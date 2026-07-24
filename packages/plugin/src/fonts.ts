/**
 * fonts.ts — pure helpers for the theme font pickers.
 *
 * The generated frame needs Regular, Medium, and Bold faces of any family it
 * uses (see tryFamily in docFrame.ts). The pickers therefore only offer
 * families that have all three, computed here from the raw
 * figma.listAvailableFontsAsync() entries. No DOM, no Figma APIs.
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
