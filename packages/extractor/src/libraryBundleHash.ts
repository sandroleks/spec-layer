/**
 * libraryBundleHash.ts — the content identity of a published library bundle.
 *
 * A fourth, bundle-level hash, deliberately separate from the three document
 * hashes: `specContentHash` (component canvas drift),
 * `foundationContentHash` (Foundation canvas drift), and
 * `semanticContentHash` (exported v5 artifact identity). This one answers a
 * question none of those do: did this publish change what developers pull?
 *
 * `sha256(JSON.stringify(bundle))` cannot answer it. Every build stamps a
 * fresh `generatedAt` into each artifact's export envelope, so two bundles
 * assembled from the same sources seconds apart differ in bytes. A proxy
 * comparing bytes therefore counts every republish and can never report
 * "nothing changed".
 *
 * So the hash is taken over a canonical JSON of the bundle with the
 * per-export envelope fields removed. Everything a developer actually pulls
 * still feeds it: each component, the foundation, `fileName`,
 * `extractorVersion`, `pluginVersion`, and every other field the bundle
 * carries. Nothing here participates in a canvas hash or in artifact
 * identity, and the proxy keeps the byte hash separately for the pull `ETag`.
 *
 * It lives beside `libraryBundle.ts` rather than inside it because that module
 * is deliberately dependency-free so a consumer can inline the envelope
 * contract on its own; this one needs `js-sha256`.
 */

import { sha256 } from 'js-sha256';
// compareCodeUnits, never localeCompare: locale ordering would make this hash
// machine-dependent, and the proxy compares one machine's hash with another's.
import { compareCodeUnits } from './v5/diagnostics';

/**
 * The export envelope fields that change on every build of the same sources.
 * `id` embeds the timestamp; `generated_at` is the timestamp. Everything else
 * under `spec_layer.export`, `content_hash` included, is content.
 *
 * The `ai` projections a bundle carries (a component's YAML brief and the
 * foundation's DTCG document) carry no timestamp of their own today. The
 * plugin test that hashes two bundles built five seconds apart is what keeps
 * that true: a timestamp introduced into either projection would fail it, and
 * the field would then have to be named here.
 */
const VOLATILE_EXPORT_FIELDS = ['id', 'generated_at'] as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Drop the per-export fields from one artifact, in place. Tolerates any shape. */
function stripExportEnvelope(artifact: unknown): void {
  if (!isRecord(artifact) || !isRecord(artifact.spec_layer)) return;
  const exported = artifact.spec_layer.export;
  if (!isRecord(exported)) return;
  for (const field of VOLATILE_EXPORT_FIELDS) delete exported[field];
}

/** Object keys sorted by code unit at every depth, so key order cannot move the hash. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareCodeUnits)) out[key] = canonical(value[key]);
  return out;
}

/**
 * The content identity of a library bundle: equal for two bundles built from
 * the same sources at different wall-clock times, different when anything a
 * developer pulls differs.
 *
 * Takes the bundle as sent rather than a parsed one, so a field this reader
 * does not know about still counts: the proxy stores the bytes verbatim, and
 * anything it stores is something a pull delivers. Shape validation belongs to
 * `parseLibraryBundle`, which the proxy runs first.
 */
export function libraryBundleContentHash(bundle: unknown): string {
  // A copy, because the caller's bundle is the one that gets stored verbatim.
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
