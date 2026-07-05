/// <reference types="@figma/plugin-typings" />
import { palette, solidFill, vstack, hstack, makeText, hex } from './frameKit';
import { measureKey } from './ui/docModel';

// Spectral "DesignDoc" measure language. The live instance sits centered; every
// measured value is a solid colored badge arranged in tidy rails OUTSIDE the
// artwork, never touching it. Translucent full-span bands with dashed inner
// edges mark the padding and gap regions over the artwork; dashed outlines mark
// children. Three fixed semantic colors carry meaning:
const SIZE_RED: RGB = hex('#f24822'); // container + child sizes
const PAD_PINK: RGB = hex('#ec4899'); // padding
const GAP_BLUE: RGB = hex('#2979ff'); // gaps
const WHITE: RGB = hex('#ffffff'); // badge text

const IMG_MAX_H = 480;
const CARD_PAD = 24;

// Diagram-box margins around the scaled image. Top/left are fixed; right/bottom
// are computed after rail placement (they depend on badge extents), so these
// two are only the inner slack added past the measured content.
const M_TOP = 44;
const M_LEFT = 64;
const R_SLACK = 8; // extra room right of the widest right-rail badge
const B_SLACK = 8; // extra room below the bottom-rail badges

// Rail geometry.
const RAIL_TOP_OFF = 18; // total-width hairline offset above the image
const RAIL_LEFT_OFF = 18; // total-height hairline offset left of the image
const RAIL_RIGHT_OFF = 16; // right-rail badge left edge, right of the image
const RAIL_BOTTOM_OFF = 16; // bottom-rail badge top edge, below the image
const TICK = 6; // end-tick length on the total-dimension hairlines
const LINE_GAP = 4; // gap between a rail badge and its hairline
const NUDGE = 4; // minimum gap enforced between adjacent rail badges

// Band styling.
const BAND_OPACITY = 0.14;
const EDGE_OPACITY = 0.5;
const OUTLINE_OPACITY = 0.6;
const DASH: number[] = [4, 3];

interface MeasureBlockData {
  componentId: string;
  rootPart: string;
  tokens: Record<string, string>;
}

/** A measured value with its optional bound token. `value` is the raw px string
 *  shown in badges; `token` (when present) drives the token-first bindings line. */
type MeasureLabel = { value: string; token: string | null };

/** The subset of node geometry the legend reads. Both ComponentNode and
 *  FrameNode satisfy this structurally, so one helper serves root + parts. */
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

/** Resolve a measured property to its value + bound token. The first matching
 *  candidate key wins; `value` is always the rounded px, `token` its binding. */
function measureLabel(
  tokens: Record<string, string>,
  part: string,
  propertyCandidates: string[],
  px: number,
): MeasureLabel {
  for (const prop of propertyCandidates) {
    const token = tokens[measureKey(part, prop)];
    if (token) return { value: String(round(px)), token };
  }
  return { value: String(round(px)), token: null };
}

// ---------------------------------------------------------------------------
// Primitive builders
// ---------------------------------------------------------------------------

/** A solid rounded value badge: fill = color, white 11 Bold text, hug-sized.
 *  Values only (e.g. `24`) — token names live on the bindings line, not here. */
function badge(text: string, color: RGB): FrameNode {
  const chip = hstack(0);
  chip.paddingTop = chip.paddingBottom = 3;
  chip.paddingLeft = chip.paddingRight = 6;
  chip.cornerRadius = 4;
  chip.fills = solidFill(color);
  const t = makeText(text, 'Bold', 11, WHITE, 120);
  t.textAutoResize = 'WIDTH_AND_HEIGHT';
  chip.appendChild(t);
  return chip;
}

/** A translucent full-span band rect (fills only, no stroke), free-positioned. */
function band(x: number, y: number, w: number, h: number, color: RGB): FrameNode {
  const f = figma.createFrame();
  f.resize(Math.max(w, 1), Math.max(h, 1));
  f.x = Math.round(x);
  f.y = Math.round(y);
  f.fills = [{ type: 'SOLID', color, opacity: BAND_OPACITY }];
  return f;
}

/** A 1px dashed line as a stroked frame (horizontal when h<=1, else vertical). */
function dashedLine(x: number, y: number, w: number, h: number, color: RGB, opacity: number): FrameNode {
  const f = figma.createFrame();
  f.resize(Math.max(w, 1), Math.max(h, 1));
  f.x = Math.round(x);
  f.y = Math.round(y);
  f.fills = [];
  f.strokes = [{ type: 'SOLID', color, opacity }];
  f.strokeWeight = 1;
  f.dashPattern = DASH;
  return f;
}

/** A 1px solid hairline / tick as a filled rect, free-positioned. */
function line(x: number, y: number, w: number, h: number, color: RGB): FrameNode {
  const f = figma.createFrame();
  f.resize(Math.max(w, 1), Math.max(h, 1));
  f.x = Math.round(x);
  f.y = Math.round(y);
  f.fills = solidFill(color);
  return f;
}

/** A dashed outline rect (no fill) marking a child's scaled bounds. */
function outline(x: number, y: number, w: number, h: number): FrameNode {
  const f = figma.createFrame();
  f.resize(Math.max(w, 1), Math.max(h, 1));
  f.x = Math.round(x);
  f.y = Math.round(y);
  f.fills = [];
  f.strokes = [{ type: 'SOLID', color: SIZE_RED, opacity: OUTLINE_OPACITY }];
  f.strokeWeight = 1;
  f.dashPattern = DASH;
  return f;
}

// ---------------------------------------------------------------------------
// Legend (first-level parts)
// ---------------------------------------------------------------------------

interface LegendEntry {
  caption: string;
  label: MeasureLabel;
}

/** Measured entries for one legend part: uniform-collapse padding, gap, radius. */
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

/** `spacing/md · 24` when bound, `24` when raw. */
function bindingText(label: MeasureLabel): string {
  return label.token ? `${label.token} · ${label.value}` : label.value;
}

/** One legend row: part name + caption/value pairs. Values are plain heading
 *  ink (no purple, no pills), captions muted. */
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
    const value = makeText(bindingText(e.label), 'Medium', 11, palette.heading, 130);
    value.textAutoResize = 'WIDTH_AND_HEIGHT';
    row.appendChild(value);
  }
  return row;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Build the token-aware measure diagram in the Spectral DesignDoc rail style: a
 * screenshot-scale live instance with the artwork left untouched, translucent
 * full-span bands (pink padding, blue gap) with dashed inner edges layered over
 * it, dashed child outlines, and solid colored value badges (red = size, pink =
 * padding, blue = gap) arranged in rails OUTSIDE the artwork — top = total
 * width, left = total height, right = layout-axis rhythm (incl. child sizes),
 * bottom = cross measurements. A quiet token-bindings line beneath the diagram
 * carries the token-first data (incl. radius); a per-part legend for first-level
 * auto-layout parts sits below that.
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
    // Rails add width beyond the image, so keep the image itself well inside.
    const innerMax = 880 - 56 * 2 - CARD_PAD * 2 - (M_LEFT + 160);
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

    // Diagram box: plain frame; children free-position by x/y. Oversized to start
    // so badges can be measured/placed, then resized to content extents.
    const box = figma.createFrame();
    box.name = 'Measure diagram';
    box.resize(2000, 2000);
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
    const padTs = pads.top * scale;
    const padRs = pads.right * scale;
    const padBs = pads.bottom * scale;
    const padLs = pads.left * scale;

    const hasAutoLayout = component.layoutMode === 'HORIZONTAL' || component.layoutMode === 'VERTICAL';
    const horizontal = component.layoutMode === 'HORIZONTAL';
    const gap = hasAutoLayout ? component.itemSpacing : 0;

    // Visible children, in layout order, with scaled box-local bounds.
    interface Child {
      x1: number; // box-local left / top edge (main-axis start / cross start)
      y1: number;
      w: number; // scaled width / height
      h: number;
    }
    const kids: Child[] = component.children
      .filter((c) => c.visible)
      .map((c) => ({
        x1: imgLeft + c.x * scale,
        y1: imgTop + c.y * scale,
        w: c.width * scale,
        h: c.height * scale,
      }));

    // ------------------------------------------------------------------
    // Bands + child outlines OVER the artwork (appended after the instance).
    // ------------------------------------------------------------------
    if (hasAutoLayout) {
      // Padding bands: full-span translucent strips, dashed line on inner edge.
      if (padTs > 0) {
        box.appendChild(band(imgLeft, imgTop, imgW, padTs, PAD_PINK));
        box.appendChild(dashedLine(imgLeft, imgTop + padTs, imgW, 1, PAD_PINK, EDGE_OPACITY));
      }
      if (padBs > 0) {
        box.appendChild(band(imgLeft, imgBottom - padBs, imgW, padBs, PAD_PINK));
        box.appendChild(dashedLine(imgLeft, imgBottom - padBs, imgW, 1, PAD_PINK, EDGE_OPACITY));
      }
      if (padLs > 0) {
        box.appendChild(band(imgLeft, imgTop, padLs, imgH, PAD_PINK));
        box.appendChild(dashedLine(imgLeft + padLs, imgTop, 1, imgH, PAD_PINK, EDGE_OPACITY));
      }
      if (padRs > 0) {
        box.appendChild(band(imgRight - padRs, imgTop, padRs, imgH, PAD_PINK));
        box.appendChild(dashedLine(imgRight - padRs, imgTop, 1, imgH, PAD_PINK, EDGE_OPACITY));
      }
    }

    // Gap bands between consecutive visible children along the layout axis, full
    // cross-axis span, with dashed edge lines on both sides.
    const gaps: { start: number; end: number }[] = []; // main-axis gap spans (box-local)
    if (hasAutoLayout && gap > 0 && kids.length > 1) {
      for (let i = 0; i + 1 < kids.length; i++) {
        const a = kids[i];
        const b = kids[i + 1];
        if (horizontal) {
          const gs = a.x1 + a.w;
          const ge = b.x1;
          if (ge > gs) {
            gaps.push({ start: gs, end: ge });
            box.appendChild(band(gs, imgTop, ge - gs, imgH, GAP_BLUE));
            box.appendChild(dashedLine(gs, imgTop, 1, imgH, GAP_BLUE, EDGE_OPACITY));
            box.appendChild(dashedLine(ge, imgTop, 1, imgH, GAP_BLUE, EDGE_OPACITY));
          }
        } else {
          const gs = a.y1 + a.h;
          const ge = b.y1;
          if (ge > gs) {
            gaps.push({ start: gs, end: ge });
            box.appendChild(band(imgLeft, gs, imgW, ge - gs, GAP_BLUE));
            box.appendChild(dashedLine(imgLeft, gs, imgW, 1, GAP_BLUE, EDGE_OPACITY));
            box.appendChild(dashedLine(imgLeft, ge, imgW, 1, GAP_BLUE, EDGE_OPACITY));
          }
        }
      }
    }

    // Child outlines when an auto-layout root has more than one visible child.
    // (A non-auto-layout root gets only the total width/height lines.)
    if (hasAutoLayout && kids.length > 1) {
      for (const k of kids) box.appendChild(outline(k.x1, k.y1, k.w, k.h));
    }

    // ------------------------------------------------------------------
    // Top rail — total width hairline + centered width badge.
    // ------------------------------------------------------------------
    const topLineY = imgTop - RAIL_TOP_OFF;
    box.appendChild(line(imgLeft, topLineY, imgW, 1, SIZE_RED));
    box.appendChild(line(imgLeft, topLineY - TICK / 2, 1, TICK, SIZE_RED));
    box.appendChild(line(imgRight - 1, topLineY - TICK / 2, 1, TICK, SIZE_RED));
    const widthBadge = badge(measureLabel(block.tokens, part, ['width'], component.width).value, SIZE_RED);
    box.appendChild(widthBadge);
    widthBadge.x = Math.round((imgLeft + imgRight) / 2 - widthBadge.width / 2);
    widthBadge.y = Math.round(topLineY - LINE_GAP - widthBadge.height);
    let minContentTop = widthBadge.y;

    // ------------------------------------------------------------------
    // Left rail — total height hairline + centered height badge.
    // ------------------------------------------------------------------
    const leftLineX = imgLeft - RAIL_LEFT_OFF;
    box.appendChild(line(leftLineX, imgTop, 1, imgH, SIZE_RED));
    box.appendChild(line(leftLineX - TICK / 2, imgTop, TICK, 1, SIZE_RED));
    box.appendChild(line(leftLineX - TICK / 2, imgBottom - 1, TICK, 1, SIZE_RED));
    const heightBadge = badge(measureLabel(block.tokens, part, ['height'], component.height).value, SIZE_RED);
    box.appendChild(heightBadge);
    heightBadge.x = Math.round(leftLineX - LINE_GAP - heightBadge.width);
    heightBadge.y = Math.round((imgTop + imgBottom) / 2 - heightBadge.height / 2);
    let minContentLeft = heightBadge.x;

    // ------------------------------------------------------------------
    // Right rail — layout-axis rhythm. Badges left-aligned at railRightX,
    // each centered on its band; a top-to-bottom nudge pass prevents overlap.
    // ------------------------------------------------------------------
    const railRightX = imgRight + RAIL_RIGHT_OFF;
    interface RailItem {
      node: FrameNode;
      center: number; // desired center along the axis (y for right, x for bottom)
    }
    const rightRail: RailItem[] = [];
    const addRight = (text: string, color: RGB, center: number): void => {
      const b = badge(text, color);
      box.appendChild(b);
      rightRail.push({ node: b, center });
    };

    if (hasAutoLayout && pads.top > 0) {
      addRight(measureLabel(block.tokens, part, ['padding-top', 'padding-y', 'padding'], pads.top).value, PAD_PINK, imgTop + padTs / 2);
    }
    if (hasAutoLayout && !horizontal) {
      // Vertical layout: per child, child-height then following gap.
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        addRight(String(round(k.h / scale)), SIZE_RED, k.y1 + k.h / 2);
        if (i < gaps.length) {
          const g = gaps[i];
          addRight(String(round(gap)), GAP_BLUE, (g.start + g.end) / 2);
        }
      }
    }
    if (hasAutoLayout && pads.bottom > 0) {
      addRight(measureLabel(block.tokens, part, ['padding-bottom', 'padding-y', 'padding'], pads.bottom).value, PAD_PINK, imgBottom - padBs / 2);
    }

    // Place right-rail badges left-aligned, vertically centered on their band,
    // then push down in order so each clears the previous (y >= prevBottom + 4).
    let prevBottom = -Infinity;
    let railRightMaxRight = railRightX;
    let railRightMaxBottom = imgBottom;
    for (const item of rightRail) {
      item.node.x = Math.round(railRightX);
      let y = Math.round(item.center - item.node.height / 2);
      if (y < prevBottom + NUDGE) y = Math.round(prevBottom + NUDGE);
      item.node.y = y;
      prevBottom = y + item.node.height;
      railRightMaxRight = Math.max(railRightMaxRight, item.node.x + item.node.width);
      railRightMaxBottom = Math.max(railRightMaxBottom, prevBottom);
    }

    // ------------------------------------------------------------------
    // Bottom rail — cross-axis measurements. Badges top-aligned at railBottomY,
    // each centered under its span; a left-to-right nudge pass prevents overlap.
    // ------------------------------------------------------------------
    const railBottomY = imgBottom + RAIL_BOTTOM_OFF;
    const bottomRail: RailItem[] = [];
    const addBottom = (text: string, color: RGB, center: number): void => {
      const b = badge(text, color);
      box.appendChild(b);
      bottomRail.push({ node: b, center });
    };

    if (horizontal) {
      // Horizontal layout: padL, per child [child-width, gap], padR.
      if (pads.left > 0) {
        addBottom(measureLabel(block.tokens, part, ['padding-left', 'padding-x', 'padding'], pads.left).value, PAD_PINK, imgLeft + padLs / 2);
      }
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        addBottom(String(round(k.w / scale)), SIZE_RED, k.x1 + k.w / 2);
        if (i < gaps.length) {
          const g = gaps[i];
          addBottom(String(round(gap)), GAP_BLUE, (g.start + g.end) / 2);
        }
      }
      if (pads.right > 0) {
        addBottom(measureLabel(block.tokens, part, ['padding-right', 'padding-x', 'padding'], pads.right).value, PAD_PINK, imgRight - padRs / 2);
      }
    } else if (hasAutoLayout) {
      // Vertical layout: padL, content-width, padR.
      if (pads.left > 0) {
        addBottom(measureLabel(block.tokens, part, ['padding-left', 'padding-x', 'padding'], pads.left).value, PAD_PINK, imgLeft + padLs / 2);
      }
      const contentLeft = imgLeft + padLs;
      const contentRight = imgRight - padRs;
      const contentW = round((component.width - pads.left - pads.right));
      addBottom(String(contentW), SIZE_RED, (contentLeft + contentRight) / 2);
      if (pads.right > 0) {
        addBottom(measureLabel(block.tokens, part, ['padding-right', 'padding-x', 'padding'], pads.right).value, PAD_PINK, imgRight - padRs / 2);
      }
    }

    // Place bottom-rail badges top-aligned, horizontally centered under their
    // span, then push right in order so each clears the previous (x >= prevRight + 4).
    let prevRight = -Infinity;
    let railBottomMaxBottom = railBottomY;
    let railBottomMaxRight = imgRight;
    for (const item of bottomRail) {
      item.node.y = Math.round(railBottomY);
      let x = Math.round(item.center - item.node.width / 2);
      if (x < prevRight + NUDGE) x = Math.round(prevRight + NUDGE);
      item.node.x = x;
      prevRight = x + item.node.width;
      railBottomMaxBottom = Math.max(railBottomMaxBottom, item.node.y + item.node.height);
      railBottomMaxRight = Math.max(railBottomMaxRight, prevRight);
    }

    // ------------------------------------------------------------------
    // Resize the box to content extents (compute margins AFTER placement).
    // ------------------------------------------------------------------
    const contentLeftEdge = Math.min(imgLeft, leftLineX - TICK / 2, minContentLeft);
    const contentTopEdge = Math.min(imgTop, topLineY - TICK / 2, minContentTop);
    const contentRightEdge = Math.max(imgRight, railRightMaxRight, railBottomMaxRight) + R_SLACK;
    const contentBottomEdge = Math.max(imgBottom, railRightMaxBottom, railBottomMaxBottom) + B_SLACK;

    // Shift every child so the left/top content edge lands at 0, then resize.
    const dx = -Math.min(0, Math.round(contentLeftEdge));
    const dy = -Math.min(0, Math.round(contentTopEdge));
    if (dx !== 0 || dy !== 0) {
      for (const child of box.children) {
        child.x += dx;
        child.y += dy;
      }
    }
    box.resize(
      Math.max(Math.round(contentRightEdge) + dx, 1),
      Math.max(Math.round(contentBottomEdge) + dy, 1),
    );

    // ------------------------------------------------------------------
    // Bindings line — token-first data OFF the diagram (our differentiator).
    // One quiet row: for each measured property, caption + value-or-token.
    // Include padding-x/-y (or per-edge), gap, width/height only when BOUND,
    // and radius ALWAYS (radius no longer appears on the diagram).
    // ------------------------------------------------------------------
    const bindings: LegendEntry[] = [];
    const pushBinding = (caption: string, label: MeasureLabel, onlyBound: boolean): void => {
      if (onlyBound && !label.token) return;
      bindings.push({ caption, label });
    };
    if (hasAutoLayout) {
      const uniform =
        pads.top > 0 && pads.top === pads.right && pads.top === pads.bottom && pads.top === pads.left;
      if (uniform) {
        pushBinding('padding', measureLabel(block.tokens, part, ['padding'], pads.top), false);
      } else {
        if (pads.left > 0 && pads.left === pads.right) {
          pushBinding('padding-x', measureLabel(block.tokens, part, ['padding-x', 'padding'], pads.left), false);
        } else {
          if (pads.left > 0) pushBinding('padding-left', measureLabel(block.tokens, part, ['padding-left', 'padding-x', 'padding'], pads.left), false);
          if (pads.right > 0) pushBinding('padding-right', measureLabel(block.tokens, part, ['padding-right', 'padding-x', 'padding'], pads.right), false);
        }
        if (pads.top > 0 && pads.top === pads.bottom) {
          pushBinding('padding-y', measureLabel(block.tokens, part, ['padding-y', 'padding'], pads.top), false);
        } else {
          if (pads.top > 0) pushBinding('padding-top', measureLabel(block.tokens, part, ['padding-top', 'padding-y', 'padding'], pads.top), false);
          if (pads.bottom > 0) pushBinding('padding-bottom', measureLabel(block.tokens, part, ['padding-bottom', 'padding-y', 'padding'], pads.bottom), false);
        }
      }
      if (gap > 0) pushBinding('gap', measureLabel(block.tokens, part, ['gap'], gap), false);
    }
    pushBinding('width', measureLabel(block.tokens, part, ['width'], component.width), true);
    pushBinding('height', measureLabel(block.tokens, part, ['height'], component.height), true);
    const radius = typeof component.cornerRadius === 'number' ? component.cornerRadius : 0;
    if (radius > 0) pushBinding('radius', measureLabel(block.tokens, part, ['border-radius'], radius), false);

    if (bindings.length) {
      const row = hstack(16);
      row.counterAxisAlignItems = 'CENTER';
      for (const e of bindings) {
        const pair = hstack(6);
        pair.counterAxisAlignItems = 'CENTER';
        const cap = makeText(e.caption, 'Regular', 11, palette.muted, 130);
        cap.textAutoResize = 'WIDTH_AND_HEIGHT';
        pair.appendChild(cap);
        const value = makeText(bindingText(e.label), 'Medium', 11, palette.heading, 130);
        value.textAutoResize = 'WIDTH_AND_HEIGHT';
        pair.appendChild(value);
        row.appendChild(pair);
      }
      card.appendChild(row);
    }

    // ------------------------------------------------------------------
    // Legend — first-level auto-layout parts only (root row excluded).
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
      const legRow = legendRow(childPart, entries);
      legend.appendChild(legRow);
      legRow.layoutSizingHorizontal = 'FILL';
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
