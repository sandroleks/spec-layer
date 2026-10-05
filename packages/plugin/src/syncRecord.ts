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
  /** Hash of the annotation that was proposed, the way `bodyHash` is for the
   *  description: a read-back Figma normalized still compares as unchanged.
   *  Absent on records written before it existed. */
  proposed?: string;
}

/** Fields are only ever added under `v: 1`, so an older build still reads a
 *  newer record. One it cannot read is left untouched (see syncFigma.ts). */
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
  /** The held state the last run reported (`SyncPlanItem.heldKey`), so an
   *  automatic run names a held value once, not on every Update. */
  held?: string;
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
    const { nodeId, hash, proposed } = a as Record<string, unknown>;
    if (typeof nodeId !== 'string' || typeof hash !== 'string') return null;
    if (proposed !== undefined && typeof proposed !== 'string') return null;
    annotations.push({ nodeId, hash, ...(proposed !== undefined ? { proposed } : {}) });
  }
  const record: SyncRecord = { v: 1, syncedAt: o.syncedAt, pluginVersion: o.pluginVersion, annotations };
  if (o.held !== undefined) {
    if (typeof o.held !== 'string') return null;
    record.held = o.held;
  }
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

/** True when two records claim the same values. When and by which build a
 *  record was written are left out, so a run that changes nothing writes
 *  nothing. */
export function sameClaims(a: SyncRecord, b: SyncRecord): boolean {
  const claims = (r: SyncRecord): string => JSON.stringify([
    r.description ? [r.description.hash, r.description.bodyHash, r.description.origin] : null,
    r.link ? r.link.uri : null,
    r.annotations
      .map((x) => [x.nodeId, x.hash, x.proposed ?? null])
      .sort((x, y) => (x.join(' ') < y.join(' ') ? -1 : x.join(' ') > y.join(' ') ? 1 : 0)),
    r.held ?? null,
  ]);
  return claims(a) === claims(b);
}

/** Hash of a description exactly as Figma returns it, untrimmed. */
export function descriptionHash(text: string): string {
  return contentHash(['description', text]);
}

/** Hash of the doc text a description carries, without the provenance line. */
export function bodyHash(body: string): string {
  return contentHash(['body', body]);
}

/** The parts of an annotation the sync reads. The hash leaves the category
 *  out: a category recreated after a designer deleted it gets a new id, and
 *  the annotation is still the sync's own. The category only tells the sync
 *  which annotation it placed once a person has edited the text. */
export interface AnnotationLike {
  label?: string;
  labelMarkdown?: string;
  properties?: ReadonlyArray<{ type: string }>;
  categoryId?: string;
}

/** An annotation as Figma accepts it back. Figma may read an annotation with
 *  both `label` and `labelMarkdown` set but refuses a write that sets both, so
 *  a kept annotation goes back with one: the Markdown, which keeps a
 *  designer's formatting, else the plain label. */
export interface WritableAnnotation {
  label?: string;
  labelMarkdown?: string;
  properties?: Array<{ type: string }>;
  categoryId?: string;
}

export function writableAnnotation(a: AnnotationLike): WritableAnnotation {
  const out: WritableAnnotation = {};
  if (typeof a.labelMarkdown === 'string' && a.labelMarkdown !== '') out.labelMarkdown = a.labelMarkdown;
  else if (typeof a.label === 'string' && a.label !== '') out.label = a.label;
  if (a.properties?.length) out.properties = a.properties.map((p) => ({ type: p.type }));
  if (typeof a.categoryId === 'string' && a.categoryId !== '') out.categoryId = a.categoryId;
  return out;
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
