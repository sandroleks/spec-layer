import { describe, it, expect } from 'vitest';
import {
  easingOf, easingLabel, durationLabel, EASING_PRESET_NAMES,
  axisLabel, triggerLabel, transitionLabel, durationCell, easingCell,
} from '../src/motion';

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
  it('rejects a spring bounce outside 0 to 1', () => {
    expect(easingOf({ type: 'CUSTOM_SPRING', easingFunctionSpring: { bounce: 1.5 } })).toBeNull();
    expect(easingOf({ type: 'CUSTOM_SPRING', easingFunctionSpring: { bounce: -0.1 } })).toBeNull();
    expect(easingOf({ type: 'CUSTOM_SPRING', easingFunctionSpring: { bounce: 1 } })).toEqual({ type: 'spring', bounce: 1 });
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

describe('transition labels', () => {
  const t = { type: 'move_in' as const, direction: 'left' as const, match_layers: true, duration: { number: 0.3, unit: 's' as const }, easing: { type: 'named' as const, name: 'ease_out' as const } };
  it('reads as the prototype panel does', () => {
    expect(axisLabel({ Size: 'Large', State: 'Hover' })).toBe('Large, Hover');
    expect(triggerLabel({ type: 'on_click' }, 'Checkbox box')).toBe('On click (Checkbox box)');
    expect(triggerLabel({ type: 'after_timeout', timeout: 0.8 }, null)).toBe('After delay 0.8 s');
    expect(triggerLabel({ type: 'mouse_leave', delay: 0.2 }, null)).toBe('Mouse leave after 0.2 s');
    expect(transitionLabel(t)).toBe('Move in from left, matching layers');
    expect(transitionLabel({ type: 'instant' })).toBe('Instant');
    expect(durationCell(t)).toBe('0.3 s');
    expect(durationCell({ type: 'instant' })).toBe('');
    expect(easingCell({ ...t, easing: { type: 'unsupported', figma_type: 'CUSTOM_SPRING' } })).toBe('Not supported: CUSTOM_SPRING');
  });
});

describe('labels for values this build does not know', () => {
  it('falls back to the raw type word and never throws', () => {
    expect(triggerLabel({ type: 'wobble_in' } as unknown as Parameters<typeof triggerLabel>[0], null)).toBe('Wobble in');
    expect(transitionLabel({ type: 'wobble_in' } as unknown as Parameters<typeof transitionLabel>[0])).toBe('Wobble in');
    const noDuration = { type: 'dissolve', easing: { type: 'hold' } } as unknown as Parameters<typeof durationCell>[0];
    expect(durationCell(noDuration)).toBe('');
    const noEasing = { type: 'dissolve', duration: { number: 0.3, unit: 's' } } as unknown as Parameters<typeof easingCell>[0];
    expect(easingCell(noEasing)).toBe('');
  });
});
