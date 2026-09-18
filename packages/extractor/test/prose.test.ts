import { describe, it, expect, vi } from 'vitest';
import { PROSE_SYSTEM_PROMPT, PROSE_MAX_TOKENS, proseFewShot, buildProsePrompt } from '../src/prose/promptV2';
import { draftProse, proseCacheKey, proseRequest, PROSE_PROMPT_VERSION } from '../src/prose/client';
import { extract } from '../src/extract';
import button from './fixtures/button.json';
import type { SerializedNode } from '../src/tree';

const spec = extract(button as SerializedNode, { figmaFile: 'FILE1' });

const ANSWER = JSON.stringify({
  overview: { lede: 'A Button triggers an action.', body: ['Use it for the primary action.'] },
  keyboard: [{ keys: ['Enter'], action: 'Activates the button.' }, { keys: ['Bogus'], action: 'Never.' }],
  anatomyParts: [{ name: 'Label', role: 'Names the action.' }, { name: 'Ghost', role: 'Not a part.' }],
});
const OK = JSON.stringify({ content: [{ type: 'text', text: ANSWER }] });

function memStore() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); }, m };
}

interface Body { model?: unknown; max_tokens: number; system: string; messages: Array<{ role: string; content: unknown }>; output_config?: unknown; thinking?: unknown }
const sentBody = (fetcher: { mock: { calls: unknown[][] } }): Body =>
  JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body)) as Body;

describe('proseRequest (v9)', () => {
  it('carries no model, the v9 cap, the v9 system prompt, the few-shot and the component prompt', () => {
    const req = proseRequest(spec, { requested: new Set(['overview']) });
    expect('model' in req).toBe(false);
    expect(req.max_tokens).toBe(PROSE_MAX_TOKENS);
    expect(req.system).toBe(PROSE_SYSTEM_PROMPT);
    expect(req.messages.slice(0, 2)).toEqual(proseFewShot());
    expect(req.messages[2]).toEqual({ role: 'user', content: buildProsePrompt(spec, new Set(['overview'])) });
  });

  it('carries exactly one cache_control, on the exemplar answer', () => {
    const req = proseRequest(spec);
    expect(JSON.stringify(req).match(/cache_control/g)).toHaveLength(1);
    const assistant = req.messages[1].content as Array<{ cache_control?: unknown }>;
    expect(assistant[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('attaches a base64 image as the first block of the final turn', () => {
    const req = proseRequest(spec, { imageBase64: 'AAAA', imageMediaType: 'image/png' });
    expect(req.messages[2].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'text', text: buildProsePrompt(spec) },
    ]);
  });
});

describe('proseCacheKey (v9)', () => {
  it('is versioned, carries the tier right after the version, and hashes the prompt', () => {
    expect(PROSE_PROMPT_VERSION).toBe('v9');
    const pro = proseCacheKey(spec, { tier: 'pro' });
    const free = proseCacheKey(spec, { tier: 'free' });
    expect(pro).toMatch(/^prose:v9:pro:[0-9a-f]{16,}$/);
    expect(free).toMatch(/^prose:v9:free:[0-9a-f]{16,}$/);
    expect(pro.slice('prose:v9:pro:'.length)).toBe(free.slice('prose:v9:free:'.length));
  });

  it('appends the image marker and the sorted key signature as before', () => {
    const key = proseCacheKey(spec, { tier: 'free', image: true, keys: ['keyboard', 'overview'] });
    expect(key.endsWith(':img:keys=keyboard,overview')).toBe(true);
    expect(proseCacheKey(spec, { tier: 'free', keys: ['overview', 'keyboard'] }))
      .toBe(proseCacheKey(spec, { tier: 'free', keys: ['keyboard', 'overview'] }));
  });
});

describe('draftProse (v9)', () => {
  it('returns the validated prose with the drop counts, and posts a model-free body', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(OK, { status: 200 }));
    const out = await draftProse(spec, { apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: memStore(), proxy: { url: 'https://proxy.test', figmaUserId: 'u1' } });
    expect(out?.prose.overview?.lede).toBe('A Button triggers an action.');
    expect(out?.prose.keyboard).toEqual([{ keys: ['Enter'], action: 'Activates the button.' }]);
    expect(out?.prose.anatomyParts).toEqual([{ name: 'Label', role: 'Names the action.' }]);
    expect(out?.dropped).toEqual({ keyboard: 1, anatomyParts: 1 });
    const posted = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body)) as { cacheKey: string; request: Body };
    expect(posted.cacheKey.startsWith('prose:v9:free:')).toBe(true);
    expect('model' in posted.request).toBe(false);
  });

  it('marks the key pro when a license key is sent', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(OK, { status: 200 }));
    await draftProse(spec, { apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: memStore(), proxy: { url: 'https://proxy.test', licenseKey: 'LK', figmaUserId: 'u1' } });
    const posted = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body)) as { cacheKey: string };
    expect(posted.cacheKey.startsWith('prose:v9:pro:')).toBe(true);
  });

  it('caches the raw answer and re-validates on a hit without a network call', async () => {
    const store = memStore();
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(OK, { status: 200 }));
    await draftProse(spec, { apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: store, proxy: { url: 'https://proxy.test', figmaUserId: 'u1' } });
    expect([...store.m.values()][0]).toBe(ANSWER);
    const second = vi.fn();
    const out = await draftProse(spec, { apiKey: null, fetcher: second as unknown as typeof fetch, cacheStore: store, proxy: { url: 'https://proxy.test', figmaUserId: 'u1' } });
    expect(second).not.toHaveBeenCalled();
    expect(out?.dropped).toEqual({ keyboard: 1, anatomyParts: 1 });
  });

  it('adds the free model itself only in direct API mode, where no proxy assigns one', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(OK, { status: 200 }));
    await draftProse(spec, { apiKey: 'sk-test', fetcher: fetcher as unknown as typeof fetch, cacheStore: memStore() });
    expect(sentBody(fetcher).model).toBe('claude-haiku-4-5');
    expect(sentBody(fetcher).thinking).toBeUndefined();
  });

  it('passes the file component list into validation', async () => {
    const answer = JSON.stringify({ whenNotToUse: ['Use a Slider for a range.', 'Not for navigation.'] });
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ content: [{ type: 'text', text: answer }] }), { status: 200 }));
    const out = await draftProse(spec, {
      apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: memStore(),
      proxy: { url: 'https://proxy.test', figmaUserId: 'u1' }, fileComponents: ['Slider'],
    });
    expect(out?.prose.whenNotToUse).toEqual(['Not for navigation.']);
    expect(out?.dropped.whenNotToUse).toBe(1);
  });

  it('returns null with neither apiKey nor proxy', async () => {
    expect(await draftProse(spec, { apiKey: null, fetcher: vi.fn() as unknown as typeof fetch, cacheStore: memStore() })).toBeNull();
  });
});
