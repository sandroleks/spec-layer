/// <reference types="@figma/plugin-typings" />
/**
 * docText.ts: the text and table primitives every generated block shares.
 *
 * Lifted from docFrame.ts so anatomySection.ts and docBlocks.ts can build
 * bullets, prose and tables without importing the frame entry point.
 * Editorial tagging lives here too, because a block that renders prose is a
 * block that must tag it for read-back.
 */
import { parseRuns, headingLine } from './ui/docModel';
import type { Bullet, TextRun } from './ui/docModel';
import { palette, solidFill, vstack, hstack, makeText, font, headingFont, radius, type FontStyle } from './frameKit';
import { SLOT_KEY, LINE_KEY, type ProseSlot, type LineKind } from './canvasProse';

export function tagSlot(node: SceneNode, slot: ProseSlot): void {
  node.setPluginData(SLOT_KEY, slot);
}

export function tagLine(node: SceneNode, kind: LineKind): void {
  node.setPluginData(LINE_KEY, kind);
}

/**
 * Apply run styling over `node.characters`. Bold runs take the Bold face.
 * Code runs take the Medium face in `codeInk`, which is how a code span is
 * drawn on canvas: Figma text has no inline boxes, so a chip is impossible
 * inside wrapping text, and Medium is otherwise unused in body text, which is
 * what lets textToMarkdown read it back as backticks. `prefix` accounts for
 * leading characters placed ahead of the runs.
 *
 * `codeInk` defaults to the heading ink, right for every body-surface caller
 * (prose, bullets). The header subtitle sits on the dark header band instead
 * of the page background, so its caller (docFrame.ts's buildHeader) must pass
 * an ink that reads there — the default would paint a code span the same
 * colour as the band on the default theme, making it invisible.
 */
export function applyRuns(node: TextNode, runs: TextRun[], prefix = 0, codeInk: RGB = palette.heading): void {
  let cursor = prefix;
  for (const run of runs) {
    const start = cursor;
    const end = cursor + run.text.length;
    if (run.text.length > 0) {
      if (run.bold) node.setRangeFontName(start, end, font('Bold'));
      else if (run.code) {
        node.setRangeFontName(start, end, font('Medium'));
        node.setRangeFills(start, end, solidFill(codeInk));
      }
    }
    cursor = end;
  }
}

/** Detect "_italic placeholder_" lines. */
export function emphasisOnly(line: string): string | null {
  const m = /^_(.+)_$/.exec(line.trim());
  return m ? m[1] : null;
}

/** A small accent bar used as a section eyebrow rule. */
export function accentRule(): FrameNode {
  const rule = figma.createFrame();
  rule.resize(28, 3);
  rule.cornerRadius = radius(2);
  rule.fills = solidFill(palette.accent);
  return rule;
}

function splitMarker(text: string): { marker: string; rest: string } {
  const m = /^([✅❌•▪◦–-])\s+(.*)$/u.exec(text);
  if (m) return { marker: m[1], rest: m[2] };
  return { marker: '•', rest: text };
}

function dropLeading(runs: TextRun[], count: number): TextRun[] {
  const out: TextRun[] = [];
  let remaining = count;
  for (const run of runs) {
    if (remaining >= run.text.length) { remaining -= run.text.length; continue; }
    out.push(remaining > 0 ? { ...run, text: run.text.slice(remaining) } : run);
    remaining = 0;
  }
  return out;
}

/** Render a single bullet as marker column plus wrapping content row. */
export function makeBulletRow(bullet: Bullet): FrameNode {
  const placeholder = emphasisOnly(bullet.text);
  const row = hstack(10);
  row.counterAxisAlignItems = 'MIN';
  if (placeholder) {
    const node = makeText(placeholder, 'Regular', 15, palette.muted, 155);
    row.appendChild(node);
    node.layoutSizingHorizontal = 'FILL';
    node.textAutoResize = 'HEIGHT';
    return row;
  }
  const { marker, rest } = splitMarker(bullet.text);
  const markerColor = marker === '❌' ? palette.muted : palette.accent;
  const markerNode = makeText(marker, 'Medium', 15, markerColor, 155);
  row.appendChild(markerNode);
  markerNode.textAutoResize = 'WIDTH_AND_HEIGHT';
  const runsMatchText = bullet.runs.map((r) => r.text).join('') === bullet.text;
  const runs = runsMatchText ? dropLeading(bullet.runs, bullet.text.length - rest.length) : parseRuns(rest);
  const plain = runs.map((r) => r.text).join('');
  const content = makeText(plain, 'Regular', 15, palette.body, 155);
  row.appendChild(content);
  content.layoutSizingHorizontal = 'FILL';
  content.textAutoResize = 'HEIGHT';
  applyRuns(content, runs, 0);
  return row;
}

/** Markdown lines to canvas nodes: placeholders, ### subheadings, bullets, paragraphs. */
export function buildProse(text: string): SceneNode[] {
  const out: SceneNode[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.trim() === '') continue;
    const placeholder = emphasisOnly(line);
    if (placeholder) {
      const node = makeText(placeholder, 'Regular', 15, palette.muted, 155);
      tagLine(node, 'placeholder');
      out.push(node);
      continue;
    }
    const subheading = headingLine(line);
    if (subheading !== null) {
      const wrap = vstack(0);
      wrap.paddingTop = 8;
      const node = makeText(subheading, 'Bold', 17, palette.heading, 130);
      node.fontName = headingFont('Bold');
      wrap.appendChild(node);
      node.layoutSizingHorizontal = 'FILL';
      node.textAutoResize = 'HEIGHT';
      tagLine(wrap, 'heading');
      out.push(wrap);
      continue;
    }
    const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      const runs = parseRuns(bulletMatch[1]);
      const plain = runs.map((r) => r.text).join('');
      const row = makeBulletRow({ runs, text: plain });
      tagLine(row, 'bullet');
      out.push(row);
    } else {
      const runs = parseRuns(line);
      const plain = runs.map((r) => r.text).join('');
      const node = makeText(plain, 'Regular', 15, palette.body, 155);
      applyRuns(node, runs, 0);
      tagLine(node, 'paragraph');
      out.push(node);
    }
  }
  if (out.length === 0) {
    const empty = makeText('', 'Regular', 15, palette.body, 155);
    tagLine(empty, 'paragraph');
    out.push(empty);
  }
  return out;
}

export type ColWidth = number | 'grow';

function columnWidths(columns: string[], contentWidth: number): ColWidth[] {
  const n = columns.length;
  return columns.map((_, i) => (i === n - 1 ? ('grow' as const) : Math.floor((contentWidth * 0.7) / Math.max(n - 1, 1))));
}

export function makeCell(text: string, style: FontStyle, size: number, color: RGB, trackingPct?: number): FrameNode {
  const cell = vstack(0);
  cell.paddingTop = 12;
  cell.paddingBottom = 12;
  cell.paddingLeft = 16;
  cell.paddingRight = 16;
  const node = makeText(text, style, size, color, 145, trackingPct);
  cell.appendChild(node);
  node.layoutSizingHorizontal = 'FILL';
  node.textAutoResize = 'HEIGHT';
  return cell;
}

export function applyColWidth(cell: FrameNode, width: ColWidth): void {
  if (width === 'grow') cell.layoutSizingHorizontal = 'FILL';
  else { cell.layoutSizingHorizontal = 'FIXED'; cell.resize(width, cell.height); }
}

/** Rounded bordered table, tinted uppercase header, key column in heading ink. */
export function buildTable(columns: string[], rows: string[][], contentWidth: number): FrameNode {
  const widths = columnWidths(columns, contentWidth);
  const table = vstack(0);
  table.cornerRadius = radius(8);
  table.clipsContent = true;
  table.strokes = solidFill(palette.border);
  table.strokeWeight = 1;
  const colCount = Math.max(columns.length, 1);
  const head = hstack(0);
  head.fills = solidFill(palette.tableHeadBg);
  table.appendChild(head);
  head.layoutSizingHorizontal = 'FILL';
  head.counterAxisAlignItems = 'MIN';
  for (let i = 0; i < colCount; i++) {
    const cell = makeCell((columns[i] ?? '').toUpperCase(), 'Medium', 11, palette.muted);
    head.appendChild(cell);
    applyColWidth(cell, widths[i]);
  }
  // Data rows. Kept as a permanent fallback: a table with no rows still says
  // "None" rather than reading as a bare header strip. A cell is a label, so
  // no period. Every current caller skips an empty table, so this is a guard.
  if (rows.length === 0) {
    const empty = hstack(0);
    table.appendChild(empty);
    empty.layoutSizingHorizontal = 'FILL';
    empty.strokes = solidFill(palette.divider);
    empty.strokeTopWeight = 1;
    const cell = makeCell('None', 'Regular', 14, palette.muted);
    empty.appendChild(cell);
    applyColWidth(cell, 'grow');
  }
  for (const r of rows) {
    const row = hstack(0);
    table.appendChild(row);
    row.layoutSizingHorizontal = 'FILL';
    row.counterAxisAlignItems = 'MIN';
    row.strokes = solidFill(palette.divider);
    row.strokeTopWeight = 1;
    row.strokeBottomWeight = 0;
    row.strokeLeftWeight = 0;
    row.strokeRightWeight = 0;
    for (let i = 0; i < colCount; i++) {
      const isKey = i === 0;
      const cell = makeCell(r[i] ?? '', isKey ? 'Medium' : 'Regular', 14, isKey ? palette.heading : palette.body);
      row.appendChild(cell);
      applyColWidth(cell, widths[i]);
    }
  }
  return table;
}
