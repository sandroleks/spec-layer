import { describe, it, expect } from 'vitest';
import { placeRightRail, placeBottomRail, type RailItem } from '../src/measureSection';

const item = (center: number, w = 24, h = 18): RailItem => ({ node: { x: 0, y: 0, width: w, height: h }, center });

describe('placeRightRail', () => {
  it('centres each badge on its span when they clear each other', () => {
    const items = [item(20), item(80)];
    placeRightRail(items, 300);
    expect(items.map((i) => [i.node.x, i.node.y])).toEqual([[300, 11], [300, 71]]);
  });
  it('pushes a badge down so it clears the previous one', () => {
    const items = [item(20), item(24), item(28)];
    placeRightRail(items, 300);
    expect(items.map((i) => i.node.y)).toEqual([11, 33, 55]);
  });
});

describe('placeBottomRail', () => {
  it('pushes a badge right so it clears the previous one and reports the extent', () => {
    const items = [item(10), item(12)];
    const extent = placeBottomRail(items, 200, 100);
    expect(items.map((i) => i.node.x)).toEqual([-2, 26]);
    expect(extent).toEqual({ maxRight: 100, maxBottom: 218 });
  });
});
