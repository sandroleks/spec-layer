import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { validateLevel1 } from '../../src/v5/validate';
import { SCHEMA_URI } from '../../src/v5/canonical';
import { compareCodeUnits } from '../../src/v5/diagnostics';
import {
  SUPPORTED_DURATION_UNITS, SUPPORTED_TOKEN_TYPES, SUPPORTED_UNITS,
} from '../../src/v5/value';
import { VALID_CASES, INVALID_CASES } from './fixtures';

const schema = JSON.parse(
  readFileSync('packages/extractor/src/v5/schema/foundation-5.0.0.json', 'utf8'),
) as Record<string, unknown>;

const ajv = addFormats(new Ajv2020({ allErrors: true, strict: true }));
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
