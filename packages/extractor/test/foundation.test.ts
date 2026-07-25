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
