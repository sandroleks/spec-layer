/**
 * The user's brand theme for generated frames, plus pure helpers shared by the
 * UI (validation, preview) and the main thread (resolving a stored theme,
 * migrating the 1.x two-color shape). A color field is a normalized `#rrggbb`
 * or `null` for the default. No DOM, no Figma APIs.
 */

export const DEFAULT_HEADER_BG = '#0f172a';
export const DEFAULT_ACCENT = '#2563eb';

export interface BrandColors {
  /** Header band background, or null to use DEFAULT_HEADER_BG. */
  headerBg: string | null;
  /** Accent (eyebrow rules, section numbers, markers), or null for DEFAULT_ACCENT. */
  accent: string | null;
}

/** `#rrggbb` or `rrggbb` in any case as lowercase `#rrggbb`, else null. */
export function parseBrandHex(input: string): string | null {
  const trimmed = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(trimmed)) return null;
  return `#${trimmed.toLowerCase()}`;
}

export const DEFAULT_BODY_TEXT = '#334155';
export const DEFAULT_TABLE_HEAD_BG = '#f8fafc';
export const DEFAULT_FONT = 'Inter';

export type CornerStyle = 'sharp' | 'soft' | 'round';
export const DEFAULT_CORNER_STYLE: CornerStyle = 'soft';

/** Four colors, two font families and a corner style; `null` means default. */
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

/** Every field null, so every field falls back to its default. */
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

/** A stored theme with defaults for every null or missing field. */
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

/** Legacy `{ headerBg, accent }` objects load with the other fields null; full
 *  themes pass through unchanged. */
export function migrateBrandColors(
  legacy: BrandColors | BrandTheme | null | undefined
): BrandTheme {
  if (!legacy) return emptyBrandTheme();
  return { ...emptyBrandTheme(), ...legacy };
}

/**
 * Built-in full-theme presets. "Default" stores concrete values equal to the
 * defaults so active-preset detection is uniform. Heading fonts are Google
 * Fonts Figma has by default; the build falls back to Inter if one is missing.
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

/** The preset the stored theme equals, or null when custom. Compares resolved
 *  values, so a null field equals a concrete default. */
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
