/** Reviewed Component Context v5 AI-profile golden generator.
 *
 * Regenerate deliberately with:
 *
 *   npx tsx packages/extractor/test/fixtures/componentV5.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildComponentArtifactV5, buildEnvelope, buildFoundation, buildFoundationArtifactV5,
  componentAiContext, extract, toYaml,
} from '../../src/index';
import type {
  ArtifactSource, CollectionV5, EffectStyleV5, FoundationArtifactV5, IntermediateSpec,
  SemanticPayload, SerializedFoundation, SerializedNode, StyleProperty, TokenRule, TokenV5,
  TypographyStyleV5, Unit, YamlValue,
} from '../../src/index';
import type { ComponentArtifactV5 } from '../../src/index';
import button from './button.json';

export const COMPONENT_V5_GOLDEN_PATH = fileURLToPath(
  new URL('./v5/button-component-ai-v5.yaml', import.meta.url),
);

const GENERATED_AT = '2026-08-29T00:00:00.000Z';

const rgba = (hex: string): { r: number; g: number; b: number; a: number } => {
  const value = Number.parseInt(hex.slice(1), 16);
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255,
    a: 1,
  };
};

const foundationDump: SerializedFoundation = {
  fileKey: 'FILE1', fileName: 'Design System', extractedAt: GENERATED_AT,
  collections: [{
    id: 'VariableCollectionId:1', name: 'Material tokens',
    modes: [{ modeId: 'm1', name: 'Default' }], defaultModeId: 'm1',
    variables: [
      {
        id: 'VariableID:1', name: 'md.sys.color.primary', resolvedType: 'COLOR',
        description: '', codeSyntax: { WEB: '--md-sys-color-primary' },
        scopes: ['FRAME_FILL', 'SHAPE_FILL'], valuesByMode: { m1: rgba('#6750a4') },
      },
      {
        id: 'VariableID:2', name: 'md.sys.shape.corner.full', resolvedType: 'FLOAT',
        description: '', codeSyntax: { WEB: '--md-sys-shape-corner-full' },
        scopes: ['CORNER_RADIUS'], valuesByMode: { m1: 999 },
      },
      {
        id: 'VariableID:3', name: 'md.sys.color.on-primary', resolvedType: 'COLOR',
        description: '', codeSyntax: { WEB: '--md-sys-color-on-primary' },
        scopes: ['FRAME_FILL', 'SHAPE_FILL'], valuesByMode: { m1: rgba('#ffffff') },
      },
      {
        id: 'VariableID:4', name: 'md.sys.color.outline', resolvedType: 'COLOR',
        description: '', codeSyntax: { WEB: '--md-sys-color-outline' },
        scopes: ['STROKE_COLOR'], valuesByMode: { m1: rgba('#79747e') },
      },
      {
        id: 'VariableID:5', name: 'md.sys.color.primary-hover', resolvedType: 'COLOR',
        description: '', codeSyntax: { WEB: '--md-sys-color-primary-hover' },
        scopes: ['FRAME_FILL', 'SHAPE_FILL'], valuesByMode: { m1: rgba('#5b438f') },
      },
      {
        id: 'VariableID:unrelated', name: 'unrelated/token', resolvedType: 'FLOAT',
        description: '', codeSyntax: {}, scopes: ['GAP'], valuesByMode: { m1: 24 },
      },
    ],
  }],
  textStyles: [], effectStyles: [], externals: [],
};

export function buildComponentV5GoldenArtifact(): ComponentArtifactV5 {
  const spec = extract(button as SerializedNode, {
    figmaFile: 'FILE1', figmaFileName: 'Design System',
  });
  const foundationSpec = buildFoundation(foundationDump);
  const foundation = buildFoundationArtifactV5(foundationSpec, {
    exportId: 'foundation:golden', generatedAt: GENERATED_AT, build: 'test',
  }).artifact;
  return buildComponentArtifactV5(spec, {
    exportId: 'component:golden', generatedAt: GENERATED_AT, build: 'test',
    foundation,
  });
}

const STYLED_SOURCE: ArtifactSource = {
  provider: 'figma', file_id: 'FILE1', file_name: 'Design System',
  file_version: null, library_enabled: null,
};

const literalDimension = (number: number, unit: Unit): StyleProperty => ({
  source: { kind: 'literal' }, resolved: { type: 'dimension', number, unit },
});

/** A second, standalone Foundation carrying one typography style and one
 *  effect style. Kept separate from `foundationDump` above: that dump backs
 *  `button-component-ai-v5.yaml`, and adding style entries to it would move
 *  `foundation_hash` in that byte-identical fixture.
 *
 *  The typography style deliberately exercises all four shapes
 *  `compactStyleProperty` (`aiContext.ts:306`) can produce for a property, so
 *  the Markdown renderer's handling of each is proven against real projection
 *  output rather than a hand-built `AiValue`:
 *   - `font_family`, `font_weight`, `line_height`: literal, resolved
 *   - `font_size`: alias, resolved -- aliases `typeScaleBody` below
 *   - `letter_spacing`: literal, unresolved (`resolved: null`)
 *   - `paragraph_indent`: alias, unresolved (`target_id: null`, `resolved: null`)
 */
function buildStyledFoundation(): FoundationArtifactV5 {
  const typeScale: CollectionV5 = {
    id: 'CollectionID:type-scale', name: 'Type scale', path: ['Type scale'],
    default_mode_id: 'CollectionID:type-scale:mode',
    modes: [{ id: 'CollectionID:type-scale:mode', name: 'Default', order: 0 }],
  };
  const typeScaleBody: TokenV5 = {
    id: 'VariableID:type-scale-body', collection_id: typeScale.id,
    name: 'type.scale.body', path: ['type', 'scale', 'body'], type: 'dimension',
    description: '', scopes: [],
    values: {
      [typeScale.default_mode_id]: {
        kind: 'literal', value: { type: 'dimension', number: 16, unit: 'px' },
      },
    },
  };
  const typography: TypographyStyleV5 = {
    id: 'StyleID:text', name: 'Body/Regular', path: ['Body', 'Regular'], description: '',
    properties: {
      font_family: { source: { kind: 'literal' }, resolved: { type: 'font_family', value: 'Inter' } },
      font_weight: { source: { kind: 'literal' }, resolved: { type: 'number', value: 400 } },
      font_size: {
        source: { kind: 'alias', target_id: typeScaleBody.id, target_path: typeScaleBody.path },
        resolved: { type: 'dimension', number: 16, unit: 'px' },
      },
      line_height: literalDimension(24, 'px'),
      letter_spacing: { source: { kind: 'literal' }, resolved: null },
      paragraph_spacing: literalDimension(0, 'px'),
      paragraph_indent: {
        source: { kind: 'alias', target_id: null, target_path: ['missing', 'token'] },
        resolved: null,
      },
      text_case: 'original', text_decoration: 'none',
    },
  };
  const effect: EffectStyleV5 = {
    id: 'StyleID:effect', name: 'Elevation/Card', path: ['Elevation', 'Card'], mode_id: null,
    effects: [{
      type: 'drop_shadow', visible: true,
      offset_x: { type: 'dimension', number: 0, unit: 'px' },
      offset_y: { type: 'dimension', number: 2, unit: 'px' },
      blur: { type: 'dimension', number: 8, unit: 'px' },
      color: { type: 'color', color_space: 'srgb', hex: '#000000', alpha: 0.2 },
    }],
  };
  const payload: SemanticPayload = {
    completeness: { collections: 'complete', styles: 'complete', unavailable_sources: [] },
    collections: [typeScale], tokens: [typeScaleBody],
    styles: { typography: [typography], effects: [effect] },
  };
  return {
    ...payload,
    spec_layer: buildEnvelope(payload, {
      exportId: 'foundation:styled', generatedAt: GENERATED_AT, build: 'test', source: STYLED_SOURCE,
    }),
    diagnostics: [], statistics: {},
  };
}

/** The golden Button spec, with two extra rules binding a text style and an
 *  effect style Figma never actually attaches to this button -- purely so the
 *  Markdown "Tokens used" typography and effect subsections have something to
 *  render in a test, without touching the golden artifact or its hash. */
export function buildComponentV5StyledArtifact(): ComponentArtifactV5 {
  const spec = extract(button as SerializedNode, {
    figmaFile: 'FILE1', figmaFileName: 'Design System',
  });
  const extraRules: TokenRule[] = [
    {
      id: 'StyleID:text', name: 'Body/Regular', kind: 'text-style', remote: false,
      part: 'label', path: 'Container/label', property: 'typography', conditions: {},
    },
    {
      id: 'StyleID:effect', name: 'Elevation/Card', kind: 'effect-style', remote: false,
      part: 'container', path: 'Container/container', property: 'effects', conditions: {},
    },
  ];
  const styledSpec: IntermediateSpec = { ...spec, tokens: [...spec.tokens, ...extraRules] };
  return buildComponentArtifactV5(styledSpec, {
    exportId: 'component:styled', generatedAt: GENERATED_AT, build: 'test',
    foundation: buildStyledFoundation(),
  });
}

export function renderComponentV5Golden(): string {
  return toYaml(componentAiContext(buildComponentV5GoldenArtifact()) as unknown as YamlValue);
}

export function writeComponentV5Golden(): void {
  writeFileSync(COMPONENT_V5_GOLDEN_PATH, renderComponentV5Golden());
}

if (process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeComponentV5Golden();
}
