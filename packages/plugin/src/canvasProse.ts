/**
 * canvasProse.ts — read the editorial lane of a component doc back off the
 * canvas.
 *
 * A doc has two lanes. The generated lane (tables, matrices, chrome) is
 * derived from the component and is always rebuilt. The editorial lane (the
 * writing sections) is authored, first by the AI or a placeholder and then by
 * whoever edits the canvas, so the canvas is its source of truth. docFrame.ts
 * tags editorial nodes with pluginData at render time; this module turns
 * those tags back into a ProseV2 overlay so an Update can rebuild the
 * generated lane without losing a word anyone wrote.
 *
 * No Figma globals. The main thread passes real nodes; tests pass plain
 * objects. This module is imported by main.ts, which runs in Figma's bare
 * sandbox realm, so it may use only ECMAScript built-ins.
 */
import { hasProseContent, type ProseV2, type GuidelinePair, type GuidelineCard } from '@spec-layer/extractor';
import { PILL_KEY } from './publishPill';
import { displayPartName } from './ui/displayNames';

/** pluginData key naming which editorial slot a node (and its subtree) fills. */
export const SLOT_KEY = 'specLayerSlot';
/** pluginData key on a keyed row (anatomyPart, propertyDescription,
 *  keyboardRow, variantsGuide, guidelinePair) holding the row's key. */
export const SLOT_PART_KEY = 'specLayerSlotKey';
/** pluginData key on a node inside a prose slot saying what kind of line it is. */
export const LINE_KEY = 'specLayerLine';

export type ProseSlot =
  | 'definitionLead' | 'definition' | 'whenToUse' | 'whenNotToUse' | 'variantsIntro' | 'variantsGuide'
  | 'anatomySummary' | 'anatomyPart' | 'propertyDescription' | 'keyboardRow'
  | 'pointer' | 'semantics' | 'content' | 'guidelinePair' | 'guidelineDo' | 'guidelineDont';

export type LineKind = 'paragraph' | 'heading' | 'bullet' | 'placeholder';

/** The placeholder as it reads on canvas: the `_To be written._` earlier
 *  builds wrote, with the emphasis markers stripped by the renderer. The doc
 *  model no longer emits it (an empty section is omitted instead), but a
 *  document already on canvas still carries it, so the read-back must keep
 *  recognising it as "nobody wrote this". */
export const PLACEHOLDER_TEXT = 'To be written.';

/** The slice of a Figma node this module reads. Structural so tests can pass
 *  plain objects and the main thread can pass SceneNodes (cast, since the
 *  typings' overloaded generic `getStyledTextSegments` is not assignable). */
export interface ProseNodeLike {
  type: string;
  characters?: string;
  children?: readonly ProseNodeLike[];
  getPluginData(key: string): string;
  getStyledTextSegments?(fields: ['fontName']):
    readonly { characters: string; fontName: { family: string; style: string } }[];
}

/** Every field optional: absent means the canvas does not show that slot.
 *  `overview` is further split into its own two optional halves: the header
 *  lead and the definition body are two separate tagged slots, so a doc with
 *  only one of them tagged must report only that half, never a fabricated
 *  empty string or empty array for the other. */
export type CanvasProse = Partial<Omit<ProseV2, 'v' | 'overview'>> & {
  overview?: { lede?: string; body?: string[] };
};

/**
 * A text node's characters as markdown. Bold segments become **bold**, Medium
 * segments become `code`: body text is Regular and lead-ins are Bold, so
 * Medium can only mean a code span (see docText.applyRuns). A whitespace-only
 * styled segment is left plain.
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

function allTexts(node: ProseNodeLike, out: ProseNodeLike[] = []): ProseNodeLike[] {
  if (node.type === 'TEXT') out.push(node);
  for (const c of node.children ?? []) allTexts(c, out);
  return out;
}

/** One markdown line per child of a prose block container. */
function readLines(container: ProseNodeLike): string[] {
  const lines: string[] = [];
  for (const child of container.children ?? []) {
    const kind = child.getPluginData(LINE_KEY);
    const texts = allTexts(child);
    if (texts.length === 0) continue;
    if (kind === 'heading') { lines.push(`### ${texts[0].characters ?? ''}`); continue; }
    if (kind === 'bullet') { lines.push(textToMarkdown(texts[texts.length - 1])); continue; }
    const md = textToMarkdown(texts[0]);
    if (kind === 'placeholder' && md.trim() === PLACEHOLDER_TEXT) continue;
    if (md.trim() === '') continue;
    lines.push(md);
  }
  return lines;
}

/** One item per bullet row of a list block: the last text node is the content. */
function readBullets(container: ProseNodeLike): string[] {
  const items: string[] = [];
  for (const row of container.children ?? []) {
    const texts = allTexts(row);
    if (texts.length === 0) continue;
    const md = textToMarkdown(texts[texts.length - 1]);
    if (md.trim() === '' || md.trim() === PLACEHOLDER_TEXT) continue;
    items.push(md);
  }
  return items;
}

const LIST_SLOTS = new Set<ProseSlot>(['whenToUse', 'whenNotToUse', 'pointer', 'semantics', 'content']);

/** Exactly what `anatomySection.ts` writes before the note. */
const SHOWN_WHEN_LEAD = '  ·  Shown when ';
const SHOWN_WHEN_TAIL = ' is true';

/**
 * Drop the trailing "  ·  Shown when <prop> is true" note the anatomy legend
 * appends, so it never reads back as part of an authored role.
 *
 * indexOf on the writer's own separator rather than
 * `/\s+·\s+Shown when .+ is true$/`: that pattern's unanchored leading `\s+`
 * backtracks quadratically over a whitespace run, and this runs on
 * user-editable canvas text on the main thread.
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
  const pairs = new Map<number, GuidelinePair>();

  const push = <T>(list: T[] | undefined, item: T): T[] => { const l = list ?? []; l.push(item); return l; };
  const lastText = (node: ProseNodeLike): string => {
    const texts = allTexts(node);
    return texts.length ? textToMarkdown(texts[texts.length - 1]).trim() : '';
  };
  const card = (node: ProseNodeLike): GuidelineCard | null => {
    // The last two text nodes are the rule then the reason. A card built with
    // a leading DO/DON'T label (three nodes) drops that label by taking only
    // the tail; a two-node card (no label) is unaffected. The rule node is
    // read as plain characters, not through textToMarkdown: Task 11 renders
    // the whole rule in the Bold face as card styling, not as a bold markdown
    // run, so converting it would stamp every stored rule with `**...**`.
    const texts = allTexts(node).slice(-2);
    const ruleNode = texts[0];
    const rule = ruleNode ? (ruleNode.characters ?? '').trim() : '';
    if (!rule) return null;
    const reasonNode = texts[1];
    const reason = reasonNode ? textToMarkdown(reasonNode).trim() : '';
    return { rule, reason };
  };

  const visit = (node: ProseNodeLike): void => {
    if (node.type === 'INSTANCE') return;
    const slotName = node.getPluginData(SLOT_KEY);
    if (slotName === '') { for (const c of node.children ?? []) visit(c); return; }
    const slot = slotName as ProseSlot;
    const key = node.getPluginData(SLOT_PART_KEY);
    if (LIST_SLOTS.has(slot)) {
      lists.set(slot, [...(lists.get(slot) ?? []), ...readBullets(node)]);
      return;
    }
    switch (slot) {
      case 'definitionLead': { const v = textToMarkdown(node).trim(); if (v) lead = lead ? `${lead} ${v}` : v; return; }
      case 'definition': definitionLines.push(...readLines(node)); return;
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
        // The legend prints the DISPLAY name (see anatomySection.ts), while the
        // tag keeps the RAW key, so both spellings of "no role" (and both
        // lead-ins) must be checked before falling through to the loose
        // ": "-search below — otherwise a nested part named in camelCase/
        // snake_case/kebab-case whose component note itself contains ": "
        // (e.g. "Icon leading  ·  Icon: 24") is misread as an authored role.
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
        // Keys are joined with " + " (spaces included) by docBlocks, so that
        // "Shift+Tab" survives as one key.
        if (!key) return;
        const action = lastText(node);
        if (action) keyboard = push(keyboard, { keys: key.split(' + ').map((k) => k.trim()).filter(Boolean), action });
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
        if (doCard || dontCard) pairs.set(index, { do: doCard, dont: dontCard });
        return;
      }
      default:
        return;
    }
  };
  visit(root);

  const out: CanvasProse = {};
  // Set only the half actually seen: a doc with just the header lead tagged
  // must not report a fabricated empty body, and vice versa.
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
  if (pairs.size) out.guidelines = [...pairs.keys()].sort((a, b) => a - b).map((i) => pairs.get(i)!);
  return out;
}

/** Every ProseV2 field this module reads off the canvas. Referenced only in
 *  the type position below, so it is prefixed like the guard it feeds. */
const _HANDLED_PROSE_KEYS = [
  'overview', 'whenToUse', 'whenNotToUse', 'variantsIntro', 'variantsGuide',
  'anatomySummary', 'anatomyParts', 'properties', 'states', 'keyboard',
  'pointer', 'semantics', 'content', 'guidelines',
] as const;

// Compile-time guard: a future field added to ProseV2 must be added to
// _HANDLED_PROSE_KEYS above, or readCanvasProse would silently never fill it.
// This fails to compile when ProseV2 gains a field this list does not name.
type UncoveredProseKey = Exclude<Exclude<keyof ProseV2, 'v'>, (typeof _HANDLED_PROSE_KEYS)[number]>;
const _everyProseKeyHasASlot: UncoveredProseKey extends never ? true : never = true;

/**
 * Canvas wins per field; stored fills whatever the canvas does not show.
 * `overview` merges sub-field-wise rather than wholesale, since the canvas
 * can show only the lede or only the body: each half falls back to the
 * stored half independently, and the merged overview is included only when
 * at least one half exists, never fabricated as `{ lede: '', body: [] }`.
 */
export function mergeProse(stored: ProseV2 | null, canvas: CanvasProse): ProseV2 | null {
  const { overview: canvasOverview, ...restCanvas } = canvas;
  const out: ProseV2 = { ...(stored ?? {}), ...restCanvas, v: 2 };
  const lede = canvasOverview?.lede ?? stored?.overview?.lede;
  const body = canvasOverview?.body ?? stored?.overview?.body;
  if (lede !== undefined || body !== undefined) out.overview = { lede: lede ?? '', body: body ?? [] };
  else delete out.overview;
  return hasProseContent(out) ? out : null;
}

/**
 * The generated lane's text, in document order: every text node that is not
 * inside an editorial slot or a component instance. This is what selfHash
 * covers, so an edit here means "Update will replace this" and an edit in a
 * slot means nothing, because Update keeps it. A doc rendered before tagging
 * has no slots, so this returns all its text, matching its stored hash.
 *
 * The publish pill is skipped by `PILL_KEY` for the same reason slots are:
 * Update repaints it, so an edit there is not something Update would destroy.
 */
export function collectGeneratedText(root: ProseNodeLike): string[] {
  const out: string[] = [];
  const visit = (n: ProseNodeLike): void => {
    if (n.type === 'INSTANCE') return;
    if (n.getPluginData(SLOT_KEY) !== '') return;
    // The publish pill is a status stamp, not generated prose: a version that
    // moves must never read as a hand edit. See publishPill.ts.
    if (n.getPluginData(PILL_KEY) !== '') return;
    if (n.type === 'TEXT') {
      out.push(n.characters ?? '');
      return;
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(root);
  return out;
}
