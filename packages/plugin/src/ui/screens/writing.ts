/**
 * The Writing screen: one task group per doc, what is left to write and what
 * was written this session. Presentation only; the host owns refreshes,
 * checks, saves and drafts.
 */
import { icon } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';
import { esc } from '../escape';
import { loadingRowsMarkup } from './progress';
import { cssString, emptyNavActionsMarkup, libraryCheckLineMarkup, type CheckLinePresentation } from './library';
import type { WritingGroup, WritingModel, WritingTask } from '../viewModel/writing';
import {
  WRITING_AI_TAG,
  WRITING_CLEAR,
  WRITING_DRAFT_ALL,
  WRITING_DRAFTING,
  WRITING_EMPTY,
  WRITING_FIELD_HINT,
  WRITING_FOOT,
  WRITING_HEADING,
  WRITING_NO_DOCS,
  WRITING_OPEN,
  WRITING_REFRESH,
  WRITING_REFRESHING,
  WRITING_SAVE,
  WRITING_STALE,
  WRITING_UNKNOWN_HEADING,
} from '../writingCopy';

export interface WritingScreenPresentation extends WritingModel, CheckLinePresentation {
  loading?: boolean;
  /** A refresh, pass, update or annotate run is out: Refresh is disabled; fields stay usable. */
  busy?: boolean;
  /**
   * An Update, Copy or Annotate run is out, not a plain source check: Save,
   * Clear draft, Draft all and Open in doc are disabled; fields stay typeable.
   */
  locked?: boolean;
  // Draft all, Save and Clear are also disabled while a draft for that group
  // is out; per group via `drafting`.
}

function taskBodyMarkup(t: WritingTask, docId: string, disabled: boolean): string {
  const g = t.gap;
  const off = disabled ? ' disabled' : '';
  if (g.kind === 'section') {
    return (
      '<div class="sl-writing-task-body">' +
      `<button class="sl-button" data-tone="secondary" type="button" data-writing-open="${esc(g.sectionId ?? '')}" data-doc-id="${esc(docId)}"${off}>${WRITING_OPEN}</button>` +
      '</div>'
    );
  }
  return (
    '<div class="sl-writing-task-body">' +
    '<span class="sl-input-wrap sl-writing-input">' +
    `<input class="sl-writing-field" type="text" data-writing-key="${esc(t.key)}" data-doc-id="${esc(docId)}" ` +
    `placeholder="${esc(WRITING_FIELD_HINT)}" value="${esc(t.draft?.text ?? '')}" aria-label="${esc(t.title)}">` +
    '</span>' +
    `<span class="sl-writing-actions">${taskActionsMarkup(t, docId, disabled)}</span></div>`
  );
}

/** Save, and Clear draft once a draft exists. Patched in place as the field is typed in. */
function taskActionsMarkup(t: WritingTask, docId: string, disabled: boolean): string {
  const off = disabled ? ' disabled' : '';
  return (
    `<button class="sl-button" data-tone="secondary" type="button" data-writing-save="${esc(t.key)}" data-doc-id="${esc(docId)}"${off}>${WRITING_SAVE}</button>` +
    (t.draft ? `<button class="sl-button" data-tone="quiet" type="button" data-writing-clear="${esc(t.key)}" data-doc-id="${esc(docId)}"${off}>${WRITING_CLEAR}</button>` : '')
  );
}

/** The title, tagged AI while the draft is the model's. Patched in place as the field is typed in. */
function taskTitleMarkup(t: WritingTask): string {
  const tag = !t.done && t.draft?.origin === 'ai' ? `<span class="sl-writing-ai-tag">${WRITING_AI_TAG}</span>` : '';
  return `${esc(t.title)}${tag}`;
}

function taskMarkup(t: WritingTask, docId: string, disabled: boolean): string {
  const caption = t.caption ? `<span class="sl-writing-caption">${esc(t.caption)}</span>` : '';
  const head = t.done
    ? `<div class="sl-writing-task-head"><span class="sl-writing-dot" aria-hidden="true">${icon('fileCheck', 14)}</span><span class="sl-writing-title">${taskTitleMarkup(t)}</span>${caption}</div>`
    : (
      `<button class="sl-writing-task-head" type="button" data-writing-toggle="${esc(t.key)}" data-doc-id="${esc(docId)}" aria-expanded="${t.expanded}">` +
      '<span class="sl-writing-dot" aria-hidden="true"></span>' +
      `<span class="sl-writing-title">${taskTitleMarkup(t)}</span>${caption}` +
      `<span class="sl-writing-chevron${t.expanded ? ' is-expanded' : ''}">${icon('chevronDown', 14)}</span>` +
      '</button>'
    );
  return (
    `<li class="sl-writing-task${t.done ? ' is-done' : ''}${t.expanded ? ' is-expanded' : ''}" data-writing-task="${esc(t.key)}">` +
    head + (t.expanded ? taskBodyMarkup(t, docId, disabled) : '') +
    '</li>'
  );
}

export function writingGroupMarkup(group: WritingGroup, locked = false): string {
  const disabled = group.drafting || locked;
  const draft = group.canDraft
    ? `<button class="sl-button" data-tone="secondary" data-size="small" type="button" data-writing-draft-all data-doc-id="${esc(group.docId)}"${disabled ? ' disabled' : ''}>${group.drafting ? WRITING_DRAFTING : WRITING_DRAFT_ALL}</button>`
    : '';
  return (
    `<section class="sl-writing-group" data-writing-group="${esc(group.docId)}">` +
    `<div class="sl-writing-group-head"><h2>${esc(group.label)}</h2><span class="sl-writing-count">${esc(group.countLabel)}</span>${draft}</div>` +
    (group.stale ? `<p class="sl-writing-note">${WRITING_STALE}</p>` : '') +
    `<ul class="sl-writing-tasks">${group.tasks.map((t) => taskMarkup(t, group.docId, disabled)).join('')}</ul>` +
    (group.tasks.some((t) => t.expanded && t.gap.kind !== 'section') ? `<p class="sl-writing-foot">${WRITING_FOOT}</p>` : '') +
    '</section>'
  );
}

function emptyMarkup(model: WritingScreenPresentation): string {
  // Nothing to write is a completeness claim: only when every doc is known.
  if (!model.known) {
    return (
      `<div class="sl-empty-state" data-writing-unknown><strong>${WRITING_UNKNOWN_HEADING}</strong>` +
      model.unknownReasons.map((r) => `<p>${esc(r)}</p>`).join('') + '</div>'
    );
  }
  // A read that found no docs: nothing is filled because nothing is there.
  if (model.noDocs) {
    return `<div class="sl-empty-state" data-writing-no-docs><strong>${WRITING_NO_DOCS}</strong>${emptyNavActionsMarkup()}</div>`;
  }
  return `<div class="sl-empty-state"><strong>${WRITING_EMPTY}</strong></div>`;
}

export function writingHeaderMarkup(): string {
  return `<div class="sl-page-header-copy"><h1>${WRITING_HEADING}</h1></div>`;
}

export function writingScrollMarkup(model: WritingScreenPresentation): string {
  const body = model.loading
    ? loadingRowsMarkup(4)
    : model.groups.length
      ? model.groups.map((group) => writingGroupMarkup(group, model.locked === true)).join('')
      : emptyMarkup(model);
  return `${libraryCheckLineMarkup(model)}<div class="sl-writing-list" data-locked="${model.locked === true}">${body}</div>`;
}

export function writingFooterMarkup(model: WritingScreenPresentation): string {
  return (
    '<div class="sl-footer-actions">' +
    `<button class="sl-button" data-tone="secondary" type="button" data-library-refresh${model.busy ? ' disabled' : ''}>` +
    `${icon('refresh', 15)}<span>${model.refreshing ? WRITING_REFRESHING : WRITING_REFRESH}</span></button>` +
    '</div>'
  );
}

/** The focused writing field and its selection, to put back after a redraw. */
interface FieldFocus { docId: string; key: string; start: number | null; end: number | null }

function focusedField(within: Element): FieldFocus | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement) || !within.contains(active)) return null;
  const { writingKey: key, docId } = active.dataset;
  return key && docId ? { docId, key, start: active.selectionStart, end: active.selectionEnd } : null;
}

/** Focus the same field again, within its own group (another doc may list the same field), and its selection. */
function restoreField(refs: ShellRefs, focus: FieldFocus | null): void {
  if (!focus) return;
  const next = refs.scroll.querySelector<HTMLInputElement>(
    `[data-writing-group="${cssString(focus.docId)}"] [data-writing-key="${cssString(focus.key)}"]`,
  );
  if (!next) return;
  next.focus({ preventScroll: true });
  if (focus.start !== null && focus.end !== null) next.setSelectionRange(focus.start, focus.end);
}

/** A full paint; a field being typed in keeps its focus and caret. */
export function renderWritingScreen(refs: ShellRefs, model: WritingScreenPresentation): void {
  const onScreen = refs.screen.classList.contains('sl-writing-screen');
  const scrollTop = onScreen ? refs.scroll.scrollTop : 0;
  const focus = onScreen ? focusedField(refs.scroll) : null;
  refs.screen.className = 'sl-screen sl-writing-screen';
  refs.pageHeader.innerHTML = writingHeaderMarkup();
  refs.pageHeader.hidden = false;
  refs.scroll.innerHTML = writingScrollMarkup(model);
  refs.scroll.scrollTop = scrollTop;
  refs.footer.innerHTML = writingFooterMarkup(model);
  refs.footer.hidden = false;
  restoreField(refs, focus);
}

/**
 * A field was typed in: redraw the title and the actions of each drawn task
 * filed under that key, leaving the field alone. A draft becoming the
 * person's drops the AI tag; a draft appearing brings Clear draft.
 */
export function patchWritingTask(refs: ShellRefs, model: WritingScreenPresentation, key: string): void {
  if (!refs.screen.classList.contains('sl-writing-screen')) return;
  for (const group of model.groups) {
    const t = group.tasks.find((candidate) => candidate.key === key);
    if (!t) continue;
    const item = refs.scroll.querySelector<HTMLElement>(
      `[data-writing-group="${cssString(group.docId)}"] [data-writing-task="${cssString(key)}"]`,
    );
    if (!item) continue;
    const title = item.querySelector('.sl-writing-title');
    if (title) title.innerHTML = taskTitleMarkup(t);
    const actions = item.querySelector('.sl-writing-actions');
    if (actions) actions.innerHTML = taskActionsMarkup(t, group.docId, group.drafting || model.locked === true);
  }
}

/**
 * One doc's reply landed: redraw its group in place, keeping focus and the
 * caret in a field, then the check line and Refresh. A doc with nothing to
 * write has no group, so only those two move. False when the set of groups
 * changed, the list is empty (its empty state may change), a run's lock
 * moved (every group's buttons change), or the list is not on screen, so the
 * caller paints fully.
 */
export function patchWritingGroup(refs: ShellRefs, model: WritingScreenPresentation, docId: string): boolean {
  if (!refs.screen.classList.contains('sl-writing-screen') || model.loading || model.groups.length === 0) return false;
  const list = refs.scroll.querySelector<HTMLElement>('.sl-writing-list');
  if (!list || list.dataset.locked !== String(model.locked === true)) return false;
  const drawn = [...refs.scroll.querySelectorAll<HTMLElement>('[data-writing-group]')].map((el) => el.dataset.writingGroup);
  const wanted = model.groups.map((g) => g.docId);
  if (drawn.length !== wanted.length || drawn.some((id, i) => id !== wanted[i])) return false;
  const group = model.groups.find((g) => g.docId === docId);
  if (group) {
    const element = refs.scroll.querySelector<HTMLElement>(`[data-writing-group="${cssString(docId)}"]`);
    if (!element) return false;
    const focus = focusedField(element);
    element.outerHTML = writingGroupMarkup(group, model.locked === true);
    restoreField(refs, focus);
  }
  const line = refs.scroll.querySelector('[data-library-check-line]');
  if (line) line.outerHTML = libraryCheckLineMarkup(model);
  // Set in place, not redrawn, so a focused Refresh keeps its focus.
  const refresh = refs.footer.querySelector<HTMLButtonElement>('[data-library-refresh]');
  if (refresh) {
    refresh.disabled = model.busy === true;
    const label = refresh.querySelector('span');
    if (label) label.textContent = model.refreshing ? WRITING_REFRESHING : WRITING_REFRESH;
  }
  return true;
}
