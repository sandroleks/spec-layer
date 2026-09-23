import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXTRACTOR_VERSION } from '@spec-layer/extractor';
import { THEME_PRESETS } from '../src/brandColors';
import { DOCS_URL } from '../src/ui/proxy';
import {
  FONT_DEFAULT_LABEL,
  FONT_DEFAULT_VALUE,
  SETTINGS_TABS,
  fontMenuMarkup,
  isSettingsTab,
  settingsHeaderMarkup,
  settingsScrollMarkup,
} from '../src/ui/screens/settings';

describe('settings screen presentation', () => {
  it('titles the page without claiming it is only frame appearance', () => {
    // About is not frame appearance, and the "Frame theme" heading directly
    // below already said it, so the subtitle was both wrong and a repeat.
    const markup = settingsHeaderMarkup();
    expect(markup).toContain('<h1>Settings</h1>');
    expect(markup).not.toContain('Generated frame appearance');
  });

  it('shows five frame-theme choices with Tech selected', () => {
    const markup = settingsScrollMarkup({
      theme: { ...THEME_PRESETS[2].theme },
      customMode: false,
      logoAttached: false,
      pluginVersion: '5.0.0',
    });
    expect(markup.match(/data-theme-preset=/g)).toHaveLength(5);
    expect(markup).toContain('data-theme-preset="Tech" aria-pressed="true"');
    expect(markup).not.toContain('sl-custom-theme-controls');
    expect(markup).toContain('Use selection as logo');
    expect(markup).toContain('Optional. Appears in the header of your docs the next time you create or update them.');
    expect(markup).toContain('aria-label="Tech doc theme"');
  });

  it('renders custom color/font controls and attached-logo actions', () => {
    const markup = settingsScrollMarkup({
      theme: { ...THEME_PRESETS[0].theme },
      customMode: true,
      logoAttached: true,
      pluginVersion: '5.0.0',
      colorError: 'Enter a valid color.',
    });
    expect(markup).toContain('sl-custom-theme-controls');
    expect(markup).toContain('value="#0f172a"');
    expect(markup).toContain('aria-label="Heading font"');
    expect(markup).toContain('Replace with selection');
    expect(markup).toContain('Logo added');
    expect(markup).toContain('Enter a valid color.');
  });
});

/**
 * Logo used to be an uppercase `<h3>` nested inside the frame-theme section,
 * so it read as a caps label among two sentence-case headings and claimed to
 * be part of frame theming. It is a peer of Frame theme and About, and its
 * heading is the same one they use.
 */
describe('logo section', () => {
  const state = {
    theme: { ...THEME_PRESETS[0].theme },
    customMode: false,
    logoAttached: false,
    pluginVersion: '5.0.0',
  };

  it('heads Logo with the shared section heading, not a caps label', () => {
    const markup = settingsScrollMarkup(state);
    expect(markup).toContain(
      '<div class="sl-settings-section-heading"><h2 id="sl-logo-heading">Logo</h2>',
    );
    expect(markup).not.toContain('<h3 id="sl-logo-heading">');
  });

  it('sits beside Frame theme rather than inside it', () => {
    const markup = settingsScrollMarkup(state);
    const theme = markup.indexOf('sl-frame-theme-section');
    const logo = markup.indexOf('sl-logo-setting');
    expect(theme).toBeGreaterThan(-1);
    expect(theme).toBeLessThan(logo);
    // The frame-theme section closes before Logo opens.
    expect(markup.slice(theme, logo)).toContain('</section>');
  });

  it('keeps the heading as the accessible name for the section', () => {
    const markup = settingsScrollMarkup(state);
    expect(markup).toContain('aria-labelledby="sl-logo-heading"');
    expect(markup).toContain('id="sl-logo-heading"');
  });
});

/**
 * The vNext Settings migration shipped the two font fields as bare inputs, so
 * the only way to set one was to type a family name exactly right; the host's
 * font list was fetched and then used for nothing but a warning afterwards. The
 * integration plan's Phase 6 says to keep the picker, so these pin the combobox
 * back in place. The list itself is an overlay, rendered by fontMenuMarkup.
 */
describe('font fields', () => {
  const state = {
    theme: { ...THEME_PRESETS[0].theme },
    customMode: true,
    logoAttached: false,
    pluginVersion: '5.0.0',
  };

  it('renders each font field as a combobox with a browse affordance', () => {
    const markup = settingsScrollMarkup(state);
    for (const field of ['headingFont', 'bodyFont']) {
      expect(markup).toContain(`data-theme-font="${field}"`);
      expect(markup).toContain(`data-font-toggle="${field}"`);
    }
    expect(markup).toMatch(/role="combobox"/);
    expect(markup.match(/aria-autocomplete="list"/g)).toHaveLength(2);
    // The chevron is a pointer affordance, not a second tab stop per field.
    // Scoped to the toggles: the colour swatches opt out for the same reason.
    expect(markup.match(/tabindex="-1" data-font-toggle=/g)).toHaveLength(2);
  });

  it('reports which field has its list open, and only that one', () => {
    const open = settingsScrollMarkup({ ...state, fontMenuField: 'bodyFont' });
    expect(open).toContain('data-theme-font="bodyFont" aria-label="Body font"');
    expect(open.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(open.match(/aria-expanded="false"/g)).toHaveLength(1);
    // Closed by default.
    expect(settingsScrollMarkup(state).match(/aria-expanded="false"/g)).toHaveLength(2);
  });
});

describe('fontMenuMarkup', () => {
  const base = { field: 'headingFont' as const, activeIndex: 0, loaded: true };

  it('always offers the default row first, so a field can be cleared', () => {
    const markup = fontMenuMarkup({ ...base, families: ['Roboto', 'Lato'] });
    const values = [...markup.matchAll(/data-font-value="([^"]*)"/g)].map((m) => m[1]);
    expect(values).toEqual(['', 'Roboto', 'Lato']);
    expect(markup).toContain(FONT_DEFAULT_LABEL);
    expect(FONT_DEFAULT_VALUE).toBe('');
  });

  it('marks the active row for assistive tech and for the highlight', () => {
    const markup = fontMenuMarkup({ ...base, families: ['Roboto', 'Lato'], activeIndex: 2 });
    expect(markup).toContain('id="sl-font-option-2" data-font-index="2" data-font-value="Lato" aria-selected="true"');
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(markup).toContain('role="listbox"');
  });

  it('says why the list is empty, distinguishing no match from no fonts', () => {
    expect(fontMenuMarkup({ ...base, families: [] }))
      .toContain('No font matches that name.');
    expect(fontMenuMarkup({ ...base, families: [], loaded: false }))
      .toContain('Figma hasn’t listed any fonts yet. Type a family name instead.');
    // A loaded list with matches says neither.
    const ok = fontMenuMarkup({ ...base, families: ['Roboto'] });
    expect(ok).not.toContain('No font matches');
    expect(ok).not.toContain('listed any fonts');
  });

  it('escapes family names before placing them in markup', () => {
    const markup = fontMenuMarkup({ ...base, families: ['A "Quoted" & <Odd>'] });
    expect(markup).toContain('data-font-value="A &quot;Quoted&quot; &amp; &lt;Odd&gt;"');
    expect(markup).not.toContain('<Odd>');
  });

  it('carries no scrim, so the panel stays usable behind the list', () => {
    // A scrim over the field turns a click meant to place the caret into a
    // close, whose focus restore then reopens the list.
    const markup = fontMenuMarkup({ ...base, families: ['Roboto'] });
    expect(markup).not.toContain('scrim');
    expect(markup).toContain('data-font-menu-field="headingFont"');
  });
});

/**
 * The swatch used to be an inert `<i>`, so the only way to set a colour was to
 * know its hex and type it. It is a native picker now, which is also why the
 * lowercase guarantee below matters: `type="color"` sanitizes anything that is
 * not `#rrggbb` to #000000, and the field would silently read as black.
 */
describe('colour swatches', () => {
  const state = {
    theme: { ...THEME_PRESETS[0].theme },
    customMode: true,
    logoAttached: false,
    pluginVersion: '5.0.0',
  };

  it('renders every swatch as a real colour input paired with its hex field', () => {
    const markup = settingsScrollMarkup(state);
    const fields = ['headerBg', 'accent', 'bodyText', 'tableHeadBg'];
    for (const field of fields) {
      expect(markup).toContain(`type="color" data-theme-swatch="${field}"`);
      expect(markup).toContain(`data-theme-field="${field}"`);
    }
    expect(markup.match(/type="color"/g)).toHaveLength(fields.length);
    // The inert preview it replaces is gone, not left behind beside it.
    expect(markup).not.toMatch(/<i style="background:/);
  });

  it('gives each swatch a spec-valid lowercase value', () => {
    const markup = settingsScrollMarkup(state);
    const values = [...markup.matchAll(/data-theme-swatch="[^"]+" tabindex="-1" [^>]*value="([^"]*)"/g)]
      .map((m) => m[1]);
    expect(values).toHaveLength(4);
    for (const value of values) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('labels the picker distinctly from the hex field it sits in', () => {
    const markup = settingsScrollMarkup(state);
    // Two controls, one row: they must not read as the same thing twice.
    expect(markup).toContain('aria-label="Pick Header background color"');
    expect(markup).toContain('aria-label="Header background color"');
  });

  it('keeps the hex field ahead of the swatch, so the label still targets it', () => {
    // A <label>'s control is its first labelable descendant. An <input
    // type="color"> is labelable where the inert <i> it replaced was not, so
    // putting the swatch first turns a click on "Header background" into an OS
    // picker rather than a caret in the hex field. The CSS puts the swatch back
    // in column one, so source order is free to serve the label.
    const markup = settingsScrollMarkup(state);
    const field = markup.indexOf('data-theme-field="headerBg"');
    const swatch = markup.indexOf('data-theme-swatch="headerBg"');
    expect(field).toBeGreaterThan(-1);
    expect(field).toBeLessThan(swatch);
  });
});

/**
 * The version had nowhere to be read. It is stamped into every connected
 * document as `pluginVersion`, and TESTING.md's release gate asks for the
 * published version to match it, but the plugin never showed it on screen.
 *
 * The extractor version rides along because it answers a different question:
 * a Library that reports "rebuild needed" on every row is an EXTRACTOR_VERSION
 * bump, and the plugin version alone cannot tell you that.
 */
describe('about section', () => {
  const state = {
    theme: { ...THEME_PRESETS[0].theme },
    customMode: false,
    logoAttached: false,
    tab: 'about' as const,
  };

  it('labels each version, so a bare number cannot read as something else', () => {
    // "Spec Layer 5.0.0" over "Extractor 2" said neither what the numbers
    // were nor what the second one counted.
    const markup = settingsScrollMarkup({ ...state, pluginVersion: '5.0.0' });
    // The tab names the panel, so the section carries no heading of its own.
    expect(markup).not.toContain('<h2>About</h2>');
    expect(markup).toContain('<dt>Plugin version</dt><dd>5.0.0</dd>');
    expect(markup).toContain(`<dt>Extractor version</dt><dd>${EXTRACTOR_VERSION}</dd>`);
    // Its own panel: About is not frame appearance.
    expect(markup).toContain('sl-about-section');
    expect(markup).not.toContain('sl-frame-theme-section');
  });

  it('drops the whole plugin row rather than guessing at an unstamped build', () => {
    // pluginBuild() is null whenever the esbuild define is absent. Never
    // fabricate: no 0.0.0, no runtime read of package.json.
    const markup = settingsScrollMarkup({ ...state, pluginVersion: null });
    expect(markup).toContain('sl-about-section');
    expect(markup).not.toContain('Plugin version');
    expect(markup).toContain(`<dt>Extractor version</dt><dd>${EXTRACTOR_VERSION}</dd>`);
  });

  it('links to the guide the way the rail links out', () => {
    const markup = settingsScrollMarkup({ ...state, pluginVersion: '5.0.0' });
    expect(markup).toContain(`href="${DOCS_URL}"`);
    expect(markup).toContain('target="_blank" rel="noopener"');
    expect(markup).toContain('Read the guide');
    // "docs" means what the plugin makes; Spec Layer's own help is the guide.
    expect(markup).not.toContain('Documentation');
  });

  it('renders the versions as plain selectable text, with no copy button', () => {
    const markup = settingsScrollMarkup({ ...state, pluginVersion: '5.0.0' });
    const start = markup.indexOf('sl-about-section');
    expect(start).toBeGreaterThan(-1);
    const about = markup.slice(start);
    expect(about).not.toContain('<button');
  });
});

/**
 * Settings was one long page, and the Custom theme alone adds six fields
 * above everything else. Tabs keep each group on a short panel. One panel
 * serves every tab and only the selected tab's content is drawn; the strip
 * lives in the page header so it stays put while the panel scrolls.
 */
describe('settings tabs', () => {
  const state = {
    theme: { ...THEME_PRESETS[0].theme },
    customMode: false,
    logoAttached: false,
    pluginVersion: '5.0.0',
  };

  it('draws a tab strip under the title, Frames first and selected by default', () => {
    const markup = settingsHeaderMarkup();
    expect(markup).toContain('role="tablist" aria-label="Settings"');
    const ids = [...markup.matchAll(/data-settings-tab="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(SETTINGS_TABS.map((tab) => tab.id));
    expect(ids[0]).toBe('frames');
    expect(markup.indexOf('<h1>Settings</h1>')).toBeLessThan(markup.indexOf('role="tablist"'));
    expect(markup).toContain(
      'id="sl-settings-tab-frames" data-settings-tab="frames" aria-selected="true" ' +
      'aria-controls="sl-settings-panel" tabindex="0"',
    );
  });

  it('marks exactly one tab selected and gives only that one a tab stop', () => {
    const markup = settingsHeaderMarkup('about');
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(markup).toContain('data-settings-tab="about" aria-selected="true"');
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(SETTINGS_TABS.length - 1);
  });

  it('labels the one panel with the selected tab', () => {
    expect(settingsScrollMarkup(state)).toContain(
      'role="tabpanel" id="sl-settings-panel" aria-labelledby="sl-settings-tab-frames"',
    );
    expect(settingsScrollMarkup({ ...state, tab: 'about' })).toContain(
      'aria-labelledby="sl-settings-tab-about"',
    );
  });

  it('draws only the selected tab: Frames holds theme and logo, About the versions', () => {
    const frames = settingsScrollMarkup(state);
    expect(frames).toContain('sl-frame-theme-section');
    expect(frames).toContain('sl-logo-setting');
    expect(frames).not.toContain('sl-about-section');
    const about = settingsScrollMarkup({ ...state, tab: 'about' });
    expect(about).toContain('sl-about-section');
    expect(about).not.toContain('sl-frame-theme-section');
    expect(about).not.toContain('sl-logo-setting');
  });

  it('knows its own tab ids and nothing else', () => {
    for (const { id } of SETTINGS_TABS) expect(isSettingsTab(id)).toBe(true);
    expect(isSettingsTab('Frames')).toBe(false);
    expect(isSettingsTab('')).toBe(false);
  });

  /**
   * A tab moves between panels; a segmented pill picks a value. The Export
   * tab's format choice is a pill, so tabs drawn as one too read as a second
   * setting stacked above the first. Tabs are underline tabs instead.
   */
  it('draws the tabs as underline tabs, not the pill a setting uses', () => {
    const header = settingsHeaderMarkup();
    expect(header).toContain('<div class="sl-tabs sl-settings-tabs" role="tablist" aria-label="Settings">');
    expect(header).not.toContain('sl-segmented');
    expect(settingsScrollMarkup({ ...state, tab: 'export' }))
      .toContain('<div class="sl-segmented" role="radiogroup"');
  });

  it('marks the selected tab with an accent underline, and no pill surface', () => {
    const components = readFileSync(
      new URL('../src/ui/design-system/components.css', import.meta.url), 'utf-8',
    );
    const selected = components.match(/\n\.sl-tabs > \[role="tab"\]\[aria-selected="true"\] \{([^}]*)\}/);
    expect(selected?.[1]).toMatch(/border-bottom-color:\s*var\(--sl-color-accent\)/);
    expect(selected?.[1]).not.toMatch(/box-shadow|background/);
    expect(components).toMatch(/\n\.sl-tabs \{[^}]*border-bottom:\s*1px solid var\(--sl-color-border\)/);
  });

  /**
   * The strip's hairline is a divider, so the panel under it keeps the room
   * every section divider on this screen keeps under its line: 14px, which
   * is the header's own 6px bottom padding plus the panel's 8px. With no
   * panel padding the first heading sat 6px under the line.
   */
  it('leaves the same room under the tab strip as under a section divider', () => {
    const patterns = readFileSync(
      new URL('../src/ui/design-system/patterns.css', import.meta.url), 'utf-8',
    );
    expect(patterns).toMatch(/\n\.sl-settings-panel \{[^}]*padding-top:\s*var\(--sl-space-8\)/);
    expect(patterns).toMatch(/\n\.sl-page-header \{[^}]*padding:\s*var\(--sl-space-10\) var\(--sl-space-12\) var\(--sl-space-6\)/);
    expect(patterns).toMatch(/\n\.sl-about-section \{[^}]*padding-top:\s*var\(--sl-space-14\)|\n\.sl-logo-setting,\n\.sl-about-section \{[^}]*padding-top:\s*var\(--sl-space-14\)/);
  });
});

/**
 * Export holds the one choice about how component context leaves the plugin.
 * It is a radio group, not two buttons, so assistive tech reads it as one
 * choice with two options; the roving tabindex keeps it one Tab stop.
 */
describe('export tab', () => {
  const state = {
    theme: { ...THEME_PRESETS[0].theme },
    customMode: false,
    logoAttached: false,
    pluginVersion: '5.0.0',
    tab: 'export' as const,
  };

  it('sits between Frames and About', () => {
    expect(SETTINGS_TABS.map((tab) => tab.label)).toEqual(['Frames', 'Export', 'About']);
  });

  it('offers YAML and Markdown as a radio group named by its heading, YAML checked by default', () => {
    const markup = settingsScrollMarkup(state);
    expect(markup).toContain('<h2 id="sl-component-format-heading">Component format</h2>');
    expect(markup).toContain('role="radiogroup" aria-labelledby="sl-component-format-heading"');
    expect(markup).toContain('data-component-format="yaml" aria-checked="true" tabindex="0">YAML</button>');
    expect(markup).toContain('data-component-format="md" aria-checked="false" tabindex="-1">Markdown</button>');
  });

  it('checks Markdown when that is the stored choice', () => {
    const markup = settingsScrollMarkup({ ...state, componentFormat: 'md' });
    expect(markup).toContain('data-component-format="md" aria-checked="true" tabindex="0"');
    expect(markup).toContain('data-component-format="yaml" aria-checked="false" tabindex="-1"');
  });

  it('says what the choice changes, and that Foundations do not change', () => {
    const markup = settingsScrollMarkup(state);
    expect(markup).toContain(
      'How Copy for AI, the snapshot download, and the developer setup command write components.',
    );
    expect(markup).toContain(
      'YAML is compact and carries machine fields such as IDs. Markdown reads as a page and leaves those out.',
    );
    expect(markup).toContain('Foundations always export as a DTCG JSON document.');
  });

  it('never shows the CLI value md, and uses no em dash', () => {
    const markup = settingsScrollMarkup({ ...state, componentFormat: 'md' });
    const text = markup.replace(/<[^>]*>/g, ' ');
    expect(text).not.toMatch(/\bmd\b/);
    expect(markup).not.toContain('—');
  });

  it('draws only the export section in its panel', () => {
    const markup = settingsScrollMarkup(state);
    expect(markup).toContain('aria-labelledby="sl-settings-tab-export"');
    expect(markup).not.toContain('sl-frame-theme-section');
    expect(markup).not.toContain('sl-about-section');
  });
});
