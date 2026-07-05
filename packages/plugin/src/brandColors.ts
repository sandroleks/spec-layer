/**
 * brandColors — the user-customizable brand colors used in the generated
 * Guidelines frame, plus pure helpers shared by the UI (validation/preview)
 * and the main thread (resolving stored overrides to concrete values).
 *
 * Only two colors are customizable: the navy header band and the teal accent.
 * The rest of the frame palette (body ink, borders, table tints) stays fixed.
 *
 * Stored shape: each field is either a normalized `#rrggbb` string or `null`
 * (meaning "use the default"). No DOM, no Figma APIs — trivially testable.
 */

export const DEFAULT_HEADER_BG = '#0d2436';
export const DEFAULT_ACCENT = '#12b3a6';

export interface BrandColors {
  /** Header band background, or null to use DEFAULT_HEADER_BG. */
  headerBg: string | null;
  /** Accent (eyebrow rules, section numbers, markers), or null for DEFAULT_ACCENT. */
  accent: string | null;
}

/**
 * Empty overrides — both colors fall back to their defaults.
 *
 * No production callers post-migration to BrandTheme; kept as the 1.x public
 * shape for stored-settings compatibility and test coverage of the migration
 * source format.
 */
export function emptyBrandColors(): BrandColors {
  return { headerBg: null, accent: null };
}

/**
 * Validate + normalize a hex color string. Accepts `#rrggbb` or `rrggbb`
 * (case-insensitive) and returns a lowercase `#rrggbb`. Returns null for any
 * input that isn't a 6-digit hex color, so callers can reject it.
 */
export function parseBrandHex(input: string): string | null {
  const trimmed = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(trimmed)) return null;
  return `#${trimmed.toLowerCase()}`;
}

/**
 * Resolve stored overrides to concrete `#rrggbb` values, substituting defaults
 * for any null/missing field. The single source of truth for what the frame
 * actually paints.
 *
 * No production callers post-migration to BrandTheme/resolveTheme; kept as
 * the 1.x public shape for stored-settings compatibility and test coverage of
 * the migration source format.
 */
export function resolveBrand(stored: BrandColors | null | undefined): {
  headerBg: string;
  accent: string;
} {
  const resolved = resolveTheme(stored as BrandTheme | null | undefined);
  return { headerBg: resolved.headerBg, accent: resolved.accent };
}

/**
 * BrandTheme extends the two-color brand into a full theme: palette (header,
 * accent, body text, table head background) plus heading/body font families.
 * Each field is either a concrete value or `null` (meaning "use the
 * default"), same convention as `BrandColors`.
 */
export const DEFAULT_BODY_TEXT = '#334155';
export const DEFAULT_TABLE_HEAD_BG = '#f8fafc';
export const DEFAULT_FONT = 'Inter';

export interface BrandTheme {
  headerBg: string | null;
  accent: string | null;
  bodyText: string | null;
  tableHeadBg: string | null;
  /** Font family name for headings, or null to use DEFAULT_FONT. */
  headingFont: string | null;
  /** Font family name for body copy, or null to use DEFAULT_FONT. */
  bodyFont: string | null;
}

/** Empty overrides — every field falls back to its default. */
export function emptyBrandTheme(): BrandTheme {
  return {
    headerBg: null,
    accent: null,
    bodyText: null,
    tableHeadBg: null,
    headingFont: null,
    bodyFont: null,
  };
}

/**
 * Resolve a stored theme to concrete values, substituting defaults for any
 * null/missing field.
 */
export function resolveTheme(stored: BrandTheme | null | undefined): {
  headerBg: string;
  accent: string;
  bodyText: string;
  tableHeadBg: string;
  headingFont: string;
  bodyFont: string;
} {
  return {
    headerBg: stored?.headerBg ?? DEFAULT_HEADER_BG,
    accent: stored?.accent ?? DEFAULT_ACCENT,
    bodyText: stored?.bodyText ?? DEFAULT_BODY_TEXT,
    tableHeadBg: stored?.tableHeadBg ?? DEFAULT_TABLE_HEAD_BG,
    headingFont: stored?.headingFont ?? DEFAULT_FONT,
    bodyFont: stored?.bodyFont ?? DEFAULT_FONT,
  };
}

/**
 * Migrate a stored value to the current `BrandTheme` shape. Legacy
 * `{ headerBg, accent }` objects (from before theming) load with the new
 * fields defaulted to null; full themes pass through unchanged.
 */
export function migrateBrandColors(
  legacy: BrandColors | BrandTheme | null | undefined
): BrandTheme {
  if (!legacy) return emptyBrandTheme();
  return { ...emptyBrandTheme(), ...legacy };
}

/** Built-in theme presets offered in the UI. "Default" matches the frame's built-in palette. */
export const THEME_PRESETS: { name: string; theme: BrandTheme }[] = [
  { name: 'Default', theme: emptyBrandTheme() },
  { name: 'Slate', theme: { ...emptyBrandTheme(), headerBg: '#1e293b', accent: '#818cf8' } },
  { name: 'Forest', theme: { ...emptyBrandTheme(), headerBg: '#14261d', accent: '#34d399' } },
  { name: 'Plum', theme: { ...emptyBrandTheme(), headerBg: '#2b1b3d', accent: '#e879a6' } },
];
