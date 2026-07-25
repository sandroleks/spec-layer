import { describe, it, expect } from 'vitest';
import { serializeFoundation, type FoundationReader, type ReaderVariable } from '../src/serializeFoundation';

function fakeReader(over: Partial<FoundationReader> = {}): FoundationReader {
  const vars: Record<string, ReaderVariable> = {
    v1: {
      id: 'v1', name: 'color/blue/500', resolvedType: 'COLOR', description: 'Blue.',
      variableCollectionId: 'c1', codeSyntax: { WEB: '--blue' },
      valuesByMode: { m1: { r: 0, g: 0, b: 1, a: 1 } },
    },
    v2: {
      id: 'v2', name: 'bg/brand', resolvedType: 'COLOR', description: '',
      variableCollectionId: 'c1', codeSyntax: {},
      valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'v1' } },
    },
  };
  return {
    async collections() {
      return [{
        id: 'c1', name: 'Primitives',
        modes: [{ modeId: 'm1', name: 'Value' }],
        defaultModeId: 'm1',
        variableIds: ['v1', 'v2'],
      }];
    },
    async variable(id) { return vars[id] ?? null; },
    async textStyles() {
      return [{
        name: 'Body/M', description: 'Body.',
        fontName: { family: 'Inter', style: 'Regular' }, fontSize: 16,
        lineHeight: { unit: 'PIXELS', value: 24 },
        letterSpacing: { unit: 'PERCENT', value: 0 },
        paragraphSpacing: 0, paragraphIndent: 0,
        textCase: 'ORIGINAL', textDecoration: 'NONE',
        boundVariables: { fontSize: { id: 'v1' } },
      }];
    },
    ...over,
  };
}

describe('serializeFoundation', () => {
  it('dumps collections, variables, and text styles', async () => {
    const dump = await serializeFoundation(fakeReader(), 'FILE1', '2026-07-25T00:00:00.000Z');
    expect(dump.fileKey).toBe('FILE1');
    expect(dump.extractedAt).toBe('2026-07-25T00:00:00.000Z');
    expect(dump.collections).toHaveLength(1);
    expect(dump.collections[0].variables.map((v) => v.name))
      .toEqual(['color/blue/500', 'bg/brand']);
    expect(dump.collections[0].variables[0].codeSyntax).toEqual({ WEB: '--blue' });
    expect(dump.textStyles[0]).toMatchObject({
      name: 'Body/M', fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
    });
  });

  it('resolves a text style bound variable id to its name', async () => {
    const dump = await serializeFoundation(fakeReader(), 'FILE1', 'T');
    expect(dump.textStyles[0].boundVariables).toEqual({ fontSize: 'color/blue/500' });
  });

  it('keeps aliases raw for the extractor to resolve', async () => {
    const dump = await serializeFoundation(fakeReader(), 'FILE1', 'T');
    expect(dump.collections[0].variables[1].valuesByMode.m1)
      .toEqual({ type: 'VARIABLE_ALIAS', id: 'v1' });
  });

  it('records an alias target that is not local as an external ref', async () => {
    const reader = fakeReader({
      async variable(id: string): Promise<ReaderVariable | null> {
        if (id === 'v1') {
          return {
            id: 'v1', name: 'x', resolvedType: 'COLOR', description: '',
            variableCollectionId: 'c1', codeSyntax: {},
            valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'remote' } },
          };
        }
        if (id === 'v2') return null;
        if (id === 'remote') {
          return {
            id: 'remote', name: 'core/blue', resolvedType: 'COLOR', description: '',
            variableCollectionId: 'remoteColl', codeSyntax: {}, valuesByMode: {},
          };
        }
        return null;
      },
      async collectionName(id) { return id === 'remoteColl' ? 'Core Library' : null; },
    });
    const dump = await serializeFoundation(reader, 'FILE1', 'T');
    expect(dump.externals).toEqual([
      { id: 'remote', name: 'core/blue', collectionName: 'Core Library' },
    ]);
  });

  it('does not list a local variable as external', async () => {
    const dump = await serializeFoundation(fakeReader(), 'FILE1', 'T');
    expect(dump.externals).toEqual([]);
  });

  it('skips variable ids the reader cannot resolve instead of throwing', async () => {
    const reader = fakeReader({ async variable() { return null; } });
    const dump = await serializeFoundation(reader, 'FILE1', 'T');
    expect(dump.collections[0].variables).toEqual([]);
  });

  it('returns an empty dump when the variables API is unavailable', async () => {
    const reader = fakeReader({
      async collections() { throw new Error('no variables API'); },
      async textStyles() { throw new Error('no styles API'); },
    });
    const dump = await serializeFoundation(reader, 'FILE1', 'T');
    expect(dump.collections).toEqual([]);
    expect(dump.textStyles).toEqual([]);
  });

  it('falls back to an empty string for an unnamed external collection', async () => {
    const reader = fakeReader({
      async variable(id: string): Promise<ReaderVariable | null> {
        if (id === 'v1') {
          return {
            id: 'v1', name: 'x', resolvedType: 'COLOR', description: '',
            variableCollectionId: 'c1', codeSyntax: {},
            valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'remote' } },
          };
        }
        if (id === 'remote') {
          return {
            id: 'remote', name: 'core/blue', resolvedType: 'COLOR', description: '',
            variableCollectionId: 'gone', codeSyntax: {}, valuesByMode: {},
          };
        }
        return null;
      },
    });
    const dump = await serializeFoundation(reader, 'FILE1', 'T');
    expect(dump.externals[0].collectionName).toBe('');
  });
});
