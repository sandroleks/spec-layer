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

/** Empty overrides — both colors fall back to their defaults. */
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
 */
export function resolveBrand(stored: BrandColors | null | undefined): {
  headerBg: string;
  accent: string;
} {
  return {
    headerBg: stored?.headerBg ?? DEFAULT_HEADER_BG,
    accent: stored?.accent ?? DEFAULT_ACCENT,
  };
}
