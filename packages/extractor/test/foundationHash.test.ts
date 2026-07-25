import { describe, it, expect } from 'vitest';
import { buildFoundation, type SerializedFoundation, type FoundationScope } from '../src/foundation';
import { foundationContentHash } from '../src/hash';

function dump(): SerializedFoundation {
  return {
    fileKey: 'FILE1', extractedAt: '2026-07-25T00:00:00.000Z', externals: [], textStyles: [],
    collections: [
      {
        id: 'c1', name: 'Semantic', defaultModeId: 's1',
        modes: [{ modeId: 's1', name: 'Light' }, { modeId: 's2', name: 'Dark' }],
        variables: [
          { id: 'bg', name: 'bg/brand', resolvedType: 'COLOR', description: 'Brand fill.',
            codeSyntax: {}, valuesByMode: {
              s1: { r: 0.145, g: 0.388, b: 0.921, a: 1 },
              s2: { r: 0.231, g: 0.510, b: 0.965, a: 1 },
            } },
        ],
      },
      {
        id: 'c2', name: 'Other', defaultModeId: 'o1',
        modes: [{ modeId: 'o1', name: 'Value' }],
        variables: [
          { id: 'x', name: 'x/y', resolvedType: 'FLOAT', description: '',
            codeSyntax: {}, valuesByMode: { o1: 4 } },
        ],
      },
    ],
  };
}

const SEMANTIC: FoundationScope = {
  target: 'collection', collectionId: 'c1', collectionName: 'Semantic', modeIds: ['s1', 's2'],
};
const OTHER: FoundationScope = {
  target: 'collection', collectionId: 'c2', collectionName: 'Other', modeIds: ['o1'],
};

const hashOf = (d: SerializedFoundation, scope: FoundationScope = SEMANTIC) =>
  foundationContentHash(buildFoundation(d), scope);

describe('foundationContentHash', () => {
  it('is stable across re-extraction of identical data', () => {
    expect(hashOf(dump())).toBe(hashOf(dump()));
  });

  it('ignores extractedAt', () => {
    const d = dump();
    d.extractedAt = '2030-01-01T00:00:00.000Z';
    expect(hashOf(d)).toBe(hashOf(dump()));
  });

  it('ignores collection and variable ids', () => {
    const d = dump();
    d.collections[0].id = 'renamed-id';
    d.collections[0].variables[0].id = 'other-id';
    const scope: FoundationScope = { ...SEMANTIC, collectionId: 'renamed-id' };
    expect(foundationContentHash(buildFoundation(d), scope)).toBe(hashOf(dump()));
  });

  it('ignores mode ids but not mode names', () => {
    const idsChanged = dump();
    idsChanged.collections[0].modes = [{ modeId: 'z1', name: 'Light' }, { modeId: 'z2', name: 'Dark' }];
    idsChanged.collections[0].defaultModeId = 'z1';
    idsChanged.collections[0].variables[0].valuesByMode = {
      z1: { r: 0.145, g: 0.388, b: 0.921, a: 1 },
      z2: { r: 0.231, g: 0.510, b: 0.965, a: 1 },
    };
    expect(foundationContentHash(buildFoundation(idsChanged), { ...SEMANTIC, modeIds: ['z1', 'z2'] }))
      .toBe(hashOf(dump()));

    const renamed = dump();
    renamed.collections[0].modes[1].name = 'Night';
    expect(hashOf(renamed)).not.toBe(hashOf(dump()));
  });

  it('changes when a variable is renamed', () => {
    const d = dump();
    d.collections[0].variables[0].name = 'bg/primary';
    expect(hashOf(d)).not.toBe(hashOf(dump()));
  });

  it('changes when a value changes', () => {
    const d = dump();
    d.collections[0].variables[0].valuesByMode.s2 = { r: 1, g: 0, b: 0, a: 1 };
    expect(hashOf(d)).not.toBe(hashOf(dump()));
  });

  it('changes when a variable is added', () => {
    const d = dump();
    d.collections[0].variables.push({
      id: 'new', name: 'bg/subtle', resolvedType: 'COLOR', description: '',
      codeSyntax: {}, valuesByMode: { s1: { r: 1, g: 1, b: 1, a: 1 }, s2: { r: 0, g: 0, b: 0, a: 1 } },
    });
    expect(hashOf(d)).not.toBe(hashOf(dump()));
  });

  it('changes when a description changes', () => {
    const d = dump();
    d.collections[0].variables[0].description = 'Different.';
    expect(hashOf(d)).not.toBe(hashOf(dump()));
  });

  it('changes when the collection is renamed', () => {
    const d = dump();
    d.collections[0].name = 'Tokens';
    expect(foundationContentHash(buildFoundation(d), { ...SEMANTIC, collectionName: 'Tokens' }))
      .not.toBe(hashOf(dump()));
  });

  it('isolates scopes: editing collection c2 leaves c1 unchanged', () => {
    const d = dump();
    d.collections[1].variables[0].valuesByMode.o1 = 999;
    expect(hashOf(d, SEMANTIC)).toBe(hashOf(dump(), SEMANTIC));
    expect(hashOf(d, OTHER)).not.toBe(hashOf(dump(), OTHER));
  });

  it('differs between a group-scoped unit and the whole collection', () => {
    const d = dump();
    d.collections[0].variables.push({
      id: 'text', name: 'text/default', resolvedType: 'COLOR', description: '',
      codeSyntax: {}, valuesByMode: { s1: { r: 0, g: 0, b: 0, a: 1 }, s2: { r: 1, g: 1, b: 1, a: 1 } },
    });
    const whole = hashOf(d, SEMANTIC);
    const scoped = hashOf(d, { ...SEMANTIC, group: 'bg' });
    expect(scoped).not.toBe(whole);
  });

  it('returns a stable sentinel when the scope source is gone', () => {
    const gone: FoundationScope = {
      target: 'collection', collectionId: 'deleted', collectionName: 'Deleted', modeIds: [],
    };
    expect(hashOf(dump(), gone)).toBe(hashOf(dump(), gone));
    expect(hashOf(dump(), gone)).not.toBe(hashOf(dump(), SEMANTIC));
  });
});
