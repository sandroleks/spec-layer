/**
 * Contrast over foundation COLOUR variables.
 *
 * A contrast ratio is a fact about two colour values, so it belongs to the
 * foundation rather than to each component that happens to use the pair. The
 * problem this file solves is that a collection is a flat list of colours with no
 * statement of which sits on which, so pairs have to come from the one signal
 * that is actually present: the words in the variable's own name.
 */

export type ColorRole = 'foreground' | 'background' | null;

/** Words meaning "this colour is drawn ON something". */
const FOREGROUND_WORDS = new Set(['text', 'icon', 'stroke', 'border', 'content']);
/** Words meaning "this colour is what something is drawn on". */
const BACKGROUND_WORDS = new Set(['surface', 'background', 'bg', 'fill', 'canvas', 'base']);

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
