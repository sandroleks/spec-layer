import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFakeFigma, uninstallFakeFigma, FakeFrame } from './fakeFigma';
import { matrixLayout, buildMatrixSection } from '../src/statesSection';
import { applyThemeToKit } from '../src/frameKit';
import { emptyBrandTheme, resolveTheme } from '../src/brandColors';

describe('matrixLayout', () => {
  it('wraps many columns into bands so cells keep a legible width', () => {
    // 9 states at the default frame width, small component: 3 per band, cells
    // at the max width instead of being crushed to ~60px across a single row.
    expect(matrixLayout(9, 768, 60)).toEqual({ kind: 'grid', colsPerBand: 3, cellW: 180 });
  });

  it('keeps a small column count on a single band', () => {
    expect(matrixLayout(2, 768, 60)).toEqual({ kind: 'grid', colsPerBand: 2, cellW: 180 });
  });

  it('fits more columns per band when the frame is wider', () => {
    const layout = matrixLayout(9, 1328, 60);
    expect(layout.kind).toBe('grid');
    if (layout.kind !== 'grid') return;
    expect(layout.colsPerBand).toBe(7);
    expect(layout.cellW).toBeGreaterThanOrEqual(160);
  });

  it('widens the cells to the widest instance rather than scaling it, and fits fewer per band', () => {
    // A 300px button needs a 324px cell (12px padding each side): one per band
    // at 768, three per band at 1328, and the cells share the band's width.
    expect(matrixLayout(4, 768, 300)).toEqual({ kind: 'grid', colsPerBand: 1, cellW: 636 });
    const wide = matrixLayout(4, 1328, 300);
    expect(wide).toEqual({ kind: 'grid', colsPerBand: 3, cellW: 390 });
  });

  it('goes down to one axis value per band when a cell cannot sit beside the row label', () => {
    // 700 + 24 > 768 - 120: no grid can hold it, so the layout stacks.
    expect(matrixLayout(4, 768, 700)).toEqual({ kind: 'stacked' });
    expect(matrixLayout(5, 250, 60)).toEqual({ kind: 'stacked' });
  });
});

/** A component whose instances are `width` x `height` and record any rescale. */
function figmaWithComponent(width: number, height: number): { instances: { rescale: ReturnType<typeof vi.fn> }[] } {
  const instances: { rescale: ReturnType<typeof vi.fn> }[] = [];
  installFakeFigma({
    getNodeByIdAsync: async () => ({
      type: 'COMPONENT',
      createInstance: () => {
        const inst = { width, height, rescale: vi.fn(), setExplicitVariableModeForCollection: vi.fn() };
        instances.push(inst);
        return inst;
      },
    }),
  });
  return { instances };
}

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

  it('says "No variant" in a cell the component has no variant for, never a dash', async () => {
    const grid = await buildMatrixSection({
      axisName: 'State', columns: ['Default', 'Hover'], rows: [{ label: 'checkbox', cells: [null, null] }],
    }, 768) as unknown as FakeFrame;
    const chars = grid.textChars();
    expect(chars.filter((c) => c === 'No variant')).toHaveLength(2);
    for (const c of chars) expect(c).not.toMatch(/[–—]/);
  });

  it('never scales an instance: a wide component gets one column per band and a cell that fits it', async () => {
    const { instances } = figmaWithComponent(500, 40);
    await applyThemeToKit(resolveTheme(emptyBrandTheme()));
    const grid = await buildMatrixSection({
      axisName: 'State', columns: ['Default', 'Hover', 'Focus'],
      rows: [{ label: 'button', cells: ['1:1', '1:2', '1:3'] }],
    }, 768) as unknown as FakeFrame;
    expect(instances).toHaveLength(3);
    for (const inst of instances) expect(inst.rescale).not.toHaveBeenCalled();
    expect(grid.textChars()).not.toContain('Previews are scaled to fit the grid.');
    // 500 + 24 = 524 per cell, one per band at 768: three bands, each one
    // header row and one grid row, the cell taking the band's usable width.
    const bands = grid.children as FakeFrame[];
    expect(bands).toHaveLength(3);
    const slot = ((bands[0].children[1] as FakeFrame).children[1]) as FakeFrame;
    expect(slot.name).toBe('Instance slot');
    expect(slot.width).toBe(636);
  });

  it('goes down when a component is wider than a cell can be: one axis value per band, a full-width slot per row', async () => {
    const { instances } = figmaWithComponent(700, 48);
    await applyThemeToKit(resolveTheme(emptyBrandTheme()));
    const grid = await buildMatrixSection({
      columns: ['Small', 'Large'],
      rows: [{ label: 'Primary', cells: ['1:1', '1:2'] }, { label: 'Secondary', cells: ['1:3', '1:4'] }],
    }, 768) as unknown as FakeFrame;
    for (const inst of instances) expect(inst.rescale).not.toHaveBeenCalled();
    const bands = grid.children as FakeFrame[];
    expect(bands).toHaveLength(2);
    // Each band: the axis value as its heading, then per row a label line and
    // a slot that fills the column, holding the instance at true size.
    expect(bands[0].textChars()).toEqual(['Small', 'Primary', 'Secondary']);
    expect(bands[1].textChars()).toEqual(['Large', 'Primary', 'Secondary']);
    const slots = bands[0].findAllNamed('Instance slot');
    expect(slots).toHaveLength(2);
    for (const slot of slots) expect(slot.layoutSizingHorizontal).toBe('FILL');
    expect(slots[0].children[0]).toBe(instances[0]);
  });
});
