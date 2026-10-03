import { describe, it, expect } from 'vitest';
import { EXTRACTOR_VERSION, extract, specContentHash, type ProseV2 } from '@spec-layer/extractor';
import { serializeNode } from '../src/serialize';
import { runSync, planSyncRun, type SyncHost, type SyncDoc } from '../src/syncFigma';
import { SYNC_RECORD_KEY, parseSyncRecord } from '../src/syncRecord';
import type { ComponentDocLink } from '../src/docLink';

const resolver = { variable: async () => null, style: async () => null, mainComponent: async () => null };

const PROSE: ProseV2 = {
  v: 2,
  overview: { lede: 'A button starts an action.', body: [] },
  whenToUse: ['To submit a form.'],
  authored: ['overview', 'whenToUse'],
};

/** A component with one text part. Setting the Markdown derives the plain
 *  description, as Figma does, so the read-back hash is what is tested. */
function makeFile(opts: { failDescription?: boolean } = {}) {
  const data = new Map<string, string>();
  const label = { id: '1:2', name: 'Label', type: 'TEXT', visible: true, annotations: [] as unknown[] };
  const component = {
    id: '1:1', name: 'Button', type: 'COMPONENT', visible: true, key: 'k',
    description: '', documentationLinks: [] as Array<{ uri: string }>,
    layoutMode: 'HORIZONTAL', cornerRadius: 8, annotations: [] as unknown[],
    children: [label],
    get descriptionMarkdown(): string { return this.description; },
    set descriptionMarkdown(md: string) {
      if (opts.failDescription) throw new Error('Description is too long');
      this.description = md.replace(/\*\*/g, '');
    },
    getPluginData: (key: string) => data.get(key) ?? '',
    setPluginData: (key: string, value: string) => { data.set(key, value); },
  };
  const nodes = new Map<string, unknown>([['1:1', component], ['1:2', label]]);
  const link: ComponentDocLink = {
    v: 1, sourceNodeId: '1:1', contentHash: 'c', selfHash: 's', generatedAt: 1, pluginVersion: 'x',
    extractorVersion: EXTRACTOR_VERSION,
    config: { sections: ['anatomy'], variantIds: [], aiEnabled: false, anatomyView: 'diagram', measureViews: [], includeHidden: false },
  };
  let fileUrl: string | null = 'https://www.figma.com/design/AbCdEf1234567890/File';
  const docs: SyncDoc[] = [{ docId: '9:9', link, prose: PROSE }];
  const host: SyncHost = {
    docs: async () => docs,
    node: async (id) => (nodes.get(id) as never) ?? null,
    serialize: (node) => serializeNode(node as never, resolver),
    fileUrl: () => fileUrl,
    normalizeMarkdown: (md) => md,
    categoryId: async () => 'cat',
    now: () => new Date(2026, 9, 3),
    pluginVersion: '6.1.0',
  };
  return { host, component, label, data, docs, setFileUrl: (u: string | null) => { fileUrl = u; } };
}

const MANUAL = { replaceEdited: false, auto: false };

describe('runSync', () => {
  it('writes the description, link and annotations, and records what landed', async () => {
    const f = makeFile();
    const r = await runSync(f.host, { kind: 'all' }, MANUAL);
    expect(r).toMatchObject({ descriptions: 1, links: 1, annotations: 2, components: 1, failed: [], held: [] });
    expect(f.component.description).toBe(
      'A button starts an action.\n\nWhen to use\n- To submit a form.\n\nWritten in Spec Layer · 2026-10-03',
    );
    expect(f.component.documentationLinks).toEqual([{ uri: 'https://www.figma.com/design/AbCdEf1234567890/?node-id=9-9' }]);
    expect(f.component.annotations).toEqual([{ properties: [{ type: 'padding' }, { type: 'itemSpacing' }, { type: 'cornerRadius' }], categoryId: 'cat' }]);
    expect(f.label.annotations).toEqual([{ label: '1 Label', properties: [{ type: 'fontSize' }, { type: 'lineHeight' }], categoryId: 'cat' }]);
    const record = parseSyncRecord(f.data.get(SYNC_RECORD_KEY) ?? '');
    expect(record?.description?.origin).toBe('authored');
    expect(record?.annotations.map((a) => a.nodeId)).toEqual(['1:1', '1:2']);
  });

  it('writes nothing on a second run with the same doc', async () => {
    const f = makeFile();
    await runSync(f.host, { kind: 'all' }, MANUAL);
    const before = f.data.get(SYNC_RECORD_KEY);
    const r = await runSync(f.host, { kind: 'all' }, MANUAL);
    expect(r.components).toBe(0);
    expect(f.label.annotations).toHaveLength(1);
    expect(f.data.get(SYNC_RECORD_KEY)).toBe(before);
  });

  it('keeps a description edited in Figma and a designer annotation', async () => {
    const f = makeFile();
    await runSync(f.host, { kind: 'all' }, MANUAL);
    f.component.description = 'Edited by a designer';
    f.label.annotations = [{ label: 'Designer note' }, ...f.label.annotations];
    f.docs[0].prose = { ...PROSE, whenToUse: ['To submit or save a form.'] };
    const r = await runSync(f.host, { kind: 'all' }, MANUAL);
    expect(f.component.description).toBe('Edited by a designer');
    expect(r.held).toEqual(['Button']);
    expect(f.label.annotations[0]).toEqual({ label: 'Designer note' });
    const replaced = await runSync(f.host, { kind: 'all' }, { replaceEdited: true, auto: false });
    expect(replaced.descriptions).toBe(1);
    expect(f.component.description).toContain('To submit or save a form.');
  });

  it('still places annotations when Figma refuses the description', async () => {
    const f = makeFile({ failDescription: true });
    const r = await runSync(f.host, { kind: 'all' }, MANUAL);
    expect(r.failed).toEqual([{ name: 'Button', message: 'Description is too long' }]);
    expect(r.annotations).toBe(2);
    expect(parseSyncRecord(f.data.get(SYNC_RECORD_KEY) ?? '')?.description).toBeUndefined();
  });

  it('writes no link without a saved file link, and says so in the plan', async () => {
    const f = makeFile();
    f.setFileUrl(null);
    const plan = await planSyncRun(f.host, { kind: 'all' }, MANUAL);
    expect(plan.fileLinkKnown).toBe(false);
    expect(plan.items[0].link).toEqual({ action: 'skip', reason: 'noFileLink' });
    await runSync(f.host, { kind: 'all' }, MANUAL);
    expect(f.component.documentationLinks).toEqual([]);
  });

  it('skips a doc that needs a rebuild', async () => {
    const f = makeFile();
    f.docs[0].link = { ...f.docs[0].link, extractorVersion: '1' };
    const plan = await planSyncRun(f.host, { kind: 'all' }, MANUAL);
    expect(plan.items).toEqual([]);
    expect(plan.skipped).toEqual([{ name: 'Button', reason: 'rebuildNeeded' }]);
  });
});

describe('the drift baseline', () => {
  it('does not move when the sync writes the description', async () => {
    const f = makeFile();
    const hash = async (): Promise<string> =>
      specContentHash(extract(await serializeNode(f.component as never, resolver), { figmaFile: 'K' }));
    const before = await hash();
    await runSync(f.host, { kind: 'all' }, MANUAL);
    expect(f.component.description).not.toBe('');
    expect(await hash()).toBe(before);
  });

  it('moves when a person edits the synced description, as any source edit does', async () => {
    const f = makeFile();
    await runSync(f.host, { kind: 'all' }, MANUAL);
    const synced = await serializeNode(f.component as never, resolver);
    expect(synced.description).toBeUndefined();
    expect(synced.documentationLinks).toBeUndefined();
    f.component.description = 'Edited';
    expect((await serializeNode(f.component as never, resolver)).description).toBe('Edited');
  });
});
