import { describe, expect, it } from 'vitest';
import { computeFoundationStatistics } from '../../src/v5/statistics';
import { diagnostic } from '../../src/v5/diagnostics';
import type { CollectionV5, TokenV5 } from '../../src/v5/entities';

const collections: CollectionV5[] = [{
  id: 'c1', name: 'One', path: ['One'], default_mode_id: 'm1',
  modes: [{ id: 'm1', name: 'Light', order: 0 }, { id: 'm2', name: 'Dark', order: 1 }],
}, {
  id: 'c2', name: 'Two', path: ['Two'], default_mode_id: 'm3',
  modes: [{ id: 'm3', name: 'Value', order: 0 }],
}];

const tokens: TokenV5[] = [{
  id: 'literal', collection_id: 'c1', name: 'literal', path: ['literal'],
  type: 'number', description: '', scopes: [],
  lifecycle: { status: 'active', replacement_id: null },
  values: {
    m1: { kind: 'literal', value: { type: 'number', value: 1 } },
    m2: { kind: 'literal', value: { type: 'number', value: 2 } },
  },
}, {
  id: 'two-alias-values', collection_id: 'c1', name: 'alias', path: ['alias'],
  type: 'number', description: '', scopes: [],
  values: {
    m1: {
      kind: 'alias',
      reference: {
        target_id: 'literal', target_collection_id: 'c1',
        target_path: ['literal'], external: false,
      },
      resolved: {
        status: 'resolved', value: { type: 'number', value: 1 },
        chain: [{ token_id: 'literal', mode_id: 'm1' }],
      },
    },
    m2: {
      kind: 'alias',
      reference: {
        target_id: null, target_collection_id: null,
        target_path: ['remote'], external: true,
      },
      resolved: {
        status: 'unresolved', reason: 'source_library_unavailable', value: null, chain: [],
      },
    },
  },
}];

const diagnostics = [
  diagnostic('UNRESOLVED_ALIAS', { entity_id: 'two-alias-values', message: 'broken' }),
  diagnostic('SYNTHETIC_IDENTITY', { entity_id: 'literal', message: 'synthetic' }),
  diagnostic('MISSING_DESCRIPTION', { entity_id: 'literal', message: 'missing' }),
];

describe('computeFoundationStatistics', () => {
  it('derives modes, styles, aliases, lifecycle, and diagnostics from finished sections', () => {
    expect(computeFoundationStatistics({
      collections, tokens,
      styles: { typography: [{} as never], effects: [{}, {}] as never[] },
      diagnostics,
    })).toEqual({
      collections: 2,
      modes: 3,
      tokens: 2,
      styles: { typography: 1, effects: 2 },
      aliases: { total: 2, resolved: 1, unresolved: 1 },
      lifecycle: { active: 1, deprecated: 0, archived: 0 },
      diagnostics: { error: 1, warning: 1, info: 1 },
    });
  });

  it('counts alias value records rather than tokens and does not assume lifecycle', () => {
    const stats = computeFoundationStatistics({
      collections, tokens, styles: { typography: [], effects: [] }, diagnostics: [],
    });
    expect(stats).toMatchObject({
      tokens: 2,
      aliases: { total: 2 },
      lifecycle: { active: 1, deprecated: 0, archived: 0 },
    });
  });

  it('is independent of input order', () => {
    const a = computeFoundationStatistics({
      collections, tokens, styles: { typography: [], effects: [] }, diagnostics,
    });
    const b = computeFoundationStatistics({
      collections: [...collections].reverse(), tokens: [...tokens].reverse(),
      styles: { typography: [], effects: [] }, diagnostics: [...diagnostics].reverse(),
    });
    expect(b).toEqual(a);
  });
});
