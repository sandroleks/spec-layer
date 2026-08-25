import { describe, it, expect } from 'vitest';
import { effectLayerOf, extractNodeEffects, type EffectLayer } from '../src/effects';
import type { SerializedNode } from '../src/tree';

const rgba = (r: number, g: number, b: number, a: number) => ({ r, g, b, a });

describe('effectLayerOf', () => {
  it('reads a drop shadow whole, geometry included', () => {
    expect(effectLayerOf({
      type: 'DROP_SHADOW', color: rgba(0, 0, 0, 0.08), offset: { x: 0, y: 2 },
      radius: 4, spread: 0, visible: true, blendMode: 'NORMAL',
    })).toEqual({
      type: 'drop-shadow', visible: true, blendMode: 'NORMAL',
      color: { hex: '#000000', alpha: 0.08 }, offset: { x: 0, y: 2 },
      radius: 4, spread: 0,
    });
  });

  it('keeps an invisible layer rather than dropping it', () => {
    const l = effectLayerOf({
      type: 'INNER_SHADOW', color: rgba(1, 0, 0, 1), offset: { x: 1, y: 1 },
      radius: 2, visible: false, blendMode: 'NORMAL',
    }) as Extract<EffectLayer, { type: 'inner-shadow' }>;
    expect(l.visible).toBe(false);
    // spread is optional on Figma's own type; an absent one is an absent key,
    // never a fabricated 0.
    expect('spread' in l).toBe(false);
  });

  it('reads a normal blur', () => {
    expect(effectLayerOf({ type: 'LAYER_BLUR', blurType: 'NORMAL', radius: 8, visible: true }))
      .toEqual({ type: 'layer-blur', blurType: 'normal', visible: true, radius: 8 });
  });

  it('reads a progressive blur with both offsets', () => {
    expect(effectLayerOf({
      type: 'BACKGROUND_BLUR', blurType: 'PROGRESSIVE', radius: 12, visible: true,
      startRadius: 0, startOffset: { x: 0, y: 0 }, endOffset: { x: 0, y: 1 },
    })).toEqual({
      type: 'background-blur', blurType: 'progressive', visible: true, radius: 12,
      startRadius: 0, startOffset: { x: 0, y: 0 }, endOffset: { x: 0, y: 1 },
    });
  });

  it('emits no radius key on a noise layer rather than a zero', () => {
    const l = effectLayerOf({
      type: 'NOISE', noiseType: 'MONOTONE', color: rgba(0, 0, 0, 1), visible: true,
      blendMode: 'NORMAL', noiseSize: 2, density: 0.5,
    });
    // NoiseEffectBase has no radius field. Fabricating one to make the union
    // rectangular would be inventing a measurement.
    expect('radius' in l).toBe(false);
    expect(l).toEqual({
      type: 'noise', noiseType: 'monotone', visible: true, blendMode: 'NORMAL',
      color: { hex: '#000000', alpha: 1 }, noiseSize: 2, density: 0.5,
    });
  });

  it('reads a duotone noise secondary colour and a multitone opacity', () => {
    const duo = effectLayerOf({
      type: 'NOISE', noiseType: 'DUOTONE', color: rgba(0, 0, 0, 1), visible: true,
      blendMode: 'NORMAL', noiseSize: 2, density: 0.5, secondaryColor: rgba(1, 1, 1, 1),
    }) as Extract<EffectLayer, { type: 'noise' }>;
    expect(duo.secondaryColor).toEqual({ hex: '#ffffff', alpha: 1 });

    const multi = effectLayerOf({
      type: 'NOISE', noiseType: 'MULTITONE', color: rgba(0, 0, 0, 1), visible: true,
      blendMode: 'NORMAL', noiseSize: 2, density: 0.5, opacity: 0.4,
    }) as Extract<EffectLayer, { type: 'noise' }>;
    expect(multi.opacity).toBe(0.4);
  });

  it('reads texture and glass', () => {
    expect(effectLayerOf({
      type: 'TEXTURE', visible: true, noiseSize: 3, radius: 1, clipToShape: true,
      noiseSizeVector: { x: 3, y: 4 },
    })).toEqual({
      type: 'texture', visible: true, noiseSize: 3, radius: 1, clipToShape: true,
      noiseSizeVector: { x: 3, y: 4 },
    });
    expect(effectLayerOf({
      type: 'GLASS', visible: true, radius: 6, lightIntensity: 0.5, lightAngle: 45,
      refraction: 0.2, depth: 2, dispersion: 0.1,
    })).toEqual({
      type: 'glass', visible: true, radius: 6, lightIntensity: 0.5, lightAngle: 45,
      refraction: 0.2, depth: 2, dispersion: 0.1,
    });
  });

  it('reports a type it cannot model instead of dropping it', () => {
    // Noise, texture and glass were all recent additions. A runtime can hand us
    // a type this union does not know, and silently dropping it would
    // reintroduce exactly the truncation this whole change exists to remove.
    expect(effectLayerOf({ type: 'HOLOGRAM', visible: true }))
      .toEqual({ type: 'unknown', figma_type: 'HOLOGRAM' });
  });

  it('attaches a binding to its field, not to the layer', () => {
    const l = effectLayerOf({
      type: 'DROP_SHADOW', color: rgba(0, 0, 0, 0.08), offset: { x: 0, y: 2 },
      radius: 4, spread: 0, visible: true, blendMode: 'NORMAL',
    }, {
      color: { id: 'VariableID:5', name: 'color/shadow/default', kind: 'variable', remote: false },
    }) as Extract<EffectLayer, { type: 'drop-shadow' }>;
    expect(l.bindings?.color?.name).toBe('color/shadow/default');
    // The geometry survives alongside the binding. A shadow with a bound colour
    // and a hardcoded radius used to count as fully bound and lose all four
    // numbers.
    expect(l.radius).toBe(4);
    expect(l.offset).toEqual({ x: 0, y: 2 });
  });

  it('rounds alpha to four decimals and geometry to two', () => {
    const l = effectLayerOf({
      type: 'DROP_SHADOW', color: rgba(0, 0, 0, 0.03999999910593033),
      offset: { x: 0, y: 2.0000001 }, radius: 4.239999999, visible: true, blendMode: 'NORMAL',
    }) as Extract<EffectLayer, { type: 'drop-shadow' }>;
    expect(l.color.alpha).toBe(0.04);
    expect(l.radius).toBe(4.24);
    expect(l.offset.y).toBe(2);
  });

  it('reports an unknown noise subtype instead of guessing at its fields', () => {
    // MONOTONE / DUOTONE / MULTITONE are the only noiseTypes this union models.
    // A new one should surface as unknown, not be misread as one of the three.
    expect(effectLayerOf({
      type: 'NOISE', noiseType: 'HALFTONE', color: rgba(0, 0, 0, 1), visible: true,
      blendMode: 'NORMAL', noiseSize: 2, density: 0.5,
    })).toEqual({ type: 'unknown', figma_type: 'NOISE/HALFTONE' });
  });
});

describe('extractNodeEffects', () => {
  it('records one entry per node carrying effects, keyed by path', () => {
    const root = {
      id: '1:1', name: 'Card', type: 'COMPONENT', visible: true,
      children: [{
        id: '1:2', name: 'Wrapper', type: 'FRAME', visible: true,
        effects: [{ type: 'drop-shadow', visible: true, blendMode: 'NORMAL',
          color: { hex: '#000000', alpha: 0.08 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0 }],
      }],
    } as unknown as SerializedNode;
    expect(extractNodeEffects(root)).toEqual([
      { part: 'Wrapper', path: 'Card/Wrapper', effects: root.children![0].effects },
    ]);
  });

  it('includes a hidden subtree, matching extractGaps walk exactly', () => {
    // extractGaps walks with hidden subtrees INCLUDED (no skipInvisible), and
    // a later task joins effects_inline against gaps on (path, property). A
    // walk that skipped invisible nodes here would silently drop rows that
    // gaps still reports, so this fixture is deliberately visible: false.
    const root = {
      id: '1:1', name: 'Card', type: 'COMPONENT', visible: true,
      children: [{
        id: '1:2', name: 'Hidden', type: 'FRAME', visible: false,
        effects: [{ type: 'drop-shadow', visible: true, blendMode: 'NORMAL',
          color: { hex: '#000000', alpha: 0.08 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0 }],
      }],
    } as unknown as SerializedNode;
    expect(extractNodeEffects(root)).toEqual([
      { part: 'Hidden', path: 'Card/Hidden', effects: root.children![0].effects },
    ]);
  });
});
