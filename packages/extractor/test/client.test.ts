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

  // Same rule as rawValues, and the same cost if it is broken. The Figma file
  // name reaches the brief's `source` block and nothing else: no reader exists
  // anywhere under prose/, so it cannot change a single word the model sees.
  // Keying on it would mean renaming a file (or opening a duplicate saved under
  // a new name) orphans every cached draft for every component and re-bills a
  // metered generation for byte-identical prose.
  it('ignores the Figma file name, which the prompt never sees', () => {
    const base = proseCacheKey(spec);
    const named = { ...spec, figmaFileName: 'Design System' } as unknown as IntermediateSpec;
    const renamed = { ...spec, figmaFileName: 'Design System (2026)' } as unknown as IntermediateSpec;
    expect(proseCacheKey(named)).toEqual(base);
    expect(proseCacheKey(renamed)).toEqual(base);
  });

  // The key must be sensitive to EXACTLY what the model sees, no more and no
  // less. Every field below is present on IntermediateSpec and never read by
  // buildProsePrompt, so moving it cannot change one word of generated prose.
  // Keying on any of them re-bills a metered Haiku call for identical output.
  //
  // These are enumerated rather than covered by one loop because each is a
  // separate claim about what the prompt reads, and a loop would hide which
  // one regressed.
  describe('ignores every field the prompt never reads', () => {
    const unchanged = (mutated: Partial<Record<string, unknown>>) => {
      const next = { ...spec, ...mutated } as unknown as IntermediateSpec;
      expect(proseCacheKey(next)).toEqual(proseCacheKey(spec));
    };

    it('ignores the Figma file key, so a duplicate or a branch reuses the cache', () => {
      // A duplicated file and a Figma branch both get a new file key while the
      // component is untouched.
      unchanged({ figmaFile: 'a-different-file-key' });
    });

    it('ignores the component key and the node id', () => {
      unchanged({ figmaKey: 'CK-changed' });
      unchanged({ figmaNode: '999:999' });
    });

    it('ignores anatomyComponentId and variantInstances', () => {
      unchanged({ anatomyComponentId: '42:42' });
      unchanged({ variantInstances: [{ nodeId: '7:7', name: 'Size=Small', values: { Size: 'Small' } }] });
    });

    it('ignores gaps, which are rendered but never prompted', () => {
      unchanged({
        gaps: [{ part: 'Label', path: 'Container/Label', property: 'fill', issue: 'hardcoded-color', value: '#bbb' }],
      });
    });

    it('ignores the identity fields threaded onto tokens and layout', () => {
      // tokens[].path and layout[].path/[].values are all NEW on this branch, so
      // without this they would each have orphaned every cached draft on release.
      const base = {
        ...spec,
        tokens: [{ part: 'Container', path: 'Container', property: 'fill', conditions: {}, token: 'color/surface' }],
        layout: [{ part: 'Container', path: 'Container', summary: 'horizontal, gap 8', values: { gap: 8 } }],
      } as unknown as IntermediateSpec;
      const moved = {
        ...base,
        tokens: [{ ...(base.tokens[0]), path: 'Somewhere/Else' }],
        layout: [{ ...(base.layout[0]), path: 'Somewhere/Else', values: { gap: 99 } }],
      } as unknown as IntermediateSpec;
      expect(proseCacheKey(moved)).toEqual(proseCacheKey(base));
    });

    it('ignores anatomy fields outside name and nested', () => {
      const base = {
        ...spec,
        anatomy: [{ id: '1:2', name: 'Label', type: 'TEXT', nested: false, depth: 0, path: 'Container/Label' }],
      } as unknown as IntermediateSpec;
      const moved = {
        ...base,
        anatomy: [{ ...(base.anatomy[0]), id: '9:9', depth: 3, path: 'Elsewhere/Label' }],
      } as unknown as IntermediateSpec;
      expect(proseCacheKey(moved)).toEqual(proseCacheKey(base));
    });
  });

  it('still changes when a token the prompt DOES read changes', () => {
    // The counterpart to the block above: proving the key is not simply inert.
    const base = {
      ...spec,
      tokens: [{ part: 'Container', path: 'Container', property: 'fill', conditions: {}, token: 'color/surface' }],
    } as unknown as IntermediateSpec;
    const moved = {
      ...base,
      tokens: [{ ...(base.tokens[0]), token: 'color/surface/brand' }],
    } as unknown as IntermediateSpec;
    expect(proseCacheKey(moved)).not.toEqual(proseCacheKey(base));
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
