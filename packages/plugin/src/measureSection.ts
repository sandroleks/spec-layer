/// <reference types="@figma/plugin-typings" />
import { palette, solidFill, vstack, hstack, makeText, hex, radius, nodeById, createInstanceFor } from './frameKit';
import { measureKey, type MeasureView } from './ui/docModel';

// One measure diagram over a live instance: four rails around the artwork and
// translucent bands over it. The lens toggles (block.views) hide categories;
// overlap between categories is accepted, since the toggles declutter.
const SIZE_RED: RGB = hex('#f24822'); // sizes: total height, child widths, child cross-height
const PAD_BLUE: RGB = hex('#2979ff'); // padding
const GAP_PINK: RGB = hex('#ec4899'); // gaps
const WHITE: RGB = hex('#ffffff'); // badge text

const CARD_PAD = 24;

// Starting room for the top/left rails; buildDiagram normalizes the box to its
// contents afterwards, which sets the final margins.
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

/** `value` is the rounded px string a badge shows; `token` its binding, shown
 *  on the bindings line. */
type MeasureLabel = { value: string; token: string | null };

const round = (n: number): number => Math.round(n * 10) / 10;

/** The first candidate key with a bound token wins. */
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

/** `spacing/size-12 · 8`, for the bindings line only: badges show plain numbers
 *  so they stay narrow and glued to their spans. */
function bindingText(label: MeasureLabel): string {
  return label.token ? `${label.token} · ${label.value}` : label.value;
}

// ---------------------------------------------------------------------------
// Primitive builders
// ---------------------------------------------------------------------------

function badge(text: string, color: RGB): FrameNode {
  const chip = hstack(0);
  chip.paddingTop = chip.paddingBottom = 3;
  chip.paddingLeft = chip.paddingRight = 6;
  chip.cornerRadius = radius(4);
  chip.fills = solidFill(color);
  const t = makeText(text, 'Bold', 11, WHITE, 120);
  t.textAutoResize = 'WIDTH_AND_HEIGHT';
  chip.appendChild(t);
  return chip;
}

function band(x: number, y: number, w: number, h: number, color: RGB): FrameNode {
  const f = figma.createFrame();
  f.resize(Math.max(w, 1), Math.max(h, 1));
  f.x = Math.round(x);
  f.y = Math.round(y);
  f.fills = [{ type: 'SOLID', color, opacity: BAND_OPACITY }];
  return f;
}

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

function line(x: number, y: number, w: number, h: number, color: RGB): FrameNode {
  const f = figma.createFrame();
  f.resize(Math.max(w, 1), Math.max(h, 1));
  f.x = Math.round(x);
  f.y = Math.round(y);
  f.fills = solidFill(color);
  return f;
}

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

interface LegendEntry {
  caption: string;
  label: MeasureLabel;
}

// ---------------------------------------------------------------------------
// Diagram geometry
// ---------------------------------------------------------------------------

/** A visible child's scaled, box-local bounds. */
interface Child {
  x1: number;
  y1: number;
  w: number;
  h: number;
}

/** `node` takes only the geometry fields, so a test can pass a plain object. */
export interface RailItem {
  node: { x: number; y: number; width: number; height: number };
  center: number; // desired center along the axis (y for right/left, x for top/bottom)
}

interface ViewGeom {
  imgLeft: number; imgTop: number; imgRight: number; imgBottom: number;
  imgW: number; imgH: number;
  rawW: number; rawH: number; // unscaled total width/height of the geometry source
  scale: number;
  padTs: number; padRs: number; padBs: number; padLs: number;
  pads: { top: number; right: number; bottom: number; left: number };
  hasAutoLayout: boolean;
  horizontal: boolean;
  gap: number;
  kids: Child[];
  gaps: { start: number; end: number }[];
}

/** What `computeGeom` reads; a ComponentNode or an InstanceNode. With
 *  `includeHidden` the revealed instance is passed, so the overlay measures
 *  what is drawn rather than the source component's box. */
interface GeometrySource {
  width: number;
  height: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  itemSpacing: number;
  layoutMode: ComponentNode['layoutMode'];
  children: readonly SceneNode[];
}

/** Geometry for an instance placed at (mLeft, mTop). */
function computeGeom(
  source: GeometrySource,
  scale: number,
  mLeft: number,
  mTop: number,
): ViewGeom {
  const imgW = source.width * scale;
  const imgH = source.height * scale;
  const imgLeft = mLeft;
  const imgTop = mTop;
  const imgRight = mLeft + imgW;
  const imgBottom = mTop + imgH;

  const pads = {
    top: source.paddingTop ?? 0,
    right: source.paddingRight ?? 0,
    bottom: source.paddingBottom ?? 0,
    left: source.paddingLeft ?? 0,
  };
  const hasAutoLayout = source.layoutMode === 'HORIZONTAL' || source.layoutMode === 'VERTICAL';
  const horizontal = source.layoutMode === 'HORIZONTAL';
  const gap = hasAutoLayout ? source.itemSpacing : 0;

  const kids: Child[] = source.children
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
    imgLeft, imgTop, imgRight, imgBottom, imgW, imgH,
    rawW: source.width, rawH: source.height, scale,
    padTs: pads.top * scale, padRs: pads.right * scale,
    padBs: pads.bottom * scale, padLs: pads.left * scale,
    pads, hasAutoLayout, horizontal, gap, kids, gaps,
  };
}

/** Badges at `railX`, each centred on its region and pushed down to clear the
 *  previous, so a short component's badges never stack. */
export function placeRightRail(items: RailItem[], railX: number): void {
  let prevBottom = -Infinity;
  for (const item of items) {
    item.node.x = Math.round(railX);
    let y = Math.round(item.center - item.node.height / 2);
    if (y < prevBottom + NUDGE) y = Math.round(prevBottom + NUDGE);
    item.node.y = y;
    prevBottom = y + item.node.height;
  }
}

/** Badges at `railY`, each centred under its span and pushed right to clear
 *  the previous. */
export function placeBottomRail(items: RailItem[], railY: number, imgRight: number): { maxRight: number; maxBottom: number } {
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
// The diagram
// ---------------------------------------------------------------------------

/**
 * `views` filters what draws:
 *  - 'size'    -> total-dimension rails, child main-axis sizes, cross size.
 *  - 'padding' -> padding bands and badges.
 *  - 'spacing' -> gap bands and badges, plus child outlines (>1 child).
 * With no auto-layout root, only total width and height draw.
 */
function buildDiagram(
  g: ViewGeom,
  inst: InstanceNode,
  tokens: Record<string, string>,
  part: string,
  views: Set<MeasureView>,
): FrameNode {
  const showSize = views.has('size');
  const showPadding = views.has('padding');
  const showSpacing = views.has('spacing');

  const box = figma.createFrame();
  box.name = 'Measurements diagram';
  box.resize(2000, 2000);
  box.fills = [];
  box.clipsContent = false;
  box.appendChild(inst);
  inst.x = M_LEFT;
  inst.y = M_TOP;

  // Bands over the artwork.
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
    if (g.kids.length > 1) {
      for (const k of g.kids) box.appendChild(outline(k.x1, k.y1, k.w, k.h));
    }
  }

  // Top and left rails: total dimensions, or child sizes on the main axis.
  if (showSize) {
    const topLineY = g.imgTop - RAIL_TOP_OFF;
    box.appendChild(line(g.imgLeft, topLineY, g.imgW, 1, SIZE_RED));
    box.appendChild(line(g.imgLeft, topLineY - TICK / 2, 1, TICK, SIZE_RED));
    box.appendChild(line(g.imgRight - 1, topLineY - TICK / 2, 1, TICK, SIZE_RED));

    if (g.hasAutoLayout && g.horizontal && g.kids.length > 0) {
      const rail: RailItem[] = [];
      for (const k of g.kids) {
        const b = badge(String(round(k.w / g.scale)), SIZE_RED);
        box.appendChild(b);
        rail.push({ node: b, center: k.x1 + k.w / 2 });
      }
      let prevRight = -Infinity;
      for (const item of rail) {
        let x = Math.round(item.center - item.node.width / 2);
        if (x < prevRight + NUDGE) x = Math.round(prevRight + NUDGE);
        item.node.x = x;
        item.node.y = Math.round(topLineY - LINE_GAP - item.node.height);
        prevRight = x + item.node.width;
      }
    } else {
      const widthBadge = badge(measureLabel(tokens, part, ['width'], g.rawW).value, SIZE_RED);
      box.appendChild(widthBadge);
      widthBadge.x = Math.round((g.imgLeft + g.imgRight) / 2 - widthBadge.width / 2);
      widthBadge.y = Math.round(topLineY - LINE_GAP - widthBadge.height);
    }

    const leftLineX = g.imgLeft - RAIL_LEFT_OFF;
    box.appendChild(line(leftLineX, g.imgTop, 1, g.imgH, SIZE_RED));
    box.appendChild(line(leftLineX - TICK / 2, g.imgTop, TICK, 1, SIZE_RED));
    box.appendChild(line(leftLineX - TICK / 2, g.imgBottom - 1, TICK, 1, SIZE_RED));

    if (g.hasAutoLayout && !g.horizontal && g.kids.length > 0) {
      const rail: RailItem[] = [];
      for (const k of g.kids) {
        const b = badge(String(round(k.h / g.scale)), SIZE_RED);
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
      const heightBadge = badge(measureLabel(tokens, part, ['height'], g.rawH).value, SIZE_RED);
      box.appendChild(heightBadge);
      heightBadge.x = Math.round(leftLineX - LINE_GAP - heightBadge.width);
      heightBadge.y = Math.round((g.imgTop + g.imgBottom) / 2 - heightBadge.height / 2);
    }
  }

  // Bottom rail: pad-left, gaps or content width, pad-right.
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
    // Vertical main axis: gaps go on the right rail with the flow.
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
      const contentW = round(g.rawW - g.pads.left - g.pads.right);
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

  // Right rail: pad-top, cross size or gaps, pad-bottom.
  if (g.hasAutoLayout && g.horizontal && (showPadding || showSize)) {
    const railRightX = g.imgRight + RAIL_RIGHT_OFF;
    const rail: RailItem[] = [];
    if (showPadding && g.pads.top > 0) {
      const b = badge(String(round(g.pads.top)), PAD_BLUE);
      box.appendChild(b);
      rail.push({ node: b, center: g.imgTop + g.padTs / 2 });
    }
    if (showSize && g.kids.length > 0) {
      // One badge: children share the cross size in practice.
      const contentTop = g.imgTop + g.padTs;
      const contentBottom = g.imgBottom - g.padBs;
      const crossH = round((g.rawH - g.pads.top - g.pads.bottom));
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

  // Normalize to the true bounding box of what was drawn: a badge centred on
  // a narrow span can extend left of or above the image.
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

/** The line beneath the diagram naming padding, gap and radius tokens. */
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
  // Uniform padding collapses to one `padding`, else symmetric x/y pairs.
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
  const cornerRadius = typeof component.cornerRadius === 'number' ? component.cornerRadius : 0;
  if (cornerRadius > 0) {
    bindings.push({ caption: 'border-radius', label: measureLabel(tokens, part, ['border-radius'], cornerRadius) });
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

// Remove the topmost frame holding `node` (just below the page, where
// createFrame/createInstance append), so a throw never orphans a half build.
function removeCanvasSubtree(node: SceneNode): void {
  try {
    let top: SceneNode = node;
    while (top.parent && top.parent.type !== 'PAGE' && top.parent.type !== 'DOCUMENT') {
      top = top.parent as SceneNode;
    }
    top.remove();
  } catch { /* already gone */ }
}

/**
 * The measure card: the diagram plus a bindings line. Null when it cannot be
 * built (component missing or any layout error), so the caller falls back to
 * a table; any created instance is removed first.
 */
export async function buildMeasureSection(
  block: MeasureBlockData, includeHidden = false, contentWidth = 880 - 56 * 2,
): Promise<{ card: FrameNode; scale: number } | null> {
  // Through the per-build cache: fitFrameWidth already read this node.
  const node = await nodeById(block.componentId);
  if (!node || node.type !== 'COMPONENT') return null;
  const component = node as ComponentNode;

  const views = new Set<MeasureView>(
    block.views && block.views.length ? block.views : (['size', 'padding', 'spacing'] as MeasureView[]),
  );
  const part = block.rootPart;

  // Matched to the component's variable modes, so the instance resolves the
  // same padding, gap and size tokens the annotations are computed from.
  const inst = await createInstanceFor(block.componentId, includeHidden);
  if (!inst) return null;

  try {
    // True size unless too wide for the column beside its left rail; never
    // upscaled.
    const innerMax = contentWidth - CARD_PAD * 2 - (M_LEFT + 160);
    const scale = Math.min(1, innerMax / inst.width);
    // Read before rescale mutates the instance in place: computeGeom applies
    // `scale` itself, so reading after would apply it twice.
    const geometrySource: GeometrySource = includeHidden ? inst : component;
    const g = computeGeom(geometrySource, scale, M_LEFT, M_TOP);
    if (scale !== 1) inst.rescale(scale);

    let box: FrameNode;
    try {
      box = buildDiagram(g, inst, block.tokens, part, views);
    } catch {
      // inst may already sit inside the diagram frame: remove the whole subtree.
      removeCanvasSubtree(inst);
      return null;
    }

    // Same visual language as the anatomy card.
    const card = vstack(20);
    card.paddingTop = card.paddingBottom = card.paddingLeft = card.paddingRight = CARD_PAD;
    card.fills = solidFill(palette.paneBg);
    card.cornerRadius = radius(8);
    card.strokes = solidFill(palette.border);
    card.strokeWeight = 1;
    card.counterAxisAlignItems = 'CENTER';
    card.appendChild(box);

    const bindings = buildBindingsRow(component, block.tokens, part);
    if (bindings) card.appendChild(bindings);

    return { card, scale };
  } catch {
    removeCanvasSubtree(inst);
    return null;
  }
}
