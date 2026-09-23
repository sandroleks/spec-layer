/**
 * foundations.ts — the flat source picker for generated foundation frames.
 *
 * The selection model and Figma actions stay in actions.ts. This module turns
 * their current values into the approved vNext presentation.
 */

import type { FoundationSpec, FoundationSelection } from '@spec-layer/extractor';
import type { FoundationScreenState } from '../viewModel/contracts';
import {
  allSelected,
  canGenerate,
  collectionMeta,
  effectStyleMeta,
  FOUNDATION_CREATE_LABEL,
  frameCount,
  framesPerSource,
  summarize,
  textStyleMeta,
} from '../foundationState';
import { FOUNDATION_ICON, icon, type IconName } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';
import { loadingRowsMarkup, progressMarkup } from './progress';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function checkbox(checked: boolean, mixed = false): string {
  return (
    `<span class="sl-checkbox-box" data-checked="${checked}"` +
    `${mixed ? ' data-mixed="true"' : ''} aria-hidden="true">` +
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
    'stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
    `<path d="${mixed ? 'M6 12h12' : 'M20 6L9 17l-5-5'}"/></svg></span>`
  );
}

function resultMarkup(state: FoundationScreenState): string {
  if (state.kind === 'error') {
    return `<div class="sl-banner" data-tone="danger">${esc(state.message)}</div>`;
  }
  return '';
}

function footerProgressMarkup(state: FoundationScreenState): string {
  if (state.kind === 'loading') {
    return progressMarkup({
      label: 'Reading this file’s variables and styles',
    });
  }
  if (state.kind === 'generating') {
    // setFoundationGenerating sets a phase from foundationBuildMessages before
    // any paint, so there is no phase-less build to put words to.
    return progressMarkup({
      label: state.phase ?? '',
      current: state.done,
      total: state.total,
    });
  }
  return '';
}

/**
 * Whether the file has anything this screen documents. buildFoundation always
 * returns a spec, so an empty file is a spec with nothing in it, not a null.
 */
function hasSources(spec: FoundationSpec): boolean {
  return spec.collections.length > 0 || spec.textStyles.length > 0 || spec.effectStyles.length > 0;
}

/**
 * An empty file panel whose three slots, a color, a text style, and an effect,
 * fill in after a refresh: the move this screen is waiting for. Decorative,
 * so hidden from assistive tech; the heading carries the message.
 */
const EMPTY_ILLUSTRATION =
  '<svg class="sl-empty-illustration sl-found-illustration" viewBox="0 0 160 112" width="160" height="112" ' +
  'fill="none" aria-hidden="true" focusable="false">' +
  '<rect x="18" y="16" width="112" height="80" rx="8" class="sl-empty-sheet"/>' +
  '<rect x="30" y="27" width="30" height="4" rx="2" class="sl-empty-line is-strong"/>' +
  '<rect x="30" y="40" width="26" height="26" rx="6" class="sl-found-slot"/>' +
  '<rect x="61" y="40" width="26" height="26" rx="6" class="sl-found-slot"/>' +
  '<rect x="92" y="40" width="26" height="26" rx="6" class="sl-found-slot"/>' +
  '<g class="sl-found-fill is-color">' +
  '<rect x="30" y="40" width="26" height="26" rx="6" class="sl-found-swatch"/>' +
  '<circle cx="43" cy="53" r="6.5" class="sl-found-dot"/>' +
  '</g>' +
  '<g class="sl-found-fill is-type">' +
  '<rect x="61" y="40" width="26" height="26" rx="6" class="sl-empty-tile"/>' +
  '<text x="74" y="57.5" text-anchor="middle" class="sl-found-type">Aa</text>' +
  '</g>' +
  '<g class="sl-found-fill is-effect">' +
  '<rect x="92" y="40" width="26" height="26" rx="6" class="sl-empty-tile"/>' +
  '<rect x="100" y="50" width="13" height="10" rx="2" class="sl-found-shadow"/>' +
  '<rect x="97" y="47" width="13" height="10" rx="2" class="sl-found-card"/>' +
  '</g>' +
  '<rect x="30" y="76" width="50" height="3" rx="1.5" class="sl-empty-line"/>' +
  '<rect x="30" y="83" width="34" height="3" rx="1.5" class="sl-empty-line"/>' +
  '<circle cx="130" cy="90" r="12" class="sl-found-badge"/>' +
  '<g transform="translate(121 81) scale(0.75)">' +
  '<g class="sl-found-refresh">' +
  '<path d="M20 11a8.1 8.1 0 0 0-15.5-2m-.5-5v5h5"/>' +
  '<path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 5v-5h-5"/>' +
  '</g></g>' +
  '</svg>';

/**
 * Shown for a file with no local collections, text styles, or effect styles.
 * The reader only sees local ones (foundationReader.ts), so the second line
 * sends a designer whose tokens come from a linked library to the file that
 * owns them rather than letting "no variables" read as a bug.
 */
const EMPTY_STATE =
  '<div class="sl-empty-state sl-empty-illustrated">' +
  EMPTY_ILLUSTRATION +
  '<strong>No local variables or styles</strong>' +
  '<p>Foundations documents the variable collections, text styles, and effect styles ' +
  'made in this file.</p>' +
  '<p class="sl-empty-hint">Using a linked library? Open its source file to document it.</p>' +
  '<div class="sl-empty-actions">' +
  '<button class="sl-button" data-tone="quiet" type="button" data-empty-nav="component">' +
  `${icon('puzzle', 15)}<span>Document a component</span></button>` +
  '</div>' +
  '</div>';

function sourceRow(options: {
  id: string;
  name: string;
  meta: string;
  checked: boolean;
  iconName: IconName;
  textStyles?: boolean;
  effectStyles?: boolean;
  busy: boolean;
}): string {
  // One constant label for a toggle: aria-pressed carries the state, so a
  // label that flipped with it would announce "Remove Color from docs,
  // pressed".
  return (
    '<article class="sl-foundation-row">' +
    `<button class="sl-foundation-summary" type="button" data-foundation-source="${esc(options.id)}"` +
    `${options.textStyles ? ' data-text-styles="true"' : ''}` +
    `${options.effectStyles ? ' data-effect-styles="true"' : ''} aria-pressed="${options.checked}" ` +
    `aria-label="Include ${esc(options.name)} in docs">` +
    checkbox(options.checked) +
    `<span class="sl-foundation-source-icon">${icon(options.iconName, 17)}</span>` +
    '<span class="sl-foundation-title">' +
    `<strong>${esc(options.name)}</strong><small>${esc(options.meta)}</small>` +
    '</span></button>' +
    // A sibling of the checkbox button, never inside it: a copy must not
    // toggle inclusion. One collection is what an agent usually needs, and
    // it stays well under the size the whole-file copy reaches.
    `<button class="sl-icon-button sl-foundation-copy" type="button" data-foundation-copy="${esc(options.id)}"` +
    `${options.textStyles ? ' data-text-styles="true"' : ''}` +
    `${options.effectStyles ? ' data-effect-styles="true"' : ''}` +
    ` aria-label="Copy ${esc(options.name)} for AI" title="Copy for AI"${options.busy ? ' disabled' : ''}>` +
    `${icon('copy', 17)}</button>` +
    '</article>'
  );
}

export function foundationHeaderMarkup(): string {
  return '<div class="sl-page-header-copy"><h1>Foundations</h1></div>';
}

export function foundationScrollMarkup(
  state: FoundationScreenState,
  spec: FoundationSpec | null,
  selection: FoundationSelection,
  refreshing = false,
): string {
  if (state.kind === 'loading') {
    return (
      '<div class="sl-foundation-loading">' +
      loadingRowsMarkup(4) +
      '</div>'
    );
  }
  if (!spec) {
    if (state.kind === 'error') return resultMarkup(state);
    return EMPTY_STATE;
  }
  // An empty file, not a missing read: no toolbar, no "0 of 0 included".
  // A failed refresh keeps its banner above the empty state.
  if (!hasSources(spec)) return resultMarkup(state) + EMPTY_STATE;

  const summary = summarize(spec);
  // 'loading' already returned above, so 'generating' or an in-flight
  // refresh are what remains busy here, matching the footer.
  const busy = state.kind === 'generating' || refreshing;
  const frames = framesPerSource(spec);
  const selectedCount = selection.collections.length +
    (selection.textStyles && summary.textStyleCount > 0 ? 1 : 0) +
    (selection.effectStyles && summary.effectStyleCount > 0 ? 1 : 0);
  const total = summary.collectionCount + (summary.textStyleCount > 0 ? 1 : 0) +
    (summary.effectStyleCount > 0 ? 1 : 0);
  const every = total > 0 && allSelected(spec, selection);
  const mixed = selectedCount > 0 && !every;

  const rows = summary.collections.map((collection) => {
    const picked = selection.collections.some((item) => item.collectionId === collection.id);
    return sourceRow({
      id: collection.id,
      name: collection.name,
      meta: collectionMeta(collection, frames.collections[collection.id] ?? 0),
      checked: picked,
      iconName: FOUNDATION_ICON[collection.iconKind],
      busy,
    });
  });
  if (summary.textStyleCount > 0) {
    rows.push(sourceRow({
      id: 'text-styles',
      name: 'Text styles',
      meta: textStyleMeta(summary.textStyleCount, frames.textStyles),
      checked: selection.textStyles,
      iconName: FOUNDATION_ICON.typography,
      textStyles: true,
      busy,
    }));
  }
  if (summary.effectStyleCount > 0) {
    rows.push(sourceRow({
      id: 'effect-styles',
      name: 'Effect styles',
      meta: effectStyleMeta(summary.effectStyleCount, frames.effectStyles),
      checked: selection.effectStyles,
      iconName: FOUNDATION_ICON.effect,
      effectStyles: true,
      busy,
    }));
  }

  return (
    '<div class="sl-foundation-toolbar">' +
    `<span aria-live="polite">${selectedCount} of ${total} included</span>` +
    '<button class="sl-foundation-bulk" type="button" data-foundation-bulk ' +
    `aria-label="${every ? 'Clear' : 'Select'} all foundation sources">` +
    checkbox(every, mixed) +
    `<span>${every ? 'Clear all' : 'Select all'}</span></button></div>` +
    `<div class="sl-foundation-status">${resultMarkup(state)}</div>` +
    `<div class="sl-foundation-list">${rows.join('')}</div>`
  );
}

export function foundationFooterMarkup(
  state: FoundationScreenState,
  spec: FoundationSpec | null,
  selection: FoundationSelection,
  refreshing = false,
): string {
  const busy = state.kind === 'loading' || state.kind === 'generating';
  const frames = spec ? frameCount(spec, selection) : 0;
  /**
   * "Select sources to continue" is an instruction, so it may only appear when
   * the user can actually follow it: sources are listed and none are ticked.
   *
   * "Nothing to build" has other causes that are not the user's to fix: the
   * list is still loading, the file has no variables or text styles, or the
   * read failed and the remedy is "Refresh sources" beside it.
   *
   * Everywhere else the button names its act and is simply disabled, the same
   * way the component screen's "Create docs" sits disabled while extraction
   * reads. The reason is already on screen in each case: the progress line, the
   * empty state, or the error banner.
   */
  const nothingTicked = state.kind === 'ready' && spec !== null && hasSources(spec) && frames === 0;
  const label = state.kind === 'generating'
    ? 'Creating docs…'
    : nothingTicked
      ? 'Select sources to continue'
      : FOUNDATION_CREATE_LABEL;
  const progress = footerProgressMarkup(state);
  const refreshLabel = refreshing ? 'Refreshing…' : 'Refresh sources';
  // The whole file, named as such now that every row copies its own
  // collection. Kept one click away: the CLI writes the same document as
  // files, and some agents want the complete vocabulary.
  // An empty file keeps only Refresh sources: copying would hand an agent an
  // empty document, and create has nothing it could ever build.
  const empty = spec !== null && !hasSources(spec);
  const copy = spec && !empty
    ? '<button class="sl-button" data-tone="secondary" id="sl-copy-foundation" type="button">' +
      `${icon('copy', 15)}<span>Copy all for AI</span></button>`
    : '';
  return (
    (progress ? `<div class="sl-footer-progress">${progress}</div>` : '') +
    '<div class="sl-footer-actions">' +
    // Per the icon contract in design-system/components.css: one button, one
    // glyph, held through every state. `filePlus` is the same glyph the
    // component screen's create button wears, because this is the same act on
    // the same object. Its old `layoutGrid` drew frames rather than the making
    // of them and was also the sidebar's glyph for this screen.
    '<button class="sl-button sl-foundation-refresh" data-tone="secondary" ' +
    `type="button" data-foundation-refresh${busy || refreshing ? ' disabled' : ''}>` +
    `${icon('refresh', 15)}<span>${refreshLabel}</span></button>` +
    copy +
    (empty
      ? ''
      : '<button class="sl-button sl-foundation-create" data-tone="primary" ' +
        `id="sl-foundation-create" type="button"${busy || !spec || !canGenerate(selection) ? ' disabled' : ''}>` +
        `${icon('filePlus', 15)}<span>${esc(label)}</span></button>`) +
    '</div>'
  );
}

export function renderFoundationScreen(
  refs: ShellRefs,
  state: FoundationScreenState,
  spec: FoundationSpec | null,
  selection: FoundationSelection,
  refreshing = false,
): void {
  refs.screen.className = 'sl-screen sl-foundation-screen';
  refs.pageHeader.innerHTML = foundationHeaderMarkup();
  refs.pageHeader.hidden = false;
  refs.scroll.innerHTML = foundationScrollMarkup(state, spec, selection, refreshing);
  refs.footer.innerHTML = foundationFooterMarkup(state, spec, selection, refreshing);
  refs.footer.hidden = false;
}
