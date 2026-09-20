/// <reference types="@figma/plugin-typings" />
/**
 * foundationSpecimens.ts: the list layouts for text styles and effect styles.
 *
 * A style is shown, not tabulated: a text style sets a sentence in itself at
 * true size, an effect style casts its shadow on a card. Under each specimen a
 * line names the metrics or layers, with a chip for every value that is bound
 * to a token. The pure halves (`metricsLine`, `layerLines`, `figmaEffectsFor`)
 * are tested; the drawing is verified on canvas by the Figma matrix.
 *
 * Runs on the main thread: ECMAScript and the figma API only.
 */
import type { FoundationTextMetrics, FoundationTextRow } from '@spec-layer/extractor';
import { groupRowsByFolder, groupTitles } from '@spec-layer/extractor';
import { palette, solidFill, vstack, hstack, makeText, headingFont, radius } from './frameKit';

export interface LinePart { label: string; tokens: string[] }

/** Set in every text style at true size. A sentence shows rhythm and descenders a name cannot. */
export const SPECIMEN_TEXT = 'The quick brown fox jumps over the lazy dog';

const CASE_WORD: Record<string, string> = {
  UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'title case',
  SMALL_CAPS: 'small caps', SMALL_CAPS_FORCED: 'small caps forced',
};

function lineHeightLabel(lh: FoundationTextMetrics['lineHeight']): string {
  if (lh.unit === 'AUTO') return 'auto';
  if (lh.value === undefined) return 'unknown';
  return lh.unit === 'PERCENT' ? `${lh.value}%` : String(lh.value);
}

function spacingLabel(s: FoundationTextMetrics['letterSpacing']): string {
  return s.unit === 'PERCENT' ? `${s.value}%` : String(s.value);
}

const tokensFor = (b: Record<string, string>, ...fields: string[]): string[] =>
  fields.flatMap((f) => (b[f] ? [b[f]] : []));

/** The metrics line, as parts so the renderer can put a chip after any that carry a token. */
export function metricsLine(m: FoundationTextMetrics): LinePart[] {
  const b = m.boundTokens;
  const parts: LinePart[] = [
    { label: m.fontFamily, tokens: tokensFor(b, 'fontFamily') },
    { label: m.fontStyle, tokens: tokensFor(b, 'fontStyle') },
    { label: `${m.fontSize}/${lineHeightLabel(m.lineHeight)}`, tokens: tokensFor(b, 'fontSize', 'lineHeight') },
    { label: `letter spacing ${spacingLabel(m.letterSpacing)}`, tokens: tokensFor(b, 'letterSpacing') },
    { label: `paragraph spacing ${m.paragraphSpacing}`, tokens: tokensFor(b, 'paragraphSpacing') },
  ];
  if (m.textCase !== 'ORIGINAL') {
    parts.push({ label: CASE_WORD[m.textCase] ?? m.textCase.toLowerCase().replace(/_/g, ' '), tokens: [] });
  }
  if (m.textDecoration !== 'NONE') parts.push({ label: m.textDecoration.toLowerCase(), tokens: [] });
  return parts;
}

function tokenChip(name: string): FrameNode {
  const c = hstack(0);
  c.paddingTop = c.paddingBottom = 1;
  c.paddingLeft = c.paddingRight = 5;
  c.cornerRadius = radius(4);
  c.fills = solidFill(palette.chipBg);
  const t = makeText(name, 'Medium', 10, palette.heading);
  t.textAutoResize = 'WIDTH_AND_HEIGHT';
  c.appendChild(t);
  return c;
}

/** One wrapping row of muted parts separated by " · ", a chip after each part's tokens. */
export function partsRow(parts: LinePart[], contentWidth: number): FrameNode {
  const row = hstack(6);
  row.name = 'Metrics';
  row.layoutWrap = 'WRAP';
  row.counterAxisAlignItems = 'CENTER';
  row.resize(contentWidth, row.height);
  row.layoutSizingHorizontal = 'FIXED';
  row.layoutSizingVertical = 'HUG';
  parts.forEach((part, i) => {
    // A separate node, not a "· " prefix baked into the label: keeps each part's
    // own text exactly what it says, so a reader (and a test) can find "paragraph
    // spacing 16" as its own string rather than a substring of "· paragraph spacing 16".
    if (i > 0) {
      const sep = makeText('·', 'Regular', 10, palette.muted);
      sep.textAutoResize = 'WIDTH_AND_HEIGHT';
      row.appendChild(sep);
    }
    const label = makeText(part.label, 'Regular', 10, palette.muted);
    label.textAutoResize = 'WIDTH_AND_HEIGHT';
    row.appendChild(label);
    for (const token of part.tokens) row.appendChild(tokenChip(token));
  });
  return row;
}

function fixedColumn(width: number): FrameNode {
  const col = vstack(6);
  col.resize(width, col.height);
  col.layoutSizingHorizontal = 'FIXED';
  col.layoutSizingVertical = 'HUG';
  return col;
}

function wrapped(parent: FrameNode, chars: string, style: 'Regular' | 'Medium', size: number, color: RGB): TextNode {
  const t = makeText(chars, style, size, color);
  parent.appendChild(t);
  t.layoutSizingHorizontal = 'FILL';
  t.textAutoResize = 'HEIGHT';
  return t;
}

function divider(row: FrameNode): void {
  row.strokes = solidFill(palette.divider);
  row.strokeTopWeight = 1;
  row.strokeBottomWeight = 0;
  row.strokeLeftWeight = 0;
  row.strokeRightWeight = 0;
}

function nameAndDescription(col: FrameNode, name: string, description: string, show: boolean): void {
  wrapped(col, name, 'Medium', 13, palette.heading);
  if (show && description) wrapped(col, description, 'Regular', 11, palette.muted);
}

/** Group rows under folder headings, the same derivation the swatch list uses. */
function groupedList<T extends { name: string }>(
  rows: T[], gap: number, renderRow: (row: T, index: number) => FrameNode,
): FrameNode {
  const list = vstack(32);
  const groups = groupRowsByFolder(rows);
  const titles = groupTitles(groups.map((g) => g.folder));
  groups.forEach((group, gi) => {
    const block = vstack(gap);
    block.name = group.folder || 'Ungrouped';
    if (group.folder) {
      const head = makeText(titles[gi], 'Bold', 15, palette.heading);
      head.fontName = headingFont('Bold');
      block.appendChild(head);
    }
    const body = vstack(0);
    block.appendChild(body);
    group.rows.forEach((row, i) => body.appendChild(renderRow(row, i)));
    list.appendChild(block);
  });
  return list;
}

const TEXT_FALLBACK_NOTE = 'Font not available, showing the default font.';

/**
 * The text-styles list. `failedFamilies` holds `${family}|${style}` keys whose
 * font could not be loaded; those specimens keep the kit font and say so.
 */
export function buildTextSpecimenList(
  rows: FoundationTextRow[], contentWidth: number, showDescriptions: boolean,
  failedFamilies: ReadonlySet<string>,
): FrameNode {
  const list = groupedList(rows, 14, (row, i) => {
    const col = fixedColumn(contentWidth);
    col.name = row.name;
    col.paddingTop = 18;
    col.paddingBottom = 18;
    if (i > 0) divider(col);
    nameAndDescription(col, row.name, row.description, showDescriptions);

    const m = row.metrics;
    const failed = failedFamilies.has(`${m.fontFamily}|${m.fontStyle}`);
    const specimen = wrapped(col, SPECIMEN_TEXT, 'Regular', m.fontSize, palette.heading);
    if (!failed) specimen.fontName = { family: m.fontFamily, style: m.fontStyle };
    specimen.lineHeight = m.lineHeight.unit === 'AUTO'
      ? { unit: 'AUTO' }
      : { unit: m.lineHeight.unit, value: m.lineHeight.value ?? 0 };
    specimen.letterSpacing = { unit: m.letterSpacing.unit, value: m.letterSpacing.value };
    specimen.textCase = m.textCase as TextCase;
    specimen.textDecoration = m.textDecoration as TextDecoration;

    col.appendChild(partsRow(metricsLine(m), contentWidth));
    if (failed) wrapped(col, TEXT_FALLBACK_NOTE, 'Regular', 10, palette.muted);
    return col;
  });
  list.name = 'Text styles';
  return list;
}
