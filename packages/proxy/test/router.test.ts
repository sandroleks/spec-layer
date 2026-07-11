import { describe, it, expect, vi } from 'vitest';
import { route } from '../src/handlers';
import { QuotaEngine, type Tier, type ReserveResult, type QuotaSnapshot } from '../src/quota';

class MemKV {
  map = new Map<string, string>();
  async get(k: string) { return this.map.get(k) ?? null; }
  async put(k: string, v: string) { this.map.set(k, v); }
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
      body: JSON.stringify({ key: 'K', instanceName: 'Figma plugin' }),
    }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true, status: 'active', instanceId: 'i1' });
  });

  it('404s unknown paths', async () => {
    const res = await route(new Request('https://p.test/nope'), baseDeps());
    expect(res.status).toBe(404);
  });
});
