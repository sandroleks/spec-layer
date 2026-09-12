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
import type { FontRequirement } from '@spec-layer/extractor';

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
    + 'Everything in it is extracted deterministically and validated against a published schema; no model '
    + 'wrote any of it. Treat it as the source of truth for what the design system contains, and treat '
    + 'anything it does not state as unknown rather than as something to infer.',
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
  if (inv.fonts.length > 0) {
    lines.push('## Fonts', '');
    lines.push('This library\'s typography styles need these families and weights:', '');
    for (const f of inv.fonts) lines.push(`- ${f.family}: ${f.weights.join(', ')}`);
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
