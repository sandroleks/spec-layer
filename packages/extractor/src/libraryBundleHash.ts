/**
 * The content identity of a published library bundle: a fourth hash, separate
 * from specContentHash, foundationContentHash and semanticContentHash, that
 * answers "did this publish change what developers pull?".
 *
 * Every build stamps a fresh timestamp into each export envelope, so a byte
 * hash counts every republish. This hashes canonical JSON with those envelope
 * fields removed; everything else the bundle carries still feeds it. It never
 * feeds a canvas hash or artifact identity, and the proxy keeps the byte hash
 * separately for the pull `ETag`. Not in libraryBundle.ts, which must stay
 * dependency-free.
 */

import { sha256 } from 'js-sha256';
// Never localeCompare: the proxy compares hashes taken on different machines.
import { compareCodeUnits } from './v5/diagnostics';

/**
 * The export envelope fields that change on every build of the same sources
 * (`id` embeds the timestamp). The `ai` projections carry no timestamp; a
 * plugin test hashing two bundles built seconds apart keeps that true.
 */
const VOLATILE_EXPORT_FIELDS = ['id', 'generated_at'] as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** In place; tolerates any shape. */
function stripExportEnvelope(artifact: unknown): void {
  if (!isRecord(artifact) || !isRecord(artifact.spec_layer)) return;
  const exported = artifact.spec_layer.export;
  if (!isRecord(exported)) return;
  for (const field of VOLATILE_EXPORT_FIELDS) delete exported[field];
}

/**
 * Keys sorted by code unit at every depth. Not canonicalJson: JSON.stringify
 * writes integer-like keys first, and the proxy already stores hashes taken
 * this way.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareCodeUnits)) out[key] = canonical(value[key]);
  return out;
}

/**
 * Equal for bundles built from the same sources at different times, different
 * when anything a developer pulls differs. Takes the bundle as sent, so an
 * unknown field still counts: the proxy stores and delivers the bytes verbatim.
 */
export function libraryBundleContentHash(bundle: unknown): string {
  // A copy: the caller's bundle is stored verbatim.
  const copy: unknown = JSON.parse(JSON.stringify(bundle));
  if (isRecord(copy)) {
    if (isRecord(copy.foundation)) stripExportEnvelope(copy.foundation.artifact);
    if (Array.isArray(copy.components)) {
      for (const component of copy.components) {
        if (isRecord(component)) stripExportEnvelope(component.artifact);
      }
    }
  }
  return sha256(JSON.stringify(canonical(copy)));
}
