/**
 * Settings screen markup, presentation only: ui-vnext.ts owns persistence and
 * host messages, and brandColors.ts owns presets, validation and resolved values.
 */

import { EXTRACTOR_VERSION } from '@spec-layer/extractor';
import {
  THEME_PRESETS,
  matchPreset,
  resolveTheme,
  type BrandTheme,
} from '../../brandColors';
import { DOCS_URL } from '../proxy';
import { icon } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';
import {
  COMPONENT_FORMATS,
  COMPONENT_FORMAT_NAME,
  DEFAULT_COMPONENT_FORMAT,
  type ComponentFormat,
} from '../../componentFormat';
import { esc } from '../escape';

export type FontField = 'headingFont' | 'bodyFont';
export type ColorField = 'headerBg' | 'accent' | 'bodyText' | 'tableHeadBg';

/** The Settings tabs, in strip order. */
export type SettingsTab = 'frames' | 'export' | 'about';

export const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: 'frames', label: 'Frames' },
  { id: 'export', label: 'Export' },
  { id: 'about', label: 'About' },
];

export function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.id === value);
}

export interface SettingsScreenState {
  theme: BrandTheme;
  customMode: boolean;
  logoAttached: boolean;
  logoError?: string | undefined;
  colorError?: string | undefined;
  fontWarning?: string | undefined;
  /** Which font field has its list open, if any. */
  fontMenuField?: FontField | null;
  /** The build's stamped plugin version, or null when unstamped; from pluginBuild(). */
  pluginVersion: string | null;
  /** The tab on show. Absent means Frames, where Settings opens. */
  tab?: SettingsTab;
  /** How components leave the plugin. Absent reads as YAML, the default. */
  componentFormat?: ComponentFormat;
  /** Sync to Figma. Absent until main reports, which reads as off and no link. */
  syncOnUpdate?: boolean;
  syncFileUrl?: string | null;
  /** Why the typed file link was refused; cleared by the next save. */
  syncFileUrlError?: string | undefined;
  /** A sync run is planning or writing. */
  syncBusy?: boolean;
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
 * The font list, an overlay in the shell root: the panel's `overflow` would
 * clip a child, and the list must be free to flip above the input. ui-vnext.ts
 * positions it with computeMenuPlacement.
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
    ? '<p class="sl-font-menu-note">Figma hasn’t listed any fonts yet. Type a family name instead.</p>'
    : model.families.length === 0
      ? '<p class="sl-font-menu-note">No font matches that name.</p>'
      : '';

  // No scrim: one over the field would turn "click to place the caret" into a
  // close whose focus restore reopens the list. Outside clicks close it instead.
  return (
    '<div class="sl-font-menu" role="listbox" aria-label="Fonts" data-font-menu ' +
    `data-font-menu-field="${model.field}">` +
    rows.join('') +
    empty +
    '</div>'
  );
}

/**
 * Keeps a font field's `aria-expanded` in sync when the list opens or closes
 * without a repaint (typing opens it through renderFontMenu).
 */
export function syncFontFieldExpanded(root: ParentNode, field: FontField, open: boolean): void {
  root.querySelector<HTMLInputElement>(`[data-theme-font="${field}"]`)
    ?.setAttribute('aria-expanded', String(open));
}

/** Writes the font fallback warning in place; the font list usually lands after Settings paints. */
export function paintFontWarning(root: ParentNode, text: string): void {
  const hint = root.querySelector<HTMLElement>('[data-settings-font-hint]');
  if (hint) hint.textContent = text;
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

/**
 * The swatch previews the frame's header band, so its colours come from the
 * preset itself, never a CSS copy that could drift. White matches `onHeader`
 * in frameKit.ts, which every preset shares.
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
    `aria-label="${esc(name)} doc theme">` +
    `<span class="sl-theme-preview ${slug}"${swatch}>${preview}</span>` +
    `<span>${esc(name)}</span>` +
    `${selected ? `<span class="sl-theme-choice-check">${icon('check', 10)}</span>` : ''}` +
    '</button>'
  );
}

/**
 * The swatch is a native `type="color"` input. Its `value` must be lowercase
 * `#rrggbb` or the control silently shows #000000; resolveTheme and
 * parseBrandHex both lowercase, which is why parseBrandHex's `.toLowerCase()` matters.
 */
function colorField(field: ColorField, label: string, value: string): string {
  return (
    `<label class="sl-theme-color-field"><span>${esc(label)}</span>` +
    '<span class="sl-theme-color-input">' +
    // The hex field comes first in the DOM (CSS puts the swatch back in column
    // one): a label activates its first labelable control, so leading with the
    // color input would make the label open the OS picker.
    `<input data-theme-field="${field}" aria-label="${esc(label)} color" ` +
    `value="${esc(value)}" spellcheck="false">` +
    // tabindex -1 like the font chevron: the hex field is the keyboard way in.
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
    '<section class="sl-settings-section sl-logo-setting" aria-labelledby="sl-logo-heading">' +
    '<div class="sl-settings-section-heading"><h2 id="sl-logo-heading">Logo</h2>' +
    '<p>Optional. Appears in the header of your docs the next time you create or update them.</p></div>' +
    '<div class="sl-logo-actions">' +
    '<button class="sl-button" data-tone="secondary" type="button" data-settings-logo-capture>' +
    `${state.logoAttached ? 'Replace with selection' : 'Use selection as logo'}</button>` +
    `${state.logoAttached ? '<button class="sl-button" data-tone="quiet" type="button" data-settings-logo-remove>Remove</button>' : ''}` +
    `${state.logoAttached ? `<span class="sl-logo-status">${icon('check', 13)}Logo added</span>` : ''}` +
    '</div>' +
    `${state.logoError ? `<p class="sl-settings-hint" data-tone="danger">${esc(state.logoError)}</p>` : ''}` +
    '</section>'
  );
}

/**
 * The Export tab: YAML or Markdown for every way a component leaves the
 * plugin. The hint says what Markdown leaves out, and names Foundations, which
 * the choice does not reach.
 */
function exportSection(format: ComponentFormat): string {
  const radios = COMPONENT_FORMATS.map((value) => {
    const on = value === format;
    return (
      `<button type="button" role="radio" data-component-format="${value}" ` +
      `aria-checked="${on}" tabindex="${on ? '0' : '-1'}">${COMPONENT_FORMAT_NAME[value]}</button>`
    );
  }).join('');
  return (
    '<section class="sl-settings-section sl-component-format-setting" ' +
    'aria-labelledby="sl-component-format-heading">' +
    '<div class="sl-settings-section-heading">' +
    '<h2 id="sl-component-format-heading">Component format</h2>' +
    '<p>How Copy for AI, the snapshot download, and the developer setup command write components.</p>' +
    '</div>' +
    `<div class="sl-segmented" role="radiogroup" aria-labelledby="sl-component-format-heading">${radios}</div>` +
    '<p class="sl-settings-hint">YAML is compact and carries machine fields such as IDs. ' +
    'Markdown reads as a page and leaves those out.</p>' +
    '<p class="sl-settings-hint">Foundations always export as a DTCG JSON document.</p>' +
    '</section>'
  );
}

/**
 * Sync to Figma: the switch for Updates, the file link documentation links
 * are built from, and a run over every documented component. Every run but
 * the automatic one asks first.
 */
function syncSection(state: SettingsScreenState): string {
  const on = state.syncOnUpdate === true;
  const url = state.syncFileUrl ?? '';
  return (
    '<section class="sl-settings-section sl-sync-setting" aria-labelledby="sl-sync-heading">' +
    '<div class="sl-settings-section-heading">' +
    '<h2 id="sl-sync-heading">Sync to Figma</h2>' +
    '<p>Writes each doc’s usage text into the component description and places anatomy annotations, ' +
    'so Dev Mode shows what your docs show. You confirm each run.</p>' +
    '</div>' +
    '<div class="sl-ai-control">' +
    '<span class="sl-ai-control-copy"><strong>Sync again when a doc is updated</strong></span>' +
    '<label class="sl-switch-control">' +
    '<input class="sl-switch-input" id="sl-sync-on-update" type="checkbox" role="switch" ' +
    `aria-label="Sync again when a doc is updated"${on ? ' checked' : ''} />` +
    '<span class="sl-switch-track" aria-hidden="true"><span class="sl-switch-thumb"></span></span>' +
    '</label>' +
    '</div>' +
    '<p class="sl-settings-hint">Only refreshes components you have synced before. ' +
    'Edits made in Figma and text written with AI wait for you to sync them.</p>' +
    '<label class="sl-theme-color-field sl-sync-file-field"><span>File link</span>' +
    `<input id="sl-sync-file-url" data-sync-file-url value="${esc(url)}" spellcheck="false" ` +
    'placeholder="https://www.figma.com/design/…" aria-describedby="sl-sync-file-hint"></label>' +
    '<div class="sl-logo-actions">' +
    '<button class="sl-button" data-tone="secondary" type="button" data-sync-file-save>Save link</button>' +
    (url ? '<button class="sl-button" data-tone="quiet" type="button" data-sync-file-clear>Remove</button>' : '') +
    '</div>' +
    '<p class="sl-settings-hint" id="sl-sync-file-hint">Copy it from Share, then Copy link. ' +
    'Each component’s documentation link then opens its doc. Without it, no link is written.</p>' +
    (state.syncFileUrlError
      ? `<p class="sl-settings-hint" data-tone="danger" role="alert">${esc(state.syncFileUrlError)}</p>`
      : '') +
    '<div class="sl-logo-actions">' +
    `<button class="sl-button" data-tone="primary" type="button" data-sync-all${state.syncBusy ? ' disabled' : ''}>` +
    `${icon('upload', 15)}<span>${state.syncBusy ? 'Syncing…' : 'Sync all components'}</span></button>` +
    '</div>' +
    '</section>'
  );
}

/**
 * The About section: two labelled versions and the way out to the docs. The
 * plugin version is what the TESTING.md release gate compares against the
 * Figma listing; the extractor version is what a Library-wide rebuild request
 * reacts to. Plain text: the iframe already lets you select it.
 */
function aboutSection(state: SettingsScreenState): string {
  // Never fabricate. An unstamped build knows no version, so the row is
  // absent rather than filled with a plausible one.
  const plugin = state.pluginVersion
    ? `<div><dt>Plugin version</dt><dd>${esc(state.pluginVersion)}</dd></div>`
    : '';
  return (
    '<section class="sl-settings-section sl-about-section">' +
    '<dl class="sl-about-versions">' +
    plugin +
    `<div><dt>Extractor version</dt><dd>${esc(EXTRACTOR_VERSION)}</dd></div>` +
    '</dl>' +
    // Shaped like the rail's outbound links, the plugin's way out of the iframe.
    `<a class="sl-about-docs" href="${DOCS_URL}" target="_blank" rel="noopener">` +
    `Read the guide${icon('externalLink', 14)}</a>` +
    '</section>'
  );
}

/**
 * The tab strip, in the page header so it holds still while the panel scrolls.
 * A roving tabindex keeps it one Tab stop. Underline tabs, not `.sl-segmented`,
 * which picks a value and would read as a second setting above Export's.
 */
function settingsTabsMarkup(selected: SettingsTab): string {
  const tabs = SETTINGS_TABS.map(({ id, label }) => {
    const on = id === selected;
    return (
      `<button type="button" role="tab" id="sl-settings-tab-${id}" data-settings-tab="${id}" ` +
      `aria-selected="${on}" aria-controls="sl-settings-panel" tabindex="${on ? '0' : '-1'}">` +
      `${label}</button>`
    );
  }).join('');
  return `<div class="sl-tabs sl-settings-tabs" role="tablist" aria-label="Settings">${tabs}</div>`;
}

export function settingsHeaderMarkup(tab: SettingsTab = 'frames'): string {
  // No subtitle: it would repeat the Frame theme heading and be untrue on About.
  return `<div class="sl-page-header-copy"><h1>Settings</h1>${settingsTabsMarkup(tab)}</div>`;
}

function framesPanel(state: SettingsScreenState): string {
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
    '</section>' +
    logoControls(state)
  );
}

export function settingsScrollMarkup(state: SettingsScreenState): string {
  const tab = state.tab ?? 'frames';
  const body = tab === 'about'
    ? aboutSection(state)
    : tab === 'export'
      ? exportSection(state.componentFormat ?? DEFAULT_COMPONENT_FORMAT) + syncSection(state)
      : framesPanel(state);
  return (
    `<div class="sl-settings-panel" role="tabpanel" id="sl-settings-panel" ` +
    `aria-labelledby="sl-settings-tab-${tab}">${body}</div>`
  );
}

export function renderSettingsScreen(
  refs: ShellRefs,
  state: SettingsScreenState,
): void {
  refs.screen.className = 'sl-screen sl-settings-screen';
  refs.pageHeader.innerHTML = settingsHeaderMarkup(state.tab ?? 'frames');
  refs.pageHeader.hidden = false;
  refs.scroll.innerHTML = settingsScrollMarkup(state);
  refs.footer.hidden = true;
}
