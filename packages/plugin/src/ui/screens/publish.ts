/**
 * publish.ts — the "Publish for developers" screen.
 *
 * Presentation only, the same split screens/library.ts has against
 * viewModel/library.ts: `ui/publish.ts` (same basename, one directory up) owns
 * publish state, the bundle, and the proxy calls. This module turns a
 * PublishState into markup and knows nothing else.
 *
 * This used to be a section appended after the Library's document list, which
 * put the one action that sends a library off the machine below everything
 * else, in a viewport that filters and reflows under it, with no report of its
 * own work in flight. It is a Library sub-screen now: the rail keeps Library
 * selected and the header carries the way back.
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

const PUBLISH_DESCRIPTION =
  "Publishes this library's AI context so developers can pull it with the spec-layer CLI. " +
  'Publishing replaces the previously published version. Anyone with the key can pull it.';

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
export function publishScrollMarkup(state: PublishState): string {
  // Both halves are needed for a command a developer can actually run. Half a
  // command is a command that fails, so it is withheld rather than guessed.
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
    '<div class="sl-publish-body">' +
    `<p class="sl-publish-lede">${PUBLISH_DESCRIPTION}</p>` +
    keySection +
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

export function renderPublishScreen(refs: ShellRefs, state: PublishState): void {
  refs.screen.className = 'sl-screen sl-publish-screen';
  refs.pageHeader.innerHTML = publishHeaderMarkup();
  refs.pageHeader.hidden = false;
  refs.scroll.innerHTML = publishScrollMarkup(state);
  refs.scroll.scrollTop = 0;
  refs.footer.innerHTML = publishFooterMarkup(state);
  refs.footer.hidden = false;
}
