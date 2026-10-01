/**
 * effects.ts: the effect layer model, and the pure converter from Figma's effect
 * shapes into it. `effectLayerOf` takes a structurally typed object, so the
 * plugin can hand it a live `Effect` and a test a literal.
 */
import type { RefIdentity, SerializedNode } from './tree';
import { defaultVariant } from './anatomy';
import { cleanPartName, walkParts } from './naming';

/** A colour with its opacity, both already rounded. */
export interface Rgba { hex: string; alpha: number }
export interface Vec2 { x: number; y: number }

/** The fields Figma lets a variable bind on an effect
 *  (`VariableBindableEffectField`). Blurs accept only `radius`; noise, texture
 *  and glass accept none, and their own typings declare `boundVariables?: {}`. */
export type EffectField = 'color' | 'radius' | 'spread' | 'offsetX' | 'offsetY';
export type EffectBindings = Partial<Record<EffectField, RefIdentity>>;

/**
 * One effect layer: nine concrete shapes plus `unknown`, matching Figma's
 * `Effect` union. `radius` is not universal: noise has none, and a union that
 * fabricated one would invent a measurement.
 *
 * Each member has a single literal `type` (and `blurType`), because
 * `Extract<EffectLayer, { type: 'b' }>` cannot pick out a member whose `type`
 * is `'a' | 'b'`, and callers rely on that narrowing.
 *
 * Bindings attach to their FIELD, as Figma's do: node-level
 * `boundVariables.effects` is a flat `VariableAlias[]` with no field identity.
 */
export type EffectLayer =
  | { type: 'drop-shadow'; visible: boolean; blendMode: string;
      color: Rgba; offset: Vec2; radius: number; spread?: number;
      showShadowBehindNode?: boolean; bindings?: EffectBindings }
  | { type: 'inner-shadow'; visible: boolean; blendMode: string;
      color: Rgba; offset: Vec2; radius: number; spread?: number;
      showShadowBehindNode?: boolean; bindings?: EffectBindings }
  | { type: 'layer-blur'; blurType: 'normal';
      visible: boolean; radius: number; bindings?: { radius?: RefIdentity } }
  | { type: 'layer-blur'; blurType: 'progressive';
      visible: boolean; radius: number;
      startRadius: number; startOffset: Vec2; endOffset: Vec2;
      bindings?: { radius?: RefIdentity } }
  | { type: 'background-blur'; blurType: 'normal';
      visible: boolean; radius: number; bindings?: { radius?: RefIdentity } }
  | { type: 'background-blur'; blurType: 'progressive';
      visible: boolean; radius: number;
      startRadius: number; startOffset: Vec2; endOffset: Vec2;
      bindings?: { radius?: RefIdentity } }
  | { type: 'noise'; noiseType: 'monotone' | 'duotone' | 'multitone';
      visible: boolean; blendMode: string; color: Rgba; noiseSize: number;
      density: number; secondaryColor?: Rgba; opacity?: number }
  | { type: 'texture'; visible: boolean; noiseSize: number;
      noiseSizeVector?: Vec2; radius: number; clipToShape: boolean }
  | { type: 'glass'; visible: boolean; radius: number; lightIntensity: number;
      lightAngle: number; refraction: number; depth: number; dispersion: number }
  | { type: 'unknown'; figma_type: string };

/** Whatever a runtime hands us. Structurally typed so this module needs no
 *  Figma globals and no @figma/plugin-typings dependency. */
export interface RawEffect { type: string; [k: string]: unknown }

/**
 * Trim binary-float noise off a measurement (140 arrives as 139.9999976158142),
 * which an agent would otherwise copy into CSS. Geometry takes 2 decimals,
 * keeping a real 137.5; alpha takes 4, since Figma's percent field expresses 0.125.
 */
export const roundN = (n: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

const round2 = (n: number): number => roundN(n, 2);

const hex2 = (c: number): string => Math.round(c * 255).toString(16).padStart(2, '0');

const rgbaOf = (c: { r: number; g: number; b: number; a: number }): Rgba => ({
  hex: `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`,
  alpha: roundN(c.a, 4),
});

const vec2Of = (v: { x: number; y: number }): Vec2 => ({ x: round2(v.x), y: round2(v.y) });

const NOISE_TYPES: Record<string, 'monotone' | 'duotone' | 'multitone'> = {
  MONOTONE: 'monotone', DUOTONE: 'duotone', MULTITONE: 'multitone',
};

/**
 * One raw effect as an EffectLayer. `bindings` comes from the caller, since
 * resolving a variable id is async and Figma-side. An unrecognized `type`
 * becomes `{ type: 'unknown', figma_type }`, never dropped.
 */
export function effectLayerOf(raw: RawEffect, bindings?: EffectBindings): EffectLayer {
  const r = raw as Record<string, never> & RawEffect;
  const visible = Boolean(r.visible);
  const bound = bindings && Object.keys(bindings).length > 0 ? { bindings } : {};

  switch (raw.type) {
    case 'DROP_SHADOW':
    case 'INNER_SHADOW': {
      const shadow = raw as unknown as {
        color: { r: number; g: number; b: number; a: number };
        offset: { x: number; y: number }; radius: number; spread?: number;
        blendMode: string; showShadowBehindNode?: boolean;
      };
      const shared = {
        visible,
        blendMode: String(shadow.blendMode),
        color: rgbaOf(shadow.color),
        offset: vec2Of(shadow.offset),
        radius: round2(shadow.radius),
        // An absent spread is an absent key, never a fabricated 0.
        ...(shadow.spread !== undefined ? { spread: round2(shadow.spread) } : {}),
        ...(shadow.showShadowBehindNode !== undefined
          ? { showShadowBehindNode: shadow.showShadowBehindNode } : {}),
        ...bound,
      };
      // Two returns, so each object's `type` is one literal, as the split union requires.
      return raw.type === 'DROP_SHADOW'
        ? { type: 'drop-shadow', ...shared }
        : { type: 'inner-shadow', ...shared };
    }
    case 'LAYER_BLUR':
    case 'BACKGROUND_BLUR': {
      const blur = raw as unknown as {
        radius: number; blurType?: string;
        startRadius?: number; startOffset?: { x: number; y: number };
        endOffset?: { x: number; y: number };
      };
      const isLayer = raw.type === 'LAYER_BLUR';
      const radiusBinding = bindings?.radius ? { bindings: { radius: bindings.radius } } : {};
      // Two returns per branch, as in the shadow case.
      if (blur.blurType === 'PROGRESSIVE' && blur.startOffset && blur.endOffset) {
        const progressive = {
          blurType: 'progressive' as const, visible, radius: round2(blur.radius),
          startRadius: round2(blur.startRadius ?? 0),
          startOffset: vec2Of(blur.startOffset),
          endOffset: vec2Of(blur.endOffset),
          ...radiusBinding,
        };
        return isLayer
          ? { type: 'layer-blur', ...progressive }
          : { type: 'background-blur', ...progressive };
      }
      const normal = { blurType: 'normal' as const, visible, radius: round2(blur.radius), ...radiusBinding };
      return isLayer
        ? { type: 'layer-blur', ...normal }
        : { type: 'background-blur', ...normal };
    }
    case 'NOISE': {
      const noise = raw as unknown as {
        noiseType: string; color: { r: number; g: number; b: number; a: number };
        blendMode: string; noiseSize: number; density: number;
        secondaryColor?: { r: number; g: number; b: number; a: number };
        opacity?: number;
      };
      const noiseType = NOISE_TYPES[noise.noiseType];
      // An unknown noiseType is an unknown shape, reported as one rather than
      // guessed at: the secondary colour and opacity fields differ per subtype.
      if (!noiseType) return { type: 'unknown', figma_type: `NOISE/${noise.noiseType}` };
      return {
        type: 'noise', noiseType, visible,
        blendMode: String(noise.blendMode),
        color: rgbaOf(noise.color),
        noiseSize: round2(noise.noiseSize),
        density: round2(noise.density),
        ...(noise.secondaryColor ? { secondaryColor: rgbaOf(noise.secondaryColor) } : {}),
        ...(noise.opacity !== undefined ? { opacity: roundN(noise.opacity, 4) } : {}),
      };
    }
    case 'TEXTURE': {
      const tex = raw as unknown as {
        noiseSize: number; noiseSizeVector?: { x: number; y: number };
        radius: number; clipToShape: boolean;
      };
      return {
        type: 'texture', visible,
        noiseSize: round2(tex.noiseSize),
        ...(tex.noiseSizeVector ? { noiseSizeVector: vec2Of(tex.noiseSizeVector) } : {}),
        radius: round2(tex.radius),
        clipToShape: Boolean(tex.clipToShape),
      };
    }
    case 'GLASS': {
      const g = raw as unknown as {
        radius: number; lightIntensity: number; lightAngle: number;
        refraction: number; depth: number; dispersion: number;
      };
      return {
        type: 'glass', visible,
        radius: round2(g.radius),
        lightIntensity: round2(g.lightIntensity),
        lightAngle: round2(g.lightAngle),
        refraction: round2(g.refraction),
        depth: round2(g.depth),
        dispersion: round2(g.dispersion),
      };
    }
    default:
      return { type: 'unknown', figma_type: raw.type };
  }
}

/** One node's effect layers, joined to everything else by `path`. */
export interface NodeEffects {
  part: string;
  path: string;
  effects: EffectLayer[];
}

/**
 * Effect layers on the DEFAULT variant, path-keyed. Walks as extractGaps does
 * (hidden subtrees included) so both describe the same nodes; rawValues skips
 * invisible ones and would not line up.
 */
export function extractNodeEffects(root: SerializedNode): NodeEffects[] {
  const out: NodeEffects[] = [];
  const def = defaultVariant(root);
  walkParts(def, root.type === 'COMPONENT_SET' ? 'Container' : cleanPartName(def.name),
    (n, part, path) => {
      if (n.effects && n.effects.length > 0) out.push({ part, path, effects: n.effects });
    });
  return out;
}
