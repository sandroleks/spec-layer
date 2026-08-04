import { describe, it, expect } from 'vitest';
import {
  buildFoundation, SPLIT_THRESHOLD, type SerializedFoundation,
} from '@spec-layer/extractor';
import {
  summarize, defaultSelection, toggleCollection, toggleMode, toggleTextStyles,
  emptyStateLines, canGenerate,
  frameCount, framesPerSource, selectAll, clearAll, allSelected,
  fileSummary, collectionMeta, textStyleMeta, createButtonLabel,
  collectionIconKind,
} from '../src/ui/foundationState';

function dump(over: Partial<SerializedFoundation> = {}): SerializedFoundation {
  return {
    fileKey: 'FILE1', extractedAt: 'T', externals: [], textStyles: [],
    collections: [{
      id: 'c1', name: 'Semantic', defaultModeId: 's1',
      modes: [{ modeId: 's1', name: 'Light' }, { modeId: 's2', name: 'Dark' }],
      variables: [
        { id: 'bg', name: 'bg/brand', resolvedType: 'COLOR', description: '',
          codeSyntax: {}, valuesByMode: { s1: { r: 0, g: 0, b: 1, a: 1 }, s2: { r: 0, g: 0, b: 0, a: 1 } } },
      ],
    }],
    ...over,
  };
}

const bodyStyle = {
  name: 'Body/M', description: '', fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
  lineHeight: { unit: 'PIXELS' as const, value: 24 },
  letterSpacing: { unit: 'PERCENT' as const, value: 0 },
  paragraphSpacing: 0, paragraphIndent: 0, textCase: 'ORIGINAL', textDecoration: 'NONE',
  boundVariables: {},
};

describe('summarize', () => {
  it('counts collections, distinct mode count, variables, and text styles', () => {
    const spec = buildFoundation(dump({ textStyles: [bodyStyle] }));
    expect(summarize(spec)).toEqual({
      collectionCount: 1, maxModeCount: 2, variableCount: 1, textStyleCount: 1,
      collections: [{
        id: 'c1', name: 'Semantic', variableCount: 1,
        modes: [{ modeId: 's1', name: 'Light' }, { modeId: 's2', name: 'Dark' }],
        iconKind: 'color',
      }],
    });
  });
});

describe('collectionIconKind', () => {
  it('is color when every variable is COLOR', () => {
    const spec = buildFoundation(dump());
    expect(collectionIconKind(spec.collections[0])).toBe('color');
  });

  it('is dimension when every variable is FLOAT', () => {
    const spec = buildFoundation(dump({
      collections: [{
        id: 'c1', name: 'Spacing', defaultModeId: 's1',
        modes: [{ modeId: 's1', name: 'Default' }],
        variables: [
          { id: 'space-4', name: 'space/4', resolvedType: 'FLOAT', description: '',
            codeSyntax: {}, valuesByMode: { s1: 4 } },
          { id: 'space-8', name: 'space/8', resolvedType: 'FLOAT', description: '',
            codeSyntax: {}, valuesByMode: { s1: 8 } },
        ],
      }],
    }));
    expect(collectionIconKind(spec.collections[0])).toBe('dimension');
  });

  it('falls back to mixed rather than guess from a majority', () => {
    const spec = buildFoundation(dump({
      collections: [{
        id: 'c1', name: 'Foundation', defaultModeId: 's1',
        modes: [{ modeId: 's1', name: 'Default' }],
        variables: [
          { id: 'bg', name: 'bg/brand', resolvedType: 'COLOR', description: '',
            codeSyntax: {}, valuesByMode: { s1: { r: 0, g: 0, b: 1, a: 1 } } },
          { id: 'radius', name: 'radius/md', resolvedType: 'FLOAT', description: '',
            codeSyntax: {}, valuesByMode: { s1: 8 } },
        ],
      }],
    }));
    expect(collectionIconKind(spec.collections[0])).toBe('mixed');
  });

  it('falls back to mixed for an empty collection rather than crash', () => {
    const spec = buildFoundation(dump({
      collections: [{
        id: 'c1', name: 'Empty', defaultModeId: 's1',
        modes: [{ modeId: 's1', name: 'Default' }],
        variables: [],
      }],
    }));
    expect(collectionIconKind(spec.collections[0])).toBe('mixed');
  });
});

describe('defaultSelection', () => {
  it('selects every collection, capped modes, and text styles when present', () => {
    const spec = buildFoundation(dump({ textStyles: [bodyStyle] }));
    expect(defaultSelection(spec)).toEqual({
      collections: [{ collectionId: 'c1', modeIds: ['s1', 's2'] }],
      textStyles: true,
    });
  });

  it('caps default modes at MAX_MODE_COLUMNS', () => {
    const d = dump();
    d.collections[0].modes = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ modeId: `m${i}`, name }));
    const sel = defaultSelection(buildFoundation(d));
    expect(sel.collections[0].modeIds).toEqual(['m0', 'm1', 'm2', 'm3']);
  });

  it('leaves text styles off when the file has none', () => {
    expect(defaultSelection(buildFoundation(dump())).textStyles).toBe(false);
  });
});

describe('toggles', () => {
  it('removes and re-adds a collection with capped modes', () => {
    const spec = buildFoundation(dump());
    const off = toggleCollection(defaultSelection(spec), spec, 'c1', false);
    expect(off.collections).toEqual([]);
    const on = toggleCollection(off, spec, 'c1', true);
    expect(on.collections).toEqual([{ collectionId: 'c1', modeIds: ['s1', 's2'] }]);
  });

  it('unchecking a mode leaves the others', () => {
    const spec = buildFoundation(dump());
    const sel = toggleMode(defaultSelection(spec), spec, 'c1', 's2', false);
    expect(sel.collections[0].modeIds).toEqual(['s1']);
  });

  it('refuses to check a mode past the cap', () => {
    const d = dump();
    d.collections[0].modes = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ modeId: `m${i}`, name }));
    const spec = buildFoundation(d);
    const sel = toggleMode(defaultSelection(spec), spec, 'c1', 'm4', true);
    expect(sel.collections[0].modeIds).toEqual(['m0', 'm1', 'm2', 'm3']);
  });

  it('keeps mode order matching collection order, not click order', () => {
    const spec = buildFoundation(dump());
    let sel = toggleMode(defaultSelection(spec), spec, 'c1', 's1', false);
    sel = toggleMode(sel, spec, 'c1', 's1', true);
    expect(sel.collections[0].modeIds).toEqual(['s1', 's2']);
  });

  it('unchecking the last mode drops the collection from the selection', () => {
    const spec = buildFoundation(dump());
    let sel = toggleMode(defaultSelection(spec), spec, 'c1', 's1', false);
    sel = toggleMode(sel, spec, 'c1', 's2', false);
    expect(sel.collections).toEqual([]);
  });

  it('toggles text styles', () => {
    const spec = buildFoundation(dump({ textStyles: [bodyStyle] }));
    expect(toggleTextStyles(defaultSelection(spec), false).textStyles).toBe(false);
  });

  it('turning on a single mode for a not-yet-selected collection selects only that mode', () => {
    const d = dump();
    d.collections[0].modes = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ modeId: `m${i}`, name }));
    const spec = buildFoundation(d);
    // Start with the collection unselected entirely (not just a mode toggled off).
    const empty = toggleCollection(defaultSelection(spec), spec, 'c1', false);
    const sel = toggleMode(empty, spec, 'c1', 'm4', true);
    expect(sel.collections).toEqual([{ collectionId: 'c1', modeIds: ['m4'] }]);
  });

  it('turning on a mode for a not-yet-selected collection inserts it in spec order, not at the end', () => {
    const d = dump();
    d.collections = [
      { id: 'c1', name: 'A', defaultModeId: 's1', modes: [{ modeId: 's1', name: 'Light' }], variables: [] },
      { id: 'c2', name: 'B', defaultModeId: 's1', modes: [{ modeId: 's1', name: 'Light' }, { modeId: 's2', name: 'Dark' }], variables: [] },
      { id: 'c3', name: 'C', defaultModeId: 's1', modes: [{ modeId: 's1', name: 'Light' }], variables: [] },
    ];
    const spec = buildFoundation(d);
    // c2 starts out of the selection entirely (not just a mode toggled off).
    const withoutC2 = toggleCollection(defaultSelection(spec), spec, 'c2', false);
    const sel = toggleMode(withoutC2, spec, 'c2', 's2', true);
    expect(sel.collections).toEqual([
      { collectionId: 'c1', modeIds: ['s1'] },
      { collectionId: 'c2', modeIds: ['s2'] },
      { collectionId: 'c3', modeIds: ['s1'] },
    ]);
  });

  it('keeps collection order matching spec order, not click order', () => {
    const d = dump();
    d.collections = [
      { id: 'c1', name: 'A', defaultModeId: 's1', modes: [{ modeId: 's1', name: 'Light' }], variables: [] },
      { id: 'c2', name: 'B', defaultModeId: 's1', modes: [{ modeId: 's1', name: 'Light' }], variables: [] },
      { id: 'c3', name: 'C', defaultModeId: 's1', modes: [{ modeId: 's1', name: 'Light' }], variables: [] },
    ];
    const spec = buildFoundation(d);
    let sel = toggleCollection(defaultSelection(spec), spec, 'c2', false);
    sel = toggleCollection(sel, spec, 'c2', true);
    expect(sel.collections.map((c) => c.collectionId)).toEqual(['c1', 'c2', 'c3']);
  });
});

describe('canGenerate', () => {
  it('is false with nothing selected and true with anything selected', () => {
    expect(canGenerate({ collections: [], textStyles: false })).toBe(false);
    expect(canGenerate({ collections: [], textStyles: true })).toBe(true);
    expect(canGenerate({ collections: [{ collectionId: 'c1', modeIds: ['s1'] }], textStyles: false }))
      .toBe(true);
  });
});

describe('emptyStateLines', () => {
  it('reports a file with neither', () => {
    expect(emptyStateLines(buildFoundation(dump({ collections: [] }))))
      .toEqual(['This file has no local variable collections or text styles.']);
  });

  it('reports text styles only', () => {
    expect(emptyStateLines(buildFoundation(dump({ collections: [], textStyles: [bodyStyle] }))))
      .toEqual(['This file has no local variable collections.']);
  });

  it('reports collections only', () => {
    expect(emptyStateLines(buildFoundation(dump())))
      .toEqual(['This file has no local text styles.']);
  });

  it('warns when no collection holds a color variable', () => {
    const d = dump({ textStyles: [bodyStyle] });
    d.collections[0].variables[0] = {
      id: 'x', name: 'space/4', resolvedType: 'FLOAT', description: '',
      codeSyntax: {}, valuesByMode: { s1: 16, s2: 16 },
    };
    expect(emptyStateLines(buildFoundation(d)))
      .toEqual(['No color variables found, so the docs will have no swatches.']);
  });

  it('says nothing when the file has both, including color', () => {
    expect(emptyStateLines(buildFoundation(dump({ textStyles: [bodyStyle] })))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Frame counts. A large collection splits into one frame per top-level group,
// so a two-row selection can produce five frames. The tab had no way to say so.
// ---------------------------------------------------------------------------

/** A collection of `count` variables spread over `groups`, plus `styles` styles. */
function bigDump(count: number, groups: string[], styles = 0): SerializedFoundation {
  return {
    fileKey: 'FILE1', extractedAt: 'T', externals: [],
    collections: [{
      id: 'big', name: 'Primitives', defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Value' }],
      variables: Array.from({ length: count }, (_, i) => ({
        id: `v${i}`, name: `${groups[i % groups.length]}/t${i}`,
        resolvedType: 'COLOR' as const, description: '', codeSyntax: {},
        valuesByMode: { m1: { r: 0, g: 0, b: 0, a: 1 } },
      })),
    }],
    textStyles: Array.from({ length: styles }, (_, i) => ({ ...bodyStyle, name: `Body/${i}` })),
  };
}

describe('frameCount', () => {
  it('counts one frame for a small collection', () => {
    const spec = buildFoundation(dump());
    expect(frameCount(spec, defaultSelection(spec))).toBe(1);
  });

  it('counts every part of a split collection', () => {
    // 152 variables over two groups is past the split threshold, so two frames.
    const spec = buildFoundation(bigDump(SPLIT_THRESHOLD + 2, ['color', 'space']));
    expect(frameCount(spec, defaultSelection(spec))).toBe(2);
  });

  it('adds the text-styles frame', () => {
    const spec = buildFoundation(bigDump(SPLIT_THRESHOLD + 2, ['color', 'space'], 3));
    expect(frameCount(spec, defaultSelection(spec))).toBe(3);
  });

  it('is zero when nothing is selected', () => {
    const spec = buildFoundation(dump({ textStyles: [bodyStyle] }));
    expect(frameCount(spec, clearAll())).toBe(0);
  });

  it('drops a deselected collection from the count', () => {
    const spec = buildFoundation(bigDump(SPLIT_THRESHOLD + 2, ['color', 'space'], 3));
    const sel = toggleCollection(defaultSelection(spec), spec, 'big', false);
    expect(frameCount(spec, sel)).toBe(1); // text styles only
  });
});

describe('framesPerSource', () => {
  it('reports each source, whether or not it is selected', () => {
    const spec = buildFoundation(bigDump(SPLIT_THRESHOLD + 3, ['color', 'space', 'radius'], 2));
    expect(framesPerSource(spec)).toEqual({ collections: { big: 3 }, textStyles: 1 });
  });

  it('reports one frame for an unsplit collection', () => {
    const spec = buildFoundation(dump());
    expect(framesPerSource(spec)).toEqual({ collections: { c1: 1 }, textStyles: 0 });
  });

  it('is independent of which modes are chosen', () => {
    // Splitting turns on variable count and name groups only, so a row's count
    // must not move when the user swaps a mode column.
    const spec = buildFoundation(bigDump(SPLIT_THRESHOLD + 2, ['color', 'space']));
    const before = framesPerSource(spec);
    toggleMode(defaultSelection(spec), spec, 'big', 'm1', false);
    expect(framesPerSource(spec)).toEqual(before);
  });
});

describe('select all / clear all', () => {
  it('round-trips through clear and back', () => {
    const spec = buildFoundation(dump({ textStyles: [bodyStyle] }));
    const all = selectAll(spec);
    expect(allSelected(spec, all)).toBe(true);
    expect(allSelected(spec, clearAll())).toBe(false);
    expect(selectAll(spec)).toEqual(defaultSelection(spec));
  });

  it('counts a collection as selected even with a subset of its modes', () => {
    // Four columns is all a frame can show, so a capped collection is fully
    // selected; the link would otherwise read "Select all" with everything on.
    const spec = buildFoundation(dump({ textStyles: [bodyStyle] }));
    const sel = toggleMode(selectAll(spec), spec, 'c1', 's2', false);
    expect(allSelected(spec, sel)).toBe(true);
  });

  it('is not all-selected while one collection is off', () => {
    const spec = buildFoundation(dump({ textStyles: [bodyStyle] }));
    expect(allSelected(spec, toggleCollection(selectAll(spec), spec, 'c1', false))).toBe(false);
  });

  it('is not all-selected while text styles are off', () => {
    const spec = buildFoundation(dump({ textStyles: [bodyStyle] }));
    expect(allSelected(spec, toggleTextStyles(selectAll(spec), false))).toBe(false);
  });

  it('ignores text styles a file does not have', () => {
    // Otherwise the link reads "Select all" forever on a file with no styles.
    const spec = buildFoundation(dump());
    expect(allSelected(spec, selectAll(spec))).toBe(true);
  });
});

describe('panel copy', () => {
  it('summarizes a file holding both kinds of source', () => {
    const spec = buildFoundation(dump({ textStyles: [bodyStyle, bodyStyle] }));
    expect(fileSummary(summarize(spec)))
      .toBe('This file has 1 variable collection and 2 text styles.');
  });

  it('names only what the file actually has', () => {
    const noStyles = buildFoundation(dump());
    expect(fileSummary(summarize(noStyles))).toBe('This file has 1 variable collection.');

    const noCollections = buildFoundation(
      dump({ collections: [], textStyles: [bodyStyle] }));
    expect(fileSummary(summarize(noCollections))).toBe('This file has 1 text style.');
  });

  it('says so plainly when there is nothing at all', () => {
    const empty = buildFoundation(dump({ collections: [], textStyles: [] }));
    expect(fileSummary(summarize(empty))).toBe('Nothing to document in this file yet.');
  });

  it('mentions a split in the row meta, and stays quiet about one frame', () => {
    const c = { id: 'x', name: 'P', variableCount: 170, modes: [{ modeId: 'm', name: 'V' }], iconKind: 'mixed' as const };
    expect(collectionMeta(c, 3)).toBe('170 variables · 1 mode · + 3 frames');
    expect(collectionMeta(c, 1)).toBe('170 variables · 1 mode');
  });

  it('uses the singular for a one-variable, one-mode collection', () => {
    const c = { id: 'x', name: 'P', variableCount: 1, modes: [{ modeId: 'm', name: 'V' }], iconKind: 'mixed' as const };
    expect(collectionMeta(c, 1)).toBe('1 variable · 1 mode');
  });

  it('describes the text-styles row', () => {
    expect(textStyleMeta(5, 1)).toBe('5 styles');
    expect(textStyleMeta(1, 1)).toBe('1 style');
    expect(textStyleMeta(200, 2)).toBe('200 styles · + 2 frames');
  });

  it('names the frame count on the button, singular included', () => {
    expect(createButtonLabel(5)).toBe('Create 5 frames');
    expect(createButtonLabel(1)).toBe('Create 1 frame');
  });

  it('falls back to a neutral button label when nothing is selected', () => {
    // The disabled button still has to read as a sentence, not "Create 0 frames".
    expect(createButtonLabel(0)).toBe('Create foundation frames');
  });

  it('contains no em dash anywhere in the panel copy', () => {
    const spec = buildFoundation(dump({ textStyles: [bodyStyle] }));
    const c = { id: 'x', name: 'P', variableCount: 9, modes: [{ modeId: 'm', name: 'V' }], iconKind: 'mixed' as const };
    const strings = [
      fileSummary(summarize(spec)),
      collectionMeta(c, 3),
      textStyleMeta(4, 2),
      createButtonLabel(3),
      createButtonLabel(0),
    ];
    for (const s of strings) expect(s).not.toContain('—');
  });
});
