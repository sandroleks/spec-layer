/**
 * foundationState.ts — the pure selection model behind the Foundations tab.
 *
 * screens/foundations.ts owns markup and painting; everything decidable without
 * a DOM lives here so it can be tested. Mode selections are always stored in
 * collection order rather than click order, so a rebuilt doc's columns do not
 * silently reorder between generations.
 */
import {
  MAX_MODE_COLUMNS, planFoundationUnits, folderOf, groupTitles,
  collectionAliasCounts, collectionModeNames,
  type FoundationSpec, type FoundationSelection, type FoundationMode,
  type FoundationGroupBrief, type FoundationCollectionBrief, type FoundationValue,
  type GroupDraftInput,
} from '@spec-layer/extractor';
import { collectionIconKind, type FoundationIconKind } from '../foundationIcon';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Joins prose parts the way a sentence does: "a", "a and b", "a, b and c". */
function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return parts.join(' and ');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Which row icon a collection gets. Derived in foundationIcon.ts because My
 * Library's foundation rows must answer this the same way from a stored scope
 * on the main thread; re-deriving it here is how the two lists would drift.
 */
export { collectionIconKind };
export type { FoundationIconKind };

export interface FoundationSummaryCollection {
  id: string;
  name: string;
  variableCount: number;
  modes: FoundationMode[];
  iconKind: FoundationIconKind;
}

export interface FoundationSummary {
  collectionCount: number;
  maxModeCount: number;
  variableCount: number;
  textStyleCount: number;
  effectStyleCount: number;
  collections: FoundationSummaryCollection[];
}

export function summarize(spec: FoundationSpec): FoundationSummary {
  return {
    collectionCount: spec.collections.length,
    maxModeCount: spec.collections.reduce((n, c) => Math.max(n, c.modes.length), 0),
    variableCount: spec.collections.reduce((n, c) => n + c.variables.length, 0),
    textStyleCount: spec.textStyles.length,
    effectStyleCount: spec.effectStyles.length,
    collections: spec.collections.map((c) => ({
      id: c.id,
      name: c.name,
      variableCount: c.variables.length,
      modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
      iconKind: collectionIconKind(c),
    })),
  };
}

export function defaultSelection(spec: FoundationSpec): FoundationSelection {
  return {
    collections: spec.collections.map((c) => ({
      collectionId: c.id,
      modeIds: c.modes.slice(0, MAX_MODE_COLUMNS).map((m) => m.modeId),
    })),
    textStyles: spec.textStyles.length > 0,
    effectStyles: spec.effectStyles.length > 0,
  };
}

/** Reorder a set of mode ids into the collection's own order. */
function inCollectionOrder(spec: FoundationSpec, collectionId: string, ids: string[]): string[] {
  const collection = spec.collections.find((c) => c.id === collectionId);
  if (!collection) return [];
  return collection.modes.map((m) => m.modeId).filter((id) => ids.includes(id));
}

/**
 * Add or replace a collection's entry in the selection, keeping the result
 * ordered by the spec's collection order rather than click/insertion order.
 * Shared by toggleCollection and toggleMode so both stay in sync.
 */
function withCollectionEntry(
  spec: FoundationSpec,
  collections: FoundationSelection['collections'],
  entry: FoundationSelection['collections'][number],
): FoundationSelection['collections'] {
  const rest = collections.filter((c) => c.collectionId !== entry.collectionId);
  return [...rest, entry].sort(
    (a, b) => spec.collections.findIndex((c) => c.id === a.collectionId)
            - spec.collections.findIndex((c) => c.id === b.collectionId),
  );
}

export function toggleCollection(
  sel: FoundationSelection, spec: FoundationSpec, collectionId: string, on: boolean,
): FoundationSelection {
  const collections = sel.collections.filter((c) => c.collectionId !== collectionId);
  if (!on) return { ...sel, collections };
  const collection = spec.collections.find((c) => c.id === collectionId);
  if (!collection) return { ...sel, collections };
  const entry = {
    collectionId,
    modeIds: collection.modes.slice(0, MAX_MODE_COLUMNS).map((m) => m.modeId),
  };
  return { ...sel, collections: withCollectionEntry(spec, sel.collections, entry) };
}

export function toggleMode(
  sel: FoundationSelection, spec: FoundationSpec,
  collectionId: string, modeId: string, on: boolean,
): FoundationSelection {
  const existing = sel.collections.find((c) => c.collectionId === collectionId);
  const current = existing ? existing.modeIds : [];

  let nextIds: string[];
  if (on) {
    if (current.includes(modeId)) return sel;
    // At the cap, ignore the check rather than silently evicting a column the
    // user chose. The UI explains this with the cap note.
    if (current.length >= MAX_MODE_COLUMNS) return sel;
    nextIds = inCollectionOrder(spec, collectionId, [...current, modeId]);
  } else {
    nextIds = current.filter((id) => id !== modeId);
  }

  if (nextIds.length === 0) {
    return { ...sel, collections: sel.collections.filter((c) => c.collectionId !== collectionId) };
  }
  if (!existing) {
    // Honor the specific mode the user picked rather than re-deriving the
    // default (first MAX_MODE_COLUMNS) modes for the collection.
    return {
      ...sel,
      collections: withCollectionEntry(spec, sel.collections, { collectionId, modeIds: nextIds }),
    };
  }
  return {
    ...sel,
    collections: sel.collections.map((c) =>
      c.collectionId === collectionId ? { ...c, modeIds: nextIds } : c),
  };
}

export function toggleTextStyles(sel: FoundationSelection, on: boolean): FoundationSelection {
  return { ...sel, textStyles: on };
}

export function toggleEffectStyles(sel: FoundationSelection, on: boolean): FoundationSelection {
  return { ...sel, effectStyles: on };
}

export function canGenerate(sel: FoundationSelection): boolean {
  return sel.collections.length > 0 || sel.textStyles || sel.effectStyles;
}

/**
 * Zero or one line explaining what the file does not have. Each case names the
 * reason rather than leaving an unexplained gap in the docs.
 */
export function emptyStateLines(spec: FoundationSpec): string[] {
  const hasCollections = spec.collections.length > 0;
  const hasTextStyles = spec.textStyles.length > 0;
  const hasEffectStyles = spec.effectStyles.length > 0;

  if (!hasCollections && !hasTextStyles && !hasEffectStyles) {
    return ['This file has no local variable collections, text styles, or effect styles.'];
  }
  if (!hasCollections) return ['This file has no local variable collections.'];
  if (!hasTextStyles) return ['This file has no local text styles.'];

  const hasColor = spec.collections.some((c) =>
    c.variables.some((v) => v.resolvedType === 'COLOR'));
  if (!hasColor) return ['No color variables found, so the docs will have no swatches.'];

  return [];
}

// ---------------------------------------------------------------------------
// How many frames a build will produce
//
// A large collection splits into one frame per top-level group, so "one row,
// one frame" is not true and the user has no way to know it from the row. These
// derive the real counts from planFoundationUnits, the same function the main
// thread plans the build with, rather than re-implementing the split rule where
// it could drift from the build it describes.
// ---------------------------------------------------------------------------

/** Frames the current selection will produce. */
export function frameCount(spec: FoundationSpec, sel: FoundationSelection): number {
  return planFoundationUnits(spec, sel).length;
}

/**
 * Frames each source would produce if it were selected, so a row can say so
 * whether or not it is currently checked. Splitting depends on variable count
 * and name groups, never on which modes are chosen, so planning over
 * everything gives each source its true count.
 */
export function framesPerSource(
  spec: FoundationSpec,
): { collections: Record<string, number>; textStyles: number; effectStyles: number } {
  const units = planFoundationUnits(spec, {
    collections: spec.collections.map((c) => ({
      collectionId: c.id, modeIds: c.modes.map((m) => m.modeId),
    })),
    textStyles: spec.textStyles.length > 0,
    effectStyles: spec.effectStyles.length > 0,
  });

  const collections: Record<string, number> = {};
  let textStyles = 0;
  let effectStyles = 0;
  for (const unit of units) {
    if (unit.scope.target === 'textStyles') textStyles += 1;
    else if (unit.scope.target === 'effectStyles') effectStyles += 1;
    else if (unit.scope.target === 'collection') {
      collections[unit.scope.collectionId] = (collections[unit.scope.collectionId] ?? 0) + 1;
    }
  }
  return { collections, textStyles, effectStyles };
}

// ---------------------------------------------------------------------------
// Select all / clear all
// ---------------------------------------------------------------------------

/** Everything in the file, with each collection's modes at the column cap. */
export function selectAll(spec: FoundationSpec): FoundationSelection {
  return defaultSelection(spec);
}

export function clearAll(): FoundationSelection {
  return { collections: [], textStyles: false, effectStyles: false };
}

/**
 * Whether every source in the file is selected, which is what the toggle-all
 * link's label reads from. Judged on sources, not modes: a collection past the
 * column cap is fully selected with only four of its modes, since four is all a
 * frame can show.
 */
export function allSelected(spec: FoundationSpec, sel: FoundationSelection): boolean {
  const everyCollection = spec.collections.every((c) =>
    sel.collections.some((s) => s.collectionId === c.id));
  const stylesSettled = spec.textStyles.length === 0 || sel.textStyles;
  const effectsSettled = spec.effectStyles.length === 0 || sel.effectStyles;
  return everyCollection && stylesSettled && effectsSettled;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** One line describing what the file holds. */
export function fileSummary(summary: FoundationSummary): string {
  const parts: string[] = [];
  if (summary.collectionCount > 0) {
    parts.push(plural(summary.collectionCount, 'variable collection', 'variable collections'));
  }
  if (summary.textStyleCount > 0) {
    parts.push(plural(summary.textStyleCount, 'text style', 'text styles'));
  }
  if (summary.effectStyleCount > 0) {
    parts.push(plural(summary.effectStyleCount, 'effect style', 'effect styles'));
  }
  if (parts.length === 0) return 'Nothing to document in this file yet.';
  return `This file has ${joinAnd(parts)}.`;
}

/** A collection row's second line. */
export function collectionMeta(c: FoundationSummaryCollection, frames: number): string {
  const parts = [
    plural(c.variableCount, 'variable', 'variables'),
    plural(c.modes.length, 'mode', 'modes'),
  ];
  // Only worth saying when it is not the obvious one doc. Each split unit is
  // its own Section and Library row, so the honest count is docs, and it is
  // the total rather than a "+" on top of one.
  if (frames > 1) parts.push(`${frames} docs`);
  return parts.join(' · ');
}

/** The text-styles row's second line. */
export function textStyleMeta(count: number, frames: number): string {
  const parts = [plural(count, 'style', 'styles')];
  if (frames > 1) parts.push(`${frames} docs`);
  return parts.join(' · ');
}

/** The effect-styles row's second line. Counts the same way text styles do:
 *  a plain style count, plus a doc count only when the row splits. */
export function effectStyleMeta(count: number, frames: number): string {
  return textStyleMeta(count, frames);
}

/**
 * The create button's label. See docs/plugin-voice-and-copy.md ("Footer
 * actions") for why this names the action rather than counting frames:
 * collectionMeta and textStyleMeta already append "N docs" to any row that
 * splits, and a frame is the wrong noun for what the user came for.
 */
export const FOUNDATION_CREATE_LABEL = 'Create docs';

// ---------------------------------------------------------------------------
// AI group descriptions
// ---------------------------------------------------------------------------

/**
 * The per-collection briefs for one build: one block per selected collection,
 * each carrying only that collection's own name, modes, alias counts and
 * colour groups. Never merged across collections, so the model is never asked
 * to describe a union that does not exist.
 *
 * Group folders are keyed `collectionId|folder` to match the message the main
 * thread receives. Built from the same `folderOf`/`groupTitle` the renderer
 * uses, so a description cannot arrive keyed to a folder no block will look up.
 */
export function groupBriefs(
  spec: FoundationSpec, sel: FoundationSelection,
): GroupDraftInput {
  const collections: FoundationCollectionBrief[] = [];

  for (const chosen of sel.collections) {
    const collection = spec.collections.find((c) => c.id === chosen.collectionId);
    if (!collection) continue;

    const groups: FoundationGroupBrief[] = [];
    const colors = collection.variables.filter((v) => v.resolvedType === 'COLOR');
    const byFolder = new Map<string, typeof colors>();
    for (const variable of colors) {
      const folder = folderOf(variable.name);
      const bucket = byFolder.get(folder);
      if (bucket) bucket.push(variable);
      else byFolder.set(folder, [variable]);
    }

    const folders = [...byFolder.keys()];
    const titles = groupTitles(folders);
    folders.forEach((folder, i) => {
      const members = byFolder.get(folder) ?? [];
      // A folderless group gets no heading, so it gets no description either.
      if (!folder) return;
      const modeId = chosen.modeIds[0] ?? collection.defaultModeId;
      groups.push({
        folder: `${collection.id}|${folder}`,
        title: titles[i],
        resolvedType: 'COLOR',
        tokenNames: members.map((m) => m.name),
        sampleValues: members.map((m) => describeValue(m.valuesByMode[modeId])),
      });
    });

    collections.push({
      collectionId: collection.id,
      collectionName: collection.name,
      modeNames: collectionModeNames(spec, collection.id),
      aliasCounts: collectionAliasCounts(spec, collection.id),
      groups,
    });
  }

  return { collections };
}

/** A short, honest rendering of one value for the prompt. */
function describeValue(value: FoundationValue | undefined): string {
  if (!value) return '';
  switch (value.kind) {
    case 'color': return value.hex;
    case 'number': return String(value.value);
    case 'string': return value.value;
    case 'boolean': return String(value.value);
    case 'alias': return `alias to ${value.targetName}`;
    case 'unresolved': return '';
  }
}
