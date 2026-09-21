import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  glyphSpec, glyphValue, buildGlyph,
  BAR_INSET, RADIUS_MIN, STROKE_MAX, FONT_MAX,
} from '../src/foundationScales';
import { installFakeFigma, uninstallFakeFigma, FakeFrame } from './fakeFigma';

describe('glyphValue', () => {
  it('reads a literal number or an alias resolved to one, and nothing else', () => {
    expect(glyphValue({ kind: 'number', value: 16 })).toBe(16);
    expect(glyphValue({ kind: 'alias', targetName: 'space/4', targetCollection: 'P', external: false,
      resolved: { kind: 'number', value: 16 } })).toBe(16);
    expect(glyphValue({ kind: 'alias', targetName: 'x', targetCollection: 'P', external: true, resolved: null })).toBeNull();
    expect(glyphValue({ kind: 'color', hex: '#000000', alpha: 1 })).toBeNull();
    expect(glyphValue({ kind: 'unresolved', reason: 'missing' })).toBeNull();
  });
});

describe('glyphSpec', () => {
  it('draws a bar at value length and clips it to the cell', () => {
    expect(glyphSpec('bar', 40, 160)).toEqual({ kind: 'bar', length: 40, clipped: false });
    expect(glyphSpec('bar', 400, 160)).toEqual({ kind: 'bar', length: 160 - BAR_INSET, clipped: true });
  });
  it('grows the radius square with the value, from a floor to the cell edge', () => {
    expect(glyphSpec('radius', 4, 160)).toEqual({ kind: 'radius', side: RADIUS_MIN, radius: 4, clamped: false });
    expect(glyphSpec('radius', 30, 160)).toEqual({ kind: 'radius', side: 60, radius: 30, clamped: false });
    // The bar's inset, so the two glyphs agree about what fits a cell.
    expect(glyphSpec('radius', 80, 160)).toEqual({
      kind: 'radius', side: 160 - BAR_INSET, radius: 80, clamped: true,
    });
  });
  it('marks the radius square as clamped once the curve exceeds half the side', () => {
    // Figma clamps a corner radius to half the side, so past this point the
    // square is a circle and the drawing no longer matches the stated value.
    // Unmarked, a 48, a 64 and a 200 would be indistinguishable.
    expect(glyphSpec('radius', 76, 160)).toMatchObject({ side: 152, clamped: false });
    expect(glyphSpec('radius', 77, 160)).toMatchObject({ side: 152, clamped: true });
    expect(glyphSpec('radius', 200, 160)).toMatchObject({ side: 152, clamped: true });
  });
  it('caps stroke and font size, passes line height and letter spacing through', () => {
    expect(glyphSpec('stroke', 2, 160)).toEqual({ kind: 'stroke', thickness: 2 });
    expect(glyphSpec('stroke', 40, 160)).toEqual({ kind: 'stroke', thickness: STROKE_MAX });
    expect(glyphSpec('fontSize', 24, 160)).toEqual({ kind: 'fontSize', size: 24 });
    expect(glyphSpec('fontSize', 96, 160)).toEqual({ kind: 'fontSize', size: FONT_MAX });
    expect(glyphSpec('lineHeight', 20, 160)).toEqual({ kind: 'lineHeight', lineHeight: 20 });
    expect(glyphSpec('letterSpacing', 0.5, 160)).toEqual({ kind: 'letterSpacing', letterSpacing: 0.5 });
  });
  it('draws opacity only inside Figma node range', () => {
    expect(glyphSpec('opacity', 0.5, 160)).toEqual({ kind: 'opacity', opacity: 0.5 });
    expect(glyphSpec('opacity', 0, 160)).toEqual({ kind: 'opacity', opacity: 0 });
    expect(glyphSpec('opacity', 1, 160)).toEqual({ kind: 'opacity', opacity: 1 });
    expect(glyphSpec('opacity', 50, 160)).toBeNull();
  });
  it('draws nothing for a negative or non-finite value', () => {
    expect(glyphSpec('bar', -4, 160)).toBeNull();
    expect(glyphSpec('radius', Number.NaN, 160)).toBeNull();
    expect(glyphSpec('stroke', Number.POSITIVE_INFINITY, 160)).toBeNull();
  });
});

describe('buildGlyph', () => {
  beforeEach(() => installFakeFigma());
  afterEach(() => uninstallFakeFigma());

  it('draws the bar with an end tick only when clipped', () => {
    const plain = buildGlyph({ kind: 'bar', length: 40, clipped: false }, 160) as unknown as FakeFrame;
    expect(plain.children).toHaveLength(1);
    const clipped = buildGlyph({ kind: 'bar', length: 152, clipped: true }, 160) as unknown as FakeFrame;
    expect(clipped.children).toHaveLength(2);
  });
  it('draws the radius square with a tick only when the curve is clamped', () => {
    const plain = buildGlyph({ kind: 'radius', side: 60, radius: 30, clamped: false }, 160) as unknown as FakeFrame;
    expect(plain.children).toHaveLength(1);
    const clamped = buildGlyph({ kind: 'radius', side: 152, radius: 200, clamped: true }, 160) as unknown as FakeFrame;
    expect(clamped.children).toHaveLength(2);
  });
  it('sets the sample text at the requested size and spacing', () => {
    const size = buildGlyph({ kind: 'fontSize', size: 24 }, 160) as unknown as FakeFrame;
    expect(size.textChars()).toEqual(['Ag']);
    const lh = buildGlyph({ kind: 'lineHeight', lineHeight: 20 }, 160) as unknown as FakeFrame;
    expect(lh.textChars()).toEqual(['Ag\nAg']);
  });
});
