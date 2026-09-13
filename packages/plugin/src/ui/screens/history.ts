/**
 * history.ts (screen): the version history pane. Presentation only, the same
 * split screens/publish.ts has against ui/publish.ts. One sl-library-row per
 * record, newest first, with a disclosure that opens the grouped change list.
 */
import type { VersionRecord } from '@spec-layer/extractor';
import { icon } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';
import type { HistoryState } from '../history';
import { formatPublishedAt } from '../viewModel/allowance';
import { groupChanges, bumpLabel, bumpTone, type HistoryGroup } from '../viewModel/history';

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function historyHeaderMarkup(): string {
  return (
    '<button class="sl-icon-button sl-publish-back" type="button" ' +
    `data-history-back aria-label="Back to Publish">${icon('chevronLeft')}</button>` +
    '<div class="sl-page-header-copy"><h1>Version history</h1></div>'
  );
}

function badge(record: VersionRecord): string {
  const tone = bumpTone(record.bump);
  return `<span class="sl-badge"${tone ? ` data-tone="${tone}"` : ''}>${esc(bumpLabel(record.bump))}</span>`;
}

function groupMarkup(group: HistoryGroup): string {
  const items = group.items.map((item) => {
    const values = item.from !== null || item.to !== null
      ? `<span class="sl-history-values">${item.from !== null ? `<span class="sl-history-from">${esc(item.from)}</span>` : ''}` +
        `${item.to !== null ? `<span class="sl-history-to">${esc(item.to)}</span>` : ''}</span>`
      : '';
    const scope = item.scope ? `<span class="sl-library-change-scope">${esc(item.scope)}</span>` : '';
    return `<li><span class="sl-history-name">${esc(item.label)}</span>${values}${scope}</li>`;
  }).join('');
  return `<div class="sl-library-change-group"><strong>${group.label}</strong><ul>${items}</ul></div>`;
}

function detailsMarkup(record: VersionRecord, expanded: boolean): string {
  const total = record.counts.major + record.counts.minor + record.counts.patch;
  let content: string;
  if (record.changes.length === 0) {
    content = '<p class="sl-library-change-fallback"><strong>No property changes</strong></p>';
  } else {
    content = groupChanges(record.changes).map(groupMarkup).join('');
    if (record.changesTruncated) {
      content += `<p class="sl-history-truncated">Showing the first ${record.changes.length} changes of ${total}</p>`;
    }
  }
  return (
    `<div id="sl-history-details-${esc(record.version)}" class="sl-library-details"${expanded ? '' : ' hidden'}>` +
    `<div class="sl-library-details-inner"><h2>Changes</h2><div class="sl-library-change-list">${content}</div></div></div>`
  );
}

function rowMarkup(record: VersionRecord, expanded: boolean, locale?: string): string {
  const when = formatPublishedAt(record.publishedAt, locale);
  return (
    `<article class="sl-library-row sl-history-row${expanded ? ' is-expanded' : ''}" data-version="${esc(record.version)}">` +
    '<div class="sl-library-summary">' +
    '<button class="sl-library-update-disclosure" type="button" ' +
    `data-history-disclosure="${esc(record.version)}" aria-expanded="${expanded}" ` +
    `aria-controls="sl-history-details-${esc(record.version)}" aria-label="Changes in ${esc(record.version)}">` +
    `<strong>v${esc(record.version)}</strong>${badge(record)}` +
    `<span class="sl-library-chevron${expanded ? ' is-expanded' : ''}">${icon('chevronDown', 14)}</span>` +
    '</button>' +
    `<time datetime="${esc(record.publishedAt)}">${esc(when ?? record.publishedAt)}</time>` +
    (record.note ? `<p class="sl-history-note">${esc(record.note)}</p>` : '') +
    '</div>' +
    detailsMarkup(record, expanded) +
    '</article>'
  );
}

export function historyScrollMarkup(state: HistoryState, locale?: string): string {
  const empty = (text: string, retry = false) =>
    `<p class="sl-publish-intro">${text}</p>` +
    (retry ? '<button class="sl-button" data-tone="secondary" type="button" data-history-retry>Try again</button>' : '');
  let body: string;
  switch (state.status) {
    case 'idle':
    case 'loading':
      body = empty('Loading versions<span class="sl-work-dots"><i></i><i></i><i></i></span>');
      break;
    case 'noLibrary':
      body = empty('Publish this file to start a version history.');
      break;
    case 'noKey':
      body = empty('Version history needs this library\'s pull key, which is stored on the device that published it. Ask that person, or rotate the key from the Publish screen.');
      break;
    case 'gone':
      body = empty('That library no longer exists on the publish service. Publish again to create a new one.');
      break;
    case 'error':
      body = empty(esc(state.message ?? 'Could not load the version history.'), true);
      break;
    case 'ready':
      body = !state.log || state.log.records.length === 0
        ? empty('No versions yet. The first publish creates 1.0.0.')
        : state.log.records.map((record) => rowMarkup(record, state.expanded === record.version, locale)).join('');
      break;
  }
  return `<div class="sl-publish-body sl-history-body">${body}</div>`;
}

export function renderHistoryScreen(refs: ShellRefs, state: HistoryState): void {
  refs.screen.className = 'sl-screen sl-publish-screen sl-history-screen';
  refs.pageHeader.innerHTML = historyHeaderMarkup();
  refs.pageHeader.hidden = false;
  refs.scroll.innerHTML = historyScrollMarkup(state);
  refs.scroll.scrollTop = 0;
  refs.footer.innerHTML = '';
  refs.footer.hidden = true;
}
