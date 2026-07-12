/// <reference types="@figma/plugin-typings" />
import { palette, solidFill, vstack, hstack, makeText, buildSlot } from './frameKit';

const LABEL_W = 120;
const CELL_MAX_W = 180;
const MIN_CELL_W = 160; // below this the live instance previews become illegible
const GRID_GAP = 12;
const HEADER_H = 30; // fits a two-line column header (e.g. "ACTIVE (FILLED)")
const BAND_GAP = 28; // vertical space between wrapped column bands

export interface MatrixBlockData {
  axisName?: string;
  columns: string[];
  rows: { label: string; cells: (string | null)[] }[];
  note?: string | null;
}

/**
 * How many columns fit per band, and how wide each cell is, for a given column
 * count and content width. Columns that don't fit wrap onto a new band below
 * rather than shrinking every cell — so a 9-state matrix keeps legible previews
 * instead of crushing them into a single overflowing row. Pure (no Figma API)
 * so the sizing math stays unit-testable.
 */
export function matrixBandLayout(columnCount: number, contentWidth: number): { colsPerBand: number; cellW: number } {
  const usable = contentWidth - LABEL_W;
  const colsPerBand = Math.min(
    Math.max(columnCount, 1),
    Math.max(1, Math.floor(usable / (MIN_CELL_W + GRID_GAP))),
  );
  const cellW = Math.min(CELL_MAX_W, Math.floor((usable - GRID_GAP * colsPerBand) / colsPerBand));
  return { colsPerBand, cellW };
}

/**
 * The shared preview matrix grid: a grid of live instances keyed by row label ×
 * column. Used by both the States and Variants sections. When there are more
 * columns than fit the content width, they wrap into stacked bands (each band
 * repeats the row labels and its own column headers). Per-cell failures fall
 * back to buildSlot's own placeholder; callers auto-hide the section at the
 * model level when there is nothing to show, so the block is assumed well-formed.
 */
export async function buildMatrixSection(block: MatrixBlockData, contentWidth: number): Promise<FrameNode> {
  const wrap = vstack(BAND_GAP);

  const { colsPerBand, cellW } = matrixBandLayout(block.columns.length, contentWidth);
  const bandCount = Math.ceil(block.columns.length / colsPerBand);

  for (let b = 0; b < bandCount; b++) {
    const start = b * colsPerBand;
    const end = Math.min(start + colsPerBand, block.columns.length);
    const bandColumns = block.columns.slice(start, end);

    const band = vstack(20);
    wrap.appendChild(band);
    band.layoutSizingHorizontal = 'HUG';

    // Header row: corner spacer + column names. The corner carries the axis name
    // only for single-row matrices (where there are no row labels to carry it).
    const head = hstack(GRID_GAP);
    band.appendChild(head);
    head.counterAxisAlignItems = 'MAX'; // baseline-align headers to the cells below
    const corner = makeText(block.rows.length > 1 ? '' : (block.axisName ?? '').toUpperCase(), 'Medium', 10, palette.muted);
    corner.textAutoResize = 'NONE';
    corner.resize(LABEL_W, HEADER_H);
    corner.textAlignVertical = 'BOTTOM';
    head.appendChild(corner);
    for (const column of bandColumns) {
      const h = makeText(column.toUpperCase(), 'Medium', 10, palette.muted, 130, 6);
      h.textAutoResize = 'NONE';
      h.resize(cellW, HEADER_H);
      h.textAlignHorizontal = 'CENTER';
      h.textAlignVertical = 'BOTTOM';
      head.appendChild(h);
    }

    // Grid rows: label + one slot per column in this band.
    for (const row of block.rows) {
      const r = hstack(GRID_GAP);
      r.counterAxisAlignItems = 'CENTER';
      band.appendChild(r);
      const label = makeText(row.label, 'Medium', 13, palette.heading, 140);
      label.textAutoResize = 'NONE';
      label.resize(LABEL_W, 20);
      r.appendChild(label);
      for (const nodeId of row.cells.slice(start, end)) {
        if (nodeId) {
          const slot = await buildSlot(nodeId, cellW, 96);
          r.appendChild(slot);
        } else {
          const empty = vstack(0);
          empty.resize(cellW, 40);
          empty.fills = solidFill(palette.paneBg);
          empty.cornerRadius = 8;
          const dash = makeText('—', 'Regular', 12, palette.muted);
          empty.appendChild(dash);
          empty.primaryAxisAlignItems = 'CENTER';
          empty.counterAxisAlignItems = 'CENTER';
          r.appendChild(empty);
        }
      }
    }
  }

  if (block.note) {
    const note = makeText(block.note, 'Regular', 12, palette.muted, 145);
    wrap.appendChild(note);
    note.layoutSizingHorizontal = 'FILL';
  }

  return wrap;
}
