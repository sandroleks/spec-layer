/**
 * Light and dark theming for the plugin UI. The initial mode is read from
 * Figma's host theme synchronously at boot, so the first paint is right, and
 * the header toggle overrides it for the session. Nothing is persisted: an
 * async clientStorage read would bring back a flash. applyThemeMode always sets
 * body[data-theme] (design-system/tokens.css), so the palette does not depend
 * on when Figma injects its :root vars.
 */

export type ThemeMode = 'light' | 'dark';

export function toggleThemeMode(mode: ThemeMode): ThemeMode {
  return mode === 'light' ? 'dark' : 'light';
}

/**
 * Read Figma's theme synchronously: the `figma-dark` / `figma-light` class on
 * <html> (with themeColors on), else the luminance of --figma-color-bg, else light.
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

/**
 * Calls `onChange` with Figma's theme whenever it changes while the plugin is
 * open: Figma swaps the `figma-dark` / `figma-light` class on <html> without
 * reloading the iframe, so a theme read only at boot went stale. Returns the
 * function that stops watching.
 */
export function watchFigmaTheme(onChange: (mode: ThemeMode) => void): () => void {
  let last = detectFigmaTheme();
  const observer = new MutationObserver(() => {
    const next = detectFigmaTheme();
    if (next === last) return;
    last = next;
    onChange(next);
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  return () => observer.disconnect();
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
