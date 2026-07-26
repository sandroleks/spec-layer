import { describe, it, expect } from 'vitest';
import { valueLabel, swatchColorOf, footerNotes } from '../src/foundationFrame';
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
