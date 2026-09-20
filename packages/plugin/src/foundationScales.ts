/// <reference types="@figma/plugin-typings" />
/**
 * foundationScales.ts: the scale drawing a number cell shows above its value.
 *
 * A GAP token is a distance, a CORNER_RADIUS token is a curve, an OPACITY token
 * is a translucency, and a table of digits shows none of that. The extractor
 * decides WHICH drawing a row gets (FoundationVariableRow.glyph, from Figma's
 * scopes) and hashes it; this module only decides how big, from the value the
 * cell already draws. `glyphSpec` is pure and tested; `buildGlyph` is verified
 * on canvas by the Figma matrix.
 *
 * Runs on the main thread: ECMAScript and the figma API only.
 */
import type { FoundationGlyph, FoundationValue } from '@spec-layer/extractor';
import { palette, solidFill, vstack, hstack, makeText, font } from './frameKit';

export const BAR_H = 4;
export const BAR_INSET = 8;
export const TICK_W = 2;
export const RADIUS_MIN = 48;
export const RADIUS_MAX = 96;
export const STROKE_MAX = 24;
export const OPACITY_SIZE = 24;
export const CHECKER = 6;
export const FONT_MAX = 64;
export const SAMPLE_SIZE = 14;

export type GlyphSpec =
  | { kind: 'bar'; length: number; clipped: boolean }
  | { kind: 'radius'; side: number; radius: number }
  | { kind: 'stroke'; thickness: number }
  | { kind: 'opacity'; opacity: number }
  | { kind: 'fontSize'; size: number }
  | { kind: 'lineHeight'; lineHeight: number }
  | { kind: 'letterSpacing'; letterSpacing: number };

/** The number a glyph is drawn from: a literal, or an alias that resolved to one. */
export function glyphValue(value: FoundationValue): number | null {
  if (value.kind === 'number') return value.value;
  if (value.kind === 'alias' && value.resolved?.kind === 'number') return value.resolved.value;
  return null;
}

/**
 * Size a glyph. Null draws nothing: negative and non-finite values have no
 * honest drawing, and an opacity outside 0..1 is not in the range Figma's own
 * `opacity` accepts, so it is left as its number rather than normalised by a
 * guess.
 */
export function glyphSpec(glyph: FoundationGlyph, value: number, cellWidth: number): GlyphSpec | null {
  if (!Number.isFinite(value) || value < 0) return null;
  switch (glyph) {
    case 'bar': {
      const max = cellWidth - BAR_INSET;
      return value > max
        ? { kind: 'bar', length: max, clipped: true }
        : { kind: 'bar', length: value, clipped: false };
    }
    case 'radius':
      return { kind: 'radius', side: Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, 2 * value)), radius: value };
    case 'stroke':
      return { kind: 'stroke', thickness: Math.min(STROKE_MAX, value) };
    case 'opacity':
      return value <= 1 ? { kind: 'opacity', opacity: value } : null;
    case 'fontSize':
      return { kind: 'fontSize', size: Math.min(FONT_MAX, value) };
    case 'lineHeight':
      return { kind: 'lineHeight', lineHeight: value };
    case 'letterSpacing':
      return { kind: 'letterSpacing', letterSpacing: value };
  }
}

function rect(width: number, height: number, fill: RGB): RectangleNode {
  const r = figma.createRectangle();
  r.resize(width, height);
  r.fills = solidFill(fill);
  return r;
}

/** A two-tone checker of `paneBg` and `chipBg`, the ground an opacity swatch is judged against. */
function checker(size: number): FrameNode {
  const grid = vstack(0);
  grid.clipsContent = true;
  grid.resize(size, size);
  grid.layoutMode = 'NONE';
  const cells = Math.ceil(size / CHECKER);
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const cell = rect(CHECKER, CHECKER, (x + y) % 2 === 0 ? palette.paneBg : palette.chipBg);
      grid.appendChild(cell);
      cell.x = x * CHECKER;
      cell.y = y * CHECKER;
    }
  }
  return grid;
}

function sample(chars: string, size: number): TextNode {
  const t = makeText(chars, 'Regular', size, palette.heading);
  t.fontName = font('Regular');
  return t;
}

/** Draw one glyph. The frame hugs its content and never exceeds `cellWidth`. */
export function buildGlyph(spec: GlyphSpec, cellWidth: number): FrameNode {
  const box = hstack(0);
  box.name = `Glyph ${spec.kind}`;
  box.counterAxisAlignItems = 'CENTER';
  switch (spec.kind) {
    case 'bar': {
      box.appendChild(rect(Math.max(spec.length, 1), BAR_H, palette.accent));
      if (spec.clipped) box.appendChild(rect(TICK_W, BAR_H * 3, palette.heading));
      return box;
    }
    case 'radius': {
      const square = rect(spec.side, spec.side, palette.paneBg);
      square.cornerRadius = spec.radius;
      square.strokes = solidFill(palette.border);
      square.strokeWeight = 1;
      box.appendChild(square);
      return box;
    }
    case 'stroke':
      box.appendChild(rect(cellWidth, Math.max(spec.thickness, 1), palette.heading));
      return box;
    case 'opacity': {
      const ground = checker(OPACITY_SIZE);
      const ink = rect(OPACITY_SIZE, OPACITY_SIZE, palette.heading);
      ink.opacity = spec.opacity;
      ground.appendChild(ink);
      ink.x = 0;
      ink.y = 0;
      box.appendChild(ground);
      return box;
    }
    case 'fontSize':
      box.appendChild(sample('Ag', spec.size));
      return box;
    case 'lineHeight': {
      const t = sample('Ag\nAg', SAMPLE_SIZE);
      t.lineHeight = { value: spec.lineHeight, unit: 'PIXELS' };
      box.appendChild(t);
      return box;
    }
    case 'letterSpacing': {
      const t = sample('Ag', SAMPLE_SIZE);
      t.letterSpacing = { value: spec.letterSpacing, unit: 'PIXELS' };
      box.appendChild(t);
      return box;
    }
  }
}
