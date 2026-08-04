import { describe, it, expect } from 'vitest';
import { SlidingWindowLimiter } from '../src/ratelimit';

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
});
