/**
 * library.ts — connected documentation maintenance.
 *
 * This module is presentation only. The host owns refreshes, source checks,
 * updates, destructive confirmations, and focus changes. Capability flags on
 * each row are the only authority for which overflow actions are shown.
 */

import { FOUNDATION_ICON, icon, type IconName } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';
import type {
  LibraryChangeUnavailableReason,
  LibraryFilter,
  LibraryModel,
  LibraryRowModel,
  LibraryRowStatus,
} from '../viewModel/library';
import { loadingRowsMarkup, progressMarkup, type ProgressPresentation } from './progress';
import { esc } from '../escape';

export type { LibraryFilter } from '../viewModel/library';

export interface LibraryChangeItemPresentation {
  text: string;
  /** Which variants the change reaches. Absent means the whole document. */
  scope?: string;
}

export interface LibraryChangeGroupPresentation {
  label: string;
  items: readonly LibraryChangeItemPresentation[];
}

/**
 * Structural on purpose: viewModel/library.ts can remain the domain owner and
 * pass its richer rows here without this presentation layer importing it.
 */
export interface LibraryRowPresentation
  extends Omit<LibraryRowModel, 'changeGroups'> {
  changeGroups: readonly LibraryChangeGroupPresentation[] | null;
}

export interface LibraryScreenPresentation
  extends Omit<LibraryModel, 'allRows' | 'rows'> {
  allRows: readonly LibraryRowPresentation[];
  rows: readonly LibraryRowPresentation[];
  menuDocId: string | null;
  loading?: boolean;
  refreshing?: boolean;
  /** At least one source check failed, so a batch would silently miss work. */
  checksIncomplete?: boolean;
  updatingAll?: boolean;
  updatingDocId?: string | null;
  progress?: ProgressPresentation | null;
  /**
   * The row the global search palette just opened, if any. It is marked and
   * scrolled to, which is how a palette that lists documents hands the user
   * off to a list of many rows without losing the one they picked. The host
   * clears it on the next refresh, filter change, or screen change.
   */
  revealedDocId?: string | null;
  /**
   * The main thread could not read this file's docs (a `libraryError` reply).
   * With no rows it replaces the empty state, because "No docs yet" would
   * claim a fact the read never established; with rows from an earlier read
   * it sits above them and says they may be out of date.
   */
  error?: string | null;
  /**
   * The scan behind the current rows stopped partway (a `library` reply with
   * `incomplete: true`): the rows shown are real, but the scan may never have
   * reached every doc. A plain note says so and offers Refresh; nothing here
   * claims the library is up to date or fully in sync until a complete read
   * clears this flag.
   */
  readIncomplete?: boolean;
}

function isUpdate(row: LibraryRowPresentation): boolean {
  return row.status === 'updateAvailable';
}

const STATUS_COPY: Record<LibraryRowStatus, string> = {
  pending: 'Checking…',
  inSync: 'In sync',
  updateAvailable: 'Update available',
  rebuildNeeded: 'Rebuild needed',
  edited: 'Manually edited',
  orphaned: 'Source missing',
  unavailable: 'Couldn’t check',
};

/**
 * The rebuild banner, said once for the whole Library above the filters
 * rather than under every stale row. A title and a button, nothing more: the
 * rows already say "Rebuild needed", and the button carries no count, like
 * "Update all docs", because the Updates filter shows it and a label that
 * changes width makes the button jump. A rebuild keeps the editorial slots
 * and rewrites Keyboard, because the old prompt's bullets upgrade to the table
 * lossily (see missingProseKeys in actions.ts); that caveat rides the
 * button's tooltip.
 */
export const REBUILD_TITLE = 'Some docs are from an older plugin version';
export const REBUILD_KEYBOARD_NOTE =
  'In docs made with AI writing, AI rewrites Keyboard and fills empty sections, if AI writing is on. Everything else is kept.';

export function rebuildBannerMarkup(count: number, disabled: boolean): string {
  if (count === 0) return '';
  return (
    '<div class="sl-banner sl-library-rebuild-banner" data-tone="accent" role="status">' +
    `<span class="sl-library-rebuild-icon">${icon('infoCircle', 16)}</span>` +
    '<span class="sl-library-rebuild-copy">' +
    `<strong>${REBUILD_TITLE}</strong>` +
    '</span>' +
    '<button class="sl-button" data-tone="primary" data-size="small" type="button" ' +
    `title="${esc(REBUILD_KEYBOARD_NOTE)}" ` +
    `data-library-rebuild-all${disabled ? ' disabled' : ''}>${icon('fileCheck', 14)}` +
    '<span>Rebuild docs</span></button>' +
    '</div>'
  );
}

function statusMarkup(status: LibraryRowStatus): string {
  return (
    `<span class="sl-library-status is-${status}" data-library-status="${status}">` +
    '<i aria-hidden="true"></i>' +
    `<span>${STATUS_COPY[status]}</span></span>`
  );
}

function changeGroupMarkup(group: LibraryChangeGroupPresentation): string {
  return (
    '<section class="sl-library-change-group">' +
    `<strong>${esc(group.label)}</strong>` +
    '<ul>' +
    group.items.map((item) =>
      `<li>${esc(item.text)}${item.scope ? `<span class="sl-library-change-scope">${esc(item.scope)}</span>` : ''}</li>`).join('') +
    '</ul></section>'
  );
}

/**
 * The second line under "Source changed" when no list can be shown. Placed in
 * HTML directly, not through esc(), so it must stay free of markup characters;
 * the typographic apostrophe needs no escape.
 */
const CHANGE_UNAVAILABLE_COPY: Record<LibraryChangeUnavailableReason, string> = {
  noBaseline: 'Update this doc once to enable change lists.',
  other: 'Couldn’t list what changed. You can still update this doc from its menu.',
};

function changeFallbackMarkup(detail: string): string {
  return (
    '<div class="sl-library-change-fallback">' +
    `${icon('alertCircle', 16)}<span><strong>Source changed</strong>` +
    `<small>${detail}</small>` +
    '</span></div>'
  );
}

function changeContentMarkup(row: LibraryRowPresentation): string {
  switch (row.changeState) {
    case 'idle':
      return '';
    case 'pending':
      // Reuses the fallback container so the pending line needs no new CSS.
      return '<div class="sl-library-change-fallback"><span><strong>Comparing…</strong></span></div>';
    case 'ready':
      return row.changeGroups?.length
        ? row.changeGroups.map(changeGroupMarkup).join('')
        // Should not occur: the diff input is the hash input. Better than an
        // empty panel if it does.
        : changeFallbackMarkup('No individual changes to list. Update this doc to bring it back in sync.');
    case 'unavailable':
      return changeFallbackMarkup(CHANGE_UNAVAILABLE_COPY[row.changeUnavailableReason ?? 'other']);
  }
}

function changeDetailsMarkup(row: LibraryRowPresentation): string {
  return (
    `<div id="sl-library-details-${esc(row.docId)}" class="sl-library-details"` +
    `${row.expanded ? '' : ' hidden'}>` +
    '<div class="sl-library-details-inner">' +
    '<h2>Changes</h2>' +
    `<div class="sl-library-change-list">${changeContentMarkup(row)}</div>` +
    '</div></div>'
  );
}

interface MenuItem {
  label: string;
  action:
    | 'review'
    | 'update'
    | 'open-frame'
    | 'open-source'
    | 'copy'
    | 'detach'
    | 'remove';
  glyph:
    | 'adjustments'
    | 'fileCheck'
    | 'externalLink'
    | 'puzzle'
    | 'download'
    | 'copy'
    | 'alertCircle';
  danger?: boolean;
}

function menuGroups(row: LibraryRowPresentation): MenuItem[][] {
  const maintenance: MenuItem[] = [];
  if (isUpdate(row)) {
    maintenance.push({
      action: 'review',
      label: row.expanded ? 'Hide changes' : 'Show changes',
      glyph: 'adjustments',
    });
  }
  if (row.canUpdate) {
    maintenance.push({
      action: 'update',
      label: 'Update this doc',
      // Same glyph as the footer's "Update all docs": one act, one glyph,
      // whether it runs on this row or on every drifted doc. It wore `refresh`
      // here, which is the re-check that writes nothing.
      glyph: 'fileCheck',
    });
  }

  const navigation: MenuItem[] = [];
  if (row.canOpenFrame) {
    navigation.push({
      action: 'open-frame',
      label: 'View this doc on canvas',
      glyph: 'externalLink',
    });
  }
  if (row.canOpenSource) {
    navigation.push({
      action: 'open-source',
      label: 'View source component',
      glyph: 'puzzle',
    });
  }
  if (row.canCopy) {
    navigation.push({
      action: 'copy',
      label: 'Copy for AI',
      glyph: 'copy',
    });
  }

  const destructive: MenuItem[] = [];
  if (row.canDetach) {
    destructive.push({
      action: 'detach',
      label: 'Detach this doc',
      glyph: 'externalLink',
    });
  }
  if (row.canRemove) {
    destructive.push({
      action: 'remove',
      label: 'Delete this doc',
      glyph: 'alertCircle',
      danger: true,
    });
  }

  return [maintenance, navigation, destructive].filter((group) => group.length);
}

function menuMarkup(
  row: LibraryRowPresentation,
  open: boolean,
  busy: boolean,
): string {
  const groups = menuGroups(row);
  if (!groups.length) return '';

  const trigger =
    '<button class="sl-library-menu-trigger" type="button" ' +
    `data-library-menu="${esc(row.docId)}" aria-label="Actions for ${esc(row.label)}" ` +
    `aria-expanded="${open}">${icon('dots', 17)}</button>`;
  if (!open) return trigger;

  const content = groups.map((group) =>
    group.map((item) => (
      `<button${item.danger ? ' class="is-danger"' : ''} role="menuitem" type="button" ` +
      `data-library-action="${item.action}" data-doc-id="${esc(row.docId)}"` +
      `${busy && item.action === 'update' ? ' disabled' : ''}>` +
      `${icon(item.glyph, 15)}<span>${item.label}</span></button>`
    )).join(''),
  ).join('<span class="sl-library-menu-separator" aria-hidden="true"></span>');

  return (
    trigger +
    '<button class="sl-library-menu-scrim" type="button" data-library-menu-close ' +
    'aria-label="Close actions menu"></button>' +
    `<div class="sl-library-overflow-menu" role="menu" aria-label="Actions for ${esc(row.label)}">` +
    `${content}</div>`
  );
}

/**
 * A foundation row wears the same glyph the Foundations picker gave the source
 * it was generated from — a swatch for a color collection, a ruler for a
 * dimension one, `typography` for text styles — so the two lists describe the
 * same thing the same way. One shared `layoutGrid` for all of them said only
 * "not a component", which the Library's own grouping already says. `puzzle`
 * keeps its existing "this is a component" meaning.
 */
function rowIcon(row: LibraryRowPresentation): IconName {
  if (row.kind !== 'foundation') return 'puzzle';
  return FOUNDATION_ICON[row.foundationIcon ?? 'mixed'];
}

const FOUNDATION_TITLE_PREFIX = 'Foundations · ';

/**
 * The main thread always prefixes a foundation row's label with
 * "Foundations · " (see messages.ts) so it reads unambiguously wherever it
 * appears alone — the global search results, for one. Inside this list the
 * new foundation icon already says that, so repeating it in the row's own
 * bold title is pure noise stacked on an already-long name. The full label
 * stays intact everywhere else (aria-label, search) — only the visible title
 * here is shortened, and it remains a substring of those, per WCAG 2.5.3.
 */
function rowTitle(row: LibraryRowPresentation): string {
  return row.kind === 'foundation' && row.label.startsWith(FOUNDATION_TITLE_PREFIX)
    ? row.label.slice(FOUNDATION_TITLE_PREFIX.length)
    : row.label;
}

export function libraryRowMarkup(
  row: LibraryRowPresentation,
  menuDocId: string | null,
  busy: boolean,
  revealed = false,
): string {
  const update = isUpdate(row);
  const expanded = update && row.expanded;
  const status = update
    ? (
      '<button class="sl-library-update-disclosure" type="button" ' +
      `data-library-disclosure="${esc(row.docId)}" aria-expanded="${expanded}" ` +
      `aria-controls="sl-library-details-${esc(row.docId)}" ` +
      `aria-label="Update available. Show changes for ${esc(row.label)}">` +
      `${statusMarkup(row.status)}` +
      `<span class="sl-library-chevron${expanded ? ' is-expanded' : ''}">${icon('chevronDown', 14)}</span>` +
      '</button>'
    )
    : statusMarkup(row.status);
  const sourceIcon = icon(rowIcon(row), 17);
  const title = esc(rowTitle(row));
  const jump = row.canOpenFrame
    ? (
      '<button class="sl-library-jump" type="button" ' +
      `data-library-open-frame="${esc(row.docId)}" aria-label="View ${esc(row.label)} on canvas">` +
      `<span class="sl-library-source-icon">${sourceIcon}</span>` +
      '<span class="sl-library-identity">' +
      `<strong>${title}</strong>` +
      '</span></button>'
    )
    : (
      '<div class="sl-library-jump is-static">' +
      `<span class="sl-library-source-icon">${sourceIcon}</span>` +
      '<span class="sl-library-identity">' +
      `<strong>${title}</strong>` +
      '</span></div>'
    );

  return (
    '<article class="sl-library-row' +
    `${expanded ? ' is-expanded' : ''}${revealed ? ' is-revealed' : ''}" ` +
    `data-doc-id="${esc(row.docId)}" data-expanded="${expanded}">` +
    '<div class="sl-library-summary">' +
    jump +
    status +
    `<time>${esc(row.ageLabel)}</time>` +
    menuMarkup(row, menuDocId === row.docId, busy) +
    '</div>' +
    (update ? changeDetailsMarkup({ ...row, expanded }) : '') +
    '</article>'
  );
}

/**
 * A doc sheet drops into a folder and is marked in sync: what the Library does
 * with every doc once one exists. Decorative, so hidden from assistive tech.
 */
const EMPTY_ILLUSTRATION =
  '<svg class="sl-empty-illustration sl-lib-illustration" viewBox="0 0 160 112" width="160" height="112" ' +
  'fill="none" aria-hidden="true" focusable="false">' +
  '<rect x="36" y="30" width="34" height="14" rx="4" class="sl-lib-folder-back"/>' +
  '<rect x="36" y="38" width="88" height="58" rx="7" class="sl-lib-folder-back"/>' +
  '<g class="sl-lib-doc">' +
  '<rect x="56" y="18" width="48" height="58" rx="5" class="sl-empty-sheet"/>' +
  '<rect x="63" y="26" width="20" height="4" rx="2" class="sl-empty-line is-strong"/>' +
  '<rect x="63" y="35" width="32" height="3" rx="1.5" class="sl-empty-line"/>' +
  '<rect x="63" y="42" width="26" height="3" rx="1.5" class="sl-empty-line"/>' +
  '</g>' +
  '<rect x="32" y="56" width="96" height="40" rx="7" class="sl-empty-tile"/>' +
  '<rect x="44" y="68" width="30" height="4" rx="2" class="sl-empty-line"/>' +
  '<g class="sl-lib-badge">' +
  '<circle cx="124" cy="58" r="10" class="sl-lib-badge-dot"/>' +
  '<path d="M119.5 58.2l3 3 6-6.2" class="sl-lib-badge-check"/>' +
  '</g>' +
  '</svg>';

/**
 * The read failed and nothing is on screen to keep. Names the failure and
 * offers the same Refresh the footer has; nothing here claims the file has
 * or lacks docs. `role="alert"` so a screen reader hears it once, on arrival.
 */
function errorMarkup(message: string): string {
  return (
    '<div class="sl-empty-state" role="alert">' +
    '<strong>Couldn’t read the docs in this file</strong>' +
    `<p>${esc(message)}</p>` +
    '<button class="sl-button" data-tone="secondary" type="button" data-library-refresh>' +
    `${icon('refresh', 15)}<span>Try again</span></button>` +
    '</div>'
  );
}

/**
 * The read failed but the last successful read's rows are still listed.
 * `message` is a caught error's own text: technical detail, so it goes last,
 * in parentheses, without a trailing period of its own, and a blank one adds
 * nothing rather than a bare "()".
 */
function errorBannerMarkup(message: string): string {
  const detail = message.trim().replace(/\.$/, '');
  return (
    '<div class="sl-banner sl-library-error" data-tone="danger" role="alert">' +
    `${icon('alertCircle', 16)}<span>Couldn’t re-read the docs in this file, so the list below may be out of date.` +
    `${detail ? ` (${esc(detail)})` : ''}</span>` +
    '</div>'
  );
}

/**
 * The scan behind the rows below stopped partway. Unlike errorBannerMarkup
 * this is not a failed re-read of an existing list: it is the current read
 * itself, incomplete, so it carries its own Refresh rather than pointing at
 * a re-read that has not happened yet. `role="status"` because nothing here
 * is as urgent as a read failure; it is a caveat on the rows underneath.
 */
function incompleteNoteMarkup(): string {
  return (
    '<div class="sl-banner sl-library-incomplete" data-tone="warning" role="status">' +
    `${icon('alertCircle', 16)}` +
    '<span>The scan stopped early, so this list may be missing some docs.</span>' +
    '<button class="sl-button" data-tone="secondary" data-size="small" type="button" data-library-refresh>' +
    `${icon('refresh', 14)}<span>Refresh</span></button>` +
    '</div>'
  );
}

/**
 * The scan stopped before it collected a single row, and no earlier read left
 * anything to fall back on either. Distinct from errorMarkup: nothing failed,
 * so this never says the read "couldn't" happen, but it is just as wrong to
 * show the illustrated "No docs yet" — that claims a fact an incomplete scan
 * never established. `role="status"`, matching incompleteNoteMarkup's tone:
 * this is a caveat on an in-progress read, not an alert.
 */
function incompleteEmptyMarkup(): string {
  return (
    '<div class="sl-empty-state" role="status">' +
    '<strong>The scan stopped before it found any docs</strong>' +
    '<p>That is not the same as this file having none. Refresh to read again.</p>' +
    '<button class="sl-button" data-tone="secondary" type="button" data-library-refresh>' +
    `${icon('refresh', 15)}<span>Refresh</span></button>` +
    '</div>'
  );
}

/**
 * `incomplete` is true when a failed re-read or a partial scan means the
 * current filter's empty subset cannot be trusted as a complete count (the
 * banner above already says so; this keeps the claim below it honest too).
 * Shared between the two filters: "None found" is the whole claim either can
 * still honestly make, so there is no reason to say it two different ways.
 */
function emptyMarkup(filter: LibraryFilter, hasRows: boolean, incomplete: boolean): string {
  if (!hasRows) {
    // Two starts, the same two views the rail opens. Nothing here creates.
    return (
      '<div class="sl-empty-state sl-empty-illustrated">' +
      EMPTY_ILLUSTRATION +
      '<strong>No docs yet</strong>' +
      '<p>Docs you create in this file appear here, so you can see when their source changes and update them.</p>' +
      '<div class="sl-empty-actions">' +
      '<button class="sl-button" data-tone="secondary" type="button" data-empty-nav="component">' +
      `${icon('puzzle', 15)}<span>Document a component</span></button>` +
      '<button class="sl-button" data-tone="quiet" type="button" data-empty-nav="foundations">' +
      `${icon('layoutGrid', 15)}<span>Document foundations</span></button>` +
      '</div>' +
      '</div>'
    );
  }
  if (incomplete) {
    return (
      '<div class="sl-empty-state"><strong>None found in what could be read</strong>' +
      '<p>The list above may still be missing docs, so this could change once a read finishes clean.</p>' +
      '<button class="sl-button" data-tone="secondary" type="button" ' +
      'data-library-filter="all">View all docs</button></div>'
    );
  }
  if (filter === 'updates') {
    return (
      '<div class="sl-empty-state"><strong>No updates waiting</strong>' +
      '<p>Docs appear here when their source changes or they need a rebuild.</p>' +
      '<button class="sl-button" data-tone="secondary" type="button" ' +
      'data-library-filter="all">View all docs</button></div>'
    );
  }
  return (
    '<div class="sl-empty-state"><strong>No docs in sync</strong>' +
    '<p>Docs appear here when they match their source.</p>' +
    '<button class="sl-button" data-tone="secondary" type="button" ' +
    'data-library-filter="all">View all docs</button></div>'
  );
}

export function libraryHeaderMarkup(): string {
  return '<div class="sl-page-header-copy"><h1>Library</h1></div>';
}

/**
 * The three filters' ids and labels, shared between the full paint (which
 * builds the whole button) and patchLibraryDrift (which only rewrites a
 * drawn button's count), so the two cannot drift apart on which id maps to
 * which count.
 */
const LIBRARY_FILTERS: ReadonlyArray<{ id: LibraryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'updates', label: 'Updates' },
  { id: 'sync', label: 'In sync' },
];

function libraryFilterCount(model: LibraryScreenPresentation, id: LibraryFilter): number {
  switch (id) {
    case 'updates': return model.counts.updates;
    case 'sync': return model.counts.inSync;
    case 'all': return model.counts.all;
  }
}

export function libraryScrollMarkup(model: LibraryScreenPresentation): string {
  const busy = Boolean(
    model.refreshing ||
    model.updatingAll ||
    model.updatingDocId,
  );

  const filterMarkup =
    '<div class="sl-library-filters" role="group" aria-label="Library filters">' +
    LIBRARY_FILTERS.map(({ id, label }) => (
      `<button class="${model.filter === id ? 'is-selected' : ''}" type="button" ` +
      `data-library-filter="${id}" aria-pressed="${model.filter === id}">` +
      `<span>${label}</span><small>${libraryFilterCount(model, id)}</small></button>`
    )).join('') +
    '</div>';
  const content = model.loading
    ? loadingRowsMarkup(5)
    : model.rows.length
      ? (
        `<div class="sl-library-list" data-busy="${busy}">` +
        model.rows.map((row) => libraryRowMarkup(
          row,
          model.menuDocId,
          busy,
          row.docId === model.revealedDocId,
        )).join('') +
        '</div>'
      )
      : model.error && model.allRows.length === 0
        ? errorMarkup(model.error)
        : model.readIncomplete && model.allRows.length === 0
          ? incompleteEmptyMarkup()
          : emptyMarkup(
            model.filter,
            model.allRows.length > 0,
            Boolean(model.error) || Boolean(model.readIncomplete),
          );

  const rebuilds = model.loading
    ? 0
    : model.allRows.filter((row) => row.status === 'rebuildNeeded').length;
  // Three filters counting zero sort nothing, so an empty Library drops them.
  const noDocs = !model.loading && model.allRows.length === 0;
  return (
    rebuildBannerMarkup(
      rebuilds,
      busy || Boolean(model.checksIncomplete) || Boolean(model.readIncomplete) || Boolean(model.error),
    ) +
    (model.error && model.allRows.length > 0 ? errorBannerMarkup(model.error) : '') +
    (model.readIncomplete ? incompleteNoteMarkup() : '') +
    (noDocs ? '' : filterMarkup) +
    content
  );
}

export function libraryFooterMarkup(model: LibraryScreenPresentation): string {
  const busy = Boolean(
    model.refreshing ||
    model.updatingAll ||
    model.updatingDocId,
  );
  const refreshLabel = model.refreshing ? 'Refreshing…' : 'Refresh library';
  /**
   * Label only. The glyph is fixed at `fileCheck` and does not vary with
   * state: one slot must not show an action, then a warning, then a status.
   * Circular arrows mean "re-reads, writes nothing" and belong to "Refresh
   * library" beside it; failed checks are already visible per row as
   * "Couldn’t check". See the icon contract in design-system/components.css.
   *
   * "Update all docs", not "Update all 3": see docs/plugin-voice-and-copy.md
   * ("Footer actions"). It names the same object the create buttons do, and
   * "all" is what separates it from a row's own "Update this doc" — the
   * count is already on the Updates filter beside it, and a label that changes
   * width as rows drift in and out made the button jump.
   */
  // One shared boolean for the label and the disabled attribute below, so
  // they cannot drift apart: a batch over rows a read couldn't vouch for is
  // never claimed safe in one and refused in the other. `error` belongs here
  // alongside `checksIncomplete`/`readIncomplete` for the same reason it
  // already gates the rebuild banner — stale rows behind a failed re-read
  // cannot be trusted to have the real update count either.
  const batchUnreliable = Boolean(model.checksIncomplete) || Boolean(model.readIncomplete) || Boolean(model.error);
  // "Up to date" is a completeness claim: every source check has landed,
  // none failed, and every source still exists. `model.refreshing` already
  // covers both an explicit refresh and rows still `pending` a check (see
  // ui-vnext.ts), so while it is true a check is genuinely in flight and
  // "Checking…" is the true label, ahead of "Refresh to retry" — a re-check
  // already started is not the same as one that still needs asking for. A
  // Library with an orphaned row has nothing left to update but is not up to
  // date either, so it gets its own honest label instead of either claim.
  const sourceMissing = model.allRows.some((row) => row.status === 'orphaned');
  const batchLabel = model.updatingAll
    ? 'Updating…'
    : model.refreshing
      ? 'Checking…'
      : batchUnreliable
        ? 'Refresh to retry'
        : model.counts.updates > 0
          ? 'Update all docs'
          : sourceMissing
            ? 'Nothing to update'
            : 'Up to date';
  const progress = model.progress
    ? `<div class="sl-footer-progress">${progressMarkup(model.progress)}</div>`
    : '';
  return (
    progress +
    '<div class="sl-footer-actions">' +
    /*
     * Never disabled, unlike the two beside it. It navigates: it opens the
     * Publish screen and starts nothing, so a refresh or a
     * batch update in flight is no reason to withhold it, and the publish
     * screen's own primary is what disables itself while publishing.
     */
    '<button class="sl-button sl-library-publish" data-tone="secondary" ' +
    'type="button" data-publish-open>' +
    `${icon('upload', 15)}<span>Publish</span></button>` +
    '<button class="sl-button sl-library-refresh" data-tone="secondary" ' +
    `type="button" data-library-refresh${busy ? ' disabled' : ''}>` +
    `${icon('refresh', 15)}<span>${refreshLabel}</span></button>` +
    // "Up to date" with no docs would claim a state nothing was checked for.
    (!model.loading && model.allRows.length === 0
      ? ''
      : '<button class="sl-button sl-library-update-all" data-tone="primary" ' +
        `type="button" data-library-update-all${busy || batchUnreliable || model.counts.updates === 0 ? ' disabled' : ''}>` +
        `${icon('fileCheck', 15)}<span>${batchLabel}</span></button>`) +
    '</div>'
  );
}

/** Row-relative offsets the CSS opens the menu at, mirrored to open upward. */
const MENU_BELOW_TOP = 42;
const MENU_ABOVE_BOTTOM = 7;
/** Breathing room kept between the menu and the scroll viewport's edges. */
const MENU_EDGE_GAP = 8;

export interface RowMenuMetrics {
  /** Viewport y of the row the menu belongs to. */
  rowTop: number;
  /** The scroll viewport's own top and bottom, in the same coordinates. */
  viewTop: number;
  viewBottom: number;
  /** Measured menu height — it varies with the row's capability flags. */
  height: number;
}

/**
 * Row-relative `top` for an open row menu, or null to keep the CSS default.
 *
 * Pure so the clamping can be tested without a layout engine; see
 * placeOpenRowMenu for why this is needed at all.
 */
export function rowMenuTop(metrics: RowMenuMetrics): number | null {
  const { rowTop, viewTop, viewBottom, height } = metrics;
  // Every bound is row-relative, matching the `top` this returns.
  const lowest = viewBottom - MENU_EDGE_GAP - height - rowTop;
  if (MENU_BELOW_TOP <= lowest) return null; // Fits below, so don't intervene.

  const highest = viewTop + MENU_EDGE_GAP - rowTop;
  const above = MENU_ABOVE_BOTTOM - height;
  // A menu taller than the viewport cannot satisfy both bounds; top-align it so
  // its first items stay reachable rather than clipping them off the top.
  return Math.round(Math.min(Math.max(above, highest), Math.max(lowest, highest)));
}

/**
 * Keeps an open row menu inside the scroll viewport.
 *
 * The menu is absolutely positioned inside `.sl-screen-scroll`, which is an
 * `overflow-y: auto` clipping context with the sticky footer sitting opaque
 * just below it. Opening downward at a fixed offset is therefore fine for most
 * rows and clipped mid-menu further down the list — the taller the row's menu,
 * the higher up that starts, and the last row loses its destructive actions
 * entirely.
 *
 * So this measures once and flips the menu above the row when it does not fit
 * below. Measuring once is enough: the host closes the menu on scroll, so an
 * open menu never has to track anything. Row index cannot stand in for the
 * measurement — whether there is room below depends on scroll position and on
 * how many actions the row's capability flags produced, and a short list has
 * room under its last row.
 */
function placeOpenRowMenu(refs: ShellRefs): void {
  const menu = refs.scroll.querySelector<HTMLElement>('.sl-library-overflow-menu');
  const row = menu?.closest<HTMLElement>('.sl-library-row');
  if (!menu || !row) return;

  const view = refs.scroll.getBoundingClientRect();
  const top = rowMenuTop({
    rowTop: row.getBoundingClientRect().top,
    viewTop: view.top,
    viewBottom: view.bottom,
    height: menu.offsetHeight,
  });
  if (top !== null) menu.style.top = `${top}px`;
}

export interface RevealMetrics {
  /** The scroll container's current offset. */
  scrollTop: number;
  /** Viewport y of the row being revealed, and of the container itself. */
  rowTop: number;
  viewTop: number;
  viewHeight: number;
  rowHeight: number;
  /** The container's full scrollable height, which clamps the result. */
  scrollHeight: number;
}

/**
 * Scroll offset that brings a revealed row into view, centred vertically and
 * clamped to the scrollable range. Pure so the arithmetic can be tested
 * without a layout engine; see revealLibraryRow for the caller.
 */
export function revealScrollTop(metrics: RevealMetrics): number {
  const { scrollTop, rowTop, viewTop, viewHeight, rowHeight } = metrics;
  const centred = scrollTop + (rowTop - viewTop)
    - Math.max(0, (viewHeight - rowHeight) / 2);
  const lowest = Math.max(0, metrics.scrollHeight - viewHeight);
  return Math.round(Math.min(Math.max(0, centred), lowest));
}

/** A docId inside a double-quoted attribute selector. */
function cssString(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * Brings one Library row into view and puts focus on it.
 *
 * Called once, right after the paint that first marks the row, rather than
 * from renderLibraryScreen: source checks repaint this screen several times
 * while a reveal is still marked, and a renderer that scrolled on every paint
 * would drag the list back under the user each time one landed. The
 * `is-revealed` mark is what survives those repaints; this is the one-time
 * move.
 */
export function revealLibraryRow(refs: ShellRefs, docId: string): void {
  const selector = `.sl-library-row[data-doc-id="${cssString(docId)}"]`;
  const row = refs.scroll.querySelector<HTMLElement>(selector);
  if (!row) return;
  refs.scroll.scrollTop = revealScrollTop({
    scrollTop: refs.scroll.scrollTop,
    rowTop: row.getBoundingClientRect().top,
    viewTop: refs.scroll.getBoundingClientRect().top,
    viewHeight: refs.scroll.clientHeight,
    rowHeight: row.offsetHeight,
    scrollHeight: refs.scroll.scrollHeight,
  });
  // Explicit order, not one selector list: a row without an openable frame
  // renders its identity as a static div, which querySelector would return
  // first and focus() would then do nothing with.
  const target = row.querySelector<HTMLElement>('button.sl-library-jump')
    ?? row.querySelector<HTMLElement>('[data-library-disclosure]')
    ?? row.querySelector<HTMLElement>('[data-library-menu]');
  target?.focus({ preventScroll: true });
}

/** The selector that re-finds a row control after its row is redrawn. */
function rowControlSelector(element: Element): string | null {
  if (element.matches('button.sl-library-jump')) return 'button.sl-library-jump';
  if (element.matches('[data-library-disclosure]')) return '[data-library-disclosure]';
  if (element.matches('[data-library-menu]')) return '[data-library-menu]';
  if (element.matches('[data-library-menu-close]')) return '[data-library-menu-close]';
  if (element.matches('[data-library-action]')) {
    const action = (element as HTMLElement).dataset.libraryAction;
    return action ? `[data-library-action="${cssString(action)}"]` : null;
  }
  return null;
}

/** The footer controls a patch can refocus after it replaces the footer. */
const FOOTER_CONTROLS = ['[data-publish-open]', '[data-library-refresh]', '[data-library-update-all]'] as const;

/** The selector that re-finds a footer control after the footer is redrawn. */
function footerControlSelector(element: Element): string | null {
  return FOOTER_CONTROLS.find((selector) => element.matches(selector)) ?? null;
}

/**
 * Redraws only what one landed source check changed: the rows whose status
 * moved (or, for the row whose overflow menu is open, whose busy-driven
 * "Update this doc" item moved), the rebuild banner's disabled state, the
 * three filter counts, and the footer. Every `driftSource` reply used to
 * repaint the whole list, which for N rows is N paints of N rows and dropped
 * focus each time. A row's controls, and the footer's, are re-found by
 * selector after the redraw, so focus stays on the same control, and an open
 * menu's on-screen position is recomputed after any row redraw, the way a
 * full paint already does.
 *
 * Returns false when only a full paint is correct: the Library list is not on
 * screen, it is loading, a filter other than All is on (a row's status
 * decides whether it is listed at all), the drawn rows are not the model's
 * rows, or the count of rows behind the rebuild banner changed (that needs
 * the banner's own markup rebuilt, not just its disabled state, and is left
 * to a full paint).
 */
export function patchLibraryDrift(refs: ShellRefs, model: LibraryScreenPresentation): boolean {
  if (!refs.screen.classList.contains('sl-library-screen')) return false;
  if (model.loading || model.filter !== 'all') return false;
  const list = refs.scroll.querySelector<HTMLElement>('.sl-library-list');
  if (!list) return false;
  const rebuilds = model.allRows.filter((row) => row.status === 'rebuildNeeded').length;
  const drawnRebuilds = list.querySelectorAll('[data-library-status="rebuildNeeded"]').length;
  if (drawnRebuilds !== rebuilds) return false;

  const drawn = new Map<string, HTMLElement>();
  for (const article of list.querySelectorAll<HTMLElement>('.sl-library-row')) {
    drawn.set(article.dataset.docId ?? '', article);
  }
  if (drawn.size !== model.rows.length || model.rows.some((row) => !drawn.has(row.docId))) return false;

  const busy = Boolean(model.refreshing || model.updatingAll || model.updatingDocId);
  // menuMarkup's overflow items are only rendered while the menu is open, and
  // only the "Update this doc" item there depends on `busy`. A row whose own
  // status did not move is otherwise left untouched, so if busy changed while
  // its menu happens to be open, that row needs redrawing too, or the open
  // menu keeps showing a disabled action a full paint would have re-enabled
  // (or the reverse).
  const busyChanged = list.dataset.busy !== String(busy);
  let redrewAny = false;
  for (const row of model.rows) {
    const article = drawn.get(row.docId)!;
    const status = article.querySelector('[data-library-status]')?.getAttribute('data-library-status');
    const openMenuBusyMoved = busyChanged && model.menuDocId === row.docId;
    if (status === row.status && !openMenuBusyMoved) continue;
    const active = document.activeElement;
    const focused = active && article.contains(active) ? rowControlSelector(active) : null;
    article.outerHTML = libraryRowMarkup(row, model.menuDocId, busy, row.docId === model.revealedDocId);
    redrewAny = true;
    if (focused) {
      list.querySelector<HTMLElement>(`.sl-library-row[data-doc-id="${cssString(row.docId)}"] ${focused}`)
        ?.focus({ preventScroll: true });
    }
  }
  list.dataset.busy = String(busy);

  const rebuildButton = refs.scroll.querySelector<HTMLElement>('[data-library-rebuild-all]');
  if (rebuildButton) {
    const disabled = busy || Boolean(model.checksIncomplete) || Boolean(model.readIncomplete) || Boolean(model.error);
    if (disabled) rebuildButton.setAttribute('disabled', '');
    else rebuildButton.removeAttribute('disabled');
  }

  for (const button of refs.scroll.querySelectorAll<HTMLElement>('[data-library-filter]')) {
    const id = button.dataset.libraryFilter as LibraryFilter | undefined;
    if (!id) continue;
    const small = button.querySelector('small');
    if (small) small.textContent = String(libraryFilterCount(model, id));
  }
  // The footer is replaced wholesale, so a focused footer control is re-found
  // by selector afterwards, the way a redrawn row's control is above. A
  // control the new footer disables cannot take focus back, which is also
  // what a full paint would do.
  const activeElement = document.activeElement;
  const footerFocus = activeElement && refs.footer.contains(activeElement)
    ? footerControlSelector(activeElement)
    : null;
  refs.footer.innerHTML = libraryFooterMarkup(model);
  if (footerFocus) refs.footer.querySelector<HTMLElement>(footerFocus)?.focus({ preventScroll: true });
  // A redrawn row's menu, if open, loses the inline `top` placeOpenRowMenu
  // set on the one it replaced; recompute it the way renderLibraryScreen
  // already does after every full paint.
  if (redrewAny) placeOpenRowMenu(refs);
  return true;
}

export function renderLibraryScreen(
  refs: ShellRefs,
  model: LibraryScreenPresentation,
): void {
  const scrollTop = refs.screen.classList.contains('sl-library-screen')
    ? refs.scroll.scrollTop
    : 0;
  refs.screen.className = 'sl-screen sl-library-screen';
  refs.pageHeader.innerHTML = libraryHeaderMarkup();
  refs.pageHeader.hidden = false;
  refs.scroll.innerHTML = libraryScrollMarkup(model);
  refs.scroll.scrollTop = scrollTop;
  refs.footer.innerHTML = libraryFooterMarkup(model);
  refs.footer.hidden = false;
  // After the scroll restore above: the menu's room depends on where the row
  // actually sits, and both entry points render through here, so the dev
  // harness cannot drift from the plugin on this.
  placeOpenRowMenu(refs);
}
