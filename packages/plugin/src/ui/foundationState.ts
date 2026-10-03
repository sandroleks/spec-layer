/**
 * The pure selection model behind the Foundations tab; screens/foundations.ts
 * paints. Modes are stored in collection order, not click order, so a rebuilt
 * doc's columns never reorder.
 */
import {
  MAX_MODE_COLUMNS, planFoundationUnits, folderOf, groupTitles,
  collectionAliasCounts, collectionModeNames, durationLabel, easingLabel,
  type FoundationSpec, type FoundationSelection, type FoundationMode,
  type FoundationGroupBrief, type FoundationCollectionBrief, type FoundationValue,
  type GroupDraftInput,
} from '@spec-layer/extractor';
import { collectionIconKind, type FoundationIconKind } from '../foundationIcon';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Derived in foundationIcon.ts so Library rows, built on the main thread,
 *  answer the same way. */
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

function inCollectionOrder(spec: FoundationSpec, collectionId: string, ids: string[]): string[] {
  const collection = spec.collections.find((c) => c.id === collectionId);
  if (!collection) return [];
  return collection.modes.map((m) => m.modeId).filter((id) => ids.includes(id));
}

/** Add or replace a collection's entry, kept in the spec's collection order. */
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
    // At the cap, ignore the check rather than evict a chosen column.
    if (current.length >= MAX_MODE_COLUMNS) return sel;
    nextIds = inCollectionOrder(spec, collectionId, [...current, modeId]);
  } else {
    nextIds = current.filter((id) => id !== modeId);
  }

  if (nextIds.length === 0) {
    return { ...sel, collections: sel.collections.filter((c) => c.collectionId !== collectionId) };
  }
  if (!existing) {
    // Honour the picked mode, not the collection's default modes.
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

// ---------------------------------------------------------------------------
// Frame counts, from planFoundationUnits, the same plan main builds with
// ---------------------------------------------------------------------------

export function frameCount(spec: FoundationSpec, sel: FoundationSelection): number {
  return planFoundationUnits(spec, sel).length;
}

/** Frames each source would produce if selected. Splitting never depends on
 *  the chosen modes, so planning over everything gives the true count. */
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

/** Everything in the file, with each collection's modes at the column cap. */
export function selectAll(spec: FoundationSpec): FoundationSelection {
  return defaultSelection(spec);
}

export function clearAll(): FoundationSelection {
  return { collections: [], textStyles: false, effectStyles: false };
}

/** Judged on sources, not modes: a collection past the column cap counts as
 *  selected with four modes, all a frame can show. */
export function allSelected(spec: FoundationSpec, sel: FoundationSelection): boolean {
  const everyCollection = spec.collections.every((c) =>
    sel.collections.some((s) => s.collectionId === c.id));
  const stylesSettled = spec.textStyles.length === 0 || sel.textStyles;
  const effectsSettled = spec.effectStyles.length === 0 || sel.effectStyles;
  return everyCollection && stylesSettled && effectsSettled;
}

/** A collection row's second line. */
export function collectionMeta(c: FoundationSummaryCollection, frames: number): string {
  const parts = [
    plural(c.variableCount, 'variable', 'variables'),
    plural(c.modes.length, 'mode', 'modes'),
  ];
  // Each split unit is its own doc, so the count is the total docs.
  if (frames > 1) parts.push(`${frames} docs`);
  return parts.join(' · ');
}

export function textStyleMeta(count: number, frames: number): string {
  const parts = [plural(count, 'style', 'styles')];
  if (frames > 1) parts.push(`${frames} docs`);
  return parts.join(' · ');
}

export function effectStyleMeta(count: number, frames: number): string {
  return textStyleMeta(count, frames);
}

/** Names the action, not a frame count; see docs/plugin-voice-and-copy.md
 *  ("Footer actions"). Split rows already say "N docs". */
export const FOUNDATION_CREATE_LABEL = 'Create docs';

// ---------------------------------------------------------------------------
// AI group descriptions
// ---------------------------------------------------------------------------

/**
 * One brief per selected collection, never merged, so the model never
 * describes a union that does not exist. Folders are keyed
 * `collectionId|folder` and built with the renderer's `folderOf`/`groupTitles`,
 * so every description lands on a folder a block looks up.
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

function describeValue(value: FoundationValue | undefined): string {
  if (!value) return '';
  switch (value.kind) {
    case 'color': return value.hex;
    case 'number': return String(value.value);
    case 'string': return value.value;
    case 'boolean': return String(value.value);
    case 'duration': return durationLabel(value.seconds);
    case 'easing': return easingLabel(value.easing);
    case 'alias': return `alias to ${value.targetName}`;
    case 'unresolved': return '';
  }
}
