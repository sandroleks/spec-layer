/**
 * Which glyph a foundation source gets, decided in one place so the Foundations
 * picker (UI) and My Library rows (main thread) agree. `color` and `dimension`
 * are claimed only when every variable in scope agrees; anything else,
 * including an unreadable source, is `mixed`, never a majority guess.
 */

import type {
  FoundationCollection,
  FoundationScope,
  FoundationSpec,
  FoundationVariable,
} from '@spec-layer/extractor';

export type FoundationIconKind = 'color' | 'dimension' | 'mixed' | 'typography' | 'effect';

export function variablesIconKind(
  variables: readonly FoundationVariable[],
): FoundationIconKind {
  const types = new Set(variables.map((v) => v.resolvedType));
  if (types.size === 1) {
    const [only] = types;
    if (only === 'COLOR') return 'color';
    if (only === 'FLOAT') return 'dimension';
  }
  return 'mixed';
}

export function collectionIconKind(
  collection: FoundationCollection,
): FoundationIconKind {
  return variablesIconKind(collection.variables);
}

/** The kind for one doc's stored scope. A group-scoped doc is read from its own
 *  rows, as unitContent filters them. A null `spec` (failed extraction) is `mixed`. */
export function scopeIconKind(
  spec: FoundationSpec | null,
  scope: FoundationScope,
): FoundationIconKind {
  if (scope.target === 'textStyles') return 'typography';
  if (scope.target === 'effectStyles') return 'effect';
  if (scope.target !== 'collection') return 'mixed';

  const collection = spec?.collections.find((c) => c.id === scope.collectionId);
  if (!collection) return 'mixed';

  return variablesIconKind(
    scope.group
      ? collection.variables.filter((v) => v.group === scope.group)
      : collection.variables,
  );
}
