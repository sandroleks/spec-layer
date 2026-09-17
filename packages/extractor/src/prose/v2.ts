/**
 * v2.ts: the structured prose contract the canvas renders.
 *
 * ProseDrafts (v1) is markdown blobs; ProseV2 is arrays and pairs, so a name
 * the model uses can be checked against the spec before it is drawn, and a
 * card, table row or bullet can be rebuilt from stored data without parsing
 * markdown again. Plan 1 stores and renders v2; the prompt still produces v1
 * until Plan 2, so `upgradeProseV1` is the seam, and `proseToLegacy` hands the
 * brief and the v5 artifact the v1 shape they still read.
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
}

export type ProseV2Key = Exclude<keyof ProseV2, 'v'>;

export const PROSE_V2_KEYS: readonly ProseV2Key[] = [
  'overview', 'whenToUse', 'whenNotToUse', 'variantsIntro', 'variantsGuide',
  'anatomySummary', 'anatomyParts', 'properties', 'states', 'keyboard',
  'pointer', 'semantics', 'content', 'guidelines',
];

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
      const line = raw.trim();
      const m = /^[-*]\s+\*\*([^*]+)\*\*\s*:?\s*(.*)$/.exec(line);
      if (m) guide.push({ name: m[1].trim(), guidance: m[2].trim() });
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
      const heading = /^#{1,6}\s+(.+)$/.exec(line);
      if (heading) { inKeyboard = /keyboard/i.test(heading[1]); continue; }
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
  return out;
}

export function hasProseContent(p: ProseV2 | null | undefined): boolean {
  if (!p) return false;
  for (const key of PROSE_V2_KEYS) {
    const value = p[key];
    if (typeof value === 'string') { if (value.trim()) return true; continue; }
    if (Array.isArray(value)) { if (value.length) return true; continue; }
    if (value && typeof value === 'object') {
      const o = value as { lede?: unknown; body?: unknown };
      if (asStr(o.lede).trim() || asArray(o.body).length) return true;
    }
  }
  return false;
}

/** Em dashes and spaced en dashes become commas; same rule as prompt.ts, and
 *  the same shared, redos-tested `replaceAround` implementation. */
function normalizeDashes(value: string): string {
  return replaceAround(replaceAround(value, '—', ', ', false), '–', ', ', true);
}

export interface ProseValidation {
  prose: ProseV2;
  dropped: Partial<Record<ProseV2Key, number>>;
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
export function validateProseV2(spec: IntermediateSpec, prose: ProseV2): ProseValidation {
  const dropped: Partial<Record<ProseV2Key, number>> = {};
  const out: ProseV2 = { v: 2 };
  const drop = (key: ProseV2Key, n = 1): void => { if (n > 0) dropped[key] = (dropped[key] ?? 0) + n; };
  const fold = (s: string): string => s.trim().toLowerCase();
  const nameSet = (names: string[]): Set<string> => new Set(names.map(fold));

  const optionValues = nameSet(spec.variants.flatMap((v) => v.values));
  const partNames = nameSet(spec.anatomy.map((a) => a.name));
  const propNames = nameSet(spec.props.map((p) => p.name));
  const stateNames = nameSet(spec.states);
  const keyNames = new Set(KEYBOARD_KEYS);

  const strings = (key: 'whenToUse' | 'whenNotToUse' | 'pointer' | 'semantics' | 'content'): void => {
    const list = asArray<unknown>(prose[key]);
    if (!list.length) return;
    const kept = list.map((s) => normalizeDashes(asStr(s)).trim()).filter(Boolean);
    drop(key, list.length - kept.length);
    if (kept.length) out[key] = kept;
  };

  if (prose.overview) {
    const lede = normalizeDashes(asStr(prose.overview.lede)).trim();
    const body = asArray<unknown>(prose.overview.body).map((s) => normalizeDashes(asStr(s)).trim()).filter(Boolean);
    if (lede || body.length) out.overview = { lede, body };
    else drop('overview');
  }
  strings('whenToUse');
  strings('whenNotToUse');
  if (asStr(prose.variantsIntro).trim()) out.variantsIntro = normalizeDashes(asStr(prose.variantsIntro)).trim();

  const named = <T extends { name: string }>(
    key: ProseV2Key, list: T[] | undefined, names: Set<string>, textOf: (t: T) => string,
    rebuild: (t: T, text: string) => T,
  ): void => {
    const items = asArray<T>(list);
    if (!items.length) return;
    const kept: T[] = [];
    for (const item of items) {
      const text = normalizeDashes(asStr(textOf(item))).trim();
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

  if (asStr(prose.anatomySummary).trim()) out.anatomySummary = normalizeDashes(asStr(prose.anatomySummary)).trim();

  const keyboardRows = asArray<{ keys?: unknown; action?: unknown } | null | undefined>(prose.keyboard);
  if (keyboardRows.length) {
    const kept: { keys: string[]; action: string }[] = [];
    for (const row of keyboardRows) {
      const keys = asArray<unknown>(row?.keys).flatMap((k) => normalizeKey(asStr(k)) ?? [asStr(k)]);
      const action = normalizeDashes(asStr(row?.action)).trim();
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
      const rule = normalizeDashes(asStr((c as { rule?: unknown }).rule)).trim();
      return rule ? { rule, reason: normalizeDashes(asStr((c as { reason?: unknown }).reason)).trim() } : null;
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
