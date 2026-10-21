import { describe, it, expect, vi } from 'vitest';
import { PLUGIN_VERSION_HEADER } from '@spec-layer/extractor';
import { clientOf, dataPoint, EMPTY_FACTS, factsCollector, outcomeOf, recordRequest } from '../src/metrics';

describe('clientOf', () => {
  it('names the plugin build from the header the plugin and the proxy share', () => {
    expect(PLUGIN_VERSION_HEADER).toBe('X-Plugin-Version');
    expect(clientOf(new Headers({ [PLUGIN_VERSION_HEADER]: '7.0.0' }))).toBe('plugin/7.0.0');
  });

  it('names the CLI from its user agent, prerelease tags included', () => {
    expect(clientOf(new Headers({ 'User-Agent': 'spec-layer/0.13.0 node/22.22.0' }))).toBe('cli/0.13.0');
    expect(clientOf(new Headers({ 'User-Agent': 'spec-layer/0.14.0-beta.1 node/22.22.0' }))).toBe('cli/0.14.0-beta.1');
  });

  it('prefers the plugin header, and drops anything that is not a version', () => {
    expect(clientOf(new Headers({ [PLUGIN_VERSION_HEADER]: '7.0.0', 'User-Agent': 'spec-layer/0.13.0' }))).toBe('plugin/7.0.0');
    expect(clientOf(new Headers({ [PLUGIN_VERSION_HEADER]: 'seven' }))).toBe('');
    expect(clientOf(new Headers({ [PLUGIN_VERSION_HEADER]: `1.0.0-${'x'.repeat(100)}` }))).toBe('');
    expect(clientOf(new Headers({ 'User-Agent': 'Mozilla/5.0' }))).toBe('');
    expect(clientOf(new Headers())).toBe('');
  });
});

describe('outcomeOf', () => {
  const jsonResponse = (status: number, body: string) =>
    new Response(body, { status, headers: { 'content-type': 'application/json' } });

  it('is ok under 400, and the error code of a JSON body above', async () => {
    expect(await outcomeOf(new Response(null, { status: 304 }))).toBe('ok');
    expect(await outcomeOf(jsonResponse(200, '{"ok":true}'))).toBe('ok');
    const refused = jsonResponse(402, JSON.stringify({ error: 'quota_exhausted', resetsAt: 'x' }));
    expect(await outcomeOf(refused)).toBe('quota_exhausted');
    // Read from a clone: the answer itself is still readable.
    expect(await refused.json()).toEqual({ error: 'quota_exhausted', resetsAt: 'x' });
  });

  it('falls back to the status when the body names no code', async () => {
    expect(await outcomeOf(new Response('nope', { status: 502, headers: { 'content-type': 'text/plain' } }))).toBe('http_502');
    expect(await outcomeOf(jsonResponse(500, '{ broken'))).toBe('http_500');
    expect(await outcomeOf(jsonResponse(400, JSON.stringify({ error: 7 })))).toBe('http_400');
  });
});

describe('dataPoint', () => {
  it('lays the columns out positionally, with the identity as the one index', () => {
    expect(dataPoint({
      route: 'publish', outcome: 'ok', client: 'plugin/7.0.0', status: 201, durationMs: 12.6,
      facts: { identity: 'lic:abc', tier: 'pro', kind: 'created', detail: 'initial', subject: 'lib_1', bytes: 4096, count: 3 },
    })).toEqual({
      indexes: ['lic:abc'],
      blobs: ['publish', 'ok', 'pro', 'plugin/7.0.0', 'created', 'initial', 'lib_1'],
      doubles: [201, 13, 4096, 3],
    });
  });

  it('writes no index without an identity, caps every blob, and never a negative duration', () => {
    const point = dataPoint({
      route: 'unmatched', outcome: 'x'.repeat(200), client: '', status: 404, durationMs: -1, facts: { ...EMPTY_FACTS },
    });
    expect(point.indexes).toEqual([]);
    expect(point.blobs[1]).toHaveLength(64);
    expect(point.doubles).toEqual([404, 0, 0, 0]);
  });
});

describe('factsCollector', () => {
  it('starts empty and lets a later write win', () => {
    const facts = factsCollector();
    expect(facts.snapshot()).toEqual(EMPTY_FACTS);
    facts.record({ identity: 'free:1', tier: 'free' });
    facts.record({ tier: 'pro', count: 2 });
    expect(facts.snapshot()).toEqual({ ...EMPTY_FACTS, identity: 'free:1', tier: 'pro', count: 2 });
  });
});

describe('recordRequest', () => {
  const ok = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });

  it('writes the point, taking the Content-Length when the handler counted no bytes', async () => {
    const write = vi.fn();
    await recordRequest({ write }, vi.fn(), {
      headers: new Headers({ 'Content-Length': '3', [PLUGIN_VERSION_HEADER]: '7.0.0' }), res: ok(), route: 'prose',
      facts: { ...EMPTY_FACTS, identity: 'free:1', tier: 'free', kind: 'component', detail: 'v9', count: 1 }, durationMs: 5,
    });
    expect(write).toHaveBeenCalledWith({
      indexes: ['free:1'], blobs: ['prose', 'ok', 'free', 'plugin/7.0.0', 'component', 'v9', ''], doubles: [200, 5, 3, 1],
    });
  });

  it('keeps the bytes a handler counted over the Content-Length', async () => {
    const write = vi.fn();
    await recordRequest({ write }, vi.fn(), {
      headers: new Headers({ 'Content-Length': '3' }), res: ok(), route: 'pull', facts: { ...EMPTY_FACTS, bytes: 900 }, durationMs: 0,
    });
    expect((write.mock.calls[0][0] as { doubles: number[] }).doubles[2]).toBe(900);
  });

  it('never throws: a failing sink is logged as metrics_write_failed', async () => {
    const log = vi.fn();
    await expect(recordRequest({ write: () => { throw new Error('no dataset'); } }, log, {
      headers: new Headers(), res: ok(), route: 'quota', facts: { ...EMPTY_FACTS }, durationMs: 0,
    })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('metrics_write_failed', { message: 'no dataset' });
  });
});
