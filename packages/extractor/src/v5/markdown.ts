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
import { componentEnvelope } from './componentContext';
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

function propertiesSection(api: Record<string, unknown>): string | undefined {
  const rows: string[][] = [];

  for (const [name, raw] of Object.entries(asRecord(api.variants))) {
    const axis = asRecord(raw);
    const options = Array.isArray(axis.options)
      ? axis.options.map((o) => escapeCell(String(o))).join(', ')
      : '';
    rows.push([escapeCell(name), 'Variant', options, escapeCell(String(axis.default ?? ''))]);
  }
  for (const [name, raw] of Object.entries(asRecord(api.booleans))) {
    const b = asRecord(raw);
    rows.push([escapeCell(name), 'Boolean', '',
      b.default === undefined ? '' : escapeCell(String(b.default))]);
  }
  for (const [name, raw] of Object.entries(asRecord(api.slots))) {
    const slot = asRecord(raw);
    const type = str(slot.type);
    const label = type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Slot';
    rows.push([escapeCell(name), label, '',
      slot.default === undefined ? '' : escapeCell(String(slot.default))]);
  }

  const states = Array.isArray(api.states)
    ? api.states.map((s) => escapeInline(String(s)))
    : [];

  if (rows.length === 0 && states.length === 0) return undefined;

  const parts = ['## Properties'];
  if (rows.length > 0) {
    parts.push(table(['Property', 'Type', 'Options', 'Default'], rows).trimEnd());
  }
  if (states.length > 0) parts.push(`States: ${states.join(', ')}`);
  return parts.join('\n\n');
}

function anatomyBullets(nodes: unknown[], depth: number): string[] {
  const lines: string[] = [];
  for (const raw of nodes) {
    const node = asRecord(raw);
    const part = escapeInline(str(node.part) ?? '');
    const path = str(node.path);
    const type = str(node.type);
    const parts: string[] = [];
    if (path) parts.push(code(path));
    const component = str(node.component);
    if (component) parts.push(`instance of ${escapeInline(component)}`);
    else if (type) parts.push(escapeInline(type.toLowerCase()));
    const shownBy = str(node.shown_by);
    if (shownBy) parts.push(`shown when ${code(shownBy)} is true`);
    lines.push(`${'  '.repeat(depth)}- ${part}: ${parts.join(', ')}`);
    if (Array.isArray(node.children)) {
      lines.push(...anatomyBullets(node.children, depth + 1));
    }
  }
  return lines;
}

function frontMatter(artifact: ComponentArtifactV5): string {
  const envelope = componentEnvelope(artifact, 'markdown');
  return `---\n${toYaml(envelope as unknown as YamlValue)}---\n`;
}

export function componentMarkdown(artifact: ComponentArtifactV5): string {
  const component = asRecord(artifact.component);
  const blocks: string[] = [];

  blocks.push(`# ${escapeInline(str(component.name) ?? 'Component')}`);

  const description = str(component.description);
  if (description) blocks.push(escapeInline(description));

  const related = Array.isArray(component.related)
    ? component.related.filter((r): r is string => typeof r === 'string')
    : [];
  if (related.length > 0) {
    blocks.push(`Related: ${related.map((r) => escapeInline(r)).join(', ')}`);
  }

  if (artifact.api !== undefined) {
    const section = propertiesSection(asRecord(artifact.api));
    if (section) blocks.push(section);
  }

  if (artifact.anatomy.length > 0) {
    blocks.push(`## Anatomy\n\n${anatomyBullets(artifact.anatomy, 0).join('\n')}`);
  }

  return `${frontMatter(artifact)}\n${blocks.join('\n\n')}\n`;
}
