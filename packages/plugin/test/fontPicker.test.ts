import { describe, it, expect } from 'vitest';
import { computeMenuPlacement } from '../src/ui/fontPicker';

// A typical input box near the given position. width/left just pass through.
const rect = (top: number, bottom: number) => ({ top, bottom, left: 40, width: 300 });

describe('computeMenuPlacement', () => {
  it('opens downward when there is room below', () => {
    const p = computeMenuPlacement(rect(100, 130), 640, 190);
    expect(p.openUp).toBe(false);
    expect(p.top).toBe(134); // bottom + gap(4)
    expect(p.bottom).toBeUndefined();
    expect(p.left).toBe(40);
    expect(p.width).toBe(300);
    expect(p.maxHeight).toBe(190); // full desired height fits
  });

  it('flips upward when the input is near the bottom and there is more room above', () => {
    // input bottom at 620 in a 640 tall window: only 20px below, ~586 above.
    const p = computeMenuPlacement(rect(590, 620), 640, 190);
    expect(p.openUp).toBe(true);
    expect(p.maxHeight).toBe(190); // fits above
    // anchored by bottom, flush to the input top: viewportHeight - inputTop + gap
    expect(p.bottom).toBe(640 - 590 + 4); // 54
    expect(p.top).toBeUndefined();
  });

  it('clamps maxHeight to the available space when neither side fits fully', () => {
    // Short window: input mid-screen, limited room below.
    const p = computeMenuPlacement(rect(180, 210), 300, 190);
    // spaceBelow = 300 - 210 - 4 - 8 = 78; spaceAbove = 180 - 4 - 8 = 168
    // openUp because 78 < 190 and 168 > 78; maxHeight clamps to spaceAbove-capped 168
    expect(p.openUp).toBe(true);
    expect(p.maxHeight).toBe(168);
    expect(p.bottom).toBe(300 - 180 + 4); // 124
  });

  it('never returns a negative maxHeight', () => {
    const p = computeMenuPlacement(rect(0, 640), 640, 190);
    expect(p.maxHeight).toBeGreaterThanOrEqual(0);
  });
});
