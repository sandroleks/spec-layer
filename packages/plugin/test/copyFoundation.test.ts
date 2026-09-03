import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SerializedFoundation } from '@spec-layer/extractor';

const copyText = vi.fn();
const renderManualCopyModal = vi.fn((_t: string, _notice?: string) => () => {});
vi.mock('../src/ui/clipboard', () => ({
  copyText: (t: string) => copyText(t),
  renderManualCopyModal: (t: string, notice?: string) => renderManualCopyModal(t, notice),
}));

const { copyFoundationBrief, copyFoundationBriefForScope, onFoundationMessage, setFoundationGroupDescriptions } =
  await import('../src/ui/actions');

/** Shape of the parsed clipboard document, just deep enough for these
 *  assertions. Typed rather than `any` so a shape drift fails at compile
 *  time, matching the convention in packages/extractor/test/brief.test.ts
 *  and copyBrief.test.ts. */
interface ClipboardDocument {
  version: string;
  name?: string;
  sets: Record<string, { sources: unknown[] }>;
  modifiers: Record<string, { contexts: Record<string, unknown[]>; default?: string }>;
  resolutionOrder: Array<{ $ref: string }>;
  $extensions: { 'com.spec-layer': {
    schema_version: string; content_hash: string; completeness: { collections: string };
    code_syntax: Record<string, Record<string, string>>; report: Array<{ code: string; path: string }>;
  } };
}
const copied = (): ClipboardDocument =>
  JSON.parse(copyText.mock.calls.at(-1)?.[0] as string) as ClipboardDocument;

/** Walks a dotted path inside an inlined DTCG source tree. */
function leafAt(tree: unknown, path: string): Record<string, unknown> {
  let node: unknown = tree;
  for (const seg of path.split('.')) {
    if (typeof node !== 'object' || node === null) {
      throw new Error(`Copied document is missing "${path}" at segment "${seg}".`);
    }
    node = (node as Record<string, unknown>)[seg];
  }
  if (typeof node !== 'object' || node === null) {
    throw new Error(`Copied document is missing "${path}".`);
  }
  return node as Record<string, unknown>;
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

  it('copies one DTCG resolver document backed by the canonical content hash', async () => {
    onFoundationMessage(DUMP);
    await copyFoundationBrief(presenter());
    const doc = copied();
    expect(doc.version).toBe('2025.10');
    expect(doc.$extensions['com.spec-layer'].content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.keys(doc.sets).concat(Object.keys(doc.modifiers))).toContain('Color');
  });

  it('carries dimensions, precise color channels, and local and external aliases', async () => {
    onFoundationMessage(DUMP);
    await copyFoundationBrief(presenter());
    const doc = copied();
    const tree = doc.sets.Color.sources[0];
    expect(leafAt(tree, 'Color.space.gap')).toEqual({ $type: 'dimension', $value: { value: 8, unit: 'px' } });
    const brand = leafAt(tree, 'Color.color.bg.brand');
    expect(brand.$type).toBe('color');
    expect((brand.$value as { components: number[] }).components).toEqual([0.1401, 0.3901, 0.9201]);
    expect((brand.$value as { alpha: number }).alpha).toBe(0.125);
    // color/owner -> color/middle -> color/terminal: the direct alias target, not the chain end.
    const owner = leafAt(tree, 'Color.color.owner');
    expect(owner).toEqual({ $type: 'color', $value: '{Color.color.middle}' });
    // color/external aliases an unavailable library source: absent from the tree,
    // and the omission is stated in the report instead of guessed at.
    const colorGroup = leafAt(tree, 'Color.color');
    expect('external' in colorGroup).toBe(false);
    expect(doc.$extensions['com.spec-layer'].report).toContainEqual(
      expect.objectContaining({ code: 'value_omitted', path: 'Color.color.external' }),
    );
  });

  it('omits group descriptions when no foundation doc on canvas carries them', async () => {
    onFoundationMessage(DUMP);
    await copyFoundationBrief(presenter());
    const bg = leafAt(copied().sets.Color.sources[0], 'Color.color.bg');
    expect('$description' in bg).toBe(false);
  });

  it('carries group descriptions merged from the foundation doc links on canvas', async () => {
    onFoundationMessage(DUMP, { Color: { 'color/bg': 'Backgrounds behind content.' } });
    await copyFoundationBrief(presenter());
    const bg = leafAt(copied().sets.Color.sources[0], 'Color.color.bg');
    expect(bg.$description).toBe('Backgrounds behind content.');
  });

  it('keeps generated guidelines outside the semantic content hash', async () => {
    onFoundationMessage(DUMP, { Color: { color: 'First wording.' } });
    await copyFoundationBrief(presenter());
    const first = copied();
    setFoundationGroupDescriptions({ Color: { color: 'Changed wording.' } });
    await copyFoundationBrief(presenter());
    const second = copied();
    const group = leafAt(second.sets.Color.sources[0], 'Color.color');
    expect(group.$description).toBe('Changed wording.');
    expect(second.$extensions['com.spec-layer'].content_hash)
      .toBe(first.$extensions['com.spec-layer'].content_hash);
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
    const bg = leafAt(copied().sets.Color.sources[0], 'Color.color.bg');
    expect(bg.$description).toBe('Backgrounds behind content.');
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
    const bg = leafAt(copied().sets.Color.sources[0], 'Color.color.bg');
    expect('$description' in bg).toBe(false);
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
        // The document still gives each token its own $type/$value object, so
        // 900 tokens stays comfortably above the 800-line manual-copy threshold.
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
      id: 'S:heading-lg',
      name: 'heading/lg', description: '', fontFamily: 'Inter', fontStyle: 'Regular',
      fontSize: 32, lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PIXELS', value: 0 }, paragraphSpacing: 0,
      paragraphIndent: 0, textCase: 'ORIGINAL', textDecoration: 'NONE',
      boundVariables: {},
      source: { remote: false, publishStatus: 'CURRENT' },
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

  it('copies only the scoped collection', async () => {
    onFoundationMessage(TWO);
    const ui = presenter();
    await copyFoundationBriefForScope(COLOR_SCOPE, ui);
    const doc = copied();
    expect(Object.keys(doc.sets).concat(Object.keys(doc.modifiers))).toEqual(['Color']);
    const brand = leafAt(doc.sets.Color.sources[0], 'Color.color.bg.brand');
    expect(brand.$type).toBe('color');
    expect(doc.$extensions['com.spec-layer'].completeness).toMatchObject({
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
    const brand = leafAt(copied().sets.Color.sources[0], 'Color.color.bg.brand');
    expect(brand.$type).toBe('color');
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
    const doc = copied();
    expect(Object.keys(doc.sets).concat(Object.keys(doc.modifiers)).sort()).toEqual(['Color', 'Spacing']);
    const semanticGap = leafAt(doc.sets.Color.sources[0], 'Color.space.semantic-gap');
    expect(semanticGap).toEqual({ $type: 'dimension', $value: '{Spacing.space.gap}' });
    const gap = leafAt(doc.sets.Spacing.sources[0], 'Spacing.space.gap');
    expect(gap).toEqual({ $type: 'dimension', $value: { value: 8, unit: 'px' } });
  });

  it('copies every text style for a text styles scope', async () => {
    onFoundationMessage(TWO);
    await copyFoundationBriefForScope({ target: 'textStyles' }, presenter());
    const doc = copied();
    expect(doc.sets['Typography styles']).toBeDefined();
    expect(doc.sets['Effect styles']).toBeUndefined();
    const heading = leafAt(doc.sets['Typography styles'].sources[0], 'Typography styles.heading.lg');
    expect(heading.$type).toBe('typography');
    expect(doc.$extensions['com.spec-layer'].completeness).toMatchObject({
      collections: 'partial', styles: 'partial',
    });
  });

  it('adds bound-token dependency collections to a text styles copy', async () => {
    const bound = structuredClone(TWO);
    bound.collections[1].variables[0].scopes = ['FONT_SIZE'];
    bound.textStyles[0].bindingIds = { fontSize: 'V2' };
    bound.textStyles[0].boundVariables = { fontSize: 'space/gap' };
    onFoundationMessage(bound);
    await copyFoundationBriefForScope({ target: 'textStyles' }, presenter());
    const doc = copied();
    expect(Object.keys(doc.sets).sort()).toEqual(['Spacing', 'Typography styles']);
    expect(doc.modifiers).toEqual({});
    const gap = leafAt(doc.sets.Spacing.sources[0], 'Spacing.space.gap');
    expect(gap.$type).toBe('dimension');
    const heading = leafAt(doc.sets['Typography styles'].sources[0], 'Typography styles.heading.lg');
    expect((heading.$value as { fontSize: string }).fontSize).toBe('{Spacing.space.gap}');
  });

  it('passes only the scoped collection\'s group descriptions', async () => {
    onFoundationMessage(TWO);
    setFoundationGroupDescriptions({
      Color: { color: 'Surface and text colours.' },
      Spacing: { space: 'The 8px scale.' },
    });
    await copyFoundationBriefForScope(COLOR_SCOPE, presenter());
    const group = leafAt(copied().sets.Color.sources[0], 'Color.color');
    expect(group.$description).toBe('Surface and text colours.');
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
    const doc = copied();
    expect(Object.keys(doc.sets).concat(Object.keys(doc.modifiers)).sort())
      .toEqual(['Color', 'Spacing', 'Typography styles']);
  });

  it('carries failed source reads into v5 completeness', async () => {
    onFoundationMessage({
      ...TWO, unavailable: ['variables'], unavailableSources: ['figma:variables'],
    });
    await copyFoundationBrief(presenter());
    expect(copied().$extensions['com.spec-layer'].completeness).toEqual({
      collections: 'partial', styles: 'partial',
      unavailable_sources: ['figma:variables'],
    });
  });
});
