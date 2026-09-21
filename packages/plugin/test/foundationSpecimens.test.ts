import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  metricsLine, buildTextSpecimenList, SPECIMEN_TEXT,
  layerLines, figmaEffectsFor, buildEffectSpecimenList,
} from '../src/foundationSpecimens';
import { setFontFamilies } from '../src/frameKit';
import { serializeFoundation } from '../src/serializeFoundation';
import { installFakeFigma, uninstallFakeFigma, FakeFrame, FakeText } from './fakeFigma';
import { buildFoundation, unitContent } from '@spec-layer/extractor';
import type { FoundationEffectRow, FoundationTextRow } from '@spec-layer/extractor';

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
    ], { 'effects[0].blur': 'shadow/blur', 'effects[0].color': 'shadow/ink' });
    expect(lines.map((parts) => parts.map((p) => p.label).join(' · '))).toEqual([
      'Drop shadow · 0, 4 · blur 12 · spread 0 · #0F172A 16%',
      'Inner shadow · 0, 4 · blur 12 · spread 0 · #0F172A 16% · hidden',
      'Layer blur · 8',
      'Background blur · 20 · progressive from 2',
      'Noise · monotone · size 1 · density 0.5 · #000000',
      'Texture · size 2 · radius 4',
      'Glass · radius 12 · light 0.5 at 45° · refraction 0.2 · depth 4 · dispersion 0.1',
      'Unsupported effect (HOLOGRAM)',
    ]);
    expect(lines[0][2]).toEqual({ label: 'blur 12', tokens: ['shadow/blur'] });
    expect(lines[0][4]).toEqual({ label: '#0F172A 16%', tokens: ['shadow/ink'] });
    expect(lines[1].every((p) => p.tokens.length === 0)).toBe(true);
  });

  it('keeps the alpha precision the extractor kept, rather than rounding to whole percent', () => {
    // effects.ts rounds alpha to four decimals because Figma's percent field
    // can express 0.125; printing "13%" for it would state a value nobody set.
    const alpha = (a: number): string =>
      layerLines([{ ...SHADOW, color: { hex: '#0f172a', alpha: a } }], {})[0][4].label;
    expect(alpha(0.125)).toBe('#0F172A 12.5%');
    expect(alpha(0.13)).toBe('#0F172A 13%');
    expect(alpha(1)).toBe('#0F172A 100%');
  });
});

describe('effect binding vocabulary', () => {
  // The Critical this task's review caught: layerLines looked chips up under
  // Figma's own field names, but serializeFoundation renames them on the way
  // out. Driven end to end through the real serializer so the two vocabularies
  // cannot drift apart again without a test failing.
  const alias = (id: string) => ({ type: 'VARIABLE_ALIAS' as const, id });

  type Rgba = { r: number; g: number; b: number; a: number };
  const vars: Record<string, { name: string; type: 'FLOAT' | 'COLOR'; value: number | Rgba }> = {
    v1: { name: 'shadow/blur', type: 'FLOAT', value: 12 },
    v2: { name: 'shadow/offset-y', type: 'FLOAT', value: 4 },
    v3: { name: 'grain/tint', type: 'COLOR', value: { r: 0, g: 0, b: 0, a: 1 } },
    v4: { name: 'glass/radius', type: 'FLOAT', value: 8 },
  };

  const reader = {
    collections: async () => [{
      id: 'c1', name: 'Primitives', defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Mode' }], variableIds: Object.keys(vars),
    }],
    variable: async (id: string) => ({
      id,
      name: vars[id].name,
      resolvedType: vars[id].type,
      description: '', variableCollectionId: 'c1', codeSyntax: {},
      valuesByMode: { m1: vars[id].value }, scopes: [], remote: false,
    }),
    textStyles: async () => [],
    effectStyles: async () => [
      {
        id: 'e1', name: 'Elevation/Low', description: '',
        effects: [{
          type: 'DROP_SHADOW', visible: true, blendMode: 'NORMAL',
          color: { r: 0, g: 0, b: 0, a: 0.16 }, offset: { x: 0, y: 4 }, radius: 12, spread: 0,
          boundVariables: { radius: alias('v1'), offsetY: alias('v2') },
        }],
      },
      {
        // A shadow with no spread at all, carrying a bound spread anyway.
        id: 'e2', name: 'Elevation/Flat', description: '',
        effects: [{
          type: 'DROP_SHADOW', visible: true, blendMode: 'NORMAL',
          color: { r: 0, g: 0, b: 0, a: 0.16 }, offset: { x: 0, y: 1 }, radius: 2,
          boundVariables: { spread: alias('v1') },
        }],
      },
      {
        // Two layer types whose lines name no bound field at all.
        id: 'e3', name: 'Grain', description: '',
        effects: [
          {
            type: 'NOISE', visible: true, blendMode: 'NORMAL', noiseType: 'MONOTONE',
            color: { r: 0, g: 0, b: 0, a: 1 }, noiseSize: 2, density: 0.5,
            boundVariables: { color: alias('v3') },
          },
          {
            type: 'GLASS', visible: true, radius: 8, lightIntensity: 0.5, lightAngle: 45,
            refraction: 0.2, depth: 4, dispersion: 0.1,
            boundVariables: { radius: alias('v4') },
          },
        ],
      },
    ],
  };

  const rowsByName = async (): Promise<Record<string, FoundationEffectRow>> => {
    const dump = await serializeFoundation(reader, 'FILE1', '2026-09-20T00:00:00.000Z');
    const content = unitContent(buildFoundation(dump), { target: 'effectStyles' })!;
    const out: Record<string, FoundationEffectRow> = {};
    for (const row of content.rows as FoundationEffectRow[]) out[row.name] = row;
    return out;
  };

  it('draws a chip for a bound blur radius and a bound offset, through the real serializer', async () => {
    const row = (await rowsByName())['Elevation/Low'];
    // The serializer's own vocabulary, which is what layerLines has to read.
    expect(Object.keys(row.boundTokens).sort())
      .toEqual(['effects[0].blur', 'effects[0].offset_y']);
    const parts = layerLines(row.layers, row.boundTokens)[0];
    expect(parts[1]).toEqual({ label: '0, 4', tokens: ['shadow/offset-y'] });
    expect(parts[2]).toEqual({ label: 'blur 12', tokens: ['shadow/blur'] });
  });

  it('drops a binding on a field no layer line prints, so it is never hashed unrendered', async () => {
    // The serializer maps color and radius for EVERY layer type, but the noise
    // and glass branches of layerLines call no chip helper, so a binding there
    // would be hashed and never drawn: a source change would then move
    // foundationContentHash over a byte-identical frame.
    const row = (await rowsByName())['Grain'];
    expect(row.boundTokens).toEqual({});
    const lines = layerLines(row.layers, row.boundTokens);
    expect(lines[0].every((p) => p.tokens.length === 0)).toBe(true);
    expect(lines[1].every((p) => p.tokens.length === 0)).toBe(true);
  });

  it('drops a bound spread on a shadow that has none, since the line omits that part', async () => {
    const row = (await rowsByName())['Elevation/Flat'];
    expect(row.boundTokens).toEqual({});
    const labels = layerLines(row.layers, row.boundTokens)[0].map((p) => p.label);
    expect(labels.some((l) => l.startsWith('spread'))).toBe(false);
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

  it('passes through the shadow and texture fields the content hash covers', () => {
    // Both are hashed by foundationContentHash, so a card that dropped them
    // would be hashed-but-undrawn, and a non-square texture would draw at the
    // wrong size besides.
    expect(figmaEffectsFor([{ ...SHADOW, showShadowBehindNode: true }])[0])
      .toMatchObject({ showShadowBehindNode: true });
    expect(figmaEffectsFor([{
      type: 'texture', visible: true, noiseSize: 2, noiseSizeVector: { x: 2, y: 5 },
      radius: 4, clipToShape: true,
    }])[0]).toMatchObject({ noiseSizeVector: { x: 2, y: 5 } });
    // Absent stays absent: no fabricated default reaches the card.
    expect(figmaEffectsFor([SHADOW])[0]).not.toHaveProperty('showShadowBehindNode');
  });

  it('withholds showShadowBehindNode from an inner shadow, which Figma does not declare it on', () => {
    // Sending an undeclared key risks the layer being refused outright, and the
    // per-layer guard would then drop a whole shadow to carry one boolean.
    const inner = figmaEffectsFor([
      { ...SHADOW, type: 'inner-shadow', showShadowBehindNode: true },
    ])[0];
    expect(inner).toMatchObject({ type: 'INNER_SHADOW', radius: 12 });
    expect(inner).not.toHaveProperty('showShadowBehindNode');
  });
});

describe('buildEffectSpecimenList', () => {
  beforeEach(() => installFakeFigma());
  afterEach(() => uninstallFakeFigma());

  it('draws a card per style with its layers applied, and the layer lines under the name', () => {
    const list = buildEffectSpecimenList([{
      kind: 'effectStyle', name: 'Elevation/Low', description: 'Cards at rest.',
      layers: [SHADOW], boundTokens: { 'effects[0].blur': 'shadow/blur' },
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

  it('keeps the layers a Figma build accepts when it rejects one of them', () => {
    // The never-fabricate safeguard: effects are applied one at a time so a
    // shape this build will not take costs only itself. Here GLASS is refused.
    installFakeFigma({
      createRectangle: () => {
        const applied: { type: string }[] = [];
        const r: Record<string, unknown> = {
          type: 'RECTANGLE', name: '', width: 0, height: 0,
          resize(w: number, h: number) { r.width = w; r.height = h; },
        };
        Object.defineProperty(r, 'effects', {
          get: () => applied,
          set: (next: { type: string }[]) => {
            if (next.some((e) => e.type === 'GLASS')) throw new Error('unsupported effect');
            applied.length = 0;
            applied.push(...next);
          },
        });
        return r;
      },
    });
    const list = buildEffectSpecimenList([{
      kind: 'effectStyle', name: 'Mixed', description: '', boundTokens: {},
      layers: [
        SHADOW,
        { type: 'glass', visible: true, radius: 12, lightIntensity: 0.5, lightAngle: 45,
          refraction: 0.2, depth: 4, dispersion: 0.1 },
        { ...SHADOW, type: 'inner-shadow' },
      ],
    }], 768, true) as unknown as FakeFrame;
    const card = list.findByName('Specimen') as FakeFrame;
    expect((card.effects as { type: string }[]).map((e) => e.type))
      .toEqual(['DROP_SHADOW', 'INNER_SHADOW']);
    // Refused on the card, still named in the text: never silently dropped.
    expect(list.textChars()).toContain('Glass');
  });
});
