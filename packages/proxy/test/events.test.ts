import { describe, it, expect, vi } from 'vitest';
import { route } from '../src/handlers';
import { MAX_EVENTS_BODY_BYTES, eventDataPoint } from '../src/events';
import { memQuota } from './quotaHarness';
import { SlidingWindowLimiter } from '../src/ratelimit';

const INSTALL = `inst_${'0123456789abcdef'.repeat(2)}`;

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

const deps = () => ({
  salt: 'salt',
  anthropicKey: 'sk',
  fetcher: vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
  licenseCache: new MemKV(),
  now: () => Date.parse('2026-10-21T00:00:00Z'),
  quotaFor: memQuota(() => Date.parse('2026-10-21T00:00:00Z')),
  log: vi.fn(),
  licenseLimiter: new SlidingWindowLimiter(20, 60_000),
  requestLimiter: new SlidingWindowLimiter(60, 60_000),
  libraryStore: new MemKV(),
  metrics: { write: vi.fn() },
  events: { write: vi.fn() },
});

type Point = { indexes: string[]; blobs: string[]; doubles: number[] };
const written = (d: ReturnType<typeof deps>, n = 0) => d.events.write.mock.calls[n][0] as Point;
const requestPoint = (d: ReturnType<typeof deps>) => d.metrics.write.mock.calls[0][0] as Point;

function post(body: unknown, headers: Record<string, string> = { 'X-Plugin-Version': '7.1.0' }) {
  return new Request('https://p.test/v1/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /v1/events', () => {
  it('writes one point per event, laid out positionally under the install id', async () => {
    const d = deps();
    const res = await route(post({
      install: INSTALL, tier: 'free',
      events: [
        { name: 'plugin_opened' },
        { name: 'copy_for_ai', kind: 'component', detail: 'md', outcome: 'ok', bytes: 40960 },
        { name: 'library_check', outcome: 'ok', count: 12, count2: 3, duration_ms: 840 },
      ],
    }), d);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 3, dropped: 0 });
    expect(d.events.write).toHaveBeenCalledTimes(3);
    expect(written(d, 0)).toEqual({
      indexes: [INSTALL], blobs: ['plugin_opened', 'plugin/7.1.0', '', '', '', 'free'], doubles: [0, 0, 0, 0],
    });
    expect(written(d, 1)).toEqual({
      indexes: [INSTALL], blobs: ['copy_for_ai', 'plugin/7.1.0', 'component', 'ok', 'md', 'free'], doubles: [0, 0, 40960, 0],
    });
    expect(written(d, 2).doubles).toEqual([12, 3, 0, 840]);
    // The request itself is a point in the request dataset, counting what landed.
    expect(requestPoint(d).blobs.slice(0, 2)).toEqual(['events', 'ok']);
    expect(requestPoint(d).blobs[3]).toBe('plugin/7.1.0');
    expect(requestPoint(d).doubles[3]).toBe(3);
  });

  it('drops an event outside the catalogue and keeps the rest', async () => {
    const d = deps();
    const res = await route(post({
      install: INSTALL,
      events: [{ name: 'plugin_opened' }, { name: 'doc_build', kind: 'create', component: 'Button' }, { name: 'nope' }],
    }), d);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 1, dropped: 2 });
    expect(d.events.write).toHaveBeenCalledTimes(1);
    expect(requestPoint(d).blobs[4]).toBe('partial');
  });

  it('refuses a request that names no plugin build, before reading the body', async () => {
    const d = deps();
    const res = await route(post({ install: INSTALL, events: [{ name: 'plugin_opened' }] }, {}), d);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'client_required' });
    expect(d.events.write).not.toHaveBeenCalled();
    const cli = await route(post({ install: INSTALL, events: [{ name: 'plugin_opened' }] }, { 'User-Agent': 'spec-layer/0.13.0' }), d);
    expect(cli.status).toBe(400);
  });

  it('refuses a wrong envelope with its reason, and malformed JSON', async () => {
    const d = deps();
    expect(await (await route(post({ install: 'nope', events: [{ name: 'plugin_opened' }] }), d)).json()).toEqual({ error: 'bad install' });
    expect(await (await route(post({ install: INSTALL, events: [] }), d)).json()).toEqual({ error: 'missing events' });
    expect(await (await route(post('{ nope'), d)).json()).toEqual({ error: 'invalid json' });
    expect(await (await route(post('null'), d)).json()).toEqual({ error: 'invalid body' });
    expect(d.events.write).not.toHaveBeenCalled();
  });

  it('refuses a body over the cap with 413', async () => {
    const d = deps();
    // The cap is checked before the envelope, so any JSON past it is refused.
    const body = JSON.stringify({ install: INSTALL, events: [{ name: 'plugin_opened' }], pad: 'x'.repeat(MAX_EVENTS_BODY_BYTES) });
    expect(body.length).toBeGreaterThan(MAX_EVENTS_BODY_BYTES);
    const res = await route(post(body), d);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'request_too_large' });
  });

  it('429s after 60 batches from one IP inside a minute', async () => {
    const d = deps();
    const req = () => post({ install: INSTALL, events: [{ name: 'plugin_opened' }] }, { 'X-Plugin-Version': '7.1.0', 'CF-Connecting-IP': '1.2.3.4' });
    for (let i = 0; i < 60; i++) expect((await route(req(), d)).status).toBe(202);
    const res = await route(req(), d);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
  });

  it('logs a failing sink once and still answers with what landed', async () => {
    const d = deps();
    d.events.write = vi.fn(() => { throw new Error('dataset gone'); });
    const res = await route(post({ install: INSTALL, events: [{ name: 'plugin_opened' }, { name: 'plugin_opened' }] }), d);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 0, dropped: 2 });
    expect(d.log).toHaveBeenCalledTimes(1);
    expect(d.log).toHaveBeenCalledWith('events_write_failed', { message: 'dataset gone' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('answers the preflight the plugin sends first', async () => {
    const res = await route(new Request('https://p.test/v1/events', { method: 'OPTIONS' }), deps());
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Plugin-Version');
  });
});

describe('eventDataPoint', () => {
  it('caps every blob and reads an absent count as 0', () => {
    const point = eventDataPoint({
      install: INSTALL, client: 'plugin/7.1.0', tier: '',
      event: { name: 'library_check', outcome: 'x'.repeat(200), count: 3 },
    });
    expect(point.blobs[3]).toHaveLength(64);
    expect(point.blobs[5]).toBe('');
    expect(point.doubles).toEqual([3, 0, 0, 0]);
  });
});
