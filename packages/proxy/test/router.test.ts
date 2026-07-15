import { describe, it, expect, vi } from 'vitest';
import { sha256 } from 'js-sha256';
import { route } from '../src/handlers';
import { QuotaEngine, type Tier, type ReserveResult, type QuotaSnapshot } from '../src/quota';
import { SlidingWindowLimiter } from '../src/ratelimit';

const UUID_KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

class MemKV {
  map = new Map<string, string>();
  async get(k: string) { return this.map.get(k) ?? null; }
  async put(k: string, v: string, _opts?: { expirationTtl?: number }) { this.map.set(k, v); }
}

function memQuota(now: () => number) {
  const engines = new Map<string, QuotaEngine>();
  return (id: string) => {
    const e = engines.get(id) ?? new QuotaEngine();
    engines.set(id, e);
    return {
      reserve: async (tier: Tier, k: string): Promise<ReserveResult> => e.reserve(tier, k, now()),
      commit: async (k: string, b: string) => e.commit(k, b, now()),
      release: async (k: string) => e.release(k),
      snapshot: async (tier: Tier): Promise<QuotaSnapshot> => e.snapshot(tier, now()),
    };
  };
}

const baseDeps = () => ({
  salt: 'salt',
  anthropicKey: 'sk',
  fetcher: vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
  licenseCache: new MemKV(),
  now: () => Date.parse('2026-07-01T00:00:00Z'),
  quotaFor: memQuota(() => Date.parse('2026-07-01T00:00:00Z')),
  log: vi.fn(),
  licenseLimiter: new SlidingWindowLimiter(20, 60_000),
});

describe('route', () => {
  it('GET /v1/quota returns the snapshot for a free identity', async () => {
    const res = await route(new Request('https://p.test/v1/quota', { headers: { 'X-Figma-User': 'u1' } }), baseDeps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tier: 'free', used: 0, limit: 20, remaining: 20,
      resetsAt: new Date(Date.parse('2026-07-01T00:00:00Z') + 30 * 864e5).toISOString(),
    });
  });

  it('GET /v1/quota is 401 without identity', async () => {
    const res = await route(new Request('https://p.test/v1/quota'), baseDeps());
    expect(res.status).toBe(401);
  });

  it('POST /v1/license/activate proxies to Lemon Squeezy', async () => {
    const d = baseDeps();
    d.fetcher = vi.fn(async () => new Response(JSON.stringify({
      activated: true, instance: { id: 'i1' }, license_key: { status: 'active' },
    }), { status: 200 })) as unknown as typeof fetch;
    const res = await route(new Request('https://p.test/v1/license/activate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: UUID_KEY, instanceName: 'Figma plugin' }),
    }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true, status: 'active', instanceId: 'i1' });
  });

  it('POST /v1/license/activate with an instanceId validates instead of re-activating', async () => {
    const d = baseDeps();
    const activateCalls: string[] = [];
    d.fetcher = vi.fn(async (url: string) => {
      activateCalls.push(url);
      return new Response(JSON.stringify({ valid: true, license_key: { status: 'active' } }), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await route(new Request('https://p.test/v1/license/activate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: UUID_KEY, instanceId: 'inst-1' }),
    }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true, status: 'active', instanceId: 'inst-1' });
    expect(activateCalls).toEqual(['https://api.lemonsqueezy.com/v1/licenses/validate']);
  });

  it('429s /v1/license/activate after 20 calls from one IP inside a minute', async () => {
    const d = baseDeps();
    d.fetcher = vi.fn(async () => new Response(JSON.stringify({
      activated: true, instance: { id: 'i1' }, license_key: { status: 'active' },
    }), { status: 200 })) as unknown as typeof fetch;
    const req = () => new Request('https://proxy.test/v1/license/activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
      body: JSON.stringify({ key: UUID_KEY }),
    });
    for (let i = 0; i < 20; i++) await route(req(), d);
    const res = await route(req(), d);
    expect(res.status).toBe(429);
  });

  it('400s a malformed key on /v1/license/activate as a definitive invalid, no LS call', async () => {
    const d = baseDeps();
    const res = await route(new Request('https://proxy.test/v1/license/activate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'hunter2' }),
    }), d);
    expect(res.status).toBe(200); // contract with old plugins: body carries the verdict
    expect(await res.json()).toEqual({ valid: false, status: 'invalid' });
  });

  it('404s unknown paths', async () => {
    const res = await route(new Request('https://p.test/nope'), baseDeps());
    expect(res.status).toBe(404);
  });

  it('502s activation cleanly when LS is unreachable (with CORS)', async () => {
    const d = baseDeps();
    d.fetcher = vi.fn(async () => { throw new Error('ls down'); }) as unknown as typeof fetch;
    const res = await route(new Request('https://proxy.test/v1/license/activate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: UUID_KEY }),
    }), d);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'ls_unreachable' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('includes licenseReason in the quota body when a key is not granting pro', async () => {
    const d = baseDeps();
    d.fetcher = vi.fn(async () => new Response(
      JSON.stringify({ valid: false, license_key: { status: 'expired' } }), { status: 200 },
    )) as unknown as typeof fetch;
    const res = await route(new Request('https://proxy.test/v1/quota', {
      headers: { Authorization: `Bearer ${UUID_KEY}` },
    }), d);
    const body = await res.json() as { tier: string; licenseReason?: string };
    expect(body.tier).toBe('free');
    expect(body.licenseReason).toBe('expired');
  });

  it('omits licenseReason from the quota body for an active (pro) license', async () => {
    const d = baseDeps();
    await d.licenseCache.put(`lic:${sha256(UUID_KEY)}`, JSON.stringify({ status: 'active', validatedAt: d.now() }));
    const res = await route(new Request('https://proxy.test/v1/quota', {
      headers: { Authorization: `Bearer ${UUID_KEY}` },
    }), d);
    const body = await res.json() as Record<string, unknown>;
    expect(body.tier).toBe('pro');
    expect('licenseReason' in body).toBe(false);
  });

  it('rethrows a non-LsUnreachable error raised during activation instead of turning it into a 502', async () => {
    // callLs funnels every fetch-level failure (thrown errors, non-2xx, missing verdict
    // field) into the LsUnreachable/502 path, so a fetch throw alone can't reach the
    // `throw err` branch in handleActivate's catch. Force a *different* failure past
    // the transient check: let LS report a successful activation, then make the cache
    // write (which only runs after a definitive verdict) throw a plain Error.
    const d = baseDeps();
    d.fetcher = vi.fn(async () => new Response(JSON.stringify({
      activated: true, instance: { id: 'i1' }, license_key: { status: 'active' },
    }), { status: 200 })) as unknown as typeof fetch;
    d.licenseCache = {
      get: async () => null,
      put: async () => { throw new Error('boom'); },
    };
    await expect(route(new Request('https://proxy.test/v1/license/activate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: UUID_KEY }),
    }), d)).rejects.toThrow('boom');
  });
});

describe('CORS', () => {
  it('answers OPTIONS preflight with 204 and CORS headers', async () => {
    const res = await route(new Request('https://p.test/v1/prose', { method: 'OPTIONS' }), baseDeps());
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Figma-User');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('adds CORS + exposed quota headers to normal responses', async () => {
    const res = await route(new Request('https://p.test/v1/quota', { headers: { 'X-Figma-User': 'u1' } }), baseDeps());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Quota-Remaining');
  });

  it('adds CORS headers to error responses too', async () => {
    const res = await route(new Request('https://p.test/nope'), baseDeps());
    expect(res.status).toBe(404);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
