import { describe, it, expect, vi } from 'vitest';
import { smokeProblems } from './smoke-proxy.mjs';
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

  it('names a broken KV binding', async () => {
    const broken = new MemKV();
    broken.get = async () => { throw new Error('KV unavailable'); };
    const { fetchFn } = deployment({ libraryStore: broken });
    const problems = await smokeProblems('https://staging.test', fetchFn);
    expect(problems).toEqual(['Pull of an unknown library (reads KV): HTTP 500, expected 404']);
  });

  it('names an unreachable host instead of throwing', async () => {
    const fetchFn = (async () => { throw new Error('getaddrinfo ENOTFOUND'); }) as unknown as typeof fetch;
    const problems = await smokeProblems('https://staging.test', fetchFn);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/request failed \(getaddrinfo ENOTFOUND\)/);
  });
});
