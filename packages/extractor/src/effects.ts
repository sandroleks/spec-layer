/**
 * effects.ts — the effect layer model, and the pure converter from Figma's own
 * effect shapes into it.
 *
 * Pure and Figma-free, like everything else in this package: `effectLayerOf`
 * takes a structurally-typed plain object, so the plugin's serializers can hand
 * it a live `Effect` and a test can hand it a literal.
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
 * One effect layer.
 *
 * Nine concrete shapes plus `unknown`, matching Figma's `Effect` union exactly.
 * `radius` is deliberately NOT universal: `NoiseEffectBase` has no radius field,
 * and a union that fabricated one to look rectangular would be inventing a
 * measurement nobody made.
 *
 * Each concrete shape is its own member with a single literal `type` (and,
 * for blurs, a single literal `blurType`) rather than sharing one member across
 * a literal union. A member whose `type` field is itself `'a' | 'b'` cannot be
 * picked out by `Extract<EffectLayer, { type: 'b' }>` — TS requires the whole
 * member to be assignable to the filter, and a two-literal field never is — so
 * collapsing shadow or blur variants into one member would silently break the
 * exact narrowing idiom this module's own callers and tests rely on.
 *
 * Bindings attach to their FIELD, never to the layer, because that is where
 * Figma puts them: node-level `boundVariables.effects` is a flat `VariableAlias[]`
 * with no field or layer identity, while the real per-field bindings sit on each
 * effect object.
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
 * Trim binary-float noise off a measurement.
 *
 * Figma stores these as doubles derived from percentage and pixel inputs, so a
 * line height typed as 140 arrives as 139.9999976158142 and an alpha of 4%
 * as 0.03999999910593033. Emitted raw, an agent reproduces the noise verbatim
 * in generated CSS.
 *
 * Two places, two precisions. Geometry gets 2 decimals, which is past any
 * precision a type ramp or a shadow expresses while keeping a real 137.5 intact.
 * Alpha gets 4, because Figma's own percent field can express 0.125 and two
 * decimals would silently round it to 0.13.
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
 * One raw effect as an EffectLayer.
 *
 * `bindings` is supplied by the caller rather than read here, because resolving
 * a variable id to a name is asynchronous and Figma-side; this function stays
 * pure so every shape can be covered from a literal.
 *
 * An unrecognized `type` becomes `{ type: 'unknown', figma_type }` rather than
 * being dropped. Noise, texture and glass are recent additions and there will be
 * more; a shape we cannot describe is still worth making visible.
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
        // Optional on Figma's own type. An absent spread is an absent key, not
        // a fabricated 0, so a reader cannot mistake "not set" for "set to 0".
        ...(shadow.spread !== undefined ? { spread: round2(shadow.spread) } : {}),
        ...(shadow.showShadowBehindNode !== undefined
          ? { showShadowBehindNode: shadow.showShadowBehindNode } : {}),
        ...bound,
      };
      // Two returns, not a ternary on `type`, so each object's `type` field is
      // one literal — the shape the split union (and Extract) requires.
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
      // Two returns per branch, not a shared `type` const, for the same reason
      // as the shadow case: the union needs one literal `type` per member.
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
 * Effect layers on the DEFAULT variant, path-keyed.
 *
 * Walks exactly the way extractGaps does (default variant, hidden subtrees
 * INCLUDED) so an entry here and a gap there always describe the same set of
 * nodes. rawValues walks with skipInvisible and would not line up.
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
