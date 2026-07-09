/// <reference types="@figma/plugin-typings" />
import { palette, solidFill, vstack, hstack, makeText, buildSlot } from './frameKit';

const LABEL_W = 120;
const CELL_MAX_W = 180;
const GRID_GAP = 12;

export interface MatrixBlockData {
  axisName?: string;
  columns: string[];
  rows: { label: string; cells: (string | null)[] }[];
  note?: string | null;
}

/**
 * The shared preview matrix grid: a grid of live instances keyed by row label ×
 * column. Used by both the States and Variants sections. Per-cell failures fall
 * back to buildSlot's own placeholder; callers auto-hide the section at the
 * model level when there is nothing to show, so the block is assumed well-formed.
 */
export async function buildMatrixSection(block: MatrixBlockData, contentWidth: number): Promise<FrameNode> {
  const wrap = vstack(20);

  const cellW = Math.min(
    CELL_MAX_W,
    Math.floor((contentWidth - LABEL_W - GRID_GAP * block.columns.length) / Math.max(block.columns.length, 1)),
  );

  // Header row: corner spacer + column names.
  const head = hstack(GRID_GAP);
  wrap.appendChild(head);
  const corner = makeText(block.rows.length > 1 ? '' : (block.axisName ?? '').toUpperCase(), 'Medium', 10, palette.muted);
  corner.textAutoResize = 'NONE';
  corner.resize(LABEL_W, 16);
  head.appendChild(corner);
  for (const column of block.columns) {
    const h = makeText(column.toUpperCase(), 'Medium', 10, palette.muted, 130, 6);
    h.textAutoResize = 'NONE';
    h.resize(cellW, 16);
    h.textAlignHorizontal = 'CENTER';
    head.appendChild(h);
  }

  // Grid rows: label + one slot per column.
  for (const row of block.rows) {
    const r = hstack(GRID_GAP);
    r.counterAxisAlignItems = 'CENTER';
    wrap.appendChild(r);
    const label = makeText(row.label, 'Medium', 13, palette.heading, 140);
    label.textAutoResize = 'NONE';
    label.resize(LABEL_W, 20);
    r.appendChild(label);
    for (const nodeId of row.cells) {
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

  if (block.note) {
    const note = makeText(block.note, 'Regular', 12, palette.muted, 145);
    wrap.appendChild(note);
    note.layoutSizingHorizontal = 'FILL';
  }

  return wrap;
}
