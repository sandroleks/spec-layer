import { describe, expect, it } from 'vitest';
import { rovingIndex } from '../src/ui/viewModel/roving';

describe('rovingIndex', () => {
  it('moves right and left, wrapping at both ends', () => {
    expect(rovingIndex(0, 3, 'ArrowRight', 'horizontal')).toBe(1);
    expect(rovingIndex(2, 3, 'ArrowRight', 'horizontal')).toBe(0);
    expect(rovingIndex(1, 3, 'ArrowLeft', 'horizontal')).toBe(0);
    expect(rovingIndex(0, 3, 'ArrowLeft', 'horizontal')).toBe(2);
  });

  it('jumps to the ends with Home and End', () => {
    expect(rovingIndex(1, 3, 'Home', 'horizontal')).toBe(0);
    expect(rovingIndex(0, 3, 'End', 'horizontal')).toBe(2);
  });

  it('answers Up and Down only when the widget moves on both axes, as a radio group does', () => {
    expect(rovingIndex(0, 2, 'ArrowDown', 'horizontal')).toBeNull();
    expect(rovingIndex(0, 2, 'ArrowUp', 'horizontal')).toBeNull();
    expect(rovingIndex(0, 2, 'ArrowDown', 'both')).toBe(1);
    expect(rovingIndex(0, 2, 'ArrowUp', 'both')).toBe(1);
    expect(rovingIndex(1, 2, 'ArrowRight', 'both')).toBe(0);
  });

  it('leaves every other key to the caller', () => {
    for (const key of ['Tab', 'Enter', ' ', 'Escape', 'a']) {
      expect(rovingIndex(0, 3, key, 'both')).toBeNull();
    }
  });

  it('clamps a stale index and answers nothing for an empty widget', () => {
    expect(rovingIndex(-1, 3, 'ArrowRight', 'horizontal')).toBe(1);
    expect(rovingIndex(9, 3, 'ArrowLeft', 'horizontal')).toBe(1);
    expect(rovingIndex(0, 0, 'ArrowRight', 'horizontal')).toBeNull();
  });
});
