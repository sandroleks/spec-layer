import { describe, expect, it } from 'vitest';
import { buildFoundation, type SerializedFoundation } from '@spec-layer/extractor';
import { collectionIconKind, scopeIconKind } from '../src/foundationIcon';

function dump(): SerializedFoundation {
  return {
    fileKey: 'FILE1', extractedAt: 'T', externals: [],
    textStyles: [], effectStyles: [],
    collections: [{
      id: 'c1', name: 'Foundation', defaultModeId: 's1',
      modes: [{ modeId: 's1', name: 'Default' }],
      variables: [
        { id: 'bg', name: 'color/bg/brand', resolvedType: 'COLOR', description: '',
          codeSyntax: {}, valuesByMode: { s1: { r: 0, g: 0, b: 1, a: 1 } } },
        { id: 'radius', name: 'radius/md', resolvedType: 'FLOAT', description: '',
          codeSyntax: {}, valuesByMode: { s1: 8 } },
      ],
    }],
  } as unknown as SerializedFoundation;
}

const SPEC = buildFoundation(dump());

describe('scopeIconKind', () => {
  it('is typography for a text styles doc, without needing a spec at all', () => {
    expect(scopeIconKind(SPEC, { target: 'textStyles' })).toBe('typography');
    expect(scopeIconKind(null, { target: 'textStyles' })).toBe('typography');
  });

  it('reads a collection doc the same way the Foundations picker does', () => {
    const scope = {
      target: 'collection' as const,
      collectionId: 'c1',
      collectionName: 'Foundation',
      modeIds: ['s1'],
    };
    expect(scopeIconKind(SPEC, scope)).toBe('mixed');
    expect(scopeIconKind(SPEC, scope)).toBe(collectionIconKind(SPEC.collections[0]));
  });

  it('reads a group-scoped doc from its own rows, not the whole collection', () => {
    // The collection as a whole is mixed; each split doc is uniform.
    expect(scopeIconKind(SPEC, {
      target: 'collection', collectionId: 'c1', collectionName: 'Foundation',
      group: 'color', modeIds: ['s1'],
    })).toBe('color');
    expect(scopeIconKind(SPEC, {
      target: 'collection', collectionId: 'c1', collectionName: 'Foundation',
      group: 'radius', modeIds: ['s1'],
    })).toBe('dimension');
  });

  it('claims nothing when the source cannot be read', () => {
    const scope = {
      target: 'collection' as const,
      collectionId: 'gone',
      collectionName: 'Deleted',
      modeIds: ['s1'],
    };
    expect(scopeIconKind(SPEC, scope)).toBe('mixed');
    expect(scopeIconKind(null, { ...scope, collectionId: 'c1' })).toBe('mixed');
    // A group that no longer matches any variable is the same situation.
    expect(scopeIconKind(SPEC, {
      target: 'collection', collectionId: 'c1', collectionName: 'Foundation',
      group: 'renamed', modeIds: ['s1'],
    })).toBe('mixed');
  });
});
