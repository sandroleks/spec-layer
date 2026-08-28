import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import {
  buildFoundation, buildFoundationArtifactV5, normalizeV4, toYaml,
  validateLevel1, validateLevel2,
  type CanonicalValue, type SerializedFoundation, type V4Foundation, type YamlValue,
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

const DIRECT_INPUT_PATH = fileURLToPath(
  new URL('../fixtures/v5/synthetic-foundation-serialized.json', import.meta.url),
);
const DIRECT_GOLDEN_PATH = fileURLToPath(
  new URL('../fixtures/v5/synthetic-foundation-direct-v5.yaml', import.meta.url),
);
const DIRECT_META = {
  exportId: 'synthetic-direct-v5-acceptance',
  generatedAt: '2026-08-28T00:00:00.000Z',
  build: null,
};

function normalizeFixture() {
  const v4 = load(readFileSync(INPUT_PATH, 'utf8')) as V4Foundation;
  return normalizeV4(v4, META);
}

function directFixture() {
  const serialized = JSON.parse(
    readFileSync(DIRECT_INPUT_PATH, 'utf8'),
  ) as SerializedFoundation;
  return buildFoundationArtifactV5(buildFoundation(serialized), DIRECT_META);
}

function valueNamed(name: string, values: ReturnType<typeof normalizeFixture>['artifact']['tokens']): CanonicalValue[] {
  const token = values.find((candidate) => candidate.name === name);
  if (!token) throw new Error(`Synthetic acceptance fixture has no token named ${name}`);
  return Object.values(token.values);
}

describe('Foundation Context v5 phase coverage', () => {
  it('separates implemented engine coverage from real-source grading', () => {
    expect(ACCEPTANCE_COVERAGE[1]).toMatchObject({
      implementedBy: 'plan-2', gradedBy: 'manual-real-v5-review',
    });
    expect(ACCEPTANCE_COVERAGE[2]).toMatchObject({
      implementedBy: 'plan-2', gradedBy: 'manual-real-v5-review',
    });
    expect(ACCEPTANCE_COVERAGE[4]).toMatchObject({
      implementedBy: 'plan-2', gradedBy: 'manual-real-v5-review',
    });
    expect(ACCEPTANCE_COVERAGE[5]).toMatchObject({
      implementedBy: 'plan-2', gradedBy: 'manual-real-v5-review',
    });
    expect(ACCEPTANCE_COVERAGE['7b']).toMatchObject({
      implementedBy: 'plan-2', gradedBy: 'manual-real-v5-review',
    });
    expect(ACCEPTANCE_COVERAGE[3]).toMatchObject({
      implementedBy: 'plan-3', gradedBy: 'plan-3',
    });
  });

  it.todo('1: all six Company DS collections have stable source ids — manual v5 pass; fixture not committed');
  it.todo('2: every Company DS mode has a stable source id — manual v5 pass; fixture not committed');
  it.todo('3: every token and style has a stable source id — plan 3');
  it.todo('4: Company DS aliases have complete extracted chains — manual v5 pass; fixture not committed');
  it.todo('5: three deprecated refs match real source metadata — manual v5 pass; fixture not committed');
  it.todo('7b: Company DS dimensions receive units — manual v5 pass; fixture not committed');
  it.todo('9: archived text styles get lifecycle plus INFERRED_LIFECYCLE — plan 3');
  it.todo('10: identical typography mode values are preserved — plan 3');
  it.todo('11: card shadow representations and binding drift are preserved — plan 3');
});

describe('Foundation Context v5 direct synthetic golden acceptance', () => {
  it('preserves raw identity, mode keys, units, precision, and full chain policy', () => {
    const { artifact } = directFixture();
    const token = (id: string) => {
      const found = artifact.tokens.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`Direct acceptance fixture has no token ${id}.`);
      return found;
    };

    expect(validateLevel1(artifact)).toEqual([]);
    expect(artifact.collections.map((collection) => collection.id)).toEqual([
      'CollectionID:primitives', 'CollectionID:semantic',
    ]);
    expect(artifact.collections.flatMap((collection) => collection.modes)
      .every((mode) => mode.id.startsWith('ModeID:'))).toBe(true);
    const primitiveLightModes = artifact.collections[0].modes
      .filter((mode) => mode.name === 'Light');
    expect(primitiveLightModes.map((mode) => mode.id)).toEqual([
      'ModeID:p-light', 'ModeID:p-light-duplicate',
    ]);
    expect(artifact.tokens.every((candidate) => !candidate.id.startsWith('figma-name:')))
      .toBe(true);
    expect(Object.keys(token('VariableID:chain-owner').values))
      .toEqual(['ModeID:s-light', 'ModeID:s-dark']);

    expect(token('VariableID:gap')).toMatchObject({ type: 'dimension' });
    expect(token('VariableID:gap').values['ModeID:p-dark']).toEqual({
      kind: 'literal', value: { type: 'dimension', number: 12, unit: 'px' },
    });
    expect(token('VariableID:font-weight')).toMatchObject({ type: 'number' });
    expect(token('VariableID:font-family')).toMatchObject({ type: 'font_family' });
    expect(token('VariableID:unknown-number')).toMatchObject({ type: 'number' });
    expect(artifact.diagnostics.some((finding) =>
      finding.code === 'UNIT_METADATA_UNAVAILABLE'
      && finding.entity_id === 'VariableID:unknown-number')).toBe(true);

    const exact = token('VariableID:color-exact').values['ModeID:p-light'];
    const lossy = token('VariableID:color-lossy').values['ModeID:p-light'];
    expect(exact).toMatchObject({ kind: 'literal', value: { hex: '#ff0000' } });
    if (exact.kind !== 'literal' || exact.value.type !== 'color') {
      throw new Error('Exact fixture color must be a literal.');
    }
    expect('channels' in exact.value).toBe(false);
    expect(lossy).toMatchObject({
      kind: 'literal',
      value: { channels: [0.5001, 0.1001, 0.0001], alpha: 0.125 },
    });

    expect(token('VariableID:chain-owner').values['ModeID:s-dark']).toMatchObject({
      reference: { target_id: 'VariableID:chain-bridge' },
      resolved: {
        status: 'resolved',
        chain: [
          { token_id: 'VariableID:chain-bridge', mode_id: 'ModeID:p-dark' },
          { token_id: 'VariableID:chain-middle', mode_id: 'ModeID:p-dark' },
          { token_id: 'VariableID:chain-terminal', mode_id: 'ModeID:p-dark' },
        ],
      },
    });
    expect(token('VariableID:declared-missing').values['ModeID:s-dark'])
      .toEqual({ kind: 'missing', reason: 'no_value_for_mode' });
    expect(artifact.diagnostics).toContainEqual(expect.objectContaining({
      code: 'CONFUSABLE_NAME', entity_id: 'VariableID:confusable',
    }));
  });

  it('keeps external identities external and states incomplete sources/styles', () => {
    const { artifact } = directFixture();
    const readable = artifact.tokens.find((token) =>
      token.id === 'VariableID:external-owner-readable')!.values['ModeID:s-dark'];
    const unreadable = artifact.tokens.find((token) =>
      token.id === 'VariableID:external-owner-unreadable')!.values['ModeID:s-dark'];
    expect(readable).toMatchObject({
      reference: {
        target_id: 'VariableID:external-readable',
        target_path: ['color', 'shared'], external: true,
        source_library_name: 'Deprecated Core',
      },
      resolved: { status: 'unresolved', chain: [] },
    });
    expect(unreadable).toMatchObject({
      reference: {
        target_id: 'VariableID:external-unreadable', target_path: [], external: true,
      },
    });
    expect(artifact.tokens.some((token) => token.id === 'VariableID:local-collision'))
      .toBe(true);
    expect(artifact.completeness).toEqual({
      collections: 'partial', styles: 'partial',
      unavailable_sources: [
        'Deprecated Core', 'VariableID:external-unreadable', 'permission:styles-metadata',
      ],
    });
    expect(artifact.diagnostics).toContainEqual(expect.objectContaining({
      code: 'SOURCE_PARTIALLY_UNAVAILABLE',
      details: { typography_not_migrated: 1, effects_not_migrated: 1 },
    }));
  });

  it('produces stable diagnostics/hash and matches the reviewed direct golden', () => {
    const first = directFixture();
    const second = directFixture();
    expect(first.artifact.spec_layer.export.content_hash)
      .toBe(second.artifact.spec_layer.export.content_hash);

    const level2 = (artifact: typeof first.artifact) => validateLevel2(artifact)
      .map(({ code, entity_id, mode_id, details }) => ({
        code, entity_id, mode_id: mode_id ?? null, details: details ?? null,
      }));
    expect(level2(first.artifact)).toEqual(level2(second.artifact));
    expect(level2(first.artifact).map((finding) => finding.code))
      .toEqual(expect.arrayContaining([
        'ALIAS_CYCLE', 'UNRESOLVED_ALIAS', 'UNRESOLVED_EXTERNAL_ALIAS',
      ]));

    const yaml = `${toYaml(first.artifact as unknown as YamlValue).trimEnd()}\n`;
    if (process.env.UPDATE_V5_DIRECT_GOLDEN === '1') {
      writeFileSync(DIRECT_GOLDEN_PATH, yaml);
    }
    expect(yaml).toBe(readFileSync(DIRECT_GOLDEN_PATH, 'utf8'));
  });
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
