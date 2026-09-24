import { describe, it, expect, vi } from 'vitest';
import { scanLibrary, libraryReply, type LibraryScanHost, type LibraryScan } from '../src/libraryScan';
import {
  DOC_LINK_KEY, serializeDocLink, textContentHash,
  type ComponentDocLink, type FoundationDocLink,
} from '../src/docLink';
import {
  buildFoundation, foundationContentHash, type FoundationSpec, type SerializedFoundation,
} from '@spec-layer/extractor';

// --- fake canvas ------------------------------------------------------------

interface FakeNode {
  id: string; type: string; name: string;
  parent: FakeNode | null; children: FakeNode[];
  characters?: string;
  data: Record<string, string>;
  getPluginData(key: string): string;
}

function node(type: string, id: string, over: Partial<FakeNode> = {}): FakeNode {
  const n: FakeNode = {
    id, type, name: id, parent: null, children: [], data: {},
    getPluginData(key) { return n.data[key] ?? ''; },
    ...over,
  };
  for (const c of n.children) c.parent = n;
  return n;
}
const text = (chars: string) => node('TEXT', `text:${chars}`, { characters: chars });
const page = (name: string, children: FakeNode[]) => node('PAGE', `page:${name}`, { name, children });

/** A doc Section carrying `link`, holding one generated text run. */
function docSection(id: string, name: string, link: ComponentDocLink | FoundationDocLink, body = 'Generated'): FakeNode {
  const s = node('SECTION', id, { name, children: [text(body)] });
  s.data[DOC_LINK_KEY] = serializeDocLink(link);
  return s;
}

const componentLink = (sourceNodeId: string, selfHash = textContentHash(['Generated'])): ComponentDocLink => ({
  v: 1, sourceNodeId, contentHash: 'spec-hash', selfHash,
  config: {
    sections: ['definition'], variantIds: [], aiEnabled: false,
    anatomyView: 'diagram', measureViews: [], includeHidden: false,
  },
  generatedAt: 10, pluginVersion: '5.1.0', extractorVersion: '3',
});

function dump(): SerializedFoundation {
  return {
    fileKey: 'FILE1', extractedAt: '2026-09-23T00:00:00.000Z', externals: [], textStyles: [], effectStyles: [],
    collections: [{
      id: 'c1', name: 'Semantic', defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Light' }],
      variables: [{
        id: 'v1', name: 'bg/brand', resolvedType: 'COLOR', description: '',
        codeSyntax: {}, valuesByMode: { m1: { r: 0, g: 0, b: 1, a: 1 } },
      }],
    }],
  };
}

const foundationLink = (): FoundationDocLink => ({
  v: 1, kind: 'foundation',
  scope: { target: 'collection', collectionId: 'c1', collectionName: 'Semantic', modeIds: ['m1'] },
  contentHash: 'old', selfHash: textContentHash(['Generated']),
  config: { includeDescriptions: true, aiNotes: false, includeContrast: false },
  generatedAt: 20, pluginVersion: '5.1.0',
});

function host(nodes: Record<string, FakeNode | null | Error>, spec: FoundationSpec | null = null): LibraryScanHost & { liveFoundation: ReturnType<typeof vi.fn> } {
  return {
    getNodeByIdAsync: async (id: string) => {
      const n = nodes[id];
      if (n instanceof Error) throw n;
      return (n ?? null) as unknown as BaseNode | null;
    },
    liveFoundation: vi.fn(async () => spec),
  };
}

// --- tests ------------------------------------------------------------------

describe('scanLibrary', () => {
  it('builds one row per linked doc, in registry order, and marks them alive', async () => {
    const spec = buildFoundation(dump());
    const source = node('COMPONENT', 'src:1', { name: 'Button' });
    page('Components', [source]);
    const compDoc = docSection('doc:1', 'Button: Documentation', componentLink('src:1'));
    const fdnDoc = docSection('doc:2', 'Foundations: Semantic', foundationLink());
    page('Docs', [compDoc, fdnDoc]);

    const scan = await scanLibrary(['doc:1', 'doc:2'], host({ 'doc:1': compDoc, 'doc:2': fdnDoc, 'src:1': source }, spec));

    expect(scan.error).toBeNull();
    expect([...scan.alive]).toEqual(['doc:1', 'doc:2']);
    expect(scan.entries.map((e) => e.kind)).toEqual(['component', 'foundation']);
    expect(scan.entries[0]).toMatchObject({
      docId: 'doc:1', label: 'Button', pageName: 'Docs', sourceLabel: 'Components',
      sourceNodeId: 'src:1', sourceExists: true, selfEdited: false,
      storedContentHash: 'spec-hash', extractorVersion: '3', includeHidden: false,
    });
    expect(scan.entries[1]).toMatchObject({
      docId: 'doc:2', label: 'Foundations · Semantic', sourceLabel: 'Semantic',
      sourceNodeId: '', sourceExists: true, storedContentHash: 'old',
      currentContentHash: foundationContentHash(spec, foundationLink().scope),
      foundationIcon: 'color',
    });
  });

  it('reads the live foundation once however many foundation rows there are', async () => {
    const spec = buildFoundation(dump());
    const a = docSection('doc:a', 'Foundations: Semantic', foundationLink());
    const b = docSection('doc:b', 'Foundations: Semantic', foundationLink());
    const h = host({ 'doc:a': a, 'doc:b': b }, spec);
    const scan = await scanLibrary(['doc:a', 'doc:b'], h);
    expect(scan.entries).toHaveLength(2);
    expect(h.liveFoundation).toHaveBeenCalledTimes(1);
  });

  it('reads a self edit from the generated lane', async () => {
    const doc = docSection('doc:1', 'Button: Documentation', componentLink('src:1'), 'Edited by hand');
    const scan = await scanLibrary(['doc:1'], host({ 'doc:1': doc, 'src:1': node('COMPONENT', 'src:1') }));
    expect(scan.entries[0].selfEdited).toBe(true);
  });

  it('keeps the benefit of the doubt when the source read rejects, and reports missing only on null', async () => {
    const rejected = docSection('doc:r', 'A: Documentation', componentLink('src:unloaded'));
    const gone = docSection('doc:g', 'B: Documentation', componentLink('src:gone'));
    const scan = await scanLibrary(['doc:r', 'doc:g'], host({
      'doc:r': rejected, 'doc:g': gone,
      'src:unloaded': new Error('page not loaded'), 'src:gone': null,
    }));
    expect(scan.error).toBeNull();
    expect(scan.entries.map((e) => e.sourceExists)).toEqual([true, false]);
    // No page to point at either way, so the locator falls back to the name.
    expect(scan.entries.map((e) => e.sourceLabel)).toEqual(['A', 'B']);
  });

  it('leaves a detached Section and a dangling id out of alive so the caller can prune them', async () => {
    const detached = node('SECTION', 'doc:detached', { name: 'Old: Documentation' });
    const live = docSection('doc:1', 'Button: Documentation', componentLink('src:1'));
    const scan = await scanLibrary(['doc:detached', 'doc:missing', 'doc:1'], host({
      'doc:detached': detached, 'doc:missing': null, 'doc:1': live, 'src:1': node('COMPONENT', 'src:1'),
    }));
    expect(scan.error).toBeNull();
    expect([...scan.alive]).toEqual(['doc:1']);
    expect(scan.entries.map((e) => e.docId)).toEqual(['doc:1']);
  });

  it('keeps a rejected registry read alive to prune, unlike a resolved-null one', async () => {
    const live = docSection('doc:1', 'Button: Documentation', componentLink('src:1'));
    const scan = await scanLibrary(['doc:rejected', 'doc:missing', 'doc:1'], host({
      'doc:rejected': new Error('page not loaded'), 'doc:missing': null,
      'doc:1': live, 'src:1': node('COMPONENT', 'src:1'),
    }));
    expect(scan.error).toBeNull();
    // doc:rejected built no row (nothing to build one from) but must not be
    // pruned either, since the reject is not evidence it is gone. doc:missing
    // resolved null, real evidence, so it is left out of alive to be pruned.
    expect([...scan.alive]).toEqual(['doc:rejected', 'doc:1']);
    expect(scan.entries.map((e) => e.docId)).toEqual(['doc:1']);
  });

  it('returns no rows plus the error when a doc-link read throws before any row is built, and never throws itself', async () => {
    const ok = docSection('doc:1', 'Button: Documentation', componentLink('src:1'));
    const broken = docSection('doc:2', 'Card: Documentation', componentLink('src:2'));
    broken.getPluginData = () => { throw new Error('plugin data unavailable'); };
    const scan = await scanLibrary(['doc:1', 'doc:2'], host({
      'doc:1': ok, 'doc:2': broken, 'src:1': node('COMPONENT', 'src:1'), 'src:2': node('COMPONENT', 'src:2'),
    }));
    expect(scan.error).toBe('plugin data unavailable');
    expect(scan.entries.map((e) => e.docId)).toEqual([]);
    // The throw hit while reading links, before any row was built, so alive is
    // empty too: a caller that pruned on it would drop doc:1. That is why the
    // caller only prunes when error is null.
    expect(scan.alive.size).toBe(0);
  });

  it('reports the error alongside the rows already built when the foundation branch throws after a component row was built', async () => {
    const spec = buildFoundation(dump());
    const comp = docSection('doc:1', 'Button: Documentation', componentLink('src:1'));
    const fdn = docSection('doc:2', 'Foundations: Semantic', foundationLink());
    const h = host({ 'doc:1': comp, 'doc:2': fdn, 'src:1': node('COMPONENT', 'src:1') }, spec);
    h.liveFoundation.mockRejectedValue(new Error('variables unavailable'));
    const scan = await scanLibrary(['doc:1', 'doc:2'], h);
    expect(scan.error).toBe('variables unavailable');
    expect(scan.entries.map((e) => e.docId)).toEqual(['doc:1']);
    expect([...scan.alive]).toEqual(['doc:1', 'doc:2']);
  });
});

describe('libraryReply', () => {
  const entry = (docId: string) => ({ docId } as unknown as LibraryScan['entries'][number]);

  it('replies library with no incomplete flag and prunes, for a complete scan', () => {
    const scan: LibraryScan = { entries: [entry('doc:1')], alive: new Set(['doc:1']), error: null };
    const { message, prune } = libraryReply(scan);
    expect(message).toEqual({ type: 'library', entries: scan.entries });
    expect(prune).toBe(true);
  });

  it('replies library with incomplete: true and does not prune, for a failed scan that still has rows', () => {
    const scan: LibraryScan = { entries: [entry('doc:1')], alive: new Set(['doc:1']), error: 'boom' };
    const { message, prune } = libraryReply(scan);
    expect(message).toEqual({ type: 'library', entries: scan.entries, incomplete: true });
    expect(prune).toBe(false);
  });

  it('replies libraryError and does not prune, for a failed scan with no rows', () => {
    const scan: LibraryScan = { entries: [], alive: new Set(), error: 'boom' };
    const { message, prune } = libraryReply(scan);
    expect(message).toEqual({ type: 'libraryError', message: 'boom' });
    expect(prune).toBe(false);
  });
});
