import { describe, it, expect, vi } from 'vitest';
import { sha256 } from 'js-sha256';
import { checkLicense, activateLicense, validateLicense, deactivateLicense, LICENSE_CACHE_TTL_MS, LICENSE_GRACE_MS, LsUnreachable } from '../src/license';

const UUID_KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

class MemKV {
  map = new Map<string, string>();
  async get(k: string) { return this.map.get(k) ?? null; }
  async put(k: string, v: string, _opts?: { expirationTtl?: number }) { this.map.set(k, v); }
  async delete(k: string) { this.map.delete(k); }
}

const lsOk = (status: string, valid = status === 'active') =>
  vi.fn(async () => new Response(JSON.stringify({ valid, license_key: { status } }), { status: 200 }));

const T0 = Date.parse('2026-07-01T00:00:00Z');

describe('checkLicense', () => {
  it('valid active key → pro, and caches the result', async () => {
    const cache = new MemKV();
    const fetcher = lsOk('active');
    const deps = { fetcher: fetcher as unknown as typeof fetch, cache, now: () => T0 };
    expect(await checkLicense(UUID_KEY, null, deps)).toEqual({ tier: 'pro' });
    expect(await checkLicense(UUID_KEY, null, deps)).toEqual({ tier: 'pro' });
    expect(fetcher).toHaveBeenCalledTimes(1); // second hit served from cache
  });

  it('revalidates after the cache TTL', async () => {
    const cache = new MemKV();
    const fetcher = lsOk('active');
    let now = T0;
    const deps = { fetcher: fetcher as unknown as typeof fetch, cache, now: () => now };
    await checkLicense(UUID_KEY, null, deps);
    now = T0 + LICENSE_CACHE_TTL_MS + 1;
    await checkLicense(UUID_KEY, null, deps);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('invalid key → free/invalid', async () => {
    const deps = { fetcher: lsOk('disabled', false) as unknown as typeof fetch, cache: new MemKV(), now: () => T0 };
    expect(await checkLicense(UUID_KEY, null, deps)).toEqual({ tier: 'free', reason: 'invalid' });
  });

  it('honors cached status during an outage within the grace window', async () => {
    const cache = new MemKV();
    let now = T0;
    await checkLicense(UUID_KEY, null, { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => now });
    const down = vi.fn(async () => { throw new Error('ls down'); });
    now = T0 + LICENSE_CACHE_TTL_MS + 1; // cache stale → tries LS → outage → grace
    expect(await checkLicense(UUID_KEY, null, { fetcher: down as unknown as typeof fetch, cache, now: () => now })).toEqual({ tier: 'pro' });
    now = T0 + LICENSE_GRACE_MS + 1;     // grace exceeded
    expect(await checkLicense(UUID_KEY, null, { fetcher: down as unknown as typeof fetch, cache, now: () => now })).toEqual({ tier: 'free', reason: 'unreachable' });
  });

  it('never grants pro when valid is false, even if status claims active', async () => {
    const deps = { fetcher: lsOk('active', false) as unknown as typeof fetch, cache: new MemKV(), now: () => T0 };
    expect(await checkLicense(UUID_KEY, null, deps)).toEqual({ tier: 'free', reason: 'invalid' });
  });

  it('a later failed validation revokes the cached pro status', async () => {
    const cache = new MemKV();
    let now = T0;
    await checkLicense(UUID_KEY, null, { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => now });
    now = T0 + LICENSE_CACHE_TTL_MS + 1;
    expect(await checkLicense(UUID_KEY, null, { fetcher: lsOk('expired', false) as unknown as typeof fetch, cache, now: () => now }))
      .toEqual({ tier: 'free', reason: 'expired' });
    // and the revocation is what's cached now
    expect(await checkLicense(UUID_KEY, null, { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => now }))
      .toEqual({ tier: 'free', reason: 'expired' });
  });
});

describe('checkLicense with an instance id', () => {
  it('validates the specific instance with LS', async () => {
    const fetcher = lsOk('active');
    await checkLicense(UUID_KEY, 'inst-1', { fetcher: fetcher as unknown as typeof fetch, cache: new MemKV(), now: () => T0 });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ license_key: UUID_KEY, instance_id: 'inst-1' });
  });

  it('caches key-only and key+instance verdicts separately', async () => {
    const cache = new MemKV();
    await checkLicense(UUID_KEY, null, { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => T0 });
    // deactivated instance: LS says valid:false while the key itself is active
    await checkLicense(UUID_KEY, 'inst-dead', { fetcher: lsOk('active', false) as unknown as typeof fetch, cache, now: () => T0 });
    expect(await checkLicense(UUID_KEY, null, { fetcher: vi.fn() as unknown as typeof fetch, cache, now: () => T0 }))
      .toEqual({ tier: 'pro' });
    expect(await checkLicense(UUID_KEY, 'inst-dead', { fetcher: vi.fn() as unknown as typeof fetch, cache, now: () => T0 }))
      .toEqual({ tier: 'free', reason: 'invalid' });
  });
});

describe('key format gate', () => {
  it('rejects a malformed key without calling LS or writing KV', async () => {
    const fetcher = vi.fn();
    const cache = new MemKV();
    expect(await checkLicense('not-a-key', null, { fetcher: fetcher as unknown as typeof fetch, cache, now: () => T0 }))
      .toEqual({ tier: 'free', reason: 'invalid' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(cache.map.size).toBe(0);
  });
});

describe('KV expiry', () => {
  it('writes cache entries with an expirationTtl', async () => {
    const puts: Array<{ opts?: { expirationTtl?: number } }> = [];
    const cache = {
      get: async () => null,
      put: async (_k: string, _v: string, opts?: { expirationTtl?: number }) => { puts.push({ opts }); },
      delete: async () => {},
    };
    await checkLicense(UUID_KEY, null, { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => T0 });
    expect(puts[0].opts?.expirationTtl).toBe(30 * 86400);
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

  it('caches the activation under the instance-qualified key', async () => {
    const cache = new MemKV();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      activated: true, instance: { id: 'inst-1' }, license_key: { status: 'active' },
    }), { status: 200 }));
    await activateLicense(UUID_KEY, 'Figma plugin', {
      fetcher: fetcher as unknown as typeof fetch, cache, now: () => T0,
    });
    // The plugin's next request bears `key:instanceId` — checkLicense for that
    // exact pair must be served from cache, no LS call.
    const neverCalled = vi.fn();
    expect(await checkLicense(UUID_KEY, 'inst-1', { fetcher: neverCalled as unknown as typeof fetch, cache, now: () => T0 }))
      .toEqual({ tier: 'pro' });
    expect(neverCalled).not.toHaveBeenCalled();
    expect(cache.map.has(`lic:${sha256(`${UUID_KEY}:inst-1`)}`)).toBe(true);
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
    await checkLicense(UUID_KEY, null, { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => now });
    now = T0 + LICENSE_CACHE_TTL_MS + 1; // cache stale → revalidates → LS is rate-limiting
    const limited = lsHttp(429, { message: 'Too many requests' });
    expect(await checkLicense(UUID_KEY, null, { fetcher: limited as unknown as typeof fetch, cache, now: () => now }))
      .toEqual({ tier: 'pro' }); // grace path, NOT a cached 'invalid'
    // and the good cache entry survived
    expect(await checkLicense(UUID_KEY, null, { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => now }))
      .toEqual({ tier: 'pro' });
  });

  it('treats a 5xx JSON body as an outage, not a verdict', async () => {
    const cache = new MemKV();
    const down = lsHttp(500, { message: 'server error' });
    expect(await checkLicense(UUID_KEY, null, { fetcher: down as unknown as typeof fetch, cache, now: () => T0 }))
      .toEqual({ tier: 'free', reason: 'unreachable' });
    expect(cache.map.size).toBe(0); // nothing cached
  });

  it('treats a 200 body with no boolean `valid` as an outage', async () => {
    const weird = lsHttp(200, { message: 'maintenance' });
    expect(await checkLicense(UUID_KEY, null, { fetcher: weird as unknown as typeof fetch, cache: new MemKV(), now: () => T0 }))
      .toEqual({ tier: 'free', reason: 'unreachable' });
  });

  it('passes the inactive status through as its own reason', async () => {
    expect(await checkLicense(UUID_KEY, null, { fetcher: lsOk('inactive', false) as unknown as typeof fetch, cache: new MemKV(), now: () => T0 }))
      .toEqual({ tier: 'free', reason: 'inactive' });
  });
});

describe('validateLicense cache write (renewal fix)', () => {
  it('overwrites a stale negative cache entry on a successful revalidation', async () => {
    const cache = new MemKV();
    let now = T0;
    // A lapse got cached, from the same device (instance) that will renew…
    await checkLicense(UUID_KEY, 'inst-1', { fetcher: lsOk('expired', false) as unknown as typeof fetch, cache, now: () => now });
    // …then the user renewed and hit Activate (validate path, instance known).
    const active = vi.fn(async () => new Response(JSON.stringify({ valid: true, license_key: { status: 'active' } }), { status: 200 }));
    await validateLicense(UUID_KEY, 'inst-1', { fetcher: active as unknown as typeof fetch, cache, now: () => now });
    // The very next quota check from that same instance must see Pro from the
    // refreshed cache, no LS call. (Key-only and key+instance verdicts are
    // cached separately, so this only holds when the instanceId matches.)
    const neverCalled = vi.fn();
    expect(await checkLicense(UUID_KEY, 'inst-1', { fetcher: neverCalled as unknown as typeof fetch, cache, now: () => now }))
      .toEqual({ tier: 'pro' });
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it('overwrites a stale negative cache entry on a successful revalidation (null instance)', async () => {
    const cache = new MemKV();
    const now = T0;
    // A lapse got cached for the bare key (no instance)…
    await checkLicense(UUID_KEY, null, { fetcher: lsOk('expired', false) as unknown as typeof fetch, cache, now: () => now });
    // …then the user renewed and hit Activate (validate path, no instance known).
    const active = vi.fn(async () => new Response(JSON.stringify({ valid: true, license_key: { status: 'active' } }), { status: 200 }));
    await validateLicense(UUID_KEY, null, { fetcher: active as unknown as typeof fetch, cache, now: () => now });
    // The very next quota check for the bare key must see Pro from the
    // refreshed cache, no LS call.
    const neverCalled = vi.fn();
    expect(await checkLicense(UUID_KEY, null, { fetcher: neverCalled as unknown as typeof fetch, cache, now: () => now }))
      .toEqual({ tier: 'pro' });
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it('throws LsUnreachable on a transient LS failure instead of reporting invalid', async () => {
    const limited = lsHttp(429, { message: 'Too many requests' });
    await expect(validateLicense('K', 'inst-1', { fetcher: limited as unknown as typeof fetch, cache: new MemKV(), now: () => T0 }))
      .rejects.toBeInstanceOf(LsUnreachable);
  });

  it('caches the demoted status (not the raw reported one) when valid:false claims active', async () => {
    const cache = new MemKV();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      valid: false, license_key: { status: 'active' },
    }), { status: 200 }));
    const out = await validateLicense(UUID_KEY, 'inst-1', { fetcher: fetcher as unknown as typeof fetch, cache, now: () => T0 });
    expect(out).toEqual({ valid: false, status: 'active' }); // return value keeps the raw reported status
    // The cache must hold the demoted status: a subsequent checkLicense for the
    // same instance must see free/invalid, never a false pro from a cached raw 'active'.
    const neverCalled = vi.fn();
    expect(await checkLicense(UUID_KEY, 'inst-1', { fetcher: neverCalled as unknown as typeof fetch, cache, now: () => T0 }))
      .toEqual({ tier: 'free', reason: 'invalid' });
    expect(neverCalled).not.toHaveBeenCalled();
  });
});

describe('activateLicense transient handling', () => {
  it('throws LsUnreachable on an LS 429 instead of reporting invalid', async () => {
    const limited = lsHttp(429, { message: 'Too many requests' });
    await expect(activateLicense('K', 'Figma plugin', { fetcher: limited as unknown as typeof fetch, cache: new MemKV(), now: () => T0 }))
      .rejects.toBeInstanceOf(LsUnreachable);
  });
});

describe('deactivateLicense', () => {
  it('calls LS deactivate and clears both cache entries', async () => {
    const cache = new MemKV();
    await checkLicense(UUID_KEY, null, { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => T0 });
    await checkLicense(UUID_KEY, 'inst-1', { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => T0 });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ deactivated: true }), { status: 200 }));
    const out = await deactivateLicense(UUID_KEY, 'inst-1', { fetcher: fetcher as unknown as typeof fetch, cache, now: () => T0 });
    expect(out).toEqual({ deactivated: true });
    expect(cache.map.size).toBe(0);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/deactivate');
    expect(JSON.parse(String(init.body))).toEqual({ license_key: UUID_KEY, instance_id: 'inst-1' });
  });
  it('throws LsUnreachable on a transient failure', async () => {
    const down = vi.fn(async () => { throw new Error('down'); });
    await expect(deactivateLicense(UUID_KEY, 'inst-1', { fetcher: down as unknown as typeof fetch, cache: new MemKV(), now: () => T0 }))
      .rejects.toBeInstanceOf(LsUnreachable);
  });
});

describe('cache key hygiene', () => {
  it('never stores the raw license key in KV', async () => {
    const SECRET_KEY = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb';
    const cache = new MemKV();
    await checkLicense(SECRET_KEY, null, { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => T0 });
    for (const k of cache.map.keys()) {
      expect(k).not.toContain(SECRET_KEY);
      expect(k).toBe(`lic:${sha256(SECRET_KEY)}`);
    }
  });
});
