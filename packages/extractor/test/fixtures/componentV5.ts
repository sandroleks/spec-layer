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
  componentAiContext, componentMarkdown, extract, toYaml,
} from '../../src/index';
import type {
  ArtifactSource, CollectionV5, EffectStyleV5, FoundationArtifactV5, IntermediateSpec,
  ProseDrafts, SemanticPayload, SerializedFoundation, SerializedNode, StyleProperty, TokenRule,
  TokenV5, TypographyStyleV5, Unit, YamlValue,
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

function buildGoldenFoundation(): FoundationArtifactV5 {
  const foundationSpec = buildFoundation(foundationDump);
  return buildFoundationArtifactV5(foundationSpec, {
    exportId: 'foundation:golden', generatedAt: GENERATED_AT, build: 'test',
  }).artifact;
}

export function buildComponentV5GoldenArtifact(): ComponentArtifactV5 {
  const spec = extract(button as SerializedNode, {
    figmaFile: 'FILE1', figmaFileName: 'Design System',
  });
  return buildComponentArtifactV5(spec, {
    exportId: 'component:golden', generatedAt: GENERATED_AT, build: 'test',
    foundation: buildGoldenFoundation(),
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
  // Two layers, one hidden: proves the Markdown renderer both marks a
  // `visible: false` layer as hidden and separates layers unambiguously.
  const effect: EffectStyleV5 = {
    id: 'StyleID:effect', name: 'Elevation/Card', path: ['Elevation', 'Card'], mode_id: null,
    effects: [
      {
        type: 'drop_shadow', visible: true,
        offset_x: { type: 'dimension', number: 0, unit: 'px' },
        offset_y: { type: 'dimension', number: 2, unit: 'px' },
        blur: { type: 'dimension', number: 8, unit: 'px' },
        color: { type: 'color', color_space: 'srgb', hex: '#000000', alpha: 0.2 },
      },
      {
        type: 'layer_blur', visible: false,
        blur: { type: 'dimension', number: 4, unit: 'px' },
      },
    ],
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

/** Prose shaped the way the prose prompt (`prose/prompt.ts`) actually asks
 *  for it, so the second reviewed Markdown page exercises the prose half of
 *  the renderer as a document rather than as isolated assertions: bold
 *  lead-ins, inline code spans, level-3 subheadings inside a blob, and a
 *  Do/Don't list whose rules are Markdown fragments rather than plain text.
 *
 *  Passed as `prose` rather than written as a `guidelines` object, so the
 *  snake_case artifact keys the renderer reads are produced by `guidelinesOf`
 *  (`brief.ts:371`) on the real path. A hand-written camelCase block is
 *  exactly the 2026-09-19 mistake, and hand-writing the snake_case one would
 *  prove only that the fixture and the renderer agree with each other.
 *
 *  Every claim here is checkable against the facts the same page renders:
 *  the Style axis really is Filled/Outlined, the states really are Enabled,
 *  Hovered and Disabled with no pressed state, the hover fill really is
 *  `md.sys.color.primary-hover`, and the container's padding and gap really
 *  are unbound. Prose that contradicted its own fact tables would make the
 *  page worse than no prose at all. */
const GOLDEN_PROSE: ProseDrafts = {
  definition: [
    'A button triggers an action in place, such as submitting a form or confirming a choice.',
    '',
    'A button is where a decision becomes a change, so its weight tells people which action the',
    'screen expects next. Keep one clearly leading action per view and let the rest sit quieter,',
    'so the choice reads at a glance rather than after a comparison.',
  ].join('\n'),
  accessibility: [
    '### Keyboard',
    '',
    '- **Activation:** `Enter` and `Space` both activate a button, while a link activates on',
    '  `Enter` alone. That difference is one reason not to swap the two.',
    '- **Focus order:** the design file does not encode focus order. Confirm in build that the',
    '  button takes focus in reading order.',
    '',
    '### Screen readers',
    '',
    '- **Accessible name:** the visible label is the accessible name. A button that shows only',
    '  its icon needs an explicit label in code, which the design file cannot carry.',
    '- **Disabled state:** a disabled control drops out of the tab order, so nobody hears why it',
    '  is unavailable. Put the reason next to it instead.',
  ].join('\n'),
  variantsSummary: [
    'One axis varies the visual weight: Style is either Filled or Outlined. A separate boolean',
    'controls whether the icon shows.',
    '',
    '- **Filled**: the single most important action in a view.',
    '- **Outlined**: a secondary action that still needs a clear edge, next to a Filled button or',
    '  alone in a quieter area.',
  ].join('\n'),
  anatomySummary: [
    'A container holds a text label and an optional icon. The container carries the fill, the',
    'corner radius and the padding, so the label and the icon only have to sit inside it.',
  ].join('\n'),
  interactions: [
    '- **Hover:** the container fill moves to `md.sys.color.primary-hover`.',
    '- **Pressed:** this component records no pressed state, so choose one in build and apply it',
    '  to every button.',
    '- **Focus:** focus styling is not encoded in the design file. A visible focus ring is',
    '  required, not optional.',
  ].join('\n'),
  designConsiderations: [
    '- **Contrast:** keep label-to-background contrast at 4.5:1 or better in both styles,',
    '  including the hover fill.',
    '- **Spacing:** the padding and gap on the container are not bound to tokens, so a change to',
    '  the spacing scale will not reach this component on its own.',
    '- **One leading action:** two Filled buttons side by side make the leading action ambiguous.',
  ].join('\n'),
  contentConsiderations: [
    '- **Verb first:** write the label as an action in one to three words, such as "Save" or',
    '  "Add item", never a bare "OK".',
    '- **Length:** plan for labels that wrap or truncate, and allow roughly 30 to 40 percent text',
    '  expansion in translation.',
    '- **Icon pairing:** when the icon shows, it repeats what the label already says rather than',
    '  carrying half the meaning.',
  ].join('\n'),
  dos: [
    '**Use the Filled style for the single most important action in a view.** Its weight tells'
    + ' people where to go next.',
    '**Keep labels to one to three words, verb first** ("Save", "Add item"). People can then scan'
    + ' the action without reading a sentence.',
    '**Pair the icon with the label, not instead of it.** An icon with no label needs its own'
    + ' accessible name, which this component does not provide.',
  ],
  donts: [
    "**Don't place more than one Filled button in the same view.** Competing primary actions make"
    + ' it unclear which one matters most.',
    "**Don't use a button for plain navigation.** Screen readers announce links and buttons"
    + ' differently, so use a link (`<a>`) when it just goes somewhere.',
    "**Don't disable a button without explaining why.** A disabled control gives no reason and"
    + ' drops out of the tab order, so use inline validation instead.',
  ],
};

/** The golden Button, carrying a designer-written description and a full set
 *  of model-written guidelines. A SEPARATE builder, following
 *  `buildComponentV5StyledArtifact` above: adding either to
 *  `buildComponentV5GoldenArtifact` would move `content_hash` in the
 *  byte-identical `button-component-ai-v5.yaml`. */
export function buildComponentV5ProseArtifact(): ComponentArtifactV5 {
  const spec = extract(button as SerializedNode, {
    figmaFile: 'FILE1', figmaFileName: 'Design System',
  });
  const described: IntermediateSpec = {
    ...spec,
    description: 'Material 3 button. Pick the visual weight with the Style property.',
  };
  return buildComponentArtifactV5(described, {
    exportId: 'component:prose', generatedAt: GENERATED_AT, build: 'test',
    foundation: buildGoldenFoundation(), prose: GOLDEN_PROSE,
  });
}

export function renderComponentV5Golden(): string {
  return toYaml(componentAiContext(buildComponentV5GoldenArtifact()) as unknown as YamlValue);
}

export function writeComponentV5Golden(): void {
  writeFileSync(COMPONENT_V5_GOLDEN_PATH, renderComponentV5Golden());
}

export const COMPONENT_V5_MARKDOWN_GOLDEN_PATH = fileURLToPath(
  new URL('./v5/button-component-md-v5.md', import.meta.url),
);

export function renderComponentV5MarkdownGolden(): string {
  return componentMarkdown(buildComponentV5GoldenArtifact());
}

export function writeComponentV5MarkdownGolden(): void {
  writeFileSync(COMPONENT_V5_MARKDOWN_GOLDEN_PATH, renderComponentV5MarkdownGolden());
}

/** The second reviewed page: the same Button, with a description and every
 *  prose section. The first golden carries no `guidelines` at all, so on its
 *  own it leaves the prose half of the renderer unread by any human. */
export const COMPONENT_V5_MARKDOWN_PROSE_GOLDEN_PATH = fileURLToPath(
  new URL('./v5/button-component-prose-md-v5.md', import.meta.url),
);

export function renderComponentV5MarkdownProseGolden(): string {
  return componentMarkdown(buildComponentV5ProseArtifact());
}

export function writeComponentV5MarkdownProseGolden(): void {
  writeFileSync(COMPONENT_V5_MARKDOWN_PROSE_GOLDEN_PATH, renderComponentV5MarkdownProseGolden());
}

if (process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeComponentV5Golden();
  writeComponentV5MarkdownGolden();
  writeComponentV5MarkdownProseGolden();
}
