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

const KEY_ALIASES: Record<string, string[]> = {
  tab: ['Tab'], shifttab: ['Shift+Tab'], enter: ['Enter'], return: ['Enter'], space: ['Space'],
  spacebar: ['Space'], escape: ['Escape'], esc: ['Escape'], arrowup: ['Arrow Up'], up: ['Arrow Up'],
  arrowdown: ['Arrow Down'], down: ['Arrow Down'], arrowleft: ['Arrow Left'], left: ['Arrow Left'],
  arrowright: ['Arrow Right'], right: ['Arrow Right'], arrowkeys: ARROWS, arrows: ARROWS,
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

export function isProseV2(value: unknown): value is ProseV2 {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (value as { v?: unknown }).v === 2;
}

const bulletLines = (md: string | undefined): string[] =>
  (md ?? '').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !/^#{1,6}\s/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, ''));

const paragraphs = (md: string | undefined): string[] =>
  (md ?? '').split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);

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

const cardToLegacy = (c: GuidelineCard): string => (c.reason ? `**${c.rule}** ${c.reason}` : `**${c.rule}**`);

/** Flatten v2 to the v1 shape the brief and the v5 artifact still consume. */
export function proseToLegacy(p: ProseV2): ProseDrafts {
  const out: ProseDrafts = {
    definition: p.overview ? [p.overview.lede, ...p.overview.body].filter(Boolean).join('\n\n') : '',
    accessibility: (p.semantics ?? []).map((s) => `- ${s}`).join('\n'),
    dos: (p.guidelines ?? []).flatMap((g) => (g.do ? [cardToLegacy(g.do)] : [])),
    donts: (p.guidelines ?? []).flatMap((g) => (g.dont ? [cardToLegacy(g.dont)] : [])),
  };
  const interactions: string[] = [];
  if (p.keyboard?.length) {
    interactions.push('### Keyboard', ...p.keyboard.map((r) => `- ${r.keys.join(' or ')}: ${r.action}`));
  }
  if (p.pointer?.length) interactions.push('### Other', ...p.pointer.map((s) => `- ${s}`));
  if (interactions.length) out.interactions = interactions.join('\n');
  const variants: string[] = [];
  if (p.variantsIntro) variants.push(p.variantsIntro);
  if (p.variantsGuide?.length) variants.push(...p.variantsGuide.map((g) => `- **${g.name}**: ${g.guidance}`));
  if (variants.length) out.variantsSummary = variants.join('\n');
  if (p.anatomySummary) out.anatomySummary = p.anatomySummary;
  if (p.anatomyParts?.length) out.anatomyParts = p.anatomyParts.map((a) => ({ name: a.name, description: a.role }));
  if (p.content?.length) out.contentConsiderations = p.content.map((s) => `- ${s}`).join('\n');
  return out;
}

export function hasProseContent(p: ProseV2 | null | undefined): boolean {
  if (!p) return false;
  for (const key of PROSE_V2_KEYS) {
    const value = p[key];
    if (typeof value === 'string') { if (value.trim()) return true; continue; }
    if (Array.isArray(value)) { if (value.length) return true; continue; }
    if (value && typeof value === 'object') {
      const o = value as { lede: string; body: string[] };
      if (o.lede.trim() || o.body.length) return true;
    }
  }
  return false;
}

/** One character's worth of `[ \t]`. Horizontal only, so a line break survives. */
const isHorizontalSpace = (ch: string): boolean => ch === ' ' || ch === '\t';

/**
 * Replace every `separator`, together with the horizontal whitespace hugging
 * it, with `replacement`. Same algorithm as `replaceAround` in `prose/prompt.ts`
 * (duplicated rather than imported, since that one is private): a single
 * left-to-right scan, because the equivalent global regex is quadratic on a
 * run of horizontal whitespace that never reaches a dash, and this runs on
 * model output, which nobody in this repository controls the length of.
 */
function replaceAround(value: string, separator: string, replacement: string, requireSpace: boolean): string {
  let out = '';
  let from = 0;
  let cursor = 0;
  for (;;) {
    const at = value.indexOf(separator, cursor);
    if (at === -1) break;
    let left = at;
    while (left > from && isHorizontalSpace(value[left - 1])) left--;
    const afterSeparator = at + separator.length;
    let right = afterSeparator;
    while (right < value.length && isHorizontalSpace(value[right])) right++;
    if (requireSpace && (left === at || right === afterSeparator)) {
      cursor = afterSeparator;
      continue;
    }
    out += value.slice(from, left) + replacement;
    from = right;
    cursor = right;
  }
  return out + value.slice(from);
}

/** Em dashes and spaced en dashes become commas; same rule as prompt.ts. */
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
    const list = prose[key];
    if (!list) return;
    const kept = list.map((s) => normalizeDashes(s).trim()).filter(Boolean);
    drop(key, list.length - kept.length);
    if (kept.length) out[key] = kept;
  };

  if (prose.overview) {
    const lede = normalizeDashes(prose.overview.lede).trim();
    const body = prose.overview.body.map((s) => normalizeDashes(s).trim()).filter(Boolean);
    if (lede || body.length) out.overview = { lede, body };
    else drop('overview');
  }
  strings('whenToUse');
  strings('whenNotToUse');
  if (prose.variantsIntro?.trim()) out.variantsIntro = normalizeDashes(prose.variantsIntro).trim();

  const named = <T extends { name: string }>(
    key: ProseV2Key, list: T[] | undefined, names: Set<string>, textOf: (t: T) => string,
    rebuild: (t: T, text: string) => T,
  ): void => {
    if (!list) return;
    const kept: T[] = [];
    for (const item of list) {
      const text = normalizeDashes(textOf(item)).trim();
      if (names.has(fold(item.name)) && text) kept.push(rebuild(item, text));
    }
    drop(key, list.length - kept.length);
    if (kept.length) (out as unknown as Record<string, unknown>)[key] = kept;
  };
  named('variantsGuide', prose.variantsGuide, optionValues, (g) => g.guidance, (g, t) => ({ ...g, guidance: t }));
  named('anatomyParts', prose.anatomyParts, partNames, (a) => a.role, (a, t) => ({ ...a, role: t }));
  named('properties', prose.properties, propNames, (p) => p.description, (p, t) => ({ ...p, description: t }));
  named('states', prose.states, stateNames, (s) => s.whenItApplies, (s, t) => ({ ...s, whenItApplies: t }));

  if (prose.anatomySummary?.trim()) out.anatomySummary = normalizeDashes(prose.anatomySummary).trim();

  if (prose.keyboard) {
    const kept: { keys: string[]; action: string }[] = [];
    for (const row of prose.keyboard) {
      const keys = row.keys.flatMap((k) => normalizeKey(k) ?? [k]);
      const action = normalizeDashes(row.action).trim();
      if (keys.length && keys.every((k) => keyNames.has(k)) && action) kept.push({ keys: [...new Set(keys)], action });
    }
    drop('keyboard', prose.keyboard.length - kept.length);
    if (kept.length) out.keyboard = kept;
  }
  strings('pointer');
  strings('semantics');
  strings('content');

  if (prose.guidelines) {
    const card = (c: GuidelineCard | null): GuidelineCard | null => {
      if (!c) return null;
      const rule = normalizeDashes(c.rule).trim();
      return rule ? { rule, reason: normalizeDashes(c.reason).trim() } : null;
    };
    const kept: GuidelinePair[] = [];
    for (const pair of prose.guidelines) {
      const p = { do: card(pair.do), dont: card(pair.dont) };
      if (p.do || p.dont) kept.push(p);
    }
    drop('guidelines', prose.guidelines.length - kept.length);
    if (kept.length) out.guidelines = kept;
  }
  return { prose: out, dropped };
}
