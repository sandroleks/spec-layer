import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installFakeFigma, uninstallFakeFigma, FakeFrame } from './fakeFigma';
import { matrixBandLayout, buildMatrixSection } from '../src/statesSection';
import { applyThemeToKit } from '../src/frameKit';
import { emptyBrandTheme, resolveTheme } from '../src/brandColors';

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

describe('buildMatrixSection', () => {
  beforeEach(async () => { installFakeFigma(); await applyThemeToKit(resolveTheme(emptyBrandTheme())); });
  afterEach(() => uninstallFakeFigma());

  it('renders user-authored headers and labels as typed, and the axis caption in caps', async () => {
    const grid = await buildMatrixSection({
      axisName: 'State', columns: ['isInvalid: true', 'Hover'], rows: [{ label: 'checkbox', cells: [null, null] }],
    }, 768) as unknown as FakeFrame;
    const chars = grid.textChars();
    expect(chars).toContain('STATE');
    expect(chars).toContain('isInvalid: true');
    expect(chars).not.toContain('ISINVALID: TRUE');
    expect(chars).toContain('checkbox');
  });
});
