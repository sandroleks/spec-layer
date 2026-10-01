/// <reference types="@figma/plugin-typings" />
/**
 * The branded header band every generated document opens with: header colour,
 * uppercase eyebrow, captured logo, large title, optional subtitle. One shared
 * band, so component and foundation docs cannot drift apart.
 *
 * Reads frameKit's palette and font state, so the caller must apply the theme
 * (buildDocFrames' preamble or applyThemeToKit) first.
 */
import { palette, solidFill, makeText, vstack, hstack, headingFont } from './frameKit';
import { buildPillNode } from './pillNode';
import type { PillState } from './publishPill';

/** Horizontal padding of the band. Content columns below it use the same value. */
export const HEADER_PAD_X = 56;

const LOGO_HEIGHT = 28;

export interface BrandHeaderOptions {
  /** Small uppercase overline: the doc group for components, "Foundations" here. */
  eyebrow: string;
  title: string;
  /** Optional one-line subtitle in muted ink. Pass plain text, not markdown. */
  subtitle?: string | null;
  /** Base64 PNG of the user's captured logo, if they have one. */
  logoBase64?: string | null;
  /** Publish pill on the eyebrow row, right-aligned, left of any logo. Absent
   *  draws none, so documents without a pill render byte-identical. */
  pill?: PillState | null;
  /** Restyles the subtitle (docFrame's bold runs), after it is appended and
   *  before the FILL pass. */
  styleSubtitle?: (node: TextNode) => void;
}

/**
 * The caller appends the band, then sets `layoutSizingHorizontal = 'FILL'`,
 * which needs a parent already FIXED on that axis. A logo that fails to decode
 * is dropped; the band still renders.
 */
export async function buildBrandHeader(opts: BrandHeaderOptions): Promise<FrameNode> {
  const band = vstack(14);
  band.name = 'Header';
  band.fills = solidFill(palette.headerBg);
  band.paddingTop = 48;
  band.paddingBottom = opts.subtitle ? 44 : 48;
  band.paddingLeft = HEADER_PAD_X;
  band.paddingRight = HEADER_PAD_X;

  // FILL only works after append, so nodes in `tmp` get it after every append.
  // With a logo row, the row FILLs and the eyebrow FILLs within it.
  const tmp: (TextNode | FrameNode)[] = [];

  const eyebrowNode = makeText(opts.eyebrow.toUpperCase(), 'Medium', 12, palette.onHeaderMuted);
  if (opts.logoBase64 || opts.pill) {
    // Eyebrow, then the pill, then the logo on one row; the eyebrow FILLs so
    // the other two sit at the right edge.
    const row = hstack(12);
    band.appendChild(row);
    row.counterAxisAlignItems = 'CENTER';
    row.appendChild(eyebrowNode);
    eyebrowNode.layoutSizingHorizontal = 'FILL';
    if (opts.pill) row.appendChild(buildPillNode(opts.pill));
    if (opts.logoBase64) {
      try {
        const image = figma.createImage(figma.base64Decode(opts.logoBase64));
        const { width, height } = await image.getSizeAsync();
        const logo = figma.createRectangle();
        logo.resize(Math.round((width / Math.max(height, 1)) * LOGO_HEIGHT), LOGO_HEIGHT);
        logo.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FIT' }];
        row.appendChild(logo);
      } catch {
        /* corrupt logo → header renders without it */
      }
    }
    tmp.push(row);
  } else {
    band.appendChild(eyebrowNode);
    tmp.push(eyebrowNode);
  }

  const title = makeText(opts.title, 'Bold', 38, palette.onHeader, 115);
  title.fontName = headingFont('Bold'); // heading family (guaranteed loaded)
  band.appendChild(title);
  tmp.push(title);

  if (opts.subtitle) {
    const sub = makeText(opts.subtitle, 'Regular', 16, palette.onHeaderMuted, 155);
    band.appendChild(sub);
    opts.styleSubtitle?.(sub);
    tmp.push(sub);
  }

  for (const t of tmp) t.layoutSizingHorizontal = 'FILL';
  return band;
}
