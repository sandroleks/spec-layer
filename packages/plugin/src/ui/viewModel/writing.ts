import type { FoundationSpec } from '@spec-layer/extractor';
import { writeKey } from '../../descriptionWriter';
import type { LibraryEntry } from '../../messages';
import { foundationWritingGaps, sectionWritingGaps, type WritingGap } from '../../writingGaps';
import {
  WRITING_CAPTION_EFFECT, WRITING_CAPTION_TYPOGRAPHY, WRITING_TASK_DESCRIPTION, WRITING_TASK_SLOT,
  WRITING_UNKNOWN_OLDER, WRITING_UNKNOWN_RUNNING, WRITING_UNKNOWN_UNREAD, writingCount,
} from '../writingCopy';
import { libraryDriftForEntry, type LibraryDriftState } from './library';

export interface WritingDraft { text: string; origin: 'person' | 'ai' }

/** A task and the doc it belongs to. */
export interface TaskRef { gap: WritingGap; docId: string }

export interface BuildWritingModelOptions {
  drift?: ReadonlyMap<string, LibraryDriftState>;
  /** Component gaps from main's `writingGaps` replies, by doc id. A doc missing here has none known. */
  componentGaps?: ReadonlyMap<string, readonly WritingGap[]>;
  /** The UI's current Foundation spec; null or absent lists no Foundation gaps. */
  foundation?: FoundationSpec | null;
  /** The Foundation dump has been asked for and has not arrived, so the spec is not current. */
  foundationLoading?: boolean;
  /** By task key: one field's draft serves every doc that lists it. */
  drafts?: ReadonlyMap<string, WritingDraft>;
  drafting?: ReadonlySet<string>;
  /** docTaskKey -> the gap as it was when it closed and the doc it closed in, in completion order. */
  done?: ReadonlyMap<string, TaskRef>;
  /** The docTaskKey of the one expanded task. */
  expandedKey?: string | null;
}

export interface WritingTask {
  key: string;
  gap: WritingGap;
  title: string;
  caption: string | null;
  draft: WritingDraft | null;
  done: boolean;
  expanded: boolean;
}

export interface WritingGroup {
  docId: string;
  label: string;
  /** Open first in gap order, then done in completion order. */
  tasks: WritingTask[];
  countLabel: string;
  drafting: boolean;
  stale: boolean;
  /** At least one open non-section task without a draft. */
  canDraft: boolean;
}

export interface WritingModel {
  groups: WritingGroup[];
  known: boolean;
  unknownReasons: string[];
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
    if (options.foundation) return { running: false, older: false, unread: false, fieldsKnown: true, sectionsKnown: true };
    const loading = !!options.foundationLoading;
    return { running: loading, older: false, unread: !loading, fieldsKnown: false, sectionsKnown: false };
  }
  let running = false;
  let unread = false;
  const older = entry.unwrittenSections === undefined;
  if (entry.sourceExists) {
    const state = libraryDriftForEntry(entry, options.drift ?? new Map<string, LibraryDriftState>());
    if (state === 'pending') running = true;
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

export function taskTitle(gap: WritingGap): string {
  switch (gap.kind) {
    case 'component': return WRITING_TASK_DESCRIPTION;
    case 'slot': return WRITING_TASK_SLOT(gap.name.includes(' / ') ? gap.name.slice(gap.name.indexOf(' / ') + 3) : gap.name);
    default: return gap.name;
  }
}

export function taskCaption(gap: WritingGap): string | null {
  if (gap.kind === 'variable') return gap.facts?.length ? gap.facts.join(' · ') : null;
  if (gap.kind === 'style') return gap.facts?.[0] === 'typography' ? WRITING_CAPTION_TYPOGRAPHY : gap.facts?.[0] === 'effect' ? WRITING_CAPTION_EFFECT : null;
  return null;
}

function task(gap: WritingGap, docId: string, done: boolean, options: BuildWritingModelOptions): WritingTask {
  const key = writingTaskKey(gap);
  return {
    key, gap, title: taskTitle(gap), caption: taskCaption(gap),
    draft: done ? null : options.drafts?.get(key) ?? null,
    done,
    expanded: !done && options.expandedKey === docTaskKey(docId, key),
  };
}

export function buildWritingModel(entries: readonly LibraryEntry[], options: BuildWritingModelOptions = {}): WritingModel {
  const groups: WritingGroup[] = [];
  for (const entry of entries) {
    const open = rowWritingGaps(entry, options);
    const openKeys = new Set(open.map((gap) => docTaskKey(entry.docId, writingTaskKey(gap))));
    const done = [...(options.done ?? [])].filter(([key, ref]) => ref.docId === entry.docId && !openKeys.has(key));
    if (open.length === 0 && done.length === 0) continue;
    const tasks = [
      ...open.map((gap) => task(gap, entry.docId, false, options)),
      ...done.map(([, ref]) => task(ref.gap, entry.docId, true, options)),
    ];
    groups.push({
      docId: entry.docId, label: entry.label,
      tasks,
      countLabel: writingCount(done.length, tasks.length),
      drafting: options.drafting?.has(entry.docId) ?? false,
      stale: entry.selfEdited && open.some((g) => g.kind === 'section'),
      canDraft: open.some((g) => g.kind !== 'section' && !options.drafts?.has(writingTaskKey(g))),
    });
  }
  const unknownReasons = writingUnknownReasons(entries, options);
  return { groups, known: unknownReasons.length === 0, unknownReasons };
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
