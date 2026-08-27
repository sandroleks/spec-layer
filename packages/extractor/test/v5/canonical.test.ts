import { describe, it, expect } from 'vitest';
import {
  canonicalJson, semanticContentHash, buildEnvelope, SCHEMA_VERSION,
} from '../../src/v5/canonical';
import { compareCodeUnits } from '../../src/v5/diagnostics';
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

/** A payload with real nesting: keys inside a collection, inside its modes,
 *  inside a token, and inside that token's per-mode canonical values. Key
 *  order has to be normalized at every one of those depths, not just at the
 *  top level. */
const NESTED: SemanticPayload = {
  completeness: { collections: 'complete', styles: 'complete', unavailable_sources: [] },
  collections: [{
    id: 'VariableCollectionId:1:2',
    name: 'Display mode',
    path: ['Display mode'],
    default_mode_id: '1:2/light',
    modes: [
      { id: '1:2/light', name: 'light', order: 0 },
      { id: '1:2/dark', name: 'dark', order: 1 },
    ],
  }],
  tokens: [{
    id: 'VariableID:3:4',
    collection_id: 'VariableCollectionId:1:2',
    name: 'Background/Page',
    path: ['Background', 'Page'],
    type: 'color',
    description: '',
    scopes: ['FRAME_FILL'],
    values: {
      '1:2/light': {
        kind: 'literal',
        value: { type: 'color', color_space: 'srgb', hex: '#006b62', alpha: 1 },
      },
      '1:2/dark': {
        kind: 'alias',
        reference: {
          target_id: 'VariableID:9:9', target_collection_id: 'VariableCollectionId:1:2',
          target_path: ['color', 'teal', '900'], external: false,
        },
        resolved: {
          status: 'resolved',
          value: { type: 'color', color_space: 'srgb', hex: '#00332f', alpha: 1 },
          chain: [{ token_id: 'VariableID:9:9', mode_id: '1:2/dark' }],
        },
      },
    },
  }],
  styles: { typography: [], effects: [] },
};

/** Rebuilds every object in `value` with its keys inserted in REVERSE order.
 *  `JSON.stringify` preserves insertion order, so this produces a structurally
 *  identical payload with a different serialization — which is exactly what a
 *  canonicalizer has to erase, at every depth. */
function reverseKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeyOrder);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).reverse()) {
      out[key] = reverseKeyOrder((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

describe('canonicalJson', () => {
  it('orders object keys BY CODE UNIT in its own output', () => {
    // The case that separates the two rules: `localeCompare` orders these
    // ['_','a','ä','B'], code units order them ['B','_','a','ä']. Asserting
    // the SERIALIZED STRING rather than a hash is deliberate — two hashes
    // agreeing proves only that the order is consistent, and a locale sort is
    // perfectly consistent right up until the next designer's browser reports
    // a different locale.
    expect(canonicalJson({ ä: 1, a: 2, _: 3, B: 4 })).toBe('{"B":4,"_":3,"a":2,"ä":1}');
  });

  it('does not order keys the way localeCompare would', () => {
    const keys = ['ä', 'a', '_', 'B'];
    const byLocale = [...keys].sort((a, b) => a.localeCompare(b));
    const byCodeUnit = [...keys].sort(compareCodeUnits);
    // Guard the guard: if this environment's localeCompare happened to agree
    // with code-unit order, the assertion below would prove nothing.
    expect(byLocale).not.toEqual(byCodeUnit);
    const emitted = canonicalJson(Object.fromEntries(keys.map((k) => [k, 0])));
    expect(emitted).toBe(`{${byCodeUnit.map((k) => `${JSON.stringify(k)}:0`).join(',')}}`);
  });

  it('sorts keys at every depth, and drops undefined-valued keys', () => {
    // Dropping `undefined` mirrors JSON.stringify's own behaviour, so a caller
    // passing an explicit `undefined` and one omitting the key produce one
    // string — the same rule hash.ts follows, kept identical on purpose.
    expect(canonicalJson({ b: { d: 1, c: [{ f: 1, e: 2 }] }, a: undefined }))
      .toBe('{"b":{"c":[{"e":2,"f":1}],"d":1}}');
  });
});

describe('semanticContentHash', () => {
  it('is stable across key order', () => {
    const reordered = {
      styles: COMPLETE.styles, tokens: COMPLETE.tokens,
      collections: COMPLETE.collections, completeness: COMPLETE.completeness,
    } as SemanticPayload;
    expect(semanticContentHash(reordered)).toBe(semanticContentHash(COMPLETE));
  });

  it('is stable across key order NESTED inside tokens and collections', () => {
    const reordered = reverseKeyOrder(NESTED) as SemanticPayload;
    // The reordering must actually have changed the serialization, or the
    // assertion below is vacuous.
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(NESTED));
    expect(semanticContentHash(reordered)).toBe(semanticContentHash(NESTED));
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
