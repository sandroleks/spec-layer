/**
 * foundationState.ts — the pure selection model behind the Foundations tab.
 *
 * dom.ts owns markup and render.ts owns painting; everything decidable without
 * a DOM lives here so it can be tested. Mode selections are always stored in
 * collection order rather than click order, so a rebuilt doc's columns do not
 * silently reorder between generations.
 */
import {
  MAX_MODE_COLUMNS, planFoundationUnits, folderOf, groupTitles,
  type FoundationSpec, type FoundationSelection, type FoundationMode,
  type FoundationGroupBrief, type FoundationValue,
} from '@spec-layer/extractor';
import { collectionIconKind, type FoundationIconKind } from '../foundationIcon';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
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
  collections: FoundationSummaryCollection[];
}

export function summarize(spec: FoundationSpec): FoundationSummary {
  return {
    collectionCount: spec.collections.length,
    maxModeCount: spec.collections.reduce((n, c) => Math.max(n, c.modes.length), 0),
    variableCount: spec.collections.reduce((n, c) => n + c.variables.length, 0),
    textStyleCount: spec.textStyles.length,
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

export function canGenerate(sel: FoundationSelection): boolean {
  return sel.collections.length > 0 || sel.textStyles;
}

/**
 * Zero or one line explaining what the file does not have. Each case names the
 * reason rather than leaving an unexplained gap in the docs.
 */
export function emptyStateLines(spec: FoundationSpec): string[] {
  const hasCollections = spec.collections.length > 0;
  const hasTextStyles = spec.textStyles.length > 0;

  if (!hasCollections && !hasTextStyles) {
    return ['This file has no local variable collections or text styles.'];
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
): { collections: Record<string, number>; textStyles: number } {
  const units = planFoundationUnits(spec, {
    collections: spec.collections.map((c) => ({
      collectionId: c.id, modeIds: c.modes.map((m) => m.modeId),
    })),
    textStyles: spec.textStyles.length > 0,
  });

  const collections: Record<string, number> = {};
  let textStyles = 0;
  for (const unit of units) {
    if (unit.scope.target === 'textStyles') textStyles += 1;
    else {
      collections[unit.scope.collectionId] = (collections[unit.scope.collectionId] ?? 0) + 1;
    }
  }
  return { collections, textStyles };
}

// ---------------------------------------------------------------------------
// Select all / clear all
// ---------------------------------------------------------------------------

/** Everything in the file, with each collection's modes at the column cap. */
export function selectAll(spec: FoundationSpec): FoundationSelection {
  return defaultSelection(spec);
}

export function clearAll(): FoundationSelection {
  return { collections: [], textStyles: false };
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
  return everyCollection && stylesSettled;
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
  if (parts.length === 0) return 'Nothing to document in this file yet.';
  return `This file has ${parts.join(' and ')}.`;
}

/** A collection row's second line. */
export function collectionMeta(c: FoundationSummaryCollection, frames: number): string {
  const parts = [
    plural(c.variableCount, 'variable', 'variables'),
    plural(c.modes.length, 'mode', 'modes'),
  ];
  // Only worth saying when it is not the obvious one frame.
  if (frames > 1) parts.push(`+ ${frames} frames`);
  return parts.join(' · ');
}

/** The text-styles row's second line. */
export function textStyleMeta(count: number, frames: number): string {
  const parts = [plural(count, 'style', 'styles')];
  if (frames > 1) parts.push(`+ ${frames} frames`);
  return parts.join(' · ');
}

/**
 * The create button's label. See docs/plugin-voice-and-copy.md ("Footer
 * actions") for why this names the action rather than counting frames.
 *
 * It used to be `createButtonLabel(frames)` → "Create 8 frames", defended on
 * the grounds that the count was the only place the user learns a build
 * produces more frames than rows they ticked. It is not: collectionMeta and
 * textStyleMeta above already append "+ N frames" to any row that splits, and
 * the toolbar reports "N of M included". A frame is also the wrong noun — the
 * user came for docs, and frames are how this screen happens to store them.
 */
export const FOUNDATION_CREATE_LABEL = 'Create docs';

// ---------------------------------------------------------------------------
// AI group descriptions
// ---------------------------------------------------------------------------

/**
 * Whether the current selection contains any colour variable at all.
 *
 * Gates the AI opt-in: only colour rows render group headings, so a file of pure
 * spacing tokens has nothing for a description to sit under, and offering to
 * spend a generation on it would be offering to waste one.
 */
export function hasColorGroups(spec: FoundationSpec, sel: FoundationSelection): boolean {
  return sel.collections.some((chosen) => {
    const collection = spec.collections.find((c) => c.id === chosen.collectionId);
    return collection?.variables.some((v) => v.resolvedType === 'COLOR') ?? false;
  });
}

/**
 * The per-group briefs for one build, keyed `collectionId|folder` to match the
 * message the main thread receives.
 *
 * Built from the same `folderOf`/`groupTitle` the renderer uses, so a description
 * cannot arrive keyed to a folder no block will look up.
 */
export function groupBriefs(
  spec: FoundationSpec, sel: FoundationSelection,
): { collectionName: string; groups: FoundationGroupBrief[] } {
  const groups: FoundationGroupBrief[] = [];
  const names: string[] = [];

  for (const chosen of sel.collections) {
    const collection = spec.collections.find((c) => c.id === chosen.collectionId);
    if (!collection) continue;
    names.push(collection.name);

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
  }

  return { collectionName: names.join(', '), groups };
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
