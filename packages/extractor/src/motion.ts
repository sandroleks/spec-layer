/**
 * motion.ts: the one easing and duration vocabulary. Both Foundation motion
 * variables (EASING / TIMING) and component variant transitions (prototype
 * reactions) read through here, so the canvas, the brief, Markdown, the AI
 * profile and DTCG never disagree on a name or a label.
 *
 * Nothing here converts: a value the model does not state maps to null and the
 * caller records what Figma returned. Figma's preset curves have no numbers in
 * the Plugin API, so a named easing stays a name (design ruling 2026-10-03).
 */
import { canonicalNumber } from './v5/precision';

export type EasingPresetName =
  | 'ease_in' | 'ease_out' | 'ease_in_and_out' | 'linear'
  | 'ease_in_back' | 'ease_out_back' | 'ease_in_and_out_back'
  | 'gentle' | 'quick' | 'bouncy' | 'slow';

export type Easing =
  | { type: 'named'; name: EasingPresetName }
  | { type: 'cubic_bezier'; value: [number, number, number, number] }
  | { type: 'spring'; bounce: number }
  | { type: 'hold' };

/** Figma's wire shape as the serializers hand it over. Only these fields are
 *  copied across the audit boundary. */
export interface RawEasing {
  type: string;
  easingFunctionCubicBezier?: { x1: number; y1: number; x2: number; y2: number };
  easingFunctionSpring?: {
    bounce?: number; mass?: number; stiffness?: number; damping?: number; initialVelocity?: number;
  };
}

/** Figma enum value to the public snake_case name. Order is Figma's documentation order. */
const PRESET_BY_FIGMA_TYPE: Readonly<Record<string, EasingPresetName>> = {
  EASE_IN: 'ease_in',
  EASE_OUT: 'ease_out',
  EASE_IN_AND_OUT: 'ease_in_and_out',
  LINEAR: 'linear',
  EASE_IN_BACK: 'ease_in_back',
  EASE_OUT_BACK: 'ease_out_back',
  EASE_IN_AND_OUT_BACK: 'ease_in_and_out_back',
  GENTLE: 'gentle',
  QUICK: 'quick',
  BOUNCY: 'bouncy',
  SLOW: 'slow',
};

/** Runtime mirror of EasingPresetName, for the v5 validator and the schema parity test. */
export const EASING_PRESET_NAMES: readonly EasingPresetName[] = Object.values(PRESET_BY_FIGMA_TYPE);

const PRESET_LABEL: Readonly<Record<EasingPresetName, string>> = {
  ease_in: 'Ease in',
  ease_out: 'Ease out',
  ease_in_and_out: 'Ease in and out',
  linear: 'Linear',
  ease_in_back: 'Ease in back',
  ease_out_back: 'Ease out back',
  ease_in_and_out_back: 'Ease in and out back',
  gentle: 'Gentle',
  quick: 'Quick',
  bouncy: 'Bouncy',
  slow: 'Slow',
};

const isFinite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Null when `raw` is not an easing this model states. Never a default. */
export function easingOf(raw: unknown): Easing | null {
  if (raw === null || typeof raw !== 'object') return null;
  const value = raw as RawEasing;
  if (typeof value.type !== 'string') return null;
  if (Object.prototype.hasOwnProperty.call(PRESET_BY_FIGMA_TYPE, value.type)) {
    return { type: 'named', name: PRESET_BY_FIGMA_TYPE[value.type] };
  }
  if (value.type === 'HOLD') return { type: 'hold' };
  if (value.type === 'CUSTOM_CUBIC_BEZIER') {
    const b = value.easingFunctionCubicBezier;
    if (!b || ![b.x1, b.y1, b.x2, b.y2].every(isFinite)) return null;
    return {
      type: 'cubic_bezier',
      value: [canonicalNumber(b.x1), canonicalNumber(b.y1), canonicalNumber(b.x2), canonicalNumber(b.y2)],
    };
  }
  if (value.type === 'CUSTOM_SPRING') {
    // A prototype transition's custom spring carries physical parameters and no
    // bounce; converting them is Figma's function, not available here.
    const bounce = value.easingFunctionSpring?.bounce;
    if (!isFinite(bounce)) return null;
    return { type: 'spring', bounce: canonicalNumber(bounce) };
  }
  return null;
}

/** "Ease out", "Cubic bezier 0.2, 0, 0, 1", "Spring, bounce 0.3", "Hold". */
export function easingLabel(e: Easing): string {
  switch (e.type) {
    case 'named': return PRESET_LABEL[e.name];
    case 'cubic_bezier': return `Cubic bezier ${e.value.join(', ')}`;
    case 'spring': return `Spring, bounce ${e.bounce}`;
    case 'hold': return 'Hold';
    default: {
      const exhaustive: never = e;
      return exhaustive;
    }
  }
}

/** "0.3 s". Seconds as the API states them. */
export function durationLabel(seconds: number): string {
  return `${canonicalNumber(seconds)} s`;
}
