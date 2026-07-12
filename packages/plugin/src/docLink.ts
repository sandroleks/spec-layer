/**
 * docLink.ts — the pure, Figma-free data model for source-linked docs.
 *
 * Owns the per-Section pluginData blob (DocLinkData), the document-root
 * registry (DocRegistry), text-content hashing for hand-edit detection, and
 * status resolution. No Figma globals: the main thread reads/writes nodes and
 * calls into these helpers, keeping the logic unit-testable (mirrors the
 * extractor-purity boundary).
 */
import { contentHash } from '@spec-layer/extractor';
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

/** The blob stored (JSON string) in a Section's pluginData. */
export interface DocLinkData {
  v: 1;
  sourceNodeId: string;
  contentHash: string;   // specContentHash of the source at generation (drift baseline)
  selfHash: string;      // textContentHash of the built Section (hand-edit baseline)
  config: DocConfig;
  generatedAt: number;
  pluginVersion: string;
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

/** Defensive parse: returns null on empty/garbage/wrong-shape (never throws). */
export function parseDocLink(raw: string): DocLinkData | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<DocLinkData>;
    if (
      j && j.v === 1 &&
      typeof j.sourceNodeId === 'string' &&
      typeof j.contentHash === 'string' &&
      typeof j.selfHash === 'string' &&
      j.config && Array.isArray(j.config.sections) &&
      typeof j.generatedAt === 'number' &&
      typeof j.pluginVersion === 'string'
    ) {
      return j as DocLinkData;
    }
  } catch { /* fall through */ }
  return null;
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
