/**
 * search.ts — global workflow and connected-document command palette.
 *
 * This is presentation only. The host owns query state, active-pointer
 * movement, activation, Escape/Cmd-K handling, the focus trap, scroll-into-
 * view, and returning focus to the header Search trigger.
 */

import { icon } from '../shell/icons';
import type {
  SearchDocumentResult,
  SearchModel,
  SearchWorkflowResult,
} from '../viewModel/search';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resultId(index: number): string {
  return `sl-global-search-result-${index}`;
}

function workflowResultMarkup(
  result: SearchWorkflowResult,
  activeIndex: number,
): string {
  const active = result.index === activeIndex;
  return (
    `<button class="sl-global-search-result${active ? ' is-active' : ''}" ` +
    `type="button" role="option" id="${resultId(result.index)}" ` +
    `aria-selected="${active}" data-search-index="${result.index}" ` +
    `data-search-kind="workflow" data-search-view="${result.view}">` +
    `<span class="sl-global-search-icon">${icon(result.icon, 15)}</span>` +
    `<span><strong>${esc(result.label)}</strong><small>${esc(result.detail)}</small></span>` +
    `${icon('chevronRight', 14)}</button>`
  );
}

function documentResultMarkup(
  result: SearchDocumentResult,
  activeIndex: number,
): string {
  const active = result.index === activeIndex;
  return (
    `<button class="sl-global-search-result${active ? ' is-active' : ''}" ` +
    `type="button" role="option" id="${resultId(result.index)}" ` +
    `aria-selected="${active}" data-search-index="${result.index}" ` +
    `data-search-kind="document" data-search-doc-id="${esc(result.docId)}">` +
    `<span class="sl-global-search-icon is-source">${icon('puzzle', 15)}</span>` +
    `<span><strong>${esc(result.label)}</strong><small>${esc(result.sourceLabel)}</small></span>` +
    `${icon('chevronRight', 14)}</button>`
  );
}

function resultsMarkup(model: SearchModel, libraryLoading: boolean): string {
  const workflows = model.workflowResults.length
    ? (
      '<section aria-labelledby="sl-global-search-workflows">' +
      '<h2 id="sl-global-search-workflows">Workflows</h2>' +
      model.workflowResults.map((result) =>
        workflowResultMarkup(result, model.activeIndex)).join('') +
      '</section>'
    )
    : '';
  const documents = model.documentResults.length
    ? (
      '<section aria-labelledby="sl-global-search-library">' +
      '<h2 id="sl-global-search-library">Library</h2>' +
      model.documentResults.map((result) =>
        documentResultMarkup(result, model.activeIndex)).join('') +
      '</section>'
    )
    : '';
  const loading = libraryLoading && !model.documentResults.length
    ? (
      '<section aria-labelledby="sl-global-search-library">' +
      '<h2 id="sl-global-search-library">Library</h2>' +
      '<div class="sl-global-search-loading" role="status">' +
      `${icon('refresh', 15)}<span>Checking connected documentation…</span>` +
      '</div></section>'
    )
    : '';

  if (workflows || documents || loading) return workflows + documents + loading;

  return (
    '<div class="sl-global-search-empty">' +
    `${icon('search', 18)}` +
    `<strong>No matches for “${esc(model.query.trim())}”</strong>` +
    '<small>Try a component, source, or workflow name.</small>' +
    '<button type="button" data-search-clear>Clear search</button>' +
    '</div>'
  );
}

/**
 * Complete overlay markup. Host code can mount this as the last child of the
 * plugin shell and use the data attributes for event delegation.
 */
export function globalSearchMarkup(
  model: SearchModel,
  options: { libraryLoading?: boolean } = {},
): string {
  const activeDescendant = model.results.length
    ? ` aria-activedescendant="${resultId(model.activeIndex)}"`
    : '';
  const clear = model.query
    ? (
      '<button class="sl-global-search-clear" type="button" ' +
      'data-search-clear>Clear</button>'
    )
    : '';

  return (
    '<div class="sl-global-search-layer" role="dialog" aria-modal="true" ' +
    'aria-label="Quick search" data-global-search-dialog>' +
    '<button class="sl-global-search-scrim" type="button" data-search-close ' +
    'tabindex="-1" aria-label="Close quick search"></button>' +
    '<div class="sl-global-search-panel">' +
    '<div class="sl-global-search-input">' +
    `${icon('search', 17)}` +
    '<input type="search" data-global-search-input autofocus ' +
    `value="${esc(model.query)}" placeholder="Search workflows and library…" ` +
    'aria-label="Search workflows and library" role="combobox" ' +
    'aria-autocomplete="list" aria-expanded="true" ' +
    `aria-controls="sl-global-search-results"${activeDescendant}>` +
    clear +
    '<button class="sl-global-search-close" type="button" data-search-close ' +
    `aria-label="Close quick search">${icon('x', 15)}</button>` +
    '</div>' +
    '<div class="sl-global-search-results" id="sl-global-search-results" ' +
    'role="listbox" aria-label="Search results">' +
    resultsMarkup(model, options.libraryLoading === true) +
    '</div>' +
    '<div class="sl-global-search-footer" aria-hidden="true">' +
    '<span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>' +
    '<span><kbd>↵</kbd> Open</span>' +
    '<span><kbd>Esc</kbd> Close</span>' +
    '</div></div></div>'
  );
}
