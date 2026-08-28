import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import {
  normalizeV4, toYaml, validateLevel1, validateLevel2,
  type CanonicalValue, type V4Foundation, type YamlValue,
} from '../../src/index';
import { ACCEPTANCE_COVERAGE } from './phaseCoverage';

const INPUT_PATH = fileURLToPath(
  new URL('../fixtures/v5/synthetic-foundation-v4.yaml', import.meta.url),
);
const GOLDEN_PATH = fileURLToPath(
  new URL('../fixtures/v5/synthetic-foundation-v5.yaml', import.meta.url),
);
const META = {
  exportId: 'synthetic-v5-acceptance',
  generatedAt: '2026-08-28T00:00:00.000Z',
};

function normalizeFixture() {
  const v4 = load(readFileSync(INPUT_PATH, 'utf8')) as V4Foundation;
  return normalizeV4(v4, META);
}

function valueNamed(name: string, values: ReturnType<typeof normalizeFixture>['artifact']['tokens']): CanonicalValue[] {
  const token = values.find((candidate) => candidate.name === name);
  if (!token) throw new Error(`Synthetic acceptance fixture has no token named ${name}`);
  return Object.values(token.values);
}

describe('Foundation Context v5 phase coverage', () => {
  it('states which acceptance criteria Phase 1 does not grade', () => {
    const ungraded = Object.entries(ACCEPTANCE_COVERAGE)
      .filter(([, value]) => value.gradedBy !== 'plan-1')
      .map(([key]) => key);
    expect(new Set(ungraded)).toEqual(new Set(['1', '2', '3', '4', '5', '7b', '9', '10', '11']));
  });

  it.todo('1: all six collections have stable source ids — plan 2');
  it.todo('2: every declared mode has a stable source id — plan 2');
  it.todo('3: every token and style has a stable source id — plan 2');
  it.todo('4: internal aliases resolve with complete extracted chains — plan 2');
  it.todo('5: three deprecated external refs are graded against real source metadata — plan 2');
  it.todo('7b: dimensional floats receive explicit units from extracted scopes — plan 2');
  it.todo('9: archived text styles get lifecycle plus INFERRED_LIFECYCLE — plan 3');
  it.todo('10: identical typography mode values are preserved — plan 3');
  it.todo('11: card shadow representations and binding drift are preserved — plan 3');
});

describe('Foundation Context v5 synthetic golden acceptance', () => {
  it('grades criteria 6, 7a, 8 and 12 against a publishable fixture', () => {
    const first = normalizeFixture();
    const second = normalizeFixture();

    const opaque = valueNamed('color/teal/500', first.artifact.tokens);
    expect(opaque).toHaveLength(2);
    expect(opaque.every((value) => value.kind === 'literal' && value.value.type === 'color'))
      .toBe(true);
    expect(opaque[0]).toEqual(opaque[1]);

    const spacing = valueNamed('spacing/400', first.artifact.tokens)[0];
    expect(spacing).toEqual({ kind: 'literal', value: { type: 'number', value: 16 } });

    const confusable = first.artifact.tokens.find((token) => token.name.includes('Сhip'));
    expect(confusable?.name).toBe('Background/Chip/Сhip (Hover)');
    expect(first.diagnostics.some((diagnostic) =>
      diagnostic.code === 'CONFUSABLE_NAME' && diagnostic.entity_id === confusable?.id)).toBe(true);

    expect(first.artifact.spec_layer.export.content_hash)
      .toBe(second.artifact.spec_layer.export.content_hash);
  });

  it('matches the committed normalized artifact and validator diagnostics', () => {
    const { artifact } = normalizeFixture();
    expect(validateLevel1(artifact)).toEqual([]);

    const yaml = `${toYaml(artifact as unknown as YamlValue).trimEnd()}\n`;
    if (process.env.UPDATE_V5_GOLDEN === '1') writeFileSync(GOLDEN_PATH, yaml);
    expect(yaml).toBe(readFileSync(GOLDEN_PATH, 'utf8'));

    expect(validateLevel2(artifact).map(({ code, entity_id, mode_id }) => ({
      code, entity_id, ...(mode_id === undefined ? {} : { mode_id }),
    }))).toMatchInlineSnapshot(`
      [
        {
          "code": "UNRESOLVED_EXTERNAL_ALIAS",
          "entity_id": "figma-name:token:Semantic/color/legacy/one",
          "mode_id": "figma-name:collection:Semantic/Light",
        },
        {
          "code": "UNRESOLVED_EXTERNAL_ALIAS",
          "entity_id": "figma-name:token:Semantic/color/legacy/one",
          "mode_id": "figma-name:collection:Semantic/Dark",
        },
        {
          "code": "UNRESOLVED_EXTERNAL_ALIAS",
          "entity_id": "figma-name:token:Semantic/color/legacy/two",
          "mode_id": "figma-name:collection:Semantic/Light",
        },
        {
          "code": "UNRESOLVED_EXTERNAL_ALIAS",
          "entity_id": "figma-name:token:Semantic/color/legacy/two",
          "mode_id": "figma-name:collection:Semantic/Dark",
        },
        {
          "code": "UNRESOLVED_EXTERNAL_ALIAS",
          "entity_id": "figma-name:token:Semantic/color/legacy/three",
          "mode_id": "figma-name:collection:Semantic/Light",
        },
        {
          "code": "UNRESOLVED_EXTERNAL_ALIAS",
          "entity_id": "figma-name:token:Semantic/color/legacy/three",
          "mode_id": "figma-name:collection:Semantic/Dark",
        },
      ]
    `);
  });

  it('exports the v5 API from the package entry point', async () => {
    const packageRoot = await import('../../src/index');
    expect(packageRoot.normalizeV4).toBe(normalizeV4);
    expect(packageRoot.validateLevel1).toBe(validateLevel1);
    expect(packageRoot.validateLevel2).toBe(validateLevel2);
    expect(packageRoot.semanticContentHash).toBeTypeOf('function');
  });
});
