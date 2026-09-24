import { describe, it, expect } from 'vitest';
import { SlidingWindowLimiter, MAX_KEYS_PER_SURFACE, REQUEST_LIMITER_MAX_KEYS, LICENSE_LIMITER_MAX_KEYS } from '../src/ratelimit';

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
