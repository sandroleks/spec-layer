import { describe, it, expect } from 'vitest';
import type { ProxyQuota } from '@spec-layer/extractor';
import { allowanceState, allowanceCopy, LOW_REMAINING } from '../src/ui/viewModel/allowance';

const free = (over: Partial<ProxyQuota> = {}): ProxyQuota => ({
  tier: 'free', used: 1, limit: 5, remaining: 4, resetsAt: '2026-08-01T00:00:00Z', ...over,
});

describe('allowanceState', () => {
  it('is loading until the first fetch settles', () => {
    expect(allowanceState(null, false)).toEqual({ kind: 'loading' });
  });

  it('is unknown when a settled fetch produced nothing', () => {
    expect(allowanceState(null, true)).toEqual({
      kind: 'unknown', message: 'Plan status unavailable',
    });
  });

  it('reports pro without a count', () => {
    expect(allowanceState(free({ tier: 'pro' }), true)).toEqual({ kind: 'pro' });
  });

  it('reports the free remaining count', () => {
    expect(allowanceState(free(), true)).toEqual({
      kind: 'free', remaining: 4, limit: 5, resetsAt: '2026-08-01T00:00:00Z',
    });
  });

  it('derives remaining from used when the server omits it', () => {
    const state = allowanceState(free({ remaining: null, used: 3 }), true);
    expect(state).toMatchObject({ kind: 'free', remaining: 2 });
  });

  it('never reports a negative remaining', () => {
    const state = allowanceState(free({ remaining: null, used: 9, limit: 5 }), true);
    expect(state).toMatchObject({ kind: 'free', remaining: 0 });
  });
});

describe('allowanceCopy', () => {
  it('keeps a stable two-line shape while loading', () => {
    const copy = allowanceCopy({ kind: 'loading' });
    expect(copy.tone).toBe('loading');
    expect(copy.title).toBe('AI writing');
    expect(copy.detail).toBe('Checking your plan');
    expect(copy.showUpgrade).toBe(false);
  });

  it('counts remaining free uses and offers the upgrade', () => {
    const copy = allowanceCopy({
      kind: 'free', remaining: 8, limit: 10, resetsAt: '2026-08-01T00:00:00Z',
    });
    expect(copy.tone).toBe('normal');
    expect(copy.detail).toBe('8 of 10 free uses left');
    expect(copy.showUpgrade).toBe(true);
    expect(copy.fillPct).toBe(80);
  });

  it('warns when the remaining count is low', () => {
    const copy = allowanceCopy({
      kind: 'free', remaining: LOW_REMAINING - 1, limit: 20, resetsAt: '',
    });
    expect(copy.tone).toBe('low');
  });

  /**
   * These two pin the same boundary proxy.test.ts already pins for the license
   * page's meter. If the header and the license page ever disagree about what
   * "low" means, one of these fails.
   */
  it('treats 5 remaining as normal, like the license page does', () => {
    expect(allowanceCopy({ kind: 'free', remaining: 5, limit: 20, resetsAt: '' }).tone)
      .toBe('normal');
  });

  it('treats 4 remaining as low, like the license page does', () => {
    expect(allowanceCopy({ kind: 'free', remaining: 4, limit: 20, resetsAt: '' }).tone)
      .toBe('low');
  });

  it('explains exhaustion without blocking anything', () => {
    const copy = allowanceCopy({ kind: 'free', remaining: 0, limit: 5, resetsAt: '' });
    expect(copy.tone).toBe('exhausted');
    expect(copy.detail).toBe('No free uses left');
    expect(copy.showUpgrade).toBe(true);
    expect(copy.fillPct).toBe(0);
  });

  it('shows pro without a count or an upgrade', () => {
    const copy = allowanceCopy({ kind: 'pro' });
    expect(copy.tone).toBe('pro');
    expect(copy.detail).toBe('Unlimited uses');
    expect(copy.showUpgrade).toBe(false);
  });

  it('passes an unknown plan through without demoting it', () => {
    const copy = allowanceCopy({ kind: 'unknown', message: 'Plan status unavailable' });
    expect(copy.tone).toBe('unknown');
    expect(copy.detail).toBe('Plan status unavailable');
    expect(copy.showUpgrade).toBe(false);
  });

  it('gives every state a self-sufficient accessible name', () => {
    const states = [
      { kind: 'loading' },
      { kind: 'free', remaining: 4, limit: 5, resetsAt: '' },
      { kind: 'pro' },
      { kind: 'unknown', message: 'Plan status unavailable' },
    ] as const;
    for (const state of states) {
      const { ariaLabel } = allowanceCopy(state);
      expect(ariaLabel.startsWith('AI writing')).toBe(true);
      expect(ariaLabel).toContain('Open License');
    }
  });

  it('handles a zero limit without dividing by zero', () => {
    const copy = allowanceCopy({ kind: 'free', remaining: 0, limit: 0, resetsAt: '' });
    expect(copy.fillPct).toBe(0);
  });
});
