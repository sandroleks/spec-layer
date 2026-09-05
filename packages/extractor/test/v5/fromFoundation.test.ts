import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildFoundation, type RawCollection, type RawExternalRef, type RawVariable,
  type SerializedFoundation,
} from '../../src/foundation';
import { buildFoundationArtifactV5 } from '../../src/v5/fromFoundation';
import { canonicalJson } from '../../src/v5/canonical';
import { validateLevel1, validateLevel2 } from '../../src/v5/validate';

const DIRECT_INPUT_PATH = fileURLToPath(
  new URL('../fixtures/v5/synthetic-foundation-serialized.json', import.meta.url),
);
const DIRECT_META = {
  exportId: 'synthetic-direct-v5-acceptance',
  generatedAt: '2026-08-28T00:00:00.000Z',
  build: null,
};

function directFixture() {
  const serialized = JSON.parse(
    readFileSync(DIRECT_INPUT_PATH, 'utf8'),
  ) as SerializedFoundation;
  return buildFoundationArtifactV5(buildFoundation(serialized), DIRECT_META);
}

const META = {
  exportId: 'export-1', generatedAt: '2026-08-28T12:00:00.000Z',
  build: 'build-1',
};

function variable(
  id: string,
  name: string,
  resolvedType: RawVariable['resolvedType'],
  valuesByMode: RawVariable['valuesByMode'],
  scopes: string[] = [],
): RawVariable {
  return {
    id, name, resolvedType, description: '', codeSyntax: {}, valuesByMode, scopes,
  };
}

function collection(
  id: string,
  name: string,
  modes: { modeId: string; name: string }[],
  defaultModeId: string,
  variables: RawVariable[],
): RawCollection {
  return {
    id, name, modes, defaultModeId, variables,
    variableIds: variables.map((item) => item.id),
  };
}

function dump(
  collections: RawCollection[],
  options: {
    externals?: RawExternalRef[];
    unavailable?: SerializedFoundation['unavailable'];
    unavailableSources?: string[];
  } = {},
): SerializedFoundation {
  return {
    fileKey: 'FILE:1', fileName: 'Company DS', extractedAt: 'T',
    collections, textStyles: [], effectStyles: [],
    externals: options.externals ?? [],
    ...(options.unavailable ? { unavailable: options.unavailable } : {}),
    ...(options.unavailableSources
      ? { unavailableSources: options.unavailableSources }
      : {}),
  };
}

const artifactOf = (
  source: SerializedFoundation,
  meta: Parameters<typeof buildFoundationArtifactV5>[1] = META,
) => buildFoundationArtifactV5(buildFoundation(source), meta).artifact;

describe('buildFoundationArtifactV5 — identity, modes, and values', () => {
  it('preserves stable ids, source order, mode-id keys, scopes, and NFC names', () => {
    const source = dump([collection(
      'Collection:1', 'Cafe\u0301',
      [{ modeId: '7b', name: 'Va\u0301lue' }, { modeId: '9', name: 'Va\u0301lue' }],
      '7b',
      [variable('Variable:1', 'color//Cafe\u0301', 'COLOR', {
        '7b': { r: 0.5, g: 0.1, b: 0, a: 0.125 },
        '9': { r: 1, g: 0, b: 0, a: 1 },
      }, ['SHAPE_FILL', 'FRAME_FILL', 'SHAPE_FILL'])],
    )]);
    const artifact = artifactOf(source);
    expect(artifact.collections[0]).toMatchObject({
      id: 'Collection:1', name: 'Café', path: ['Café'], default_mode_id: '7b',
      modes: [
        { id: '7b', name: 'Válue', order: 0 },
        { id: '9', name: 'Válue', order: 1 },
      ],
    });
    expect(artifact.tokens[0]).toMatchObject({
      id: 'Variable:1', collection_id: 'Collection:1', name: 'color//Café',
      path: ['color', '', 'Café'], scopes: ['FRAME_FILL', 'SHAPE_FILL'],
    });
    // JavaScript enumerates integer-like object keys before other string keys;
    // mode source order is carried by collection.modes, while the value record
    // is addressed exclusively by stable mode id.
    expect(Object.keys(artifact.tokens[0].values).sort()).toEqual(['7b', '9']);
    expect(artifact.tokens[0].values['7b']).toEqual({
      kind: 'literal',
      value: {
        type: 'color', color_space: 'srgb', hex: '#801a00', alpha: 0.125,
        channels: [0.5, 0.1, 0],
      },
    });
    expect(validateLevel1(artifact)).toEqual([]);
  });

  it('keeps identity stable when a token is renamed or moved', () => {
    const before = dump([collection('c1', 'One', [{ modeId: 'm1', name: 'Value' }], 'm1', [
      variable('v1', 'old/path', 'STRING', { m1: 'x' }),
    ])]);
    const after = structuredClone(before);
    after.collections[0].variables[0].name = 'new/folder/path';
    const a = artifactOf(before).tokens[0];
    const b = artifactOf(after).tokens[0];
    expect(b.id).toBe(a.id);
    expect(b.path).toEqual(['new', 'folder', 'path']);
  });

  it('emits explicit missing records for every declared mode', () => {
    const artifact = artifactOf(dump([collection(
      'c1', 'One',
      [{ modeId: 'm1', name: 'Light' }, { modeId: 'm2', name: 'Dark' }],
      'm1', [variable('v1', 'value', 'STRING', { m1: 'x' })],
    )]));
    expect(artifact.tokens[0].values.m2)
      .toEqual({ kind: 'missing', reason: 'no_value_for_mode' });
    expect(artifact.diagnostics.some((finding) =>
      finding.code === 'MISSING_MODE_VALUE' && finding.mode_id === 'm2')).toBe(true);
  });

  it('reports and excludes stale raw mode ids, marking completeness and hash', () => {
    const clean = dump([collection('c1', 'One', [{ modeId: 'm1', name: 'Value' }], 'm1', [
      variable('v1', 'value', 'STRING', { m1: 'x' }),
    ])]);
    const stale = structuredClone(clean);
    stale.collections[0].variables[0].valuesByMode.deleted = 'old';
    const cleanArtifact = artifactOf(clean);
    const staleArtifact = artifactOf(stale);
    expect('deleted' in staleArtifact.tokens[0].values).toBe(false);
    expect(staleArtifact.completeness.collections).toBe('partial');
    expect(staleArtifact.diagnostics).toContainEqual(expect.objectContaining({
      code: 'UNRESOLVED_REFERENCE', entity_id: 'v1', mode_id: 'deleted',
    }));
    expect(staleArtifact.spec_layer.export.content_hash)
      .not.toBe(cleanArtifact.spec_layer.export.content_hash);
  });

  it('rejects invalid source colors rather than clamping them', () => {
    const artifact = artifactOf(dump([collection(
      'c1', 'Colors', [{ modeId: 'm1', name: 'Value' }], 'm1', [
        variable('bad', 'bad', 'COLOR', { m1: { r: 1.2, g: 0, b: 0, a: 1 } }),
      ],
    )]));
    expect(artifact.tokens[0].values.m1)
      .toEqual({ kind: 'missing', reason: 'invalid_source_value' });
    expect(artifact.diagnostics).toContainEqual(expect.objectContaining({
      code: 'INVALID_SOURCE_COLOR', entity_id: 'bad', mode_id: 'm1',
    }));
  });
});

describe('buildFoundationArtifactV5 — units and specializations', () => {
  const cases: [string[], string, string | undefined][] = [
    [['WIDTH_HEIGHT'], 'dimension', 'px'],
    [['CORNER_RADIUS'], 'dimension', 'px'],
    [['GAP'], 'dimension', 'px'],
    [['FONT_SIZE'], 'dimension', 'px'],
    [['STROKE_FLOAT'], 'dimension', 'px'],
    [['PARAGRAPH_SPACING'], 'dimension', 'px'],
    [['PARAGRAPH_INDENT'], 'dimension', 'px'],
    [['EFFECT_FLOAT'], 'dimension', 'px'],
    [['FONT_WEIGHT'], 'number', undefined],
    [['OPACITY'], 'number', undefined],
  ];

  it.each(cases)('maps scope %j to %s', (scopes, expectedType, expectedUnit) => {
    const artifact = artifactOf(dump([collection(
      'c1', 'Numbers', [{ modeId: 'm1', name: 'Value' }], 'm1', [
        variable('v1', 'number', 'FLOAT', { m1: 16 }, scopes),
      ],
    )]));
    expect(artifact.tokens[0].type).toBe(expectedType);
    const value = artifact.tokens[0].values.m1;
    expect(value.kind).toBe('literal');
    if (value.kind !== 'literal') throw new Error('expected literal');
    if (expectedUnit) expect(value.value).toMatchObject({ unit: expectedUnit });
  });

  it('keeps unknown and conflicting numeric scopes unitless with a warning', () => {
    for (const scopes of [[], ['GAP', 'FONT_WEIGHT'], ['ALL_SCOPES']]) {
      const artifact = artifactOf(dump([collection(
        'c1', 'Numbers', [{ modeId: 'm1', name: 'Value' }], 'm1', [
          variable('v1', 'number', 'FLOAT', { m1: 16 }, scopes),
        ],
      )]));
      expect(artifact.tokens[0].type).toBe('number');
      expect(artifact.tokens[0].values.m1).toEqual({
        kind: 'literal', value: { type: 'number', value: 16 },
      });
      expect(artifact.diagnostics.some((finding) =>
        finding.code === 'UNIT_METADATA_UNAVAILABLE' && finding.severity === 'warning')).toBe(true);
    }
  });

  it('uses font_family only when that is the unique string scope', () => {
    const artifact = artifactOf(dump([collection(
      'c1', 'Strings', [{ modeId: 'm1', name: 'Value' }], 'm1', [
        variable('font', 'font', 'STRING', { m1: 'Inter' }, ['FONT_FAMILY']),
        variable('mixed', 'mixed', 'STRING', { m1: 'Inter' }, ['FONT_FAMILY', 'TEXT_CONTENT']),
      ],
    )]));
    expect(artifact.tokens.map((token) => token.type)).toEqual(['font_family', 'string']);
  });
});

describe('buildFoundationArtifactV5 — alias graph and scope', () => {
  function aliasSource(): SerializedFoundation {
    const primitives = collection(
      'prim', 'Primitives',
      [{ modeId: 'p-light', name: 'Light' }, { modeId: 'p-dark', name: 'Dark' }],
      'p-light', [
        variable('terminal', 'color/terminal', 'COLOR', {
          'p-light': { r: 1, g: 1, b: 1, a: 1 },
          'p-dark': { r: 0, g: 0, b: 0, a: 1 },
        }),
        variable('middle', 'color/middle', 'COLOR', {
          'p-light': { type: 'VARIABLE_ALIAS', id: 'terminal' },
          'p-dark': { type: 'VARIABLE_ALIAS', id: 'terminal' },
        }),
      ],
    );
    const semantic = collection(
      'sem', 'Semantic',
      [{ modeId: 's-light', name: 'Light' }, { modeId: 's-dark', name: 'Dark' }],
      's-light', [variable('surface', 'color/surface', 'COLOR', {
        's-light': { type: 'VARIABLE_ALIAS', id: 'middle' },
        's-dark': { type: 'VARIABLE_ALIAS', id: 'middle' },
      })],
    );
    return dump([primitives, semantic]);
  }

  it('emits every target/mode pair and uses the same-named non-default mode', () => {
    const artifact = artifactOf(aliasSource());
    const surface = artifact.tokens.find((token) => token.id === 'surface')!;
    expect(surface.values['s-dark']).toMatchObject({
      kind: 'alias',
      reference: { target_id: 'middle', target_collection_id: 'prim' },
      resolved: {
        status: 'resolved',
        value: { type: 'color', hex: '#000000' },
        chain: [
          { token_id: 'middle', mode_id: 'p-dark' },
          { token_id: 'terminal', mode_id: 'p-dark' },
        ],
      },
    });
  });

  it('falls back to the valid target default when no mode name matches', () => {
    const source = aliasSource();
    source.collections[1].modes[0].name = 'Day';
    const artifact = artifactOf(source);
    const surface = artifact.tokens.find((token) => token.id === 'surface')!;
    expect(surface.values['s-light']).toMatchObject({
      resolved: { chain: [
        { token_id: 'middle', mode_id: 'p-light' },
        { token_id: 'terminal', mode_id: 'p-light' },
      ] },
    });
  });

  it('includes complete transitive dependency collections for a scoped copy', () => {
    const artifact = artifactOf(aliasSource(), {
      ...META, scope: { target: 'collection', collectionId: 'sem' },
    });
    expect(artifact.collections.map((item) => item.id)).toEqual(['prim', 'sem']);
    expect(artifact.tokens.map((token) => token.id)).toEqual(['terminal', 'middle', 'surface']);
    expect(artifact.completeness).toMatchObject({
      collections: 'partial', styles: 'unavailable',
    });
    expect(validateLevel1(artifact)).toEqual([]);
  });

  it('throws before construction when a scoped collection no longer exists', () => {
    expect(() => artifactOf(aliasSource(), {
      ...META, scope: { target: 'collection', collectionId: 'gone' },
    })).toThrow(/no longer in this file/);
  });

  it('retains readable and unreadable external identities without local path capture', () => {
    const local = variable('local', 'same/path', 'COLOR', { m1: { r: 1, g: 1, b: 1, a: 1 } });
    const readable = variable('readable-owner', 'readable', 'COLOR', {
      m1: { type: 'VARIABLE_ALIAS', id: 'remote-readable' },
    });
    const unreadable = variable('unreadable-owner', 'unreadable', 'COLOR', {
      m1: { type: 'VARIABLE_ALIAS', id: 'remote-unreadable' },
    });
    const artifact = artifactOf(dump([
      collection('c1', 'One', [{ modeId: 'm1', name: 'Value' }], 'm1', [local, readable, unreadable]),
    ], {
      externals: [{
        id: 'remote-readable', name: 'same/path', collectionId: 'remote-c1',
        collectionName: 'Core', remote: true, external: true,
      }, {
        id: 'remote-unreadable', name: null, collectionId: null,
        collectionName: null, remote: null, external: true,
      }],
    }));
    const readableValue = artifact.tokens.find((token) => token.id === 'readable-owner')!.values.m1;
    const unreadableValue = artifact.tokens.find((token) => token.id === 'unreadable-owner')!.values.m1;
    expect(readableValue).toMatchObject({
      reference: {
        target_id: 'remote-readable', target_path: ['same', 'path'],
        source_library_name: 'Core', external: true,
      },
    });
    expect(unreadableValue).toMatchObject({
      reference: { target_id: 'remote-unreadable', target_path: [], external: true },
    });
    expect(artifact.completeness.collections).toBe('partial');
    expect(artifact.completeness.unavailable_sources).toEqual(['Core', 'remote-unreadable']);
  });

  it('maps missing targets, missing target modes, type mismatches, cycles, and depth limits', () => {
    const owner = (targetId: string, ownerType: RawVariable['resolvedType'] = 'COLOR') =>
      collection('sem', 'Semantic', [{ modeId: 's1', name: 'Value' }], 's1', [
        variable('owner', 'owner', ownerType, {
          s1: { type: 'VARIABLE_ALIAS', id: targetId },
        }),
      ]);

    const dangling = artifactOf(dump([owner('gone')]));
    expect(dangling.tokens[0].values.s1).toMatchObject({
      kind: 'alias', resolved: { status: 'unresolved', reason: 'target_not_found' },
    });

    const targetWithoutValue = collection(
      'prim', 'Primitives', [{ modeId: 'p1', name: 'Value' }], 'p1', [
        variable('target', 'target', 'COLOR', {}),
      ],
    );
    const missingMode = artifactOf(dump([targetWithoutValue, owner('target')]));
    expect(missingMode.tokens.find((token) => token.id === 'owner')!.values.s1)
      .toMatchObject({
        resolved: { status: 'unresolved', reason: 'target_mode_value_missing' },
      });

    const numericTarget = collection(
      'prim', 'Primitives', [{ modeId: 'p1', name: 'Value' }], 'p1', [
        variable('target', 'target', 'FLOAT', { p1: 1 }),
      ],
    );
    const mismatch = artifactOf(dump([numericTarget, owner('target')]));
    expect(mismatch.tokens.find((token) => token.id === 'owner')!.values.s1)
      .toMatchObject({
        resolved: { status: 'unresolved', reason: 'type_mismatch' },
      });

    const cyclicSource = dump([collection(
      'cycle', 'Cycle', [{ modeId: 'm1', name: 'Value' }], 'm1', [
        variable('a', 'a', 'COLOR', { m1: { type: 'VARIABLE_ALIAS', id: 'b' } }),
        variable('b', 'b', 'COLOR', { m1: { type: 'VARIABLE_ALIAS', id: 'a' } }),
      ],
    )]);
    const cyclic = artifactOf(cyclicSource);
    expect(cyclic.tokens[0].values.m1).toMatchObject({
      resolved: { status: 'unresolved', reason: 'cycle' },
    });
    expect(cyclic.diagnostics.some((finding) => finding.code === 'ALIAS_CYCLE')).toBe(true);

    const deepSource = dump([collection(
      'deep', 'Deep', [{ modeId: 'm1', name: 'Value' }], 'm1', [
        variable('a', 'a', 'COLOR', { m1: { type: 'VARIABLE_ALIAS', id: 'b' } }),
        variable('b', 'b', 'COLOR', { m1: { type: 'VARIABLE_ALIAS', id: 'c' } }),
        variable('c', 'c', 'COLOR', { m1: { r: 1, g: 0, b: 0, a: 1 } }),
      ],
    )]);
    const depthLimited = buildFoundationArtifactV5(
      buildFoundation(deepSource, { maxAliasDepth: 1 }), META,
    ).artifact;
    expect(depthLimited.tokens[0].values.m1).toMatchObject({
      resolved: {
        status: 'unresolved', reason: 'depth_exceeded',
        chain: [{ token_id: 'b', mode_id: 'm1' }],
      },
    });
  });
});

describe('buildFoundationArtifactV5 — composite styles and publication', () => {
  function styledSource(): SerializedFoundation {
    const source = dump([collection(
      'c1', 'Foundation', [{ modeId: 'light', name: 'Light' }, { modeId: 'dark', name: 'Dark' }],
      'light', [
        variable('family', 'type/family', 'STRING', { light: 'Inter', dark: 'Inter' }, ['FONT_FAMILY']),
        variable('blur', 'effect/blur', 'FLOAT', { light: 8, dark: 12 }, ['EFFECT_FLOAT']),
      ],
    )]);
    source.collections[0].publication = {
      hiddenFromPublishing: false, publishStatus: 'CURRENT', remote: false,
    };
    source.collections[0].variables[0].publication = {
      hiddenFromPublishing: true, publishStatus: 'CHANGED', remote: false,
    };
    source.textStyles = [{
      id: 'style:text', name: 'Body/M', description: 'Body text.',
      fontFamily: 'Inter', fontStyle: 'Semi Bold', fontSize: 16,
      lineHeight: { unit: 'PERCENT', value: 150 },
      letterSpacing: { unit: 'PIXELS', value: -0.25 },
      paragraphSpacing: 8, paragraphIndent: 0,
      textCase: 'ORIGINAL', textDecoration: 'NONE',
      boundVariables: { fontFamily: 'type/family' },
      bindingIds: { fontFamily: 'family' },
      source: { remote: false, publishStatus: 'CURRENT' },
    }];
    source.effectStyles = [{
      id: 'style:effect', name: 'Elevation/Card', description: '',
      effects: [{
        type: 'drop-shadow', visible: true, blendMode: 'NORMAL',
        color: { hex: '#000000', alpha: 0.2 }, offset: { x: 0, y: 4 },
        radius: 8, spread: 0,
      }],
      bindings: [{ property: 'effects[0].blur', tokenId: 'blur' }],
      source: { remote: false, publishStatus: 'CURRENT' },
    }];
    return source;
  }

  it('projects composite properties and source publication facts', () => {
    const artifact = artifactOf(styledSource());
    expect(artifact.collections[0]).toMatchObject({
      publication: { published: true, hidden_from_publishing: false },
      source: { remote: false, library_file_id: null },
    });
    expect(artifact.tokens[0].publication).toEqual({
      published: true, hidden_from_publishing: true,
    });
    expect(artifact.styles.typography[0]).toMatchObject({
      id: 'style:text', path: ['Body', 'M'], source: { remote: false },
      properties: {
        font_family: {
          source: { kind: 'alias', target_id: 'family', target_path: ['type', 'family'] },
          resolved: { type: 'font_family', value: 'Inter' },
        },
        font_weight: { resolved: { type: 'number', value: 600 } },
        line_height: { resolved: { type: 'dimension', number: 150, unit: '%' } },
        letter_spacing: { resolved: { type: 'dimension', number: -0.25, unit: 'px' } },
      },
    });
    expect(artifact.styles.effects[0]).toMatchObject({
      id: 'style:effect', mode_id: null,
      effects: [{
        type: 'drop_shadow', visible: true, blend_mode: 'normal',
        blur: { type: 'dimension', number: 8, unit: 'px' },
      }],
      bindings: [{ property: 'effects[0].blur', token_id: 'blur' }],
    });
    // The bound blur differs by mode, and a style has no consuming mode. The
    // exporter must not pick one just to manufacture a drift result.
    expect(artifact.diagnostics.some((finding) =>
      finding.code === 'STYLE_BINDING_DRIFT')).toBe(false);
    expect(validateLevel1(artifact)).toEqual([]);
  });

  it('reports binding drift only when every mode gives one comparable value', () => {
    const source = styledSource();
    source.collections[0].variables[1].valuesByMode = { light: 12, dark: 12 };
    const artifact = artifactOf(source);
    expect(artifact.diagnostics).toContainEqual(expect.objectContaining({
      code: 'STYLE_BINDING_DRIFT', entity_id: 'style:effect',
      details: expect.objectContaining({ property: 'effects[0].blur', token_id: 'blur' }),
    }));
  });

  it('reports typography binding drift without choosing a mode', () => {
    const source = styledSource();
    source.collections[0].variables.push(variable(
      'weight', 'type/weight/500', 'FLOAT', { light: 500, dark: 500 }, ['FONT_WEIGHT'],
    ));
    source.textStyles[0].fontStyle = 'Regular';
    source.textStyles[0].bindingIds = {
      ...source.textStyles[0].bindingIds,
      fontWeight: 'weight',
    };

    const artifact = artifactOf(source);
    expect(artifact.diagnostics).toContainEqual(expect.objectContaining({
      code: 'STYLE_BINDING_DRIFT', entity_id: 'style:text',
      details: expect.objectContaining({
        property: 'font_weight', token_id: 'weight',
        style_value: { type: 'number', value: 400 },
        token_value: { type: 'number', value: 500 },
      }),
    }));
  });

  it('keeps supported effect order and diagnoses newer unsupported layers', () => {
    const source = styledSource();
    source.effectStyles[0].effects.unshift({
      type: 'noise', noiseType: 'monotone', visible: true, blendMode: 'NORMAL',
      color: { hex: '#ffffff', alpha: 1 }, noiseSize: 1, density: 0.5,
    });
    source.effectStyles[0].bindings = [
      { property: 'effects[1].blur', tokenId: 'blur' },
    ];
    const artifact = artifactOf(source);
    expect(artifact.styles.effects[0].effects.map((effect) => effect.type))
      .toEqual(['drop_shadow']);
    expect(artifact.styles.effects[0].bindings).toEqual([
      { property: 'effects[0].blur', token_id: 'blur' },
    ]);
    expect(artifact.diagnostics).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_VALUE_TYPE', entity_id: 'style:effect',
      details: { effect_index: 0, figma_type: 'noise' },
    }));
  });
});

describe('buildFoundationArtifactV5 — completeness, hashes, and validation', () => {
  it('distinguishes complete, partial, and unavailable source states honestly', () => {
    const empty = dump([]);
    expect(artifactOf(empty).completeness).toEqual({
      collections: 'complete', styles: 'complete', unavailable_sources: [],
    });
    expect(artifactOf(dump([], {
      unavailable: ['variables'], unavailableSources: ['figma:variables'],
    })).completeness).toEqual({
      collections: 'unavailable', styles: 'complete',
      unavailable_sources: ['figma:variables'],
    });

    const styles = dump([]);
    styles.textStyles = [{
      name: 'Body', description: '', fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
      lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PIXELS', value: 0 },
      paragraphSpacing: 0, paragraphIndent: 0, textCase: 'ORIGINAL',
      textDecoration: 'NONE', boundVariables: {},
    }];
    const missingIdentity = artifactOf(styles);
    expect(missingIdentity.completeness.styles).toBe('partial');
    expect(missingIdentity.styles.typography).toEqual([]);
    expect(missingIdentity.diagnostics).toContainEqual(expect.objectContaining({
      code: 'SOURCE_PARTIALLY_UNAVAILABLE',
      details: { kind: 'typography', name: 'Body' },
    }));
    styles.unavailable = ['textStyles', 'effectStyles'];
    expect(artifactOf(styles).completeness.styles).toBe('unavailable');
  });

  it('keeps volatile metadata outside the semantic hash and source facts inside it', () => {
    const source = dump([collection('c1', 'One', [{ modeId: 'm1', name: 'Value' }], 'm1', [
      variable('v1', 'value', 'STRING', { m1: 'x' }),
    ])]);
    const first = artifactOf(source, META);
    const second = artifactOf(source, {
      exportId: 'other', generatedAt: '2030-01-01T00:00:00.000Z',
      build: 'other-build', libraryEnabled: true,
    });
    expect(second.spec_layer.export.content_hash).toBe(first.spec_layer.export.content_hash);

    const changedScopes = structuredClone(source);
    changedScopes.collections[0].variables[0].scopes = ['TEXT_CONTENT'];
    expect(artifactOf(changedScopes).spec_layer.export.content_hash)
      .not.toBe(first.spec_layer.export.content_hash);
  });

  it('returns final statistics including Level-2 findings exactly once', () => {
    const source = dump([collection('c1', 'One', [{ modeId: 'm1', name: 'Value' }], 'm1', [
      variable('duplicate', 'one', 'STRING', { m1: 'a' }),
      variable('duplicate', 'two', 'STRING', { m1: 'b' }),
    ])]);
    const artifact = artifactOf(source);
    expect(validateLevel1(artifact)).toEqual([]);
    const level2 = validateLevel2(artifact);
    const level2Keys = new Set(level2.map((finding) => canonicalJson({
      code: finding.code, entity_id: finding.entity_id, mode_id: finding.mode_id,
      details: finding.details ?? null,
    })));
    const finalKeys = new Set(artifact.diagnostics.map((finding) => canonicalJson({
      code: finding.code, entity_id: finding.entity_id, mode_id: finding.mode_id,
      details: finding.details ?? null,
    })));
    for (const key of level2Keys) expect(finalKeys.has(key)).toBe(true);
    expect(artifact.diagnostics.filter((finding) =>
      finding.code === 'DUPLICATE_SOURCE_ID')).toHaveLength(1);
    const stats = artifact.statistics as { diagnostics: Record<string, number> };
    expect(Object.values(stats.diagnostics).reduce((sum, count) => sum + count, 0))
      .toBe(artifact.diagnostics.length);
  });

  it('carries code_syntax only for variables that state one', () => {
    const { artifact } = directFixture();
    const red = artifact.tokens.find((t) => t.id === 'VariableID:color-exact');
    const gap = artifact.tokens.find((t) => t.id === 'VariableID:gap');
    expect(red?.code_syntax).toEqual({ WEB: '--color-exact-red' });
    expect(gap?.code_syntax).toEqual({ WEB: '--spacing-gap' });
    // The fixture's second variable declares `"codeSyntax": {}`, which must not
    // surface as an empty object.
    const empty = artifact.tokens.filter((t) => !('code_syntax' in t));
    expect(empty.length).toBeGreaterThan(0);
  });

  it('reports a scope-less number once per token as a warning', () => {
    const { artifact } = directFixture();
    const entries = artifact.diagnostics.filter((d) => d.code === 'UNIT_METADATA_UNAVAILABLE');
    const ids = entries.map((d) => d.entity_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of entries) {
      expect(d.severity).toBe('warning');
      expect(d).not.toHaveProperty('mode_id');
    }
  });

  it('files metadata the Plugin API never exposes as info, not error', () => {
    const { artifact } = directFixture();
    const meta = artifact.diagnostics.filter((d) => d.code === 'METADATA_UNAVAILABLE');
    expect(meta.length).toBeGreaterThan(0);
    for (const d of meta) expect(d.severity).toBe('info');
    const partial = artifact.diagnostics.filter((d) => d.code === 'SOURCE_PARTIALLY_UNAVAILABLE');
    for (const d of partial) expect(d.severity).toBe('error');
  });
});
