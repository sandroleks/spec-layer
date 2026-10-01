/// <reference types="@figma/plugin-typings" />
import { DEFAULT_HEADER_BG, DEFAULT_ACCENT, type CornerStyle } from './brandColors';

/** Parse a #rrggbb string into a normalized RGB object. */
export function hex(value: string): RGB {
  const h = value.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

/** The frame palette. applyThemeToKit sets the themed fields per build; builds
 *  run one at a time, so module state is safe. */
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
  // Do and Don't inks carry meaning, not brand, so applyThemeToKit never
  // touches them. Each label ink clears 5:1 on its tint.
  doTint: hex('#f0fdf4'),
  doBorder: hex('#bbf7d0'),
  doInk: hex('#15803d'),
  dontTint: hex('#fef2f2'),
  dontBorder: hex('#fecaca'),
  dontInk: hex('#b91c1c'),
};

export function solidFill(color: RGB): Paint[] {
  return [{ type: 'SOLID', color }];
}

export type FontStyle = 'Regular' | 'Medium' | 'Bold';

// Mutable so the theme can swap families. Reset to Inter per build.
let headingFamily = 'Inter';
let bodyFamily = 'Inter';

export function setFontFamilies(heading: string, body: string): void {
  headingFamily = heading;
  bodyFamily = body;
}

// Set every build by applyThemeToKit; 'soft' (scale 1) is the default.
let cornerScale = 1;

export function setCornerStyle(style: CornerStyle): void {
  cornerScale = style === 'sharp' ? 0 : style === 'round' ? 1.75 : 1;
}

/** Theme-scaled corner radius. `base` is the soft (default) radius. */
export function radius(base: number): number {
  return Math.round(base * cornerScale);
}

/** Body-font face. makeText always uses it; headings switch to headingFont after. */
export function font(style: FontStyle): FontName {
  return { family: bodyFamily, style };
}

export function headingFont(style: FontStyle): FontName {
  return { family: headingFamily, style };
}

// ---------------------------------------------------------------------------
// Per-build caches
// ---------------------------------------------------------------------------

/**
 * Reads a build repeats (a collection per instance, a node per width probe and
 * again per instancing), each one bridge round trip. Reset by applyThemeToKit
 * and whenever the `figma` host changes identity (tests install a fresh stub).
 * No build edits what it reads, so nothing goes stale within one. A throwing
 * read is cached as null too, so every caller in the build shares that outcome.
 */
let cacheHost: unknown = null;
let collectionCache = new Map<string, Promise<VariableCollection | null>>();
let nodeCache = new Map<string, Promise<BaseNode | null>>();

export function resetBuildCaches(): void {
  cacheHost = figma;
  collectionCache = new Map();
  nodeCache = new Map();
}

function ensureCachesForThisHost(): void {
  if (cacheHost !== figma) resetBuildCaches();
}

/** A variable collection by id, read once per build. Null when it is
 *  unavailable (a detached library) or the read throws. */
export function collectionById(id: string): Promise<VariableCollection | null> {
  ensureCachesForThisHost();
  let hit = collectionCache.get(id);
  if (!hit) {
    hit = Promise.resolve()
      .then(() => figma.variables.getVariableCollectionByIdAsync(id))
      .catch((): VariableCollection | null => null);
    collectionCache.set(id, hit);
  }
  return hit;
}

/** A node by id, read once per build. Null when it is gone or the read throws. */
export function nodeById(id: string): Promise<BaseNode | null> {
  ensureCachesForThisHost();
  let hit = nodeCache.get(id);
  if (!hit) {
    hit = Promise.resolve()
      .then(() => figma.getNodeByIdAsync(id))
      .catch((): BaseNode | null => null);
    nodeCache.set(id, hit);
  }
  return hit;
}

/**
 * Make a fresh instance resolve variables in its component's modes. A new
 * instance inherits the DESTINATION page's modes (a density mode can shrink
 * its padding), while every measurement is computed from the component.
 */
export async function matchVariableModes(inst: InstanceNode, component: ComponentNode): Promise<void> {
  const modes = (component as SceneNode & { resolvedVariableModes?: Record<string, string> })
    .resolvedVariableModes;
  if (!modes) return;
  const entries = Object.entries(modes);
  // All collections at once, through the per-build cache.
  const collections = await Promise.all(entries.map(([collectionId]) => collectionById(collectionId)));
  entries.forEach(([, modeId], i) => {
    const coll = collections[i];
    if (!coll) return; // collection unavailable (detached library): skip
    try { inst.setExplicitVariableModeForCollection(coll, modeId); } catch { /* mode no longer on this collection: skip */ }
  });
}

/**
 * Set every BOOLEAN component property true on `inst`, so hidden layers draw.
 * Every one, not only those hiding a documented part: one that defaults true
 * changes nothing, and a deeper layer is still in the token tables.
 * A variant's definitions come from its component set: Figma throws on a
 * variant's own componentPropertyDefinitions. Never throws; on failure the
 * instance keeps its defaults.
 */
export async function revealBooleanParts(inst: InstanceNode, component: ComponentNode): Promise<void> {
  try {
    const owner: ComponentNode | ComponentSetNode =
      component.parent && component.parent.type === 'COMPONENT_SET'
        ? (component.parent as ComponentSetNode)
        : component;
    const values: Record<string, boolean> = {};
    for (const [key, def] of Object.entries(owner.componentPropertyDefinitions)) {
      if (def.type === 'BOOLEAN') values[key] = true;
    }
    if (Object.keys(values).length > 0) inst.setProperties(values);
  } catch (err) {
    console.error('[Spec Layer] could not reveal boolean-controlled layers', err);
  }
}

/** A TextNode in the body family. Fonts MUST already be loaded (applyThemeToKit). */
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

/** The readable measure for foundation frame notes. Component prose spans its
 *  content column instead, so nothing in docFrame or docBlocks reads this. */
export const PROSE_MEASURE = 640;

/** Shortest a preview cell may be, so a tiny instance still reads as a cell. */
export const SLOT_MIN_H = 72;
/** Padding inside a preview slot, each side. */
export const SLOT_PAD = 12;

/** A live instance of `nodeId` in its component's variable modes, with hidden
 *  boolean parts revealed when asked. Null when it is not a component or
 *  instancing throws. Never scaled here. */
export async function createInstanceFor(nodeId: string, includeHidden = false): Promise<InstanceNode | null> {
  let inst: InstanceNode | null = null;
  try {
    const node = await nodeById(nodeId);
    if (!node || node.type !== 'COMPONENT') return null;
    inst = node.createInstance();
    await matchVariableModes(inst, node);
    if (includeHidden) await revealBooleanParts(inst, node);
    return inst;
  } catch {
    try { inst?.remove(); } catch { /* already gone */ }
    return null;
  }
}

/**
 * A slot of `width` holding `inst` exactly as it is, or the placeholder when
 * there is none. The height hugs the instance with a floor of SLOT_MIN_H.
 */
export function slotAround(inst: InstanceNode | null, width: number): FrameNode {
  const slot = figma.createFrame();
  slot.name = 'Instance slot';
  slot.layoutMode = 'VERTICAL';
  slot.primaryAxisAlignItems = 'CENTER';
  slot.counterAxisAlignItems = 'CENTER';
  slot.paddingTop = slot.paddingBottom = slot.paddingLeft = slot.paddingRight = SLOT_PAD;
  slot.fills = solidFill(palette.bg);
  slot.cornerRadius = radius(8);
  slot.clipsContent = true;
  slot.strokes = solidFill(palette.divider);
  slot.strokeWeight = 1;
  // resize() fixes BOTH axes, so the vertical (primary) hug is restored after it.
  slot.resize(width, SLOT_MIN_H);
  slot.primaryAxisSizingMode = 'AUTO';
  slot.minHeight = SLOT_MIN_H;
  if (inst) slot.appendChild(inst);
  else slot.appendChild(makeText('Preview unavailable', 'Regular', 11, palette.muted));
  return slot;
}

/** A live instance in a slot of `width`, scaled DOWN only to fit the inner
 *  width or `maxH`, never up; the factor is returned so the caller can say so.
 *  The matrices size their cells to the instance instead. */
export async function placeInstance(
  nodeId: string, width: number, maxH = 160, includeHidden = false,
): Promise<{ slot: FrameNode; scale: number }> {
  const inst = await createInstanceFor(nodeId, includeHidden);
  let scale = 1;
  if (inst) {
    const maxW = width - SLOT_PAD * 2;
    scale = Math.min(1, maxW / inst.width, maxH / inst.height);
    if (scale < 1) inst.rescale(scale);
  }
  return { slot: slotAround(inst, width), scale };
}

/** A slot holding a live instance (or a placeholder). See placeInstance. */
export async function buildSlot(nodeId: string, width: number, maxH = 160, includeHidden = false): Promise<FrameNode> {
  return (await placeInstance(nodeId, width, maxH, includeHidden)).slot;
}

/**
 * Apply a resolved brand theme to this module's state, setting EVERY field so
 * a Default build after a themed one fully resets. A family missing a face
 * falls back to Inter, which is always loaded (bold runs need it). Also resets
 * the per-build caches. Both frame families call this.
 */
export async function applyThemeToKit(theme: {
  headerBg: string; accent: string; bodyText: string; tableHeadBg: string;
  cornerStyle: CornerStyle; headingFont: string; bodyFont: string;
}): Promise<void> {
  resetBuildCaches();
  palette.headerBg = hex(theme.headerBg);
  palette.accent = hex(theme.accent);
  palette.body = hex(theme.bodyText);
  palette.tableHeadBg = hex(theme.tableHeadBg);
  setCornerStyle(theme.cornerStyle);

  const tryFamily = async (family: string): Promise<string> => {
    if (family === 'Inter') return 'Inter';
    try {
      await Promise.all((['Regular', 'Medium', 'Bold'] as const).map((style) =>
        figma.loadFontAsync({ family, style })));
      return family;
    } catch {
      return 'Inter';
    }
  };
  const [headingFam, bodyFam] = await Promise.all([
    tryFamily(theme.headingFont), tryFamily(theme.bodyFont),
  ]);
  setFontFamilies(headingFam, bodyFam);

  await Promise.all((['Regular', 'Medium', 'Bold'] as FontStyle[]).map((style) =>
    figma.loadFontAsync({ family: 'Inter', style })));
}
