/**
 * brandColors — the user-customizable brand colors used in the generated
 * Guidelines frame, plus pure helpers shared by the UI (validation/preview)
 * and the main thread (resolving stored overrides to concrete values).
 *
 * Only two colors are customizable: the header band and the accent color.
 * The rest of the frame palette (body ink, borders, table tints) stays fixed.
 *
 * Stored shape: each field is either a normalized `#rrggbb` string or `null`
 * (meaning "use the default"). No DOM, no Figma APIs — trivially testable.
 */

export const DEFAULT_HEADER_BG = '#0f172a';
export const DEFAULT_ACCENT = '#2563eb';

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

export type CornerStyle = 'sharp' | 'soft' | 'round';
export const DEFAULT_CORNER_STYLE: CornerStyle = 'soft';

export interface BrandTheme {
  headerBg: string | null;
  accent: string | null;
  bodyText: string | null;
  tableHeadBg: string | null;
  /** Font family name for headings, or null to use DEFAULT_FONT. */
  headingFont: string | null;
  /** Font family name for body copy, or null to use DEFAULT_FONT. */
  bodyFont: string | null;
  /** Corner style for the generated frame, or null to use 'soft'. */
  cornerStyle: CornerStyle | null;
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
    cornerStyle: null,
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
  cornerStyle: CornerStyle;
} {
  return {
    headerBg: stored?.headerBg ?? DEFAULT_HEADER_BG,
    accent: stored?.accent ?? DEFAULT_ACCENT,
    bodyText: stored?.bodyText ?? DEFAULT_BODY_TEXT,
    tableHeadBg: stored?.tableHeadBg ?? DEFAULT_TABLE_HEAD_BG,
    headingFont: stored?.headingFont ?? DEFAULT_FONT,
    bodyFont: stored?.bodyFont ?? DEFAULT_FONT,
    cornerStyle: stored?.cornerStyle ?? DEFAULT_CORNER_STYLE,
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

/**
 * Built-in theme presets. Each preset is a full personality: all four
 * colors, both fonts, and a corner style. "Default" stores concrete values
 * equal to the built-in defaults so active-preset detection is uniform.
 * Heading fonts are Google Fonts available in Figma by default; the build
 * still falls back to Inter if one is missing.
 */
export const THEME_PRESETS: { name: string; theme: BrandTheme }[] = [
  {
    name: 'Default',
    theme: {
      headerBg: '#0f172a', accent: '#2563eb', bodyText: '#334155',
      tableHeadBg: '#f8fafc', headingFont: 'Inter', bodyFont: 'Inter',
      cornerStyle: 'soft',
    },
  },
  {
    name: 'Editorial',
    theme: {
      headerBg: '#1c1917', accent: '#b45309', bodyText: '#3f3a36',
      tableHeadBg: '#faf9f7', headingFont: 'Lora', bodyFont: 'Inter',
      cornerStyle: 'sharp',
    },
  },
  {
    name: 'Tech',
    theme: {
      headerBg: '#1e293b', accent: '#6366f1', bodyText: '#334155',
      tableHeadBg: '#f6f7fb', headingFont: 'Space Grotesk', bodyFont: 'Inter',
      cornerStyle: 'round',
    },
  },
  {
    name: 'Warm',
    theme: {
      headerBg: '#2b1b3d', accent: '#e879a6', bodyText: '#3d3450',
      tableHeadBg: '#faf8fb', headingFont: 'DM Sans', bodyFont: 'Inter',
      cornerStyle: 'soft',
    },
  },
];

/**
 * Which preset (if any) the stored theme currently equals. Compares RESOLVED
 * values so a null field and a concrete field holding the default are equal.
 * Returns the preset name, or null when the theme is custom.
 */
export function matchPreset(theme: BrandTheme | null | undefined): string | null {
  const t = resolveTheme(migrateBrandColors(theme));
  for (const preset of THEME_PRESETS) {
    const p = resolveTheme(preset.theme);
    if (
      p.headerBg === t.headerBg && p.accent === t.accent &&
      p.bodyText === t.bodyText && p.tableHeadBg === t.tableHeadBg &&
      p.headingFont === t.headingFont && p.bodyFont === t.bodyFont &&
      p.cornerStyle === t.cornerStyle
    ) {
      return preset.name;
    }
  }
  return null;
}
