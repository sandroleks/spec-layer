import { describe, expect, it } from 'vitest';
import { THEME_PRESETS } from '../src/brandColors';
import {
  settingsHeaderMarkup,
  settingsScrollMarkup,
} from '../src/ui/screens/settings';

describe('settings screen presentation', () => {
  it('renders the approved title and subtitle', () => {
    const markup = settingsHeaderMarkup();
    expect(markup).toContain('<h1>Settings</h1>');
    expect(markup).toContain('Generated frame appearance');
  });

  it('shows five frame-theme choices with Tech selected', () => {
    const markup = settingsScrollMarkup({
      theme: { ...THEME_PRESETS[2].theme },
      customMode: false,
      logoAttached: false,
    });
    expect(markup.match(/data-theme-preset=/g)).toHaveLength(5);
    expect(markup).toContain('data-theme-preset="Tech" aria-pressed="true"');
    expect(markup).not.toContain('sl-custom-theme-controls');
    expect(markup).toContain('Use selected node as logo');
  });

  it('renders custom color/font controls and attached-logo actions', () => {
    const markup = settingsScrollMarkup({
      theme: { ...THEME_PRESETS[0].theme },
      customMode: true,
      logoAttached: true,
      colorError: 'Enter a valid color.',
    });
    expect(markup).toContain('sl-custom-theme-controls');
    expect(markup).toContain('value="#0f172a"');
    expect(markup).toContain('aria-label="Heading font"');
    expect(markup).toContain('Replace with selected node');
    expect(markup).toContain('Logo added');
    expect(markup).toContain('Enter a valid color.');
  });
});
