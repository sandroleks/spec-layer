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
  createButtonLabel,
  frameCount,
  framesPerSource,
  summarize,
  textStyleMeta,
} from '../foundationState';
import { icon } from '../shell/icons';
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
      label: 'Reading this file',
    });
  }
  if (state.kind === 'generating') {
    return progressMarkup({
      label: state.phase ?? 'Creating foundation frames',
      current: state.done,
      total: state.total,
    });
  }
  return '';
}

function sourceRow(options: {
  id: string;
  name: string;
  meta: string;
  checked: boolean;
  textStyles?: boolean;
}): string {
  const action = options.checked ? 'Remove' : 'Include';
  return (
    '<article class="sl-foundation-row">' +
    `<button class="sl-foundation-summary" type="button" data-foundation-source="${esc(options.id)}"` +
    `${options.textStyles ? ' data-text-styles="true"' : ''} aria-pressed="${options.checked}" ` +
    `aria-label="${action} ${esc(options.name)} ${options.checked ? 'from' : 'in'} docs">` +
    checkbox(options.checked) +
    `<span class="sl-foundation-source-icon">${icon('puzzle', 17)}</span>` +
    '<span class="sl-foundation-title">' +
    `<strong>${esc(options.name)}</strong><small>${esc(options.meta)}</small>` +
    '</span></button></article>'
  );
}

export function foundationHeaderMarkup(): string {
  return '<div class="sl-page-header-copy"><h1>Foundation documents</h1></div>';
}

export function foundationScrollMarkup(
  state: FoundationScreenState,
  spec: FoundationSpec | null,
  selection: FoundationSelection,
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
    return (
      '<div class="sl-empty-state"><strong>No foundation sources</strong>' +
      '<p>This file has no local variable collections or text styles.</p></div>'
    );
  }

  const summary = summarize(spec);
  const frames = framesPerSource(spec);
  const selectedCount = selection.collections.length +
    (selection.textStyles && summary.textStyleCount > 0 ? 1 : 0);
  const total = summary.collectionCount + (summary.textStyleCount > 0 ? 1 : 0);
  const every = total > 0 && allSelected(spec, selection);
  const mixed = selectedCount > 0 && !every;

  const rows = summary.collections.map((collection) => {
    const picked = selection.collections.some((item) => item.collectionId === collection.id);
    return sourceRow({
      id: collection.id,
      name: collection.name,
      meta: collectionMeta(collection, frames.collections[collection.id] ?? 0),
      checked: picked,
    });
  });
  if (summary.textStyleCount > 0) {
    rows.push(sourceRow({
      id: 'text-styles',
      name: 'Text styles',
      meta: textStyleMeta(summary.textStyleCount, frames.textStyles),
      checked: selection.textStyles,
      textStyles: true,
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
): string {
  const busy = state.kind === 'loading' || state.kind === 'generating';
  const frames = spec ? frameCount(spec, selection) : 0;
  const label = state.kind === 'generating'
    ? 'Creating frames…'
    : frames > 0
      ? createButtonLabel(frames)
      : 'Select sources to continue';
  const progress = footerProgressMarkup(state);
  return (
    (progress ? `<div class="sl-footer-progress">${progress}</div>` : '') +
    '<div class="sl-footer-actions">' +
    '<button class="sl-button sl-foundation-create" data-tone="primary" ' +
    `id="sl-foundation-create" type="button"${busy || !spec || !canGenerate(selection) ? ' disabled' : ''}>` +
    `${esc(label)}</button>` +
    '</div>'
  );
}

export function renderFoundationScreen(
  refs: ShellRefs,
  state: FoundationScreenState,
  spec: FoundationSpec | null,
  selection: FoundationSelection,
): void {
  refs.screen.className = 'sl-screen sl-foundation-screen';
  refs.pageHeader.innerHTML = foundationHeaderMarkup();
  refs.pageHeader.hidden = false;
  refs.scroll.innerHTML = foundationScrollMarkup(state, spec, selection);
  refs.footer.innerHTML = foundationFooterMarkup(state, spec, selection);
  refs.footer.hidden = false;
}
