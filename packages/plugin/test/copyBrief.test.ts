import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { load } from 'js-yaml';
import type { DocSource } from '../src/ui/actions';

const copyText = vi.fn();
vi.mock('../src/ui/clipboard', () => ({
  copyText: (t: string) => copyText(t),
  renderManualCopyModal: () => () => {},
}));

const { copyBriefFromSource, createState } = await import('../src/ui/actions');

/** Shape of the parsed brief, just deep enough for these assertions. Typed
 *  rather than `any` so a shape drift fails at compile time, matching the
 *  convention in packages/extractor/test/brief.test.ts. */
interface ParsedCopyBrief {
  spec_layer: { kind: string };
  component: { name: string };
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
};

beforeEach(() => {
  copyText.mockReset().mockResolvedValue('async');
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
    expect(y.component.name).toBe('Button');
    expect(ui.error).not.toHaveBeenCalled();
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

  it('never posts a canvas-mutating message', async () => {
    const sent: unknown[] = [];
    vi.stubGlobal('parent', { postMessage: (m: { pluginMessage: unknown }) => sent.push(m.pluginMessage) });
    await copyBriefFromSource(createState(), SRC, null, presenter());
    const types = sent.map((m) => (m as { type: string }).type);
    expect(types).not.toContain('renderDocFrame');
    expect(types).not.toContain('updateFoundationDoc');
  });
});
