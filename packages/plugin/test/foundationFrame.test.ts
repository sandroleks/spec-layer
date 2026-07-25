import { describe, it, expect } from 'vitest';
import { valueLabel, swatchColorOf } from '../src/foundationFrame';
import type { FoundationValue } from '@spec-layer/extractor';

describe('valueLabel', () => {
  it('labels a color as hex, adding alpha only when partial', () => {
    expect(valueLabel({ kind: 'color', hex: '#2563eb', alpha: 1 })).toBe('#2563EB');
    expect(valueLabel({ kind: 'color', hex: '#000000', alpha: 0.5 })).toBe('#000000 50%');
  });

  it('labels numbers without trailing zeros', () => {
    expect(valueLabel({ kind: 'number', value: 16 })).toBe('16');
    expect(valueLabel({ kind: 'number', value: 1.5 })).toBe('1.5');
  });

  it('labels strings and booleans', () => {
    expect(valueLabel({ kind: 'string', value: 'Acme' })).toBe('Acme');
    expect(valueLabel({ kind: 'boolean', value: true })).toBe('true');
  });

  it('labels a resolved alias with the arrow and the final value', () => {
    const v: FoundationValue = {
      kind: 'alias', targetName: 'color/blue/500', targetCollection: 'Primitives',
      external: false, resolved: { kind: 'color', hex: '#0000ff', alpha: 1 },
    };
    expect(valueLabel(v)).toBe('→ color/blue/500  #0000FF');
  });

  it('marks an external alias as a library reference with no value', () => {
    const v: FoundationValue = {
      kind: 'alias', targetName: 'core/blue', targetCollection: 'Core Library',
      external: true, resolved: null,
    };
    expect(valueLabel(v)).toBe('→ core/blue (library)');
  });

  it('states every unresolved reason plainly', () => {
    expect(valueLabel({ kind: 'unresolved', reason: 'cycle' })).toBe('not resolved: cycle');
    expect(valueLabel({ kind: 'unresolved', reason: 'missing' })).toBe('not resolved: missing');
    expect(valueLabel({ kind: 'unresolved', reason: 'depth' })).toBe('not resolved: depth');
    expect(valueLabel({ kind: 'unresolved', reason: 'external' }))
      .toBe('not resolved: external library variable');
  });

  it('labels an alias whose chain failed with the arrow plus the reason', () => {
    const v: FoundationValue = {
      kind: 'alias', targetName: 'a', targetCollection: 'P', external: false,
      resolved: { kind: 'unresolved', reason: 'cycle' },
    };
    expect(valueLabel(v)).toBe('→ a  not resolved: cycle');
  });

  it('contains no em dash in any label', () => {
    const values: FoundationValue[] = [
      { kind: 'color', hex: '#000000', alpha: 0.5 },
      { kind: 'unresolved', reason: 'external' },
      { kind: 'alias', targetName: 'a', targetCollection: 'P', external: true, resolved: null },
    ];
    for (const v of values) expect(valueLabel(v)).not.toContain('—');
  });
});

describe('swatchColorOf', () => {
  it('returns rgb for a color', () => {
    expect(swatchColorOf({ kind: 'color', hex: '#0000ff', alpha: 1 }))
      .toEqual({ r: 0, g: 0, b: 1 });
  });

  it('returns the resolved color through an alias', () => {
    expect(swatchColorOf({
      kind: 'alias', targetName: 'x', targetCollection: 'P', external: false,
      resolved: { kind: 'color', hex: '#ff0000', alpha: 1 },
    })).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('returns null for non-colors and unresolved values', () => {
    expect(swatchColorOf({ kind: 'number', value: 4 })).toBeNull();
    expect(swatchColorOf({ kind: 'unresolved', reason: 'missing' })).toBeNull();
    expect(swatchColorOf({
      kind: 'alias', targetName: 'x', targetCollection: 'L', external: true, resolved: null,
    })).toBeNull();
  });
});
