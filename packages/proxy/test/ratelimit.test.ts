import { describe, it, expect } from 'vitest';
import { LayeredLimiter, SlidingWindowLimiter, MAX_KEYS_PER_SURFACE, REQUEST_LIMITER_MAX_KEYS, LICENSE_LIMITER_MAX_KEYS } from '../src/ratelimit';

describe('SlidingWindowLimiter', () => {
  it('allows up to the limit within the window, then refuses', () => {
    const l = new SlidingWindowLimiter(3, 60_000);
    expect(l.allow('ip1', 0)).toBe(true);
    expect(l.allow('ip1', 1)).toBe(true);
    expect(l.allow('ip1', 2)).toBe(true);
    expect(l.allow('ip1', 3)).toBe(false);
    expect(l.allow('ip2', 3)).toBe(true); // independent keys
  });
  it('frees slots as the window slides', () => {
    const l = new SlidingWindowLimiter(1, 60_000);
    expect(l.allow('ip1', 0)).toBe(true);
    expect(l.allow('ip1', 59_999)).toBe(false);
    expect(l.allow('ip1', 60_000)).toBe(true);
  });

  it('bounds attacker-controlled keys and admits new keys after expiry', () => {
    const l = new SlidingWindowLimiter(1, 60_000, 2);
    expect(l.allow('ip1', 0)).toBe(true);
    expect(l.allow('ip2', 0)).toBe(true);
    expect(l.allow('ip3', 0)).toBe(false);
    expect(l.allow('ip3', 60_000)).toBe(true);
  });

  it('gives each surface sharing a limiter its own ten thousand keys', () => {
    expect(REQUEST_LIMITER_MAX_KEYS).toBe(5 * MAX_KEYS_PER_SURFACE);
    expect(LICENSE_LIMITER_MAX_KEYS).toBe(3 * MAX_KEYS_PER_SURFACE);
    const l = new SlidingWindowLimiter(60, 60_000, REQUEST_LIMITER_MAX_KEYS);
    // Two surfaces each fill the old single-surface ceiling; a fresh key on a third still gets in.
    for (let i = 0; i < MAX_KEYS_PER_SURFACE; i += 1) {
      l.allow(`prose:${i}`, 0);
      l.allow(`quota:${i}`, 0);
    }
    expect(l.allow('libpull:new', 0)).toBe(true);
  });

  it('defaults to one surface worth of keys', () => {
    const l = new SlidingWindowLimiter(1, 60_000);
    for (let i = 0; i < MAX_KEYS_PER_SURFACE; i += 1) l.allow(`k${i}`, 0);
    expect(l.allow('one-more', 0)).toBe(false);
  });
});

describe('LayeredLimiter', () => {
  const binding = (outcomes: boolean[]) => {
    const calls: string[] = [];
    return {
      calls,
      limit: async ({ key }: { key: string }) => { calls.push(key); return { success: outcomes.shift() ?? true }; },
    };
  };

  it('asks the shared binding only after the isolate window allows', async () => {
    const shared = binding([true, false]);
    const limiter = new LayeredLimiter(new SlidingWindowLimiter(2, 60_000), shared);
    expect(await limiter.allow('prose:1.2.3.4', 0)).toBe(true);
    expect(await limiter.allow('prose:1.2.3.4', 1)).toBe(false); // the binding refused
    expect(await limiter.allow('prose:1.2.3.4', 2)).toBe(false); // the isolate window is full
    expect(shared.calls).toEqual(['prose:1.2.3.4', 'prose:1.2.3.4']);
  });

  it('falls back to the isolate window alone when there is no binding', async () => {
    const limiter = new LayeredLimiter(new SlidingWindowLimiter(1, 60_000), undefined);
    expect(await limiter.allow('k', 0)).toBe(true);
    expect(await limiter.allow('k', 1)).toBe(false);
  });

  it('lets a request through on the isolate answer when the binding throws, and reports it', async () => {
    const errors: unknown[] = [];
    const broken = { limit: async () => { throw new Error('limiter unavailable'); } };
    const limiter = new LayeredLimiter(new SlidingWindowLimiter(1, 60_000), broken, (err) => errors.push(err));
    expect(await limiter.allow('k', 0)).toBe(true);
    expect(errors).toHaveLength(1);
    expect(await limiter.allow('k', 1)).toBe(false); // the isolate window still caps it
  });
});
