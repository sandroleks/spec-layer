import { describe, it, expect } from 'vitest';
import { detectStateMatrix, stateAxisProps } from '../src/statesMatrix';

describe('detectStateMatrix', () => {
  it('detects an axis named State', () => {
    const info = detectStateMatrix([
      { prop: 'Type', values: ['Primary', 'Secondary'] },
      { prop: 'State', values: ['Default', 'Disabled', 'Hover'] },
    ]);
    expect(info).toEqual({
      encoding: 'enum',
      axis: 'State',
      rowAxis: 'Type',
      columns: [
        { label: 'Default', override: { State: 'Default' } },
        { label: 'Hover', override: { State: 'Hover' } },
        { label: 'Disabled', override: { State: 'Disabled' } },
      ],
    });
  });

  it('detects a state-like axis by value vocabulary', () => {
    const info = detectStateMatrix([{ prop: 'Interaction', values: ['Rest', 'Hover', 'Pressed'] }]);
    expect(info?.encoding).toBe('enum');
    expect(info?.axis).toBe('Interaction');
    expect(info?.rowAxis).toBeNull();
  });

  it('ignores modifier (boolean) axes as row candidates for enum state axes', () => {
    const info = detectStateMatrix([
      { prop: 'Disabled', values: ['True', 'False'] },
      { prop: 'State', values: ['Default', 'Hover'] },
    ]);
    expect(info?.encoding).toBe('enum');
    expect(info?.rowAxis).toBeNull();
    expect(info?.columns.some((c) => c.label === 'Disabled')).toBe(false);
  });

  it('returns null when nothing state-like exists', () => {
    expect(detectStateMatrix([{ prop: 'Size', values: ['S', 'M', 'L'] }])).toBeNull();
  });

  it('synthesizes a flags matrix from boolean state-vocab axes', () => {
    const info = detectStateMatrix([
      { prop: 'Hover', values: ['True', 'False'] },
      { prop: 'Disabled', values: ['True', 'False'] },
      { prop: 'Size', values: ['S', 'L'] },
    ]);
    expect(info).toEqual({
      encoding: 'flags',
      axis: null,
      rowAxis: 'Size',
      columns: [
        { label: 'Default', override: {} },
        { label: 'Hover', override: { Hover: 'True' } },
        { label: 'Disabled', override: { Disabled: 'True' } },
      ],
    });
  });

  it('returns null for a non-state boolean axis alone', () => {
    expect(detectStateMatrix([{ prop: 'HasIcon', values: ['True', 'False'] }])).toBeNull();
  });

  it('prefers enum over flags when both are present (mixed)', () => {
    const info = detectStateMatrix([
      { prop: 'State', values: ['Default', 'Hover'] },
      { prop: 'Disabled', values: ['True', 'False'] },
    ]);
    expect(info?.encoding).toBe('enum');
    expect(info?.columns.some((c) => c.label === 'Disabled')).toBe(false);
  });

  it('treats warning, success, and filled boolean axes as state flags', () => {
    const info = detectStateMatrix([
      { prop: 'warning', values: ['True', 'False'] },
      { prop: 'success', values: ['True', 'False'] },
      { prop: 'filled', values: ['True', 'False'] },
      { prop: 'size', values: ['Small', 'Large'] },
    ]);
    expect(info?.encoding).toBe('flags');
    const labels = info?.columns.map((c) => c.label);
    expect(labels).toContain('warning');
    expect(labels).toContain('success');
    expect(labels).toContain('filled');
    expect(info?.rowAxis).toBe('size');
  });

  it('treats parenthetical-qualified active axes as state flags', () => {
    const info = detectStateMatrix([
      { prop: 'active (Filled)', values: ['True', 'False'] },
      { prop: 'active (Empty)', values: ['True', 'False'] },
      { prop: 'size', values: ['Small', 'Large'] },
    ]);
    expect(info?.encoding).toBe('flags');
    const labels = info?.columns.map((c) => c.label);
    expect(labels).toContain('active (Filled)');
    expect(labels).toContain('active (Empty)');
    expect(info?.rowAxis).toBe('size');
  });
});

describe('stateAxisProps', () => {
  it('returns the enum state axis prop', () => {
    const props = stateAxisProps([
      { prop: 'Type', values: ['Primary', 'Secondary'] },
      { prop: 'State', values: ['Default', 'Hover'] },
    ]);
    expect(props).toEqual(new Set(['State']));
  });

  it('returns the boolean state-flag axis props', () => {
    const props = stateAxisProps([
      { prop: 'Hover', values: ['True', 'False'] },
      { prop: 'Disabled', values: ['True', 'False'] },
      { prop: 'Size', values: ['S', 'L'] },
    ]);
    expect(props).toEqual(new Set(['Hover', 'Disabled']));
  });

  it('returns an empty set when there is no state axis', () => {
    const props = stateAxisProps([{ prop: 'Size', values: ['S', 'M', 'L'] }]);
    expect(props).toEqual(new Set());
  });

  it('consumes every state flag on an inputField-style set, leaving only size', () => {
    const props = stateAxisProps([
      { prop: 'hover', values: ['False', 'True'] },
      { prop: 'active (Filled)', values: ['False', 'True'] },
      { prop: 'active (Empty)', values: ['False', 'True'] },
      { prop: 'filled', values: ['False', 'True'] },
      { prop: 'disabled', values: ['False', 'True'] },
      { prop: 'error', values: ['False', 'True'] },
      { prop: 'warning', values: ['False', 'True'] },
      { prop: 'success', values: ['False', 'True'] },
      { prop: 'size', values: ['Small', 'Large'] },
    ]);
    expect(props).toEqual(
      new Set([
        'hover', 'active (Filled)', 'active (Empty)', 'filled',
        'disabled', 'error', 'warning', 'success',
      ]),
    );
  });
});

