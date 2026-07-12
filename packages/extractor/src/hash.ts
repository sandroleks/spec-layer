import { sha256 } from 'js-sha256';
import type { IntermediateSpec } from './extract';

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
 * The drift baseline hash. Computed over a projection that excludes rawValues
 * (presentation-only) and reduces anatomy to the legacy depth-0 {id,name,type,
 * nested} shape, so canvas-only 2.0 additions never flip the hash for existing
 * committed specs. This is the single source of truth for content_hash; both
 * the Markdown frontmatter and on-canvas drift detection call it.
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
