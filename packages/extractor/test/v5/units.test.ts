import { describe, it, expect } from 'vitest';
import { numericValue } from '../../src/v5/units';

describe('numericValue', () => {
  it('reads px from Figma dimension scopes', () => {
    for (const scope of ['WIDTH_HEIGHT', 'CORNER_RADIUS', 'GAP', 'FONT_SIZE', 'STROKE_FLOAT']) {
      expect(numericValue(16, [scope])).toEqual({ type: 'dimension', number: 16, unit: 'px' });
    }
  });

  it('reads a unitless number from FONT_WEIGHT', () => {
    // The exact case that produced `font-weight: 600px`.
    expect(numericValue(600, ['FONT_WEIGHT'])).toEqual({ type: 'number', value: 600 });
  });

  it('reads a unitless number from OPACITY', () => {
    expect(numericValue(0.5, ['OPACITY'])).toEqual({ type: 'number', value: 0.5 });
  });

  it('returns null rather than guessing when scopes say nothing', () => {
    // ALL_SCOPES is Figma's default: the designer never narrowed it, so the file
    // genuinely does not state a unit.
    expect(numericValue(16, ['ALL_SCOPES'])).toBeNull();
    expect(numericValue(16, [])).toBeNull();
    expect(numericValue(16, undefined)).toBeNull();
  });

  it('returns null when two scopes imply different units', () => {
    expect(numericValue(600, ['FONT_WEIGHT', 'CORNER_RADIUS'])).toBeNull();
  });

  it('returns null for a scope this version does not know', () => {
    // Forward compatibility (§19): a scope Figma adds later must read as "not
    // stated", never as a default.
    expect(numericValue(16, ['SOME_FUTURE_SCOPE'])).toBeNull();
  });

  it('applies the precision policy to the number', () => {
    expect(numericValue(139.9999976158142, ['WIDTH_HEIGHT']))
      .toEqual({ type: 'dimension', number: 140, unit: 'px' });
  });
});
