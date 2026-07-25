import { describe, it, expect } from 'vitest';
import { buildFoundation, groupOf, type SerializedFoundation } from '../src/foundation';

/** Minimal dump with one single-mode collection holding one variable per type. */
function dumpOneOfEach(): SerializedFoundation {
  return {
    fileKey: 'FILE1',
    extractedAt: '2026-07-25T00:00:00.000Z',
    externals: [],
    textStyles: [],
    collections: [{
      id: 'c1',
      name: 'Primitives',
      defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Value' }],
      variables: [
        { id: 'v1', name: 'color/blue/500', resolvedType: 'COLOR', description: 'Brand blue.',
          codeSyntax: { WEB: '--blue-500' },
          valuesByMode: { m1: { r: 0.145, g: 0.388, b: 0.921, a: 1 } } },
        { id: 'v2', name: 'space/4', resolvedType: 'FLOAT', description: '',
          codeSyntax: {}, valuesByMode: { m1: 16 } },
        { id: 'v3', name: 'brand/name', resolvedType: 'STRING', description: '',
          codeSyntax: {}, valuesByMode: { m1: 'Acme' } },
        { id: 'v4', name: 'flags/beta', resolvedType: 'BOOLEAN', description: '',
          codeSyntax: {}, valuesByMode: { m1: true } },
        { id: 'v5', name: 'standalone', resolvedType: 'FLOAT', description: '',
          codeSyntax: {}, valuesByMode: { m1: 2 } },
      ],
    }],
  };
}

describe('groupOf', () => {
  it('takes the segment before the first slash', () => {
    expect(groupOf('color/bg/brand')).toBe('color');
  });
  it('returns the whole name when there is no slash', () => {
    expect(groupOf('standalone')).toBe('standalone');
  });
  it('handles a leading slash without producing an empty group', () => {
    expect(groupOf('/odd')).toBe('/odd');
  });
});

describe('buildFoundation — non-alias values', () => {
  it('carries file identity and collection shape through', () => {
    const spec = buildFoundation(dumpOneOfEach());
    expect(spec.fileKey).toBe('FILE1');
    expect(spec.extractedAt).toBe('2026-07-25T00:00:00.000Z');
    expect(spec.collections).toHaveLength(1);
    expect(spec.collections[0].name).toBe('Primitives');
    expect(spec.collections[0].modes).toEqual([{ modeId: 'm1', name: 'Value' }]);
    expect(spec.collections[0].defaultModeId).toBe('m1');
  });

  it('converts a color to hex plus alpha', () => {
    const spec = buildFoundation(dumpOneOfEach());
    const v = spec.collections[0].variables[0];
    expect(v.name).toBe('color/blue/500');
    expect(v.group).toBe('color');
    expect(v.description).toBe('Brand blue.');
    expect(v.codeSyntax).toEqual({ WEB: '--blue-500' });
    expect(v.valuesByMode.m1).toEqual({ kind: 'color', hex: '#2563eb', alpha: 1 });
  });

  it('preserves fractional alpha', () => {
    const dump = dumpOneOfEach();
    dump.collections[0].variables[0].valuesByMode.m1 = { r: 0, g: 0, b: 0, a: 0.5 };
    const spec = buildFoundation(dump);
    expect(spec.collections[0].variables[0].valuesByMode.m1)
      .toEqual({ kind: 'color', hex: '#000000', alpha: 0.5 });
  });

  it('converts number, string, and boolean values', () => {
    const spec = buildFoundation(dumpOneOfEach());
    const [, num, str, bool] = spec.collections[0].variables;
    expect(num.valuesByMode.m1).toEqual({ kind: 'number', value: 16 });
    expect(str.valuesByMode.m1).toEqual({ kind: 'string', value: 'Acme' });
    expect(bool.valuesByMode.m1).toEqual({ kind: 'boolean', value: true });
  });

  it('derives group for a name with no slash', () => {
    const spec = buildFoundation(dumpOneOfEach());
    expect(spec.collections[0].variables[4].group).toBe('standalone');
  });

  it('marks a mode with no value as missing rather than dropping the row', () => {
    const dump = dumpOneOfEach();
    dump.collections[0].modes.push({ modeId: 'm2', name: 'Other' });
    const spec = buildFoundation(dump);
    expect(spec.collections[0].variables[1].valuesByMode.m2)
      .toEqual({ kind: 'unresolved', reason: 'missing' });
  });

  it('builds text styles with group and full metrics', () => {
    const dump = dumpOneOfEach();
    dump.textStyles = [{
      name: 'Heading/XL', description: 'Page titles.',
      fontFamily: 'Inter', fontStyle: 'Bold', fontSize: 32,
      lineHeight: { unit: 'PIXELS', value: 40 },
      letterSpacing: { unit: 'PERCENT', value: -2 },
      paragraphSpacing: 0, paragraphIndent: 0,
      textCase: 'ORIGINAL', textDecoration: 'NONE',
      boundVariables: { fontSize: 'type/size/xl' },
    }];
    const spec = buildFoundation(dump);
    expect(spec.textStyles).toHaveLength(1);
    expect(spec.textStyles[0].group).toBe('Heading');
    expect(spec.textStyles[0].fontSize).toBe(32);
    expect(spec.textStyles[0].lineHeight).toEqual({ unit: 'PIXELS', value: 40 });
    expect(spec.textStyles[0].boundVariables).toEqual({ fontSize: 'type/size/xl' });
  });
});

/** Two collections: Primitives (single mode) and Semantic (Light/Dark) aliasing it. */
function dumpWithAliases(): SerializedFoundation {
  return {
    fileKey: 'FILE1',
    extractedAt: '2026-07-25T00:00:00.000Z',
    externals: [],
    textStyles: [],
    collections: [
      {
        id: 'c1', name: 'Primitives', defaultModeId: 'p1',
        modes: [{ modeId: 'p1', name: 'Value' }],
        variables: [
          { id: 'blue', name: 'color/blue/500', resolvedType: 'COLOR', description: '',
            codeSyntax: {}, valuesByMode: { p1: { r: 0, g: 0, b: 1, a: 1 } } },
          { id: 'navy', name: 'color/navy/900', resolvedType: 'COLOR', description: '',
            codeSyntax: {}, valuesByMode: { p1: { r: 0, g: 0, b: 0.2, a: 1 } } },
        ],
      },
      {
        id: 'c2', name: 'Semantic', defaultModeId: 's1',
        modes: [{ modeId: 's1', name: 'Light' }, { modeId: 's2', name: 'Dark' }],
        variables: [
          { id: 'bg', name: 'bg/brand', resolvedType: 'COLOR', description: '',
            codeSyntax: {}, valuesByMode: {
              s1: { type: 'VARIABLE_ALIAS', id: 'blue' },
              s2: { type: 'VARIABLE_ALIAS', id: 'navy' },
            } },
        ],
      },
    ],
  };
}

describe('buildFoundation — alias resolution', () => {
  it('resolves an alias to its target name, collection, and value', () => {
    const spec = buildFoundation(dumpWithAliases());
    const bg = spec.collections[1].variables[0];
    expect(bg.valuesByMode.s1).toEqual({
      kind: 'alias', targetName: 'color/blue/500', targetCollection: 'Primitives',
      external: false, resolved: { kind: 'color', hex: '#0000ff', alpha: 1 },
    });
  });

  it('follows a different target per mode', () => {
    const spec = buildFoundation(dumpWithAliases());
    const bg = spec.collections[1].variables[0];
    expect(bg.valuesByMode.s2).toMatchObject({ targetName: 'color/navy/900' });
  });

  it('prefers the target mode whose name matches the source mode name', () => {
    const dump = dumpWithAliases();
    // Give Primitives its own Light/Dark so name matching has something to do.
    dump.collections[0].modes = [{ modeId: 'p1', name: 'Light' }, { modeId: 'p2', name: 'Dark' }];
    dump.collections[0].variables[0].valuesByMode = {
      p1: { r: 0, g: 0, b: 1, a: 1 },
      p2: { r: 1, g: 1, b: 1, a: 1 },
    };
    dump.collections[1].variables[0].valuesByMode.s2 = { type: 'VARIABLE_ALIAS', id: 'blue' };
    const spec = buildFoundation(dump);
    const bg = spec.collections[1].variables[0];
    // Light → Light (#0000ff), Dark → Dark (#ffffff)
    expect(bg.valuesByMode.s1).toMatchObject({ resolved: { kind: 'color', hex: '#0000ff', alpha: 1 } });
    expect(bg.valuesByMode.s2).toMatchObject({ resolved: { kind: 'color', hex: '#ffffff', alpha: 1 } });
  });

  it('falls back to the target default mode when no name matches', () => {
    const spec = buildFoundation(dumpWithAliases());
    // Primitives has only "Value"; Semantic modes are Light/Dark. Default used.
    expect(spec.collections[1].variables[0].valuesByMode.s1)
      .toMatchObject({ resolved: { kind: 'color', hex: '#0000ff', alpha: 1 } });
  });

  it('follows a chain of three hops', () => {
    const dump = dumpWithAliases();
    dump.collections[0].variables.push(
      { id: 'mid', name: 'color/mid', resolvedType: 'COLOR', description: '',
        codeSyntax: {}, valuesByMode: { p1: { type: 'VARIABLE_ALIAS', id: 'blue' } } },
    );
    dump.collections[1].variables[0].valuesByMode.s1 = { type: 'VARIABLE_ALIAS', id: 'mid' };
    const spec = buildFoundation(dump);
    expect(spec.collections[1].variables[0].valuesByMode.s1).toEqual({
      kind: 'alias', targetName: 'color/mid', targetCollection: 'Primitives',
      external: false, resolved: { kind: 'color', hex: '#0000ff', alpha: 1 },
    });
  });

  it('reports a cycle instead of looping forever', () => {
    const dump = dumpWithAliases();
    dump.collections[0].variables[0].valuesByMode.p1 = { type: 'VARIABLE_ALIAS', id: 'navy' };
    dump.collections[0].variables[1].valuesByMode.p1 = { type: 'VARIABLE_ALIAS', id: 'blue' };
    const spec = buildFoundation(dump);
    expect(spec.collections[0].variables[0].valuesByMode.p1)
      .toMatchObject({ kind: 'alias', resolved: { kind: 'unresolved', reason: 'cycle' } });
  });

  it('reports depth overflow past four hops', () => {
    const dump = dumpWithAliases();
    // a → b → c → d → e → value: five hops, over MAX_ALIAS_DEPTH of 4.
    dump.collections[0].variables = [
      { id: 'a', name: 'a', resolvedType: 'COLOR', description: '', codeSyntax: {},
        valuesByMode: { p1: { type: 'VARIABLE_ALIAS', id: 'b' } } },
      { id: 'b', name: 'b', resolvedType: 'COLOR', description: '', codeSyntax: {},
        valuesByMode: { p1: { type: 'VARIABLE_ALIAS', id: 'c' } } },
      { id: 'c', name: 'c', resolvedType: 'COLOR', description: '', codeSyntax: {},
        valuesByMode: { p1: { type: 'VARIABLE_ALIAS', id: 'd' } } },
      { id: 'd', name: 'd', resolvedType: 'COLOR', description: '', codeSyntax: {},
        valuesByMode: { p1: { type: 'VARIABLE_ALIAS', id: 'e' } } },
      { id: 'e', name: 'e', resolvedType: 'COLOR', description: '', codeSyntax: {},
        valuesByMode: { p1: { r: 1, g: 0, b: 0, a: 1 } } },
    ];
    dump.collections[1].variables[0].valuesByMode.s1 = { type: 'VARIABLE_ALIAS', id: 'a' };
    const spec = buildFoundation(dump);
    const value = spec.collections[1].variables[0].valuesByMode.s1;
    expect(value).toMatchObject({ kind: 'alias', targetName: 'a' });
    expect(JSON.stringify(value)).toContain('"reason":"depth"');
  });

  it('marks a library target as external with a real name and no value', () => {
    const dump = dumpWithAliases();
    dump.externals = [{ id: 'lib1', name: 'core/blue/500', collectionName: 'Core Library' }];
    dump.collections[1].variables[0].valuesByMode.s1 = { type: 'VARIABLE_ALIAS', id: 'lib1' };
    const spec = buildFoundation(dump);
    expect(spec.collections[1].variables[0].valuesByMode.s1).toEqual({
      kind: 'alias', targetName: 'core/blue/500', targetCollection: 'Core Library',
      external: true, resolved: null,
    });
  });

  it('reports a dangling target as missing', () => {
    const dump = dumpWithAliases();
    dump.collections[1].variables[0].valuesByMode.s1 = { type: 'VARIABLE_ALIAS', id: 'ghost' };
    const spec = buildFoundation(dump);
    expect(spec.collections[1].variables[0].valuesByMode.s1)
      .toEqual({ kind: 'unresolved', reason: 'missing' });
  });
});
