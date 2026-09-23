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
import { valueText } from './aiContext';
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

/** @internal `escapeInline` plus the cell separator, escaped in ONE pass.
 *
 * The pipe is in the same character class as the backslash rather than added
 * by a second `.replace`, so the escape character can never be escaped after
 * the delimiter it is supposed to protect. Composing two passes happened to
 * be correct here, because `escapeInline` runs first, but that correctness
 * was an ordering accident a later edit could silently undo, and the same
 * accident in `codeCell` was a real defect: it destroyed a table cell whose
 * value held a backslash before a pipe. One pass removes the ordering
 * question entirely. Verified byte-identical to the two-pass form over every
 * string up to length three drawn from the characters either form touches. */
export function escapeCell(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/([\\*_<>[\]|])/g, '\\$1')
    .trim();
}

/** @internal `escapeInline` plus the two characters that could make a
 * hostile component name read as something other than the literal text of
 * the H1 title: a leading `#` (escaped only at position zero, so a name that
 * happens to be reused as the whole content of some other line can never be
 * mistaken for a fresh ATX heading) and every `|` (a table cell boundary
 * elsewhere in this document, escaped here purely for consistency with how
 * the same name renders in a table row). Used only for the title -- every
 * other value that could legitimately start with `#` (a hex color, for
 * instance) reaches the page through `escapeCell`/`escapeInline` alone, and
 * must not gain this extra escaping or the golden `#6750a4` token value
 * would corrupt into `\#6750a4`. */
function escapeHeading(text: string): string {
  // `escapeCell` has already escaped the backslash and the pipe in one pass,
  // so the only thing left is the leading hash, which a character class
  // cannot express because it matters at position zero and nowhere else.
  return escapeCell(text).replace(/^#/, '\\#');
}

/** @internal `escapeInline` plus the constructs that open a BLOCK when they
 * lead a line. Used for the one slot where designer-authored free text is
 * pushed as its own top-level block: the component description, which sits
 * directly under the H1. `escapeInline` alone is not enough there, because it
 * neutralises inline markup only: a description beginning with a triple
 * backtick would open a fenced code block that swallows every table and
 * section below it, one beginning with `##` would forge a section heading the
 * renderer never produced, and one beginning with `#` would emit a second H1.
 *
 * `escapeInline` has already collapsed every newline to a space and trimmed
 * the result, so only the START of that single line can open anything and one
 * backslash there is enough. The backslash is a Markdown escape, so the
 * character the designer typed is what the reader sees.
 *
 * Deliberately NOT `escapeHeading`: that also escapes every `|`, which is a
 * cell boundary in a table row and nothing at all in a paragraph, so reusing
 * it here would leave a visible stray backslash in prose rather than a needed
 * escape.
 *
 * `>`, `*` and `_` are absent from the list because `escapeInline` has
 * already escaped them, so they can never lead its result; adding them here
 * would be an alternative that can never match. One or two backticks (or
 * tildes) are left alone because a run shorter than three cannot open a
 * fenced block, and escaping it would turn a description that legitimately
 * opens with an inline code span into literal backticks. */
function escapeBlock(text: string): string {
  return escapeInline(text)
    .replace(/^(`{3,}|~{3,}|[#=+-])/, '\\$1')
    // An ordered list marker is up to nine digits followed by `.` or `)`;
    // escaping the delimiter is what stops CommonMark reading it as a list,
    // and renders as the digits and the delimiter the designer typed.
    .replace(/^(\d{1,9})([.)])/, '$1\\$2');
}

/** @internal Inline code with a fence longer than any run of backticks inside. */
export function code(text: string): string {
  const flat = text.replace(/\r?\n/g, ' ');
  const longest = (flat.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  return longest === 0 ? `${fence}${flat}${fence}` : `${fence} ${flat} ${fence}`;
}

/** @internal `code`, plus escaping for the one character a GFM table row
 * splitter treats as a cell boundary even inside a matched pair of
 * backticks: cell splitting runs on the raw line, before backtick spans are
 * parsed, so `` `a|b` `` as a whole cell's content genuinely widens that row
 * by one column -- wrapping a path in backticks does not, by itself, make an
 * embedded `|` safe. A backslash-escaped pipe is honoured by that splitter
 * even inside backticks and still renders as a literal `|` once the code
 * span is finalised (verified against `mdast-util-gfm-table`), so this is
 * safe everywhere it is used. It is deliberately NOT used by `anatomyBullets`
 * or the `## Issues` bullet list: those spans sit in prose, never a table
 * cell, where a stray backslash would be a fabricated character rather than
 * a needed escape. */
function codeCell(text: string): string {
  // A literal backslash has NO encoding inside a code span in a GFM table
  // row. `\|` is the only escape the row splitter honours there, so a
  // backslash immediately before a pipe is inexpressible. Verified against
  // remark-gfm: `a\|b` wrapped by the branch below renders as the row
  // `` `a\\|b` ``, whose code span is destroyed and whose remaining text is
  // silently dropped from the cell, and escaping the backslash as well
  // renders a doubled backslash the designer never typed. Plain escaped text
  // round-trips every one of those inputs exactly, so a value carrying a
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

// `componentLayout` emits exactly one scope value today
// (`componentContext.ts:500`). Every member of this map must be a value the
// extractor actually produces: inventing a sentence for a scope that does not
// exist is the never-fabricate rule broken in the renderer itself.
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

const NOT_READ_SENTENCE =
  'Token values are not included: the foundations had not been read when this was exported.';

/** @internal Renders one typography `StyleProperty`, as `compactStyleProperty`
 * (`aiContext.ts:306`) actually shapes it. That function emits exactly four
 * shapes, and each is handled explicitly rather than falling through to the
 * shared `valueText` -- which knows none of them and would silently print
 * `[object Object]`, a never-fabricate violation in a document a coding agent
 * reads as fact:
 *
 * 1. literal, resolved:   `{ type, value }`               -> `valueText(value)`
 * 2. literal, unresolved: `{ missing: reason }`            -> `missing: <reason>`
 * 3. alias, resolved:     `{ alias, resolved: { value } }` -> `<alias> (resolved: <value>)`
 * 4. alias, unresolved:   `{ alias, unresolved: reason }`  -> `<alias> (unresolved: <reason>)`
 *
 * The caller wraps this function's return value in `escapeCell`, same as
 * every other cell in this table, so an alias name containing `|` cannot
 * break the row -- there is deliberately no second escape here. Anything
 * else (a shape this function does not recognise) still falls back to
 * `valueText`, unchanged, per the plan's resolution: a value shape `valueText`
 * renders wrongly is a stop-and-report, not a fork of `valueText` itself. */
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

// Deliberately does not render `paragraph_spacing`, `text_case` or
// `text_decoration`: an honest scope cut to the properties most useful for an
// implementer, not an oversight. Extend the table and this comment together
// if a later task needs them.
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
  // A hidden layer must read differently from an active one: `visible` is a
  // real Figma fact (`EffectV5.visible`), and silently dropping it would have
  // a coding agent implement a shadow the designer turned off. `visible ===
  // true` and an absent `visible` both stay unmarked -- the unmarked case is
  // the normal one, and stating it on every row would only be noise.
  return effect.visible === false ? `${summary} (hidden)` : summary;
}

function effectsSection(items: unknown[]): string | undefined {
  if (items.length === 0) return undefined;
  const rows = items.map((raw) => {
    const style = asRecord(raw);
    const mode = str(style.mode);
    const effects = Array.isArray(style.effects) ? style.effects : [];
    // Layers are joined with `; `, one level up from the `, ` a single
    // layer's own fields use, so a reader can find the boundary between two
    // layers -- otherwise ambiguous whenever two layers share a `type`.
    const summary = effects.map((effect) => effectSummary(asRecord(effect))).join('; ');
    return [escapeCell(str(style.name) ?? ''), mode ? escapeCell(mode) : '', escapeCell(summary)];
  });
  return [
    '### Effect styles',
    table(['Style', 'Mode', 'Effects'], rows).trimEnd(),
  ].join('\n\n');
}

/**
 * One inline effect layer, as `exactEffectLayer` (`componentContext.ts:510`)
 * actually shapes it: the RAW `EffectLayer` record (`effects.ts:44`), not
 * `compactEffect`'s compacted AI-profile shape. The two are unrelated: a raw
 * layer nests its offset in `offset: {x,y}` rather than separate `offset_x`/
 * `offset_y` typed envelopes, names its blur radius `radius` rather than
 * `blur`, and carries a plain `Rgba` (`{hex, alpha}`) rather than a
 * `compactTypedValue` color -- so `effectSummary` (`compactEffect`'s renderer,
 * above) would read every one of those fields as `undefined` and print
 * nothing but the bare effect type. This renders each of the nine concrete
 * shapes `EffectLayer` can be explicitly, using only the fields that shape
 * actually carries, plus any per-field variable binding `exactEffectLayer`
 * attached. Returns plain text; the caller escapes once, after joining every
 * layer for a part.
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
 * The `## Effects` section: inline effects applied directly to component
 * parts (`artifact.effects_inline`), distinct from `## Tokens used`'s
 * `### Effect styles` subsection above, which renders the Foundation's
 * SHARED effect styles from `compactEffect`'s compacted shape. This section
 * has no relation to that one beyond both describing shadows and blurs.
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
 * The `## Unbound values` section: `artifact.unbound`, one row per
 * `{ path, property, issue, value? }` entry. An absent `value` renders as an
 * empty cell -- never `none`, never a dash -- because `unbound-value` findings
 * without a value (e.g. a missing token binding) genuinely have none to show.
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
 * The `## Issues` section: every `validation` row that is not an
 * `unbound-value` finding (those are already the Unbound values table above,
 * and repeating them here would double-count the same fact). Omitted
 * entirely when there is none -- including when every validation row is an
 * `unbound-value` finding, which is exactly the golden Button's case.
 *
 * Deliberately reads `validation` ALONE and never `artifact.diagnostics`.
 * `buildComponentArtifactV5` (`componentContext.ts:767`) already folds every
 * diagnostic into `validation` via `componentDiagnosticRows`, which adds
 * `path`/`property` a raw diagnostic does not carry -- so `validation`'s
 * copy of a diagnostic is strictly more informative than the diagnostic
 * itself, and iterating both would render the same finding twice, the
 * duplicate being the worse of the two renderings.
 */
function issuesSection(artifact: ComponentArtifactV5): string | undefined {
  const validation = Array.isArray(artifact.validation) ? artifact.validation : [];
  const lines: string[] = [];
  for (const raw of validation) {
    const row = asRecord(raw);
    if (str(row.id) === 'unbound-value') continue;
    const severity = escapeInline(str(row.severity) ?? 'info');
    const message = escapeInline(str(row.message) ?? '');
    const where = [
      str(row.path) ? code(str(row.path)!) : undefined,
      str(row.property) ? escapeInline(str(row.property)!) : undefined,
    ].filter((v): v is string => v !== undefined);
    lines.push(`- ${severity}: ${message}${where.length > 0 ? ` (${where.join(', ')})` : ''}`);
  }
  return lines.length === 0 ? undefined : `## Issues\n\n${lines.join('\n')}`;
}

/**
 * The `## Tokens used` section: the Foundation dependency slice a component
 * needs, reusing `componentFoundationAiSlice` for the join, the mode-name
 * mapping and the value formatting rather than a second interpretation of
 * `artifact.references.foundation`. Always renders, even when the foundation
 * was never read, because that absence is itself a fact worth stating.
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
      ...collection.modes.map((mode) => escapeCell(valueText(token.values[mode]))),
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
  return parts.join('\n\n');
}

/** @internal The honesty invariant made visible: every prose section carries
 * this exact line directly under its heading, so a reader can never mistake
 * model-written prose for something a designer wrote. Never appears on a
 * fact section. */
const AI_MARKER = '*Written by AI from the extracted facts, not read from Figma.*';

/** @internal An ATX heading of level 1 or 2, CommonMark-legal indentation
 * (up to three leading spaces) included. Levels 3-6 are already deep enough
 * and are left alone; the lookahead requires a following space or end of
 * line, exactly as CommonMark itself does, so `##Heading` (no space) is
 * plain text, not a heading. */
const ATX_H1_H2 = /^ {0,3}(#{1,2})(?= |$)/;

/** @internal A line that is a fenced code block delimiter (three or more
 * backticks or tildes, CommonMark allows leading indentation here too, but
 * these blobs are never that deeply nested so a bare `trim()` is enough). */
const FENCE_MARKER = /^(`{3,}|~{3,})/;

/** @internal A setext underline candidate: one or more `=` (level 1) or one
 * or more `-` (level 2), and nothing else on the line. */
const SETEXT_UNDERLINE = /^(?:=+|-+)$/;

/**
 * Prose blobs are already Markdown (bullets, bold lead-ins, sub-headings),
 * so they are embedded rather than escaped. Every heading inside one is
 * demoted to at least `###`, so a model-written heading cannot open a
 * top-level section the renderer itself did not -- this is the ENTIRE
 * enforcement of that invariant, so it walks the blob line by line rather
 * than running one regex over the whole string, to close every CommonMark
 * way a heading can be spelled:
 *
 * - ATX (`# Heading`, `## Heading`): demoted to `###`, dropping any leading
 *   indentation together with the original hashes (indentation is not
 *   preserved -- a demoted heading reads the same left-aligned as every
 *   other one this renderer produces).
 * - Setext (`Heading` followed by a line of `=` or `-`): the underline line
 *   is dropped and the paragraph line above it becomes `### <text>`. A line
 *   of `-` is only treated as a setext underline when the line directly
 *   above it (as already emitted, i.e. after any of its own demotion) is
 *   non-blank and not itself a heading or fence delimiter -- a blank line
 *   above it makes it a thematic break, and both a table separator row and
 *   a front-matter delimiter also always follow non-blank text, which this
 *   line-by-line heuristic cannot distinguish from a real setext heading.
 *   That is a known, accepted limitation: these blobs are prose, not full
 *   documents with tables or front matter.
 *
 * Fenced code blocks (three or more backticks or tildes) suspend ALL of the
 * above while open: a `#`-prefixed comment or a `---`-shaped divider inside
 * a fenced sample is sample content, never a heading, and demoting it would
 * corrupt the sample.
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

function proseSection(heading: string, blob: string): string {
  return `## ${heading}\n\n${AI_MARKER}\n\n${demote(blob)}`;
}

/**
 * `guidelines` exactly as the ARTIFACT carries it: `guidelinesOf`
 * (`brief.ts:371`) renames every field to snake_case on the way in and drops
 * `anatomyParts` entirely. Reading only the exact keys below means a stray
 * camelCase field -- or `anatomyParts` itself -- is silently unread rather
 * than rendered, and `origin` is excluded from every section by
 * construction (no function here ever reads it), never by a filter.
 */
function overviewBlock(guidelines: Record<string, unknown>): string | undefined {
  const blob = str(guidelines.definition);
  return blob ? proseSection('Overview', blob) : undefined;
}

/** The `anatomy_summary` paragraph plus its own marker line, meant to be
 * embedded inside the existing `## Anatomy` heading above the bullets
 * (rendered separately, below) -- never a second `## Anatomy` heading. */
function anatomyProseParagraph(guidelines: Record<string, unknown>): string | undefined {
  const blob = str(guidelines.anatomy_summary);
  return blob ? `${AI_MARKER}\n\n${demote(blob)}` : undefined;
}

/**
 * One bullet per Do or Don't rule. Each rule is a Markdown FRAGMENT, not
 * plain text, exactly like every other prose field: the prose prompt
 * (`prompt.ts:82`) tells the model to open each rule with a short bold
 * lead-in, and its own exemplars (`prompt.ts:177`) carry inline code spans.
 * Escaping them would print `\*\*` where the bold was meant, and -- worse --
 * would put a backslash INSIDE a code span, where a backslash is a literal
 * character rather than an escape: a page reading `` `\<a>` `` tells a coding
 * agent to write a tag no artifact ever mentioned, which is the never-
 * fabricate rule broken in the renderer itself. So each rule goes through
 * `demote`, which floors any heading a model wrote inside it at `###` just as
 * it does for a whole blob. Continuation lines are indented two spaces so a
 * rule that arrives with a line break stays inside its own bullet instead of
 * closing the list.
 */
function ruleList(items: unknown[]): string {
  const indent = (blob: string): string => blob
    .split('\n')
    .map((line, index) => (index === 0 || line === '' ? line : `  ${line}`))
    .join('\n');
  return items.map((item) => `- ${indent(demote(String(item)))}`).join('\n');
}

/** The prose sections that follow every fact section: `## Variants`,
 * `## Do and don't`, `## Accessibility`, `## Interactions`,
 * `## Content considerations`, `## Design considerations`, in that order.
 * `## Overview` and the `## Anatomy` paragraph are placed earlier in the
 * document by `componentMarkdown` itself, so they are not part of this list. */
function restProseBlocks(guidelines: Record<string, unknown>): string[] {
  const blocks: string[] = [];
  const add = (heading: string, key: string): void => {
    const blob = str(guidelines[key]);
    if (blob) blocks.push(proseSection(heading, blob));
  };
  add('Variants', 'variants_summary');
  const dos = Array.isArray(guidelines.dos) ? guidelines.dos : [];
  const donts = Array.isArray(guidelines.donts) ? guidelines.donts : [];
  if (dos.length > 0 || donts.length > 0) {
    // Two labelled lists, not two unlabelled ones. A bare `-` list followed
    // by a blank line and another bare `-` list is ONE loose list to
    // CommonMark, so without these subheadings nothing in the page says which
    // rules are prohibitions -- a reader would have to infer it from the
    // wording of each rule. `###` is the right level: the section itself is
    // `##`, and `demote` floors a model-written heading at `###` too, so a
    // rule can never open a heading above these.
    const parts = [`## Do and don't`, AI_MARKER];
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
    // `anatomy_summary` extends this heading with a marked paragraph above
    // the bullets Task 5 already renders, rather than opening a second
    // `## Anatomy` heading of its own.
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

  // The remaining prose sections follow every fact section.
  blocks.push(...restProseBlocks(guidelines));

  return `${frontMatter(artifact)}\n${blocks.join('\n\n')}\n`;
}
