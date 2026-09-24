/// <reference types="@figma/plugin-typings" />
/**
 * pillNode.ts: draws and repaints the publish pill on a header band.
 *
 * Figma-facing counterpart of publishPill.ts. Colours are the header band's
 * own roles, because the pill sits on the band: `onHeader` is the ink the
 * title already uses there, so it is readable on every brand header colour
 * the user can pick, and `accent` is the brand accent the eyebrow rule uses.
 *
 * Repainting finds pills by plugin data, never by name or position, so a
 * header the user moved keeps its pill where they put it.
 */
import { palette, solidFill, makeText, hstack } from './frameKit';
import { PILL_KEY, PILL_NODE_NAME, pillLabel, type PillState } from './publishPill';

const PILL_HEIGHT = 24;
const PILL_PAD_X = 10;
const LABEL_SIZE = 12;

function styleFrame(frame: FrameNode, state: PillState): void {
  switch (state.kind) {
    case 'published':
      frame.fills = [{ type: 'SOLID', color: palette.accent, opacity: 0.22 }];
      frame.strokes = solidFill(palette.accent);
      frame.strokeWeight = 1;
      frame.dashPattern = [];
      break;
    case 'changed':
      frame.fills = [{ type: 'SOLID', color: palette.onHeaderMuted, opacity: 0.18 }];
      frame.strokes = [];
      frame.dashPattern = [];
      break;
    case 'unpublished':
      // The unbound-token chip convention: no fill, dashed muted outline.
      frame.fills = [];
      frame.strokes = solidFill(palette.onHeaderMuted);
      frame.strokeWeight = 1;
      frame.dashPattern = [3, 2];
      break;
  }
}

const inkFor = (state: PillState): RGB => (state.kind === 'unpublished' ? palette.onHeaderMuted : palette.onHeader);

export function buildPillNode(state: PillState): FrameNode {
  const pill = hstack(0);
  pill.name = PILL_NODE_NAME;
  pill.setPluginData(PILL_KEY, '1');
  pill.primaryAxisAlignItems = 'CENTER';
  pill.counterAxisAlignItems = 'CENTER';
  pill.paddingLeft = PILL_PAD_X;
  pill.paddingRight = PILL_PAD_X;
  // 12px Medium sits in a 14px line box; 5 above and below makes the 24px pill.
  pill.paddingTop = (PILL_HEIGHT - 14) / 2;
  pill.paddingBottom = (PILL_HEIGHT - 14) / 2;
  pill.cornerRadius = 999;
  styleFrame(pill, state);
  const label = makeText(pillLabel(state), 'Medium', LABEL_SIZE, inkFor(state));
  label.setPluginData(PILL_KEY, '1');
  pill.appendChild(label);
  return pill;
}

/** The subset of SectionNode (and FrameNode) that repainting needs; a test can fake it. */
export type PillHost = Pick<ChildrenMixin, 'findAllWithCriteria'>;

/**
 * Restyle every pill under `host` to `state`, in place. Loads the label's own
 * font first, because repainting happens outside a build and frameKit's fonts
 * may not be loaded. Returns how many pills were repainted; 0 on a doc that
 * predates pills, which is not an error.
 *
 * findAllWithCriteria is evaluated by Figma, not by a predicate called once
 * per node across the bridge, and the pluginData filter returns only frames
 * that carry the key at all; the value check below is the last word.
 */
export async function repaintPills(host: PillHost, state: PillState): Promise<number> {
  const pills = host
    .findAllWithCriteria({ types: ['FRAME'], pluginData: { keys: [PILL_KEY] } })
    .filter((node) => node.getPluginData(PILL_KEY) === '1');
  for (const pill of pills) {
    styleFrame(pill, state);
    const label = pill.children.find((child) => child.type === 'TEXT') as TextNode | undefined;
    if (!label) continue;
    const fontName = label.fontName;
    if (fontName !== figma.mixed) await figma.loadFontAsync(fontName);
    label.characters = pillLabel(state);
    label.fills = solidFill(inkFor(state));
  }
  return pills.length;
}
