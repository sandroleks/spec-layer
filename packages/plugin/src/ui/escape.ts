/** HTML-escapes text for a markup template. Attributes are always
 *  double-quoted here, so these four characters are the whole set. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
