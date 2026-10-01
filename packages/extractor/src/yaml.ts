/**
 * A deterministic YAML 1.2 emitter for the brief shapes in brief.ts, not a
 * general library: the shapes are closed and both ends are controlled. Tests
 * parse the output with js-yaml to prove the escaping, where a hand-rolled
 * emitter fails.
 *
 * Block style by default; short scalar-only collections go flow style
 * (flowText) so the brief stays compact enough to paste into a chat window.
 * Helpers return fully indented lines; a list item's nested block has its first
 * line's padding sliced off to follow "- ", never a regex de-indent.
 */

export type YamlValue =
  | string | number | boolean | null
  | YamlValue[]
  | { [k: string]: YamlValue | undefined };

/**
 * Plain scalars YAML would coerce to a non-string: numbers, booleans in every
 * spelling (including YAML 1.1 `yes`/`no`/`on`/`off`, which parsers still
 * honour), and null.
 */
const RESERVED_WORD = /^(y|n|yes|no|true|false|on|off|null|~)$/i;
const NUMERIC = /^[-+]?(\d[\d_]*(\.\d*)?([eE][-+]?\d+)?|\.\d+|0[xob][0-9a-fA-F_]+)$/;
/** YAML 1.1 special floats (`.inf`, `-.Inf`, `+.NAN`, ...). LEADING_INDICATOR
 *  catches a leading `-` but not `+`, so "+.inf" would round-trip as `null`. */
const SPECIAL_FLOAT = /^[-+]?\.(inf|nan)$/i;
const LEADING_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;
/** Any C0 control character: NUL through US (0x00-0x1F), including \n, \r, \t. */
const CONTROL_CHAR = /[\x00-\x1f]/;

function needsQuote(s: string): boolean {
  if (s === '') return true;
  if (LEADING_INDICATOR.test(s)) return true;
  if (/^\s|\s$/.test(s)) return true;
  if (s.includes(': ') || s.endsWith(':')) return true;
  if (s.includes(' #')) return true;
  if (RESERVED_WORD.test(s)) return true;
  if (SPECIAL_FLOAT.test(s)) return true;
  if (NUMERIC.test(s)) return true;
  if (CONTROL_CHAR.test(s)) return true;
  return false;
}

/** \uXXXX escape for a control character with no short mnemonic. */
function unicodeEscape(ch: string): string {
  return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
}

/**
 * Double-quoted style. A C0 control without a short escape becomes `\uXXXX`:
 * js-yaml refuses the raw byte ("non-printable characters").
 */
function doubleQuote(s: string): string {
  const body = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[\x00-\x1f]/g, (ch) => unicodeEscape(ch));
  return `"${body}"`;
}

/** A single-line scalar (map value or key): plain if safe, else double-quoted. */
function inlineScalar(s: string): string {
  return needsQuote(s) ? doubleQuote(s) : s;
}

/**
 * True when a value fits on its "key:" or "- " line: a scalar, or an empty
 * collection as "[]"/"{}". A string with `\r` is always inline (double-quoted):
 * a literal block scalar cannot represent a bare `\r` or `\r\n`.
 */
function isInline(value: YamlValue): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return true;
  if (typeof value === 'string') return value.includes('\r') || !value.includes('\n');
  if (Array.isArray(value)) return value.length === 0;
  return Object.values(value).filter((v) => v !== undefined).length === 0;
}

/** Render an inline value (see isInline) as the text that follows "key: " or "- ". */
function inlineText(value: YamlValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`yaml: cannot emit ${String(value)}`);
    return String(value);
  }
  if (typeof value === 'string') return inlineScalar(value);
  if (Array.isArray(value)) return '[]';
  return '{}';
}

/** Width budget for a flow collection, excluding indentation; past it block
 *  style reads better. */
const FLOW_MAX = 72;

/**
 * Flow-eligible: every member is an inline scalar or a flow-eligible
 * collection, so `when: { type: [Primary] }` qualifies. Bounded at two levels,
 * enough for every brief shape, so deep nesting never collapses into one line.
 */
function flowEligible(value: YamlValue, depth = 0): boolean {
  if (isInline(value)) return true;
  // A non-inline string is multi-line and belongs to the block-scalar path;
  // `Object.values` would split it into one-char "eligible" scalars.
  if (typeof value === 'string') return false;
  if (depth >= 2) return false;
  if (Array.isArray(value)) return value.every((m) => flowEligible(m, depth + 1));
  if (value === null || typeof value !== 'object') {
    // Unreachable (isInline excludes null and scalars); narrows without a cast.
    throw new Error(`yaml: flowEligible() called on a non-collection value: ${JSON.stringify(value)}`);
  }
  const members = Object.values(value).filter((v) => v !== undefined);
  if (members.length === 0) return true;
  return members.every((m) => flowEligible(m as YamlValue, depth + 1));
}

/** Flow terminators (`,` `{}` `[]`) that would end a collection early if
 *  unquoted; `needsQuote` covers block context only. */
const FLOW_UNSAFE = /[,{}[\]]/;

/** Flow context adds quoting triggers but shares `doubleQuote`, so the styles
 *  differ only in when they quote, never in how. */
function flowScalar(value: YamlValue): string {
  if (typeof value !== 'string') return inlineText(value);
  return needsQuote(value) || FLOW_UNSAFE.test(value) ? doubleQuote(value) : value;
}

/** Render a flow-eligible collection; scalars go through flowScalar. */
function flowText(value: YamlValue): string {
  if (isInline(value)) return flowScalar(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => flowText(v)).join(', ')}]`;
  }
  if (value === null || typeof value !== 'object') {
    // Unreachable: flowEligible accepted the value; narrows for Object.entries.
    throw new Error(`yaml: flowText() called on a non-collection value: ${JSON.stringify(value)}`);
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return `{ ${entries.map(([k, v]) => `${flowScalar(k)}: ${flowText(v as YamlValue)}`).join(', ')} }`;
}

/** Flow style only when it is eligible AND the result actually fits. */
function asFlow(value: YamlValue): string | null {
  if (isInline(value)) return null;
  if (!flowEligible(value)) return null;
  const text = flowText(value);
  return text.length <= FLOW_MAX ? text : null;
}

/**
 * A literal block scalar cannot auto-detect indentation when its first
 * non-empty line starts with a space: a later shorter line ends it early, or
 * every line loses its leading spaces. Leading blank lines are emitted empty,
 * hence `\n*`. js-yaml's own dumper applies the same test.
 */
const LEADING_SPACE = /^\n* /;

/**
 * A multi-line string (with `\n`, never `\r`; see isInline) as a block scalar.
 * Interior trailing whitespace round-trips without special-casing.
 *
 * Chomping: `|-` for no trailing newline, `|+` for one or more. Clip (`|`) is
 * never used: it loses data for "a\n\n" (loads as "a\n") and "\n" (loads as "").
 *
 * An indentation indicator (YAML 1.2, 8.1.1.1) only when LEADING_SPACE says
 * auto-detection would fail, so every other string is emitted unchanged. It is
 * relative to the parent's indentation: `indent - 2` for a map value or list
 * item, -1 for the top-level node (9.1.4, `s-l+block-node(-1, block-in)`), so a
 * top-level scalar at column 2 carries `3`.
 */
function blockScalarLines(s: string, indent: number, parentIndent: number): string[] {
  const pad = ' '.repeat(indent);
  let trailingNewlines = 0;
  while (trailingNewlines < s.length && s[s.length - 1 - trailingNewlines] === '\n') {
    trailingNewlines++;
  }
  const core = trailingNewlines === 0 ? s : s.slice(0, s.length - trailingNewlines);
  const chomping = trailingNewlines === 0 ? '-' : '+';
  const indentation = LEADING_SPACE.test(core) ? String(indent - parentIndent) : '';
  const indicator = `|${indentation}${chomping}`;
  const extraBlankLines = trailingNewlines >= 1 ? trailingNewlines - 1 : 0;
  const contentLines = core.split('\n').concat(Array(extraBlankLines).fill(''));
  return [indicator, ...contentLines.map((l) => (l === '' ? '' : pad + l))];
}

/** One map entry as full output lines, e.g. ["key: value"] or ["key:", "  nested: 1"]. */
function emitMapEntry(key: string, value: YamlValue, indent: number): string[] {
  const pad = ' '.repeat(indent);
  const k = inlineScalar(key);
  if (isInline(value)) {
    return [`${pad}${k}: ${inlineText(value)}`];
  }
  const flow = asFlow(value);
  if (flow !== null) {
    return [`${pad}${k}: ${flow}`];
  }
  if (typeof value === 'string') {
    const [indicator, ...lines] = blockScalarLines(value, indent + 2, indent);
    return [`${pad}${k}: ${indicator}`, ...lines];
  }
  return [`${pad}${k}:`, ...blockLines(value, indent + 2)];
}

/** One list item as full output lines, e.g. ["- value"] or ["- name: a", "  n: 1"]. */
function emitListItem(value: YamlValue, indent: number): string[] {
  const pad = ' '.repeat(indent);
  if (isInline(value)) {
    return [`${pad}- ${inlineText(value)}`];
  }
  const flow = asFlow(value);
  if (flow !== null) {
    return [`${pad}- ${flow}`];
  }
  if (typeof value === 'string') {
    const [indicator, ...lines] = blockScalarLines(value, indent + 2, indent);
    return [`${pad}- ${indicator}`, ...lines];
  }
  // Nested lines sit at indent+2, the width of `pad + "- "`, so the first
  // line's padding is swapped for "- ".
  const lines = blockLines(value, indent + 2);
  const first = lines[0].slice(indent + 2);
  return [`${pad}- ${first}`, ...lines.slice(1)];
}

/** Full block lines for a non-empty array or map (never called on an inline value). */
function blockLines(value: YamlValue, indent: number): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => emitListItem(item, indent));
  }
  if (value === null || typeof value !== 'object') {
    // Unreachable (callers exclude inline values); keeps this total without a cast.
    throw new Error(`yaml: blockLines() called on a non-collection value: ${JSON.stringify(value)}`);
  }
  const entries = Object.entries(value).filter((e): e is [string, YamlValue] => e[1] !== undefined);
  return entries.flatMap(([k, v]) => emitMapEntry(k, v, indent));
}

export function toYaml(value: YamlValue): string {
  if (isInline(value)) return inlineText(value) + '\n';
  if (typeof value === 'string') {
    // The bare document's parent indentation is -1 (YAML 1.2, 9.1.4).
    const [indicator, ...lines] = blockScalarLines(value, 2, -1);
    return [indicator, ...lines].join('\n') + '\n';
  }
  return blockLines(value, 0).join('\n') + '\n';
}
