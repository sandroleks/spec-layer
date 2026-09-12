/**
 * publish.ts — the Publish screen.
 *
 * Presentation only, the same split screens/library.ts has against
 * viewModel/library.ts: `ui/publish.ts` (same basename, one directory up) owns
 * publish state, the bundle, and the proxy calls. This module turns a
 * PublishState into markup and knows nothing else.
 *
 * The screen is deliberately short. It states where the library stands, hands
 * over the two things a reader came for (the developer command and the agent
 * prompt, each visible in full with its own Copy), and leaves the explanation
 * of publishing and pulling to the documentation the footer links to.
 */

import { icon } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';
import { agentSetupMessage, setupCommand, type PublishState } from '../publish';
import { PUBLISH_DOCS_URL } from '../proxy';
import {
  formatPublishedAt, publishAllowanceCopy, type PublishAllowance,
} from '../viewModel/allowance';
import { progressMarkup } from './progress';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The one sentence of explanation, shown only before the first publish, where
 * the setup blocks would otherwise be. Once there is a library the blocks
 * speak for themselves and the footer's documentation link carries the rest.
 * Names both audiences: the command is for a developer, the prompt for a
 * coding agent, and neither is the whole point.
 */
const BEFORE_FIRST_PUBLISH =
  "Publishes this file's foundation and component docs as context for " +
  'developers and coding agents. The setup commands appear here after the ' +
  'first publish.';

/** Statuses where a publish OR a download is in flight, so the primary is
 *  working. Intent-blind by design: both share the one collect round trip. */
function isBusy(state: PublishState): boolean {
  return state.status === 'collecting' || state.status === 'uploading';
}

/**
 * The footer's primary is always the Publish action (the download has its own
 * button in the scroll body), but the two intents share one collect, so this
 * button also goes busy and disables while a download runs. Saying
 * "Publishing…" then would claim an action the user never took: `intent`
 * (already in `state` for `skippedMessage`, see ui/publish.ts) says which
 * round trip is actually in flight, so the busy label can say so honestly.
 */
function busyLabel(state: PublishState): string {
  return state.intent === 'download' ? 'Downloading…' : 'Publishing…';
}

/**
 * Back control, the title, and a status pill.
 *
 * The title is the act alone, "Publish", like the Library footer button that
 * opens this screen. It used to say "for developers", which named half the
 * audience: the agent prompt below is for a coding agent. The pill is the
 * status at a glance; the meta line under the header carries the date.
 *
 * The `<small>` eyebrow slot is deliberately unused. It means "what kind of
 * thing the h1 names" ("Selected component" above a component's name), and a
 * clickable "Library" breadcrumb there would give one slot a second,
 * navigational category — the mistake the button-icon contract in
 * design-system/components.css was written to stop.
 */
export function publishHeaderMarkup(state: PublishState): string {
  const pill = state.libraryId
    ? '<span class="sl-badge" data-tone="success">Published</span>'
    : '<span class="sl-badge">Not published</span>';
  return (
    '<button class="sl-icon-button sl-publish-back" type="button" ' +
    `data-publish-back aria-label="Back to Library">${icon('chevronLeft')}</button>` +
    `<div class="sl-page-header-copy sl-publish-title"><h1>Publish</h1>${pill}</div>`
  );
}

/**
 * One muted line under the header: when the library was last published, and
 * on a free plan how many updates are left. Each part appears only when it
 * has a true value. "Not recorded" covers a library published by a build
 * before the date was stored; the next publish records one. Never a guessed
 * date. `locale` is for deterministic tests; the plugin passes none.
 */
function metaMarkup(state: PublishState, allowance: PublishAllowance, locale?: string): string {
  const parts: string[] = [];
  if (state.libraryId) {
    const when = state.lastPublishedAt ? formatPublishedAt(state.lastPublishedAt, locale) : null;
    parts.push(when ? `Last published ${esc(when)}` : 'Last published date not recorded');
  }
  // The allowance sentence is the view model's, shared with the publish error
  // copy, so the meter and the 402 line can never disagree on the numbers.
  const allowanceLine = publishAllowanceCopy(allowance);
  if (allowanceLine) parts.push(esc(allowanceLine));
  if (parts.length === 0) return '';
  return `<p class="sl-publish-meta">${parts.map((p) => `<span>${p}</span>`).join('')}</p>`;
}

/**
 * A labelled block with the full text visible and one Copy. Both blocks have
 * the same shape so the reader learns it once: the developer's command and
 * the agent's prompt are peers, not a primary and a variant.
 */
function copyBlock(kind: 'command' | 'agent', label: string, text: string): string {
  return (
    '<section class="sl-publish-block">' +
    `<div class="sl-publish-block-head"><h2>${label}</h2>` +
    '<button class="sl-button" data-tone="secondary" data-size="small" type="button" ' +
    `data-publish-copy-${kind}>Copy</button></div>` +
    `<pre class="sl-publish-code"><code>${esc(text)}</code></pre>` +
    '</section>'
  );
}

/**
 * The no-account route. Sits below the setup blocks in every state, including
 * before the first publish, because a snapshot depends on nothing the publish
 * service holds. Disabled while a collect is in flight, since both actions
 * share one round trip.
 */
function downloadBlock(busy: boolean): string {
  return (
    '<section class="sl-publish-block sl-publish-download">' +
    '<div class="sl-publish-block-head"><h2>Download a snapshot</h2></div>' +
    '<p class="sl-publish-note">A zip of everything this file documents: component briefs, ' +
    'design tokens, and a SKILL.md a coding agent reads. No account needed. It does not ' +
    'update, so download it again after the design system changes.</p>' +
    '<button class="sl-button" data-tone="secondary" type="button" ' +
    `data-publish-download${busy ? ' disabled' : ''}>Download snapshot (.zip)</button>` +
    '</section>'
  );
}

/**
 * The meta line, the setup blocks once there is a key, the rotate action, and
 * an error line when the last action failed. Successes are toasts (see the
 * controller's `notify`), so nothing here restates them. Everything varies in
 * height with state, which is why it lives in the scroll body rather than the
 * fixed-height footer band.
 */
export function publishScrollMarkup(
  state: PublishState, allowance: PublishAllowance, locale?: string,
): string {
  const busy = isBusy(state);
  // Rotating during an upload would race the publish on the server, so the
  // control is disabled while the footer reports work in progress. Its own
  // row, apart from the copy actions: the one destructive control on the
  // screen. `is-danger` sets only the label colour, which composes with the
  // secondary tone's surface and border instead of replacing them the way
  // `data-tone="danger"` would.
  const rotateRow =
    '<div class="sl-publish-rotate">' +
    '<button class="sl-button is-danger" data-tone="secondary" type="button" ' +
    `data-publish-rotate${busy ? ' disabled' : ''}>Rotate key</button>` +
    '</div>';
  let body: string;
  if (state.libraryId && state.pullKey) {
    body =
      copyBlock('command', 'Developer setup', setupCommand(state.libraryId, state.pullKey)) +
      copyBlock('agent', 'AI agent setup', agentSetupMessage(state.libraryId, state.pullKey)) +
      rotateRow;
  } else if (state.libraryId) {
    // The id lives in the file; the key lives on the device that published or
    // rotated last, because the server hands it out only then and the file is
    // readable by every editor. Both halves are needed for a command a
    // developer can actually run, so with only the id the screen says where
    // the key is and names both ways out: ask, or rotate. This is the one
    // place the rotate consequence is stated, since rotating from here cuts
    // off developers the reader may not know about.
    body =
      '<section class="sl-publish-block">' +
      '<div class="sl-publish-block-head"><h2>Developer setup</h2></div>' +
      `<p class="sl-publish-note">This file is published as <code>${esc(state.libraryId)}</code>. ` +
      'The pull key is stored on the device that published it. Ask that person ' +
      'for the setup command, or rotate the key to issue a new one here. ' +
      'Rotating stops the current key working for everyone within about a minute.</p>' +
      '</section>' +
      rotateRow;
  } else {
    body = `<p class="sl-publish-intro">${BEFORE_FIRST_PUBLISH}</p>`;
  }
  // Errors stay on screen until the next action; a toast would be gone before
  // the reader looked up from the button.
  const errorLine = state.status === 'error' && state.message
    ? `<p class="sl-publish-status is-error">${esc(state.message)}</p>`
    : '';
  return (
    '<div class="sl-publish-body">' +
    metaMarkup(state, allowance, locale) +
    body +
    downloadBlock(busy) +
    errorLine +
    '</div>'
  );
}

/**
 * The way to the docs, then the one primary, plus a progress line while a
 * publish runs.
 *
 * Documentation is a footer secondary rather than a link in the body: the
 * body no longer explains publishing, so the explanation needs a permanent,
 * findable exit. An anchor with target _blank is the plugin's established way
 * to leave the iframe (Settings > About does the same).
 *
 * The progress line is why the primary can keep a single static glyph in
 * every state (see the spinner exception in the button-icon contract): the
 * screen reports the work, so the glyph never has to. Labels follow
 * docs/plugin-voice-and-copy.md — the busy label is the present participle plus
 * an ellipsis, the same button working rather than a new action, and the
 * progress labels carry no ellipsis because `sl-work-dots` animates one.
 */
export function publishFooterMarkup(state: PublishState): string {
  const busy = isBusy(state);
  const progress = busy
    ? (
      '<div class="sl-footer-progress">' +
      progressMarkup({
        label: state.status === 'collecting' ? 'Collecting sources' : 'Uploading library',
      }) +
      '</div>'
    )
    : '';
  return (
    progress +
    '<div class="sl-footer-actions">' +
    `<a class="sl-button sl-publish-docs" data-tone="secondary" href="${PUBLISH_DOCS_URL}" ` +
    'target="_blank" rel="noopener">' +
    `<span>Read documentation</span>${icon('externalLink', 15)}</a>` +
    '<button class="sl-button sl-publish-submit" data-tone="primary" ' +
    `type="button" data-publish${busy ? ' disabled' : ''}>` +
    `${icon('upload', 15)}<span>${busy ? busyLabel(state) : 'Publish library'}</span></button>` +
    '</div>'
  );
}

export function renderPublishScreen(
  refs: ShellRefs, state: PublishState, allowance: PublishAllowance,
): void {
  refs.screen.className = 'sl-screen sl-publish-screen';
  refs.pageHeader.innerHTML = publishHeaderMarkup(state);
  refs.pageHeader.hidden = false;
  refs.scroll.innerHTML = publishScrollMarkup(state, allowance);
  refs.scroll.scrollTop = 0;
  refs.footer.innerHTML = publishFooterMarkup(state);
  refs.footer.hidden = false;
}
