import { describe, it, expect } from 'vitest';
import { easingOf, easingLabel, durationLabel, EASING_PRESET_NAMES } from '../src/motion';

describe('easingOf', () => {
  it('maps every Figma preset to its snake_case name', () => {
    expect(easingOf({ type: 'EASE_OUT' })).toEqual({ type: 'named', name: 'ease_out' });
    expect(easingOf({ type: 'EASE_IN_AND_OUT_BACK' })).toEqual({ type: 'named', name: 'ease_in_and_out_back' });
    expect(easingOf({ type: 'GENTLE' })).toEqual({ type: 'named', name: 'gentle' });
    expect(EASING_PRESET_NAMES).toHaveLength(11);
  });
  it('keeps a custom cubic bezier as four canonical numbers', () => {
    expect(easingOf({ type: 'CUSTOM_CUBIC_BEZIER', easingFunctionCubicBezier: { x1: 0.2, y1: 0, x2: 0, y2: 1.0000001192 } }))
      .toEqual({ type: 'cubic_bezier', value: [0.2, 0, 0, 1] });
  });
  it('keeps a normalized spring bounce and rejects a physical spring', () => {
    expect(easingOf({ type: 'CUSTOM_SPRING', easingFunctionSpring: { bounce: 0.3 } })).toEqual({ type: 'spring', bounce: 0.3 });
    expect(easingOf({ type: 'CUSTOM_SPRING', easingFunctionSpring: { mass: 1, stiffness: 100, damping: 10, initialVelocity: 0 } })).toBeNull();
  });
  it('maps HOLD and rejects anything else', () => {
    expect(easingOf({ type: 'HOLD' })).toEqual({ type: 'hold' });
    expect(easingOf({ type: 'WOBBLE' })).toBeNull();
    expect(easingOf({ type: 'CUSTOM_CUBIC_BEZIER' })).toBeNull();
    expect(easingOf(null)).toBeNull();
    expect(easingOf(0.3)).toBeNull();
    expect(easingOf({ type: 'constructor' })).toBeNull();
    expect(easingOf({ type: '__proto__' })).toBeNull();
  });
});

describe('labels', () => {
  it('reads as plugin copy', () => {
    expect(easingLabel({ type: 'named', name: 'ease_out' })).toBe('Ease out');
    expect(easingLabel({ type: 'named', name: 'ease_in_and_out_back' })).toBe('Ease in and out back');
    expect(easingLabel({ type: 'cubic_bezier', value: [0.2, 0, 0, 1] })).toBe('Cubic bezier 0.2, 0, 0, 1');
    expect(easingLabel({ type: 'spring', bounce: 0.3 })).toBe('Spring, bounce 0.3');
    expect(easingLabel({ type: 'hold' })).toBe('Hold');
    expect(durationLabel(0.30000001192092896)).toBe('0.3 s');
    expect(durationLabel(2)).toBe('2 s');
  });
});
