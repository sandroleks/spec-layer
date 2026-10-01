/**
 * Keyboard movement inside a tab strip or a radio group, shared by both
 * composite widgets on Settings. The caller owns focus and state.
 */

export type RovingAxis = 'horizontal' | 'both';

/**
 * The index `key` moves to, or null when this widget does not answer that key
 * (the event then passes through, so Tab still leaves the widget). `both` adds
 * Up and Down, as a radio group does. Moves wrap; a stale `current` is clamped.
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
