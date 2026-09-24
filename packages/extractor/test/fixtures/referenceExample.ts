/** Synthetic reference example for the documentation site's Example page.
 *
 * Every value here is invented for this repository: the file key, the node
 * and variable ids, the names, the colours and the prose. Nothing is taken
 * from a customer file. The inputs are the two serialized dumps beside this
 * file, `reference-example/foundation.json` (a `SerializedFoundation`) and
 * `reference-example/button.json` (a `SerializedNode` component set), and the
 * builders below run them through the same extractor calls the plugin makes,
 * so what the site shows is real extractor output rather than hand-written
 * YAML.
 *
 * `referenceExample.test.ts` pins which features the example exercises. When
 * one of those assertions fails, the fix belongs in the input JSON.
 *
 * `renderReferenceExample` below mirrors what a real `spec-layer pull` writes
 * for this library (`packages/cli/src/files.ts`, `packages/cli/src/outputs.ts`),
 * restricted to the files the documentation site's Example page shows:
 * the component brief in both projections, the Foundation's DTCG export and
 * CSS output (both of which the CLI writes under `tokens/`), and `fonts.json`.
 * It does not render `bundle.json`, `manifest.json`, `outputs/*.map.json`,
 * `outputs/*.report.json`, or `component-specs/`, which the site does not
 * mirror. `referenceExampleGolden.test.ts` pins the output byte for byte
 * against `reference-example/out/`.
 *
 * Regenerate deliberately with:
 * `npx tsx packages/extractor/test/fixtures/referenceExample.ts`.
 * The documentation site mirrors `reference-example/out/` byte for byte, so
 * regenerate only when you mean every consumer to see the new bytes.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildComponentArtifactV5, buildFoundation, buildFoundationArtifactV5,
  componentAiContext, componentMarkdown, cssOutput, dtcgExportFiles, extract,
  fontRequirements, foundationDtcg, foundationDtcgDocument, toYaml, usageUnits,
  EXTRACTOR_VERSION, LIBRARY_BUNDLE_SCHEMA,
} from '../../src/index';
import type {
  ComponentArtifactV5, FoundationArtifactV5, LibraryBundleV1, ProseDrafts,
  SerializedFoundation, SerializedNode, YamlValue,
} from '../../src/index';
import foundationDump from './reference-example/foundation.json';
import buttonDump from './reference-example/button.json';

/** A library id of the shape the CLI's `LIBRARY_ID_RE` accepts. Invented. */
export const REFERENCE_LIBRARY_ID = 'lib_5e1ec7ab1e0000000000beef';
export const REFERENCE_GENERATED_AT = '2026-09-24T00:00:00.000Z';
export const REFERENCE_FILE_NAME = 'Reference Design System';

/** The designer description on the Button component set, read from
 *  `button.json` so the test pins the text the input actually carries. */
export const REFERENCE_DESCRIPTION: string = (buttonDump as SerializedNode).description ?? '';

const BUILD = '6.0.0';

/** Guidelines written for this Button, in the shape the prose prompt returns.
 *  Passed as `prose`, so the snake_case `guidelines` keys come from
 *  `guidelinesOf` on the real path rather than from a hand-written block.
 *
 *  Every claim is checkable against the facts the same artifact carries: the
 *  axes really are Size (Medium, Large) and Style (Filled, Outlined), the
 *  states really are `hover` and `disabled` switches with no pressed or focus
 *  state, the hover fill really is `color/action/primary-hover` with the
 *  `Elevation/1` shadow, the label really uses the `Label/Large` text style,
 *  and the icon slot's 2px padding really is unbound. */
export const REFERENCE_PROSE: ProseDrafts = {
  definition: [
    'A button triggers an action in place, such as saving a form or confirming a choice.',
    '',
    'Its visual weight tells people which action the view expects next, so keep one leading',
    'action per view and let the rest sit quieter.',
  ].join('\n'),
  accessibility: [
    '### Keyboard',
    '',
    '- **Activation:** `Enter` and `Space` both activate a button. A link activates on `Enter`',
    '  alone, which is one reason not to swap the two.',
    '- **Focus:** the design file records no focus state. Add a visible focus ring in code; it',
    '  is required, not optional.',
    '',
    '### Pointer and touch',
    '',
    '- **Hover:** the hover state only exists for a pointer. Never put information in it that',
    '  a touch or keyboard user would miss.',
    '- **Target size:** the design file records padding and line height, not a final height.',
    '  Check in code that every size stays at least 24 by 24px.',
    '',
    '### Screen readers',
    '',
    '- **Accessible name:** the visible label is the accessible name. A button that shows only',
    '  its icon needs an explicit label in code, which the design file cannot carry.',
    '- **Disabled:** a disabled button drops out of the tab order, so nobody hears why it is',
    '  unavailable. Say why next to it.',
  ].join('\n'),
  variantsSummary: [
    'Two axes vary the look, and two switches record state.',
    '',
    '- **Style:** Filled for the single leading action, Outlined for a secondary action.',
    '- **Size:** Medium for most layouts, Large where the button leads a sparse view.',
    '- **hover** and **disabled:** switches rather than one State axis, so each state is a',
    '  condition a binding can name.',
  ].join('\n'),
  anatomySummary: [
    'The component itself is the container: it carries the fill or border, the corner radius,',
    'the padding and the gap. Inside it sit an icon slot and a text label.',
  ].join('\n'),
  /* `name` matches `spec.anatomy` exactly (case-insensitive), the way the
   * prose prompt asks for it: `icon-slot` and `label` are the container's
   * direct children, and `icon` is the instance nested inside the slot.
   * Note for a future reader: as of this writing neither `guidelinesOf`
   * (`brief.ts`) nor `componentMarkdown` (`markdown.ts`) reads
   * `anatomyParts` at all, so these lines do not yet surface in either
   * rendered golden. They are added here because the field is part of the
   * real `ProseDrafts` contract and every real anatomy part deserves a true
   * line; if a future change starts rendering `anatomyParts`, this is the
   * text it will pick up. */
  anatomyParts: [
    { name: 'icon-slot', description: 'Frame that positions the leading icon; its 2px padding is a literal, not a token.' },
    { name: 'icon', description: 'The leading icon instance, shown only when Show icon is on.' },
    { name: 'label', description: "The button's text, set in the Label/Large text style." },
  ],
  interactions: [
    '- **Hover:** a Filled button moves to `color/action/primary-hover` and lifts with the',
    '  `Elevation/1` shadow. An Outlined button records no hover change.',
    '- **Disabled:** a Filled button moves to `color/action/disabled`; an Outlined button keeps',
    '  its border and moves its label and icon to `color/action/disabled`.',
    '- **Pressed and focus:** neither is recorded. Choose them in code and apply them to every',
    '  button.',
  ].join('\n'),
  designConsiderations: [
    '- **Tokens, not values:** fill, border, radius, padding and gap are all bound to tokens,',
    '  so a change to the foundation reaches every button.',
    '- **The icon slot is the exception:** its 2px padding is a literal, so a spacing change',
    '  will not reach it.',
    '- **One leading action:** two Filled buttons side by side make the leading action unclear.',
  ].join('\n'),
  contentConsiderations: [
    '- **Verb first:** write the label as an action in one to three words, such as "Save" or',
    '  "Add item", never a bare "OK".',
    '- **Length:** allow for labels to grow by a third in translation.',
  ].join('\n'),
  dos: [
    '**Use the Filled style for the single most important action in a view.** Its weight tells'
    + ' people where to go next.',
    '**Keep labels short and verb first** ("Save", "Add item"). People can then scan the action'
    + ' without reading a sentence.',
    '**Pair the icon with the label, not instead of it.** An icon on its own needs an accessible'
    + ' name the design file cannot carry.',
  ],
  donts: [
    "**Don't place two Filled buttons side by side.** Competing leading actions make it unclear"
    + ' which one matters.',
    "**Don't use a button for plain navigation.** Screen readers announce links and buttons"
    + ' differently, so use a link (`<a>`) when it only goes somewhere.',
    "**Don't disable a button without saying why.** A disabled control gives no reason and drops"
    + ' out of the tab order.',
  ],
};

export function buildReferenceFoundation(): FoundationArtifactV5 {
  const spec = buildFoundation(structuredClone(foundationDump) as SerializedFoundation);
  return buildFoundationArtifactV5(spec, {
    exportId: 'foundation:reference', generatedAt: REFERENCE_GENERATED_AT, build: BUILD,
  }).artifact;
}

function referenceSpec() {
  return extract(structuredClone(buttonDump) as SerializedNode, {
    figmaFile: 'REFFILE', figmaFileName: REFERENCE_FILE_NAME,
  });
}

export function buildReferenceButton(): ComponentArtifactV5 {
  return buildComponentArtifactV5(referenceSpec(), {
    exportId: 'component:reference-button', generatedAt: REFERENCE_GENERATED_AT, build: BUILD,
    foundation: buildReferenceFoundation(), prose: REFERENCE_PROSE,
  });
}

/** The bundle the plugin would publish for this file. Assembled the way
 *  `packages/plugin/src/ui/publish.ts` (`buildPublishArtifacts`) assembles
 *  it: the foundation's `ai` string is the DTCG resolver document, pretty
 *  printed with a trailing newline, and each component's `ai` string is its
 *  Component Context v5 YAML. */
export function buildReferenceBundle(): LibraryBundleV1 {
  const foundation = buildReferenceFoundation();
  const button = buildReferenceButton();
  return {
    schema: LIBRARY_BUNDLE_SCHEMA,
    version: '1.0.0',
    fileName: REFERENCE_FILE_NAME,
    pluginVersion: BUILD,
    extractorVersion: EXTRACTOR_VERSION,
    foundation: {
      ai: `${JSON.stringify(foundationDtcgDocument(foundation), null, 2)}\n`,
      artifact: foundation,
    },
    components: [{
      name: 'Button',
      ai: toYaml(componentAiContext(button) as unknown as YamlValue),
      artifact: button,
      variants: referenceSpec().variantInstances.map(({ name, values }) => ({ name, values })),
    }],
  };
}

/** Where the rendered goldens live on disk, committed beside this file. */
export const REFERENCE_OUT_DIR = fileURLToPath(new URL('./reference-example/out/', import.meta.url));

/**
 * Renders every file a real `spec-layer pull` would write for this library,
 * restricted to what the documentation site's Example page shows. Paths are
 * relative to `REFERENCE_OUT_DIR`. See the file header for what is and is
 * not rendered, and why.
 */
export function renderReferenceExample(): Record<string, string> {
  const bundle = buildReferenceBundle();
  const foundation = buildReferenceFoundation();
  const button = buildReferenceButton();
  const exp = foundationDtcg(foundation, {}, usageUnits(bundle));
  const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  const out: Record<string, string> = {
    'button.yaml': toYaml(componentAiContext(button) as unknown as YamlValue),
    'button.md': componentMarkdown(button),
    'fonts.json': json(fontRequirements(foundation)),
  };
  // The CLI writes both the DTCG export and the CSS output under `tokens/`
  // (`packages/cli/src/files.ts`: `put(\`tokens/${name}\`, ...)` for the DTCG
  // files, and the default `web`/`css` output path is also `tokens`, per
  // `packages/cli/src/outputs.ts` `FORMATS`), so both land in the same
  // directory here.
  for (const [name, text] of Object.entries(dtcgExportFiles(exp))) out[`tokens/${name}`] = text;
  const header = {
    libraryId: REFERENCE_LIBRARY_ID,
    contentHash: foundation.spec_layer.export.content_hash,
    platform: 'web',
    format: 'css',
  };
  const css = cssOutput(exp, header, { case: 'kebab' });
  for (const [name, text] of Object.entries(css.files)) out[`tokens/${name}`] = text;
  return out;
}

/** Writes `renderReferenceExample()` to `REFERENCE_OUT_DIR`, replacing
 *  whatever was there. Called by `referenceExampleGolden.test.ts` under
 *  `UPDATE_REFERENCE_EXAMPLE=1`, and by the CLI entry point below. */
export function writeReferenceExample(): void {
  rmSync(REFERENCE_OUT_DIR, { recursive: true, force: true });
  for (const [path, text] of Object.entries(renderReferenceExample())) {
    const full = join(REFERENCE_OUT_DIR, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

// Regenerate deliberately with:
// npx tsx packages/extractor/test/fixtures/referenceExample.ts
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeReferenceExample();
}
