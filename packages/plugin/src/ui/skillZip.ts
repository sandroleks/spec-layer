/**
 * skillZip.ts — the downloadable snapshot skill, as files.
 *
 * Every byte comes from extractor code that already ships: the component
 * briefs are the same YAML Copy for AI and publish produce, and the token
 * files are the same ones `spec-layer pull` writes. Nothing here is a second
 * interpretation of v5.
 *
 * Pure by construction, so the whole payload is testable without a DOM or a
 * Figma file. `download.ts` turns the result into bytes.
 */
import {
  componentSlugs, dtcgExportFiles, fontRequirements, foundationDtcg, usageUnits,
  type FontRequirement, type FoundationArtifactV5, type LibraryBundleV1,
} from '@spec-layer/extractor';
import type { PublishBundleV1 } from './publish';

/** What SKILL.md describes, derived from the file set so it can never name a
 *  file the zip does not carry. */
export interface SnapshotInventory {
  fileName: string | null;
  pluginVersion: string | null;
  generatedAt: string;
  components: Array<{ name: string; path: string }>;
  tokens: { files: string[] } | null;
  fonts: FontRequirement[];
}

const DESCRIPTION =
  'Use the design-system context downloaded from the Spec Layer Figma plugin: '
  + 'component variants, states, anatomy, token bindings, and design tokens. '
  + 'Read this before building or changing UI or using tokens.';

/** ISO instant to a plain date, which is all the reader needs and all we can
 *  state without guessing a timezone. */
function day(iso: string): string {
  return iso.slice(0, 10);
}

export function renderSnapshotSkill(inv: SnapshotInventory): string {
  const lines: string[] = [];
  lines.push('---', 'name: spec-layer', `description: ${JSON.stringify(DESCRIPTION)}`, '---', '');
  lines.push('# Spec Layer: design-system context', '');

  const source = inv.fileName ? `the Figma file "${inv.fileName}"` : 'a Figma file';
  const version = inv.pluginVersion ? ` by plugin version ${inv.pluginVersion}` : '';
  lines.push(
    `This folder holds a design system extracted from ${source} on ${day(inv.generatedAt)}${version}. `
    + 'Everything in it is extracted deterministically and validated against a published schema, with two '
    + "exceptions that can carry model-written prose: a component's `guidelines` block, marked `origin: "
    + 'generated`, and a token group\'s `$description` in `tokens/`, which carries no marker and can be '
    + 'model-written even though it looks like an ordinary field. Treat the rest as the source of truth for '
    + 'what the design system contains, and treat anything it does not state as unknown rather than as '
    + 'something to infer.',
    '',
  );

  lines.push('## This is a snapshot', '');
  lines.push(
    'It does not update. When the design system changes, download it again from the Spec Layer plugin in '
    + 'Figma. For live updates and drift detection instead, publish the library from the plugin and use the '
    + 'spec-layer CLI. If this repository already uses that CLI, the guide it writes replaces this file, and '
    + 'the components and tokens folders next to it are stale and should be deleted.',
    '',
  );

  lines.push('## How to read it', '');
  if (inv.components.length > 0) {
    lines.push(
      '1. Building or changing a component: read its YAML under `components/`. `api` gives variants, states, '
      + 'booleans, and slots; `anatomy` names the parts; `references.bindings` says which token each part\'s '
      + 'property uses and under which `when` conditions; `unbound` lists values that are hardcoded in Figma.',
    );
  } else {
    lines.push('1. No component documentation was included in this download.');
  }
  if (inv.tokens) {
    lines.push(
      '2. Working with colors, spacing, type, or effects: start at `tokens/resolver.json`, load the set and '
      + 'mode files it names, and look up `code_syntax` in `tokens/spec-layer.meta.json` for the name the '
      + 'designer declared for your platform.',
    );
  } else {
    lines.push('2. The foundation was not read for this download, so it carries no tokens.');
  }
  lines.push(
    '3. Reference tokens by name in code; never paste a resolved value where a token exists. A value the '
    + 'design system does not define is not a token: say so in your change rather than adding one.',
    '4. An `unbound` entry is design debt reported from Figma. Do not silently promote it to a token; keep '
    + 'the literal and note that Figma has no binding for it.',
    '',
  );

  if (inv.components.length > 0) {
    lines.push('## Components', '');
    for (const c of inv.components) lines.push(`- ${c.name}: \`${c.path}\``);
    lines.push('');
  }
  if (inv.tokens) {
    lines.push('## Token files', '');
    for (const f of inv.tokens.files) lines.push(`- \`${f}\``);
    lines.push('');
  }
  if (inv.tokens) {
    // `fonts.json` is written whenever a foundation was read, empty or not
    // (the CLI's pull does the same), so this section always runs alongside
    // it and always names the file by path -- the one payload file that
    // otherwise had no path printed anywhere in the guide.
    lines.push('## Fonts', '');
    if (inv.fonts.length > 0) {
      lines.push(
        'This library\'s typography styles need these families and weights, listed in `fonts.json`:', '',
      );
      for (const f of inv.fonts) lines.push(`- ${f.family}: ${f.weights.join(', ')}`);
    } else {
      lines.push(
        'No typography style in this library resolved to a font family, so `fonts.json` is present and empty.',
      );
    }
    lines.push('');
  }

  lines.push('## What this cannot see', '');
  lines.push(
    'This guide knows the design system and nothing about the repository it was copied into. It does not '
    + 'know the stack, where components live, or which platform naming to prefer. The spec-layer CLI reads '
    + 'the repository and writes a guide that does. Do not read silence here as a statement about this '
    + 'codebase.',
    '',
  );
  lines.push('Generated by the Spec Layer Figma plugin.');
  return `${lines.join('\n')}\n`;
}

/** The folder the zip unpacks to, so `.claude/skills/` is the unzip target. */
const ROOT = 'spec-layer';

/**
 * The whole snapshot as `path -> text`.
 *
 * The token files are produced exactly as `spec-layer pull` produces them,
 * including the `usageUnits` pass: the evidence for a unit no Figma scope
 * states is split between the Foundation and the component bindings, and the
 * projection alone sees only the first. Skipping it here would give a
 * downloaded `tokens/` directory that disagrees with a pulled one.
 */
export function buildSkillFiles(
  bundle: PublishBundleV1, generatedAt: string,
): Record<string, string> {
  const files: Record<string, string> = {};

  const slugs = componentSlugs(bundle.components.map((c) => c.name));
  const components = bundle.components.map((component, i) => ({
    name: component.name,
    path: `components/${slugs[i]}.yaml`,
    ai: component.ai,
  }));
  for (const c of components) files[`${ROOT}/${c.path}`] = c.ai;

  let tokens: SnapshotInventory['tokens'] = null;
  let fonts: FontRequirement[] = [];
  if (bundle.foundation) {
    const artifact = bundle.foundation.artifact as FoundationArtifactV5;
    // PublishBundleV1 types each component artifact as `unknown`; it is
    // otherwise structurally LibraryBundleV1, which is what usageUnits reads.
    const exp = foundationDtcg(artifact, {}, usageUnits(bundle as unknown as LibraryBundleV1));
    const written: string[] = [];
    for (const [name, text] of Object.entries(dtcgExportFiles(exp))) {
      files[`${ROOT}/tokens/${name}`] = text;
      written.push(`tokens/${name}`);
    }
    tokens = { files: written };
    fonts = fontRequirements(artifact);
    // Written whenever a foundation was read, empty list included -- the same
    // as the CLI's pull (packages/cli/src/files.ts writes fonts.json whenever
    // the Foundation is written). renderSnapshotSkill's Fonts section always
    // runs alongside it and always names the path, honestly, either way.
    files[`${ROOT}/fonts.json`] = `${JSON.stringify(fonts, null, 2)}\n`;
  }

  files[`${ROOT}/SKILL.md`] = renderSnapshotSkill({
    fileName: bundle.fileName,
    pluginVersion: bundle.pluginVersion,
    generatedAt,
    components: components.map(({ name, path }) => ({ name, path })),
    tokens,
    fonts,
  });
  return files;
}

/** `spec-layer-<file>-skill.zip`, or `spec-layer-skill.zip` when the file name
 *  carries nothing usable. `slugify` returns 'component' for such a name, which
 *  is meaningless here, so that case falls back instead. */
export function skillZipFilename(fileName: string | null): string {
  if (!fileName) return 'spec-layer-skill.zip';
  const slug = fileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? `spec-layer-${slug}-skill.zip` : 'spec-layer-skill.zip';
}
