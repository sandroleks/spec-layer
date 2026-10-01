/// <reference types="@figma/plugin-typings" />
/**
 * Renders one foundation output unit as a Figma Section. It shares frameKit
 * primitives and brandHeader with docFrame.ts, so it inherits the brand theme
 * and logo with no theming code of its own.
 */
import type {
  FoundationUnit, FoundationUnitContent, FoundationValue, FoundationScope,
  FoundationRow, FoundationVariableRow, FoundationTextRow, FoundationEffectRow,
  ColorContrastReport, FoundationGlyph,
} from '@spec-layer/extractor';
import { foundationUnitTitle, groupRowsByFolder, groupTitles } from '@spec-layer/extractor';
import {
  palette, solidFill, makeText, vstack, hstack, radius, hex, applyThemeToKit,
  headingFont, PROSE_MEASURE,
} from './frameKit';
import { buildGlyph, glyphSpec, glyphValue } from './foundationScales';
import { buildTextSpecimenList, buildEffectSpecimenList } from './foundationSpecimens';
import { buildBrandHeader, HEADER_PAD_X } from './brandHeader';
import {
  contrastBlockModel, contrastBlockWidth, matrixFrame, type ContrastBlockModel,
} from './foundationContrast';
import type { resolveTheme } from './brandColors';
import type { PillState } from './publishPill';

type UnresolvedReason = Extract<FoundationValue, { kind: 'unresolved' }>['reason'];

/** Reader words for each unresolved reason code, which is never drawn as is.
 *  Display only: foundationContentHash hashes the code, not this label. */
const UNRESOLVED_WORDS: Record<UnresolvedReason, string> = {
  external: 'library variable',
  cycle: 'aliases form a loop',
  missing: 'value missing',
  depth: 'alias chain too long',
};

/** "Not resolved: {plain reason}", the one form every unresolved value takes. */
export function unresolvedLabel(reason: UnresolvedReason): string {
  return `Not resolved: ${UNRESOLVED_WORDS[reason]}`;
}

/** Label for a single value, never empty. The alias branch is only a floor:
 *  resolution flattens chains, so a resolved target is never an alias. */
function leafLabel(value: FoundationValue): string {
  switch (value.kind) {
    case 'alias':
      return `→ ${value.targetName}`;
    case 'color': {
      const h = value.hex.toUpperCase();
      return value.alpha < 1 ? `${h} ${Math.round(value.alpha * 100)}%` : h;
    }
    case 'number':
      return String(value.value);
    case 'string':
      return value.value === '' ? 'Empty string' : value.value;
    case 'boolean':
      return String(value.value);
    case 'unresolved':
      return unresolvedLabel(value.reason);
  }
}

/** One cell's text on two lines: an alias's target, then what it resolves to.
 *  `secondary` is empty when there is nothing more to say. */
export interface ValueLines { primary: string; secondary: string }

export function valueLines(value: FoundationValue): ValueLines {
  if (value.kind !== 'alias') return { primary: leafLabel(value), secondary: '' };
  const primary = `→ ${value.targetName}`;
  // A library's modes cannot map onto local ones, so there is no value to show.
  if (value.external) return { primary, secondary: 'Library variable' };
  if (!value.resolved) return { primary, secondary: '' };
  return { primary, secondary: leafLabel(value.resolved) };
}

// ---------------------------------------------------------------------------
// Colour formats: hex, rgb and hsl, all derived from the hex the drift hash
// already covers, so they cannot drift from it.
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

/** `hsl(212.9, 93.9%, 19.4%)`, or `hsla(...)` when not opaque. A grey's
 *  undefined hue is 0, by convention. */
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
 * The value lines beside one swatch, in render order. A direct colour gets all
 * three notations; an alias gets its target and resolved hex, since the
 * primitive's own frame carries the full formats.
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

/** The header subtitle, counted. Reads only `content`, as footerNotes does. */
export function headerSubtitle(content: FoundationUnitContent, target: FoundationScope['target']): string {
  if (target === 'textStyles') return plural(content.rows.length, 'text style', 'text styles');
  if (target === 'effectStyles') return plural(content.rows.length, 'effect style', 'effect styles');
  return `${plural(content.rows.length, 'variable', 'variables')} across `
    + plural(content.modeNames.length, 'mode', 'modes');
}

/**
 * The frame's footer lines, in render order. Takes ONLY `content`: whatever a
 * footer says must come from what the drift hash reads, or it is rendered
 * without being covered.
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
// A stacked "name over value" pair fits a narrower column.
const COL_MODE = 160;
const ROW_PAD = 10;
const CELL_GAP = 12;

/** Narrowest card, matching the component doc frame so the two sit level. */
const CARD_WIDTH_MIN = 880;

/** Inner width the card's body offers a full-width block, once its own padding is subtracted. */
const CONTENT_WIDTH = CARD_WIDTH_MIN - HEADER_PAD_X * 2;

export interface TableColumn { label: string; width: number }

/** The table's columns in render order. One list drives the header, every
 *  row and the card width, so a column cannot be labelled at one width and
 *  filled at another. */
export function tableColumns(
  content: FoundationUnitContent, hasDescriptions: boolean,
): TableColumn[] {
  const columns: TableColumn[] = [{ label: 'Name', width: COL_NAME }];
  if (hasDescriptions) columns.push({ label: 'Description', width: COL_DESC });
  // Only a collection unit gets here; specimen units return earlier.
  for (const name of content.modeNames) columns.push({ label: name, width: COL_MODE });
  return columns;
}

/** A table row's laid-out width: cells, gaps and the row's own side padding.
 *  The card width derives from exactly this, because the card clips. */
export function rowWidth(columns: TableColumn[]): number {
  return columns.reduce((sum, c) => sum + c.width, 0)
    + CELL_GAP * Math.max(columns.length - 1, 0)
    + CELL_GAP * 2;
}

/** The card's width: the table plus padding, never narrower than a component
 *  doc frame. Unbounded above: a description column plus the four-mode cap
 *  still fits inside the component frame's ceiling. */
export function cardWidth(columns: TableColumn[]): number {
  return Math.max(CARD_WIDTH_MIN, rowWidth(columns) + HEADER_PAD_X * 2);
}

/**
 * Pin a frame's width while its height hugs. Uses the axis-explicit
 * layoutSizing* API: on a HORIZONTAL frame the primary axis is the width, so
 * the primary/counter API would leave the height fixed. resize() fixes BOTH
 * axes, so the vertical hug must be restored after it.
 */
function fixWidthHugHeight(frame: FrameNode, width: number): void {
  frame.layoutSizingHorizontal = 'FIXED';
  frame.resize(width, frame.height); // current height, never a literal
  frame.layoutSizingVertical = 'HUG';
}

/**
 * Append a text node that wraps inside its cell. makeText's default sizing hugs
 * both axes, so a FIXED cell would not constrain it; FILL plus a HEIGHT-only
 * autoresize wraps it to the column. `parent` must already be FIXED
 * horizontally: Figma rejects FILL on a child of a frame that hugs that axis.
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

// ---------------------------------------------------------------------------
// Reference chips: Figma's code syntax, shown exactly as stored. No chip is
// ever derived from the token's own name or path.
// ---------------------------------------------------------------------------

/** Figma's code-syntax platform keys as people read them; an unknown key is shown as stored. */
export const PLATFORM_LABEL: Record<string, string> = { WEB: 'Web', iOS: 'iOS', ANDROID: 'Android' };

function referenceChip(platform: string, identifier: string, width: number): FrameNode {
  const c = hstack(4);
  c.paddingTop = c.paddingBottom = 2;
  c.paddingLeft = c.paddingRight = 6;
  c.cornerRadius = radius(6);
  c.fills = solidFill(palette.chipBg);
  c.counterAxisAlignItems = 'CENTER';
  // Capped at the cell width, so a long identifier wraps instead of clipping.
  c.maxWidth = width;
  c.layoutWrap = 'WRAP';
  const label = makeText(PLATFORM_LABEL[platform] ?? platform, 'Regular', 10, palette.muted);
  label.textAutoResize = 'WIDTH_AND_HEIGHT';
  c.appendChild(label);
  const id = makeText(identifier, 'Medium', 11, palette.heading);
  id.textAutoResize = 'WIDTH_AND_HEIGHT';
  // Figma accepts maxWidth only on an auto-layout child: set it after the append, or it throws.
  c.appendChild(id);
  id.maxWidth = Math.max(1, width - 12); // 6 + 6 chip padding
  return c;
}

/** One chip per platform, in code-unit key order (the projection sorted
 *  them). Null when the variable defines none. */
export function referenceChips(codeSyntax: Record<string, string>, width: number): FrameNode | null {
  const entries = Object.entries(codeSyntax);
  if (entries.length === 0) return null;
  const row = hstack(6);
  row.name = 'Code syntax';
  row.layoutWrap = 'WRAP';
  for (const [platform, identifier] of entries) row.appendChild(referenceChip(platform, identifier, width));
  return row;
}

/** The table's Name cell: the token name, then its reference chips when it has any. */
export function nameCell(row: FoundationVariableRow, width: number): FrameNode {
  const cell = cellText(row.name, width);
  cell.itemSpacing = 6;
  const chips = referenceChips(row.codeSyntax, width);
  if (chips) { cell.appendChild(chips); chips.layoutSizingHorizontal = 'FILL'; }
  return cell;
}

export function swatchCell(value: FoundationValue, width: number, glyph: FoundationGlyph | null = null): FrameNode {
  const cell = vstack(6);
  cell.counterAxisAlignItems = 'MIN';
  fixWidthHugHeight(cell, width);

  // A scale drawing only when the value is a number glyphSpec accepts.
  const n = glyph ? glyphValue(value) : null;
  const spec = glyph && n !== null ? glyphSpec(glyph, n, width) : null;
  if (spec) cell.appendChild(buildGlyph(spec, width));

  const line = hstack(8);
  // Top-aligned, so wrapped and one-line cells share a first line.
  line.counterAxisAlignItems = 'MIN';
  cell.appendChild(line);
  line.layoutSizingHorizontal = 'FILL';

  const color = swatchColorOf(value);
  if (color) {
    const chip = figma.createRectangle();
    chip.resize(14, 14);
    chip.cornerRadius = radius(3);
    chip.fills = solidFill(color);
    chip.strokes = solidFill(palette.border);
    chip.strokeWeight = 1;
    line.appendChild(chip);
  }

  const lines = vstack(2);
  line.appendChild(lines);
  lines.layoutSizingHorizontal = 'FILL';

  const unresolved = value.kind === 'unresolved'
    || (value.kind === 'alias' && !value.external && value.resolved?.kind === 'unresolved');
  const { primary, secondary } = valueLines(value);
  wrappingText(lines, primary, 'Regular', 11, unresolved ? palette.muted : palette.body);
  // The resolved value is supporting detail: smaller and muted.
  if (secondary) wrappingText(lines, secondary, 'Regular', 10, palette.muted);
  return cell;
}

// ---------------------------------------------------------------------------
// Swatch list: colour variables get a swatch, name, description and values
// instead of a table row. Single-mode: swatch, name, values right-aligned.
// Multi-mode: the name leads and each mode follows as its own swatch block.
// ---------------------------------------------------------------------------

const SWATCH = 44;          // single-mode: the reference's large chip
const SWATCH_SMALL = 36;    // multi-mode: one per mode, so slightly smaller
const SWATCH_GAP = 18;
const BLOCK_GAP = 12;       // swatch to its own values
const NAME_MIN = 300;       // single-mode: the name column FILLs beyond this
const NAME_W = 280;         // multi-mode: fixed, so the mode blocks line up
const VALUES_W = 210;       // single-mode: the right-aligned value stack
const MODE_BLOCK_W = 190;   // multi-mode: swatch plus its values
const SWATCH_ROW_PAD = 18;
const GROUP_GAP = 32;       // between one titled group and the next
const GROUP_HEAD_GAP = 14;  // a group's heading to its own rows
// The mode-heading row captions the list under it, so it sits closer than GROUP_GAP.
const HEADER_GAP = 12;

/** True for the rows the swatch list owns. */
export function isColorRow(row: FoundationRow): boolean {
  return row.kind === 'variable' && row.resolvedType === 'COLOR';
}

/** Inner width one swatch-list row needs; the card clips, so it must fit this. */
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
  // Unresolved gets an empty outlined box: a gap reads as a rendering fault.
  chip.fills = color ? solidFill(color) : [];
  chip.strokes = solidFill(palette.border);
  chip.strokeWeight = 1;
  return chip;
}

/** The token's name over its description. `showDescription` is the user's
 *  Foundations setting, which governs both layouts. */
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
  // The single-mode FILL resolves to exactly NAME_MIN in a fixed-width row.
  const chips = referenceChips(row.codeSyntax, width === 'fill' ? NAME_MIN : width);
  if (chips) block.appendChild(chips);
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

/** A value stack styled by POSITION: the first line is the fact that matters
 *  (the hex, or an alias's target), the rest are muted detail. */
function appendSwatchValues(
  parent: FrameNode, lines: string[], align: 'LEFT' | 'RIGHT' = 'LEFT',
): void {
  lines.forEach((text, i) => {
    if (i === 0) wrappingText(parent, text, 'Medium', 12, palette.body, align);
    else wrappingText(parent, text, 'Regular', 10, palette.muted, align);
  });
}

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
      values, cell ? swatchValueLines(cell.value) : [unresolvedLabel('missing')], 'RIGHT');
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
    // No mode label: the list's header row names each column once.
    appendSwatchValues(values, swatchValueLines(cell.value));
  }
  return line;
}

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
  // Two nested frames, since one auto layout has one itemSpacing: `wrap`
  // (HEADER_GAP) holds the mode headings and `groups` (GROUP_GAP).
  const wrap = vstack(HEADER_GAP);
  wrap.name = 'Colors';

  // Mode headings only when there are modes to tell apart.
  if (modeNames.length > 1) wrap.appendChild(modeHeadings(modeNames));

  const groupsList = vstack(GROUP_GAP);
  wrap.appendChild(groupsList);

  const groups = groupRowsByFolder(rows);
  // Extractor titles, so the AI pass and the frame agree.
  const titles = groupTitles(groups.map((g) => g.folder));

  groups.forEach((group, gi) => {
    const block = vstack(GROUP_HEAD_GAP);
    block.name = group.folder || 'Ungrouped';
    // Root rows have no folder, so no heading rather than an invented one.
    if (group.folder) block.appendChild(groupHeading(titles[gi]));

    // Keyed by folder, not title: a title can widen to avoid a clash.
    const note = groupDescriptions?.[group.folder];
    if (note) {
      const wrapNote = vstack(0);
      block.appendChild(wrapNote);
      fixWidthHugHeight(wrapNote, PROSE_MEASURE);
      wrappingText(wrapNote, note, 'Regular', 11, palette.muted);
    }

    const body = vstack(0);
    block.appendChild(body);
    group.rows.forEach((row, i) => {
      // Dividers restart per group; the heading already separates the block above.
      body.appendChild(swatchRow(row, modeNames.length, i > 0, showDescriptions));
    });

    groupsList.appendChild(block);
  });
  return wrap;
}

/** A heading grouped with its block, so it sits against the block rather than
 *  at the body's 28px rhythm. */
function labelledBlock(text: string, block: FrameNode): FrameNode {
  const group = vstack(10);
  const label = makeText(text, 'Medium', 11, palette.muted);
  // A mode name is unbounded, so cap it at the prose measure. Set after the
  // append: Figma accepts maxWidth only on an auto-layout child.
  group.appendChild(label);
  label.maxWidth = PROSE_MEASURE;
  group.appendChild(block);
  return group;
}

// Grid to grid, and grid to note.
const CONTRAST_GAP = 16;

/** A note set to the prose measure. */
function contrastNote(parent: FrameNode, text: string): void {
  const box = vstack(0);
  parent.appendChild(box);
  fixWidthHugHeight(box, PROSE_MEASURE);
  wrappingText(box, text, 'Regular', 11, palette.muted);
}

/** One contrast grid per mode, plus the model's note. The empty case draws its
 *  REASON: a blank grid reads as "the colours are fine". */
function buildContrastBlock(model: ContrastBlockModel): FrameNode {
  const stack = vstack(CONTRAST_GAP);
  stack.name = 'Contrast';
  if (model.kind === 'none') {
    contrastNote(stack, model.reason);
    return labelledBlock('Contrast', stack);
  }
  const many = model.matrices.length > 1;
  for (const m of model.matrices) {
    const grid = matrixFrame(m);
    stack.appendChild(many ? labelledBlock(m.mode, grid) : grid);
  }
  // Under the grids: a footnote on what is missing.
  if (model.note) contrastNote(stack, model.note);
  return labelledBlock('Contrast', stack);
}

/** A column heading. Not uppercased: many are user-authored mode names. */
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
  // First lines align; centring cells of different heights reads as ragged.
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

/** The footer note block, shared by every exit. Exported for its sizing test. */
export function buildFooter(notes: string[]): FrameNode {
  const footer = vstack(2);
  footer.name = 'Notes';
  // The prose measure, so a long list of omitted modes wraps.
  fixWidthHugHeight(footer, PROSE_MEASURE);
  for (const n of notes) wrappingText(footer, n, 'Regular', 10, palette.muted);
  return footer;
}

/** Wrap the card in its Section, sized around it. One copy for every exit. */
function finishCard(card: FrameNode, title: string): SectionNode {
  const section = figma.createSection();
  try {
    section.name = `Foundations: ${title}`;
    section.appendChild(card);
    card.x = 40;
    card.y = 40;
    section.resizeWithoutConstraints(card.width + 80, card.height + 80);
    return section;
  } catch (err) {
    // createSection auto-appends to the page, so never leave it half-filled.
    // The card is the caller's to remove.
    try { section.remove(); } catch { /* already gone */ }
    throw err;
  }
}

/** Build one foundation Section. A specimen whose font failed to load is
 *  noted on its row. */
export async function buildFoundationFrame(
  content: FoundationUnitContent,
  unit: FoundationUnit,
  theme: ReturnType<typeof resolveTheme>,
  includeDescriptions: boolean,
  logoBase64?: string | null,
  groupDescriptions?: Record<string, string>,
  // Defaulted off, so a caller that omits it renders what it always did and no
  // existing doc's drift baseline moves.
  includeContrast = false,
  contrast?: ColorContrastReport,
  pill: PillState | null = null,
  collectionOverview?: string,
): Promise<SectionNode> {
  // Apply theme state BEFORE any layout reads palette or fonts, or this build
  // inherits the last build's frameKit module state.
  await applyThemeToKit(theme);

  const isText = unit.scope.target === 'textStyles';
  // Specimen units render a list and return before the table.
  const usesTable = unit.scope.target !== 'textStyles' && unit.scope.target !== 'effectStyles';

  // Colour variables render as a swatch list, everything else as a table. A
  // mixed collection (colour plus spacing plus radius) gets both, in that order.
  const colorRows = content.rows.filter(isColorRow) as FoundationVariableRow[];
  const tableRows = content.rows.filter((r) => !isColorRow(r));

  // Decided before the card is sized: the card CLIPS, and a grid at the
  // extractor's 24 column cap is the widest block. A styles unit has no
  // colour variables, so it gets none.
  const contrastModel = includeContrast && contrast && unit.scope.target === 'collection'
    ? contrastBlockModel(contrast, content.collectionName)
    : null;

  // Only when asked for AND some TABLE row has one, so there is never a column
  // of blanks. Colour rows carry their descriptions inline.
  const hasDescriptions = usesTable && includeDescriptions
    && tableRows.some((r) => r.description.length > 0);

  // Track failures so a wrong-looking specimen is always acknowledged.
  const failedFamilies = new Set<string>();
  if (isText) {
    const wanted = new Map<string, FontName>();
    for (const row of content.rows) {
      if (row.kind !== 'textStyle') continue;
      wanted.set(`${row.metrics.fontFamily}|${row.metrics.fontStyle}`,
        { family: row.metrics.fontFamily, style: row.metrics.fontStyle });
    }
    await Promise.all([...wanted].map(([key, fontName]) => Promise.resolve()
      .then(() => figma.loadFontAsync(fontName))
      .catch(() => { failedFamilies.add(key); })));
  }

  // From `content`, which the drift hash reads, not from `unit`. One extractor
  // function derives every title, so a batch and an Update agree.
  const title = foundationUnitTitle(unit.scope, content);
  // No columns for a specimen unit leaves cardWidth at its floor.
  const columns = usesTable ? tableColumns(content, hasDescriptions) : [];
  // The card has to fit whichever layouts it holds, since it clips its contents.
  const width = Math.max(
    tableRows.length > 0 ? cardWidth(columns) : CARD_WIDTH_MIN,
    colorRows.length > 0
      ? Math.max(CARD_WIDTH_MIN, swatchRowWidth(content.modeNames.length) + HEADER_PAD_X * 2)
      : CARD_WIDTH_MIN,
    contrastModel?.kind === 'matrix'
      ? contrastBlockWidth(contrastModel.matrices) + HEADER_PAD_X * 2
      : CARD_WIDTH_MIN,
  );

  const card = vstack(0);
  try {
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
    // Fix the width BEFORE appending: FILL needs a parent FIXED on that axis.
    fixWidthHugHeight(card, width);

    const header = await buildBrandHeader({
      eyebrow: 'Foundations',
      title,
      subtitle: headerSubtitle(content, unit.scope.target),
      logoBase64,
      pill,
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

    // The AI collection overview. Untagged: selfHash covers it, so a hand edit
    // reads as Edited. Never read back from canvas.
    const overview = unit.scope.target === 'collection' ? collectionOverview?.trim() : undefined;
    if (overview) {
      const box = vstack(0);
      box.name = 'Overview';
      body.appendChild(box);
      fixWidthHugHeight(box, PROSE_MEASURE);
      wrappingText(box, overview, 'Regular', 13, palette.body);
    }

    // Label the layouts only when the frame holds both.
    const bothLayouts = colorRows.length > 0 && tableRows.length > 0;

    if (colorRows.length > 0) {
      const list = buildSwatchList(
        colorRows, content.modeNames, includeDescriptions, groupDescriptions);
      body.appendChild(bothLayouts ? labelledBlock('Colors', list) : list);
    }

    // Ahead of the early returns, so a colours-only frame gets it too.
    if (contrastModel) body.appendChild(buildContrastBlock(contrastModel));

    // A styles unit's specimen list IS its body.
    if (unit.scope.target === 'textStyles') {
      const textRows = content.rows.filter((r): r is FoundationTextRow => r.kind === 'textStyle');
      body.appendChild(buildTextSpecimenList(textRows, CONTENT_WIDTH, includeDescriptions, failedFamilies));
      const notes = footerNotes(content);
      if (notes.length > 0) body.appendChild(buildFooter(notes));
      return finishCard(card, title);
    }

    if (unit.scope.target === 'effectStyles') {
      const effectRows = content.rows.filter((r): r is FoundationEffectRow => r.kind === 'effectStyle');
      body.appendChild(buildEffectSpecimenList(effectRows, CONTENT_WIDTH, includeDescriptions));
      const notes = footerNotes(content);
      if (notes.length > 0) body.appendChild(buildFooter(notes));
      return finishCard(card, title);
    }

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
      // Filled in column order, so each cell gets its heading's width.
      let next = 0;
      const widthOf = (): number => columns[next++]?.width ?? COL_MODE;

      const cells: FrameNode[] = [
        row.kind === 'variable' ? nameCell(row, widthOf()) : cellText(row.name, widthOf()),
      ];
      if (hasDescriptions) cells.push(cellText(row.description, widthOf(), true));

      if (row.kind === 'variable') {
        for (const cell of row.cells) cells.push(swatchCell(cell.value, widthOf(), row.glyph));
      }

      // A hairline above every row after the header, so the border never doubles.
      table.appendChild(tableRow(cells, true));
    });

    const notes = footerNotes(content);
    if (notes.length > 0) body.appendChild(buildFooter(notes));

    return finishCard(card, title);
  } catch (err) {
    // Never litter the canvas: createFrame auto-appends to the page, and every
    // frame this build made is inside `card`.
    try { card.remove(); } catch { /* already gone */ }
    throw err;
  }
}
