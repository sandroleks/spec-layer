import type { FoundationSpec } from '@spec-layer/extractor';
import { writeKey } from '../../descriptionWriter';
import type { LibraryEntry } from '../../messages';
import { foundationWritingGaps, sectionWritingGaps, type WritingGap } from '../../writingGaps';
import {
  WRITING_CAPTION_EFFECT, WRITING_CAPTION_TYPOGRAPHY, WRITING_TASK_DESCRIPTION, WRITING_TASK_SLOT,
  WRITING_UNKNOWN_OLDER, WRITING_UNKNOWN_RUNNING, WRITING_UNKNOWN_UNREAD, writtenCount,
} from '../writingCopy';
import { libraryDriftForEntry, type LibraryDriftState } from './library';

export interface WritingDraft { text: string; origin: 'person' | 'ai' }

/**
 * A save that is out (`saving`) or written and waiting on the source check
 * that closes it (`checking`). The text is what was sent, so the row keeps
 * showing it after the draft is dropped.
 */
export interface WritingSaving { state: 'saving' | 'checking'; text: string; origin: 'person' | 'ai' }

/** A task and the doc it belongs to. */
export interface TaskRef { gap: WritingGap; docId: string }

export interface BuildWritingModelOptions {
  drift?: ReadonlyMap<string, LibraryDriftState>;
  /** Component gaps from main's `writingGaps` replies, by doc id. A doc missing here has none known. */
  componentGaps?: ReadonlyMap<string, readonly WritingGap[]>;
  /**
   * Docs whose source was written and whose fresh `writingGaps` reply has not
   * landed. Their old gaps stay listed (the write is not yet confirmed), but
   * nothing about their fields is known, so no task of theirs closes.
   */
  gapsPending?: ReadonlySet<string>;
  /** The UI's current Foundation spec; null or absent lists no Foundation gaps. */
  foundation?: FoundationSpec | null;
  /** The Foundation dump has been asked for and has not arrived, so the spec is not current. */
  foundationLoading?: boolean;
  /** By task key: one field's draft serves every doc that lists it. */
  drafts?: ReadonlyMap<string, WritingDraft>;
  drafting?: ReadonlySet<string>;
  /** docTaskKey -> the gap as it was when it closed and the doc it closed in, in completion order. */
  done?: ReadonlyMap<string, TaskRef>;
  /** By docTaskKey: saves out or waiting on their check. */
  saving?: ReadonlyMap<string, WritingSaving>;
  /** By docTaskKey: why Figma refused the last save, in its words. */
  errors?: ReadonlyMap<string, string>;
  /** Doc ids whose Written this session list is open. */
  doneOpen?: ReadonlySet<string>;
}

export interface WritingTask {
  key: string;
  gap: WritingGap;
  title: string;
  caption: string | null;
  /** The full name, then each mode's full value: the row's title attribute. */
  tooltip: string;
  /** One per mode with a resolved colour, in mode order. */
  swatches: { hex: string; alpha: number }[];
  draft: WritingDraft | null;
  done: boolean;
  saving: WritingSaving | null;
  error: string | null;
}

/** A run of field tasks under one subheader: a token path, or a component. */
export interface WritingFieldGroup { heading: string | null; tasks: WritingTask[] }

export interface WritingGroup {
  docId: string;
  label: string;
  /** Every task, open in gap order then done in completion order, for lookups. */
  tasks: WritingTask[];
  /** Open description, slot, variable and style tasks, in runs by heading. */
  fields: WritingFieldGroup[];
  /** Open section tasks, written on the canvas. */
  sections: WritingTask[];
  /** Tasks closed this session, in completion order. */
  done: WritingTask[];
  countLabel: string;
  drafting: boolean;
  stale: boolean;
  /** Open field tasks with no draft and no save out: what Draft with AI covers. */
  draftable: number;
  /** Open field tasks with a draft and no save out: what Save all covers. */
  unsaved: number;
  doneOpen: boolean;
}

export interface WritingModel {
  groups: WritingGroup[];
  known: boolean;
  unknownReasons: string[];
  /** The file has no docs at all, which is not the same as nothing to write. */
  noDocs: boolean;
  /** Open field tasks across every group, a field two docs list counted under each. */
  openFields: number;
  openSections: number;
  /** Groups with an open task. */
  docsWithOpen: number;
  unsaved: number;
}

/** The key a draft or a write is filed under. A section has no field to write. */
export function writingTaskKey(gap: WritingGap): string {
  if (gap.kind === 'section') return `section:${gap.id}:${gap.sectionId ?? ''}`;
  return writeKey({ kind: gap.kind, id: gap.id, ...(gap.propertyName ? { propertyName: gap.propertyName } : {}) });
}

/**
 * A task as one doc lists it. Two docs can list the same gap (a collection doc
 * and a group doc over it, two docs for one component), and each closes and
 * expands on its own. A newline never occurs in a doc id, so the pair is unique.
 */
export function docTaskKey(docId: string, key: string): string {
  return `${docId}\n${key}`;
}

/** A row's open gaps: main's component gaps plus the link's section gaps, or
 *  the Foundation gaps within the row's scope. Never a guess: no reply, no gaps. */
export function rowWritingGaps(entry: LibraryEntry, options: BuildWritingModelOptions): WritingGap[] {
  if (entry.kind === 'foundation') {
    return options.foundation ? foundationWritingGaps(options.foundation, entry.foundationScope) : [];
  }
  return [
    ...(options.componentGaps?.get(entry.docId) ?? []),
    ...sectionWritingGaps(entry.docId, entry.unwrittenSections, entry.sections ?? []),
  ];
}

interface DocReadState {
  running: boolean;
  older: boolean;
  unread: boolean;
  /** Its description, slot, variable and style gaps are read and current. */
  fieldsKnown: boolean;
  /** Its link records which sections are still placeholders. */
  sectionsKnown: boolean;
}

/** One doc's writing state: what is still unknown about it, and what is known now. */
function docReadState(entry: LibraryEntry, options: BuildWritingModelOptions): DocReadState {
  if (entry.kind === 'foundation') {
    // A spec read again is not current until its reply lands, even with the last one still in hand.
    const loading = !!options.foundationLoading;
    const loaded = !!options.foundation && !loading;
    return { running: loading, older: false, unread: !options.foundation && !loading, fieldsKnown: loaded, sectionsKnown: loaded };
  }
  let running = false;
  let unread = false;
  const older = entry.unwrittenSections === undefined;
  if (entry.sourceExists) {
    const state = libraryDriftForEntry(entry, options.drift ?? new Map<string, LibraryDriftState>());
    if (state === 'pending' || options.gapsPending?.has(entry.docId)) running = true;
    else if (state === 'unavailable' || state === 'staleVersion') unread = true;
    // Settled, but main's gaps read never landed (it threw, or is still on its way).
    else if (!options.componentGaps?.has(entry.docId)) unread = true;
  }
  return { running, older, unread, fieldsKnown: entry.sourceExists && !running && !unread, sectionsKnown: !older };
}

/**
 * Whether an empty Writing list is a fact, and if not, why. A component
 * row is known once its source check settled and main's gaps reply landed, and
 * its link records the sections drawn as placeholders; a Foundation row once
 * the Foundation dump is loaded. A row whose source is gone has no field left
 * to read, so only its link counts.
 */
export function writingUnknownReasons(
  entries: readonly LibraryEntry[],
  options: BuildWritingModelOptions = {},
): string[] {
  let running = false;
  let older = false;
  let unread = false;
  for (const entry of entries) {
    const state = docReadState(entry, options);
    running ||= state.running;
    older ||= state.older;
    unread ||= state.unread;
  }
  return [
    ...(running ? [WRITING_UNKNOWN_RUNNING] : []),
    ...(older ? [WRITING_UNKNOWN_OLDER] : []),
    ...(unread ? [WRITING_UNKNOWN_UNREAD] : []),
  ];
}

/**
 * Whether a task's state is known right now, so its absence means it closed.
 * Decided per gap kind: a field task is known once its doc's check settled and
 * the gaps reply landed (a Foundation's once the spec is loaded), a section
 * task once the link records its sections. A doc built before the section list
 * still closes its description when the re-check no longer lists it.
 */
export function writingTaskKnown(
  entries: readonly LibraryEntry[], options: BuildWritingModelOptions = {},
): (ref: TaskRef) => boolean {
  const states = new Map(entries.map((entry) => [entry.docId, docReadState(entry, options)] as const));
  return (ref) => {
    const state = states.get(ref.docId);
    if (!state) return false;
    return ref.gap.kind === 'section' ? state.sectionsKnown : state.fieldsKnown;
  };
}

/** A token path or style name splits at its last slash; a name without one has no parent. */
function splitPath(name: string): { parent: string | null; leaf: string } {
  const at = name.lastIndexOf('/');
  return at <= 0 || at === name.length - 1 ? { parent: null, leaf: name } : { parent: name.slice(0, at), leaf: name.slice(at + 1) };
}

/** "Button / Content" is the component "Button" and the property "Content". */
function slotParts(name: string): { component: string; property: string } {
  const at = name.indexOf(' / ');
  return at < 0 ? { component: name, property: name } : { component: name.slice(0, at), property: name.slice(at + 3) };
}

/** The row's title: the last path segment, or the task, never the mechanism. */
export function taskTitle(gap: WritingGap): string {
  switch (gap.kind) {
    case 'component': return WRITING_TASK_DESCRIPTION;
    case 'slot': return WRITING_TASK_SLOT(slotParts(gap.name).property);
    case 'variable':
    case 'style': return splitPath(gap.name).leaf;
    default: return gap.name;
  }
}

/** The subheader a field task sits under: its parent path, or its component. */
export function taskHeading(gap: WritingGap): string | null {
  switch (gap.kind) {
    case 'component': return gap.name;
    case 'slot': return slotParts(gap.name).component;
    case 'variable':
    case 'style': return splitPath(gap.name).parent;
    default: return null;
  }
}

/** Each mode's short value, named when there are two or more modes. */
export function taskCaption(gap: WritingGap): string | null {
  if (gap.kind === 'variable') {
    if (gap.modes?.length) {
      const named = gap.modes.length > 1;
      return gap.modes.map((m) => (named ? `${m.mode} ${m.short}` : m.short)).join(' · ');
    }
    return gap.facts?.length ? gap.facts.join(' · ') : null;
  }
  if (gap.kind === 'style') return gap.facts?.[0] === 'typography' ? WRITING_CAPTION_TYPOGRAPHY : gap.facts?.[0] === 'effect' ? WRITING_CAPTION_EFFECT : null;
  return null;
}

function taskTooltip(gap: WritingGap): string {
  return [gap.name, ...(gap.kind === 'variable' ? gap.modes?.map((m) => m.full) ?? gap.facts ?? [] : [])].join('\n');
}

function task(gap: WritingGap, docId: string, done: boolean, options: BuildWritingModelOptions): WritingTask {
  const key = writingTaskKey(gap);
  const taskKey = docTaskKey(docId, key);
  return {
    key, gap, title: taskTitle(gap), caption: taskCaption(gap), tooltip: taskTooltip(gap),
    swatches: (gap.modes ?? []).flatMap((m) => (m.color ? [m.color] : [])),
    draft: done ? null : options.drafts?.get(key) ?? null,
    done,
    saving: done ? null : options.saving?.get(taskKey) ?? null,
    error: done ? null : options.errors?.get(taskKey) ?? null,
  };
}

/** Consecutive tasks under one heading, in the order given: nothing is re-sorted. */
function fieldRuns(tasks: readonly WritingTask[]): WritingFieldGroup[] {
  const runs: WritingFieldGroup[] = [];
  for (const t of tasks) {
    const heading = taskHeading(t.gap);
    const last = runs[runs.length - 1];
    if (last && last.heading === heading) last.tasks.push(t);
    else runs.push({ heading, tasks: [t] });
  }
  return runs;
}

export function buildWritingModel(entries: readonly LibraryEntry[], options: BuildWritingModelOptions = {}): WritingModel {
  const groups: WritingGroup[] = [];
  for (const entry of entries) {
    const open = rowWritingGaps(entry, options);
    const openKeys = new Set(open.map((gap) => docTaskKey(entry.docId, writingTaskKey(gap))));
    const done = [...(options.done ?? [])].filter(([key, ref]) => ref.docId === entry.docId && !openKeys.has(key));
    if (open.length === 0 && done.length === 0) continue;
    const openList = open.map((gap) => task(gap, entry.docId, false, options));
    const doneTasks = done.map(([, ref]) => task(ref.gap, entry.docId, true, options));
    const fields = openList.filter((t) => t.gap.kind !== 'section');
    const sections = openList.filter((t) => t.gap.kind === 'section');
    const tasks = [...openList, ...doneTasks];
    groups.push({
      docId: entry.docId, label: entry.label,
      tasks,
      fields: fieldRuns(fields),
      sections,
      done: doneTasks,
      countLabel: writtenCount(doneTasks.length, tasks.length),
      drafting: options.drafting?.has(entry.docId) ?? false,
      stale: entry.selfEdited && sections.length > 0,
      draftable: fields.filter((t) => !t.draft && !t.saving).length,
      unsaved: fields.filter((t) => t.draft && !t.saving).length,
      doneOpen: options.doneOpen?.has(entry.docId) ?? false,
    });
  }
  const unknownReasons = writingUnknownReasons(entries, options);
  const openFields = groups.reduce((n, g) => n + g.fields.reduce((m, run) => m + run.tasks.length, 0), 0);
  return {
    groups, known: unknownReasons.length === 0, unknownReasons, noDocs: entries.length === 0,
    openFields,
    openSections: groups.reduce((n, g) => n + g.sections.length, 0),
    docsWithOpen: groups.filter((g) => g.fields.length > 0 || g.sections.length > 0).length,
    unsaved: groups.reduce((n, g) => n + g.unsaved, 0),
  };
}

/** Every open task, by docTaskKey, with its doc. */
export function openTasks(model: WritingModel): Map<string, TaskRef> {
  const out = new Map<string, TaskRef>();
  for (const group of model.groups) {
    for (const t of group.tasks) if (!t.done) out.set(docTaskKey(group.docId, t.key), { gap: t.gap, docId: group.docId });
  }
  return out;
}

/** Tasks open in `previous` and absent from `current` whose state is known now: they closed.
 *  A task whose state is not known now (checking, unread, removed) closes nothing. */
export function closedTasks(
  previous: ReadonlyMap<string, TaskRef>, current: ReadonlyMap<string, TaskRef>, isKnown: (ref: TaskRef) => boolean,
): Map<string, TaskRef> {
  const out = new Map<string, TaskRef>();
  for (const [key, ref] of previous) {
    if (!current.has(key) && isKnown(ref)) out.set(key, ref);
  }
  return out;
}
