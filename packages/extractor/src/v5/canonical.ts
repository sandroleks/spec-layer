/**
 * The artifact envelope and the semantic content hash — spec §5.1, §16.
 *
 * THREE hashes now exist in this codebase and they answer different questions:
 *
 *  - `specContentHash` (hash.ts) -- component drift. Hashes a projection of
 *    IntermediateSpec that excludes anything a canvas frame does not draw,
 *    because it drives the on-canvas "update available" badge.
 *  - `foundationContentHash` (hash.ts) -- foundation drift, same job, same rule.
 *  - `semanticContentHash` (here) -- artifact identity, for a consumer diffing
 *    two exported YAML files.
 *
 * Only the third is defined here, and the first two must not be altered to
 * serve it: every committed doc's baseline depends on their current definitions.
 *
 * WHY v5 CANONICALIZES ITS OWN JSON instead of calling `contentHash` from
 * `../hash`:
 *
 * That shared serializer sorts object keys with `a.localeCompare(b)`
 * (`hash.ts:13`), which is locale-dependent. The IDENTICAL payload hashes
 * differently under `LC_ALL=en_US` and `LC_ALL=et_EE`, and `lt_LT` reorders
 * `i`/`y`. The plugin runs in whatever locale the user's browser reports, so
 * reusing it means two designers exporting one Figma file get two different
 * content hashes -- §16 ("repeated exports MUST produce semantically identical
 * artifacts") and §21.1.12 ("repeated extraction produces the same semantic
 * content hash") both fail.
 *
 * `hash.ts` is deliberately NOT fixed instead: its `canonical` is shared with
 * `specContentHash` and `foundationContentHash`, which drive the on-canvas
 * drift badge. Changing their output would flip every committed document to
 * "update available" for a change nobody can see on canvas. So the locale bug
 * is fixed HERE, for the one hash that has no committed baselines yet.
 */
import { sha256 } from 'js-sha256';
import { EXTRACTOR_VERSION } from '../version';
import { compareCodeUnits } from './diagnostics';
import type { Diagnostic } from './diagnostics';
import type {
  CollectionV5, EffectStyleV5, ExtractionCompleteness, TokenV5, TypographyStyleV5,
} from './entities';

export const SCHEMA_VERSION = '5.1.0';
export const SCHEMA_URI = 'https://spec-layer.com/schemas/foundation-context/v5.json';
export const EXTRACTOR_NAME = 'spec-layer-foundation';

export interface ArtifactSource {
  provider: 'figma';
  file_id: string | null;
  file_name: string | null;
  file_version: string | null;
  /** null when the source API does not expose whether this file publishes a
   *  library. null is unknown; it never means disabled. */
  library_enabled: boolean | null;
}

export interface Envelope {
  kind: 'foundation';
  schema_version: string;
  schema_uri: string;
  extractor: { name: string; version: string; build: string | null };
  export: { id: string; generated_at: string; deterministic: boolean; content_hash: string };
  source: ArtifactSource;
}

/**
 * What the content hash covers.
 *
 * `completeness` is IN because extraction failures are not recoverable from the
 * data that survived them: an export that could not read a library and one that
 * read it and found nothing produce identical `collections`, `tokens` and
 * `styles`. Hashing the completeness state is what makes those two different
 * artifacts instead of the same one.
 *
 * `diagnostics` is OUT. Every fact a diagnostic carries is either in the
 * payload or in `completeness`, and its MESSAGE is prose -- rewording one must
 * not change an artifact's identity.
 *
 * `statistics` is OUT: §15 requires it to be derivable from the artifact, and
 * hashing a derived value alongside its source can only ever create false
 * differences.
 *
 * The envelope is OUT: it holds the timestamp, the export id and the build,
 * none of which is design data and all of which would make §21.1.12 false
 * across two builds of the extractor.
 */
export interface SemanticPayload {
  completeness: ExtractionCompleteness;
  collections: CollectionV5[];
  tokens: TokenV5[];
  styles: { typography: TypographyStyleV5[]; effects: EffectStyleV5[] };
}

/** Generated prose carried through Copy for AI. This is a canvas annotation,
 *  not measured design-system data, so it deliberately stays outside
 *  SemanticPayload and the semantic content hash. */
export interface FoundationGuidelinesV5 {
  origin: 'generated';
  group_descriptions: Record<string, Record<string, string>>;
}

export interface FoundationArtifactV5 extends SemanticPayload {
  spec_layer: Envelope;
  diagnostics: Diagnostic[];
  statistics: Record<string, unknown>;
  guidelines?: FoundationGuidelinesV5;
}

/**
 * Canonical JSON for v5: object keys sorted recursively BY CODE UNIT.
 *
 * Semantically identical to `hash.ts`'s private `canonical` in every respect
 * but one -- the comparator. Recursive key sort, `undefined`-valued keys
 * dropped (mirroring `JSON.stringify`'s own behaviour, so a caller passing an
 * explicit `undefined` and a caller omitting the key produce one string), and
 * `JSON.stringify` for every scalar. ONLY the comparator differs, and that is
 * the whole point: `compareCodeUnits` is reused from `diagnostics.ts` rather
 * than open-coded here so the v5 tree has exactly one definition of ordering,
 * and a future edit to it cannot leave the hash and the sorts disagreeing.
 *
 * Exported so a test can assert the SERIALIZED STRING's key order directly.
 * Asserting only that two hashes match cannot distinguish "ordered by code
 * unit" from "ordered consistently by some other rule", and the locale bug this
 * replaces was precisely a consistent-but-wrong rule.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareCodeUnits(a, b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function semanticContentHash(payload: SemanticPayload): string {
  // The four fields are named rather than the whole payload spread, so a field
  // added to FoundationArtifactV5 (statistics, diagnostics, the envelope) can
  // never leak into the hash by accident. See SemanticPayload's own comment
  // for why each of these is in and each of those is out.
  return `sha256:${sha256(canonicalJson({
    completeness: payload.completeness,
    collections: payload.collections,
    tokens: payload.tokens,
    styles: payload.styles,
  }))}`;
}

export function buildEnvelope(
  payload: SemanticPayload,
  meta: {
    exportId: string; generatedAt: string;
    build: string | null; source: ArtifactSource;
  },
): Envelope {
  return {
    kind: 'foundation',
    schema_version: SCHEMA_VERSION,
    schema_uri: SCHEMA_URI,
    extractor: {
      name: EXTRACTOR_NAME,
      // Opaque, equality-compared, deliberately not semver -- see version.ts.
      // §5.1 requires this and schema_version kept apart precisely because they
      // answer different questions.
      version: EXTRACTOR_VERSION,
      build: meta.build,
    },
    export: {
      id: meta.exportId,
      generated_at: meta.generatedAt,
      deterministic: true,
      content_hash: semanticContentHash(payload),
    },
    source: meta.source,
  };
}
