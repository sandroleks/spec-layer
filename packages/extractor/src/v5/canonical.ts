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
 */
import { contentHash } from '../hash';
import { EXTRACTOR_VERSION } from '../version';
import type { Diagnostic } from './diagnostics';
import type {
  CollectionV5, EffectStyleV5, ExtractionCompleteness, TokenV5, TypographyStyleV5,
} from './entities';

export const SCHEMA_VERSION = '5.0.0';
export const SCHEMA_URI = 'https://spec-layer.dev/schemas/foundation-context/v5.json';
export const EXTRACTOR_NAME = 'spec-layer-foundation';

export interface ArtifactSource {
  provider: 'figma';
  file_id: string | null;
  file_name: string | null;
  file_version: string | null;
  library_enabled: boolean;
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

export interface FoundationArtifactV5 extends SemanticPayload {
  spec_layer: Envelope;
  diagnostics: Diagnostic[];
  statistics: Record<string, unknown>;
}

export function semanticContentHash(payload: SemanticPayload): string {
  return `sha256:${contentHash({
    completeness: payload.completeness,
    collections: payload.collections,
    tokens: payload.tokens,
    styles: payload.styles,
  })}`;
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
