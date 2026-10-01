/**
 * Filenames for component briefs, shared by the CLI's pull and the plugin's
 * snapshot so both name the same component the same way.
 */

const DASH = 0x2d;

export function slugify(name: string): string {
  const collapsed = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  // Trimmed by scanning, not `/^-+|-+$/g`, whose trailing alternative is
  // quadratic on a dash run (CodeQL js/polynomial-redos). `redos.test.ts` pins
  // this against the regex it replaced.
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed.charCodeAt(start) === DASH) start += 1;
  while (end > start && collapsed.charCodeAt(end - 1) === DASH) end -= 1;
  const slug = collapsed.slice(start, end);
  return slug || 'component';
}

/**
 * Slugs for every name in order, deduped the same way whatever a selection
 * writes, so a filtered pull names files as an unfiltered one does.
 */
export function componentSlugs(names: string[]): string[] {
  const usedSlugs = new Set<string>();
  const nextSuffix = new Map<string, number>();
  return names.map((name) => {
    const base = slugify(name);
    let slug = base;
    if (usedSlugs.has(slug)) {
      let n = (nextSuffix.get(base) ?? 1) + 1;
      slug = `${base}-${n}`;
      while (usedSlugs.has(slug)) {
        n += 1;
        slug = `${base}-${n}`;
      }
      nextSuffix.set(base, n);
    } else {
      nextSuffix.set(base, 1);
    }
    usedSlugs.add(slug);
    return slug;
  });
}
