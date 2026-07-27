/// <reference types="@figma/plugin-typings" />
/**
 * brandHeader.ts — the branded header band shared by every generated document.
 *
 * Component docs and foundation docs both open with the same band: the brand
 * header colour, an uppercase eyebrow, the captured logo on the right, a large
 * title, and an optional subtitle. It lives here rather than in docFrame.ts
 * because two callers now need it, and a copy in each would drift the moment
 * either one is restyled. "Foundation frames follow the component style" is only
 * true for as long as there is one band, not two that currently agree.
 *
 * Reads the theme through frameKit's palette and font state, so the caller must
 * have applied the theme (buildDocFrames' preamble or applyThemeToKit) first.
 */
import { palette, solidFill, makeText, vstack, hstack, headingFont } from './frameKit';

/** Horizontal padding of the band. Content columns below it use the same value. */
export const HEADER_PAD_X = 56;

const LOGO_HEIGHT = 28;

export interface BrandHeaderOptions {
  /** Small uppercase overline: the doc group for components, "Foundations" here. */
  eyebrow: string;
  /** The large title line. */
  title: string;
  /** Optional one-line subtitle in muted ink. Pass plain text, not markdown. */
  subtitle?: string | null;
  /** Base64 PNG of the user's captured logo, if they have one. */
  logoBase64?: string | null;
  /**
   * Hook to restyle the subtitle node (docFrame applies bold runs to its lifted
   * definition lead). Called after the node is appended and before the FILL
   * pass, which is the order the component header has always used.
   */
  styleSubtitle?: (node: TextNode) => void;
}

/**
 * Build the header band. The caller appends it and then sets
 * `layoutSizingHorizontal = 'FILL'`, which requires the parent to be FIXED on
 * that axis already.
 *
 * A logo that fails to decode is dropped and the rest of the band still
 * renders: a corrupt capture should cost the user their logo, not their
 * document.
 */
export async function buildBrandHeader(opts: BrandHeaderOptions): Promise<FrameNode> {
  const band = vstack(14);
  band.name = 'Header';
  band.fills = solidFill(palette.headerBg);
  band.paddingTop = 48;
  band.paddingBottom = opts.subtitle ? 44 : 48;
  band.paddingLeft = HEADER_PAD_X;
  band.paddingRight = HEADER_PAD_X;

  // We append children, then set FILL, then style text — order matters for FILL.
  // Nodes in `tmp` get FILL after all appends. When the eyebrow sits inside a
  // logo row, the ROW is what FILLs (the eyebrow FILLs within it, set inline).
  const tmp: (TextNode | FrameNode)[] = [];

  const eyebrowNode = makeText(opts.eyebrow.toUpperCase(), 'Medium', 12, palette.onHeaderMuted);
  if (opts.logoBase64) {
    // Eyebrow + logo on one row, logo pushed to the right edge.
    const row = hstack(12);
    band.appendChild(row);
    row.counterAxisAlignItems = 'CENTER';
    row.appendChild(eyebrowNode);
    eyebrowNode.layoutSizingHorizontal = 'FILL';
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
    tmp.push(row); // the row FILLs; the eyebrow already FILLs within it
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
