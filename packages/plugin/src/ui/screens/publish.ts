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
import {
  agentSetupMessage, setupCommand, effectiveBump, currentVersionOf, nextVersionFor,
  PROPOSAL_FAILED_MESSAGE, BELOW_MINIMUM_MESSAGE,
  type PublishState, type DryRunResult,
} from '../publish';
import { COMPONENT_FORMAT_NAME, DEFAULT_COMPONENT_FORMAT, type ComponentFormat } from '../../componentFormat';
import { PUBLISH_DOCS_URL } from '../proxy';
import {
  formatPublishedAt, publishAllowanceCopy, type PublishAllowance,
} from '../viewModel/allowance';
import { progressMarkup } from './progress';
import { isSemver, type Bump } from '@spec-layer/extractor';

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
  'Publish this file’s component and foundation docs so developers and ' +
  'coding agents can pull them. The setup commands appear here after the ' +
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
  if (state.intent === 'download') return 'Downloading…';
  if (state.intent === 'dryRun') return 'Checking…';
  return 'Publishing…';
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
 * on a free plan how many free publishes are left. Each part appears only when it
 * has a true value. "Not recorded" covers a library published by a build
 * before the date was stored; the next publish records one. Never a guessed
 * date. `locale` is for deterministic tests; the plugin passes none.
 */
function metaMarkup(state: PublishState, allowance: PublishAllowance, locale?: string): string {
  const parts: string[] = [];
  if (state.libraryId) {
    const when = state.lastPublishedAt ? formatPublishedAt(state.lastPublishedAt, locale) : null;
    // The same source the Version block reads, so the two never name
    // different versions.
    const version = currentVersionOf(state);
    if (version) {
      parts.push(
        when
          ? `Version ${esc(version)}, published ${esc(when)}`
          : `Version ${esc(version)}, publish date not recorded`,
      );
    } else {
      parts.push(when ? `Last published ${esc(when)}` : 'Last published date not recorded');
    }
  }
  // The allowance sentence is the view model's, shared with the publish error
  // copy, so the meter and the 402 line can never disagree on the numbers.
  const allowanceLine = publishAllowanceCopy(allowance);
  if (allowanceLine) parts.push(esc(allowanceLine));
  if (parts.length === 0) return '';
  return `<p class="sl-publish-meta">${parts.map((p) => `<span>${p}</span>`).join('')}</p>`;
}

const BUMPS: Bump[] = ['patch', 'minor', 'major'];
const RANK: Record<Bump, number> = { patch: 0, minor: 1, major: 2 };

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * One line under the next version: what kind of changes drove it. Counts come
 * from the change list, so the line and the list can never disagree. An empty
 * list does not mean nothing changed (the content did, or there would be no
 * next version; the server may just have no list, as for a stored bundle it
 * cannot read), so it says the list is empty rather than the changes.
 */
export function proposalReason(proposal: DryRunResult): string {
  let added = 0; let removed = 0; let renamed = 0; let changed = 0;
  for (const change of proposal.changes) {
    if (change.kind === 'added') added += 1;
    else if (change.kind === 'removed') removed += 1;
    else if (change.kind === 'renamed') renamed += 1;
    else changed += 1;
  }
  const parts: string[] = [];
  if (added > 0) parts.push(plural(added, 'addition', 'additions'));
  if (removed > 0) parts.push(plural(removed, 'removal', 'removals'));
  if (renamed > 0) parts.push(plural(renamed, 'rename', 'renames'));
  if (changed > 0) parts.push(plural(changed, 'value change', 'value changes'));
  return parts.length > 0 ? parts.join(', ') : 'no listed changes';
}

const BUMP_WORD: Record<Bump, string> = { patch: 'Patch', minor: 'Minor', major: 'Major' };

/**
 * The raise control: Patch, Minor, Major, plain words only. A choice below
 * the dry run's minimum is disabled and explains itself in a tooltip rather
 * than in small print inside the button. When the minimum is already major
 * there is nothing to choose, so no control is drawn; the line above it
 * already says why. Each button sits in a span (the segmented control styles
 * `> span > button` too) because the tooltip needs a positioned wrapper.
 */
function bumpControl(minimum: Bump, chosen: Bump | null): string {
  if (minimum === 'major') return '';
  const buttons = BUMPS.map((bump) => {
    const below = RANK[bump] < RANK[minimum];
    const checked = (chosen ?? minimum) === bump;
    const button =
      `<button type="button" role="radio" data-publish-bump="${bump}" aria-checked="${checked}"` +
      `${below ? ' disabled' : ''}>${BUMP_WORD[bump]}</button>`;
    return below
      ? `<span data-tooltip-trigger>${button}<span class="sl-tooltip" role="tooltip">${esc(BELOW_MINIMUM_MESSAGE(minimum))}</span></span>`
      : `<span>${button}</span>`;
  }).join('');
  return `<div class="sl-segmented sl-publish-bumps" role="radiogroup" aria-label="Version change">${buttons}</div>`;
}

function historyLink(): string {
  return (
    '<button class="sl-button" data-tone="secondary" data-size="small" type="button" ' +
    'data-publish-history>Version history</button>'
  );
}

/**
 * The version block: the next version and one line of why, the raise
 * control, the note, and the way to the history. The meta line under the
 * header already names the current version, so the block never repeats it.
 * Every line states only what the proxy or the rules said, never a guessed
 * version.
 */
function versionBlock(state: PublishState): string {
  const head = (extra = '') =>
    `<div class="sl-publish-block-head"><h2>Version</h2>${extra}</div>`;
  const note = (text: string) => `<p class="sl-publish-note">${text}</p>`;
  const noteField = (
    '<label class="sl-field"><span class="sl-field-label">Note</span>' +
    '<textarea class="sl-publish-note-field" data-publish-note maxlength="500" rows="2" ' +
    `placeholder="Optional. Appears in version history.">${esc(state.note)}</textarea></label>`
  );
  let body: string;
  if (!state.libraryId) {
    // Nothing published yet, so there is nothing to diff against: the version
    // is whatever the publisher types here, and it becomes 1.0.0 by default.
    const valid = isSemver(state.initialVersion);
    body =
      note('The first publish creates this version.') +
      `<label class="sl-field"${valid ? '' : ' data-invalid="true"'}><span class="sl-field-label">First version</span>` +
      '<span class="sl-input-wrap"><input data-publish-initial-version inputmode="decimal" ' +
      `value="${esc(state.initialVersion)}" aria-invalid="${!valid}"></span></label>` +
      (valid ? '' : '<p class="sl-publish-status is-error">Use three numbers, like 1.0.0.</p>') +
      noteField;
    return `<section class="sl-publish-block sl-publish-version">${head()}${body}</section>`;
  }
  const current = currentVersionOf(state);
  const since = current ?? 'the last publish';
  if (state.proposalStatus === 'loading') {
    body = note(`Checking what changed since ${esc(since)}<span class="sl-work-dots" aria-hidden="true"><i></i><i></i><i></i></span>`);
  } else if (state.proposalStatus === 'failed') {
    // A dry run that could not be computed still lets the publish go through:
    // the proxy applies the minimum bump on its own, so the reader is told
    // that rather than left staring at a blank block.
    body = note(PROPOSAL_FAILED_MESSAGE) + noteField;
  } else if (!state.proposal) {
    // No failure and no answer yet: either nothing has asked (a fresh publish
    // just landed) or the reply has not arrived. Neutral, not a failure claim.
    body = note('Open Publish again to check what changed.') + noteField;
  } else if (state.proposal.unchanged) {
    body = note(`Nothing changed since ${esc(since)}.`);
  } else if (current === null) {
    // A library published before versions existed: no baseline version to
    // bump, so the next publish creates the first one and there is no raise.
    body = note(`No version yet. The next publish creates ${esc(state.proposal.proposedVersion ?? '1.0.0')}.`) + noteField;
  } else {
    const minimum: Bump = state.proposal.minimumBump ?? 'patch';
    const applied = effectiveBump(state) ?? minimum;
    const next = nextVersionFor(state) ?? state.proposal.proposedVersion ?? '';
    const reason = proposalReason(state.proposal);
    const why = applied === minimum
      ? `${BUMP_WORD[applied]}: ${reason}`
      : `${BUMP_WORD[applied]}, raised from ${minimum}: ${reason}`;
    body =
      `<p class="sl-publish-version-next"><strong>Next version ${esc(next)}</strong><span>${esc(why)}</span></p>` +
      bumpControl(minimum, state.chosenBump) +
      noteField;
  }
  return `<section class="sl-publish-block sl-publish-version">${head(historyLink())}${body}</section>`;
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
 *
 * The format line says how the zip writes components and where that is set.
 * The setting lives in Settings, not here: a second control on this screen
 * would read as a separate choice. It shows in both formats, so someone who
 * only ever downloads still learns the choice exists.
 */
function downloadBlock(busy: boolean, format: ComponentFormat): string {
  return (
    '<section class="sl-publish-block sl-publish-download">' +
    '<div class="sl-publish-block-head"><h2>Download a snapshot</h2></div>' +
    '<p class="sl-publish-note">A zip of everything this file documents: component briefs, ' +
    'design tokens, and a SKILL.md a coding agent reads. No account needed. It does not ' +
    'update, so download it again after the design system changes.</p>' +
    `<p class="sl-publish-note sl-publish-format">Components export as ${COMPONENT_FORMAT_NAME[format]}. ` +
    '<button class="sl-text-button" type="button" data-open-settings="export">' +
    'Change this in Settings</button></p>' +
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
  componentFormat: ComponentFormat = DEFAULT_COMPONENT_FORMAT,
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
    `data-publish-rotate${busy ? ' disabled' : ''}>Rotate pull key</button>` +
    '</div>';
  let body: string;
  if (state.libraryId && state.pullKey) {
    body =
      copyBlock('command', 'Developer setup', setupCommand(state.libraryId, state.pullKey, componentFormat)) +
      copyBlock('agent', 'AI agent setup', agentSetupMessage(state.libraryId, state.pullKey, componentFormat)) +
      rotateRow;
  } else if (state.libraryId) {
    // The id lives in the file; the key lives on the device that published or
    // rotated last, because the server hands it out only then and the file is
    // readable by every editor. Both halves are needed for a command a
    // developer can actually run, so with only the id the screen says where
    // the key is and names both ways out: ask, or rotate. Rotating from here
    // works only with the license key the library was published with, since
    // a Figma identity alone must also present the current pull key, so the
    // sentence says so. This is the one place the rotate consequence is
    // stated, since rotating from here cuts off developers the reader may not
    // know about.
    body =
      '<section class="sl-publish-block">' +
      '<div class="sl-publish-block-head"><h2>Developer setup</h2></div>' +
      `<p class="sl-publish-note">This file is published as <code>${esc(state.libraryId)}</code>. ` +
      'Its pull key is on the device that first published it or last rotated the key, ' +
      'so ask that person for the setup command. If this device has the license key it was ' +
      'published with, you can rotate the pull key here instead. ' +
      'Rotating stops the current key working for everyone within about a minute.</p>' +
      '</section>' +
      rotateRow;
  } else {
    body = `<p class="sl-publish-intro">${BEFORE_FIRST_PUBLISH}</p>`;
  }
  // Room to scroll the last control out from under the floating error.
  const hasError = state.status === 'error' && Boolean(state.message);
  return (
    `<div class="sl-publish-body${hasError ? ' has-error' : ''}">` +
    metaMarkup(state, allowance, locale) +
    versionBlock(state) +
    body +
    downloadBlock(busy, componentFormat) +
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
        label: state.intent === 'dryRun'
          ? 'Checking what changed'
          : state.status === 'collecting' ? 'Collecting sources' : 'Uploading library',
      }) +
      '</div>'
    )
    // Errors stay on screen until the next action; a toast would be gone
    // before the reader looked up from the button. They float in the same
    // slot as progress, just above the button that failed: at the end of the
    // body they sat below the fold on any library with setup blocks.
    : state.status === 'error' && state.message
      ? '<div class="sl-footer-progress">' +
        `<div class="sl-banner sl-publish-error" data-tone="danger" role="alert">${esc(state.message)}</div>` +
        '</div>'
      : '';
  // The primary names the version a publish would make, so the reader never
  // has to hold the raise control's choice in their head to know what
  // clicking it does. Silent when there is nothing to propose yet (no
  // library) or nothing to publish (the dry run reported unchanged):
  // `nextVersionFor` already carries that guard.
  const next = busy ? null : nextVersionFor(state);
  const label = busy ? busyLabel(state) : next ? `Publish ${esc(next)}` : 'Publish library';
  return (
    progress +
    '<div class="sl-footer-actions">' +
    `<a class="sl-button sl-publish-docs" data-tone="secondary" href="${PUBLISH_DOCS_URL}" ` +
    'target="_blank" rel="noopener">' +
    `<span>Read the guide</span>${icon('externalLink', 15)}</a>` +
    '<button class="sl-button sl-publish-submit" data-tone="primary" ' +
    `type="button" data-publish${busy ? ' disabled' : ''}>` +
    `${icon('upload', 15)}<span>${label}</span></button>` +
    '</div>'
  );
}

export function renderPublishScreen(
  refs: ShellRefs, state: PublishState, allowance: PublishAllowance, componentFormat: ComponentFormat,
): void {
  // A repaint of the screen already on show (a bump choice, a note) keeps
  // the reader's place; arriving from another screen starts at the top.
  const samePane = refs.screen.classList.contains('sl-publish-screen')
    && !refs.screen.classList.contains('sl-history-screen');
  const top = refs.scroll.scrollTop;
  refs.screen.className = 'sl-screen sl-publish-screen';
  refs.pageHeader.innerHTML = publishHeaderMarkup(state);
  refs.pageHeader.hidden = false;
  refs.scroll.innerHTML = publishScrollMarkup(state, allowance, undefined, componentFormat);
  refs.scroll.scrollTop = samePane ? top : 0;
  refs.footer.innerHTML = publishFooterMarkup(state);
  refs.footer.hidden = false;
}
