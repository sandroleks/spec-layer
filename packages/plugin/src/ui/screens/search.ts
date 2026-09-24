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
import { esc } from '../escape';

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
 * The Library's last (or only) read found nothing at all: it failed outright,
 * or stopped partway before collecting a single doc. Either way, "No
 * component docs yet" and "No matches for …" would both claim a fact this
 * file's read never established. Distinct from `emptyMarkup`'s two branches,
 * and from the loading state above it: nothing is in flight here, so this
 * points at the Library rather than promising the palette itself will
 * resolve it. Only for a read that produced nothing; see
 * `partialNoMatchesMarkup` for a read that did produce docs but cannot vouch
 * for the rest of the file.
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
 * A query matched none of the docs a failed or partial read did collect.
 * Plain "No matches for …" would claim the whole file was searched, which
 * this read cannot back: the doc that matches may be one the read never
 * reached. Only reached with `results.length === 0` and at least one doc on
 * screen (`libraryUnreadable` above takes the zero-doc case first), so this
 * never doubles up with it.
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
 * The recent list is empty, but the read behind it failed or stopped early.
 * "No component docs yet" would claim the whole file was read; a component
 * doc may be one the read never reached. Only reached with at least one doc
 * on screen (`libraryUnreadable` takes the zero-doc case first). No Clear
 * button: nothing has been typed.
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

/**
 * Just the results list, which is the only part that changes as the user
 * types. Exported for patchGlobalSearch.
 */
export function globalSearchResultsMarkup(
  model: SearchModel,
  options: {
    libraryLoading?: boolean;
    libraryUnreadable?: boolean;
    libraryReadUnreliable?: boolean;
  } = {},
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
      `${icon('refresh', 15)}<span>Finding docs in this file…</span>` +
      '</div></section>'
    );
  }
  // A refresh already in flight (checked above) gets the benefit of the
  // doubt; a read that failed or came up empty with nothing further running
  // does not. `libraryUnreadable` is only set when the read produced no docs
  // at all (the host guards it on `libraryEntries.length === 0`), so a file
  // with docs on screen never hits this branch, however unreliable the read
  // behind them is.
  if (options.libraryUnreadable === true) {
    return unreadableMarkup();
  }
  // Docs exist, so the file is not "unreadable", but a query with no matches
  // among them still cannot be reported as a complete negative when the read
  // that produced those docs failed or stopped early: the doc that matches
  // may be the one it never reached. The same goes for an empty recent list.
  if (options.libraryReadUnreliable === true) {
    return model.recent ? partialNoRecentMarkup() : partialNoMatchesMarkup();
  }
  return emptyMarkup(model);
}

/**
 * Complete overlay markup. Host code can mount this as the last child of the
 * plugin shell and use the data attributes for event delegation.
 */
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

/**
 * Moves the active row without rebuilding the list. Hover and focus report an
 * index on every pointer move, so re-rendering the results for each one did
 * the whole list's work to change two attributes.
 */
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
