/// <reference types="@figma/plugin-typings" />
/**
 * docBlocks.ts: the blocks Docs 2.0 added to the component document.
 *
 * Every block that carries editorial text tags it (see canvasProse.ts for the
 * slot and key contract). Deterministic text is left untagged so selfHash
 * covers it and an Update rebuilds it.
 */
import type { ColumnBlock, KeyboardRow, PropertyRow } from './ui/docModel';
import type { GuidelinePair, GuidelineCard } from '@spec-layer/extractor';
import { parseRuns } from './ui/docModel';
import { palette, solidFill, vstack, hstack, makeText, radius, headingFont } from './frameKit';
import { tagSlot, makeBulletRow, makeCell, applyColWidth, applyRuns } from './docText';
import { SLOT_PART_KEY } from './canvasProse';

const KEY_JOINER = ' + ';

/** A paragraph spanning the content column, like the tables around it. */
export function columnParagraph(text: string, contentWidth: number, size = 15): FrameNode {
  const box = vstack(0);
  box.resize(contentWidth, 1);
  box.primaryAxisSizingMode = 'AUTO';
  const runs = parseRuns(text);
  const node = makeText(runs.map((r) => r.text).join(''), 'Regular', size, palette.body, 155);
  box.appendChild(node);
  node.layoutSizingHorizontal = 'FILL';
  node.textAutoResize = 'HEIGHT';
  applyRuns(node, runs, 0);
  return box;
}

/** A standalone chip: light fill, medium weight. For keys, tokens, references. */
export function chip(text: string, tone: 'default' | 'muted' = 'default'): FrameNode {
  const c = hstack(0);
  c.paddingTop = c.paddingBottom = 3;
  c.paddingLeft = c.paddingRight = 8;
  c.cornerRadius = radius(6);
  c.fills = solidFill(palette.chipBg);
  const t = makeText(text, 'Medium', 13, tone === 'muted' ? palette.muted : palette.heading, 140);
  t.textAutoResize = 'WIDTH_AND_HEIGHT';
  c.appendChild(t);
  return c;
}

function columnHeading(text: string): TextNode {
  const h = makeText(text, 'Bold', 17, palette.heading, 130);
  h.fontName = headingFont('Bold');
  return h;
}

/** Two equal columns, each a subheading over a tagged bullet list. */
export function buildTwoColumns(left: ColumnBlock, right: ColumnBlock, contentWidth: number): FrameNode {
  const row = hstack(32);
  row.counterAxisAlignItems = 'MIN';
  row.resize(contentWidth, 1);
  row.counterAxisSizingMode = 'AUTO';
  for (const col of [left, right]) {
    const column = vstack(12);
    row.appendChild(column);
    column.layoutSizingHorizontal = 'FILL';
    column.appendChild(columnHeading(col.heading));
    const list = vstack(10);
    tagSlot(list, col.slot);
    column.appendChild(list);
    list.layoutSizingHorizontal = 'FILL';
    for (const b of col.items) {
      const bullet = makeBulletRow(b);
      list.appendChild(bullet);
      bullet.layoutSizingHorizontal = 'FILL';
    }
  }
  return row;
}

/** A Do card sits on a faint green tint with a green border and label; a
 *  Don't card the same in red. The tints say which half is which before the
 *  label is read, and stay legible because the rule and reason keep the
 *  document's own heading and body inks. */
function guidelineCard(card: GuidelineCard | null, kind: 'do' | 'dont'): FrameNode {
  const box = vstack(8);
  box.paddingTop = box.paddingBottom = box.paddingLeft = box.paddingRight = 16;
  box.cornerRadius = radius(8);
  box.strokeWeight = 1;
  if (!card) { box.fills = []; box.strokes = []; return box; } // an empty half keeps the grid
  box.fills = solidFill(kind === 'do' ? palette.doTint : palette.dontTint);
  box.strokes = solidFill(kind === 'do' ? palette.doBorder : palette.dontBorder);
  tagSlot(box, kind === 'do' ? 'guidelineDo' : 'guidelineDont');
  const label = makeText(kind === 'do' ? 'DO' : "DON'T", 'Medium', 11, kind === 'do' ? palette.doInk : palette.dontInk, 130, 6);
  box.appendChild(label);
  const ruleRuns = parseRuns(card.rule);
  const rule = makeText(ruleRuns.map((r) => r.text).join(''), 'Bold', 15, palette.heading, 145);
  box.appendChild(rule);
  rule.layoutSizingHorizontal = 'FILL';
  rule.textAutoResize = 'HEIGHT';
  const reasonRuns = parseRuns(card.reason);
  const reason = makeText(reasonRuns.map((r) => r.text).join(''), 'Regular', 14, palette.body, 150);
  box.appendChild(reason);
  reason.layoutSizingHorizontal = 'FILL';
  reason.textAutoResize = 'HEIGHT';
  applyRuns(reason, reasonRuns, 0);
  return box;
}

/** Paired Do and Don't cards, one pair per row. The pair row carries its
 *  index. The row hugs the taller card and both cards fill its height, so a
 *  pair always reads as two equal blocks however long each reason runs. */
export function buildGuidelinePairs(pairs: GuidelinePair[], contentWidth: number): FrameNode {
  const grid = vstack(16);
  grid.resize(contentWidth, 1);
  grid.primaryAxisSizingMode = 'AUTO';
  pairs.forEach((pair, i) => {
    const row = hstack(16);
    tagSlot(row, 'guidelinePair');
    row.setPluginData(SLOT_PART_KEY, String(i));
    row.counterAxisAlignItems = 'MIN';
    grid.appendChild(row);
    row.layoutSizingHorizontal = 'FILL';
    for (const [card, kind] of [[pair.do, 'do'], [pair.dont, 'dont']] as const) {
      const c = guidelineCard(card, kind);
      row.appendChild(c);
      c.layoutSizingHorizontal = 'FILL';
      c.layoutSizingVertical = 'FILL';
    }
  });
  return grid;
}

function tableShell(): FrameNode {
  const table = vstack(0);
  table.cornerRadius = radius(8);
  table.clipsContent = true;
  table.strokes = solidFill(palette.border);
  table.strokeWeight = 1;
  return table;
}

function headerRow(labels: string[], widths: (number | 'grow')[]): FrameNode {
  const head = hstack(0);
  head.fills = solidFill(palette.tableHeadBg);
  head.counterAxisAlignItems = 'MIN';
  labels.forEach((label, i) => {
    const cell = makeCell(label.toUpperCase(), 'Medium', 11, palette.muted);
    head.appendChild(cell);
    applyColWidth(cell, widths[i]);
  });
  return head;
}

function dataRow(): FrameNode {
  const row = hstack(0);
  row.counterAxisAlignItems = 'MIN';
  row.strokes = solidFill(palette.divider);
  row.strokeTopWeight = 1;
  row.strokeBottomWeight = 0;
  row.strokeLeftWeight = 0;
  row.strokeRightWeight = 0;
  return row;
}

/** A cell holding chips in a wrapping row. */
function chipCell(chips: FrameNode[]): FrameNode {
  const cell = hstack(6);
  cell.paddingTop = cell.paddingBottom = 10;
  cell.paddingLeft = cell.paddingRight = 16;
  cell.layoutWrap = 'WRAP';
  cell.counterAxisSpacing = 6;
  for (const c of chips) cell.appendChild(c);
  return cell;
}

/** Key and Action. The row's key is the canonical keys joined by " + ". */
export function buildKeyboardTable(rows: KeyboardRow[], contentWidth: number): FrameNode {
  const widths: (number | 'grow')[] = [Math.floor(contentWidth * 0.3), 'grow'];
  const table = tableShell();
  const head = headerRow(['Key', 'Action'], widths);
  table.appendChild(head);
  head.layoutSizingHorizontal = 'FILL';
  for (const r of rows) {
    const row = dataRow();
    tagSlot(row, 'keyboardRow');
    row.setPluginData(SLOT_PART_KEY, r.keys.join(KEY_JOINER));
    table.appendChild(row);
    row.layoutSizingHorizontal = 'FILL';
    const keys = chipCell(r.keys.map((k) => chip(k)));
    row.appendChild(keys);
    applyColWidth(keys, widths[0]);
    const action = makeCell(r.action, 'Regular', 14, palette.body);
    row.appendChild(action);
    applyColWidth(action, 'grow');
  }
  return table;
}

/** Property, Type, Values, Default, and Description when any row has one.
 *  Only the description cell is editorial; it carries the property name. */
export function buildPropertiesTable(rows: PropertyRow[], hasDescriptions: boolean, contentWidth: number): FrameNode {
  const labels = hasDescriptions ? ['Property', 'Type', 'Values', 'Default', 'Description'] : ['Property', 'Type', 'Values', 'Default'];
  // Shares of the column for the fixed cells; the last column grows. Values
  // takes the widest fixed share: when four fixed columns split 55% evenly,
  // Values had 105px and an option such as "Color Background" broke mid-word.
  const shares = hasDescriptions ? [0.16, 0.12, 0.22, 0.13] : [0.22, 0.16, 0.32];
  const widths: (number | 'grow')[] = [...shares.map((share) => Math.floor(contentWidth * share)), 'grow'];
  const table = tableShell();
  const head = headerRow(labels, widths);
  table.appendChild(head);
  head.layoutSizingHorizontal = 'FILL';
  for (const r of rows) {
    const row = dataRow();
    table.appendChild(row);
    row.layoutSizingHorizontal = 'FILL';
    const cells = [
      makeCell(r.name, 'Medium', 14, palette.heading),
      makeCell(r.type, 'Regular', 14, palette.body),
      makeCell(r.values, 'Regular', 14, palette.body),
      makeCell(r.defaultValue, 'Regular', 14, palette.body),
    ];
    if (hasDescriptions) {
      const desc = makeCell(r.description ?? '', 'Regular', 14, palette.body);
      tagSlot(desc, 'propertyDescription');
      desc.setPluginData(SLOT_PART_KEY, r.name);
      cells.push(desc);
    }
    cells.forEach((cell, i) => { row.appendChild(cell); applyColWidth(cell, widths[i]); });
  }
  return table;
}
