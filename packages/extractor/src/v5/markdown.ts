/**
 * Markdown projection of a Component Context v5 artifact.
 *
 * A PROJECTION, like `dtcg.ts`: it reads a validated artifact, never feeds a
 * hash, is never stored in a bundle, and nothing parses it back. It cannot say
 * anything the artifact does not say. What the format cannot carry is omitted,
 * never replaced with a plausible default.
 */

import { toYaml } from '../yaml';
import type { YamlValue } from '../yaml';
import type { ComponentArtifactV5 } from './componentContext';

/** Opening bytes of the YAML profile, for ownership checks. */
export const COMPONENT_YAML_MARKER = 'spec_layer:\n  kind: component';

/** Opening bytes of this projection, for ownership checks. */
export const COMPONENT_MARKDOWN_MARKER = '---\nspec_layer:\n  kind: component';

/** @internal Text, not markup: one line, with inline constructs neutralised. */
export function escapeInline(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/([\\*_<>[\]])/g, '\\$1')
    .trim();
}

/** @internal `escapeInline` plus the cell separator. */
export function escapeCell(text: string): string {
  return escapeInline(text).replace(/\|/g, '\\|');
}

/** @internal Inline code with a fence longer than any run of backticks inside. */
export function code(text: string): string {
  const flat = text.replace(/\r?\n/g, ' ');
  const longest = (flat.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  return longest === 0 ? `${fence}${flat}${fence}` : `${fence} ${flat} ${fence}`;
}

/** @internal A GFM table. Cells are already escaped by the caller. */
export function table(headers: string[], rows: string[][]): string {
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |\n`;
  return line(headers)
    + `|${headers.map(() => '---').join('|')}|\n`
    + rows.map(line).join('');
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

function frontMatter(artifact: ComponentArtifactV5): string {
  const source = artifact.spec_layer.source;
  const envelope = {
    spec_layer: {
      kind: 'component', version: 5, profile: 'markdown',
      content_hash: artifact.spec_layer.export.content_hash,
      ...(artifact.foundation_content_hash
        ? { foundation_hash: artifact.foundation_content_hash }
        : {}),
      source: {
        provider: 'figma',
        ...(source.file_name ? { file_name: source.file_name } : {}),
      },
    },
    source: {
      node_id: source.node_id,
      node_name: source.node_name,
      ...(source.component_key ? { component_key: source.component_key } : {}),
    },
  };
  return `---\n${toYaml(envelope as unknown as YamlValue)}---\n`;
}

export function componentMarkdown(artifact: ComponentArtifactV5): string {
  const component = asRecord(artifact.component);
  const blocks: string[] = [];

  blocks.push(`# ${escapeInline(str(component.name) ?? 'Component')}`);

  const description = str(component.description);
  if (description) blocks.push(escapeInline(description));

  const docs = Array.isArray(component.documentation_links)
    ? component.documentation_links.filter((l): l is string => typeof l === 'string')
    : [];
  if (docs.length > 0) blocks.push(docs.map((l) => `- <${l}>`).join('\n'));

  const related = Array.isArray(component.related)
    ? component.related.filter((r): r is string => typeof r === 'string')
    : [];
  if (related.length > 0) {
    blocks.push(`Related: ${related.map((r) => escapeInline(r)).join(', ')}`);
  }

  return `${frontMatter(artifact)}\n${blocks.join('\n\n')}\n`;
}
