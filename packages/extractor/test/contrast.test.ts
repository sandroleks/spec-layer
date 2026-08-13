import { describe, it, expect } from 'vitest';
import { relativeLuminance, contrastRatio, blend, requiredRatio } from '../src/contrast';

const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(near(relativeLuminance('#000000'), 0)).toBe(true);
    expect(near(relativeLuminance('#ffffff'), 1)).toBe(true);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(near(contrastRatio('#000000', '#ffffff'), 21, 0.05)).toBe(true);
  });
  it('is 1:1 for a colour against itself', () => {
    expect(near(contrastRatio('#3366cc', '#3366cc'), 1)).toBe(true);
  });
  it('is symmetric', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(contrastRatio('#abcdef', '#123456'), 10);
  });
  it('matches a known reference pair', () => {
    // #767676 on #ffffff is the canonical "exactly AA" grey.
    expect(near(contrastRatio('#767676', '#ffffff'), 4.54, 0.02)).toBe(true);
  });
});

describe('blend', () => {
  it('returns the foreground at full alpha', () => {
    expect(blend('#ff0000', 1, '#ffffff')).toBe('#ff0000');
  });
  it('returns the background at zero alpha', () => {
    expect(blend('#ff0000', 0, '#ffffff')).toBe('#ffffff');
  });
  it('composites at half alpha', () => {
    expect(blend('#000000', 0.5, '#ffffff')).toBe('#808080');
  });
});

describe('requiredRatio', () => {
  it('is 3 for 24px and above', () => {
    expect(requiredRatio(24, 400)).toBe(3);
  });
  it('is 3 for 18.66px bold', () => {
    expect(requiredRatio(18.66, 700)).toBe(3);
  });
  it('is 4.5 for 18.66px regular', () => {
    expect(requiredRatio(18.66, 400)).toBe(4.5);
  });
  it('is 4.5 for small text and when the size is unknown', () => {
    expect(requiredRatio(14, 700)).toBe(4.5);
    expect(requiredRatio(undefined, undefined)).toBe(4.5);
  });
});
