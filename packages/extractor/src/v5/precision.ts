/**
 * The numeric precision policy — spec §16.
 *
 * SIX decimal places, applied to every number that reaches the artifact.
 *
 * Why six: Figma stores numbers as doubles derived from percentage fields, so
 * 4% arrives as 0.03999999910593033 and a 140px line height as
 * 139.9999976158142 -- artifacts that must go. But Figma's own percent field
 * expresses 12.5%, and letter spacing routinely carries three decimals, so a
 * policy tight enough to erase the artifacts must be loose enough to keep the
 * data. Every artifact observed in the corpus appears at the 7th place or
 * beyond, leaving four places of headroom.
 *
 * Why one policy: v4 had three, and its foundation and component documents
 * ended up disagreeing about the same text style.
 *
 * NaN and Infinity pass through UNCHANGED. Mapping them to 0 would put a
 * fabricated number where an unrepresentable value belongs; passing them
 * through lets Level 1 validation reject them by name.
 */
const PLACES = 6;

export function canonicalNumber(n: number): number {
  if (!Number.isFinite(n)) return n;
  // Integers need no rounding, and this branch also covers every magnitude at
  // or above 1e21 -- which JavaScript prints exponentially and which is always
  // integral in double representation, so the string paths below never see one.
  if (Number.isInteger(n)) return n + 0;

  // A non-integer that JS prints exponentially has |n| < 1e-6, which is below
  // the policy's resolution. `toFixed` states that directly and is exact here;
  // it is NOT used for the general case because it goes exponential itself at
  // 1e21 and would reintroduce the same defect at the other end of the range.
  //
  // The naive `Number(`${n}e${PLACES}`)` form is what this branch exists to
  // avoid: for 1e-7 it builds the string "1e-7e6", which parses to NaN.
  const rounded = /e/i.test(String(n))
    ? Number(n.toFixed(PLACES))
    // Scaling through the decimal string, not by multiplying by 1e6: the
    // multiply-then-divide form reintroduces the artifact it removes for values
    // like 1.005, because the intermediate product is itself inexact.
    : Number(`${Math.round(Number(`${n}e${PLACES}`))}e-${PLACES}`);

  // `+ 0` collapses -0 to 0. -0 equals 0 in every comparison but serializes as
  // `-0`, so leaving it breaks byte stability.
  return rounded + 0;
}
