/// <reference types="@figma/plugin-typings" />
/**
 * The numbered callout diagram and its legend. Each depth-0 part is outlined
 * where it draws (a fill-width text layer around its glyphs, not its layout
 * box) and its pin's leader ends on that outline, so no pin points at empty
 * space. Instances render at true size, so crowded pins fan out along the
 * callout zone with elbow leaders; a component wider than the column is scaled
 * down and the caller draws the scale note.
 */
import type { AnatomyPartBlock } from './ui/docModel';
import { palette, solidFill, vstack, hstack, makeText, radius, font, createInstanceFor, nodeById } from './frameKit';
import { tagSlot } from './docText';
import { SLOT_PART_KEY } from './canvasProse';
import { displayPartName } from './ui/displayNames';

export const PIN_SIZE = 18;
const LEGEND_BADGE = 20;
const ANATOMY_PAD = 24;
const PIN_GAP = 6;
const RAIL_GAP = 10; // from the pin's inner edge to the elbow rail
const OUTLINE_OUTSET = 2; // how far a part's outline sits outside what it draws

function clamp01(n: number): number { return n < 0 ? 0 : n > 1 ? 1 : n; }

/**
 * Pin positions along one axis. Pins already `pinSize + gap` apart stay put; a
 * crowded run is spread evenly at that step, centred on its mean, in input
 * order, so numbers still read in order and a far pin is not dragged along.
 * Pure, so testable without Figma.
 *
 * Pools adjacent violators: grouping by the original centres would spread one
 * run into the next pin (`[10, 14, 40]` to `[0, 24, 40]`). Merging a block with
 * a neighbour it would crowd and re-centring reaches a fixed point in one sweep.
 */
export function fanOutPins(centers: number[], pinSize: number, gap: number): number[] {
  const step = pinSize + gap;
  const order = centers.map((c, i) => ({ c, i })).sort((a, b) => a.c - b.c || a.i - b.i);
  // Each block covers order[start .. start+count-1] and holds the sum of its
  // members' `c - k * step`. That offset turns "at least `step` apart" into
  // "non-decreasing", so merging out-of-order neighbours is all that is left.
  const blocks: { start: number; count: number; sum: number }[] = [];
  order.forEach((o, k) => {
    blocks.push({ start: k, count: 1, sum: o.c - k * step });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      const prev = blocks[blocks.length - 2];
      if (prev.sum / prev.count <= last.sum / last.count) break;
      blocks.pop();
      prev.count += last.count;
      prev.sum += last.sum;
    }
  });
  const placed = new Array<number>(order.length);
  for (const b of blocks) {
    const base = b.sum / b.count;
    for (let k = b.start; k < b.start + b.count; k += 1) {
      // A lone pin keeps its measured centre exactly; only a spread run rounds.
      placed[k] = b.count === 1 ? order[k].c : Math.round(base + k * step);
    }
  }
  const out = new Array<number>(centers.length);
  order.forEach((o, k) => { out[o.i] = placed[k]; });
  return out;
}

/** `Shown at 60% of actual size` under a shrunk diagram; null at true size.
 *  Floored, not rounded: 0.996 is not true size, so it must not read 100%. */
export function scaleNote(scale: number): TextNode | null {
  if (scale >= 1) return null;
  return makeText(`Shown at ${Math.floor(scale * 100)}% of actual size`, 'Regular', 12, palette.muted, 145);
}

function numberBadge(n: string, size: number): FrameNode {
  const badge = figma.createFrame();
  badge.layoutMode = 'HORIZONTAL';
  badge.primaryAxisSizingMode = 'FIXED';
  badge.counterAxisSizingMode = 'FIXED';
  badge.primaryAxisAlignItems = 'CENTER';
  badge.counterAxisAlignItems = 'CENTER';
  badge.resize(size, size);
  badge.paddingLeft = badge.paddingRight = 4;
  badge.primaryAxisSizingMode = 'AUTO';
  badge.minWidth = size;
  badge.cornerRadius = size / 2;
  badge.fills = solidFill(palette.accent);
  badge.appendChild(makeText(n, 'Bold', size <= 18 ? 10 : 11, palette.onHeader));
  return badge;
}

function anatomyPin(n: string): FrameNode {
  const pin = numberBadge(n, PIN_SIZE);
  pin.strokes = solidFill(palette.bg);
  pin.strokeWeight = 2;
  pin.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.28 }, offset: { x: 0, y: 1 }, radius: 4, spread: 0, visible: true, blendMode: 'NORMAL' }];
  return pin;
}

/**
 * Legend row: badge, then "Display name: role" or the display name alone, plus
 * the nested and "Shown when" notes. The tag keeps the raw name so read-back
 * and the prompt still match on it.
 */
function anatomyLegendRow(part: AnatomyPartBlock): FrameNode {
  const row = hstack(12);
  tagSlot(row, 'anatomyPart');
  row.setPluginData(SLOT_PART_KEY, part.name);
  row.counterAxisAlignItems = 'MIN';
  row.paddingTop = row.paddingBottom = 12;
  row.paddingLeft = part.depth * 18;
  row.appendChild(numberBadge(part.label, LEGEND_BADGE));
  const shown = displayPartName(part.name);
  const role = part.role?.trim();
  const nestedNote = part.nested ? `  ·  ${part.component ?? 'Unknown component'}` : '';
  const shownNote = part.shownBy ? `  ·  Shown when ${part.shownBy} is true` : '';
  const chars = role ? `${shown}: ${role}${shownNote}` : `${shown}${nestedNote}${shownNote}`;
  const text = makeText(chars, 'Regular', 15, palette.body, 150);
  row.appendChild(text);
  text.layoutSizingHorizontal = 'FILL';
  text.textAutoResize = 'HEIGHT';
  text.setRangeFontName(0, shown.length, font('Bold'));
  return row;
}

export function buildAnatomyLegend(parts: AnatomyPartBlock[]): FrameNode {
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
 * The diagram card: a live instance at true size, part outlines, pins on the
 * side the parts are least spread along, elbow leaders, then the legend. Null
 * when the component cannot be instanced. `scale` is 1 unless the instance was
 * wider than `contentWidth` minus the card padding.
 */
export async function buildAnatomyDiagram(
  componentId: string, parts: AnatomyPartBlock[], includeHidden: boolean, contentWidth: number,
): Promise<{ card: FrameNode; scale: number } | null> {
  const inst = await createInstanceFor(componentId, includeHidden);
  if (!inst) return null;
  const ib = inst.absoluteBoundingBox;
  if (!ib || ib.width <= 0 || ib.height <= 0) { try { inst.remove(); } catch { /* gone */ } return null; }

  // Each part as the box it draws, normalized to the instance: a fill-width
  // text layer's layout box spans its container, so its centre can point at
  // nothing, while render bounds are the glyphs. The layout box is the fallback
  // when render bounds are null or missing.
  const pins: { n: string; x0: number; y0: number; x1: number; y1: number }[] = [];
  const topParts = parts.filter((part) => part.depth === 0);
  // One batch: each lookup is a round trip, and none depends on another.
  const partNodes = await Promise.all(topParts.map((part) => nodeById(`I${inst.id};${part.id}`)));
  for (const [i, part] of topParts.entries()) {
    const p = partNodes[i];
    if (!p || !('absoluteBoundingBox' in p)) continue;
    const layout = (p as SceneNode).absoluteBoundingBox;
    if (!layout) continue;
    // Typed as optional: the typings declare it on the drawable mixins, not
    // on every SceneNode, and a host without it takes the layout box.
    const drawn = (p as SceneNode & { absoluteRenderBounds?: Rect | null }).absoluteRenderBounds ?? layout;
    pins.push({
      n: part.label,
      x0: clamp01((drawn.x - ib.x) / ib.width),
      y0: clamp01((drawn.y - ib.y) / ib.height),
      x1: clamp01((drawn.x + drawn.width - ib.x) / ib.width),
      y1: clamp01((drawn.y + drawn.height - ib.y) / ib.height),
    });
  }
  const cx = (p: { x0: number; x1: number }): number => (p.x0 + p.x1) / 2;
  const cy = (p: { y0: number; y1: number }): number => (p.y0 + p.y1) / 2;

  // The callout side depends only on the normalized spread, so it is settled
  // before scaling: a side zone widens the box out of the same column budget.
  const xs = pins.map(cx);
  const ys = pins.map(cy);
  const xRange = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const yRange = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const sideCallouts = yRange > xRange;
  const ZONE = pins.length ? PIN_SIZE + RAIL_GAP + 24 : 0;

  // True size unless wider than the column; height is never capped, so only a
  // side zone's ZONE comes off the instance's budget.
  const maxW = Math.max(1, contentWidth - ANATOMY_PAD * 2 - (sideCallouts ? ZONE : 0));
  const scale = Math.min(1, maxW / inst.width);
  if (scale < 1) inst.rescale(scale);
  const renderedW = inst.width;
  const renderedH = inst.height;

  const card = vstack(20);
  card.paddingTop = card.paddingBottom = card.paddingLeft = card.paddingRight = ANATOMY_PAD;
  card.fills = solidFill(palette.paneBg);
  card.cornerRadius = radius(8);
  card.strokes = solidFill(palette.border);
  card.strokeWeight = 1;
  card.counterAxisAlignItems = 'CENTER';
  // Width fixed to the column, height hugs: a hugging width would shrink to a
  // tiny diagram and leave the legend nothing real to FILL against.
  card.resize(contentWidth, 1);
  card.primaryAxisSizingMode = 'AUTO';

  // Natural pin centres along the callout axis, then fanned so none overlap.
  const natural = pins.map((p) => Math.round(sideCallouts ? cy(p) * renderedH : cx(p) * renderedW));
  let fanned = fanOutPins(natural, PIN_SIZE, PIN_GAP);
  if (!sideCallouts) {
    // A crowded top row can fan past the instance's edges and widen the box
    // past the column; clamp back inside, so pins touch only when more exist
    // than fit across the column.
    const spanMin = Math.min(0, ...fanned.map((c) => c - PIN_SIZE / 2));
    const spanMax = Math.max(renderedW, ...fanned.map((c) => c + PIN_SIZE / 2));
    if (spanMax - spanMin > maxW) {
      const lo = PIN_SIZE / 2;
      const hi = Math.max(lo, renderedW - PIN_SIZE / 2);
      fanned = fanned.map((c) => Math.min(Math.max(c, lo), hi));
    }
  }
  const minPos = Math.min(0, ...fanned.map((c) => c - PIN_SIZE / 2));
  const maxPos = Math.max(sideCallouts ? renderedH : renderedW, ...fanned.map((c) => c + PIN_SIZE / 2));
  const shift = -minPos; // fanned pins may overhang the instance's start edge

  const box = figma.createFrame();
  box.name = 'Anatomy diagram';
  box.fills = [];
  box.clipsContent = false;
  card.appendChild(box);
  box.appendChild(inst);
  if (sideCallouts) {
    box.resize(renderedW + ZONE, maxPos - minPos);
    inst.x = 0; inst.y = shift;
  } else {
    box.resize(maxPos - minPos, renderedH + ZONE);
    inst.x = shift; inst.y = ZONE;
  }

  const leaderPaint = [{ type: 'SOLID', color: palette.accent, opacity: 0.45 }] as Paint[];
  const outlinePaint = [{ type: 'SOLID', color: palette.accent, opacity: 0.6 }] as Paint[];
  const seg = (x: number, y: number, w: number, h: number): void => {
    const f = figma.createFrame();
    f.resize(Math.max(w, 1), Math.max(h, 1));
    f.x = Math.round(x); f.y = Math.round(y);
    f.fills = leaderPaint;
    box.appendChild(f);
  };
  // A part's drawn box in rendered pixels, relative to the instance.
  const edges = (pin: { x0: number; y0: number; x1: number; y1: number }) => ({
    left: Math.round(pin.x0 * renderedW), top: Math.round(pin.y0 * renderedH),
    right: Math.round(pin.x1 * renderedW), bottom: Math.round(pin.y1 * renderedH),
  });

  // Outlines first, under leaders and pins, a little outside what each part
  // draws; the outline is what a pin points at, so no anchor dot is needed.
  for (const pin of pins) {
    const e = edges(pin);
    const outline = figma.createFrame();
    outline.name = 'Part outline';
    outline.fills = [];
    outline.strokes = outlinePaint;
    outline.strokeWeight = 1;
    outline.cornerRadius = radius(3);
    outline.resize(Math.max(e.right - e.left, 0) + OUTLINE_OUTSET * 2, Math.max(e.bottom - e.top, 0) + OUTLINE_OUTSET * 2);
    outline.x = inst.x + e.left - OUTLINE_OUTSET;
    outline.y = inst.y + e.top - OUTLINE_OUTSET;
    box.appendChild(outline);
  }

  pins.forEach((pin, i) => {
    const node = anatomyPin(pin.n);
    const e = edges(pin);
    if (sideCallouts) {
      const anchorY = Math.round(cy(pin) * renderedH) + shift;
      const anchorX = e.right + OUTLINE_OUTSET; // the outline's right edge
      const railX = renderedW + RAIL_GAP;
      const pinX = renderedW + ZONE - PIN_SIZE;
      const pinY = fanned[i] + shift;
      seg(anchorX, anchorY, railX - anchorX, 1);          // out from the outline
      if (pinY !== anchorY) seg(railX, Math.min(anchorY, pinY), 1, Math.abs(pinY - anchorY)); // along the rail
      seg(railX, pinY, pinX - railX, 1);                   // in to the pin
      box.appendChild(node);
      node.x = pinX; node.y = Math.round(pinY - PIN_SIZE / 2);
    } else {
      const anchorX = Math.round(cx(pin) * renderedW) + shift;
      const anchorY = ZONE + e.top - OUTLINE_OUTSET; // the outline's top edge
      const railY = ZONE - RAIL_GAP;
      const pinX = fanned[i] + shift;
      seg(anchorX, railY, 1, anchorY - railY);
      if (pinX !== anchorX) seg(Math.min(anchorX, pinX), railY, Math.abs(pinX - anchorX), 1);
      seg(pinX, PIN_SIZE, 1, railY - PIN_SIZE);
      box.appendChild(node);
      node.x = Math.round(pinX - PIN_SIZE / 2); node.y = 0;
    }
  });

  const legend = buildAnatomyLegend(parts);
  card.appendChild(legend);
  legend.layoutSizingHorizontal = 'FILL';
  return { card, scale };
}
