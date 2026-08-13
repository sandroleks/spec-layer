/**
 * settings.ts — generated-frame appearance controls.
 *
 * This is presentation only. ui-vnext.ts owns persistence and host messages,
 * while brandColors.ts remains the single source of truth for presets,
 * validation, and resolved values.
 */

import {
  THEME_PRESETS,
  matchPreset,
  resolveTheme,
  type BrandTheme,
} from '../../brandColors';
import { icon } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';

export type FontField = 'headingFont' | 'bodyFont';
export type ColorField = 'headerBg' | 'accent' | 'bodyText' | 'tableHeadBg';

export interface SettingsScreenState {
  theme: BrandTheme;
  customMode: boolean;
  logoAttached: boolean;
  logoError?: string;
  colorError?: string;
  fontWarning?: string;
  /** Which font field has its list open, if any. */
  fontMenuField?: FontField | null;
}

/** The "Default (Inter)" row's value: clearing the field back to the default. */
export const FONT_DEFAULT_VALUE = '';
export const FONT_DEFAULT_LABEL = 'Default (Inter)';

export interface FontMenuPresentation {
  field: FontField;
  /** Families to list, already filtered by the query. */
  families: readonly string[];
  /** Index into the rendered rows, where 0 is always the default row. */
  activeIndex: number;
  /** True once the host has listed fonts. False renders the honest fallback. */
  loaded: boolean;
}

/**
 * The font list, as an overlay rather than a child of the field.
 *
 * It renders into the shell root next to the global search palette, for the
 * same two reasons: the settings panel scrolls with `overflow`, which clips an
 * absolutely positioned child, and the list has to be free to flip above the
 * input when it is near the bottom of a short panel. ui-vnext.ts positions it
 * in viewport coordinates with computeMenuPlacement from fontPicker.ts.
 */
export function fontMenuMarkup(model: FontMenuPresentation): string {
  const rows = [
    `<div class="sl-font-option is-default" role="option" id="sl-font-option-0" ` +
    `data-font-index="0" data-font-value="" ` +
    `aria-selected="${model.activeIndex === 0}">${FONT_DEFAULT_LABEL}</div>`,
    ...model.families.map((family, index) => {
      const row = index + 1;
      return (
        `<div class="sl-font-option" role="option" id="sl-font-option-${row}" ` +
        `data-font-index="${row}" data-font-value="${esc(family)}" ` +
        `aria-selected="${model.activeIndex === row}">${esc(family)}</div>`
      );
    }),
  ];
  const empty = !model.loaded
    ? '<p class="sl-font-menu-note">Figma did not list any fonts. Type a family name instead.</p>'
    : model.families.length === 0
      ? '<p class="sl-font-menu-note">No font matches that name.</p>'
      : '';

  // No scrim. A combobox should not block the rest of the panel, and a scrim
  // covering the field turns "click the input to place the caret" into a close,
  // whose focus restore then reopens the list. ui-vnext.ts closes it on an
  // outside click instead.
  return (
    '<div class="sl-font-menu" role="listbox" aria-label="Fonts" data-font-menu ' +
    `data-font-menu-field="${model.field}">` +
    rows.join('') +
    empty +
    '</div>'
  );
}

function fontField(field: FontField, label: string, value: string, open: boolean): string {
  return (
    '<label><span>' + label + '</span>' +
    '<span class="sl-font-input">' +
    `<input data-theme-font="${field}" aria-label="${label}" value="${esc(value)}" ` +
    `role="combobox" aria-expanded="${open}" aria-autocomplete="list" ` +
    'aria-controls="sl-font-menu" autocomplete="off" spellcheck="false">' +
    // tabindex -1: the input already opens the list on focus, so this is a
    // pointer affordance only and must not add a second tab stop per field.
    `<button class="sl-font-toggle" type="button" tabindex="-1" data-font-toggle="${field}" ` +
    `aria-label="Browse fonts for ${label}">${icon('chevronDown', 13)}</button>` +
    '</span></label>'
  );
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The swatch previews the generated frame's header band, so its colours must
 * come from the preset itself rather than a copy in CSS — a copy drifts, and a
 * preview that shows a colour the frame will not use is worse than no preview.
 * White matches `onHeader` in frameKit.ts, which every preset shares.
 */
function themeChoice(
  name: string,
  selected: boolean,
  custom = false,
  theme?: BrandTheme,
): string {
  const slug = name.toLowerCase();
  const preview = custom ? icon('adjustments', 16) : 'Ag';
  // Custom has no preset to preview, so it keeps the neutral token surface.
  const swatch = custom || !theme
    ? ''
    : ` style="background:${esc(resolveTheme(theme).headerBg)};color:#ffffff"`;
  return (
    `<button type="button" class="sl-theme-choice${selected ? ' is-selected' : ''}" ` +
    `data-theme-preset="${custom ? '__custom__' : esc(name)}" aria-pressed="${selected}" ` +
    `aria-label="${esc(name)} frame theme">` +
    `<span class="sl-theme-preview ${slug}"${swatch}>${preview}</span>` +
    `<span>${esc(name)}</span>` +
    `${selected ? `<span class="sl-theme-choice-check">${icon('check', 10)}</span>` : ''}` +
    '</button>'
  );
}

/**
 * The swatch is the picker.
 *
 * It used to be an inert `<i>` that only previewed the hex beside it, so a
 * colour could be chosen exactly one way: by knowing its hex and typing it. A
 * native `type="color"` input is the whole feature, with the OS picker and no
 * custom eyedropper/wheel to build or maintain, and it keeps the field looking
 * like the swatch it replaces (see the CSS, which strips its default chrome).
 *
 * `value` must be a spec-valid lowercase `#rrggbb` or the control silently
 * sanitizes it to #000000 and the field would read as black. Everything here
 * comes through resolveTheme or parseBrandHex, both of which lowercase, so this
 * holds; it is the reason parseBrandHex's `.toLowerCase()` matters beyond tidiness.
 */
function colorField(field: ColorField, label: string, value: string): string {
  return (
    `<label class="sl-theme-color-field"><span>${esc(label)}</span>` +
    '<span class="sl-theme-color-input">' +
    // The hex field comes FIRST in the DOM and the CSS puts the swatch back in
    // column one. A label's control is its first labelable descendant, and an
    // <input type="color"> is labelable where the inert <i> was not, so leading
    // with the swatch quietly turned "click the field's label to type a hex"
    // into "click the label to open the OS picker".
    `<input data-theme-field="${field}" aria-label="${esc(label)} color" ` +
    `value="${esc(value)}" spellcheck="false">` +
    // tabindex -1 for the same reason as the font chevron: the hex field is the
    // labelled, keyboard-complete way in, so this is a pointer affordance and
    // must not add a second tab stop to all four fields.
    `<input type="color" data-theme-swatch="${field}" tabindex="-1" ` +
    `aria-label="Pick ${esc(label)} color" value="${esc(value)}">` +
    '</span></label>'
  );
}

function customControls(state: SettingsScreenState): string {
  if (!state.customMode) return '';
  const resolved = resolveTheme(state.theme);
  return (
    '<section class="sl-custom-theme-controls" aria-labelledby="sl-customize-heading">' +
    '<h3 id="sl-customize-heading">Customize</h3>' +
    '<div class="sl-theme-color-grid">' +
    colorField('headerBg', 'Header background', resolved.headerBg) +
    colorField('accent', 'Accent', resolved.accent) +
    colorField('bodyText', 'Body text', resolved.bodyText) +
    colorField('tableHeadBg', 'Table header', resolved.tableHeadBg) +
    '</div>' +
    '<div class="sl-theme-font-grid">' +
    fontField('headingFont', 'Heading font', resolved.headingFont,
      state.fontMenuField === 'headingFont') +
    fontField('bodyFont', 'Body font', resolved.bodyFont,
      state.fontMenuField === 'bodyFont') +
    '</div>' +
    `<p class="sl-settings-hint" data-settings-color-hint data-tone="danger">${esc(state.colorError ?? '')}</p>` +
    `<p class="sl-settings-hint" data-settings-font-hint data-tone="warning">${esc(state.fontWarning ?? '')}</p>` +
    '</section>'
  );
}

function logoControls(state: SettingsScreenState): string {
  return (
    '<section class="sl-logo-setting" aria-labelledby="sl-logo-heading">' +
    '<h3 id="sl-logo-heading">Logo</h3>' +
    '<p>Optional. Appears in the header of generated frames.</p>' +
    '<div class="sl-logo-actions">' +
    '<button class="sl-button" data-tone="secondary" type="button" data-settings-logo-capture>' +
    `${state.logoAttached ? 'Replace with selected node' : 'Use selected node as logo'}</button>` +
    `${state.logoAttached ? '<button class="sl-button" data-tone="quiet" type="button" data-settings-logo-remove>Remove</button>' : ''}` +
    `${state.logoAttached ? `<span class="sl-logo-status">${icon('check', 13)}Logo added</span>` : ''}` +
    '</div>' +
    `${state.logoError ? `<p class="sl-settings-hint" data-tone="danger">${esc(state.logoError)}</p>` : ''}` +
    '</section>'
  );
}

export function settingsHeaderMarkup(): string {
  return (
    '<div class="sl-page-header-copy"><h1>Settings</h1>' +
    '<p>Generated frame appearance</p></div>'
  );
}

export function settingsScrollMarkup(state: SettingsScreenState): string {
  const preset = matchPreset(state.theme);
  return (
    '<section class="sl-settings-section sl-frame-theme-section">' +
    '<div class="sl-settings-section-heading"><h2>Frame theme</h2>' +
    '<p>Choose a theme for generated documentation frames.</p></div>' +
    '<div class="sl-theme-grid" role="group" aria-label="Frame theme">' +
    THEME_PRESETS.map((item) =>
      themeChoice(
        item.name,
        !state.customMode && preset === item.name,
        false,
        item.theme,
      ),
    ).join('') +
    themeChoice('Custom', state.customMode, true) +
    '</div>' +
    customControls(state) +
    logoControls(state) +
    '</section>'
  );
}

export function renderSettingsScreen(
  refs: ShellRefs,
  state: SettingsScreenState,
): void {
  refs.screen.className = 'sl-screen sl-settings-screen';
  refs.pageHeader.innerHTML = settingsHeaderMarkup();
  refs.pageHeader.hidden = false;
  refs.scroll.innerHTML = settingsScrollMarkup(state);
  refs.footer.hidden = true;
}
