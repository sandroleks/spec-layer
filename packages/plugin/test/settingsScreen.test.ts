import { describe, expect, it } from 'vitest';
import { THEME_PRESETS } from '../src/brandColors';
import {
  FONT_DEFAULT_LABEL,
  FONT_DEFAULT_VALUE,
  fontMenuMarkup,
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
      .toContain('Figma did not list any fonts. Type a family name instead.');
    // A loaded list with matches says neither.
    const ok = fontMenuMarkup({ ...base, families: ['Roboto'] });
    expect(ok).not.toContain('No font matches');
    expect(ok).not.toContain('did not list');
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
