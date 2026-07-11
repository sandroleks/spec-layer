import { describe, it, expect, vi } from 'vitest';
import { checkLicense, activateLicense, LICENSE_CACHE_TTL_MS, LICENSE_GRACE_MS } from '../src/license';

class MemKV {
  map = new Map<string, string>();
  async get(k: string) { return this.map.get(k) ?? null; }
  async put(k: string, v: string) { this.map.set(k, v); }
}

const lsOk = (status: string, valid = status === 'active') =>
  vi.fn(async () => new Response(JSON.stringify({ valid, license_key: { status } }), { status: 200 }));

const T0 = Date.parse('2026-07-01T00:00:00Z');

describe('checkLicense', () => {
  it('valid active key → pro, and caches the result', async () => {
    const cache = new MemKV();
    const fetcher = lsOk('active');
    const deps = { fetcher: fetcher as unknown as typeof fetch, cache, now: () => T0 };
    expect(await checkLicense('K', deps)).toEqual({ tier: 'pro' });
    expect(await checkLicense('K', deps)).toEqual({ tier: 'pro' });
    expect(fetcher).toHaveBeenCalledTimes(1); // second hit served from cache
  });

  it('revalidates after the cache TTL', async () => {
    const cache = new MemKV();
    const fetcher = lsOk('active');
    let now = T0;
    const deps = { fetcher: fetcher as unknown as typeof fetch, cache, now: () => now };
    await checkLicense('K', deps);
    now = T0 + LICENSE_CACHE_TTL_MS + 1;
    await checkLicense('K', deps);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('invalid key → free/invalid', async () => {
    const deps = { fetcher: lsOk('disabled', false) as unknown as typeof fetch, cache: new MemKV(), now: () => T0 };
    expect(await checkLicense('bad', deps)).toEqual({ tier: 'free', reason: 'invalid' });
  });

  it('honors cached status during an outage within the grace window', async () => {
    const cache = new MemKV();
    let now = T0;
    await checkLicense('K', { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => now });
    const down = vi.fn(async () => { throw new Error('ls down'); });
    now = T0 + LICENSE_CACHE_TTL_MS + 1; // cache stale → tries LS → outage → grace
    expect(await checkLicense('K', { fetcher: down as unknown as typeof fetch, cache, now: () => now })).toEqual({ tier: 'pro' });
    now = T0 + LICENSE_GRACE_MS + 1;     // grace exceeded
    expect(await checkLicense('K', { fetcher: down as unknown as typeof fetch, cache, now: () => now })).toEqual({ tier: 'free', reason: 'unreachable' });
  });

  it('never grants pro when valid is false, even if status claims active', async () => {
    const deps = { fetcher: lsOk('active', false) as unknown as typeof fetch, cache: new MemKV(), now: () => T0 };
    expect(await checkLicense('weird', deps)).toEqual({ tier: 'free', reason: 'invalid' });
  });

  it('a later failed validation revokes the cached pro status', async () => {
    const cache = new MemKV();
    let now = T0;
    await checkLicense('K', { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => now });
    now = T0 + LICENSE_CACHE_TTL_MS + 1;
    expect(await checkLicense('K', { fetcher: lsOk('expired', false) as unknown as typeof fetch, cache, now: () => now }))
      .toEqual({ tier: 'free', reason: 'expired' });
    // and the revocation is what's cached now
    expect(await checkLicense('K', { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => now }))
      .toEqual({ tier: 'free', reason: 'expired' });
  });
});

describe('activateLicense', () => {
  it('activates and returns the instance id', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      activated: true, instance: { id: 'inst-1' }, license_key: { status: 'active' },
    }), { status: 200 }));
    const out = await activateLicense('K', 'Figma plugin', {
      fetcher: fetcher as unknown as typeof fetch, cache: new MemKV(), now: () => T0,
    });
    expect(out).toEqual({ valid: true, status: 'active', instanceId: 'inst-1' });
  });
});
