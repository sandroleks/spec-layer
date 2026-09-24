import { describe, it, expect, vi } from 'vitest';
import { sha256 } from 'js-sha256';
import { handleProse, requestLog, UPSTREAM_TIMEOUT_MS, type QuotaClient } from '../src/handlers';
import { RESERVATION_TTL_MS } from '../src/quota';
import { memQuota } from './quotaHarness';
import { SlidingWindowLimiter } from '../src/ratelimit';
import {
  proseRequest, proseCacheKey,
  LEGACY_PROSE_SYSTEM_PROMPT, legacyProseFewShot, LEGACY_PROSE_MAX_TOKENS,
  type IntermediateSpec,
} from '@spec-layer/extractor';

const UUID_KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

class MemKV {
  map = new Map<string, string>();
  async get(k: string) { return this.map.get(k) ?? null; }
  async put(k: string, v: string, _opts?: { expirationTtl?: number }) { this.map.set(k, v); }
  async delete(k: string) { this.map.delete(k); }
  async list(opts: { prefix: string }) {
    return { keys: [...this.map.keys()].filter((k) => k.startsWith(opts.prefix)).map((name) => ({ name })) };
  }
  async getStream(k: string): Promise<ReadableStream | null> {
    const v = this.map.get(k);
    return v === undefined ? null : new Response(v).body;
  }
}

/** The same stub `proseContract.test.ts` uses: the v9 prompt walks every field
 *  it lists, so the real client builder runs against it unchanged. */
const spec = {
  name: 'Button', figmaKey: '', figmaFile: 'f', figmaNode: '1:1', description: '', documentationLinks: [],
  anatomy: [], anatomyComponentId: '1:1', props: [], variants: [], variantInstances: [], states: [],
  tokens: [], related: [], gaps: [], layout: [], rawValues: [], nodeEffects: [],
} as unknown as IntermediateSpec;

/** Built by the real client, so the handler is exercised against the bytes the
 *  plugin actually posts rather than a literal that can drift away from them. */
const GOOD_BODY = { cacheKey: proseCacheKey(spec, { tier: 'free' }), request: proseRequest(spec) };

/** The same bytes under the key a Pro client sends. The tier is part of the
 *  key now, so a bearer request has to carry the pro one or be rejected. */
const PRO_BODY = { ...GOOD_BODY, cacheKey: proseCacheKey(spec, { tier: 'pro' }) };

/** The shipped 5.1.0 plugin's payload, kept until that build is off the wire. */
const LEGACY_BODY = {
  cacheKey: 'prose:v8:abc123',
  request: {
    model: 'claude-haiku-4-5',
    max_tokens: LEGACY_PROSE_MAX_TOKENS,
    system: LEGACY_PROSE_SYSTEM_PROMPT,
    messages: [
      ...legacyProseFewShot(),
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
  // Declared as the two-argument call the handler makes, so `mock.calls[0]`
  // is a `[string, RequestInit]` tuple and the assertions below need no cast.
  const anthropic = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify({ id: 'msg_1', content: [{ type: 'text', text: 'ok' }] }), { status: 200 }),
  );
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
    expect(res.headers.get('X-Quota-Limit')).toBe('20'); // free monthly limit
    const [url, init] = d._anthropic.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
  });

  it('forwards the free request with Haiku 4.5 and no output_config', async () => {
    const d = deps();
    await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    const sent = JSON.parse(String(d._anthropic.mock.calls[0][1].body)) as Record<string, unknown>;
    expect(sent.model).toBe('claude-haiku-4-5');
    expect(sent.output_config).toBeUndefined();
    expect(sent.thinking).toBeUndefined();
  });

  it('forwards the pro request with Sonnet 5 at low effort', async () => {
    const d = deps();
    await d.licenseCache.put(`lic:${sha256(`${UUID_KEY}:inst-1`)}`, JSON.stringify({ status: 'active', validatedAt: Date.parse('2026-07-01T00:00:00Z') }));
    const res = await handleProse(proseReq(PRO_BODY, { Authorization: `Bearer ${UUID_KEY}:inst-1` }), d);
    expect(res.status).toBe(200);
    const sent = JSON.parse(String(d._anthropic.mock.calls[0][1].body)) as Record<string, unknown>;
    expect(sent.model).toBe('claude-sonnet-5');
    expect(sent.output_config).toEqual({ effort: 'low' });
  });

  it('rejects a key whose tier segment disagrees with the proved tier, before spending quota', async () => {
    const d = deps();
    const res = await handleProse(proseReq(PRO_BODY, { 'X-Figma-User': 'u1' }), d);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'tier mismatch' });
    expect(d._anthropic).not.toHaveBeenCalled();
    // Nothing was reserved: the next valid free request is the identity's first.
    const ok = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    expect(ok.headers.get('X-Quota-Used')).toBe('1');
  });

  it('rejects a proved Pro posting a free key, before spending quota', async () => {
    // The mirror of the case above. A pro identity answered from the free
    // bucket would be served a Haiku draft under a key it will read back as
    // its own, so the disagreement is refused from either side.
    const d = deps();
    await d.licenseCache.put(`lic:${sha256(`${UUID_KEY}:inst-1`)}`, JSON.stringify({ status: 'active', validatedAt: Date.parse('2026-07-01T00:00:00Z') }));
    const res = await handleProse(proseReq(GOOD_BODY, { Authorization: `Bearer ${UUID_KEY}:inst-1` }), d);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'tier mismatch' });
    expect(d._anthropic).not.toHaveBeenCalled();
    // Nothing was reserved: the next valid pro request is the identity's first.
    const ok = await handleProse(proseReq(PRO_BODY, { Authorization: `Bearer ${UUID_KEY}:inst-1` }), d);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('X-Quota-Used')).toBe('1');
  });

  it('still serves a shipped v8 client', async () => {
    const d = deps();
    const res = await handleProse(proseReq(LEGACY_BODY, { 'X-Figma-User': 'u1' }), d);
    expect(res.status).toBe(200);
    const sent = JSON.parse(String(d._anthropic.mock.calls[0][1].body)) as Record<string, unknown>;
    expect(sent.model).toBe('claude-haiku-4-5');
  });

  it('replays the cached response on retry without a second upstream call', async () => {
    const d = deps();
    await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    const res2 = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    expect(res2.status).toBe(200);
    expect(d._anthropic).toHaveBeenCalledTimes(1);
    expect(res2.headers.get('X-Quota-Used')).toBe('1');
  });

  it('answers a generation from the snapshot commit returns: no separate snapshot hop', async () => {
    const d = deps();
    const inner = d.quotaFor;
    let snapshots = 0;
    d.quotaFor = (id, profile) => {
      const client = inner(id, profile);
      return { ...client, snapshot: (tier) => { snapshots += 1; return client.snapshot(tier); } };
    };
    const res = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Quota-Used')).toBe('1');
    expect(snapshots).toBe(0);
  });

  it('402 when the free quota is exhausted', async () => {
    const d = deps();
    for (let i = 0; i < 20; i++) {
      await handleProse(proseReq({ ...GOOD_BODY, cacheKey: `prose:v9:free:k${i}` }, { 'X-Figma-User': 'u1' }), d);
    }
    // 20 committed → 21st is exhausted (rate limit is per-minute; use a fresh minute clock if needed)
    const res = await handleProse(proseReq({ ...GOOD_BODY, cacheKey: 'prose:v9:free:k-over' }, { 'X-Figma-User': 'u1' }), d);
    expect([402, 429]).toContain(res.status); // 429 if the fixed clock trips the rate limit first
  });

  it('does not decrement quota when Anthropic fails, and returns 502', async () => {
    const failing = vi.fn(async () => new Response('overloaded', { status: 529, headers: { 'request-id': 'req_abc' } }));
    const d = deps({ fetcher: failing as unknown as typeof fetch });
    const res = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    expect(res.status).toBe(502);
    expect(d.log).toHaveBeenCalledWith('upstream_error', { status: 529, requestId: 'req_abc' });
    const res2 = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), { ...d, fetcher: deps().fetcher });
    expect(res2.headers.get('X-Quota-Used')).toBe('1'); // first attempt did not count
  });

  it('gives the Anthropic call a timeout shorter than the reservation TTL', async () => {
    expect(UPSTREAM_TIMEOUT_MS).toBeLessThan(RESERVATION_TTL_MS);
    const d = deps();
    await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    const init = (d._anthropic.mock.calls[0] as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('releases the reservation and answers 502 upstream_timeout when the call times out', async () => {
    const timingOut = vi.fn(async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); });
    const d = deps({ fetcher: timingOut as unknown as typeof fetch });
    const res = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_timeout' });
    expect(d.log).toHaveBeenCalledWith('upstream_timeout', { timeoutMs: UPSTREAM_TIMEOUT_MS });
    // Nothing was charged and nothing is pending: the retry runs.
    const retry = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), { ...d, fetcher: deps().fetcher });
    expect(retry.status).toBe(200);
    expect(retry.headers.get('X-Quota-Used')).toBe('1');
  });

  it('releases the reservation and answers 502 upstream_timeout when the body is still streaming at the deadline', async () => {
    // Headers arrived (the Response resolved), but AbortSignal.timeout aborts
    // the whole fetch, including a body still being read, so .text() is where
    // the timeout actually surfaces here.
    const timingOutBody = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); },
    }));
    const d = deps({ fetcher: timingOutBody as unknown as typeof fetch });
    const res = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_timeout' });
    expect(d.log).toHaveBeenCalledWith('upstream_timeout', { timeoutMs: UPSTREAM_TIMEOUT_MS });
    // Nothing was charged and nothing is pending: the retry runs.
    const retry = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), { ...d, fetcher: deps().fetcher });
    expect(retry.status).toBe(200);
    expect(retry.headers.get('X-Quota-Used')).toBe('1');
  });

  it('releases the reservation when reading the answer fails for any other reason, so a retry is not left pending', async () => {
    const brokenBody = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: () => { throw new TypeError('Network connection lost.'); },
    }));
    const d = deps({ fetcher: brokenBody as unknown as typeof fetch });
    await expect(handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d)).rejects.toThrow('Network connection lost.');
    // Nothing was charged and nothing is pending: the retry runs.
    const retry = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), { ...d, fetcher: deps().fetcher });
    expect(retry.status).toBe(200);
    expect(retry.headers.get('X-Quota-Used')).toBe('1');
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
    const res = await handleProse(proseReq(PRO_BODY, { Authorization: `Bearer ${UUID_KEY}:inst-1` }), d);
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
      commit: async () => ({
        tier: 'pro', used: 1001, limit: null, remaining: null,
        resetsAt: new Date('2026-08-01T00:00:00Z').toISOString(),
      }),
      release: async () => {},
      snapshot: async () => ({
        tier: 'pro', used: 1000, limit: null, remaining: null,
        resetsAt: new Date('2026-08-01T00:00:00Z').toISOString(),
      }),
    };
    const d = deps({ quotaFor: () => flaggedQuota });
    await d.licenseCache.put(`lic:${sha256(UUID_KEY)}`, JSON.stringify({ status: 'active', validatedAt: Date.parse('2026-07-01T00:00:00Z') }));
    const res = await handleProse(proseReq(PRO_BODY, { Authorization: `Bearer ${UUID_KEY}` }), d);
    expect(res.status).toBe(200);

    // The log path must actually have fired, or this test would be vacuous.
    expect((d.log as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    for (const call of (d.log as ReturnType<typeof vi.fn>).mock.calls) {
      expect(JSON.stringify(call)).not.toContain(UUID_KEY);
    }
  });
});

describe('requestLog', () => {
  it('stamps every line with the ray id and the route', () => {
    const lines: string[] = [];
    const log = requestLog(new Request('https://p.test/v1/libraries/lib_000000000000000000000000', { headers: { 'CF-Ray': '8a1b2c3d4e5f-SJC' } }), (line) => lines.push(line));
    log('library_publish', { libraryId: 'lib_000000000000000000000000', size: 12 });
    expect(JSON.parse(lines[0])).toEqual({
      event: 'library_publish', ray: '8a1b2c3d4e5f-SJC', route: 'GET /v1/libraries/lib_000000000000000000000000',
      libraryId: 'lib_000000000000000000000000', size: 12,
    });
  });

  it('writes null, not a made-up id, when there is no ray header', () => {
    const lines: string[] = [];
    requestLog(new Request('https://p.test/v1/quota'), (line) => lines.push(line))('x', {});
    expect(JSON.parse(lines[0])).toEqual({ event: 'x', ray: null, route: 'GET /v1/quota' });
  });
});
