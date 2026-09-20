import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  metricsLine, buildTextSpecimenList, SPECIMEN_TEXT,
  layerLines, figmaEffectsFor, buildEffectSpecimenList,
} from '../src/foundationSpecimens';
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

const SHADOW = {
  type: 'drop-shadow' as const, visible: true, blendMode: 'NORMAL',
  color: { hex: '#0f172a', alpha: 0.16 }, offset: { x: 0, y: 4 }, radius: 12, spread: 0,
};

describe('layerLines', () => {
  it('describes each layer type in words and numbers, with chips for bound fields', () => {
    const lines = layerLines([
      SHADOW,
      { ...SHADOW, type: 'inner-shadow', visible: false },
      { type: 'layer-blur', blurType: 'normal', visible: true, radius: 8 },
      { type: 'background-blur', blurType: 'progressive', visible: true, radius: 20, startRadius: 2,
        startOffset: { x: 0, y: 0 }, endOffset: { x: 0, y: 1 } },
      { type: 'noise', noiseType: 'monotone', visible: true, blendMode: 'NORMAL',
        color: { hex: '#000000', alpha: 1 }, noiseSize: 1, density: 0.5 },
      { type: 'texture', visible: true, noiseSize: 2, radius: 4, clipToShape: true },
      { type: 'glass', visible: true, radius: 12, lightIntensity: 0.5, lightAngle: 45,
        refraction: 0.2, depth: 4, dispersion: 0.1 },
      { type: 'unknown', figma_type: 'HOLOGRAM' },
    ], { 'effects[0].radius': 'shadow/blur', 'effects[0].color': 'shadow/ink' });
    expect(lines.map((parts) => parts.map((p) => p.label).join(' · '))).toEqual([
      'Drop shadow · 0, 4 · blur 12 · spread 0 · #0F172A 16%',
      'Inner shadow · 0, 4 · blur 12 · spread 0 · #0F172A 16% · hidden',
      'Layer blur · 8',
      'Background blur · 20 · progressive from 2',
      'Noise · monotone · size 1 · density 0.5 · #000000',
      'Texture · size 2 · radius 4',
      'Glass · radius 12 · light 0.5 at 45° · refraction 0.2 · depth 4 · dispersion 0.1',
      'Unsupported effect',
    ]);
    expect(lines[0][2]).toEqual({ label: 'blur 12', tokens: ['shadow/blur'] });
    expect(lines[0][4]).toEqual({ label: '#0F172A 16%', tokens: ['shadow/ink'] });
    expect(lines[1].every((p) => p.tokens.length === 0)).toBe(true);
  });
});

describe('figmaEffectsFor', () => {
  it('maps visible layers to Figma effects and skips hidden and unknown ones', () => {
    const effects = figmaEffectsFor([
      SHADOW, { ...SHADOW, visible: false },
      { type: 'layer-blur', blurType: 'normal', visible: true, radius: 8 },
      { type: 'unknown', figma_type: 'HOLOGRAM' },
    ]);
    expect(effects).toEqual([
      { type: 'DROP_SHADOW', visible: true, blendMode: 'NORMAL',
        color: { r: 15 / 255, g: 23 / 255, b: 42 / 255, a: 0.16 },
        offset: { x: 0, y: 4 }, radius: 12, spread: 0 },
      { type: 'LAYER_BLUR', blurType: 'NORMAL', visible: true, radius: 8 },
    ]);
  });
});

describe('buildEffectSpecimenList', () => {
  beforeEach(() => installFakeFigma());
  afterEach(() => uninstallFakeFigma());

  it('draws a card per style with its layers applied, and the layer lines under the name', () => {
    const list = buildEffectSpecimenList([{
      kind: 'effectStyle', name: 'Elevation/Low', description: 'Cards at rest.',
      layers: [SHADOW], boundTokens: { 'effects[0].radius': 'shadow/blur' },
    }], 768, true) as unknown as FakeFrame;
    const chars = list.textChars();
    expect(chars).toContain('Elevation/Low');
    expect(chars).toContain('Cards at rest.');
    expect(chars).toContain('Drop shadow');
    expect(chars).toContain('shadow/blur');
    const card = list.findByName('Specimen') as FakeFrame;
    expect(card.effects).toHaveLength(1);
    expect(card.width).toBe(160);
    expect(card.height).toBe(96);
  });

  it('draws a backdrop only for a background blur', () => {
    const blurred = buildEffectSpecimenList([{
      kind: 'effectStyle', name: 'Glass', description: '',
      layers: [{ type: 'background-blur', blurType: 'normal', visible: true, radius: 20 }],
      boundTokens: {},
    }], 768, true) as unknown as FakeFrame;
    expect(blurred.findByName('Backdrop')).not.toBeNull();
    const plain = buildEffectSpecimenList([{
      kind: 'effectStyle', name: 'Shadow', description: '', layers: [SHADOW], boundTokens: {},
    }], 768, true) as unknown as FakeFrame;
    expect(plain.findByName('Backdrop')).toBeNull();
  });
});
