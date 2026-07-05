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
      axis: 'State',
      states: ['Default', 'Hover', 'Disabled'], // lifecycle order
      rowAxis: 'Type',
    });
  });

  it('detects a state-like axis by value vocabulary', () => {
    const info = detectStateMatrix([{ prop: 'Interaction', values: ['Rest', 'Hover', 'Pressed'] }]);
    expect(info?.axis).toBe('Interaction');
    expect(info?.rowAxis).toBeNull();
  });

  it('ignores modifier (boolean) axes as row candidates', () => {
    const info = detectStateMatrix([
      { prop: 'Disabled', values: ['True', 'False'] },
      { prop: 'State', values: ['Default', 'Hover'] },
    ]);
    expect(info?.rowAxis).toBeNull();
  });

  it('returns null when nothing state-like exists', () => {
    expect(detectStateMatrix([{ prop: 'Size', values: ['S', 'M', 'L'] }])).toBeNull();
  });
});

describe('stateTokenDeltas', () => {
  it('names the tokens that change per state vs default', () => {
    const tokens: TokenRule[] = [
      { part: 'Container', property: 'padding', conditions: {}, token: 'spacing/md' },
      { part: 'Container', property: 'fill', conditions: { State: ['Default'] }, token: 'color/rest' },
      { part: 'Container', property: 'fill', conditions: { State: ['Hover'] }, token: 'color/hover' },
      { part: 'Container', property: 'border', conditions: { State: ['Hover'] }, token: 'color/border-hover' },
    ];
    const deltas = stateTokenDeltas(
      tokens,
      { State: 'Default' },
      { axis: 'State', states: ['Default', 'Hover'], rowAxis: null },
    );
    expect(deltas).toEqual([
      {
        state: 'Hover',
        changes: [
          { part: 'Container', property: 'fill', token: 'color/hover' },
          { part: 'Container', property: 'border', token: 'color/border-hover' },
        ],
      },
    ]);
  });
});
