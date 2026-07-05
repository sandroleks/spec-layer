/// <reference types="@figma/plugin-typings" />
import { palette, solidFill, vstack, hstack, makeText, hex } from './frameKit';
import { measureKey, type MeasureView } from './ui/docModel';

// Spectral "DesignDoc" measure language, now split into user-selectable lenses:
// each measurement type (size / padding / spacing) renders as its OWN focused
// mini-diagram, arranged in a wrapping row so they sit side by side. A live
// instance sits inside each diagram with the artwork left untouched; measured
// values are solid colored badges arranged in tidy rails OUTSIDE the artwork.
// Translucent full-span bands with dashed inner edges mark padding and gap
// regions over the artwork; dashed outlines mark children. Three fixed semantic
// colors carry meaning:
const SIZE_RED: RGB = hex('#f24822'); // container + child sizes
const PAD_PINK: RGB = hex('#ec4899'); // padding
const GAP_BLUE: RGB = hex('#2979ff'); // gaps
const WHITE: RGB = hex('#ffffff'); // badge text

// Per-instance image cap: full height when a single lens renders, capped when
// two or more sit side by side so the wrapping row stays readable.
const IMG_MAX_H_SINGLE = 480;
const IMG_MAX_H_MULTI = 220;
const CARD_PAD = 24;

// Rail geometry.
const RAIL_TOP_OFF = 18; // total-width hairline offset above the image
const RAIL_LEFT_OFF = 18; // total-height hairline offset left of the image
const RAIL_RIGHT_OFF = 16; // right-rail badge left edge, right of the image
const RAIL_BOTTOM_OFF = 16; // bottom-rail badge top edge, below the image
const TICK = 6; // end-tick length on the total-dimension hairlines
const LINE_GAP = 4; // gap between a rail badge and its hairline
const NUDGE = 4; // minimum gap enforced between adjacent rail badges
const R_SLACK = 8; // extra room right of the widest right-rail badge
const B_SLACK = 8; // extra room below the bottom-rail badges

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
 *  shown in badges; `token` (when present) drives the token-first bindings line. */
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
// Legend (first-level parts) — rendered once beneath the wrap row.
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
// Per-view diagram geometry
// ---------------------------------------------------------------------------

/** A visible child's scaled box-local bounds (main-axis start, cross start, w, h). */
interface Child {
  x1: number;
  y1: number;
  w: number;
  h: number;
}

/** Everything a rail placement needs: rail items with their desired centers. */
interface RailItem {
  node: FrameNode;
  center: number; // desired center along the axis (y for right, x for bottom)
}

/** Geometry shared by all views for one instance: scaled image edges, padding,
 *  layout mode, children, and gap spans. Computed once per view (each view has
 *  its own instance, so its own scale). */
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

/** Resize a diagram box to its content extents (accounting for negative-extent
 *  rail badges), then shift every child so the left/top content edge lands at 0.
 *  `extraLeft`/`extraTop`/`extraRight`/`extraBottom` are the outermost graphic
 *  edges the caller computed while placing rails. */
function fitBox(
  box: FrameNode,
  g: ViewGeom,
  extraLeft: number,
  extraTop: number,
  extraRight: number,
  extraBottom: number,
): void {
  const contentLeftEdge = Math.min(g.imgLeft, extraLeft);
  const contentTopEdge = Math.min(g.imgTop, extraTop);
  const contentRightEdge = Math.max(g.imgRight, extraRight) + R_SLACK;
  const contentBottomEdge = Math.max(g.imgBottom, extraBottom) + B_SLACK;

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
}

/** Place a top-to-bottom rail: badges left-aligned at `railX`, vertically
 *  centered on their band, pushed down so each clears the previous. Returns the
 *  rail's max right + max bottom for extent math. */
function placeRightRail(items: RailItem[], railX: number, imgBottom: number): { maxRight: number; maxBottom: number } {
  let prevBottom = -Infinity;
  let maxRight = railX;
  let maxBottom = imgBottom;
  for (const item of items) {
    item.node.x = Math.round(railX);
    let y = Math.round(item.center - item.node.height / 2);
    if (y < prevBottom + NUDGE) y = Math.round(prevBottom + NUDGE);
    item.node.y = y;
    prevBottom = y + item.node.height;
    maxRight = Math.max(maxRight, item.node.x + item.node.width);
    maxBottom = Math.max(maxBottom, prevBottom);
  }
  return { maxRight, maxBottom };
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
// The three lenses. Each builds ONE diagram box for a freshly created instance.
// Returns null when the view is not applicable (e.g. spacing on a component with
// no auto-layout / no children). The caller owns instance cleanup on failure.
// ---------------------------------------------------------------------------

/** SIZE: instance + top width hairline/ticks + red width badge + left height
 *  hairline/ticks + red height badge. Nothing else. */
function buildSizeView(component: ComponentNode, inst: InstanceNode, tokens: Record<string, string>, part: string, scale: number): FrameNode {
  // Margins: top 44, left 64; right/bottom slack applied via fitBox (R/B_SLACK).
  const M_TOP = 44, M_LEFT = 64;
  const box = figma.createFrame();
  box.name = 'Measure — size';
  box.resize(2000, 2000);
  box.fills = [];
  box.clipsContent = false;
  box.appendChild(inst);
  inst.x = M_LEFT;
  inst.y = M_TOP;
  const g = computeGeom(component, scale, M_LEFT, M_TOP);

  // Top rail — total width hairline + centered width badge.
  const topLineY = g.imgTop - RAIL_TOP_OFF;
  box.appendChild(line(g.imgLeft, topLineY, g.imgW, 1, SIZE_RED));
  box.appendChild(line(g.imgLeft, topLineY - TICK / 2, 1, TICK, SIZE_RED));
  box.appendChild(line(g.imgRight - 1, topLineY - TICK / 2, 1, TICK, SIZE_RED));
  const widthBadge = badge(measureLabel(tokens, part, ['width'], component.width).value, SIZE_RED);
  box.appendChild(widthBadge);
  widthBadge.x = Math.round((g.imgLeft + g.imgRight) / 2 - widthBadge.width / 2);
  widthBadge.y = Math.round(topLineY - LINE_GAP - widthBadge.height);

  // Left rail — total height hairline + centered height badge.
  const leftLineX = g.imgLeft - RAIL_LEFT_OFF;
  box.appendChild(line(leftLineX, g.imgTop, 1, g.imgH, SIZE_RED));
  box.appendChild(line(leftLineX - TICK / 2, g.imgTop, TICK, 1, SIZE_RED));
  box.appendChild(line(leftLineX - TICK / 2, g.imgBottom - 1, TICK, 1, SIZE_RED));
  const heightBadge = badge(measureLabel(tokens, part, ['height'], component.height).value, SIZE_RED);
  box.appendChild(heightBadge);
  heightBadge.x = Math.round(leftLineX - LINE_GAP - heightBadge.width);
  heightBadge.y = Math.round((g.imgTop + g.imgBottom) / 2 - heightBadge.height / 2);

  fitBox(
    box, g,
    Math.min(leftLineX - TICK / 2, heightBadge.x),
    Math.min(topLineY - TICK / 2, widthBadge.y),
    g.imgRight,
    g.imgBottom,
  );
  return box;
}

/** PADDING: instance + pink padding bands with dashed inner-edge lines + pink
 *  badges on the right rail (padT/padB) and bottom rail (padL/padR). No
 *  width/height lines, no child outlines, no gaps. */
function buildPaddingView(component: ComponentNode, inst: InstanceNode, tokens: Record<string, string>, part: string, scale: number): FrameNode | null {
  const M_TOP = 8, M_LEFT = 8;
  const box = figma.createFrame();
  box.name = 'Measure — padding';
  box.resize(2000, 2000);
  box.fills = [];
  box.clipsContent = false;
  box.appendChild(inst);
  inst.x = M_LEFT;
  inst.y = M_TOP;
  const g = computeGeom(component, scale, M_LEFT, M_TOP);

  // No padding at all → nothing to show for this lens; skip it.
  if (!g.hasAutoLayout || (g.pads.top <= 0 && g.pads.right <= 0 && g.pads.bottom <= 0 && g.pads.left <= 0)) {
    return null;
  }

  // Pink padding bands with dashed inner edges.
  if (g.padTs > 0) {
    box.appendChild(band(g.imgLeft, g.imgTop, g.imgW, g.padTs, PAD_PINK));
    box.appendChild(dashedLine(g.imgLeft, g.imgTop + g.padTs, g.imgW, 1, PAD_PINK, EDGE_OPACITY));
  }
  if (g.padBs > 0) {
    box.appendChild(band(g.imgLeft, g.imgBottom - g.padBs, g.imgW, g.padBs, PAD_PINK));
    box.appendChild(dashedLine(g.imgLeft, g.imgBottom - g.padBs, g.imgW, 1, PAD_PINK, EDGE_OPACITY));
  }
  if (g.padLs > 0) {
    box.appendChild(band(g.imgLeft, g.imgTop, g.padLs, g.imgH, PAD_PINK));
    box.appendChild(dashedLine(g.imgLeft + g.padLs, g.imgTop, 1, g.imgH, PAD_PINK, EDGE_OPACITY));
  }
  if (g.padRs > 0) {
    box.appendChild(band(g.imgRight - g.padRs, g.imgTop, g.padRs, g.imgH, PAD_PINK));
    box.appendChild(dashedLine(g.imgRight - g.padRs, g.imgTop, 1, g.imgH, PAD_PINK, EDGE_OPACITY));
  }

  // Right rail — padT / padB badges (vertical padding).
  const railRightX = g.imgRight + RAIL_RIGHT_OFF;
  const rightRail: RailItem[] = [];
  if (g.pads.top > 0) {
    const b = badge(measureLabel(tokens, part, ['padding-top', 'padding-y', 'padding'], g.pads.top).value, PAD_PINK);
    box.appendChild(b);
    rightRail.push({ node: b, center: g.imgTop + g.padTs / 2 });
  }
  if (g.pads.bottom > 0) {
    const b = badge(measureLabel(tokens, part, ['padding-bottom', 'padding-y', 'padding'], g.pads.bottom).value, PAD_PINK);
    box.appendChild(b);
    rightRail.push({ node: b, center: g.imgBottom - g.padBs / 2 });
  }
  const rr = placeRightRail(rightRail, railRightX, g.imgBottom);

  // Bottom rail — padL / padR badges (horizontal padding).
  const railBottomY = g.imgBottom + RAIL_BOTTOM_OFF;
  const bottomRail: RailItem[] = [];
  if (g.pads.left > 0) {
    const b = badge(measureLabel(tokens, part, ['padding-left', 'padding-x', 'padding'], g.pads.left).value, PAD_PINK);
    box.appendChild(b);
    bottomRail.push({ node: b, center: g.imgLeft + g.padLs / 2 });
  }
  if (g.pads.right > 0) {
    const b = badge(measureLabel(tokens, part, ['padding-right', 'padding-x', 'padding'], g.pads.right).value, PAD_PINK);
    box.appendChild(b);
    bottomRail.push({ node: b, center: g.imgRight - g.padRs / 2 });
  }
  const br = placeBottomRail(bottomRail, railBottomY, g.imgRight);

  fitBox(
    box, g,
    g.imgLeft,
    g.imgTop,
    Math.max(rr.maxRight, br.maxRight),
    Math.max(rr.maxBottom, br.maxBottom),
  );
  return box;
}

/** SPACING: instance + blue gap bands + dashed red child outlines (>1 child) +
 *  the layout-axis rhythm rail WITHOUT padding entries. Horizontal → bottom rail
 *  [childW][gap][childW]…; vertical → right rail [childH][gap]…. Only meaningful
 *  when the root has auto-layout and ≥1 visible child; otherwise null. */
function buildSpacingView(component: ComponentNode, inst: InstanceNode, scale: number): FrameNode | null {
  const M_TOP = 8, M_LEFT = 8;
  const box = figma.createFrame();
  box.name = 'Measure — spacing';
  box.resize(2000, 2000);
  box.fills = [];
  box.clipsContent = false;
  box.appendChild(inst);
  inst.x = M_LEFT;
  inst.y = M_TOP;
  const g = computeGeom(component, scale, M_LEFT, M_TOP);

  if (!g.hasAutoLayout || g.kids.length < 1) return null;

  // Gap bands between consecutive children, full cross span, dashed edges.
  for (const gp of g.gaps) {
    if (g.horizontal) {
      box.appendChild(band(gp.start, g.imgTop, gp.end - gp.start, g.imgH, GAP_BLUE));
      box.appendChild(dashedLine(gp.start, g.imgTop, 1, g.imgH, GAP_BLUE, EDGE_OPACITY));
      box.appendChild(dashedLine(gp.end, g.imgTop, 1, g.imgH, GAP_BLUE, EDGE_OPACITY));
    } else {
      box.appendChild(band(g.imgLeft, gp.start, g.imgW, gp.end - gp.start, GAP_BLUE));
      box.appendChild(dashedLine(g.imgLeft, gp.start, g.imgW, 1, GAP_BLUE, EDGE_OPACITY));
      box.appendChild(dashedLine(g.imgLeft, gp.end, g.imgW, 1, GAP_BLUE, EDGE_OPACITY));
    }
  }

  // Dashed child outlines when there is more than one visible child.
  if (g.kids.length > 1) {
    for (const k of g.kids) box.appendChild(outline(k.x1, k.y1, k.w, k.h));
  }

  // Rhythm rail: alternating child-size / gap badges along the layout axis.
  let rr = { maxRight: g.imgRight, maxBottom: g.imgBottom };
  let br = { maxRight: g.imgRight, maxBottom: g.imgBottom };
  if (g.horizontal) {
    const railBottomY = g.imgBottom + RAIL_BOTTOM_OFF;
    const rail: RailItem[] = [];
    for (let i = 0; i < g.kids.length; i++) {
      const k = g.kids[i];
      const b = badge(String(round(k.w / scale)), SIZE_RED);
      box.appendChild(b);
      rail.push({ node: b, center: k.x1 + k.w / 2 });
      if (i < g.gaps.length) {
        const gp = g.gaps[i];
        const gb = badge(String(round(g.gap)), GAP_BLUE);
        box.appendChild(gb);
        rail.push({ node: gb, center: (gp.start + gp.end) / 2 });
      }
    }
    br = placeBottomRail(rail, railBottomY, g.imgRight);
  } else {
    const railRightX = g.imgRight + RAIL_RIGHT_OFF;
    const rail: RailItem[] = [];
    for (let i = 0; i < g.kids.length; i++) {
      const k = g.kids[i];
      const b = badge(String(round(k.h / scale)), SIZE_RED);
      box.appendChild(b);
      rail.push({ node: b, center: k.y1 + k.h / 2 });
      if (i < g.gaps.length) {
        const gp = g.gaps[i];
        const gb = badge(String(round(g.gap)), GAP_BLUE);
        box.appendChild(gb);
        rail.push({ node: gb, center: (gp.start + gp.end) / 2 });
      }
    }
    rr = placeRightRail(rail, railRightX, g.imgBottom);
  }

  fitBox(
    box, g,
    g.imgLeft,
    g.imgTop,
    Math.max(rr.maxRight, br.maxRight),
    Math.max(rr.maxBottom, br.maxBottom),
  );
  return box;
}

// ---------------------------------------------------------------------------
// Bindings line + composition
// ---------------------------------------------------------------------------

/** Overline caption sitting above each mini-diagram (e.g. "SIZE"). */
function viewCaption(text: string): TextNode {
  const t = makeText(text, 'Medium', 10, palette.muted, 130, 6);
  t.textAutoResize = 'WIDTH_AND_HEIGHT';
  return t;
}

/** Build the quiet token-bindings line beneath the wrap row (unchanged from the
 *  all-in-one design): caption + value-or-token for each measured property. */
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
  const pushBinding = (caption: string, label: MeasureLabel, onlyBound: boolean): void => {
    if (onlyBound && !label.token) return;
    bindings.push({ caption, label });
  };
  if (hasAutoLayout) {
    const uniform =
      pads.top > 0 && pads.top === pads.right && pads.top === pads.bottom && pads.top === pads.left;
    if (uniform) {
      pushBinding('padding', measureLabel(tokens, part, ['padding'], pads.top), false);
    } else {
      if (pads.left > 0 && pads.left === pads.right) {
        pushBinding('padding-x', measureLabel(tokens, part, ['padding-x', 'padding'], pads.left), false);
      } else {
        if (pads.left > 0) pushBinding('padding-left', measureLabel(tokens, part, ['padding-left', 'padding-x', 'padding'], pads.left), false);
        if (pads.right > 0) pushBinding('padding-right', measureLabel(tokens, part, ['padding-right', 'padding-x', 'padding'], pads.right), false);
      }
      if (pads.top > 0 && pads.top === pads.bottom) {
        pushBinding('padding-y', measureLabel(tokens, part, ['padding-y', 'padding'], pads.top), false);
      } else {
        if (pads.top > 0) pushBinding('padding-top', measureLabel(tokens, part, ['padding-top', 'padding-y', 'padding'], pads.top), false);
        if (pads.bottom > 0) pushBinding('padding-bottom', measureLabel(tokens, part, ['padding-bottom', 'padding-y', 'padding'], pads.bottom), false);
      }
    }
    if (gap > 0) pushBinding('gap', measureLabel(tokens, part, ['gap'], gap), false);
  }
  pushBinding('width', measureLabel(tokens, part, ['width'], component.width), true);
  pushBinding('height', measureLabel(tokens, part, ['height'], component.height), true);
  const radius = typeof component.cornerRadius === 'number' ? component.cornerRadius : 0;
  if (radius > 0) pushBinding('radius', measureLabel(tokens, part, ['border-radius'], radius), false);

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
// Main
// ---------------------------------------------------------------------------

const VIEW_CAPTIONS: Record<MeasureView, string> = {
  size: 'SIZE',
  padding: 'PADDING',
  spacing: 'SPACING',
};

/**
 * Build the token-aware measure section as user-selectable lenses. Each selected
 * view (size / padding / spacing) renders as its OWN focused mini-diagram — a
 * small overline caption above a diagram box — and they sit side by side in a
 * wrapping row. Beneath the row, a quiet token-bindings line carries the
 * token-first data (incl. radius), and a per-part legend for first-level
 * auto-layout parts sits below that. Both render once, unchanged.
 *
 * Each view creates its OWN independent instance (rescaled per the multi-view
 * cap) and is built in its own try/catch: a failed view is skipped (its instance
 * removed) while the others still render. If ALL selected views fail (or none
 * apply), returns null so the caller falls back to the plain table.
 *
 * Module-level never-crash contract: any Figma-API throw returns null and never
 * leaves an orphaned instance on the canvas.
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

  const views = block.views && block.views.length ? block.views : (['size', 'padding', 'spacing'] as MeasureView[]);
  const part = block.rootPart;

  // Image cap: full height when a single lens renders, capped when 2+ do.
  const imgMaxH = views.length >= 2 ? IMG_MAX_H_MULTI : IMG_MAX_H_SINGLE;
  const innerMax = 880 - 56 * 2 - CARD_PAD * 2 - (64 + 160);

  // Build one diagram box per applicable view; each owns its instance and is
  // isolated so one view's failure never aborts the others.
  const diagrams: { view: MeasureView; box: FrameNode }[] = [];
  try {
    for (const view of views) {
      let inst: InstanceNode | null = null;
      try {
        inst = component.createInstance();
        const scale = Math.min(innerMax / inst.width, imgMaxH / inst.height, 1);
        if (scale !== 1) inst.rescale(scale);

        let box: FrameNode | null = null;
        if (view === 'size') box = buildSizeView(component, inst, block.tokens, part, scale);
        else if (view === 'padding') box = buildPaddingView(component, inst, block.tokens, part, scale);
        else box = buildSpacingView(component, inst, scale);

        if (box) {
          diagrams.push({ view, box });
        } else {
          // Not applicable → drop the instance and the empty box (if any).
          inst.remove();
        }
      } catch {
        // This view failed: remove its instance (and any partial box) and move on.
        try {
          if (inst) inst.remove();
        } catch { /* already gone */ }
      }
    }

    if (!diagrams.length) {
      // All selected views failed or were inapplicable → table fallback.
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

    // Wrapping row of mini-diagrams: each is a caption + box vstack.
    const wrap = hstack(24);
    wrap.layoutWrap = 'WRAP';
    wrap.counterAxisSpacing = 24;
    wrap.counterAxisAlignItems = 'MIN';
    card.appendChild(wrap);
    wrap.layoutSizingHorizontal = 'FILL';

    for (const { view, box } of diagrams) {
      const mini = vstack(8);
      mini.counterAxisAlignItems = 'CENTER';
      mini.appendChild(viewCaption(VIEW_CAPTIONS[view]));
      mini.appendChild(box);
      wrap.appendChild(mini);
    }

    // Bindings line + legend, once, beneath the row.
    const bindings = buildBindingsRow(component, block.tokens, part);
    if (bindings) card.appendChild(bindings);
    const legend = buildLegend(component, block.tokens);
    if (legend) {
      card.appendChild(legend);
      legend.layoutSizingHorizontal = 'FILL';
    }

    return card;
  } catch {
    // Unexpected throw during composition: tear down every built diagram's
    // instance so the canvas is never littered.
    for (const { box } of diagrams) {
      try {
        box.remove();
      } catch { /* already gone */ }
    }
    return null;
  }
}
