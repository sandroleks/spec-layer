/**
 * publish.ts — the "Publish for developers" screen.
 *
 * Presentation only, the same split screens/library.ts has against
 * viewModel/library.ts: `ui/publish.ts` (same basename, one directory up) owns
 * publish state, the bundle, and the proxy calls. This module turns a
 * PublishState into markup and knows nothing else.
 */

import { icon } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';
import { setupCommand, type PublishState } from '../publish';
import { CLI_DOCS_URL } from '../proxy';
import {
  formatPublishedAt, formatResetDate, type PublishAllowance,
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
 * A status block, then two groups, because this screen holds two different
 * concerns: what leaving this file means, and the key a developer needs.
 * "Anyone with the key can pull it" has to sit next to the key it is about.
 */
const WHAT_GETS_PUBLISHED =
  'The foundation document and every connected component document in this ' +
  'file, published as AI context. Publishing replaces the version before it.';

const DEVELOPER_SETUP =
  'Developers run this in their repo. It stores the pull key so later pulls '
  + 'need no key, adds that file to .gitignore, and pulls the library. Anyone '
  + 'with the key can pull it.';

/**
 * Shown only before the first publish, where the Developer setup group would
 * otherwise be. Without it the screen names an act, offers a button, and says
 * nothing about where the key a developer needs comes from.
 */
const BEFORE_FIRST_PUBLISH =
  'Publishing creates the key and setup command developers need. They appear ' +
  'here once it has run.';

/**
 * The status block: label and value rows, each present only when it has a
 * true value. "Not recorded" covers a library published by a build before
 * the date was stored; the next publish records one. Never a guessed date.
 * `locale` is for deterministic tests; the plugin passes none.
 */
function factsMarkup(state: PublishState, allowance: PublishAllowance, locale?: string): string {
  const row = (label: string, value: string) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const rows: string[] = [];
  if (!state.libraryId) {
    rows.push(row('Status', 'Not published yet'));
  } else {
    const when = state.lastPublishedAt ? formatPublishedAt(state.lastPublishedAt, locale) : null;
    rows.push(row('Last published', when ? esc(when) : 'Not recorded'));
    rows.push(row('Library id', `<code>${esc(state.libraryId)}</code>`));
  }
  if (allowance.kind === 'free') {
    const reset = formatResetDate(allowance.resetsAt);
    const tail = reset ? `, resets ${reset}` : '';
    const count = allowance.remaining <= 0
      ? `None left this month${tail}`
      : `${allowance.remaining} of ${allowance.limit} left this month${tail}`;
    rows.push(row('Free updates', count));
  }
  return `<dl class="sl-publish-facts">${rows.join('')}</dl>`;
}

/**
 * The way to the CLI reference, in the same shape as the Settings docs link
 * (an anchor with target _blank is the plugin's one established way to leave
 * the iframe). Shown wherever there is a library to pull.
 */
const DOCS_LINK =
  `<a class="sl-publish-docs" href="${CLI_DOCS_URL}" target="_blank" rel="noopener">` +
  `CLI documentation${icon('externalLink', 14)}</a>`;

/** Statuses where a publish is in flight, so the primary is working. */
function isBusy(state: PublishState): boolean {
  return state.status === 'collecting' || state.status === 'uploading';
}

/**
 * Back control, then the title.
 *
 * The `<small>` eyebrow slot is deliberately unused. It means "what kind of
 * thing the h1 names" ("Selected component" above a component's name), and a
 * clickable "Library" breadcrumb there would give one slot a second,
 * navigational category — the mistake the button-icon contract in
 * design-system/components.css was written to stop.
 */
export function publishHeaderMarkup(): string {
  return (
    '<button class="sl-icon-button sl-publish-back" type="button" ' +
    `data-publish-back aria-label="Back to Library">${icon('chevronLeft')}</button>` +
    '<div class="sl-page-header-copy"><h1>Publish for developers</h1></div>'
  );
}

/**
 * The status block, what publishing does, the setup command once there is
 * one, and the last result line. Everything here varies in height with
 * state, which is why it belongs in the scroll body rather than the
 * fixed-height footer band.
 */
export function publishScrollMarkup(
  state: PublishState, allowance: PublishAllowance, locale?: string,
): string {
  const busy = isBusy(state);
  // Rotating during an upload would race the publish on the server, so the
  // control is disabled while the footer reports work in progress. Its own
  // row: the one destructive action on the screen, kept apart from copying,
  // with its consequence directly beneath it. `is-danger` sets only the label
  // colour, which composes with the secondary tone's surface and border
  // instead of replacing them the way `data-tone="danger"` would. "Within
  // about a minute" is what the server can actually promise.
  const rotateRow =
    '<div class="sl-publish-rotate">' +
    '<button class="sl-button is-danger" data-tone="secondary" type="button" ' +
    `data-publish-rotate${busy ? ' disabled' : ''}>Rotate key</button>` +
    '</div>' +
    '<p class="sl-publish-hint">Rotating cuts off everyone using the current key ' +
    'within about a minute.</p>';
  // The id lives in the file; the key lives on the device that published or
  // rotated last. Both halves are needed for a command a developer can
  // actually run, so with only the id the screen says so and offers the one
  // way to get a key: rotate.
  const idOnly = state.libraryId && !state.pullKey
    ? (
      '<section class="sl-publish-group">' +
      '<div class="sl-settings-section-heading"><h2>Developer setup</h2>' +
      `<p>This file is published as <code>${esc(state.libraryId)}</code>. ` +
      'The pull key is not on this device, so the setup command cannot be shown here. ' +
      'Rotate the key to issue a new one.' +
      '</p></div>' +
      DOCS_LINK +
      rotateRow +
      '</section>'
    )
    : '';
  const setup = state.pullKey && state.libraryId
    ? (
      '<section class="sl-publish-group">' +
      '<div class="sl-settings-section-heading"><h2>Developer setup</h2>' +
      `<p>${DEVELOPER_SETUP}</p></div>` +
      '<div class="sl-publish-command">' +
      `<code>${esc(setupCommand(state.libraryId, state.pullKey))}</code>` +
      '</div>' +
      '<div class="sl-publish-command-actions">' +
      '<button class="sl-button" data-tone="secondary" type="button" ' +
      'data-publish-copy-command>Copy setup command</button>' +
      /*
       * The same setup as a message for a coding agent: the command with
       * `--yes`, what it does, and the command that writes the agent's guide.
       * A developer who hands the bare command to an agent leaves it to guess
       * at the files; this hands it the instructions with the key.
       */
      '<button class="sl-button" data-tone="secondary" type="button" ' +
      'data-publish-copy-agent>Copy for an AI agent</button>' +
      '</div>' +
      DOCS_LINK +
      rotateRow +
      '</section>'
    )
    : idOnly;
  const statusLine = state.message
    ? `<p class="sl-publish-status${state.status === 'error' ? ' is-error' : ''}">${esc(state.message)}</p>`
    : '';
  return (
    '<div class="sl-publish-body">' +
    factsMarkup(state, allowance, locale) +
    '<section class="sl-publish-group">' +
    '<div class="sl-settings-section-heading"><h2>What gets published</h2>' +
    `<p>${WHAT_GETS_PUBLISHED}</p>` +
    (!setup ? `<p>${BEFORE_FIRST_PUBLISH}</p>` : '') +
    '</div>' +
    '</section>' +
    setup +
    // Last, not inside either group: the message reports whichever action ran
    // last, and both Publish (the footer) and Rotate key (above) can set it.
    statusLine +
    '</div>'
  );
}

/**
 * One primary, plus a progress line while a publish runs.
 *
 * The progress line is why the button can keep a single static glyph in every
 * state (see the spinner exception in the button-icon contract): the screen
 * reports the work, so the glyph never has to. Labels follow
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
    '<button class="sl-button sl-publish-submit" data-tone="primary" ' +
    `type="button" data-publish${busy ? ' disabled' : ''}>` +
    `${icon('upload', 15)}<span>${busy ? 'Publishing…' : 'Publish library'}</span></button>` +
    '</div>'
  );
}

export function renderPublishScreen(
  refs: ShellRefs, state: PublishState, allowance: PublishAllowance,
): void {
  refs.screen.className = 'sl-screen sl-publish-screen';
  refs.pageHeader.innerHTML = publishHeaderMarkup();
  refs.pageHeader.hidden = false;
  refs.scroll.innerHTML = publishScrollMarkup(state, allowance);
  refs.scroll.scrollTop = 0;
  refs.footer.innerHTML = publishFooterMarkup(state);
  refs.footer.hidden = false;
}
