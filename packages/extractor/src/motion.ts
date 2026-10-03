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
import type { TransitionRule } from './transitions';
import type { SerializedTrigger, SerializedTransitionEffect, TransitionDirection } from './tree';

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

export interface MotionTriggerYaml {
  type: SerializedTrigger['type'];
  timeout?: number; delay?: number; device?: string; key_codes?: number[]; media_hit_time?: number;
}
export type MotionEasingYaml = Easing | { type: 'unsupported'; figma_type: string };
export type MotionTransitionEffectYaml =
  | { type: 'instant' }
  | { type: 'dissolve' | 'smart_animate' | 'scroll_animate';
      duration: { number: number; unit: 's' }; easing: MotionEasingYaml }
  | { type: 'move_in' | 'move_out' | 'push' | 'slide_in' | 'slide_out'; direction: TransitionDirection;
      match_layers: boolean; duration: { number: number; unit: 's' }; easing: MotionEasingYaml };
export interface MotionTransitionYaml {
  from: Record<string, string>; to: Record<string, string>;
  trigger: MotionTriggerYaml; on: string; transition: MotionTransitionEffectYaml;
}

function triggerYaml(trigger: SerializedTrigger): MotionTriggerYaml {
  switch (trigger.type) {
    case 'after_timeout': return { type: trigger.type, timeout: trigger.timeout };
    case 'mouse_up': case 'mouse_down': case 'mouse_enter': case 'mouse_leave':
      return { type: trigger.type, delay: trigger.delay };
    case 'on_key_down': return { type: trigger.type, device: trigger.device, key_codes: [...trigger.keyCodes] };
    case 'on_media_hit': return { type: trigger.type, media_hit_time: trigger.mediaHitTime };
    default: return { type: trigger.type };
  }
}

function effectYaml(t: SerializedTransitionEffect): MotionTransitionEffectYaml {
  if (t.type === 'instant') return { type: 'instant' };
  const duration = { number: t.duration, unit: 's' as const };
  if (!('direction' in t)) return { type: t.type, duration, easing: t.easing };
  return { type: t.type, direction: t.direction, match_layers: t.matchLayers, duration, easing: t.easing };
}

/** The brief's shape for one rule: snake_case keys, duration as a typed value. */
export function transitionYaml(rule: TransitionRule): MotionTransitionYaml {
  return { from: rule.from, to: rule.to, trigger: triggerYaml(rule.trigger), on: rule.triggerPart, transition: effectYaml(rule.transition) };
}

/** Enough of a check to read our own artifact back; Markdown never parses anything else. */
export function isMotionTransitionYaml(value: unknown): value is MotionTransitionYaml {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const trigger = v.trigger as Record<string, unknown> | undefined | null;
  const transition = v.transition as Record<string, unknown> | undefined | null;
  return typeof v.on === 'string' && v.from !== null && typeof v.from === 'object' && v.to !== null && typeof v.to === 'object'
    && trigger !== undefined && trigger !== null && typeof trigger.type === 'string'
    && transition !== undefined && transition !== null && typeof transition.type === 'string';
}

/** "Hover", or "Large, Hover" across axes; "" for a lone component. */
export function axisLabel(values: Record<string, string>): string {
  return Object.values(values).join(', ');
}

const TRIGGER_WORDS: Readonly<Record<SerializedTrigger['type'], string>> = {
  on_click: 'On click', on_hover: 'While hovering', on_press: 'While pressing', on_drag: 'On drag',
  after_timeout: 'After delay', mouse_up: 'Mouse up', mouse_down: 'Mouse down',
  mouse_enter: 'Mouse enter', mouse_leave: 'Mouse leave', on_key_down: 'Key press',
  on_media_hit: 'Media hit', on_media_end: 'Media end',
};

/** Figma's prototype panel words. `onPart` names a trigger layer other than the variant root. */
export function triggerLabel(trigger: MotionTriggerYaml, onPart: string | null): string {
  let text = TRIGGER_WORDS[trigger.type];
  if (trigger.type === 'after_timeout' && trigger.timeout !== undefined) text = `${text} ${durationLabel(trigger.timeout)}`;
  if (trigger.delay !== undefined && trigger.delay > 0) text = `${text} after ${durationLabel(trigger.delay)}`;
  if (trigger.type === 'on_key_down' && trigger.key_codes) text = `${text} ${trigger.key_codes.join(', ')}`;
  if (trigger.type === 'on_media_hit' && trigger.media_hit_time !== undefined) text = `${text} ${durationLabel(trigger.media_hit_time)}`;
  return onPart ? `${text} (${onPart})` : text;
}

const DIRECTIONAL_WORDS: Readonly<Record<'move_in' | 'move_out' | 'push' | 'slide_in' | 'slide_out', [string, 'from' | 'to']>> = {
  move_in: ['Move in', 'from'], move_out: ['Move out', 'to'], push: ['Push', 'from'],
  slide_in: ['Slide in', 'from'], slide_out: ['Slide out', 'to'],
};

export function transitionLabel(t: MotionTransitionEffectYaml): string {
  switch (t.type) {
    case 'instant': return 'Instant';
    case 'dissolve': return 'Dissolve';
    case 'smart_animate': return 'Smart animate';
    case 'scroll_animate': return 'Scroll animate';
    default: {
      const [word, preposition] = DIRECTIONAL_WORDS[t.type];
      return `${word} ${preposition} ${t.direction}${t.match_layers ? ', matching layers' : ''}`;
    }
  }
}

export function durationCell(t: MotionTransitionEffectYaml): string {
  return t.type === 'instant' ? '' : durationLabel(t.duration.number);
}

export function easingCell(t: MotionTransitionEffectYaml): string {
  if (t.type === 'instant') return '';
  return t.easing.type === 'unsupported' ? `Not supported: ${t.easing.figma_type}` : easingLabel(t.easing);
}
