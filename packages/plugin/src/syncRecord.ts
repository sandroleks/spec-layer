/**
 * What Annotate in Dev Mode wrote on a component, kept in the component's own plugin
 * data so it travels with the node. Every field holds a hash of the value as
 * Figma read it back after the write, never of what was sent: a live value
 * with the same hash is Spec Layer's own, and any other value is a person's.
 *
 * The serializer reads this too (`ownDescription`, `ownDocumentationLink`), so
 * text the sync wrote is never read back as source. That is what keeps a
 * synced doc from reporting drift against its own words.
 */
import { contentHash } from '@spec-layer/extractor';

export const SYNC_RECORD_KEY = 'specLayerSync';

/** `authored`: every synced section was typed or edited by a person.
 *  `ai`: none was. `mixed`: some were. */
export type SyncOrigin = 'authored' | 'ai' | 'mixed';

export interface SyncedAnnotation {
  /** The layer the annotation sits on. */
  nodeId: string;
  hash: string;
}

export interface SyncRecord {
  v: 1;
  syncedAt: number;
  pluginVersion: string;
  /** `hash` covers the plain description Figma derives from the Markdown.
   *  `bodyHash` covers the text without the dated provenance line, so a
   *  re-sync on another day with the same doc text writes nothing. */
  description?: { hash: string; bodyHash: string; origin: SyncOrigin };
  link?: { uri: string };
  annotations: SyncedAnnotation[];
}

const ORIGINS: ReadonlySet<string> = new Set(['authored', 'ai', 'mixed']);

export function serializeSyncRecord(record: SyncRecord): string {
  return JSON.stringify(record);
}

/** A record that does not parse, or has the wrong shape, reads as absent: the
 *  plugin then treats every live value as a person's, which never overwrites. */
export function parseSyncRecord(raw: string): SyncRecord | null {
  if (!raw) return null;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  if (o.v !== 1 || typeof o.syncedAt !== 'number' || typeof o.pluginVersion !== 'string') return null;
  if (!Array.isArray(o.annotations)) return null;
  const annotations: SyncedAnnotation[] = [];
  for (const a of o.annotations) {
    if (!a || typeof a !== 'object') return null;
    const { nodeId, hash } = a as Record<string, unknown>;
    if (typeof nodeId !== 'string' || typeof hash !== 'string') return null;
    annotations.push({ nodeId, hash });
  }
  const record: SyncRecord = { v: 1, syncedAt: o.syncedAt, pluginVersion: o.pluginVersion, annotations };
  const d = o.description as Record<string, unknown> | undefined;
  if (d !== undefined) {
    if (!d || typeof d.hash !== 'string' || typeof d.bodyHash !== 'string'
      || typeof d.origin !== 'string' || !ORIGINS.has(d.origin)) return null;
    record.description = { hash: d.hash, bodyHash: d.bodyHash, origin: d.origin as SyncOrigin };
  }
  const l = o.link as Record<string, unknown> | undefined;
  if (l !== undefined) {
    if (!l || typeof l.uri !== 'string') return null;
    record.link = { uri: l.uri };
  }
  return record;
}

/** Hash of a description exactly as Figma returns it, untrimmed. */
export function descriptionHash(text: string): string {
  return contentHash(['description', text]);
}

/** Hash of the doc text a description carries, without the provenance line. */
export function bodyHash(body: string): string {
  return contentHash(['body', body]);
}

/** The parts of an annotation the sync controls. The category is left out:
 *  a category recreated after a designer deleted it gets a new id, and the
 *  annotation is still the sync's own. */
export interface AnnotationLike {
  label?: string;
  labelMarkdown?: string;
  properties?: ReadonlyArray<{ type: string }>;
}

export function annotationHash(a: AnnotationLike): string {
  const label = typeof a.label === 'string' ? a.label : (typeof a.labelMarkdown === 'string' ? a.labelMarkdown : '');
  const props = (a.properties ?? []).map((p) => p.type).sort();
  return contentHash(['annotation', label, props]);
}

/** True when the live description is the one the sync wrote. */
export function ownDescription(live: string | undefined, record: SyncRecord | null): boolean {
  return record?.description !== undefined && typeof live === 'string'
    && descriptionHash(live) === record.description.hash;
}

/** True when the live documentation links are exactly the one the sync wrote. */
export function ownDocumentationLink(live: readonly string[], record: SyncRecord | null): boolean {
  return record?.link !== undefined && live.length === 1 && live[0] === record.link.uri;
}
