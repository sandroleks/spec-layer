/**
 * HTML-escapes text that lands inside a markup template string.
 *
 * Attribute values are always double-quoted in this UI, so these four
 * characters are the whole set: an unescaped single quote cannot end an
 * attribute here. Nine screen modules carried their own copy of this
 * function; one place means one test and one place to widen it.
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
