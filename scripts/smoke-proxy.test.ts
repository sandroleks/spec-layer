import { describe, it, expect, vi } from 'vitest';
import { answeredBy, smokeProblems, waitForReachable } from './smoke-proxy.mjs';
import { route, type HandlerDeps } from '../packages/proxy/src/handlers';
import { SlidingWindowLimiter } from '../packages/proxy/src/ratelimit';
import { memQuota } from '../packages/proxy/test/quotaHarness';

class MemKV {
  map = new Map<string, string>();
  async get(k: string) { return this.map.get(k) ?? null; }
  async put(k: string, v: string) { this.map.set(k, v); }
  async delete(k: string) { this.map.delete(k); }
  async list(opts: { prefix: string }) {
    return { keys: [...this.map.keys()].filter((k) => k.startsWith(opts.prefix)).map((name) => ({ name })) };
  }
  async getStream(k: string): Promise<ReadableStream | null> {
    const v = this.map.get(k);
    return v === undefined ? null : new Response(v).body;
  }
}

/** The real router behind an in-memory deployment; `upstream` must never be called. */
function deployment(overrides: Partial<HandlerDeps> = {}) {
  const upstream = vi.fn(async () => new Response('{}'));
  const now = () => Date.parse('2026-10-01T00:00:00Z');
  const deps: HandlerDeps = {
    salt: 'salt',
    anthropicKey: 'sk',
    fetcher: upstream as unknown as typeof fetch,
    licenseCache: new MemKV(),
    now,
    quotaFor: memQuota(now),
    log: vi.fn(),
    licenseLimiter: new SlidingWindowLimiter(20, 60_000),
    requestLimiter: new SlidingWindowLimiter(60, 60_000),
    libraryStore: new MemKV(),
    ...overrides,
  };
  const fetchFn = ((input: string, init?: RequestInit) => route(new Request(input, init), deps)) as typeof fetch;
  return { fetchFn, upstream, deps };
}

describe('smokeProblems', () => {
  it('passes against the real router, and spends nothing', async () => {
    const { fetchFn, upstream, deps } = deployment();
    expect(await smokeProblems('https://staging.test/', fetchFn)).toEqual([]);
    expect(upstream).not.toHaveBeenCalled();
    expect((deps.libraryStore as unknown as MemKV).map.size).toBe(0);
  });

  it('names Cloudflare as the answerer when its security features block the probe', async () => {
    const blocked = (async () => new Response('error code: 1010', {
      status: 403, headers: { 'cf-mitigated': 'challenge', 'cf-ray': '8c0ffee-IAD' },
    })) as unknown as typeof fetch;
    const problems = await smokeProblems('https://staging.test', blocked);
    expect(problems[0]).toBe('CORS preflight: HTTP 403, expected 204 (cf-mitigated: challenge; Cloudflare error 1010; cf-ray 8c0ffee-IAD)');
  });

  it('names a broken KV binding', async () => {
    const broken = new MemKV();
    broken.get = async () => { throw new Error('KV unavailable'); };
    const { fetchFn } = deployment({ libraryStore: broken });
    const problems = await smokeProblems('https://staging.test', fetchFn);
    expect(problems).toEqual(['Pull of an unknown library (reads KV): HTTP 500, expected 404 (body "{\\"error\\":\\"internal\\"}")']);
  });

  it('names an unreachable host instead of throwing', async () => {
    const fetchFn = (async () => { throw new Error('getaddrinfo ENOTFOUND'); }) as unknown as typeof fetch;
    const problems = await smokeProblems('https://staging.test', fetchFn);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/request failed \(getaddrinfo ENOTFOUND\)/);
  });
});

describe('waitForReachable', () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => { t += ms; } };
  };

  it('waits out network failures and 52x answers on a fresh custom domain, then returns', async () => {
    const answers: Array<'down' | number> = ['down', 'down', 525, 404];
    const fetchFn = vi.fn(async () => {
      const next = answers.shift();
      if (next === 'down') throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      return new Response(null, { status: next });
    }) as unknown as typeof fetch;
    const waits: string[] = [];
    const result = await waitForReachable('https://staging.test', { fetchFn, ...clock(), onWait: (why) => waits.push(why) });
    expect(result).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(waits).toEqual(['fetch failed: ENOTFOUND', 'fetch failed: ENOTFOUND', 'HTTP 525']);
  });

  it('returns at once when the host already answers, whatever the status', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
    expect(await waitForReachable('https://staging.test', { fetchFn, ...clock() })).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the timeout and says what it last saw', async () => {
    const fetchFn = vi.fn(async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); }) as unknown as typeof fetch;
    const result = await waitForReachable('https://staging.test', { fetchFn, ...clock(), timeoutMs: 20_000, intervalMs: 5_000 });
    expect(result).toBe('https://staging.test did not answer within 20 s (last: fetch failed: ECONNREFUSED).');
    expect(fetchFn).toHaveBeenCalledTimes(5); // t = 0, 5, 10, 15, 20 s
  });
});

describe('answeredBy', () => {
  it('says nothing more for an empty answer', async () => {
    expect(await answeredBy(new Response(null, { status: 403 }))).toBe('');
  });

  it('recognises a challenge page', async () => {
    expect(await answeredBy(new Response('<!DOCTYPE html><html><title>Just a moment...</title></html>', { status: 403 })))
      .toBe(" (an HTML page, not the Worker's JSON)");
  });
});

