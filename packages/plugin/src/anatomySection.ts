/// <reference types="@figma/plugin-typings" />
/**
 * anatomySection.ts: the numbered callout diagram and its legend.
 *
 * Every depth-0 part is outlined where it draws, and its numbered pin's leader
 * ends on that outline, so a pin never points at empty space: a fill-width
 * text layer is outlined around its glyphs, not its layout box. Instances
 * render at true size. A small component therefore has parts closer together
 * than a pin is wide, so pins fan out along the callout zone and an elbow
 * leader connects each one to its outline, the way a printed spec does. A
 * component wider than the column is scaled down and the caller draws the
 * scale note the returned factor describes.
 */
import type { AnatomyPartBlock } from './ui/docModel';
import { palette, solidFill, vstack, hstack, makeText, matchVariableModes, radius, revealBooleanParts, font } from './frameKit';
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
 * Pin positions along one axis. Pins that already clear each other by
 * `pinSize + gap` stay put. A run of crowded pins is spread evenly at that
 * step, centred on the run's mean, in input order, so the numbers still read
 * left to right (or top to bottom) and a far-away pin is not dragged along.
 * Pure, so it can be tested without Figma.
 *
 * Pool adjacent violators, not a single grouping pass. A single pass grouped
 * runs by the ORIGINAL centres and so could spread one run straight into the
 * next pin: `fanOutPins([10, 14, 40], 18, 6)` returned `[0, 24, 40]`, whose
 * last two pins are 16 apart against a 24 step. Pooling merges a block with
 * its neighbour whenever the spread would crowd it and re-centres over the
 * merged block, which reaches a fixed point in one left-to-right sweep. On
 * every input the single pass got right, this returns the same answer: a
 * block of one keeps its exact centre, and a block of several is the same
 * "evenly at `step`, centred on the mean" placement.
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

/** `Shown at 60%` under a diagram that had to shrink; null at true size.
 *  Floored, not rounded: 0.996 is not true size, and "Shown at 100%" would
 *  say it was. */
export function scaleNote(scale: number): TextNode | null {
  if (scale >= 1) return null;
  return makeText(`Shown at ${Math.floor(scale * 100)}%`, 'Regular', 12, palette.muted, 145);
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
 * Legend row: badge, then "Display name: role", or the display name alone,
 * with the nested note and the "Shown when" note as before. The type and the
 * token list moved to the table view (Round 1). The tag keeps the RAW name so
 * read-back and the prompt still match on it.
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
  const nestedNote = part.nested ? `  ·  ${part.component ?? 'component'}` : '';
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
 * The diagram card: a live instance at true size, an outline around each
 * part, pins in a callout zone on the side the parts are least spread along,
 * elbow leaders from pin to outline, then the legend. Null when the component
 * cannot be instanced. `scale` is 1 unless the instance was wider than
 * `contentWidth` minus the card padding.
 */
export async function buildAnatomyDiagram(
  componentId: string, parts: AnatomyPartBlock[], includeHidden: boolean, contentWidth: number,
): Promise<{ card: FrameNode; scale: number } | null> {
  let node: BaseNode | null;
  try { node = await figma.getNodeByIdAsync(componentId); } catch { return null; }
  if (!node || node.type !== 'COMPONENT') return null;
  const component = node;
  let inst: InstanceNode;
  try {
    inst = component.createInstance();
    await matchVariableModes(inst, component);
    if (includeHidden) await revealBooleanParts(inst, component);
  } catch { return null; }
  const ib = inst.absoluteBoundingBox;
  if (!ib || ib.width <= 0 || ib.height <= 0) { try { inst.remove(); } catch { /* gone */ } return null; }

  // Each part as the box it DRAWS, normalized to the instance. Figma's render
  // bounds are the glyphs of a text layer or the painted area of a frame; the
  // layout box of a fill-width text layer spans its container while the word
  // sits at one end, and the old anchor at that box's centre pointed at
  // nothing. The layout box is the fallback for a layer Figma has not
  // rendered (render bounds null) or a host that lacks the field.
  const pins: { n: string; x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const part of parts) {
    if (part.depth !== 0) continue;
    let p: BaseNode | null;
    try { p = await figma.getNodeByIdAsync(`I${inst.id};${part.id}`); } catch { continue; }
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

  // Which side the callouts sit on depends only on the parts' normalized
  // spread, never on the render size, so it can be settled before the scale
  // below: a side callout zone widens the box, and that width has to come out
  // of the same column budget the instance itself is fit to.
  const xs = pins.map(cx);
  const ys = pins.map(cy);
  const xRange = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const yRange = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const sideCallouts = yRange > xRange;
  const ZONE = pins.length ? PIN_SIZE + RAIL_GAP + 24 : 0;

  // True size, unless wider than the column. Never taller-than-cap shrinking.
  // A side callout zone sits beside the instance and widens the box by ZONE,
  // so that much comes off the instance's own budget up front; a top callout
  // zone only adds height, which this diagram never caps.
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
  // Fixed to the column width — only the height hugs. A hugging WIDTH card
  // shrinks to whatever the (possibly tiny) diagram box measures, which then
  // leaves the legend inside it nothing real to FILL against; fixing the
  // width here gives a small component's box room to sit centred, and the
  // legend below a real inner width to stretch to.
  card.resize(contentWidth, 1);
  card.primaryAxisSizingMode = 'AUTO';

  // Natural pin centres along the callout axis, then fanned so none overlap.
  const natural = pins.map((p) => Math.round(sideCallouts ? cy(p) * renderedH : cx(p) * renderedW));
  let fanned = fanOutPins(natural, PIN_SIZE, PIN_GAP);
  if (!sideCallouts) {
    // A crowded top row can fan past the instance's own left/right edges,
    // which would otherwise widen the box past the column budget the scale
    // above already fit the instance to. Clamp back inside when that would
    // happen; pins may then touch, which only occurs when more pins exist
    // than physically fit across the column.
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

  // Outlines first, under the leaders and pins: a thin accent rectangle a
  // little outside what each part draws. The outline is what a pin points at,
  // so no connect dot is needed at the anchor.
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
