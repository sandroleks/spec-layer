import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { load } from 'js-yaml';
import type { SerializedFoundation } from '@spec-layer/extractor';

const copyText = vi.fn();
const renderManualCopyModal = vi.fn((_t: string, _notice?: string) => () => {});
vi.mock('../src/ui/clipboard', () => ({
  copyText: (t: string) => copyText(t),
  renderManualCopyModal: (t: string, notice?: string) => renderManualCopyModal(t, notice),
}));

const { copyFoundationBrief, copyFoundationBriefForScope, onFoundationMessage, setFoundationGroupDescriptions } =
  await import('../src/ui/actions');

/** Shape of the parsed brief, just deep enough for these assertions. Typed
 *  rather than `any` so a shape drift fails at compile time, matching the
 *  convention in packages/extractor/test/brief.test.ts and copyBrief.test.ts. */
interface ParsedFoundationBrief {
  spec_layer: {
    kind: string; schema_version?: string;
    extractor?: { build: string | null };
    export?: { content_hash: string };
  };
  completeness?: {
    collections: string; styles: string; unavailable_sources: string[];
  };
  collections: Array<{
    id?: string; name: string;
    modes?: Array<{ id: string; name: string }>;
    tokens?: Array<{ name: string }>;
  }>;
  tokens?: Array<{
    id: string; name: string; collection_id: string; type: string;
    scopes: string[]; values: Record<string, Record<string, unknown>>;
  }>;
  text_styles?: Array<Record<string, unknown>>;
  diagnostics?: Array<{ code: string }>;
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
  fileName: 'Company DS',
  extractedAt: '2026-08-14T00:00:00.000Z',
  externals: [{
    id: 'V:external', name: 'color/shared', collectionId: 'C:remote',
    collectionName: 'Remote Core', remote: true, external: true,
  }],
  textStyles: [],
  effectStyles: [],
  collections: [{
    id: 'C1', name: 'Color', defaultModeId: 'm1',
    modes: [{ modeId: 'm1', name: 'Light' }],
    variables: [
      {
        id: 'V1', name: 'color/bg/brand', resolvedType: 'COLOR', description: '',
        codeSyntax: {}, scopes: ['FRAME_FILL'],
        valuesByMode: { m1: { r: 0.1401, g: 0.3901, b: 0.9201, a: 0.125 } },
      },
      {
        id: 'V:gap', name: 'space/gap', resolvedType: 'FLOAT', description: '',
        codeSyntax: {}, scopes: ['GAP'], valuesByMode: { m1: 8 },
      },
      {
        id: 'V:unknown-unit', name: 'number/unknown', resolvedType: 'FLOAT', description: '',
        codeSyntax: {}, scopes: [], valuesByMode: { m1: 3 },
      },
      {
        id: 'V:terminal', name: 'color/terminal', resolvedType: 'COLOR', description: '',
        codeSyntax: {}, valuesByMode: { m1: { r: 1, g: 0, b: 0, a: 1 } },
      },
      {
        id: 'V:middle', name: 'color/middle', resolvedType: 'COLOR', description: '',
        codeSyntax: {}, valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'V:terminal' } },
      },
      {
        id: 'V:owner', name: 'color/owner', resolvedType: 'COLOR', description: '',
        codeSyntax: {}, valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'V:middle' } },
      },
      {
        id: 'V:local-shared', name: 'color/shared', resolvedType: 'COLOR', description: '',
        codeSyntax: {}, valuesByMode: { m1: { r: 0, g: 0, b: 0, a: 1 } },
      },
      {
        id: 'V:external-owner', name: 'color/external', resolvedType: 'COLOR', description: '',
        codeSyntax: {}, valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'V:external' } },
      },
    ],
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

  it('copies parseable Foundation Context v5 with real ids and mode-id values', async () => {
    onFoundationMessage(DUMP);
    await copyFoundationBrief(presenter());
    const y = load(copyText.mock.calls[0][0]) as ParsedFoundationBrief;
    expect(y.spec_layer.kind).toBe('foundation');
    expect(y.spec_layer.schema_version).toBe('5.0.0');
    expect(y.spec_layer.extractor?.build).toBeNull();
    expect(y.collections[0]).toMatchObject({
      id: 'C1', modes: [{ id: 'm1', name: 'Light' }],
    });
    expect(y.tokens?.[0]).toMatchObject({
      id: 'V1', name: 'color/bg/brand', collection_id: 'C1', scopes: ['FRAME_FILL'],
    });
    expect(Object.keys(y.tokens?.[0].values ?? {})).toEqual(['m1']);
  });

  it('carries dimensions, unit diagnostics, precise channels, and full/external aliases', async () => {
    onFoundationMessage(DUMP);
    await copyFoundationBrief(presenter());
    const y = load(copyText.mock.calls[0][0]) as ParsedFoundationBrief;
    const token = (id: string) => {
      const found = y.tokens?.find((item) => item.id === id);
      if (!found) throw new Error(`Copied artifact is missing token ${id}.`);
      return found;
    };
    expect(token('V:gap')).toMatchObject({ type: 'dimension' });
    expect(token('V:gap').values.m1).toMatchObject({
      kind: 'literal', value: { type: 'dimension', number: 8, unit: 'px' },
    });
    expect(token('V:unknown-unit')).toMatchObject({ type: 'number' });
    expect(y.diagnostics?.map((finding) => finding.code))
      .toContain('UNIT_METADATA_UNAVAILABLE');
    expect(token('V1').values.m1).toMatchObject({
      value: { type: 'color', channels: [0.1401, 0.3901, 0.9201], alpha: 0.125 },
    });
    expect(token('V:owner').values.m1).toMatchObject({
      resolved: {
        chain: [
          { token_id: 'V:middle', mode_id: 'm1' },
          { token_id: 'V:terminal', mode_id: 'm1' },
        ],
      },
    });
    expect(token('V:external-owner').values.m1).toMatchObject({
      reference: {
        target_id: 'V:external', target_path: ['color', 'shared'], external: true,
        source_library_name: 'Remote Core',
      },
      resolved: { status: 'unresolved', chain: [] },
    });
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

  it('keeps generated guidelines outside the semantic content hash', async () => {
    onFoundationMessage(DUMP, { Color: { color: 'First wording.' } });
    await copyFoundationBrief(presenter());
    const first = load(copyText.mock.calls[0][0]) as ParsedFoundationBrief;
    setFoundationGroupDescriptions({ Color: { color: 'Changed wording.' } });
    await copyFoundationBrief(presenter());
    const second = load(copyText.mock.calls[1][0]) as ParsedFoundationBrief;
    expect(second.guidelines?.group_descriptions.Color.color).toBe('Changed wording.');
    expect(second.spec_layer.export?.content_hash)
      .toBe(first.spec_layer.export?.content_hash);
  });

  /**
   * Pins the exact sequence the review found broken: open the Foundations
   * tab (one 'foundation' reply, no docs on canvas yet, cache empty),
   * generate descriptions via "Create foundation frame(s)" (a 'foundationDone'
   * reply carrying the fresh whole-canvas merge), then Copy — with NO
   * intervening 'foundation' reply / "Refresh sources" click. Before the fix,
   * step 3's Copy read the step-1 empty cache and silently dropped the
   * descriptions the user had just generated one click earlier.
   */
  it('carries descriptions generated by a build in the same session, with no refresh in between', async () => {
    onFoundationMessage(DUMP); // 1: Foundations tab opens; nothing on canvas yet.
    setFoundationGroupDescriptions({ // 2: foundationDone lands after Create.
      Color: { 'color/bg': 'Backgrounds behind content.' },
    });
    await copyFoundationBrief(presenter()); // 3: Copy, no refresh in between.
    const y = load(copyText.mock.calls[0][0]) as ParsedFoundationBrief;
    expect(y.guidelines?.group_descriptions).toEqual({
      Color: { 'color/bg': 'Backgrounds behind content.' },
    });
  });

  /**
   * The inverse failure: a doc detached or removed from canvas must stop
   * contributing its descriptions to the very next Copy, even though the
   * last 'foundation' reply still had them cached.
   */
  it('drops descriptions once their doc is detached or removed from canvas, with no refresh in between', async () => {
    onFoundationMessage(DUMP, { Color: { 'color/bg': 'Backgrounds behind content.' } });
    setFoundationGroupDescriptions({}); // docDetached/docRemoved's fresh, now-empty merge.
    await copyFoundationBrief(presenter());
    const y = load(copyText.mock.calls[0][0]) as ParsedFoundationBrief;
    expect('guidelines' in y).toBe(false);
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

describe('copyFoundationBriefForScope', () => {
  /** Two collections plus a text style, so narrowing has something to drop. */
  const TWO: SerializedFoundation = {
    fileKey: 'F1',
    extractedAt: '2026-08-24T00:00:00.000Z',
    externals: [],
    effectStyles: [],
    textStyles: [{
      name: 'heading/lg', description: '', fontFamily: 'Inter', fontStyle: 'Regular',
      fontSize: 32, lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PIXELS', value: 0 }, paragraphSpacing: 0,
      paragraphIndent: 0, textCase: 'ORIGINAL', textDecoration: 'NONE',
      boundVariables: {},
    }],
    collections: [
      {
        id: 'C1', name: 'Color', defaultModeId: 'm1',
        modes: [{ modeId: 'm1', name: 'Light' }],
        variables: [{
          id: 'V1', name: 'color/bg/brand', resolvedType: 'COLOR', description: '',
          codeSyntax: {}, valuesByMode: { m1: { r: 0.14, g: 0.39, b: 0.92, a: 1 } },
        }],
      },
      {
        id: 'C2', name: 'Spacing', defaultModeId: 'n1',
        modes: [{ modeId: 'n1', name: 'Value' }],
        variables: [{
          id: 'V2', name: 'space/gap', resolvedType: 'FLOAT', description: '',
          codeSyntax: {}, valuesByMode: { n1: 8 },
        }],
      },
    ],
  };

  const COLOR_SCOPE = {
    target: 'collection' as const, collectionId: 'C1',
    collectionName: 'Color', modeIds: ['m1'],
  };

  function parse(): ParsedFoundationBrief {
    return load(copyText.mock.calls[0][0] as string) as ParsedFoundationBrief;
  }

  it('copies only the scoped collection', async () => {
    onFoundationMessage(TWO);
    const ui = presenter();
    await copyFoundationBriefForScope(COLOR_SCOPE, ui);
    const brief = parse();
    expect(brief.collections).toHaveLength(1);
    expect(brief.collections[0].id).toBe('C1');
    expect(brief.tokens?.map((token) => token.name)).toEqual(['color/bg/brand']);
    expect(brief.completeness).toMatchObject({
      collections: 'partial', styles: 'unavailable',
    });
    expect(ui.info).toHaveBeenCalled();
    expect(ui.error).not.toHaveBeenCalled();
  });

  it('ignores the group and mode narrowing the scope carries', async () => {
    onFoundationMessage(TWO);
    await copyFoundationBriefForScope(
      { ...COLOR_SCOPE, group: 'nonexistent', modeIds: [] },
      presenter(),
    );
    const brief = parse();
    expect(brief.tokens?.map((token) => token.name)).toEqual(['color/bg/brand']);
  });

  it('adds complete transitive dependency collections to a collection copy', async () => {
    const dependent = structuredClone(TWO);
    dependent.collections[0].variables.push({
      id: 'V3', name: 'space/semantic-gap', resolvedType: 'FLOAT', description: '',
      codeSyntax: {}, scopes: ['GAP'],
      valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'V2' } },
    });
    dependent.collections[1].variables[0].scopes = ['GAP'];
    onFoundationMessage(dependent);
    await copyFoundationBriefForScope(
      { ...COLOR_SCOPE, group: 'color', modeIds: [] },
      presenter(),
    );
    const brief = parse();
    expect(brief.collections.map((collection) => collection.id)).toEqual(['C1', 'C2']);
    expect(brief.tokens?.map((token) => token.id)).toEqual(['V1', 'V3', 'V2']);
    expect(brief.tokens?.find((token) => token.id === 'V3')?.values.m1)
      .toMatchObject({
        reference: { target_id: 'V2', target_collection_id: 'C2' },
        resolved: { chain: [{ token_id: 'V2', mode_id: 'n1' }] },
      });
  });

  it('copies every text style for a text styles scope', async () => {
    onFoundationMessage(TWO);
    await copyFoundationBriefForScope({ target: 'textStyles' }, presenter());
    const brief = parse();
    expect((brief.spec_layer as unknown as { version: number }).version).toBe(4);
    expect(brief.collections).toEqual([]);
    expect(brief.text_styles).toEqual([expect.objectContaining({ name: 'heading/lg' })]);
  });

  it('passes only the scoped collection\'s group descriptions', async () => {
    onFoundationMessage(TWO);
    setFoundationGroupDescriptions({
      Color: { color: 'Surface and text colours.' },
      Spacing: { space: 'The 8px scale.' },
    });
    await copyFoundationBriefForScope(COLOR_SCOPE, presenter());
    const brief = parse();
    expect(brief.guidelines?.group_descriptions).toEqual({
      Color: { color: 'Surface and text colours.' },
    });
  });

  it('refuses when no foundation has been read', async () => {
    // A fresh module instance, so this case sees the null spec a real cold
    // start has. The alternative — a reset helper exported from actions.ts —
    // would put test scaffolding in production code for one assertion.
    vi.resetModules();
    const fresh = await import('../src/ui/actions');
    const ui = presenter();
    await fresh.copyFoundationBriefForScope(COLOR_SCOPE, ui);
    expect(copyText).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalledWith(
      "Still reading this file's variables. Try again in a moment.",
    );
  });

  it('refuses when the collection is gone from the file', async () => {
    onFoundationMessage(TWO);
    const ui = presenter();
    await copyFoundationBriefForScope({ ...COLOR_SCOPE, collectionId: 'GONE' }, ui);
    expect(copyText).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalledWith(
      'That collection is no longer in this file. Nothing was copied.',
    );
  });

  it('leaves the whole-file copy covering every collection', async () => {
    onFoundationMessage(TWO);
    await copyFoundationBrief(presenter());
    expect(parse().collections).toHaveLength(2);
  });

  it('carries failed source reads into v5 completeness', async () => {
    onFoundationMessage({
      ...TWO, unavailable: ['variables'], unavailableSources: ['figma:variables'],
    });
    await copyFoundationBrief(presenter());
    expect(parse().completeness).toEqual({
      collections: 'partial', styles: 'partial',
      unavailable_sources: ['figma:variables'],
    });
  });
});
