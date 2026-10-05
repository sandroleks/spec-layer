/**
 * Decides, per component, what Annotate in Dev Mode writes, keeps, or skips, from
 * plain facts the main thread reads. Pure, so every rule is tested in Node.
 *
 * The rules, in one place:
 * - A live value whose hash matches the sync record is Spec Layer's own and
 *   may be replaced, cleared or removed.
 * - Any other value is a person's, and so is the gap where a person removed
 *   one: it is kept, unless the run was confirmed as a replace.
 * - An automatic run only refreshes what a manual run wrote, and never writes
 *   AI text nobody has reviewed.
 * - Nothing is ever written to make a case go away: no text means skip.
 */
import { contentHash } from '@spec-layer/extractor';
import type { SyncRecord, AnnotationLike } from './syncRecord';
import { annotationHash, bodyHash, descriptionHash } from './syncRecord';
import type { DescriptionText } from './syncText';

/** `clear` empties Spec Layer's own description once the doc has no Usage
 *  text; only the description is ever cleared. */
export type SyncAction = 'write' | 'same' | 'keep' | 'skip' | 'clear';

/** Why a target was kept or skipped. */
export type SyncReason =
  | 'nothingToWrite'      // no Usage text on the doc
  | 'writtenBeforeSync'   // a person's value, older than any sync
  | 'editedInFigma'       // changed in Figma since the last sync
  | 'removedInFigma'      // a value the sync wrote was removed in Figma
  | 'aiNotReviewed'       // automatic runs never write unreviewed AI text
  | 'notSyncedYet'        // automatic runs only refresh what a manual run wrote
  | 'noFileLink';         // no file link saved, so no documentation link

/** What an automatic run holds back. A person's value from before any sync
 *  is not among them: it was never Spec Layer's to refresh. */
const AUTO_HELD: ReadonlySet<SyncReason> = new Set(['editedInFigma', 'removedInFigma', 'aiNotReviewed']);

/** Every reason a value is left for a person to review. */
export const HELD_REASONS: ReadonlySet<SyncReason> = new Set([...AUTO_HELD, 'writtenBeforeSync']);

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
  /** Layers the record names that this run does not plan, because the doc no
   *  longer numbers them. `live` is null when the layer is gone. */
  orphans: Array<{ nodeId: string; live: AnnotationLike[] | null }>;
  /** The Spec Layer annotation category, null when the file has none. */
  categoryId: string | null;
  /** False when the doc's legend no longer numbers today's parts: no
   *  annotation is placed or removed until the doc is updated. */
  legendCurrent: boolean;
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
  /** Hash of `proposed`, recorded with a write. */
  proposedHash: string;
  /** Index in the live list of the annotation the sync owns, or -1. On
   *  `same`, -1 is a person's identical annotation, which is not claimed. */
  ownIndex: number;
}

/** A layer the doc no longer numbers. `remove` takes Spec Layer's own
 *  annotation off it; `drop` forgets the record entry and writes nothing,
 *  because the layer is gone or a person edited the annotation. */
export interface OrphanPlan {
  nodeId: string;
  action: 'remove' | 'drop';
  ownIndex: number;
}

export interface SyncPlanItem {
  docId: string;
  nodeId: string;
  name: string;
  description: { action: SyncAction; reason?: SyncReason; origin?: DescriptionText['origin'] };
  link: { action: SyncAction; reason?: SyncReason };
  layers: LayerPlan[];
  orphans: OrphanPlan[];
  /** The doc's legend is out of date, so its annotations wait for an Update. */
  updateFirst: boolean;
  /** Identifies what an automatic run holds back, the same in a manual run,
   *  so a value is named once. Absent when nothing is held. */
  heldKey?: string;
}

function planDescription(f: SyncFacts, o: SyncOptions): SyncPlanItem['description'] {
  const d = f.description;
  const rec = f.record?.description;
  const live = f.liveDescription;
  const ours = rec !== undefined && descriptionHash(live) === rec.hash;
  // No Usage text: Spec Layer's own description goes, a person's stays.
  if (!d) return ours ? { action: 'clear' } : { action: 'skip', reason: 'nothingToWrite' };
  const origin = d.origin;
  if (ours) {
    // The provenance line follows the origin, so it counts as a change.
    const sameOrigin = (rec.origin === 'authored') === (origin === 'authored');
    if (rec.bodyHash === bodyHash(d.body) && sameOrigin) return { action: 'same', origin };
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
  const rec = f.record?.link;
  // Its own older link, for example to a doc Section an Update replaced.
  if (rec && live.length === 1 && live[0] === rec.uri) return { action: 'write' };
  const reason: SyncReason = !rec ? 'writtenBeforeSync' : live.length === 0 ? 'removedInFigma' : 'editedInFigma';
  if (o.auto) return { action: 'skip', reason: rec ? reason : 'notSyncedYet' };
  if (live.length === 0 && !rec) return { action: 'write' };
  if (o.replaceEdited) return { action: 'write' };
  return { action: 'keep', reason };
}

function planLayer(
  layer: SyncFacts['layers'][number], record: SyncRecord | null, categoryId: string | null, o: SyncOptions,
): LayerPlan {
  const proposedHash = annotationHash(annotationOf(layer.proposed));
  const liveHashes = layer.live.map(annotationHash);
  const owned = (record?.annotations ?? []).filter((a) => a.nodeId === layer.nodeId);
  const ownIndex = liveHashes.findIndex((h) => owned.some((a) => a.hash === h));
  const base = { nodeId: layer.nodeId, proposed: layer.proposed, proposedHash };
  if (ownIndex >= 0) {
    const entry = owned.find((a) => a.hash === liveHashes[ownIndex]);
    const unchanged = entry?.proposed !== undefined
      ? entry.proposed === proposedHash
      : liveHashes[ownIndex] === proposedHash;
    return { ...base, ownIndex, action: unchanged ? 'same' : 'write' };
  }
  // An identical annotation is never doubled. In the Spec Layer category it
  // is adopted; otherwise it is a person's and stays theirs.
  const twin = liveHashes.indexOf(proposedHash);
  if (twin >= 0) {
    const ours = categoryId !== null && layer.live[twin].categoryId === categoryId;
    return { ...base, ownIndex: ours ? twin : -1, action: 'same' };
  }
  if (owned.length > 0) {
    // The sync's annotation was edited or removed. An edited one still sits
    // in the Spec Layer category, so a Replace writes over it in place.
    const edited = categoryId === null ? -1 : layer.live.findIndex((a) => a.categoryId === categoryId);
    if (o.replaceEdited && !o.auto) return { ...base, ownIndex: edited, action: 'write' };
    return {
      ...base, ownIndex: edited, action: o.auto ? 'skip' : 'keep',
      reason: edited >= 0 ? 'editedInFigma' : 'removedInFigma',
    };
  }
  if (o.auto && !record) return { ...base, ownIndex: -1, action: 'skip', reason: 'notSyncedYet' };
  return { ...base, ownIndex: -1, action: 'write' };
}

function planOrphans(f: SyncFacts): OrphanPlan[] {
  const planned = new Set(f.layers.map((l) => l.nodeId));
  const out: OrphanPlan[] = [];
  for (const entry of f.record?.annotations ?? []) {
    if (planned.has(entry.nodeId) || out.some((p) => p.nodeId === entry.nodeId)) continue;
    const owned = (f.record?.annotations ?? []).filter((a) => a.nodeId === entry.nodeId).map((a) => a.hash);
    const live = f.orphans.find((x) => x.nodeId === entry.nodeId)?.live ?? null;
    const ownIndex = live ? live.findIndex((a) => owned.includes(annotationHash(a))) : -1;
    out.push({ nodeId: entry.nodeId, action: ownIndex >= 0 ? 'remove' : 'drop', ownIndex });
  }
  return out;
}

function heldKey(item: Omit<SyncPlanItem, 'heldKey'>, f: SyncFacts): string | undefined {
  const held: string[] = [];
  const d = item.description;
  if (d.reason && AUTO_HELD.has(d.reason)) {
    const what = d.reason === 'aiNotReviewed' && f.description ? bodyHash(f.description.body) : descriptionHash(f.liveDescription);
    held.push(`description ${d.reason} ${what}`);
  }
  if (item.link.reason && AUTO_HELD.has(item.link.reason)) held.push(`link ${item.link.reason} ${f.liveLinks.join(' ')}`);
  item.layers.forEach((l, i) => {
    if (!l.reason || !AUTO_HELD.has(l.reason)) return;
    const live = f.layers[i].live;
    held.push(`layer ${l.nodeId} ${l.reason} ${l.ownIndex >= 0 ? annotationHash(live[l.ownIndex]) : ''}`);
  });
  return held.length ? contentHash(['held', held]) : undefined;
}

export function planSync(f: SyncFacts, o: SyncOptions): SyncPlanItem {
  // A number on a layer must match the legend's, so a stale legend places
  // nothing and removes nothing: the record keeps every claim it had.
  const annotate = f.legendCurrent;
  const item = {
    docId: f.docId, nodeId: f.nodeId, name: f.name,
    description: planDescription(f, o),
    link: planLink(f, o),
    layers: annotate ? f.layers.map((l) => planLayer(l, f.record, f.categoryId, o)) : [],
    orphans: annotate ? planOrphans(f) : [],
    updateFirst: !annotate,
  };
  const key = heldKey(item, f);
  return key ? { ...item, heldKey: key } : item;
}

/** True when a target was left for a person to review. */
export function isHeld(item: SyncPlanItem): boolean {
  const held = (t: { reason?: SyncReason }): boolean => t.reason !== undefined && HELD_REASONS.has(t.reason);
  return held(item.description) || held(item.link) || item.layers.some(held);
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
  /** Spec Layer's own descriptions emptied, because the doc has no Usage text. */
  cleared: number;
  links: number;
  annotations: number;
  /** Spec Layer's own annotations taken off layers the doc no longer numbers. */
  removed: number;
  /** Components with a value kept because a person set, changed or removed it. */
  edited: string[];
  /** Components whose description to write has AI text nobody edited. */
  aiWritten: string[];
  /** Components whose kept description a Replace would write over with such text. */
  keptAi: string[];
  /** Components whose annotations wait for an Update of their doc. */
  updateFirst: string[];
}

export function countPlan(items: readonly SyncPlanItem[]): SyncCounts {
  const c: SyncCounts = {
    components: items.length, descriptions: 0, cleared: 0, links: 0, annotations: 0, removed: 0,
    edited: [], aiWritten: [], keptAi: [], updateFirst: [],
  };
  const ai = (origin: DescriptionText['origin'] | undefined): boolean => origin !== undefined && origin !== 'authored';
  for (const it of items) {
    if (it.description.action === 'write') {
      c.descriptions++;
      if (ai(it.description.origin)) c.aiWritten.push(it.name);
    }
    if (it.description.action === 'clear') c.cleared++;
    if (it.description.action === 'keep' && ai(it.description.origin)) c.keptAi.push(it.name);
    if (it.link.action === 'write') c.links++;
    c.annotations += it.layers.filter((l) => l.action === 'write').length;
    c.removed += it.orphans.filter((p) => p.action === 'remove').length;
    const kept = it.description.action === 'keep' || it.link.action === 'keep' || it.layers.some((l) => l.action === 'keep');
    if (kept) c.edited.push(it.name);
    if (it.updateFirst) c.updateFirst.push(it.name);
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
  /** A grid auto layout, whose gaps are row and column gaps, not item spacing. */
  grid?: boolean;
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
  if (layer.autoLayout) properties.push('padding', ...(layer.grid ? ['gridRowGap', 'gridColumnGap'] : ['itemSpacing']));
  if (layer.hasRadius) properties.push('cornerRadius');
  if (layer.type === 'INSTANCE') properties.push('mainComponent');
  const label = layer.label && layer.name
    ? `${layer.label} ${layer.name}${layer.shownBy ? ` · shown by ${layer.shownBy}` : ''}`
    : '';
  if (!label && !properties.length) return null;
  return { label, properties };
}
