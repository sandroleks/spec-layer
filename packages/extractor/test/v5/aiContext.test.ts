import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { toYaml, type YamlValue } from '../../src/yaml';
import {
  canonicalJson, foundationAiContext, type FoundationArtifactV5, type StyleProperty,
} from '../../src/v5';

const FIXTURE_PATH = fileURLToPath(new URL(
  '../fixtures/v5/synthetic-foundation-direct-v5.yaml', import.meta.url,
));

function fixture(): FoundationArtifactV5 {
  return load(readFileSync(FIXTURE_PATH, 'utf8')) as FoundationArtifactV5;
}

describe('foundationAiContext', () => {
  it('keeps implementation facts while replacing audit repetition with readable labels', () => {
    const full = fixture();
    const context = foundationAiContext(full);

    expect(context.spec_layer).toEqual({
      kind: 'foundation', version: 5, profile: 'ai',
      content_hash: full.spec_layer.export.content_hash,
      source: { provider: 'figma', file_name: 'Synthetic Direct Foundation' },
    });
    expect(context.completeness).toEqual(full.completeness);
    expect(context.collections.map(({ name }) => name)).toEqual(['Primitives', 'Semantic']);

    const primitives = context.collections[0];
    expect(primitives.modes).toEqual([
      'Light [ModeID:p-light]', 'Dark', 'Light [ModeID:p-light-duplicate]',
    ]);
    expect(primitives.default_mode).toBe('Light [ModeID:p-light]');

    const token = (name: string) => {
      const found = context.collections.flatMap((collection) => collection.tokens)
        .find((candidate) => candidate.name === name);
      if (!found) throw new Error(`Compact context is missing ${name}.`);
      return found;
    };
    expect(token('spacing/gap')).toEqual({
      name: 'spacing/gap', type: 'dimension', scopes: ['GAP'],
      code_syntax: { WEB: '--spacing-gap' },
      values: {
        'Light [ModeID:p-light]': { number: 8, unit: 'px' },
        Dark: { number: 12, unit: 'px' },
        'Light [ModeID:p-light-duplicate]': { number: 8, unit: 'px' },
      },
    });
    expect(token('color/exact/red').values.Dark).toBe('#ff0000');
    expect(token('color/lossy/teal').values.Dark).toEqual({
      hex: '#4080bf', alpha: 0.875, channels: [0.2501, 0.5001, 0.7501],
    });
    expect(token('color/chain/middle').values.Dark).toEqual({
      alias: 'Primitives/color/chain/terminal @ Dark', resolved: '#000000',
    });
    expect(token('color/surface/primary').values.Dark).toMatchObject({
      alias: 'Primitives/color/chain/bridge @ Dark',
      resolved: '#000000',
      chain: [
        'Primitives/color/chain/bridge @ Dark',
        'Primitives/color/chain/middle @ Dark',
        'Primitives/color/chain/terminal @ Dark',
      ],
    });
    expect(token('color/legacy/readable').values.Dark).toEqual({
      alias: 'Deprecated Core/color/shared',
      unresolved: 'source_library_unavailable',
    });
    expect(token('string/declared-missing').values.Dark)
      .toEqual({ missing: 'no_value_for_mode' });
  });

  it('summarizes derived diagnostics without copying their repeated prose', () => {
    const full = fixture();
    const context = foundationAiContext(full);
    expect(context.issue_counts).toEqual({
      error: {
        ALIAS_CYCLE: 1,
        MISSING_MODE_VALUE: 2,
        UNRESOLVED_ALIAS: 2,
        UNRESOLVED_EXTERNAL_ALIAS: 4,
      },
      warning: { CONFUSABLE_NAME: 1, STYLE_BINDING_DRIFT: 1, UNIT_METADATA_UNAVAILABLE: 1 },
      info: { METADATA_UNAVAILABLE: 1 },
    });
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('Alias resolution cycles back to itself');
    expect(serialized).not.toContain('diagnostics');
    expect(serialized).not.toContain('statistics');
  });

  it('keeps source ids only when a human-readable name is ambiguous', () => {
    const full = fixture();
    const first = full.tokens[0];
    const duplicate = { ...structuredClone(first), id: 'VariableID:duplicate-name' };
    full.tokens.splice(1, 0, duplicate);

    const context = foundationAiContext(full);
    const colliding = context.collections[0].tokens
      .filter(({ name }) => name === first.name);
    expect(colliding.map(({ source_id }) => source_id)).toEqual([
      first.id, 'VariableID:duplicate-name',
    ]);
    expect(context.collections[0].tokens.find(({ name }) => name === 'spacing/gap'))
      .not.toHaveProperty('source_id');
  });

  it('keeps projected labels unique when a source name imitates the id suffix', () => {
    const full = fixture();
    full.collections[0].modes[1].name = 'Light [ModeID:p-light]';
    const context = foundationAiContext(full);
    const { modes, tokens } = context.collections[0];
    expect(new Set(modes).size).toBe(modes.length);
    expect(modes).toEqual([
      '[ModeID:p-light] Light',
      '[ModeID:p-dark] Light [ModeID:p-light]',
      '[ModeID:p-light-duplicate] Light',
    ]);
    expect(tokens.every((token) => Object.keys(token.values).length === modes.length)).toBe(true);
  });

  it('compacts lifecycle, publication, typography, effects, and bindings for Phase 3', () => {
    const full = fixture();
    full.collections[0].publication = { published: true, hidden_from_publishing: false };
    full.collections[0].source = {
      remote: true, library_file_id: 'FILE:library', library_name: 'Core Library',
      modified_at: '2026-08-28T00:00:00.000Z',
    };
    full.tokens[0].lifecycle = {
      status: 'deprecated', replacement_id: 'VariableID:gap',
    };
    const property = (value: StyleProperty): StyleProperty => value;
    full.styles.typography = [{
      id: 'StyleID:heading', name: 'Heading/L', path: ['Heading', 'L'],
      description: 'Large heading.', lifecycle: {
        status: 'archived', replacement_id: 'StyleID:shadow',
      },
      properties: {
        font_family: property({ source: { kind: 'literal' }, resolved: {
          type: 'font_family', value: 'Inter',
        } }),
        font_weight: property({ source: {
          kind: 'alias', target_id: 'VariableID:font-weight',
          target_path: ['typography', 'weight', 'strong'],
        }, resolved: { type: 'number', value: 600 } }),
        font_size: property({ source: { kind: 'literal' }, resolved: {
          type: 'dimension', number: 32, unit: 'px',
        } }),
        line_height: property({ source: { kind: 'literal' }, resolved: {
          type: 'dimension', number: 40, unit: 'px',
        } }),
        letter_spacing: property({ source: { kind: 'literal' }, resolved: {
          type: 'dimension', number: 0, unit: 'px',
        } }),
        paragraph_spacing: property({ source: { kind: 'literal' }, resolved: {
          type: 'dimension', number: 16, unit: 'px',
        } }),
        paragraph_indent: property({ source: { kind: 'literal' }, resolved: null }),
        text_case: 'ORIGINAL', text_decoration: 'NONE',
      },
    }];
    full.styles.effects = [{
      id: 'StyleID:shadow', name: 'Elevation/Card', path: ['Elevation', 'Card'],
      mode_id: 'ModeID:p-dark',
      effects: [{
        type: 'drop_shadow', visible: true, blend_mode: 'NORMAL',
        color: { type: 'color', color_space: 'srgb', hex: '#000000', alpha: 0.2 },
        offset_x: { type: 'dimension', number: 0, unit: 'px' },
        offset_y: { type: 'dimension', number: 4, unit: 'px' },
        blur: { type: 'dimension', number: 12, unit: 'px' },
      }],
      bindings: [{ property: 'effects[0].blur', token_id: 'VariableID:gap' }],
    }];

    const context = foundationAiContext(full);
    expect(context.collections[0]).toMatchObject({
      publication: { published: true, hidden_from_publishing: false },
      source: { remote: true, library_name: 'Core Library' },
    });
    expect(context.collections[0].tokens[0].lifecycle).toEqual({
      status: 'deprecated', replacement: 'Primitives/spacing/gap',
    });
    const typography = context.styles.typography[0] as unknown as {
      lifecycle: { status: string; replacement: string };
      properties: Record<string, unknown>;
    };
    expect(typography.lifecycle).toEqual({
      status: 'archived', replacement: 'Effects/Elevation/Card',
    });
    expect(typography.properties.font_family).toEqual({ type: 'font_family', value: 'Inter' });
    expect(typography.properties.font_weight).toEqual({
      alias: 'Primitives/typography/weight/strong',
      resolved: { type: 'number', value: 600 },
    });
    expect(typography.properties.paragraph_indent).toEqual({ missing: 'source_unavailable' });
    const effect = context.styles.effects[0] as unknown as {
      mode: string; bindings: Record<string, string>;
      effects: Array<Record<string, unknown>>;
    };
    expect(effect.mode).toBe('Dark');
    expect(effect.bindings).toEqual({ 'effects[0].blur': 'Primitives/spacing/gap' });
    expect(effect.effects[0]).toMatchObject({
      color: { hex: '#000000', alpha: 0.2 },
      offset_y: { number: 4, unit: 'px' },
      blur: { number: 12, unit: 'px' },
    });
  });

  it('is deterministic, leaves the artifact untouched, and carries guidelines outside the hash', () => {
    const full = fixture();
    full.guidelines = {
      origin: 'generated',
      group_descriptions: { Primitives: { color: 'Base colour ramps.' } },
    };
    const before = canonicalJson(full);
    const first = foundationAiContext(full);
    const second = foundationAiContext(structuredClone(full));
    expect(canonicalJson(second)).toBe(canonicalJson(first));
    expect(canonicalJson(full)).toBe(before);
    expect(first.guidelines).toEqual({ Primitives: { color: 'Base colour ramps.' } });
    expect(first.spec_layer.content_hash).toBe(full.spec_layer.export.content_hash);
  });

  it('stays substantially smaller than the canonical artifact', () => {
    const full = fixture();
    const canonicalYaml = toYaml(full as unknown as YamlValue);
    const compactYaml = toYaml(foundationAiContext(full) as unknown as YamlValue);
    expect(Buffer.byteLength(compactYaml)).toBeLessThan(Buffer.byteLength(canonicalYaml) * 0.55);
    expect(compactYaml.split('\n').length).toBeLessThan(canonicalYaml.split('\n').length * 0.55);
  });
});
