/**
 * WCAG 2.1 contrast maths. Pure and dependency-free so it runs identically in
 * the plugin sandbox and under vitest.
 */

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('')}`;

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.1 contrast ratio. Symmetric; always >= 1. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Composite `fg` at `alpha` over an opaque `bg`. WCAG is defined on the colour
 * a user actually sees, and semi-transparent text is common in disabled and
 * muted styles, so ignoring alpha would report ratios nobody experiences.
 */
export function blend(fg: string, alpha: number, bg: string): string {
  if (alpha >= 1) return fg;
  if (alpha <= 0) return bg;
  const [fr, fg_, fb] = rgb(fg);
  const [br, bg_, bb] = rgb(bg);
  return toHex(
    fr * alpha + br * (1 - alpha),
    fg_ * alpha + bg_ * (1 - alpha),
    fb * alpha + bb * (1 - alpha),
  );
}

/**
 * The AA threshold for this text. "Large" is >= 24px, or >= 18.66px at weight
 * 700 or above (WCAG 2.1 SC 1.4.3). An unknown size is treated as normal text,
 * which is the stricter and therefore safer assumption.
 */
export function requiredRatio(fontSize: number | undefined, fontWeight: number | undefined): 3 | 4.5 {
  if (fontSize === undefined) return 4.5;
  if (fontSize >= 24) return 3;
  if (fontSize >= 18.66 && (fontWeight ?? 400) >= 700) return 3;
  return 4.5;
}
