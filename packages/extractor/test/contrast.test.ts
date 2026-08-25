import { describe, it, expect } from 'vitest';
import { relativeLuminance, contrastRatio, blend, requiredRatio } from '../src/contrast';
import { resolveTokenColor } from '../src/contrast';
import type { FoundationSpec } from '../src/foundation';

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

  // The cases above pin each boundary only from ABOVE, so widening a boundary
  // downward (>= 24 becoming >= 20, or the bold rule becoming >= 16 at weight
  // >= 600) leaves every one of them green while silently relaxing AA for real
  // text. These pin the same boundaries from just below.
  it('is 4.5 just below every large-text boundary', () => {
    expect(requiredRatio(23, 400)).toBe(4.5);   // just under the 24px cutoff
    expect(requiredRatio(18, 700)).toBe(4.5);   // bold, but under 18.66px
    expect(requiredRatio(18.66, 600)).toBe(4.5); // big enough, but under weight 700
  });
});

const foundation = (vars: Record<string, string>): FoundationSpec => ({
  fileKey: 'f', extractedAt: '', textStyles: [], effectStyles: [],
  collections: [{
    id: 'c1', name: 'Core', defaultModeId: 'm1', modes: [{ modeId: 'm1', name: 'Light' }],
    variables: Object.entries(vars).map(([name, hex]) => ({
      name, group: 'g', resolvedType: 'COLOR' as const, description: '', codeSyntax: {},
      valuesByMode: { m1: { kind: 'color' as const, hex, alpha: 1 } },
    })),
  }],
});

describe('resolveTokenColor', () => {
  it('resolves a colour variable in its collection default mode', () => {
    expect(resolveTokenColor(foundation({ 'text/muted': '#767676' }), 'text/muted'))
      .toEqual({ hex: '#767676', alpha: 1 });
  });
  it('returns null for an unknown token', () => {
    expect(resolveTokenColor(foundation({}), 'nope')).toBeNull();
  });
});
