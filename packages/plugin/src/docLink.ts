/**
 * The pure, Figma-free data model for source-linked docs: the per-Section link
 * blob, the root registry, hand-edit text hashing and status resolution.
 */
import {
  contentHash, upgradeProseV1, isProseV2, hasProseContent, normalizeAuthored,
  type FoundationScope, type ProseV2, type ProseDrafts, type SpecHashProjection, type FoundationUnitContent,
} from '@spec-layer/extractor';
import { KNOWN_SECTION_IDS, LEGACY_SECTION_IDS, type SectionId, type MeasureView } from './ui/docModel';

/** pluginData key on each generated Section. */
export const DOC_LINK_KEY = 'specLayerDoc';
/** pluginData key on figma.root holding the registry index. */
export const DOC_REGISTRY_KEY = 'specLayerDocs';

/** A component doc's generated guidelines, under their own key: the Library
 *  scan parses every link on every refresh and never reads prose. */
export const DOC_PROSE_KEY = 'specLayerProse';

/** Ceiling on a serialized prose blob, well under Figma's 100 kB per-entry
 *  plugin data cap. Over budget is dropped whole, never half-presented. */
export const PROSE_BUDGET_BYTES = 64 * 1024;

/**
 * The drift baseline for "Review detected changes": the exact object the doc's
 * content hash was computed over, since a hash alone cannot be diffed. Its own
 * key, like prose, so it gets its own 100 kB budget and the scan skips it.
 */
export const DOC_BASELINE_KEY = 'specLayerBaseline';

/** Ceiling on a serialized baseline. Over budget is dropped whole: a truncated
 *  one would report every missing item as "removed", which is fabrication. */
export const BASELINE_BUDGET_BYTES = 90 * 1024;

export interface ComponentDocBaseline {
  v: 1;
  kind: 'component';
  /** Must equal the doc link's contentHash, or the baseline is discarded. */
  contentHash: string;
  projection: SpecHashProjection;
}

export interface FoundationDocBaseline {
  v: 1;
  kind: 'foundation';
  contentHash: string;
  projection: FoundationUnitContent;
}

export type DocBaseline = ComponentDocBaseline | FoundationDocBaseline;

/**
 * UTF-8 byte length without `TextEncoder`, which Figma's main-thread sandbox
 * lacks (Node has it, so tests delete the global to reproduce the sandbox). A
 * lone surrogate counts 3 bytes, like the U+FFFD an encoder replaces it with.
 */
function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const low = s.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export function serializeProse(p: ProseV2): string {
  const out = JSON.stringify(p);
  // Figma stores plugin data as UTF-8; measure encoded length, not UTF-16 units.
  const bytes = utf8ByteLength(out);
  if (bytes > PROSE_BUDGET_BYTES) {
    // Dropped whole; the log is the only record.
    console.warn(`[Spec Layer] prose dropped: ${bytes} bytes exceeds the ${PROSE_BUDGET_BYTES}-byte budget`);
    return '';
  }
  return out;
}

const V2_ARRAY_KEYS = [
  'whenToUse', 'whenNotToUse', 'variantsGuide', 'anatomyParts', 'properties', 'states',
  'keyboard', 'pointer', 'semantics', 'content', 'guidelines',
] as const;
const V2_STRING_KEYS = ['variantsIntro', 'anatomySummary'] as const;

/** A stored v2 blob, field by field, with anything mistyped dropped. */
function readProseV2(o: Record<string, unknown>): ProseV2 | null {
  const out: ProseV2 = { v: 2 };
  const ov = o.overview as { lede?: unknown; body?: unknown } | undefined;
  if (ov && typeof ov === 'object' && typeof ov.lede === 'string') {
    out.overview = {
      lede: ov.lede,
      body: Array.isArray(ov.body) ? ov.body.filter((x): x is string => typeof x === 'string') : [],
    };
  }
  for (const k of V2_STRING_KEYS) if (typeof o[k] === 'string') out[k] = o[k] as string;
  for (const k of V2_ARRAY_KEYS) {
    if (Array.isArray(o[k])) (out as unknown as Record<string, unknown>)[k] = o[k];
  }
  // Keys a person typed on canvas; omitted when empty.
  const authored = normalizeAuthored(o.authored);
  if (authored.length) out.authored = authored;
  return hasProseContent(out) ? out : null;
}

/** A stored v1 blob (no `v`), upgraded. Null when it is not a v1 shape either. */
function readProseV1(o: Record<string, unknown>): ProseV2 | null {
  if (typeof o.definition !== 'string' || typeof o.accessibility !== 'string') return null;
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const v1: ProseDrafts = {
    definition: o.definition,
    accessibility: o.accessibility,
    dos: strings(o.dos),
    donts: strings(o.donts),
  };
  // `designConsiderations` is dropped: no section ever rendered it.
  for (const k of ['interactions', 'variantsSummary', 'anatomySummary', 'contentConsiderations'] as const) {
    if (typeof o[k] === 'string') v1[k] = o[k] as string;
  }
  if (Array.isArray(o.anatomyParts)) v1.anatomyParts = o.anatomyParts as ProseDrafts['anatomyParts'];
  const upgraded = upgradeProseV1(v1);
  return hasProseContent(upgraded) ? upgraded : null;
}

/** Parse stored prose. A v1 blob is upgraded on read, so no consumer branches
 *  on the version. Null for nothing, garbage, an unknown version or no content. */
export function parseProse(raw: string): ProseV2 | null {
  if (!raw) return null;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  if (isProseV2(o)) return readProseV2(o);
  if (o.v !== undefined) return null;
  return readProseV1(o);
}

export function serializeBaseline(baseline: DocBaseline): string {
  const out = JSON.stringify(baseline);
  const bytes = utf8ByteLength(out);
  if (bytes > BASELINE_BUDGET_BYTES) {
    // Dropped whole and logged: the Library then asks for an Update that
    // already ran, and the log is the only record of why.
    console.warn(`[Spec Layer] baseline dropped: ${bytes} bytes exceeds the ${BASELINE_BUDGET_BYTES}-byte budget`);
    return '';
  }
  return out;
}

/** Defensive parse: null on empty, malformed, wrong `v` or `kind`, or a
 *  non-object projection. The interior is not validated; the diff treats
 *  unknown shapes as absent lists. */
export function parseBaseline(raw: string): DocBaseline | null {
  if (!raw) return null;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (o.kind !== 'component' && o.kind !== 'foundation') return null;
  if (typeof o.contentHash !== 'string') return null;
  if (!o.projection || typeof o.projection !== 'object' || Array.isArray(o.projection)) return null;
  return o as unknown as DocBaseline;
}

/** Parse, then accept only a baseline whose kind and contentHash match the
 *  link's; a stale or foreign one is rejected. */
export function baselineFor(link: DocLinkData, raw: string): DocBaseline | null {
  const baseline = parseBaseline(raw);
  if (!baseline) return null;
  const kind = isFoundationLink(link) ? 'foundation' : 'component';
  if (baseline.kind !== kind || baseline.contentHash !== link.contentHash) return null;
  return baseline;
}

/** Everything needed to faithfully regenerate a doc on Update. */
export interface DocConfig {
  sections: SectionId[];
  variantIds: string[];
  aiEnabled: boolean;
  anatomyView: 'diagram';
  measureViews: MeasureView[];
  /**
   * Draw the parts a boolean component property hides by default. FALSE on
   * older links, so their output and drift hash are unchanged. Unlike
   * measureViews, this DOES move specContentHash when on (see SpecHashOptions).
   */
  includeHidden: boolean;
}

/** Everything needed to faithfully regenerate a component doc on Update. */
export interface ComponentDocLink {
  v: 1;
  /** Absent on every blob written before foundation support. */
  kind?: 'component';
  sourceNodeId: string;
  contentHash: string;   // specContentHash of the source at generation (drift baseline)
  /** Hash of the Section's GENERATED text (hand-edit baseline). Editorial
   *  slots are excluded, since an Update keeps them; a doc without slots
   *  hashes all its text, which is what its stored value covered. */
  selfHash: string;
  config: DocConfig;
  generatedAt: number;
  pluginVersion: string;
  /** `EXTRACTOR_VERSION` that produced this doc, so a drift check can tell an
   *  extractor change from a content change. Absent means stale: rebuilt once. */
  extractorVersion?: string;
  /** Legacy name for extractorVersion: read, never written. Its values
   *  ('0.1'/'0.2') never equal an EXTRACTOR_VERSION, so such a doc reads as
   *  rebuild-required. */
  specVersion?: string;
}

export interface FoundationConfig {
  includeDescriptions: boolean;
  aiNotes: boolean;
  /** Render the colour contrast matrix. FALSE on older links. Derived from
   *  colours already hashed via FoundationUnitContent.rows, so toggling it
   *  moves no foundationContentHash, as with includeDescriptions. */
  includeContrast: boolean;
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
   * AI-written descriptions for the groups THIS doc renders, keyed by folder
   * path. Stored because an Update rebuilds from the link alone, and
   * regenerating would spend the user's AI quota. Absent when never generated.
   */
  groupDescriptions?: Record<string, string>;
  /** AI-written paragraph about the whole collection, stored for the same
   *  reasons; absent when never generated. */
  collectionOverview?: string;
  generatedAt: number;
  pluginVersion: string;
}

/** The blob stored (JSON string) in a Section's pluginData. */
export type DocLinkData = ComponentDocLink | FoundationDocLink;

export function isFoundationLink(d: DocLinkData): d is FoundationDocLink {
  return d.kind === 'foundation';
}

/**
 * Every foundation link's group descriptions in one map for the Foundation
 * copy and download (`foundationDtcgJson`), keyed by collection name then
 * folder, since two collections can share a folder name. A styles link has no
 * collection name and is skipped, never given an invented key. When two links
 * name one collection, later links win on a folder collision.
 */
export function mergeFoundationGroupDescriptions(
  links: readonly FoundationDocLink[],
): Record<string, Record<string, string>> {
  const merged: Record<string, Record<string, string>> = {};
  for (const link of links) {
    if (link.scope.target !== 'collection') continue;
    const folders = link.groupDescriptions;
    if (!folders || Object.keys(folders).length === 0) continue;
    const name = link.scope.collectionName;
    merged[name] = { ...(merged[name] ?? {}), ...folders };
  }
  return merged;
}

/** The key that matches a foundation Section to its predecessor on regenerate. */
export function foundationScopeKey(s: FoundationScope): string {
  if (s.target === 'textStyles') return `text:${s.group ?? ''}`;
  if (s.target === 'effectStyles') return `effect:${s.group ?? ''}`;
  return `coll:${s.collectionId}:${s.group ?? ''}`;
}

/**
 * Re-point a scope whose collection id no longer exists at the ONE live
 * collection with its name (a re-created collection gets a fresh id). Figma
 * allows duplicate names, so with several matches the scope comes back
 * untouched: guessing would rebuild the doc from unrelated variables.
 */
export function retargetScope(
  scope: FoundationScope,
  collections: readonly { id: string; name: string }[],
): FoundationScope {
  if (scope.target !== 'collection') return scope;
  // A const, so the narrowing survives into the closures below.
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

/** Defensive parse, never throws. A blob without `kind` is a component link. */
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

/** Legacy ids expand to their successors, known ids pass through, anything
 *  else drops. Order is preserved, with no duplicates. */
function migrateSectionIds(raw: unknown[]): SectionId[] {
  const out: SectionId[] = [];
  for (const x of raw) {
    if (typeof x !== 'string') continue;
    const legacy = LEGACY_SECTION_IDS[x];
    const mapped: SectionId[] = legacy ?? (KNOWN_SECTION_IDS.has(x) ? [x as SectionId] : []);
    for (const id of mapped) if (!out.includes(id)) out.push(id);
  }
  return out;
}

function parseComponentLink(j: Partial<ComponentDocLink>): ComponentDocLink | null {
  if (
    typeof j.sourceNodeId !== 'string' || !commonValid(j)
    || !j.config || !Array.isArray(j.config.sections)
  ) return null;

  const c = j.config as Partial<DocConfig>;
  const config: DocConfig = {
    sections: migrateSectionIds(c.sections ?? []),
    variantIds: Array.isArray(c.variantIds) ? c.variantIds.filter((x): x is string => typeof x === 'string') : [],
    aiEnabled: c.aiEnabled === true,
    // Diagram-only: old table/both links converge on the current output.
    anatomyView: 'diagram',
    measureViews: Array.isArray(c.measureViews)
      ? c.measureViews.filter((x): x is MeasureView => x === 'size' || x === 'padding' || x === 'spacing')
      : [],
    includeHidden: c.includeHidden === true,
  };
  // Normalize `specVersion` forward, so consumers read one field.
  const extractorVersion = j.extractorVersion ?? j.specVersion;
  return {
    ...(j as ComponentDocLink),
    config,
    ...(extractorVersion === undefined ? {} : { extractorVersion }),
  };
}

function parseScope(raw: unknown): FoundationScope | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;

  if (s.target === 'textStyles') {
    return typeof s.group === 'string'
      ? { target: 'textStyles', group: s.group }
      : { target: 'textStyles' };
  }
  if (s.target === 'effectStyles') {
    return typeof s.group === 'string'
      ? { target: 'effectStyles', group: s.group }
      : { target: 'effectStyles' };
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
      includeContrast: c.includeContrast === true,
    },
    // Omitted, not {}, so an older doc still serializes byte-identically.
    ...(descriptions ? { groupDescriptions: descriptions } : {}),
    ...(typeof j.collectionOverview === 'string' && j.collectionOverview.trim()
      ? { collectionOverview: j.collectionOverview } : {}),
    generatedAt: j.generatedAt as number,
    pluginVersion: j.pluginVersion as string,
  };
}

/** Only non-empty string entries survive; null when none do, so the caller
 *  omits the field. */
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

/** Hash of a Section's text runs, in document order (the extractor's hash). */
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
