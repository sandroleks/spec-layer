import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { validateLevel1 } from '../../src/v5/validate';
import { SCHEMA_URI } from '../../src/v5/canonical';
import { VALID_CASES, INVALID_CASES } from './fixtures';

const schema = JSON.parse(
  readFileSync('packages/extractor/src/v5/schema/foundation-5.0.0.json', 'utf8'),
) as Record<string, unknown>;

const ajv = addFormats(new Ajv2020({ allErrors: true, strict: true }));
const compiled = ajv.compile(schema);

describe('schema parity', () => {
  it('is itself a valid 2020-12 schema', () => {
    // strict: true above makes ajv reject an unknown keyword or a malformed
    // $ref at compile time, which is what "validate the schema itself" means
    // in practice.
    expect(() => ajv.compile(schema)).not.toThrow();
    expect(schema.$id).toBe(SCHEMA_URI);
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
