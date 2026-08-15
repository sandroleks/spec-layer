/**
 * yaml.ts — a deterministic YAML emitter for the brief shapes in brief.ts.
 *
 * Deliberately NOT a general YAML library. Both ends of this format are
 * controlled, the shapes are closed, and the output is snapshot-tested, so
 * shipping a general parser into a plugin bundle would buy nothing. The tests
 * parse this emitter's output with js-yaml (a dev dependency) to prove the
 * escaping is right, which is where a hand-rolled emitter actually fails.
 *
 * Emits YAML 1.2 block style only: no flow maps, no anchors, no tags.
 *
 * Implementation note: every internal helper below returns fully-formed,
 * already-indented lines (an array of strings, one per output line) rather
 * than building strings via leading-newline conventions and regex de-indent.
 * A list item's nested map/array is produced as normal lines at indent+2,
 * then its first line has that same padding stripped off so it can follow
 * "- " on one line — a plain string slice, not a regex de-indent, so it can't
 * misfire on content that happens to start with spaces.
 */

export type YamlValue =
  | string | number | boolean | null
  | YamlValue[]
  | { [k: string]: YamlValue | undefined };

/**
 * Characters that change a plain scalar's meaning in block context, plus the
 * shapes YAML would coerce to a non-string: numbers, booleans in all their
 * spellings, and null. `yes`/`no`/`on`/`off` are YAML 1.1 booleans that many
 * parsers still honour, so they are quoted defensively.
 */
const RESERVED_WORD = /^(y|n|yes|no|true|false|on|off|null|~)$/i;
const NUMERIC = /^[-+]?(\d[\d_]*(\.\d*)?([eE][-+]?\d+)?|\.\d+|0[xob][0-9a-fA-F_]+)$/;
/**
 * The YAML 1.1 special floats, unsigned or signed, in any case:
 * `.inf`, `.Inf`, `.INF`, `-.inf`, `+.inf`, `.nan`, `.NaN`, `.NAN`, etc.
 * Needs its own pattern rather than relying on LEADING_INDICATOR: that class
 * catches a leading `-` but not `+`, so "+.inf" would otherwise slip through
 * unquoted and round-trip as `null`.
 */
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
 * Double-quoted style. `\\`, `"`, and the three control chars with standard
 * short escapes come first; every other C0 control character (NUL, BEL, VT,
 * ESC, etc.) is escaped as `\uXXXX` -- the raw byte is otherwise embedded
 * unchanged and js-yaml refuses to parse it ("non-printable characters").
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

/**
 * A single-line scalar: plain if safe, double-quoted if not. Used both for
 * map values (never called with a multi-line string) and for map keys.
 */
function inlineScalar(s: string): string {
  return needsQuote(s) ? doubleQuote(s) : s;
}

/**
 * True when a value can be written on the same line as its "key:" or "- "
 * (a scalar, or an empty collection rendered as "[]"/"{}"). False for
 * non-empty arrays/maps and for multi-line strings that need a block form.
 *
 * A string containing `\r` is always inline, even if it also contains `\n`:
 * a YAML literal block scalar has no way to represent a bare `\r` or a
 * `\r\n` pair, so such strings fall back to the double-quoted inline form
 * (via needsQuote's control-character check) instead of silently losing the
 * `\r` bytes to a literal block scalar.
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

/**
 * A multi-line string as a YAML block scalar. Only called for strings that
 * contain `\n` and no `\r` -- isInline() routes anything containing `\r` to
 * the double-quoted inline form instead, since a literal block scalar has no
 * way to represent a bare `\r` or `\r\n` pair (js-yaml silently drops the
 * `\r` bytes on load rather than erroring, which is worse than a crash).
 * Trailing whitespace on an interior line, by contrast, round-trips through
 * a literal block scalar without any special-casing -- verified against
 * js-yaml directly -- so no fallback is needed for that case.
 *
 * Chomping indicator is picked from the number of trailing newlines in `s`:
 * `|-` (strip) for zero, `|+` (keep) for one or more. The brief's sketch used
 * clip (bare `|`) for "exactly one trailing newline", which silently drops
 * data in two cases verified by this module's tests: a string with two or
 * more trailing newlines (e.g. "a\n\n" round-trips to "a\n" under clip), and
 * a string that is entirely blank (e.g. "\n" round-trips to "" under clip,
 * because clip strips a wholly-blank scalar's only line along with it).
 * Keep chomping reproduces every trailing newline exactly in both cases, so
 * it is used uniformly whenever the count is nonzero -- clip is never used.
 */
function blockScalarLines(s: string, indent: number): string[] {
  const pad = ' '.repeat(indent);
  let trailingNewlines = 0;
  while (trailingNewlines < s.length && s[s.length - 1 - trailingNewlines] === '\n') {
    trailingNewlines++;
  }
  const core = trailingNewlines === 0 ? s : s.slice(0, s.length - trailingNewlines);
  const indicator = trailingNewlines === 0 ? '|-' : '|+';
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
  if (typeof value === 'string') {
    const [indicator, ...lines] = blockScalarLines(value, indent + 2);
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
  if (typeof value === 'string') {
    const [indicator, ...lines] = blockScalarLines(value, indent + 2);
    return [`${pad}- ${indicator}`, ...lines];
  }
  // Non-empty nested array or map: its lines are already indented by indent+2,
  // which is exactly the width of `pad + "- "`, so the first line's padding
  // is stripped and replaced by "- " to put it on the same line.
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
    // Unreachable given the call sites (each already excludes inline values,
    // which covers null/boolean/number/string), but keeps this function
    // total instead of relying on an unsafe cast at every call site.
    throw new Error(`yaml: blockLines() called on a non-collection value: ${JSON.stringify(value)}`);
  }
  const entries = Object.entries(value).filter((e): e is [string, YamlValue] => e[1] !== undefined);
  return entries.flatMap(([k, v]) => emitMapEntry(k, v, indent));
}

export function toYaml(value: YamlValue): string {
  if (isInline(value)) return inlineText(value) + '\n';
  if (typeof value === 'string') {
    const [indicator, ...lines] = blockScalarLines(value, 2);
    return [indicator, ...lines].join('\n') + '\n';
  }
  return blockLines(value, 0).join('\n') + '\n';
}
