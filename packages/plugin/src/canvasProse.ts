/**
 * canvasProse.ts — read the editorial lane of a component doc back off the
 * canvas.
 *
 * A doc has two lanes. The generated lane (tables, matrices, chrome) is
 * derived from the component and is always rebuilt. The editorial lane (the
 * writing sections) is authored, first by the AI or a placeholder and then by
 * whoever edits the canvas, so the canvas is its source of truth. docFrame.ts
 * tags editorial nodes with pluginData at render time; this module turns
 * those tags back into a ProseDrafts overlay so an Update can rebuild the
 * generated lane without losing a word anyone wrote.
 *
 * No Figma globals. The main thread passes real nodes; tests pass plain
 * objects. This module is imported by main.ts, which runs in Figma's bare
 * sandbox realm, so it may use only ECMAScript built-ins.
 */
import type { ProseDrafts, AnatomyPartProse } from '@spec-layer/extractor';

/** pluginData key naming which editorial slot a node (and its subtree) fills. */
export const SLOT_KEY = 'specLayerSlot';
/** pluginData key on an `anatomyPart` row holding the part's name. */
export const SLOT_PART_KEY = 'specLayerSlotKey';
/** pluginData key on a node inside a prose slot saying what kind of line it is. */
export const LINE_KEY = 'specLayerLine';

export type ProseSlot =
  | 'definitionLead' | 'definition' | 'accessibility' | 'interactions'
  | 'contentConsiderations' | 'dos' | 'donts' | 'variantsSummary'
  | 'anatomySummary' | 'anatomyPart';

export type LineKind = 'paragraph' | 'heading' | 'bullet' | 'placeholder';

/** The placeholder as it reads on canvas: docModel's `_To be written._` with
 *  the emphasis markers stripped by the renderer. */
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

/** Every field optional: absent means the canvas does not show that slot, or
 *  shows only the untouched placeholder. */
export type CanvasProse = Partial<ProseDrafts>;

type BlockSlot = 'definition' | 'accessibility' | 'interactions' | 'contentConsiderations' | 'variantsSummary';
const BLOCK_SLOTS: ReadonlySet<string> = new Set<BlockSlot>([
  'definition', 'accessibility', 'interactions', 'contentConsiderations', 'variantsSummary',
]);

/**
 * A text node's characters as markdown: bold segments wrapped in `**`, which
 * is exactly the markup parseRuns understands, so a rebuilt node bolds the
 * same characters. Other styling is not carried.
 */
export function textToMarkdown(node: ProseNodeLike): string {
  const chars = node.characters ?? '';
  if (!node.getStyledTextSegments) return chars;
  let segments: ReturnType<NonNullable<ProseNodeLike['getStyledTextSegments']>>;
  try {
    segments = node.getStyledTextSegments(['fontName']);
  } catch {
    return chars;
  }
  return segments
    .map((s) => (s.fontName.style === 'Bold' && s.characters.trim() !== '' ? `**${s.characters}**` : s.characters))
    .join('');
}

function allTexts(node: ProseNodeLike, out: ProseNodeLike[] = []): ProseNodeLike[] {
  if (node.type === 'TEXT') out.push(node);
  for (const c of node.children ?? []) allTexts(c, out);
  return out;
}

/** One markdown line per child of a prose slot container. */
function readLines(container: ProseNodeLike): string[] {
  const lines: string[] = [];
  for (const child of container.children ?? []) {
    const kind = child.getPluginData(LINE_KEY);
    const texts = allTexts(child);
    if (texts.length === 0) continue;
    if (kind === 'heading') {
      lines.push(`### ${texts[0].characters ?? ''}`);
      continue;
    }
    if (kind === 'bullet') {
      lines.push(`- ${textToMarkdown(texts[texts.length - 1])}`);
      continue;
    }
    const md = textToMarkdown(texts[0]);
    if (kind === 'placeholder' && md.trim() === PLACEHOLDER_TEXT) continue;
    if (md.trim() === '') continue;
    lines.push(md);
  }
  return lines;
}

/**
 * One item per row of a dos/donts container. The marker node is skipped and
 * the content node is read. Returns null when the container holds only the
 * placeholder, so the slot reads as absent rather than as an empty list; an
 * empty container is a real empty list, since someone deleted every row.
 */
function readBullets(container: ProseNodeLike): string[] | null {
  const items: string[] = [];
  let sawPlaceholder = false;
  for (const row of container.children ?? []) {
    const texts = allTexts(row);
    if (texts.length === 0) continue;
    const md = textToMarkdown(texts[texts.length - 1]);
    if (texts.length === 1 && md.trim() === PLACEHOLDER_TEXT) {
      sawPlaceholder = true;
      continue;
    }
    if (md.trim() === '') continue;
    items.push(md);
  }
  return items.length === 0 && sawPlaceholder ? null : items;
}

/** Walk a Section and collect what its editorial slots currently say. */
export function readCanvasProse(root: ProseNodeLike): CanvasProse {
  const blocks = new Map<BlockSlot, string[]>();
  let lead: string | undefined;
  let anatomySummary: string | undefined;
  let dos: string[] | undefined;
  let donts: string[] | undefined;
  let parts: AnatomyPartProse[] | undefined;

  const visit = (node: ProseNodeLike): void => {
    // Instance text mirrors the source component; it is never editorial.
    if (node.type === 'INSTANCE') return;
    const slot = node.getPluginData(SLOT_KEY);
    if (slot === '') {
      for (const c of node.children ?? []) visit(c);
      return;
    }
    if (BLOCK_SLOTS.has(slot)) {
      blocks.set(slot as BlockSlot, readLines(node));
      return;
    }
    switch (slot) {
      case 'definitionLead':
        lead = textToMarkdown(node);
        return;
      case 'anatomySummary':
        anatomySummary = textToMarkdown(node);
        return;
      case 'dos':
        dos = readBullets(node) ?? undefined;
        return;
      case 'donts':
        donts = readBullets(node) ?? undefined;
        return;
      case 'anatomyPart': {
        // Seeing any row means the anatomy legend is on canvas, so an empty
        // list is a real answer: every description was removed.
        if (!parts) parts = [];
        const name = node.getPluginData(SLOT_PART_KEY);
        const texts = allTexts(node);
        const chars = texts.length ? (texts[texts.length - 1].characters ?? '') : '';
        const i = chars.indexOf(': ');
        if (!name || i < 0) return;
        const description = chars.slice(i + 2).trim();
        if (description) parts.push({ name, description });
        return;
      }
      default:
        // A slot this build does not know (written by a newer plugin): leave
        // it alone rather than guess which field it belongs to.
        return;
    }
  };
  visit(root);

  const out: CanvasProse = {};
  const definitionLines = [...(lead && lead.trim() ? [lead] : []), ...(blocks.get('definition') ?? [])];
  if (definitionLines.length) out.definition = definitionLines.join('\n');
  for (const slot of ['accessibility', 'interactions', 'contentConsiderations', 'variantsSummary'] as const) {
    const lines = blocks.get(slot);
    if (lines && lines.length) out[slot] = lines.join('\n');
  }
  if (anatomySummary !== undefined && anatomySummary.trim()) out.anatomySummary = anatomySummary;
  if (dos) out.dos = dos;
  if (donts) out.donts = donts;
  if (parts) out.anatomyParts = parts;
  return out;
}

const OPTIONAL_KEYS = [
  'variantsSummary', 'anatomySummary', 'anatomyParts',
  'interactions', 'designConsiderations', 'contentConsiderations',
] as const;

/** True when at least one field carries real content: a non-blank string
 *  after trimming, or a non-empty array. An object with only empty strings
 *  and empty arrays (e.g. an anatomy legend on canvas with no descriptions)
 *  is not content — it must not read as "this doc has prose". */
function hasContent(p: ProseDrafts): boolean {
  for (const value of Object.values(p)) {
    if (typeof value === 'string') {
      if (value.trim() !== '') return true;
    } else if (Array.isArray(value)) {
      if (value.length > 0) return true;
    }
  }
  return false;
}

/**
 * Canvas wins per field; stored fills whatever the canvas does not show. A
 * section the config does not render leaves no tags, so its stored text
 * survives. Null when neither side has anything at all, or when the merge
 * itself carries no real content (e.g. canvas contributed only an empty
 * anatomyParts array and stored was null).
 */
export function mergeProse(stored: ProseDrafts | null, canvas: CanvasProse): ProseDrafts | null {
  if (!stored && Object.keys(canvas).length === 0) return null;
  const out: ProseDrafts = {
    definition: canvas.definition ?? stored?.definition ?? '',
    accessibility: canvas.accessibility ?? stored?.accessibility ?? '',
    dos: canvas.dos ?? stored?.dos ?? [],
    donts: canvas.donts ?? stored?.donts ?? [],
  };
  for (const key of OPTIONAL_KEYS) {
    const value = canvas[key] ?? stored?.[key];
    if (value !== undefined) (out as unknown as Record<string, unknown>)[key] = value;
  }
  return hasContent(out) ? out : null;
}

/**
 * The generated lane's text, in document order: every text node that is not
 * inside an editorial slot or a component instance. This is what selfHash
 * covers, so an edit here means "Update will replace this" and an edit in a
 * slot means nothing, because Update keeps it. A doc rendered before tagging
 * has no slots, so this returns all its text, matching its stored hash.
 */
export function collectGeneratedText(root: ProseNodeLike): string[] {
  const out: string[] = [];
  const visit = (n: ProseNodeLike): void => {
    if (n.type === 'INSTANCE') return;
    if (n.getPluginData(SLOT_KEY) !== '') return;
    if (n.type === 'TEXT') {
      out.push(n.characters ?? '');
      return;
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(root);
  return out;
}
