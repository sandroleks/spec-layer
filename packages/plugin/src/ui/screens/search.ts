/**
 * The search palette's markup, presentation only: the host owns query state,
 * the active pointer, activation, keys, the focus trap and focus return. Rows
 * stay plain (glyph, name, source when it adds something) so the list scans fast.
 */

import { icon } from '../shell/icons';
import type {
  SearchDocumentResult,
  SearchModel,
} from '../viewModel/search';
import { esc } from '../escape';

function resultId(index: number): string {
  return `sl-global-search-result-${index}`;
}

/**
 * The source line, dropped when it repeats the label (a foundation doc's
 * "Foundations · Mapped Radius" over "Mapped Radius") or when every result
 * shares one source.
 */
function sourceDetail(result: SearchDocumentResult, sharedSource: boolean): string {
  if (sharedSource) return '';
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
  sharedSource: boolean,
): string {
  const active = result.index === activeIndex;
  return (
    `<button class="sl-global-search-result${active ? ' is-active' : ''}" ` +
    `type="button" role="option" id="${resultId(result.index)}" ` +
    `aria-selected="${active}" data-search-index="${result.index}" ` +
    `data-search-kind="${result.kind}" data-search-doc-id="${esc(result.docId)}">` +
    `${icon(result.kind === 'foundation' ? 'layoutGrid' : 'puzzle', 15)}` +
    `<span class="sl-global-search-label">${esc(result.label)}</span>` +
    sourceDetail(result, sharedSource) +
    '</button>'
  );
}

/** True when two or more results all name the same source. */
function allShareSource(results: readonly SearchDocumentResult[]): boolean {
  if (results.length < 2) return false;
  const first = results[0].sourceLabel.trim();
  return results.every((result) => result.sourceLabel.trim() === first);
}

/**
 * Before typing the list is the recent component docs, so an empty palette
 * reads as "nothing documented yet", not "nothing matched".
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
 * The Library's read found nothing at all (failed, or stopped before one doc),
 * so "No component docs yet" or "No matches" would claim an unestablished
 * fact. Nothing is in flight, so it points at the Library.
 */
function unreadableMarkup(): string {
  return (
    '<div class="sl-global-search-empty">' +
    '<strong>Couldn’t read the docs in this file</strong>' +
    '<small>Open the Library and refresh to try again.</small>' +
    '</div>'
  );
}

/**
 * No match among the docs a failed or partial read collected. Plain "No
 * matches" would claim the whole file was searched; the match may be a doc
 * the read never reached.
 */
function partialNoMatchesMarkup(): string {
  return (
    '<div class="sl-global-search-empty">' +
    '<strong>No matches in the docs that could be read</strong>' +
    '<small>The library read failed or stopped early, so this is not the ' +
    'whole file. Refresh the Library to check the rest.</small>' +
    '<button type="button" data-search-clear>Clear search</button>' +
    '</div>'
  );
}

/**
 * The recent list is empty but its read failed or stopped early, so "No
 * component docs yet" would overclaim. No Clear button: nothing was typed.
 */
function partialNoRecentMarkup(): string {
  return (
    '<div class="sl-global-search-empty">' +
    '<strong>No component docs in what could be read</strong>' +
    '<small>The library read failed or stopped early, so this is not the ' +
    'whole file. Refresh the Library to check the rest.</small>' +
    '</div>'
  );
}

/** Just the results list, the only part that changes while typing. */
export function globalSearchResultsMarkup(
  model: SearchModel,
  options: {
    libraryLoading?: boolean;
    libraryUnreadable?: boolean;
    libraryReadUnreliable?: boolean;
  } = {},
): string {
  if (model.results.length) {
    const sharedSource = allShareSource(model.results);
    return (
      '<section aria-labelledby="sl-global-search-group">' +
      `<h2 id="sl-global-search-group">${groupTitle(model)}</h2>` +
      model.results.map((result) =>
        documentResultMarkup(result, model.activeIndex, sharedSource)).join('') +
      '</section>'
    );
  }
  if (options.libraryLoading === true) {
    return (
      '<section aria-labelledby="sl-global-search-group">' +
      `<h2 id="sl-global-search-group">${groupTitle(model)}</h2>` +
      '<div class="sl-global-search-loading" role="status">' +
      `${icon('refresh', 15)}<span>Finding docs in this file…</span>` +
      '</div></section>'
    );
  }
  // A refresh in flight (above) gets the benefit of the doubt; a finished read
  // with no docs does not. The host sets `libraryUnreadable` only with zero docs.
  if (options.libraryUnreadable === true) {
    return unreadableMarkup();
  }
  // Docs exist, but no match (or no recent doc) among them is not a complete
  // negative when their read failed or stopped early.
  if (options.libraryReadUnreliable === true) {
    return model.recent ? partialNoRecentMarkup() : partialNoMatchesMarkup();
  }
  return emptyMarkup(model);
}

/** Complete overlay markup, mounted as the last child of the plugin shell. */
export function globalSearchMarkup(
  model: SearchModel,
  options: {
    libraryLoading?: boolean;
    libraryUnreadable?: boolean;
    libraryReadUnreliable?: boolean;
  } = {},
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
    `value="${esc(model.query)}" placeholder="Search your docs…" ` +
    'aria-label="Search your docs" role="combobox" ' +
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
 * Updates a mounted palette in place (returns whether one was there):
 * replacing the layer per keystroke restarts its entry animation and rebuilds
 * the input. The input's value is reset only when the host cleared the query.
 */
export function patchGlobalSearch(
  root: HTMLElement,
  model: SearchModel,
  options: {
    libraryLoading?: boolean;
    libraryUnreadable?: boolean;
    libraryReadUnreliable?: boolean;
  } = {},
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

/** Moves the active row by toggling attributes; hover and focus report every pointer move. */
export function setSearchActive(root: HTMLElement, activeIndex: number): void {
  const dialog = root.querySelector<HTMLElement>('[data-global-search-dialog]');
  if (!dialog) return;
  let found = false;
  for (const option of dialog.querySelectorAll<HTMLElement>('[data-search-index]')) {
    const active = Number(option.dataset.searchIndex) === activeIndex;
    option.classList.toggle('is-active', active);
    option.setAttribute('aria-selected', String(active));
    if (active) found = true;
  }
  const input = dialog.querySelector<HTMLInputElement>('[data-global-search-input]');
  if (!input) return;
  if (found) input.setAttribute('aria-activedescendant', resultId(activeIndex));
  else input.removeAttribute('aria-activedescendant');
}
