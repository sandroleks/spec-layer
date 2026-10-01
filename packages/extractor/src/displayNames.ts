/**
 * displayNames.ts: the names a reader sees, derived from Figma's. Display only:
 * every identity (Section and layer names, tags, hashes, prompt matching) keeps
 * the raw name. Runs on both plugin threads, so it stays free of browser and
 * Figma globals.
 */

/** A fully lowercase component name gets a capital; a leading atom marker
 *  (`.` or `_`) is dropped; anything with a capital is left as typed. */
export function displayComponentName(raw: string): string {
  const name = raw.replace(/^[._]+/, '').trim();
  if (!name) return '';
  if (/[A-Z]/.test(name)) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Simple camelCase (one lowercase word, then capitalised words with no
 *  acronym runs), snake_case and kebab-case layer names read as words.
 *  A name with a space, or one this rule cannot split safely, is left as typed. */
export function displayPartName(raw: string): string {
  const name = raw.trim();
  if (!name || name.includes(' ')) return name;
  if (/[_-]/.test(name)) {
    const segments = name.split(/[_-]+/).filter(Boolean);
    if (segments.some((seg) => /[A-Z]/.test(seg.slice(1)))) {
      return name;
    }
    const words = segments.map((w) => w.toLowerCase());
    return capitalise(words.join(' '));
  }
  if (/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)+$/.test(name)) {
    return capitalise(name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase());
  }
  return name;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
