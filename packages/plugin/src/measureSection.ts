/// <reference types="@figma/plugin-typings" />
import { palette, solidFill, vstack, hstack, makeText, hex, matchVariableModes } from './frameKit';
import { measureKey, type MeasureView } from './ui/docModel';

// Spectral "DesignDoc" measure language: ONE unified diagram overlaid on a
// single live component instance. Four rails surround the artwork (top/left =
// total sizes, bottom = padding+gap flow, right = padding+cross-size), and
// translucent bands mark padding/gap regions over the artwork itself. The
// user's lens toggles (block.views) simply hide whichever categories they
// turn off on this ONE diagram — there is no per-lens diagram anymore, and
// overlap between categories is acceptable by design (the toggles are the
// decluttering mechanism, not layout collision avoidance). Three fixed
// semantic colors carry meaning:
const SIZE_RED: RGB = hex('#f24822'); // sizes: total height, child widths, child cross-height
const PAD_BLUE: RGB = hex('#2979ff'); // padding
const GAP_PINK: RGB = hex('#ec4899'); // gaps
const WHITE: RGB = hex('#ffffff'); // badge text

const IMG_MAX_H = 480;
const CARD_PAD = 24;

// Initial placement offsets for the scaled image inside the (oversized) box.
// After all rails/bands are drawn, the box is re-normalized to the TRUE
// bounding box of its contents (see buildDiagram), so these are only starting
// room for the top/left rails — the final margins come from that pass.
const M_TOP = 44;
const M_LEFT = 64;

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
  views: MeasureView[];
}

/** A measured value with its optional bound token. `value` is the raw px string
 *  shown in badges; `token` (when present) drives both the badge's inline short
 *  form (padding/gap) and the quiet bindings line (radius, and any full path a
 *  badge abbreviated). */
type MeasureLabel = { value: string; token: string | null };

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

/** `radius rounded-8 · 8` / `spacing/size-12 · 8` — full token path, for the
 *  bindings line only. All rail badges show plain numbers; token names live on
 *  this bindings line, so badges stay narrow and glued to the spans they mark. */
function bindingText(label: MeasureLabel): string {
  return label.token ? `${label.token} · ${label.value}` : label.value;
}

// ---------------------------------------------------------------------------
// Primitive builders
// ---------------------------------------------------------------------------

/** A solid rounded value badge: fill = color, white 11 Bold text, hug-sized. */
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
// Legend (first-level parts) — unchanged.
// ---------------------------------------------------------------------------

interface LegendEntry {
  caption: string;
  label: MeasureLabel;
}

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

/** Build the first-level auto-layout parts legend (rendered once). Returns null
 *  when no part has measurable auto-layout entries. */
function buildLegend(component: ComponentNode, tokens: Record<string, string>): FrameNode | null {
  const legend = vstack(10);
  for (const child of component.children) {
    if (!child.visible) continue;
    if (child.type !== 'FRAME' && child.type !== 'INSTANCE' && child.type !== 'COMPONENT') continue;
    const layoutChild = child;
    if (layoutChild.layoutMode !== 'HORIZONTAL' && layoutChild.layoutMode !== 'VERTICAL') continue;
    const childPart = child.name.replace(/#+\s*$/, '').trim();
    const entries = partEntries(tokens, childPart, layoutChild);
    if (!entries.length) continue;
    const legRow = legendRow(childPart, entries);
    legend.appendChild(legRow);
    legRow.layoutSizingHorizontal = 'FILL';
  }
  if (legend.children.length === 0) {
    legend.remove();
    return null;
  }
  return legend;
}

// ---------------------------------------------------------------------------
// Diagram geometry
// ---------------------------------------------------------------------------

/** A visible child's scaled box-local bounds (main-axis start, cross start, w, h). */
interface Child {
  x1: number;
  y1: number;
  w: number;
  h: number;
}

/** Everything the rail placement needs: rail items with their desired centers. */
interface RailItem {
  node: FrameNode;
  center: number; // desired center along the axis (y for right/left, x for top/bottom)
}

/** Geometry for the single shared instance: scaled image edges, padding,
 *  layout mode, children, and gap spans. */
interface ViewGeom {
  imgLeft: number; imgTop: number; imgRight: number; imgBottom: number;
  imgW: number; imgH: number;
  scale: number;
  padTs: number; padRs: number; padBs: number; padLs: number;
  pads: { top: number; right: number; bottom: number; left: number };
  hasAutoLayout: boolean;
  horizontal: boolean;
  gap: number;
  kids: Child[];
  gaps: { start: number; end: number }[];
}

/** Compute the view geometry for an instance already placed at (M_LEFT, M_TOP). */
function computeGeom(
  component: ComponentNode,
  scale: number,
  mLeft: number,
  mTop: number,
): ViewGeom {
  const imgW = component.width * scale;
  const imgH = component.height * scale;
  const imgLeft = mLeft;
  const imgTop = mTop;
  const imgRight = mLeft + imgW;
  const imgBottom = mTop + imgH;

  const pads = {
    top: component.paddingTop ?? 0,
    right: component.paddingRight ?? 0,
    bottom: component.paddingBottom ?? 0,
    left: component.paddingLeft ?? 0,
  };
  const hasAutoLayout = component.layoutMode === 'HORIZONTAL' || component.layoutMode === 'VERTICAL';
  const horizontal = component.layoutMode === 'HORIZONTAL';
  const gap = hasAutoLayout ? component.itemSpacing : 0;

  const kids: Child[] = component.children
    .filter((c) => c.visible)
    .map((c) => ({
      x1: imgLeft + c.x * scale,
      y1: imgTop + c.y * scale,
      w: c.width * scale,
      h: c.height * scale,
    }));

  const gaps: { start: number; end: number }[] = [];
  if (hasAutoLayout && gap > 0 && kids.length > 1) {
    for (let i = 0; i + 1 < kids.length; i++) {
      const a = kids[i];
      const b = kids[i + 1];
      if (horizontal) {
        const gs = a.x1 + a.w;
        const ge = b.x1;
        if (ge > gs) gaps.push({ start: gs, end: ge });
      } else {
        const gs = a.y1 + a.h;
        const ge = b.y1;
        if (ge > gs) gaps.push({ start: gs, end: ge });
      }
    }
  }

  return {
    imgLeft, imgTop, imgRight, imgBottom, imgW, imgH, scale,
    padTs: pads.top * scale, padRs: pads.right * scale,
    padBs: pads.bottom * scale, padLs: pads.left * scale,
    pads, hasAutoLayout, horizontal, gap, kids, gaps,
  };
}

/** Place a top-to-bottom rail: badges left-aligned at `railX`, each centered on
 *  its region. No vertical spreading — on short components the padding/size
 *  badges overlap each other rather than drift away from what they mark (and,
 *  critically, they don't spill down into the bottom rail). Overlap between
 *  badges is acceptable; the lens toggles are the decluttering mechanism. */
function placeRightRail(items: RailItem[], railX: number): void {
  for (const item of items) {
    item.node.x = Math.round(railX);
    item.node.y = Math.round(item.center - item.node.height / 2);
  }
}

/** Place a left-to-right rail: badges top-aligned at `railY`, horizontally
 *  centered under their span, pushed right so each clears the previous. */
function placeBottomRail(items: RailItem[], railY: number, imgRight: number): { maxRight: number; maxBottom: number } {
  let prevRight = -Infinity;
  let maxBottom = railY;
  let maxRight = imgRight;
  for (const item of items) {
    item.node.y = Math.round(railY);
    let x = Math.round(item.center - item.node.width / 2);
    if (x < prevRight + NUDGE) x = Math.round(prevRight + NUDGE);
    item.node.x = x;
    prevRight = x + item.node.width;
    maxBottom = Math.max(maxBottom, item.node.y + item.node.height);
    maxRight = Math.max(maxRight, prevRight);
  }
  return { maxRight, maxBottom };
}

// ---------------------------------------------------------------------------
// The single unified diagram.
// ---------------------------------------------------------------------------

/**
 * Build the ONE Spectral 4-rail measure diagram. `views` filters which
 * categories draw:
 *  - 'size'    -> top+left total-dimension rails, red child-size badges (top
 *                 rail for horizontal main axis / left rail for vertical main
 *                 axis), and the red child cross-size badge on the opposite
 *                 cross rail.
 *  - 'padding' -> blue translucent padding bands + blue pad badges on the
 *                 main-axis flow rail (bottom/right) and the cross rail.
 *  - 'spacing' -> pink translucent gap bands + dashed red child outlines
 *                 (>1 child) + pink gap badges on the main-axis flow rail.
 * With no auto-layout root, only total width/height (size) ever draw.
 */
function buildDiagram(
  component: ComponentNode,
  inst: InstanceNode,
  tokens: Record<string, string>,
  part: string,
  scale: number,
  views: Set<MeasureView>,
): FrameNode {
  const showSize = views.has('size');
  const showPadding = views.has('padding');
  const showSpacing = views.has('spacing');

  const box = figma.createFrame();
  box.name = 'Measure diagram';
  box.resize(2000, 2000);
  box.fills = [];
  box.clipsContent = false;
  box.appendChild(inst);
  inst.x = M_LEFT;
  inst.y = M_TOP;
  const g = computeGeom(component, scale, M_LEFT, M_TOP);

  // -------------------------------------------------------------------
  // Over-artwork bands (padding + gaps), drawn above the instance.
  // -------------------------------------------------------------------
  if (showPadding && g.hasAutoLayout) {
    if (g.padTs > 0) {
      box.appendChild(band(g.imgLeft, g.imgTop, g.imgW, g.padTs, PAD_BLUE));
      box.appendChild(dashedLine(g.imgLeft, g.imgTop + g.padTs, g.imgW, 1, PAD_BLUE, EDGE_OPACITY));
    }
    if (g.padBs > 0) {
      box.appendChild(band(g.imgLeft, g.imgBottom - g.padBs, g.imgW, g.padBs, PAD_BLUE));
      box.appendChild(dashedLine(g.imgLeft, g.imgBottom - g.padBs, g.imgW, 1, PAD_BLUE, EDGE_OPACITY));
    }
    if (g.padLs > 0) {
      box.appendChild(band(g.imgLeft, g.imgTop, g.padLs, g.imgH, PAD_BLUE));
      box.appendChild(dashedLine(g.imgLeft + g.padLs, g.imgTop, 1, g.imgH, PAD_BLUE, EDGE_OPACITY));
    }
    if (g.padRs > 0) {
      box.appendChild(band(g.imgRight - g.padRs, g.imgTop, g.padRs, g.imgH, PAD_BLUE));
      box.appendChild(dashedLine(g.imgRight - g.padRs, g.imgTop, 1, g.imgH, PAD_BLUE, EDGE_OPACITY));
    }
  }

  if (showSpacing && g.hasAutoLayout) {
    for (const gp of g.gaps) {
      if (g.horizontal) {
        box.appendChild(band(gp.start, g.imgTop, gp.end - gp.start, g.imgH, GAP_PINK));
        box.appendChild(dashedLine(gp.start, g.imgTop, 1, g.imgH, GAP_PINK, EDGE_OPACITY));
        box.appendChild(dashedLine(gp.end, g.imgTop, 1, g.imgH, GAP_PINK, EDGE_OPACITY));
      } else {
        box.appendChild(band(g.imgLeft, gp.start, g.imgW, gp.end - gp.start, GAP_PINK));
        box.appendChild(dashedLine(g.imgLeft, gp.start, g.imgW, 1, GAP_PINK, EDGE_OPACITY));
        box.appendChild(dashedLine(g.imgLeft, gp.end, g.imgW, 1, GAP_PINK, EDGE_OPACITY));
      }
    }
    // Dashed child outlines (SPACING owns gaps + outlines).
    if (g.kids.length > 1) {
      for (const k of g.kids) box.appendChild(outline(k.x1, k.y1, k.w, k.h));
    }
  }

  // -------------------------------------------------------------------
  // TOP / LEFT rails — total dimensions (SIZE), plus main-axis child sizes on
  // whichever of top/left carries the main axis.
  // -------------------------------------------------------------------
  if (showSize) {
    // Top rail: total-width hairline + centered badge (or per-child badges
    // when the main axis is horizontal).
    const topLineY = g.imgTop - RAIL_TOP_OFF;
    box.appendChild(line(g.imgLeft, topLineY, g.imgW, 1, SIZE_RED));
    box.appendChild(line(g.imgLeft, topLineY - TICK / 2, 1, TICK, SIZE_RED));
    box.appendChild(line(g.imgRight - 1, topLineY - TICK / 2, 1, TICK, SIZE_RED));

    if (g.hasAutoLayout && g.horizontal && g.kids.length > 0) {
      // Main axis horizontal: one red width badge per visible child.
      const rail: RailItem[] = [];
      for (const k of g.kids) {
        const b = badge(String(round(k.w / scale)), SIZE_RED);
        box.appendChild(b);
        rail.push({ node: b, center: k.x1 + k.w / 2 });
      }
      // Badges sit above the hairline, centered on each child, nudged right to
      // clear the previous one.
      let prevRight = -Infinity;
      for (const item of rail) {
        let x = Math.round(item.center - item.node.width / 2);
        if (x < prevRight + NUDGE) x = Math.round(prevRight + NUDGE);
        item.node.x = x;
        item.node.y = Math.round(topLineY - LINE_GAP - item.node.height);
        prevRight = x + item.node.width;
      }
    } else {
      // Main axis vertical (or no auto-layout): single centered total-width badge.
      const widthBadge = badge(measureLabel(tokens, part, ['width'], component.width).value, SIZE_RED);
      box.appendChild(widthBadge);
      widthBadge.x = Math.round((g.imgLeft + g.imgRight) / 2 - widthBadge.width / 2);
      widthBadge.y = Math.round(topLineY - LINE_GAP - widthBadge.height);
    }

    // Left rail: total-height hairline + centered badge (or per-child badges
    // when the main axis is vertical).
    const leftLineX = g.imgLeft - RAIL_LEFT_OFF;
    box.appendChild(line(leftLineX, g.imgTop, 1, g.imgH, SIZE_RED));
    box.appendChild(line(leftLineX - TICK / 2, g.imgTop, TICK, 1, SIZE_RED));
    box.appendChild(line(leftLineX - TICK / 2, g.imgBottom - 1, TICK, 1, SIZE_RED));

    if (g.hasAutoLayout && !g.horizontal && g.kids.length > 0) {
      // Main axis vertical: one red height badge per visible child.
      const rail: RailItem[] = [];
      for (const k of g.kids) {
        const b = badge(String(round(k.h / scale)), SIZE_RED);
        box.appendChild(b);
        rail.push({ node: b, center: k.y1 + k.h / 2 });
      }
      let prevBottom = -Infinity;
      for (const item of rail) {
        let y = Math.round(item.center - item.node.height / 2);
        if (y < prevBottom + NUDGE) y = Math.round(prevBottom + NUDGE);
        item.node.y = y;
        item.node.x = Math.round(leftLineX - LINE_GAP - item.node.width);
        prevBottom = y + item.node.height;
      }
    } else {
      // Main axis horizontal (or no auto-layout): single centered total-height badge.
      const heightBadge = badge(measureLabel(tokens, part, ['height'], component.height).value, SIZE_RED);
      box.appendChild(heightBadge);
      heightBadge.x = Math.round(leftLineX - LINE_GAP - heightBadge.width);
      heightBadge.y = Math.round((g.imgTop + g.imgBottom) / 2 - heightBadge.height / 2);
    }
  }

  // -------------------------------------------------------------------
  // BOTTOM rail — horizontal main axis: pad-left, gaps, pad-right (flow).
  // Vertical main axis: pad-left, content width, pad-right (cross flow).
  // -------------------------------------------------------------------
  if (g.hasAutoLayout && g.horizontal && (showPadding || showSpacing)) {
    const railBottomY = g.imgBottom + RAIL_BOTTOM_OFF;
    const rail: RailItem[] = [];
    if (showPadding && g.pads.left > 0) {
      const b = badge(String(round(g.pads.left)), PAD_BLUE);
      box.appendChild(b);
      rail.push({ node: b, center: g.imgLeft + g.padLs / 2 });
    }
    if (showSpacing) {
      for (const gp of g.gaps) {
        const b = badge(String(round(g.gap)), GAP_PINK);
        box.appendChild(b);
        rail.push({ node: b, center: (gp.start + gp.end) / 2 });
      }
    }
    if (showPadding && g.pads.right > 0) {
      const b = badge(String(round(g.pads.right)), PAD_BLUE);
      box.appendChild(b);
      rail.push({ node: b, center: g.imgRight - g.padRs / 2 });
    }
    placeBottomRail(rail, railBottomY, g.imgRight);
  } else if (g.hasAutoLayout && !g.horizontal && (showPadding || showSize)) {
    // Vertical main axis: bottom rail shows pad-left, content width (red,
    // SIZE), pad-right. Gaps live on the right rail alongside the vertical
    // flow, not here.
    const railBottomY = g.imgBottom + RAIL_BOTTOM_OFF;
    const rail: RailItem[] = [];
    if (showPadding && g.pads.left > 0) {
      const b = badge(String(round(g.pads.left)), PAD_BLUE);
      box.appendChild(b);
      rail.push({ node: b, center: g.imgLeft + g.padLs / 2 });
    }
    if (showSize) {
      const contentLeft = g.imgLeft + g.padLs;
      const contentRight = g.imgRight - g.padRs;
      const contentW = round(component.width - g.pads.left - g.pads.right);
      const b = badge(String(contentW), SIZE_RED);
      box.appendChild(b);
      rail.push({ node: b, center: (contentLeft + contentRight) / 2 });
    }
    if (showPadding && g.pads.right > 0) {
      const b = badge(String(round(g.pads.right)), PAD_BLUE);
      box.appendChild(b);
      rail.push({ node: b, center: g.imgRight - g.padRs / 2 });
    }
    placeBottomRail(rail, railBottomY, g.imgRight);
  }

  // -------------------------------------------------------------------
  // RIGHT rail — padding + cross-size when horizontal main axis; padding +
  // vertical flow (pad-top, gaps, pad-bottom) when vertical main axis.
  // -------------------------------------------------------------------
  if (g.hasAutoLayout && g.horizontal && (showPadding || showSize)) {
    const railRightX = g.imgRight + RAIL_RIGHT_OFF;
    const rail: RailItem[] = [];
    if (showPadding && g.pads.top > 0) {
      const b = badge(String(round(g.pads.top)), PAD_BLUE);
      box.appendChild(b);
      rail.push({ node: b, center: g.imgTop + g.padTs / 2 });
    }
    if (showSize && g.kids.length > 0) {
      // Cross-axis child height: collapse to one representative badge centered
      // on the content band (children share the cross size in practice).
      const contentTop = g.imgTop + g.padTs;
      const contentBottom = g.imgBottom - g.padBs;
      const crossH = round((component.height - g.pads.top - g.pads.bottom));
      const b = badge(String(crossH), SIZE_RED);
      box.appendChild(b);
      rail.push({ node: b, center: (contentTop + contentBottom) / 2 });
    }
    if (showPadding && g.pads.bottom > 0) {
      const b = badge(String(round(g.pads.bottom)), PAD_BLUE);
      box.appendChild(b);
      rail.push({ node: b, center: g.imgBottom - g.padBs / 2 });
    }
    placeRightRail(rail, railRightX);
  } else if (g.hasAutoLayout && !g.horizontal && (showPadding || showSpacing)) {
    const railRightX = g.imgRight + RAIL_RIGHT_OFF;
    const rail: RailItem[] = [];
    if (showPadding && g.pads.top > 0) {
      const b = badge(String(round(g.pads.top)), PAD_BLUE);
      box.appendChild(b);
      rail.push({ node: b, center: g.imgTop + g.padTs / 2 });
    }
    if (showSpacing) {
      for (const gp of g.gaps) {
        const b = badge(String(round(g.gap)), GAP_PINK);
        box.appendChild(b);
        rail.push({ node: b, center: (gp.start + gp.end) / 2 });
      }
    }
    if (showPadding && g.pads.bottom > 0) {
      const b = badge(String(round(g.pads.bottom)), PAD_BLUE);
      box.appendChild(b);
      rail.push({ node: b, center: g.imgBottom - g.padBs / 2 });
    }
    placeRightRail(rail, railRightX);
  }
  // No auto-layout root: right rail carries nothing extra — total width/height
  // on the top/left rails are the only SIZE measurements available.

  // -------------------------------------------------------------------
  // Normalize to the TRUE bounding box of everything placed, with uniform
  // slack. A rail badge centered on a narrow span (left-padding, a gap) can
  // extend left of / above the image; the earlier min/max tracking only ever
  // grew rightward/downward, so that overflow spilled outside the box and made
  // the centered card look offset. This pass wraps whatever actually got drawn.
  const S = 8; // uniform slack around the content bounding box
  let bbL = Infinity;
  let bbT = Infinity;
  let bbR = -Infinity;
  let bbB = -Infinity;
  for (const child of box.children) {
    bbL = Math.min(bbL, child.x);
    bbT = Math.min(bbT, child.y);
    bbR = Math.max(bbR, child.x + child.width);
    bbB = Math.max(bbB, child.y + child.height);
  }
  if (!isFinite(bbL)) {
    bbL = 0; bbT = 0; bbR = 1; bbB = 1;
  }
  const dx = Math.round(S - bbL);
  const dy = Math.round(S - bbT);
  for (const child of box.children) {
    child.x += dx;
    child.y += dy;
  }
  box.resize(
    Math.max(Math.round(bbR - bbL) + 2 * S, 1),
    Math.max(Math.round(bbB - bbT) + 2 * S, 1),
  );

  return box;
}

// ---------------------------------------------------------------------------
// Bindings line
// ---------------------------------------------------------------------------

/** Build the quiet bindings line beneath the diagram: radius (always, when
 *  present) plus any full padding/gap token path — kept minimal since the
 *  abbreviated short form already appears inline on the badges. */
function buildBindingsRow(component: ComponentNode, tokens: Record<string, string>, part: string): FrameNode | null {
  const pads = {
    top: component.paddingTop ?? 0,
    right: component.paddingRight ?? 0,
    bottom: component.paddingBottom ?? 0,
    left: component.paddingLeft ?? 0,
  };
  const hasAutoLayout = component.layoutMode === 'HORIZONTAL' || component.layoutMode === 'VERTICAL';
  const gap = hasAutoLayout ? component.itemSpacing : 0;

  const bindings: LegendEntry[] = [];
  // Padding tokens live here now: the rail badges show only the number (matching
  // the reference), so their token names surface on this quiet line. Uniform
  // padding collapses to one `padding`, else symmetric x/y pairs.
  if (hasAutoLayout) {
    if (
      pads.top === pads.bottom &&
      pads.left === pads.right &&
      pads.top === pads.left &&
      pads.top > 0
    ) {
      bindings.push({ caption: 'padding', label: measureLabel(tokens, part, ['padding'], pads.top) });
    } else {
      if (pads.left > 0 && pads.left === pads.right) {
        bindings.push({ caption: 'padding-x', label: measureLabel(tokens, part, ['padding-x', 'padding'], pads.left) });
      }
      if (pads.top > 0 && pads.top === pads.bottom) {
        bindings.push({ caption: 'padding-y', label: measureLabel(tokens, part, ['padding-y', 'padding'], pads.top) });
      }
    }
    if (gap > 0) {
      bindings.push({ caption: 'gap', label: measureLabel(tokens, part, ['gap'], gap) });
    }
  }
  const radius = typeof component.cornerRadius === 'number' ? component.cornerRadius : 0;
  if (radius > 0) {
    bindings.push({ caption: 'radius', label: measureLabel(tokens, part, ['border-radius'], radius) });
  }

  if (!bindings.length) return null;
  const row = hstack(16);
  row.counterAxisAlignItems = 'CENTER';
  row.layoutWrap = 'WRAP';
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
  return row;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Build the token-aware measure section as ONE unified Spectral 4-rail
 * diagram: a screenshot-scale live instance with the artwork left untouched,
 * translucent bands (blue padding, pink gap) with dashed inner edges layered
 * over it, dashed red child outlines, and solid colored value badges (red =
 * size, blue = padding, pink = gap) arranged in rails OUTSIDE the artwork —
 * top = child sizes / total width, left = total height / child sizes,
 * bottom = padding+gap flow, right = padding + cross-size. `block.views`
 * (the lens toggles) filters which categories draw on this single diagram;
 * overlap between categories is expected and acceptable — the toggles are
 * the decluttering mechanism. Beneath the diagram, a quiet bindings line
 * carries radius; a per-part legend for first-level auto-layout parts sits
 * below that.
 *
 * Returns null when the diagram can't be built (component missing, not a
 * COMPONENT, or any layout error) so the caller falls back to a plain table.
 * Any created instance is removed before returning null so the canvas is
 * never left with an orphaned node.
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

  const views = new Set<MeasureView>(
    block.views && block.views.length ? block.views : (['size', 'padding', 'spacing'] as MeasureView[]),
  );
  const part = block.rootPart;

  let inst: InstanceNode;
  try {
    inst = component.createInstance();
  } catch {
    return null;
  }

  // Everything after the instance exists is wrapped so any Figma-API throw
  // (resize/rescale/layout) cleans up the instance and falls back to the table.
  try {
    // Match the component's variable modes so the instance resolves the SAME
    // padding/gap/size tokens (else a differing density mode renders it
    // narrower and the annotations, computed from the component, overhang it).
    await matchVariableModes(inst, component);

    const innerMax = 880 - 56 * 2 - CARD_PAD * 2 - (M_LEFT + 160);
    const scale = Math.min(innerMax / inst.width, IMG_MAX_H / inst.height, 1);
    if (scale !== 1) inst.rescale(scale);

    let box: FrameNode;
    try {
      box = buildDiagram(component, inst, block.tokens, part, scale, views);
    } catch {
      // Diagram build failed: clean up the instance (still attached to no
      // parent frame yet, or attached to a partial box we also discard).
      try {
        inst.remove();
      } catch { /* already gone */ }
      return null;
    }

    // Card (same visual language as the anatomy card).
    const card = vstack(20);
    card.paddingTop = card.paddingBottom = card.paddingLeft = card.paddingRight = CARD_PAD;
    card.fills = solidFill(palette.paneBg);
    card.cornerRadius = 8;
    card.strokes = solidFill(palette.border);
    card.strokeWeight = 1;
    card.counterAxisAlignItems = 'CENTER';
    card.appendChild(box);

    const bindings = buildBindingsRow(component, block.tokens, part);
    if (bindings) card.appendChild(bindings);
    const legend = buildLegend(component, block.tokens);
    if (legend) {
      card.appendChild(legend);
      legend.layoutSizingHorizontal = 'FILL';
    }

    return card;
  } catch {
    // Unexpected throw during composition: tear down the instance so the
    // canvas is never littered.
    try {
      inst.remove();
    } catch { /* already gone */ }
    return null;
  }
}
