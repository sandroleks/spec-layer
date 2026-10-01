/**
 * The numeric precision policy (spec §16): seven significant digits on every
 * number that reaches the artifact.
 *
 * Significant digits, not decimals: Figma stores float32 and hands back the
 * float64 widening, so the error is relative (140 arrives as 139.9999976158142,
 * 0.3 as 0.30000001192092896) and no fixed decimal count cleans both. Seven is
 * float32's own precision, so this drops only what the source never held. One
 * policy everywhere, so foundation and component documents agree.
 *
 * NaN and Infinity pass through unchanged so Level 1 validation rejects them by
 * name; mapping them to 0 would fabricate a number.
 */
const SIGNIFICANT_DIGITS = 7;

/** 2^24, the largest integer float32 holds exactly. Above it there is no float32
 *  artifact to clean, so rounding would only discard real digits. */
const FLOAT32_EXACT_LIMIT = 16777216;

export function canonicalNumber(n: number): number {
  if (!Number.isFinite(n)) return n;
  // Integers first: `toPrecision` corrupts large ones (MAX_SAFE_INTEGER becomes
  // "9.007199e+15"). `+ 0` collapses -0, which would serialize as `-0`.
  if (Number.isInteger(n)) return n + 0;
  if (Math.abs(n) >= FLOAT32_EXACT_LIMIT) return n + 0;
  return Number(n.toPrecision(SIGNIFICANT_DIGITS)) + 0;
}
