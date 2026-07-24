/**
 * exportFiles.ts — pure utilities for building and zipping export file records.
 *
 * Intentionally has no DOM or Figma dependencies so it can be unit-tested in
 * Node/Vitest without a browser environment.
 *
 * buildExportFiles: maps an array of { name, markdown } to a record of
 *   "<folder>/<kebab-name>.md" → markdown, with collision handling and a safe
 *   fallback for names that reduce to empty after kebab-casing.
 *
 * zipFiles: takes that record and produces a Uint8Array zip using fflate.
 */

import { zipSync, strToU8 } from 'fflate';
import type { IntermediateSpec } from '@spec-layer/extractor';
import { toKebab } from './ui/state';

export interface ExportItem {
  name: string;
  markdown: string;
  /**
   * The structured extraction. When present, a `.spec-data/<path>.json` sidecar
   * is emitted alongside the markdown — this is what powers the docs site's
   * interactive Variants grid, Anatomy, and Properties tables. Omitting it
   * (legacy/raw markdown) writes the `.md` only.
   */
  spec?: IntermediateSpec;
}

// ---------------------------------------------------------------------------
// buildExportFiles
// ---------------------------------------------------------------------------

/**
 * Convert an array of components to a path → content record ready to zip.
 *
 * For each item this emits:
 *   - "<folder>/<slug>.md"               → the rendered markdown
 *   - ".spec-data/<folder>/<slug>.json"  → the IntermediateSpec (when present)
 *
 * The `.spec-data` sidecar carries the full `IntermediateSpec` alongside the
 * markdown — including the per-variant grid in `spec.variantInstances`, which
 * never appears in the markdown itself — so a downstream importer can reproduce
 * the same rendering instead of falling back to markdown-only.
 *
 * - Names are kebab-cased via toKebab().
 * - If a name kebabs to empty, the fallback "component" is used.
 * - Collisions are resolved by appending -2, -3, … (first occurrence keeps no
 *   suffix); the candidate is also re-checked against already-emitted paths so a
 *   literal "card-2" can't silently overwrite the suffixed form of "card". The
 *   resolved slug is shared between the `.md` and its `.json` sidecar so the two
 *   stay in lockstep.
 * - folder is prepended as "<folder>/" when non-empty.
 */
export function buildExportFiles(
  items: ExportItem[],
  folder: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  // Track how many times a base slug has been seen (for collision handling).
  const seen = new Map<string, number>();

  for (const item of items) {
    let slug = toKebab(item.name).replace(/^-+|-+$/g, '');
    if (!slug) slug = 'component';

    // First occurrence keeps the bare slug; subsequent ones get -2, -3, …
    // Then re-check against already-emitted paths and keep incrementing if the
    // candidate is taken — this covers the edge where a literal name like
    // "card-2" collides with the suffixed form of a duplicate "card".
    let n = (seen.get(slug) ?? 0) + 1;
    const mdPathFor = (suffix: string) => {
      const filename = slug + suffix + '.md';
      return folder ? `${folder}/${filename}` : filename;
    };
    let suffix = n === 1 ? '' : `-${n}`;
    let path = mdPathFor(suffix);
    while (result[path] !== undefined) {
      n += 1;
      suffix = `-${n}`;
      path = mdPathFor(suffix);
    }
    seen.set(slug, n);

    result[path] = item.markdown;

    // Sidecar uses the same resolved slug under a sibling ".spec-data" tree, so
    // it can never collide with a ".md" path; lockstep slugging keeps it paired
    // with its markdown even across name collisions.
    if (item.spec) {
      const sidecarName = slug + suffix + '.json';
      const sidecarPath = folder
        ? `.spec-data/${folder}/${sidecarName}`
        : `.spec-data/${sidecarName}`;
      result[sidecarPath] = JSON.stringify(item.spec, null, 2);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// zipFiles
// ---------------------------------------------------------------------------

/**
 * Compress a path → content record into a zip Uint8Array.
 * Uses fflate's synchronous zipSync; content strings are encoded with strToU8.
 */
export function zipFiles(files: Record<string, string>): Uint8Array {
  const input: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    input[path] = strToU8(content);
  }
  return zipSync(input, { level: 6 });
}
