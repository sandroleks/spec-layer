import type { FoundationSpec } from '@spec-layer/extractor';
import { writeKey } from '../../descriptionWriter';
import type { LibraryEntry } from '../../messages';
import { foundationWritingGaps, sectionWritingGaps, type WritingGap } from '../../writingGaps';
import {
  WRITING_CAPTION_EFFECT, WRITING_CAPTION_TYPOGRAPHY, WRITING_TASK_DESCRIPTION, WRITING_TASK_SLOT,
  WRITING_UNKNOWN_OLDER, WRITING_UNKNOWN_RUNNING, WRITING_UNKNOWN_UNREAD, writingCount,
} from '../writingCopy';
import {
  libraryDriftForEntry, resolveLibraryRowStatus,
  type LibraryDriftState, type LibraryRowStatus,
} from './library';

export interface WritingDraft { text: string; origin: 'person' | 'ai' }

export interface BuildWritingModelOptions {
  drift?: ReadonlyMap<string, LibraryDriftState>;
  /** Component gaps from main's `writingGaps` replies, by doc id. A doc missing here has none known. */
  componentGaps?: ReadonlyMap<string, readonly WritingGap[]>;
  /** The UI's current Foundation spec; null or absent lists no Foundation gaps. */
  foundation?: FoundationSpec | null;
  /** The Foundation dump has been asked for and has not arrived. */
  foundationLoading?: boolean;
  drafts?: ReadonlyMap<string, WritingDraft>;
  drafting?: ReadonlySet<string>;
  /** Task key -> the gap as it was when it closed, in completion order. */
  done?: ReadonlyMap<string, WritingGap>;
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
  kind: LibraryEntry['kind'];
  status: LibraryRowStatus;
  /** Open first in gap order, then done in completion order. */
  tasks: WritingTask[];
  openCount: number;
  doneCount: number;
  totalCount: number;
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
  openCount: number;
  doneCount: number;
}

/** The key a draft or a write is filed under. A section has no field to write. */
export function writingTaskKey(gap: WritingGap): string {
  if (gap.kind === 'section') return `section:${gap.id}:${gap.sectionId ?? ''}`;
  return writeKey({ kind: gap.kind, id: gap.id, ...(gap.propertyName ? { propertyName: gap.propertyName } : {}) });
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
  const drift = options.drift ?? new Map<string, LibraryDriftState>();
  for (const entry of entries) {
    if (entry.kind === 'foundation') {
      if (!options.foundation) {
        if (options.foundationLoading) running = true;
        else unread = true;
      }
      continue;
    }
    if (entry.unwrittenSections === undefined) older = true;
    if (!entry.sourceExists) continue;
    const state = libraryDriftForEntry(entry, drift);
    if (state === 'pending') running = true;
    else if (state === 'unavailable' || state === 'staleVersion') unread = true;
    // Settled, but main's gaps read never landed (it threw, or is still on its way).
    else if (!options.componentGaps?.has(entry.docId)) unread = true;
  }
  return [
    ...(running ? [WRITING_UNKNOWN_RUNNING] : []),
    ...(older ? [WRITING_UNKNOWN_OLDER] : []),
    ...(unread ? [WRITING_UNKNOWN_UNREAD] : []),
  ];
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

function task(gap: WritingGap, done: boolean, options: BuildWritingModelOptions): WritingTask {
  const key = writingTaskKey(gap);
  return {
    key, gap, title: taskTitle(gap), caption: taskCaption(gap),
    draft: done ? null : options.drafts?.get(key) ?? null,
    done,
    expanded: !done && options.expandedKey === key,
  };
}

/** A gap belongs to the doc whose source it names: a section gap carries the
 *  doc id itself; a component or slot gap carries the source node id; a
 *  variable or style gap is matched through the Foundation row it was listed under. */
function gapDocId(gap: WritingGap, entry: LibraryEntry): string {
  if (gap.kind === 'section') return gap.id;
  if (gap.kind === 'component' || gap.kind === 'slot') return entry.sourceNodeId === gap.id ? entry.docId : '';
  return entry.kind === 'foundation' ? entry.docId : '';
}

export function buildWritingModel(entries: readonly LibraryEntry[], options: BuildWritingModelOptions = {}): WritingModel {
  const groups: WritingGroup[] = [];
  let openCount = 0;
  let doneCount = 0;
  for (const entry of entries) {
    const open = rowWritingGaps(entry, options);
    const openKeys = new Set(open.map(writingTaskKey));
    const done = [...(options.done ?? [])].filter(([key, gap]) => !openKeys.has(key) && gapDocId(gap, entry) === entry.docId);
    if (open.length === 0 && done.length === 0) continue;
    const tasks = [...open.map((gap) => task(gap, false, options)), ...done.map(([, gap]) => task(gap, true, options))];
    const drift = libraryDriftForEntry(entry, options.drift ?? new Map());
    openCount += open.length;
    doneCount += done.length;
    groups.push({
      docId: entry.docId, label: entry.label, kind: entry.kind,
      status: resolveLibraryRowStatus(entry, drift),
      tasks,
      openCount: open.length, doneCount: done.length, totalCount: tasks.length,
      countLabel: writingCount(done.length, tasks.length),
      drafting: options.drafting?.has(entry.docId) ?? false,
      stale: entry.selfEdited && open.some((g) => g.kind === 'section'),
      canDraft: open.some((g) => g.kind !== 'section' && !options.drafts?.has(writingTaskKey(g))),
    });
  }
  const unknownReasons = writingUnknownReasons(entries, options);
  return { groups, known: unknownReasons.length === 0, unknownReasons, openCount, doneCount };
}

export function openTasks(model: WritingModel): Map<string, WritingGap> {
  const out = new Map<string, WritingGap>();
  for (const group of model.groups) for (const t of group.tasks) if (!t.done) out.set(t.key, t.gap);
  return out;
}

/** Keys open in `previous` and absent from `current` whose doc is still in `alive`: they closed. */
export function closedTasks(
  previous: ReadonlyMap<string, WritingGap>, current: ReadonlyMap<string, WritingGap>, alive: ReadonlySet<string>,
): Map<string, WritingGap> {
  const out = new Map<string, WritingGap>();
  for (const [key, gap] of previous) {
    if (current.has(key)) continue;
    const docId = key.startsWith('section:') ? key.split(':')[1] : null;
    if (docId !== null ? alive.has(docId) : alive.size > 0) out.set(key, gap);
  }
  return out;
}
