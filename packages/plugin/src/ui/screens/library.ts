/**
 * library.ts — connected documentation maintenance.
 *
 * This module is presentation only. The host owns refreshes, source checks,
 * updates, destructive confirmations, and focus changes. Capability flags on
 * each row are the only authority for which overflow actions are shown.
 */

import { FOUNDATION_ICON, icon, type IconName } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';
import { setupCommand, type PublishState } from '../publish';
import type {
  LibraryFilter,
  LibraryModel,
  LibraryRowModel,
  LibraryRowStatus,
} from '../viewModel/library';
import { loadingRowsMarkup, progressMarkup, type ProgressPresentation } from './progress';

export type { LibraryFilter } from '../viewModel/library';

export interface LibraryChangeGroupPresentation {
  label: string;
  items: readonly string[];
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
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  unavailable: 'Check unavailable',
};

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
    group.items.map((item) => `<li>${esc(item)}</li>`).join('') +
    '</ul></section>'
  );
}

function changeDetailsMarkup(row: LibraryRowPresentation): string {
  const content = row.changeGroups?.length
    ? row.changeGroups.map(changeGroupMarkup).join('')
    : (
      '<div class="sl-library-change-fallback">' +
      `${icon('alertCircle', 16)}<span><strong>Source changed</strong>` +
      '<small>A detailed comparison isn&#39;t available. Review the source from the row menu.</small>' +
      '</span></div>'
    );

  return (
    `<div id="sl-library-details-${esc(row.docId)}" class="sl-library-details"` +
    `${row.expanded ? '' : ' hidden'}>` +
    '<div class="sl-library-details-inner">' +
    '<h2>Changes</h2>' +
    `<div class="sl-library-change-list">${content}</div>` +
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
    | 'reconnect'
    | 'copy'
    | 'detach'
    | 'remove';
  glyph:
    | 'adjustments'
    | 'refresh'
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
      label: row.expanded ? 'Hide detected changes' : 'Review detected changes',
      glyph: 'adjustments',
    });
  }
  if (row.canUpdate) {
    maintenance.push({
      action: 'update',
      label: 'Update documentation',
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
      label: 'Open documentation frame',
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
  if (row.canReconnect) {
    navigation.push({
      action: 'reconnect',
      label: 'Reconnect',
      glyph: 'refresh',
    });
  }

  const destructive: MenuItem[] = [];
  if (row.canDetach) {
    destructive.push({
      action: 'detach',
      label: 'Detach documentation',
      glyph: 'externalLink',
    });
  }
  if (row.canRemove) {
    destructive.push({
      action: 'remove',
      label: 'Remove connection',
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

function libraryRowMarkup(
  row: LibraryRowPresentation,
  menuDocId: string | null,
  busy: boolean,
): string {
  const update = isUpdate(row);
  const expanded = update && row.expanded;
  const status = update
    ? (
      '<button class="sl-library-update-disclosure" type="button" ' +
      `data-library-disclosure="${esc(row.docId)}" aria-expanded="${expanded}" ` +
      `aria-controls="sl-library-details-${esc(row.docId)}" ` +
      `aria-label="Review changes for ${esc(row.label)}">` +
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
      `data-library-open-frame="${esc(row.docId)}" aria-label="Open ${esc(row.label)} in Figma">` +
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
    `<article class="sl-library-row${expanded ? ' is-expanded' : ''}" ` +
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

function emptyMarkup(filter: LibraryFilter, hasRows: boolean): string {
  if (!hasRows) {
    return (
      '<div class="sl-empty-state"><strong>No connected documents</strong>' +
      '<p>Create documentation to add it to this Library.</p></div>'
    );
  }
  if (filter === 'updates') {
    return (
      '<div class="sl-empty-state"><strong>Everything is in sync</strong>' +
      '<p>There are no documentation updates waiting.</p>' +
      '<button class="sl-button" data-tone="secondary" type="button" ' +
      'data-library-filter="all">View all docs</button></div>'
    );
  }
  return (
    '<div class="sl-empty-state"><strong>No documents in sync</strong>' +
    '<p>Updated documentation will appear here.</p>' +
    '<button class="sl-button" data-tone="secondary" type="button" ' +
    'data-library-filter="all">View all docs</button></div>'
  );
}

export function libraryHeaderMarkup(): string {
  return '<div class="sl-page-header-copy"><h1>Library</h1></div>';
}

export function libraryScrollMarkup(model: LibraryScreenPresentation): string {
  const busy = Boolean(
    model.refreshing ||
    model.updatingAll ||
    model.updatingDocId,
  );
  const filters: Array<{ id: LibraryFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: model.counts.all },
    { id: 'updates', label: 'Updates', count: model.counts.updates },
    { id: 'sync', label: 'In sync', count: model.counts.inSync },
  ];

  const filterMarkup =
    '<div class="sl-library-filters" role="group" aria-label="Library filters">' +
    filters.map(({ id, label, count }) => (
      `<button class="${model.filter === id ? 'is-selected' : ''}" type="button" ` +
      `data-library-filter="${id}" aria-pressed="${model.filter === id}">` +
      `<span>${label}</span><small>${count}</small></button>`
    )).join('') +
    '</div>';
  const content = model.loading
    ? loadingRowsMarkup(5)
    : model.rows.length
      ? (
        '<div class="sl-library-list">' +
        model.rows.map((row) => libraryRowMarkup(row, model.menuDocId, busy)).join('') +
        '</div>'
      )
      : emptyMarkup(model.filter, model.allRows.length > 0);

  return filterMarkup + content;
}

export function libraryFooterMarkup(model: LibraryScreenPresentation): string {
  const busy = Boolean(
    model.refreshing ||
    model.updatingAll ||
    model.updatingDocId,
  );
  const refreshLabel = model.refreshing ? 'Refreshing…' : 'Refresh library';
  /**
   * Label only. The glyph is fixed at `fileCheck` below and does not vary with
   * state, which is the whole of the bug this used to have: it picked
   * `refresh`, then `alertCircle`, then `check` as the state changed, so one
   * slot showed an action, then a warning, then a status. It also could not
   * take the circular arrows it wanted, because those mean "re-reads, writes
   * nothing" and belong to the "Refresh library" beside it. The failed checks
   * the old `alertCircle` reported are already visible per row as "Check
   * unavailable". See the icon contract in design-system/components.css.
   *
   * "Update all docs", not "Update all 3": see docs/plugin-voice-and-copy.md
   * ("Footer actions"). It names the same object the create buttons do, and
   * "all" is what separates it from a row's own "Update documentation" — the
   * count is already on the Updates filter beside it, and a label that changes
   * width as rows drift in and out made the button jump.
   */
  const batchLabel = model.updatingAll
    ? 'Updating…'
    : model.checksIncomplete
      ? 'Refresh to retry'
    : model.counts.updates > 0
      ? 'Update all docs'
      : 'Up to date';
  const progress = model.progress
    ? `<div class="sl-footer-progress">${progressMarkup(model.progress)}</div>`
    : '';
  return (
    progress +
    '<div class="sl-footer-actions">' +
    '<button class="sl-button sl-library-refresh" data-tone="secondary" ' +
    `type="button" data-library-refresh${busy ? ' disabled' : ''}>` +
    `${icon('refresh', 15)}<span>${refreshLabel}</span></button>` +
    '<button class="sl-button sl-library-update-all" data-tone="primary" ' +
    `type="button" data-library-update-all${busy || model.checksIncomplete || model.counts.updates === 0 ? ' disabled' : ''}>` +
    `${icon('fileCheck', 15)}<span>${batchLabel}</span></button>` +
    '</div>'
  );
}

const PUBLISH_DESCRIPTION =
  "Publishes this library's AI context so developers can pull it with the spec-layer CLI. " +
  'Publishing replaces the previously published version. Anyone with the key can pull it.';

/**
 * "Publish for developers" footer section: a button that starts a publish,
 * the setup command once a library exists, and the last status line. Kept as
 * its own function (rather than folded into libraryFooterMarkup) since the
 * host appends it to the footer independently of the row/filter model.
 */
export function publishSectionMarkup(state: PublishState, busy: boolean): string {
  const keySection = state.pullKey && state.libraryId
    ? (
      '<div class="sl-publish-command">' +
      `<code>${esc(setupCommand(state.libraryId, state.pullKey))}</code>` +
      '</div>' +
      '<div class="sl-publish-command-actions">' +
      '<button class="sl-button" data-tone="secondary" type="button" ' +
      'data-publish-copy-command>Copy setup command</button>' +
      '<button class="sl-button" data-tone="secondary" type="button" ' +
      'data-publish-rotate>Rotate key</button>' +
      '</div>' +
      '<p class="sl-publish-hint">Rotating invalidates the current key for everyone.</p>'
    )
    : '';
  const statusLine = state.message
    ? `<p class="sl-publish-status${state.status === 'error' ? ' is-error' : ''}">${esc(state.message)}</p>`
    : '';
  return (
    '<section class="sl-publish-section">' +
    '<h2>Publish for developers</h2>' +
    `<p>${PUBLISH_DESCRIPTION}</p>` +
    '<button class="sl-button" type="button" ' +
    `data-publish${busy ? ' disabled' : ''}>Publish library</button>` +
    keySection +
    statusLine +
    '</section>'
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
