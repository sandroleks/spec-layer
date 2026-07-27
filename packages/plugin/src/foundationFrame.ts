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
 * The pure functions here (valueLabel, swatchColorOf, footerNotes,
 * headerSubtitle, tableColumns, cardWidth) are unit-tested. Node construction
 * is verified by the manual Figma pass, the same treatment docFrame.ts gets.
 */
import type {
  FoundationUnit, FoundationUnitContent, FoundationValue,
} from '@spec-layer/extractor';
import { foundationUnitTitle } from '@spec-layer/extractor';
import {
  palette, solidFill, makeText, vstack, hstack, radius, hex, applyThemeToKit,
} from './frameKit';
import { buildBrandHeader, HEADER_PAD_X } from './brandHeader';
import type { resolveTheme } from './brandColors';

/** Human label for one cell. Never returns an empty string. */
export function valueLabel(value: FoundationValue): string {
  switch (value.kind) {
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
    case 'alias': {
      if (value.external) return `→ ${value.targetName} (library)`;
      if (!value.resolved) return `→ ${value.targetName}`;
      return `→ ${value.targetName}  ${valueLabel(value.resolved)}`;
    }
    case 'unresolved':
      return value.reason === 'external'
        ? 'not resolved: external library variable'
        : `not resolved: ${value.reason}`;
  }
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
const COL_MODE = 180;
const ROW_PAD = 8;
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

export function cellText(label: string, width: number, muted = false): FrameNode {
  const row = hstack(6);
  row.counterAxisAlignItems = 'CENTER';
  row.appendChild(makeText(label, 'Regular', 11, muted ? palette.muted : palette.body));
  fixWidthHugHeight(row, width);
  return row;
}

export function swatchCell(value: FoundationValue, width: number): FrameNode {
  const row = hstack(6);
  row.counterAxisAlignItems = 'CENTER';

  const color = swatchColorOf(value);
  if (color) {
    const chip = figma.createRectangle();
    chip.resize(14, 14);
    chip.cornerRadius = radius(3);
    chip.fills = solidFill(color);
    chip.strokes = solidFill(palette.border);
    chip.strokeWeight = 1;
    row.appendChild(chip);
  }
  const unresolved = value.kind === 'unresolved'
    || (value.kind === 'alias' && !value.external && value.resolved?.kind === 'unresolved');
  row.appendChild(makeText(valueLabel(value), 'Regular', 11,
    unresolved ? palette.muted : palette.body));
  fixWidthHugHeight(row, width);
  return row;
}

/**
 * A column heading. Not uppercased, unlike the component doc's table headings:
 * half of these labels are user-authored mode names, and shouting a name the
 * user chose back at them misrepresents what the mode is called.
 */
export function headerCell(label: string, width: number): FrameNode {
  const row = hstack(0);
  row.appendChild(makeText(label, 'Medium', 11, palette.muted));
  fixWidthHugHeight(row, width);
  return row;
}

/** One table row. `divider` draws the hairline above it, as the doc tables do. */
function tableRow(children: FrameNode[], divider: boolean): FrameNode {
  const row = hstack(CELL_GAP);
  row.paddingTop = ROW_PAD;
  row.paddingBottom = ROW_PAD;
  row.paddingLeft = CELL_GAP;
  row.paddingRight = CELL_GAP;
  row.counterAxisAlignItems = 'CENTER';
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
): Promise<SectionNode> {
  // Reset and apply theme state BEFORE any layout reads palette or fonts.
  // Skipping this would inherit whatever the last component build left in
  // frameKit's module state.
  await applyThemeToKit(theme);

  // The column appears only when the user asked for descriptions AND some row
  // in this unit actually has one, so a file with no descriptions never gets a
  // column of blanks.
  const hasDescriptions = includeDescriptions
    && content.rows.some((r) => r.description.length > 0);
  const isText = unit.scope.target === 'textStyles';

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
  const width = cardWidth(columns);

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

  // --- table ---
  const table = vstack(0);
  table.name = 'Table';
  table.cornerRadius = radius(8);
  table.clipsContent = true;
  table.strokes = solidFill(palette.border);
  table.strokeWeight = 1;
  body.appendChild(table);

  const head = tableRow(columns.map((c) => headerCell(c.label, c.width)), false);
  head.fills = solidFill(palette.tableHeadBg);
  table.appendChild(head);

  content.rows.forEach((row) => {
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
      const pane = vstack(2);
      pane.resize(widthOf(), 1);
      pane.primaryAxisSizingMode = 'AUTO';
      const specimen = makeText('Ag', 'Regular', Math.min(row.metrics.fontSize, 40), palette.heading);
      if (!failed) {
        specimen.fontName = { family: row.metrics.fontFamily, style: row.metrics.fontStyle };
      }
      pane.appendChild(specimen);
      const lh = row.metrics.lineHeight.unit === 'AUTO'
        ? 'auto' : `${row.metrics.lineHeight.value}${row.metrics.lineHeight.unit === 'PERCENT' ? '%' : ''}`;
      pane.appendChild(makeText(
        `${row.metrics.fontFamily} ${row.metrics.fontStyle} ${row.metrics.fontSize}/${lh}`,
        'Regular', 10, palette.muted));
      if (failed) {
        pane.appendChild(makeText('Font not available, showing the default font.', 'Regular', 10, palette.muted));
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
  if (notes.length > 0) {
    const footer = vstack(2);
    footer.name = 'Notes';
    for (const n of notes) footer.appendChild(makeText(n, 'Regular', 10, palette.muted));
    body.appendChild(footer);
  }

  const section = figma.createSection();
  section.name = `Foundations: ${title}`;
  section.appendChild(card);
  card.x = 40;
  card.y = 40;
  section.resizeWithoutConstraints(card.width + 80, card.height + 80);
  return section;
}
