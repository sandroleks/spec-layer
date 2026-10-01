/**
 * Markdown projection of a Component Context v5 artifact. Like `dtcg.ts`, it
 * reads a validated artifact, never feeds a hash, is never stored in a bundle,
 * and nothing parses it back. What the format cannot carry is omitted, never
 * replaced with a plausible default.
 */

import { toYaml } from '../yaml';
import type { YamlValue } from '../yaml';
import { valueText } from './aiContext';
import type { FoundationValidationRow } from './aiContext';
import { componentEnvelope, componentFoundationAiSlice } from './componentContext';
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

/** @internal `escapeInline` plus the cell separator, in ONE pass: with the pipe
 * in the backslash's character class, no ordering of passes can escape the
 * escape character after the delimiter it protects. */
export function escapeCell(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/([\\*_<>[\]|])/g, '\\$1')
    .trim();
}

/** @internal `escapeCell` plus a leading `#`, for the H1 title only, so a
 * hostile component name cannot forge a heading (`|` is escaped to match the
 * name in a table row). Other values that may start with `#`, such as a hex
 * colour, must not get this, or `#6750a4` would render as `\#6750a4`. */
function escapeHeading(text: string): string {
  // Position zero only, which a character class cannot express.
  return escapeCell(text).replace(/^#/, '\\#');
}

/** @internal `escapeInline` plus the constructs that open a block when they
 * lead a line, for the two slots where designer text starts a line: the
 * description under the H1 and an anatomy part name (a list item's content).
 * Without it a description could open a fence that swallows the page, forge a
 * `##` section, or emit a second H1.
 *
 * `escapeInline` already made it one trimmed line, so one backslash at the
 * start suffices. Not `escapeHeading`, whose `|` escape would leave a stray
 * backslash in prose. `>`, `*` and `_` are absent because `escapeInline`
 * already escaped them; runs of fewer than three backticks or tildes are left
 * alone, since they cannot open a fence and may start an inline code span. */
function escapeBlock(text: string): string {
  return escapeInline(text)
    .replace(/^(`{3,}|~{3,}|[#=+-])/, '\\$1')
    // An ordered list marker (up to nine digits, then `.` or `)`): escaping the
    // delimiter stops the list and still renders what was typed.
    .replace(/^(\d{1,9})([.)])/, '$1\\$2');
}

/** @internal Inline code with a fence longer than any run of backticks inside. */
export function code(text: string): string {
  const flat = text.replace(/\r?\n/g, ' ');
  const longest = (flat.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  return longest === 0 ? `${fence}${flat}${fence}` : `${fence} ${flat} ${fence}`;
}

/** @internal `code` plus `\|`: a GFM row splitter runs before code spans are
 * parsed, so a `|` inside backticks still splits the cell. The escaped pipe is
 * honoured there and renders as `|` (verified against `mdast-util-gfm-table`).
 * Table cells only: in prose (`anatomyBullets`, `## Issues`) the backslash
 * would be a fabricated character. */
function codeCell(text: string): string {
  // A backslash before a pipe is inexpressible in a table code span (`\|` is
  // the only escape honoured; verified against remark-gfm), so a value with a
  // backslash gives up the monospace font rather than its own characters.
  if (text.includes('\\')) return escapeCell(text);
  return code(text).replace(/\|/g, '\\|');
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

// Only scope values the extractor produces (`componentContext.ts:500`): a
// sentence for a scope that does not exist would be fabricated.
const SCOPE_SENTENCE: Record<string, string> = {
  default_variant: 'Default variant.',
};

function bindingsSection(references: Record<string, unknown>): string | undefined {
  const bindings = Array.isArray(references.bindings) ? references.bindings : [];
  if (bindings.length === 0) return undefined;
  const byId = new Map(
    (Array.isArray(references.used) ? references.used : []).map((r) => [
      asRecord(r).source_id,
      r,
    ]),
  );
  const rows = bindings.map((raw) => {
    const binding = asRecord(raw);
    const source_id = str(binding.source_id);
    const reference = source_id ? byId.get(source_id) : undefined;
    const ref = asRecord(reference);
    const name = str(ref.name) ?? source_id;
    const status = ref.status && ref.status !== 'resolved' ? ` (${ref.status})` : '';
    const when = asRecord(binding.when);
    const whenStr = Object.entries(when)
      .map(([axis, raw_values]) => {
        const values = Array.isArray(raw_values) ? raw_values : [];
        return `${escapeCell(axis)}: ${values.map((v) => escapeCell(String(v))).join(', ')}`;
      })
      .join('; ');
    const path = str(binding.path);
    const property = str(binding.property);
    return [path ? codeCell(path) : '', property ? escapeCell(property) : '',
      `${escapeCell(name ?? '')}${status}`, whenStr];
  });
  return `## Token bindings\n\n${table(['Part', 'Property', 'Token', 'When'], rows).trimEnd()}`;
}

function layoutSection(layout: Record<string, unknown>): string | undefined {
  const items = Array.isArray(layout.items) ? layout.items : [];
  if (items.length === 0) return undefined;
  const rows = items.map((raw) => {
    const item = asRecord(raw);
    const path = str(item.path);
    return [path ? codeCell(path) : '', escapeCell(str(item.summary) ?? '')];
  });
  const scope = str(layout.scope);
  const sentence = scope ? SCOPE_SENTENCE[scope] : undefined;
  const parts = ['## Layout'];
  if (sentence) parts.push(sentence);
  parts.push(table(['Part', 'Layout'], rows).trimEnd());
  return parts.join('\n\n');
}

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
    const part = escapeBlock(str(node.part) ?? '');
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

const NOT_READ_SENTENCE =
  'Token values are not included: the foundations had not been read when this was exported.';

/** @internal One typography `StyleProperty` as `compactStyleProperty`
 * (`aiContext.ts:306`) shapes it. Its four shapes are handled here, since
 * `valueText` would print `[object Object]` for them:
 *
 * 1. literal, resolved:   `{ type, value }`               -> `valueText(value)`
 * 2. literal, unresolved: `{ missing: reason }`            -> `missing: <reason>`
 * 3. alias, resolved:     `{ alias, resolved: { value } }` -> `<alias> (resolved: <value>)`
 * 4. alias, unresolved:   `{ alias, unresolved: reason }`  -> `<alias> (unresolved: <reason>)`
 *
 * The caller escapes the result with `escapeCell`. An unrecognised shape falls
 * back to `valueText`: a shape it renders wrongly is a stop-and-report, not a
 * fork of `valueText`. */
function styleValueText(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.missing === 'string') return `missing: ${record.missing}`;
    if (typeof record.alias === 'string') {
      if (record.resolved !== undefined) {
        const resolved = record.resolved as Record<string, unknown>;
        return `${record.alias} (resolved: ${valueText(resolved.value)})`;
      }
      if (typeof record.unresolved === 'string') {
        return `${record.alias} (unresolved: ${record.unresolved})`;
      }
    }
    if ('value' in record) return valueText(record.value);
  }
  return valueText(value);
}

// No `paragraph_spacing`, `text_case` or `text_decoration`: a scope cut to what
// an implementer needs. Extend the table and this comment together.
function typographySection(items: unknown[]): string | undefined {
  if (items.length === 0) return undefined;
  const rows = items.map((raw) => {
    const style = asRecord(raw);
    const properties = asRecord(style.properties);
    return [
      escapeCell(str(style.name) ?? ''),
      escapeCell(styleValueText(properties.font_family)),
      escapeCell(styleValueText(properties.font_weight)),
      escapeCell(styleValueText(properties.font_size)),
      escapeCell(styleValueText(properties.line_height)),
      escapeCell(styleValueText(properties.letter_spacing)),
      escapeCell(styleValueText(properties.paragraph_indent)),
    ];
  });
  return [
    '### Typography styles',
    table(
      ['Style', 'Font family', 'Weight', 'Size', 'Line height', 'Letter spacing', 'Paragraph indent'],
      rows,
    ).trimEnd(),
  ].join('\n\n');
}

function effectSummary(effect: Record<string, unknown>): string {
  const parts: string[] = [];
  const type = str(effect.type);
  if (type) parts.push(type);
  if (effect.offset_x !== undefined || effect.offset_y !== undefined) {
    parts.push(`offset ${valueText(effect.offset_x)}/${valueText(effect.offset_y)}`);
  }
  if (effect.blur !== undefined) parts.push(`blur ${valueText(effect.blur)}`);
  if (effect.spread !== undefined) parts.push(`spread ${valueText(effect.spread)}`);
  if (effect.color !== undefined) parts.push(valueText(effect.color));
  const summary = parts.join(', ');
  // A hidden layer is marked, or an agent would implement a shadow the designer
  // turned off. True or absent `visible` stays unmarked, as the normal case.
  return effect.visible === false ? `${summary} (hidden)` : summary;
}

function effectsSection(items: unknown[]): string | undefined {
  if (items.length === 0) return undefined;
  const rows = items.map((raw) => {
    const style = asRecord(raw);
    const mode = str(style.mode);
    const effects = Array.isArray(style.effects) ? style.effects : [];
    // `; ` between layers, above a layer's own `, `, so two layers of one type
    // stay distinguishable.
    const summary = effects.map((effect) => effectSummary(asRecord(effect))).join('; ');
    return [escapeCell(str(style.name) ?? ''), mode ? escapeCell(mode) : '', escapeCell(summary)];
  });
  return [
    '### Effect styles',
    table(['Style', 'Mode', 'Effects'], rows).trimEnd(),
  ].join('\n\n');
}

/**
 * One inline effect layer as `exactEffectLayer` (`componentContext.ts:510`)
 * shapes it: the raw `EffectLayer` (`effects.ts:44`), not `compactEffect`'s
 * shape, so `effectSummary` cannot read it (`offset: {x,y}`, `radius`, a plain
 * `Rgba`). Each of the nine `EffectLayer` shapes renders from its own fields,
 * plus any per-field binding. Plain text; the caller escapes once per part.
 */
function inlineEffectLayerText(raw: unknown): string {
  const layer = asRecord(raw);
  const type = str(layer.type) ?? 'unknown';
  const num = (value: unknown): string => (typeof value === 'number' ? String(value) : '');
  let summary: string;
  switch (type) {
    case 'drop-shadow':
    case 'inner-shadow': {
      const offset = asRecord(layer.offset);
      const color = asRecord(layer.color);
      const parts = [type, `offset ${num(offset.x)}/${num(offset.y)}`, `radius ${num(layer.radius)}`];
      if (layer.spread !== undefined) parts.push(`spread ${num(layer.spread)}`);
      if (str(color.hex)) parts.push(`${str(color.hex)} alpha ${num(color.alpha)}`);
      summary = parts.join(', ');
      break;
    }
    case 'layer-blur':
    case 'background-blur': {
      const progressive = layer.blurType === 'progressive';
      const parts = [progressive ? `${type} (progressive)` : type, `radius ${num(layer.radius)}`];
      if (progressive) {
        const startOffset = asRecord(layer.startOffset);
        const endOffset = asRecord(layer.endOffset);
        parts.push(`start radius ${num(layer.startRadius)}`);
        parts.push(`start offset ${num(startOffset.x)}/${num(startOffset.y)}`);
        parts.push(`end offset ${num(endOffset.x)}/${num(endOffset.y)}`);
      }
      summary = parts.join(', ');
      break;
    }
    case 'noise': {
      const color = asRecord(layer.color);
      const noiseType = str(layer.noiseType);
      const parts = [noiseType ? `noise (${noiseType})` : 'noise'];
      if (str(color.hex)) parts.push(`${str(color.hex)} alpha ${num(color.alpha)}`);
      parts.push(`size ${num(layer.noiseSize)}`);
      parts.push(`density ${num(layer.density)}`);
      const secondary = asRecord(layer.secondaryColor);
      if (str(secondary.hex)) parts.push(`secondary ${str(secondary.hex)} alpha ${num(secondary.alpha)}`);
      if (layer.opacity !== undefined) parts.push(`opacity ${num(layer.opacity)}`);
      summary = parts.join(', ');
      break;
    }
    case 'texture': {
      const parts = ['texture', `size ${num(layer.noiseSize)}`, `radius ${num(layer.radius)}`,
        `clip ${layer.clipToShape === true ? 'true' : 'false'}`];
      const vector = asRecord(layer.noiseSizeVector);
      if (vector.x !== undefined) parts.push(`vector ${num(vector.x)}/${num(vector.y)}`);
      summary = parts.join(', ');
      break;
    }
    case 'glass': {
      summary = [
        'glass', `radius ${num(layer.radius)}`, `light intensity ${num(layer.lightIntensity)}`,
        `light angle ${num(layer.lightAngle)}`, `refraction ${num(layer.refraction)}`,
        `depth ${num(layer.depth)}`, `dispersion ${num(layer.dispersion)}`,
      ].join(', ');
      break;
    }
    default: {
      const figmaType = str(layer.figma_type);
      summary = figmaType ? `unknown (${figmaType})` : 'unknown';
    }
  }
  const bindings = layer.bindings !== undefined ? asRecord(layer.bindings) : undefined;
  const boundText = bindings
    ? Object.entries(bindings)
      .map(([field, reference]) => `${field} bound to ${str(asRecord(reference).name) ?? ''}`)
      .join(', ')
    : '';
  const hidden = layer.visible === false ? ' (hidden)' : '';
  return `${summary}${boundText ? `, ${boundText}` : ''}${hidden}`;
}

/**
 * `## Effects`: inline effects on component parts (`artifact.effects_inline`),
 * unrelated to `### Effect styles`, which renders the Foundation's shared styles.
 */
function effectsInlineSection(items: unknown[]): string | undefined {
  if (items.length === 0) return undefined;
  const rows = items.map((raw) => {
    const item = asRecord(raw);
    const path = str(item.path);
    const layers = Array.isArray(item.layers) ? item.layers : [];
    const summary = layers.map((layer) => inlineEffectLayerText(layer)).join('; ');
    return [path ? codeCell(path) : '', escapeCell(summary)];
  });
  return `## Effects\n\n${table(['Part', 'Effects'], rows).trimEnd()}`;
}

/**
 * `## Unbound values`, one row per `artifact.unbound` entry. An absent `value`
 * is an empty cell, never `none` or a dash: such a finding has none to show.
 */
function unboundSection(unbound: unknown): string | undefined {
  const entries = Array.isArray(unbound) ? unbound : [];
  if (entries.length === 0) return undefined;
  const rows = entries.map((raw) => {
    const entry = asRecord(raw);
    return [
      str(entry.path) ? codeCell(str(entry.path)!) : '',
      escapeCell(str(entry.property) ?? ''),
      escapeCell(str(entry.issue) ?? ''),
      entry.value === undefined ? '' : escapeCell(String(entry.value)),
    ];
  });
  return `## Unbound values\n\n${table(['Part', 'Property', 'Issue', 'Value'], rows).trimEnd()}`;
}

/**
 * `## Issues`: every `validation` row except `unbound-value` (already the
 * Unbound values table); omitted when none remain. Reads `validation` alone,
 * never `artifact.diagnostics`: `buildComponentArtifactV5`
 * (`componentContext.ts:767`) already folds each diagnostic into `validation`
 * with path and property added, so reading both would duplicate findings.
 */
function issuesSection(artifact: ComponentArtifactV5): string | undefined {
  const validation = Array.isArray(artifact.validation) ? artifact.validation : [];
  const lines: string[] = [];
  for (const raw of validation) {
    const row = asRecord(raw);
    if (str(row.id) === 'unbound-value') continue;
    lines.push(issueLine(row));
  }
  return lines.length === 0 ? undefined : `## Issues\n\n${lines.join('\n')}`;
}

/** @internal `escapeInline` for a finding message, leaving single-backtick code
 * spans as they are: a backslash inside one is literal (`font\_size`). An
 * unpaired backtick opens nothing, so it stays in the escaped text. */
function escapeMessage(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .split(/(`[^`]+`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/([\\*_<>[\]])/g, '\\$1')))
    .join('')
    .trim();
}

/** @internal One finding as `- severity: message (path, property)`, shared by
 * `## Issues` and the Foundation issues so both lists format alike. */
function issueLine(row: Record<string, unknown>): string {
  const severity = escapeInline(str(row.severity) ?? 'info');
  const message = escapeMessage(str(row.message) ?? '');
  const where = [
    str(row.path) ? code(str(row.path)!) : undefined,
    str(row.property) ? escapeInline(str(row.property)!) : undefined,
  ].filter((v): v is string => v !== undefined);
  return `- ${severity}: ${message}${where.length > 0 ? ` (${where.join(', ')})` : ''}`;
}

/** @internal The Foundation's actionable `validation` rows from the slice (a
 * style disagreeing with its bound token, a number no scope gives a unit), so a
 * page never shows disagreeing values without saying so. Omitted when empty;
 * codes the projection only counts never become rows. */
function foundationIssuesSection(
  rows: readonly FoundationValidationRow[] | undefined,
): string | undefined {
  if (!rows || rows.length === 0) return undefined;
  return `### Foundation issues\n\n${rows.map((row) => issueLine(asRecord(row))).join('\n')}`;
}

/** @internal One token value as `compactCanonicalValue` (`aiContext.ts:243`)
 * shapes it. `valueText` knows the literal; the other two would print as
 * `[object Object]`:
 *
 * - missing: `{ missing: reason }` -> `missing: <reason>`
 * - alias:   `{ alias, resolved | unresolved, chain? }` ->
 *   `<alias> (resolved: <value>)` or `<alias> (unresolved: <reason>)`, with
 *   a longer chain joined by `→` in place of the bare alias.
 *
 * Worded like `styleValueText` but kept apart: a style's `resolved` wraps its
 * value in `{ type, value }`, a token's is the value. The caller escapes. */
function tokenValueText(value: unknown): string {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.missing === 'string') return `missing: ${record.missing}`;
    if (typeof record.alias === 'string') {
      const chain = Array.isArray(record.chain)
        ? record.chain.filter((step): step is string => typeof step === 'string')
        : [];
      const steps = chain.length === 0
        ? [record.alias]
        : chain[0] === record.alias ? chain : [record.alias, ...chain];
      const target = steps.join(' → ');
      if (record.resolved !== undefined) return `${target} (resolved: ${valueText(record.resolved)})`;
      if (typeof record.unresolved === 'string') return `${target} (unresolved: ${record.unresolved})`;
      // Neither outcome stated: say what it points at and nothing more.
      return target;
    }
  }
  return valueText(value);
}

/**
 * `## Tokens used`: the Foundation slice the component needs, via
 * `componentFoundationAiSlice` rather than a second reading of
 * `references.foundation`. Always rendered: a foundation never read is a fact.
 */
function tokensUsedSection(artifact: ComponentArtifactV5): string {
  const slice = componentFoundationAiSlice(artifact);
  if (!slice) return `## Tokens used\n\n${NOT_READ_SENTENCE}`;
  const { compact } = slice;
  const parts = ['## Tokens used'];
  parts.push(
    `Foundation: collections ${compact.completeness.collections}, `
    + `styles ${compact.completeness.styles}.`,
  );
  if (compact.completeness.unavailable_sources.length > 0) {
    parts.push(`Unavailable sources: ${compact.completeness.unavailable_sources
      .map((source) => escapeInline(source)).join(', ')}.`);
  }
  for (const collection of compact.collections) {
    parts.push(`### ${escapeInline(collection.name)}`);
    const modes = collection.modes.map((mode) => (mode === collection.default_mode
      ? `${escapeInline(mode)} (default)`
      : escapeInline(mode)));
    parts.push(`Modes: ${modes.join(', ')}.`);
    const rows = collection.tokens.map((token) => [
      escapeCell(token.name),
      escapeCell(token.type),
      ...collection.modes.map((mode) => escapeCell(tokenValueText(token.values[mode]))),
      token.code_syntax
        ? Object.entries(token.code_syntax)
          .map(([platform, id]) => (id ? `${escapeCell(platform)} ${codeCell(id)}` : escapeCell(platform)))
          .join(', ')
        : '',
    ]);
    parts.push(table(
      ['Token', 'Type', ...collection.modes.map((mode) => escapeCell(mode)), 'Code syntax'],
      rows,
    ).trimEnd());
  }
  const typography = typographySection(compact.styles.typography);
  if (typography) parts.push(typography);
  const effects = effectsSection(compact.styles.effects);
  if (effects) parts.push(effects);
  const issues = foundationIssuesSection(compact.validation);
  if (issues) parts.push(issues);
  return parts.join('\n\n');
}

/** @internal Under the heading of every prose section a person did not write
 * (see AUTHORED_MARKER), so model prose is never mistaken for a designer's.
 * Never on a fact section. */
const AI_MARKER = '*Written by AI from the extracted facts, not read from Figma.*';

/** @internal The line for a section a person typed on the canvas, named under
 * `guidelines.authored` (or all, under `origin: authored`). Replaces AI_MARKER;
 * a section only partly authored keeps AI_MARKER. */
const AUTHORED_MARKER = '*Written on the Figma canvas, not generated by AI.*';

/** @internal AUTHORED_MARKER when every field of the section that carries
 * content is authored, else AI_MARKER (also when there is no authorship data). */
function markerFor(guidelines: Record<string, unknown>, fields: readonly string[]): string {
  if (guidelines.origin === 'authored') return AUTHORED_MARKER;
  const authored = Array.isArray(guidelines.authored) ? guidelines.authored : [];
  const present = fields.filter((f) => {
    const v = guidelines[f];
    return Array.isArray(v) ? v.length > 0 : Boolean(str(v));
  });
  return present.length > 0 && present.every((f) => authored.includes(f)) ? AUTHORED_MARKER : AI_MARKER;
}

/** @internal An ATX h1 or h2 with CommonMark's up-to-three-space indent. The
 * lookahead needs a space or end of line, as CommonMark does (`##Heading` is
 * text). Levels 3-6 are deep enough already. */
const ATX_H1_H2 = /^ {0,3}(#{1,2})(?= |$)/;

/** @internal A fence delimiter (three or more backticks or tildes); these blobs
 * are never nested deep enough to need more than `trim()`. */
const FENCE_MARKER = /^(`{3,}|~{3,})/;

/** @internal A setext underline candidate: one or more `=` (level 1) or one
 * or more `-` (level 2), and nothing else on the line. */
const SETEXT_UNDERLINE = /^(?:=+|-+)$/;

/**
 * Prose blobs are Markdown, so they are embedded, not escaped, and every
 * heading in one is demoted to at least `###` so model prose cannot open a
 * top-level section. This is the whole enforcement, so it walks line by line
 * to catch every CommonMark heading form:
 *
 * - ATX (`# Heading`, `## Heading`): demoted to `###`, leading indent dropped.
 * - Setext (a line, then a `=` or `-` underline): the underline is dropped and
 *   the line above becomes `### <text>`. A `-` line counts only when the line
 *   above (as emitted) is non-blank and not a heading or fence. A table
 *   separator or front-matter delimiter also matches, an accepted limit for
 *   prose blobs.
 *
 * An open fenced code block suspends all of this: a `#` comment or `---`
 * inside a sample is content, and demoting it would corrupt the sample.
 */
function demote(blob: string): string {
  const lines = blob.split('\n');
  const out: string[] = [];
  let inFence = false;

  const isHeadingOrFence = (line: string | undefined): boolean => {
    if (line === undefined) return false;
    const trimmed = line.trim();
    return /^#{1,6}(?= |$)/.test(trimmed) || FENCE_MARKER.test(trimmed);
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (FENCE_MARKER.test(trimmed)) {
      inFence = !inFence;
      out.push(rawLine);
      continue;
    }
    if (inFence) {
      out.push(rawLine);
      continue;
    }

    if (SETEXT_UNDERLINE.test(trimmed)) {
      const previous = out[out.length - 1];
      const previousIsBlank = previous === undefined || previous.trim() === '';
      if (!previousIsBlank && !isHeadingOrFence(previous)) {
        out[out.length - 1] = `### ${previous!.trim()}`;
        continue; // the underline itself never survives
      }
      out.push(rawLine); // a thematic break, or nothing eligible above it
      continue;
    }

    out.push(rawLine.replace(ATX_H1_H2, '###'));
  }

  return out.join('\n').trimEnd();
}

function proseSection(heading: string, blob: string, marker: string): string {
  return `## ${heading}\n\n${marker}\n\n${demote(blob)}`;
}

/**
 * `guidelines` as the artifact carries it: `guidelinesOf` (`brief.ts:371`)
 * snake_cases every field and drops `anatomyParts`, so reading only exact keys
 * leaves a stray camelCase field unread. `origin` and `authored` only choose
 * marker lines (`markerFor`).
 */
function overviewBlock(guidelines: Record<string, unknown>): string | undefined {
  const blob = str(guidelines.definition);
  return blob ? proseSection('Overview', blob, markerFor(guidelines, ['definition'])) : undefined;
}

/** The `anatomy_summary` paragraph and its marker, embedded under the existing
 * `## Anatomy` heading above the bullets, never a second heading. */
function anatomyProseParagraph(guidelines: Record<string, unknown>): string | undefined {
  const blob = str(guidelines.anatomy_summary);
  return blob ? `${markerFor(guidelines, ['anatomy_summary'])}\n\n${demote(blob)}` : undefined;
}

/**
 * One bullet per Do or Don't rule. A rule is a Markdown fragment (the prompt,
 * `prompt.ts:82` and `prompt.ts:177`, asks for bold lead-ins and code spans),
 * so it goes through `demote`, not escaping: escaping would print `\*\*` and
 * put a literal backslash inside a code span, fabricating text. Continuation
 * lines are indented two spaces so a multi-line rule stays in its bullet.
 */
function ruleList(items: unknown[]): string {
  const indent = (blob: string): string => blob
    .split('\n')
    .map((line, index) => (index === 0 || line === '' ? line : `  ${line}`))
    .join('\n');
  return items.map((item) => `- ${indent(demote(String(item)))}`).join('\n');
}

/** The prose sections after every fact section, in order: Variants, Do and
 * don't, Accessibility, Interactions, Content and Design considerations.
 * `componentMarkdown` places Overview and the Anatomy paragraph earlier. */
function restProseBlocks(guidelines: Record<string, unknown>): string[] {
  const blocks: string[] = [];
  const add = (heading: string, key: string): void => {
    const blob = str(guidelines[key]);
    if (blob) blocks.push(proseSection(heading, blob, markerFor(guidelines, [key])));
  };
  add('Variants', 'variants_summary');
  const dos = Array.isArray(guidelines.dos) ? guidelines.dos : [];
  const donts = Array.isArray(guidelines.donts) ? guidelines.donts : [];
  if (dos.length > 0 || donts.length > 0) {
    // Two labelled lists: CommonMark reads two bare lists split by a blank line
    // as one loose list, so nothing would mark the prohibitions. `###` matches
    // `demote`'s floor, so no rule can open a heading above these.
    const parts = [`## Do and don't`, markerFor(guidelines, ['dos', 'donts'])];
    if (dos.length > 0) parts.push('### Do', ruleList(dos));
    if (donts.length > 0) parts.push(`### Don't`, ruleList(donts));
    blocks.push(parts.join('\n\n'));
  }
  add('Accessibility', 'accessibility');
  add('Interactions', 'interactions');
  add('Content considerations', 'content_considerations');
  add('Design considerations', 'design_considerations');
  return blocks;
}

function frontMatter(artifact: ComponentArtifactV5): string {
  const envelope = componentEnvelope(artifact, 'markdown');
  return `---\n${toYaml(envelope as unknown as YamlValue)}---\n`;
}

export function componentMarkdown(artifact: ComponentArtifactV5): string {
  const component = asRecord(artifact.component);
  const guidelines = asRecord(artifact.guidelines);
  const blocks: string[] = [];

  // The schema requires a name, so a valid artifact always has one. The CLI
  // renders published bundles no schema check has passed, and a heading made
  // up for a nameless one would state a fact the artifact does not.
  const name = str(component.name);
  if (name === undefined) throw new Error('componentMarkdown needs component.name; the artifact has none.');
  if (!Array.isArray(artifact.anatomy)) {
    throw new Error('componentMarkdown needs anatomy as an array; the artifact has none.');
  }
  blocks.push(`# ${escapeHeading(name)}`);

  const description = str(component.description);
  if (description) blocks.push(escapeBlock(description));

  const related = Array.isArray(component.related)
    ? component.related.filter((r): r is string => typeof r === 'string')
    : [];
  if (related.length > 0) {
    blocks.push(`Related: ${related.map((r) => escapeInline(r)).join(', ')}`);
  }

  // `## Overview` sits before the fact sections, immediately after the lead.
  const overview = overviewBlock(guidelines);
  if (overview) blocks.push(overview);

  if (artifact.api !== undefined) {
    const section = propertiesSection(asRecord(artifact.api));
    if (section) blocks.push(section);
  }

  if (artifact.anatomy.length > 0) {
    const anatomyProse = anatomyProseParagraph(guidelines);
    const bullets = anatomyBullets(artifact.anatomy, 0).join('\n');
    const body = anatomyProse ? `${anatomyProse}\n\n${bullets}` : bullets;
    blocks.push(`## Anatomy\n\n${body}`);
  }

  if (artifact.layout !== undefined) {
    const section = layoutSection(asRecord(artifact.layout));
    if (section) blocks.push(section);
  }

  const bindings = bindingsSection(asRecord(artifact.references));
  if (bindings) blocks.push(bindings);

  blocks.push(tokensUsedSection(artifact));

  if (artifact.effects_inline !== undefined) {
    const section = effectsInlineSection(
      Array.isArray(artifact.effects_inline) ? artifact.effects_inline : [],
    );
    if (section) blocks.push(section);
  }

  const unbound = unboundSection(artifact.unbound);
  if (unbound) blocks.push(unbound);

  const issues = issuesSection(artifact);
  if (issues) blocks.push(issues);

  blocks.push(...restProseBlocks(guidelines));

  return `${frontMatter(artifact)}\n${blocks.join('\n\n')}\n`;
}
