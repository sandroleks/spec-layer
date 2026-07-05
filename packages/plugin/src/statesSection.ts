/// <reference types="@figma/plugin-typings" />
import { palette, solidFill, vstack, hstack, makeText, buildSlot } from './frameKit';

const LABEL_W = 120;
const CELL_MAX_W = 180;
const GRID_GAP = 12;

interface StatesBlockData {
  axisName: string;
  states: string[];
  rows: { label: string; cells: (string | null)[] }[];
  capped: boolean;
  deltas: { state: string; lines: string }[];
}

/**
 * The States matrix: a grid of live instances keyed by rowAxis × state, plus a
 * list of token deltas describing what defines each non-default state. Per-cell
 * failures fall back to buildSlot's own placeholder; the section auto-hides at
 * the model level when there is no state axis, so the block is assumed well-formed.
 */
export async function buildStatesSection(block: StatesBlockData, contentWidth: number): Promise<FrameNode> {
  const wrap = vstack(20);

  const cellW = Math.min(
    CELL_MAX_W,
    Math.floor((contentWidth - LABEL_W - GRID_GAP * block.states.length) / Math.max(block.states.length, 1)),
  );

  // Header row: corner spacer + state names.
  const head = hstack(GRID_GAP);
  wrap.appendChild(head);
  const corner = makeText(block.rows.length > 1 ? '' : block.axisName.toUpperCase(), 'Medium', 10, palette.muted);
  corner.textAutoResize = 'NONE';
  corner.resize(LABEL_W, 16);
  head.appendChild(corner);
  for (const state of block.states) {
    const h = makeText(state.toUpperCase(), 'Medium', 10, palette.muted, 130, 6);
    h.textAutoResize = 'NONE';
    h.resize(cellW, 16);
    h.textAlignHorizontal = 'CENTER';
    head.appendChild(h);
  }

  // Grid rows: label + one slot per state.
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

  if (block.capped) {
    const note = makeText('Showing the first 4 values — other rows share the same state behavior.', 'Regular', 12, palette.muted, 145);
    wrap.appendChild(note);
    note.layoutSizingHorizontal = 'FILL';
  }

  // Token-delta lines: the differentiator — what defines each state.
  if (block.deltas.length) {
    const list = vstack(8);
    wrap.appendChild(list);
    list.layoutSizingHorizontal = 'FILL';
    for (const d of block.deltas) {
      const line = hstack(8);
      line.counterAxisAlignItems = 'MIN';
      list.appendChild(line);
      line.layoutSizingHorizontal = 'FILL';
      const name = makeText(d.state, 'Bold', 13, palette.heading, 145);
      name.textAutoResize = 'WIDTH_AND_HEIGHT';
      line.appendChild(name);
      const changes = makeText(d.lines, 'Regular', 13, palette.body, 145);
      line.appendChild(changes);
      changes.layoutSizingHorizontal = 'FILL';
      changes.textAutoResize = 'HEIGHT';
    }
  }

  return wrap;
}
