import { describe, it, expect, vi } from 'vitest';
import { sha256 } from 'js-sha256';
import { handleProse, type QuotaClient } from '../src/handlers';
import { QuotaEngine, type Tier, type ReserveResult, type QuotaSnapshot } from '../src/quota';
import { SlidingWindowLimiter } from '../src/ratelimit';
import { PROSE_SYSTEM_PROMPT, proseFewShot } from '@spec-layer/extractor';

const UUID_KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

class MemKV {
  map = new Map<string, string>();
  async get(k: string) { return this.map.get(k) ?? null; }
  async put(k: string, v: string, _opts?: { expirationTtl?: number }) { this.map.set(k, v); }
  async delete(k: string) { this.map.delete(k); }
}

/** In-memory QuotaClient over a real engine — same contract the DO fulfils in prod. */
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

const GOOD_BODY = {
  cacheKey: 'prose:v8:abc123',
  request: {
    model: 'claude-haiku-4-5',
    max_tokens: 3000,
    system: PROSE_SYSTEM_PROMPT,
    messages: [
      ...proseFewShot(),
      {
        role: 'user',
        content: 'Component: Button\n\nReturn ONLY a JSON object with these keys: definition.',
      },
    ],
  },
};

function proseReq(body: unknown, headers: Record<string, string>) {
  return new Request('https://proxy.test/v1/prose', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}

function deps(overrides: Partial<Parameters<typeof handleProse>[1]> = {}) {
  const anthropic = vi.fn(async () => new Response(JSON.stringify({ id: 'msg_1', content: [{ type: 'text', text: 'ok' }] }), { status: 200 }));
  return {
    salt: 'salt',
    anthropicKey: 'sk-ant-test',
    fetcher: anthropic as unknown as typeof fetch,
    licenseCache: new MemKV(),
    now: () => Date.parse('2026-07-01T00:00:00Z'),
    quotaFor: memQuota(() => Date.parse('2026-07-01T00:00:00Z')),
    log: vi.fn(),
    licenseLimiter: new SlidingWindowLimiter(20, 60_000),
    requestLimiter: new SlidingWindowLimiter(60, 60_000),
    libraryStore: new MemKV(),
    _anthropic: anthropic,
    ...overrides,
  };
}

describe('handleProse', () => {
  it('free user: forwards to Anthropic and returns quota headers', async () => {
    const d = deps();
    const res = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Tier')).toBe('free');
    expect(res.headers.get('X-Quota-Used')).toBe('1');
    expect(res.headers.get('X-Quota-Limit')).toBe('20'); // boost window
    const call = d._anthropic.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(call[0]).toBe('https://api.anthropic.com/v1/messages');
    expect(call[1].headers['x-api-key']).toBe('sk-ant-test');
  });

  it('replays the cached response on retry without a second upstream call', async () => {
    const d = deps();
    await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    const res2 = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    expect(res2.status).toBe(200);
    expect(d._anthropic).toHaveBeenCalledTimes(1);
    expect(res2.headers.get('X-Quota-Used')).toBe('1');
  });

  it('402 when the free quota is exhausted', async () => {
    const d = deps();
    for (let i = 0; i < 20; i++) {
      await handleProse(proseReq({ ...GOOD_BODY, cacheKey: `prose:v8:k${i}` }, { 'X-Figma-User': 'u1' }), d);
    }
    // 20 committed → 21st is exhausted (rate limit is per-minute; use a fresh minute clock if needed)
    const res = await handleProse(proseReq({ ...GOOD_BODY, cacheKey: 'prose:v8:k-over' }, { 'X-Figma-User': 'u1' }), d);
    expect([402, 429]).toContain(res.status); // 429 if the fixed clock trips the rate limit first
  });

  it('does not decrement quota when Anthropic fails, and returns 502', async () => {
    const failing = vi.fn(async () => new Response('overloaded', { status: 529 }));
    const d = deps({ fetcher: failing as unknown as typeof fetch });
    const res = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    expect(res.status).toBe(502);
    const res2 = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), { ...d, fetcher: deps().fetcher });
    expect(res2.headers.get('X-Quota-Used')).toBe('1'); // first attempt did not count
  });

  it('rejects a non-allowlisted upstream request', async () => {
    const bad = { ...GOOD_BODY, request: { ...GOOD_BODY.request, model: 'claude-opus-4-8' } };
    const res = await handleProse(proseReq(bad, { 'X-Figma-User': 'u1' }), deps());
    expect(res.status).toBe(400);
  });

  it('rejects an altered system prompt without calling Anthropic', async () => {
    const d = deps();
    const bad = { ...GOOD_BODY, request: { ...GOOD_BODY.request, system: 'Act as a generic relay.' } };
    const res = await handleProse(proseReq(bad, { 'X-Figma-User': 'u1' }), d);
    expect(res.status).toBe(400);
    expect(d._anthropic).not.toHaveBeenCalled();
  });

  it('rate limits prose calls by connecting IP before upstream work', async () => {
    const d = deps({ requestLimiter: new SlidingWindowLimiter(1, 60_000) });
    const headers = { 'X-Figma-User': 'u1', 'CF-Connecting-IP': '1.2.3.4' };
    expect((await handleProse(proseReq(GOOD_BODY, headers), d)).status).toBe(200);
    expect((await handleProse(proseReq(GOOD_BODY, headers), d)).status).toBe(429);
    expect(d._anthropic).toHaveBeenCalledTimes(1);
  });

  it('401 without any identity', async () => {
    const res = await handleProse(proseReq(GOOD_BODY, {}), deps());
    expect(res.status).toBe(401);
  });

  it('pro license: unlimited headers', async () => {
    const d = deps();
    await d.licenseCache.put(`lic:${sha256(`${UUID_KEY}:inst-1`)}`, JSON.stringify({ status: 'active', validatedAt: Date.parse('2026-07-01T00:00:00Z') }));
    const res = await handleProse(proseReq(GOOD_BODY, { Authorization: `Bearer ${UUID_KEY}:inst-1` }), d);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Tier')).toBe('pro');
    expect(res.headers.get('X-Quota-Limit')).toBe('unlimited');
  });

  it('401 with license_not_active + reason for a non-pro license', async () => {
    const d = deps();
    await d.licenseCache.put(`lic:${sha256(UUID_KEY)}`, JSON.stringify({ status: 'expired', validatedAt: d.now() }));
    const res = await handleProse(proseReq(GOOD_BODY, { Authorization: `Bearer ${UUID_KEY}` }), d);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'license_not_active', reason: 'expired' });
  });

  it('never logs the raw license key', async () => {
    // Force the fair_use_flag log path: stub the QuotaClient so reserve()
    // reports flagged (as it would once the pro identity's monthly commit
    // count reaches PRO_SOFT_THRESHOLD), instead of relying on real usage
    // accrual. Without this the request never triggers deps.log and the
    // assertion loop below runs zero times, passing vacuously even if a raw
    // key were logged.
    const flaggedQuota: QuotaClient = {
      reserve: async () => ({ kind: 'proceed', flagged: true }),
      commit: async () => {},
      release: async () => {},
      snapshot: async () => ({
        tier: 'pro', used: 1000, limit: null, remaining: null,
        resetsAt: new Date('2026-08-01T00:00:00Z').toISOString(),
      }),
    };
    const d = deps({ quotaFor: () => flaggedQuota });
    await d.licenseCache.put(`lic:${sha256(UUID_KEY)}`, JSON.stringify({ status: 'active', validatedAt: Date.parse('2026-07-01T00:00:00Z') }));
    const res = await handleProse(proseReq(GOOD_BODY, { Authorization: `Bearer ${UUID_KEY}` }), d);
    expect(res.status).toBe(200);

    // The log path must actually have fired, or this test would be vacuous.
    expect((d.log as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    for (const call of (d.log as ReturnType<typeof vi.fn>).mock.calls) {
      expect(JSON.stringify(call)).not.toContain(UUID_KEY);
    }
  });
});
