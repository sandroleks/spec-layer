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
 * Shown instead of the publish action on a free plan.
 *
 * Publishing is a Pro action the proxy already enforces (`proCaller` in
 * packages/proxy/src/libraries.ts answers 401 to every other tier). Stating the
 * plan up front saves a free plan a collection pass over every component in
 * the file that would end in that refusal.
 */
const PRO_ONLY =
  'Publishing is part of Pro. Upgrade to publish this library, and to get the ' +
  'key and setup command developers need.';

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
export function publishScrollMarkup(state: PublishState, locked: boolean): string {
  const busy = isBusy(state);
  // Rotating during an upload would race the publish on the server, so the
  // control is disabled while the footer reports work in progress.
  // Rotating is a Pro call too, so a locked screen offers no rotate control and
  // no consequence line for one. What a lapsed license already published stays
  // pullable, and the command it needs is still shown below.
  const rotateButton = locked
    ? ''
    : '<button class="sl-button is-danger" data-tone="secondary" type="button" ' +
      `data-publish-rotate${busy ? ' disabled' : ''}>Rotate key</button>`;
  // Names the action, since it sits under a row of two: the consequence
  // belongs to rotating, not to the copy button beside it. "Within about a
  // minute" is what the server can actually promise.
  const rotateHint = locked
    ? ''
    : '<p class="sl-publish-hint">Rotating cuts off everyone using the current key ' +
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
      (locked
        ? 'Issuing a new key needs Pro.'
        : 'Rotate the key to issue a new one.') +
      '</p></div>' +
      (rotateButton ? `<div class="sl-publish-command-actions">${rotateButton}</div>` : '') +
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
  // Its own group, above the key it gates: on a free plan this is the answer to
  // "what happens if I press the button", and the footer's primary is an
  // Upgrade rather than a Publish because of it.
  const paywall = locked
    ? (
      '<section class="sl-publish-group">' +
      '<div class="sl-settings-section-heading"><h2>Pro plan required</h2>' +
      `<p>${PRO_ONLY}</p></div>` +
      '</section>'
    )
    : '';
  return (
    '<div class="sl-publish-body">' +
    '<section class="sl-publish-group">' +
    '<div class="sl-settings-section-heading"><h2>What gets published</h2>' +
    `<p>${WHAT_GETS_PUBLISHED}</p>` +
    (setup || locked ? '' : `<p>${BEFORE_FIRST_PUBLISH}</p>`) +
    '</div>' +
    '</section>' +
    paywall +
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
export function publishFooterMarkup(state: PublishState, locked: boolean): string {
  /*
   * Locked: no Publish at all, rather than a disabled one. A disabled primary
   * says "not right now" about work the plan will never do, and there is
   * nowhere to wait for. The two ways out are both real actions instead, in the
   * order the Library footer uses (secondary first, primary last): the key you
   * may already own, then the plan you do not. Both are the controls the
   * License screen and the header already offer, so this adds no new route.
   */
  if (locked) {
    return (
      '<div class="sl-footer-actions">' +
      '<button class="sl-button" data-tone="secondary" type="button" ' +
      `data-view="license">${icon('key', 15)}<span>Enter a license key</span></button>` +
      '<button class="sl-button sl-publish-submit" data-tone="primary" ' +
      'type="button" data-license-open="upgrade">' +
      `<span>Upgrade to Pro</span>${icon('externalLink', 15)}</button>` +
      '</div>'
    );
  }
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
  refs: ShellRefs, state: PublishState, locked: boolean,
): void {
  refs.screen.className = 'sl-screen sl-publish-screen';
  refs.pageHeader.innerHTML = publishHeaderMarkup();
  refs.pageHeader.hidden = false;
  refs.scroll.innerHTML = publishScrollMarkup(state, locked);
  refs.scroll.scrollTop = 0;
  refs.footer.innerHTML = publishFooterMarkup(state, locked);
  refs.footer.hidden = false;
}
