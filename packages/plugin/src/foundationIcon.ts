/**
 * foundationIcon.ts — which glyph a foundation source is entitled to, decided
 * in exactly one place.
 *
 * Two lists show the same foundation sources: the Foundations tab's picker rows
 * and My Library's foundation rows. They are resolved on opposite sides of the
 * plugin boundary — the picker reads the live spec in the UI, while a Library
 * row's source is a stored scope only the main thread can read — so without a
 * shared derivation the same collection ends up with two different icons, which
 * is exactly the drift this module exists to prevent.
 *
 * `color`/`dimension` are only claimed when every variable in scope agrees. A
 * mixed bag, an empty one, or a source that could not be read falls back to
 * `mixed` rather than guessing from a majority, so the glyph never asserts a
 * uniformity the source doesn't have.
 */

import type {
  FoundationCollection,
  FoundationScope,
  FoundationSpec,
  FoundationVariable,
} from '@spec-layer/extractor';

export type FoundationIconKind = 'color' | 'dimension' | 'mixed' | 'typography';

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

/**
 * The kind for one generated document's stored scope.
 *
 * Group-scoped docs (a large collection split by top-level group) are read from
 * their own rows, mirroring unitContent's filter, so a split doc describes what
 * it actually renders rather than what its whole collection contains.
 *
 * `spec` is nullable because live extraction can fail: with nothing to read,
 * `mixed` says the least.
 */
export function scopeIconKind(
  spec: FoundationSpec | null,
  scope: FoundationScope,
): FoundationIconKind {
  if (scope.target === 'textStyles') return 'typography';

  const collection = spec?.collections.find((c) => c.id === scope.collectionId);
  if (!collection) return 'mixed';

  return variablesIconKind(
    scope.group
      ? collection.variables.filter((v) => v.group === scope.group)
      : collection.variables,
  );
}
