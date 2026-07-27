import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildBrandHeader, HEADER_PAD_X } from '../src/brandHeader';
import { palette, applyThemeToKit } from '../src/frameKit';
import { installFakeFigma, uninstallFakeFigma, FakeFrame } from './fakeFigma';

/**
 * The header band is what makes a generated document look like it belongs to
 * the user's brand: their header colour, their logo, their fonts. These tests
 * pin the three things that were wrong or missing on foundation frames before
 * the band was shared — the brand colour is actually used, the logo is drawn
 * when there is one, and a broken logo costs the logo rather than the document.
 */
describe('buildBrandHeader', () => {
  beforeEach(installFakeFigma);
  afterEach(uninstallFakeFigma);

  const theme = {
    headerBg: '#123456', accent: '#00ffcc', bodyText: '#222222',
    tableHeadBg: '#fafafa', cornerStyle: 'soft' as const,
    headingFont: 'Inter', bodyFont: 'Inter',
  };

  it('paints the band in the theme header colour', async () => {
    await applyThemeToKit(theme);
    const band = await buildBrandHeader({ eyebrow: 'Foundations', title: 'Primitives' });
    // 0x12 / 255, 0x34 / 255, 0x56 / 255
    expect((band as unknown as FakeFrame).fills).toEqual([
      { type: 'SOLID', color: palette.headerBg },
    ]);
    expect(palette.headerBg.r).toBeCloseTo(0x12 / 255, 5);
  });

  it('uses the shared horizontal padding on both sides', async () => {
    const band = await buildBrandHeader({ eyebrow: 'Usage', title: 'Button' });
    expect(band.paddingLeft).toBe(HEADER_PAD_X);
    expect(band.paddingRight).toBe(HEADER_PAD_X);
  });

  it('uppercases the eyebrow and keeps the title verbatim', async () => {
    const band = await buildBrandHeader({ eyebrow: 'Foundations', title: 'Primitives · color' });
    const texts = (band as unknown as FakeFrame).textChars();
    expect(texts).toContain('FOUNDATIONS');
    expect(texts).toContain('Primitives · color');
  });

  it('draws the logo beside the eyebrow when one was captured', async () => {
    const band = await buildBrandHeader({
      eyebrow: 'Foundations', title: 'Primitives', logoBase64: 'AAAA',
    });
    // Eyebrow + logo share a row, so the band's first child is a frame, and the
    // logo rectangle is inside it.
    const row = (band as unknown as FakeFrame).children[0] as FakeFrame;
    expect(row.layoutMode).toBe('HORIZONTAL');
    const logo = row.children.find((k) => (k as Record<string, unknown>).type === 'RECTANGLE');
    expect(logo).toBeDefined();
    expect((logo as Record<string, unknown>).height).toBe(28);
  });

  it('keeps the eyebrow on its own when there is no logo', async () => {
    const band = await buildBrandHeader({ eyebrow: 'Foundations', title: 'Primitives' });
    const first = (band as unknown as FakeFrame).children[0] as Record<string, unknown>;
    expect(first.type).toBe('TEXT');
    expect(first.characters).toBe('FOUNDATIONS');
  });

  it('scales the logo to 28px tall, preserving its aspect ratio', async () => {
    // The fake image reports 200x50, so a 28px-tall logo is 112px wide.
    const band = await buildBrandHeader({
      eyebrow: 'Foundations', title: 'Primitives', logoBase64: 'AAAA',
    });
    const row = (band as unknown as FakeFrame).children[0] as FakeFrame;
    const logo = row.children.find((k) => (k as Record<string, unknown>).type === 'RECTANGLE');
    expect((logo as Record<string, unknown>).width).toBe(112);
  });

  it('still renders the document when the logo cannot be decoded', async () => {
    // A corrupt capture should cost the user their logo, not their document.
    installFakeFigma({ base64Decode: () => { throw new Error('bad base64'); } });
    const band = await buildBrandHeader({
      eyebrow: 'Foundations', title: 'Primitives', logoBase64: 'not-base64',
    });
    const texts = (band as unknown as FakeFrame).textChars();
    expect(texts).toContain('FOUNDATIONS');
    expect(texts).toContain('Primitives');
    const row = (band as unknown as FakeFrame).children[0] as FakeFrame;
    expect(row.children.some((k) => (k as Record<string, unknown>).type === 'RECTANGLE')).toBe(false);
  });

  it('renders the subtitle and leaves room for it', async () => {
    const withSub = await buildBrandHeader({
      eyebrow: 'Foundations', title: 'Primitives', subtitle: '12 variables across 2 modes',
    });
    expect((withSub as unknown as FakeFrame).textChars()).toContain('12 variables across 2 modes');

    const without = await buildBrandHeader({ eyebrow: 'Foundations', title: 'Primitives' });
    // A band with no subtitle closes up the extra bottom room the subtitle needs.
    expect(withSub.paddingBottom).toBeLessThan(without.paddingBottom);
  });

  it('applies the caller styling hook to the subtitle before the FILL pass', async () => {
    // docFrame uses this to re-apply the **bold** runs it parsed out of the
    // lifted Definition lead. It must receive the node it actually rendered.
    const seen: string[] = [];
    await buildBrandHeader({
      eyebrow: 'Usage', title: 'Button', subtitle: 'A pressable control.',
      styleSubtitle: (node) => seen.push(node.characters),
    });
    expect(seen).toEqual(['A pressable control.']);
  });

  it('never calls the styling hook when there is no subtitle', async () => {
    let called = false;
    await buildBrandHeader({
      eyebrow: 'Usage', title: 'Button', subtitle: null,
      styleSubtitle: () => { called = true; },
    });
    expect(called).toBe(false);
  });
});
