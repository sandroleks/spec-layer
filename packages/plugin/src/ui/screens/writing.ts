/**
 * The To do screen (view id `writing`): one block per doc, every field
 * typeable in place, AI drafts reviewed inline and saved one row or all at
 * once. Presentation only; the host owns refreshes, checks, saves and drafts.
 */
import { DESCRIPTION_CHUNK } from '@spec-layer/extractor';
import { icon } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';
import { esc } from '../escape';
import { loadingRowsMarkup } from './progress';
import { checkLineState, cssString, emptyNavActionsMarkup, type CheckLinePresentation } from './library';
import { taskHeading, type WritingGroup, type WritingModel, type WritingTask } from '../viewModel/writing';
import {
  WRITING_AI_TAG,
  WRITING_CANVAS_HEADING,
  WRITING_CHECKING,
  WRITING_CONFIRM_CANCEL,
  WRITING_CONFIRM_YES,
  WRITING_DISCARD,
  WRITING_DISCARD_ALL,
  WRITING_EMPTY,
  WRITING_EMPTY_HEADING,
  WRITING_FIELD_HINTS,
  WRITING_DRAFT_ALL,
  WRITING_DRAFTING,
  WRITING_HEADING,
  WRITING_NO_DOCS,
  WRITING_NO_DOCS_HEADING,
  WRITING_OPEN,
  WRITING_REFRESH,
  WRITING_SAVE_ALL,
  WRITING_SAVING,
  WRITING_STALE,
  WRITING_UNKNOWN_HEADING,
  WRITING_WHY,
  WRITING_WHY_DISMISS,
  WRITING_WHY_HEADING,
  discardConfirmLabel,
  doneHeading,
  draftCostLabel,
  unsavedLabel,
  writingCheckingLabel,
  writingSummary,
} from '../writingCopy';

export interface WritingScreenPresentation extends WritingModel, CheckLinePresentation {
  loading?: boolean;
  /** A refresh, pass, update or annotate run is out: Refresh is disabled; fields stay usable. */
  busy?: boolean;
  /**
   * An Update, Copy or Annotate run is out, not a plain source check: every
   * button that writes or drafts is disabled; fields stay typeable.
   */
  locked?: boolean;
  /** Discard all is asking to be confirmed. */
  confirmDiscard?: boolean;
  /** The free tier, so the draft cost says "free" as the component screen does. */
  freeTier?: boolean;
  /** The explainer shows: first visit, or reopened from its info button. */
  why?: boolean;
  // Draft, Save and Discard draft are also disabled while a draft for that
  // group is out; per group via `drafting`.
}

type FieldKind = keyof typeof WRITING_FIELD_HINTS;

const off = (disabled: boolean): string => (disabled ? ' disabled' : '');

/** A swatch only for a colour read as a plain hex; anything else draws none. */
function swatchMarkup(color: { hex: string; alpha: number }): string {
  if (!/^#[0-9a-f]{6}$/i.test(color.hex)) return '';
  const alpha = Math.max(0, Math.min(1, color.alpha));
  const fill = alpha < 1 ? `${color.hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}` : color.hex;
  return `<span class="sl-writing-swatch" style="background-color: ${fill}" aria-hidden="true"></span>`;
}

/**
 * The end of the name line: a save out or waiting on its check, else the AI
 * mark while the field holds the model's text unedited, else nothing.
 */
function tagMarkup(t: WritingTask): string {
  if (t.saving) return `<span class="sl-writing-state" role="status">${t.saving.state === 'saving' ? WRITING_SAVING : WRITING_CHECKING}</span>`;
  if (t.draft?.origin !== 'ai') return '';
  return `<span class="sl-writing-ai-mark" title="${WRITING_AI_TAG}">${icon('sparkles', 13)}<span class="sl-sr-only">${WRITING_AI_TAG}</span></span>`;
}

/** Discard draft, once the row holds unsaved text. Enter or Save all saves it. */
function actionsMarkup(t: WritingTask, docId: string, disabled: boolean): string {
  if (!t.draft || t.saving) return '';
  return (
    `<button class="sl-icon-button sl-writing-discard" type="button" data-writing-clear="${esc(t.key)}" data-doc-id="${esc(docId)}" ` +
    `aria-label="${WRITING_DISCARD}" title="${WRITING_DISCARD}"${off(disabled)}>${icon('x', 14)}</button>`
  );
}

/** Figma's refusal of the last save, under the field. */
function statusMarkup(t: WritingTask): string {
  return t.error ? `<p class="sl-writing-error" role="alert">${esc(t.error)}</p>` : '';
}

/** What a screen reader hears for the field: the token, or the component and the task. */
function fieldLabel(t: WritingTask): string {
  if (t.gap.kind === 'variable' || t.gap.kind === 'style') return t.gap.name;
  const heading = taskHeading(t.gap);
  return heading ? `${heading}, ${t.title}` : t.title;
}

function fieldRowMarkup(t: WritingTask, docId: string, disabled: boolean): string {
  const text = t.saving?.text ?? t.draft?.text ?? '';
  const origin = t.saving ? '' : t.draft?.origin ?? '';
  const caption = t.caption ? `<span class="sl-writing-caption">${esc(t.caption)}</span>` : '';
  return (
    `<li class="sl-writing-task" data-writing-task="${esc(t.key)}" data-origin="${origin}" data-state="${t.saving?.state ?? ''}"${t.error ? ' data-error' : ''}>` +
    `<div class="sl-writing-row-head" title="${esc(t.tooltip)}">` +
    `<span class="sl-writing-swatches">${t.swatches.map(swatchMarkup).join('')}</span>` +
    `<span class="sl-writing-title">${esc(t.title)}</span>${caption}` +
    `<span class="sl-writing-tag-slot">${tagMarkup(t)}</span>` +
    '</div>' +
    '<div class="sl-writing-field-line">' +
    `<textarea class="sl-writing-field" rows="1" data-writing-key="${esc(t.key)}" data-doc-id="${esc(docId)}" ` +
    `placeholder="${esc(WRITING_FIELD_HINTS[t.gap.kind as FieldKind] ?? '')}" aria-label="${esc(fieldLabel(t))}"` +
    `${t.saving ? ' readonly' : ''}>${esc(text)}</textarea>` +
    `<span class="sl-writing-actions">${actionsMarkup(t, docId, disabled)}</span>` +
    '</div>' +
    `<div class="sl-writing-status-slot">${statusMarkup(t)}</div>` +
    '</li>'
  );
}

function sectionRowMarkup(t: WritingTask, docId: string, disabled: boolean): string {
  return (
    `<li class="sl-writing-task sl-writing-section-row" data-writing-task="${esc(t.key)}">` +
    `<span class="sl-writing-title">${esc(t.title)}</span>` +
    `<button class="sl-button" data-tone="quiet" data-size="small" type="button" data-writing-open="${esc(t.gap.sectionId ?? '')}" data-doc-id="${esc(docId)}"${off(disabled)}>` +
    `${WRITING_OPEN}</button>` +
    '</li>'
  );
}

function doneRowMarkup(t: WritingTask): string {
  const heading = t.gap.kind === 'component' || t.gap.kind === 'slot' ? taskHeading(t.gap) : null;
  const name = t.gap.kind === 'variable' || t.gap.kind === 'style' ? t.gap.name : heading ? `${heading}, ${t.title}` : t.title;
  return (
    `<li class="sl-writing-task is-done" data-writing-task="${esc(t.key)}">` +
    `<span class="sl-writing-check" aria-hidden="true">${icon('check', 14)}</span>` +
    `<span class="sl-writing-title">${esc(name)}</span></li>`
  );
}

/** Draft with AI, its field count and cost in the tooltip, before it is pressed. */
function draftMarkup(group: WritingGroup, model: WritingScreenPresentation): string {
  if (group.draftable === 0) return '';
  const disabled = group.drafting || model.locked === true;
  const cost = draftCostLabel(group.draftable, Math.ceil(group.draftable / DESCRIPTION_CHUNK), model.freeTier === true);
  return (
    `<button class="sl-button" data-tone="quiet" data-size="small" type="button" data-writing-draft-all data-doc-id="${esc(group.docId)}" ` +
    `title="${esc(cost)}"${off(disabled)}>` +
    `${icon('sparkles', 14)}<span>${group.drafting ? WRITING_DRAFTING : WRITING_DRAFT_ALL}</span></button>`
  );
}

function progressPercent(group: WritingGroup): number {
  return group.tasks.length === 0 ? 0 : Math.round((group.done.length / group.tasks.length) * 100);
}

function doneMarkup(group: WritingGroup): string {
  if (group.done.length === 0) return '';
  return (
    '<div class="sl-writing-done">' +
    `<button class="sl-writing-done-toggle" type="button" data-writing-done-toggle="${esc(group.docId)}" aria-expanded="${group.doneOpen}">` +
    `<span class="sl-writing-chevron${group.doneOpen ? ' is-expanded' : ''}" aria-hidden="true">${icon('chevronDown', 14)}</span>` +
    `<span>${doneHeading(group.done.length)}</span></button>` +
    `<ul class="sl-writing-tasks"${group.doneOpen ? '' : ' hidden'}>${group.done.map(doneRowMarkup).join('')}</ul>` +
    '</div>'
  );
}

export function writingGroupMarkup(group: WritingGroup, model: WritingScreenPresentation): string {
  const disabled = group.drafting || model.locked === true;
  const runs = group.fields.map((run) =>
    '<div class="sl-writing-run">' +
    (run.heading ? `<h3 class="sl-writing-subhead">${esc(run.heading)}</h3>` : '') +
    `<ul class="sl-writing-tasks">${run.tasks.map((t) => fieldRowMarkup(t, group.docId, disabled)).join('')}</ul>` +
    '</div>').join('');
  const canvas = group.sections.length === 0 ? '' : (
    '<div class="sl-writing-run" data-writing-canvas>' +
    `<h3 class="sl-writing-subhead">${WRITING_CANVAS_HEADING}</h3>` +
    (group.stale ? `<p class="sl-writing-note">${WRITING_STALE}</p>` : '') +
    `<ul class="sl-writing-tasks">${group.sections.map((t) => sectionRowMarkup(t, group.docId, model.locked === true)).join('')}</ul>` +
    '</div>'
  );
  return (
    `<section class="sl-writing-group" data-writing-group="${esc(group.docId)}">` +
    '<header class="sl-writing-group-head">' +
    '<div class="sl-writing-group-main">' +
    `<h2>${esc(group.label)}</h2>` +
    `<span class="sl-writing-count">${esc(group.countLabel)}</span>` +
    `<span class="sl-writing-progress" aria-hidden="true"><i style="width: ${progressPercent(group)}%"></i></span>` +
    '</div>' +
    `<div class="sl-writing-draft" data-writing-draft-slot>${draftMarkup(group, model)}</div>` +
    '</header>' +
    runs + canvas + doneMarkup(group) +
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
    return (
      `<div class="sl-empty-state" data-writing-no-docs><strong>${WRITING_NO_DOCS_HEADING}</strong>` +
      `<p>${WRITING_NO_DOCS}</p>${emptyNavActionsMarkup()}</div>`
    );
  }
  return `<div class="sl-empty-state"><strong>${WRITING_EMPTY_HEADING}</strong><p>${WRITING_EMPTY}</p></div>`;
}

/** What is left, then the check: its progress while it runs, else when it last ran. */
export function writingSublineText(model: WritingScreenPresentation): string {
  const check = checkLineState(model);
  const checkText = check.mode === 'progress'
    ? writingCheckingLabel(check.current, check.total)
    : check.mode === 'text' ? check.label : '';
  const summary = model.loading ? '' : writingSummary(model.openFields, model.openSections, model.docsWithOpen);
  return [summary, checkText].filter((part) => part !== '').join(' · ');
}

export function writingHeaderMarkup(model: WritingScreenPresentation): string {
  return (
    '<div class="sl-page-header-copy sl-writing-header">' +
    '<div class="sl-writing-title-row">' +
    `<h1>${WRITING_HEADING}</h1>` +
    `<button class="sl-icon-button sl-writing-why-button" type="button" data-writing-why aria-label="${WRITING_WHY_HEADING}" title="${WRITING_WHY_HEADING}" ` +
    `aria-controls="sl-writing-why" aria-expanded="${model.why === true}">${icon('infoCircle', 15)}</button>` +
    '</div>' +
    '<div class="sl-writing-subline">' +
    `<span class="sl-writing-subline-text" data-writing-subline>${esc(writingSublineText(model))}</span>` +
    `<button class="sl-icon-button sl-writing-refresh" type="button" data-library-refresh aria-label="${WRITING_REFRESH}" title="${WRITING_REFRESH}"${off(model.busy === true)}>` +
    `${icon('refresh', 15)}</button>` +
    '</div>' +
    '</div>'
  );
}

/** Why a description is written here and not in a doc, until dismissed. */
function whyMarkup(): string {
  return (
    '<section class="sl-writing-why" id="sl-writing-why" aria-labelledby="sl-writing-why-heading">' +
    `<h2 id="sl-writing-why-heading">${WRITING_WHY_HEADING}</h2>` +
    WRITING_WHY.map((line) => `<p>${line}</p>`).join('') +
    `<button class="sl-button" data-tone="secondary" data-size="small" type="button" data-writing-why-dismiss>${WRITING_WHY_DISMISS}</button>` +
    '</section>'
  );
}

export function writingScrollMarkup(model: WritingScreenPresentation): string {
  const body = model.loading
    ? loadingRowsMarkup(4)
    : (model.why ? whyMarkup() : '') + (model.groups.length
      ? model.groups.map((group) => writingGroupMarkup(group, model)).join('')
      : emptyMarkup(model));
  return `<div class="sl-writing-list" data-locked="${model.locked === true}" data-why="${model.why === true}">${body}</div>`;
}

/** Save all and Discard all while anything is unsaved; nothing otherwise. */
export function writingFooterMarkup(model: WritingScreenPresentation): string {
  const n = model.unsaved;
  if (n === 0) return '';
  const locked = model.locked === true;
  if (model.confirmDiscard) {
    return (
      '<div class="sl-footer-actions sl-writing-bar" data-writing-bar>' +
      `<span class="sl-writing-bar-label">${discardConfirmLabel(n)}</span>` +
      `<button class="sl-button" data-tone="quiet" type="button" data-writing-discard-cancel>${WRITING_CONFIRM_CANCEL}</button>` +
      `<button class="sl-button" data-tone="danger" type="button" data-writing-discard-yes${off(locked)}>${WRITING_CONFIRM_YES}</button>` +
      '</div>'
    );
  }
  return (
    '<div class="sl-footer-actions sl-writing-bar" data-writing-bar>' +
    `<span class="sl-writing-bar-label">${unsavedLabel(n)}</span>` +
    `<button class="sl-button" data-tone="quiet" type="button" data-writing-discard-all${off(locked)}>${WRITING_DISCARD_ALL}</button>` +
    `<button class="sl-button" data-tone="primary" type="button" data-writing-save-all${off(locked)}>${WRITING_SAVE_ALL}</button>` +
    '</div>'
  );
}

/** Size each field to its text, so a long description wraps instead of scrolling. */
export function growWritingFields(root: ParentNode): void {
  for (const field of root.querySelectorAll<HTMLTextAreaElement>('textarea.sl-writing-field')) growField(field);
}

export function growField(field: HTMLTextAreaElement): void {
  field.style.height = 'auto';
  // Zero while detached or hidden: leave the CSS height alone then.
  if (field.scrollHeight > 0) field.style.height = `${field.scrollHeight}px`;
}

/** The focused writing field and its selection, to put back after a redraw. */
interface FieldFocus { docId: string; key: string; start: number | null; end: number | null }

function focusedField(within: Element): FieldFocus | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLTextAreaElement) || !within.contains(active)) return null;
  const { writingKey: key, docId } = active.dataset;
  return key && docId ? { docId, key, start: active.selectionStart, end: active.selectionEnd } : null;
}

/**
 * Focus the same field again, within its own group (another doc may list the
 * same field), and its selection. False when the field is gone (its task
 * closed), so the caller can put focus somewhere near instead.
 */
function restoreField(refs: ShellRefs, focus: FieldFocus | null): boolean {
  if (!focus) return true;
  const next = refs.scroll.querySelector<HTMLTextAreaElement>(
    `[data-writing-group="${cssString(focus.docId)}"] [data-writing-key="${cssString(focus.key)}"]`,
  );
  if (!next) return false;
  next.focus({ preventScroll: true });
  if (focus.start !== null && focus.end !== null) next.setSelectionRange(focus.start, focus.end);
  return true;
}

const GROUP_CONTROLS = ['data-writing-clear', 'data-writing-open', 'data-writing-done-toggle', 'data-writing-draft-all'] as const;

/** The focused button inside a group, by the attribute it carries and its value, to put back after a redraw. */
function focusedControl(group: Element): { selector: string; key: string } | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLButtonElement) || !group.contains(active)) return null;
  const selector = GROUP_CONTROLS.find((name) => active.hasAttribute(name));
  return selector ? { selector, key: active.getAttribute(selector) ?? '' } : null;
}

/**
 * Focus the same button in the redrawn group; when it is gone (a saved row
 * lost its Save, a draft its Discard), that row's field, else the group's first
 * field, else the group itself, so keyboard focus never falls to the page.
 */
function restoreControl(group: HTMLElement, focus: { selector: string; key: string } | null): void {
  if (!focus) return;
  const within = (selector: string): HTMLElement | null => group.querySelector<HTMLElement>(selector);
  const same = focus.key === '' ? `[${focus.selector}]` : `[${focus.selector}="${cssString(focus.key)}"]`;
  const row = focus.selector === 'data-writing-clear'
    ? within(`[data-writing-key="${cssString(focus.key)}"]`)
    : null;
  const next = [within(same), row, within('[data-writing-key]')]
    .find((el): el is HTMLElement => el !== null && !(el instanceof HTMLButtonElement && el.disabled));
  if (next) {
    next.focus({ preventScroll: true });
    return;
  }
  group.tabIndex = -1;
  group.focus({ preventScroll: true });
}

const FOOTER_CONTROLS = ['data-writing-save-all', 'data-writing-discard-all', 'data-writing-discard-yes', 'data-writing-discard-cancel'] as const;

/**
 * Draw the footer bar, hidden when it has nothing to say. A focused bar
 * button keeps its focus when it is still drawn; when the bar is gone, focus
 * goes to the first field so it never falls to the page.
 */
export function paintWritingFooter(refs: ShellRefs, model: WritingScreenPresentation): void {
  const active = document.activeElement;
  const had = active instanceof HTMLElement && refs.footer.contains(active)
    ? FOOTER_CONTROLS.find((name) => active.hasAttribute(name)) ?? 'other'
    : null;
  const markup = writingFooterMarkup(model);
  if (refs.footer.innerHTML !== markup) refs.footer.innerHTML = markup;
  refs.footer.hidden = markup === '';
  if (had === null) return;
  const same = had === 'other' ? null : refs.footer.querySelector<HTMLButtonElement>(`[${had}]`);
  // A confirm that opened or closed moves focus to its own first choice.
  const next = same && !same.disabled
    ? same
    : refs.footer.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?? refs.scroll.querySelector<HTMLElement>('textarea.sl-writing-field');
  next?.focus({ preventScroll: true });
}

/** A full paint; a field being typed in keeps its focus and caret. */
export function renderWritingScreen(refs: ShellRefs, model: WritingScreenPresentation): void {
  const onScreen = refs.screen.classList.contains('sl-writing-screen');
  const scrollTop = onScreen ? refs.scroll.scrollTop : 0;
  const focus = onScreen ? focusedField(refs.scroll) : null;
  refs.screen.className = 'sl-screen sl-writing-screen';
  refs.pageHeader.innerHTML = writingHeaderMarkup(model);
  refs.pageHeader.hidden = false;
  refs.scroll.innerHTML = writingScrollMarkup(model);
  growWritingFields(refs.scroll);
  refs.scroll.scrollTop = scrollTop;
  paintWritingFooter(refs, model);
  restoreField(refs, focus);
}

/**
 * A field was typed in: redraw the tag, the actions and the status of each
 * drawn row filed under that key, the doc's draft button, and the footer,
 * leaving the field alone so the caret and any IME composition survive.
 */
export function patchWritingTask(refs: ShellRefs, model: WritingScreenPresentation, key: string): void {
  if (!refs.screen.classList.contains('sl-writing-screen')) return;
  for (const group of model.groups) {
    const t = group.tasks.find((candidate) => candidate.key === key);
    if (!t) continue;
    const groupEl = refs.scroll.querySelector<HTMLElement>(`[data-writing-group="${cssString(group.docId)}"]`);
    const item = groupEl?.querySelector<HTMLElement>(`[data-writing-task="${cssString(key)}"]`);
    if (!groupEl || !item) continue;
    const disabled = group.drafting || model.locked === true;
    item.dataset.origin = t.saving ? '' : t.draft?.origin ?? '';
    item.toggleAttribute('data-error', t.error !== null);
    const slot = (selector: string, markup: string): void => {
      const el = item.querySelector(selector);
      if (el && el.innerHTML !== markup) el.innerHTML = markup;
    };
    slot('.sl-writing-tag-slot', tagMarkup(t));
    slot('.sl-writing-actions', actionsMarkup(t, group.docId, disabled));
    slot('.sl-writing-status-slot', statusMarkup(t));
    // Draft lists open fields without a draft, so typing moves its count.
    const draft = groupEl.querySelector<HTMLElement>('[data-writing-draft-slot]');
    const focusInDraft = draft !== null && draft.contains(document.activeElement);
    if (draft && !focusInDraft) {
      const markup = draftMarkup(group, model);
      if (draft.innerHTML !== markup) draft.innerHTML = markup;
    }
  }
  paintWritingFooter(refs, model);
}

/**
 * One doc's reply landed: redraw its group in place, keeping focus and the
 * caret in a field, then the subline, Refresh and the footer. A doc with
 * nothing to write has no group, so only those move. False when the set of
 * groups changed, the list is empty (its empty state may change), a run's
 * lock moved (every group's buttons change), or the list is not on screen, so
 * the caller paints fully.
 */
export function patchWritingGroup(refs: ShellRefs, model: WritingScreenPresentation, docId: string): boolean {
  if (!refs.screen.classList.contains('sl-writing-screen') || model.loading || model.groups.length === 0) return false;
  const list = refs.scroll.querySelector<HTMLElement>('.sl-writing-list');
  if (!list || list.dataset.locked !== String(model.locked === true)) return false;
  if (list.dataset.why !== String(model.why === true)) return false;
  const drawn = [...refs.scroll.querySelectorAll<HTMLElement>('[data-writing-group]')].map((el) => el.dataset.writingGroup);
  const wanted = model.groups.map((g) => g.docId);
  if (drawn.length !== wanted.length || drawn.some((id, i) => id !== wanted[i])) return false;
  const group = model.groups.find((g) => g.docId === docId);
  if (group) {
    const element = refs.scroll.querySelector<HTMLElement>(`[data-writing-group="${cssString(docId)}"]`);
    if (!element) return false;
    const focus = focusedField(element);
    const control = focusedControl(element);
    element.outerHTML = writingGroupMarkup(group, model);
    const redrawn = refs.scroll.querySelector<HTMLElement>(`[data-writing-group="${cssString(docId)}"]`);
    if (redrawn) growWritingFields(redrawn);
    // A closed task takes its field with it: the group's first field, else the group, keeps focus.
    if (!restoreField(refs, focus) && redrawn) restoreControl(redrawn, { selector: 'data-writing-key', key: '' });
    if (redrawn) restoreControl(redrawn, control);
  }
  const subline = refs.pageHeader.querySelector('[data-writing-subline]');
  const text = writingSublineText(model);
  if (subline && subline.textContent !== text) subline.textContent = text;
  // Set in place, not redrawn, so a focused Refresh keeps its focus.
  const refresh = refs.pageHeader.querySelector<HTMLButtonElement>('[data-library-refresh]');
  if (refresh) refresh.disabled = model.busy === true;
  paintWritingFooter(refs, model);
  return true;
}
