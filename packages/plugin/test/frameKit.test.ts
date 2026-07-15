import { describe, it, expect } from 'vitest';
import { setCornerStyle, radius } from '../src/frameKit';

describe('radius', () => {
  it('soft keeps the base values (the current look)', () => {
    setCornerStyle('soft');
    for (const base of [2, 3, 6, 8, 12, 16]) expect(radius(base)).toBe(base);
  });

  it('sharp squares everything off', () => {
    setCornerStyle('sharp');
    for (const base of [2, 3, 6, 8, 12, 16]) expect(radius(base)).toBe(0);
  });

  it('round scales by 1.75 and rounds to whole pixels', () => {
    setCornerStyle('round');
    expect(radius(16)).toBe(28);
    expect(radius(12)).toBe(21);
    expect(radius(8)).toBe(14);
    expect(radius(6)).toBe(11);
    expect(radius(3)).toBe(5);
    expect(radius(2)).toBe(4);
  });

  it('setCornerStyle replaces the previous style completely', () => {
    setCornerStyle('round');
    setCornerStyle('soft');
    expect(radius(16)).toBe(16);
  });
});
