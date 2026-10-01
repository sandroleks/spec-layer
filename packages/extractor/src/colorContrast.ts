/**
 * Contrast over foundation COLOUR variables. A collection states no pairing, so
 * pairs come from the one signal present: the words in each variable's name.
 */

import type { FoundationSpec, FoundationVariable } from './foundation';
import { blend, contrastRatio, concreteColor } from './contrast';

export type ColorRole = 'foreground' | 'background' | null;

/** Words meaning "this colour is drawn ON something". `foreground`/`fg` mirror
 *  `background`/`bg`, so shadcn-style `color/muted-foreground` classifies. */
export const FOREGROUND_WORDS: ReadonlySet<string> =
  new Set(['text', 'icon', 'stroke', 'border', 'content', 'foreground', 'fg']);
/** Words meaning "this colour is what something is drawn on". */
export const BACKGROUND_WORDS: ReadonlySet<string> =
  new Set(['surface', 'background', 'bg', 'fill', 'canvas', 'base']);

/**
 * The role a colour variable's name declares, or null. The FIRST role across the
 * `/` segments wins, so `color/text/on-surface` is a foreground. An `on-` segment
 * is checked before hyphen splitting, or `on-surface` would read as a background.
 * Whole hyphen-delimited words only: `subtext` is not `text`.
 */
export function colorRole(name: string): ColorRole {
  for (const rawSegment of name.split('/')) {
    const segment = rawSegment.trim().toLowerCase();
    if (!segment) continue;
    if (segment === 'on' || segment.startsWith('on-')) return 'foreground';
    const words = segment.split('-');
    if (words.some((w) => FOREGROUND_WORDS.has(w))) return 'foreground';
    if (words.some((w) => BACKGROUND_WORDS.has(w))) return 'background';
  }
  return null;
}

/** The named WCAG bars a ratio can clear, ascending in strictness. */
export type ContrastBar = 'aa-large' | 'aa' | 'aaa';

/**
 * Which bars this ratio clears; not a pass/fail verdict, since a foundation has
 * no font size to say which bar applies. The payload-facing names are narrower
 * than the thresholds, so read them as numbers:
 *
 *   3:1   `aa-large`  SC 1.4.3 AA large text, AND SC 1.4.11 non-text contrast
 *                     (UI components, icons, focus indicators).
 *   4.5:1 `aa`        SC 1.4.3 AA normal text, AND SC 1.4.6 AAA large text.
 *   7:1   `aaa`       SC 1.4.6 AAA normal text.
 */
export function barsCleared(ratio: number): ContrastBar[] {
  const out: ContrastBar[] = [];
  if (ratio >= 3) out.push('aa-large');
  if (ratio >= 4.5) out.push('aa');
  if (ratio >= 7) out.push('aaa');
  return out;
}

/**
 * Cap on each axis of one matrix, to keep a frame readable. What it drops is
 * REPORTED (`omitted`): a bounded result must never pass as complete.
 */
export const CONTRAST_AXIS_CAP = 24;

export interface ContrastCell { ratio: number; clears: ContrastBar[] }

export interface ContrastMatrix {
  collection: string;
  mode: string;
  foregrounds: string[];
  backgrounds: string[];
  /** `cells[fgIndex][bgIndex]`, null where the pair could not be measured. */
  cells: (ContrastCell | null)[][];
  /** THIS collection's unclassified count, not the foundation's: a global count
   *  beside one grid would claim drops from a collection that had none. */
  unclassified: number;
  /** THIS collection's count of classified colours dropped by the cap. */
  omitted: number;
}

export interface ContrastFailure {
  collection: string;
  mode: string;
  foreground: { token: string; value: string };
  background: { token: string; value: string };
  ratio: number;
  clears: ContrastBar[];
}

export interface ColorContrastReport {
  /** Pairs actually measured. Zero means nothing was checked, never "all pass". */
  measured: number;
  /** COLOUR variables whose name declared no role, so they were never paired. */
  unclassified: number;
  /** Classified variables dropped by the cap. */
  omitted: number;
  matrices: ContrastMatrix[];
  /** Pairs clearing NO bar, across matrices. A pair clearing only aa-large is
   *  not listed: that depends on a font size the foundation lacks. */
  failures: ContrastFailure[];
}

/**
 * Measure contrast across a foundation's colour variables. Pairs stay within ONE
 * collection so both sides share a mode set (Light with Light); pairing across
 * collections would invent a mode correspondence.
 */
export function colorContrast(
  foundation: FoundationSpec,
  cap: number = CONTRAST_AXIS_CAP,
): ColorContrastReport {
  const matrices: ContrastMatrix[] = [];
  const failures: ContrastFailure[] = [];
  let measured = 0;
  let unclassified = 0;
  let omitted = 0;

  for (const collection of foundation.collections) {
    const colours = collection.variables.filter((v) => v.resolvedType === 'COLOR');
    const fg: FoundationVariable[] = [];
    const bg: FoundationVariable[] = [];
    let collectionUnclassified = 0;
    for (const v of colours) {
      const role = colorRole(v.name);
      if (role === 'foreground') fg.push(v);
      else if (role === 'background') bg.push(v);
      else collectionUnclassified++;
    }
    unclassified += collectionUnclassified;

    // Each variable sits on one axis, so the sum counts distinct drops.
    const collectionOmitted = Math.max(0, fg.length - cap) + Math.max(0, bg.length - cap);
    omitted += collectionOmitted;
    const foregrounds = fg.slice(0, cap);
    const backgrounds = bg.slice(0, cap);
    if (!foregrounds.length || !backgrounds.length) continue;

    for (const mode of collection.modes) {
      const cells: (ContrastCell | null)[][] = [];
      for (const f of foregrounds) {
        const row: (ContrastCell | null)[] = [];
        const fgValue = f.valuesByMode[mode.modeId];
        const fgColour = fgValue ? concreteColor(fgValue) : null;
        for (const b of backgrounds) {
          const bgValue = b.valuesByMode[mode.modeId];
          const bgColour = bgValue ? concreteColor(bgValue) : null;
          // A translucent background depends on what sits behind it, which a
          // foundation does not know; assuming white could hide a real failure.
          if (!fgColour || !bgColour || bgColour.alpha < 1) { row.push(null); continue; }
          const composited = blend(fgColour.hex, fgColour.alpha, bgColour.hex);
          // FLOOR, never round: rounding awards bars the exact ratio does not clear
          // (#0078d7 on white is 4.4989:1, not "4.5:1 AA"). Flooring equals reading
          // bars off the unrounded ratio, since 3, 4.5 and 7 are exact at two
          // decimals. A false pass is the expensive direction.
          const ratio = Math.floor(contrastRatio(composited, bgColour.hex) * 100) / 100;
          const clears = barsCleared(ratio);
          row.push({ ratio, clears });
          measured++;
          if (clears.length === 0) {
            failures.push({
              collection: collection.name, mode: mode.name,
              foreground: { token: f.name, value: composited },
              background: { token: b.name, value: bgColour.hex },
              ratio, clears,
            });
          }
        }
        cells.push(row);
      }
      matrices.push({
        collection: collection.name, mode: mode.name,
        foregrounds: foregrounds.map((v) => v.name),
        backgrounds: backgrounds.map((v) => v.name),
        cells,
        unclassified: collectionUnclassified,
        omitted: collectionOmitted,
      });
    }
  }

  return { measured, unclassified, omitted, matrices, failures };
}
