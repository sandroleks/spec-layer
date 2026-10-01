import { describe, it, expect } from 'vitest';
import { SelectionCache } from '../src/selectionCache';

class Flag {
  isDirty = true;
  consume(): boolean { const was = this.isDirty; this.isDirty = false; return was; }
}

const fp = (value: string | null) => () => Promise.resolve(value);

function shown(cache: SelectionCache, id: string, fingerprint: string | null = 'v1'): void {
  cache.begin(id, Promise.resolve(fingerprint));
  cache.end(id, true);
}

describe('SelectionCache', () => {
  it('reads a component the panel has never shown', async () => {
    const cache = new SelectionCache(new Flag(), true);
    expect(await cache.unchanged('A', fp('v1'))).toBe(false);
  });

  it('skips the component the panel shows when nothing changed', async () => {
    const cache = new SelectionCache(new Flag(), true);
    shown(cache, 'A');
    expect(await cache.unchanged('A', fp('v1'))).toBe(true);
  });

  it('reads again after an edit, a different component, or a variable change', async () => {
    const flag = new Flag();
    const cache = new SelectionCache(flag, true);
    shown(cache, 'A');
    expect(await cache.unchanged('B', fp('v1'))).toBe(false);
    expect(await cache.unchanged('A', fp('v2'))).toBe(false);
    flag.isDirty = true;
    expect(await cache.unchanged('A', fp('v1'))).toBe(false);
  });

  it('counts an edit made while a read was running', async () => {
    const flag = new Flag();
    const cache = new SelectionCache(flag, true);
    cache.begin('A', Promise.resolve('v1'));
    flag.isDirty = true; // the user edits the component mid-read
    cache.end('A', true);
    expect(await cache.unchanged('A', fp('v1'))).toBe(false);
  });

  it('counts an edit made during an overlapping read of another component', async () => {
    const flag = new Flag();
    const cache = new SelectionCache(flag, true);
    cache.begin('A', Promise.resolve('v1'));
    flag.isDirty = true; // A is edited while its read runs
    cache.begin('B', Promise.resolve('v1')); // B's read starts and clears the flag
    cache.end('A', true);
    cache.end('B', false);
    expect(await cache.unchanged('A', fp('v1'))).toBe(false);
  });

  it('does not join a running read that started before an edit', async () => {
    const flag = new Flag();
    const cache = new SelectionCache(flag, true);
    cache.begin('A', Promise.resolve('v1'));
    flag.isDirty = true;
    expect(await cache.unchanged('A', fp('v1'))).toBe(false);
  });

  it('joins a read already running for the same component', async () => {
    const cache = new SelectionCache(new Flag(), true);
    cache.begin('A', Promise.resolve('v1'));
    expect(await cache.unchanged('A', fp('v1'))).toBe(true);
    expect(await cache.unchanged('B', fp('v1'))).toBe(false);
  });

  it('reads again once the panel shows something else', async () => {
    const cache = new SelectionCache(new Flag(), true);
    shown(cache, 'A');
    cache.clear();
    expect(await cache.unchanged('A', fp('v1'))).toBe(false);
  });

  it('does not remember a read whose result never reached the panel', async () => {
    const cache = new SelectionCache(new Flag(), true);
    cache.begin('A', Promise.resolve('v1'));
    cache.end('A', false);
    expect(await cache.unchanged('A', fp('v1'))).toBe(false);
  });

  it('never skips when the fingerprint cannot be read', async () => {
    const cache = new SelectionCache(new Flag(), true);
    shown(cache, 'A', null);
    expect(await cache.unchanged('A', fp(null))).toBe(false);
    shown(cache, 'B');
    expect(await cache.unchanged('B', () => Promise.reject(new Error('no variables')))).toBe(false);
  });

  it('never skips without a live edit watch', async () => {
    const cache = new SelectionCache(new Flag(), false);
    shown(cache, 'A');
    expect(await cache.unchanged('A', fp('v1'))).toBe(false);
  });
});
