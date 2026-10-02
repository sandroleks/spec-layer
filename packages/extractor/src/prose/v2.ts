/**
 * The structured prose contract the canvas renders. Unlike the v1 markdown
 * blobs (ProseDrafts), every name can be checked against the spec before it is
 * drawn. `upgradeProseV1` reads back stored v1 prose; `proseToLegacy` gives the
 * brief and the v5 artifact the v1 shape they still read. Imported by the main
 * thread: no DOM.
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
  /** Keys a person typed on the canvas, so the export can say who wrote them.
   *  Metadata, never content and never sent to the model; omitted when empty.
   *  Read through `normalizeAuthored`. */
  authored?: ProseV2Key[];
}

export type ProseV2Key = Exclude<keyof ProseV2, 'v' | 'authored'>;

export const PROSE_V2_KEYS: readonly ProseV2Key[] = [
  'overview', 'whenToUse', 'whenNotToUse', 'variantsIntro', 'variantsGuide',
  'anatomySummary', 'anatomyParts', 'properties', 'states', 'keyboard',
  'pointer', 'semantics', 'content', 'guidelines',
];

/** Known keys once each, in PROSE_V2_KEYS order; anything else is dropped. */
export function normalizeAuthored(value: unknown): ProseV2Key[] {
  if (!Array.isArray(value)) return [];
  return PROSE_V2_KEYS.filter((key) => value.includes(key));
}

/** A row whose key is not one of these is dropped. */
export const KEYBOARD_KEYS: readonly string[] = [
  'Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape', 'Arrow Up', 'Arrow Down',
  'Arrow Left', 'Arrow Right', 'Home', 'End', 'Page Up', 'Page Down', 'Delete', 'Backspace',
];

const ARROWS = ['Arrow Up', 'Arrow Down', 'Arrow Left', 'Arrow Right'];

/**
 * Bare `up`/`down`/`left`/`right`/`return` are absent: they open ordinary
 * sentences ("Return focus to the trigger."), and reading them as keys
 * fabricates a row `validateProseV2` cannot catch. Spell them as keys ("Arrow
 * Down", "Down Key", the glyph).
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

/** Canonical key names for one spelling, or null. "Arrow keys" gives all four. */
export function normalizeKey(raw: string): string[] | null {
  const folded = raw.toLowerCase().replace(/[\s+_-]+/g, '');
  const direct = KEY_ALIASES[folded];
  if (direct) return direct;
  const stripped = folded.replace(/key$/, '');
  return KEY_ALIASES[stripped] ?? null;
}

const KEY_SEPARATOR = /\s*(?:\bor\b|\band\b|\/|,)\s*/i;

/** A v1 keyboard bullet as a table row: it must open with vocabulary keys
 *  joined by "or", "and", a slash or a comma; the rest is the action. */
export function parseKeyboardBullet(text: string): { keys: string[]; action: string } | null {
  const line = text.replace(/^[-*]\s+/, '').trim();
  const words = line.split(/\s+/);
  // Longest key prefix first; six words covers "Tab / Shift+Tab move".
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

/** A sentence ends at `.`, `!` or `?` followed by whitespace and a capital or
 *  `(`, so "e.g. a Toggle" and "3.5 items" do not end it. */
export function firstSentence(text: string): { sentence: string; remainder: string } {
  const t = text.trim();
  const m = /[.!?](?=\s+[A-Z(])/.exec(t);
  if (!m) return { sentence: t, remainder: '' };
  const end = m.index + 1;
  return { sentence: t.slice(0, end).trim(), remainder: t.slice(end).trim() };
}

/** What `.` never matches without `s`. The matchers below keep the `(.*)$`
 *  tails' failure on these, to equal the regexes they replaced. */
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/**
 * A v1 variants-guide bullet, `- **Name**: guidance`, or null. The tail is a
 * trim, an optional colon and a trim, because the old `\s*:?\s*(.*)$` regex
 * tail was polynomial; the result is the same.
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
 * The text of a markdown heading line, or null. Replaces the polynomial
 * `/^#{1,6}\s+(.+)$/`. Callers pass a trimmed line, which is what makes this
 * slice agree with the greedy `\s+`.
 */
export function headingText(line: string): string | null {
  const m = /^#{1,6}\s+/.exec(line);
  if (!m) return null;
  const text = line.slice(m[0].length);
  return text === '' || LINE_TERMINATOR.test(text) ? null : text;
}

/** The first bold run is the rule; without one, the first sentence is. */
export function splitRuleReason(text: string): GuidelineCard {
  const t = text.trim();
  const bold = /^\*\*([^*]+)\*\*\s*(.*)$/s.exec(t);
  if (bold) return { rule: bold[1].trim(), reason: bold[2].trim() };
  const { sentence, remainder } = firstSentence(t.replace(/\*\*/g, ''));
  return { rule: sentence, reason: remainder };
}

/**
 * Checks `v === 2` only, no sub-shape. Only `validateProseV2` makes a value
 * trustworthy, which is why every reader here treats each field defensively.
 */
export function isProseV2(value: unknown): value is ProseV2 {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (value as { v?: unknown }).v === 2;
}

/** AI-authored values are only shaped like `ProseV2`, so readers normalise here. */
const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const asStr = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The one fold matching an AI-written name to a spec name. Exported so a
 *  renderer re-checks with exactly this comparison, never a second one. */
export const foldName = (s: string): string => s.trim().toLowerCase();

const bulletLines = (md: string | undefined): string[] =>
  (md ?? '').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !/^#{1,6}\s/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, ''));

/**
 * Paragraphs on a blank line, inner line-wraps collapsed to one space. A line
 * split, not a `\s*\n\s*` replace, which is quadratic on model output.
 */
const paragraphs = (md: string | undefined): string[] =>
  (md ?? '').split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join(' '))
    .filter(Boolean);

/** Deterministic; see spec section 8.1 for the table. */
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
 * Each brief `guidelines` field `proseToLegacy` fills, in block order: its
 * ProseDrafts name and the v2 keys it is built from. `design_considerations`
 * has no v2 source, so no person can have written it.
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
 *  Defensive (see `isProseV2`), so an unvalidated `p` never throws. */
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
  // A field is a person's only when every contentful v2 key behind it was
  // typed on the canvas; a mixed field is never listed.
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

/** Defensive: `p` is only shaped like a ProseV2. */
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

/** `authored` is not a prose key and never counts. */
export function hasProseContent(p: ProseV2 | null | undefined): boolean {
  if (!p) return false;
  return PROSE_V2_KEYS.some((key) => proseKeyHasContent(p, key));
}

/** Em dashes and spaced en dashes become commas. Exported so `redos.test.ts`
 *  can pin it against the regexes it replaced. */
export function normalizeDashes(value: string): string {
  return replaceAround(replaceAround(value, '—', ', ', false), '–', ', ', true);
}

/** Any line opening with a level-one or level-two heading; level three and
 *  below are allowed. No regex, so nothing can backtrack. */
export function hasHeading(value: string): boolean {
  for (const line of value.split('\n')) {
    if (line.startsWith('# ') || line === '#' || line.startsWith('## ') || line === '##') return true;
  }
  return false;
}

export interface ValidateProseOptions {
  /** Lets `whenNotToUse` drop a bullet naming an unrelated component. Absent:
   *  the bullet is left alone (spec 5.3). */
  fileComponents?: readonly string[] | undefined;
}

export interface ProseValidation {
  prose: ProseV2;
  dropped: Partial<Record<ProseV2Key, number>>;
}

/** Dashes to commas, trimmed, and empty when it carries a level-one or
 *  level-two heading (spec 5.3). */
const clean = (value: unknown): string => {
  const text = normalizeDashes(asStr(value)).trim();
  return hasHeading(text) ? '' : text;
};

/** Whole words, case-insensitive. indexOf, not a regex over `name`, which
 *  would need escaping and could backtrack. */
function namesComponent(sentence: string, name: string): boolean {
  const hay = sentence.toLowerCase();
  const needle = name.toLowerCase();
  // An empty needle would loop forever; the caller filters blanks anyway.
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
 * every key must be in the vocabulary, every string must be non-empty. Drops
 * are counted per key; a key with no survivors is omitted. A missing or
 * wrong-typed sub-field is dropped as empty, never thrown on.
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
    // One count per item removed: the lede, and each rejected body bullet.
    const rawLede = asStr(prose.overview.lede).trim();
    const rawBody = asArray<unknown>(prose.overview.body);
    const lede = clean(prose.overview.lede);
    const body = rawBody.map(clean).filter(Boolean);
    if (rawLede && !lede) drop('overview');
    drop('overview', rawBody.length - body.length);
    if (lede || body.length) out.overview = { lede, body };
    // Present but entirely empty still counts once, unlike an unrequested one.
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
