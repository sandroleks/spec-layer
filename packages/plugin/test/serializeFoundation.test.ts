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
    // The text style's bound fontSize variable (id 'v1') also fails to resolve
    // here, so its key must be dropped entirely from boundVariables rather than
    // set to undefined/null. toEqual({}) alone wouldn't catch an undefined-valued
    // key, so also check the key is genuinely absent.
    expect(dump.textStyles[0].boundVariables).toEqual({});
    expect('fontSize' in dump.textStyles[0].boundVariables).toBe(false);
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

  it('treats an alias into a later collection as local, not external', async () => {
    // c1 is walked first and holds a variable that aliases a variable living in
    // c2, which hasn't been walked yet at the point the alias is seen. Because
    // externals resolution only happens after the full walk (over every
    // collection), the target must still be recognized as local.
    const vars: Record<string, ReaderVariable> = {
      a1: {
        id: 'a1', name: 'a1name', resolvedType: 'COLOR', description: '',
        variableCollectionId: 'c1', codeSyntax: {},
        valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'b1' } },
      },
      b1: {
        id: 'b1', name: 'b1name', resolvedType: 'COLOR', description: '',
        variableCollectionId: 'c2', codeSyntax: {},
        valuesByMode: { m2: { r: 1, g: 1, b: 1, a: 1 } },
      },
    };
    const reader: FoundationReader = {
      async collections() {
        return [
          {
            id: 'c1', name: 'C1',
            modes: [{ modeId: 'm1', name: 'Mode1' }],
            defaultModeId: 'm1',
            variableIds: ['a1'],
          },
          {
            id: 'c2', name: 'C2',
            modes: [{ modeId: 'm2', name: 'Mode2' }],
            defaultModeId: 'm2',
            variableIds: ['b1'],
          },
        ];
      },
      async variable(id) { return vars[id] ?? null; },
      async textStyles() { return []; },
    };
    const dump = await serializeFoundation(reader, 'FILE1', 'T');
    expect(dump.externals).toEqual([]);
    expect(dump.collections).toHaveLength(2);
    expect(dump.collections[0].variables.map((v) => v.name)).toEqual(['a1name']);
    expect(dump.collections[1].variables.map((v) => v.name)).toEqual(['b1name']);
  });

  it('keeps variables in variableIds order when the batched reads finish out of order', async () => {
    // Variable reads are issued as one batch, so they resolve in whatever order
    // the host happens to finish them. Row order inside a collection feeds the
    // rendered frame and therefore the doc's content hash, so it must follow
    // variableIds, not completion. Here the LAST id resolves first and the
    // first resolves last, and 'v3' fails to resolve at all.
    const ids = ['v1', 'v2', 'v3', 'v4', 'v5'];
    const completed: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const reader: FoundationReader = {
      async collections() {
        return [{
          id: 'c1', name: 'Primitives',
          modes: [{ modeId: 'm1', name: 'Value' }],
          defaultModeId: 'm1',
          variableIds: ids,
        }];
      },
      variable(id: string): Promise<ReaderVariable | null> {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Reverse the completion order relative to the argument order.
        const delay = (ids.length - ids.indexOf(id)) * 4;
        return new Promise((resolve) => {
          setTimeout(() => {
            inFlight--;
            completed.push(id);
            resolve(id === 'v3' ? null : {
              id, name: `${id}-name`, resolvedType: 'COLOR', description: '',
              variableCollectionId: 'c1', codeSyntax: {},
              valuesByMode: { m1: { r: 0, g: 0, b: 0, a: 1 } },
            });
          }, delay);
        });
      },
      async textStyles() { return []; },
    };

    const dump = await serializeFoundation(reader, 'FILE1', 'T');

    // The reads really were concurrent (a sequential loop would peak at 1)...
    expect(maxInFlight).toBe(ids.length);
    // ...and really did land out of order...
    expect(completed).toEqual(['v5', 'v4', 'v3', 'v2', 'v1']);
    // ...yet the dump is in variableIds order, with the unresolvable id skipped
    // rather than left as a hole or moved.
    expect(dump.collections[0].variables.map((v) => v.id))
      .toEqual(['v1', 'v2', 'v4', 'v5']);
    expect(dump.collections[0].variables.map((v) => v.name))
      .toEqual(['v1-name', 'v2-name', 'v4-name', 'v5-name']);
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

  describe('unavailable reads', () => {
    it('records a variables read that threw instead of reporting an empty file', async () => {
      const reader = fakeReader({ collections: async () => { throw new Error('nope'); } });
      const dump = await serializeFoundation(reader, 'FILE1', 'T');
      expect(dump.collections).toEqual([]);
      // Without this, a total API failure and a file with no variables at all
      // produce byte-identical dumps, and the brief reports the second.
      expect(dump.unavailable).toEqual(['variables']);
    });

    it('records a text styles read that threw', async () => {
      const reader = fakeReader({ textStyles: async () => { throw new Error('nope'); } });
      const dump = await serializeFoundation(reader, 'FILE1', 'T');
      expect(dump.unavailable).toEqual(['textStyles']);
    });

    it('leaves the key absent on a clean read', async () => {
      const dump = await serializeFoundation(fakeReader(), 'FILE1', 'T');
      expect('unavailable' in dump).toBe(false);
    });
  });
});
