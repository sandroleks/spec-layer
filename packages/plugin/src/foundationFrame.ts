/// <reference types="@figma/plugin-typings" />
/**
 * foundationFrame.ts — renders one foundation output unit as a Figma Section.
 *
 * Deliberately separate from docFrame.ts: that file owns the component
 * document and is already large. What the two share, they share through code
 * rather than by resemblance — frameKit primitives for the palette, fonts and
 * corner style, and brandHeader for the header band — so a foundation frame
 * inherits the user's brand theme and captured logo with no theming code of its
 * own, and stays in step when the component frame is restyled.
 *
 * The card chrome matches a component doc: one fixed-width card, the brand
 * header band across the top, then a bordered table on the body background.
 *
 * The pure functions here (valueLines, swatchColorOf, footerNotes,
 * headerSubtitle, tableColumns, cardWidth) are unit-tested, and the cell
 * builders' sizing contract is pinned against a stub of Figma's resize
 * behaviour. Everything else about the layout is verified by the manual Figma
 * pass, the same treatment docFrame.ts gets.
 */
import type {
  FoundationUnit, FoundationUnitContent, FoundationValue,
  FoundationRow, FoundationVariableRow,
} from '@spec-layer/extractor';
import { foundationUnitTitle, groupRowsByFolder, groupTitles } from '@spec-layer/extractor';
import {
  palette, solidFill, makeText, vstack, hstack, radius, hex, applyThemeToKit,
  headingFont,
} from './frameKit';
import { buildBrandHeader, HEADER_PAD_X } from './brandHeader';
import type { resolveTheme } from './brandColors';

/**
 * Label for a single value. Never returns an empty string.
 *
 * The alias branch is a floor, not a path the extractor takes: resolution
 * flattens chains, so a resolved target is a literal or an unresolved reason.
 * Degrading to the target's name beats rendering "[object Object]" if that ever
 * stops being true.
 */
function leafLabel(value: FoundationValue): string {
  switch (value.kind) {
    case 'alias':
      return `→ ${value.targetName}`;
    case 'color': {
      const h = value.hex.toUpperCase();
      return value.alpha < 1 ? `${h} ${Math.round(value.alpha * 100)}%` : h;
    }
    case 'number':
      // String() on a number never prints trailing zeros: 16 stays "16", 1.5 stays "1.5".
      return String(value.value);
    case 'string':
      return value.value === '' ? '(empty string)' : value.value;
    case 'boolean':
      return String(value.value);
    case 'unresolved':
      return value.reason === 'external'
        ? 'not resolved: external library variable'
        : `not resolved: ${value.reason}`;
  }
}

/**
 * One cell's text, split across two lines.
 *
 * A semantic token's cell has two things to say: which primitive it points at,
 * and what that resolves to. On one line those ran together as
 * "→ colors/blue/500  #722ED1", which read as crowded and, at any realistic
 * column width, overflowed into the next column. Stacking them gives each a
 * short line and lets the column be narrower than before rather than wider.
 *
 * `secondary` is empty when there is nothing more to say, which is the common
 * case for a plain literal value.
 */
export interface ValueLines { primary: string; secondary: string }

export function valueLines(value: FoundationValue): ValueLines {
  if (value.kind !== 'alias') return { primary: leafLabel(value), secondary: '' };
  const primary = `→ ${value.targetName}`;
  // A library's modes cannot be mapped onto local ones, so there is no value to
  // show. Say which kind of reference it is rather than leaving a bare arrow.
  if (value.external) return { primary, secondary: 'library variable' };
  if (!value.resolved) return { primary, secondary: '' };
  return { primary, secondary: leafLabel(value.resolved) };
}

// ---------------------------------------------------------------------------
// Colour formats
//
// A colour swatch carries the value in the three notations a developer actually
// pastes: hex, rgb, hsl. All three are derived from the same hex the drift hash
// already covers, so they add nothing to the projection and cannot drift from
// it: change the colour and the hex moves, so the hash moves.
// ---------------------------------------------------------------------------

/** One decimal at most, with no trailing ".0" (matching how CSS is written). */
function round1(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function channels(hexValue: string): [number, number, number] {
  const h = hexValue.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** `rgb(3, 45, 96)`, or `rgba(3, 45, 96, 0.5)` when the colour is not opaque. */
export function rgbLabel(hexValue: string, alpha: number): string {
  const [r, g, b] = channels(hexValue);
  return alpha < 1
    ? `rgba(${r}, ${g}, ${b}, ${round1(alpha * 100)}%)`
    : `rgb(${r}, ${g}, ${b})`;
}

/**
 * `hsl(212.9, 93.9%, 19.4%)`, or `hsla(...)` when the colour is not opaque.
 *
 * Hue is undefined for a grey, where the standard convention is 0, which is what
 * makes white read as `hsl(0, 0%, 100%)` rather than `hsl(NaN, 0%, 100%)`.
 */
export function hslLabel(hexValue: string, alpha: number): string {
  const [r255, g255, b255] = channels(hexValue);
  const r = r255 / 255, g = g255 / 255, b = b255 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
    if (h < 0) h += 360;
  }
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  const body = `${round1(h)}, ${round1(s * 100)}%, ${round1(l * 100)}%`;
  return alpha < 1 ? `hsla(${body}, ${round1(alpha * 100)}%)` : `hsl(${body})`;
}

/**
 * The value lines beside one swatch, in render order.
 *
 * A direct colour gets all three notations, the way a token reference table
 * does. An alias gets its target and the resolved hex instead: the target is the
 * fact a reader of a semantic collection needs, and the primitive it points at
 * has its own frame carrying the full formats, so nothing is lost across the
 * document set and a four-mode semantic row stays readable.
 */
export function swatchValueLines(value: FoundationValue): string[] {
  if (value.kind === 'color') {
    return [
      leafLabel(value),
      rgbLabel(value.hex, value.alpha),
      hslLabel(value.hex, value.alpha),
    ];
  }
  const { primary, secondary } = valueLines(value);
  return secondary ? [primary, secondary] : [primary];
}

/** The swatch color for a cell, or null when there is nothing to show. */
export function swatchColorOf(value: FoundationValue): RGB | null {
  if (value.kind === 'color') return hex(value.hex);
  if (value.kind === 'alias' && value.resolved) return swatchColorOf(value.resolved);
  return null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The header band's subtitle line: what this document covers, counted.
 *
 * Reads only `content`, for the same reason footerNotes does: everything the
 * frame states has to come from what the drift hash reads.
 */
export function headerSubtitle(content: FoundationUnitContent, isText: boolean): string {
  if (isText) return plural(content.rows.length, 'text style', 'text styles');
  return `${plural(content.rows.length, 'variable', 'variables')} across `
    + plural(content.modeNames.length, 'mode', 'modes');
}

/**
 * The frame's footer lines, in render order.
 *
 * Takes ONLY the content object, never the surrounding batch. Everything a
 * footer says has to come from what the drift hash reads, or the note is
 * rendered without being covered: the part numbers used to arrive as
 * arguments, which put them outside the hash, counted the whole batch rather
 * than the split collection, and let a single-doc Update silently drop the
 * line altogether.
 */
export function footerNotes(content: FoundationUnitContent): string[] {
  const notes: string[] = [];
  if (content.omittedModeNames.length > 0) {
    notes.push(`Modes not shown: ${content.omittedModeNames.join(', ')}`);
  }
  if (content.part && content.group) {
    notes.push(`Part ${content.part.index + 1} of ${content.part.total}, covering ${content.group}.`);
  }
  return notes;
}

const COL_NAME = 240;
const COL_DESC = 220;
// Narrower than the one-line cell needed: a stacked "name over value" pair fits
// a shorter column, so a four-mode table is now narrower than it used to be
// rather than wider.
const COL_MODE = 160;
const ROW_PAD = 10;
const CELL_GAP = 12;

/** Narrowest card, matching the component doc frame so the two sit level. */
const CARD_WIDTH_MIN = 880;

export interface TableColumn { label: string; width: number }

/**
 * The table's columns, in render order, as label/width pairs.
 *
 * One list drives the header row, every data row, and the card width, so a
 * column cannot be labelled at one width and filled at another.
 */
export function tableColumns(
  content: FoundationUnitContent, isText: boolean, hasDescriptions: boolean,
): TableColumn[] {
  const columns: TableColumn[] = [{ label: 'Name', width: COL_NAME }];
  if (hasDescriptions) columns.push({ label: 'Description', width: COL_DESC });
  if (isText) columns.push({ label: 'Specimen', width: COL_MODE * 2 });
  else for (const name of content.modeNames) columns.push({ label: name, width: COL_MODE });
  return columns;
}

/**
 * The laid-out width of a table row: its cells, the gaps between them, and the
 * row's own left and right padding, which keeps the first and last cell off the
 * table's border.
 *
 * The card's width has to be derived from this exact number. The card clips its
 * contents, so a table one pixel wider than the space inside the card's padding
 * is a table with a clipped right-hand column.
 */
export function rowWidth(columns: TableColumn[]): number {
  return columns.reduce((sum, c) => sum + c.width, 0)
    + CELL_GAP * Math.max(columns.length - 1, 0)
    + CELL_GAP * 2;
}

/**
 * The card's width: whatever the table needs plus the shared padding, but never
 * narrower than a component doc frame. A single-mode collection would otherwise
 * produce a card too narrow to carry the header band's 38px title.
 *
 * Unbounded above, unlike the component frame, and safely so: the widest table
 * this can produce is a description column plus the four-mode cap, which lands
 * inside the component frame's own ceiling.
 */
export function cardWidth(columns: TableColumn[]): number {
  return Math.max(CARD_WIDTH_MIN, rowWidth(columns) + HEADER_PAD_X * 2);
}

/**
 * Pin a frame to a fixed width while its height keeps hugging its content.
 *
 * Uses the axis-explicit layoutSizing* API on purpose. The primary/counter API
 * is a trap here: on a HORIZONTAL frame the primary axis is the WIDTH and the
 * counter axis is the HEIGHT, so `resize(width, 1)` followed by
 * `primaryAxisSizingMode = 'FIXED'` re-fixes the axis resize had already fixed
 * and leaves the height pinned at the literal 1 that was passed, clipping every
 * row to a sliver. resize() fixes BOTH axes in the Figma API, so the height hug
 * must be restored explicitly, and it must be restored on the vertical axis.
 *
 * Safe before or after the children exist: resize is handed the frame's current
 * height rather than a literal, and the HUG on the last line is what governs.
 */
function fixWidthHugHeight(frame: FrameNode, width: number): void {
  frame.layoutSizingHorizontal = 'FIXED';
  frame.resize(width, frame.height); // current height, never a literal
  frame.layoutSizingVertical = 'HUG';
}

/**
 * Append a text node that wraps inside its cell instead of running past it.
 *
 * This is the structural half of the crowding fix. makeText leaves a text node
 * on Figma's default sizing, which hugs its content on both axes, so a cell of
 * FIXED width does not constrain it at all: a long token path or a description
 * of any length simply drew over the next column, and the rightmost column's
 * overflow was clipped by the table's own border. FILL plus a HEIGHT-only
 * autoresize makes the text wrap to the column and the row grow to fit, which
 * holds for any content without measuring anything.
 *
 * `parent` must already be FIXED on the horizontal axis; Figma rejects FILL on a
 * child of a frame that hugs the axis being filled.
 */
function wrappingText(
  parent: FrameNode, chars: string, style: 'Regular' | 'Medium', size: number, color: RGB,
  align: 'LEFT' | 'RIGHT' = 'LEFT',
): TextNode {
  const node = makeText(chars, style, size, color);
  parent.appendChild(node);
  node.layoutSizingHorizontal = 'FILL';
  node.textAutoResize = 'HEIGHT';
  // Right alignment rides on FILL rather than on the parent's item alignment, so
  // a value that wraps stays flush to the edge instead of drifting mid-column.
  if (align === 'RIGHT') node.textAlignHorizontal = 'RIGHT';
  return node;
}

export function cellText(label: string, width: number, muted = false): FrameNode {
  // Vertical, so wrapped lines stack rather than fighting a horizontal flow.
  const cell = vstack(0);
  fixWidthHugHeight(cell, width);
  wrappingText(cell, label, 'Regular', 11, muted ? palette.muted : palette.body);
  return cell;
}

export function swatchCell(value: FoundationValue, width: number): FrameNode {
  const cell = hstack(8);
  // Top-aligned, not centred: a wrapped two-line cell beside a one-line cell
  // reads as a table when their first lines align and as a mess when their
  // midpoints do.
  cell.counterAxisAlignItems = 'MIN';
  fixWidthHugHeight(cell, width);

  const color = swatchColorOf(value);
  if (color) {
    const chip = figma.createRectangle();
    chip.resize(14, 14);
    chip.cornerRadius = radius(3);
    chip.fills = solidFill(color);
    chip.strokes = solidFill(palette.border);
    chip.strokeWeight = 1;
    cell.appendChild(chip);
  }

  const lines = vstack(2);
  cell.appendChild(lines);
  lines.layoutSizingHorizontal = 'FILL';

  const unresolved = value.kind === 'unresolved'
    || (value.kind === 'alias' && !value.external && value.resolved?.kind === 'unresolved');
  const { primary, secondary } = valueLines(value);
  wrappingText(lines, primary, 'Regular', 11, unresolved ? palette.muted : palette.body);
  // The resolved value is supporting detail for the name above it, so it is
  // smaller and muted whether or not the alias resolved.
  if (secondary) wrappingText(lines, secondary, 'Regular', 10, palette.muted);
  return cell;
}

// ---------------------------------------------------------------------------
// Swatch list — the layout colour variables get instead of a table row.
//
// A grid of hex codes is the wrong shape for colour: the value a reader wants is
// the colour itself, and the swatch has to be big enough to judge. So a colour
// row is a swatch, the token's name and description, and the value in the
// notations a developer pastes.
//
// Single-mode collections take the reference shape exactly: a column of swatches
// down the left, name and description beside them, values right-aligned at the
// far edge. Multi-mode collections cannot, since there is one value slot and
// several values, so the name leads and each mode follows as its own labelled
// swatch block.
// ---------------------------------------------------------------------------

const SWATCH = 44;          // single-mode: the reference's large chip
const SWATCH_SMALL = 36;    // multi-mode: one per mode, so slightly smaller
const SWATCH_GAP = 18;
const BLOCK_GAP = 12;       // swatch to its own values
const NAME_MIN = 300;       // single-mode: the name column FILLs beyond this
const NAME_W = 280;         // multi-mode: fixed, so the mode blocks line up
const VALUES_W = 210;       // single-mode: the right-aligned value stack
const MODE_BLOCK_W = 190;   // multi-mode: swatch plus its values
// Row rhythm. Bumped from the first pass, which read as cramped once a mapped
// (multi-mode) collection had three or four columns of small type packed
// together: the row itself needs more air, not just the text inside it.
const SWATCH_ROW_PAD = 18;
const GROUP_GAP = 32;       // between one titled group and the next
const GROUP_HEAD_GAP = 14;  // a group's heading to its own rows
// A measure, not the full row width: a description is prose, and prose set to
// 900px runs too wide to read comfortably.
const GROUP_NOTE_W = 560;

/** True for the rows the swatch list owns. */
export function isColorRow(row: FoundationRow): boolean {
  return row.kind === 'variable' && row.resolvedType === 'COLOR';
}

/**
 * Inner width one swatch-list row needs, which the card must be wide enough to
 * hold for the same reason the table's is: the card clips.
 */
export function swatchRowWidth(modeCount: number): number {
  if (modeCount <= 1) {
    return SWATCH + SWATCH_GAP + NAME_MIN + SWATCH_GAP + VALUES_W;
  }
  return NAME_W + modeCount * (SWATCH_GAP + MODE_BLOCK_W);
}

/** A colour chip. Always drawn, even with no colour to show, so rows align. */
function swatchChip(color: RGB | null, size: number): RectangleNode {
  const chip = figma.createRectangle();
  chip.resize(size, size);
  chip.cornerRadius = radius(6);
  // An unresolved value gets an empty outlined box rather than a missing one: a
  // gap in the swatch column reads as a rendering fault, not as "no value".
  chip.fills = color ? solidFill(color) : [];
  chip.strokes = solidFill(palette.border);
  chip.strokeWeight = 1;
  return chip;
}

/**
 * The token's name over its description.
 *
 * `showDescription` is the user's Foundations setting, which governs both
 * layouts. The swatch list ignored it at first, which quietly overrode a choice
 * the user had made for the table in the same frame.
 */
function nameBlock(
  row: FoundationVariableRow, width: number | 'fill', showDescription: boolean,
): FrameNode {
  const block = vstack(4);
  if (width !== 'fill') fixWidthHugHeight(block, width);
  const name = makeText(row.name, 'Medium', 13, palette.heading);
  block.appendChild(name);
  if (showDescription && row.description) {
    const desc = makeText(row.description, 'Regular', 11, palette.muted);
    block.appendChild(desc);
  }
  return block;
}

/** Wire a name block's text to wrap once its final width is settled. */
function wrapNameBlock(block: FrameNode): void {
  for (const child of block.children) {
    if (child.type !== 'TEXT') continue;
    child.layoutSizingHorizontal = 'FILL';
    child.textAutoResize = 'HEIGHT';
  }
}

/**
 * Render a value stack with a primary/secondary hierarchy, instead of every
 * line looking the same.
 *
 * `swatchValueLines` and `valueLines` both already put the fact that matters
 * first: the hex for a literal colour, the target name for an alias. Styling by
 * POSITION rather than by what the line contains is what lets one function serve
 * both cases and stay correct if a third value kind is ever added. Without this,
 * "→ colors/red/500" and "#F53F3F" read as two equally-weighted facts, which is
 * why the table felt flat rather than scannable.
 */
function appendSwatchValues(
  parent: FrameNode, lines: string[], align: 'LEFT' | 'RIGHT' = 'LEFT',
): void {
  lines.forEach((text, i) => {
    if (i === 0) wrappingText(parent, text, 'Medium', 12, palette.body, align);
    else wrappingText(parent, text, 'Regular', 10, palette.muted, align);
  });
}

/** One swatch-list row. */
function swatchRow(
  row: FoundationVariableRow, modeCount: number, divider: boolean,
  showDescriptions: boolean,
): FrameNode {
  const line = hstack(SWATCH_GAP);
  line.paddingTop = SWATCH_ROW_PAD;
  line.paddingBottom = SWATCH_ROW_PAD;
  line.counterAxisAlignItems = 'MIN';
  fixWidthHugHeight(line, swatchRowWidth(modeCount));
  if (divider) {
    line.strokes = solidFill(palette.divider);
    line.strokeTopWeight = 1;
    line.strokeBottomWeight = 0;
    line.strokeLeftWeight = 0;
    line.strokeRightWeight = 0;
  }

  if (modeCount <= 1) {
    // The reference shape: swatch, name, values hard right.
    const cell = row.cells[0];
    line.appendChild(swatchChip(cell ? swatchColorOf(cell.value) : null, SWATCH));

    const names = nameBlock(row, 'fill', showDescriptions);
    line.appendChild(names);
    names.layoutSizingHorizontal = 'FILL';
    wrapNameBlock(names);

    const values = vstack(4);
    line.appendChild(values);
    fixWidthHugHeight(values, VALUES_W);
    appendSwatchValues(
      values, cell ? swatchValueLines(cell.value) : ['not resolved: missing'], 'RIGHT');
    return line;
  }

  const names = nameBlock(row, NAME_W, showDescriptions);
  line.appendChild(names);
  wrapNameBlock(names);

  for (const cell of row.cells) {
    const block = hstack(BLOCK_GAP);
    block.counterAxisAlignItems = 'MIN';
    line.appendChild(block);
    fixWidthHugHeight(block, MODE_BLOCK_W);
    block.appendChild(swatchChip(swatchColorOf(cell.value), SWATCH_SMALL));

    const values = vstack(3);
    block.appendChild(values);
    values.layoutSizingHorizontal = 'FILL';
    // No mode label here: the list's header row names each column once. Labelling
    // every block repeated the mode names on every row, which for six rows and
    // three modes meant eighteen copies of "Light / Dark / Wireframe".
    appendSwatchValues(values, swatchValueLines(cell.value));
  }
  return line;
}

/**
 * The swatch list for every colour row in a unit.
 *
 * Borderless with hairline dividers, unlike the table: the reference reads as a
 * list of colours rather than a grid of cells, and an outer box around 40 tall
 * rows only boxes them in.
 */
function modeHeadings(modeNames: string[]): FrameNode {
  const head = hstack(SWATCH_GAP);
  head.name = 'Modes';
  fixWidthHugHeight(head, swatchRowWidth(modeNames.length));
  // An empty cell over the name column, so each heading lands on its own block.
  const spacer = vstack(0);
  head.appendChild(spacer);
  fixWidthHugHeight(spacer, NAME_W);
  for (const name of modeNames) {
    const label = vstack(0);
    head.appendChild(label);
    fixWidthHugHeight(label, MODE_BLOCK_W);
    wrappingText(label, name, 'Medium', 10, palette.muted);
  }
  return head;
}

/**
 * A group's heading. The title is derived by the extractor, which also widens it
 * if two folders in this document would otherwise both read "Surface".
 */
function groupHeading(title: string): TextNode {
  const head = makeText(title, 'Bold', 15, palette.heading);
  head.fontName = headingFont('Bold');
  return head;
}

function buildSwatchList(
  rows: FoundationVariableRow[], modeNames: string[], showDescriptions: boolean,
  groupDescriptions?: Record<string, string>,
): FrameNode {
  const list = vstack(GROUP_GAP);
  list.name = 'Colors';

  // Only a multi-mode list needs mode headings, and only once: with one mode
  // there is nothing to tell apart, and the reference has no header row at all.
  if (modeNames.length > 1) list.appendChild(modeHeadings(modeNames));

  const groups = groupRowsByFolder(rows);
  // Titles come from the extractor so the AI pass and the frame agree on them.
  // Every folder-bearing group is titled now, including a lone one: a short
  // "Surface" says something the frame's own title does not, which a repeat of
  // the full folder path did not.
  const titles = groupTitles(groups.map((g) => g.folder));

  groups.forEach((group, gi) => {
    const block = vstack(GROUP_HEAD_GAP);
    block.name = group.folder || 'Ungrouped';
    // Rows at the root of a collection have no folder to name, so they get no
    // heading rather than an invented one.
    if (group.folder) block.appendChild(groupHeading(titles[gi]));

    // Keyed by folder, not by title: the title can widen to avoid a clash, and
    // keying on a value that moves would drop the description when it did.
    const note = groupDescriptions?.[group.folder];
    if (note) {
      const wrap = vstack(0);
      block.appendChild(wrap);
      fixWidthHugHeight(wrap, GROUP_NOTE_W);
      wrappingText(wrap, note, 'Regular', 11, palette.muted);
    }

    const body = vstack(0);
    block.appendChild(body);
    group.rows.forEach((row, i) => {
      // The divider count restarts per group: the heading already separates the
      // block above, so a leading hairline would double it.
      body.appendChild(swatchRow(row, modeNames.length, i > 0, showDescriptions));
    });

    list.appendChild(block);
  });
  return list;
}

/**
 * A block with its heading, used only when one frame holds both layouts.
 *
 * The two are grouped rather than appended side by side so the heading sits
 * against its own block: as separate children of the body they were separated by
 * the body's own 28px rhythm, which reads as a heading floating between blocks
 * rather than belonging to the one below it.
 */
function labelledBlock(text: string, block: FrameNode): FrameNode {
  const group = vstack(10);
  group.appendChild(makeText(text, 'Medium', 11, palette.muted));
  group.appendChild(block);
  return group;
}

/**
 * A column heading. Not uppercased, unlike the component doc's table headings:
 * half of these labels are user-authored mode names, and shouting a name the
 * user chose back at them misrepresents what the mode is called.
 */
export function headerCell(label: string, width: number): FrameNode {
  const cell = vstack(0);
  fixWidthHugHeight(cell, width);
  wrappingText(cell, label, 'Medium', 11, palette.muted);
  return cell;
}

/** One table row. `divider` draws the hairline above it, as the doc tables do. */
function tableRow(children: FrameNode[], divider: boolean): FrameNode {
  const row = hstack(CELL_GAP);
  row.paddingTop = ROW_PAD;
  row.paddingBottom = ROW_PAD;
  row.paddingLeft = CELL_GAP;
  row.paddingRight = CELL_GAP;
  // First lines align across the row. With cells that can wrap to different
  // heights, centring each one against the others reads as ragged.
  row.counterAxisAlignItems = 'MIN';
  row.layoutSizingHorizontal = 'HUG';
  for (const c of children) row.appendChild(c);
  if (divider) {
    row.strokes = solidFill(palette.divider);
    row.strokeTopWeight = 1;
    row.strokeBottomWeight = 0;
    row.strokeLeftWeight = 0;
    row.strokeRightWeight = 0;
  }
  return row;
}

/** The footer note block. Shared by both exits from the frame builder. */
function buildFooter(notes: string[]): FrameNode {
  const footer = vstack(2);
  footer.name = 'Notes';
  for (const n of notes) footer.appendChild(makeText(n, 'Regular', 10, palette.muted));
  return footer;
}

/**
 * Wrap the finished card in its Section and size the Section around it.
 *
 * Shared by both exits for one reason: a colours-only frame returns before the
 * table is built, and a second copy of this would be the place a future change
 * to one exit silently fails to reach the other.
 */
function finishCard(card: FrameNode, title: string): SectionNode {
  const section = figma.createSection();
  section.name = `Foundations: ${title}`;
  section.appendChild(card);
  card.x = 40;
  card.y = 40;
  section.resizeWithoutConstraints(card.width + 80, card.height + 80);
  return section;
}

/**
 * Build one foundation Section. `loadFonts` reports families that failed so the
 * caller can note the fallback on the affected rows.
 */
export async function buildFoundationFrame(
  content: FoundationUnitContent,
  unit: FoundationUnit,
  theme: ReturnType<typeof resolveTheme>,
  includeDescriptions: boolean,
  logoBase64?: string | null,
  groupDescriptions?: Record<string, string>,
): Promise<SectionNode> {
  // Reset and apply theme state BEFORE any layout reads palette or fonts.
  // Skipping this would inherit whatever the last component build left in
  // frameKit's module state.
  await applyThemeToKit(theme);

  const isText = unit.scope.target === 'textStyles';

  // Colour variables render as a swatch list, everything else as a table. A
  // mixed collection (colour plus spacing plus radius) gets both, in that order.
  const colorRows = content.rows.filter(isColorRow) as FoundationVariableRow[];
  const tableRows = content.rows.filter((r) => !isColorRow(r));

  // The column appears only when the user asked for descriptions AND some row
  // in this unit actually has one, so a file with no descriptions never gets a
  // column of blanks. Judged on the TABLE's rows alone: a colour row carries its
  // description inline, so counting those would add an all-blank column whenever
  // only colours are described.
  const hasDescriptions = includeDescriptions
    && tableRows.some((r) => r.description.length > 0);

  // Load every family a specimen needs. Track failures so a wrong-looking
  // specimen is always acknowledged rather than silently wrong.
  const failedFamilies = new Set<string>();
  if (isText) {
    const wanted = new Map<string, FontName>();
    for (const row of content.rows) {
      if (row.kind !== 'textStyle') continue;
      wanted.set(`${row.metrics.fontFamily}|${row.metrics.fontStyle}`,
        { family: row.metrics.fontFamily, style: row.metrics.fontStyle });
    }
    for (const [key, fontName] of wanted) {
      try { await figma.loadFontAsync(fontName); }
      catch { failedFamilies.add(key); }
    }
  }

  // Derived from content, not read off `unit`: the title is rendered text, so it
  // has to come from the same object the drift hash reads. It also has to agree
  // with the title the batch and a later single-doc Update compute, which is why
  // one function in the extractor derives all three.
  const title = foundationUnitTitle(unit.scope, content);
  const columns = tableColumns(content, isText, hasDescriptions);
  // The card has to fit whichever layouts it holds, since it clips its contents.
  const width = Math.max(
    tableRows.length > 0 ? cardWidth(columns) : CARD_WIDTH_MIN,
    colorRows.length > 0
      ? Math.max(CARD_WIDTH_MIN, swatchRowWidth(content.modeNames.length) + HEADER_PAD_X * 2)
      : CARD_WIDTH_MIN,
  );

  const card = vstack(0);
  card.name = title;
  card.fills = solidFill(palette.bg);
  card.strokes = solidFill(palette.border);
  card.strokeWeight = 1;
  card.cornerRadius = radius(16);
  card.clipsContent = true; // so the header band's corners follow the card's
  card.effects = [
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
  // Fix the width BEFORE appending: a child can only be set to FILL once its
  // parent is FIXED on that axis.
  fixWidthHugHeight(card, width);

  // --- brand header band ---
  const header = await buildBrandHeader({
    eyebrow: 'Foundations',
    title,
    subtitle: headerSubtitle(content, isText),
    logoBase64,
  });
  card.appendChild(header);
  header.layoutSizingHorizontal = 'FILL';

  const body = vstack(28);
  body.name = 'Content';
  body.paddingTop = 40;
  body.paddingBottom = 48;
  body.paddingLeft = HEADER_PAD_X;
  body.paddingRight = HEADER_PAD_X;
  card.appendChild(body);
  body.layoutSizingHorizontal = 'FILL';

  // A frame holding both layouts labels them, so the split reads as deliberate
  // rather than as two unrelated blocks. A frame with only one needs no label.
  const bothLayouts = colorRows.length > 0 && tableRows.length > 0;

  // --- swatch list (colours) ---
  if (colorRows.length > 0) {
    const list = buildSwatchList(
      colorRows, content.modeNames, includeDescriptions, groupDescriptions);
    body.appendChild(bothLayouts ? labelledBlock('Colors', list) : list);
  }

  // --- table (everything else) ---
  if (tableRows.length === 0) {
    const notes = footerNotes(content);
    if (notes.length > 0) body.appendChild(buildFooter(notes));
    return finishCard(card, title);
  }

  const table = vstack(0);
  table.name = 'Table';
  table.cornerRadius = radius(8);
  table.clipsContent = true;
  table.strokes = solidFill(palette.border);
  table.strokeWeight = 1;
  body.appendChild(bothLayouts ? labelledBlock('Other values', table) : table);

  const head = tableRow(columns.map((c) => headerCell(c.label, c.width)), false);
  head.fills = solidFill(palette.tableHeadBg);
  table.appendChild(head);

  tableRows.forEach((row) => {
    // Cells are filled in column order, so a cell's width is always the width
    // its own heading was measured at.
    let next = 0;
    const widthOf = (): number => columns[next++]?.width ?? COL_MODE;

    const cells: FrameNode[] = [cellText(row.name, widthOf())];
    if (hasDescriptions) cells.push(cellText(row.description, widthOf(), true));

    if (row.kind === 'variable') {
      for (const cell of row.cells) cells.push(swatchCell(cell.value, widthOf()));
    } else {
      const key = `${row.metrics.fontFamily}|${row.metrics.fontStyle}`;
      const failed = failedFamilies.has(key);
      const pane = vstack(4);
      fixWidthHugHeight(pane, widthOf());
      const specimen = makeText('Ag', 'Regular', Math.min(row.metrics.fontSize, 40), palette.heading);
      if (!failed) {
        specimen.fontName = { family: row.metrics.fontFamily, style: row.metrics.fontStyle };
      }
      pane.appendChild(specimen);
      const lh = row.metrics.lineHeight.unit === 'AUTO'
        ? 'auto' : `${row.metrics.lineHeight.value}${row.metrics.lineHeight.unit === 'PERCENT' ? '%' : ''}`;
      // Wrapped, like every other cell: a family name plus style and metrics is
      // routinely longer than the column.
      wrappingText(pane,
        `${row.metrics.fontFamily} ${row.metrics.fontStyle} ${row.metrics.fontSize}/${lh}`,
        'Regular', 10, palette.muted);
      if (failed) {
        wrappingText(pane, 'Font not available, showing the default font.',
          'Regular', 10, palette.muted);
      }
      cells.push(pane);
    }

    // Every row after the header carries the hairline above it, so the table's
    // own border is never doubled at the last row.
    table.appendChild(tableRow(cells, true));
  });

  // --- footer notes ---
  // Derived from `content` alone, never from `unit` or from parameters: the
  // renderer must read the same object the drift hash reads.
  const notes = footerNotes(content);
  if (notes.length > 0) body.appendChild(buildFooter(notes));

  return finishCard(card, title);
}
