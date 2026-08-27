import { describe, it, expect } from 'vitest';
import { semanticContentHash, buildEnvelope, SCHEMA_VERSION } from '../../src/v5/canonical';
import type { SemanticPayload } from '../../src/v5/canonical';

const COMPLETE: SemanticPayload = {
  completeness: { collections: 'complete', styles: 'complete', unavailable_sources: [] },
  collections: [],
  tokens: [],
  styles: { typography: [], effects: [] },
};

const SOURCE = {
  provider: 'figma' as const, file_id: 'F:1', file_name: 'DS',
  file_version: null, library_enabled: true,
};

const META = {
  exportId: 'one', generatedAt: '2026-01-01T00:00:00.000Z',
  build: 'abc123', source: SOURCE,
};

describe('semanticContentHash', () => {
  it('is stable across key order', () => {
    const reordered = {
      styles: COMPLETE.styles, tokens: COMPLETE.tokens,
      collections: COMPLETE.collections, completeness: COMPLETE.completeness,
    } as SemanticPayload;
    expect(semanticContentHash(reordered)).toBe(semanticContentHash(COMPLETE));
  });

  it('is prefixed with its algorithm', () => {
    expect(semanticContentHash(COMPLETE)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('distinguishes a complete export from one that could not read a library', () => {
    // THE reason completeness is hashed. Both exports carry the same surviving
    // tokens; one of them silently failed. Without this they hash identically
    // and a consumer diffing two exports sees no change at all.
    const partial: SemanticPayload = {
      ...COMPLETE,
      completeness: {
        collections: 'partial', styles: 'complete',
        unavailable_sources: ['Color base [deprecated]'],
      },
    };
    expect(semanticContentHash(partial)).not.toBe(semanticContentHash(COMPLETE));
  });

  it('moves when the payload moves', () => {
    const changed: SemanticPayload = {
      ...COMPLETE,
      tokens: [{ id: 'V:1' } as unknown as SemanticPayload['tokens'][number]],
    };
    expect(semanticContentHash(changed)).not.toBe(semanticContentHash(COMPLETE));
  });
});

describe('buildEnvelope', () => {
  it('excludes the timestamp, the export id and the build from the hash', () => {
    const a = buildEnvelope(COMPLETE, META);
    const b = buildEnvelope(COMPLETE, {
      ...META, exportId: 'two',
      generatedAt: '2026-12-31T00:00:00.000Z', build: 'def456',
    });
    expect(a.export.content_hash).toBe(b.export.content_hash);
  });

  it('separates schema version from extractor version', () => {
    const env = buildEnvelope(COMPLETE, META);
    expect(env.schema_version).toBe(SCHEMA_VERSION);
    expect(env.schema_version).toMatch(/^\d+\.\d+\.\d+$/);
    // EXTRACTOR_VERSION is an opaque equality-compared identifier and is
    // deliberately not semver. See version.ts.
    expect(env.extractor.version).not.toBe(env.schema_version);
  });

  it('writes null for an unavailable source field, never a placeholder', () => {
    // §5.1 forbids placeholder strings. v4's fileKeyOf already refuses to emit
    // the literal 'unknown' for the same reason.
    expect(buildEnvelope(COMPLETE, META).source.file_version).toBeNull();
  });
});
