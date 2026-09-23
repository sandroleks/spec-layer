/**
 * history.ts (screen): the version history pane. Presentation only, the same
 * split screens/publish.ts has against ui/publish.ts. One sl-library-row per
 * record, newest first, with a disclosure that opens one card of changes per
 * component.
 */
import type { VersionRecord } from '@spec-layer/extractor';
import { icon } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';
import type { HistoryState } from '../history';
import { formatPublishedAt } from '../viewModel/allowance';
import { groupChanges, bumpLabel, bumpExplanation, bumpTone, type HistoryCard } from '../viewModel/history';

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

/**
 * The bump word, with its one-sentence meaning in the shell's tooltip
 * pattern. The trigger is the wrapper span, so hovering the badge shows it;
 * a focus rule in patterns.css shows it when the disclosure has keyboard
 * focus, since the badge sits inside that button.
 */
function badge(record: VersionRecord): string {
  const tone = bumpTone(record.bump);
  return (
    '<span class="sl-history-bump" data-tooltip-trigger>' +
    `<span class="sl-badge"${tone ? ` data-tone="${tone}"` : ''}>${esc(bumpLabel(record.bump))}</span>` +
    `<span class="sl-tooltip" role="tooltip">${esc(bumpExplanation(record.bump))}</span>` +
    '</span>'
  );
}

function cardMarkup(card: HistoryCard): string {
  const items = card.items.map((item) => {
    const values = item.from !== null || item.to !== null
      ? `<span class="sl-history-values">${item.from !== null ? `<span class="sl-history-from">${esc(item.from)}</span>` : ''}` +
        `${item.to !== null ? `<span class="sl-history-to">${esc(item.to)}</span>` : ''}</span>`
      : '';
    const scope = item.scope ? `<span class="sl-library-change-scope">${esc(item.scope)}</span>` : '';
    return `<li data-change-kind="${item.kind}"><span class="sl-history-name">${esc(item.text)}</span>${values}${scope}</li>`;
  }).join('');
  return `<div class="sl-library-change-group"><strong>${esc(card.label)}</strong><ul>${items}</ul></div>`;
}

function detailsMarkup(record: VersionRecord, expanded: boolean): string {
  const total = record.counts.major + record.counts.minor + record.counts.patch;
  let content: string;
  if (record.changes.length === 0 && record.changesTruncated) {
    // Compacted by the proxy's log cap (see versions.ts compactLog): the
    // counts survive, but the per-change list this old does not. Never claim
    // "No changes" over a version that plainly had some.
    content =
      '<p class="sl-library-change-fallback"><strong>Older versions keep only a count of their changes. ' +
      `This one had ${total}.</strong></p>`;
  } else if (record.changes.length === 0 && record.bump === 'initial') {
    content = '<p class="sl-library-change-fallback"><strong>The first publish. Nothing to compare against.</strong></p>';
  } else if (record.changes.length === 0) {
    content =
      '<p class="sl-library-change-fallback"><strong>No changes to components, variables, or styles. ' +
      'Text changes, such as descriptions, aren’t listed.</strong></p>';
  } else {
    content = groupChanges(record.changes).map(cardMarkup).join('');
    if (record.changesTruncated) {
      content +=
        `<p class="sl-history-truncated">Showing the first ${record.changes.length} of ${total} changes. ` +
        'The full list was too large to store.</p>';
    }
  }
  return (
    `<div id="sl-history-details-${esc(record.version)}" class="sl-library-details"${expanded ? '' : ' hidden'}>` +
    `<div class="sl-library-details-inner"><h2>Changes</h2><div class="sl-library-change-list">${content}</div></div></div>`
  );
}

/**
 * One row is one button. The version, its badge, the date, the chevron, and
 * the note all sit inside the disclosure, so a click anywhere on the row
 * opens the changes; a chip-sized target on a full-width row read as a
 * control that only worked in one spot. The button's accessible name is its
 * content, which names the version, the bump, and the date in reading order.
 */
function rowMarkup(record: VersionRecord, expanded: boolean, locale?: string): string {
  const when = formatPublishedAt(record.publishedAt, locale);
  const version = esc(record.version);
  return (
    `<article class="sl-library-row sl-history-row${expanded ? ' is-expanded' : ''}" data-version="${version}">` +
    `<button class="sl-history-summary" type="button" data-history-disclosure="${version}" ` +
    `aria-expanded="${expanded}" aria-controls="sl-history-details-${version}">` +
    `<strong>v${version}</strong>${badge(record)}` +
    `<time datetime="${esc(record.publishedAt)}">${esc(when ?? record.publishedAt)}</time>` +
    `<span class="sl-library-chevron${expanded ? ' is-expanded' : ''}">${icon('chevronDown', 14)}</span>` +
    (record.note ? `<span class="sl-history-note">${esc(record.note)}</span>` : '') +
    '</button>' +
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
      body = empty(
        'This device doesn’t have the pull key. Only the device that first published this file, ' +
        'or last rotated its key, has it. Open History there, or rotate the key on the Publish screen.',
      );
      break;
    case 'gone':
      body = empty(
        'This published library no longer exists on Spec Layer. Publish again to create a new one, ' +
        'then give developers the new setup command.',
      );
      break;
    case 'error':
      body = empty(esc(state.message), true);
      break;
    case 'ready':
      if (state.log && state.log.records.length > 0) {
        // Rows run edge to edge, the way the Library list does, so the hover
        // band and the hairlines span the panel instead of reading as an
        // inset card. Prose states below keep the padded Publish body.
        const rows = state.log.records.map((record) => rowMarkup(record, state.expanded === record.version, locale)).join('');
        return `<div class="sl-history-list">${rows}</div>`;
      }
      body = empty('No versions yet. Your next publish starts the history at 1.0.0.');
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
