import { describe, it, expect, vi } from 'vitest';
import {
  draftProse, proseCacheKey, ProseProxyError,
  groupProseRequest, groupCacheKey, GROUP_MAX_TOKENS, draftGroupDescriptions,
} from '../src/prose/client';
import { MAX_OVERVIEW } from '../src/prose/foundationPrompt';
import type { IntermediateSpec } from '../src/extract';
import type { RefIdentity } from '../src/tree';

/** A reference now carries a full identity, not just a name. These tests are
 *  not about resolution, so one identity is minted per token NAME -- which is
 *  exactly what a name meant before the identity fields existed. */
const ident = (name: string): RefIdentity => (
  { id: `VariableID:${name}`, name, kind: 'variable', remote: false });

const spec = {
  name: 'Button', figmaKey: '', figmaFile: 'f', figmaNode: '1:1', description: '',
  anatomy: [], props: [], variants: [], states: [], tokens: [], related: [], gaps: [], layout: [],
} as unknown as IntermediateSpec;

const PROSE = JSON.stringify({ overview: { lede: 'd', body: [] } });

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
    const textKey = proseCacheKey(spec, { tier: 'free' });
    const visionKey = proseCacheKey(spec, { tier: 'free', image: true });
    expect(visionKey).not.toEqual(textKey);
    // base64 must produce the vision-marked key, not the text-only one:
    expect(proseCacheKey(spec, { tier: 'free', image: true })).toContain(':img');
  });

  it('folds the requested key set into the cache key', () => {
    const a = proseCacheKey(spec, { tier: 'free', keys: ['overview', 'keyboard'] });
    const b = proseCacheKey(spec, { tier: 'free', keys: ['overview'] });
    expect(a).not.toEqual(b);
    expect(a).toContain('v9');
  });

  it('key is order-independent for the same requested set', () => {
    expect(proseCacheKey(spec, { tier: 'free', keys: ['keyboard', 'overview'] }))
      .toEqual(proseCacheKey(spec, { tier: 'free', keys: ['overview', 'keyboard'] }));
  });

  // rawValues is presentation-only and never reaches the prompt. Keying on it
  // would mean that a value now rendered differently orphans every cached
  // draft and re-bills a metered generation for identical prose.
  it('ignores rawValues, which the prompt never sees', () => {
    const base = proseCacheKey(spec, { tier: 'free' });
    const withRaw = {
      ...spec,
      rawValues: [{ part: 'label', property: 'color', value: '#bbbbbb' }],
    } as unknown as IntermediateSpec;
    expect(proseCacheKey(withRaw, { tier: 'free' })).toEqual(base);
  });

  // Same rule as rawValues, and the same cost if it is broken. The Figma file
  // name reaches the brief's `source` block and nothing else: no reader exists
  // anywhere under prose/, so it cannot change a single word the model sees.
  // Keying on it would mean renaming a file (or opening a duplicate saved under
  // a new name) orphans every cached draft for every component and re-bills a
  // metered generation for byte-identical prose.
  it('ignores the Figma file name, which the prompt never sees', () => {
    const base = proseCacheKey(spec, { tier: 'free' });
    const named = { ...spec, figmaFileName: 'Design System' } as unknown as IntermediateSpec;
    const renamed = { ...spec, figmaFileName: 'Design System (2026)' } as unknown as IntermediateSpec;
    expect(proseCacheKey(named, { tier: 'free' })).toEqual(base);
    expect(proseCacheKey(renamed, { tier: 'free' })).toEqual(base);
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
      expect(proseCacheKey(next, { tier: 'free' })).toEqual(proseCacheKey(spec, { tier: 'free' }));
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
        tokens: [{ part: 'Container', path: 'Container', property: 'fill', conditions: {}, ...ident('color/surface') }],
        layout: [{ part: 'Container', path: 'Container', summary: 'horizontal, gap 8', values: { gap: 8 } }],
      } as unknown as IntermediateSpec;
      const moved = {
        ...base,
        tokens: [{ ...(base.tokens[0]), path: 'Somewhere/Else' }],
        layout: [{ ...(base.layout[0]), path: 'Somewhere/Else', values: { gap: 99 } }],
      } as unknown as IntermediateSpec;
      expect(proseCacheKey(moved, { tier: 'free' })).toEqual(proseCacheKey(base, { tier: 'free' }));
    });

    // The v9 prompt lists a part's kind and its nesting depth, so `type`,
    // `component`, `shownBy` and `depth` DO reach it and must move the key.
    // The node id and the layer path still do not.
    it('ignores the anatomy node id and path', () => {
      const base = {
        ...spec,
        anatomy: [{ id: '1:2', name: 'Label', type: 'TEXT', nested: false, depth: 0, path: 'Container/Label' }],
      } as unknown as IntermediateSpec;
      const moved = {
        ...base,
        anatomy: [{ ...(base.anatomy[0]), id: '9:9', path: 'Elsewhere/Label' }],
      } as unknown as IntermediateSpec;
      expect(proseCacheKey(moved, { tier: 'free' })).toEqual(proseCacheKey(base, { tier: 'free' }));
    });

    it('does NOT ignore an anatomy part depth, type, shownBy or nested component', () => {
      // The inverse of the test above, one field at a time. The v9 prompt draws
      // each part as `<indent><name>: <partKind>[; shown by X]`, so depth, type
      // and shownBy all reach it and each has to be a fresh generation rather
      // than a stale draft served from the old key.
      const key = (part: Record<string, unknown>): string => proseCacheKey(
        { ...spec, anatomy: [{ id: '1:2', path: 'Container/Label', ...part }] } as unknown as IntermediateSpec,
        { tier: 'free' },
      );
      const plain = { name: 'Label', type: 'TEXT', nested: false, depth: 0, shownBy: 'Show label' };
      const plainKey = key(plain);
      expect(key({ ...plain, depth: 1 })).not.toEqual(plainKey);
      expect(key({ ...plain, type: 'RECTANGLE' })).not.toEqual(plainKey);
      expect(key({ ...plain, shownBy: 'Has label' })).not.toEqual(plainKey);

      // `component` reaches the prompt only through a nested part, where
      // `partKind` reads it in place of the Figma type.
      const nested = { name: 'Icon', type: 'INSTANCE', nested: true, depth: 1, component: 'Icon' };
      expect(key({ ...nested, component: 'Glyph' })).not.toEqual(key(nested));
    });
  });

  it('still changes when a token the prompt DOES read changes', () => {
    // The counterpart to the block above: proving the key is not simply inert.
    const base = {
      ...spec,
      tokens: [{ part: 'Container', path: 'Container', property: 'fill', conditions: {}, ...ident('color/surface') }],
    } as unknown as IntermediateSpec;
    const moved = {
      ...base,
      tokens: [{ ...(base.tokens[0]), ...ident('color/surface/brand') }],
    } as unknown as IntermediateSpec;
    expect(proseCacheKey(moved, { tier: 'free' })).not.toEqual(proseCacheKey(base, { tier: 'free' }));
  });

  it('still changes when something the prompt reads changes', () => {
    const renamed = { ...spec, name: 'Chip' } as unknown as IntermediateSpec;
    expect(proseCacheKey(renamed, { tier: 'free' })).not.toEqual(proseCacheKey(spec, { tier: 'free' }));
  });
});

describe('group request (v3)', () => {
  const input = { collections: [{
    collectionId: 'c1', collectionName: 'Semantic', modeNames: ['Light', 'Dark'], aliasCounts: [], groups: [
      { folder: 'c1|color/surface', title: 'Surface', resolvedType: 'COLOR' as const, tokenNames: ['color/surface/primary'], sampleValues: ['#722ED1'] },
    ],
  }] };
  it('keys by version, groups marker and tier, and sends no model', () => {
    const { cacheKey, request } = groupProseRequest(input, 'pro');
    expect(cacheKey).toMatch(/^prose:v3:groups:pro:[0-9a-f]{16,}$/);
    expect('model' in request).toBe(false);
    expect(request.max_tokens).toBe(GROUP_MAX_TOKENS);
  });
  it('caps the answer above the largest one this prompt can ask for', () => {
    // Truncation here is all or nothing: a cut-off answer has no closing brace,
    // so parseGroupDraft finds no JSON object and the build loses every
    // description AND every overview at once. The worst case the prompt can ask
    // for is four collections of twelve groups: 48 descriptions under 220
    // characters and four overviews under MAX_OVERVIEW, each with its key.
    const worstCaseChars = 4 * (MAX_OVERVIEW + 20) + 48 * (220 + 25);
    // English JSON runs about four characters to the token.
    expect(GROUP_MAX_TOKENS).toBeGreaterThan(worstCaseChars / 4);
  });
  it('gives the two tiers different keys over the same hash', () => {
    const pro = groupCacheKey(input, 'pro');
    const free = groupCacheKey(input, 'free');
    expect(pro.replace(':pro:', ':')).toBe(free.replace(':free:', ':'));
  });
  it('misses the cache when a collection or a token is renamed', () => {
    const renamed = { collections: [{ ...input.collections[0], collectionName: 'Semantics' }] };
    expect(groupCacheKey(renamed, 'free')).not.toBe(groupCacheKey(input, 'free'));
  });
  it('draftGroupDescriptions returns descriptions and the overviews, caching the raw answer', async () => {
    const raw = '{"c1|overview":"Semantic colours.","c1|color/surface":"Surfaces."}';
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: raw }] }), { status: 200 }));
    const { get, set } = memStore();
    const out = await draftGroupDescriptions(input, { apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: { get, set }, proxy: { url: 'https://proxy.test', figmaUserId: 'u1' } });
    expect(out).toEqual({ overviews: { c1: 'Semantic colours.' }, descriptions: { 'c1|color/surface': 'Surfaces.' } });
    // What is stored is the model's own text, not the parsed draft, so a later
    // parser fix reaches the entry. Asserting the return value alone would
    // pass just as happily if the parsed object were cached instead.
    expect(await get(groupCacheKey(input, 'free'))).toBe(raw);
  });
  it('returns an empty draft with no collections or no identity, and asks nothing', async () => {
    const never = vi.fn();
    expect(await draftGroupDescriptions({ collections: [] }, {
      apiKey: null, fetcher: never as unknown as typeof fetch, cacheStore: memStore(),
      proxy: { url: 'https://proxy.test', figmaUserId: 'u1' },
    })).toEqual({ overviews: {}, descriptions: {} });
    expect(await draftGroupDescriptions(input, {
      apiKey: null, fetcher: never as unknown as typeof fetch, cacheStore: memStore(),
    })).toEqual({ overviews: {}, descriptions: {} });
    expect(never).not.toHaveBeenCalled();
  });
  it('still asks about a collection with no groups, which is where an overview is all there is', async () => {
    const raw = '{"c1|overview":"Spacing steps."}';
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: raw }] }), { status: 200 }));
    const out = await draftGroupDescriptions({ collections: [{ ...input.collections[0], groups: [] }] }, {
      apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: memStore(),
      proxy: { url: 'https://proxy.test', figmaUserId: 'u1' },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ overviews: { c1: 'Spacing steps.' }, descriptions: {} });
  });
});

// --- Task 2: proxy mode ------------------------------------------------------

const PROSE_OK = JSON.stringify({
  content: [{ type: 'text', text: '{"overview":{"lede":"D","body":[]}}' }],
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
    expect(out?.prose.overview?.lede).toBe('D');
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proxy.test/v1/prose');
    expect((init.headers as Record<string, string>)['X-Figma-User']).toBe('u1');
    const body = JSON.parse(String(init.body)) as { cacheKey: string; request: Record<string, unknown> };
    expect(body.cacheKey).toMatch(/^prose:v\d+:/);
    expect('model' in body.request).toBe(false);
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
    expect(out?.prose.overview?.lede).toBe('D');
    expect(second).not.toHaveBeenCalled();
  });

  it('caches the raw answer once it has parsed, and never caches one that has not', async () => {
    // A truncation at the token cap arrives as unparseable JSON. Cached, it
    // would make every retry in the session re-throw from the cache instead of
    // asking again, so the parse has to come first.
    const truncated = '{"overview":{"lede":"D","body":[';
    const store = memStore();
    const bad = vi.fn(async () => new Response(
      JSON.stringify({ content: [{ type: 'text', text: truncated }] }), { status: 200 },
    ));
    const proxy = { url: 'https://proxy.test', figmaUserId: 'u1' };
    await expect(draftProse(spec, {
      apiKey: null, fetcher: bad as unknown as typeof fetch, cacheStore: store, proxy,
    })).rejects.toThrow(/parse prose response/i);
    expect(store.store.size).toBe(0);

    // The same key, answered properly this time, is asked again and stored raw.
    const good = vi.fn(async () => new Response(PROSE_OK, { status: 200 }));
    const out = await draftProse(spec, {
      apiKey: null, fetcher: good as unknown as typeof fetch, cacheStore: store, proxy,
    });
    expect(out?.prose.overview?.lede).toBe('D');
    expect([...store.store.values()]).toEqual(['{"overview":{"lede":"D","body":[]}}']);
  });

  it('reads the answer from the first text block, past a leading thinking block', async () => {
    // Sonnet 5 thinks before it answers unless told not to, and at low effort
    // the thinking arrives as an empty block with a signature ahead of the text.
    // The first Pro generation after the tier assignment shipped threw the
    // shape error on exactly this envelope.
    const envelope = JSON.stringify({
      model: 'claude-sonnet-5', type: 'message', role: 'assistant',
      content: [
        { type: 'thinking', thinking: '', signature: 'EosCCpABCBEYAipA' },
        { type: 'text', text: '{"overview":{"lede":"Thought first.","body":[]}}' },
      ],
      stop_reason: 'end_turn',
    });
    const fetcher = vi.fn(async () => new Response(envelope, { status: 200 }));
    const { get, set } = memStore();
    const out = await draftProse(spec, {
      apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: { get, set },
      proxy: { url: 'https://proxy.test', figmaUserId: 'u1' },
    });
    expect(out?.prose.overview?.lede).toBe('Thought first.');
  });

  it('still rejects an envelope with no text block at all', async () => {
    const envelope = JSON.stringify({ content: [{ type: 'thinking', thinking: '', signature: 'x' }] });
    const fetcher = vi.fn(async () => new Response(envelope, { status: 200 }));
    const { get, set } = memStore();
    await expect(draftProse(spec, {
      apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: { get, set },
      proxy: { url: 'https://proxy.test', figmaUserId: 'u1' },
    })).rejects.toThrow(/Unexpected Claude API response shape/);
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
