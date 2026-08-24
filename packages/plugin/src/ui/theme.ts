/**
 * theme.ts — light/dark theming for the plugin UI.
 *
 * Two modes, light ↔ dark, toggled by the header button. The initial mode is
 * detected automatically from Figma's host theme at boot (synchronously, so the
 * first paint is already correct — no flash-then-flip), and the toggle then
 * overrides it for the session. There is no persisted preference: deriving from
 * Figma every load is both the "automatic" behaviour we want and the thing that
 * removes the async clientStorage round-trip that used to cause the flash.
 *
 * applyThemeMode() always sets body[data-theme] (our published palette in
 * design-system/tokens.css) rather than relying on Figma's injected :root vars — that way the
 * forced palette is deterministic regardless of how/when Figma injects.
 */

export type ThemeMode = 'light' | 'dark';

export function toggleThemeMode(mode: ThemeMode): ThemeMode {
  return mode === 'light' ? 'dark' : 'light';
}

/**
 * Read Figma's current theme synchronously. Figma adds a `figma-dark` /
 * `figma-light` class to <html> when themeColors is on; we fall back to the
 * luminance of the injected --figma-color-bg, then to light.
 */
export function detectFigmaTheme(): ThemeMode {
  const cls = document.documentElement.className;
  if (/figma-dark/.test(cls)) return 'dark';
  if (/figma-light/.test(cls)) return 'light';
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue('--figma-color-bg')
    .trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(bg);
  if (m) {
    const n = parseInt(m[1], 16);
    const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    return lum < 128 ? 'dark' : 'light';
  }
  return 'light';
}

// Crisp 24-viewBox line icons, stroked with currentColor. The icon previews the
// theme a click will switch to; the title spells out the same action.
const ICONS: Record<ThemeMode, string> = {
  light:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  dark:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4"/>' +
    '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
};

const LABELS: Record<ThemeMode, string> = {
  light: 'Switch to dark theme',
  dark: 'Switch to light theme',
};

/** Apply a theme mode: set body[data-theme] and refresh the button affordance. */
export function applyThemeMode(btn: HTMLButtonElement, mode: ThemeMode): void {
  document.body.dataset.theme = mode;
  btn.innerHTML = ICONS[mode];
  btn.title = LABELS[mode];
}
