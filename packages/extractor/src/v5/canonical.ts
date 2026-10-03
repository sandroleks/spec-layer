/**
 * The artifact envelope and the semantic content hash (spec §5.1, §16).
 * `semanticContentHash` is artifact identity, distinct from the canvas drift
 * hashes in hash.ts, which must not change to serve it: every committed
 * baseline depends on them. All serialize through `canonicalJson`.
 */
import { sha256 } from 'js-sha256';
import { EXTRACTOR_VERSION } from '../version';
import { compareCodeUnits } from './diagnostics';
import type { Diagnostic } from './diagnostics';
import type {
  CollectionV5, EffectStyleV5, ExtractionCompleteness, TokenV5, TypographyStyleV5,
} from './entities';

export const SCHEMA_VERSION = '5.2.0';
export const SCHEMA_URI = 'https://spec-layer.com/schemas/foundation-context/v5.json';
export const EXTRACTOR_NAME = 'spec-layer-foundation';

export interface ArtifactSource {
  provider: 'figma';
  file_id: string | null;
  file_name: string | null;
  file_version: string | null;
  /** null is unknown (the API does not say); it never means disabled. */
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
 * `completeness` is IN: a failed library read and an empty one otherwise
 * produce identical data. `diagnostics` is OUT: their facts are in the payload
 * or `completeness`, and rewording a message must not change identity.
 * `statistics` is OUT: derivable (§15). The envelope is OUT: timestamp, export
 * id and build would break §21.1.12 across builds.
 */
export interface SemanticPayload {
  completeness: ExtractionCompleteness;
  collections: CollectionV5[];
  tokens: TokenV5[];
  styles: { typography: TypographyStyleV5[]; effects: EffectStyleV5[] };
}

/** Generated prose carried through Copy for AI: an annotation, not measured
 *  data, so outside SemanticPayload and the hash. */
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
 * Canonical JSON for v5: object keys sorted recursively BY CODE UNIT, with
 * `undefined` handled as `JSON.stringify` does (keys dropped, array members
 * `null`). Uses `compareCodeUnits` so the v5 tree has one ordering. Exported so
 * a test can assert the serialized key order, not just hash equality.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(v => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  }
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
  // Named, not spread, so no other artifact field can leak in (see SemanticPayload).
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
      // Opaque and equality-compared, not semver (version.ts); §5.1 keeps it
      // apart from schema_version.
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
