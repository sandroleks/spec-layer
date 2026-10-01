import { describe, expect, it } from 'vitest';
import { categorize, isModifierAxis, isStateAxisName } from '../src/pivot';

describe('categorize', () => {
  it('classifies color properties', () => {
    expect(categorize('fill')).toBe('color');
    expect(categorize('border')).toBe('color');
    expect(categorize('background')).toBe('color');
    expect(categorize('color')).toBe('color');
    expect(categorize('outline')).toBe('color');
  });

  it('classifies typography properties', () => {
    expect(categorize('typography')).toBe('typography');
    expect(categorize('font-size')).toBe('typography');
    expect(categorize('font-weight')).toBe('typography');
    expect(categorize('line-height')).toBe('typography');
    expect(categorize('letter-spacing')).toBe('typography');
  });

  it('classifies everything else as measurements', () => {
    expect(categorize('border-radius')).toBe('measurements');
    expect(categorize('padding')).toBe('measurements');
    expect(categorize('padding-x')).toBe('measurements');
    expect(categorize('gap')).toBe('measurements');
  });
});

describe('axis predicates', () => {
  it('isModifierAxis recognizes true/false pairs', () => {
    expect(isModifierAxis({ prop: 'Danger', values: ['false', 'true'] })).toBe(true);
    expect(isModifierAxis({ prop: 'Disabled', values: ['true', 'false'] })).toBe(true);
    expect(isModifierAxis({ prop: 'Type', values: ['Primary', 'Secondary'] })).toBe(false);
    expect(isModifierAxis({ prop: 'X', values: ['true'] })).toBe(false);
  });

  it('isStateAxisName matches State/States', () => {
    expect(isStateAxisName('State')).toBe(true);
    expect(isStateAxisName('states')).toBe(true);
    expect(isStateAxisName('Type')).toBe(false);
  });
});
