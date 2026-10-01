/**
 * The Publish screen, presentation only: `ui/publish.ts` owns the state, the
 * bundle and the proxy calls. The screen states where the library stands, hands
 * over the developer command and the agent prompt, and leaves the explanation
 * to the documentation the footer links to.
 */

import { icon } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';
import {
  agentSetupMessage, setupCommand, effectiveBump, currentVersionOf, nextVersionFor, isPublishBusy,
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
import { esc } from '../escape';

/**
 * The one sentence of explanation, shown only before the first publish in place
 * of the setup blocks. Names both audiences: developers and coding agents.
 */
const BEFORE_FIRST_PUBLISH =
  'Publish this file’s component and foundation docs so developers and ' +
  'coding agents can pull them. The setup commands appear here after the ' +
  'first publish.';

/**
 * Publish and download share one collect, so the primary goes busy during a
 * download too; `intent` says which round trip runs, so the label never claims
 * "Publishing…" for an action the user never took.
 */
function busyLabel(state: PublishState): string {
  if (state.intent === 'download') return 'Downloading…';
  if (state.intent === 'dryRun') return 'Checking…';
  return 'Publishing…';
}

/**
 * Back control, the title, and a status pill. The `<small>` eyebrow stays
 * unused: a clickable "Library" breadcrumb there would give the slot a second,
 * navigational meaning, which the button-icon contract in
 * design-system/components.css forbids.
 */
export function publishHeaderMarkup(state: PublishState): string {
  // Neutral until the file's identity has arrived: "Not published" for a
  // published file is the fabrication this guards against.
  const pill = !state.infoKnown
    ? '<span class="sl-badge">Checking…</span>'
    : state.libraryId
      ? '<span class="sl-badge" data-tone="success">Published</span>'
      : '<span class="sl-badge">Not published</span>';
  return (
    '<button class="sl-icon-button sl-publish-back" type="button" ' +
    `data-publish-back aria-label="Back to Library">${icon('chevronLeft')}</button>` +
    `<div class="sl-page-header-copy sl-publish-title"><h1>Publish</h1>${pill}</div>`
  );
}

/**
 * One muted line: when the library was last published and, on a free plan, the
 * publishes left, each only when known. "Not recorded" covers a library
 * published before the date was stored; never a guessed date. `locale` is for tests.
 */
function metaMarkup(state: PublishState, allowance: PublishAllowance, locale?: string): string {
  const parts: string[] = [];
  if (state.libraryId) {
    const when = state.lastPublishedAt ? formatPublishedAt(state.lastPublishedAt, locale) : null;
    // The Version block's source, so the two never name different versions.
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
 * What kind of changes drove the next version, counted from the change list so
 * the two never disagree. An empty list says the list is empty, not that
 * nothing changed: the server may have no list for a stored bundle.
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
 * The raise control. A choice below the dry run's minimum is disabled with a
 * tooltip, which needs each button in a positioned span; at a major minimum
 * there is nothing to choose, so no control is drawn.
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

/**
 * Check again and Version history. While busy, Check again is `aria-disabled`,
 * not `disabled`, so a focused reader never loses focus to `<body>`;
 * `onPublishRecheck` already ignores a click while busy.
 */
function versionActions(state: PublishState): string {
  const recheckDisabled = state.proposalStatus === 'loading' || isPublishBusy(state);
  return (
    '<span class="sl-publish-version-actions">' +
    '<button class="sl-button" data-tone="secondary" data-size="small" type="button" ' +
    `data-publish-recheck${recheckDisabled ? ' aria-disabled="true"' : ''}>Check again</button>` +
    '<button class="sl-button" data-tone="secondary" data-size="small" type="button" ' +
    'data-publish-history>Version history</button></span>'
  );
}

/**
 * A proposal is an answer as of when it was computed: canvas edits are
 * invisible until the next dry run, so the note never claims the file's present
 * state. Worded per `proposalSource`, since a publish's own proposal reflects
 * exactly what it sent.
 */
function checkedNote(state: PublishState): string {
  return state.proposalSource === 'publish'
    ? 'This reflects what you just published.'
    : 'Checked earlier in this session. If you’ve edited the canvas since, press Check again.';
}

const INVALID_FIRST_VERSION_HINT = 'Use three numbers, like 1.0.0.';

/**
 * The version block: the next version and why, the raise control, the note,
 * and the history. Every line states only what the proxy or the rules said,
 * never a guessed version.
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
  if (!state.infoKnown) {
    // Unknown whether this file has a library, so nothing can show without
    // guessing; the pill and footer already read "Checking…".
    return '';
  }
  if (!state.libraryId) {
    // Nothing published yet, so there is nothing to diff against: the version
    // is whatever the publisher types here, and it becomes 1.0.0 by default.
    const valid = isSemver(state.initialVersion);
    // The hint is always in the DOM and hidden when valid, so typing can
    // toggle it in place (patchInitialVersion) instead of repainting.
    body =
      note('The first publish creates this version.') +
      `<label class="sl-field"${valid ? '' : ' data-invalid="true"'}><span class="sl-field-label">First version</span>` +
      '<span class="sl-input-wrap"><input data-publish-initial-version inputmode="decimal" ' +
      `value="${esc(state.initialVersion)}" aria-invalid="${!valid}"></span></label>` +
      `<p class="sl-publish-status is-error" data-publish-initial-version-error${valid ? ' hidden' : ''}>${INVALID_FIRST_VERSION_HINT}</p>` +
      noteField;
    return `<section class="sl-publish-block sl-publish-version">${head()}${body}</section>`;
  }
  const current = currentVersionOf(state);
  const since = current ?? 'the last publish';
  if (state.proposalStatus === 'loading') {
    body = note(`Checking what changed since ${esc(since)}<span class="sl-work-dots" aria-hidden="true"><i></i><i></i><i></i></span>`);
  } else if (state.proposalStatus === 'failed') {
    // The publish still goes through, since the proxy applies the minimum bump
    // itself, so the reader is told that.
    body = note(PROPOSAL_FAILED_MESSAGE) + noteField;
  } else if (!state.proposal) {
    // Nothing has asked yet or the reply is out: neutral, not a failure claim.
    body = note('Press Check again to see what changed.') + noteField;
  } else if (state.proposal.unchanged) {
    body = note(`Nothing changed since ${esc(since)}. ${checkedNote(state)}`);
  } else if (current === null) {
    // A library published before versions existed: no baseline version to
    // bump, so the next publish creates the first one and there is no raise.
    body = note(`No version yet. The next publish creates ${esc(state.proposal.proposedVersion ?? '1.0.0')}. ${checkedNote(state)}`) + noteField;
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
      note(checkedNote(state)) +
      bumpControl(minimum, state.chosenBump) +
      noteField;
  }
  return `<section class="sl-publish-block sl-publish-version">${head(versionActions(state))}${body}</section>`;
}

/** A labelled block with the full text and one Copy; command and prompt are peers. */
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
 * The no-account route, shown in every state since a snapshot needs nothing
 * the publish service holds; disabled during a collect, which it shares. The
 * format line points to Settings rather than adding a second control here.
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
 * The meta line, the setup blocks once there is a key, and the rotate action:
 * all vary in height with state, so they live in the scroll body.
 */
export function publishScrollMarkup(
  state: PublishState, allowance: PublishAllowance, locale?: string,
  componentFormat: ComponentFormat = DEFAULT_COMPONENT_FORMAT,
): string {
  const busy = isPublishBusy(state);
  // Disabled during an upload, which rotating would race on the server. Its own
  // row as the one destructive control; `is-danger` colours only the label,
  // keeping the secondary tone's surface and border.
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
    // The id lives in the file; the key only on the device that last published
    // or rotated, since the server hands it out only then and every editor can
    // read the file. Rotating here needs the original license key (a Figma
    // identity must also present the pull key), and this is the one place the
    // rotate consequence is stated.
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
  } else if (state.infoKnown) {
    body = `<p class="sl-publish-intro">${BEFORE_FIRST_PUBLISH}</p>`;
  } else {
    body = ''; // the pill and footer already say the identity is being read
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
 * The docs link, then the one primary, plus a progress line while a publish
 * runs. The docs link is an anchor with target _blank, the plugin's way out of
 * the iframe (Settings > About does the same).
 *
 * The progress line lets the primary keep one static glyph (see the spinner
 * exception in the button-icon contract). Labels follow
 * docs/plugin-voice-and-copy.md: the busy label is a present participle plus an
 * ellipsis; progress labels carry none because `sl-work-dots` animates one.
 */
export function publishFooterMarkup(state: PublishState): string {
  const busy = isPublishBusy(state);
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
    // Errors stay on screen until the next action, floating just above the
    // button that failed; a toast would be gone before the reader looked up.
    : state.status === 'error' && state.message
      ? '<div class="sl-footer-progress">' +
        `<div class="sl-banner sl-footer-error" data-tone="danger" role="alert">${esc(state.message)}</div>` +
        '</div>'
      : '';
  // The primary names the version a publish would make; `nextVersionFor`
  // returns nothing with no library or nothing to publish.
  const next = busy ? null : nextVersionFor(state);
  // Before the identity arrives, "Publish library" would be a first-publish
  // claim, so the button reads "Checking…", disabled. Busy wins first: a
  // download needs no identity and can run while infoKnown is false.
  const label = busy
    ? busyLabel(state)
    : !state.infoKnown ? 'Checking…' : next ? `Publish ${esc(next)}` : 'Publish library';
  return (
    progress +
    '<div class="sl-footer-actions">' +
    `<a class="sl-button sl-publish-docs" data-tone="secondary" href="${PUBLISH_DOCS_URL}" ` +
    'target="_blank" rel="noopener">' +
    `<span>Read the guide</span>${icon('externalLink', 15)}</a>` +
    '<button class="sl-button sl-publish-submit" data-tone="primary" ' +
    `type="button" data-publish${(busy || !state.infoKnown) ? ' disabled' : ''}>` +
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

/**
 * Reflects the first-version field's validity without a repaint, which would
 * move the caret. Trims like onInitialVersionInput. False when the field is absent.
 */
export function patchInitialVersion(root: ParentNode, value: string): boolean {
  const input = root.querySelector<HTMLInputElement>('[data-publish-initial-version]');
  if (!input) return false;
  const valid = isSemver(value.trim());
  input.setAttribute('aria-invalid', String(!valid));
  const field = input.closest<HTMLElement>('.sl-field');
  if (field) {
    if (valid) field.removeAttribute('data-invalid');
    else field.setAttribute('data-invalid', 'true');
  }
  const hint = root.querySelector<HTMLElement>('[data-publish-initial-version-error]');
  if (hint) hint.hidden = valid;
  return true;
}
