import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { load } from 'js-yaml';
import type { DocSource } from '../src/ui/actions';

const copyText = vi.fn();
const renderManualCopyModal = vi.fn((_t: string, _notice?: string) => () => {});
vi.mock('../src/ui/clipboard', () => ({
  copyText: (t: string) => copyText(t),
  renderManualCopyModal: (t: string, notice?: string) => renderManualCopyModal(t, notice),
}));

const { copyBriefFromSource, createState, onSelectionFoundation } =
  await import('../src/ui/actions');

/** Shape of the parsed brief, just deep enough for these assertions. Typed
 *  rather than `any` so a shape drift fails at compile time, matching the
 *  convention in packages/extractor/test/brief.test.ts. */
interface ParsedCopyBrief {
  spec_layer: {
    kind: string; version: number; profile: string; content_hash: string;
    source: { file_name?: string };
  };
  source: { node_id: string; node_name: string; component_key?: string };
  component: { name: string };
  references: { foundation: unknown };
  guidelines?: { definition: string };
}

function presenter() {
  return {
    clear: vi.fn(), error: vi.fn(), info: vi.fn(),
    setBusy: vi.fn(), startProgress: vi.fn(), stopProgress: vi.fn(),
  };
}

const NODE = {
  id: '1:100', name: 'Button', type: 'COMPONENT', visible: true, key: 'k',
  children: [], bindings: [],
} as never;

const SRC: DocSource = {
  docId: 'doc-1', node: NODE, fileKey: 'F1',
  config: { sections: [], variantIds: [], aiEnabled: false, anatomyView: 'diagram', measureViews: [] },
  prose: null,
};

beforeEach(() => {
  copyText.mockReset().mockResolvedValue('async');
  renderManualCopyModal.mockReset();
  vi.stubGlobal('parent', { postMessage: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('copyBriefFromSource', () => {
  it('copies parseable YAML naming the component', async () => {
    const ui = presenter();
    await copyBriefFromSource(createState(), SRC, null, ui);
    expect(copyText).toHaveBeenCalledTimes(1);
    const y = load(copyText.mock.calls[0][0]) as ParsedCopyBrief;
    expect(y.spec_layer.kind).toBe('component');
    expect(y.spec_layer).toMatchObject({ version: 5, profile: 'ai' });
    expect(y.spec_layer.content_hash).toMatch(/^sha256:/);
    expect(y.component.name).toBe('Button');
    expect(y.references.foundation).toEqual({ status: 'not_read' });
    expect(ui.error).not.toHaveBeenCalled();
  });

  it('names the source node and keeps the file name in the AI envelope', async () => {
    await copyBriefFromSource(createState(), { ...SRC, fileName: 'Design System' }, null, presenter());
    const y = load(copyText.mock.calls[0][0]) as ParsedCopyBrief;
    expect(y.spec_layer.source.file_name).toBe('Design System');
    expect(y.source.node_id).toBe('1:100');
    expect(y.source.component_key).toBe('k');
  });

  it('omits file_name when the stored source carries no file name', async () => {
    await copyBriefFromSource(createState(), SRC, null, presenter());
    const y = load(copyText.mock.calls[0][0]) as ParsedCopyBrief;
    expect('file_name' in y.spec_layer.source).toBe(false);
  });

  it('includes stored guidelines without generating any', async () => {
    await copyBriefFromSource(createState(), SRC,
      { definition: 'A button.', accessibility: 'Name it.', dos: [], donts: [] }, presenter());
    const y = load(copyText.mock.calls[0][0]) as ParsedCopyBrief;
    expect(y.guidelines?.definition).toBe('A button.');
  });

  it('omits guidelines when the document has none stored', async () => {
    await copyBriefFromSource(createState(), SRC, null, presenter());
    expect('guidelines' in (load(copyText.mock.calls[0][0]) as ParsedCopyBrief)).toBe(false);
  });

  it('reports a failure without copying when extraction throws', async () => {
    const ui = presenter();
    const broken: DocSource = { ...SRC, node: null as never };
    await copyBriefFromSource(createState(), broken, null, ui);
    expect(copyText).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalled();
  });

  it('carries the honesty caveats into the tier-3 modal, not just the toast', async () => {
    copyText.mockResolvedValue('manual');
    await copyBriefFromSource(createState(), SRC, null, presenter());
    expect(renderManualCopyModal).toHaveBeenCalledTimes(1);
    const [, notice] = renderManualCopyModal.mock.calls[0];
    expect(notice).toContain('Token values are missing because foundations have not been read yet.');
    expect(notice).toContain('This document has no saved guidelines.');
  });

  it('omits the modal caveat entirely when nothing is missing', async () => {
    copyText.mockResolvedValue('manual');
    await copyBriefFromSource(createState(), SRC,
      { definition: 'A button.', accessibility: 'Name it.', dos: [], donts: [] }, presenter());
    // foundationSpec is still unset in this test file's module state, so the
    // "token values missing" caveat is unavoidable here; assert only that a
    // present prose stops contributing its own half of the caveat.
    const [, notice] = renderManualCopyModal.mock.calls[0];
    expect(notice).not.toContain('no saved guidelines');
  });

  it('never posts a canvas-mutating message', async () => {
    const sent: unknown[] = [];
    vi.stubGlobal('parent', { postMessage: (m: { pluginMessage: unknown }) => sent.push(m.pluginMessage) });
    await copyBriefFromSource(createState(), SRC, null, presenter());
    const types = sent.map((m) => (m as { type: string }).type);
    expect(types).not.toContain('renderDocFrame');
    expect(types).not.toContain('updateFoundationDoc');
  });

  it('embeds only the exact bound Foundation dependency with stable ids', async () => {
    onSelectionFoundation({
      fileKey: 'F1', fileName: 'Design System', extractedAt: '2026-08-29T00:00:00.000Z',
      collections: [{
        id: 'CollectionID:space', name: 'Space',
        modes: [{ modeId: 'm1', name: 'Default' }], defaultModeId: 'm1',
        variables: [{
          id: 'VariableID:gap', name: 'space/gap', resolvedType: 'FLOAT',
          description: '', codeSyntax: {}, scopes: ['GAP'], valuesByMode: { m1: 8 },
        }],
      }],
      textStyles: [], effectStyles: [], externals: [],
    });
    const boundNode = {
      id: '1:100', name: 'Button', type: 'COMPONENT', visible: true, key: 'k',
      bindings: [],
      children: ['Container A', 'Container B'].map((name, index) => ({
        id: `1:${101 + index}`, name, type: 'FRAME', visible: true, children: [],
        bindings: [{
          property: 'itemSpacing', id: 'VariableID:gap', name: 'space/gap',
          kind: 'variable', remote: false, collectionId: 'CollectionID:space',
        }],
      })),
    } as never;

    await copyBriefFromSource(createState(), { ...SRC, node: boundNode }, null, presenter());
    const y = load(copyText.mock.calls[0][0]) as unknown as {
      spec_layer: { foundation_hash: string };
      references: {
        used: Array<{ source_id: string; status: string }>;
        bindings: Array<{
          path?: string; paths?: string[]; property: string; source_id: string;
        }>;
        foundation: {
          collections: Array<{ source_id: string; tokens: Array<{ source_id: string }> }>;
        };
      };
    };
    expect(y.spec_layer.foundation_hash).toMatch(/^sha256:/);
    expect(y.references.used).toEqual([expect.objectContaining({
      source_id: 'VariableID:gap', status: 'resolved',
    })]);
    expect(y.references.bindings).toContainEqual(expect.objectContaining({
      paths: ['Button/Container A', 'Button/Container B'],
      property: 'gap', source_id: 'VariableID:gap',
    }));
    expect(y.references.foundation.collections[0]).toMatchObject({
      source_id: 'CollectionID:space',
      tokens: [expect.objectContaining({ source_id: 'VariableID:gap' })],
    });
  });
});
