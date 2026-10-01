import type { BundleV1 } from './bundle';
import { slugify } from './files';

/**
 * Which bundle entries a pull writes. The unit is a whole entry (the Foundation,
 * or one component): anything narrower would need the extractor's alias-closure
 * logic and become a second interpretation of v5.
 */
export interface Selection {
  /** Write the tokens/ directory when the bundle has a Foundation. */
  foundation: boolean;
  /** Component names to write; null means every component, [] means none. */
  components: string[] | null;
}

export const DEFAULT_SELECTION: Selection = { foundation: true, components: null };

export interface SelectionFlags { only?: string; component?: string[] }

/** The selection the flags ask for, or null when none was given. Throws on contradictory or unknown flags. */
export function selectionFromFlags(flags: SelectionFlags): Selection | null {
  const named = flags.component !== undefined && flags.component.length > 0 ? flags.component : null;
  if (flags.only === undefined) return named ? { foundation: true, components: named } : null;
  if (flags.only === 'foundation') {
    if (named) throw new Error('--only foundation cannot be combined with --component. Drop one of them.');
    return { foundation: true, components: [] };
  }
  if (flags.only === 'components') return { foundation: false, components: named };
  throw new Error(`--only takes "foundation" or "components", not "${flags.only}".`);
}

/** Flags replace the config selection outright; nothing is merged. */
export function resolveSelection(flags: SelectionFlags, config: { include?: Selection } | null): Selection {
  return selectionFromFlags(flags) ?? config?.include ?? DEFAULT_SELECTION;
}

/** Name equality by slug, so "button" and "Icon Button" match "Button" and "icon-button". */
export const matchesName = (input: string, name: string): boolean => slugify(input) === slugify(name);

/**
 * One flag per bundle component, in bundle order. A name matching nothing is
 * an error, so pull never reports success for nothing.
 */
export function selectComponents(bundle: BundleV1, selection: Selection): boolean[] {
  const wanted = selection.components;
  if (wanted === null) return bundle.components.map(() => true);
  const hasMatch = (name: string) => bundle.components.some((c) => matchesName(name, c.name));
  const missing = wanted.filter((name) => !hasMatch(name));
  if (missing.length > 0) {
    const available = bundle.components.map((c) => c.name).join(', ');
    throw new Error(
      `No component named ${missing.map((m) => `"${m}"`).join(', ')} in this library.\n` +
      `Available: ${available || 'none'}.`,
    );
  }
  return bundle.components.map((c) => wanted.some((name) => matchesName(name, c.name)));
}
