/// <reference types="@figma/plugin-typings" />
import { parseRuns } from './ui/docModel';
import type {
  Bullet,
  DocFrameModel,
  SectionBlock,
  TextRun,
} from './ui/docModel';

// ---------------------------------------------------------------------------
// Design tokens for the generated doc frame
// ---------------------------------------------------------------------------
const COLOR_HEADER_BG: RGB = hex('#0d2436'); // navy header band
const COLOR_ON_HEADER: RGB = hex('#ffffff'); // title on navy
const COLOR_ON_HEADER_MUTED: RGB = hex('#9fb3c6'); // subtitle on navy
const COLOR_ACCENT: RGB = hex('#12b3a6'); // teal eyebrow rule / number
const COLOR_HEADING: RGB = hex('#0f172a'); // section headings
const COLOR_BODY: RGB = hex('#334155'); // paragraph / bullet ink
const COLOR_MUTED: RGB = hex('#64748b'); // secondary / placeholder
const COLOR_BG: RGB = hex('#ffffff'); // card fill
const COLOR_BORDER: RGB = hex('#e2e8f0'); // outer / table border
const COLOR_DIVIDER: RGB = hex('#eef2f6'); // row dividers
const COLOR_TABLE_HEAD_BG: RGB = hex('#f8fafc'); // table header tint

// Layout constants
const CARD_WIDTH = 880;
const PAD_X = 56; // horizontal padding for header + content
const CONTENT_WIDTH = CARD_WIDTH - PAD_X * 2;

const FONT_FAMILY = 'Inter';
type FontStyle = 'Regular' | 'Medium' | 'Bold';

function font(style: FontStyle): FontName {
  return { family: FONT_FAMILY, style };
}

/** Parse a #rrggbb string into a normalized RGB object. */
function hex(value: string): RGB {
  const h = value.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

function solidFill(color: RGB): Paint[] {
  return [{ type: 'SOLID', color }];
}

// ---------------------------------------------------------------------------
// Text construction
// ---------------------------------------------------------------------------

/**
 * Create a TextNode using one of the pre-loaded Inter faces.
 * Fonts MUST already be loaded (see buildDocFrame) before this is called.
 */
function makeText(
  chars: string,
  style: FontStyle,
  size: number,
  color: RGB = COLOR_BODY,
  lineHeightPct?: number,
): TextNode {
  const node = figma.createText();
  node.fontName = font(style);
  node.fontSize = size;
  node.characters = chars;
  node.fills = solidFill(color);
  if (lineHeightPct !== undefined) {
    node.lineHeight = { value: lineHeightPct, unit: 'PERCENT' };
  }
  return node;
}

/**
 * Apply the Inter Bold face over the character ranges that correspond to bold
 * runs. `prefix` accounts for any leading characters prepended ahead of the
 * runs in the node's `characters`.
 */
function applyBoldRuns(node: TextNode, runs: TextRun[], prefix = 0): void {
  let cursor = prefix;
  for (const run of runs) {
    const start = cursor;
    const end = cursor + run.text.length;
    if (run.bold && run.text.length > 0) {
      node.setRangeFontName(start, end, font('Bold'));
    }
    cursor = end;
  }
}

/** Detect "_italic placeholder_" lines (e.g. "_To be written._", "_None._"). */
function emphasisOnly(line: string): string | null {
  const m = /^_(.+)_$/.exec(line.trim());
  return m ? m[1] : null;
}

/**
 * Split a markdown block into its lead paragraph (first non-empty line) and the
 * remainder. The lead becomes the header subtitle; the rest renders as a body
 * section. Prevents multi-line markdown (headings, bullets) from leaking raw
 * `**`/`- ` markers into the single-line header subtitle.
 */
function splitLead(md: string): { lead: string; rest: string } {
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  const lead = i < lines.length ? lines[i].trim() : '';
  const rest = lines.slice(i + 1).join('\n').trim();
  return { lead, rest };
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** A vertical auto-layout frame that hugs its contents. */
function vstack(spacing: number): FrameNode {
  const frame = figma.createFrame();
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.itemSpacing = spacing;
  frame.fills = [];
  return frame;
}

/** A horizontal auto-layout frame that hugs its height. */
function hstack(spacing: number): FrameNode {
  const frame = figma.createFrame();
  frame.layoutMode = 'HORIZONTAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.itemSpacing = spacing;
  frame.fills = [];
  return frame;
}

/** A small teal accent bar used as a section eyebrow rule. */
function accentRule(): FrameNode {
  const rule = figma.createFrame();
  rule.resize(28, 3);
  rule.cornerRadius = 2;
  rule.fills = solidFill(COLOR_ACCENT);
  return rule;
}

// ---------------------------------------------------------------------------
// Bullets — hanging-indent rows (marker column + wrapping content)
// ---------------------------------------------------------------------------

/** Pull a leading emoji/marker (✅ ❌ •) off the text so it can sit in the
 *  marker column; default to a bullet dot otherwise. */
function splitMarker(text: string): { marker: string; rest: string } {
  const m = /^([✅❌•▪◦–-])\s+(.*)$/u.exec(text);
  if (m) return { marker: m[1], rest: m[2] };
  return { marker: '•', rest: text };
}

/** Render a single bullet as marker-column + wrapping content row. */
function makeBulletRow(bullet: Bullet): FrameNode {
  const placeholder = emphasisOnly(bullet.text);
  const row = hstack(10);
  row.counterAxisAlignItems = 'MIN'; // top-align marker with first text line

  if (placeholder) {
    // Muted, marker-less placeholder line ("None.", "To be written.")
    const node = makeText(placeholder, 'Regular', 15, COLOR_MUTED, 155);
    row.appendChild(node);
    node.layoutSizingHorizontal = 'FILL';
    node.textAutoResize = 'HEIGHT';
    return row;
  }

  const { marker, rest } = splitMarker(bullet.text);
  const markerColor = marker === '✅' ? COLOR_ACCENT : marker === '❌' ? COLOR_MUTED : COLOR_ACCENT;
  const markerNode = makeText(marker, 'Medium', 15, markerColor, 155);
  row.appendChild(markerNode);
  markerNode.textAutoResize = 'WIDTH_AND_HEIGHT';

  // Re-parse the rest so bold lead-ins survive the marker split.
  const runs = parseRuns(rest);
  const plain = runs.map((r) => r.text).join('');
  const content = makeText(plain, 'Regular', 15, COLOR_BODY, 155);
  row.appendChild(content);
  content.layoutSizingHorizontal = 'FILL';
  content.textAutoResize = 'HEIGHT';
  applyBoldRuns(content, runs, 0);
  return row;
}

// ---------------------------------------------------------------------------
// Prose — paragraphs and inline bullet lines
// ---------------------------------------------------------------------------

function buildProse(text: string): SceneNode[] {
  const out: SceneNode[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.trim() === '') continue;

    const placeholder = emphasisOnly(line);
    if (placeholder) {
      out.push(makeText(placeholder, 'Regular', 15, COLOR_MUTED, 155));
      continue;
    }

    const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      const runs = parseRuns(bulletMatch[1]);
      const plain = runs.map((r) => r.text).join('');
      out.push(makeBulletRow({ runs, text: plain }));
    } else {
      const runs = parseRuns(line);
      const plain = runs.map((r) => r.text).join('');
      const node = makeText(plain, 'Regular', 15, COLOR_BODY, 155);
      applyBoldRuns(node, runs, 0);
      out.push(node);
    }
  }
  if (out.length === 0) out.push(makeText('', 'Regular', 15, COLOR_BODY, 155));
  return out;
}

// ---------------------------------------------------------------------------
// Tables — rounded bordered container, tinted header, per-column widths
// ---------------------------------------------------------------------------

/** Per-column sizing: a fixed pixel width, or 'grow' to fill remaining space. */
type ColWidth = number | 'grow';

/** Heuristic column widths so the longest/free-text column grows. */
function columnWidths(columns: string[]): ColWidth[] {
  const n = columns.length;
  // Last column is typically the descriptive one → let it grow.
  return columns.map((_, i) => (i === n - 1 ? ('grow' as const) : Math.floor((CONTENT_WIDTH * 0.7) / Math.max(n - 1, 1))));
}

function makeCell(text: string, style: FontStyle, size: number, color: RGB): FrameNode {
  const cell = vstack(0);
  cell.paddingTop = 12;
  cell.paddingBottom = 12;
  cell.paddingLeft = 16;
  cell.paddingRight = 16;
  const node = makeText(text, style, size, color, 145);
  cell.appendChild(node);
  node.layoutSizingHorizontal = 'FILL';
  node.textAutoResize = 'HEIGHT';
  return cell;
}

function applyColWidth(cell: FrameNode, width: ColWidth): void {
  if (width === 'grow') {
    cell.layoutSizingHorizontal = 'FILL';
  } else {
    cell.layoutSizingHorizontal = 'FIXED';
    cell.resize(width, cell.height);
  }
}

function buildTable(columns: string[], rows: string[][]): FrameNode {
  const widths = columnWidths(columns);
  const table = vstack(0);
  table.cornerRadius = 8;
  table.clipsContent = true;
  table.strokes = solidFill(COLOR_BORDER);
  table.strokeWeight = 1;

  const colCount = Math.max(columns.length, 1);

  // Header row
  const head = hstack(0);
  head.fills = solidFill(COLOR_TABLE_HEAD_BG);
  table.appendChild(head);
  head.layoutSizingHorizontal = 'FILL';
  head.counterAxisAlignItems = 'MIN';
  for (let i = 0; i < colCount; i++) {
    const cell = makeCell((columns[i] ?? '').toUpperCase(), 'Medium', 11, COLOR_MUTED);
    head.appendChild(cell);
    applyColWidth(cell, widths[i]);
  }

  // Data rows
  if (rows.length === 0) {
    const empty = hstack(0);
    table.appendChild(empty);
    empty.layoutSizingHorizontal = 'FILL';
    empty.strokes = solidFill(COLOR_DIVIDER);
    empty.strokeTopWeight = 1;
    const cell = makeCell('None.', 'Regular', 14, COLOR_MUTED);
    empty.appendChild(cell);
    applyColWidth(cell, 'grow');
  }

  for (const r of rows) {
    const row = hstack(0);
    table.appendChild(row);
    row.layoutSizingHorizontal = 'FILL';
    row.counterAxisAlignItems = 'MIN';
    row.strokes = solidFill(COLOR_DIVIDER);
    row.strokeTopWeight = 1;
    row.strokeBottomWeight = 0;
    row.strokeLeftWeight = 0;
    row.strokeRightWeight = 0;
    for (let i = 0; i < colCount; i++) {
      // First column reads as the row's "key" → slightly stronger ink + weight.
      const isKey = i === 0;
      const cell = makeCell(
        r[i] ?? '',
        isKey ? 'Medium' : 'Regular',
        14,
        isKey ? COLOR_HEADING : COLOR_BODY,
      );
      row.appendChild(cell);
      applyColWidth(cell, widths[i]);
    }
  }

  return table;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** Build one section: teal accent rule + heading + body. */
function buildSection(section: SectionBlock): FrameNode {
  const group = vstack(16);
  group.name = section.heading;

  // Teal accent rule + heading (tightly grouped)
  const head = vstack(12);
  group.appendChild(head);
  head.layoutSizingHorizontal = 'FILL';
  head.appendChild(accentRule());

  const heading = makeText(section.heading, 'Bold', 24, COLOR_HEADING, 130);
  head.appendChild(heading);
  heading.layoutSizingHorizontal = 'FILL';

  // Body
  const body = vstack(section.kind === 'table' ? 0 : 10);
  group.appendChild(body);
  body.layoutSizingHorizontal = 'FILL';

  if (section.kind === 'prose') {
    for (const node of buildProse(section.text)) {
      body.appendChild(node);
      (node as TextNode).layoutSizingHorizontal = 'FILL';
    }
  } else if (section.kind === 'bullets') {
    for (const b of section.items) {
      const row = makeBulletRow(b);
      body.appendChild(row);
      row.layoutSizingHorizontal = 'FILL';
    }
  } else {
    const table = buildTable(section.columns, section.rows);
    body.appendChild(table);
    table.layoutSizingHorizontal = 'FILL';
  }

  return group;
}

// ---------------------------------------------------------------------------
// Header band
// ---------------------------------------------------------------------------

function buildHeader(componentName: string, subtitleMd: string | null): FrameNode {
  const band = vstack(14);
  band.fills = solidFill(COLOR_HEADER_BG);
  band.paddingTop = 48;
  band.paddingBottom = subtitleMd ? 44 : 48;
  band.paddingLeft = PAD_X;
  band.paddingRight = PAD_X;

  // We append children, set FILL, then fill text — order matters for FILL.
  const tmp: TextNode[] = [];

  const eyebrow = makeText('GUIDELINES', 'Medium', 12, COLOR_ON_HEADER_MUTED);
  band.appendChild(eyebrow);
  tmp.push(eyebrow);

  const title = makeText(componentName, 'Bold', 38, COLOR_ON_HEADER, 115);
  band.appendChild(title);
  tmp.push(title);

  if (subtitleMd) {
    // Parse the lead for **bold** runs and drop any leading list marker so no
    // raw markdown shows in the subtitle.
    const runs = parseRuns(subtitleMd.replace(/^[-*]\s+/, ''));
    const plain = runs.map((r) => r.text).join('');
    const sub = makeText(plain, 'Regular', 16, COLOR_ON_HEADER_MUTED, 155);
    band.appendChild(sub);
    applyBoldRuns(sub, runs, 0);
    tmp.push(sub);
  }

  for (const t of tmp) t.layoutSizingHorizontal = 'FILL';
  return band;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Build an on-canvas "Guidelines" frame from a DocFrameModel.
 * Returns the frame; the caller positions it and appends it to the page.
 */
export async function buildDocFrame(model: DocFrameModel): Promise<FrameNode> {
  // Load fonts FIRST — bold runs need the Bold face before setRangeFontName.
  await Promise.all(
    (['Regular', 'Medium', 'Bold'] as FontStyle[]).map((style) =>
      figma.loadFontAsync(font(style)),
    ),
  );

  // Lift the Definition's lead sentence into the header subtitle; any remaining
  // definition content renders as the first body section.
  const componentName = model.title.replace(/:\s*Guidelines$/i, '');
  const definition = model.sections.find(
    (s) => s.id === 'definition' && s.kind === 'prose',
  ) as Extract<SectionBlock, { kind: 'prose' }> | undefined;

  let subtitle: string | null = null;
  const definitionBody: SectionBlock[] = [];
  if (definition) {
    if (emphasisOnly(definition.text) !== null) {
      // Placeholder ("To be written.") → keep as a body section, no subtitle.
      definitionBody.push(definition);
    } else {
      const { lead, rest } = splitLead(definition.text);
      subtitle = lead || null;
      if (rest) definitionBody.push({ ...definition, kind: 'prose', text: rest });
    }
  }

  const bodySections: SectionBlock[] = [
    ...definitionBody,
    ...model.sections.filter((s) => s.id !== 'definition'),
  ];

  // Root card
  const frame = figma.createFrame();
  frame.name = model.title;
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'FIXED';
  frame.itemSpacing = 0;
  frame.fills = solidFill(COLOR_BG);
  frame.cornerRadius = 16;
  frame.clipsContent = true;
  frame.strokes = solidFill(COLOR_BORDER);
  frame.strokeWeight = 1;
  frame.resize(CARD_WIDTH, frame.height);
  frame.effects = [
    {
      type: 'DROP_SHADOW',
      color: { r: 0.06, g: 0.09, b: 0.16, a: 0.08 },
      offset: { x: 0, y: 12 },
      radius: 32,
      spread: 0,
      visible: true,
      blendMode: 'NORMAL',
    },
  ];

  // Header band
  const header = buildHeader(componentName, subtitle);
  frame.appendChild(header);
  header.layoutSizingHorizontal = 'FILL';

  // Content column
  const content = vstack(40);
  content.paddingTop = 48;
  content.paddingBottom = 56;
  content.paddingLeft = PAD_X;
  content.paddingRight = PAD_X;
  frame.appendChild(content);
  content.layoutSizingHorizontal = 'FILL';

  for (const section of bodySections) {
    const group = buildSection(section);
    content.appendChild(group);
    group.layoutSizingHorizontal = 'FILL';
  }

  return frame;
}
