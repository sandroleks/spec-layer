/// <reference types="@figma/plugin-typings" />
/**
 * foundationFrame.ts — renders one foundation output unit as a Figma Section.
 *
 * Deliberately separate from docFrame.ts: that file owns the component
 * document and is already large. Both share frameKit.ts primitives, so a
 * foundation frame inherits the user's brand theme, fonts, and corner style
 * with no new theming code.
 *
 * valueLabel and swatchColorOf are pure and unit-tested. Node construction is
 * verified by the manual Figma pass, the same treatment docFrame.ts gets.
 */
import type {
  FoundationUnit, FoundationUnitContent, FoundationValue, FoundationVariableRow,
  FoundationTextRow,
} from '@spec-layer/extractor';
import {
  palette, solidFill, makeText, vstack, hstack, radius, headingFont, hex,
  applyThemeToKit,
} from './frameKit';
import type { resolveTheme } from './brandColors';

/** Human label for one cell. Never returns an empty string. */
export function valueLabel(value: FoundationValue): string {
  switch (value.kind) {
    case 'color': {
      const h = value.hex.toUpperCase();
      return value.alpha < 1 ? `${h} ${Math.round(value.alpha * 100)}%` : h;
    }
    case 'number':
      // Strip trailing zeros: 16 stays "16", 1.50 becomes "1.5".
      return String(Number(value.value));
    case 'string':
      return value.value;
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

const COL_NAME = 240;
const COL_DESC = 220;
const COL_MODE = 180;
const ROW_PAD = 8;

function cellText(label: string, width: number, muted = false): FrameNode {
  const row = hstack(6);
  row.resize(width, 1);
  row.primaryAxisSizingMode = 'FIXED';
  row.counterAxisAlignItems = 'CENTER';
  row.appendChild(makeText(label, 'Regular', 11, muted ? palette.muted : palette.body));
  return row;
}

function swatchCell(value: FoundationValue, width: number): FrameNode {
  const row = hstack(6);
  row.resize(width, 1);
  row.primaryAxisSizingMode = 'FIXED';
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
  return row;
}

function headerCell(label: string, width: number): FrameNode {
  const row = hstack(0);
  row.resize(width, 1);
  row.primaryAxisSizingMode = 'FIXED';
  row.appendChild(makeText(label, 'Medium', 10, palette.label));
  return row;
}

function tableRow(children: FrameNode[], withDivider: boolean): FrameNode {
  const row = hstack(12);
  row.paddingTop = ROW_PAD;
  row.paddingBottom = ROW_PAD;
  row.counterAxisAlignItems = 'CENTER';
  row.layoutSizingHorizontal = 'HUG';
  for (const c of children) row.appendChild(c);
  if (withDivider) {
    row.strokes = solidFill(palette.divider);
    row.strokeBottomWeight = 1;
    row.strokeTopWeight = 0;
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
  unitIndex: number,
  unitTotal: number,
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

  const card = vstack(0);
  card.name = unit.title;
  card.fills = solidFill(palette.bg);
  card.strokes = solidFill(palette.border);
  card.strokeWeight = 1;
  card.cornerRadius = radius(12);
  card.paddingTop = 0;
  card.paddingBottom = 20;
  card.paddingLeft = 24;
  card.paddingRight = 24;

  // --- header band ---
  const header = vstack(4);
  header.paddingTop = 20;
  header.paddingBottom = 16;
  header.appendChild(makeText('Foundations', 'Medium', 10, palette.muted));
  const title = makeText(unit.title, 'Bold', 20, palette.heading);
  title.fontName = headingFont('Bold');
  header.appendChild(title);
  const subtitle = isText
    ? `${content.rows.length} text styles`
    : `${content.rows.length} variables · ${content.modeNames.length} modes`;
  header.appendChild(makeText(subtitle, 'Regular', 11, palette.muted));
  card.appendChild(header);

  // --- table header ---
  const columns: FrameNode[] = [headerCell('Name', COL_NAME)];
  if (hasDescriptions) columns.push(headerCell('Description', COL_DESC));
  if (isText) columns.push(headerCell('Specimen', COL_MODE * 2));
  else for (const m of content.modeNames) columns.push(headerCell(m, COL_MODE));
  const head = tableRow(columns, true);
  head.fills = solidFill(palette.tableHeadBg);
  card.appendChild(head);

  // --- rows ---
  content.rows.forEach((row, i) => {
    const cells: FrameNode[] = [cellText(row.name, COL_NAME)];
    if (hasDescriptions) cells.push(cellText(row.description, COL_DESC, true));

    if (row.kind === 'variable') {
      const v = row as FoundationVariableRow;
      for (const cell of v.cells) cells.push(swatchCell(cell.value, COL_MODE));
    } else {
      const t = row as FoundationTextRow;
      const key = `${t.metrics.fontFamily}|${t.metrics.fontStyle}`;
      const failed = failedFamilies.has(key);
      const pane = vstack(2);
      pane.resize(COL_MODE * 2, 1);
      pane.primaryAxisSizingMode = 'AUTO';
      const specimen = makeText('Ag', 'Regular', Math.min(t.metrics.fontSize, 40), palette.heading);
      if (!failed) {
        specimen.fontName = { family: t.metrics.fontFamily, style: t.metrics.fontStyle };
      }
      pane.appendChild(specimen);
      const lh = t.metrics.lineHeight.unit === 'AUTO'
        ? 'auto' : `${t.metrics.lineHeight.value}${t.metrics.lineHeight.unit === 'PERCENT' ? '%' : ''}`;
      pane.appendChild(makeText(
        `${t.metrics.fontFamily} ${t.metrics.fontStyle} ${t.metrics.fontSize}/${lh}`,
        'Regular', 10, palette.muted));
      if (failed) {
        pane.appendChild(makeText('Font not available, shown in Inter.', 'Regular', 10, palette.muted));
      }
      cells.push(pane);
    }

    card.appendChild(tableRow(cells, i < content.rows.length - 1));
  });

  // --- footer notes ---
  const notes: string[] = [];
  // Read omitted modes from `content`, NOT from `unit`. Both carry the same
  // value, but only content's is covered by the drift hash, and the renderer
  // must read the same object the hash reads.
  if (content.omittedModeNames.length > 0) {
    notes.push(`Modes not shown: ${content.omittedModeNames.join(', ')}`);
  }
  if (unitTotal > 1 && content.group) {
    notes.push(`Part ${unitIndex + 1} of ${unitTotal}, covering ${content.group}.`);
  }
  if (notes.length > 0) {
    const footer = vstack(2);
    footer.paddingTop = 14;
    for (const n of notes) footer.appendChild(makeText(n, 'Regular', 10, palette.muted));
    card.appendChild(footer);
  }

  const section = figma.createSection();
  section.name = `Foundations: ${unit.title}`;
  section.appendChild(card);
  card.x = 40;
  card.y = 40;
  section.resizeWithoutConstraints(card.width + 80, card.height + 80);
  return section;
}
