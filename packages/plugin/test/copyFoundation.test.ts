import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { load } from 'js-yaml';
import type { SerializedFoundation } from '@spec-layer/extractor';

const copyText = vi.fn();
vi.mock('../src/ui/clipboard', () => ({
  copyText: (t: string) => copyText(t),
  renderManualCopyModal: () => () => {},
}));

const { copyFoundationBrief, onFoundationMessage } = await import('../src/ui/actions');

/** Shape of the parsed brief, just deep enough for these assertions. Typed
 *  rather than `any` so a shape drift fails at compile time, matching the
 *  convention in packages/extractor/test/brief.test.ts and copyBrief.test.ts. */
interface ParsedFoundationBrief {
  spec_layer: { kind: string };
  collections: Array<{ tokens: Array<{ name: string }> }>;
}

function presenter() {
  return {
    clear: vi.fn(), error: vi.fn(), info: vi.fn(),
    setBusy: vi.fn(), startProgress: vi.fn(), stopProgress: vi.fn(),
  };
}

const DUMP: SerializedFoundation = {
  fileKey: 'F1',
  extractedAt: '2026-08-14T00:00:00.000Z',
  externals: [],
  textStyles: [],
  collections: [{
    id: 'C1', name: 'Color', defaultModeId: 'm1',
    modes: [{ modeId: 'm1', name: 'Light' }],
    variables: [{
      id: 'V1', name: 'color/bg/brand', resolvedType: 'COLOR', description: '',
      codeSyntax: {}, valuesByMode: { m1: { r: 0.14, g: 0.39, b: 0.92, a: 1 } },
    }],
  }],
};

beforeEach(() => {
  copyText.mockReset().mockResolvedValue('async');
  vi.stubGlobal('parent', { postMessage: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('copyFoundationBrief', () => {
  it('refuses to copy when no foundation has been read', async () => {
    const ui = presenter();
    await copyFoundationBrief(ui);
    expect(copyText).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalled();
  });

  it('copies parseable YAML with a foundation envelope', async () => {
    onFoundationMessage(DUMP);
    await copyFoundationBrief(presenter());
    const y = load(copyText.mock.calls[0][0]) as ParsedFoundationBrief;
    expect(y.spec_layer.kind).toBe('foundation');
    expect(y.collections[0].tokens[0].name).toBe('color/bg/brand');
  });
});
