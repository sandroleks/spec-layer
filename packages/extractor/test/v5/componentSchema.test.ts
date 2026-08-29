import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { COMPONENT_SCHEMA_URI } from '../../src/v5/componentContext';
import { buildComponentV5GoldenArtifact } from '../fixtures/componentV5';

const componentSchemaText = readFileSync(
  'packages/extractor/src/v5/schema/component-5.0.0.json', 'utf8',
);
const componentSchema = JSON.parse(componentSchemaText) as Record<string, unknown>;
const foundationSchema = JSON.parse(readFileSync(
  'packages/extractor/src/v5/schema/foundation-5.0.0.json', 'utf8',
)) as Record<string, unknown>;

const ajv = addFormats(new Ajv2020({ allErrors: true, strict: true, inlineRefs: false }));
ajv.addSchema(foundationSchema);
const validate = ajv.compile(componentSchema);

describe('Component Context v5 schema', () => {
  it('is a valid 2020-12 schema and accepts the canonical golden artifact', () => {
    expect(componentSchema.$id).toBe(COMPONENT_SCHEMA_URI);
    expect(
      validate(buildComponentV5GoldenArtifact()),
      ajv.errorsText(validate.errors),
    ).toBe(true);
  });

  it('keeps the landing copy byte-identical', () => {
    expect(readFileSync('apps/landing/schemas/component-context/v5.json', 'utf8'))
      .toBe(componentSchemaText);
  });

  it('rejects a resolved binding whose source identity is absent', () => {
    const artifact = structuredClone(buildComponentV5GoldenArtifact());
    artifact.references.used[0].source_id = '';
    expect(validate(artifact)).toBe(false);
  });
});
