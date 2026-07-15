import { describe, it, expect, vi } from 'vitest';
import { checkLicense, activateLicense, validateLicense, LICENSE_CACHE_TTL_MS, LICENSE_GRACE_MS, LsUnreachable } from '../src/license';

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

describe('validateLicense', () => {
  it('sends the instance id when given one, and maps active → valid', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      valid: true, license_key: { status: 'active' },
    }), { status: 200 }));
    const out = await validateLicense('K', 'inst-1', {
      fetcher: fetcher as unknown as typeof fetch, cache: new MemKV(), now: () => T0,
    });
    expect(out).toEqual({ valid: true, status: 'active' });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/validate');
    expect(JSON.parse(String(init.body))).toEqual({ license_key: 'K', instance_id: 'inst-1' });
  });

  it('omits instance_id from the body when none is given', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      valid: true, license_key: { status: 'active' },
    }), { status: 200 }));
    const out = await validateLicense('K', null, {
      fetcher: fetcher as unknown as typeof fetch, cache: new MemKV(), now: () => T0,
    });
    expect(out).toEqual({ valid: true, status: 'active' });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ license_key: 'K' });
  });

  it('maps a non-active status to invalid', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      valid: true, license_key: { status: 'expired' },
    }), { status: 200 }));
    const out = await validateLicense('K', 'inst-1', {
      fetcher: fetcher as unknown as typeof fetch, cache: new MemKV(), now: () => T0,
    });
    expect(out).toEqual({ valid: false, status: 'expired' });
  });

  it('maps valid:false to invalid even when status claims active (defense-in-depth)', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      valid: false, license_key: { status: 'active' },
    }), { status: 200 }));
    const out = await validateLicense('K', 'inst-1', {
      fetcher: fetcher as unknown as typeof fetch, cache: new MemKV(), now: () => T0,
    });
    expect(out).toEqual({ valid: false, status: 'active' });
  });
});

const lsHttp = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('checkLicense transient-error handling', () => {
  it('does NOT cache an LS 429 as invalid; falls back to the cached active status', async () => {
    const cache = new MemKV();
    let now = T0;
    await checkLicense('K', { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => now });
    now = T0 + LICENSE_CACHE_TTL_MS + 1; // cache stale → revalidates → LS is rate-limiting
    const limited = lsHttp(429, { message: 'Too many requests' });
    expect(await checkLicense('K', { fetcher: limited as unknown as typeof fetch, cache, now: () => now }))
      .toEqual({ tier: 'pro' }); // grace path, NOT a cached 'invalid'
    // and the good cache entry survived
    expect(await checkLicense('K', { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => now }))
      .toEqual({ tier: 'pro' });
  });

  it('treats a 5xx JSON body as an outage, not a verdict', async () => {
    const cache = new MemKV();
    const down = lsHttp(500, { message: 'server error' });
    expect(await checkLicense('K', { fetcher: down as unknown as typeof fetch, cache, now: () => T0 }))
      .toEqual({ tier: 'free', reason: 'unreachable' });
    expect(cache.map.size).toBe(0); // nothing cached
  });

  it('treats a 200 body with no boolean `valid` as an outage', async () => {
    const weird = lsHttp(200, { message: 'maintenance' });
    expect(await checkLicense('K', { fetcher: weird as unknown as typeof fetch, cache: new MemKV(), now: () => T0 }))
      .toEqual({ tier: 'free', reason: 'unreachable' });
  });

  it('passes the inactive status through as its own reason', async () => {
    expect(await checkLicense('K', { fetcher: lsOk('inactive', false) as unknown as typeof fetch, cache: new MemKV(), now: () => T0 }))
      .toEqual({ tier: 'free', reason: 'inactive' });
  });
});

describe('validateLicense cache write (renewal fix)', () => {
  it('overwrites a stale negative cache entry on a successful revalidation', async () => {
    const cache = new MemKV();
    let now = T0;
    // A lapse got cached…
    await checkLicense('K', { fetcher: lsOk('expired', false) as unknown as typeof fetch, cache, now: () => now });
    // …then the user renewed and hit Activate (validate path, instance known).
    const active = vi.fn(async () => new Response(JSON.stringify({ valid: true, license_key: { status: 'active' } }), { status: 200 }));
    await validateLicense('K', 'inst-1', { fetcher: active as unknown as typeof fetch, cache, now: () => now });
    // The very next quota check must see Pro from the refreshed cache, no LS call.
    const neverCalled = vi.fn();
    expect(await checkLicense('K', { fetcher: neverCalled as unknown as typeof fetch, cache, now: () => now }))
      .toEqual({ tier: 'pro' });
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it('throws LsUnreachable on a transient LS failure instead of reporting invalid', async () => {
    const limited = lsHttp(429, { message: 'Too many requests' });
    await expect(validateLicense('K', 'inst-1', { fetcher: limited as unknown as typeof fetch, cache: new MemKV(), now: () => T0 }))
      .rejects.toBeInstanceOf(LsUnreachable);
  });
});

describe('activateLicense transient handling', () => {
  it('throws LsUnreachable on an LS 429 instead of reporting invalid', async () => {
    const limited = lsHttp(429, { message: 'Too many requests' });
    await expect(activateLicense('K', 'Figma plugin', { fetcher: limited as unknown as typeof fetch, cache: new MemKV(), now: () => T0 }))
      .rejects.toBeInstanceOf(LsUnreachable);
  });
});
