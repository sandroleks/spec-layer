import { describe, it, expect } from 'vitest';
import { canonicalNumber } from '../../src/v5/precision';

describe('canonicalNumber', () => {
  it('removes binary floating-point artifacts', () => {
    expect(canonicalNumber(139.9999976158142)).toBe(140);
    expect(canonicalNumber(120.00000476837158)).toBe(120);
    expect(canonicalNumber(0.30000001192092896)).toBe(0.3);
    expect(canonicalNumber(0.03999999910593033)).toBe(0.04);
  });

  it('keeps a value Figma can genuinely express', () => {
    // Figma's percent field expresses 12.5%, and letter spacing routinely
    // carries three decimals. A policy tight enough to erase the artifacts
    // above must be loose enough to keep these.
    expect(canonicalNumber(0.125)).toBe(0.125);
    expect(canonicalNumber(0.333333)).toBe(0.333333);
    expect(canonicalNumber(1.005)).toBe(1.005);
    expect(canonicalNumber(-0.005)).toBe(-0.005);
  });

  it('leaves integers alone, including ones toPrecision would corrupt', () => {
    // MAX_SAFE_INTEGER.toPrecision(7) is "9.007199e+15" -- a different number.
    expect(canonicalNumber(16)).toBe(16);
    expect(canonicalNumber(-1)).toBe(-1);
    expect(canonicalNumber(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(canonicalNumber(1e21)).toBe(1e21);
  });

  it('leaves a non-integer above float32 integer-exact range alone', () => {
    // Above 2^24 float32 cannot hold the value precisely, so there is no
    // artifact to clean and rounding would only discard real digits.
    expect(canonicalNumber(16777216.5)).toBe(16777216.5);
    expect(canonicalNumber(1.7976931348623157e308)).toBe(1.7976931348623157e308);
  });

  it('does not flatten a genuinely tiny number to zero', () => {
    // A small value is a small number, not an artifact. Under a
    // decimal-places policy these all collapsed to 0, which is data loss.
    expect(canonicalNumber(1e-7)).toBe(1e-7);
    expect(canonicalNumber(5.5e-7)).toBe(5.5e-7);
    expect(canonicalNumber(-1e-9)).toBe(-1e-9);
    expect(canonicalNumber(Number.MIN_VALUE)).toBe(Number.MIN_VALUE);
  });

  it('normalizes negative zero', () => {
    // -0 compares equal to 0 but serializes as `-0`, so leaving it makes two
    // semantically identical artifacts byte-different.
    expect(Object.is(canonicalNumber(-0), 0)).toBe(true);
  });

  it('passes a non-finite number through so a validator can reject it by name', () => {
    expect(Number.isNaN(canonicalNumber(NaN))).toBe(true);
    expect(canonicalNumber(Infinity)).toBe(Infinity);
    expect(canonicalNumber(-Infinity)).toBe(-Infinity);
  });
});
