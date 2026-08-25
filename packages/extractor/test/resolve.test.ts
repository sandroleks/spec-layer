import { describe, expect, it } from 'vitest';
import { resolveTokensForVariant } from '../src/resolve';
import type { TokenRule } from '../src/tokens';
import type { RefIdentity } from '../src/tree';

/** A reference now carries a full identity, not just a name. These tests are
 *  not about resolution, so one identity is minted per token NAME -- which is
 *  exactly what a name meant before the identity fields existed. */
const ident = (name: string): RefIdentity => (
  { id: `VariableID:${name}`, name, kind: 'variable', remote: false });

const rules: TokenRule[] = [
  { part: 'Container', path: 'Container', property: 'border-radius', conditions: {}, ...ident('shape.full') },
  { part: 'Container', path: 'Container', property: 'fill', conditions: { Type: ['Primary'] }, ...ident('color.primary') },
  { part: 'Container', path: 'Container', property: 'fill', conditions: { Type: ['Secondary', 'Tertiary'] }, ...ident('color.surface') },
  {
    part: 'Container', path: 'Container', property: 'fill',
    conditions: { Type: ['Primary'], State: ['Hover'] }, ...ident('color.primary-hover'),
  },
  { part: 'Label', path: 'Container/Label', property: 'fill', conditions: { Disabled: ['true'] }, ...ident('color.disabled') },
];

describe('resolveTokensForVariant', () => {
  it('returns unconditioned rules for every variant', () => {
    const resolved = resolveTokensForVariant(rules, { Type: 'Primary', State: 'Default', Disabled: 'false' });
    expect(resolved).toContainEqual({ part: 'Container', property: 'border-radius', token: 'shape.full' });
  });

  it('matches single-axis conditioned rules', () => {
    const resolved = resolveTokensForVariant(rules, { Type: 'Primary', State: 'Default', Disabled: 'false' });
    expect(resolved).toContainEqual({ part: 'Container', property: 'fill', token: 'color.primary' });
    expect(resolved.find((r) => r.token === 'color.surface')).toBeUndefined();
  });

  it('matches axis-value-list rules', () => {
    const resolved = resolveTokensForVariant(rules, { Type: 'Secondary', State: 'Default', Disabled: 'false' });
    expect(resolved).toContainEqual({ part: 'Container', property: 'fill', token: 'color.surface' });
  });

  it('matches multi-axis conditioned rules', () => {
    const resolved = resolveTokensForVariant(rules, { Type: 'Primary', State: 'Hover', Disabled: 'false' });
    expect(resolved).toContainEqual({ part: 'Container', property: 'fill', token: 'color.primary-hover' });
    expect(resolved).toContainEqual({ part: 'Container', property: 'fill', token: 'color.primary' });
  });

  it('excludes rules when an axis is missing from the variant values', () => {
    const resolved = resolveTokensForVariant(rules, { Type: 'Primary' });
    expect(resolved.find((r) => r.token === 'color.disabled')).toBeUndefined();
  });

  it('excludes rules when an axis value does not match', () => {
    const resolved = resolveTokensForVariant(rules, { Type: 'Primary', State: 'Default', Disabled: 'false' });
    expect(resolved.find((r) => r.token === 'color.disabled')).toBeUndefined();
  });
});
