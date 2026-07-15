/// <reference types="@figma/plugin-typings" />
import { parseRuns, groupSections, firstSentence, headingLine } from './ui/docModel';
import type {
  AnatomyPartBlock,
  Bullet,
  DocFrameModel,
  DocGroup,
  SectionBlock,
  TextRun,
  VariantRow,
} from './ui/docModel';
import type { resolveTheme } from './brandColors';
import {
  palette, hex, solidFill, vstack, hstack, makeText, buildSlot, font,
  headingFont, setFontFamilies, matchVariableModes, radius, setCornerStyle,
  type FontStyle,
} from './frameKit';
import { buildMeasureSection } from './measureSection';
import { buildMatrixSection } from './statesSection';
import { resolveTokenColor, resolveTokenNumber, resolveTokenTypography, resetTokenResolveCaches } from './tokenResolve';

// ---------------------------------------------------------------------------
// Design tokens for the generated doc frame
// ---------------------------------------------------------------------------

// Layout constants
const PAD_X = 56; // horizontal padding for header + content
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

// ---------------------------------------------------------------------------
// Text construction
// ---------------------------------------------------------------------------

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
  const firstLine = i < lines.length ? lines[i].trim() : '';
  const following = lines.slice(i + 1).join('\n').trim();
  // The header takes only the first sentence; the rest of the paragraph plus any
  // following lines drop into the Definition body, so the header stays a one-liner.
  const { sentence, remainder } = firstSentence(firstLine);
  const rest = [remainder, following].filter(Boolean).join('\n\n').trim();
  return { lead: sentence, rest };
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** A small teal accent bar used as a section eyebrow rule. */
function accentRule(): FrameNode {
  const rule = figma.createFrame();
  rule.resize(28, 3);
  rule.cornerRadius = radius(2);
  rule.fills = solidFill(palette.accent);
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
    const node = makeText(placeholder, 'Regular', 15, palette.muted, 155);
    row.appendChild(node);
    node.layoutSizingHorizontal = 'FILL';
    node.textAutoResize = 'HEIGHT';
    return row;
  }

  const { marker, rest } = splitMarker(bullet.text);
  const markerColor = marker === '✅' ? palette.accent : marker === '❌' ? palette.muted : palette.accent;
  const markerNode = makeText(marker, 'Medium', 15, markerColor, 155);
  row.appendChild(markerNode);
  markerNode.textAutoResize = 'WIDTH_AND_HEIGHT';

  // Re-parse the rest so bold lead-ins survive the marker split.
  const runs = parseRuns(rest);
  const plain = runs.map((r) => r.text).join('');
  const content = makeText(plain, 'Regular', 15, palette.body, 155);
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
      out.push(makeText(placeholder, 'Regular', 15, palette.muted, 155));
      continue;
    }

    const subheading = headingLine(line);
    if (subheading !== null) {
      // "### Mouse" → a small subheading. Wrapped in a padded frame so it gets
      // extra separation from the bullet group above (body spacing is a flat 10).
      const wrap = vstack(0);
      wrap.paddingTop = 8;
      const node = makeText(subheading, 'Bold', 17, palette.heading, 130);
      node.fontName = headingFont('Bold');
      wrap.appendChild(node);
      node.layoutSizingHorizontal = 'FILL';
      node.textAutoResize = 'HEIGHT';
      out.push(wrap);
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
      const node = makeText(plain, 'Regular', 15, palette.body, 155);
      applyBoldRuns(node, runs, 0);
      out.push(node);
    }
  }
  if (out.length === 0) out.push(makeText('', 'Regular', 15, palette.body, 155));
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

function makeCell(text: string, style: FontStyle, size: number, color: RGB, trackingPct?: number): FrameNode {
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
  table.cornerRadius = radius(8);
  table.clipsContent = true;
  table.strokes = solidFill(palette.border);
  table.strokeWeight = 1;

  const colCount = Math.max(columns.length, 1);

  // Header row
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

  // Data rows
  if (rows.length === 0) {
    const empty = hstack(0);
    table.appendChild(empty);
    empty.layoutSizingHorizontal = 'FILL';
    empty.strokes = solidFill(palette.divider);
    empty.strokeTopWeight = 1;
    const cell = makeCell('None.', 'Regular', 14, palette.muted);
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
      // First column reads as the row's "key" → slightly stronger ink + weight.
      const isKey = i === 0;
      const cell = makeCell(
        r[i] ?? '',
        isKey ? 'Medium' : 'Regular',
        14,
        isKey ? palette.heading : palette.body,
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

/** A 12×12 rounded color chip. */
function colorChip(color: RGB): FrameNode {
  const chip = figma.createFrame();
  chip.resize(12, 12);
  chip.cornerRadius = radius(3);
  chip.fills = solidFill(color);
  chip.strokes = solidFill(palette.border);
  chip.strokeWeight = 1;
  return chip;
}

/** The Token cell: a rounded chip (like the web) holding an optional color
 *  swatch plus the token name. When `unbound`, the value is a raw hardcoded
 *  value (not a token): no color lookup, a dashed muted outline, and muted ink. */
async function makeTokenCell(token: string, unbound = false): Promise<FrameNode> {
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
  chip.cornerRadius = radius(6);

  if (unbound) {
    // Raw value: no swatch, no fill, dashed muted outline.
    chip.fills = [];
    chip.strokes = solidFill(palette.muted);
    chip.strokeWeight = 1;
    chip.dashPattern = [3, 2];
  } else {
    chip.fills = solidFill(palette.chipBg);
    const color = await resolveTokenColor(token);
    if (color) chip.appendChild(colorChip(color));
  }

  // Chip and text both hug their content (single-line pill). The Token column is
  // sized wide enough to hold the longest token (see fitFrameWidthToTokens), so
  // the pill never overflows and gets clipped.
  const text = makeText(token, 'Medium', 13, unbound ? palette.muted : palette.heading, 140);
  text.textAutoResize = 'WIDTH_AND_HEIGHT';
  chip.appendChild(text);

  // Bound tokens with no color swatch: append a best-effort resolved-value
  // suffix (a FLOAT number, or a text-style summary) as a separate muted node so
  // the chip stays single-line. Any failure → no suffix, never a crash.
  if (!unbound && chip.children.length === 1) {
    let suffix: string | null = null;
    const n = await resolveTokenNumber(token);
    if (n !== null) suffix = `· ${n}`;
    else {
      const typo = await resolveTokenTypography(token);
      if (typo) suffix = `· ${typo}`;
    }
    if (suffix) {
      const sfx = makeText(suffix, 'Regular', 11, palette.muted, 140);
      sfx.textAutoResize = 'WIDTH_AND_HEIGHT';
      chip.appendChild(sfx);
    }
  }

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
  rows: VariantRow[],
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
    table.cornerRadius = radius(8);
    table.clipsContent = true;
    table.strokes = solidFill(palette.border);
    table.strokeWeight = 1;
  }

  const head = hstack(0);
  head.fills = solidFill(palette.tableHeadBg);
  table.appendChild(head);
  head.layoutSizingHorizontal = 'FILL';
  head.counterAxisAlignItems = 'MIN';
  for (let i = 0; i < dataCount; i++) {
    const cell = makeCell((dataColumns[i] ?? '').toUpperCase(), 'Medium', 11, palette.muted, 5);
    head.appendChild(cell);
    sizeCol(cell, i);
  }

  if (rows.length === 0) {
    const empty = hstack(0);
    table.appendChild(empty);
    empty.layoutSizingHorizontal = 'FILL';
    empty.strokes = solidFill(palette.divider);
    empty.strokeTopWeight = 1;
    const cell = makeCell('None.', 'Regular', 14, palette.muted);
    empty.appendChild(cell);
    cell.layoutSizingHorizontal = 'FILL';
    return table;
  }

  let currentPart: string | null = null;
  for (const r of rows) {
    const part = r.part ?? '';
    const cells = [r.property, r.token];
    // Start a new group with a full-width, bold part band whenever the part
    // changes (rows are pre-sorted by part). A blank part gets no band.
    if (part && part !== currentPart) {
      currentPart = part;
      const groupHead = hstack(0);
      table.appendChild(groupHead);
      groupHead.layoutSizingHorizontal = 'FILL';
      groupHead.counterAxisAlignItems = 'MIN';
      groupHead.fills = solidFill(palette.tableHeadBg);
      groupHead.strokes = solidFill(palette.border);
      groupHead.strokeTopWeight = 1;
      groupHead.strokeBottomWeight = 0;
      groupHead.strokeLeftWeight = 0;
      groupHead.strokeRightWeight = 0;
      const cell = makeCell(part.toUpperCase(), 'Medium', 11, palette.heading, 6);
      cell.paddingTop = 7;
      cell.paddingBottom = 7;
      groupHead.appendChild(cell);
      cell.layoutSizingHorizontal = 'FILL';
    }

    const row = hstack(0);
    table.appendChild(row);
    row.layoutSizingHorizontal = 'FILL';
    row.counterAxisAlignItems = 'MIN';
    row.strokes = solidFill(palette.divider);
    row.strokeTopWeight = 1;
    row.strokeBottomWeight = 0;
    row.strokeLeftWeight = 0;
    row.strokeRightWeight = 0;
    // Diff rows (a token that changed from the default variant) get a faint
    // accent tint and a stronger Property ink so they read as the delta.
    if (r.diff) row.fills = [{ type: 'SOLID', color: palette.accent, opacity: 0.06 }];
    for (let i = 0; i < dataCount; i++) {
      const value = cells[i] ?? '';
      const isToken = i === dataCount - 1;
      // Property reads as a quiet label; the token value (chip) carries emphasis.
      const cell = isToken
        ? await makeTokenCell(value, r.unbound)
        : makeCell(value, 'Medium', 13, r.diff ? palette.heading : palette.label);
      row.appendChild(cell);
      sizeCol(cell, i);
    }
  }

  return table;
}

/** The left-pane PROPERTIES list: a small heading + axis/value rows. */
function buildPropertyList(props: { name: string; value: string }[]): FrameNode {
  const wrap = vstack(8);
  const heading = makeText('PROPERTIES', 'Medium', 10, palette.muted);
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

    const key = makeText(p.name, 'Regular', 12, palette.muted, 140);
    row.appendChild(key);
    key.layoutSizingHorizontal = 'FILL';
    key.textAutoResize = 'HEIGHT';

    const value = makeText(p.value, 'Medium', 12, palette.heading, 140);
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
  badge.fills = solidFill(palette.accent);
  const label = makeText(String(n), 'Bold', size <= 18 ? 10 : 11, palette.onHeader);
  badge.appendChild(label);
  return badge;
}

/** On-image pin: a number badge with a white ring + soft shadow so it reads on
 *  top of the screenshot. */
function anatomyPin(n: number): FrameNode {
  const pin = numberBadge(n, PIN_SIZE);
  pin.strokes = solidFill(palette.bg);
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

/** Legend row: number badge + bold part name, then either the AI role
 *  description ("name: description") or, when undescribed, the nested-component
 *  note ("name  ·  component"). Indented per nesting depth so sub-parts read as
 *  children of their parent; the badge top-aligns so multi-line descriptions
 *  hang cleanly beside it. */
function anatomyLegendRow(part: AnatomyPartBlock): FrameNode {
  const row = hstack(12);
  row.counterAxisAlignItems = 'MIN';
  row.paddingTop = row.paddingBottom = 12;
  row.paddingLeft = part.depth * 18;
  row.appendChild(numberBadge(part.n, LEGEND_BADGE));

  const desc = part.description?.trim();
  const nestedNote = part.nested ? `  ·  ${part.component ?? 'component'}` : '';
  const chars = desc ? `${part.name}: ${desc}` : `${part.name}${nestedNote}`;
  const text = makeText(chars, 'Regular', 15, palette.body, 150);
  row.appendChild(text);
  text.layoutSizingHorizontal = 'FILL';
  text.textAutoResize = 'HEIGHT';
  // Bold the part name only (the leading run before the colon / nested note).
  text.setRangeFontName(0, part.name.length, font('Bold'));
  return row;
}

/** The numbered part list: legend rows separated by hairline dividers, so each
 *  part reads as its own spec entry. Shared by the diagram card and the
 *  no-screenshot fallback. */
function buildAnatomyLegend(parts: AnatomyPartBlock[]): FrameNode {
  const legend = vstack(0);
  legend.counterAxisAlignItems = 'MIN';
  parts.forEach((part, i) => {
    if (i > 0) {
      const divider = figma.createFrame();
      divider.resize(100, 1);
      divider.fills = solidFill(palette.divider);
      legend.appendChild(divider);
      divider.layoutSizingHorizontal = 'FILL';
    }
    const row = anatomyLegendRow(part);
    legend.appendChild(row);
    row.layoutSizingHorizontal = 'FILL';
  });
  return legend;
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
    // Match the component's variable modes so the instance resolves the same
    // token values (else a differing density mode shrinks it, misaligning pins).
    await matchVariableModes(inst, component);
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
  card.fills = solidFill(palette.paneBg);
  card.cornerRadius = radius(8);
  card.strokes = solidFill(palette.border);
  card.strokeWeight = 1;
  card.counterAxisAlignItems = 'CENTER';

  // Resolve each depth-0 part to its normalized center + edges in the component
  // box. Deeper parts stay unpinned (numbered in the legend/table only) so
  // nested sub-parts don't clutter the image.
  const pins: { n: number; nx: number; ny: number; rx: number; ty: number }[] = [];
  for (const part of parts) {
    if (part.depth !== 0) continue;
    let p: BaseNode | null;
    try {
      p = await figma.getNodeByIdAsync(part.id);
    } catch {
      continue;
    }
    if (!p || !('absoluteBoundingBox' in p)) continue;
    const pb = (p as SceneNode).absoluteBoundingBox;
    if (!pb) continue;
    pins.push({
      n: part.n,
      nx: clamp01((pb.x + pb.width / 2 - cb.x) / cb.width),
      ny: clamp01((pb.y + pb.height / 2 - cb.y) / cb.height),
      rx: clamp01((pb.x + pb.width - cb.x) / cb.width), // part's right edge
      ty: clamp01((pb.y - cb.y) / cb.height), // part's top edge
    });
  }

  // Pin orientation: place callouts on the side the parts are LEAST spread
  // along, so they line up without piling. A horizontal row of parts shares a
  // vertical range near zero -> pins go ABOVE (spread by x); a vertical stack
  // shares an x range near zero -> pins go to the RIGHT (spread by y).
  const xs = pins.map((p) => p.nx);
  const ys = pins.map((p) => p.ny);
  const xRange = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const yRange = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const sideCallouts = yRange > xRange; // vertical stack -> right-side pins
  const CALLOUT_ZONE = pins.length ? 48 : 0;

  // Image box: a plain (non-auto-layout) frame holding the instance plus the
  // callout zone. Pins sit in the zone (beside each part); a leader anchored at
  // the part's own edge (a small dot marks the connection) runs to the pin.
  const box = figma.createFrame();
  box.name = 'Anatomy diagram';
  box.resize(
    renderedW + (sideCallouts ? CALLOUT_ZONE : 0),
    renderedH + (sideCallouts ? 0 : CALLOUT_ZONE),
  );
  box.fills = [];
  box.clipsContent = false; // edge pins/leaders may overhang slightly
  card.appendChild(box);
  box.appendChild(inst);
  inst.x = 0;
  inst.y = sideCallouts ? 0 : CALLOUT_ZONE;

  // Leaders share the pin hue (at low opacity) so they read as connections; a
  // solid accent dot marks where each leader meets its part.
  const leaderPaint = [{ type: 'SOLID', color: palette.accent, opacity: 0.45 }] as Paint[];
  const connectDot = (x: number, y: number): void => {
    const dot = figma.createFrame();
    dot.resize(6, 6);
    dot.cornerRadius = radius(3);
    dot.fills = solidFill(palette.accent);
    dot.x = Math.round(x - 3);
    dot.y = Math.round(y - 3);
    box.appendChild(dot);
  };

  for (const pin of pins) {
    const node = anatomyPin(pin.n);
    if (sideCallouts) {
      const cy = Math.round(pin.ny * renderedH);
      const anchorX = Math.round(pin.rx * renderedW); // the part's right edge
      const pinX = renderedW + CALLOUT_ZONE - PIN_SIZE;
      const leader = figma.createFrame();
      leader.resize(Math.max(pinX - anchorX, 1), 1);
      leader.x = anchorX;
      leader.y = cy;
      leader.fills = leaderPaint;
      box.appendChild(leader);
      connectDot(anchorX, cy);
      box.appendChild(node);
      node.x = pinX;
      node.y = Math.round(cy - PIN_SIZE / 2);
    } else {
      const cx = Math.round(pin.nx * renderedW);
      const anchorY = Math.round(CALLOUT_ZONE + pin.ty * renderedH); // part's top edge
      const leader = figma.createFrame();
      leader.resize(1, Math.max(anchorY - PIN_SIZE, 1));
      leader.x = cx;
      leader.y = PIN_SIZE;
      leader.fills = leaderPaint;
      box.appendChild(leader);
      connectDot(cx, anchorY);
      box.appendChild(node);
      node.x = Math.round(cx - PIN_SIZE / 2);
      node.y = 0;
    }
  }

  // Numbered legend below the screenshot.
  const legend = buildAnatomyLegend(parts);
  card.appendChild(legend);
  legend.layoutSizingHorizontal = 'FILL';

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

  const heading = makeText(section.heading, 'Bold', 24, palette.heading, 130);
  heading.fontName = headingFont('Bold'); // heading family (guaranteed loaded)
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
    // AI orientation to the component's structure, above the diagram.
    if (section.summary) {
      const summary = makeText(section.summary, 'Regular', 15, palette.body, 155);
      body.appendChild(summary);
      summary.layoutSizingHorizontal = 'FILL';
      summary.textAutoResize = 'HEIGHT';
    }
    // 'table' skips the diagram build entirely — no point spending an instance +
    // screenshot render when only the tabular list will be shown.
    if (section.view !== 'table') {
      const diagram = await buildAnatomyDiagram(section.componentId, section.parts);
      if (diagram) {
        body.appendChild(diagram);
        diagram.layoutSizingHorizontal = 'FILL';
      } else {
        // Fallback: the numbered legend on its own when the screenshot can't render.
        const legend = buildAnatomyLegend(section.parts);
        body.appendChild(legend);
        legend.layoutSizingHorizontal = 'FILL';
      }
    }
    if (section.view === 'table' || section.view === 'both') {
      const rows = section.parts.map((p) => [
        String(p.n),
        `${'    '.repeat(p.depth)}${p.name}`,
        p.type.toLowerCase(),
        p.component ?? '—',
        p.tokens.length <= 3
          ? p.tokens.join(' · ')
          : `${p.tokens.slice(0, 3).join(' · ')} +${p.tokens.length - 3}`,
      ]);
      const table = buildTable(['#', 'Part', 'Type', 'Component', 'Tokens'], rows);
      body.appendChild(table);
      table.layoutSizingHorizontal = 'FILL';
    }
  } else if (section.kind === 'variantTokens') {
    for (const variant of section.variants) {
      // A bordered card split into a left pane (preview + PROPERTIES) and a
      // right pane (token table), like the docs inspector.
      const card = hstack(0);
      card.cornerRadius = radius(12);
      card.clipsContent = true;
      card.strokes = solidFill(palette.border);
      card.strokeWeight = 1;
      body.appendChild(card);
      card.layoutSizingHorizontal = 'FILL';

      // Left pane
      const left = vstack(16);
      left.fills = solidFill(palette.paneBg);
      left.paddingTop = left.paddingBottom = left.paddingLeft = left.paddingRight = VAR_PANE_PAD;
      left.strokes = solidFill(palette.border);
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

      // Non-default cards suppress rows identical to the default; a summary line
      // accounts for them so the card doesn't read as if those tokens are absent.
      if (!variant.isDefault && variant.sameAsDefault > 0) {
        const note = hstack(0);
        note.paddingTop = 10;
        note.paddingBottom = 12;
        note.paddingLeft = 16;
        note.paddingRight = 16;
        const label = variant.rows.length === 0
          ? `Identical to default (${variant.sameAsDefault} tokens)`
          : `Same as default · ${variant.sameAsDefault} more token${variant.sameAsDefault === 1 ? '' : 's'}`;
        const t = makeText(label, 'Regular', 12, palette.muted, 140);
        note.appendChild(t);
        right.appendChild(note);
        note.layoutSizingHorizontal = 'FILL';
      }
    }
  } else if (section.kind === 'measure') {
    const diagram = await buildMeasureSection(section);
    if (diagram) {
      body.appendChild(diagram);
      diagram.layoutSizingHorizontal = 'FILL';
    } else {
      // Fallback: measurement rules as a plain table (same data, no diagram).
      // Keys are `${part} ${property}`; the property never contains a space, so
      // split on the last space to recover the part even when it has spaces.
      const rows = Object.entries(section.tokens)
        .map(([key, token]) => {
          const at = key.lastIndexOf(' ');
          const part = at === -1 ? key : key.slice(0, at);
          const property = at === -1 ? '' : key.slice(at + 1);
          return [part, property, token] as string[];
        })
        .filter((r) => !['fill', 'border', 'typography'].includes(r[1]));
      const table = buildTable(['Part', 'Property', 'Token'], rows);
      body.appendChild(table);
      table.layoutSizingHorizontal = 'FILL';
    }
  } else if (section.kind === 'statesMatrix') {
    const grid = await buildMatrixSection(
      {
        axisName: section.axisName,
        columns: section.states,
        rows: section.rows,
        note: section.capped
          ? 'Showing the first 4 values — other rows share the same state behavior.'
          : null,
      },
      CONTENT_WIDTH,
    );
    body.appendChild(grid);
    grid.layoutSizingHorizontal = 'FILL';
  } else if (section.kind === 'variantsMatrix') {
    // The variants guide (orientation + bulleted "when to use which type") renders
    // as prose above the matrix so bold type names and bullet lines format
    // correctly, rather than as a single flat line of raw markdown.
    if (section.summary) {
      for (const node of buildProse(section.summary)) {
        body.appendChild(node);
        (node as TextNode).layoutSizingHorizontal = 'FILL';
      }
    }
    // Combine the row-cap disclosure (when the first axis had >4 values) with any
    // held-axis note, so a capped Variants matrix explains its truncation the same
    // way the States matrix does.
    const capNote = section.capped
      ? 'Showing the first 4 values — other variants share the same structure.'
      : null;
    const note = [capNote, section.note].filter(Boolean).join(' ') || null;
    const grid = await buildMatrixSection(
      {
        columns: section.columns,
        rows: section.rows,
        note,
      },
      CONTENT_WIDTH,
    );
    body.appendChild(grid);
    grid.layoutSizingHorizontal = 'FILL';
    // Extra breathing room between the guide/bullets and the preview matrix; the
    // body's default 10px spacing reads as cramped against the prose above.
    if (section.summary) grid.paddingTop = 24;
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

async function buildHeader(
  componentName: string,
  subtitleMd: string | null,
  eyebrow: string,
  logoBase64?: string | null,
): Promise<FrameNode> {
  const band = vstack(14);
  band.fills = solidFill(palette.headerBg);
  band.paddingTop = 48;
  band.paddingBottom = subtitleMd ? 44 : 48;
  band.paddingLeft = PAD_X;
  band.paddingRight = PAD_X;

  // We append children, set FILL, then fill text — order matters for FILL.
  // Nodes in `tmp` get FILL after all appends. When the eyebrow sits inside a
  // logo row, the ROW is what FILLs (the eyebrow FILLs within it, set inline).
  const tmp: (TextNode | FrameNode)[] = [];

  const eyebrowNode = makeText(eyebrow.toUpperCase(), 'Medium', 12, palette.onHeaderMuted);
  if (logoBase64) {
    // Eyebrow + logo on one row, logo pushed to the right edge.
    const row = hstack(12);
    band.appendChild(row);
    row.counterAxisAlignItems = 'CENTER';
    row.appendChild(eyebrowNode);
    eyebrowNode.layoutSizingHorizontal = 'FILL';
    try {
      const image = figma.createImage(figma.base64Decode(logoBase64));
      const { width, height } = await image.getSizeAsync();
      const logoH = 28;
      const logo = figma.createRectangle();
      logo.resize(Math.round((width / Math.max(height, 1)) * logoH), logoH);
      logo.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FIT' }];
      row.appendChild(logo);
    } catch {
      /* corrupt logo → header renders without it */
    }
    tmp.push(row); // the row FILLs; the eyebrow already FILLs within it
  } else {
    band.appendChild(eyebrowNode);
    tmp.push(eyebrowNode);
  }

  const title = makeText(componentName, 'Bold', 38, palette.onHeader, 115);
  title.fontName = headingFont('Bold'); // heading family (guaranteed loaded)
  band.appendChild(title);
  tmp.push(title);

  if (subtitleMd) {
    // Parse the lead for **bold** runs and drop any leading list marker so no
    // raw markdown shows in the subtitle.
    const runs = parseRuns(subtitleMd.replace(/^[-*]\s+/, ''));
    const plain = runs.map((r) => r.text).join('');
    const sub = makeText(plain, 'Regular', 16, palette.onHeaderMuted, 155);
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
        const tk = row.token ?? '';
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

/** Build one group's frame: root card + header band + content column. */
async function buildGroupFrame(
  group: DocGroup,
  componentName: string,
  subtitle: string | null,
  logoBase64?: string | null,
): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = group.label; // "Usage" | "Specifications" | "Accessibility"
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'FIXED';
  frame.itemSpacing = 0;
  frame.fills = solidFill(palette.bg);
  frame.cornerRadius = radius(16);
  frame.clipsContent = true;
  frame.strokes = solidFill(palette.border);
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

  try {
    const header = await buildHeader(componentName, subtitle, group.label, logoBase64);
    frame.appendChild(header);
    header.layoutSizingHorizontal = 'FILL';

    const content = vstack(40);
    content.paddingTop = 48;
    content.paddingBottom = 56;
    content.paddingLeft = PAD_X;
    content.paddingRight = PAD_X;
    frame.appendChild(content);
    content.layoutSizingHorizontal = 'FILL';

    for (const section of group.sections) {
      const built = await buildSection(section);
      content.appendChild(built);
      built.layoutSizingHorizontal = 'FILL';
    }
  } catch (err) {
    frame.remove();
    throw err;
  }

  return frame;
}

/** Lift the definition's lead sentence into a header subtitle. Returns the
 *  subtitle plus the section list with the definition block rewritten to its
 *  remainder (or dropped if fully lifted). Mirrors the pre-split behavior. */
function liftDefinitionLead(
  sections: SectionBlock[],
): { subtitle: string | null; sections: SectionBlock[] } {
  const def = sections.find(
    (s) => s.id === 'definition' && s.kind === 'prose',
  ) as Extract<SectionBlock, { kind: 'prose' }> | undefined;
  if (!def) return { subtitle: null, sections };
  if (emphasisOnly(def.text) !== null) return { subtitle: null, sections }; // placeholder
  const { lead, rest } = splitLead(def.text);
  const rebuilt = sections.flatMap((s) =>
    s === def
      ? (rest ? [{ ...def, kind: 'prose' as const, text: rest }] : [])
      : [s],
  );
  return { subtitle: lead || null, sections: rebuilt };
}

/**
 * Build the on-canvas doc Section (Usage / Specifications / Accessibility
 * frames side by side) from a DocFrameModel. Returns the Section; the caller
 * positions it and appends it to the page.
 */
export async function buildDocFrames(
  model: DocFrameModel,
  theme: ReturnType<typeof resolveTheme>,
  logoBase64?: string | null,
): Promise<SectionNode> {
  // Resolved-value caches (color/float variables, text styles) are module
  // state in tokenResolve — reset them per build so a rebuild after the user
  // edits variables/styles picks up fresh values instead of stale ones.
  resetTokenResolveCaches();

  // Apply the (already-resolved) theme palette before any layout reads it.
  // EVERY mutable field is set per build so a Default build after a themed one
  // fully resets (palette is module state).
  palette.headerBg = hex(theme.headerBg);
  palette.accent = hex(theme.accent);
  palette.body = hex(theme.bodyText);
  palette.tableHeadBg = hex(theme.tableHeadBg);

  // Corner style is module state in frameKit, same as the font families —
  // set it every build so styles never leak into the next build.
  setCornerStyle(theme.cornerStyle);

  // Fonts: try the requested families; ANY failure reverts that family to Inter
  // (families missing Medium/Bold are common — robustness beats partial styling).
  const tryFamily = async (family: string): Promise<string> => {
    if (family === 'Inter') return 'Inter';
    try {
      await Promise.all((['Regular', 'Medium', 'Bold'] as const).map((style) =>
        figma.loadFontAsync({ family, style })));
      return family;
    } catch {
      return 'Inter';
    }
  };
  const [headingFam, bodyFam] = await Promise.all([
    tryFamily(theme.headingFont),
    tryFamily(theme.bodyFont),
  ]);
  // Set families every build (with the Inter fallbacks above) so a themed build
  // never leaves stale families for the next Default build.
  setFontFamilies(headingFam, bodyFam);

  // Always load Inter faces too — fallback family + text measuring below need
  // them, and bold runs need the Bold face before setRangeFontName.
  await Promise.all(
    (['Regular', 'Medium', 'Bold'] as FontStyle[]).map((style) =>
      figma.loadFontAsync({ family: 'Inter', style }),
    ),
  );

  // Shared width across all frames — measured over the full (flat) model.
  fitFrameWidthToTokens(model);

  const componentName = model.componentName;

  // Definition lead → Usage subtitle. Fall back to keeping the definition as a
  // body section if lifting would leave nothing to render.
  let { subtitle, sections } = liftDefinitionLead(model.sections);
  let groups = groupSections(sections);
  if (groups.length === 0 && model.sections.length > 0) {
    subtitle = null;
    groups = groupSections(model.sections);
  }
  if (groups.length === 0) throw new Error('No sections selected.');

  // Build frames (auto-appended to the page by createFrame), then wrap + lay out.
  const GAP = 80; // gap between frames
  const PAD = 64; // breathing room between the frames and the Section edge
  const frames: FrameNode[] = [];
  try {
    for (const group of groups) {
      const sub = group.sections.some((s) => s.id === 'definition') ? subtitle : null;
      frames.push(await buildGroupFrame(group, componentName, sub, logoBase64));
    }

    // A freshly created Section keeps its default (small) size — it does NOT
    // auto-grow to contain appended children. Pin its origin to (0,0), lay the
    // frames out inside at PAD offsets, then resize the Section to the frames'
    // bounding box (+ padding) so it actually holds all three. Section children
    // use section-relative coordinates, so a later section.x/y move carries them.
    const section = figma.createSection();
    section.name = `${componentName}: Documentation`;
    section.x = 0;
    section.y = 0;

    let cursorX = PAD;
    let maxH = 0;
    for (const frame of frames) {
      section.appendChild(frame);
      frame.x = cursorX;
      frame.y = PAD;
      cursorX += frame.width + GAP;
      if (frame.height > maxH) maxH = frame.height;
    }

    // cursorX overshot by one trailing GAP after the last frame; drop it.
    const contentWidth = cursorX - GAP;
    section.resizeWithoutConstraints(
      Math.max(contentWidth + PAD, 1),
      Math.max(maxH + PAD * 2, 1),
    );
    return section;
  } catch (err) {
    for (const f of frames) f.remove(); // never litter the canvas on failure
    throw err;
  }
}
