import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { load } from 'js-yaml';
import type { SerializedFoundation } from '@spec-layer/extractor';

const copyText = vi.fn();
const renderManualCopyModal = vi.fn((_t: string, _notice?: string) => () => {});
vi.mock('../src/ui/clipboard', () => ({
  copyText: (t: string) => copyText(t),
  renderManualCopyModal: (t: string, notice?: string) => renderManualCopyModal(t, notice),
}));

const { copyFoundationBrief, onFoundationMessage } = await import('../src/ui/actions');

/** Shape of the parsed brief, just deep enough for these assertions. Typed
 *  rather than `any` so a shape drift fails at compile time, matching the
 *  convention in packages/extractor/test/brief.test.ts and copyBrief.test.ts. */
interface ParsedFoundationBrief {
  spec_layer: { kind: string };
  collections: Array<{ tokens: Array<{ name: string }> }>;
  guidelines?: { origin: string; group_descriptions: Record<string, Record<string, string>> };
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
  renderManualCopyModal.mockReset();
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

  it('omits guidelines when no foundation doc on canvas carries group descriptions', async () => {
    onFoundationMessage(DUMP);
    await copyFoundationBrief(presenter());
    const y = load(copyText.mock.calls[0][0]) as ParsedFoundationBrief;
    expect('guidelines' in y).toBe(false);
  });

  it('carries group descriptions merged from the foundation doc links on canvas', async () => {
    onFoundationMessage(DUMP, { Color: { 'color/bg': 'Backgrounds behind content.' } });
    await copyFoundationBrief(presenter());
    const y = load(copyText.mock.calls[0][0]) as ParsedFoundationBrief;
    expect(y.guidelines?.origin).toBe('generated');
    expect(y.guidelines?.group_descriptions).toEqual({
      Color: { 'color/bg': 'Backgrounds behind content.' },
    });
  });

  it('renders no caveat in the tier-3 modal for a small payload', async () => {
    onFoundationMessage(DUMP);
    copyText.mockResolvedValue('manual');
    await copyFoundationBrief(presenter());
    expect(renderManualCopyModal).toHaveBeenCalledWith(expect.any(String), undefined);
  });

  it('carries the same size caveat into the tier-3 modal as the toast reports', async () => {
    const bigDump: SerializedFoundation = {
      ...DUMP,
      collections: [{
        id: 'C1', name: 'Color', defaultModeId: 'm1',
        modes: [{ modeId: 'm1', name: 'Light' }],
        // Each variable now renders as a single flow-style line (task 5), so the
        // line count needed to cross the 800-line "large payload" threshold in
        // ui/actions.ts is roughly 1-per-variable rather than the ~4-5 it used to
        // take in block style. 900 keeps this comfortably over the threshold.
        variables: Array.from({ length: 900 }, (_, i) => ({
          id: `V${i}`, name: `color/bg/brand-${i}`, resolvedType: 'COLOR' as const, description: '',
          codeSyntax: {}, valuesByMode: { m1: { r: 0.14, g: 0.39, b: 0.92, a: 1 } },
        })),
      }],
    };
    onFoundationMessage(bigDump);
    copyText.mockResolvedValue('manual');
    await copyFoundationBrief(presenter());
    expect(renderManualCopyModal).toHaveBeenCalledTimes(1);
    const [, notice] = renderManualCopyModal.mock.calls[0];
    expect(notice).toMatch(/lines, which is large for some chat windows\.$/);
  });
});
