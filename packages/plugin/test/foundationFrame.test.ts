import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  valueLabel, swatchColorOf, footerNotes, cellText, swatchCell, headerCell,
  buildFoundationFrame, headerSubtitle, tableColumns, cardWidth, rowWidth,
  type TableColumn,
} from '../src/foundationFrame';
import { hstack, vstack } from '../src/frameKit';
import {
  installFakeFigma, uninstallFakeFigma, FakeFrame, FakeSection, TEXT_H,
} from './fakeFigma';
import {
  buildFoundation, planFoundationUnits, unitContent,
  SPLIT_THRESHOLD, type FoundationValue, type FoundationUnitContent,
  type SerializedFoundation,
} from '@spec-layer/extractor';

describe('valueLabel', () => {
  it('labels a color as hex, adding alpha only when partial', () => {
    expect(valueLabel({ kind: 'color', hex: '#2563eb', alpha: 1 })).toBe('#2563EB');
    expect(valueLabel({ kind: 'color', hex: '#000000', alpha: 0.5 })).toBe('#000000 50%');
  });

  it('labels numbers without trailing zeros', () => {
    expect(valueLabel({ kind: 'number', value: 16 })).toBe('16');
    expect(valueLabel({ kind: 'number', value: 1.5 })).toBe('1.5');
  });

  it('labels strings and booleans', () => {
    expect(valueLabel({ kind: 'string', value: 'Acme' })).toBe('Acme');
    expect(valueLabel({ kind: 'boolean', value: true })).toBe('true');
  });

  it('labels an empty string variable as a stated fact, not a blank cell', () => {
    expect(valueLabel({ kind: 'string', value: '' })).toBe('(empty string)');
  });

  it('labels a non-empty string unchanged', () => {
    expect(valueLabel({ kind: 'string', value: 'Acme Corp' })).toBe('Acme Corp');
  });

  it('labels a resolved alias with the arrow and the final value', () => {
    const v: FoundationValue = {
      kind: 'alias', targetName: 'color/blue/500', targetCollection: 'Primitives',
      external: false, resolved: { kind: 'color', hex: '#0000ff', alpha: 1 },
    };
    expect(valueLabel(v)).toBe('→ color/blue/500  #0000FF');
  });

  it('marks an external alias as a library reference with no value', () => {
    const v: FoundationValue = {
      kind: 'alias', targetName: 'core/blue', targetCollection: 'Core Library',
      external: true, resolved: null,
    };
    expect(valueLabel(v)).toBe('→ core/blue (library)');
  });

  it('states every unresolved reason plainly', () => {
    expect(valueLabel({ kind: 'unresolved', reason: 'cycle' })).toBe('not resolved: cycle');
    expect(valueLabel({ kind: 'unresolved', reason: 'missing' })).toBe('not resolved: missing');
    expect(valueLabel({ kind: 'unresolved', reason: 'depth' })).toBe('not resolved: depth');
    expect(valueLabel({ kind: 'unresolved', reason: 'external' }))
      .toBe('not resolved: external library variable');
  });

  it('labels an alias whose chain failed with the arrow plus the reason', () => {
    const v: FoundationValue = {
      kind: 'alias', targetName: 'a', targetCollection: 'P', external: false,
      resolved: { kind: 'unresolved', reason: 'cycle' },
    };
    expect(valueLabel(v)).toBe('→ a  not resolved: cycle');
  });

  it('contains no em dash in any label', () => {
    const values: FoundationValue[] = [
      { kind: 'color', hex: '#000000', alpha: 0.5 },
      { kind: 'unresolved', reason: 'external' },
      { kind: 'alias', targetName: 'a', targetCollection: 'P', external: true, resolved: null },
    ];
    for (const v of values) expect(valueLabel(v)).not.toContain('—');
  });
});

describe('footerNotes', () => {
  const base: FoundationUnitContent = {
    collectionName: 'Primitives', modeNames: ['Value'], omittedModeNames: [], rows: [],
  };

  it('says nothing when there is nothing to say', () => {
    expect(footerNotes(base)).toEqual([]);
  });

  it('names omitted modes', () => {
    expect(footerNotes({ ...base, omittedModeNames: ['E', 'F'] }))
      .toEqual(['Modes not shown: E, F']);
  });

  it('renders the part note from content, one-indexed', () => {
    expect(footerNotes({ ...base, group: 'space', part: { index: 1, total: 3 } }))
      .toEqual(['Part 2 of 3, covering space.']);
  });

  it('omits the part note when the unit was not split', () => {
    expect(footerNotes({ ...base, group: 'space' })).toEqual([]);
  });

  it('lists omitted modes before the part note', () => {
    expect(footerNotes({
      ...base, group: 'space', omittedModeNames: ['Dark'], part: { index: 0, total: 2 },
    })).toEqual(['Modes not shown: Dark', 'Part 1 of 2, covering space.']);
  });

  it('contains no em dash', () => {
    const notes = footerNotes({
      ...base, group: 'space', omittedModeNames: ['Dark'], part: { index: 0, total: 2 },
    });
    for (const n of notes) expect(n).not.toContain('—');
  });
});

describe('footerNotes — end to end over a split batch', () => {
  /** Two collections that each split: Primitives into 3, Semantic into 2. */
  function twoSplitCollections(): SerializedFoundation {
    const varsFor = (prefix: string, mode: string, groups: string[]) =>
      Array.from({ length: SPLIT_THRESHOLD + groups.length }, (_, i) => ({
        id: `${prefix}${i}`, name: `${groups[i % groups.length]}/item${i}`,
        resolvedType: 'COLOR' as const, description: '', codeSyntax: {},
        valuesByMode: { [mode]: { r: 0, g: 0, b: 0, a: 1 } },
      }));
    return {
      fileKey: 'FILE1', extractedAt: '2026-07-25T00:00:00.000Z', externals: [], textStyles: [],
      collections: [
        { id: 'c1', name: 'Primitives', defaultModeId: 'am1',
          modes: [{ modeId: 'am1', name: 'Value' }],
          variables: varsFor('a', 'am1', ['color', 'space', 'radius']) },
        { id: 'c2', name: 'Semantic', defaultModeId: 'bm1',
          modes: [{ modeId: 'bm1', name: 'Value' }],
          variables: varsFor('b', 'bm1', ['bg', 'text']) },
      ],
    };
  }

  it('numbers each collection separately across a five-frame batch', () => {
    const dump = twoSplitCollections();
    const spec = buildFoundation(dump);
    const units = planFoundationUnits(spec, {
      collections: dump.collections.map((c) => ({
        collectionId: c.id, modeIds: c.modes.map((m) => m.modeId),
      })),
      textStyles: false,
    });
    // Numbering the batch would read "Part 4 of 5" / "Part 5 of 5" for Semantic.
    expect(units.map((u) => footerNotes(unitContent(spec, u.scope)!)[0])).toEqual([
      'Part 1 of 3, covering color.',
      'Part 2 of 3, covering space.',
      'Part 3 of 3, covering radius.',
      'Part 1 of 2, covering bg.',
      'Part 2 of 2, covering text.',
    ]);
  });

  it('reproduces a single doc note identically without the batch', () => {
    // updateFoundationDoc rebuilds one doc from its stored scope alone; it used
    // to pass 0, 1 and so dropped the note entirely.
    const spec = buildFoundation(twoSplitCollections());
    const scope = {
      target: 'collection' as const, collectionId: 'c2', collectionName: 'Semantic',
      group: 'text', modeIds: ['bm1'],
    };
    expect(footerNotes(unitContent(spec, scope)!)).toEqual(['Part 2 of 2, covering text.']);
  });
});

describe('swatchColorOf', () => {
  it('returns rgb for a color', () => {
    expect(swatchColorOf({ kind: 'color', hex: '#0000ff', alpha: 1 }))
      .toEqual({ r: 0, g: 0, b: 1 });
  });

  it('returns the resolved color through an alias', () => {
    expect(swatchColorOf({
      kind: 'alias', targetName: 'x', targetCollection: 'P', external: false,
      resolved: { kind: 'color', hex: '#ff0000', alpha: 1 },
    })).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('returns null for non-colors and unresolved values', () => {
    expect(swatchColorOf({ kind: 'number', value: 4 })).toBeNull();
    expect(swatchColorOf({ kind: 'unresolved', reason: 'missing' })).toBeNull();
    expect(swatchColorOf({
      kind: 'alias', targetName: 'x', targetCollection: 'L', external: true, resolved: null,
    })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Table cell sizing — the row-clipping regression.
//
// Every cell must end up FIXED at its column width horizontally and HUG
// vertically. The bug was an axis mix-up: on a HORIZONTAL auto-layout frame the
// PRIMARY axis is the width and the COUNTER axis is the height, and Figma's
// resize() fixes BOTH axes. `resize(width, 1)` then
// `primaryAxisSizingMode = 'FIXED'` therefore re-fixed the width and left the
// height pinned at the literal 1, clipping every row to a sliver.
//
// The stub below MUST reproduce that resize() behaviour or this whole suite is
// worthless: it would pass against the buggy code. See the "stub fidelity"
// tests, which pin the emulation itself.
// ---------------------------------------------------------------------------

describe('table cell sizing (row-clipping regression)', () => {
  beforeEach(() => installFakeFigma());
  afterEach(uninstallFakeFigma);

  describe('stub fidelity — without these the suite cannot catch the bug', () => {
    it('resize() pins BOTH sizing modes to FIXED, as the real Figma API does', () => {
      const f = hstack(6) as unknown as FakeFrame;
      expect(f.primaryAxisSizingMode).toBe('AUTO');
      expect(f.counterAxisSizingMode).toBe('AUTO');
      f.resize(240, 1);
      expect(f.primaryAxisSizingMode).toBe('FIXED');
      expect(f.counterAxisSizingMode).toBe('FIXED');
    });

    it('maps layoutSizing* onto the axis the layout direction implies', () => {
      const h = hstack(0) as unknown as FakeFrame;
      h.layoutSizingVertical = 'FIXED';
      // Vertical is the COUNTER axis of a horizontal frame.
      expect(h.counterAxisSizingMode).toBe('FIXED');
      expect(h.primaryAxisSizingMode).toBe('AUTO');

      const v = vstack(0) as unknown as FakeFrame;
      v.layoutSizingVertical = 'FIXED';
      // Vertical is the PRIMARY axis of a vertical frame.
      expect(v.primaryAxisSizingMode).toBe('FIXED');
      expect(v.counterAxisSizingMode).toBe('AUTO');
    });

    it('reproduces the bug when the old primary-only fix is applied', () => {
      const f = hstack(6) as unknown as FakeFrame;
      f.resize(240, 1);
      f.primaryAxisSizingMode = 'FIXED'; // the original, wrong-axis line
      expect(f.layoutSizingVertical).toBe('FIXED'); // height stuck, not hugging
      expect(f.height).toBe(1); // the one-pixel sliver the user saw
    });

    it('shows why the same shape is CORRECT on a vstack (the specimen pane)', () => {
      // buildFoundationFrame's text-style pane does exactly this. On a VERTICAL
      // frame the primary axis IS the height, so restoring primary to AUTO
      // restores the height hug and leaves the width fixed. Same two lines,
      // opposite meaning, purely because the direction changed.
      const pane = vstack(2) as unknown as FakeFrame;
      pane.resize(360, 1);
      pane.primaryAxisSizingMode = 'AUTO';
      expect(pane.layoutSizingHorizontal).toBe('FIXED');
      expect(pane.width).toBe(360);
      expect(pane.layoutSizingVertical).toBe('HUG');
      pane.appendChild({ height: 40 });
      pane.appendChild({ height: 12 });
      expect(pane.height).toBe(40 + 12 + 2); // hugs its children, not stuck at 1
    });
  });

  const builders: [string, (w: number) => FakeFrame][] = [
    ['cellText', (w) => cellText('spacing/md', w) as unknown as FakeFrame],
    ['cellText (muted)', (w) => cellText('a description', w, true) as unknown as FakeFrame],
    ['swatchCell (color, with chip)', (w) =>
      swatchCell({ kind: 'color', hex: '#2563eb', alpha: 1 }, w) as unknown as FakeFrame],
    ['swatchCell (number, no chip)', (w) =>
      swatchCell({ kind: 'number', value: 16 }, w) as unknown as FakeFrame],
    ['swatchCell (unresolved)', (w) =>
      swatchCell({ kind: 'unresolved', reason: 'cycle' }, w) as unknown as FakeFrame],
    ['headerCell', (w) => headerCell('Name', w) as unknown as FakeFrame],
  ];

  for (const [name, build] of builders) {
    describe(name, () => {
      it('is FIXED horizontally at the requested column width', () => {
        const cell = build(240);
        expect(cell.layoutSizingHorizontal).toBe('FIXED');
        expect(cell.width).toBe(240);
        // Stated on the underlying axis too: width is the PRIMARY axis here.
        expect(cell.primaryAxisSizingMode).toBe('FIXED');
      });

      it('HUGS vertically so the text is never clipped', () => {
        const cell = build(180);
        expect(cell.layoutSizingVertical).toBe('HUG');
        // Height is the COUNTER axis of a horizontal frame. Asserting this is
        // what makes a primaryAxisSizingMode-only regression fail.
        expect(cell.counterAxisSizingMode).toBe('AUTO');
      });

      it('is as tall as its content, not a one-pixel sliver', () => {
        const cell = build(180);
        expect(cell.height).toBe(TEXT_H);
        expect(cell.height).toBeGreaterThan(1);
      });

      it('holds its content and stays a horizontal auto-layout frame', () => {
        const cell = build(180);
        expect(cell.layoutMode).toBe('HORIZONTAL');
        expect(cell.children.length).toBeGreaterThan(0);
      });
    });
  }

  it('keeps the swatch chip and its label in one row', () => {
    const cell = swatchCell({ kind: 'color', hex: '#2563eb', alpha: 1 }, 180) as unknown as FakeFrame;
    expect(cell.children).toHaveLength(2); // chip + label
    expect(cell.counterAxisAlignItems).toBe('CENTER'); // vertical centring preserved
  });

  it('centres cellText content vertically', () => {
    const cell = cellText('x', 240) as unknown as FakeFrame;
    expect(cell.counterAxisAlignItems).toBe('CENTER');
  });
});

// ---------------------------------------------------------------------------
// The whole card. Foundation frames are meant to read as the same family of
// document as component frames: the brand header band, the captured logo, the
// theme colours, one fixed-width card. Before this they were an unbranded white
// box that applied the theme's fonts and ignored its header colour entirely.
// ---------------------------------------------------------------------------

describe('buildFoundationFrame', () => {
  beforeEach(() => installFakeFigma());
  afterEach(uninstallFakeFigma);

  const theme = {
    headerBg: '#123456', accent: '#00ffcc', bodyText: '#222222',
    tableHeadBg: '#fafafa', cornerStyle: 'soft' as const,
    headingFont: 'Inter', bodyFont: 'Inter',
  };

  /** Two modes, three described variables, plus one text style. */
  function dump(): SerializedFoundation {
    return {
      fileKey: 'FILE1', extractedAt: '2026-07-27T00:00:00.000Z', externals: [],
      collections: [{
        id: 'c1', name: 'Primitives', defaultModeId: 'light',
        modes: [{ modeId: 'light', name: 'Light' }, { modeId: 'dark', name: 'Dark' }],
        variables: [
          { id: 'v1', name: 'color/bg', resolvedType: 'COLOR', description: 'Page background',
            codeSyntax: {}, valuesByMode: {
              light: { r: 1, g: 1, b: 1, a: 1 }, dark: { r: 0, g: 0, b: 0, a: 1 } } },
          { id: 'v2', name: 'color/fg', resolvedType: 'COLOR', description: '',
            codeSyntax: {}, valuesByMode: {
              light: { r: 0, g: 0, b: 0, a: 1 }, dark: { r: 1, g: 1, b: 1, a: 1 } } },
          { id: 'v3', name: 'space/md', resolvedType: 'FLOAT', description: '',
            codeSyntax: {}, valuesByMode: { light: 16, dark: 16 } },
        ],
      }],
      textStyles: [{
        name: 'Heading/H1', description: '', fontFamily: 'Inter', fontStyle: 'Bold',
        fontSize: 32, lineHeight: { unit: 'PERCENT', value: 120 },
        letterSpacing: { unit: 'PERCENT', value: 0 }, paragraphSpacing: 0,
        paragraphIndent: 0, textCase: 'ORIGINAL', textDecoration: 'NONE', boundVariables: {},
      }],
    };
  }

  function build(opts: {
    textStyles?: boolean; descriptions?: boolean; logo?: string | null;
  } = {}) {
    const spec = buildFoundation(dump());
    const units = planFoundationUnits(spec, {
      collections: opts.textStyles
        ? []
        : [{ collectionId: 'c1', modeIds: ['light', 'dark'] }],
      textStyles: opts.textStyles ?? false,
    });
    const unit = units[0];
    const content = unitContent(spec, unit.scope)!;
    return buildFoundationFrame(
      content, unit, theme, opts.descriptions ?? false, opts.logo,
    ) as unknown as Promise<FakeSection>;
  }

  /** The card is the Section's only child. */
  function cardOf(section: FakeSection): FakeFrame {
    return section.children[0] as unknown as FakeFrame;
  }

  it('opens with a header band painted in the theme header colour', async () => {
    const card = cardOf(await build());
    const band = card.children[0] as FakeFrame;
    expect(band.name).toBe('Header');
    // #123456 from the theme, not the default navy and not the card background.
    expect(band.fills).toEqual([{
      type: 'SOLID',
      color: { r: 0x12 / 255, g: 0x34 / 255, b: 0x56 / 255 },
    }]);
  });

  it('labels the band Foundations and titles it from the content', async () => {
    const card = cardOf(await build());
    const texts = card.textChars();
    expect(texts).toContain('FOUNDATIONS');
    expect(texts).toContain('Primitives');
  });

  it('titles the text-styles document from its scope, not a collection name', async () => {
    // content.collectionName is '' for this unit, so a title read straight off
    // the content would render a blank header.
    const card = cardOf(await build({ textStyles: true }));
    expect(card.textChars()).toContain('Text styles');
    expect(card.name).toBe('Text styles');
  });

  it('counts what the document covers in the subtitle', async () => {
    const card = cardOf(await build());
    expect(card.textChars()).toContain('3 variables across 2 modes');
  });

  it('stamps the captured logo into the header', async () => {
    const card = cardOf(await build({ logo: 'AAAA' }));
    const band = card.children[0] as FakeFrame;
    const row = band.children[0] as FakeFrame;
    const logo = row.children.find((k) => (k as Record<string, unknown>).type === 'RECTANGLE');
    expect(logo).toBeDefined();
  });

  it('renders without a logo when the user has not captured one', async () => {
    const card = cardOf(await build({ logo: null }));
    const band = card.children[0] as FakeFrame;
    // The eyebrow sits directly in the band, with no logo row around it.
    expect((band.children[0] as Record<string, unknown>).type).toBe('TEXT');
  });

  it('is one fixed-width card whose height hugs its rows', async () => {
    const card = cardOf(await build());
    expect(card.layoutSizingHorizontal).toBe('FIXED');
    // The bug this branch already fixed once, now at the card level: a FIXED
    // height here would clip the whole table rather than one row.
    expect(card.layoutSizingVertical).toBe('HUG');
    expect(card.height).toBeGreaterThan(1);
  });

  it('never renders narrower than a component doc frame', async () => {
    // Name (240) + two modes (360) + gaps is far short of 880 on its own; a card
    // that narrow cannot carry the header band's 38px title.
    const card = cardOf(await build());
    expect(card.width).toBe(880);
  });

  it('widens past the minimum when the table needs the room', async () => {
    const wide = cardWidth(tableColumns(
      { collectionName: 'C', modeNames: ['a', 'b', 'c', 'd'], omittedModeNames: [], rows: [] },
      false, true,
    ));
    // Name 240 + Description 220 + 4 x 180 = 1180, plus gaps and padding.
    expect(wide).toBeGreaterThan(880);
    const card = cardOf(await build());
    expect(card.width).toBeLessThan(wide);
  });

  it('stretches the header and the body to the card width', async () => {
    const card = cardOf(await build());
    const [band, body] = card.children as unknown as FakeFrame[];
    expect(band.layoutSizingHorizontal).toBe('FILL');
    expect(body.layoutSizingHorizontal).toBe('FILL');
  });

  it('wraps the rows in a bordered table, as the component tables are', async () => {
    const card = cardOf(await build());
    const table = card.findAllNamed('Table')[0];
    expect(table).toBeDefined();
    expect(table.strokeWeight).toBe(1);
    expect(table.clipsContent).toBe(true);
    // Header row plus one row per variable.
    expect(table.children).toHaveLength(4);
  });

  it('heads the mode columns with the mode names', async () => {
    const card = cardOf(await build());
    const texts = card.textChars();
    expect(texts).toContain('Name');
    expect(texts).toContain('Light');
    expect(texts).toContain('Dark');
  });

  it('omits the description column unless the user asked and a row has one', async () => {
    const off = cardOf(await build({ descriptions: false }));
    expect(off.textChars()).not.toContain('Description');
    const on = cardOf(await build({ descriptions: true }));
    expect(on.textChars()).toContain('Description');
    expect(on.textChars()).toContain('Page background');
  });

  it('names the Section for the document it holds', async () => {
    const section = await build();
    expect(section.name).toBe('Foundations: Primitives');
  });

  it('sizes the Section around the card', async () => {
    const section = await build();
    const card = cardOf(section);
    expect(section.width).toBe(card.width + 80);
    expect(section.height).toBe(card.height + 80);
  });
});

describe('headerSubtitle', () => {
  const base: FoundationUnitContent = {
    collectionName: 'P', modeNames: ['Value'], omittedModeNames: [], rows: [],
  };
  const rows = (n: number): FoundationUnitContent['rows'] =>
    Array.from({ length: n }, (_, i) => ({
      kind: 'variable' as const, name: `v${i}`, description: '', cells: [],
    }));

  it('counts variables and the modes they are shown in', () => {
    expect(headerSubtitle({ ...base, rows: rows(12), modeNames: ['L', 'D'] }, false))
      .toBe('12 variables across 2 modes');
  });

  it('says one variable and one mode in the singular', () => {
    expect(headerSubtitle({ ...base, rows: rows(1) }, false))
      .toBe('1 variable across 1 mode');
  });

  it('counts text styles, which have no modes', () => {
    expect(headerSubtitle({ ...base, rows: rows(8) }, true)).toBe('8 text styles');
    expect(headerSubtitle({ ...base, rows: rows(1) }, true)).toBe('1 text style');
  });

  it('states an empty document plainly rather than leaving the line blank', () => {
    expect(headerSubtitle(base, false)).toBe('0 variables across 1 mode');
  });

  it('contains no em dash', () => {
    expect(headerSubtitle({ ...base, rows: rows(3) }, false)).not.toContain('—');
  });
});

describe('tableColumns', () => {
  const content: FoundationUnitContent = {
    collectionName: 'P', modeNames: ['Light', 'Dark'], omittedModeNames: [], rows: [],
  };

  it('is Name plus one column per rendered mode', () => {
    expect(tableColumns(content, false, false).map((c) => c.label))
      .toEqual(['Name', 'Light', 'Dark']);
  });

  it('inserts Description between Name and the modes', () => {
    expect(tableColumns(content, false, true).map((c) => c.label))
      .toEqual(['Name', 'Description', 'Light', 'Dark']);
  });

  it('replaces the mode columns with one wide Specimen column for text styles', () => {
    const cols = tableColumns(content, true, false);
    expect(cols.map((c) => c.label)).toEqual(['Name', 'Specimen']);
    // The specimen needs the room two mode columns would have taken.
    expect(cols[1].width).toBe(360);
  });

  it('gives every column a positive width', () => {
    for (const col of tableColumns(content, false, true)) {
      expect(col.width).toBeGreaterThan(0);
    }
  });
});

describe('cardWidth', () => {
  const content = (modes: string[]): FoundationUnitContent => ({
    collectionName: 'P', modeNames: modes, omittedModeNames: [], rows: [],
  });

  /** Every shape a foundation table can take, widest last. */
  const shapes: [string, TableColumn[]][] = [
    ['one mode', tableColumns(content(['Value']), false, false)],
    ['one mode + descriptions', tableColumns(content(['Value']), false, true)],
    ['text styles', tableColumns(content([]), true, false)],
    ['text styles + descriptions', tableColumns(content([]), true, true)],
    ['four modes', tableColumns(content(['a', 'b', 'c', 'd']), false, false)],
    ['four modes + descriptions', tableColumns(content(['a', 'b', 'c', 'd']), false, true)],
  ];

  for (const [name, columns] of shapes) {
    it(`leaves room for the whole table: ${name}`, () => {
      // The card clips its contents, so anything wider than the space inside its
      // padding loses its right-hand column. This is the check that the row's own
      // padding is counted, which it originally was not.
      const inside = cardWidth(columns) - 56 * 2;
      expect(inside).toBeGreaterThanOrEqual(rowWidth(columns));
    });
  }

  it('never drops below the component frame width', () => {
    for (const [, columns] of shapes) {
      expect(cardWidth(columns)).toBeGreaterThanOrEqual(880);
    }
  });

  it('stays inside the component frame ceiling at its widest', () => {
    // The widest table possible is descriptions plus the four-mode cap. If this
    // ever exceeds 1440 the two frame families stop looking like a set.
    const widest = shapes[shapes.length - 1][1];
    expect(cardWidth(widest)).toBeLessThanOrEqual(1440);
  });

  it('counts the gaps between columns, not just the columns', () => {
    const one = tableColumns(content(['Value']), false, false);
    const two = tableColumns(content(['Value', 'Dark']), false, false);
    // Adding a 180px column costs 180 plus one 12px gap.
    expect(rowWidth(two) - rowWidth(one)).toBe(192);
  });
});
