// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_PRESETS } from '../src/brandColors';
import {
  paintFontWarning,
  settingsScrollMarkup,
  syncFontFieldExpanded,
} from '../src/ui/screens/settings';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = settingsScrollMarkup({
    theme: { ...THEME_PRESETS[0].theme },
    customMode: true,
    logoAttached: false,
    pluginVersion: '5.1.0',
    tab: 'frames',
  });
  document.body.append(root);
  return root;
}

describe('font field patches', () => {
  it('reports the list as open on the typed field only', () => {
    const root = mount();
    syncFontFieldExpanded(root, 'headingFont', true);
    expect(root.querySelector('[data-theme-font="headingFont"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('[data-theme-font="bodyFont"]')?.getAttribute('aria-expanded')).toBe('false');
    syncFontFieldExpanded(root, 'headingFont', false);
    expect(root.querySelector('[data-theme-font="headingFont"]')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('paints the fallback warning in place and clears it', () => {
    const root = mount();
    paintFontWarning(root, 'Figma doesn’t list this font.');
    expect(root.querySelector('[data-settings-font-hint]')?.textContent).toBe('Figma doesn’t list this font.');
    paintFontWarning(root, '');
    expect(root.querySelector('[data-settings-font-hint]')?.textContent).toBe('');
  });

  it('does nothing when Frames is not the tab on show', () => {
    const root = document.createElement('div');
    expect(() => {
      syncFontFieldExpanded(root, 'bodyFont', true);
      paintFontWarning(root, 'x');
    }).not.toThrow();
  });
});
