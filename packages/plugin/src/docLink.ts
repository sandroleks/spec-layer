/**
 * docLink.ts — the pure, Figma-free data model for source-linked docs.
 *
 * Owns the per-Section pluginData blob (DocLinkData), the document-root
 * registry (DocRegistry), text-content hashing for hand-edit detection, and
 * status resolution. No Figma globals: the main thread reads/writes nodes and
 * calls into these helpers, keeping the logic unit-testable (mirrors the
 * extractor-purity boundary).
 */
import { contentHash, type FoundationScope } from '@spec-layer/extractor';
import type { SectionId, MeasureView } from './ui/docModel';

/** pluginData key on each generated Section. */
export const DOC_LINK_KEY = 'specLayerDoc';
/** pluginData key on figma.root holding the registry index. */
export const DOC_REGISTRY_KEY = 'specLayerDocs';

/** Everything needed to faithfully regenerate a doc on Update. */
export interface DocConfig {
  sections: SectionId[];
  variantIds: string[];
  aiEnabled: boolean;
  anatomyView: 'diagram' | 'table' | 'both';
  measureViews: MeasureView[];
}

/** Everything needed to faithfully regenerate a component doc on Update. */
export interface ComponentDocLink {
  v: 1;
  /** Absent on every blob written before foundation support. */
  kind?: 'component';
  sourceNodeId: string;
  contentHash: string;   // specContentHash of the source at generation (drift baseline)
  selfHash: string;      // textContentHash of the built Section (hand-edit baseline)
  config: DocConfig;
  generatedAt: number;
  pluginVersion: string;
  /** Extractor format that produced this doc. Absent on every blob written
   *  before 0.2; treated as stale so the doc is rebuilt once. */
  specVersion?: string;
}

export interface FoundationConfig {
  includeDescriptions: boolean;
  aiNotes: boolean;
}

/** A foundation doc has no source node: its source is the file's own
 *  collections, addressed by scope. */
export interface FoundationDocLink {
  v: 1;
  kind: 'foundation';
  scope: FoundationScope;
  contentHash: string;   // foundationContentHash for this scope at generation
  selfHash: string;
  config: FoundationConfig;
  /**
   * AI-written group descriptions, keyed by folder path, for the groups THIS doc
   * renders. Stored rather than passed at render time for two reasons: an Update
   * rebuilds a doc from its stored link with no UI round trip, so descriptions
   * that lived only in the render call would be silently deleted by the first
   * Update (the same way part numbers once were), and regenerating them would
   * spend another AI generation from the user's quota every time.
   *
   * Absent on any doc generated without AI descriptions, including every doc
   * written before they existed.
   */
  groupDescriptions?: Record<string, string>;
  generatedAt: number;
  pluginVersion: string;
}

/** The blob stored (JSON string) in a Section's pluginData. */
export type DocLinkData = ComponentDocLink | FoundationDocLink;

export function isFoundationLink(d: DocLinkData): d is FoundationDocLink {
  return d.kind === 'foundation';
}

/** The key by which a foundation Section is matched to its predecessor on
 *  regenerate: two sections cover the same doc when they target the same
 *  collection and group, or both cover text styles with the same group. */
export function foundationScopeKey(s: FoundationScope): string {
  return s.target === 'textStyles'
    ? `text:${s.group ?? ''}`
    : `coll:${s.collectionId}:${s.group ?? ''}`;
}

/**
 * Re-point a stored foundation scope at a live collection when its recorded id
 * no longer exists.
 *
 * A renamed or re-created collection keeps its name but gets a fresh id, and
 * retargeting by name is what lets such a doc read as "Update available"
 * instead of "Source missing". But Figma allows two collections to share a
 * name, so a name match is only evidence when there is exactly ONE of them:
 * with several, the doc could just as easily belong to a collection that was
 * deleted, and guessing would rebuild it from unrelated variables and stamp the
 * wrong id in. Ambiguous means unresolved, so the scope comes back untouched
 * and the caller's existing "this doc can no longer be rebuilt" path handles it.
 *
 * Returns the scope unchanged when it targets text styles, when its id still
 * resolves, or when the name match is anything other than a single hit.
 */
export function retargetScope(
  scope: FoundationScope,
  collections: readonly { id: string; name: string }[],
): FoundationScope {
  if (scope.target !== 'collection') return scope;
  // Bind to a const so the 'collection' narrowing survives into the closures
  // below: narrowing does not carry into a callback for a mutable binding.
  const s = scope;
  if (collections.some((c) => c.id === s.collectionId)) return s;
  const byName = collections.filter((c) => c.name === s.collectionName);
  if (byName.length !== 1) return s;
  return { ...s, collectionId: byName[0].id };
}

/** The index stored (JSON string) on figma.root. */
export interface DocRegistry { v: 1; docIds: string[] }

export type DocStatus = 'inSync' | 'updateAvailable' | 'edited' | 'orphaned';

export interface DocFacts {
  sourceExists: boolean;
  sourceDrifted: boolean;
  selfEdited: boolean;
}

export function serializeDocLink(d: DocLinkData): string {
  return JSON.stringify(d);
}

/** Defensive parse: returns null on empty/garbage/wrong-shape (never throws).
 *  Branches on `kind` FIRST so a blob without one takes the original
 *  component path unchanged. */
export function parseDocLink(raw: string): DocLinkData | null {
  if (!raw) return null;
  let j: Record<string, unknown>;
  try { j = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  if (!j || j.v !== 1) return null;
  return j.kind === 'foundation'
    ? parseFoundationLink(j as unknown as Partial<FoundationDocLink>)
    : parseComponentLink(j as unknown as Partial<ComponentDocLink>);
}

function commonValid(j: { contentHash?: unknown; selfHash?: unknown; generatedAt?: unknown; pluginVersion?: unknown }): boolean {
  return typeof j.contentHash === 'string'
    && typeof j.selfHash === 'string'
    && typeof j.generatedAt === 'number'
    && typeof j.pluginVersion === 'string';
}

function parseComponentLink(j: Partial<ComponentDocLink>): ComponentDocLink | null {
  if (
    typeof j.sourceNodeId !== 'string' || !commonValid(j)
    || !j.config || !Array.isArray(j.config.sections)
  ) return null;

  const c = j.config as Partial<DocConfig>;
  const config: DocConfig = {
    sections: (c.sections ?? []).filter((x): x is SectionId => typeof x === 'string'),
    variantIds: Array.isArray(c.variantIds) ? c.variantIds.filter((x): x is string => typeof x === 'string') : [],
    aiEnabled: c.aiEnabled === true,
    // Anatomy is intentionally diagram-only. Normalize old table/both links so
    // every update converges on the current output contract.
    anatomyView: 'diagram',
    measureViews: Array.isArray(c.measureViews)
      ? c.measureViews.filter((x): x is MeasureView => x === 'size' || x === 'padding' || x === 'spacing')
      : [],
  };
  return { ...(j as ComponentDocLink), config };
}

function parseScope(raw: unknown): FoundationScope | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;

  if (s.target === 'textStyles') {
    return typeof s.group === 'string'
      ? { target: 'textStyles', group: s.group }
      : { target: 'textStyles' };
  }
  if (s.target === 'collection') {
    if (typeof s.collectionId !== 'string' || typeof s.collectionName !== 'string') return null;
    const modeIds = Array.isArray(s.modeIds)
      ? s.modeIds.filter((x): x is string => typeof x === 'string')
      : [];
    return {
      target: 'collection',
      collectionId: s.collectionId,
      collectionName: s.collectionName,
      ...(typeof s.group === 'string' ? { group: s.group } : {}),
      modeIds,
    };
  }
  return null;
}

function parseFoundationLink(j: Partial<FoundationDocLink>): FoundationDocLink | null {
  if (!commonValid(j)) return null;
  const scope = parseScope(j.scope);
  if (!scope) return null;
  const c = (j.config ?? {}) as Partial<FoundationConfig>;
  const descriptions = parseGroupDescriptions(j.groupDescriptions);
  return {
    v: 1,
    kind: 'foundation',
    scope,
    contentHash: j.contentHash as string,
    selfHash: j.selfHash as string,
    config: {
      includeDescriptions: c.includeDescriptions !== false,
      aiNotes: c.aiNotes === true,
    },
    // Omitted rather than set to {} when there are none, so a doc written before
    // descriptions existed still serializes byte-identically.
    ...(descriptions ? { groupDescriptions: descriptions } : {}),
    generatedAt: j.generatedAt as number,
    pluginVersion: j.pluginVersion as string,
  };
}

/**
 * Validate a stored description map, dropping anything that is not a
 * string-to-string entry. Returns null when there is nothing usable, so the
 * caller can omit the field entirely.
 */
function parseGroupDescriptions(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function serializeRegistry(r: DocRegistry): string {
  return JSON.stringify(r);
}

export function parseRegistry(raw: string): DocRegistry {
  if (raw) {
    try {
      const j = JSON.parse(raw) as Partial<DocRegistry>;
      if (j && j.v === 1 && Array.isArray(j.docIds)) {
        return { v: 1, docIds: j.docIds.filter((x): x is string => typeof x === 'string') };
      }
    } catch { /* fall through */ }
  }
  return { v: 1, docIds: [] };
}

export function addDoc(r: DocRegistry, docId: string): DocRegistry {
  return r.docIds.includes(docId) ? r : { v: 1, docIds: [...r.docIds, docId] };
}

export function removeDoc(r: DocRegistry, docId: string): DocRegistry {
  return { v: 1, docIds: r.docIds.filter((id) => id !== docId) };
}

/** Keep only ids present in `keep` (drop dangling entries → self-heal). */
export function pruneRegistry(r: DocRegistry, keep: Set<string>): DocRegistry {
  return { v: 1, docIds: r.docIds.filter((id) => keep.has(id)) };
}

/** Hash of a Section's text runs, in document order. Reuses the extractor's
 *  canonical hash so behavior matches the rest of the codebase. */
export function textContentHash(texts: string[]): string {
  return contentHash(texts);
}

/** Displayed status from the three facts. Priority: orphaned > updateAvailable
 *  > edited > inSync. */
export function resolveStatus(f: DocFacts): DocStatus {
  if (!f.sourceExists) return 'orphaned';
  if (f.sourceDrifted) return 'updateAvailable';
  if (f.selfEdited) return 'edited';
  return 'inSync';
}
