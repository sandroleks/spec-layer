/**
 * Filenames for component briefs, shared by the CLI's pull and the plugin's
 * downloadable snapshot. Both write `<slug>.yaml` for the same library, so the
 * rule lives here rather than in either consumer: a snapshot downloaded today
 * and a pull run tomorrow name the same component the same way.
 */

const DASH = 0x2d;

export function slugify(name: string): string {
  const collapsed = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  // Trimmed by scanning rather than by `/^-+|-+$/g`. The trailing alternative
  // of that regex retries `-+` from every position on a run of dashes, which
  // is quadratic and is what CodeQL's js/polynomial-redos flags. The collapse
  // above means a run cannot actually occur today, but the guarantee lives in
  // the caller's ordering rather than in this expression, and a slug decides a
  // filename every pull writes, so the safe shape is the one that does not
  // depend on it. `redos.test.ts` pins this against the regex it replaced.
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed.charCodeAt(start) === DASH) start += 1;
  while (end > start && collapsed.charCodeAt(end - 1) === DASH) end -= 1;
  const slug = collapsed.slice(start, end);
  return slug || 'component';
}

/**
 * Slugs for every name in order, deduped the same way regardless of which
 * components a selection writes, so a filtered pull names a file exactly as an
 * unfiltered one would.
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
