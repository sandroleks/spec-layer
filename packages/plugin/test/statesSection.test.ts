import { describe, it, expect } from 'vitest';
import { matrixBandLayout } from '../src/statesSection';

describe('matrixBandLayout', () => {
  it('wraps many columns into bands so cells keep a legible width', () => {
    // 9 states at the default frame width: 3 per band, cells at the max width
    // instead of being crushed to ~60px across a single row.
    expect(matrixBandLayout(9, 768)).toEqual({ colsPerBand: 3, cellW: 180 });
  });

  it('keeps a small column count on a single band', () => {
    expect(matrixBandLayout(2, 768)).toEqual({ colsPerBand: 2, cellW: 180 });
  });

  it('fits more columns per band when the frame is wider', () => {
    // At the widened (token-driven) frame width, cells stay at or above the
    // legible minimum while packing more per band.
    const { colsPerBand, cellW } = matrixBandLayout(9, 1328);
    expect(colsPerBand).toBe(7);
    expect(cellW).toBeGreaterThanOrEqual(160);
  });

  it('never drops below one column per band, even on a narrow frame', () => {
    const { colsPerBand } = matrixBandLayout(5, 250);
    expect(colsPerBand).toBe(1);
  });
});
