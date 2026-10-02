/**
 * Reads the editorial lane of a component doc back off the canvas. The
 * generated lane (tables, matrices, chrome) is always rebuilt; the editorial
 * lane (writing sections) is authored, so the canvas is its source of truth.
 * docFrame.ts tags editorial nodes with pluginData; this turns the tags back
 * into a ProseV2 overlay so an Update keeps every word anyone wrote.
 *
 * Imported by main.ts, which runs in Figma's bare sandbox realm, so only
 * ECMAScript built-ins: no Figma globals. Tests pass plain objects.
 */
import {
  hasProseContent, normalizeKey, normalizeAuthored, PROSE_V2_KEYS,
  type ProseV2, type ProseV2Key, type GuidelinePair, type GuidelineCard,
} from '@spec-layer/extractor';
import { PILL_KEY } from './publishPill';
import { displayPartName } from './ui/displayNames';

/** pluginData key naming which editorial slot a node (and its subtree) fills. */
export const SLOT_KEY = 'specLayerSlot';
/** pluginData key on a keyed row (anatomyPart, propertyDescription,
 *  keyboardRow, variantsGuide, guidelinePair) holding the row's key. */
export const SLOT_PART_KEY = 'specLayerSlotKey';
/** pluginData key on a node inside a prose slot saying what kind of line it is. */
export const LINE_KEY = 'specLayerLine';

/** pluginData key on a guidance text node, holding the exact guidance it was
 *  drawn with. A node whose characters still equal it was never written, so
 *  it reads back as empty; once someone types over it, it is their prose. */
export const PLACEHOLDER_KEY = 'specLayerPlaceholder';

/** pluginData key on the Placeholder tag frame and its label. The tag is a
 *  status stamp, like the publish pill: it goes away once the box is filled
 *  and Updated, so deleting it by hand must not read as a hand edit. */
export const PLACEHOLDER_TAG_KEY = 'specLayerPlaceholderTag';

/** True while a stamped guidance node still shows its guidance. */
export function isUnfilledPlaceholder(node: ProseNodeLike): boolean {
  const guidance = node.getPluginData(PLACEHOLDER_KEY);
  return guidance !== '' && (node.characters ?? '').trim() === guidance.trim();
}

/** True for a guidance node, filled or not. Content read from a filled one
 *  was typed by a person, which is what `CanvasProse.authored` records. */
const isStamped = (node: ProseNodeLike | undefined): boolean =>
  node !== undefined && node.getPluginData(PLACEHOLDER_KEY) !== '';

export type ProseSlot =
  | 'definitionLead' | 'definition' | 'whenToUse' | 'whenNotToUse' | 'variantsIntro' | 'variantsGuide'
  | 'anatomySummary' | 'anatomyPart' | 'propertyDescription' | 'keyboardRow'
  | 'pointer' | 'semantics' | 'content' | 'guidelinePair' | 'guidelineDo' | 'guidelineDont';

export type LineKind = 'paragraph' | 'heading' | 'bullet' | 'placeholder' | 'label';

/** The Do/Don't card label as docBlocks draws it. Older docs carry it without
 *  LINE_KEY `'label'`, so these exact characters also read as a label. */
export const GUIDELINE_LABEL = { do: 'DO', dont: 'DON’T' } as const;
const LABEL_TEXTS: ReadonlySet<string> = new Set([GUIDELINE_LABEL.do, GUIDELINE_LABEL.dont]);

/** The placeholder older docs carry (`_To be written._`, emphasis stripped)
 *  instead of a PLACEHOLDER_KEY stamp; it still reads as "nobody wrote this". */
export const PLACEHOLDER_TEXT = 'To be written.';

/** The slice of a Figma node this module reads. SceneNodes need a cast: the
 *  typings' overloaded generic `getStyledTextSegments` is not assignable. */
export interface ProseNodeLike {
  id?: string;
  type: string;
  characters?: string;
  children?: readonly ProseNodeLike[] | undefined;
  getPluginData(key: string): string;
  /** Figma's native subtree search, when the host has it. */
  findAllWithCriteria?(criteria: { pluginData: { keys: string[] } }): readonly { id: string }[];
  getStyledTextSegments?(fields: ['fontName']):
    readonly { characters: string; fontName: { family: string; style: string } }[];
}

/** Every field optional: absent means the canvas does not show that slot.
 *  `overview`'s lede and body are separate slots, so a doc reports only the
 *  half it shows, never a fabricated empty other half. */
export type CanvasProse = Partial<Omit<ProseV2, 'v' | 'overview' | 'authored'>> & {
  overview?: { lede?: string; body?: string[] };
  /** The prose keys that took content from a placeholder someone typed
   *  over, in PROSE_V2_KEYS order. Absent when there are none. */
  authored?: ProseV2Key[];
};

/**
 * A text node's characters as markdown: Bold becomes **bold** and Medium
 * becomes `code`, since body text is Regular and only a code span is Medium
 * (see docText.applyRuns). Whitespace-only segments stay plain.
 */
export function textToMarkdown(node: ProseNodeLike): string {
  const chars = node.characters ?? '';
  if (!node.getStyledTextSegments) return chars;
  let segments: ReturnType<NonNullable<ProseNodeLike['getStyledTextSegments']>>;
  try { segments = node.getStyledTextSegments(['fontName']); } catch { return chars; }
  return segments.map((s) => {
    if (s.characters.trim() === '') return s.characters;
    if (s.fontName.style === 'Bold') return `**${s.characters}**`;
    if (s.fontName.style === 'Medium') return `\`${s.characters}\``;
    return s.characters;
  }).join('');
}

/** `read(node)` for a node someone wrote, or '' for a missing node or one
 *  still showing its placeholder guidance. */
function unlessGuidance(node: ProseNodeLike | undefined, read: (n: ProseNodeLike) => string): string {
  return node && !isUnfilledPlaceholder(node) ? read(node) : '';
}

const plainText = (node: ProseNodeLike): string => (node.characters ?? '').trim();

function allTexts(node: ProseNodeLike, out: ProseNodeLike[] = []): ProseNodeLike[] {
  if (node.type === 'TEXT') out.push(node);
  for (const c of node.children ?? []) allTexts(c, out);
  return out;
}

/** One markdown line per child of a prose block container. `typed` is called
 *  when a line came from a placeholder someone typed over. */
function readLines(container: ProseNodeLike, typed: () => void = () => {}): string[] {
  const lines: string[] = [];
  for (const child of container.children ?? []) {
    const kind = child.getPluginData(LINE_KEY);
    const texts = allTexts(child);
    if (texts.length === 0) continue;
    if (kind === 'heading') { lines.push(`### ${texts[0].characters ?? ''}`); continue; }
    if (kind === 'bullet') { lines.push(textToMarkdown(texts[texts.length - 1])); continue; }
    const md = textToMarkdown(texts[0]);
    if (isUnfilledPlaceholder(texts[0])) continue;
    if (kind === 'placeholder' && md.trim() === PLACEHOLDER_TEXT) continue;
    if (md.trim() === '') continue;
    lines.push(md);
    if (isStamped(texts[0])) typed();
  }
  return lines;
}

/** One item per bullet row, read from its last text node. `typed` is called
 *  for an item from a placeholder someone typed over. */
function readBullets(container: ProseNodeLike, typed: () => void = () => {}): string[] {
  const items: string[] = [];
  for (const row of container.children ?? []) {
    const texts = allTexts(row);
    if (texts.length === 0) continue;
    const last = texts[texts.length - 1];
    if (isUnfilledPlaceholder(last)) continue;
    const md = textToMarkdown(last);
    if (md.trim() === '' || md.trim() === PLACEHOLDER_TEXT) continue;
    items.push(md);
    if (isStamped(last)) typed();
  }
  return items;
}

/**
 * The keys typed into a placeholder keyboard row: alternatives split on " or ",
 * a comma or a slash; spaces around `+` close up ("Shift + Tab" is one combo);
 * vocabulary spellings take their canonical name. Whitespace collapses first so
 * the split cannot backtrack on user-edited text.
 */
function typedKeys(text: string): string[] {
  const keys: string[] = [];
  for (const raw of text.replace(/\s+/g, ' ').split(/ or |,|\//i)) {
    const alt = raw.trim().replace(/ ?\+ ?/g, '+');
    if (!alt) continue;
    for (const k of normalizeKey(alt) ?? [alt]) if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}

const LIST_SLOTS = new Set<ProseSlot>(['whenToUse', 'whenNotToUse', 'pointer', 'semantics', 'content']);

/** Exactly what `anatomySection.ts` writes before the note. */
const SHOWN_WHEN_LEAD = '  ·  Shown when ';
const SHOWN_WHEN_TAIL = ' is true';

/**
 * Drops the anatomy legend's trailing "  ·  Shown when <prop> is true" note so
 * it never reads back as an authored role. indexOf on the writer's separator,
 * not a regex whose leading `\s+` backtracks quadratically on user-editable
 * text on the main thread.
 */
function stripShownWhenNote(role: string): string {
  if (!role.endsWith(SHOWN_WHEN_TAIL)) return role;
  const at = role.lastIndexOf(SHOWN_WHEN_LEAD);
  // A note needs a property name between the lead-in and the tail.
  if (at < 0 || at + SHOWN_WHEN_LEAD.length >= role.length - SHOWN_WHEN_TAIL.length) return role;
  return role.slice(0, at).trim();
}

/** Walk a Section and collect what its editorial slots currently say. */
export function readCanvasProse(root: ProseNodeLike): CanvasProse {
  const lists = new Map<string, string[]>();
  const definitionLines: string[] = [];
  let lead: string | undefined;
  let variantsIntro: string[] | undefined;
  let anatomySummary: string | undefined;
  let guide: { name: string; guidance: string }[] | undefined;
  let parts: { name: string; role: string }[] | undefined;
  let properties: { name: string; description: string }[] | undefined;
  let keyboard: { keys: string[]; action: string }[] | undefined;
  // A duplicated row carries its original's index, so pairs are a list sorted
  // stably, not a map by index that would keep only the last.
  const pairs: { index: number; pair: GuidelinePair }[] = [];
  const authored = new Set<ProseV2Key>();

  const push = <T>(list: T[] | undefined, item: T): T[] => { const l = list ?? []; l.push(item); return l; };
  const lastText = (node: ProseNodeLike): string => {
    const texts = allTexts(node);
    return unlessGuidance(texts[texts.length - 1], (n) => textToMarkdown(n).trim());
  };
  const card = (node: ProseNodeLike): GuidelineCard | null => {
    // The DO/DON'T label is never content: a tagged label is dropped, as is an
    // untagged leading node that reads exactly like one. Then rule, then
    // reason, so a missing node never promotes or demotes a line. The rule is
    // read as plain characters: it is drawn Bold as card styling, and
    // textToMarkdown would wrap every rule in `**...**`. Unfilled guidance
    // reads as empty.
    const all = allTexts(node);
    const texts = all.filter((t) => t.getPluginData(LINE_KEY) !== 'label');
    if (texts.length === all.length && texts.length && LABEL_TEXTS.has(texts[0].characters ?? '')) texts.shift();
    const rule = unlessGuidance(texts[0], plainText);
    if (!rule) return null;
    const reason = unlessGuidance(texts[1], (n) => textToMarkdown(n).trim());
    if (isStamped(texts[0]) || (reason && isStamped(texts[1]))) authored.add('guidelines');
    return { rule, reason };
  };

  const visit = (node: ProseNodeLike): void => {
    if (node.type === 'INSTANCE') return;
    const slotName = node.getPluginData(SLOT_KEY);
    if (slotName === '') { for (const c of node.children ?? []) visit(c); return; }
    const slot = slotName as ProseSlot;
    const key = node.getPluginData(SLOT_PART_KEY);
    if (LIST_SLOTS.has(slot)) {
      lists.set(slot, [...(lists.get(slot) ?? []), ...readBullets(node, () => authored.add(slot as ProseV2Key))]);
      return;
    }
    switch (slot) {
      case 'definitionLead': { const v = textToMarkdown(node).trim(); if (v) lead = lead ? `${lead} ${v}` : v; return; }
      case 'definition': definitionLines.push(...readLines(node, () => authored.add('overview'))); return;
      case 'variantsIntro': variantsIntro = [...(variantsIntro ?? []), ...readLines(node)]; return;
      case 'anatomySummary': { const v = textToMarkdown(node).trim(); if (v) anatomySummary = anatomySummary ? `${anatomySummary} ${v}` : v; return; }
      case 'variantsGuide': {
        if (!guide) guide = [];
        if (!key) return;
        const chars = lastText(node);
        const guidance = chars.startsWith(`${key}: `) ? chars.slice(key.length + 2).trim() : chars.replace(/^\*\*[^*]+\*\*:?\s*/, '').trim();
        if (guidance) guide.push({ name: key, guidance });
        return;
      }
      case 'anatomyPart': {
        if (!parts) parts = [];
        if (!key) return;
        const chars = allTexts(node).length ? (allTexts(node).slice(-1)[0].characters ?? '') : '';
        // The legend prints the display name and the tag keeps the raw key, so
        // both spellings of "no role" and both lead-ins are checked before the
        // loose ": " search, which would misread a nested part's component note
        // ("Icon leading  ·  Icon: 24") as a role.
        const shown = displayPartName(key);
        let role: string | undefined;
        if (chars === key || chars === shown || chars.startsWith(`${key}  ·  `) || chars.startsWith(`${shown}  ·  `)) role = undefined;
        else if (chars.startsWith(`${key}: `)) role = chars.slice(key.length + 2).trim();
        else if (chars.startsWith(`${shown}: `)) role = chars.slice(shown.length + 2).trim();
        else { const i = chars.indexOf(': '); if (i >= 0) role = chars.slice(i + 2).trim(); }
        // A revealed part's "Shown when X is true" note is not editorial.
        if (role) role = stripShownWhenNote(role);
        if (role) parts.push({ name: key, role });
        return;
      }
      case 'propertyDescription': { if (!key) return; const d = lastText(node); if (d) properties = push(properties, { name: key, description: d }); return; }
      case 'keyboardRow': {
        // A keyed row's tag holds its keys joined with " + " by docBlocks, so
        // "Shift+Tab" stays one key. A placeholder row has no key tag: its keys
        // are what was typed into its first cell, while that cell exists.
        const action = lastText(node);
        const texts = allTexts(node);
        const keys = key
          ? key.split(' + ').map((k) => k.trim()).filter(Boolean)
          : texts.length >= 2 ? typedKeys(unlessGuidance(texts[0], plainText)) : [];
        if (keys.length && action) {
          keyboard = push(keyboard, { keys, action });
          if (isStamped(texts[0]) || isStamped(texts[texts.length - 1])) authored.add('keyboard');
        }
        return;
      }
      case 'guidelinePair': {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0) return;
        let doCard: GuidelineCard | null = null;
        let dontCard: GuidelineCard | null = null;
        for (const c of node.children ?? []) {
          const inner = c.getPluginData(SLOT_KEY);
          if (inner === 'guidelineDo') doCard = card(c);
          else if (inner === 'guidelineDont') dontCard = card(c);
        }
        if (doCard || dontCard) pairs.push({ index, pair: { do: doCard, dont: dontCard } });
        return;
      }
      default:
        return;
    }
  };
  visit(root);

  const out: CanvasProse = {};
  // Only the half actually seen (see CanvasProse).
  if (lead !== undefined || definitionLines.length) {
    out.overview = {};
    if (lead !== undefined) out.overview.lede = lead;
    if (definitionLines.length) out.overview.body = definitionLines;
  }
  for (const slot of LIST_SLOTS) { const items = lists.get(slot); if (items && items.length) out[slot as 'pointer'] = items; }
  if (variantsIntro && variantsIntro.length) out.variantsIntro = variantsIntro.join('\n');
  if (guide) out.variantsGuide = guide;
  if (anatomySummary) out.anatomySummary = anatomySummary;
  if (parts) out.anatomyParts = parts;
  if (properties) out.properties = properties;
  if (keyboard) out.keyboard = keyboard;
  if (pairs.length) out.guidelines = [...pairs].sort((a, b) => a.index - b.index).map((p) => p.pair);
  const typed = PROSE_V2_KEYS.filter((k) => authored.has(k) && out[k as keyof CanvasProse] !== undefined);
  if (typed.length) out.authored = typed;
  return out;
}

/** Every ProseV2 field this module reads off the canvas. Referenced only in
 *  the type position below, so it is prefixed like the guard it feeds. */
const _HANDLED_PROSE_KEYS = [
  'overview', 'whenToUse', 'whenNotToUse', 'variantsIntro', 'variantsGuide',
  'anatomySummary', 'anatomyParts', 'properties', 'states', 'keyboard',
  'pointer', 'semantics', 'content', 'guidelines',
] as const;

// Compile-time guard: a ProseV2 field missing from _HANDLED_PROSE_KEYS fails
// to compile instead of never being read. `authored` is metadata, not a slot,
// so it is excluded with `v`.
type UncoveredProseKey = Exclude<Exclude<keyof ProseV2, 'v' | 'authored'>, (typeof _HANDLED_PROSE_KEYS)[number]>;
const _everyProseKeyHasASlot: UncoveredProseKey extends never ? true : never = true;

/**
 * Canvas wins per field; stored fills what the canvas does not show.
 * `overview` merges per half, since the canvas may show only one, and exists
 * only when a half does, never as a fabricated `{ lede: '', body: [] }`.
 *
 * `authored` is the union of both sides, for keys that still have content, in
 * PROSE_V2_KEYS order. The union carries authorship past the first Update,
 * which rebuilds a filled placeholder as an ordinary section.
 */
export function mergeProse(stored: ProseV2 | null, canvas: CanvasProse): ProseV2 | null {
  const { overview: canvasOverview, authored: canvasAuthored, ...restCanvas } = canvas;
  const out: ProseV2 = { ...(stored ?? {}), ...restCanvas, v: 2 };
  delete out.authored;
  const lede = canvasOverview?.lede ?? stored?.overview?.lede;
  const body = canvasOverview?.body ?? stored?.overview?.body;
  if (lede !== undefined || body !== undefined) out.overview = { lede: lede ?? '', body: body ?? [] };
  else delete out.overview;
  const either = new Set([...normalizeAuthored(stored?.authored), ...normalizeAuthored(canvasAuthored)]);
  const authored = PROSE_V2_KEYS.filter((k) => either.has(k) && hasProseContent({ v: 2, [k]: out[k] }));
  if (authored.length) out.authored = authored;
  return hasProseContent(out) ? out : null;
}

/**
 * The generated lane's text in document order: every text node outside an
 * editorial slot or a component instance. This is what selfHash covers, so an
 * edit here means "Update will replace this" and one in a slot means nothing.
 * A doc rendered before tagging has no slots, so all its text is returned,
 * matching its stored hash.
 *
 * The publish pill and the Placeholder tag are skipped like slots: Update
 * redraws both, so editing or deleting them destroys nothing. No shipped doc
 * carries the tag, so no stored hash moves.
 */
export function collectGeneratedText(root: ProseNodeLike): string[] {
  const tagged = laneTaggedIds(root);
  const excluded = (n: ProseNodeLike): boolean => (tagged && n !== root && n.id !== undefined
    ? tagged.has(n.id)
    : LANE_EXCLUSIONS.some((key) => n.getPluginData(key) !== ''));
  const out: string[] = [];
  const visit = (n: ProseNodeLike): void => {
    if (n.type === 'INSTANCE') return;
    if (excluded(n)) return;
    if (n.type === 'TEXT') {
      out.push(n.characters ?? '');
      return;
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(root);
  return out;
}

/** Tags that take a subtree out of the generated lane. A pill version that
 *  moves must never read as a hand edit (see publishPill.ts). */
const LANE_EXCLUSIONS = [SLOT_KEY, PILL_KEY, PLACEHOLDER_TAG_KEY];

/**
 * Every lane-tagged node under `root` from one native search, so the walk reads
 * no plugin data per node. Figma removes a key set to '', so "has the key" is
 * "getPluginData(key) !== ''". Null when the search is missing or throws; the
 * walk then reads tags per node. `root` itself is checked by the walk.
 */
function laneTaggedIds(root: ProseNodeLike): Set<string> | null {
  if (typeof root.findAllWithCriteria !== 'function') return null;
  try {
    return new Set(root.findAllWithCriteria({ pluginData: { keys: LANE_EXCLUSIONS } }).map((n) => n.id));
  } catch {
    return null;
  }
}
