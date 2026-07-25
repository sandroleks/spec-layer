/**
 * foundationState.ts — the pure selection model behind the Foundations tab.
 *
 * dom.ts owns markup and render.ts owns painting; everything decidable without
 * a DOM lives here so it can be tested. Mode selections are always stored in
 * collection order rather than click order, so a rebuilt doc's columns do not
 * silently reorder between generations.
 */
import {
  MAX_MODE_COLUMNS, type FoundationSpec, type FoundationSelection, type FoundationMode,
} from '@spec-layer/extractor';

export interface FoundationSummaryCollection {
  id: string;
  name: string;
  variableCount: number;
  modes: FoundationMode[];
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
