/// <reference types="@figma/plugin-typings" />
import { palette, solidFill, vstack, hstack, makeText, createInstanceFor, slotAround, SLOT_PAD, radius } from './frameKit';

const LABEL_W = 120;
const CELL_MAX_W = 180;
const MIN_CELL_W = 160; // below this the live instance previews become illegible
const GRID_GAP = 12;
const HEADER_H = 30; // fits a two-line column header (e.g. "Active (filled)")
const BAND_GAP = 28; // vertical space between wrapped column bands

export interface MatrixBlockData {
  axisName?: string;
  columns: string[];
  rows: { label: string; cells: (string | null)[] }[];
  note?: string | null;
}

export type MatrixLayout =
  | { kind: 'grid'; colsPerBand: number; cellW: number }
  | { kind: 'stacked' };

/**
 * Cell layout for the widest instance; pure, so it stays unit-testable.
 * Instances are never scaled: a cell fits the widest one plus slot padding,
 * as many as fit share each band (small components keep the CELL_MAX_W cap),
 * and when none fits beside the label the matrix stacks one value per band.
 */
export function matrixLayout(columnCount: number, contentWidth: number, widestInstance: number): MatrixLayout {
  const usable = contentWidth - LABEL_W;
  const needed = Math.max(MIN_CELL_W, Math.ceil(widestInstance) + SLOT_PAD * 2);
  const colsPerBand = Math.min(Math.max(columnCount, 1), Math.floor(usable / (needed + GRID_GAP)));
  if (colsPerBand < 1) return { kind: 'stacked' };
  const share = Math.floor((usable - GRID_GAP * colsPerBand) / colsPerBand);
  const cellW = needed > CELL_MAX_W ? share : Math.min(CELL_MAX_W, share);
  return { kind: 'grid', colsPerBand, cellW };
}

/** A word, never a dash: an empty cell says why it is empty. */
function emptyCell(width: number): FrameNode {
  const empty = vstack(0);
  empty.resize(width, 40);
  empty.fills = solidFill(palette.paneBg);
  empty.cornerRadius = radius(8);
  const label = makeText('No variant', 'Regular', 12, palette.muted);
  empty.appendChild(label);
  empty.primaryAxisAlignItems = 'CENTER';
  empty.counterAxisAlignItems = 'CENTER';
  return empty;
}

/**
 * The live-instance matrix behind States and Variants. Instances are created
 * first so the layout fits them (matrixLayout). A failed cell falls back to
 * the slot's placeholder; the model hides empty sections.
 */
export async function buildMatrixSection(
  block: MatrixBlockData,
  contentWidth: number,
  includeHidden = false,
): Promise<FrameNode> {
  const wrap = vstack(BAND_GAP);

  const created: (InstanceNode | null)[][] = [];
  let widest = 0;
  for (const row of block.rows) {
    const cells: (InstanceNode | null)[] = [];
    for (const nodeId of row.cells) {
      const inst = nodeId ? await createInstanceFor(nodeId, includeHidden) : null;
      if (inst) widest = Math.max(widest, inst.width);
      cells.push(inst);
    }
    created.push(cells);
  }
  const cellFor = (ri: number, ci: number, width: number): FrameNode =>
    (block.rows[ri].cells[ci] ? slotAround(created[ri][ci], width) : emptyCell(width));

  const layout = matrixLayout(block.columns.length, contentWidth, widest);
  if (layout.kind === 'stacked') buildStacked(wrap, block, contentWidth, cellFor);
  else buildGrid(wrap, block, layout, cellFor);

  if (block.note) {
    const note = makeText(block.note, 'Regular', 12, palette.muted, 145);
    wrap.appendChild(note);
    note.layoutSizingHorizontal = 'FILL';
  }

  return wrap;
}

type CellFor = (rowIndex: number, columnIndex: number, width: number) => FrameNode;

/** Bands of `colsPerBand` columns; each band repeats the row labels and its
 *  own column headers. */
function buildGrid(
  wrap: FrameNode, block: MatrixBlockData, layout: { colsPerBand: number; cellW: number }, cellFor: CellFor,
): void {
  const { colsPerBand, cellW } = layout;
  const bandCount = Math.ceil(block.columns.length / colsPerBand);
  for (let b = 0; b < bandCount; b++) {
    const start = b * colsPerBand;
    const end = Math.min(start + colsPerBand, block.columns.length);

    const band = vstack(20);
    wrap.appendChild(band);
    band.layoutSizingHorizontal = 'HUG';

    // The corner names the axis only when no row labels do.
    const head = hstack(GRID_GAP);
    band.appendChild(head);
    head.counterAxisAlignItems = 'MAX'; // baseline-align headers to the cells below
    const corner = makeText(block.rows.length > 1 ? '' : (block.axisName ?? '').toUpperCase(), 'Medium', 10, palette.muted);
    corner.textAutoResize = 'NONE';
    corner.resize(LABEL_W, HEADER_H);
    corner.textAlignVertical = 'BOTTOM';
    head.appendChild(corner);
    for (const column of block.columns.slice(start, end)) {
      // As typed: a designer's axis value is never re-cased.
      const h = makeText(column, 'Medium', 10, palette.muted, 130, 6);
      h.textAutoResize = 'NONE';
      h.resize(cellW, HEADER_H);
      h.textAlignHorizontal = 'CENTER';
      h.textAlignVertical = 'BOTTOM';
      head.appendChild(h);
    }

    block.rows.forEach((row, ri) => {
      const r = hstack(GRID_GAP);
      r.counterAxisAlignItems = 'CENTER';
      band.appendChild(r);
      const label = makeText(row.label, 'Medium', 13, palette.heading, 140);
      label.textAutoResize = 'NONE';
      label.resize(LABEL_W, 20);
      r.appendChild(label);
      for (let ci = start; ci < end; ci++) r.appendChild(cellFor(ri, ci, cellW));
    });
  }
}

/** One band per axis value, each row's slot spanning the column, for a
 *  component too wide for a grid cell. */
function buildStacked(wrap: FrameNode, block: MatrixBlockData, contentWidth: number, cellFor: CellFor): void {
  wrap.resize(contentWidth, 1);
  wrap.primaryAxisSizingMode = 'AUTO';
  block.columns.forEach((column, ci) => {
    const band = vstack(12);
    wrap.appendChild(band);
    band.layoutSizingHorizontal = 'FILL';
    if (ci === 0 && block.rows.length <= 1 && block.axisName) {
      band.appendChild(makeText(block.axisName.toUpperCase(), 'Medium', 10, palette.muted));
    }
    band.appendChild(makeText(column, 'Medium', 11, palette.muted, 130, 6)); // as typed
    block.rows.forEach((row, ri) => {
      const item = vstack(6);
      band.appendChild(item);
      item.layoutSizingHorizontal = 'FILL';
      if (block.rows.length > 1) item.appendChild(makeText(row.label, 'Medium', 13, palette.heading, 140));
      const cell = cellFor(ri, ci, contentWidth);
      item.appendChild(cell);
      cell.layoutSizingHorizontal = 'FILL';
    });
  });
}
