import { describe, it, expect } from 'vitest';
import { canonicalNumber } from '../../src/v5/precision';

describe('canonicalNumber', () => {
  it('removes binary floating-point artifacts', () => {
    expect(canonicalNumber(139.9999976158142)).toBe(140);
    expect(canonicalNumber(120.00000476837158)).toBe(120);
    expect(canonicalNumber(0.30000001192092896)).toBe(0.3);
    expect(canonicalNumber(0.03999999910593033)).toBe(0.04);
  });

  it('does not reintroduce an artifact through the scaling step', () => {
    // Math.round(n * 1e6) / 1e6 fails here: the intermediate product is itself
    // inexact.
    expect(canonicalNumber(1.005)).toBe(1.005);
  });

  it('keeps a value Figma can genuinely express', () => {
    expect(canonicalNumber(0.125)).toBe(0.125);
    expect(canonicalNumber(0.333333)).toBe(0.333333);
  });

  it('handles values JavaScript prints in exponential notation', () => {
    // The naive string-exponent implementation returns NaN for every one of
    // these, and NaN in the artifact is a fabricated value that no consumer can
    // detect as one.
    expect(canonicalNumber(1e-7)).toBe(0);
    expect(canonicalNumber(5.5e-7)).toBe(1e-6);
    expect(canonicalNumber(-1e-7)).toBe(0);
    expect(canonicalNumber(1e21)).toBe(1e21);
    expect(canonicalNumber(1.7976931348623157e308)).toBe(1.7976931348623157e308);
    expect(canonicalNumber(Number.MIN_VALUE)).toBe(0);
  });

  it('normalizes negative zero', () => {
    // -0 compares equal to 0 but serializes as `-0`, so leaving it makes two
    // semantically identical artifacts byte-different.
    expect(Object.is(canonicalNumber(-0), 0)).toBe(true);
    expect(Object.is(canonicalNumber(-1e-9), 0)).toBe(true);
  });

  it('leaves integers alone', () => {
    expect(canonicalNumber(16)).toBe(16);
    expect(canonicalNumber(-1)).toBe(-1);
    expect(canonicalNumber(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('passes a non-finite number through so a validator can reject it by name', () => {
    expect(Number.isNaN(canonicalNumber(NaN))).toBe(true);
    expect(canonicalNumber(Infinity)).toBe(Infinity);
    expect(canonicalNumber(-Infinity)).toBe(-Infinity);
  });
});
