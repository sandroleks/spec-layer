/**
 * v2.ts: the structured prose contract the canvas renders.
 *
 * ProseDrafts (v1) is markdown blobs; ProseV2 is arrays and pairs, so a name
 * the model uses can be checked against the spec before it is drawn, and a
 * card, table row or bullet can be rebuilt from stored data without parsing
 * markdown again. The v9 prompt produces v2 directly, so `upgradeProseV1`
 * now serves only the read-back of prose an earlier build stored, and
 * `proseToLegacy` hands the brief and the v5 artifact the v1 shape they
 * still read.
 *
 * No Figma, no DOM: this file is imported by the plugin's main thread.
 */
import type { IntermediateSpec } from '../extract';
import type { ProseDrafts } from './prompt';
import { replaceAround } from './prompt';

export interface GuidelineCard { rule: string; reason: string }
export interface GuidelinePair { do: GuidelineCard | null; dont: GuidelineCard | null }

export interface ProseV2 {
  v: 2;
  overview?: { lede: string; body: string[] };
  whenToUse?: string[];
  whenNotToUse?: string[];
  variantsIntro?: string;
  variantsGuide?: { name: string; guidance: string }[];
  anatomySummary?: string;
  anatomyParts?: { name: string; role: string }[];
  properties?: { name: string; description: string }[];
  states?: { name: string; whenItApplies: string }[];
  keyboard?: { keys: string[]; action: string }[];
  pointer?: string[];
  semantics?: string[];
  content?: string[];
  guidelines?: GuidelinePair[];
  /**
   * The keys whose content a person typed on the canvas into a placeholder,
   * so the export can say who wrote them. Not a prose key: it is metadata
   * about the keys above, never counted as content, never sent to or asked of
   * the model, and omitted when empty. Read through `normalizeAuthored`.
   */
  authored?: ProseV2Key[];
}

export type ProseV2Key = Exclude<keyof ProseV2, 'v' | 'authored'>;

export const PROSE_V2_KEYS: readonly ProseV2Key[] = [
  'overview', 'whenToUse', 'whenNotToUse', 'variantsIntro', 'variantsGuide',
  'anatomySummary', 'anatomyParts', 'properties', 'states', 'keyboard',
  'pointer', 'semantics', 'content', 'guidelines',
];

/** A stored `authored` value as the known prose keys it names, each once, in
 *  PROSE_V2_KEYS order. Anything else (an unknown entry, a non-array) is
 *  dropped, never thrown on. */
export function normalizeAuthored(value: unknown): ProseV2Key[] {
  if (!Array.isArray(value)) return [];
  return PROSE_V2_KEYS.filter((key) => value.includes(key));
}

/** The keyboard vocabulary. A row whose key is not one of these is dropped. */
export const KEYBOARD_KEYS: readonly string[] = [
  'Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape', 'Arrow Up', 'Arrow Down',
  'Arrow Left', 'Arrow Right', 'Home', 'End', 'Page Up', 'Page Down', 'Delete', 'Backspace',
];

const ARROWS = ['Arrow Up', 'Arrow Down', 'Arrow Left', 'Arrow Right'];

/**
 * Bare `up`/`down`/`left`/`right`/`return` are deliberately absent: those are
 * ordinary English words ("Down the list, focus wraps.", "Return focus to
 * the trigger.") and accepting them as keys fabricates a binding table row
 * out of plain prose that `validateProseV2` cannot catch afterwards, because
 * a fabricated row still names a real vocabulary key. An arrow or Enter must
 * be spelled out as a key: "Arrow Down", "Down Arrow", "Down Key", or the
 * glyph. `Space`, `Home`, `End`, `Enter`, `Tab`, `Escape`, `Delete`,
 * `Backspace`, `Page Up` and `Page Down` keep their bare forms: those words
 * do not open ordinary sentences about component behaviour the way the
 * directional words and "return" do.
 */
const KEY_ALIASES: Record<string, string[]> = {
  tab: ['Tab'], shifttab: ['Shift+Tab'], enter: ['Enter'], returnkey: ['Enter'], space: ['Space'],
  spacebar: ['Space'], escape: ['Escape'], esc: ['Escape'],
  arrowup: ['Arrow Up'], uparrow: ['Arrow Up'], upkey: ['Arrow Up'], '↑': ['Arrow Up'],
  arrowdown: ['Arrow Down'], downarrow: ['Arrow Down'], downkey: ['Arrow Down'], '↓': ['Arrow Down'],
  arrowleft: ['Arrow Left'], leftarrow: ['Arrow Left'], leftkey: ['Arrow Left'], '←': ['Arrow Left'],
  arrowright: ['Arrow Right'], rightarrow: ['Arrow Right'], rightkey: ['Arrow Right'], '→': ['Arrow Right'],
  arrowkeys: ARROWS, arrows: ARROWS,
  home: ['Home'], end: ['End'], pageup: ['Page Up'], pagedown: ['Page Down'],
  delete: ['Delete'], del: ['Delete'], backspace: ['Backspace'],
};

/** Canonical key names for one spelling, or null when it is not in the
 *  vocabulary. "Arrow keys" expands to the four arrows. */
export function normalizeKey(raw: string): string[] | null {
  const folded = raw.toLowerCase().replace(/[\s+_-]+/g, '');
  const direct = KEY_ALIASES[folded];
  if (direct) return direct;
  const stripped = folded.replace(/key$/, '');
  return KEY_ALIASES[stripped] ?? null;
}

const KEY_SEPARATOR = /\s*(?:\bor\b|\band\b|\/|,)\s*/i;

/**
 * Read a v1 keyboard bullet as a table row. The sentence must open with one or
 * more vocabulary keys joined by "or", "and", a slash or a comma; the rest is
 * the action, capitalised. Anything else is not a keyboard row.
 */
export function parseKeyboardBullet(text: string): { keys: string[]; action: string } | null {
  const line = text.replace(/^[-*]\s+/, '').trim();
  const words = line.split(/\s+/);
  // Try the longest key prefix first (up to six words covers "Tab / Shift+Tab move").
  for (let n = Math.min(words.length - 1, 6); n >= 1; n -= 1) {
    const head = words.slice(0, n).join(' ');
    const parts = head.split(KEY_SEPARATOR).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const keys: string[] = [];
    let ok = true;
    for (const part of parts) {
      const k = normalizeKey(part);
      if (!k) { ok = false; break; }
      keys.push(...k);
    }
    if (!ok) continue;
    const rest = words.slice(n).join(' ').trim();
    if (!rest) continue;
    return { keys: [...new Set(keys)], action: rest.charAt(0).toUpperCase() + rest.slice(1) };
  }
  return null;
}

/** Split a paragraph into its first sentence and the remainder. A sentence
 *  ends at the first `.`, `!` or `?` followed by whitespace and a capital or
 *  `(`, so "e.g. a Toggle" and "3.5 items" do not end it. */
export function firstSentence(text: string): { sentence: string; remainder: string } {
  const t = text.trim();
  const m = /[.!?](?=\s+[A-Z(])/.exec(t);
  if (!m) return { sentence: t, remainder: '' };
  const end = m.index + 1;
  return { sentence: t.slice(0, end).trim(), remainder: t.slice(end).trim() };
}

/**
 * The characters `.` never matches without the `s` flag. The two line matchers
 * below replaced regexes whose tail was `(.*)$`, and that tail fails, rather
 * than matching, when one of these sits after the first non-space character.
 * The scans keep that answer so they return exactly what the regexes did.
 */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/**
 * A v1 variants-guide bullet, `- **Name**: guidance`, as its two parts, or
 * null when the line is not one. Replaces
 * `/^[-*]\s+\*\*([^*]+)\*\*\s*:?\s*(.*)$/`, whose `\s*:?\s*(.*)` tail could
 * split a run of spaces three ways and so ran in polynomial time when the
 * anchor failed (CodeQL alert 65). The prefix is still a regex because nothing
 * in it overlaps; the tail is a trim, one optional colon, and a second trim,
 * which is what the greedy quantifiers always resolved to.
 */
export function variantBullet(line: string): { name: string; guidance: string } | null {
  const m = /^[-*]\s+\*\*([^*]+)\*\*/.exec(line);
  if (!m) return null;
  let rest = line.slice(m[0].length).trimStart();
  if (rest.startsWith(':')) rest = rest.slice(1).trimStart();
  if (LINE_TERMINATOR.test(rest)) return null;
  return { name: m[1].trim(), guidance: rest.trim() };
}

/**
 * The text of a markdown heading line (`#` to `######`, whitespace, text), or
 * null when the line is not one. Replaces `/^#{1,6}\s+(.+)$/`, where `\s+` and
 * `.+` both match a space and so shared a run of them in polynomial time when
 * the anchor failed (CodeQL alert 66). Callers pass a trimmed line, which is
 * what makes the greedy `\s+` and this slice agree: the text after the
 * whitespace is then never empty.
 */
export function headingText(line: string): string | null {
  const m = /^#{1,6}\s+/.exec(line);
  if (!m) return null;
  const text = line.slice(m[0].length);
  return text === '' || LINE_TERMINATOR.test(text) ? null : text;
}

/** A v1 guideline string as rule and reason: the first bold run is the rule;
 *  without one, the first sentence is. */
export function splitRuleReason(text: string): GuidelineCard {
  const t = text.trim();
  const bold = /^\*\*([^*]+)\*\*\s*(.*)$/s.exec(t);
  if (bold) return { rule: bold[1].trim(), reason: bold[2].trim() };
  const { sentence, remainder } = firstSentence(t.replace(/\*\*/g, ''));
  return { rule: sentence, reason: remainder };
}

/**
 * Cheap discriminator: true when `value` is an object with `v === 2`. It does
 * not validate any sub-shape — a value can pass this check and still be
 * missing `overview.body`, a keyboard row's `keys`, or any other nested
 * field a caller assumes is there. Callers still need `validateProseV2` to
 * turn a value shaped like this into one whose fields can be trusted; that is
 * also why every reader below (`validateProseV2`, `proseToLegacy`,
 * `hasProseContent`) treats each field defensively instead of assuming the
 * declared `ProseV2` type holds at runtime.
 */
export function isProseV2(value: unknown): value is ProseV2 {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (value as { v?: unknown }).v === 2;
}

/** An unknown value as an array of `T`, or `[]` when it is missing or not an
 *  array. AI-authored `ProseV2` values are only shaped like the type, not
 *  guaranteed to satisfy it, so every reader below normalises through this
 *  instead of trusting a declared array field is actually an array. */
const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** An unknown value as a string, or `''` when it is missing or not a string. */
const asStr = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The one fold used to match an AI-written name against a name the spec
 * carries: trimmed, lower-cased, nothing else. Exported because a renderer
 * has to re-check a stored name against the live spec with exactly this
 * comparison. A second spelling of the fold would let a name pass validation
 * and fail at render, or the reverse.
 */
export const foldName = (s: string): string => s.trim().toLowerCase();

const bulletLines = (md: string | undefined): string[] =>
  (md ?? '').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !/^#{1,6}\s/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, ''));

/**
 * Split model-authored markdown into paragraphs on a blank line, then collapse
 * any single line-wrap left inside a paragraph to one space. The inner join is
 * a plain line split rather than a global `\s*\n\s*` replace: that pattern is
 * quadratic on a long run of horizontal whitespace that never reaches a `\n`
 * (measured through `upgradeProseV1`: 2.9s at 40k spaces, quadrupling on every
 * doubling), the same class of bug `normalizeDashes` below was already fixed
 * for. This runs on model output, which nobody in this repository controls
 * the length of.
 */
const paragraphs = (md: string | undefined): string[] =>
  (md ?? '').split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join(' '))
    .filter(Boolean);

/** Upgrade a v1 draft. Deterministic; see spec section 8.1 for the table. */
export function upgradeProseV1(v1: ProseDrafts): ProseV2 {
  const out: ProseV2 = { v: 2 };

  const defParas = paragraphs(v1.definition);
  if (defParas.length) {
    const { sentence, remainder } = firstSentence(defParas[0]);
    const body = [remainder, ...defParas.slice(1)].filter(Boolean);
    out.overview = { lede: sentence, body };
  }

  if (v1.variantsSummary) {
    const intro: string[] = [];
    const guide: { name: string; guidance: string }[] = [];
    for (const raw of v1.variantsSummary.split('\n')) {
      const bullet = variantBullet(raw.trim());
      if (bullet) guide.push(bullet);
      else intro.push(raw);
    }
    const introText = intro.join('\n').trim();
    if (introText) out.variantsIntro = introText;
    if (guide.length) out.variantsGuide = guide;
  }

  if (v1.anatomySummary?.trim()) out.anatomySummary = v1.anatomySummary.trim();
  if (v1.anatomyParts?.length) out.anatomyParts = v1.anatomyParts.map((p) => ({ name: p.name, role: p.description }));

  const semantics = bulletLines(v1.accessibility);
  if (semantics.length) out.semantics = semantics;
  const content = bulletLines(v1.contentConsiderations);
  if (content.length) out.content = content;

  if (v1.interactions) {
    const keyboard: { keys: string[]; action: string }[] = [];
    const pointer: string[] = [];
    let inKeyboard = false;
    for (const raw of v1.interactions.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const heading = headingText(line);
      if (heading !== null) { inKeyboard = /keyboard/i.test(heading); continue; }
      const text = line.replace(/^[-*]\s+/, '');
      if (inKeyboard) {
        const row = parseKeyboardBullet(text);
        if (row) keyboard.push(row);
      } else {
        pointer.push(text);
      }
    }
    if (keyboard.length) out.keyboard = keyboard;
    if (pointer.length) out.pointer = pointer;
  }

  const n = Math.max(v1.dos.length, v1.donts.length);
  if (n > 0) {
    out.guidelines = [];
    for (let i = 0; i < n; i += 1) {
      out.guidelines.push({
        do: v1.dos[i] !== undefined ? splitRuleReason(v1.dos[i]) : null,
        dont: v1.donts[i] !== undefined ? splitRuleReason(v1.donts[i]) : null,
      });
    }
  }
  return out;
}

const cardToLegacy = (c: GuidelineCard | null | undefined): string => {
  const rule = asStr(c?.rule);
  const reason = asStr(c?.reason);
  return reason ? `**${rule}** ${reason}` : `**${rule}**`;
};

/**
 * Each field of the brief's `guidelines` block that `proseToLegacy` fills, in
 * the block's own field order, with its ProseDrafts name and the v2 keys it
 * is built from. `design_considerations` has no v2 source, so no person can
 * have written it.
 */
const LEGACY_SOURCES: readonly (readonly [string, 'definition' | 'accessibility' | 'interactions'
  | 'variantsSummary' | 'anatomySummary' | 'contentConsiderations' | 'dos' | 'donts', readonly ProseV2Key[]])[] = [
  ['definition', 'definition', ['overview']],
  ['accessibility', 'accessibility', ['semantics']],
  ['interactions', 'interactions', ['keyboard', 'pointer']],
  ['variants_summary', 'variantsSummary', ['variantsIntro', 'variantsGuide']],
  ['anatomy_summary', 'anatomySummary', ['anatomySummary']],
  ['content_considerations', 'contentConsiderations', ['content']],
  ['dos', 'dos', ['guidelines']],
  ['donts', 'donts', ['guidelines']],
];

/** Flatten v2 to the v1 shape the brief and the v5 artifact still consume.
 *  `p` is only shaped like a validated `ProseV2` (see `isProseV2`'s doc
 *  comment), so every field is read through `asArray`/`asStr` rather than
 *  trusted outright — a caller that skips `validateProseV2` still gets a v1
 *  shape back instead of a thrown `TypeError`. */
export function proseToLegacy(p: ProseV2): ProseDrafts {
  const guidelines = asArray<GuidelinePair>(p.guidelines);
  const overviewBody = p.overview ? asArray<unknown>(p.overview.body).map(asStr) : [];
  const out: ProseDrafts = {
    definition: p.overview ? [asStr(p.overview.lede), ...overviewBody].filter(Boolean).join('\n\n') : '',
    accessibility: asArray<unknown>(p.semantics).map(asStr).filter(Boolean).map((s) => `- ${s}`).join('\n'),
    dos: guidelines.flatMap((g) => (g?.do ? [cardToLegacy(g.do)] : [])),
    donts: guidelines.flatMap((g) => (g?.dont ? [cardToLegacy(g.dont)] : [])),
  };
  const interactions: string[] = [];
  const keyboard = asArray<{ keys?: unknown; action?: unknown }>(p.keyboard);
  if (keyboard.length) {
    interactions.push('### Keyboard', ...keyboard.map((r) => `- ${asArray<unknown>(r.keys).map(asStr).join(' or ')}: ${asStr(r.action)}`));
  }
  const pointer = asArray<unknown>(p.pointer).map(asStr).filter(Boolean);
  if (pointer.length) interactions.push('### Other', ...pointer.map((s) => `- ${s}`));
  if (interactions.length) out.interactions = interactions.join('\n');
  const variants: string[] = [];
  if (asStr(p.variantsIntro)) variants.push(asStr(p.variantsIntro));
  const variantsGuide = asArray<{ name?: unknown; guidance?: unknown }>(p.variantsGuide);
  if (variantsGuide.length) variants.push(...variantsGuide.map((g) => `- **${asStr(g.name)}**: ${asStr(g.guidance)}`));
  if (variants.length) out.variantsSummary = variants.join('\n');
  if (asStr(p.anatomySummary)) out.anatomySummary = asStr(p.anatomySummary);
  const anatomyParts = asArray<{ name?: unknown; role?: unknown }>(p.anatomyParts);
  if (anatomyParts.length) out.anatomyParts = anatomyParts.map((a) => ({ name: asStr(a.name), description: asStr(a.role) }));
  const content = asArray<unknown>(p.content).map(asStr).filter(Boolean);
  if (content.length) out.contentConsiderations = content.map((s) => `- ${s}`).join('\n');
  // A field reads as written by a person only when every v2 key it is built
  // from that carries content was typed on the canvas: a Keyboard table a
  // person filled beside AI-written Pointer bullets is not a person's
  // Interactions section, so a mixed field is never listed.
  const authored = new Set(normalizeAuthored(p.authored));
  if (authored.size) {
    const names = LEGACY_SOURCES.filter(([, field, keys]) => {
      const value = out[field];
      const filled = Array.isArray(value) ? value.length > 0 : Boolean(value);
      return filled && keys.every((key) => authored.has(key) || !proseKeyHasContent(p, key));
    }).map(([name]) => name);
    if (names.length) out.authored = names;
  }
  return out;
}

/** True when `p[key]` has something to show. Defensive like every reader
 *  here: `p` is only shaped like a ProseV2. */
function proseKeyHasContent(p: ProseV2, key: ProseV2Key): boolean {
  const value = p[key];
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') {
    const o = value as { lede?: unknown; body?: unknown };
    return Boolean(asStr(o.lede).trim() || asArray(o.body).length);
  }
  return false;
}

/** True when any prose key has content. `authored` is not a prose key and
 *  never counts. */
export function hasProseContent(p: ProseV2 | null | undefined): boolean {
  if (!p) return false;
  return PROSE_V2_KEYS.some((key) => proseKeyHasContent(p, key));
}

/** Em dashes and spaced en dashes become commas; same rule as prompt.ts, and
 *  the same shared, redos-tested `replaceAround` implementation. Exported so
 *  `redos.test.ts` can pin it against the regexes it replaced. */
export function normalizeDashes(value: string): string {
  return replaceAround(replaceAround(value, '—', ', ', false), '–', ', ', true);
}

/** True when any line of `value` opens with a level-one or level-two markdown
 *  heading. Level three and below are allowed; `#` inside a sentence is not a
 *  heading. Tested one character class at a time, so no run can backtrack. */
export function hasHeading(value: string): boolean {
  for (const line of value.split('\n')) {
    if (line.startsWith('# ') || line === '#' || line.startsWith('## ') || line === '##') return true;
  }
  return false;
}

export interface ValidateProseOptions {
  /** Every component name in the Figma file, when the caller has it. Lets the
   *  `whenNotToUse` rule drop a bullet naming a component that exists but is
   *  not related. Absent: the bullet is left alone (spec 5.3). */
  fileComponents?: readonly string[];
}

export interface ProseValidation {
  prose: ProseV2;
  dropped: Partial<Record<ProseV2Key, number>>;
}

/** The one string cleaner: dashes to commas, trimmed, and empty when it carries
 *  a level-one or level-two heading (rejected, per spec 5.3). */
const clean = (value: unknown): string => {
  const text = normalizeDashes(asStr(value)).trim();
  return hasHeading(text) ? '' : text;
};

/** True when `sentence` contains `name` as whole words, case-insensitively.
 *  Built with indexOf and boundary checks rather than a regex over `name`,
 *  which would need escaping and could backtrack on a long name. */
function namesComponent(sentence: string, name: string): boolean {
  const hay = sentence.toLowerCase();
  const needle = name.toLowerCase();
  // An empty needle matches at every offset including the end, and the
  // advance-by-one loop below never terminates on it. The caller filters
  // blank names, so this is unreachable today and is here to keep it that way.
  if (!needle) return false;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? ' ' : hay[at - 1];
    const afterIndex = at + needle.length;
    const after = afterIndex >= hay.length ? ' ' : hay[afterIndex];
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = at + 1;
  }
}

/**
 * Enforce never-fabricate on the AI lane: every name must exist in the spec,
 * every key must be in the vocabulary, every string must be non-empty. Dropped
 * items are counted per key; a key with no survivors is omitted.
 *
 * `prose` is only shaped like a validated `ProseV2` (see `isProseV2`'s doc
 * comment) — this function is what makes it trustworthy, not a precondition
 * of calling it — so every field is read through `asArray`/`asStr` rather
 * than assumed present: a missing or wrong-typed sub-field (a keyboard row
 * with no `keys`, an `overview` with no `body`) is treated as empty and
 * dropped like any other empty value, instead of throwing.
 */
export function validateProseV2(
  spec: IntermediateSpec, prose: ProseV2, opts: ValidateProseOptions = {},
): ProseValidation {
  const dropped: Partial<Record<ProseV2Key, number>> = {};
  const out: ProseV2 = { v: 2 };
  const drop = (key: ProseV2Key, n = 1): void => { if (n > 0) dropped[key] = (dropped[key] ?? 0) + n; };
  const fold = foldName;
  const nameSet = (names: string[]): Set<string> => new Set(names.map(fold));

  const optionValues = nameSet(spec.variants.flatMap((v) => v.values));
  const partNames = nameSet(spec.anatomy.map((a) => a.name));
  const propNames = nameSet(spec.props.map((p) => p.name));
  const stateNames = nameSet(spec.states);
  const keyNames = new Set(KEYBOARD_KEYS);

  const strings = (key: 'whenToUse' | 'whenNotToUse' | 'pointer' | 'semantics' | 'content'): void => {
    const list = asArray<unknown>(prose[key]);
    if (!list.length) return;
    const kept = list.map((s) => clean(s)).filter(Boolean);
    drop(key, list.length - kept.length);
    if (kept.length) out[key] = kept;
  };

  if (prose.overview) {
    // One count per item actually removed: a rejected lede is one, each
    // rejected body bullet is one. The lede used to be counted twice when the
    // body was empty as well, and a rejected bullet was never counted at all.
    const rawLede = asStr(prose.overview.lede).trim();
    const rawBody = asArray<unknown>(prose.overview.body);
    const lede = clean(prose.overview.lede);
    const body = rawBody.map(clean).filter(Boolean);
    if (rawLede && !lede) drop('overview');
    drop('overview', rawBody.length - body.length);
    if (lede || body.length) out.overview = { lede, body };
    // An overview the model sent with nothing in it at all: no item was
    // removed, but the key was asked for and produced none, so it still counts
    // once. Without this a present-but-empty overview would be indistinguishable
    // from one that was never requested.
    else if (!rawLede && !rawBody.length) drop('overview');
  }
  strings('whenToUse');
  strings('whenNotToUse');
  if (out.whenNotToUse && opts.fileComponents && opts.fileComponents.length) {
    const related = nameSet(spec.related);
    const others = opts.fileComponents.map((n) => n.trim()).filter((n) => n && !related.has(fold(n)));
    const kept = out.whenNotToUse.filter((bullet) => !others.some((name) => namesComponent(bullet, name)));
    drop('whenNotToUse', out.whenNotToUse.length - kept.length);
    if (kept.length) out.whenNotToUse = kept; else delete out.whenNotToUse;
  }
  const variantsIntro = clean(prose.variantsIntro);
  if (variantsIntro) out.variantsIntro = variantsIntro;

  const named = <T extends { name: string }>(
    key: ProseV2Key, list: T[] | undefined, names: Set<string>, textOf: (t: T) => string,
    rebuild: (t: T, text: string) => T,
  ): void => {
    const items = asArray<T>(list);
    if (!items.length) return;
    const kept: T[] = [];
    for (const item of items) {
      const text = clean(textOf(item));
      const name = asStr((item as { name?: unknown } | null | undefined)?.name);
      if (names.has(fold(name)) && text) kept.push(rebuild(item, text));
    }
    drop(key, items.length - kept.length);
    if (kept.length) (out as unknown as Record<string, unknown>)[key] = kept;
  };
  named('variantsGuide', prose.variantsGuide, optionValues, (g) => g?.guidance, (g, t) => ({ ...g, guidance: t }));
  named('anatomyParts', prose.anatomyParts, partNames, (a) => a?.role, (a, t) => ({ ...a, role: t }));
  named('properties', prose.properties, propNames, (p) => p?.description, (p, t) => ({ ...p, description: t }));
  named('states', prose.states, stateNames, (s) => s?.whenItApplies, (s, t) => ({ ...s, whenItApplies: t }));

  const anatomySummary = clean(prose.anatomySummary);
  if (anatomySummary) out.anatomySummary = anatomySummary;

  const keyboardRows = asArray<{ keys?: unknown; action?: unknown } | null | undefined>(prose.keyboard);
  if (keyboardRows.length) {
    const kept: { keys: string[]; action: string }[] = [];
    for (const row of keyboardRows) {
      const keys = asArray<unknown>(row?.keys).flatMap((k) => normalizeKey(asStr(k)) ?? [asStr(k)]);
      const action = clean(row?.action);
      if (keys.length && keys.every((k) => keyNames.has(k)) && action) kept.push({ keys: [...new Set(keys)], action });
    }
    drop('keyboard', keyboardRows.length - kept.length);
    if (kept.length) out.keyboard = kept;
  }
  strings('pointer');
  strings('semantics');
  strings('content');

  const guidelineRows = asArray<{ do?: unknown; dont?: unknown } | null | undefined>(prose.guidelines);
  if (guidelineRows.length) {
    const card = (c: unknown): GuidelineCard | null => {
      if (!c || typeof c !== 'object') return null;
      const rule = clean((c as { rule?: unknown }).rule);
      return rule ? { rule, reason: clean((c as { reason?: unknown }).reason) } : null;
    };
    const kept: GuidelinePair[] = [];
    for (const pair of guidelineRows) {
      const p = { do: card(pair?.do), dont: card(pair?.dont) };
      if (p.do || p.dont) kept.push(p);
    }
    drop('guidelines', guidelineRows.length - kept.length);
    if (kept.length) out.guidelines = kept;
  }
  return { prose: out, dropped };
}
