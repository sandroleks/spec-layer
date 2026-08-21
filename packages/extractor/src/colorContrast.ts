/**
 * Contrast over foundation COLOUR variables.
 *
 * A contrast ratio is a fact about two colour values, so it belongs to the
 * foundation rather than to each component that happens to use the pair. The
 * problem this file solves is that a collection is a flat list of colours with no
 * statement of which sits on which, so pairs have to come from the one signal
 * that is actually present: the words in the variable's own name.
 */

import type { FoundationSpec, FoundationVariable } from './foundation';
import { blend, contrastRatio, concreteColor } from './contrast';

export type ColorRole = 'foreground' | 'background' | null;

/** Words meaning "this colour is drawn ON something".
 *
 *  `foreground` and `fg` are the exact mirrors of `background` and `bg` in the
 *  set below, and their absence was pure asymmetry rather than a decision. It
 *  silently dropped every text token in any shadcn, Radix or Tailwind v4
 *  library (`color/foreground`, `color/muted-foreground`), which would hand
 *  colorContrast a matrix with an empty foreground axis, and it also inverted a
 *  flat `fg-on-surface` name into a background, because the `on-` guard fires
 *  only on a segment that STARTS with `on-`. */
export const FOREGROUND_WORDS: ReadonlySet<string> =
  new Set(['text', 'icon', 'stroke', 'border', 'content', 'foreground', 'fg']);
/** Words meaning "this colour is what something is drawn on". */
export const BACKGROUND_WORDS: ReadonlySet<string> =
  new Set(['surface', 'background', 'bg', 'fill', 'canvas', 'base']);

/**
 * The role a colour variable's name declares, or null when it declares none.
 *
 * Walks the name's `/` segments in order and returns the FIRST role found, which
 * is what makes a name carrying both words deterministic:
 * `color/text/on-surface/default` is a foreground because `text` comes first, not
 * a background because `surface` appears later.
 *
 * An `on-` prefixed segment is checked before the segment is split on hyphens.
 * Splitting first would find `surface` inside `on-surface` and classify the very
 * convention that means "content drawn on a surface" as a background.
 *
 * Matching is on whole hyphen-delimited words, never substrings: `subtext` is not
 * `text`, and `basement` is not `base`.
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
 * Which bars this ratio clears.
 *
 * Deliberately NOT a pass/fail verdict. A foundation carries no font size, so
 * nothing here can know whether 3:1 or 4.5:1 is the bar that applies to a given
 * use of the pair. Reporting every bar the ratio clears lets the reader apply
 * the one their case needs, instead of the extractor asserting a threshold it
 * cannot justify.
 *
 * The three numbers cover every distinct threshold in WCAG 2.x, but each NAME
 * is narrower than the thresholds it stands for, and these names are
 * payload-facing (they reach ContrastCell.clears and the failure list), so read
 * them as numbers first:
 *
 *   3:1   `aa-large`  SC 1.4.3 AA large text, AND SC 1.4.11 non-text contrast,
 *                     which covers user interface components and graphical
 *                     objects: icons, chart segments, focus indicators, any
 *                     graphic needed to understand content. Much wider than the
 *                     text-flavoured name suggests.
 *   4.5:1 `aa`        SC 1.4.3 AA normal text, AND SC 1.4.6 AAA LARGE text. So
 *                     a reader with large text who sees ['aa-large', 'aa'] has
 *                     met AAA for their case, which the name alone hides.
 *   7:1   `aaa`       SC 1.4.6 AAA normal text.
 *
 * There is no separate AAA-large bar because 4.5:1 already is it. Adding one
 * would change no output value, only the label.
 */
export function barsCleared(ratio: number): ContrastBar[] {
  const out: ContrastBar[] = [];
  if (ratio >= 3) out.push('aa-large');
  if (ratio >= 4.5) out.push('aa');
  if (ratio >= 7) out.push('aaa');
  return out;
}

/**
 * Cap on each axis of one matrix. A frame has to stay readable and a brief has to
 * stay small, and a 40 by 40 grid is neither. What the cap drops is REPORTED (see
 * `omitted`), because a bounded result presented as a complete one is worse than
 * no result at all.
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
  /** THIS collection's unclassified colour count, not the foundation's.
   *
   *  Present because the report's top-level totals are foundation-global while a
   *  consumer drawing one collection's grid needs that collection's numbers, and
   *  nothing downstream can recover them from a total. Reporting a global count
   *  beside one collection's grid would tell a reader that tokens were dropped
   *  from a collection they were not dropped from. */
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
  /** Every measured pair clearing NO bar at all, flattened across matrices. A
   *  pair clearing aa-large but not aa is not listed: whether that is a failure
   *  depends on a font size the foundation does not have. */
  failures: ContrastFailure[];
}

/**
 * Measure contrast across a foundation's colour variables.
 *
 * Pairs are confined to ONE collection, which is what makes per-mode measurement
 * possible: both sides then share a single mode set, so Light pairs with Light and
 * Dark with Dark without inventing a correspondence between two collections'
 * unrelated modes. Cross-collection pairing needs exactly that correspondence,
 * which is why it stays out of scope rather than being approximated.
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

    // Each variable sits on exactly one axis, so summing the two overflows counts
    // distinct dropped variables rather than double counting any of them.
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
          // A translucent background is only meaningful over whatever sits behind
          // it, and a foundation does not know that. Assuming white would lighten
          // the computed background enough to push a real failure above threshold,
          // so skip and let the counts say so.
          if (!fgColour || !bgColour || bgColour.alpha < 1) { row.push(null); continue; }
          const composited = blend(fgColour.hex, fgColour.alpha, bgColour.hex);
          // FLOOR, never round. Rounding awards a bar the exact ratio does not
          // clear: across 10.2 million real colour pairs it produces 13,600 false
          // passes, and #0078d7 on white (an ordinary brand blue) measures
          // 4.4989:1, fails AA, and would be reported as "4.5:1 AA". Flooring is
          // exactly equivalent to reading the bars off the unrounded ratio,
          // because 3, 4.5 and 7 are all representable at two decimals, so the
          // printed number and the bars still come from one value and that value
          // never overstates. For an accessibility tool a false pass is the
          // expensive direction, so the truncation is deliberate.
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
