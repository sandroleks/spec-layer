/// <reference types="@figma/plugin-typings" />
/**
 * The scale drawing a number cell shows above its value. The extractor decides
 * WHICH drawing a row gets (FoundationVariableRow.glyph) and hashes it; this
 * module only sizes it from the value the cell already draws. Runs on the main
 * thread: ECMAScript and the figma API only.
 */
import type { FoundationGlyph, FoundationValue } from '@spec-layer/extractor';
import { palette, solidFill, vstack, hstack, makeText, font } from './frameKit';

export const BAR_H = 4;
export const BAR_INSET = 8;
export const TICK_W = 2;
export const RADIUS_MIN = 48;
export const STROKE_MAX = 24;
export const OPACITY_SIZE = 24;
export const CHECKER = 6;
export const FONT_MAX = 64;
export const SAMPLE_SIZE = 14;

export const EASING_SIZE = 32;

export type GlyphSpec =
  | { kind: 'bar'; length: number; clipped: boolean }
  | { kind: 'radius'; side: number; radius: number; clamped: boolean }
  | { kind: 'stroke'; thickness: number }
  | { kind: 'opacity'; opacity: number }
  | { kind: 'fontSize'; size: number }
  | { kind: 'lineHeight'; lineHeight: number }
  | { kind: 'letterSpacing'; letterSpacing: number }
  | { kind: 'easingCurve'; x1: number; y1: number; x2: number; y2: number };

/** The number a glyph is drawn from: a literal, or an alias that resolved to one. */
export function glyphValue(value: FoundationValue): number | null {
  if (value.kind === 'number') return value.value;
  if (value.kind === 'alias' && value.resolved?.kind === 'number') return value.resolved.value;
  return null;
}

/** Size a glyph. Null draws nothing: negative and non-finite values have no
 *  honest drawing, and an opacity outside 0..1 stays a number rather than
 *  being normalised by a guess. */
export function glyphSpec(glyph: FoundationGlyph, value: number, cellWidth: number): GlyphSpec | null {
  if (!Number.isFinite(value) || value < 0) return null;
  switch (glyph) {
    case 'bar': {
      const max = cellWidth - BAR_INSET;
      return value > max
        ? { kind: 'bar', length: max, clipped: true }
        : { kind: 'bar', length: value, clipped: false };
    }
    case 'radius': {
      // The square grows with the value up to the bar's edge. Figma clamps a
      // corner radius to half the side, so `clamped` marks a drawn curve
      // smaller than the stated radius, as the bar marks a clip.
      const side = Math.min(cellWidth - BAR_INSET, Math.max(RADIUS_MIN, 2 * value));
      return { kind: 'radius', side, radius: value, clamped: value > side / 2 };
    }
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

/** The curve a cubic bezier easing draws, from the literal or the alias's
 *  resolved value. Named easings and springs have no numbers, so null. */
export function easingCurveSpec(value: FoundationValue): GlyphSpec | null {
  const easing = value.kind === 'easing'
    ? value.easing
    : value.kind === 'alias' && value.resolved?.kind === 'easing' ? value.resolved.easing : null;
  if (!easing || easing.type !== 'cubic_bezier') return null;
  const [x1, y1, x2, y2] = easing.value;
  return { kind: 'easingCurve', x1, y1, x2, y2 };
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
      // The bar's clip tick: the curve drawn is smaller than the number says.
      if (spec.clamped) box.appendChild(rect(TICK_W, spec.side, palette.heading));
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
    case 'easingCurve': {
      const vector = figma.createVector();
      vector.name = 'Easing curve';
      vector.resize(EASING_SIZE, EASING_SIZE);
      // Canvas y grows downward, so 1 - y draws the curve upright. A control
      // point outside 0..1 (a back easing) draws outside the box, as it should.
      const px = (x: number) => (x * EASING_SIZE).toFixed(2);
      const py = (y: number) => ((1 - y) * EASING_SIZE).toFixed(2);
      vector.vectorPaths = [{
        windingRule: 'NONE',
        data: `M ${px(0)} ${py(0)} C ${px(spec.x1)} ${py(spec.y1)} ${px(spec.x2)} ${py(spec.y2)} ${px(1)} ${py(1)}`,
      }];
      vector.fills = [];
      vector.strokes = solidFill(palette.accent);
      vector.strokeWeight = 1.5;
      box.appendChild(vector);
      return box;
    }
  }
}
