import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { validateLevel1 } from '../../src/v5/validate';
import { SCHEMA_URI } from '../../src/v5/canonical';
import { DEFAULT_SEVERITY, compareCodeUnits } from '../../src/v5/diagnostics';
import { buildFoundation } from '../../src/foundation';
import type { SerializedFoundation } from '../../src/foundation';
import { buildFoundationArtifactV5 } from '../../src/v5/fromFoundation';
import type { FoundationExportV5Meta } from '../../src/v5/fromFoundation';
import {
  SUPPORTED_DURATION_UNITS, SUPPORTED_MISSING_REASONS, SUPPORTED_TOKEN_TYPES, SUPPORTED_UNITS,
  SUPPORTED_UNRESOLVED_REASONS,
} from '../../src/v5/value';
import { OK_ARTIFACT, VALID_CASES, INVALID_CASES } from './fixtures';

const schemaText = readFileSync(
  'packages/extractor/src/v5/schema/foundation-5.1.1.json', 'utf8',
);
const schema = JSON.parse(schemaText) as Record<string, unknown>;

// The token/value type correlation deliberately reuses small $defs across
// eight type branches. Keeping refs as callable validators avoids Ajv
// inlining the entire canonical-value union into every branch and makes this
// consumer-facing schema compile in constant-sized generated code.
const ajv = addFormats(new Ajv2020({ allErrors: true, strict: true, inlineRefs: false }));
const compiled = ajv.compile(schema);

const defs = schema.$defs as Record<string, Record<string, unknown>>;
const sorted = (values: readonly string[]): string[] => [...values].sort(compareCodeUnits);

/** Reports members present in exactly one of the two sets, so a failure names
 *  the drifted member instead of dumping two arrays for a reader to diff. */
function symmetricDifference(a: readonly string[], b: readonly string[]): string[] {
  const inA = new Set(a);
  const inB = new Set(b);
  return sorted([
    ...a.filter((x) => !inB.has(x)).map((x) => `${x} (only in the runtime vocabulary)`),
    ...b.filter((x) => !inA.has(x)).map((x) => `${x} (only in the schema)`),
  ]);
}

function enumOf(defName: string, path: string[]): string[] {
  let node: unknown = defs[defName];
  for (const key of path) node = (node as Record<string, unknown>)[key];
  const values = (node as { enum?: unknown }).enum;
  if (!Array.isArray(values)) throw new Error(`$defs.${defName} has no enum at ${path.join('.')}`);
  return values as string[];
}

describe('schema parity', () => {
  it('is itself a valid 2020-12 schema', () => {
    // strict: true above makes ajv reject an unknown keyword or a malformed
    // $ref at compile time, which is what "validate the schema itself" means
    // in practice.
    expect(() => ajv.compile(schema)).not.toThrow();
    expect(schema.$id).toBe(SCHEMA_URI);
  });

  it('keeps every schema enum identical to its runtime vocabulary', () => {
    // value.ts claims these arrays are "asserted equal in the schema test".
    // They were not, and nothing else could have caught it: TypeScript's
    // unions are erased at compile time, so adding a unit to both the `Unit`
    // type and `SUPPORTED_UNITS` left the published JSON Schema stale with
    // every test in this repo still green — a consumer validating against the
    // published schema would reject an artifact the plugin considers valid.
    //
    // Compared as code-unit-sorted arrays rather than by membership in one
    // direction: a schema that is merely LAXER than the runtime vocabulary
    // would pass a subset check while accepting values no consumer can handle.
    const pairs: [string, readonly string[], string[]][] = [
      ['unit', SUPPORTED_UNITS, enumOf('unit', [])],
      ['token_type', SUPPORTED_TOKEN_TYPES, enumOf('token_type', [])],
      ['duration_value.unit', SUPPORTED_DURATION_UNITS,
        enumOf('duration_value', ['properties', 'unit'])],
      ['unresolved_reason', SUPPORTED_UNRESOLVED_REASONS, enumOf('unresolved_reason', [])],
      ['missing_reason', SUPPORTED_MISSING_REASONS, enumOf('missing_reason', [])],
      ['diagnostic.code', Object.keys(DEFAULT_SEVERITY), enumOf('diagnostic', ['properties', 'code'])],
    ];
    for (const [name, runtime, schemaEnum] of pairs) {
      expect(
        symmetricDifference(runtime, schemaEnum),
        `${name} has drifted between value.ts and the published schema`,
      ).toEqual([]);
      expect(sorted(schemaEnum), `${name} enum`).toEqual(sorted(runtime));
    }
  });

  it('exercises every unit and every token type through both validators', () => {
    // The enum assertion above proves the two vocabularies AGREE; this proves
    // the agreement is actually tested. Fixture coverage used to be `px` and
    // `ms` only, so five of seven units and one of two duration units never
    // reached either validator, and a genuine disagreement about `deg` or `s`
    // could sit in the tree indefinitely.
    const types = new Set<string>();
    const units = new Set<string>();
    for (const { artifact } of VALID_CASES) {
      const tokens = (artifact as { tokens?: unknown[] }).tokens ?? [];
      for (const token of tokens) {
        const { type, values } = token as { type?: string; values?: Record<string, unknown> };
        if (type !== undefined) types.add(type);
        for (const value of Object.values(values ?? {})) {
          const typed = (value as { value?: { unit?: string } }).value;
          if (typed?.unit !== undefined) units.add(typed.unit);
        }
      }
    }
    expect(sorted([...types])).toEqual(sorted(SUPPORTED_TOKEN_TYPES));
    expect(sorted([...units])).toEqual(sorted(SUPPORTED_UNITS));
    // Both duration units are covered by their own cases; `SUPPORTED_UNITS`
    // contains ms and s too, so the assertion above already requires them.
    for (const unit of SUPPORTED_DURATION_UNITS) expect(units.has(unit)).toBe(true);
  });

  it('accepts every valid fixture, in both validators', () => {
    for (const { name, artifact } of VALID_CASES) {
      expect(compiled(artifact), `schema rejected ${name}: ${ajv.errorsText(compiled.errors)}`)
        .toBe(true);
      expect(validateLevel1(artifact), `handwritten rejected ${name}`).toEqual([]);
    }
  });

  it('rejects every invalid fixture, in both validators', () => {
    // Agreement on rejection is the check that matters: a schema that is merely
    // laxer than the validator passes an "accepts everything valid" test while
    // silently letting a broken artifact through to a consumer who trusts it.
    for (const { name, artifact } of INVALID_CASES) {
      expect(compiled(artifact), `schema ACCEPTED invalid ${name}`).toBe(false);
      expect(validateLevel1(artifact).length, `handwritten accepted invalid ${name}`)
        .toBeGreaterThan(0);
    }
  });
});

describe('schema-only envelope rules', () => {
  // Level 1 runs inside the plugin on an artifact the plugin itself just
  // wrote, so it checks only that the envelope, the diagnostics list and the
  // statistics block exist; their contents are the writer's own output. The
  // published schema is the consumer's check on the same bytes and pins them.
  const rejects = (name: string, mutate: (root: Record<string, unknown>) => void) => {
    const root = structuredClone(OK_ARTIFACT) as unknown as Record<string, unknown>;
    mutate(root);
    expect(compiled(root), `schema accepted ${name}`).toBe(false);
  };
  const envelope = (root: Record<string, unknown>) => root.spec_layer as Record<string, Record<string, unknown>>;

  it('rejects a foreign envelope', () => {
    rejects('a component envelope kind', (r) => { (r.spec_layer as Record<string, unknown>).kind = 'component'; });
    rejects('the component extractor name', (r) => { envelope(r).extractor.name = 'spec-layer-component'; });
    rejects('a content hash that is not sha256', (r) => { envelope(r).export.content_hash = 'md5:abc'; });
    rejects('an unknown envelope field', (r) => { (r.spec_layer as Record<string, unknown>).extra = true; });
  });

  it('rejects a diagnostic outside the vocabulary', () => {
    rejects('an unknown code', (r) => {
      r.diagnostics = [{ code: 'MADE_UP', severity: 'error', entity_id: 'x', message: 'y' }];
    });
    rejects('an unknown severity', (r) => {
      r.diagnostics = [{ code: 'UNRESOLVED_ALIAS', severity: 'fatal', entity_id: 'x', message: 'y' }];
    });
  });

  it('rejects statistics that are not the extractor counts', () => {
    rejects('a fractional token count', (r) => { (r.statistics as Record<string, unknown>).tokens = 1.5; });
    rejects('a missing lifecycle block', (r) => { delete (r.statistics as Record<string, unknown>).lifecycle; });
    rejects('an unknown statistic', (r) => { (r.statistics as Record<string, unknown>).luck = 7; });
  });

});

// `OK_ARTIFACT` (and every VALID_CASES entry above) has `diagnostics: []`
// and no styles, so a `diagnostic`, `statistics`, or `envelope` def that
// rejected every diagnostic, or that only happened to work for an empty
// `styles.typography`/`styles.effects`, would still ship green through every
// fixture-based test in this file. These three variants of one real
// synthetic golden -- built through the actual production extractor
// (`buildFoundationArtifactV5`), not a hand-mutated fixture -- are what
// exercises those defs against non-empty diagnostics and both style kinds.
const REAL_FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/v5/synthetic-foundation-serialized.json', import.meta.url),
);
const REAL_META: FoundationExportV5Meta = {
  exportId: 'synthetic-direct-v5-acceptance',
  generatedAt: '2026-08-28T00:00:00.000Z',
  build: null,
};

function realArtifact(scope?: FoundationExportV5Meta['scope']) {
  const serialized = JSON.parse(readFileSync(REAL_FIXTURE_PATH, 'utf8')) as SerializedFoundation;
  const meta: FoundationExportV5Meta = scope ? { ...REAL_META, scope } : REAL_META;
  return buildFoundationArtifactV5(buildFoundation(serialized), meta).artifact;
}

/** A real artifact reaches a consumer as JSON, never as the live JS object
 *  `buildFoundationArtifactV5` returns, so it is round-tripped before
 *  validation here too -- the same transform every consumer's `JSON.parse`
 *  already applies. */
const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('validates real synthetic foundation artifacts', () => {
  it('accepts the whole-file real artifact, which is not a vacuous check', () => {
    const artifact = realArtifact();
    // If any of these read zero, the schema check below would pass for the
    // wrong reason: the empty-diagnostics, no-styles case OK_ARTIFACT already
    // covers, not the non-empty case this test exists to cover.
    expect(artifact.diagnostics.length).toBeGreaterThan(0);
    expect(artifact.styles.typography.length).toBeGreaterThan(0);
    expect(artifact.styles.effects.length).toBeGreaterThan(0);
    expect(compiled(roundTrip(artifact)), ajv.errorsText(compiled.errors)).toBe(true);
  });

  it('accepts a styles-only real artifact, scoped to effect styles', () => {
    const artifact = realArtifact({ target: 'effectStyles' });
    expect(artifact.styles.effects.length).toBeGreaterThan(0);
    expect(artifact.diagnostics.length).toBeGreaterThan(0);
    expect(compiled(roundTrip(artifact)), ajv.errorsText(compiled.errors)).toBe(true);
  });

  it('accepts a real artifact scoped to typography styles', () => {
    const artifact = realArtifact({ target: 'textStyles' });
    expect(artifact.styles.typography.length).toBeGreaterThan(0);
    expect(artifact.diagnostics.length).toBeGreaterThan(0);
    expect(compiled(roundTrip(artifact)), ajv.errorsText(compiled.errors)).toBe(true);
  });
});
