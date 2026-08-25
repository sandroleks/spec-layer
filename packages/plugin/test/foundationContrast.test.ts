import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  contrastBlockModel, cellLabel, matrixFrame, gridWidth, contrastBlockWidth,
} from '../src/foundationContrast';
import {
  FOREGROUND_WORDS, BACKGROUND_WORDS,
  type ColorContrastReport, type ContrastMatrix,
} from '@spec-layer/extractor';
import { installFakeFigma, uninstallFakeFigma, FakeFrame, FakeSection } from './fakeFigma';
import {
  buildFoundation, planFoundationUnits, unitContent, colorContrast,
  type SerializedFoundation,
} from '@spec-layer/extractor';
import { buildFoundationFrame } from '../src/foundationFrame';

/**
 * A dash of either kind in plugin copy is a voice violation (see
 * docs/plugin-voice-and-copy.md), so every string this module can produce is
 * swept rather than spot-checked.
 */
const DASHES = /[–—]/;

const empty: ColorContrastReport =
  { measured: 0, unclassified: 0, omitted: 0, matrices: [], failures: [] };

/** One 1x1 matrix. Per-collection counts default to clean, so a test that cares
 *  about a count states only that count. */
function matrix(over: Partial<ContrastMatrix> = {}): ContrastMatrix {
  return {
    collection: 'Semantic',
    mode: 'Light',
    foregrounds: ['color/text/a'],
    backgrounds: ['color/surface/x'],
    cells: [[{ ratio: 6.94, clears: ['aa-large', 'aa'] }]],
    unclassified: 0,
    omitted: 0,
    ...over,
  };
}

describe('contrastBlockModel', () => {
  it('explains itself when the collection has no matrix at all', () => {
    const m = contrastBlockModel(empty, 'Spacing');
    expect(m.kind).toBe('none');
    expect(m.kind === 'none' && m.reason).toMatch(/no colour pairs/i);
  });

  it('never borrows the foundation total for a collection it cannot source', () => {
    // The report's unclassified/omitted are foundation-global. A collection with
    // no matrix has no per-collection carrier for them, so the reason must not
    // print a number: 12 unclassified colours in Primitives say nothing about
    // Semantic, and a frame claiming otherwise is a lie the reader cannot check.
    const m = contrastBlockModel({ ...empty, unclassified: 12, omitted: 6 }, 'Semantic');
    expect(m.kind).toBe('none');
    expect(m.kind === 'none' && m.reason).not.toMatch(/\d/);
  });

  it('names the collection, and falls back rather than starting on a space', () => {
    const named = contrastBlockModel(empty, 'Semantic');
    expect(named.kind === 'none' && named.reason).toMatch(/^Semantic /);
    const unnamed = contrastBlockModel(empty, '');
    expect(unnamed.kind === 'none' && unnamed.reason).toMatch(/^This collection /);
  });

  it('tells the reader every name the classifier actually accepts', () => {
    // The anti-drift guard. This copy is the only place a user is told how to
    // make their names work, so it is derived from the classifier's own
    // vocabulary and this test fails if a word is added there and not here.
    const m = contrastBlockModel(empty, 'Semantic');
    const reason = m.kind === 'none' ? m.reason : '';
    for (const word of [...FOREGROUND_WORDS, ...BACKGROUND_WORDS]) {
      expect(reason).toContain(word);
    }
  });

  it('returns the matrices when there is something to show', () => {
    const m = contrastBlockModel({ ...empty, measured: 1, matrices: [matrix()] }, 'Semantic');
    expect(m.kind).toBe('matrix');
    expect(m.kind === 'matrix' && m.matrices).toHaveLength(1);
    expect(m.kind === 'matrix' && m.note).toBeNull();
  });

  it('draws only the named collection, never a grid belonging to another', () => {
    const report = {
      ...empty,
      measured: 2,
      matrices: [matrix({ collection: 'Primitives' }), matrix()],
    };
    const m = contrastBlockModel(report, 'Semantic');
    expect(m.kind === 'matrix' && m.matrices.map((x) => x.collection)).toEqual(['Semantic']);
  });

  it('names the omitted count rather than hiding the cap', () => {
    const m = contrastBlockModel(
      { ...empty, measured: 4, omitted: 7, matrices: [matrix({ omitted: 7 })] }, 'Semantic');
    expect(m.kind === 'matrix' && m.note).toContain('7');
  });

  it('names unclassified colours too, even when a grid was drawn', () => {
    const m = contrastBlockModel(
      { ...empty, measured: 4, unclassified: 3, matrices: [matrix({ unclassified: 3 })] },
      'Semantic');
    const note = m.kind === 'matrix' ? m.note : null;
    expect(note).toContain('3');
    // Actionable, not just a count: the note carries the same vocabulary the
    // no-matrix reason does.
    expect(note).toContain('foreground');
  });

  it('reads the counts off the matrix for this collection, not the report total', () => {
    // The regression this shape exists for: Primitives dropped 6 to the cap and
    // failed to classify 12, Semantic dropped none. Semantic's frame must say so.
    const report: ColorContrastReport = {
      measured: 25,
      unclassified: 12,
      omitted: 6,
      matrices: [
        matrix({ collection: 'Primitives', unclassified: 12, omitted: 6 }),
        matrix(),
      ],
      failures: [],
    };
    const semantic = contrastBlockModel(report, 'Semantic');
    expect(semantic.kind === 'matrix' && semantic.note).toBeNull();
    const primitives = contrastBlockModel(report, 'Primitives');
    expect(primitives.kind === 'matrix' && primitives.note).toContain('12');
  });

  it('counts one colour in the singular', () => {
    const one = contrastBlockModel(
      { ...empty, measured: 1, matrices: [matrix({ omitted: 1, unclassified: 1 })] }, 'Semantic');
    const note = one.kind === 'matrix' ? (one.note ?? '') : '';
    expect(note).toContain('1 colour');
    expect(note).not.toContain('1 colours');
  });

  it('uses no em dash or en dash in any copy', () => {
    const models = [
      contrastBlockModel({ ...empty, unclassified: 3 }, 'Semantic'),
      contrastBlockModel(empty, 'Spacing'),
      contrastBlockModel(empty, ''),
      contrastBlockModel(
        { ...empty, measured: 1, matrices: [matrix({ omitted: 2 })] }, 'Semantic'),
      contrastBlockModel(
        { ...empty, measured: 1, matrices: [matrix({ unclassified: 2 })] }, 'Semantic'),
      contrastBlockModel(
        { ...empty, measured: 1, matrices: [matrix({ omitted: 2, unclassified: 5 })] },
        'Semantic'),
    ];
    for (const m of models) {
      const text = m.kind === 'none' ? m.reason : (m.note ?? '');
      expect(text).not.toMatch(DASHES);
    }
  });
});

describe('cellLabel', () => {
  it('names the strongest bar cleared', () => {
    expect(cellLabel({ ratio: 6.94, clears: ['aa-large', 'aa'] })).toBe('6.94:1 AA');
    expect(cellLabel({ ratio: 21, clears: ['aa-large', 'aa', 'aaa'] })).toBe('21:1 AAA');
  });

  it('says what a 3:1 pair actually clears, rather than shouting AA-LARGE', () => {
    // 3:1 is SC 1.4.3 large text AND SC 1.4.11 non-text contrast, which covers
    // icons, borders and focus rings. A bare "AA-LARGE" on an icon colour
    // understates it, so the label names both halves.
    expect(cellLabel({ ratio: 3, clears: ['aa-large'] })).toBe('3:1 AA large text and UI');
  });

  it('says a pair fails when it clears nothing', () => {
    expect(cellLabel({ ratio: 2.23, clears: [] })).toBe('2.23:1 fails');
    // Ratios are floored at two decimals, so the near miss reads as a miss.
    expect(cellLabel({ ratio: 2.99, clears: [] })).toBe('2.99:1 fails');
  });

  it('prints a whole ratio without invented decimals', () => {
    expect(cellLabel({ ratio: 21, clears: ['aa-large', 'aa', 'aaa'] })).toContain('21:1');
    expect(cellLabel({ ratio: 21, clears: [] })).not.toContain('21.00');
  });

  it('distinguishes unmeasured from failing', () => {
    expect(cellLabel(null)).toBe('not measured');
  });

  it('falls back to the bar name if a new bar is ever added', () => {
    // A floor, not a path: every ContrastBar is named above. This keeps an
    // unmapped bar readable instead of blank.
    expect(cellLabel({ ratio: 9, clears: ['aaa-plus'] })).toBe('9:1 AAA-PLUS');
  });

  it('uses no em dash or en dash in any label', () => {
    const labels = [
      cellLabel(null),
      cellLabel({ ratio: 1, clears: [] }),
      cellLabel({ ratio: 3, clears: ['aa-large'] }),
      cellLabel({ ratio: 5, clears: ['aa-large', 'aa'] }),
      cellLabel({ ratio: 8, clears: ['aa-large', 'aa', 'aaa'] }),
    ];
    for (const label of labels) expect(label).not.toMatch(DASHES);
  });
});

/** Every cell frame in one grid row, label cell first. */
function cellsOf(row: FakeFrame): FakeFrame[] {
  return row.children.filter((c): c is FakeFrame => c instanceof FakeFrame);
}

function textOf(cell: FakeFrame): { characters: string; fills: unknown; fontName: unknown } {
  const node = cell.children[0] as unknown as
    { characters: string; fills: unknown; fontName: unknown };
  return node;
}

function wide(fgCount: number, bgCount: number): ContrastMatrix {
  const foregrounds = Array.from({ length: fgCount }, (_, i) => `color/text/t${i}`);
  const backgrounds = Array.from({ length: bgCount }, (_, i) => `color/surface/s${i}`);
  return {
    collection: 'Semantic',
    mode: 'Light',
    foregrounds,
    backgrounds,
    cells: foregrounds.map(() => backgrounds.map(() => ({
      ratio: 4.51, clears: ['aa-large' as const, 'aa' as const],
    }))),
    unclassified: 0,
    omitted: 0,
  };
}

describe('matrixFrame', () => {
  beforeEach(() => installFakeFigma());
  afterEach(() => uninstallFakeFigma());

  it('lays out backgrounds across the top and foregrounds down the side', () => {
    const frame = matrixFrame(matrix()) as unknown as FakeFrame;
    expect(frame.name).toBe('Contrast Semantic Light');
    // Header row, then one row per foreground.
    expect(frame.children).toHaveLength(2);
    expect(frame.textChars()).toEqual(['', 'x', 'a', '6.94:1 AA']);
  });

  it('shortens a token to its last segment so a heading fits its column', () => {
    const frame = matrixFrame(matrix({
      foregrounds: ['color/text/body/strong'],
      backgrounds: ['color/surface/page/default'],
    })) as unknown as FakeFrame;
    expect(frame.textChars()).toContain('strong');
    expect(frame.textChars()).toContain('default');
  });

  it('keeps a token with no segments readable', () => {
    const frame = matrixFrame(matrix({
      foregrounds: ['ink'], backgrounds: ['paper'],
    })) as unknown as FakeFrame;
    expect(frame.textChars()).toContain('ink');
    expect(frame.textChars()).toContain('paper');
  });

  it('distinguishes not measured from failing by more than its wording', () => {
    // The whole point: side by side on a frame, a grey "not measured" and a red
    // "fails" must not read as the same verdict.
    const frame = matrixFrame(matrix({
      backgrounds: ['color/surface/x', 'color/surface/y'],
      cells: [[null, { ratio: 1.2, clears: [] }]],
    })) as unknown as FakeFrame;
    const row = frame.children[1] as FakeFrame;
    const [, unmeasured, failing] = cellsOf(row);
    expect(textOf(unmeasured).characters).toBe('not measured');
    expect(textOf(failing).characters).toBe('1.2:1 fails');
    expect(textOf(failing).fills).not.toEqual(textOf(unmeasured).fills);
    expect(textOf(failing).fontName).not.toEqual(textOf(unmeasured).fontName);
    // A failing cell is tinted; an unmeasured one carries no fill at all.
    expect(failing.fills).not.toEqual([]);
    expect(unmeasured.fills).toEqual([]);
  });

  it('sizes itself to its own columns, so the card can be widened to hold it', () => {
    const frame = matrixFrame(wide(2, 3)) as unknown as FakeFrame;
    expect(frame.width).toBe(gridWidth(3));
    expect(contrastBlockWidth([wide(2, 3), wide(1, 8)])).toBe(gridWidth(8));
    expect(contrastBlockWidth([])).toBe(0);
  });

  it('stays a full grid at the 24 by 24 cap', () => {
    const frame = matrixFrame(wide(24, 24)) as unknown as FakeFrame;
    expect(frame.children).toHaveLength(25);
    for (const row of frame.children as FakeFrame[]) expect(cellsOf(row)).toHaveLength(25);
    expect(frame.width).toBe(gridWidth(24));
    // Hugging height, so the frame is exactly its rows: every row is the same
    // height, and the grid is their sum. At the cap that is 2398 by 650.
    const rowH = (frame.children[0] as FakeFrame).height;
    expect((frame.children as FakeFrame[]).every((r) => r.height === rowH)).toBe(true);
    expect(frame.height).toBe(25 * rowH);
  });

  it('renders no em dash or en dash', () => {
    const frame = matrixFrame(matrix({
      backgrounds: ['color/surface/x', 'color/surface/y'],
      cells: [[null, { ratio: 3, clears: ['aa-large'] }]],
    })) as unknown as FakeFrame;
    for (const chars of frame.textChars()) expect(chars).not.toMatch(DASHES);
  });
});

/**
 * The frame end of the wiring, including the one thing that must NOT change.
 *
 * `includeContrast: false` has to render byte for byte what a doc rendered
 * before this block existed: the drift baseline (selfHash) is a hash of the
 * Section's own text, so a single extra text node on the false path would make
 * every foundation doc in every file report "Update available".
 */
describe('buildFoundationFrame with contrast', () => {
  beforeEach(() => installFakeFigma());
  afterEach(() => uninstallFakeFigma());

  const theme = {
    headerBg: '#123456', accent: '#00ffcc', bodyText: '#222222',
    tableHeadBg: '#fafafa', cornerStyle: 'soft' as const,
    headingFont: 'Inter', bodyFont: 'Inter',
  };

  /** One pairable collection: a foreground, a background, and a spacing value. */
  function dump(names: string[]): SerializedFoundation {
    return {
      fileKey: 'F', extractedAt: 'T', externals: [], textStyles: [], effectStyles: [],
      collections: [{
        id: 'c1', name: 'Semantic', defaultModeId: 'm1',
        modes: [{ modeId: 'm1', name: 'Light' }],
        variables: names.map((name, i) => ({
          id: `v${i}`, name, resolvedType: 'COLOR' as const, description: '',
          codeSyntax: {}, valuesByMode: { m1: { r: 0.1, g: 0.2, b: 0.3, a: 1 } },
        })),
      }],
    };
  }

  async function build(names: string[], includeContrast?: boolean): Promise<FakeFrame> {
    const spec = buildFoundation(dump(names));
    const units = planFoundationUnits(spec, {
      collections: [{ collectionId: 'c1', modeIds: ['m1'] }], textStyles: false,
    });
    const content = unitContent(spec, units[0].scope)!;
    const section = await buildFoundationFrame(
      content, units[0], theme, false, null, undefined,
      includeContrast, includeContrast === undefined ? undefined : colorContrast(spec),
    ) as unknown as FakeSection;
    return section.children[0] as unknown as FakeFrame;
  }

  const pairable = ['color/text/body', 'color/surface/page'];

  it('renders nothing at all when the toggle is off', async () => {
    const off = await build(pairable, false);
    const absent = await build(pairable);
    expect(off.textChars()).toEqual(absent.textChars());
    expect(off.findAllNamed('Contrast Semantic Light')).toHaveLength(0);
    expect(off.width).toBe(absent.width);
  });

  it('draws the grid and names the block when the toggle is on', async () => {
    const card = await build(pairable, true);
    expect(card.findAllNamed('Contrast Semantic Light')).toHaveLength(1);
    expect(card.textChars()).toContain('Contrast');
    // Same colour on both sides, so the pair fails and says so.
    expect(card.textChars()).toContain('1:1 fails');
  });

  it('widens the card rather than clipping a grid wider than it', async () => {
    const many = [
      ...Array.from({ length: 12 }, (_, i) => `color/text/t${i}`),
      ...Array.from({ length: 12 }, (_, i) => `color/surface/s${i}`),
    ];
    const wideCard = await build(many, true);
    const narrow = await build(many, false);
    expect(wideCard.width).toBeGreaterThan(narrow.width);
    expect(wideCard.width).toBeGreaterThanOrEqual(gridWidth(12));
  });

  it('explains itself instead of drawing a blank grid when nothing pairs', async () => {
    const card = await build(['color/brand/500', 'color/brand/600'], true);
    expect(card.findAllNamed('Contrast Semantic Light')).toHaveLength(0);
    expect(card.textChars().join(' ')).toMatch(/no colour pairs/i);
  });

  it('uses no em dash or en dash in anything it renders', async () => {
    const card = await build(pairable, true);
    for (const chars of card.textChars()) expect(chars).not.toMatch(DASHES);
  });
});
