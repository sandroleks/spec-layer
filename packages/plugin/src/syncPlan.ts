/**
 * Decides, per component, what Sync to Figma writes, keeps, or skips, from
 * plain facts the main thread reads. Pure, so every rule is tested in Node.
 *
 * The rules, in one place:
 * - A live value whose hash matches the sync record is Spec Layer's own and
 *   may be replaced.
 * - Any other non-empty live value is a person's and is kept, unless the run
 *   was confirmed as a replace.
 * - Nothing is ever written to make a case go away: no text means skip.
 */
import type { SyncRecord, AnnotationLike } from './syncRecord';
import { annotationHash, bodyHash, descriptionHash } from './syncRecord';
import type { DescriptionText } from './syncText';

export type SyncAction = 'write' | 'same' | 'keep' | 'skip';

/** Why a target was kept or skipped. Each maps to one sentence in the UI. */
export type SyncReason =
  | 'nothingToWrite'      // no Usage text on the doc
  | 'writtenBeforeSync'   // a person's description, older than any sync
  | 'editedInFigma'       // changed in Figma since the last sync
  | 'removedInFigma'      // an annotation the sync placed is gone
  | 'aiNotReviewed'       // automatic runs never write unreviewed AI text
  | 'notSyncedYet'        // automatic runs only refresh components synced by hand
  | 'noFileLink';         // no file link saved, so no documentation link

export interface AnnotationSpec {
  label: string;
  properties: string[];
}

/** The annotation as Figma takes it. No label key when there is no label:
 *  an annotation may be pinned properties alone. */
export function annotationOf(spec: AnnotationSpec): { label?: string; properties: Array<{ type: string }> } {
  return {
    ...(spec.label ? { label: spec.label } : {}),
    properties: spec.properties.map((type) => ({ type })),
  };
}

export interface SyncFacts {
  docId: string;
  nodeId: string;
  name: string;
  liveDescription: string;
  liveLinks: string[];
  record: SyncRecord | null;
  description: DescriptionText | null;
  /** The link to write, null when the file link is unknown. */
  link: string | null;
  layers: Array<{ nodeId: string; live: AnnotationLike[]; proposed: AnnotationSpec }>;
}

export interface SyncOptions {
  /** The second, confirmed step: a person's values are replaced. */
  replaceEdited: boolean;
  /** Sync on Update: refresh only what a manual sync already owns. */
  auto: boolean;
}

export interface LayerPlan {
  nodeId: string;
  action: SyncAction;
  reason?: SyncReason;
  proposed: AnnotationSpec;
  /** Index in the live list of the annotation the sync owns, or -1. */
  ownIndex: number;
}

export interface SyncPlanItem {
  docId: string;
  nodeId: string;
  name: string;
  description: { action: SyncAction; reason?: SyncReason; origin?: DescriptionText['origin'] };
  link: { action: SyncAction; reason?: SyncReason };
  layers: LayerPlan[];
}

function planDescription(f: SyncFacts, o: SyncOptions): SyncPlanItem['description'] {
  const d = f.description;
  if (!d) return { action: 'skip', reason: 'nothingToWrite' };
  const origin = d.origin;
  const rec = f.record?.description;
  const live = f.liveDescription;
  if (rec && descriptionHash(live) === rec.hash) {
    if (rec.bodyHash === bodyHash(d.body)) return { action: 'same', origin };
    if (o.auto && origin !== 'authored') return { action: 'skip', reason: 'aiNotReviewed', origin };
    return { action: 'write', origin };
  }
  if (o.auto) return { action: 'skip', reason: rec ? 'editedInFigma' : 'notSyncedYet', origin };
  if (live.trim() === '' && !rec) return { action: 'write', origin };
  if (o.replaceEdited) return { action: 'write', origin };
  return { action: 'keep', reason: rec ? 'editedInFigma' : 'writtenBeforeSync', origin };
}

function planLink(f: SyncFacts, o: SyncOptions): SyncPlanItem['link'] {
  if (!f.link) return { action: 'skip', reason: 'noFileLink' };
  const live = f.liveLinks;
  if (live.length === 1 && live[0] === f.link) return { action: 'same' };
  const ours = f.record?.link !== undefined && live.length === 1 && live[0] === f.record.link.uri;
  if (live.length === 0 || ours) {
    if (o.auto && !f.record) return { action: 'skip', reason: 'notSyncedYet' };
    return { action: 'write' };
  }
  if (o.auto || !o.replaceEdited) return { action: o.auto ? 'skip' : 'keep', reason: 'editedInFigma' };
  return { action: 'write' };
}

function planLayer(
  layer: SyncFacts['layers'][number], record: SyncRecord | null, o: SyncOptions,
): LayerPlan {
  const proposedHash = annotationHash(annotationOf(layer.proposed));
  const liveHashes = layer.live.map(annotationHash);
  const owned = (record?.annotations ?? []).filter((a) => a.nodeId === layer.nodeId).map((a) => a.hash);
  const ownIndex = liveHashes.findIndex((h) => owned.includes(h));
  const base = { nodeId: layer.nodeId, proposed: layer.proposed, ownIndex };
  if (ownIndex >= 0) {
    return liveHashes[ownIndex] === proposedHash ? { ...base, action: 'same' } : { ...base, action: 'write' };
  }
  // Adopt an identical annotation instead of placing a second copy.
  const twin = liveHashes.indexOf(proposedHash);
  if (twin >= 0) return { ...base, ownIndex: twin, action: 'same' };
  if (owned.length > 0) {
    return o.replaceEdited && !o.auto
      ? { ...base, action: 'write' }
      : { ...base, action: o.auto ? 'skip' : 'keep', reason: 'removedInFigma' };
  }
  if (o.auto && !record) return { ...base, action: 'skip', reason: 'notSyncedYet' };
  return { ...base, action: 'write' };
}

export function planSync(f: SyncFacts, o: SyncOptions): SyncPlanItem {
  return {
    docId: f.docId, nodeId: f.nodeId, name: f.name,
    description: planDescription(f, o),
    link: planLink(f, o),
    layers: f.layers.map((l) => planLayer(l, f.record, o)),
  };
}

/** The live list with the sync's annotation replaced in place, or appended.
 *  Every other annotation keeps its position and content. */
export function nextAnnotations<T extends AnnotationLike>(
  live: readonly T[], plan: LayerPlan, make: (spec: AnnotationSpec) => T,
): T[] {
  const out = [...live];
  if (plan.ownIndex >= 0) out[plan.ownIndex] = make(plan.proposed);
  else out.push(make(plan.proposed));
  return out;
}

export interface SyncCounts {
  components: number;
  descriptions: number;
  links: number;
  annotations: number;
  /** Components with any value kept because a person changed it. */
  edited: string[];
  /** Components whose description to write was written with AI. */
  aiWritten: string[];
  /** Components with nothing to write, kept values included. */
  noWrites: number;
}

export function countPlan(items: readonly SyncPlanItem[]): SyncCounts {
  const c: SyncCounts = { components: items.length, descriptions: 0, links: 0, annotations: 0, edited: [], aiWritten: [], noWrites: 0 };
  for (const it of items) {
    if (it.description.action === 'write') {
      c.descriptions++;
      if (it.description.origin && it.description.origin !== 'authored') c.aiWritten.push(it.name);
    }
    if (it.link.action === 'write') c.links++;
    const layerWrites = it.layers.filter((l) => l.action === 'write').length;
    c.annotations += layerWrites;
    const kept = it.description.action === 'keep' || it.link.action === 'keep' || it.layers.some((l) => l.action === 'keep');
    if (kept) c.edited.push(it.name);
    if (it.description.action !== 'write' && it.link.action !== 'write' && layerWrites === 0) c.noWrites++;
  }
  return c;
}

/** What the doc knows about one layer, read by the main thread. */
export interface LayerFacts {
  /** The callout number from the Anatomy legend, absent on the root. */
  label?: string;
  name?: string;
  shownBy?: string;
  type: string;
  autoLayout: boolean;
  hasRadius: boolean;
}

/**
 * The annotation for one layer. Numbers are never typed: each value is a
 * pinned property, which Dev Mode renders live with its variable binding.
 * Null when there is nothing to label and nothing to pin.
 */
export function annotationFor(layer: LayerFacts): AnnotationSpec | null {
  const properties: string[] = [];
  if (layer.type === 'TEXT') properties.push('fontSize', 'lineHeight');
  if (layer.autoLayout) properties.push('padding', 'itemSpacing');
  if (layer.hasRadius) properties.push('cornerRadius');
  if (layer.type === 'INSTANCE') properties.push('mainComponent');
  const label = layer.label && layer.name
    ? `${layer.label} ${layer.name}${layer.shownBy ? ` · shown by ${layer.shownBy}` : ''}`
    : '';
  if (!label && !properties.length) return null;
  return { label, properties };
}
