import { describe, it, expect } from 'vitest';
import {
  isLiteral, isAlias, isMissing, resolvedValueOf,
  SUPPORTED_UNITS, SUPPORTED_TOKEN_TYPES,
} from '../../src/v5/value';
import type { CanonicalValue } from '../../src/v5/value';

const LITERAL: CanonicalValue = {
  kind: 'literal',
  value: { type: 'color', color_space: 'srgb', hex: '#006b62', alpha: 1 },
};

const RESOLVED_ALIAS: CanonicalValue = {
  kind: 'alias',
  reference: {
    target_id: 'VariableID:color-teal-500',
    target_collection_id: 'VariableCollectionId:color-base',
    target_path: ['color', 'teal-green', '500'],
    external: false,
  },
  resolved: {
    status: 'resolved',
    value: { type: 'color', color_space: 'srgb', hex: '#006b62', alpha: 1 },
    chain: [{ token_id: 'VariableID:color-teal-500', mode_id: 'base/default' }],
  },
};

const UNRESOLVED_ALIAS: CanonicalValue = {
  kind: 'alias',
  reference: {
    target_id: null, target_collection_id: null,
    target_path: ['coolGray-80'], external: true,
    source_library_name: 'Color base [deprecated]',
  },
  resolved: {
    status: 'unresolved', reason: 'source_library_unavailable',
    value: null, chain: [],
  },
};

const MISSING: CanonicalValue = { kind: 'missing', reason: 'no_value_for_mode' };

describe('canonical value', () => {
  it('discriminates the three kinds', () => {
    expect(isLiteral(LITERAL)).toBe(true);
    expect(isAlias(RESOLVED_ALIAS)).toBe(true);
    expect(isMissing(MISSING)).toBe(true);
    expect(isLiteral(RESOLVED_ALIAS)).toBe(false);
  });

  it('reads through a resolved alias to its typed value', () => {
    expect(resolvedValueOf(RESOLVED_ALIAS)).toEqual(
      { type: 'color', color_space: 'srgb', hex: '#006b62', alpha: 1 });
    expect(resolvedValueOf(LITERAL)).toEqual(LITERAL.value);
  });

  it('reads null through an unresolved alias, never a substituted default', () => {
    expect(resolvedValueOf(UNRESOLVED_ALIAS)).toBeNull();
    expect(resolvedValueOf(MISSING)).toBeNull();
  });

  it('carries a mode id at every hop of a resolution chain', () => {
    // A cross-collection alias points at a VARIABLE, not at a (variable, mode)
    // pair -- Figma's own alias carries no mode. Which mode of the target
    // collection was read is therefore a DECISION the extractor made, and a
    // chain that recorded only token ids would leave it unstated and force a
    // validator to re-guess it from mode names or defaults.
    const chain = (RESOLVED_ALIAS as Extract<CanonicalValue, { kind: 'alias' }>)
      .resolved.chain;
    for (const step of chain) {
      expect(typeof step.token_id).toBe('string');
      expect(typeof step.mode_id).toBe('string');
    }
  });

  it('exposes its vocabularies at runtime for schema cross-checking', () => {
    // Types are erased at compile time and cannot be compared against the
    // published JSON Schema. These arrays are what makes that check possible.
    expect(SUPPORTED_UNITS).toContain('px');
    expect(SUPPORTED_UNITS).not.toContain('pt');
    expect(SUPPORTED_TOKEN_TYPES).toContain('cubic_bezier');
  });
});
