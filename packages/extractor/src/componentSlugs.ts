/**
 * Filenames for component briefs, shared by the CLI's pull and the plugin's
 * downloadable snapshot. Both write `<slug>.yaml` for the same library, so the
 * rule lives here rather than in either consumer: a snapshot downloaded today
 * and a pull run tomorrow name the same component the same way.
 */

export function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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
