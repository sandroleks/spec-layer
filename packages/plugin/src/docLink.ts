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
  generatedAt: number;
  pluginVersion: string;
}

/** The blob stored (JSON string) in a Section's pluginData. */
export type DocLinkData = ComponentDocLink | FoundationDocLink;

export function isFoundationLink(d: DocLinkData): d is FoundationDocLink {
  return d.kind === 'foundation';
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
    anatomyView: c.anatomyView === 'diagram' || c.anatomyView === 'table' || c.anatomyView === 'both' ? c.anatomyView : 'both',
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
    generatedAt: j.generatedAt as number,
    pluginVersion: j.pluginVersion as string,
  };
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
