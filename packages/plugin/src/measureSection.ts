/// <reference types="@figma/plugin-typings" />
import { palette, solidFill, vstack, hstack, makeText, hex } from './frameKit';
import { measureKey } from './ui/docModel';

// Professional dimension-drawing style. No overlays on the artwork: every value
// is physically connected to the geometry it measures by extension lines + a
// dimension hairline, and carried by a plain purple text label (no pills). All
// measurement graphics — extension lines, hairlines, ticks, leaders, and the
// label text itself — share one ink (Figma's auto-layout purple).
const MEASURE_INK = hex('#7b61ff');
const IMG_MAX_H = 480;
const CARD_PAD = 24;

// Diagram box margins around the scaled image (room for dimension rows). The
// bottom/right margins are lower bounds; the box is grown after rows resolve.
const M_LEFT = 24;
const M_TOP = 44;
const M_RIGHT = 96;
const M_BOTTOM = 104;

// Dimension geometry.
const TICK = 6; // end-tick length on dimension hairlines
const EXT_OVER = 4; // extension-line overshoot past the image edge / dim line
const ROW_A_OFF = 18; // first dimension row/column offset from the image edge
const ROW_STEP = 24; // minimum spacing between dimension rows/columns
const LABEL_OFF = 3; // gap between a horizontal-span label and its hairline
const STAGGER_STEP = 14; // vertical push increment in the collision pass
const GUTTER = 6; // required horizontal gap between staggered labels
const LABEL_W = 120; // makeText width cap for measurement labels

/** A placed label's bounding box in box-local coords (for collision passes). */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlapsX = (a: Rect, b: Rect, gutter: number): boolean =>
  a.x < b.x + b.w + gutter && b.x < a.x + a.w + gutter;

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

/** `spacing/md · 12` when bound; `12` when raw. The token name's presence is
 *  the bound/raw distinction now — both render in the same purple ink. */
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

/** A plain purple text label — no background, no stroke. */
function makeLabel(label: MeasureLabel): TextNode {
  const text = makeText(label.text, 'Medium', 11, MEASURE_INK, 120);
  text.textAutoResize = 'WIDTH_AND_HEIGHT';
  return text;
}

/** A 1px hairline / tick / extension line as a filled rect, free-positioned.
 *  `opacity` fades the purple ink for the lighter extension lines. */
function line(x: number, y: number, w: number, h: number, opacity = 1): FrameNode {
  const f = figma.createFrame();
  f.resize(Math.max(w, 1), Math.max(h, 1));
  f.x = Math.round(x);
  f.y = Math.round(y);
  f.fills = [{ type: 'SOLID', color: MEASURE_INK, opacity }];
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

/** One legend row: the part name followed by caption + value text pairs.
 *  Caption in muted ink, value in purple — plain text, no pills. */
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
    const value = makeText(e.label.text, 'Medium', 11, MEASURE_INK, 130);
    value.textAutoResize = 'WIDTH_AND_HEIGHT';
    row.appendChild(value);
  }
  return row;
}

/**
 * Build the token-aware measure diagram in a professional dimension-drawing
 * style: a screenshot-scale live instance with the artwork left untouched, and
 * every measured value connected to its geometry by extension lines + a
 * dimension hairline outside the image (horizontal spans below, vertical spans
 * to the right). All measurement graphics share one purple ink; labels are plain
 * text placed above/below (or beside) their hairline, never on it, and a
 * left-to-right stagger pass guarantees no two labels — and no label and
 * extension line — overlap. A per-part legend for first-level auto-layout parts
 * sits below.
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

    // Track the deepest / rightmost content so the box is grown after rows
    // resolve (dynamic offsets can exceed the fixed M_BOTTOM / M_RIGHT).
    let maxContentBottom = imgBottom;
    let maxContentRight = imgRight;
    // Extension-line x positions are treated as 1px occupied rects by the
    // horizontal stagger pass so purple labels never sit over a purple line.
    const extColumns: number[] = [];

    // ------------------------------------------------------------------
    // Bottom side — horizontal dimension spans.
    // ------------------------------------------------------------------
    const rowA_y = imgBottom + ROW_A_OFF;

    /** Draw a horizontal span's extension lines, hairline + end ticks, and place
     *  its label above (wide span) or below (narrow span) the hairline. Returns
     *  the placed label node and its initial rect for the stagger pass. */
    const horizontalSpan = (
      x1: number,
      x2: number,
      label: MeasureLabel,
      y: number,
    ): { node: TextNode; rect: Rect; above: boolean } => {
      // Extension lines (55% ink) from just below the image down past the line.
      box.appendChild(line(x1, imgBottom + EXT_OVER, 1, y - (imgBottom + EXT_OVER) + EXT_OVER, 0.55));
      box.appendChild(line(x2, imgBottom + EXT_OVER, 1, y - (imgBottom + EXT_OVER) + EXT_OVER, 0.55));
      extColumns.push(x1, x2);
      // Dimension hairline + end ticks at 100%.
      box.appendChild(line(x1, y, x2 - x1, 1));
      box.appendChild(line(x1, y - TICK / 2, 1, TICK));
      box.appendChild(line(x2 - 1, y - TICK / 2, 1, TICK));
      // Label: measure width, then place centered on the span — above the line
      // when it fits within the span, below when the span is too narrow.
      const node = makeLabel(label);
      box.appendChild(node);
      const spanW = x2 - x1;
      const above = node.width + 8 <= spanW;
      const cx = (x1 + x2) / 2;
      const x = Math.round(cx - node.width / 2);
      const y2 = above
        ? Math.round(y - LABEL_OFF - node.height) // above the hairline
        : Math.round(y + LABEL_OFF); // below the hairline
      node.x = x;
      node.y = y2;
      return { node, rect: { x, y: y2, w: node.width, h: node.height }, above };
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

    // Place Row A labels, then a left-to-right stagger pass: each label is
    // pushed down in STAGGER_STEP increments until it clears every previously
    // placed label AND every extension-line column (with a GUTTER gutter).
    // Extension lines occupy the vertical band from the image bottom to the
    // hairline only — below the hairline there is no line, so a below-line label
    // is free to sit there without ever colliding with an extension column.
    // Above-line labels live above the hairline and ignore these columns (being
    // pushed down would move them onto the line, defeating the purpose).
    const columnRects: Rect[] = extColumns.map((x) => ({
      x,
      y: imgBottom,
      w: 1,
      h: rowA_y - imgBottom,
    }));
    const placedLabels: Rect[] = [];
    const rowANodes = rowASpans.map((s) => horizontalSpan(s.x1, s.x2, s.label, rowA_y));
    const yOverlap = (a: Rect, b: Rect): boolean => a.y < b.y + b.h && b.y < a.y + a.h;
    let rowABottom = rowA_y; // deepest label bottom (or the hairline y)
    for (const item of rowANodes) {
      const r = item.rect;
      const obstacles = item.above ? placedLabels : [...placedLabels, ...columnRects];
      while (obstacles.some((q) => overlapsX(r, q, GUTTER) && yOverlap(r, q))) {
        r.y += STAGGER_STEP;
      }
      item.node.y = r.y;
      placedLabels.push(r);
      rowABottom = Math.max(rowABottom, r.y + r.h);
    }
    maxContentBottom = Math.max(maxContentBottom, rowABottom);

    // Row B: total width — hairline computed AFTER Row A resolves so overlap is
    // structurally impossible. Width spans are wide, so the label goes below.
    const rowB_y = Math.max(rowA_y + ROW_STEP, rowABottom + 12);
    const widthLabel = horizontalSpan(
      imgLeft,
      imgRight,
      measureLabel(block.tokens, part, ['width'], component.width),
      rowB_y,
    );
    // Force below-line placement for the width label regardless of span width.
    widthLabel.node.y = Math.round(rowB_y + LABEL_OFF);
    maxContentBottom = Math.max(maxContentBottom, widthLabel.node.y + widthLabel.node.height);

    // ------------------------------------------------------------------
    // Right side — vertical dimension spans.
    // ------------------------------------------------------------------
    const colA_x = imgRight + ROW_A_OFF;

    /** A vertical span on the right: two horizontal extension lines, a vertical
     *  hairline with end ticks, and a horizontal label to the RIGHT of the line
     *  (6px away), vertically centered on the span. Returns the label's right
     *  edge so Column B can clear Column A. */
    const verticalSpan = (y1: number, y2: number, label: MeasureLabel, x: number): number => {
      box.appendChild(line(imgRight + EXT_OVER, y1, x - (imgRight + EXT_OVER) + EXT_OVER, 1, 0.55));
      box.appendChild(line(imgRight + EXT_OVER, y2, x - (imgRight + EXT_OVER) + EXT_OVER, 1, 0.55));
      box.appendChild(line(x, y1, 1, y2 - y1));
      box.appendChild(line(x - TICK / 2, y1, TICK, 1));
      box.appendChild(line(x - TICK / 2, y2 - 1, TICK, 1));
      const node = makeLabel(label);
      box.appendChild(node);
      node.x = Math.round(x + GUTTER);
      node.y = Math.round((y1 + y2) / 2 - node.height / 2);
      maxContentBottom = Math.max(maxContentBottom, node.y + node.height);
      return node.x + node.width;
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
    let colARight = colA_x;
    for (const s of colASpans) {
      colARight = Math.max(colARight, verticalSpan(s.y1, s.y2, s.label, colA_x));
    }

    // Column B: total height — hairline computed AFTER Column A resolves.
    const colB_x = colASpans.length ? Math.max(colA_x + ROW_STEP, colARight + 12) : imgRight + ROW_A_OFF;
    const heightRight = verticalSpan(
      imgTop,
      imgBottom,
      measureLabel(block.tokens, part, ['height'], component.height),
      colB_x,
    );
    maxContentRight = Math.max(maxContentRight, colARight, heightRight);

    // ------------------------------------------------------------------
    // Radius — plain label at top-left above the image, leader down to corner.
    // ------------------------------------------------------------------
    const radius = typeof component.cornerRadius === 'number' ? component.cornerRadius : 0;
    if (radius > 0) {
      const node = makeLabel(measureLabel(block.tokens, part, ['border-radius'], radius));
      box.appendChild(node);
      node.x = imgLeft;
      node.y = Math.round(imgTop - 8 - node.height);
      // Leader (100% ink) from the label's bottom-left down to the corner.
      box.appendChild(line(imgLeft, node.y + node.height, 1, imgTop - (node.y + node.height)));
      box.appendChild(line(imgLeft, imgTop - 1, 10, 1));
    }

    // Grow the box to fit dynamic rows (never shrink below the fixed margins).
    box.resize(
      Math.max(box.width, Math.round(maxContentRight + M_LEFT)),
      Math.max(box.height, Math.round(maxContentBottom - imgTop + M_TOP + 12)),
    );

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
