import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  valueLines, swatchColorOf, footerNotes, cellText, swatchCell, headerCell,
  buildFoundationFrame, headerSubtitle, tableColumns, cardWidth, rowWidth,
  rgbLabel, hslLabel, swatchValueLines, isColorRow, swatchRowWidth,
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

describe('valueLines', () => {
  it('labels a color as hex, adding alpha only when partial', () => {
    expect(valueLines({ kind: 'color', hex: '#2563eb', alpha: 1 }))
      .toEqual({ primary: '#2563EB', secondary: '' });
    expect(valueLines({ kind: 'color', hex: '#000000', alpha: 0.5 }))
      .toEqual({ primary: '#000000 50%', secondary: '' });
  });

  it('labels numbers without trailing zeros', () => {
    expect(valueLines({ kind: 'number', value: 16 }).primary).toBe('16');
    expect(valueLines({ kind: 'number', value: 1.5 }).primary).toBe('1.5');
  });

  it('labels strings and booleans', () => {
    expect(valueLines({ kind: 'string', value: 'Acme' }).primary).toBe('Acme');
    expect(valueLines({ kind: 'boolean', value: true }).primary).toBe('true');
  });

  it('labels an empty string variable as a stated fact, not a blank cell', () => {
    expect(valueLines({ kind: 'string', value: '' }).primary).toBe('(empty string)');
  });

  it('labels a non-empty string unchanged', () => {
    expect(valueLines({ kind: 'string', value: 'Acme Corp' }).primary).toBe('Acme Corp');
  });

  it('puts an alias target and its resolved value on separate lines', () => {
    // The whole point of the split: these two used to share one line as
    // "→ color/blue/500  #0000FF", which read as crowded and overflowed.
    const v: FoundationValue = {
      kind: 'alias', targetName: 'color/blue/500', targetCollection: 'Primitives',
      external: false, resolved: { kind: 'color', hex: '#0000ff', alpha: 1 },
    };
    expect(valueLines(v)).toEqual({ primary: '→ color/blue/500', secondary: '#0000FF' });
  });

  it('names a library reference as such, with no value invented for it', () => {
    const v: FoundationValue = {
      kind: 'alias', targetName: 'core/blue', targetCollection: 'Core Library',
      external: true, resolved: null,
    };
    expect(valueLines(v)).toEqual({ primary: '→ core/blue', secondary: 'library variable' });
  });

  it('leaves the second line empty for an unresolvable local alias', () => {
    const v: FoundationValue = {
      kind: 'alias', targetName: 'gone', targetCollection: 'P',
      external: false, resolved: null,
    };
    expect(valueLines(v)).toEqual({ primary: '→ gone', secondary: '' });
  });

  it('states every unresolved reason plainly', () => {
    expect(valueLines({ kind: 'unresolved', reason: 'cycle' }).primary)
      .toBe('not resolved: cycle');
    expect(valueLines({ kind: 'unresolved', reason: 'missing' }).primary)
      .toBe('not resolved: missing');
    expect(valueLines({ kind: 'unresolved', reason: 'depth' }).primary)
      .toBe('not resolved: depth');
    expect(valueLines({ kind: 'unresolved', reason: 'external' }).primary)
      .toBe('not resolved: external library variable');
  });

  it('carries a failed chain reason on the second line', () => {
    const v: FoundationValue = {
      kind: 'alias', targetName: 'a', targetCollection: 'P', external: false,
      resolved: { kind: 'unresolved', reason: 'cycle' },
    };
    expect(valueLines(v)).toEqual({ primary: '→ a', secondary: 'not resolved: cycle' });
  });

  it('degrades to a name if a resolved target is ever itself an alias', () => {
    // Resolution flattens chains, so this cannot happen today. It is here so
    // that a model change surfaces as a plain name rather than "[object Object]".
    const nested: FoundationValue = {
      kind: 'alias', targetName: 'outer', targetCollection: 'P', external: false,
      resolved: {
        kind: 'alias', targetName: 'inner', targetCollection: 'P',
        external: false, resolved: null,
      },
    };
    expect(valueLines(nested)).toEqual({ primary: '→ outer', secondary: '→ inner' });
  });

  it('never returns an empty primary line', () => {
    const values: FoundationValue[] = [
      { kind: 'color', hex: '#000000', alpha: 1 },
      { kind: 'string', value: '' },
      { kind: 'number', value: 0 },
      { kind: 'boolean', value: false },
      { kind: 'unresolved', reason: 'missing' },
      { kind: 'alias', targetName: 'a', targetCollection: 'P', external: true, resolved: null },
    ];
    // A blank cell reads as "this token has no value", which is never what any
    // of these mean.
    for (const v of values) expect(valueLines(v).primary).not.toBe('');
  });

  it('contains no em dash in any label', () => {
    const values: FoundationValue[] = [
      { kind: 'color', hex: '#000000', alpha: 0.5 },
      { kind: 'unresolved', reason: 'external' },
      { kind: 'alias', targetName: 'a', targetCollection: 'P', external: true, resolved: null },
    ];
    for (const v of values) {
      const { primary, secondary } = valueLines(v);
      expect(primary).not.toContain('—');
      expect(secondary).not.toContain('—');
    }
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

  // Direction matters to the assertions: width is the PRIMARY axis of a
  // horizontal frame and the COUNTER axis of a vertical one, which is exactly
  // the confusion that produced the one-pixel rows. Each builder therefore
  // declares the direction it uses.
  const builders: [string, 'HORIZONTAL' | 'VERTICAL', (w: number) => FakeFrame][] = [
    ['cellText', 'VERTICAL', (w) => cellText('spacing/md', w) as unknown as FakeFrame],
    ['cellText (muted)', 'VERTICAL', (w) => cellText('a description', w, true) as unknown as FakeFrame],
    ['swatchCell (color, with chip)', 'HORIZONTAL', (w) =>
      swatchCell({ kind: 'color', hex: '#2563eb', alpha: 1 }, w) as unknown as FakeFrame],
    ['swatchCell (number, no chip)', 'HORIZONTAL', (w) =>
      swatchCell({ kind: 'number', value: 16 }, w) as unknown as FakeFrame],
    ['swatchCell (unresolved)', 'HORIZONTAL', (w) =>
      swatchCell({ kind: 'unresolved', reason: 'cycle' }, w) as unknown as FakeFrame],
    ['headerCell', 'VERTICAL', (w) => headerCell('Name', w) as unknown as FakeFrame],
  ];

  for (const [name, dir, build] of builders) {
    describe(name, () => {
      const widthAxis = (c: FakeFrame) =>
        (dir === 'HORIZONTAL' ? c.primaryAxisSizingMode : c.counterAxisSizingMode);
      const heightAxis = (c: FakeFrame) =>
        (dir === 'HORIZONTAL' ? c.counterAxisSizingMode : c.primaryAxisSizingMode);

      it('is FIXED horizontally at the requested column width', () => {
        const cell = build(240);
        expect(cell.layoutSizingHorizontal).toBe('FIXED');
        expect(cell.width).toBe(240);
        // Stated on the underlying axis too, so a primary/counter mix-up fails.
        expect(widthAxis(cell)).toBe('FIXED');
      });

      it('HUGS vertically so the text is never clipped', () => {
        const cell = build(180);
        expect(cell.layoutSizingVertical).toBe('HUG');
        expect(heightAxis(cell)).toBe('AUTO');
      });

      it('is as tall as its content, not a one-pixel sliver', () => {
        const cell = build(180);
        expect(cell.height).toBeGreaterThan(1);
        expect(cell.height).toBeGreaterThanOrEqual(TEXT_H);
      });

      it('holds its content in an auto-layout frame', () => {
        const cell = build(180);
        expect(cell.layoutMode).toBe(dir);
        expect(cell.children.length).toBeGreaterThan(0);
      });

      it('lets its text wrap inside the column instead of running past it', () => {
        // The overflow fix. A Figma text node defaults to hugging BOTH axes, so
        // a FIXED-width cell does not constrain it: long content drew straight
        // over the next column. Every text node a cell owns has to FILL the
        // width and grow in height only.
        const cell = build(160);
        const texts: Record<string, unknown>[] = [];
        const walk = (f: FakeFrame) => {
          for (const child of f.children) {
            if (child instanceof FakeFrame) walk(child);
            else if ((child as Record<string, unknown>).type === 'TEXT') {
              texts.push(child as Record<string, unknown>);
            }
          }
        };
        walk(cell);
        expect(texts.length).toBeGreaterThan(0);
        for (const t of texts) {
          expect(t.layoutSizingHorizontal).toBe('FILL');
          expect(t.textAutoResize).toBe('HEIGHT');
        }
      });
    });
  }

  it('stacks an alias target over its resolved value', () => {
    const cell = swatchCell({
      kind: 'alias', targetName: 'colors/blue/500', targetCollection: 'P',
      external: false, resolved: { kind: 'color', hex: '#722ed1', alpha: 1 },
    }, 160) as unknown as FakeFrame;
    // chip + the two-line stack
    expect(cell.children).toHaveLength(2);
    expect(cell.textChars()).toEqual(['→ colors/blue/500', '#722ED1']);
  });

  it('gives a literal value a single line', () => {
    const cell = swatchCell({ kind: 'color', hex: '#722ed1', alpha: 1 }, 160) as unknown as FakeFrame;
    expect(cell.textChars()).toEqual(['#722ED1']);
  });

  it('top-aligns the swatch against the first line, not the midpoint', () => {
    const cell = swatchCell({ kind: 'color', hex: '#000000', alpha: 1 }, 160) as unknown as FakeFrame;
    expect(cell.counterAxisAlignItems).toBe('MIN');
  });

  it('sets the resolved value smaller than the name above it', () => {
    const cell = swatchCell({
      kind: 'alias', targetName: 'a', targetCollection: 'P',
      external: false, resolved: { kind: 'color', hex: '#000000', alpha: 1 },
    }, 160) as unknown as FakeFrame;
    const stack = cell.children.find((c) => c instanceof FakeFrame) as FakeFrame;
    const [primary, secondary] = stack.children as Record<string, unknown>[];
    expect(Number(secondary.fontSize)).toBeLessThan(Number(primary.fontSize));
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
    singleMode?: boolean;
  } = {}) {
    const spec = buildFoundation(dump());
    const units = planFoundationUnits(spec, {
      collections: opts.textStyles
        ? []
        : [{ collectionId: 'c1', modeIds: opts.singleMode ? ['light'] : ['light', 'dark'] }],
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

  it('wraps the non-colour rows in a bordered table, as the component tables are', async () => {
    const card = cardOf(await build());
    const table = card.findAllNamed('Table')[0];
    expect(table).toBeDefined();
    expect(table.strokeWeight).toBe(1);
    expect(table.clipsContent).toBe(true);
    // The fixture has two COLOR variables and one FLOAT, so the table holds its
    // header plus the FLOAT alone; the colours are in the swatch list.
    expect(table.children).toHaveLength(2);
  });

  it('sends colour variables to the swatch list, not the table', async () => {
    const card = cardOf(await build());
    const list = card.findAllNamed('Colors')[0];
    expect(list).toBeDefined();
    // The fixture has two modes, so a heading row plus color/bg and color/fg.
    expect(list.children).toHaveLength(3);
    expect(list.textChars()).toContain('color/bg');
    const table = card.findAllNamed('Table')[0];
    expect(table.textChars()).toContain('space/md');
    expect(table.textChars()).not.toContain('color/bg');
  });

  it('names each mode once in a heading row, not on every swatch', async () => {
    const card = cardOf(await build());
    const chars = card.findAllNamed('Colors')[0].textChars();
    // Two colour rows over two modes: four blocks. Labelling each would repeat
    // every mode name four times.
    expect(chars.filter((c) => c === 'Light')).toHaveLength(1);
    expect(chars.filter((c) => c === 'Dark')).toHaveLength(1);
  });

  it('gives a single-mode list no heading row at all', async () => {
    // Nothing to tell apart, and the reference layout has no header.
    const card = cardOf(await build({ singleMode: true }));
    const list = card.findAllNamed('Colors')[0];
    expect(list.children).toHaveLength(2); // the two colour rows only
  });

  it('labels both blocks when one frame holds colours and other values', async () => {
    const card = cardOf(await build());
    const texts = card.textChars();
    expect(texts).toContain('Colors');
    expect(texts).toContain('Other values');
  });

  it('labels nothing when a frame holds only one kind', async () => {
    // A text-styles frame is all table, so a heading would be labelling the
    // obvious.
    const card = cardOf(await build({ textStyles: true }));
    const texts = card.textChars();
    expect(texts).not.toContain('Colors');
    expect(texts).not.toContain('Other values');
  });

  it('heads the mode columns with the mode names', async () => {
    const card = cardOf(await build());
    const texts = card.textChars();
    expect(texts).toContain('Name');
    expect(texts).toContain('Light');
    expect(texts).toContain('Dark');
  });

  it('renders a colour description beside its swatch, with no table column', async () => {
    // The only described variable in the fixture is a colour, so its description
    // belongs in the swatch list. Adding a Description column to the table would
    // add a column of blanks, since the FLOAT row has none.
    const on = cardOf(await build({ descriptions: true }));
    expect(on.findAllNamed('Colors')[0].textChars()).toContain('Page background');
    expect(on.findAllNamed('Table')[0].textChars()).not.toContain('Description');
  });

  it('leaves a colour description out entirely when descriptions are off', async () => {
    const off = cardOf(await build({ descriptions: false }));
    expect(off.textChars()).not.toContain('Page background');
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
      kind: 'variable' as const, name: `v${i}`, description: '',
      resolvedType: 'FLOAT' as const, cells: [],
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
    expect(cols[1].width).toBe(320);
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
    // Adding a 160px column costs 160 plus one 12px gap.
    expect(rowWidth(two) - rowWidth(one)).toBe(172);
  });
});

// ---------------------------------------------------------------------------
// Colour formats.
//
// The expected strings below are read off the reference design this layout was
// asked to match, so they are an independent oracle rather than a copy of what
// this implementation happens to produce. hsl is easy to get subtly wrong;
// #032D60 -> hsl(212.9, 93.9%, 19.4%) pins hue, saturation and lightness at once.
// ---------------------------------------------------------------------------

describe('rgbLabel', () => {
  it('matches the reference values', () => {
    expect(rgbLabel('#FFFFFF', 1)).toBe('rgb(255, 255, 255)');
    expect(rgbLabel('#F3F3F3', 1)).toBe('rgb(243, 243, 243)');
    expect(rgbLabel('#032D60', 1)).toBe('rgb(3, 45, 96)');
    expect(rgbLabel('#03234D', 1)).toBe('rgb(3, 35, 77)');
  });

  it('accepts a hex with no leading hash', () => {
    expect(rgbLabel('032D60', 1)).toBe('rgb(3, 45, 96)');
  });

  it('switches to rgba for a partial alpha', () => {
    expect(rgbLabel('#000000', 0.5)).toBe('rgba(0, 0, 0, 50%)');
  });
});

describe('hslLabel', () => {
  it('matches the reference values', () => {
    expect(hslLabel('#FFFFFF', 1)).toBe('hsl(0, 0%, 100%)');
    expect(hslLabel('#F3F3F3', 1)).toBe('hsl(0, 0%, 95.3%)');
    expect(hslLabel('#032D60', 1)).toBe('hsl(212.9, 93.9%, 19.4%)');
    expect(hslLabel('#03234D', 1)).toBe('hsl(214.1, 92.5%, 15.7%)');
  });

  it('reports hue 0 for a grey rather than NaN', () => {
    // Hue is undefined when there is no chroma; 0 is the convention, and NaN
    // would render as literal "NaN" on the canvas.
    expect(hslLabel('#808080', 1)).toBe('hsl(0, 0%, 50.2%)');
    expect(hslLabel('#000000', 1)).toBe('hsl(0, 0%, 0%)');
  });

  it('finds the hue in each of the three sectors', () => {
    expect(hslLabel('#FF0000', 1)).toBe('hsl(0, 100%, 50%)');
    expect(hslLabel('#00FF00', 1)).toBe('hsl(120, 100%, 50%)');
    expect(hslLabel('#0000FF', 1)).toBe('hsl(240, 100%, 50%)');
  });

  it('never reports a negative hue', () => {
    // The red sector wraps through negative values before normalising, which is
    // the classic place this formula goes wrong.
    for (const h of ['#FF0080', '#FF00FF', '#FF0040']) {
      const label = hslLabel(h, 1);
      expect(label).not.toContain('-');
      const hue = Number(label.slice(4, label.indexOf(',')));
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it('drops a trailing .0 so values read as CSS is written', () => {
    expect(hslLabel('#FF0000', 1)).not.toContain('.0');
  });

  it('switches to hsla for a partial alpha', () => {
    expect(hslLabel('#FF0000', 0.25)).toBe('hsla(0, 100%, 50%, 25%)');
  });
});

describe('swatchValueLines', () => {
  it('gives a primitive all three notations', () => {
    expect(swatchValueLines({ kind: 'color', hex: '#032d60', alpha: 1 })).toEqual([
      '#032D60', 'rgb(3, 45, 96)', 'hsl(212.9, 93.9%, 19.4%)',
    ]);
  });

  it('gives an alias its target and the resolved hex, not the formats', () => {
    // The target is the fact a semantic collection exists to state, and the
    // primitive it points at carries the formats in its own frame.
    expect(swatchValueLines({
      kind: 'alias', targetName: 'colors/blue/500', targetCollection: 'P',
      external: false, resolved: { kind: 'color', hex: '#722ed1', alpha: 1 },
    })).toEqual(['→ colors/blue/500', '#722ED1']);
  });

  it('names a library target with no value invented for it', () => {
    expect(swatchValueLines({
      kind: 'alias', targetName: 'core/blue', targetCollection: 'Lib',
      external: true, resolved: null,
    })).toEqual(['→ core/blue', 'library variable']);
  });

  it('states an unresolved value plainly', () => {
    expect(swatchValueLines({ kind: 'unresolved', reason: 'cycle' }))
      .toEqual(['not resolved: cycle']);
  });

  it('never returns an empty line', () => {
    const values: FoundationValue[] = [
      { kind: 'color', hex: '#000000', alpha: 1 },
      { kind: 'unresolved', reason: 'missing' },
      { kind: 'alias', targetName: 'a', targetCollection: 'P', external: false, resolved: null },
    ];
    for (const v of values) {
      for (const line of swatchValueLines(v)) expect(line).not.toBe('');
    }
  });
});

describe('isColorRow', () => {
  const row = (resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN') => ({
    kind: 'variable' as const, name: 'n', description: '', resolvedType, cells: [],
  });

  it('claims colour variables', () => {
    expect(isColorRow(row('COLOR'))).toBe(true);
  });

  it('leaves numbers, strings and booleans to the table', () => {
    expect(isColorRow(row('FLOAT'))).toBe(false);
    expect(isColorRow(row('STRING'))).toBe(false);
    expect(isColorRow(row('BOOLEAN'))).toBe(false);
  });

  it('leaves text styles to the table', () => {
    expect(isColorRow({
      kind: 'textStyle', name: 'H1', description: '',
      metrics: { fontFamily: 'Inter', fontStyle: 'Bold', fontSize: 32, lineHeight: { unit: 'AUTO' } },
    })).toBe(false);
  });

  it('claims a colour that resolves to nothing at all', () => {
    // A colour aliased into a library has no local value, and inferring from the
    // value would drop a whole semantic collection into the numbers table.
    expect(isColorRow({
      kind: 'variable', name: 'bg', description: '', resolvedType: 'COLOR',
      cells: [{ modeName: 'Light', value: { kind: 'unresolved', reason: 'external' } }],
    })).toBe(true);
  });
});

describe('swatchRowWidth', () => {
  it('takes the reference shape for a single mode', () => {
    // swatch 44 + 16 + name 300 + 16 + values 210
    expect(swatchRowWidth(1)).toBe(586);
    expect(swatchRowWidth(0)).toBe(586);
  });

  it('grows by one block per extra mode', () => {
    // name 260 + n x (16 + 170)
    expect(swatchRowWidth(2)).toBe(260 + 2 * 186);
    expect(swatchRowWidth(4)).toBe(260 + 4 * 186);
    expect(swatchRowWidth(4) - swatchRowWidth(3)).toBe(186);
  });

  it('stays inside the component frame ceiling at the four-mode cap', () => {
    expect(swatchRowWidth(4) + 56 * 2).toBeLessThanOrEqual(1440);
  });
});
