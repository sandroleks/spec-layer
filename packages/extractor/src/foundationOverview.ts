/**
 * The deterministic facts the collection overview prompt is built from: names,
 * modes and alias counts, and nothing else about the collection as a whole.
 */
import type { FoundationSpec } from './foundation';
import { compareCodeUnits } from './v5/diagnostics';

export interface AliasCount { collection: string; count: number }

/**
 * How many variables of `collectionId` alias into each other collection, once
 * per target however many modes alias there. Sorted by count descending, then
 * name by code unit, so the same spec yields the same prompt bytes.
 */
export function collectionAliasCounts(spec: FoundationSpec, collectionId: string): AliasCount[] {
  const collection = spec.collections.find((c) => c.id === collectionId);
  if (!collection) return [];
  const counts = new Map<string, number>();
  for (const variable of collection.variables) {
    const targets = new Set<string>();
    for (const value of Object.values(variable.valuesByMode)) {
      if (value.kind === 'alias' && value.targetCollection && value.targetCollection !== collection.name) {
        targets.add(value.targetCollection);
      }
    }
    for (const target of targets) counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ collection: name, count }))
    .sort((a, b) => b.count - a.count || compareCodeUnits(a.collection, b.collection));
}

/** The collection's mode names in declaration order; empty for an unknown id. */
export function collectionModeNames(spec: FoundationSpec, collectionId: string): string[] {
  return spec.collections.find((c) => c.id === collectionId)?.modes.map((m) => m.name) ?? [];
}
