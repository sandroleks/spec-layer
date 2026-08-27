/**
 * The numeric precision policy — spec §16.
 *
 * SEVEN SIGNIFICANT DIGITS, applied to every number that reaches the artifact.
 *
 * Significant digits, not decimal places. Figma stores these numbers as float32
 * and hands back the float64 widening, so the error is RELATIVE: 140 arrives as
 * 139.9999976158142 and 0.3 as 0.30000001192092896, and no fixed number of
 * decimal places cleans both. Six decimals leaves 139.999998; eight significant
 * digits leaves 0.30000001. Seven is float32's own decimal precision (~7.2
 * digits), which is exactly the precision the source actually held -- so the
 * policy discards what float32 never carried and keeps everything it did.
 *
 * Why one policy: v4 had three (alpha to 4, typography to 2, foundation text
 * styles to none), and its foundation and component documents ended up
 * disagreeing about the same text style.
 *
 * NaN and Infinity pass through UNCHANGED. Mapping them to 0 would put a
 * fabricated number where an unrepresentable value belongs; passing them
 * through lets Level 1 validation reject them by name.
 */
const SIGNIFICANT_DIGITS = 7;

/** 2^24 -- the largest integer float32 represents exactly. At or above it,
 *  float32 cannot hold the value precisely in the first place, so there is no
 *  artifact to clean and rounding would only discard real digits. */
const FLOAT32_EXACT_LIMIT = 16777216;

export function canonicalNumber(n: number): number {
  if (!Number.isFinite(n)) return n;
  // Integers first, and not merely as a fast path: `toPrecision` CORRUPTS large
  // ones -- Number.MAX_SAFE_INTEGER.toPrecision(7) is "9.007199e+15", a
  // different number. `+ 0` on the way out also collapses -0 to 0, which is
  // required for byte stability: -0 equals 0 in every comparison but serializes
  // as `-0`.
  if (Number.isInteger(n)) return n + 0;
  if (Math.abs(n) >= FLOAT32_EXACT_LIMIT) return n + 0;
  return Number(n.toPrecision(SIGNIFICANT_DIGITS)) + 0;
}
