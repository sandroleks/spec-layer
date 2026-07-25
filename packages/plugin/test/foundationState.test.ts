import { describe, it, expect } from 'vitest';
import { buildFoundation, type SerializedFoundation } from '@spec-layer/extractor';
import {
  summarize, defaultSelection, toggleCollection, toggleMode, toggleTextStyles,
  emptyStateLines, canGenerate,
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
      }],
    });
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
