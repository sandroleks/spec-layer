import { describe, it, expect, vi } from 'vitest';
import { draftProse, proseCacheKey, ProseProxyError } from '../src/prose/client';
import type { IntermediateSpec } from '../src/extract';

const spec = {
  name: 'Button', figmaKey: '', figmaFile: 'f', figmaNode: '1:1',
  anatomy: [], props: [], variants: [], states: [], tokens: [], related: [], gaps: [], layout: [],
} as unknown as IntermediateSpec;

const PROSE = JSON.stringify({ definition: 'd', accessibility: 'a', dos: ['x'], donts: ['y'] });

function memStore() {
  const m = new Map<string, string>();
  return { store: m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); } };
}

interface ContentBlock {
  type: string;
  source?: { type: string; media_type?: string; data?: string; url?: string };
  text?: string;
}
interface RequestBody {
  messages: Array<{ role: string; content: ContentBlock[] }>;
}

describe('draftProse base64 image', () => {
  it('sends a base64 image content block when imageBase64 is provided', async () => {
    let captured: RequestBody | undefined;
    const fetcher = (async (_url: string, init: RequestInit) => {
      captured = JSON.parse(init.body as string) as RequestBody;
      return { ok: true, json: async () => ({ content: [{ text: PROSE }] }) };
    }) as unknown as typeof fetch;
    const { get, set } = memStore();
    await draftProse(spec, {
      apiKey: 'k', fetcher, cacheStore: { get, set },
      imageBase64: 'AAAA', imageMediaType: 'image/png',
    });
    const userMsg = captured!.messages.at(-1)!;
    const imgBlock = userMsg.content.find((c) => c.type === 'image')!;
    expect(imgBlock.source).toEqual({ type: 'base64', media_type: 'image/png', data: 'AAAA' });
  });

  it('keys a base64 vision draft separately from a text-only draft', () => {
    const textKey = proseCacheKey(spec, {});
    const visionKey = proseCacheKey(spec, { image: true });
    expect(visionKey).not.toEqual(textKey);
    // base64 must produce the vision-marked key, not the text-only one:
    expect(proseCacheKey(spec, { image: true })).toContain(':img');
  });

  it('folds the requested key set into the cache key', () => {
    const a = proseCacheKey(spec, { keys: ['definition', 'interactions'] });
    const b = proseCacheKey(spec, { keys: ['definition'] });
    expect(a).not.toEqual(b);
    expect(a).toContain('v8');
  });

  it('key is order-independent for the same requested set', () => {
    expect(proseCacheKey(spec, { keys: ['interactions', 'definition'] }))
      .toEqual(proseCacheKey(spec, { keys: ['definition', 'interactions'] }));
  });

  // rawValues is presentation-only and never reaches the prompt. Keying on it
  // would mean that a value now rendered differently orphans every cached
  // draft and re-bills a metered generation for identical prose.
  it('ignores rawValues, which the prompt never sees', () => {
    const base = proseCacheKey(spec);
    const withRaw = {
      ...spec,
      rawValues: [{ part: 'label', property: 'color', value: '#bbbbbb' }],
    } as unknown as IntermediateSpec;
    expect(proseCacheKey(withRaw)).toEqual(base);
  });

  it('still changes when something the prompt reads changes', () => {
    const renamed = { ...spec, name: 'Chip' } as unknown as IntermediateSpec;
    expect(proseCacheKey(renamed)).not.toEqual(proseCacheKey(spec));
  });
});

// --- Task 2: proxy mode ------------------------------------------------------

const PROSE_OK = JSON.stringify({
  content: [{ type: 'text', text: '{"definition":"D","accessibility":"A","dos":[],"donts":[]}' }],
});

describe('draftProse proxy mode', () => {
  it('posts {cacheKey, request} to the proxy with free identity and fires onQuota', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(PROSE_OK, {
      status: 200,
      headers: {
        'X-Tier': 'free', 'X-Quota-Used': '1', 'X-Quota-Limit': '20',
        'X-Quota-Remaining': '19', 'X-Quota-Resets-At': '2026-08-10T00:00:00.000Z',
      },
    }));
    const onQuota = vi.fn();
    const { get, set } = memStore();
    const out = await draftProse(spec, {
      apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: { get, set },
      proxy: { url: 'https://proxy.test', figmaUserId: 'u1', onQuota },
    });
    expect(out?.definition).toBe('D');
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proxy.test/v1/prose');
    expect((init.headers as Record<string, string>)['X-Figma-User']).toBe('u1');
    const body = JSON.parse(String(init.body)) as { cacheKey: string; request: { model: string } };
    expect(body.cacheKey).toMatch(/^prose:v\d+:/);
    expect(body.request.model).toBe('claude-haiku-4-5');
    expect(onQuota).toHaveBeenCalledWith({
      tier: 'free', used: 1, limit: 20, remaining: 19, resetsAt: '2026-08-10T00:00:00.000Z',
    });
  });

  it('uses Bearer auth when a license key is present (wins over figmaUserId)', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(PROSE_OK, {
      status: 200,
      headers: { 'X-Tier': 'pro', 'X-Quota-Used': '1', 'X-Quota-Limit': 'unlimited', 'X-Quota-Remaining': 'unlimited', 'X-Quota-Resets-At': '2026-08-01T00:00:00.000Z' },
    }));
    const onQuota = vi.fn();
    const { get, set } = memStore();
    await draftProse(spec, {
      apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: { get, set },
      proxy: { url: 'https://proxy.test', licenseKey: 'LK-1', figmaUserId: 'u1', onQuota },
    });
    const headers = (fetcher.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer LK-1');
    expect(headers['X-Figma-User']).toBeUndefined();
    expect(onQuota).toHaveBeenCalledWith({
      tier: 'pro', used: 1, limit: null, remaining: null, resetsAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('throws a typed error on 402 quota_exhausted with resetsAt', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ error: 'quota_exhausted', resetsAt: '2026-08-01T00:00:00.000Z' }), { status: 402 },
    ));
    const { get, set } = memStore();
    await expect(draftProse(spec, {
      apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: { get, set },
      proxy: { url: 'https://proxy.test', figmaUserId: 'u1' },
    })).rejects.toMatchObject({ code: 'quota_exhausted', resetsAt: '2026-08-01T00:00:00.000Z' });
  });

  it('maps 429/409/401/400 and 5xx to typed codes', async () => {
    const codes: Array<[number, string]> = [
      [429, 'rate_limited'], [409, 'generation_pending'], [401, 'license_not_active'],
      [400, 'bad_request'], [502, 'upstream'],
    ];
    for (const [status, code] of codes) {
      const fetcher = vi.fn(async () => new Response('{}', { status }));
      const { get, set } = memStore();
      await expect(draftProse(spec, {
        apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: { get, set },
        proxy: { url: 'https://proxy.test', figmaUserId: 'u1' },
      })).rejects.toMatchObject({ code });
    }
  });

  it('returns null with neither apiKey nor proxy (unchanged legacy guard)', async () => {
    const { get, set } = memStore();
    const out = await draftProse(spec, {
      apiKey: null, fetcher: vi.fn() as unknown as typeof fetch, cacheStore: { get, set },
    });
    expect(out).toBeNull();
  });

  it('serves a local cache hit without any network call in proxy mode', async () => {
    const store = memStore();
    const ok = vi.fn(async () => new Response(PROSE_OK, {
      status: 200,
      headers: { 'X-Tier': 'free', 'X-Quota-Used': '1', 'X-Quota-Limit': '20', 'X-Quota-Remaining': '19', 'X-Quota-Resets-At': '2026-08-10T00:00:00.000Z' },
    }));
    await draftProse(spec, { apiKey: null, fetcher: ok as unknown as typeof fetch, cacheStore: store, proxy: { url: 'https://proxy.test', figmaUserId: 'u1' } });
    const second = vi.fn();
    const out = await draftProse(spec, { apiKey: null, fetcher: second as unknown as typeof fetch, cacheStore: store, proxy: { url: 'https://proxy.test', figmaUserId: 'u1' } });
    expect(out?.definition).toBe('D');
    expect(second).not.toHaveBeenCalled();
  });

  it('sends key:instanceId in the bearer when the proxy auth has an instance', async () => {
    const fetcher = vi.fn(async () => new Response(PROSE_OK, { status: 200 }));
    const { get, set } = memStore();
    await draftProse(spec, {
      apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: { get, set },
      proxy: { url: 'https://proxy.test', licenseKey: 'LK', licenseInstanceId: 'inst-1' },
    });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer LK:inst-1');
  });

  it('exposes the 401 reason on ProseProxyError', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ error: 'license_not_active', reason: 'unreachable' }), { status: 401 },
    ));
    const { get, set } = memStore();
    const err = await draftProse(spec, {
      apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: { get, set },
      proxy: { url: 'https://proxy.test', licenseKey: 'LK' },
    }).catch((e) => e as ProseProxyError);
    expect(err).toBeInstanceOf(ProseProxyError);
    expect((err as ProseProxyError).code).toBe('license_not_active');
    expect((err as ProseProxyError).reason).toBe('unreachable');
  });
});
