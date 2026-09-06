import { describe, it, expect } from 'vitest';
import { diffKeyed } from '../src/diff';

interface Item { id: string; value: number }
const byId = (item: Item) => item.id;

describe('diffKeyed', () => {
  it('returns empty lists and no reorder for two empty lists', () => {
    expect(diffKeyed([], [], byId)).toEqual({ added: [], removed: [], changed: [], reordered: false });
  });

  it('reports added items in after order and removed items in before order', () => {
    const before: Item[] = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 3 }];
    const after: Item[] = [{ id: 'z', value: 9 }, { id: 'b', value: 2 }, { id: 'y', value: 8 }];
    const d = diffKeyed(before, after, byId);
    expect(d.added.map(byId)).toEqual(['z', 'y']);
    expect(d.removed.map(byId)).toEqual(['a', 'c']);
    expect(d.changed).toEqual([]);
    expect(d.reordered).toBe(false);
  });

  it('reports a changed item with its before and after, in after order', () => {
    const before: Item[] = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
    const after: Item[] = [{ id: 'b', value: 20 }, { id: 'a', value: 10 }];
    const d = diffKeyed(before, after, byId);
    expect(d.changed).toEqual([
      { before: { id: 'b', value: 2 }, after: { id: 'b', value: 20 } },
      { before: { id: 'a', value: 1 }, after: { id: 'a', value: 10 } },
    ]);
    // A change list is not a reorder even though the order also moved.
    expect(d.reordered).toBe(false);
  });

  it('flags a pure reorder and nothing else', () => {
    const before: Item[] = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
    const after: Item[] = [{ id: 'b', value: 2 }, { id: 'a', value: 1 }];
    expect(diffKeyed(before, after, byId)).toEqual({ added: [], removed: [], changed: [], reordered: true });
  });

  it('does not flag a reorder when the lists are identical', () => {
    const list: Item[] = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
    expect(diffKeyed(list, [...list], byId).reordered).toBe(false);
  });

  it('compares equal keys by canonical serialization: key order and undefined do not count', () => {
    const before = [{ id: 'a', x: 1, y: 2 }];
    const after = [{ id: 'a', y: 2, x: 1, z: undefined }];
    expect(diffKeyed(before, after, (i) => i.id).changed).toEqual([]);
  });

  it('pairs duplicate keys positionally and reports surplus as added or removed, never merged', () => {
    const before: Item[] = [{ id: 'a', value: 1 }, { id: 'a', value: 2 }, { id: 'a', value: 3 }];
    const after: Item[] = [{ id: 'a', value: 1 }, { id: 'a', value: 20 }];
    const d = diffKeyed(before, after, byId);
    expect(d.changed).toEqual([{ before: { id: 'a', value: 2 }, after: { id: 'a', value: 20 } }]);
    expect(d.removed).toEqual([{ id: 'a', value: 3 }]);
    expect(d.added).toEqual([]);

    const grown = diffKeyed(after, before, byId);
    expect(grown.added).toEqual([{ id: 'a', value: 3 }]);
    expect(grown.removed).toEqual([]);
  });

  it('accepts a custom equality', () => {
    const before: Item[] = [{ id: 'a', value: 1 }];
    const after: Item[] = [{ id: 'a', value: 2 }];
    expect(diffKeyed(before, after, byId, () => true).changed).toEqual([]);
    expect(diffKeyed(before, after, byId, (x, y) => x.value === y.value).changed).toHaveLength(1);
  });

  it('works on plain strings keyed by themselves', () => {
    const d = diffKeyed(['hover', 'focus'], ['focus', 'disabled'], (s) => s);
    expect(d.added).toEqual(['disabled']);
    expect(d.removed).toEqual(['hover']);
  });
});
