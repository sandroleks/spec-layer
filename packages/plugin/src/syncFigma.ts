/**
 * Annotate in Dev Mode on the main thread: read each documented component, plan with
 * syncPlan.ts, then write the description, the documentation link and the
 * annotations, read them back, and store the record. Figma is reached only
 * through `SyncHost` and the narrow node shapes below, so a test drives the
 * whole flow with plain objects.
 */
import { EXTRACTOR_VERSION, extract, anatomyFor, type ProseV2, type SerializedNode } from '@spec-layer/extractor';
import { calloutLabels } from './ui/docModel';
import type { ComponentDocLink } from './docLink';
import {
  SYNC_RECORD_KEY, parseSyncRecord, serializeSyncRecord, descriptionHash, bodyHash, annotationHash,
  type SyncRecord, type SyncedAnnotation, type AnnotationLike,
} from './syncRecord';
import { descriptionText, calendarDate, fileKeyFromUrl, sectionLink } from './syncText';
import {
  planSync, nextAnnotations, annotationFor, annotationOf,
  type SyncFacts, type SyncOptions, type SyncPlanItem, type LayerFacts,
} from './syncPlan';

/** Which components a run covers. */
export type SyncScope = { kind: 'all' } | { kind: 'source'; sourceNodeId: string };

export type SyncSkipReason = 'rebuildNeeded' | 'sourceMissing';
export interface SyncSkip { name: string; reason: SyncSkipReason }

/** The node fields the sync reads and writes. Figma's component, frame, text
 *  and instance nodes all satisfy it. */
export interface SyncLayerNode {
  id: string;
  type: string;
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
  link: ComponentDocLink;
  prose: ProseV2 | null;
}

export interface SyncHost {
  /** Every component doc in the file, from the registry. */
  docs(): Promise<SyncDoc[]>;
  node(id: string): Promise<SyncComponentNode | SyncLayerNode | null>;
  serialize(node: SyncComponentNode): Promise<SerializedNode>;
  /** The file link a designer saved, or null. */
  fileUrl(): string | null;
  normalizeMarkdown(markdown: string): string;
  /** The Spec Layer annotation category id, created on first use; null when
   *  the file refuses categories. */
  categoryId(): Promise<string | null>;
  now(): Date;
  pluginVersion: string;
}

interface Gathered {
  facts: SyncFacts;
  node: SyncComponentNode;
  record: SyncRecord | null;
}

export interface SyncPlanResult {
  items: SyncPlanItem[];
  skipped: SyncSkip[];
  /** False when no file link is saved, so no documentation link is written. */
  fileLinkKnown: boolean;
}

export interface SyncResult {
  descriptions: number;
  links: number;
  annotations: number;
  /** Components with at least one write. */
  components: number;
  failed: Array<{ name: string; message: string }>;
  /** True when annotations went in without the Spec Layer category. */
  noCategory: boolean;
  /** Components with a value left alone because a person changed it, or
   *  because an automatic run met AI text nobody has reviewed. */
  held: string[];
}

const isComponentNode = (n: SyncComponentNode | SyncLayerNode | null): n is SyncComponentNode =>
  n !== null && (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') && 'setPluginData' in n;

/** The newest doc per source: two docs of one component sync once. */
function newestPerSource(docs: SyncDoc[]): SyncDoc[] {
  const bySource = new Map<string, SyncDoc>();
  for (const d of docs) {
    const prev = bySource.get(d.link.sourceNodeId);
    if (!prev || d.link.generatedAt > prev.link.generatedAt) bySource.set(d.link.sourceNodeId, d);
  }
  return [...bySource.values()];
}

function layerFacts(node: SyncLayerNode, part?: { label: string; name: string; shownBy?: string }): LayerFacts {
  const radius = node.cornerRadius;
  return {
    ...(part ? { label: part.label, name: part.name, ...(part.shownBy ? { shownBy: part.shownBy } : {}) } : {}),
    type: node.type,
    autoLayout: typeof node.layoutMode === 'string' && node.layoutMode !== 'NONE',
    // A symbol is figma.mixed: per-corner radii, which is still a radius.
    hasRadius: typeof radius === 'symbol' || (typeof radius === 'number' && radius > 0),
  };
}

async function gather(host: SyncHost, doc: SyncDoc, node: SyncComponentNode, fileKey: string | null, today: string): Promise<Gathered> {
  const record = parseSyncRecord(node.getPluginData(SYNC_RECORD_KEY));
  const spec = extract(await host.serialize(node), { figmaFile: '' });
  const layers: SyncFacts['layers'] = [];
  const add = async (id: string, part?: { label: string; name: string; shownBy?: string }): Promise<void> => {
    const live = await host.node(id);
    if (!live || !('annotations' in live) || !Array.isArray(live.annotations)) return;
    const proposed = annotationFor(layerFacts(live, part));
    if (proposed) layers.push({ nodeId: id, live: [...live.annotations], proposed });
  };
  // The root is the variant the doc measures; parts are the legend's
  // depth-0 parts, numbered exactly as the legend numbers them.
  if (spec.anatomyComponentId) await add(spec.anatomyComponentId);
  const included = anatomyFor(spec.anatomy, { includeHidden: doc.link.config.includeHidden });
  const labels = calloutLabels(included.map((p) => p.depth));
  for (let i = 0; i < included.length; i++) {
    const p = included[i];
    const label = labels[i];
    if (p.depth !== 0) continue;
    await add(p.id, { label, name: p.name, ...(p.shownBy ? { shownBy: p.shownBy } : {}) });
  }
  const facts: SyncFacts = {
    docId: doc.docId, nodeId: node.id, name: node.name,
    liveDescription: node.description,
    liveLinks: node.documentationLinks.map((l) => l.uri),
    record,
    description: descriptionText(doc.prose, today),
    link: fileKey ? sectionLink(fileKey, doc.docId) : null,
    layers,
  };
  return { facts, node, record };
}

async function gatherAll(host: SyncHost, scope: SyncScope): Promise<{ gathered: Gathered[]; skipped: SyncSkip[]; fileLinkKnown: boolean }> {
  const url = host.fileUrl();
  const fileKey = url ? fileKeyFromUrl(url) : null;
  const today = calendarDate(host.now());
  let docs = newestPerSource(await host.docs());
  if (scope.kind === 'source') docs = docs.filter((d) => d.link.sourceNodeId === scope.sourceNodeId);
  const gathered: Gathered[] = [];
  const skipped: SyncSkip[] = [];
  for (const doc of docs) {
    const node = await host.node(doc.link.sourceNodeId);
    if (!isComponentNode(node)) { skipped.push({ name: doc.docId, reason: 'sourceMissing' }); continue; }
    // A stale doc may number its parts differently from today's extraction.
    if (doc.link.extractorVersion !== EXTRACTOR_VERSION) { skipped.push({ name: node.name, reason: 'rebuildNeeded' }); continue; }
    gathered.push(await gather(host, doc, node, fileKey, today));
  }
  return { gathered, skipped, fileLinkKnown: fileKey !== null };
}

export async function planSyncRun(host: SyncHost, scope: SyncScope, options: SyncOptions): Promise<SyncPlanResult> {
  const { gathered, skipped, fileLinkKnown } = await gatherAll(host, scope);
  return { items: gathered.map((g) => planSync(g.facts, options)), skipped, fileLinkKnown };
}

/** The record as it stands after a run: written and adopted targets take
 *  their read-back hashes, kept and skipped ones carry the previous entry. */
function nextRecord(prev: SyncRecord | null, host: SyncHost, parts: {
  description?: SyncRecord['description']; link?: SyncRecord['link']; annotations: SyncedAnnotation[]; touchedNodes: Set<string>;
}): SyncRecord {
  const carried = (prev?.annotations ?? []).filter((a) => !parts.touchedNodes.has(a.nodeId));
  const description = parts.description ?? prev?.description;
  const link = parts.link ?? prev?.link;
  return {
    v: 1, syncedAt: host.now().getTime(), pluginVersion: host.pluginVersion,
    ...(description ? { description } : {}),
    ...(link ? { link } : {}),
    annotations: [...carried, ...parts.annotations],
  };
}

const sameRecord = (a: SyncRecord | null, b: SyncRecord): boolean =>
  a !== null && JSON.stringify({ ...a, syncedAt: 0, pluginVersion: '' }) === JSON.stringify({ ...b, syncedAt: 0, pluginVersion: '' });

async function applyOne(host: SyncHost, g: Gathered, item: SyncPlanItem, categoryId: () => Promise<string | null>, result: SyncResult): Promise<void> {
  const { node, facts } = g;
  let wrote = false;
  let failure: string | null = null;
  // Each target on its own: a refused description still lets the
  // annotations and the record go in.
  const attempt = async (write: () => Promise<void> | void): Promise<void> => {
    try { await write(); } catch (err) { failure ??= err instanceof Error ? err.message : String(err); }
  };
  let description: SyncRecord['description'];
  let link: SyncRecord['link'];
  const annotations: SyncedAnnotation[] = [];
  const touchedNodes = new Set<string>();

  const text = facts.description;
  if (item.description.action === 'write' && text) {
    await attempt(() => {
      node.descriptionMarkdown = host.normalizeMarkdown(text.markdown);
      // Hashed as Figma reads it back, the field the serializer compares.
      description = { hash: descriptionHash(node.description), bodyHash: bodyHash(text.body), origin: text.origin };
      result.descriptions++; wrote = true;
    });
  }
  const uri = facts.link;
  if (item.link.action === 'write' && uri) {
    await attempt(() => {
      node.documentationLinks = [{ uri }];
      link = { uri };
      result.links++; wrote = true;
    });
  } else if (item.link.action === 'same' && uri) {
    link = { uri };
  }
  for (const layer of item.layers) {
    if (layer.action === 'keep' || layer.action === 'skip') continue;
    await attempt(async () => {
      const live = await host.node(layer.nodeId);
      if (!live || !Array.isArray(live.annotations)) return;
      touchedNodes.add(layer.nodeId);
      if (layer.action === 'same') {
        const own = live.annotations[layer.ownIndex] as AnnotationLike | undefined;
        if (own) annotations.push({ nodeId: layer.nodeId, hash: annotationHash(own) });
        return;
      }
      const cat = await categoryId();
      const next = nextAnnotations(live.annotations, layer, (spec) => ({ ...annotationOf(spec), ...(cat ? { categoryId: cat } : {}) }));
      live.annotations = next;
      const index = layer.ownIndex >= 0 ? layer.ownIndex : next.length - 1;
      const back = live.annotations?.[index];
      if (back) annotations.push({ nodeId: layer.nodeId, hash: annotationHash(back) });
      result.annotations++; wrote = true;
    });
  }
  // Last, and only from read-back values, so the record never claims a write
  // that did not land.
  const record = nextRecord(g.record, host, { description, link, annotations, touchedNodes });
  await attempt(() => {
    if (!sameRecord(g.record, record)) node.setPluginData(SYNC_RECORD_KEY, serializeSyncRecord(record));
  });
  if (wrote) result.components++;
  if (failure !== null) result.failed.push({ name: node.name, message: failure });
}

const HELD_REASONS: ReadonlySet<string> = new Set(['writtenBeforeSync', 'editedInFigma', 'removedInFigma', 'aiNotReviewed']);
function isHeld(item: SyncPlanItem): boolean {
  const held = (t: { reason?: string }): boolean => t.reason !== undefined && HELD_REASONS.has(t.reason);
  return held(item.description) || held(item.link) || item.layers.some(held);
}

/** Plans again against the live file and writes. A component that fails is
 *  named with Figma's message, and the run carries on with the next. */
export async function runSync(host: SyncHost, scope: SyncScope, options: SyncOptions): Promise<SyncResult> {
  const { gathered } = await gatherAll(host, scope);
  const result: SyncResult = { descriptions: 0, links: 0, annotations: 0, components: 0, failed: [], noCategory: false, held: [] };
  let category: Promise<string | null> | null = null;
  const categoryId = async (): Promise<string | null> => {
    category ??= host.categoryId().catch(() => null);
    const id = await category;
    if (!id) result.noCategory = true;
    return id;
  };
  for (const g of gathered) {
    const item = planSync(g.facts, options);
    if (isHeld(item)) result.held.push(g.node.name);
    try {
      await applyOne(host, g, item, categoryId, result);
    } catch (err) {
      result.failed.push({ name: g.node.name, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
