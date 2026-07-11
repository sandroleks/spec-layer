import { describe, it, expect } from 'vitest';
import { QuotaEngine, BOOST_LIMIT, BOOST_WINDOW_MS, MONTHLY_LIMIT } from '../src/quota';

const T0 = Date.parse('2026-07-01T00:00:00Z');
const DAY = 864e5;

/** Reserve+commit n times with distinct keys, spaced 1 min apart (avoids rate limit). */
function burn(e: QuotaEngine, n: number, at: number, prefix = 'k') {
  for (let i = 0; i < n; i++) {
    const t = at + i * 60_000;
    const r = e.reserve('free', `${prefix}${i}`, t);
    expect(r.kind).toBe('proceed');
    e.commit(`${prefix}${i}`, '{}', t);
  }
}

describe('QuotaEngine free tier', () => {
  it('allows 20 in the 30-day boost window, then exhausts', () => {
    const e = new QuotaEngine();
    burn(e, BOOST_LIMIT, T0);
    const r = e.reserve('free', 'k-over', T0 + DAY);
    expect(r.kind).toBe('exhausted');
    if (r.kind === 'exhausted') {
      expect(r.resetsAt).toBe(new Date(T0 + BOOST_WINDOW_MS).toISOString());
    }
  });

  it('after the boost window, allows 10 per calendar month', () => {
    const e = new QuotaEngine();
    burn(e, 5, T0);                       // firstSeen = T0, some boost usage
    const aug = Date.parse('2026-08-15T00:00:00Z'); // boost over
    burn(e, MONTHLY_LIMIT, aug, 'm');
    const r = e.reserve('free', 'm-over', aug + DAY);
    expect(r.kind).toBe('exhausted');
    if (r.kind === 'exhausted') expect(r.resetsAt).toBe('2026-09-01T00:00:00.000Z');
    // new month resets
    const sep = Date.parse('2026-09-02T00:00:00Z');
    expect(e.reserve('free', 'sep-1', sep).kind).toBe('proceed');
  });

  it('only commit decrements; an un-committed reserve does not count', () => {
    const e = new QuotaEngine();
    e.reserve('free', 'a', T0);           // reserved, never committed
    e.release('a');
    const s = e.snapshot('free', T0 + 1);
    expect(s.used).toBe(0);
    expect(s.limit).toBe(BOOST_LIMIT);
  });

  it('serializes and rehydrates', () => {
    const e = new QuotaEngine();
    burn(e, 3, T0);
    const e2 = new QuotaEngine(e.toJSON());
    expect(e2.snapshot('free', T0 + 4 * 60_000).used).toBe(3);
  });
});
