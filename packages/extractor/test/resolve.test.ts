import { describe, expect, it } from 'vitest';
import { resolveTokensForVariant } from '../src/resolve';
import type { TokenRule } from '../src/tokens';

const rules: TokenRule[] = [
  { part: 'Container', path: 'Container', property: 'border-radius', conditions: {}, token: 'shape.full' },
  { part: 'Container', path: 'Container', property: 'fill', conditions: { Type: ['Primary'] }, token: 'color.primary' },
  { part: 'Container', path: 'Container', property: 'fill', conditions: { Type: ['Secondary', 'Tertiary'] }, token: 'color.surface' },
  {
    part: 'Container', path: 'Container', property: 'fill',
    conditions: { Type: ['Primary'], State: ['Hover'] }, token: 'color.primary-hover',
  },
  { part: 'Label', path: 'Container/Label', property: 'fill', conditions: { Disabled: ['true'] }, token: 'color.disabled' },
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
