import { sha256 } from 'js-sha256';
import type { IntermediateSpec } from './extract';
import { unitContent, type FoundationSpec, type FoundationScope } from './foundation';

/** Canonical JSON: object keys sorted recursively, then SHA-256. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    // Mirror JSON.stringify's own dropping of undefined-valued keys, keeping
    // canonical output consistent regardless of whether a caller passes them.
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export const contentHash = (value: unknown): string => sha256(canonical(value));

/**
 * The drift baseline hash. Computed over a projection that excludes rawValues,
 * and reduces anatomy to the legacy depth-0 {id,name,type,nested} shape, so
 * canvas-only 2.0 additions never flip the hash for existing committed specs.
 * This is the single source of truth for content_hash; both the Markdown
 * frontmatter and on-canvas drift detection call it.
 */
export function specContentHash(spec: IntermediateSpec): string {
  const { rawValues: _rawValues, ...rest } = spec;
  const hashable = {
    ...rest,
    anatomy: spec.anatomy
      .filter((p) => p.depth === 0)
      .map(({ id, name, type, nested }) => ({ id, name, type, nested })),
  };
  return contentHash(hashable);
}

/**
 * The drift baseline for one foundation output unit.
 *
 * Hashes the WHOLE unitContent() result, so "update available" always
 * corresponds to a visible change. Ids, extractedAt, fileKey, and anything
 * extracted but unrendered are excluded structurally: they are simply not in
 * unitContent's output.
 *
 * Deliberately not a field list. An earlier draft enumerated four fields and
 * thereby dropped omittedModeNames, which frames render in their footer, so
 * renaming an omitted mode changed the document without moving its hash. Every
 * field of FoundationUnitContent is rendered by definition; enumerating them
 * here can only ever go stale. Add fields to FoundationUnitContent, not here.
 *
 * The converse is FoundationUnitContent's job, not this function's: nothing
 * may sit in that type unless a frame draws it, or this hash flips on changes
 * whose Update produces a byte-identical frame and the badge becomes noise.
 *
 * A scope whose source no longer exists hashes a stable sentinel rather than
 * throwing, so a stale link resolves to a comparable value.
 */
export function foundationContentHash(spec: FoundationSpec, scope: FoundationScope): string {
  const content = unitContent(spec, scope);
  if (!content) return contentHash({ foundationUnit: null });
  // Hash the WHOLE unitContent result, never a cherry-picked field list. Any
  // field added to FoundationUnitContent is rendered by definition, so it must
  // be hashed; a hand-maintained projection here would silently drop it. This
  // is what makes the invariant structural rather than a matter of discipline.
  return contentHash(content);
}
