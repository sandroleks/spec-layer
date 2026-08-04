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

export interface SettingsScreenState {
  theme: BrandTheme;
  customMode: boolean;
  logoAttached: boolean;
  logoError?: string;
  colorError?: string;
  fontWarning?: string;
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

function colorField(
  field: 'headerBg' | 'accent' | 'bodyText' | 'tableHeadBg',
  label: string,
  value: string,
): string {
  return (
    `<label class="sl-theme-color-field"><span>${esc(label)}</span>` +
    '<span class="sl-theme-color-input">' +
    `<i style="background:${esc(value)}" aria-hidden="true"></i>` +
    `<input data-theme-field="${field}" aria-label="${esc(label)} color" ` +
    `value="${esc(value)}" spellcheck="false"></span></label>`
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
    '<label><span>Heading font</span>' +
    `<input data-theme-font="headingFont" aria-label="Heading font" value="${esc(resolved.headingFont)}"></label>` +
    '<label><span>Body font</span>' +
    `<input data-theme-font="bodyFont" aria-label="Body font" value="${esc(resolved.bodyFont)}"></label>` +
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
