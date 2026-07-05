/// <reference types="@figma/plugin-typings" />
import { palette, hex, solidFill, vstack, hstack, makeText } from './frameKit';
import { measureKey } from './ui/docModel';

// Fixed semantic colors — the diagram's visual key. Bands paint the color at a
// low opacity; chips use it as a solid dot next to the (mostly neutral) label.
const MEASURE_PADDING: RGB = hex('#22a06b'); // green
const MEASURE_GAP: RGB = hex('#e56910'); // orange
const MEASURE_SIZE: RGB = hex('#1868db'); // blue
const BAND_OPACITY = 0.18;
const IMG_MAX_H = 480;
const MARGIN = 72; // room around the image for lines + chips
const CARD_PAD = 24;

interface MeasureBlockData {
  componentId: string;
  rootPart: string;
  tokens: Record<string, string>;
}

type MeasureLabel = { text: string; bound: boolean };

/** A legend entry: one measured value with its semantic color and caption. */
interface LegendEntry {
  label: MeasureLabel;
  color: RGB;
  caption: string;
}

/** The subset of node geometry the legend reads. Both ComponentNode and
 *  FrameNode satisfy this structurally, so a single helper serves root + parts. */
interface MeasurableNode {
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  itemSpacing: number;
  cornerRadius: number | typeof figma.mixed;
  layoutMode: string;
}

const round = (n: number): number => Math.round(n * 10) / 10;

/** `spacing/md · 12` when bound; `12` when raw. `bound` drives chip styling. */
function measureLabel(
  tokens: Record<string, string>,
  part: string,
  propertyCandidates: string[],
  px: number,
): MeasureLabel {
  for (const prop of propertyCandidates) {
    const token = tokens[measureKey(part, prop)];
    if (token) return { text: `${token} · ${round(px)}`, bound: true };
  }
  return { text: String(round(px)), bound: false };
}

/** A pill chip: colored semantic dot + label. Unbound values render with a
 *  dashed border and muted ink — the same hygiene signal as extraction gaps. */
function measureChip(label: MeasureLabel, color: RGB): FrameNode {
  const chip = hstack(6);
  chip.counterAxisAlignItems = 'CENTER';
  chip.paddingTop = chip.paddingBottom = 3;
  chip.paddingLeft = chip.paddingRight = 8;
  chip.cornerRadius = 6;
  chip.fills = solidFill(palette.bg);
  chip.strokes = solidFill(label.bound ? palette.border : palette.muted);
  chip.strokeWeight = 1;
  if (!label.bound) chip.dashPattern = [3, 2];

  const dot = figma.createFrame();
  dot.resize(8, 8);
  dot.cornerRadius = 4;
  dot.fills = solidFill(color);
  chip.appendChild(dot);

  const text = makeText(label.text, 'Medium', 11, label.bound ? palette.heading : palette.muted, 130);
  text.textAutoResize = 'WIDTH_AND_HEIGHT';
  chip.appendChild(text);
  return chip;
}

/** A translucent overlay band (absolute-positioned inside the diagram box). */
function band(x: number, y: number, w: number, h: number, color: RGB): FrameNode {
  const rect = figma.createFrame();
  rect.resize(Math.max(w, 1), Math.max(h, 1));
  rect.x = x;
  rect.y = y;
  rect.fills = [{ type: 'SOLID', color, opacity: BAND_OPACITY }];
  return rect;
}

/** A 1px dimension line with end ticks, horizontal or vertical. */
function dimensionLine(length: number, vertical: boolean): FrameNode {
  const wrap = figma.createFrame();
  wrap.fills = [];
  const w = vertical ? 7 : Math.max(length, 1);
  const h = vertical ? Math.max(length, 1) : 7;
  wrap.resize(w, h);
  const mk = (x: number, y: number, lw: number, lh: number): void => {
    const f = figma.createFrame();
    f.resize(Math.max(lw, 1), Math.max(lh, 1));
    f.x = x;
    f.y = y;
    f.fills = solidFill(MEASURE_SIZE);
    wrap.appendChild(f);
  };
  if (vertical) {
    mk(3, 0, 1, length); // line
    mk(0, 0, 7, 1); // top tick
    mk(0, length - 1, 7, 1); // bottom tick
  } else {
    mk(0, 3, length, 1);
    mk(0, 0, 1, 7);
    mk(length - 1, 0, 1, 7);
  }
  return wrap;
}

/** Center a free-positioned child horizontally over a span (post-append, once
 *  the chip has its measured width). */
function centerX(node: SceneNode, spanX: number, spanW: number): void {
  node.x = Math.round(spanX + spanW / 2 - node.width / 2);
}

/** The measured entries for one part: uniform-collapse padding, gap, radius. */
function partEntries(
  tokens: Record<string, string>,
  partName: string,
  n: MeasurableNode,
): LegendEntry[] {
  const out: LegendEntry[] = [];
  const auto = n.layoutMode === 'HORIZONTAL' || n.layoutMode === 'VERTICAL';
  if (
    auto &&
    n.paddingTop === n.paddingBottom &&
    n.paddingLeft === n.paddingRight &&
    n.paddingTop === n.paddingLeft &&
    n.paddingTop > 0
  ) {
    out.push({ caption: 'padding', color: MEASURE_PADDING, label: measureLabel(tokens, partName, ['padding'], n.paddingTop) });
  } else if (auto && (n.paddingTop > 0 || n.paddingLeft > 0)) {
    if (n.paddingLeft > 0 && n.paddingLeft === n.paddingRight) {
      out.push({ caption: 'padding-x', color: MEASURE_PADDING, label: measureLabel(tokens, partName, ['padding-x', 'padding'], n.paddingLeft) });
    }
    if (n.paddingTop > 0 && n.paddingTop === n.paddingBottom) {
      out.push({ caption: 'padding-y', color: MEASURE_PADDING, label: measureLabel(tokens, partName, ['padding-y', 'padding'], n.paddingTop) });
    }
  }
  if (auto && n.itemSpacing > 0) {
    out.push({ caption: 'gap', color: MEASURE_GAP, label: measureLabel(tokens, partName, ['gap'], n.itemSpacing) });
  }
  if (typeof n.cornerRadius === 'number' && n.cornerRadius > 0) {
    out.push({ caption: 'radius', color: MEASURE_SIZE, label: measureLabel(tokens, partName, ['border-radius'], n.cornerRadius) });
  }
  return out;
}

/** One legend row: the part name followed by caption + chip pairs. */
function legendRow(partName: string, entries: LegendEntry[]): FrameNode {
  const row = hstack(10);
  row.counterAxisAlignItems = 'CENTER';
  const name = makeText(partName, 'Medium', 13, palette.heading, 140);
  name.textAutoResize = 'WIDTH_AND_HEIGHT';
  row.appendChild(name);
  for (const e of entries) {
    const cap = makeText(e.caption, 'Regular', 11, palette.muted, 130);
    cap.textAutoResize = 'WIDTH_AND_HEIGHT';
    row.appendChild(cap);
    row.appendChild(measureChip(e.label, e.color));
  }
  return row;
}

/**
 * Build the token-aware measure diagram: a screenshot-scale live instance with
 * root-only padding/gap overlay bands and width/height dimension lines, plus a
 * per-part measure legend below. Labels resolve tokens where the default variant
 * carries them (`spacing/md · 12`) and fall back to raw px in a dashed-muted
 * chip otherwise.
 *
 * Returns null when the diagram can't be built (component missing, not a
 * COMPONENT, or any layout error) so the caller can fall back to a plain table.
 * Any created instance is removed before returning null so the canvas is never
 * left with an orphaned node.
 */
export async function buildMeasureSection(block: MeasureBlockData): Promise<FrameNode | null> {
  let node: BaseNode | null;
  try {
    node = await figma.getNodeByIdAsync(block.componentId);
  } catch {
    return null;
  }
  if (!node || node.type !== 'COMPONENT') return null;
  const component = node;

  let inst: InstanceNode;
  try {
    inst = component.createInstance();
  } catch {
    return null;
  }

  // Everything after the instance exists is wrapped so any Figma-API throw
  // (resize/rescale/layout) cleans up the instance and falls back to the table.
  try {
    // CONTENT_WIDTH is owned by docFrame; the card FILLs its parent, so size the
    // image against a conservative inner width instead of importing the mutable.
    const innerMax = 880 - 56 * 2 - CARD_PAD * 2 - MARGIN * 2;
    const scale = Math.min(innerMax / inst.width, IMG_MAX_H / inst.height, 1);
    if (scale !== 1) inst.rescale(scale);
    const imgW = inst.width;
    const imgH = inst.height;

    // Card (same visual language as the anatomy card).
    const card = vstack(20);
    card.paddingTop = card.paddingBottom = card.paddingLeft = card.paddingRight = CARD_PAD;
    card.fills = solidFill(palette.paneBg);
    card.cornerRadius = 8;
    card.strokes = solidFill(palette.border);
    card.strokeWeight = 1;
    card.counterAxisAlignItems = 'CENTER';

    // Diagram box: plain frame; children free-position by x/y.
    const box = figma.createFrame();
    box.name = 'Measure diagram';
    box.resize(imgW + MARGIN * 2, imgH + MARGIN * 2);
    box.fills = [];
    box.clipsContent = false;
    card.appendChild(box);
    box.appendChild(inst);
    inst.x = MARGIN;
    inst.y = MARGIN;

    const part = block.rootPart;
    const pads = {
      top: component.paddingTop ?? 0,
      right: component.paddingRight ?? 0,
      bottom: component.paddingBottom ?? 0,
      left: component.paddingLeft ?? 0,
    };
    const hasAutoLayout = component.layoutMode === 'HORIZONTAL' || component.layoutMode === 'VERTICAL';

    // --- Padding bands + edge chips (collapse-aware label lookup order) ---
    if (hasAutoLayout) {
      const edges = [
        { edge: 'top', px: pads.top, candidates: ['padding-top', 'padding-y', 'padding'] },
        { edge: 'bottom', px: pads.bottom, candidates: ['padding-bottom', 'padding-y', 'padding'] },
        { edge: 'left', px: pads.left, candidates: ['padding-left', 'padding-x', 'padding'] },
        { edge: 'right', px: pads.right, candidates: ['padding-right', 'padding-x', 'padding'] },
      ] as const;

      // Uniform padding → one band set, one chip (top).
      const uniform = pads.top > 0 && pads.top === pads.right && pads.top === pads.bottom && pads.top === pads.left;

      for (const e of edges) {
        if (e.px <= 0) continue;
        const s = e.px * scale;
        if (e.edge === 'top') box.appendChild(band(MARGIN, MARGIN, imgW, s, MEASURE_PADDING));
        if (e.edge === 'bottom') box.appendChild(band(MARGIN, MARGIN + imgH - s, imgW, s, MEASURE_PADDING));
        if (e.edge === 'left') box.appendChild(band(MARGIN, MARGIN, s, imgH, MEASURE_PADDING));
        if (e.edge === 'right') box.appendChild(band(MARGIN + imgW - s, MARGIN, s, imgH, MEASURE_PADDING));
      }

      const chipFor = (candidates: readonly string[], px: number): FrameNode =>
        measureChip(measureLabel(block.tokens, part, [...candidates], px), MEASURE_PADDING);

      if (uniform) {
        const chip = chipFor(['padding'], pads.top);
        box.appendChild(chip);
        centerX(chip, MARGIN, imgW);
        chip.y = MARGIN - chip.height - 8;
      } else {
        if (pads.top > 0) {
          const chip = chipFor(['padding-top', 'padding-y', 'padding'], pads.top);
          box.appendChild(chip);
          centerX(chip, MARGIN, imgW);
          chip.y = MARGIN - chip.height - 8;
        }
        if (pads.bottom > 0 && pads.bottom !== pads.top) {
          const chip = chipFor(['padding-bottom', 'padding-y', 'padding'], pads.bottom);
          box.appendChild(chip);
          centerX(chip, MARGIN, imgW);
          chip.y = MARGIN + imgH + 8;
        }
        if (pads.left > 0) {
          const chip = chipFor(['padding-left', 'padding-x', 'padding'], pads.left);
          box.appendChild(chip);
          chip.x = MARGIN - chip.width - 8;
          chip.y = Math.round(MARGIN + imgH / 2 - chip.height / 2);
        }
        if (pads.right > 0 && pads.right !== pads.left) {
          const chip = chipFor(['padding-right', 'padding-x', 'padding'], pads.right);
          box.appendChild(chip);
          chip.x = MARGIN + imgW + 8;
          chip.y = Math.round(MARGIN + imgH / 2 - chip.height / 2);
        }
      }
    }

    // --- Gap bands between consecutive visible children + one chip ---
    if (hasAutoLayout && component.itemSpacing > 0) {
      const kids = component.children.filter((c) => c.visible);
      const horizontal = component.layoutMode === 'HORIZONTAL';
      let firstBand: FrameNode | null = null;
      for (let i = 0; i + 1 < kids.length; i++) {
        const a = kids[i];
        const b = kids[i + 1];
        if (horizontal) {
          const gx = (a.x + a.width) * scale;
          const gw = b.x * scale - gx;
          if (gw <= 0) continue;
          const g = band(MARGIN + gx, MARGIN, gw, imgH, MEASURE_GAP);
          box.appendChild(g);
          firstBand ??= g;
        } else {
          const gy = (a.y + a.height) * scale;
          const gh = b.y * scale - gy;
          if (gh <= 0) continue;
          const g = band(MARGIN, MARGIN + gy, imgW, gh, MEASURE_GAP);
          box.appendChild(g);
          firstBand ??= g;
        }
      }
      if (firstBand) {
        const chip = measureChip(measureLabel(block.tokens, part, ['gap'], component.itemSpacing), MEASURE_GAP);
        box.appendChild(chip);
        centerX(chip, firstBand.x, firstBand.width);
        chip.y = MARGIN + imgH + (pads.bottom > 0 && pads.bottom !== pads.top ? 36 : 8);
      }
    }

    // --- Size dimension lines (width below, height right) ---
    const wLine = dimensionLine(imgW, false);
    box.appendChild(wLine);
    wLine.x = MARGIN;
    wLine.y = MARGIN + imgH + 34;
    const wChip = measureChip(measureLabel(block.tokens, part, ['width'], component.width), MEASURE_SIZE);
    box.appendChild(wChip);
    centerX(wChip, MARGIN, imgW);
    wChip.y = wLine.y + 12;

    const hLine = dimensionLine(imgH, true);
    box.appendChild(hLine);
    hLine.x = MARGIN + imgW + 34;
    hLine.y = MARGIN;
    const hChip = measureChip(measureLabel(block.tokens, part, ['height'], component.height), MEASURE_SIZE);
    box.appendChild(hChip);
    hChip.x = hLine.x + 12;
    hChip.y = Math.round(MARGIN + imgH / 2 - hChip.height / 2);

    // --- Corner radius chip (top-right, above the image) ---
    const radius = typeof component.cornerRadius === 'number' ? component.cornerRadius : 0;
    if (radius > 0) {
      const chip = measureChip(measureLabel(block.tokens, part, ['border-radius'], radius), MEASURE_SIZE);
      box.appendChild(chip);
      chip.x = MARGIN + imgW - chip.width;
      chip.y = MARGIN - chip.height - 8;
    }

    // --- Measure legend: root + first-level auto-layout parts ---
    const legend = vstack(10);
    card.appendChild(legend);
    legend.layoutSizingHorizontal = 'FILL';

    const rootEntries = partEntries(block.tokens, part, component);
    if (rootEntries.length) {
      const row = legendRow(part, rootEntries);
      legend.appendChild(row);
      row.layoutSizingHorizontal = 'FILL';
    }
    for (const child of component.children) {
      if (!child.visible) continue;
      if (child.type !== 'FRAME' && child.type !== 'INSTANCE' && child.type !== 'COMPONENT') continue;
      const layoutChild = child;
      if (layoutChild.layoutMode !== 'HORIZONTAL' && layoutChild.layoutMode !== 'VERTICAL') continue;
      const childPart = child.name.replace(/#+\s*$/, '').trim();
      const entries = partEntries(block.tokens, childPart, layoutChild);
      if (!entries.length) continue;
      const row = legendRow(childPart, entries);
      legend.appendChild(row);
      row.layoutSizingHorizontal = 'FILL';
    }
    if (legend.children.length === 0) legend.remove();

    return card;
  } catch {
    // Clean up the orphaned instance so a failed build never litters the canvas.
    try {
      inst.remove();
    } catch {
      /* already gone */
    }
    return null;
  }
}
