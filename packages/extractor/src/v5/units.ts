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
