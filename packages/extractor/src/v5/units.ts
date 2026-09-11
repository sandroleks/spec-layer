/**
 * Unit resolution — spec §9.5.
 *
 * The unit comes from Figma's `Variable.scopes` and from nothing else. A token
 * NAME is not evidence: `spacing/400: 16` means 16px and
 * `font-weight/fw-600: 600` does not mean 600px, and the only thing separating
 * them in v4 was a guess a generator made and got wrong -- it emitted
 * `font-weight: 600px`, which no CSS parser rejects loudly.
 *
 * `null` is a first-class answer and the common one. ALL_SCOPES is Figma's
 * default, so an unnarrowed variable does not state its unit; reporting that is
 * useful, because a consumer then knows to ask a human. Guessing is not.
 */
import { canonicalNumber } from './precision';
import type { DimensionValue, NumberValue, Unit } from './value';

/** Figma scopes that pin a unit.
 *
 *  LINE_HEIGHT and LETTER_SPACING are absent on purpose: Figma carries their
 *  unit per style (PIXELS / PERCENT / AUTO), so a variable scoped to either has
 *  no single answer and must be resolved where the style is read (plan 3). */
const UNIT_BY_SCOPE: Record<string, Unit | 'number'> = {
  WIDTH_HEIGHT: 'px',
  CORNER_RADIUS: 'px',
  GAP: 'px',
  FONT_SIZE: 'px',
  STROKE_FLOAT: 'px',
  PARAGRAPH_SPACING: 'px',
  PARAGRAPH_INDENT: 'px',
  EFFECT_FLOAT: 'px',
  FONT_WEIGHT: 'number',
  OPACITY: 'number',
};

/**
 * Whether the token's own scopes state its unit AT ALL — a scope that pins a
 * length, or one of the two that pin a unitless number.
 *
 * `numericValue(n, scopes) === null` cannot answer this: it is also null when
 * two scopes state two DIFFERENT units, which is a file that states plenty and
 * simply does not agree with itself. A caller deciding whether it may look
 * elsewhere for a unit must not treat those two as the same, so the question
 * is asked here rather than re-derived from `numericValue`'s null.
 */
export function scopesStateUnit(scopes: string[] | undefined): boolean {
  return (scopes ?? []).some((s) => UNIT_BY_SCOPE[s] !== undefined);
}

/**
 * Whether the token's own scopes state that it is a UNITLESS NUMBER.
 *
 * `FONT_WEIGHT` and `OPACITY` are statements about a token's unit exactly as
 * `CORNER_RADIUS` is, and the statement they make is "there is no unit here."
 * A reader that collects only the length-stating half sees a scoped opacity as
 * silence and is free to pin a length on it, which is how `opacity: 1px` gets
 * written. Asked here so the one list has one owner.
 */
export function scopesStateNumber(scopes: string[] | undefined): boolean {
  return (scopes ?? []).some((s) => UNIT_BY_SCOPE[s] === 'number');
}

export function numericValue(
  n: number,
  scopes: string[] | undefined,
): DimensionValue | NumberValue | null {
  const units = new Set(
    (scopes ?? [])
      .map((s) => UNIT_BY_SCOPE[s])
      .filter((u): u is Unit | 'number' => u !== undefined),
  );
  // Zero known scopes means the file does not state a unit; two different ones
  // mean it states two, and picking one would be this function inventing a
  // decision the designer did not make.
  if (units.size !== 1) return null;
  const unit = [...units][0];
  return unit === 'number'
    ? { type: 'number', value: canonicalNumber(n) }
    : { type: 'dimension', number: canonicalNumber(n), unit };
}
