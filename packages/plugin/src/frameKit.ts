/// <reference types="@figma/plugin-typings" />
import { DEFAULT_HEADER_BG, DEFAULT_ACCENT } from './brandColors';

/** Parse a #rrggbb string into a normalized RGB object. */
export function hex(value: string): RGB {
  const h = value.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

/**
 * The doc-frame palette. headerBg/accent (and later body/tableHeadBg) are
 * mutable: buildDocFrame() sets them from the user's theme before layout. The
 * build runs one frame at a time, so module-level state is safe here.
 */
export const palette = {
  headerBg: hex(DEFAULT_HEADER_BG), // navy header band
  accent: hex(DEFAULT_ACCENT), // teal eyebrow rule / number
  onHeader: hex('#ffffff'), // title on navy
  onHeaderMuted: hex('#9fb3c6'), // subtitle on navy
  heading: hex('#0f172a'), // section headings / emphasized values
  body: hex('#334155'), // paragraph / bullet ink
  label: hex('#475569'), // table row labels (between heading and muted)
  muted: hex('#64748b'), // secondary / placeholder / overlines
  bg: hex('#ffffff'), // card fill
  border: hex('#e2e8f0'), // outer / table border
  divider: hex('#eef2f6'), // row dividers
  tableHeadBg: hex('#f8fafc'), // table header tint
  chipBg: hex('#eef1f5'), // token chip background
  paneBg: hex('#fbfcfd'), // variant card left-pane tint
};

export function solidFill(color: RGB): Paint[] {
  return [{ type: 'SOLID', color }];
}

export type FontStyle = 'Regular' | 'Medium' | 'Bold';

// Mutable so the theme can swap families (Task 14). Reset to Inter per build.
let headingFamily = 'Inter';
let bodyFamily = 'Inter';

export function setFontFamilies(heading: string, body: string): void {
  headingFamily = heading;
  bodyFamily = body;
}

/** Body-font face. Heading text nodes are still created via makeText with the
 *  body family; buildDocFrame applies the heading family where it differs. */
export function font(style: FontStyle): FontName {
  return { family: bodyFamily, style };
}

export function headingFont(style: FontStyle): FontName {
  return { family: headingFamily, style };
}

// ---------------------------------------------------------------------------
// Text construction
// ---------------------------------------------------------------------------

/**
 * Create a TextNode using one of the pre-loaded Inter faces.
 * Fonts MUST already be loaded (see buildDocFrame) before this is called.
 */
export function makeText(
  chars: string,
  style: FontStyle,
  size: number,
  color: RGB = palette.body,
  lineHeightPct?: number,
  trackingPct?: number,
): TextNode {
  const node = figma.createText();
  node.fontName = font(style);
  node.fontSize = size;
  node.characters = chars;
  node.fills = solidFill(color);
  if (lineHeightPct !== undefined) {
    node.lineHeight = { value: lineHeightPct, unit: 'PERCENT' };
  }
  if (trackingPct !== undefined) {
    node.letterSpacing = { value: trackingPct, unit: 'PERCENT' };
  }
  return node;
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** A vertical auto-layout frame that hugs its contents. */
export function vstack(spacing: number): FrameNode {
  const frame = figma.createFrame();
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.itemSpacing = spacing;
  frame.fills = [];
  return frame;
}

/** A horizontal auto-layout frame that hugs its height. */
export function hstack(spacing: number): FrameNode {
  const frame = figma.createFrame();
  frame.layoutMode = 'HORIZONTAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.itemSpacing = spacing;
  frame.fills = [];
  return frame;
}

/** A slot holding a live instance of the variant (or a placeholder). `width` is
 *  the slot's box width; the instance is rescaled to fit inside its padding. */
export async function buildSlot(nodeId: string, width: number, maxH = 160): Promise<FrameNode> {
  const slot = figma.createFrame();
  slot.name = 'Instance slot';
  slot.layoutMode = 'VERTICAL';
  slot.counterAxisSizingMode = 'FIXED'; // fixed width
  slot.primaryAxisSizingMode = 'AUTO'; // hug height
  slot.primaryAxisAlignItems = 'CENTER';
  slot.counterAxisAlignItems = 'CENTER';
  slot.paddingTop = slot.paddingBottom = slot.paddingLeft = slot.paddingRight = 12;
  slot.fills = solidFill(palette.bg);
  slot.cornerRadius = 8;
  slot.clipsContent = true;
  slot.strokes = solidFill(palette.divider);
  slot.strokeWeight = 1;
  slot.resize(width, width);

  let placed = false;
  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (node && node.type === 'COMPONENT') {
      const inst = (node as ComponentNode).createInstance();
      slot.appendChild(inst);
      const maxW = width - 24;
      const scale = Math.min(1, maxW / inst.width, maxH / inst.height);
      if (scale < 1) inst.rescale(scale);
      placed = true;
    }
  } catch {
    /* fall through to placeholder */
  }
  if (!placed) {
    slot.appendChild(makeText('Drop instance', 'Regular', 11, palette.muted));
  }
  return slot;
}
