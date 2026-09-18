import { describe, it, expect } from 'vitest';
import { collectionAliasCounts, collectionModeNames } from '../src/foundationOverview';
import type { FoundationSpec, FoundationVariable } from '../src/foundation';

const variable = (name: string, valuesByMode: FoundationVariable['valuesByMode']): FoundationVariable => ({
  name, group: '', resolvedType: 'COLOR', description: '', codeSyntax: {}, valuesByMode,
  provenance: { id: name, scopes: [], valuesByMode: {}, staleModeIds: [] },
});
const alias = (targetCollection: string) => ({ kind: 'alias' as const, targetName: 't', targetCollection, external: false, resolved: null });
const hex = { kind: 'color' as const, hex: '#000000', alpha: 1 };

const spec = {
  fileKey: 'f', extractedAt: '', textStyles: [], effectStyles: [],
  collections: [
    {
      id: 'sem', name: 'Semantic', defaultModeId: 'l',
      modes: [{ modeId: 'l', name: 'Light' }, { modeId: 'd', name: 'Dark' }],
      variables: [
        variable('surface', { l: alias('Primitives'), d: alias('Primitives') }),
        variable('accent', { l: alias('Brand'), d: alias('Primitives') }),
        variable('literal', { l: hex, d: hex }),
        variable('self', { l: alias('Semantic'), d: hex }),
      ],
    },
    { id: 'prim', name: 'Primitives', defaultModeId: 'm', modes: [{ modeId: 'm', name: 'Value' }], variables: [] },
  ],
} as unknown as FoundationSpec;

describe('collectionAliasCounts', () => {
  it('counts a variable once per target collection, ignores literals and self-aliases, sorts by count then name', () => {
    expect(collectionAliasCounts(spec, 'sem')).toEqual([
      { collection: 'Primitives', count: 2 },
      { collection: 'Brand', count: 1 },
    ]);
  });
  it('returns nothing for an unknown collection or one with no aliases', () => {
    expect(collectionAliasCounts(spec, 'nope')).toEqual([]);
    expect(collectionAliasCounts(spec, 'prim')).toEqual([]);
  });
});

describe('collectionModeNames', () => {
  it('lists mode names in declaration order', () => {
    expect(collectionModeNames(spec, 'sem')).toEqual(['Light', 'Dark']);
    expect(collectionModeNames(spec, 'nope')).toEqual([]);
  });
});
