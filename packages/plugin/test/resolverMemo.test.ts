import { describe, it, expect, vi } from 'vitest';
import { memoizedResolver } from '../src/resolverMemo';
import type { NodeResolver } from '../src/serialize';

function base() {
  const resolver: NodeResolver = {
    variable: vi.fn(async (id: string) =>
      id === 'missing' ? null : { id, name: `var ${id}`, remote: false, collectionId: 'c1' }),
    style: vi.fn(async (id: string) =>
      id === 'missing' ? null : { id, name: `style ${id}`, remote: false, kind: 'paint-style' as const }),
    mainComponent: vi.fn(async () => ({ name: 'Main', key: 'k' })),
  };
  return resolver;
}

describe('memoizedResolver', () => {
  it('asks the base once per distinct variable id', async () => {
    const b = base();
    const memo = memoizedResolver(b);
    const [a1, a2, c1] = await Promise.all([memo.variable('a'), memo.variable('a'), memo.variable('c')]);
    await memo.variable('a');
    expect(b.variable).toHaveBeenCalledTimes(2);
    expect(a1).toEqual(a2);
    expect(c1?.name).toBe('var c');
  });

  it('asks the base once per distinct style id', async () => {
    const b = base();
    const memo = memoizedResolver(b);
    await memo.style('s');
    await memo.style('s');
    await memo.style('t');
    expect(b.style).toHaveBeenCalledTimes(2);
  });

  it('caches a null answer so a missing id is not re-asked', async () => {
    const b = base();
    const memo = memoizedResolver(b);
    expect(await memo.variable('missing')).toBeNull();
    expect(await memo.variable('missing')).toBeNull();
    expect(b.variable).toHaveBeenCalledTimes(1);
  });

  it('keeps variable and style caches apart', async () => {
    const b = base();
    const memo = memoizedResolver(b);
    await memo.variable('same');
    await memo.style('same');
    expect(b.variable).toHaveBeenCalledTimes(1);
    expect(b.style).toHaveBeenCalledTimes(1);
  });

  it('passes mainComponent through untouched', async () => {
    const b = base();
    const memo = memoizedResolver(b);
    const node = {};
    await memo.mainComponent(node);
    await memo.mainComponent(node);
    expect(b.mainComponent).toHaveBeenCalledTimes(2);
    expect(b.mainComponent).toHaveBeenCalledWith(node);
  });

  it('does not share a cache between two wrappers', async () => {
    const b = base();
    await memoizedResolver(b).variable('a');
    await memoizedResolver(b).variable('a');
    expect(b.variable).toHaveBeenCalledTimes(2);
  });
});
