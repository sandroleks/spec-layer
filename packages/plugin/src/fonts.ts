/**
 * Pure helpers for the theme font pickers. The frame needs Regular, Medium and
 * Bold of any family it uses (see tryFamily in frameKit.ts), so the pickers
 * offer only families with all three. No DOM, no Figma APIs.
 */

export const REQUIRED_FONT_STYLES = ['Regular', 'Medium', 'Bold'] as const;

export interface FontEntry {
  fontName: { family: string; style: string };
}

/** Families that have every required style, sorted alphabetically. */
export function familiesWithRequiredStyles(fonts: FontEntry[]): string[] {
  const byFamily = new Map<string, Set<string>>();
  for (const { fontName } of fonts) {
    let styles = byFamily.get(fontName.family);
    if (!styles) byFamily.set(fontName.family, (styles = new Set()));
    styles.add(fontName.style);
  }
  const out: string[] = [];
  for (const [family, styles] of byFamily) {
    if (REQUIRED_FONT_STYLES.every((s) => styles.has(s))) out.push(family);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** Case-insensitive substring filter for the picker's type-to-search. */
export function filterFamilies(families: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return families;
  return families.filter((f) => f.toLowerCase().includes(q));
}
