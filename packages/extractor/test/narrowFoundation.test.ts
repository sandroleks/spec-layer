import { describe, it, expect } from 'vitest';
import {
  buildFoundation, narrowFoundation,
  type SerializedFoundation, type RawTextStyle,
} from '../src/foundation';

function textStyle(name: string): RawTextStyle {
  return {
    name, description: '', fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
    lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PIXELS', value: 0 },
    paragraphSpacing: 0, paragraphIndent: 0, textCase: 'ORIGINAL',
    textDecoration: 'NONE', boundVariables: {},
  };
}

/**
 * Two collections where Semantic aliases into Primitives, plus five modes on
 * Semantic (one more than MAX_MODE_COLUMNS) and two top-level groups. This is
 * the shape every narrowing rule is stated against.
 */
function dumpTwoCollections(): SerializedFoundation {
  return {
    fileKey: 'FILE1',
    extractedAt: '2026-08-24T00:00:00.000Z',
    externals: [],
    effectStyles: [],
    textStyles: [textStyle('heading/lg'), textStyle('body/md')],
    collections: [
      {
        id: 'prim', name: 'Primitives', defaultModeId: 'p1',
        modes: [{ modeId: 'p1', name: 'Value' }],
        variables: [
          { id: 'blue500', name: 'color/blue/500', resolvedType: 'COLOR',
            description: '', codeSyntax: {},
            valuesByMode: { p1: { r: 0, g: 0.5, b: 1, a: 1 } } },
        ],
      },
      {
        id: 'sem', name: 'Semantic', defaultModeId: 's1',
        modes: [
          { modeId: 's1', name: 'Light' }, { modeId: 's2', name: 'Dark' },
          { modeId: 's3', name: 'HC' }, { modeId: 's4', name: 'Print' },
          { modeId: 's5', name: 'BrandB' },
        ],
        variables: [
          { id: 'bg', name: 'color/bg/brand', resolvedType: 'COLOR',
            description: '', codeSyntax: {},
            valuesByMode: {
              s1: { type: 'VARIABLE_ALIAS', id: 'blue500' },
              s2: { type: 'VARIABLE_ALIAS', id: 'blue500' },
              s3: { type: 'VARIABLE_ALIAS', id: 'blue500' },
              s4: { type: 'VARIABLE_ALIAS', id: 'blue500' },
              s5: { type: 'VARIABLE_ALIAS', id: 'blue500' },
            } },
          { id: 'gap', name: 'space/gap', resolvedType: 'FLOAT',
            description: '', codeSyntax: {},
            valuesByMode: { s1: 8, s2: 8, s3: 8, s4: 8, s5: 8 } },
        ],
      },
    ],
  };
}

describe('narrowFoundation — collection target', () => {
  it('keeps only the named collection and drops every text style', () => {
    const spec = buildFoundation(dumpTwoCollections());
    const out = narrowFoundation(spec, { target: 'collection', collectionId: 'sem' });
    expect(out).not.toBeNull();
    expect(out!.collections.map((c) => c.name)).toEqual(['Semantic']);
    expect(out!.textStyles).toEqual([]);
  });

  it('keeps every mode and every group, ignoring the frame pagination limits', () => {
    const spec = buildFoundation(dumpTwoCollections());
    const out = narrowFoundation(spec, { target: 'collection', collectionId: 'sem' })!;
    // Five modes: one more than MAX_MODE_COLUMNS, which is a frame limit only.
    expect(out.collections[0].modes.map((m) => m.name))
      .toEqual(['Light', 'Dark', 'HC', 'Print', 'BrandB']);
    // Both groups: a split would have put these on separate rows.
    expect(out.collections[0].variables.map((v) => v.name))
      .toEqual(['color/bg/brand', 'space/gap']);
  });

  it('keeps aliases into a dropped collection resolvable', () => {
    const spec = buildFoundation(dumpTwoCollections());
    const beforeLegacy = structuredClone(spec.collections[1].variables[0].valuesByMode);
    const beforeProvenance = spec.collections[1].variables[0].provenance;
    const out = narrowFoundation(spec, { target: 'collection', collectionId: 'sem' })!;
    const value = out.collections[0].variables[0].valuesByMode.s1;
    expect(value.kind).toBe('alias');
    if (value.kind !== 'alias') throw new Error('expected an alias');
    expect(value.targetName).toBe('color/blue/500');
    expect(value.resolved).toEqual({ kind: 'color', hex: '#0080ff', alpha: 1 });
    expect(out.collections[0].variables[0].valuesByMode).toEqual(beforeLegacy);
    expect(out.collections[0].variables[0].provenance).toBe(beforeProvenance);
  });

  it('carries file identity through unchanged', () => {
    const spec = buildFoundation(dumpTwoCollections());
    const out = narrowFoundation(spec, { target: 'collection', collectionId: 'prim' })!;
    expect(out.fileKey).toBe('FILE1');
    expect(out.extractedAt).toBe('2026-08-24T00:00:00.000Z');
  });

  it('returns null for a collection that is no longer in the file', () => {
    const spec = buildFoundation(dumpTwoCollections());
    expect(narrowFoundation(spec, { target: 'collection', collectionId: 'gone' }))
      .toBeNull();
  });
});

describe('narrowFoundation — text styles target', () => {
  it('keeps every text style and drops every collection', () => {
    const spec = buildFoundation(dumpTwoCollections());
    const out = narrowFoundation(spec, { target: 'textStyles' })!;
    expect(out.collections).toEqual([]);
    expect(out.textStyles.map((t) => t.name)).toEqual(['heading/lg', 'body/md']);
  });

  it('returns null when the file has no text styles left', () => {
    const dump = dumpTwoCollections();
    dump.textStyles = [];
    const spec = buildFoundation(dump);
    expect(narrowFoundation(spec, { target: 'textStyles' })).toBeNull();
  });
});

describe('narrowFoundation — purity', () => {
  it('does not mutate the spec it was given', () => {
    const spec = buildFoundation(dumpTwoCollections());
    narrowFoundation(spec, { target: 'collection', collectionId: 'sem' });
    expect(spec.collections).toHaveLength(2);
    expect(spec.textStyles).toHaveLength(2);
  });
});

describe('narrowFoundation — narrowedTo', () => {
  it('records what a narrowed spec covers', () => {
    const spec = buildFoundation(dumpTwoCollections());
    const narrowed = narrowFoundation(spec, { target: 'collection', collectionId: 'sem' })!;
    // The distinction this exists for: a token absent from THIS spec because the
    // narrowing excluded its collection is not the same as one absent from the
    // file, and without this field a resolver cannot tell them apart.
    expect(narrowed.narrowedTo).toEqual({ target: 'collection', collectionId: 'sem' });
  });

  it('leaves a whole-file spec unnarrowed', () => {
    const spec = buildFoundation(dumpTwoCollections());
    // `in`, not an undefined comparison: `{ narrowedTo: undefined }` would still
    // read as "narrowed to nothing" for a consumer checking presence.
    expect('narrowedTo' in spec).toBe(false);
  });
});
