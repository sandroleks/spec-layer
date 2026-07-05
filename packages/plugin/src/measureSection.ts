/// <reference types="@figma/plugin-typings" />
import { palette, solidFill, vstack, hstack, makeText } from './frameKit';
import { measureKey } from './ui/docModel';

// Monochrome, Dev-Mode / engineering-drawing style. No overlays on the artwork:
// every value is physically connected to the geometry it measures by extension
// lines + a dimension hairline, with a single neutral pill carrying the value.
const IMG_MAX_H = 480;
const CARD_PAD = 24;

// Diagram box margins around the scaled image (room for dimension rows).
const M_LEFT = 24;
const M_TOP = 44;
const M_RIGHT = 96;
const M_BOTTOM = 104;

// Dimension geometry.
const TICK = 6; // end-tick length on dimension hairlines
const EXT_OVER = 4; // extension-line overshoot past the image edge / dim line
const ROW_A_OFF = 18; // first dimension row/column offset from the image edge
const ROW_STEP = 36; // spacing between dimension rows (Row A → Row B, Col A → Col B)
const PILL_DROP = 16; // Row-A collision fallback drop below the line

interface MeasureBlockData {
  componentId: string;
  rootPart: string;
  tokens: Record<string, string>;
}

type MeasureLabel = { text: string; bound: boolean };

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

/** A legend entry: one measured value with its caption. */
interface LegendEntry {
  label: MeasureLabel;
  caption: string;
}

const round = (n: number): number => Math.round(n * 10) / 10;

/** `spacing/md · 12` when bound; `12` when raw. `bound` drives pill text ink. */
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

/** A single unified pill: white bg, 1px border, radius 6, 3/8 padding, 11 Medium.
 *  Text ink is the only bound/unbound distinction — no dots, no dashes. */
function pill(label: MeasureLabel): FrameNode {
  const p = hstack(0);
  p.name = 'Measure pill';
  p.counterAxisAlignItems = 'CENTER';
  p.paddingTop = p.paddingBottom = 3;
  p.paddingLeft = p.paddingRight = 8;
  p.cornerRadius = 6;
  p.fills = solidFill(palette.bg);
  p.strokes = solidFill(palette.border);
  p.strokeWeight = 1;
  const text = makeText(label.text, 'Medium', 11, label.bound ? palette.heading : palette.muted, 130);
  text.textAutoResize = 'WIDTH_AND_HEIGHT';
  p.appendChild(text);
  return p;
}

/** A 1px hairline / tick / extension line as a filled rect, free-positioned. */
function line(x: number, y: number, w: number, h: number, color: RGB): FrameNode {
  const f = figma.createFrame();
  f.resize(Math.max(w, 1), Math.max(h, 1));
  f.x = Math.round(x);
  f.y = Math.round(y);
  f.fills = solidFill(color);
  return f;
}

/** The measured entries for one legend part: uniform-collapse padding, gap, radius. */
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
    out.push({ caption: 'padding', label: measureLabel(tokens, partName, ['padding'], n.paddingTop) });
  } else if (auto && (n.paddingTop > 0 || n.paddingLeft > 0)) {
    if (n.paddingLeft > 0 && n.paddingLeft === n.paddingRight) {
      out.push({ caption: 'padding-x', label: measureLabel(tokens, partName, ['padding-x', 'padding'], n.paddingLeft) });
    }
    if (n.paddingTop > 0 && n.paddingTop === n.paddingBottom) {
      out.push({ caption: 'padding-y', label: measureLabel(tokens, partName, ['padding-y', 'padding'], n.paddingTop) });
    }
  }
  if (auto && n.itemSpacing > 0) {
    out.push({ caption: 'gap', label: measureLabel(tokens, partName, ['gap'], n.itemSpacing) });
  }
  if (typeof n.cornerRadius === 'number' && n.cornerRadius > 0) {
    out.push({ caption: 'radius', label: measureLabel(tokens, partName, ['border-radius'], n.cornerRadius) });
  }
  return out;
}

/** One legend row: the part name followed by caption + pill pairs. */
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
    row.appendChild(pill(e.label));
  }
  return row;
}

/**
 * Build the token-aware measure diagram in a monochrome engineering-drawing
 * style: a screenshot-scale live instance with the artwork left untouched, and
 * every measured value connected to its geometry by extension lines + a
 * dimension hairline outside the image (horizontal spans below, vertical spans
 * to the right). One neutral pill style carries each value; bound values render
 * in heading ink, raw/unbound values in muted ink. A per-part legend for
 * first-level auto-layout parts sits below.
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
    const innerMax = 880 - 56 * 2 - CARD_PAD * 2 - (M_LEFT + M_RIGHT);
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
    box.resize(Math.max(M_LEFT + imgW + M_RIGHT, 1), Math.max(M_TOP + imgH + M_BOTTOM, 1));
    box.fills = [];
    box.clipsContent = false;
    card.appendChild(box);
    box.appendChild(inst);
    inst.x = M_LEFT;
    inst.y = M_TOP;

    // Image edges in box-local coordinates.
    const imgLeft = M_LEFT;
    const imgTop = M_TOP;
    const imgRight = M_LEFT + imgW;
    const imgBottom = M_TOP + imgH;

    const part = block.rootPart;
    const pads = {
      top: component.paddingTop ?? 0,
      right: component.paddingRight ?? 0,
      bottom: component.paddingBottom ?? 0,
      left: component.paddingLeft ?? 0,
    };
    const hasAutoLayout = component.layoutMode === 'HORIZONTAL' || component.layoutMode === 'VERTICAL';
    const horizontal = component.layoutMode === 'HORIZONTAL';
    const uniform =
      pads.top > 0 && pads.top === pads.right && pads.top === pads.bottom && pads.top === pads.left;

    // First visible child gap span, in scaled image coords along the main axis.
    let gapSpan: { start: number; end: number } | null = null;
    if (hasAutoLayout && component.itemSpacing > 0) {
      const kids = component.children.filter((c) => c.visible);
      for (let i = 0; i + 1 < kids.length; i++) {
        const a = kids[i];
        const b = kids[i + 1];
        if (horizontal) {
          const gx = imgLeft + (a.x + a.width) * scale;
          const gw = imgLeft + b.x * scale - gx;
          if (gw > 0) { gapSpan = { start: gx, end: gx + gw }; break; }
        } else {
          const gy = imgTop + (a.y + a.height) * scale;
          const gh = imgTop + b.y * scale - gy;
          if (gh > 0) { gapSpan = { start: gy, end: gy + gh }; break; }
        }
      }
    }

    // ------------------------------------------------------------------
    // Bottom side — horizontal dimension spans.
    // ------------------------------------------------------------------
    const rowA_y = imgBottom + ROW_A_OFF;

    /** A horizontal span on the bottom: two vertical extension lines, a
     *  dimension hairline with end ticks, and a value pill centered on it.
     *  Returns the placed pill so the collision pass can inspect it. */
    const horizontalSpan = (x1: number, x2: number, label: MeasureLabel, y: number): FrameNode => {
      // Extension lines from just below the image down to just past the line.
      box.appendChild(line(x1, imgBottom + EXT_OVER, 1, y - (imgBottom + EXT_OVER) + EXT_OVER, palette.border));
      box.appendChild(line(x2, imgBottom + EXT_OVER, 1, y - (imgBottom + EXT_OVER) + EXT_OVER, palette.border));
      // Dimension hairline + end ticks.
      box.appendChild(line(x1, y, x2 - x1, 1, palette.muted));
      box.appendChild(line(x1, y - TICK / 2, 1, TICK, palette.muted));
      box.appendChild(line(x2 - 1, y - TICK / 2, 1, TICK, palette.muted));
      // Pill centered on the span, vertically centered ON the line (z-above).
      const p = pill(label);
      box.appendChild(p);
      p.x = Math.round((x1 + x2) / 2 - p.width / 2);
      p.y = Math.round(y - p.height / 2);
      return p;
    };

    // Row A spans: collect sources in left-to-right order, then place.
    const rowASpans: { x1: number; x2: number; label: MeasureLabel }[] = [];
    if (hasAutoLayout) {
      if (uniform) {
        // Single padding value stands for all four sides (left span).
        rowASpans.push({
          x1: imgLeft,
          x2: imgLeft + pads.left * scale,
          label: measureLabel(block.tokens, part, ['padding'], pads.left),
        });
      } else {
        if (pads.left > 0) {
          rowASpans.push({
            x1: imgLeft,
            x2: imgLeft + pads.left * scale,
            label: measureLabel(block.tokens, part, ['padding-left', 'padding-x', 'padding'], pads.left),
          });
        }
        if (pads.right > 0 && pads.right !== pads.left) {
          rowASpans.push({
            x1: imgRight - pads.right * scale,
            x2: imgRight,
            label: measureLabel(block.tokens, part, ['padding-right', 'padding-x', 'padding'], pads.right),
          });
        }
      }
      // Gap span belongs on the bottom Row A only for HORIZONTAL layouts.
      if (horizontal && gapSpan) {
        rowASpans.push({
          x1: gapSpan.start,
          x2: gapSpan.end,
          label: measureLabel(block.tokens, part, ['gap'], component.itemSpacing),
        });
      }
    }
    rowASpans.sort((a, b) => a.x1 - b.x1);

    // Place Row A spans; simple one-tier collision fallback (drop below line).
    let prevRight = -Infinity;
    for (const s of rowASpans) {
      const p = horizontalSpan(s.x1, s.x2, s.label, rowA_y);
      if (p.x < prevRight) {
        p.y = Math.round(rowA_y + PILL_DROP);
      }
      prevRight = Math.max(prevRight, p.x + p.width);
    }

    // Row B: total width. Drops to Row A's y when Row A is empty.
    const rowB_y = rowASpans.length ? rowA_y + ROW_STEP : imgBottom + ROW_A_OFF;
    horizontalSpan(imgLeft, imgRight, measureLabel(block.tokens, part, ['width'], component.width), rowB_y);

    // ------------------------------------------------------------------
    // Right side — vertical dimension spans.
    // ------------------------------------------------------------------
    const colA_x = imgRight + ROW_A_OFF;

    /** A vertical span on the right: two horizontal extension lines, a vertical
     *  dimension hairline with end ticks, and a value pill to the RIGHT of it
     *  (horizontal text, never rotated), vertically centered on the span. */
    const verticalSpan = (y1: number, y2: number, label: MeasureLabel, x: number): void => {
      box.appendChild(line(imgRight + EXT_OVER, y1, x - (imgRight + EXT_OVER) + EXT_OVER, 1, palette.border));
      box.appendChild(line(imgRight + EXT_OVER, y2, x - (imgRight + EXT_OVER) + EXT_OVER, 1, palette.border));
      box.appendChild(line(x, y1, 1, y2 - y1, palette.muted));
      box.appendChild(line(x - TICK / 2, y1, TICK, 1, palette.muted));
      box.appendChild(line(x - TICK / 2, y2 - 1, TICK, 1, palette.muted));
      const p = pill(label);
      box.appendChild(p);
      p.x = Math.round(x + 8);
      p.y = Math.round((y1 + y2) / 2 - p.height / 2);
    };

    // Column A spans: padding-top (and padding-bottom if different), gap when
    // layout is VERTICAL. Only when NOT uniform (uniform collapses to bottom).
    const colASpans: { y1: number; y2: number; label: MeasureLabel }[] = [];
    if (hasAutoLayout && !uniform) {
      if (pads.top > 0 && pads.top === pads.bottom) {
        // padding-y pair: single top span carries the y-padding value.
        colASpans.push({
          y1: imgTop,
          y2: imgTop + pads.top * scale,
          label: measureLabel(block.tokens, part, ['padding-top', 'padding-y', 'padding'], pads.top),
        });
      } else {
        if (pads.top > 0) {
          colASpans.push({
            y1: imgTop,
            y2: imgTop + pads.top * scale,
            label: measureLabel(block.tokens, part, ['padding-top', 'padding-y', 'padding'], pads.top),
          });
        }
        if (pads.bottom > 0 && pads.bottom !== pads.top) {
          colASpans.push({
            y1: imgBottom - pads.bottom * scale,
            y2: imgBottom,
            label: measureLabel(block.tokens, part, ['padding-bottom', 'padding-y', 'padding'], pads.bottom),
          });
        }
      }
    }
    if (hasAutoLayout && !horizontal && gapSpan) {
      colASpans.push({
        y1: gapSpan.start,
        y2: gapSpan.end,
        label: measureLabel(block.tokens, part, ['gap'], component.itemSpacing),
      });
    }
    for (const s of colASpans) verticalSpan(s.y1, s.y2, s.label, colA_x);

    // Column B: total height. Drops to Column A's x when Column A is empty.
    const colB_x = colASpans.length ? colA_x + ROW_STEP : imgRight + ROW_A_OFF;
    verticalSpan(imgTop, imgBottom, measureLabel(block.tokens, part, ['height'], component.height), colB_x);

    // ------------------------------------------------------------------
    // Radius — pill at top-left above the image, short vertical leader down.
    // ------------------------------------------------------------------
    const radius = typeof component.cornerRadius === 'number' ? component.cornerRadius : 0;
    if (radius > 0) {
      const p = pill(measureLabel(block.tokens, part, ['border-radius'], radius));
      box.appendChild(p);
      p.x = imgLeft;
      p.y = Math.round(imgTop - 6 - p.height);
      // Leader hairline from the pill's bottom center down to the image top.
      const leaderX = imgLeft + 10;
      box.appendChild(line(leaderX, p.y + p.height, 1, imgTop - (p.y + p.height), palette.border));
    }

    // ------------------------------------------------------------------
    // Legend — first-level auto-layout parts only (root row deleted).
    // ------------------------------------------------------------------
    const legend = vstack(10);
    card.appendChild(legend);
    legend.layoutSizingHorizontal = 'FILL';

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
