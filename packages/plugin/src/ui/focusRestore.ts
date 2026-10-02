/**
 * Keeping keyboard focus across a repaint.
 *
 * Screens rebuild with innerHTML, so a repaint the user did not ask for (a
 * reply from the main thread, a quota fetch, a selection change) replaced
 * the focused element and dropped focus to <body>: a keyboard or screen
 * reader user lost their place mid-task. Before the repaint this records how
 * to find the focused element again, by id or by its data-* attributes; after
 * it, when focus was lost, it focuses the element that now matches.
 */

const cssEscape = (value: string): string => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&'));

/** A selector that finds `el` again after a repaint, or null when it has nothing stable to go by. */
export function focusSelector(el: Element | null): string | null {
  if (!el || el === el.ownerDocument.body || el === el.ownerDocument.documentElement) return null;
  if (el.id) return `#${cssEscape(el.id)}`;
  const tag = el.tagName.toLowerCase();
  const data = [...el.attributes].filter((a) => a.name.startsWith('data-'));
  if (data.length > 0) return tag + data.map((a) => `[${a.name}="${cssEscape(a.value)}"]`).join('');
  const name = el.getAttribute('name');
  return name ? `${tag}[name="${cssEscape(name)}"]` : null;
}

/**
 * Runs `repaint`, then puts focus back on the element that matches the one
 * focused before, if the repaint removed it. Focus that survived, or that the
 * repaint itself moved, is left alone.
 */
export function keepFocus(doc: Document, repaint: () => void): void {
  const before = doc.activeElement;
  const selector = focusSelector(before);
  repaint();
  if (!selector || (before && before.isConnected)) return;
  const active = doc.activeElement;
  if (active && active !== doc.body) return;
  const next = doc.querySelector<HTMLElement>(selector);
  next?.focus({ preventScroll: true });
}
