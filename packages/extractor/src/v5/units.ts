/**
 * Unit resolution (spec §9.5). The unit comes from Figma's `Variable.scopes`
 * and nothing else: a token name is not evidence (`font-weight/fw-600: 600` is
 * not 600px, and guessing from names writes `font-weight: 600px`).
 *
 * `null` is a first-class answer and the common one: ALL_SCOPES is Figma's
 * default, so an unnarrowed variable states no unit and a consumer knows to ask
 * a human.
 */
import { canonicalNumber } from './precision';
import type { DimensionValue, NumberValue, Unit } from './value';

/** Figma scopes that pin a unit. LINE_HEIGHT and LETTER_SPACING are absent:
 *  their unit is per style (PIXELS / PERCENT / AUTO), so it is resolved where
 *  the style is read (plan 3). */
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
 * Whether the token's scopes state a unit at all (a length or a unitless
 * number). Not `numericValue(...) === null`, which is also null when two scopes
 * state conflicting units; a caller deciding whether to look elsewhere for a
 * unit must not conflate the two.
 */
export function scopesStateUnit(scopes: string[] | undefined): boolean {
  return (scopes ?? []).some((s) => UNIT_BY_SCOPE[s] !== undefined);
}

/**
 * Whether the scopes state a unitless number (`FONT_WEIGHT`, `OPACITY`). A
 * reader that collects only the length scopes sees a scoped opacity as silence
 * and writes `opacity: 1px`.
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
  // None means no stated unit; two means conflicting ones, and picking one
  // would invent a decision the designer did not make.
  if (units.size !== 1) return null;
  const unit = [...units][0];
  return unit === 'number'
    ? { type: 'number', value: canonicalNumber(n) }
    : { type: 'dimension', number: canonicalNumber(n), unit };
}
