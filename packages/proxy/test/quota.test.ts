import { describe, it, expect } from 'vitest';
import { QuotaEngine, BOOST_LIMIT, BOOST_WINDOW_MS, MONTHLY_LIMIT, RESERVATION_TTL_MS, RESPONSE_TTL_MS, HEAD_TTL_MS, RATE_LIMIT_PER_MIN, PRO_SOFT_THRESHOLD, QUOTA_PROFILES, PUBLISH_MONTHLY_LIMIT, MAX_RETAINED_RESPONSES, quotaObjectName } from '../src/quota';

const T0 = Date.parse('2026-07-01T00:00:00Z');
const DAY = 864e5;

describe('quotaObjectName', () => {
  it('returns the bare identity id for the ai profile', () => {
    expect(quotaObjectName('user123', 'ai')).toBe('user123');
  });

  it('prefixes the identity id with the profile name for non-ai profiles', () => {
    expect(quotaObjectName('user123', 'publish')).toBe('publish:user123');
  });
});

/** Reserve+commit n times with distinct keys, spaced 1 min apart (avoids rate limit). */
function burn(e: QuotaEngine, n: number, at: number, prefix = 'k') {
  for (let i = 0; i < n; i++) {
    const t = at + i * 60_000;
    const r = e.reserve('free', `${prefix}${i}`, t);
    expect(r.kind).toBe('proceed');
    e.commit(`${prefix}${i}`, t);
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
  it('reports a committed cacheKey as cached without counting it again; the body is the store\'s', () => {
    const e = new QuotaEngine();
    e.reserve('free', 'dup', T0);
    e.commit('dup', T0);
    const r = e.reserve('free', 'dup', T0 + 60_000);
    expect(r).toEqual({ kind: 'cached' });
    expect(e.snapshot('free', T0 + 60_000).used).toBe(1); // still 1
  });

  it('expires the response cache after 24h', () => {
    const e = new QuotaEngine();
    e.reserve('free', 'dup', T0);
    e.commit('dup', T0);
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

  it('prunes expired index entries and hands their keys to the store for deletion', () => {
    const e = new QuotaEngine();
    e.reserve('pro', 'old', T0);
    e.commit('old', T0);
    expect(e.takeEvicted()).toEqual([]);
    // A later unrelated request past the TTL sweeps the old entry out.
    e.reserve('pro', 'new', T0 + RESPONSE_TTL_MS + 1);
    expect(e.toJSON()).not.toContain('old');
    expect(e.takeEvicted()).toEqual(['old']);
    expect(e.takeEvicted()).toEqual([]); // drained
  });

  it('lifts inline bodies out of a pre-split blob and keeps the index', () => {
    const e = new QuotaEngine(JSON.stringify({
      firstSeen: T0, boostUsed: 1, months: {}, reservations: {}, recent: [],
      responses: { a: { body: '{"id":"a"}', at: T0 }, b: { at: T0 + 1 } },
    }));
    expect(e.drainLegacyBodies()).toEqual([{ cacheKey: 'a', body: '{"id":"a"}', at: T0 }]);
    expect(e.drainLegacyBodies()).toEqual([]);
    expect(e.toJSON()).not.toContain('"body"');
    expect(e.reserve('free', 'a', T0 + 2)).toEqual({ kind: 'cached' });
    expect(e.reserve('free', 'b', T0 + 3)).toEqual({ kind: 'cached' });
  });

  it('caps the index at MAX_RETAINED_RESPONSES, evicting the oldest first', () => {
    const e = new QuotaEngine();
    for (let i = 0; i <= MAX_RETAINED_RESPONSES; i += 1) {
      const t = T0 + i * 60_000;
      e.reserve('pro', `k${i}`, t);
      e.commit(`k${i}`, t);
    }
    expect(e.takeEvicted()).toEqual(['k0']);
    expect(e.reserve('pro', 'k0', T0 + (MAX_RETAINED_RESPONSES + 2) * 60_000).kind).toBe('proceed');
  });

  it('commit never reports its own key as evicted when it prunes a stale entry for it', () => {
    const e = new QuotaEngine();
    e.reserve('pro', 'k', T0);
    e.commit('k', T0);
    e.commit('k', T0 + RESPONSE_TTL_MS + 1); // prunes the old 'k', then re-adds it
    expect(e.takeEvicted()).toEqual([]);
    expect(e.reserve('pro', 'k', T0 + RESPONSE_TTL_MS + 2)).toEqual({ kind: 'cached' });
  });

  it('caps a pre-split blob at MAX_RETAINED_RESPONSES on load, keeping the newest, without evicting unwritten bodies', () => {
    const responses: Record<string, { body: string; at: number }> = {};
    for (let i = 0; i < MAX_RETAINED_RESPONSES + 2; i += 1) responses[`k${i}`] = { body: `{"n":${i}}`, at: T0 + i };
    const e = new QuotaEngine(JSON.stringify({ firstSeen: T0, boostUsed: 0, months: {}, reservations: {}, recent: [], responses }));
    const lifted = e.drainLegacyBodies().map((l) => l.cacheKey);
    expect(lifted).toHaveLength(MAX_RETAINED_RESPONSES);
    expect(lifted).not.toContain('k0');
    expect(lifted).not.toContain('k1');
    expect(lifted).toContain(`k${MAX_RETAINED_RESPONSES + 1}`);
    expect(e.takeEvicted()).toEqual([]);
    expect(Object.keys((JSON.parse(e.toJSON()) as { responses: object }).responses)).toHaveLength(MAX_RETAINED_RESPONSES);
  });

  it('forgetResponse removes one entry and reports it once', () => {
    const e = new QuotaEngine();
    e.reserve('pro', 'k', T0);
    e.commit('k', T0);
    e.forgetResponse('k');
    e.forgetResponse('k');
    expect(e.takeEvicted()).toEqual(['k']);
    expect(e.reserve('pro', 'k', T0 + 1).kind).toBe('proceed');
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
    e.commit('c', T0);
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

describe('QuotaEngine publish profile', () => {
  it('has no boost window: the monthly limit applies from first sight', () => {
    const e = new QuotaEngine(undefined, QUOTA_PROFILES.publish);
    const snap = e.snapshot('free', T0);
    expect(snap.limit).toBe(PUBLISH_MONTHLY_LIMIT);
    expect(snap.resetsAt).toBe('2026-08-01T00:00:00.000Z');
    burn(e, PUBLISH_MONTHLY_LIMIT, T0, 'p');
    const r = e.reserve('free', 'p-over', T0 + PUBLISH_MONTHLY_LIMIT * 60_000);
    expect(r).toEqual({ kind: 'exhausted', resetsAt: '2026-08-01T00:00:00.000Z' });
  });

  it('resets on the next UTC month', () => {
    const e = new QuotaEngine(undefined, QUOTA_PROFILES.publish);
    burn(e, PUBLISH_MONTHLY_LIMIT, T0, 'p');
    const august = Date.parse('2026-08-01T00:00:00Z');
    expect(e.reserve('free', 'p-aug', august).kind).toBe('proceed');
  });

  it('rehydrates with the same profile', () => {
    const e = new QuotaEngine(undefined, QUOTA_PROFILES.publish);
    burn(e, 3, T0, 'p');
    const again = new QuotaEngine(e.toJSON(), QUOTA_PROFILES.publish);
    expect(again.snapshot('free', T0 + 3 * 60_000).used).toBe(3);
  });

  it('the ai profile is the default and keeps the boost window', () => {
    expect(QUOTA_PROFILES.ai).toEqual({ boostLimit: BOOST_LIMIT, boostWindowMs: BOOST_WINDOW_MS, monthlyLimit: MONTHLY_LIMIT });
    expect(new QuotaEngine().snapshot('free', T0).limit).toBe(BOOST_LIMIT);
  });
});

describe('QuotaEngine locks and create slots', () => {
  it('a reserve whose base matches the recorded head proceeds, and one that read an older head is pending', () => {
    const e = new QuotaEngine(undefined, QUOTA_PROFILES.publish);
    expect(e.reserve('pro', 'publish:lib_1:100->a', T0, { lock: 'publish:lib_1', base: 100 }).kind).toBe('proceed');
    e.commit('publish:lib_1:100->a', T0 + 1, { head: { lock: 'publish:lib_1', at: 200 } });
    // Read before that commit: its base is the head the commit replaced.
    expect(e.reserve('pro', 'publish:lib_1:100->b', T0 + 2, { lock: 'publish:lib_1', base: 100 })).toEqual({ kind: 'pending' });
    // Read after it: the base is the recorded head.
    expect(e.reserve('pro', 'publish:lib_1:200->b', T0 + 3, { lock: 'publish:lib_1', base: 200 }).kind).toBe('proceed');
  });

  it('accepts any base when no head is recorded, and a base newer than the recorded one', () => {
    const e = new QuotaEngine(undefined, QUOTA_PROFILES.publish);
    // Nothing committed under this lock yet (a library from before heads existed).
    expect(e.reserve('pro', 'publish:lib_1:5->a', T0, { lock: 'publish:lib_1', base: 5 }).kind).toBe('proceed');
    e.commit('publish:lib_1:5->a', T0 + 1, { head: { lock: 'publish:lib_1', at: 200 } });
    // Another identity wrote at 300: a read that has seen it is not stale.
    expect(e.reserve('pro', 'publish:lib_1:300->b', T0 + 2, { lock: 'publish:lib_1', base: 300 }).kind).toBe('proceed');
    // Another library's head is independent.
    expect(e.reserve('pro', 'publish:lib_2:1->a', T0 + 3, { lock: 'publish:lib_2', base: 1 }).kind).toBe('proceed');
  });

  it('records a head only on commit, never on release, and forgets it after HEAD_TTL_MS', () => {
    const e = new QuotaEngine(undefined, QUOTA_PROFILES.publish);
    e.reserve('pro', 'publish:lib_1:100->a', T0, { lock: 'publish:lib_1', base: 100 });
    e.release('publish:lib_1:100->a');
    expect((JSON.parse(e.toJSON()) as { heads: Record<string, unknown> }).heads).toEqual({});
    expect(e.reserve('pro', 'publish:lib_1:100->b', T0 + 1, { lock: 'publish:lib_1', base: 100 }).kind).toBe('proceed');
    e.commit('publish:lib_1:100->b', T0 + 2, { head: { lock: 'publish:lib_1', at: 200 } });
    const later = new QuotaEngine(e.toJSON(), QUOTA_PROFILES.publish);
    expect(later.reserve('pro', 'publish:lib_1:100->c', T0 + 3, { lock: 'publish:lib_1', base: 100 })).toEqual({ kind: 'pending' });
    expect(later.reserve('pro', 'publish:lib_1:100->c', T0 + 2 + HEAD_TTL_MS, { lock: 'publish:lib_1', base: 100 }).kind).toBe('proceed');
  });

  it('a live lock held by another cache key answers pending until it is released', () => {
    const e = new QuotaEngine(undefined, QUOTA_PROFILES.publish);
    expect(e.reserve('pro', 'publish:lib_1:a->h1', T0, { lock: 'publish:lib_1' }).kind).toBe('proceed');
    expect(e.reserve('pro', 'publish:lib_1:a->h2', T0 + 1, { lock: 'publish:lib_1' })).toEqual({ kind: 'pending' });
    // A different library's lock is independent.
    expect(e.reserve('pro', 'publish:lib_2:a->h1', T0 + 2, { lock: 'publish:lib_2' }).kind).toBe('proceed');
    e.release('publish:lib_1:a->h1');
    expect(e.reserve('pro', 'publish:lib_1:a->h2', T0 + 3, { lock: 'publish:lib_1' }).kind).toBe('proceed');
  });

  it('commit frees the lock, and the lock expires with the reservation', () => {
    const e = new QuotaEngine(undefined, QUOTA_PROFILES.publish);
    e.reserve('pro', 'k1', T0, { lock: 'L' });
    e.commit('k1', T0 + 1);
    expect(e.reserve('pro', 'k2', T0 + 2, { lock: 'L' }).kind).toBe('proceed');
    // Crashed holder: nothing commits or releases k2; the lock lapses with its reservation.
    expect(e.reserve('pro', 'k3', T0 + 3, { lock: 'L' })).toEqual({ kind: 'pending' });
    expect(e.reserve('pro', 'k3', T0 + 2 + RESERVATION_TTL_MS, { lock: 'L' }).kind).toBe('proceed');
  });

  it('refuses a create once committed, listed and in-flight creates reach the limit', () => {
    const e = new QuotaEngine(undefined, QUOTA_PROFILES.publish);
    expect(e.reserve('free', 'publish:new:a', T0, { create: { limit: 1, listed: 0 } }).kind).toBe('proceed');
    // In flight: the slot is taken before anything commits.
    expect(e.reserve('free', 'publish:new:b', T0 + 1, { create: { limit: 1, listed: 0 } }))
      .toEqual({ kind: 'library_limit', limit: 1, owned: 0 });
    e.release('publish:new:a');
    expect(e.reserve('free', 'publish:new:b', T0 + 2, { create: { limit: 1, listed: 0 } }).kind).toBe('proceed');
    e.commit('publish:new:b', T0 + 3, { create: true });
    // Committed: the count is the object's own, whatever the listing says.
    expect(e.reserve('free', 'publish:new:c', T0 + 4, { create: { limit: 1, listed: 0 } }))
      .toEqual({ kind: 'library_limit', limit: 1, owned: 1 });
    expect(e.snapshot('free', T0 + 4).used).toBe(1);
  });

  it('trusts the caller\'s listing when it knows more than the counter', () => {
    const e = new QuotaEngine(undefined, QUOTA_PROFILES.publish);
    expect(e.reserve('pro', 'publish:new:a', T0, { create: { limit: 10, listed: 10 } }))
      .toEqual({ kind: 'library_limit', limit: 10, owned: 10 });
    expect(e.reserve('pro', 'publish:new:a', T0 + 1, { create: { limit: 10, listed: 9 } }).kind).toBe('proceed');
  });

  it('an update never holds a create slot, and a create slot is released with its reservation', () => {
    const e = new QuotaEngine(undefined, QUOTA_PROFILES.publish);
    e.reserve('free', 'publish:lib_1:x->y', T0, { lock: 'publish:lib_1' });
    e.commit('publish:lib_1:x->y', T0 + 1);
    expect(e.reserve('free', 'publish:new:a', T0 + 2, { create: { limit: 1, listed: 0 } }).kind).toBe('proceed');
    const later = new QuotaEngine(e.toJSON(), QUOTA_PROFILES.publish);
    expect(later.reserve('free', 'publish:new:b', T0 + 2 + RESERVATION_TTL_MS, { create: { limit: 1, listed: 0 } }).kind).toBe('proceed');
  });

  it('counts a create from its commit marker even after the slot expired, and a replayed commit only once', () => {
    const e = new QuotaEngine(undefined, QUOTA_PROFILES.publish);
    const libraries = () => (JSON.parse(e.toJSON()) as { libraries: number }).libraries;
    expect(e.reserve('free', 'publish:new:a', T0, { create: { limit: 1, listed: 0 } }).kind).toBe('proceed');
    // The write outlived its reservation: commit prunes the slot before it settles.
    const late = T0 + RESERVATION_TTL_MS + 1;
    e.commit('publish:new:a', late, { create: true });
    expect(libraries()).toBe(1);
    expect(e.reserve('free', 'publish:new:b', late + 1, { create: { limit: 1, listed: 0 } }))
      .toEqual({ kind: 'library_limit', limit: 1, owned: 1 });
    e.commit('publish:new:a', late + 2, { create: true });
    expect(libraries()).toBe(1);
    // Without the marker a commit never counts a library, slot or no slot.
    expect(e.reserve('free', 'publish:new:c', late + 3, { create: { limit: 5, listed: 0 } }).kind).toBe('proceed');
    e.commit('publish:new:c', late + 4);
    expect(libraries()).toBe(1);
  });
});
