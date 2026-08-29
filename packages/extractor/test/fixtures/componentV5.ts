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
  buildComponentArtifactV5, buildFoundation, buildFoundationArtifactV5,
  componentAiContext, extract, toYaml,
} from '../../src/index';
import type { SerializedFoundation, SerializedNode, YamlValue } from '../../src/index';
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
