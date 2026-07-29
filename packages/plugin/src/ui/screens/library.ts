/**
 * library.ts — connected documentation maintenance.
 *
 * This module is presentation only. The host owns refreshes, source checks,
 * updates, destructive confirmations, and focus changes. Capability flags on
 * each row are the only authority for which overflow actions are shown.
 */

import { icon } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';
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
    | 'download'
    | 'reconnect'
    | 'detach'
    | 'remove';
  glyph:
    | 'adjustments'
    | 'refresh'
    | 'externalLink'
    | 'puzzle'
    | 'download'
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
      glyph: 'refresh',
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
  if (row.canDownload) {
    navigation.push({
      action: 'download',
      label: 'Download documentation',
      glyph: 'download',
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
  const jump = row.canOpenFrame
    ? (
      '<button class="sl-library-jump" type="button" ' +
      `data-library-open-frame="${esc(row.docId)}" aria-label="Open ${esc(row.label)} in Figma">` +
      `<span class="sl-library-source-icon">${icon('puzzle', 17)}</span>` +
      '<span class="sl-library-identity">' +
      `<strong>${esc(row.label)}</strong><small>${esc(row.sourceLabel)}</small>` +
      '</span></button>'
    )
    : (
      '<div class="sl-library-jump is-static">' +
      `<span class="sl-library-source-icon">${icon('puzzle', 17)}</span>` +
      '<span class="sl-library-identity">' +
      `<strong>${esc(row.label)}</strong><small>${esc(row.sourceLabel)}</small>` +
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
    '<div class="sl-library-filters" role="tablist" aria-label="Library filters">' +
    filters.map(({ id, label, count }) => (
      `<button class="${model.filter === id ? 'is-selected' : ''}" type="button" ` +
      `role="tab" data-library-filter="${id}" aria-selected="${model.filter === id}">` +
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
  const batchLabel = model.updatingAll
    ? 'Updating…'
    : model.checksIncomplete
      ? 'Refresh to retry'
    : model.counts.updates > 0
      ? `Update all ${model.counts.updates}`
      : 'Up to date';
  const progress = model.progress
    ? `<div class="sl-footer-progress">${progressMarkup(model.progress)}</div>`
    : '';
  return (
    progress +
    '<div class="sl-footer-actions">' +
    '<button class="sl-button sl-library-refresh" data-tone="secondary" ' +
    `type="button" data-library-refresh${busy ? ' disabled' : ''}>` +
    `${icon('refresh', 16)}<span>${refreshLabel}</span></button>` +
    '<button class="sl-button sl-library-update-all" data-tone="primary" ' +
    `type="button" data-library-update-all${busy || model.checksIncomplete || model.counts.updates === 0 ? ' disabled' : ''}>` +
    `${icon('refresh', 16)}<span>${batchLabel}</span></button>` +
    '</div>'
  );
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
}
