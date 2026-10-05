import { describe, it, expect } from 'vitest';
import {
  EXTRACTOR_VERSION, contentHash, extract, specContentHash, specHashProjection, type ProseV2,
} from '@spec-layer/extractor';
import type { SectionId } from '../src/ui/docModel';
import { serializeNode } from '../src/serialize';
import { runSync, planSyncRun, relinkDoc, unlinkDoc, type SyncHost, type SyncDoc } from '../src/syncFigma';
import { SYNC_RECORD_KEY, parseSyncRecord, serializeSyncRecord } from '../src/syncRecord';
import type { ComponentDocLink } from '../src/docLink';

const resolver = { variable: async () => null, style: async () => null, mainComponent: async () => null };
const FILE_KEY = 'unknown-file';
const SECTION_LINK = 'https://www.figma.com/design/AbCdEf1234567890/?node-id=9-9';

const PROSE: ProseV2 = {
  v: 2,
  overview: { lede: 'A button starts an action.', body: [] },
  whenToUse: ['To submit a form.'],
  authored: ['overview', 'whenToUse'],
};

type Ann = { label?: string; labelMarkdown?: string; properties?: Array<{ type: string }>; categoryId?: string };

const refusals = new WeakMap<object, number>();
/** The next annotations write on `node` throws, as Figma does for a value it refuses. */
const refuseNextWrite = (node: object): void => { refusals.set(node, (refusals.get(node) ?? 0) + 1); };

/** Annotations as Figma is reported to treat them: read back with both label
 *  fields set, and a write that sets both is refused. */
function annotatable<T extends object>(node: T): T & { annotations: Ann[] } {
  let stored: Ann[] = [];
  Object.defineProperty(node, 'annotations', {
    enumerable: true,
    get: () => stored.map((a) => {
      const text = a.label ?? a.labelMarkdown;
      return text === undefined ? { ...a } : { ...a, label: text, labelMarkdown: text };
    }),
    set: (list: Ann[]) => {
      const refused = refusals.get(node) ?? 0;
      if (refused > 0) { refusals.set(node, refused - 1); throw new Error('Figma refused the annotations'); }
      for (const a of list) {
        if (a.label !== undefined && a.labelMarkdown !== undefined) throw new Error('Cannot set both label and labelMarkdown');
      }
      stored = list.map((a) => ({ ...a }));
    },
  });
  return node as T & { annotations: Ann[] };
}

const texts = (node: { annotations: Ann[] }): Array<string | undefined> => node.annotations.map((a) => a.label);

/** A component with an icon and a text part, a current doc, and a file link.
 *  Setting the Markdown derives the plain description, as Figma does, so the
 *  read-back hash is what is tested. */
async function makeFile(opts: { failDescription?: boolean; sections?: SectionId[]; set?: boolean } = {}) {
  const data = new Map<string, string>();
  let recordWrites = 0;
  const icon = annotatable({ id: '1:3', name: 'Icon', type: 'FRAME', visible: true, children: [] as unknown[] });
  const label = annotatable({ id: '1:2', name: 'Label', type: 'TEXT', visible: true });
  // With `set`, the component is a set whose one variant holds the parts.
  const variant = opts.set
    ? annotatable({
      id: '1:5', name: 'State=Default', type: 'COMPONENT', visible: true,
      layoutMode: 'HORIZONTAL', cornerRadius: 8, children: [icon, label] as unknown[],
    })
    : null;
  const component = annotatable({
    id: '1:1', name: 'Button', type: opts.set ? 'COMPONENT_SET' : 'COMPONENT', visible: true, key: 'k', removed: false,
    description: '', documentationLinks: [] as Array<{ uri: string }>,
    layoutMode: opts.set ? 'NONE' : 'HORIZONTAL', cornerRadius: opts.set ? 0 : 8,
    children: (variant ? [variant] : [icon, label]) as unknown[],
    get descriptionMarkdown(): string { return this.description; },
    set descriptionMarkdown(md: string) {
      if (opts.failDescription) throw new Error('Description is too long');
      this.description = md.replace(/\*\*/g, '');
    },
    getPluginData: (key: string) => data.get(key) ?? '',
    setPluginData: (key: string, value: string) => { recordWrites++; data.set(key, value); },
  });
  const nodes = new Map<string, unknown>([['1:1', component], ['1:2', label], ['1:3', icon]]);
  if (variant) nodes.set(variant.id, variant);
  const link: ComponentDocLink = {
    v: 1, sourceNodeId: '1:1', contentHash: '', selfHash: 's', generatedAt: 1, pluginVersion: 'x',
    extractorVersion: EXTRACTOR_VERSION,
    config: {
      sections: opts.sections ?? ['definition', 'whenToUse', 'anatomy'],
      variantIds: [], aiEnabled: false, anatomyView: 'diagram', measureViews: [], includeHidden: false,
    },
  };
  let baseline: ReturnType<typeof specHashProjection> | null = null;
  let prose: ProseV2 | null = PROSE;
  const doc: SyncDoc = { docId: '9:9', name: 'Button: Documentation', link, prose: () => prose, baseline: () => baseline };
  const docs: SyncDoc[] = [doc];
  let fileUrl: string | null = 'https://www.figma.com/design/AbCdEf1234567890/File';
  let categoryExists = true;
  let clock = new Date(2026, 9, 3).getTime();
  const beforeNode: Array<(id: string) => void> = [];
  const host: SyncHost = {
    docs: async () => docs,
    node: async (id) => {
      for (const hook of beforeNode) hook(id);
      return (nodes.get(id) as never) ?? null;
    },
    serializer: () => (node) => serializeNode(node as never, resolver),
    fileKey: () => FILE_KEY,
    fileUrl: () => fileUrl,
    normalizeMarkdown: (md) => md,
    categoryId: async (create) => {
      if (!categoryExists && create) categoryExists = true;
      return categoryExists ? 'cat' : null;
    },
    now: () => new Date(clock += 60_000),
    pluginVersion: '6.1.0',
  };
  /** What a build or an Update stamps: the drift hash and the projection the legend was drawn from. */
  const stamp = async (): Promise<void> => {
    const spec = extract(await serializeNode(component as never, resolver), { figmaFile: FILE_KEY });
    baseline = specHashProjection(spec, { includeHidden: link.config.includeHidden });
    doc.link = { ...doc.link, contentHash: contentHash(baseline) };
  };
  await stamp();
  return {
    host, component, variant, label, icon, data, docs, doc, nodes, beforeNode, stamp,
    record: () => parseSyncRecord(data.get(SYNC_RECORD_KEY) ?? ''),
    recordWrites: () => recordWrites,
    setFileUrl: (u: string | null) => { fileUrl = u; },
    setProse: (p: ProseV2 | null) => { prose = p; },
    dropCategory: () => { categoryExists = false; },
    dropBaseline: () => { baseline = null; },
  };
}

const MANUAL = { replaceEdited: false, auto: false };
const REPLACE = { replaceEdited: true, auto: false };
const AUTO = { replaceEdited: false, auto: true };
const ALL = { kind: 'all' } as const;

describe('runSync', () => {
  it('writes the description, link and annotations, and records what landed', async () => {
    const f = await makeFile();
    const r = await runSync(f.host, ALL, MANUAL);
    expect(r).toMatchObject({ descriptions: 1, links: 1, annotations: 3, components: 1, failed: [], held: [] });
    expect(f.component.description).toBe(
      'A button starts an action.\n\nWhen to use\n- To submit a form.\n\nWritten in Spec Layer · 2026-10-03',
    );
    expect(f.component.documentationLinks).toEqual([{ uri: SECTION_LINK }]);
    expect(f.component.annotations).toMatchObject([{ properties: [{ type: 'padding' }, { type: 'itemSpacing' }, { type: 'cornerRadius' }], categoryId: 'cat' }]);
    expect(f.icon.annotations).toMatchObject([{ label: '1 Icon', categoryId: 'cat' }]);
    expect(f.label.annotations).toMatchObject([{ label: '2 Label', properties: [{ type: 'fontSize' }, { type: 'lineHeight' }], categoryId: 'cat' }]);
    expect(f.record()?.description?.origin).toBe('authored');
    expect(f.record()?.annotations.map((a) => a.nodeId).sort()).toEqual(['1:1', '1:2', '1:3']);
  });

  it('writes the description on a component set and annotates its default variant', async () => {
    const f = await makeFile({ set: true });
    const r = await runSync(f.host, ALL, MANUAL);
    expect(r.failed).toEqual([]);
    expect(f.component.description).toContain('A button starts an action.');
    expect(f.component.annotations).toEqual([]);
    expect(f.variant?.annotations).toMatchObject([{ properties: [{ type: 'padding' }, { type: 'itemSpacing' }, { type: 'cornerRadius' }] }]);
    expect(texts(f.icon)).toEqual(['1 Icon']);
    expect(texts(f.label)).toEqual(['2 Label']);
  });

  it('annotates without the category when the file refuses one, and says so', async () => {
    const f = await makeFile();
    f.dropCategory();
    f.host.categoryId = async () => null;
    const r = await runSync(f.host, ALL, MANUAL);
    expect(r).toMatchObject({ annotations: 3, noCategory: true, failed: [] });
    expect(f.label.annotations[0].categoryId).toBeUndefined();
  });

  it('writes nothing, the record included, on a second run with the same doc', async () => {
    const f = await makeFile();
    await runSync(f.host, ALL, MANUAL);
    const writes = f.recordWrites();
    const r = await runSync(f.host, ALL, MANUAL);
    expect(r.components).toBe(0);
    expect(f.label.annotations).toHaveLength(1);
    expect(f.recordWrites()).toBe(writes);
  });

  it('keeps a description edited in Figma and a designer annotation', async () => {
    const f = await makeFile();
    await runSync(f.host, ALL, MANUAL);
    f.component.description = 'Edited by a designer';
    f.label.annotations = [{ label: 'Designer note' }, ...f.label.annotations.map(({ labelMarkdown: _, ...a }) => a)];
    f.setProse({ ...PROSE, whenToUse: ['To submit or save a form.'] });
    const r = await runSync(f.host, ALL, MANUAL);
    expect(f.component.description).toBe('Edited by a designer');
    expect(r.held).toEqual(['Button']);
    expect(texts(f.label)).toEqual(['Designer note', '2 Label']);
    const replaced = await runSync(f.host, ALL, REPLACE);
    expect(replaced.descriptions).toBe(1);
    expect(f.component.description).toContain('To submit or save a form.');
  });

  it('writes a designer’s annotation back with one label field, so the layer still annotates', async () => {
    const f = await makeFile();
    f.label.annotations = [{ labelMarkdown: 'Use **aria-label**' }];
    const r = await runSync(f.host, ALL, MANUAL);
    expect(r.failed).toEqual([]);
    expect(texts(f.label)).toEqual(['Use **aria-label**', '2 Label']);
  });

  it('still places annotations when Figma refuses the description', async () => {
    const f = await makeFile({ failDescription: true });
    const r = await runSync(f.host, ALL, MANUAL);
    expect(r.failed).toEqual([{ name: 'Button', message: 'Description is too long' }]);
    expect(r.annotations).toBe(3);
    expect(f.record()?.description).toBeUndefined();
  });

  it('keeps owning an annotation whose rewrite Figma refused, so a later run adds no copy', async () => {
    const f = await makeFile();
    await runSync(f.host, ALL, MANUAL);
    const rec = f.record()!;
    f.data.set(SYNC_RECORD_KEY, serializeSyncRecord({
      ...rec, annotations: rec.annotations.map((a) => (a.nodeId === '1:2' ? { ...a, proposed: 'older' } : a)),
    }));
    refuseNextWrite(f.label);
    expect((await runSync(f.host, ALL, MANUAL)).failed).toEqual([{ name: 'Button', message: 'Figma refused the annotations' }]);
    expect(f.record()?.annotations.some((a) => a.nodeId === '1:2')).toBe(true);
    f.label.name = 'Text';
    await f.stamp();
    await runSync(f.host, ALL, MANUAL);
    expect(texts(f.label)).toEqual(['2 Text']);
  });

  it('replaces its own annotation edited in Figma in place on Replace', async () => {
    const f = await makeFile();
    await runSync(f.host, ALL, MANUAL);
    f.label.annotations = [{ label: '2 Label, edited', categoryId: 'cat' }];
    const plan = await planSyncRun(f.host, ALL, MANUAL);
    expect(plan.items[0].layers.find((l) => l.nodeId === '1:2')).toMatchObject({ action: 'keep', reason: 'editedInFigma' });
    await runSync(f.host, ALL, REPLACE);
    expect(texts(f.label)).toEqual(['2 Label']);
  });

  it('takes its own annotation off a part the legend no longer numbers', async () => {
    const f = await makeFile();
    await runSync(f.host, ALL, MANUAL);
    f.component.children = [f.label];
    await f.stamp();
    const r = await runSync(f.host, ALL, MANUAL);
    expect(r.annotations).toBe(2);
    expect(f.icon.annotations).toEqual([]);
    expect(texts(f.label)).toEqual(['1 Label']);
    expect(f.record()?.annotations.map((a) => a.nodeId).sort()).toEqual(['1:1', '1:2']);
  });

  it('places no annotation while the legend is out of date, and says so', async () => {
    const f = await makeFile();
    f.component.children = [f.label];
    const plan = await planSyncRun(f.host, ALL, MANUAL);
    expect(plan.items[0]).toMatchObject({ updateFirst: true, layers: [], orphans: [] });
    expect(plan.items[0].description.action).toBe('write');
    const r = await runSync(f.host, ALL, MANUAL);
    expect(r.annotations).toBe(0);
    expect(f.label.annotations).toEqual([]);
  });

  it('falls back to the drift hash when the doc has no stored baseline', async () => {
    const f = await makeFile();
    f.dropBaseline();
    expect((await planSyncRun(f.host, ALL, MANUAL)).items[0].updateFirst).toBe(false);
    f.component.name = 'Primary button';
    expect((await planSyncRun(f.host, ALL, MANUAL)).items[0].updateFirst).toBe(true);
  });

  it('numbers no part when the doc has no Anatomy section', async () => {
    const f = await makeFile({ sections: ['definition', 'whenToUse'] });
    await runSync(f.host, ALL, MANUAL);
    expect(f.component.annotations).toHaveLength(1);
    expect(f.icon.annotations).toEqual([]);
    expect(f.label.annotations).toEqual([]);
  });

  it('writes only the Usage text the doc shows', async () => {
    const f = await makeFile({ sections: ['whenToUse', 'anatomy'] });
    await runSync(f.host, ALL, MANUAL);
    expect(f.component.description).toBe('When to use\n- To submit a form.\n\nWritten in Spec Layer · 2026-10-03');
    const none = await makeFile({ sections: ['anatomy'] });
    const r = await runSync(none.host, ALL, MANUAL);
    expect(r.descriptions).toBe(0);
    expect(none.component.description).toBe('');
  });

  it('clears its own description once the doc has no Usage text', async () => {
    const f = await makeFile();
    await runSync(f.host, ALL, MANUAL);
    f.setProse(null);
    const plan = await planSyncRun(f.host, ALL, MANUAL);
    expect(plan.items[0].description).toEqual({ action: 'clear' });
    const r = await runSync(f.host, ALL, MANUAL);
    expect(r.descriptions).toBe(1);
    expect(f.component.description).toBe('');
    expect(f.record()?.description).toBeUndefined();
  });

  it('writes no link without a saved file link, and says so in the plan', async () => {
    const f = await makeFile();
    f.setFileUrl(null);
    const plan = await planSyncRun(f.host, ALL, MANUAL);
    expect(plan.fileLinkKnown).toBe(false);
    expect(plan.items[0].link).toEqual({ action: 'skip', reason: 'noFileLink' });
    await runSync(f.host, ALL, MANUAL);
    expect(f.component.documentationLinks).toEqual([]);
  });

  it('keeps a link a person removed', async () => {
    const f = await makeFile();
    await runSync(f.host, ALL, MANUAL);
    f.component.documentationLinks = [];
    const r = await runSync(f.host, ALL, MANUAL);
    expect(r.links).toBe(0);
    expect(r.held).toEqual(['Button']);
    expect(f.component.documentationLinks).toEqual([]);
  });

  it('skips a doc that needs a rebuild', async () => {
    const f = await makeFile();
    f.doc.link = { ...f.doc.link, extractorVersion: '1' };
    const plan = await planSyncRun(f.host, ALL, MANUAL);
    expect(plan.items).toEqual([]);
    expect(plan.skipped).toEqual([{ name: 'Button', reason: 'rebuildNeeded' }]);
  });

  it('names a doc whose source is gone by the doc', async () => {
    const f = await makeFile();
    f.doc.link = { ...f.doc.link, sourceNodeId: '7:7' };
    expect((await planSyncRun(f.host, ALL, MANUAL)).skipped).toEqual([{ name: 'Button: Documentation', reason: 'sourceMissing' }]);
  });

  it('leaves a record it cannot read untouched', async () => {
    const f = await makeFile();
    const future = JSON.stringify({ v: 2, everything: 'new' });
    f.data.set(SYNC_RECORD_KEY, future);
    const plan = await planSyncRun(f.host, ALL, MANUAL);
    expect(plan.skipped).toEqual([{ name: 'Button', reason: 'recordUnreadable' }]);
    await runSync(f.host, ALL, MANUAL);
    expect(f.data.get(SYNC_RECORD_KEY)).toBe(future);
    expect(f.component.description).toBe('');
  });

  it('carries on past a component it cannot read, and names it', async () => {
    const f = await makeFile();
    const serializer = f.host.serializer;
    f.host.serializer = () => {
      const inner = serializer();
      return (node) => (node.id === '1:1' ? Promise.reject(new Error('boom')) : inner(node));
    };
    const plan = await planSyncRun(f.host, ALL, MANUAL);
    expect(plan.skipped).toEqual([{ name: 'Button', reason: 'unreadable', message: 'boom' }]);
    const r = await runSync(f.host, ALL, MANUAL);
    expect(r.failed).toEqual([{ name: 'Button', message: 'boom' }]);
  });

  it('annotates the doc a row names, not the newest doc of its source', async () => {
    const f = await makeFile();
    const newer: SyncDoc = {
      ...f.doc, docId: '8:8', link: { ...f.doc.link, generatedAt: 5 },
      prose: () => ({ v: 2, overview: { lede: 'Newer doc.', body: [] }, authored: ['overview'] }),
    };
    f.docs.push(newer);
    await runSync(f.host, { kind: 'doc', docId: '9:9' }, MANUAL);
    expect(f.component.description).toContain('A button starts an action.');
    expect(f.component.documentationLinks).toEqual([{ uri: SECTION_LINK }]);
  });

  it('reads the live list again right before writing, so an edit made meanwhile is never overwritten', async () => {
    const f = await makeFile();
    await runSync(f.host, ALL, MANUAL);
    const rec = f.record()!;
    f.data.set(SYNC_RECORD_KEY, serializeSyncRecord({
      ...rec, annotations: rec.annotations.map((a) => (a.nodeId === '1:1' ? { ...a, proposed: 'older' } : a)),
    }));
    let inserted = false;
    f.beforeNode.push((id) => {
      if (id === '1:2' && !inserted) {
        inserted = true;
        f.component.annotations = [{ label: 'Designer note' }, ...f.component.annotations.map(({ labelMarkdown: _, ...a }) => a)];
      }
    });
    await runSync(f.host, ALL, MANUAL);
    expect(f.component.annotations.map((a) => a.label ?? a.properties?.map((p) => p.type).join(','))).toEqual([
      'Designer note', 'padding,itemSpacing,cornerRadius',
    ]);
  });

  it('writes nothing until it can write the record with it', async () => {
    const f = await makeFile();
    f.dropCategory();
    const gate: { release?: (id: string) => void } = {};
    f.host.categoryId = (create) => (create ? new Promise((resolve) => { gate.release = resolve; }) : Promise.resolve(null));
    const run = runSync(f.host, ALL, MANUAL);
    for (let i = 0; i < 100 && !gate.release; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gate.release).toBeDefined();
    expect(f.component.description).toBe('');
    gate.release!('cat');
    await run;
    expect(f.component.description).not.toBe('');
    expect(f.record()?.description).toBeDefined();
  });
});

describe('automatic runs', () => {
  it('never touch a component nobody annotated by hand, however often they run', async () => {
    const f = await makeFile();
    for (let i = 0; i < 2; i++) {
      const r = await runSync(f.host, { kind: 'source', sourceNodeId: '1:1' }, AUTO);
      expect(r).toMatchObject({ descriptions: 0, links: 0, annotations: 0, components: 0, held: [], heldNew: [] });
    }
    expect(f.data.has(SYNC_RECORD_KEY)).toBe(false);
    expect(f.component.documentationLinks).toEqual([]);
    expect(f.label.annotations).toEqual([]);
  });

  it('name a held value once, and again only after a new edit', async () => {
    const f = await makeFile();
    await runSync(f.host, ALL, MANUAL);
    f.component.description = 'Edited by a designer';
    const source = { kind: 'source', sourceNodeId: '1:1' } as const;
    expect((await runSync(f.host, source, AUTO)).heldNew).toEqual(['Button']);
    expect((await runSync(f.host, source, AUTO)).heldNew).toEqual([]);
    f.component.description = 'Edited again';
    expect((await runSync(f.host, source, AUTO)).heldNew).toEqual(['Button']);
  });

  it('do not re-name what a manual run already showed', async () => {
    const f = await makeFile();
    await runSync(f.host, ALL, MANUAL);
    f.component.description = 'Edited by a designer';
    expect((await runSync(f.host, ALL, MANUAL)).held).toEqual(['Button']);
    expect((await runSync(f.host, { kind: 'source', sourceNodeId: '1:1' }, AUTO)).heldNew).toEqual([]);
  });

  it('hold nothing for a link a person set before any sync', async () => {
    const f = await makeFile();
    f.setFileUrl(null);
    await runSync(f.host, ALL, MANUAL);
    f.setFileUrl('https://www.figma.com/design/AbCdEf1234567890/File');
    f.component.documentationLinks = [{ uri: 'https://storybook.example/button' }];
    const r = await runSync(f.host, { kind: 'source', sourceNodeId: '1:1' }, AUTO);
    expect(r).toMatchObject({ held: [], heldNew: [], links: 0 });
  });
});

describe('a replaced or deleted doc Section', () => {
  it('moves the sync’s own link to the Section an Update built', async () => {
    const f = await makeFile();
    await runSync(f.host, ALL, MANUAL);
    expect(await relinkDoc(f.host, '1:1', '9:9', '12:12')).toBe(true);
    const moved = 'https://www.figma.com/design/AbCdEf1234567890/?node-id=12-12';
    expect(f.component.documentationLinks).toEqual([{ uri: moved }]);
    expect(f.record()?.link).toEqual({ uri: moved });
  });

  it('leaves a link a person set alone', async () => {
    const f = await makeFile();
    await runSync(f.host, ALL, MANUAL);
    f.component.documentationLinks = [{ uri: 'https://storybook.example/button' }];
    expect(await relinkDoc(f.host, '1:1', '9:9', '12:12')).toBe(false);
    expect(await unlinkDoc(f.host, '1:1', '9:9')).toBe(false);
    expect(f.component.documentationLinks).toEqual([{ uri: 'https://storybook.example/button' }]);
  });

  it('clears the sync’s own link to a deleted doc', async () => {
    const f = await makeFile();
    await runSync(f.host, ALL, MANUAL);
    expect(await unlinkDoc(f.host, '1:1', '9:9')).toBe(true);
    expect(f.component.documentationLinks).toEqual([]);
    expect(f.record()?.link).toBeUndefined();
    expect(f.record()?.description).toBeDefined();
  });
});

describe('the drift baseline', () => {
  it('does not move when the sync writes the description', async () => {
    const f = await makeFile();
    const hash = async (): Promise<string> =>
      specContentHash(extract(await serializeNode(f.component as never, resolver), { figmaFile: 'K' }));
    const before = await hash();
    await runSync(f.host, ALL, MANUAL);
    expect(f.component.description).not.toBe('');
    expect(await hash()).toBe(before);
  });

  it('moves when a person edits the synced description, as any source edit does', async () => {
    const f = await makeFile();
    await runSync(f.host, ALL, MANUAL);
    const synced = await serializeNode(f.component as never, resolver);
    expect(synced.description).toBeUndefined();
    expect(synced.documentationLinks).toBeUndefined();
    f.component.description = 'Edited';
    expect((await serializeNode(f.component as never, resolver)).description).toBe('Edited');
  });

  it('never reads the provenance line as source, even after a person edits the text', async () => {
    const f = await makeFile();
    await runSync(f.host, ALL, MANUAL);
    f.component.description = f.component.description.replace('action.', 'action!');
    const edited = await serializeNode(f.component as never, resolver);
    expect(edited.description).toBe('A button starts an action!\n\nWhen to use\n- To submit a form.');
    f.component.description = 'Written in Spec Layer · 2026-10-03';
    expect((await serializeNode(f.component as never, resolver)).description).toBeUndefined();
  });
});
