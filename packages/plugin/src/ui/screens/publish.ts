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
import { publishAllowanceCopy, type PublishAllowance } from '../viewModel/allowance';
import { progressMarkup } from './progress';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Two groups, because this screen holds two different concerns: what leaving
 * this file means, and the key a developer needs. "Anyone with the key can
 * pull it" has to sit next to the key it is about.
 */
const WHAT_GETS_PUBLISHED =
  "This library's AI context: the foundation document and every connected " +
  'component document. Publishing replaces the version published before it.';

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
 * Defines the noun the screen counts. "Library" is the technical name the CLI
 * and proxy use; the allowance below counts Figma files and updates, so the
 * two have to be tied together once, where both are visible.
 */
const LIBRARY_DEFINITION =
  'A library is this Figma file, published for developers to pull with the CLI.';

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
 * What publishing does, the setup command once there is one, and the last
 * status line. Everything here varies in height with state, which is why it
 * belongs in the scroll body rather than the fixed-height footer band.
 */
export function publishScrollMarkup(state: PublishState, allowance: PublishAllowance): string {
  const busy = isBusy(state);
  // Rotating during an upload would race the publish on the server, so the
  // control is disabled while the footer reports work in progress.
  const rotateButton =
    '<button class="sl-button is-danger" data-tone="secondary" type="button" ' +
    `data-publish-rotate${busy ? ' disabled' : ''}>Rotate key</button>`;
  // Names the action, since it sits under a row of two: the consequence
  // belongs to rotating, not to the copy button beside it. "Within about a
  // minute" is what the server can actually promise.
  const rotateHint =
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
      `<div class="sl-publish-command-actions">${rotateButton}</div>` +
      rotateHint +
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
      /*
       * Copying is the action taken every time; rotating cuts off every
       * developer already pulling this library. Both are real buttons in one
       * row, so the weighting is carried by colour rather than by placement:
       * `is-danger` sets only the label colour, which composes with the
       * secondary tone's surface and border instead of replacing them the way
       * `data-tone="danger"` would. Second in the row, since copy is what the
       * user came for.
       */
      rotateButton +
      '</div>' +
      rotateHint +
      '</section>'
    )
    : idOnly;
  const statusLine = state.message
    ? `<p class="sl-publish-status${state.status === 'error' ? ' is-error' : ''}">${esc(state.message)}</p>`
    : '';
  const allowanceLine = publishAllowanceCopy(allowance);
  return (
    '<div class="sl-publish-body">' +
    `<p class="sl-publish-definition">${LIBRARY_DEFINITION}</p>` +
    '<section class="sl-publish-group">' +
    '<div class="sl-settings-section-heading"><h2>What gets published</h2>' +
    `<p>${WHAT_GETS_PUBLISHED}</p>` +
    (!setup ? `<p>${BEFORE_FIRST_PUBLISH}</p>` : '') +
    '</div>' +
    '</section>' +
    (allowanceLine ? `<p class="sl-publish-allowance">${esc(allowanceLine)}</p>` : '') +
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
