/**
 * Annotate in Dev Mode on the main thread: read each documented component, plan with
 * syncPlan.ts, then write the description, the documentation link and the
 * annotations, read them back, and store the record. Figma is reached only
 * through `SyncHost` and the narrow node shapes below, so a test drives the
 * whole flow with plain objects.
 */
import {
  EXTRACTOR_VERSION, extract, anatomyFor, canonicalEqual, contentHash, specHashProjection,
  type IntermediateSpec, type ProseV2, type SerializedNode, type SpecHashProjection,
} from '@spec-layer/extractor';
import { calloutLabels, proseKeysForSections } from './ui/docModel';
import type { ComponentDocLink } from './docLink';
import {
  SYNC_RECORD_KEY, parseSyncRecord, serializeSyncRecord, descriptionHash, bodyHash, annotationHash,
  sameClaims, writableAnnotation, ownDocumentationLink,
  type SyncRecord, type SyncedAnnotation, type AnnotationLike, type WritableAnnotation,
} from './syncRecord';
import { descriptionText, calendarDate, fileKeyFromUrl, sectionLink, relinkedSection } from './syncText';
import {
  planSync, nextAnnotations, annotationFor, annotationOf, isHeld,
  type AnnotationSpec, type SyncFacts, type SyncOptions, type SyncPlanItem, type LayerFacts,
} from './syncPlan';

/** Which components a run covers. `doc` is the one doc a Library row names. */
export type SyncScope =
  | { kind: 'all' }
  | { kind: 'source'; sourceNodeId: string }
  | { kind: 'doc'; docId: string };

/** Why a doc was left out. `recordUnreadable` is a record from a newer build,
 *  or a damaged one, which is never overwritten; `unreadable` carries the
 *  message of a read that threw. */
export type SyncSkipReason = 'rebuildNeeded' | 'sourceMissing' | 'recordUnreadable' | 'unreadable';
export interface SyncSkip { name: string; reason: SyncSkipReason; message?: string }

/** The node fields the sync reads and writes. Figma's component, frame, text
 *  and instance nodes all satisfy it. */
export interface SyncLayerNode {
  id: string;
  type: string;
  /** True once the node is deleted, when every other read throws. */
  removed?: boolean;
  annotations?: ReadonlyArray<AnnotationLike>;
  layoutMode?: string;
  cornerRadius?: number | symbol;
}
export interface SyncComponentNode extends SyncLayerNode {
  name: string;
  description: string;
  descriptionMarkdown: string;
  documentationLinks: ReadonlyArray<{ uri: string }>;
  getPluginData(key: string): string;
  setPluginData(key: string, value: string): void;
}

export interface SyncDoc {
  docId: string;
  /** The doc Section's name, which names a doc whose source is gone. */
  name: string;
  link: ComponentDocLink;
  /** Read only for a doc the run covers. */
  prose(): ProseV2 | null;
  /** The projection the doc was drawn from, null when none is stored. */
  baseline(): SpecHashProjection | null;
}

export interface SyncHost {
  /** Every component doc in the file, from the registry. */
  docs(): Promise<SyncDoc[]>;
  node(id: string): Promise<SyncComponentNode | SyncLayerNode | null>;
  /** A serializer for one run, so its reads share one resolver memo. */
  serializer(): (node: SyncComponentNode) => Promise<SerializedNode>;
  /** The file key extraction stamps, the one each doc's drift hash used. */
  fileKey(): string;
  /** The file link a designer saved, or null. */
  fileUrl(): string | null;
  normalizeMarkdown(markdown: string): string;
  /** The Spec Layer annotation category id, or null when the file has none.
   *  With `create`, a missing one is added; null then means it was refused. */
  categoryId(create: boolean): Promise<string | null>;
  now(): Date;
  pluginVersion: string;
}

interface Gathered {
  node: SyncComponentNode;
  facts: SyncFacts;
  /** Every layer read, so the write step reads each again without waiting. */
  layerNodes: Map<string, SyncLayerNode>;
}

export interface SyncPlanResult {
  items: SyncPlanItem[];
  skipped: SyncSkip[];
  /** False when no file link is saved, so no documentation link is written. */
  fileLinkKnown: boolean;
}

export interface SyncResult {
  /** Descriptions written or cleared. */
  descriptions: number;
  links: number;
  /** Annotations placed, rewritten or removed. */
  annotations: number;
  /** Components with at least one write. */
  components: number;
  failed: Array<{ name: string; message: string }>;
  /** True when annotations went in without the Spec Layer category. */
  noCategory: boolean;
  /** Components with a value left for a person to review: set, changed or
   *  removed in Figma, or, in an automatic run, AI text nobody reviewed. */
  held: string[];
  /** Of those, components whose kept description a Replace would write over
   *  with AI text nobody has edited. */
  heldAi: string[];
  /** Components whose held values changed since a run last reported them. */
  heldNew: string[];
}

const isComponentNode = (n: SyncComponentNode | SyncLayerNode | null): n is SyncComponentNode =>
  n !== null && (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') && 'setPluginData' in n;

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The newest doc per source: two docs of one component sync once. */
function newestPerSource(docs: SyncDoc[]): SyncDoc[] {
  const bySource = new Map<string, SyncDoc>();
  for (const d of docs) {
    const prev = bySource.get(d.link.sourceNodeId);
    if (!prev || d.link.generatedAt > prev.link.generatedAt) bySource.set(d.link.sourceNodeId, d);
  }
  return [...bySource.values()];
}

function docsIn(docs: SyncDoc[], scope: SyncScope): SyncDoc[] {
  if (scope.kind === 'doc') return docs.filter((d) => d.docId === scope.docId);
  const newest = newestPerSource(docs);
  return scope.kind === 'source' ? newest.filter((d) => d.link.sourceNodeId === scope.sourceNodeId) : newest;
}

function layerFacts(node: SyncLayerNode, part?: { label: string; name: string; shownBy?: string }): LayerFacts {
  const radius = node.cornerRadius;
  return {
    ...(part ? { label: part.label, name: part.name, ...(part.shownBy ? { shownBy: part.shownBy } : {}) } : {}),
    type: node.type,
    autoLayout: typeof node.layoutMode === 'string' && node.layoutMode !== 'NONE',
    grid: node.layoutMode === 'GRID',
    // A symbol is figma.mixed: per-corner radii, which is still a radius.
    hasRadius: typeof radius === 'symbol' || (typeof radius === 'number' && radius > 0),
  };
}

/**
 * True when the doc's legend numbers today's parts: the same measured variant
 * and the same top-level parts in the same order, which is all a callout
 * number and name depend on. Without a stored projection only an unchanged
 * source counts.
 */
function legendCurrent(doc: SyncDoc, spec: IntermediateSpec): boolean {
  const live = specHashProjection(spec, { includeHidden: doc.link.config.includeHidden });
  const drawn = doc.baseline();
  if (!drawn) return contentHash(live) === doc.link.contentHash;
  return drawn.anatomyComponentId === live.anatomyComponentId && canonicalEqual(drawn.anatomy, live.anatomy);
}

/** What one run reads once, on its first covered doc. */
interface RunContext {
  serialize: (node: SyncComponentNode) => Promise<SerializedNode>;
  fileKey: string | null;
  today: string;
  categoryId: string | null;
}

async function runContext(host: SyncHost): Promise<RunContext> {
  const url = host.fileUrl();
  let categoryId: string | null;
  try { categoryId = await host.categoryId(false); } catch { categoryId = null; }
  return {
    serialize: host.serializer(),
    fileKey: url ? fileKeyFromUrl(url) : null,
    today: calendarDate(host.now()),
    categoryId,
  };
}

type Candidate = { doc: SyncDoc; node: SyncComponentNode; record: SyncRecord | null };

/** The doc's component and record, a reason to skip it, or null when an
 *  automatic run has nothing to refresh there. */
async function candidate(host: SyncHost, doc: SyncDoc, options: SyncOptions): Promise<Candidate | SyncSkip | null> {
  const node = await host.node(doc.link.sourceNodeId);
  if (!isComponentNode(node)) return { name: doc.name, reason: 'sourceMissing' };
  // A stale doc may number its parts differently from today's extraction.
  if (doc.link.extractorVersion !== EXTRACTOR_VERSION) return { name: node.name, reason: 'rebuildNeeded' };
  const raw = node.getPluginData(SYNC_RECORD_KEY);
  const record = parseSyncRecord(raw);
  if (raw && !record) return { name: node.name, reason: 'recordUnreadable' };
  // Only a component a manual run annotated has anything to refresh.
  if (options.auto && !record) return null;
  return { doc, node, record };
}

async function gather(host: SyncHost, ctx: RunContext, c: Candidate): Promise<Gathered> {
  const { doc, node, record } = c;
  const spec = extract(await ctx.serialize(node), { figmaFile: host.fileKey() });
  const current = legendCurrent(doc, spec);
  const layerNodes = new Map<string, SyncLayerNode>();
  const layers: SyncFacts['layers'] = [];
  const orphans: SyncFacts['orphans'] = [];
  const read = async (id: string): Promise<AnnotationLike[] | null> => {
    const live = await host.node(id);
    if (!live || live.removed || !Array.isArray(live.annotations)) return null;
    layerNodes.set(id, live);
    return [...live.annotations];
  };
  if (current) {
    const add = async (id: string, part?: { label: string; name: string; shownBy?: string }): Promise<void> => {
      const live = await read(id);
      const layer = layerNodes.get(id);
      const proposed = live && layer ? annotationFor(layerFacts(layer, part)) : null;
      if (live && proposed) layers.push({ nodeId: id, live, proposed });
    };
    // The root is the variant the doc measures. Parts are numbered only when
    // the doc draws its Anatomy legend, exactly as the legend numbers its
    // depth-0 parts.
    if (spec.anatomyComponentId) await add(spec.anatomyComponentId);
    if (doc.link.config.sections.includes('anatomy')) {
      const included = anatomyFor(spec.anatomy, { includeHidden: doc.link.config.includeHidden });
      const labels = calloutLabels(included.map((p) => p.depth));
      for (let i = 0; i < included.length; i++) {
        const p = included[i];
        if (p.depth !== 0) continue;
        await add(p.id, { label: labels[i], name: p.name, ...(p.shownBy ? { shownBy: p.shownBy } : {}) });
      }
    }
    // Layers the record names that the legend no longer numbers.
    const planned = new Set(layers.map((l) => l.nodeId));
    for (const entry of record?.annotations ?? []) {
      if (planned.has(entry.nodeId) || orphans.some((o) => o.nodeId === entry.nodeId)) continue;
      orphans.push({ nodeId: entry.nodeId, live: await read(entry.nodeId) });
    }
  }
  const facts: SyncFacts = {
    docId: doc.docId, nodeId: node.id, name: node.name,
    liveDescription: node.description,
    liveLinks: node.documentationLinks.map((l) => l.uri),
    record,
    description: descriptionText(doc.prose(), ctx.today, proseKeysForSections(doc.link.config.sections)),
    link: ctx.fileKey ? sectionLink(ctx.fileKey, doc.docId) : null,
    layers, orphans,
    categoryId: ctx.categoryId,
    legendCurrent: current,
  };
  return { node, facts, layerNodes };
}

export async function planSyncRun(host: SyncHost, scope: SyncScope, options: SyncOptions): Promise<SyncPlanResult> {
  const items: SyncPlanItem[] = [];
  const skipped: SyncSkip[] = [];
  let ctx: RunContext | null = null;
  for (const doc of docsIn(await host.docs(), scope)) {
    const c = await candidate(host, doc, options);
    if (c === null) continue;
    if ('reason' in c) { skipped.push(c); continue; }
    ctx ??= await runContext(host);
    try {
      items.push(planSync((await gather(host, ctx, c)).facts, options));
    } catch (err) {
      skipped.push({ name: c.node.name, reason: 'unreadable', message: messageOf(err) });
    }
  }
  const url = host.fileUrl();
  return { items, skipped, fileLinkKnown: url !== null && fileKeyFromUrl(url) !== null };
}

/** Every live value read again from the nodes the run holds, without waiting. */
function reread(g: Gathered, categoryId: string | null): SyncFacts | null {
  const { node, facts, layerNodes } = g;
  if (node.removed) return null;
  const read = (id: string): AnnotationLike[] | null => {
    const n = layerNodes.get(id);
    return n && !n.removed && Array.isArray(n.annotations) ? [...n.annotations] : null;
  };
  const layers: SyncFacts['layers'] = [];
  for (const l of facts.layers) {
    const live = read(l.nodeId);
    if (live) layers.push({ ...l, live });
  }
  return {
    ...facts,
    liveDescription: node.description,
    liveLinks: node.documentationLinks.map((l) => l.uri),
    layers,
    orphans: facts.orphans.map((o) => ({ nodeId: o.nodeId, live: o.live ? read(o.nodeId) : null })),
    categoryId,
  };
}

/** The record as it stands after a run: written and adopted targets take
 *  their read-back hashes, kept and skipped ones carry the previous entry. */
function nextRecord(prev: SyncRecord | null, host: SyncHost, parts: {
  description?: SyncRecord['description']; cleared: boolean; link?: SyncRecord['link'];
  annotations: SyncedAnnotation[]; touched: Set<string>; held?: string | undefined;
}): SyncRecord {
  const carried = (prev?.annotations ?? []).filter((a) => !parts.touched.has(a.nodeId));
  const description = parts.cleared ? undefined : parts.description ?? prev?.description;
  const link = parts.link ?? prev?.link;
  return {
    v: 1, syncedAt: host.now().getTime(), pluginVersion: host.pluginVersion,
    ...(description ? { description } : {}),
    ...(link ? { link } : {}),
    annotations: [...carried, ...parts.annotations],
    ...(parts.held ? { held: parts.held } : {}),
  };
}

async function applyOne(
  host: SyncHost, g: Gathered, options: SyncOptions, ensureCategory: () => Promise<string | null>, result: SyncResult,
): Promise<void> {
  // The one wait: the category, created on a run's first annotation write.
  let categoryId = g.facts.categoryId;
  if (!categoryId && planSync(g.facts, options).layers.some((l) => l.action === 'write')) categoryId = await ensureCategory();

  // From here nothing waits. Every value is read and planned again, then
  // written, then recorded: an edit made while the run was reading is never
  // written over, and the plugin cannot stop between a write and its record.
  const facts = reread(g, categoryId);
  if (!facts) return;
  const item = planSync(facts, options);
  const { node } = g;
  let wrote = false;
  let failure: string | null = null;
  // Each target on its own: a refused description still lets the
  // annotations and the record go in.
  const attempt = (write: () => void): void => {
    try { write(); } catch (err) { failure ??= messageOf(err); }
  };
  let description: SyncRecord['description'];
  let cleared = false;
  let link: SyncRecord['link'];
  const annotations: SyncedAnnotation[] = [];
  const touched = new Set<string>();

  const text = facts.description;
  if (item.description.action === 'write' && text) {
    attempt(() => {
      node.descriptionMarkdown = host.normalizeMarkdown(text.markdown);
      // Hashed as Figma reads it back, the field the serializer compares.
      description = { hash: descriptionHash(node.description), bodyHash: bodyHash(text.body), origin: text.origin };
      result.descriptions++; wrote = true;
    });
  } else if (item.description.action === 'clear') {
    attempt(() => {
      node.descriptionMarkdown = '';
      cleared = true;
      result.descriptions++; wrote = true;
    });
  }
  const uri = facts.link;
  if (item.link.action === 'write' && uri) {
    attempt(() => {
      node.documentationLinks = [{ uri }];
      link = { uri };
      result.links++; wrote = true;
    });
  } else if (item.link.action === 'same' && uri) {
    link = { uri };
  }

  const make = (spec: AnnotationSpec): WritableAnnotation => ({ ...annotationOf(spec), ...(categoryId ? { categoryId } : {}) });
  for (const layer of item.layers) {
    const target = g.layerNodes.get(layer.nodeId);
    const live = facts.layers.find((l) => l.nodeId === layer.nodeId)?.live;
    if (!target || !live) continue;
    if (layer.action === 'same') {
      // An adopted or unchanged annotation of its own; a person's identical
      // one (ownIndex -1) is left unclaimed.
      if (layer.ownIndex >= 0) {
        touched.add(layer.nodeId);
        annotations.push({ nodeId: layer.nodeId, hash: annotationHash(live[layer.ownIndex]), proposed: layer.proposedHash });
      }
      continue;
    }
    if (layer.action !== 'write') continue;
    attempt(() => {
      const next = nextAnnotations(live.map(writableAnnotation), layer, make);
      target.annotations = next;
      // Claimed only once Figma took the list: a refused write keeps the old
      // claim, so a later run neither loses its annotation nor adds a copy.
      touched.add(layer.nodeId);
      const back = target.annotations?.[layer.ownIndex >= 0 ? layer.ownIndex : next.length - 1];
      if (back) annotations.push({ nodeId: layer.nodeId, hash: annotationHash(back), proposed: layer.proposedHash });
      if (!categoryId) result.noCategory = true;
      result.annotations++; wrote = true;
    });
  }
  for (const orphan of item.orphans) {
    if (orphan.action === 'drop') { touched.add(orphan.nodeId); continue; }
    const target = g.layerNodes.get(orphan.nodeId);
    const live = facts.orphans.find((o) => o.nodeId === orphan.nodeId)?.live;
    if (!target || !live) continue;
    attempt(() => {
      target.annotations = live.filter((_, i) => i !== orphan.ownIndex).map(writableAnnotation);
      touched.add(orphan.nodeId);
      result.annotations++; wrote = true;
    });
  }

  // Last, and only from read-back values, so the record never claims a write
  // that did not land. A component that had no record gets one only when it
  // now holds something of Spec Layer's: an automatic run treats a record as
  // a manual run's consent.
  const prev = facts.record;
  const record = nextRecord(prev, host, { description, cleared, link, annotations, touched, held: item.heldKey });
  const claims = record.description !== undefined || record.link !== undefined || record.annotations.length > 0;
  if (prev ? !sameClaims(prev, record) : claims) {
    attempt(() => node.setPluginData(SYNC_RECORD_KEY, serializeSyncRecord(record)));
  }
  if (wrote) result.components++;
  if (failure !== null) result.failed.push({ name: node.name, message: failure });
  if (isHeld(item)) {
    result.held.push(node.name);
    const kept = item.description;
    if (kept.action === 'keep' && kept.origin !== undefined && kept.origin !== 'authored') result.heldAi.push(node.name);
  }
  if (item.heldKey !== undefined && item.heldKey !== prev?.held) result.heldNew.push(node.name);
}

/** Plans again against the live file and writes. A component that cannot be
 *  read or written is named with the message, and the run carries on. */
export async function runSync(host: SyncHost, scope: SyncScope, options: SyncOptions): Promise<SyncResult> {
  const result: SyncResult = {
    descriptions: 0, links: 0, annotations: 0, components: 0, failed: [], noCategory: false,
    held: [], heldAi: [], heldNew: [],
  };
  let ctx: RunContext | null = null;
  let created: Promise<string | null> | null = null;
  const ensureCategory = (): Promise<string | null> => {
    created ??= host.categoryId(true).catch(() => null);
    return created;
  };
  for (const doc of docsIn(await host.docs(), scope)) {
    const c = await candidate(host, doc, options);
    if (c === null || 'reason' in c) continue;
    ctx ??= await runContext(host);
    try {
      await applyOne(host, await gather(host, ctx, c), options, ensureCategory, result);
    } catch (err) {
      result.failed.push({ name: c.node.name, message: messageOf(err) });
    }
  }
  return result;
}

/** Points Spec Layer's own documentation link somewhere else, or clears it
 *  with ''. A link a person set is never touched. */
async function retarget(host: SyncHost, sourceNodeId: string, next: (uri: string) => string | null): Promise<boolean> {
  const node = await host.node(sourceNodeId);
  if (!isComponentNode(node) || node.removed) return false;
  const record = parseSyncRecord(node.getPluginData(SYNC_RECORD_KEY));
  if (!record?.link || !ownDocumentationLink(node.documentationLinks.map((l) => l.uri), record)) return false;
  const uri = next(record.link.uri);
  if (uri === null) return false;
  node.documentationLinks = uri ? [{ uri }] : [];
  const updated: SyncRecord = { ...record, syncedAt: host.now().getTime(), pluginVersion: host.pluginVersion };
  if (uri) updated.link = { uri };
  else delete updated.link;
  node.setPluginData(SYNC_RECORD_KEY, serializeSyncRecord(updated));
  return true;
}

/** After an Update rebuilt a doc as a new Section: moves Spec Layer's own
 *  documentation link to it, so the link never opens a removed node. */
export function relinkDoc(host: SyncHost, sourceNodeId: string, oldDocId: string, newDocId: string): Promise<boolean> {
  return retarget(host, sourceNodeId, (uri) => relinkedSection(uri, oldDocId, newDocId));
}

/** After a doc is deleted: clears Spec Layer's own link to its Section. */
export function unlinkDoc(host: SyncHost, sourceNodeId: string, docId: string): Promise<boolean> {
  return retarget(host, sourceNodeId, (uri) => (relinkedSection(uri, docId, docId) !== null ? '' : null));
}
