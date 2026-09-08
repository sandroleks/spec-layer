/**
 * search.ts — connected-document command palette.
 *
 * This is presentation only. The host owns query state, active-pointer
 * movement, activation, Escape/Cmd-K handling, the focus trap, scroll-into-
 * view, and returning focus to the header Search trigger.
 *
 * Rows are deliberately plain: one line, a quiet glyph, the document name, and
 * its source only when that adds something. The palette is a list to scan
 * quickly, so the list itself carries no tiles, chevrons, or accent frames.
 */

import { icon } from '../shell/icons';
import type {
  SearchDocumentResult,
  SearchModel,
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

/**
 * The source line, dropped when it only repeats the name.
 *
 * A foundation doc is labelled "Foundations · Mapped Radius" over a source of
 * "Mapped Radius", so showing both prints the same words twice on one row.
 */
function sourceDetail(result: SearchDocumentResult): string {
  const label = result.label.toLocaleLowerCase();
  const source = result.sourceLabel.trim().toLocaleLowerCase();
  if (!source || label.includes(source) || source.includes(label)) return '';
  return (
    `<span class="sl-global-search-source">${esc(result.sourceLabel)}</span>`
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
    `data-search-kind="${result.kind}" data-search-doc-id="${esc(result.docId)}">` +
    `${icon(result.kind === 'foundation' ? 'layoutGrid' : 'puzzle', 15)}` +
    `<span class="sl-global-search-label">${esc(result.label)}</span>` +
    sourceDetail(result) +
    '</button>'
  );
}

/**
 * The group heading names what the list actually is. Before typing it is the
 * recent component docs, not a search result, and saying so is the difference
 * between an empty palette reading as "nothing matched" and "nothing
 * documented yet".
 */
function groupTitle(model: SearchModel): string {
  return model.recent ? 'Recent components' : 'Library';
}

function emptyMarkup(model: SearchModel): string {
  if (model.recent) {
    return (
      '<div class="sl-global-search-empty">' +
      '<strong>No component docs yet</strong>' +
      '<small>Document a component and it will show up here.</small>' +
      '</div>'
    );
  }
  return (
    '<div class="sl-global-search-empty">' +
    `<strong>No matches for “${esc(model.query.trim())}”</strong>` +
    '<small>Try a component or source name.</small>' +
    '<button type="button" data-search-clear>Clear search</button>' +
    '</div>'
  );
}

/**
 * Just the results list, which is the only part that changes as the user
 * types. Exported for patchGlobalSearch.
 */
export function globalSearchResultsMarkup(
  model: SearchModel,
  options: { libraryLoading?: boolean } = {},
): string {
  if (model.results.length) {
    return (
      '<section aria-labelledby="sl-global-search-group">' +
      `<h2 id="sl-global-search-group">${groupTitle(model)}</h2>` +
      model.results.map((result) =>
        documentResultMarkup(result, model.activeIndex)).join('') +
      '</section>'
    );
  }
  if (options.libraryLoading === true) {
    return (
      '<section aria-labelledby="sl-global-search-group">' +
      `<h2 id="sl-global-search-group">${groupTitle(model)}</h2>` +
      '<div class="sl-global-search-loading" role="status">' +
      `${icon('refresh', 15)}<span>Checking connected documentation…</span>` +
      '</div></section>'
    );
  }
  return emptyMarkup(model);
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

  return (
    '<div class="sl-global-search-layer" role="dialog" aria-modal="true" ' +
    'aria-label="Quick search" data-global-search-dialog>' +
    '<button class="sl-global-search-scrim" type="button" data-search-close ' +
    'tabindex="-1" aria-label="Close quick search"></button>' +
    '<div class="sl-global-search-panel">' +
    '<div class="sl-global-search-input">' +
    `${icon('search', 17)}` +
    '<input type="search" data-global-search-input autofocus ' +
    `value="${esc(model.query)}" placeholder="Search your library…" ` +
    'aria-label="Search your library" role="combobox" ' +
    'aria-autocomplete="list" aria-expanded="true" ' +
    `aria-controls="sl-global-search-results"${activeDescendant}>` +
    '<button class="sl-global-search-close" type="button" data-search-close ' +
    `aria-label="Close quick search">${icon('x', 15)}</button>` +
    '</div>' +
    '<div class="sl-global-search-results" id="sl-global-search-results" ' +
    'role="listbox" aria-label="Search results">' +
    globalSearchResultsMarkup(model, options) +
    '</div>' +
    '<div class="sl-global-search-footer" aria-hidden="true">' +
    '<span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>' +
    '<span><kbd>↵</kbd> Open</span>' +
    '<span><kbd>Esc</kbd> Close</span>' +
    '</div></div></div>'
  );
}

/**
 * Updates a mounted palette in place, and returns whether one was there.
 *
 * Replacing the whole layer on every keystroke restarted the panel's entry
 * animation, so the palette flashed once per typed letter, and it also meant
 * rebuilding the input and putting the caret back by hand. Only the results
 * list and the input's pointer attribute actually change while typing, so
 * those are all this touches. The input's own value is left alone unless it
 * has genuinely diverged from the model, which happens when the host clears
 * the query rather than when the user types it.
 */
export function patchGlobalSearch(
  root: HTMLElement,
  model: SearchModel,
  options: { libraryLoading?: boolean } = {},
): boolean {
  const dialog = root.querySelector<HTMLElement>('[data-global-search-dialog]');
  if (!dialog) return false;

  const results = dialog.querySelector<HTMLElement>('.sl-global-search-results');
  if (results) {
    results.innerHTML = globalSearchResultsMarkup(model, options);
  }

  const input = dialog.querySelector<HTMLInputElement>('[data-global-search-input]');
  if (input) {
    if (input.value !== model.query) input.value = model.query;
    if (model.results.length) {
      input.setAttribute('aria-activedescendant', resultId(model.activeIndex));
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }
  return true;
}
