import { describe, it, expect } from 'vitest';
import { canonicalColor, colorFromHex } from '../../src/v5/color';

const ok = (r: ReturnType<typeof canonicalColor>) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.value;
};

describe('canonicalColor', () => {
  it('emits a lowercase six-digit hex with an explicit colour space', () => {
    expect(ok(canonicalColor({ r: 0, g: 0.4196078431372549, b: 0.3843137254901961, a: 1 })))
      .toEqual({ type: 'color', color_space: 'srgb', hex: '#006b62', alpha: 1 });
  });

  it('keeps alpha on a fully opaque colour', () => {
    expect(ok(canonicalColor({ r: 1, g: 1, b: 1, a: 1 })).alpha).toBe(1);
  });

  it('preserves source channels only when the hex would lose them', () => {
    const lossy = ok(canonicalColor({ r: 0.5, g: 0.5, b: 0.5, a: 1 }));
    expect(lossy.hex).toBe('#808080');
    expect(lossy.channels).toEqual([0.5, 0.5, 0.5]);

    const exact = ok(canonicalColor({ r: 0, g: 1, b: 0, a: 1 }));
    expect('channels' in exact).toBe(false);
  });

  it('rounds alpha to the documented precision', () => {
    expect(ok(canonicalColor({ r: 0, g: 0, b: 0, a: 0.03999999910593033 })).alpha).toBe(0.04);
  });

  it('snaps float noise at the range boundary', () => {
    // Figma's own colour arithmetic produces this; it is the artifact class
    // canonicalNumber exists for, not malformed data.
    expect(ok(canonicalColor({ r: 1.0000000001, g: 0, b: -1e-12, a: 1 })).hex)
      .toBe('#ff0000');
  });

  it('REJECTS a channel genuinely outside 0..1 instead of clamping it', () => {
    // Clamping 1.4 to 1.0 emits a colour that looks measured and is not. The
    // caller turns this into `missing` plus INVALID_SOURCE_COLOR.
    const r = canonicalColor({ r: -0.2, g: 1.4, b: 0.5, a: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('out of range');
  });

  it('REJECTS a non-finite channel', () => {
    expect(canonicalColor({ r: NaN, g: 0, b: 0, a: 1 }).ok).toBe(false);
  });
});

describe('colorFromHex', () => {
  it('accepts a valid three- or six-digit hex', () => {
    expect(ok(colorFromHex('#FFF', 1)).hex).toBe('#ffffff');
    expect(ok(colorFromHex('#006B62', 1)).hex).toBe('#006b62');
    expect(ok(colorFromHex('006b62', 1)).hex).toBe('#006b62');
  });

  it('REJECTS a malformed hex rather than padding or truncating it', () => {
    // v4's `#colors/blue/200` and a truncated `#ff` are both real defects seen
    // in exports. Padding `#ff` to `#ff0000` invents a colour.
    for (const bad of ['#ff', '#fffff', '#12345g', '#colors/blue/200', '', '#']) {
      expect(colorFromHex(bad, 1).ok).toBe(false);
    }
  });

  it('REJECTS an alpha outside 0..1', () => {
    expect(colorFromHex('#ffffff', 1.5).ok).toBe(false);
  });
});
