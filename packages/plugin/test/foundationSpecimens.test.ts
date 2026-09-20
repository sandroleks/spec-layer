import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { metricsLine, buildTextSpecimenList, SPECIMEN_TEXT } from '../src/foundationSpecimens';
import { setFontFamilies } from '../src/frameKit';
import { installFakeFigma, uninstallFakeFigma, FakeFrame, FakeText } from './fakeFigma';
import type { FoundationTextRow } from '@spec-layer/extractor';

const BASE = {
  fontFamily: 'Inter', fontStyle: 'Semi Bold', fontSize: 24, lineHeight: { unit: 'PIXELS' as const, value: 32 },
  letterSpacing: { unit: 'PIXELS' as const, value: 0 }, paragraphSpacing: 16,
  textCase: 'ORIGINAL', textDecoration: 'NONE', boundTokens: {},
};

describe('metricsLine', () => {
  it('names family, style, size over line height, letter spacing and paragraph spacing', () => {
    expect(metricsLine(BASE)).toEqual([
      { label: 'Inter', tokens: [] }, { label: 'Semi Bold', tokens: [] },
      { label: '24/32', tokens: [] }, { label: 'letter spacing 0', tokens: [] },
      { label: 'paragraph spacing 16', tokens: [] },
    ]);
  });
  it('adds case and decoration only when they are not the defaults, in words', () => {
    const parts = metricsLine({ ...BASE, textCase: 'UPPER', textDecoration: 'UNDERLINE' }).map((p) => p.label);
    expect(parts.slice(-2)).toEqual(['uppercase', 'underline']);
    expect(metricsLine({ ...BASE, textCase: 'SMALL_CAPS' }).map((p) => p.label)).toContain('small caps');
  });
  it('renders auto and percent line heights and percent letter spacing honestly', () => {
    expect(metricsLine({ ...BASE, lineHeight: { unit: 'AUTO' } })[2].label).toBe('24/auto');
    expect(metricsLine({ ...BASE, lineHeight: { unit: 'PERCENT', value: 150 } })[2].label).toBe('24/150%');
    expect(metricsLine({ ...BASE, letterSpacing: { unit: 'PERCENT', value: 2 } })[3].label).toBe('letter spacing 2%');
  });
  it('attaches the bound token to the part that draws it', () => {
    const parts = metricsLine({ ...BASE, boundTokens: { fontSize: 'type/lg', lineHeight: 'type/lg-lh', paragraphSpacing: 'space/4' } });
    expect(parts[2]).toEqual({ label: '24/32', tokens: ['type/lg', 'type/lg-lh'] });
    expect(parts[4]).toEqual({ label: 'paragraph spacing 16', tokens: ['space/4'] });
  });
});

describe('buildTextSpecimenList', () => {
  // A kit body font distinct from every fixture's own family, so a specimen
  // that keeps the default is distinguishable from one that loaded its own.
  beforeEach(() => { installFakeFigma(); setFontFamilies('Kit Sans', 'Kit Sans'); });
  afterEach(() => uninstallFakeFigma());
  const row: FoundationTextRow = { kind: 'textStyle', name: 'Heading/L', description: 'Page titles.', metrics: BASE };

  it('sets the pangram in the style at true size and lists the metrics under it', () => {
    const list = buildTextSpecimenList([row], 768, true, new Set()) as unknown as FakeFrame;
    const chars = list.textChars();
    expect(chars).toContain('Heading/L');
    expect(chars).toContain('Page titles.');
    expect(chars).toContain(SPECIMEN_TEXT);
    const specimen = list.findText(SPECIMEN_TEXT) as FakeText;
    expect(specimen.fontName).toEqual({ family: 'Inter', style: 'Semi Bold' });
    expect(specimen.fontSize).toBe(24);
    expect(chars).toContain('paragraph spacing 16');
  });
  it('keeps the default font and says so when the family failed to load', () => {
    const list = buildTextSpecimenList([row], 768, true, new Set(['Inter|Semi Bold'])) as unknown as FakeFrame;
    expect(list.textChars()).toContain('Font not available, showing the default font.');
    expect((list.findText(SPECIMEN_TEXT) as FakeText).fontName.family).not.toBe('Inter');
  });
  it('leaves the description out when descriptions are off', () => {
    const list = buildTextSpecimenList([row], 768, false, new Set()) as unknown as FakeFrame;
    expect(list.textChars()).not.toContain('Page titles.');
  });
});
