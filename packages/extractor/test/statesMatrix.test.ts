import { describe, it, expect } from 'vitest';
import { detectStateMatrix, stateTokenDeltas } from '../src/statesMatrix';
import type { TokenRule } from '../src/tokens';

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
});

describe('stateTokenDeltas', () => {
  it('names the tokens that change per state vs default (enum)', () => {
    const tokens: TokenRule[] = [
      { part: 'Container', property: 'padding', conditions: {}, token: 'spacing/md' },
      { part: 'Container', property: 'fill', conditions: { State: ['Default'] }, token: 'color/rest' },
      { part: 'Container', property: 'fill', conditions: { State: ['Hover'] }, token: 'color/hover' },
      { part: 'Container', property: 'border', conditions: { State: ['Hover'] }, token: 'color/border-hover' },
    ];
    const deltas = stateTokenDeltas(
      tokens,
      { State: 'Default' },
      {
        encoding: 'enum',
        axis: 'State',
        rowAxis: null,
        columns: [
          { label: 'Default', override: { State: 'Default' } },
          { label: 'Hover', override: { State: 'Hover' } },
        ],
      },
    );
    expect(deltas).toEqual([
      {
        label: 'Hover',
        changes: [
          { part: 'Container', property: 'fill', token: 'color/hover' },
          { part: 'Container', property: 'border', token: 'color/border-hover' },
        ],
      },
    ]);
  });

  it('names the tokens that change per flag vs default (flags)', () => {
    const tokens: TokenRule[] = [
      { part: 'Container', property: 'padding', conditions: {}, token: 'spacing/md' },
      { part: 'Container', property: 'fill', conditions: {}, token: 'color/rest' },
      { part: 'Container', property: 'opacity', conditions: { Disabled: ['True'] }, token: 'opacity/disabled' },
    ];
    const deltas = stateTokenDeltas(
      tokens,
      { Disabled: 'False', Hover: 'False' },
      {
        encoding: 'flags',
        axis: null,
        rowAxis: null,
        columns: [
          { label: 'Default', override: {} },
          { label: 'Hover', override: { Hover: 'True' } },
          { label: 'Disabled', override: { Disabled: 'True' } },
        ],
      },
    );
    expect(deltas).toEqual([
      {
        label: 'Disabled',
        changes: [{ part: 'Container', property: 'opacity', token: 'opacity/disabled' }],
      },
    ]);
  });
});
