import { describe, it, expect } from 'vitest';
import { QuotaEngine, BOOST_LIMIT, BOOST_WINDOW_MS, MONTHLY_LIMIT, RESERVATION_TTL_MS, RESPONSE_TTL_MS, RATE_LIMIT_PER_MIN, PRO_SOFT_THRESHOLD } from '../src/quota';

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

describe('QuotaEngine idempotency', () => {
  it('returns the cached response for a committed cacheKey (no double bill)', () => {
    const e = new QuotaEngine();
    e.reserve('free', 'dup', T0);
    e.commit('dup', '{"id":"msg_1"}', T0);
    const r = e.reserve('free', 'dup', T0 + 60_000);
    expect(r).toEqual({ kind: 'cached', body: '{"id":"msg_1"}' });
    expect(e.snapshot('free', T0 + 60_000).used).toBe(1); // still 1
  });

  it('expires the response cache after 24h', () => {
    const e = new QuotaEngine();
    e.reserve('free', 'dup', T0);
    e.commit('dup', '{}', T0);
    expect(e.reserve('free', 'dup', T0 + RESPONSE_TTL_MS + 1).kind).toBe('proceed');
  });

  it('reports pending while another window holds a live reservation', () => {
    const e = new QuotaEngine();
    e.reserve('free', 'race', T0);
    expect(e.reserve('free', 'race', T0 + 1000).kind).toBe('pending');
  });

  it('lets a retry proceed once the reservation is stale', () => {
    const e = new QuotaEngine();
    e.reserve('free', 'crashed', T0);
    expect(e.reserve('free', 'crashed', T0 + RESERVATION_TTL_MS + 1).kind).toBe('proceed');
  });
});

describe('QuotaEngine rate limit + pro', () => {
  it('rate-limits the 11th request inside a minute', () => {
    const e = new QuotaEngine();
    for (let i = 0; i < RATE_LIMIT_PER_MIN; i++) {
      expect(e.reserve('pro', `r${i}`, T0 + i).kind).toBe('proceed');
    }
    const r = e.reserve('pro', 'r-over', T0 + RATE_LIMIT_PER_MIN);
    expect(r.kind).toBe('rate_limited');
    if (r.kind === 'rate_limited') expect(r.retryAfterMs).toBeGreaterThan(0);
    // window slides: a minute later it's fine again
    expect(e.reserve('pro', 'later', T0 + 61_000).kind).toBe('proceed');
  });

  it('cached hits are not rate-limited (free redraws)', () => {
    const e = new QuotaEngine();
    e.reserve('pro', 'c', T0);
    e.commit('c', '{}', T0);
    for (let i = 0; i < 30; i++) {
      expect(e.reserve('pro', 'c', T0 + 1000 + i).kind).toBe('cached');
    }
  });

  it('pro is never exhausted but flags at the soft threshold', () => {
    const e = new QuotaEngine(JSON.stringify({
      firstSeen: 0, boostUsed: 0,
      months: { [new Date(T0).toISOString().slice(0, 7)]: PRO_SOFT_THRESHOLD },
      reservations: {}, responses: {}, recent: [],
    }));
    const r = e.reserve('pro', 'p1', T0);
    expect(r).toEqual({ kind: 'proceed', flagged: true });
  });
});
