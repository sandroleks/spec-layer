/**
 * Library screen markup, presentation only: the host owns refreshes, checks,
 * updates, confirmations and focus. Each row's capability flags alone decide
 * which overflow actions show.
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
  /**
   * A "has anything changed?" probe is out; its reply may start a new pass, so
   * Update, Update all and Refresh are disabled. Nothing else reads it, so the
   * labels and check line follow `refreshing` and do not flash.
   */
  probing?: boolean;
  /** At least one source check failed, so a batch would silently miss work. */
  checksIncomplete?: boolean;
  /** "Checked 4 min ago", or null before the first pass completes. Shown in
   * the check line whenever no check is running; see checkLineState. */
  checkedLabel?: string | null;
  /** A source check (or the read that finds the docs) running now. It fills
   * the check line under the filters, never the footer card. */
  checkProgress?: ProgressPresentation | null;
  updatingAll?: boolean;
  updatingDocId?: string | null;
  /** An Update or Update all run. The footer card floats this above the
   * buttons it came from; a source check goes in the check line instead. */
  progress?: ProgressPresentation | null;
  /** The row the search palette just opened, marked and scrolled to until the host clears it. */
  revealedDocId?: string | null;
  /**
   * The docs could not be read (`libraryError`). With no rows it replaces the
   * empty state, since "No docs yet" would claim an unestablished fact; with
   * earlier rows it sits above them and says they may be out of date.
   */
  error?: string | null;
  /**
   * The scan behind the rows stopped partway (`incomplete: true`): the rows are
   * real but may not be all, so nothing claims the library is complete or in
   * sync until a complete read clears this.
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
 * The rebuild banner, said once above the filters rather than under each stale
 * row. Its button carries no count, like "Update all docs", so its width holds.
 * A rebuild rewrites Keyboard because the old bullets upgrade to the table
 * lossily (see missingProseKeys in actions.ts); that caveat is the tooltip.
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
 * The second line under "Source changed" when no list can be shown. Inserted
 * without esc(), so it must stay free of markup characters.
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
    | 'sync'
    | 'detach'
    | 'remove';
  glyph:
    | 'adjustments'
    | 'fileCheck'
    | 'externalLink'
    | 'unlink'
    | 'puzzle'
    | 'download'
    | 'copy'
    | 'upload'
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
      // Matches "Update all docs"; `refresh` means the re-check, which writes nothing.
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
  if (row.canSync) {
    navigation.push({
      action: 'sync',
      label: 'Sync to Figma',
      glyph: 'upload',
    });
  }

  const destructive: MenuItem[] = [];
  if (row.canDetach) {
    destructive.push({
      action: 'detach',
      label: 'Detach this doc',
      // Not `externalLink`, which would read as "View this doc on canvas".
      glyph: 'unlink',
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
 * A foundation row wears the glyph the Foundations picker gave its source (a
 * swatch for color, a ruler for dimension, `typography` for text styles), so
 * both lists describe it the same way.
 */
function rowIcon(row: LibraryRowPresentation): IconName {
  if (row.kind !== 'foundation') return 'puzzle';
  return FOUNDATION_ICON[row.foundationIcon ?? 'mixed'];
}

const FOUNDATION_TITLE_PREFIX = 'Foundations · ';

/**
 * Drops the "Foundations · " prefix main adds (messages.ts) from the visible
 * title, where the icon already says it. The full label stays in aria-label and
 * search, and the title remains a substring of it, per WCAG 2.5.3.
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

/** A doc sheet drops into a folder and is marked in sync. Decorative, so aria-hidden. */
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
 * The read failed with nothing on screen: names the failure and offers Refresh,
 * never claiming the file has or lacks docs. `role="alert"` announces it once.
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
 * The read failed but earlier rows remain. `message` is technical detail, so it
 * goes last in parentheses without its own period; a blank one adds nothing.
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
 * The current read itself stopped partway, so it carries its own Refresh.
 * `role="status"`: a caveat on the rows, less urgent than a read failure.
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
 * The scan stopped before finding any row, with no earlier read to fall back
 * on. Nothing failed, but "No docs yet" would claim a fact the scan never
 * established. `role="status"`, like incompleteNoteMarkup.
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
 * `incomplete`: a failed re-read or partial scan means the filter's empty subset
 * is not a complete count, so "None found" is all either filter can claim.
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
 * The filters' ids and labels, shared by the full paint and patchLibraryDrift
 * so the two cannot disagree on which id maps to which count.
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

/**
 * The check line under the filters: a running check's progress, else when the
 * rows were last checked, else nothing. Always drawn at a fixed height
 * (patterns.css) with the filter group, so a check's start and end move no row.
 * The one place the rule lives, shared by the full paint and patchLibraryCheckLine.
 */
/** `live` is true for a check running now, false for the stamp of one past. */
type CheckLineState =
  | { mode: 'progress'; label: string; current: number; total: number }
  | { mode: 'text'; label: string; live: boolean }
  | { mode: 'empty' };

function checkLineState(model: LibraryScreenPresentation): CheckLineState {
  const progress = model.checkProgress;
  if (progress) {
    const { label, current, total } = progress;
    return current !== undefined && total !== undefined && total > 0
      ? { mode: 'progress', label, current: Math.max(0, Math.min(current, total)), total }
      : { mode: 'text', label, live: true };
  }
  // A check with no progress to show says nothing rather than a stamp the
  // check under way is about to replace.
  if (model.refreshing) return { mode: 'empty' };
  return model.checkedLabel
    ? { mode: 'text', label: model.checkedLabel, live: false }
    : { mode: 'empty' };
}

function checkLineContent(state: CheckLineState): string {
  if (state.mode === 'empty') return '';
  if (state.mode === 'text') return `<span class="sl-library-check-label">${esc(state.label)}</span>`;
  const percent = Math.round((state.current / state.total) * 100);
  return (
    `<span class="sl-library-check-label">${esc(state.label)}</span>` +
    `<span class="sl-progress-track" role="progressbar" aria-valuemin="0" ` +
    `aria-valuemax="${state.total}" aria-valuenow="${state.current}" ` +
    `aria-label="${esc(state.label)}"><i style="width:${percent}%"></i></span>` +
    `<span class="sl-library-check-count">${state.current} of ${state.total}</span>`
  );
}

/** Polite while a check runs; off otherwise, so the minute-by-minute stamp is not read out. */
function checkLineLive(state: CheckLineState): 'polite' | 'off' {
  return state.mode === 'progress' || (state.mode === 'text' && state.live) ? 'polite' : 'off';
}

function libraryCheckLineMarkup(model: LibraryScreenPresentation): string {
  const state = checkLineState(model);
  return (
    `<div class="sl-library-check-line" data-library-check-line data-mode="${state.mode}" ` +
    `aria-live="${checkLineLive(state)}">${checkLineContent(state)}</div>`
  );
}

export function libraryScrollMarkup(model: LibraryScreenPresentation): string {
  const busy = Boolean(
    model.refreshing ||
    model.probing ||
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
    (noDocs ? '' : filterMarkup + libraryCheckLineMarkup(model)) +
    content
  );
}

export function libraryFooterMarkup(model: LibraryScreenPresentation): string {
  const busy = Boolean(
    model.refreshing ||
    model.probing ||
    model.updatingAll ||
    model.updatingDocId,
  );
  const refreshLabel = model.refreshing ? 'Refreshing…' : 'Refresh library';
  /**
   * Only the label varies; the glyph stays `fileCheck`, since one slot must not
   * show an action, then a warning, then a status. See the icon contract in
   * design-system/components.css. "Update all docs", not "Update all 3": see
   * docs/plugin-voice-and-copy.md ("Footer actions"); the count is on the
   * Updates filter, and a label that changes width makes the button jump.
   */
  // One boolean for the label and the disabled attribute, so they cannot
  // disagree; `error` counts because stale rows behind a failed re-read cannot
  // be trusted for the update count either.
  const batchUnreliable = Boolean(model.checksIncomplete) || Boolean(model.readIncomplete) || Boolean(model.error);
  // "Up to date" is a completeness claim: every check landed, none failed, every
  // source exists. While `refreshing` a check is in flight, so "Checking…" wins
  // over "Refresh to retry". An orphaned row gets its own honest label.
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
    // Never disabled: it only opens the Publish screen, whose own primary
    // disables itself while publishing.
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

/** Row-relative `top` for an open row menu, or null for the CSS default; see placeOpenRowMenu. */
export function rowMenuTop(metrics: RowMenuMetrics): number | null {
  const { rowTop, viewTop, viewBottom, height } = metrics;
  // Every bound is row-relative, matching the `top` this returns.
  const lowest = viewBottom - MENU_EDGE_GAP - height - rowTop;
  if (MENU_BELOW_TOP <= lowest) return null;

  const highest = viewTop + MENU_EDGE_GAP - rowTop;
  const above = MENU_ABOVE_BOTTOM - height;
  // A menu taller than the viewport cannot satisfy both bounds; top-align it so
  // its first items stay reachable rather than clipping them off the top.
  return Math.round(Math.min(Math.max(above, highest), Math.max(lowest, highest)));
}

/**
 * Keeps an open row menu inside the scroll viewport, which clips it above the
 * opaque sticky footer: measures once and flips the menu above the row when it
 * does not fit below. Once is enough because the host closes the menu on
 * scroll; row index cannot stand in, since room depends on scroll position and
 * on how many actions the row has.
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
  scrollTop: number;
  /** Viewport y of the row being revealed, and of the container itself. */
  rowTop: number;
  viewTop: number;
  viewHeight: number;
  rowHeight: number;
  /** The container's full scrollable height, which clamps the result. */
  scrollHeight: number;
}

/** Scroll offset that centres a revealed row, clamped to the scrollable range. */
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
 * Brings one Library row into view and focuses it, once, right after the paint
 * that first marks it: source checks repaint while the mark stays, and
 * scrolling on every paint would drag the list from under the user.
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
  // Explicit order: a row with no openable frame draws its identity as a static
  // div, which one selector list would return first.
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
 * Redraws only what one landed source check changed (moved rows, an open
 * menu's busy-driven item, the rebuild button, filter counts, the check line,
 * the footer), keeping focus on the same control, so a pass of N replies does
 * not paint N rows N times.
 *
 * False when only a full paint is correct: the list is not on screen or is
 * loading, a filter other than All is on, the drawn rows differ from the
 * model's, or the rebuild count changed.
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

  const busy = Boolean(model.refreshing || model.probing || model.updatingAll || model.updatingDocId);
  // Only an open menu's "Update this doc" item depends on `busy`, so a row
  // whose status held still is redrawn when busy changes under its open menu.
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

  patchLibraryCheckLine(refs, model);

  // A focused footer control is re-found by selector; one the new footer
  // disables cannot take focus back, as with a full paint.
  const activeElement = document.activeElement;
  const footerFocus = activeElement && refs.footer.contains(activeElement)
    ? footerControlSelector(activeElement)
    : null;
  refs.footer.innerHTML = libraryFooterMarkup(model);
  if (footerFocus) refs.footer.querySelector<HTMLElement>(footerFocus)?.focus({ preventScroll: true });
  // A redrawn row's open menu loses its inline `top`; recompute it.
  if (redrewAny) placeOpenRowMenu(refs);
  return true;
}

/**
 * Rewrites only the check line, so the caption timer never touches the rows or
 * footer. Between progress states it moves the existing bar, so its width
 * transition runs instead of restarting.
 */
export function patchLibraryCheckLine(refs: ShellRefs, model: LibraryScreenPresentation): void {
  const line = refs.scroll.querySelector<HTMLElement>('[data-library-check-line]');
  if (!line) return;
  const state = checkLineState(model);
  line.setAttribute('aria-live', checkLineLive(state));
  const bar = line.querySelector<HTMLElement>('.sl-progress-track');
  if (state.mode === 'progress' && line.dataset.mode === 'progress' && bar) {
    const label = line.querySelector('.sl-library-check-label');
    if (label) label.textContent = state.label;
    bar.setAttribute('aria-valuemax', String(state.total));
    bar.setAttribute('aria-valuenow', String(state.current));
    bar.setAttribute('aria-label', state.label);
    const fill = bar.querySelector<HTMLElement>('i');
    if (fill) fill.style.width = `${Math.round((state.current / state.total) * 100)}%`;
    const count = line.querySelector('.sl-library-check-count');
    if (count) count.textContent = `${state.current} of ${state.total}`;
    return;
  }
  line.dataset.mode = state.mode;
  line.innerHTML = checkLineContent(state);
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
  // After the scroll restore: the menu's room depends on where the row sits.
  placeOpenRowMenu(refs);
}
