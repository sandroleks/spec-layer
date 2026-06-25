/// <reference types="@figma/plugin-typings" />
import { parseRuns } from './ui/docModel';
import type {
  AnatomyPartBlock,
  Bullet,
  DocFrameModel,
  SectionBlock,
  TextRun,
} from './ui/docModel';
import { DEFAULT_HEADER_BG, DEFAULT_ACCENT } from './brandColors';

// ---------------------------------------------------------------------------
// Design tokens for the generated doc frame
// ---------------------------------------------------------------------------
// The two brand colors are mutable: buildDocFrame() sets them from the user's
// Settings (falling back to these defaults) before laying out the frame. The
// build runs one frame at a time, so module-level state is safe here.
let COLOR_HEADER_BG: RGB = hex(DEFAULT_HEADER_BG); // navy header band
let COLOR_ACCENT: RGB = hex(DEFAULT_ACCENT); // teal eyebrow rule / number
const COLOR_ON_HEADER: RGB = hex('#ffffff'); // title on navy
const COLOR_ON_HEADER_MUTED: RGB = hex('#9fb3c6'); // subtitle on navy
const COLOR_HEADING: RGB = hex('#0f172a'); // section headings
const COLOR_BODY: RGB = hex('#334155'); // paragraph / bullet ink
const COLOR_MUTED: RGB = hex('#64748b'); // secondary / placeholder
const COLOR_BG: RGB = hex('#ffffff'); // card fill
const COLOR_BORDER: RGB = hex('#e2e8f0'); // outer / table border
const COLOR_DIVIDER: RGB = hex('#eef2f6'); // row dividers
const COLOR_TABLE_HEAD_BG: RGB = hex('#f8fafc'); // table header tint
const COLOR_CHIP_BG: RGB = hex('#eef1f5'); // token chip background
const COLOR_PANE_BG: RGB = hex('#fbfcfd'); // variant card left-pane tint

// Layout constants
const PAD_X = 56; // horizontal padding for header + content
const SLOT_MAX_H = 160; // cap instance height inside a slot
const VAR_LEFT_W = 240; // per-variant card: left pane (preview + properties)
const VAR_PANE_PAD = 20; // per-variant card: pane padding
const TOKEN_KEY_COL_W = 120; // token tables: fixed width of the non-Token columns

// The frame width is normally CARD_WIDTH_MIN, but token names can be long
// slash-paths and their chips hug their text, so the frame widens on build to
// give the Token column enough room (computed in fitFrameWidthToTokens()). These
// are `let` because they're recomputed per build; CONTENT_WIDTH derives from it.
const CARD_WIDTH_MIN = 880;
const CARD_WIDTH_MAX = 1440; // safety cap so a pathological token can't run away
let CARD_WIDTH = CARD_WIDTH_MIN;
let CONTENT_WIDTH = CARD_WIDTH - PAD_X * 2;

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

// ---------------------------------------------------------------------------
// Per-variant tokens — live instance slot + a token table with color swatches
// ---------------------------------------------------------------------------

// Local COLOR variables, loaded once, keyed by full name (e.g. "color/bg/brand")
// so a token string from the spec can be resolved to a swatch.
let colorVarCache: Map<string, Variable> | null = null;

async function loadColorVars(): Promise<Map<string, Variable>> {
  if (colorVarCache) return colorVarCache;
  const map = new Map<string, Variable>();
  try {
    const vars = await figma.variables.getLocalVariablesAsync('COLOR');
    for (const v of vars) map.set(v.name, v);
  } catch {
    /* variables API unavailable — swatches simply won't render */
  }
  colorVarCache = map;
  return map;
}

async function resolveVariableColor(v: Variable, depth = 0): Promise<RGB | null> {
  if (depth > 4) return null;
  try {
    const collection = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
    const modeId = collection?.defaultModeId;
    if (!modeId) return null;
    const value = v.valuesByMode[modeId];
    if (value && typeof value === 'object' && 'type' in value && (value as VariableAlias).type === 'VARIABLE_ALIAS') {
      const aliased = await figma.variables.getVariableByIdAsync((value as VariableAlias).id);
      return aliased ? resolveVariableColor(aliased, depth + 1) : null;
    }
    if (value && typeof value === 'object' && 'r' in value) {
      const c = value as RGBA;
      return { r: c.r, g: c.g, b: c.b };
    }
  } catch {
    /* unresolved → no swatch */
  }
  return null;
}

/** Resolve a token name to its swatch color, or null if it isn't a known color. */
async function resolveTokenColor(token: string): Promise<RGB | null> {
  const map = await loadColorVars();
  const v = map.get(token);
  return v ? resolveVariableColor(v) : null;
}

/** A 12×12 rounded color chip. */
function colorChip(color: RGB): FrameNode {
  const chip = figma.createFrame();
  chip.resize(12, 12);
  chip.cornerRadius = 3;
  chip.fills = solidFill(color);
  chip.strokes = solidFill(COLOR_BORDER);
  chip.strokeWeight = 1;
  return chip;
}

/** The Token cell: a rounded chip (like the web) holding an optional color
 *  swatch plus the token name. */
async function makeTokenCell(token: string): Promise<FrameNode> {
  const cell = vstack(0);
  cell.paddingTop = 10;
  cell.paddingBottom = 10;
  cell.paddingLeft = 16;
  cell.paddingRight = 16;

  const chip = figma.createFrame();
  chip.name = 'token';
  chip.layoutMode = 'HORIZONTAL';
  chip.primaryAxisSizingMode = 'AUTO';
  chip.counterAxisSizingMode = 'AUTO';
  chip.counterAxisAlignItems = 'CENTER';
  chip.itemSpacing = 6;
  chip.paddingTop = 3;
  chip.paddingBottom = 3;
  chip.paddingLeft = 8;
  chip.paddingRight = 8;
  chip.cornerRadius = 6;
  chip.fills = solidFill(COLOR_CHIP_BG);

  const color = await resolveTokenColor(token);
  if (color) chip.appendChild(colorChip(color));

  // Chip and text both hug their content (single-line pill). The Token column is
  // sized wide enough to hold the longest token (see fitFrameWidthToTokens), so
  // the pill never overflows and gets clipped.
  const text = makeText(token, 'Regular', 12, COLOR_BODY, 140);
  text.textAutoResize = 'WIDTH_AND_HEIGHT';
  chip.appendChild(text);

  cell.appendChild(chip);
  return cell;
}

/** Token table for a single variant. Rows arrive as [part, property, token, …]
 *  already ordered by part; we drop the repeated Part column and instead start
 *  each part's rows with a bold group-header band, so the table reads as grouped
 *  sub-sections. The Token column (last) holds long, slash-delimited names, so it
 *  FILLs the remaining width while the short key columns stay fixed-narrow.
 *  Sized to FILL its parent (the table sits beside the instance slot). */
async function buildTokenTable(
  columns: string[],
  rows: string[][],
  bordered = true,
): Promise<FrameNode> {
  // Column 0 is the Part group key; the rest are the rendered data columns.
  const dataColumns = columns.slice(1);
  const dataCount = Math.max(dataColumns.length, 1);
  const sizeCol = (cell: FrameNode, i: number): void => {
    if (i === dataCount - 1) {
      cell.layoutSizingHorizontal = 'FILL';
    } else {
      cell.layoutSizingHorizontal = 'FIXED';
      cell.resize(TOKEN_KEY_COL_W, cell.height);
    }
  };

  const table = vstack(0);
  if (bordered) {
    table.cornerRadius = 8;
    table.clipsContent = true;
    table.strokes = solidFill(COLOR_BORDER);
    table.strokeWeight = 1;
  }

  const head = hstack(0);
  head.fills = solidFill(COLOR_TABLE_HEAD_BG);
  table.appendChild(head);
  head.layoutSizingHorizontal = 'FILL';
  head.counterAxisAlignItems = 'MIN';
  for (let i = 0; i < dataCount; i++) {
    const cell = makeCell((dataColumns[i] ?? '').toUpperCase(), 'Medium', 11, COLOR_MUTED);
    head.appendChild(cell);
    sizeCol(cell, i);
  }

  if (rows.length === 0) {
    const empty = hstack(0);
    table.appendChild(empty);
    empty.layoutSizingHorizontal = 'FILL';
    empty.strokes = solidFill(COLOR_DIVIDER);
    empty.strokeTopWeight = 1;
    const cell = makeCell('None.', 'Regular', 14, COLOR_MUTED);
    empty.appendChild(cell);
    cell.layoutSizingHorizontal = 'FILL';
    return table;
  }

  let currentPart: string | null = null;
  for (const r of rows) {
    const part = r[0] ?? '';
    // Start a new group with a full-width, bold part band whenever the part
    // changes (rows are pre-sorted by part). A blank part gets no band.
    if (part && part !== currentPart) {
      currentPart = part;
      const groupHead = hstack(0);
      table.appendChild(groupHead);
      groupHead.layoutSizingHorizontal = 'FILL';
      groupHead.counterAxisAlignItems = 'MIN';
      groupHead.fills = solidFill(COLOR_TABLE_HEAD_BG);
      groupHead.strokes = solidFill(COLOR_BORDER);
      groupHead.strokeTopWeight = 1;
      groupHead.strokeBottomWeight = 0;
      groupHead.strokeLeftWeight = 0;
      groupHead.strokeRightWeight = 0;
      const cell = makeCell(part.toUpperCase(), 'Bold', 11, COLOR_HEADING);
      cell.paddingTop = 7;
      cell.paddingBottom = 7;
      groupHead.appendChild(cell);
      cell.layoutSizingHorizontal = 'FILL';
    }

    const row = hstack(0);
    table.appendChild(row);
    row.layoutSizingHorizontal = 'FILL';
    row.counterAxisAlignItems = 'MIN';
    row.strokes = solidFill(COLOR_DIVIDER);
    row.strokeTopWeight = 1;
    row.strokeBottomWeight = 0;
    row.strokeLeftWeight = 0;
    row.strokeRightWeight = 0;
    for (let i = 0; i < dataCount; i++) {
      const value = r[i + 1] ?? ''; // +1 skips the Part group key
      const isKey = i === 0;
      const isToken = i === dataCount - 1;
      const cell = isToken
        ? await makeTokenCell(value)
        : makeCell(value, isKey ? 'Medium' : 'Regular', 14, isKey ? COLOR_HEADING : COLOR_BODY);
      row.appendChild(cell);
      sizeCol(cell, i);
    }
  }

  return table;
}

/** A slot holding a live instance of the variant (or a placeholder). `width` is
 *  the slot's box width; the instance is rescaled to fit inside its padding. */
async function buildSlot(nodeId: string, width: number): Promise<FrameNode> {
  const slot = figma.createFrame();
  slot.name = 'Instance slot';
  slot.layoutMode = 'VERTICAL';
  slot.counterAxisSizingMode = 'FIXED'; // fixed width
  slot.primaryAxisSizingMode = 'AUTO'; // hug height
  slot.primaryAxisAlignItems = 'CENTER';
  slot.counterAxisAlignItems = 'CENTER';
  slot.paddingTop = slot.paddingBottom = slot.paddingLeft = slot.paddingRight = 12;
  slot.fills = solidFill(COLOR_BG);
  slot.cornerRadius = 8;
  slot.clipsContent = true;
  slot.strokes = solidFill(COLOR_DIVIDER);
  slot.strokeWeight = 1;
  slot.resize(width, width);

  let placed = false;
  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (node && node.type === 'COMPONENT') {
      const inst = (node as ComponentNode).createInstance();
      slot.appendChild(inst);
      const maxW = width - 24;
      const scale = Math.min(1, maxW / inst.width, SLOT_MAX_H / inst.height);
      if (scale < 1) inst.rescale(scale);
      placed = true;
    }
  } catch {
    /* fall through to placeholder */
  }
  if (!placed) {
    slot.appendChild(makeText('Drop instance', 'Regular', 11, COLOR_MUTED));
  }
  return slot;
}

/** The left-pane PROPERTIES list: a small heading + axis/value rows. */
function buildPropertyList(props: { name: string; value: string }[]): FrameNode {
  const wrap = vstack(8);
  const heading = makeText('PROPERTIES', 'Medium', 10, COLOR_MUTED);
  wrap.appendChild(heading);
  heading.layoutSizingHorizontal = 'FILL';

  const list = vstack(6);
  wrap.appendChild(list);
  list.layoutSizingHorizontal = 'FILL';

  for (const p of props) {
    const row = hstack(8);
    row.counterAxisAlignItems = 'CENTER';
    list.appendChild(row);
    row.layoutSizingHorizontal = 'FILL';

    const key = makeText(p.name, 'Regular', 12, COLOR_MUTED, 140);
    row.appendChild(key);
    key.layoutSizingHorizontal = 'FILL';
    key.textAutoResize = 'HEIGHT';

    const value = makeText(p.value, 'Medium', 12, COLOR_HEADING, 140);
    row.appendChild(value);
    value.textAutoResize = 'WIDTH_AND_HEIGHT';
  }
  return wrap;
}

// ---------------------------------------------------------------------------
// Anatomy — numbered callout diagram (component screenshot + numbered pins)
// ---------------------------------------------------------------------------

const PIN_SIZE = 18; // on-image numbered pin diameter
const LEGEND_BADGE = 20; // legend number badge diameter
const ANATOMY_PAD = 24; // diagram card padding
const ANATOMY_MAX_H = 360; // cap on the rendered screenshot height

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** A teal circle with a centered white number — shared by pins and legend. */
function numberBadge(n: number, size: number): FrameNode {
  const badge = figma.createFrame();
  badge.layoutMode = 'HORIZONTAL';
  badge.primaryAxisSizingMode = 'FIXED';
  badge.counterAxisSizingMode = 'FIXED';
  badge.primaryAxisAlignItems = 'CENTER';
  badge.counterAxisAlignItems = 'CENTER';
  badge.resize(size, size);
  badge.cornerRadius = size / 2;
  badge.fills = solidFill(COLOR_ACCENT);
  const label = makeText(String(n), 'Bold', size <= 18 ? 10 : 11, COLOR_ON_HEADER);
  badge.appendChild(label);
  return badge;
}

/** On-image pin: a number badge with a white ring + soft shadow so it reads on
 *  top of the screenshot. */
function anatomyPin(n: number): FrameNode {
  const pin = numberBadge(n, PIN_SIZE);
  pin.strokes = solidFill(COLOR_BG);
  pin.strokeWeight = 2;
  pin.effects = [
    {
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.28 },
      offset: { x: 0, y: 1 },
      radius: 4,
      spread: 0,
      visible: true,
      blendMode: 'NORMAL',
    },
  ];
  return pin;
}

/** Legend row: number badge + part name (with a "· component" note for nested). */
function anatomyLegendRow(part: AnatomyPartBlock): FrameNode {
  const row = hstack(10);
  row.counterAxisAlignItems = 'CENTER';
  row.appendChild(numberBadge(part.n, LEGEND_BADGE));
  const text = makeText(
    `${part.name}${part.nested ? '  ·  component' : ''}`,
    'Regular',
    15,
    COLOR_BODY,
    145,
  );
  row.appendChild(text);
  text.layoutSizingHorizontal = 'FILL';
  text.textAutoResize = 'HEIGHT';
  return row;
}

/**
 * Build the numbered-callout anatomy diagram: a screenshot of the default
 * variant with a numbered pin over each part, above a numbered legend.
 *
 * Returns null when the diagram can't be built (component missing, not
 * exportable, or no bounding box) so the caller can fall back to a list.
 */
async function buildAnatomyDiagram(
  componentId: string,
  parts: AnatomyPartBlock[],
): Promise<FrameNode | null> {
  let node: BaseNode | null;
  try {
    node = await figma.getNodeByIdAsync(componentId);
  } catch {
    return null;
  }
  if (!node || node.type !== 'COMPONENT') return null;
  const component = node;
  const cb = component.absoluteBoundingBox;
  if (!cb || cb.width <= 0 || cb.height <= 0) return null;

  // A live instance keeps the preview crisp at any size (vector, not a bitmap).
  let inst: InstanceNode;
  try {
    inst = component.createInstance();
  } catch {
    return null;
  }

  // Fit to the content width / height cap. Cap at 1× so a small component sits at
  // its natural size (centered) rather than stretched to fill the column.
  const maxW = CONTENT_WIDTH - ANATOMY_PAD * 2;
  const scale = Math.min(maxW / inst.width, ANATOMY_MAX_H / inst.height, 1);
  if (scale !== 1) inst.rescale(scale);
  const renderedW = inst.width;
  const renderedH = inst.height;

  // Diagram card: padded, bordered, tinted — same language as the instance slot.
  const card = vstack(20);
  card.paddingTop = card.paddingBottom = ANATOMY_PAD;
  card.paddingLeft = card.paddingRight = ANATOMY_PAD;
  card.fills = solidFill(COLOR_PANE_BG);
  card.cornerRadius = 8;
  card.strokes = solidFill(COLOR_BORDER);
  card.strokeWeight = 1;
  card.counterAxisAlignItems = 'CENTER';

  // Image box: a plain (non-auto-layout) frame holding the instance + pins, which
  // free-position by x/y. The instance goes in first so pins layer on top.
  const box = figma.createFrame();
  box.name = 'Anatomy diagram';
  box.resize(renderedW, renderedH);
  box.fills = [];
  box.clipsContent = false; // edge pins may overhang slightly
  card.appendChild(box);
  box.appendChild(inst);
  inst.x = 0;
  inst.y = 0;

  // Place a pin at each part's center, mapped from component coords into the box.
  for (const part of parts) {
    let p: BaseNode | null;
    try {
      p = await figma.getNodeByIdAsync(part.id);
    } catch {
      continue;
    }
    if (!p || !('absoluteBoundingBox' in p)) continue;
    const pb = (p as SceneNode).absoluteBoundingBox;
    if (!pb) continue;
    const nx = clamp01((pb.x + pb.width / 2 - cb.x) / cb.width);
    const ny = clamp01((pb.y + pb.height / 2 - cb.y) / cb.height);
    const pin = anatomyPin(part.n);
    box.appendChild(pin);
    pin.x = Math.round(nx * renderedW - PIN_SIZE / 2);
    pin.y = Math.round(ny * renderedH - PIN_SIZE / 2);
  }

  // Numbered legend below the screenshot.
  const legend = vstack(10);
  legend.counterAxisAlignItems = 'MIN';
  card.appendChild(legend);
  legend.layoutSizingHorizontal = 'FILL';
  for (const part of parts) {
    const row = anatomyLegendRow(part);
    legend.appendChild(row);
    row.layoutSizingHorizontal = 'FILL';
  }

  return card;
}

/** Build one section: teal accent rule + heading + body. */
async function buildSection(section: SectionBlock): Promise<FrameNode> {
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
  const bodySpacing = section.kind === 'table' ? 0 : section.kind === 'variantTokens' ? 20 : 10;
  const body = vstack(bodySpacing);
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
  } else if (section.kind === 'anatomy') {
    const diagram = await buildAnatomyDiagram(section.componentId, section.parts);
    if (diagram) {
      body.appendChild(diagram);
      diagram.layoutSizingHorizontal = 'FILL';
    } else {
      // Fallback: the numbered legend on its own when the screenshot can't render.
      for (const part of section.parts) {
        const row = anatomyLegendRow(part);
        body.appendChild(row);
        row.layoutSizingHorizontal = 'FILL';
      }
    }
  } else if (section.kind === 'variantTokens') {
    for (const variant of section.variants) {
      // A bordered card split into a left pane (preview + PROPERTIES) and a
      // right pane (token table), like the docs inspector.
      const card = hstack(0);
      card.cornerRadius = 12;
      card.clipsContent = true;
      card.strokes = solidFill(COLOR_BORDER);
      card.strokeWeight = 1;
      body.appendChild(card);
      card.layoutSizingHorizontal = 'FILL';

      // Left pane
      const left = vstack(16);
      left.fills = solidFill(COLOR_PANE_BG);
      left.paddingTop = left.paddingBottom = left.paddingLeft = left.paddingRight = VAR_PANE_PAD;
      left.strokes = solidFill(COLOR_BORDER);
      left.strokeRightWeight = 1;
      left.strokeTopWeight = 0;
      left.strokeBottomWeight = 0;
      left.strokeLeftWeight = 0;
      card.appendChild(left);
      left.layoutSizingHorizontal = 'FIXED';
      left.resize(VAR_LEFT_W, left.height);
      left.layoutSizingVertical = 'FILL'; // match the taller (token) pane

      const slot = await buildSlot(variant.nodeId, VAR_LEFT_W - VAR_PANE_PAD * 2);
      left.appendChild(slot);
      slot.layoutSizingHorizontal = 'FILL';

      const propList = buildPropertyList(variant.props);
      left.appendChild(propList);
      propList.layoutSizingHorizontal = 'FILL';

      // Right pane — no padding so the token table sits flush with the divider
      // and card edges; cell padding provides the text inset.
      const right = vstack(0);
      card.appendChild(right);
      right.layoutSizingHorizontal = 'FILL';
      right.layoutSizingVertical = 'FILL';

      const table = await buildTokenTable(section.columns, variant.rows, false);
      right.appendChild(table);
      table.layoutSizingHorizontal = 'FILL';
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

/** Measure a single-line string at the Token text style (Inter Regular 12). */
function measureTokenText(s: string): number {
  const t = figma.createText();
  t.fontName = font('Regular');
  t.fontSize = 12;
  t.characters = s;
  const w = t.width;
  t.remove();
  return w;
}

/**
 * Token chips hug their text, so a long token can overflow the Token column and
 * get clipped. Rather than wrap or shrink the chip, we widen the whole frame:
 * find the longest token across any per-variant token table, measure its chip,
 * and grow CARD_WIDTH so the (FILL) Token column is at least that wide. Stays at
 * CARD_WIDTH_MIN when there are no variant tokens or they're short, and is capped
 * at CARD_WIDTH_MAX. Must run after fonts load (it measures text).
 */
function fitFrameWidthToTokens(model: DocFrameModel): void {
  CARD_WIDTH = CARD_WIDTH_MIN;
  CONTENT_WIDTH = CARD_WIDTH - PAD_X * 2;

  let longest = '';
  let keyCols = 0; // rendered columns other than Token (Part is dropped — see buildTokenTable)
  for (const s of model.sections) {
    if (s.kind !== 'variantTokens') continue;
    const tokenCol = s.columns.length - 1;
    for (const v of s.variants) {
      for (const row of v.rows) {
        const tk = row[tokenCol] ?? '';
        if (tk.length > longest.length) {
          longest = tk;
          // buildTokenTable drops the Part column, so the fixed-width key
          // columns rendered are (all columns) minus Part minus Token.
          keyCols = tokenCol - 1;
        }
      }
    }
  }
  if (!longest) return;

  // Token chip: swatch (12) + gap (6) + chip padding (8+8); the cell adds its own
  // padding (16+16). Assume a swatch is present (the wider case) plus slack.
  const chipW = measureTokenText(longest) + 12 + 6 + 16;
  const tokenColW = chipW + 32 + 8;
  // right pane = CONTENT_WIDTH - VAR_LEFT_W; Token col = right pane - key columns.
  // Solve for the CONTENT_WIDTH (hence CARD_WIDTH) that fits tokenColW.
  const needed = tokenColW + keyCols * TOKEN_KEY_COL_W + VAR_LEFT_W + PAD_X * 2;
  CARD_WIDTH = Math.max(CARD_WIDTH_MIN, Math.min(CARD_WIDTH_MAX, Math.ceil(needed)));
  CONTENT_WIDTH = CARD_WIDTH - PAD_X * 2;
}

/**
 * Build an on-canvas "Guidelines" frame from a DocFrameModel.
 * Returns the frame; the caller positions it and appends it to the page.
 */
export async function buildDocFrame(
  model: DocFrameModel,
  brand: { headerBg: string; accent: string } = {
    headerBg: DEFAULT_HEADER_BG,
    accent: DEFAULT_ACCENT,
  },
): Promise<FrameNode> {
  // Apply the (already-resolved) brand colors before any layout reads them.
  COLOR_HEADER_BG = hex(brand.headerBg);
  COLOR_ACCENT = hex(brand.accent);

  // Load fonts FIRST — bold runs need the Bold face before setRangeFontName,
  // and fitFrameWidthToTokens measures text (which needs the face loaded).
  await Promise.all(
    (['Regular', 'Medium', 'Bold'] as FontStyle[]).map((style) =>
      figma.loadFontAsync(font(style)),
    ),
  );

  // Size the frame to fit the longest token chip before laying anything out.
  fitFrameWidthToTokens(model);

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

  // If anything below throws, remove the partial frame so a failed build never
  // litters the canvas with orphaned nodes.
  try {
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
      const group = await buildSection(section);
      content.appendChild(group);
      group.layoutSizingHorizontal = 'FILL';
    }
  } catch (err) {
    frame.remove();
    throw err;
  }

  return frame;
}
