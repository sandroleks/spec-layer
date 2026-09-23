/**
 * roving.ts — keyboard movement inside a tab strip or a radio group.
 *
 * One pure rule, so both composite widgets on Settings move the same way and
 * the rule is testable without a DOM. The caller owns focus and state; this
 * only answers "which item does this key land on".
 */

export type RovingAxis = 'horizontal' | 'both';

/**
 * The index `key` moves to among `count` items, or null when this widget does
 * not answer that key (the caller then lets the event through, so Tab still
 * leaves the widget). Horizontal answers Left and Right; `both` also answers
 * Up and Down, the way a radio group does. Moves wrap at the ends; Home and End
 * go to the ends. A stale `current` is clamped first.
 */
export function rovingIndex(
  current: number,
  count: number,
  key: string,
  axis: RovingAxis,
): number | null {
  if (count <= 0) return null;
  const at = Math.min(Math.max(0, current), count - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight' || (axis === 'both' && key === 'ArrowDown')) return (at + 1) % count;
  if (key === 'ArrowLeft' || (axis === 'both' && key === 'ArrowUp')) return (at - 1 + count) % count;
  return null;
}
