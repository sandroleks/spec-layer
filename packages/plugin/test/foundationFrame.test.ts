import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  valueLabel, swatchColorOf, footerNotes, cellText, swatchCell, headerCell,
} from '../src/foundationFrame';
import { hstack, vstack } from '../src/frameKit';
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

type SizeMode = 'FIXED' | 'AUTO';
type LayoutSizing = 'FIXED' | 'HUG';

const TEXT_H = 14;

/**
 * A minimal auto-layout frame that models the two things this bug turned on:
 * resize() fixing both axes, and layoutSizing{Horizontal,Vertical} being views
 * onto primary/counter that depend on layoutMode.
 */
class FakeFrame {
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' = 'NONE';
  primaryAxisSizingMode: SizeMode = 'AUTO';
  counterAxisSizingMode: SizeMode = 'AUTO';
  itemSpacing = 0;
  paddingTop = 0;
  paddingBottom = 0;
  children: { height: number }[] = [];
  fills: unknown = [];
  [k: string]: unknown;

  private fixedW = 0.01;
  private fixedH = 0.01;

  appendChild(n: { height?: number }): void {
    this.children.push({ height: n.height ?? TEXT_H });
  }

  /**
   * Figma's real behaviour: an explicit resize pins BOTH axes to FIXED. This is
   * the single most important line in the stub.
   */
  resize(w: number, h: number): void {
    this.fixedW = w;
    this.fixedH = h;
    this.primaryAxisSizingMode = 'FIXED';
    this.counterAxisSizingMode = 'FIXED';
  }

  /** Which sizing mode governs the horizontal axis, given the layout direction. */
  private get horizontalMode(): SizeMode {
    return this.layoutMode === 'VERTICAL' ? this.counterAxisSizingMode : this.primaryAxisSizingMode;
  }

  private get verticalMode(): SizeMode {
    return this.layoutMode === 'VERTICAL' ? this.primaryAxisSizingMode : this.counterAxisSizingMode;
  }

  private setAxis(axis: 'horizontal' | 'vertical', mode: SizeMode): void {
    const isPrimary = this.layoutMode === 'VERTICAL' ? axis === 'vertical' : axis === 'horizontal';
    if (isPrimary) this.primaryAxisSizingMode = mode;
    else this.counterAxisSizingMode = mode;
  }

  get layoutSizingHorizontal(): LayoutSizing {
    return this.horizontalMode === 'AUTO' ? 'HUG' : 'FIXED';
  }

  set layoutSizingHorizontal(v: LayoutSizing) {
    this.setAxis('horizontal', v === 'HUG' ? 'AUTO' : 'FIXED');
  }

  get layoutSizingVertical(): LayoutSizing {
    return this.verticalMode === 'AUTO' ? 'HUG' : 'FIXED';
  }

  set layoutSizingVertical(v: LayoutSizing) {
    this.setAxis('vertical', v === 'HUG' ? 'AUTO' : 'FIXED');
  }

  get width(): number {
    if (this.horizontalMode === 'FIXED') return this.fixedW;
    // A hugging width is not modelled: nothing here asserts on one, and
    // returning a made-up number would make a future test quietly meaningless.
    throw new Error('FakeFrame: hugging width is not modelled');
  }

  /** A hugging height is measured from the content, so a clipped row shows up. */
  get height(): number {
    if (this.verticalMode === 'FIXED') return this.fixedH;
    const content = this.layoutMode === 'VERTICAL'
      ? this.children.reduce((a, c) => a + c.height, 0)
        + Math.max(this.children.length - 1, 0) * this.itemSpacing
      : this.children.reduce((a, c) => Math.max(a, c.height), 0);
    return content + this.paddingTop + this.paddingBottom;
  }
}

function fakeRect(): Record<string, unknown> {
  const r: Record<string, unknown> = {
    width: 0, height: 0,
    resize(w: number, h: number) { r.width = w; r.height = h; },
  };
  return r;
}

function installFigma(): void {
  (globalThis as Record<string, unknown>).figma = {
    createFrame: () => new FakeFrame(),
    createText: () => ({ type: 'TEXT', height: TEXT_H }) as Record<string, unknown>,
    createRectangle: () => fakeRect(),
  };
}

describe('table cell sizing (row-clipping regression)', () => {
  beforeEach(installFigma);
  afterEach(() => { delete (globalThis as Record<string, unknown>).figma; });

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
