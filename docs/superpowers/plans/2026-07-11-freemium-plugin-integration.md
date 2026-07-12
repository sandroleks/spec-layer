# Freemium Plugin Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the Figma plugin to the deployed freemium proxy — CORS on the proxy, prose calls routed through it, license activation UI, quota meter, and the quota-exhausted upsell (spec §5, §6.2).

**Architecture:** The proxy gains CORS (Figma plugin iframes are `origin: null`). The extractor's `draftProse` gains a `proxy` option that swaps the Anthropic call for the proxy contract (`{cacheKey, request}` + auth headers + typed errors + quota callback) — the plugin then stops passing an API key and passes identity instead. BYOK is removed: `anthropicKey` messages/storage/UI are replaced by `licenseKey` + a `userInfo` message carrying `figma.currentUser.id`. Quota/upsell rendering follows the repo convention: pure logic in testable modules, DOM wiring untested.

**Tech Stack:** Existing repo stack — TypeScript ESM, vitest (root config), esbuild via `packages/plugin/build.mjs`, Figma plugin postMessage bridge.

## Global Constraints

- **The free product is never degraded by declining to pay** — doc generation is NEVER blocked; quota exhaustion shows a fork, and "Continue without AI" always works (spec §5).
- Free tier requires NO key of any kind — identity is `figma.currentUser.id` sent as `X-Figma-User`; license key sent as `Authorization: Bearer` wins when both exist (mirrors the proxy).
- AI off → no quota UI, no license prompts; prose sections use placeholder text (existing `prose: null` path — do not change it).
- Proxy URL: `https://spec-layer-proxy.spec-layer-test.workers.dev` (constant `PROXY_URL`).
- Checkout URL: `https://speclayertest.lemonsqueezy.com/checkout/buy/bb2d0913-6243-47f5-94f1-dfc24a33b713` (constant `CHECKOUT_URL`). Manage-subscription URL: `https://app.lemonsqueezy.com/my-orders`.
- Copy strings, verbatim: meter free tier `"{remaining}/{limit} AI generations left this month"`; meter pro `"Pro — unlimited AI"`; upsell text `"You've used your free AI generations for {MonthName}."`; buttons `"Upgrade – $8/mo"` and `"Continue without AI"`.
- Quota display is server-driven: the plugin renders what proxy headers/responses say, never computes quotas itself.
- Testing convention: pure logic gets vitest unit tests; DOM files (`ui/dom.ts`, `ui/ui.ts`, `ui/render.ts`) have no test coverage in this repo — extract logic, don't add jsdom.
- Node ≥ 20.9, ESM; run `npm run check` semantics (lint+typecheck+test+build+build:plugin) must stay green at plan end.

## API contract consumed (from packages/proxy/README.md)

- `POST {PROXY_URL}/v1/prose` body `{cacheKey, request}` → Anthropic JSON + headers `X-Tier`, `X-Quota-Used`, `X-Quota-Limit` (`unlimited` for pro), `X-Quota-Remaining`, `X-Quota-Resets-At`; errors 400/401/402(`{error:'quota_exhausted',resetsAt}`)/409/429(`{error:'rate_limited',retryAfterMs}`)/502.
- `GET {PROXY_URL}/v1/quota` → `{tier, used, limit, remaining, resetsAt}` (limit/remaining `null` for pro).
- `POST {PROXY_URL}/v1/license/activate` body `{key, instanceName}` → `{valid, status, instanceId?}`.

---

### Task 1: Proxy CORS

Figma plugin iframes send `Origin: null`; without CORS the browser blocks both the requests and — separately — the quota response headers. `Access-Control-Expose-Headers` is load-bearing: without it `res.headers.get('X-Quota-Used')` returns null in the iframe even on success.

**Files:**
- Modify: `packages/proxy/src/handlers.ts` (add `CORS_HEADERS`, `withCors`, OPTIONS handling in `route`)
- Test: `packages/proxy/test/router.test.ts` (append)

**Interfaces:**
- Consumes: existing `route(req, deps)`.
- Produces: same `route` signature — every response (including errors and OPTIONS preflight) now carries CORS headers. No caller changes.

- [ ] **Step 1: Write the failing test** — append to `packages/proxy/test/router.test.ts`:

```ts
describe('CORS', () => {
  it('answers OPTIONS preflight with 204 and CORS headers', async () => {
    const res = await route(new Request('https://p.test/v1/prose', { method: 'OPTIONS' }), baseDeps());
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Figma-User');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('adds CORS + exposed quota headers to normal responses', async () => {
    const res = await route(new Request('https://p.test/v1/quota', { headers: { 'X-Figma-User': 'u1' } }), baseDeps());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Quota-Remaining');
  });

  it('adds CORS headers to error responses too', async () => {
    const res = await route(new Request('https://p.test/nope'), baseDeps());
    expect(res.status).toBe(404);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/proxy/test/router.test.ts`
Expected: FAIL — no CORS headers present.

- [ ] **Step 3: Implement** — in `packages/proxy/src/handlers.ts`, add above the existing `route` function:

```ts
const CORS_HEADERS: Record<string, string> = {
  // Figma plugin iframes run with Origin: null — '*' (with header-based auth,
  // no cookies) is the correct and safe setting here.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Figma-User',
  // Without this, the plugin iframe cannot read the quota headers at all.
  'Access-Control-Expose-Headers':
    'X-Tier, X-Quota-Used, X-Quota-Limit, X-Quota-Remaining, X-Quota-Resets-At',
  'Access-Control-Max-Age': '86400',
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}
```

Then rename the existing `route` to `routeInner` (not exported) and add:

```ts
export async function route(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  return withCors(await routeInner(req, deps));
}
```

(`routeInner` keeps the exact body the old `route` had.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/proxy`
Expected: PASS — all proxy tests (37 = 34 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/handlers.ts packages/proxy/test/router.test.ts
git commit -m "feat(proxy): CORS for the Figma plugin iframe (origin null)"
```

---

### Task 2: Extractor — proxy mode in draftProse

**Files:**
- Modify: `packages/extractor/src/prose/client.ts`
- Modify: `packages/extractor/src/index.ts` (export the new symbols alongside the existing `draftProse` export)
- Test: `packages/extractor/test/client.test.ts` (append)

**Interfaces:**
- Consumes: proxy API contract (plan header).
- Produces (Tasks 4+ rely on these exact names, exported from `@spec-layer/extractor`):

```ts
export interface ProxyQuota {
  tier: 'free' | 'pro';
  used: number;
  limit: number | null;
  remaining: number | null;
  resetsAt: string;
}

export type ProseProxyErrorCode =
  | 'quota_exhausted' | 'rate_limited' | 'generation_pending'
  | 'license_not_active' | 'bad_request' | 'upstream';

export class ProseProxyError extends Error {
  constructor(public code: ProseProxyErrorCode, public resetsAt?: string);
}

// DraftOptions gains:
interface DraftOptions {
  apiKey: string | null;              // now unused when proxy is set
  proxy?: {
    url: string;                      // PROXY_URL, no trailing slash
    licenseKey?: string | null;       // wins over figmaUserId
    figmaUserId?: string | null;
    onQuota?: (q: ProxyQuota) => void; // fires on every successful proxy response
  };
  // ...existing fields unchanged
}
```

- [ ] **Step 1: Write the failing test** — append to `packages/extractor/test/client.test.ts`. Reuse the file's existing imports/helpers where present (`draftProse`, `vi`, a `spec` built from the button fixture). If any are missing there, add them the way `packages/extractor/test/prose.test.ts` does: `const spec = extract(button as SerializedNode, { figmaFile: 'FILE1' });` with the corresponding imports.

```ts
import { ProseProxyError } from '../src/prose/client';

const PROSE_OK = JSON.stringify({
  content: [{ type: 'text', text: '{"definition":"D","accessibility":"A","dos":[],"donts":[]}' }],
});

function memStore() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); } };
}

describe('draftProse proxy mode', () => {
  it('posts {cacheKey, request} to the proxy with free identity and fires onQuota', async () => {
    const fetcher = vi.fn(async () => new Response(PROSE_OK, {
      status: 200,
      headers: {
        'X-Tier': 'free', 'X-Quota-Used': '1', 'X-Quota-Limit': '20',
        'X-Quota-Remaining': '19', 'X-Quota-Resets-At': '2026-08-10T00:00:00.000Z',
      },
    }));
    const onQuota = vi.fn();
    const out = await draftProse(spec, {
      apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: memStore(),
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
    const fetcher = vi.fn(async () => new Response(PROSE_OK, {
      status: 200,
      headers: { 'X-Tier': 'pro', 'X-Quota-Used': '1', 'X-Quota-Limit': 'unlimited', 'X-Quota-Remaining': 'unlimited', 'X-Quota-Resets-At': '2026-08-01T00:00:00.000Z' },
    }));
    const onQuota = vi.fn();
    await draftProse(spec, {
      apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: memStore(),
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
    await expect(draftProse(spec, {
      apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: memStore(),
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
      await expect(draftProse(spec, {
        apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: memStore(),
        proxy: { url: 'https://proxy.test', figmaUserId: 'u1' },
      })).rejects.toMatchObject({ code });
    }
  });

  it('returns null with neither apiKey nor proxy (unchanged legacy guard)', async () => {
    const out = await draftProse(spec, {
      apiKey: null, fetcher: vi.fn() as unknown as typeof fetch, cacheStore: memStore(),
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/client.test.ts`
Expected: FAIL — `ProseProxyError` not exported / proxy option ignored.

- [ ] **Step 3: Implement** — in `packages/extractor/src/prose/client.ts`:

Add after the `CacheStore` interface:

```ts
export interface ProxyQuota {
  tier: 'free' | 'pro';
  used: number;
  limit: number | null;
  remaining: number | null;
  resetsAt: string;
}

export type ProseProxyErrorCode =
  | 'quota_exhausted' | 'rate_limited' | 'generation_pending'
  | 'license_not_active' | 'bad_request' | 'upstream';

/** Typed proxy failure — the plugin branches on `code` (402 → upsell, etc.). */
export class ProseProxyError extends Error {
  constructor(public code: ProseProxyErrorCode, public resetsAt?: string) {
    super(code);
    this.name = 'ProseProxyError';
  }
}

const PROXY_ERROR_BY_STATUS: Record<number, ProseProxyErrorCode> = {
  400: 'bad_request', 401: 'license_not_active', 402: 'quota_exhausted',
  409: 'generation_pending', 429: 'rate_limited',
};

function parseQuotaHeaders(headers: Headers): ProxyQuota | null {
  const tier = headers.get('X-Tier');
  if (tier !== 'free' && tier !== 'pro') return null;
  const num = (v: string | null): number | null =>
    v === null || v === 'unlimited' ? null : Number(v);
  return {
    tier,
    used: Number(headers.get('X-Quota-Used') ?? 0),
    limit: num(headers.get('X-Quota-Limit')),
    remaining: num(headers.get('X-Quota-Remaining')),
    resetsAt: headers.get('X-Quota-Resets-At') ?? '',
  };
}
```

Extend `DraftOptions` (add after the `requested` field):

```ts
  /**
   * When set, the request goes through the Spec Layer proxy instead of the
   * Anthropic API directly; `apiKey` is ignored. licenseKey (pro) wins over
   * figmaUserId (free). onQuota fires with the server's quota headers on
   * every successful response.
   */
  proxy?: {
    url: string;
    licenseKey?: string | null;
    figmaUserId?: string | null;
    onQuota?: (q: ProxyQuota) => void;
  };
```

In `draftProse`, change the guard (first line) from `if (!opts.apiKey) return null;` to:

```ts
  if (!opts.apiKey && !opts.proxy) return null;
```

Then replace the single `const res = await opts.fetcher(...)` call with a branch. The request body object currently inlined in the fetch stays identical — extract it first so both branches share it:

```ts
  const requestBody = {
    model: 'claude-haiku-4-5',
    max_tokens: 3000,
    system: PROSE_SYSTEM_PROMPT,
    messages: [...proseFewShot(), { role: 'user', content }],
  };

  let res: Response;
  if (opts.proxy) {
    const auth: Record<string, string> = opts.proxy.licenseKey
      ? { Authorization: `Bearer ${opts.proxy.licenseKey}` }
      : { 'X-Figma-User': opts.proxy.figmaUserId ?? '' };
    res = await opts.fetcher(`${opts.proxy.url}/v1/prose`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ cacheKey: key, request: requestBody }),
    });
    if (!res.ok) {
      const code = PROXY_ERROR_BY_STATUS[res.status] ?? 'upstream';
      let resetsAt: string | undefined;
      try { resetsAt = ((await res.json()) as { resetsAt?: string }).resetsAt; } catch { /* body optional */ }
      throw new ProseProxyError(code, resetsAt);
    }
    const quota = parseQuotaHeaders(res.headers);
    if (quota && opts.proxy.onQuota) opts.proxy.onQuota(quota);
  } else {
    res = await opts.fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey as string,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) throw new Error(`Claude API error ${res.status}`);
  }
```

The rest of the function (parse `data.content[0].text`, `parseProseResponse`, cache set) is unchanged and shared by both branches.

In `packages/extractor/src/index.ts`, find the existing export of `draftProse` from `./prose/client` and add `ProseProxyError` plus the types to it:

```ts
export { draftProse, proseCacheKey, ProseProxyError } from './prose/client';
export type { ProxyQuota, ProseProxyErrorCode, DraftOptions, CacheStore } from './prose/client';
```

(Adapt to the file's existing export style — extend the existing lines, don't duplicate exports that are already there.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/extractor && npm run typecheck`
Expected: PASS — existing prose/client tests untouched (the BYOK branch is byte-identical behavior), 6 new tests green, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/prose/client.ts packages/extractor/src/index.ts packages/extractor/test/client.test.ts
git commit -m "feat(extractor): proxy mode for draftProse with typed errors + quota callback"
```

---

### Task 3: Plugin proxy client module

**Files:**
- Create: `packages/plugin/src/ui/proxy.ts`
- Test: `packages/plugin/test/proxy.test.ts`

**Interfaces:**
- Consumes: proxy API contract; `ProxyQuota` type from `@spec-layer/extractor`.
- Produces (Tasks 4–6 rely on these exact names):

```ts
export const PROXY_URL = 'https://spec-layer-proxy.spec-layer-test.workers.dev';
export const CHECKOUT_URL = 'https://speclayertest.lemonsqueezy.com/checkout/buy/bb2d0913-6243-47f5-94f1-dfc24a33b713';
export const MANAGE_SUB_URL = 'https://app.lemonsqueezy.com/my-orders';

export interface ProxyAuth { licenseKey: string | null; figmaUserId: string | null }

export function authHeaders(auth: ProxyAuth): Record<string, string> | null; // null = no identity
export function fetchQuota(auth: ProxyAuth, fetcher?: typeof fetch): Promise<ProxyQuota | null>;
export function activateLicense(key: string, fetcher?: typeof fetch):
  Promise<{ valid: boolean; status: string; instanceId?: string }>;
export function quotaMeterText(q: ProxyQuota | null): string; // '' when q is null
export function upsellText(resetsAt: string | undefined, now?: Date): string;
```

- [ ] **Step 1: Write the failing test** — `packages/plugin/test/proxy.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  authHeaders, fetchQuota, activateLicense, quotaMeterText, upsellText, PROXY_URL,
} from '../src/ui/proxy';

describe('authHeaders', () => {
  it('prefers the license key', () => {
    expect(authHeaders({ licenseKey: 'LK', figmaUserId: 'u1' })).toEqual({ Authorization: 'Bearer LK' });
  });
  it('falls back to the figma user id', () => {
    expect(authHeaders({ licenseKey: null, figmaUserId: 'u1' })).toEqual({ 'X-Figma-User': 'u1' });
  });
  it('returns null with no identity', () => {
    expect(authHeaders({ licenseKey: null, figmaUserId: null })).toBeNull();
  });
});

describe('fetchQuota', () => {
  it('GETs /v1/quota with auth and returns the snapshot', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ tier: 'free', used: 3, limit: 20, remaining: 17, resetsAt: '2026-08-10T00:00:00.000Z' }),
      { status: 200 },
    ));
    const q = await fetchQuota({ licenseKey: null, figmaUserId: 'u1' }, fetcher as unknown as typeof fetch);
    expect(q).toEqual({ tier: 'free', used: 3, limit: 20, remaining: 17, resetsAt: '2026-08-10T00:00:00.000Z' });
    expect(fetcher).toHaveBeenCalledWith(`${PROXY_URL}/v1/quota`, { headers: { 'X-Figma-User': 'u1' } });
  });
  it('returns null with no identity (no network call)', async () => {
    const fetcher = vi.fn();
    expect(await fetchQuota({ licenseKey: null, figmaUserId: null }, fetcher as unknown as typeof fetch)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('returns null on network failure (meter simply hides)', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    expect(await fetchQuota({ licenseKey: null, figmaUserId: 'u1' }, fetcher as unknown as typeof fetch)).toBeNull();
  });
});

describe('activateLicense', () => {
  it('POSTs the key and returns the result', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ valid: true, status: 'active', instanceId: 'i1' }), { status: 200 },
    ));
    const out = await activateLicense('LK-1', fetcher as unknown as typeof fetch);
    expect(out).toEqual({ valid: true, status: 'active', instanceId: 'i1' });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${PROXY_URL}/v1/license/activate`);
    expect(JSON.parse(String(init.body))).toEqual({ key: 'LK-1', instanceName: 'Figma plugin' });
  });
});

describe('copy strings', () => {
  it('free meter text', () => {
    expect(quotaMeterText({ tier: 'free', used: 3, limit: 20, remaining: 17, resetsAt: '' }))
      .toBe('17/20 AI generations left this month');
  });
  it('pro meter text', () => {
    expect(quotaMeterText({ tier: 'pro', used: 5, limit: null, remaining: null, resetsAt: '' }))
      .toBe('Pro — unlimited AI');
  });
  it('empty when quota unknown', () => {
    expect(quotaMeterText(null)).toBe('');
  });
  it('upsell text names the current month', () => {
    expect(upsellText(undefined, new Date('2026-07-15T00:00:00Z')))
      .toBe("You've used your free AI generations for July.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/proxy.test.ts`
Expected: FAIL — cannot resolve `../src/ui/proxy`.

- [ ] **Step 3: Implement** — `packages/plugin/src/ui/proxy.ts`:

```ts
import type { ProxyQuota } from '@spec-layer/extractor';

export const PROXY_URL = 'https://spec-layer-proxy.spec-layer-test.workers.dev';
export const CHECKOUT_URL = 'https://speclayertest.lemonsqueezy.com/checkout/buy/bb2d0913-6243-47f5-94f1-dfc24a33b713';
export const MANAGE_SUB_URL = 'https://app.lemonsqueezy.com/my-orders';

export interface ProxyAuth { licenseKey: string | null; figmaUserId: string | null }

/** License wins over the free identity — mirrors the proxy's own precedence. */
export function authHeaders(auth: ProxyAuth): Record<string, string> | null {
  if (auth.licenseKey) return { Authorization: `Bearer ${auth.licenseKey}` };
  if (auth.figmaUserId) return { 'X-Figma-User': auth.figmaUserId };
  return null;
}

/** Quota snapshot for the meter. Null (no identity / offline) hides the meter. */
export async function fetchQuota(
  auth: ProxyAuth, fetcher: typeof fetch = window.fetch.bind(window),
): Promise<ProxyQuota | null> {
  const headers = authHeaders(auth);
  if (!headers) return null;
  try {
    const res = await fetcher(`${PROXY_URL}/v1/quota`, { headers });
    if (!res.ok) return null;
    return (await res.json()) as ProxyQuota;
  } catch {
    return null;
  }
}

export async function activateLicense(
  key: string, fetcher: typeof fetch = window.fetch.bind(window),
): Promise<{ valid: boolean; status: string; instanceId?: string }> {
  const res = await fetcher(`${PROXY_URL}/v1/license/activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, instanceName: 'Figma plugin' }),
  });
  return (await res.json()) as { valid: boolean; status: string; instanceId?: string };
}

export function quotaMeterText(q: ProxyQuota | null): string {
  if (!q) return '';
  if (q.tier === 'pro') return 'Pro — unlimited AI';
  return `${q.remaining ?? 0}/${q.limit ?? 0} AI generations left this month`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function upsellText(resetsAt: string | undefined, now: Date = new Date()): string {
  void resetsAt; // reserved: could show the reset date later
  return `You've used your free AI generations for ${MONTHS[now.getUTCMonth()]}.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/plugin/test/proxy.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/proxy.ts packages/plugin/test/proxy.test.ts
git commit -m "feat(plugin): proxy client module (auth, quota, activation, copy)"
```

---

### Task 4: Plumbing swap — messages, main thread, state, generation path

Replaces the BYOK plumbing with license + user-id plumbing and routes generation through the proxy.

**Files:**
- Modify: `packages/plugin/src/messages.ts`
- Modify: `packages/plugin/src/main.ts` (boot block ~117–126, onmessage cases ~167–173)
- Modify: `packages/plugin/src/ui/ai.ts`
- Modify: `packages/plugin/src/ui/actions.ts` (UiState, `createState`, `setAnthropicKey`→`setLicenseKey`, `willGenerateProse`, `ensureProse`)
- Test: `packages/plugin/test/actions.test.ts` (append)

**Interfaces:**
- Consumes: `ProseProxyError`, `ProxyQuota` from `@spec-layer/extractor`; `PROXY_URL`, `ProxyAuth` from `./proxy` (Task 3).
- Produces (Tasks 5–6 rely on these):
  - Messages: `MainToUi` gains `{ type: 'licenseKey'; value: string | null }` and `{ type: 'userInfo'; userId: string | null }`; loses `anthropicKey`. `UiToMain` gains `{ type: 'setLicenseKey'; value: string }`; loses `setAnthropicKey`.
  - `UiState` gains `licenseKey: string | null`, `figmaUserId: string | null`, `quota: ProxyQuota | null`, `quotaExhausted: boolean` (defaults `null/null/null/false`); loses `anthropicKey`.
  - `setLicenseKey(state, value: string): void` (persists via `send({type:'setLicenseKey',value})`).
  - `canGenerate(state): boolean` — exported pure helper: `state.aiEnabled && Boolean(state.licenseKey || state.figmaUserId)`.
  - `ensureProse(state)` — now: catches `ProseProxyError` with code `quota_exhausted` → sets `state.quotaExhausted = true` and `state.generatedProse = null`, does NOT rethrow (callers proceed; Task 6 renders the fork); rethrows all other codes.
  - `ai.ts`: `generateProse(spec, auth: ProxyAuth, nodeId, requested?, onQuota?): Promise<ProseDrafts | null>`.

- [ ] **Step 1: Write the failing test** — append to `packages/plugin/test/actions.test.ts`:

```ts
import { canGenerate, createState } from '../src/ui/actions';

describe('canGenerate', () => {
  it('false when AI is off', () => {
    const s = createState();
    s.aiEnabled = false; s.figmaUserId = 'u1';
    expect(canGenerate(s)).toBe(false);
  });
  it('true for a free user with only a figma id (no key of any kind)', () => {
    const s = createState();
    s.aiEnabled = true; s.figmaUserId = 'u1'; s.licenseKey = null;
    expect(canGenerate(s)).toBe(true);
  });
  it('true with a license key and no figma id', () => {
    const s = createState();
    s.aiEnabled = true; s.licenseKey = 'LK'; s.figmaUserId = null;
    expect(canGenerate(s)).toBe(true);
  });
  it('false with AI on but no identity at all', () => {
    const s = createState();
    s.aiEnabled = true; s.licenseKey = null; s.figmaUserId = null;
    expect(canGenerate(s)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/actions.test.ts`
Expected: FAIL — `canGenerate` not exported / `figmaUserId` not on state.

- [ ] **Step 3: Implement.** Precise edits (grep for the quoted anchors):

**`messages.ts`** — in `MainToUi`, replace the `{ type: 'anthropicKey'; value: string | null }` variant with:

```ts
  | { type: 'licenseKey'; value: string | null }
  | { type: 'userInfo'; userId: string | null }
```

In `UiToMain`, replace `{ type: 'setAnthropicKey'; value: string }` with:

```ts
  | { type: 'setLicenseKey'; value: string }
```

**`main.ts`** — in the boot block (the code that currently reads `anthropicKey` at ~117–120), replace:

```ts
  const licenseKey = (await figma.clientStorage.getAsync('licenseKey')) as string | undefined;
  figma.ui.postMessage({ type: 'licenseKey', value: licenseKey ?? null } satisfies MainToUi);
  figma.ui.postMessage({ type: 'userInfo', userId: figma.currentUser?.id ?? null } satisfies MainToUi);
```

(Keep the `aiEnabled` boot read at ~123–126 exactly as is.) In the `figma.ui.onmessage` switch, replace the `'setAnthropicKey'` case with:

```ts
    case 'setLicenseKey':
      await figma.clientStorage.setAsync('licenseKey', msg.value);
      break;
```

Adapt the `satisfies MainToUi` form to whatever typing style the surrounding postMessage calls already use — match the file's existing pattern.

**`ui/actions.ts`** — in `UiState`, replace `anthropicKey: string | null;` with:

```ts
  licenseKey: string | null;
  figmaUserId: string | null;
  quota: ProxyQuota | null;
  quotaExhausted: boolean;
```

(add `import type { ProxyQuota } from '@spec-layer/extractor';` and `import { ProseProxyError } from '@spec-layer/extractor';` to the imports). In `createState()`, replace `anthropicKey: null,` with:

```ts
    licenseKey: null,
    figmaUserId: null,
    quota: null,
    quotaExhausted: false,
```

Replace `setAnthropicKey` (at ~313–316) with:

```ts
export function setLicenseKey(state: UiState, value: string): void {
  state.licenseKey = value || null;
  send({ type: 'setLicenseKey', value });
}
```

Add the pure guard and rewrite `willGenerateProse` (~191–196) to use it:

```ts
/** AI runs when the toggle is on and any identity exists — free tier needs no key. */
export function canGenerate(state: UiState): boolean {
  return state.aiEnabled && Boolean(state.licenseKey || state.figmaUserId);
}
```

(`willGenerateProse` keeps its other conditions — spec/selection checks — but its `state.aiEnabled && state.anthropicKey` clause becomes `canGenerate(state)`.)

In `ensureProse` (~198–224): the `generateProse(state.currentSpec!, state.anthropicKey!, ...)` call becomes:

```ts
      const drafts = await generateProse(
        state.currentSpec!,
        { licenseKey: state.licenseKey, figmaUserId: state.figmaUserId },
        state.currentNode!.id,
        requested,
        (q) => { state.quota = q; },
      );
```

and the call site is wrapped so quota exhaustion becomes state, not an exception (keep the function's existing structure — caching fields, requested-keys bookkeeping — intact; only the generate call gains this wrapper):

```ts
    try {
      // ...existing generate call...
    } catch (e) {
      if (e instanceof ProseProxyError && e.code === 'quota_exhausted') {
        state.quotaExhausted = true;
        state.generatedProse = null;
        return; // callers proceed without AI; the UI renders the upgrade fork
      }
      throw e;
    }
```

**`ui/ai.ts`** — replace `generateProse` with:

```ts
import { PROXY_URL, type ProxyAuth } from './proxy';
import type { ProxyQuota } from '@spec-layer/extractor';

export async function generateProse(
  spec: IntermediateSpec,
  auth: ProxyAuth,
  nodeId: string,
  requested?: Set<ProseKey>,
  onQuota?: (q: ProxyQuota) => void,
): Promise<ProseDrafts | null> {
  const img = await requestImage(nodeId);
  return draftProse(spec, {
    apiKey: null,
    fetcher: window.fetch.bind(window),
    cacheStore,
    proxy: { url: PROXY_URL, licenseKey: auth.licenseKey, figmaUserId: auth.figmaUserId, onQuota },
    imageBase64: img?.base64 ?? null,
    imageMediaType: img?.mediaType,
    requested,
  });
}
```

Note: `ui/ui.ts` still references `anthropicKey` symbols after this task — TypeScript will fail until Task 5 rewires the UI. That is expected mid-task-sequence; Task 4's gate is its unit tests, not the full typecheck. Run the focused tests only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/plugin/test/actions.test.ts packages/plugin/test/proxy.test.ts packages/extractor/test/client.test.ts`
Expected: PASS (existing + 4 new). (Full `npm run typecheck` is deferred to Task 5 — `ui.ts` intentionally still references removed symbols.)

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/messages.ts packages/plugin/src/main.ts packages/plugin/src/ui/actions.ts packages/plugin/src/ui/ai.ts packages/plugin/test/actions.test.ts
git commit -m "feat(plugin): license + figma-id plumbing, proxy-routed generation"
```

---

### Task 5: Settings UI — license section replaces BYOK

DOM-layer task; per repo convention there are no DOM tests. The gate is `npm run typecheck` + `node packages/plugin/build.mjs` succeeding, plus all prior unit tests staying green.

**Files:**
- Modify: `packages/plugin/src/ui/dom.ts` (settings block ~756–767; `.ai-card` hint copy ~689–691; `Refs` interface ~855+)
- Modify: `packages/plugin/src/ui/ui.ts` (key-input wiring ~100–102; `reflectAiToggle` ~112–125; `goToKeySettings` ~126–138 and its call site ~143; message cases ~415–423)

**Interfaces:**
- Consumes: `setLicenseKey`, `canGenerate` (Task 4); `activateLicense`, `fetchQuota`, `MANAGE_SUB_URL` (Task 3).
- Produces: `Refs` gains `licenseKeyInput: HTMLInputElement`, `licenseActivateBtn: HTMLButtonElement`, `licenseStatus: HTMLElement`; loses `anthropicKeyInput`. Task 6 uses the same message-handler area in `ui.ts`.

- [ ] **Step 1: Replace the settings block** in `dom.ts` (the block containing `id="anthropic-key-input"`, ~756–767) with:

```html
      <div class="settings-block">
        <h3>Spec Layer Pro</h3>
        <p class="hint">The free plan includes monthly AI generations — no setup needed.
          Pro removes the limit. Paste the license key from your purchase email.</p>
        <div class="license-row">
          <input type="password" id="license-key-input" placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" />
          <button id="license-activate-btn" type="button">Activate</button>
        </div>
        <p id="license-status" class="hint" aria-live="polite"></p>
        <p class="hint"><a id="manage-sub-link" href="#" target="_blank">Manage subscription</a></p>
      </div>
```

Match the block's outer wrapper/classes to whatever the previous BYOK block used so existing settings CSS applies; add a minimal `.license-row { display: flex; gap: 8px; }` rule beside the other styles if no equivalent row style exists. Update the `.ai-card` no-key hint (`#ai-nokey`, ~689–691): the "needs an API key" copy is obsolete — change the hint text to `AI works on the free plan — no key needed.` and Task 5's `reflectAiToggle` change below stops showing it as a blocker.

In the `Refs` interface and the ref-binding code, replace `anthropicKeyInput` with:

```ts
  licenseKeyInput: HTMLInputElement;
  licenseActivateBtn: HTMLButtonElement;
  licenseStatus: HTMLElement;
```

(bind by the new element ids, following the file's existing `byId` pattern).

- [ ] **Step 2: Rewire `ui.ts`.**

Replace the `anthropicKeyInput` change-listener (~100–102) with license wiring:

```ts
  refs.licenseActivateBtn.addEventListener('click', async () => {
    const key = refs.licenseKeyInput.value.trim();
    if (!key) return;
    refs.licenseStatus.textContent = 'Checking…';
    try {
      const out = await activateLicense(key);
      if (out.valid && out.status === 'active') {
        setLicenseKey(state, key);
        refs.licenseStatus.textContent = 'Pro active ✓';
        state.quota = await fetchQuota({ licenseKey: key, figmaUserId: state.figmaUserId });
      } else {
        refs.licenseStatus.textContent = `Key not active (${out.status}). Check your purchase email or contact support.`;
      }
    } catch {
      refs.licenseStatus.textContent = "Couldn't reach the license server — try again in a minute.";
    }
    renderQuota(refs, state);
  });
  refs.licenseKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') refs.licenseActivateBtn.click();
  });
```

(Add the imports: `activateLicense`, `fetchQuota`, `MANAGE_SUB_URL` from `./proxy`; `setLicenseKey` from `./actions`. `renderQuota` arrives in Task 6 — until then leave that one call commented with `// renderQuota(refs, state); // wired in the quota-meter change`.)

Wire the manage-subscription link near the other listeners:

```ts
  document.getElementById('manage-sub-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    send({ type: 'openBrowser', url: MANAGE_SUB_URL });
  });
```

(Match the `openBrowser` message's actual payload field name — check `messages.ts`; if it's `{ type: 'openBrowser'; url: string }` use as shown, otherwise adapt.)

`reflectAiToggle` (~112–125): remove the `hasKey` requirement — the toggle no longer depends on any key:

```ts
  function reflectAiToggle(): void {
    refs.aiToggle.checked = state.aiEnabled;
    // Free tier needs no key: the old "no key" blocker is gone. The hint
    // element stays for the edge case of a missing Figma user id.
    const noIdentity = !state.licenseKey && !state.figmaUserId;
    refs.aiNokey.style.display = state.aiEnabled && noIdentity ? '' : 'none';
  }
```

(The `Refs` property name for the `#ai-nokey` element may differ — check the existing `Refs` interface and use whatever name it already has; likewise mirror the file's existing show/hide idiom if it uses `hidden` instead of `style.display`.)

Delete `goToKeySettings` (~126–138) and its call in the toggle handler (~143) — toggling AI on no longer redirects to settings.

In the `MainToUi` switch (~415–423), replace the `'anthropicKey'` case with:

```ts
      case 'licenseKey':
        state.licenseKey = msg.value;
        refs.licenseKeyInput.value = msg.value ?? '';
        if (msg.value) refs.licenseStatus.textContent = 'Pro key saved';
        reflectAiToggle();
        break;
      case 'userInfo':
        state.figmaUserId = msg.userId;
        reflectAiToggle();
        break;
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run packages/plugin && node packages/plugin/build.mjs`
Expected: typecheck clean (the Task 4 gap closes here), all plugin tests pass, build emits `dist/main.js` + `dist/ui.html`.

- [ ] **Step 4: Commit**

```bash
git add packages/plugin/src/ui/dom.ts packages/plugin/src/ui/ui.ts
git commit -m "feat(plugin): license activation settings UI replaces BYOK"
```

---

### Task 6: Quota meter + upsell fork

**Files:**
- Modify: `packages/plugin/src/ui/dom.ts` (`.ai-card` ~684–697; `#action-footer` ~840–853; `Refs`)
- Modify: `packages/plugin/src/ui/render.ts` (add `renderQuota`)
- Modify: `packages/plugin/src/ui/ui.ts` (boot quota fetch, upsell button wiring, post-generation rendering)
- Modify: `packages/plugin/src/ui/actions.ts` (only if `runCreateDocFrame` needs the skip-AI flag described below)
- Test: covered by Task 3's `quotaMeterText`/`upsellText` tests (pure copy logic); DOM wiring untested per convention.

**Interfaces:**
- Consumes: `quotaMeterText`, `upsellText`, `fetchQuota`, `CHECKOUT_URL` (Task 3); `state.quota`, `state.quotaExhausted`, `canGenerate` (Task 4).
- Produces: `renderQuota(refs: Refs, state: UiState): void` in `render.ts`; `Refs` gains `quotaMeter: HTMLElement`, `upsell: HTMLElement`, `upsellText: HTMLElement`, `upsellUpgradeBtn: HTMLButtonElement`, `upsellContinueBtn: HTMLButtonElement`.

- [ ] **Step 1: DOM.** In `dom.ts`, inside `.ai-card` (right after the "Write with AI" header row, ~688), add:

```html
        <span id="quota-meter" class="hint"></span>
```

In `#action-footer` (between the banners and the `.actions` row, ~845), add:

```html
      <div id="upsell" hidden>
        <p id="upsell-text"></p>
        <div class="actions">
          <button id="upsell-upgrade-btn" type="button" class="primary">Upgrade – $8/mo</button>
          <button id="upsell-continue-btn" type="button">Continue without AI</button>
        </div>
      </div>
```

Add the five new entries to `Refs` (+ bindings): `quotaMeter`, `upsell`, `upsellText`, `upsellUpgradeBtn`, `upsellContinueBtn`. Reuse the footer's existing banner/button styles; add at most a `#upsell { padding: 8px 0; }` rule.

- [ ] **Step 2: `render.ts`** — add (imports: `quotaMeterText`, `upsellText` from `./proxy`; types from `./actions`/`./dom` following the file's existing imports):

```ts
/** Quota meter + upsell visibility. AI off → both hidden (spec §5 state 1). */
export function renderQuota(refs: Refs, state: UiState): void {
  refs.quotaMeter.textContent = state.aiEnabled ? quotaMeterText(state.quota) : '';
  const showUpsell = state.aiEnabled && state.quotaExhausted;
  refs.upsell.hidden = !showUpsell;
  if (showUpsell) refs.upsellText.textContent = upsellText(state.quota?.resetsAt);
}
```

- [ ] **Step 3: `ui.ts` wiring.**

Boot-time quota fetch — quota needs identity, which arrives via the `licenseKey`/`userInfo` messages; refresh after each (extend the two cases added in Task 5):

```ts
      // at the end of BOTH the 'licenseKey' and 'userInfo' cases:
        void refreshQuota();
```

with this helper near the top of the wiring section:

```ts
  async function refreshQuota(): Promise<void> {
    state.quota = await fetchQuota({ licenseKey: state.licenseKey, figmaUserId: state.figmaUserId });
    renderQuota(refs, state);
  }
```

Uncomment the `renderQuota(refs, state)` call left in Task 5's activate handler.

After any flow that runs `ensureProse` completes (the create-frame and download flows in `ui.ts`/`actions.ts` — find the post-`ensureProse` points), call `renderQuota(refs, state)` so a generation updates the meter and a 402 shows the fork. The `onQuota` callback already updated `state.quota`; `state.quotaExhausted` was set by `ensureProse` (Task 4).

Upsell buttons:

```ts
  refs.upsellUpgradeBtn.addEventListener('click', () => {
    send({ type: 'openBrowser', url: CHECKOUT_URL });
  });
  refs.upsellContinueBtn.addEventListener('click', () => {
    state.quotaExhausted = false;
    renderQuota(refs, state);
    // Re-run the last action without AI: aiEnabled stays on, but generation is
    // skipped because generatedProse stays null and ensureProse early-returns
    // when quota is exhausted server-side; simplest correct v1: turn the
    // toggle off for this run, re-trigger the create action, then restore.
    void runCreateWithoutAi();
  });
```

with the helper:

```ts
  async function runCreateWithoutAi(): Promise<void> {
    const wasEnabled = state.aiEnabled;
    state.aiEnabled = false; // local only — do NOT send setAiEnabled; the preference is untouched
    try {
      await runCreateDocFrame(state); // same call the create button makes — match its actual signature/args in this file
    } finally {
      state.aiEnabled = wasEnabled;
      renderQuota(refs, state);
    }
  }
```

**Adaptation note:** `runCreateDocFrame`'s exact signature and how the create button invokes it live in `ui.ts` (search for `create-frame-btn`). Reuse that invocation verbatim inside `runCreateWithoutAi`. If the create flow already routes through a shared handler function in `ui.ts`, call that instead — the invariant is: same behavior as clicking Create with AI off.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npx vitest run packages/plugin packages/extractor packages/proxy && node packages/plugin/build.mjs`
Expected: all clean/green; build emits both artifacts.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/dom.ts packages/plugin/src/ui/render.ts packages/plugin/src/ui/ui.ts packages/plugin/src/ui/actions.ts
git commit -m "feat(plugin): quota meter + quota-exhausted upgrade fork"
```

---

### Task 7: Manifest + final gates

**Files:**
- Modify: `packages/plugin/manifest.json` (networkAccess, ~lines 9–17)

- [ ] **Step 1: Update networkAccess** — replace the `networkAccess` object with:

```json
  "networkAccess": {
    "allowedDomains": ["https://spec-layer-proxy.spec-layer-test.workers.dev"],
    "reasoning": "AI guideline text is generated through the Spec Layer proxy service, which enforces free-tier quotas and Pro licenses. No user API keys are required or stored; requests carry only the component's structured summary.",
    "devAllowedDomains": ["https://spec-layer-proxy.spec-layer-test.workers.dev"]
  }
```

⚠️ `manifest.json` has pre-existing uncommitted edits in the working tree from the plugin-2.0 branch work. Apply this change on top of the file as it currently is, and in the commit step stage ONLY if the pre-existing edits belong (check `git diff packages/plugin/manifest.json` first). If unrelated hunks are present, use `git add -p packages/plugin/manifest.json` to stage only the networkAccess hunk.

- [ ] **Step 2: Full gate**

Run: `npm run check`
Expected: lint, typecheck, all tests (proxy 37 + extractor + plugin), web build, and plugin build all pass.

- [ ] **Step 3: Commit**

```bash
git add -p packages/plugin/manifest.json
git commit -m "chore(plugin): route network access to the Spec Layer proxy"
```

---

### Task 8: Deploy + manual verification (controller + human)

No subagent. The controller redeploys the proxy (Task 1's CORS change is not live until then) and the human tests in Figma.

- [ ] **Step 1 (controller): redeploy the proxy.** Requires a valid `CLOUDFLARE_API_TOKEN` — the previous one was slated for rotation; ask the user for a fresh token if needed. From `packages/proxy`: `npx wrangler deploy`. Verify CORS live:
  ```bash
  curl -s -i -X OPTIONS https://spec-layer-proxy.spec-layer-test.workers.dev/v1/prose | grep -i access-control
  # expect: allow-origin *, allow-headers with Authorization + X-Figma-User, expose-headers with X-Quota-*
  ```
- [ ] **Step 2 (human): manual Figma pass** — import the plugin from `packages/plugin/manifest.json` in Figma desktop (after `node packages/plugin/build.mjs`) and walk spec §5's states:
  1. AI off → no quota UI anywhere; doc frame renders with placeholder prose.
  2. AI on, no license → meter shows `20/20 AI generations left this month` (fresh Figma account) or current count; generate a doc → prose appears, meter decrements.
  3. Repeat generation on the same unchanged component → no meter decrement (cache).
  4. Settings → paste the test license key (`ED15C6D3-…`) → Activate → "Pro active ✓", meter shows `Pro — unlimited AI`.
  5. (Optional, destructive) exhaust a fresh free identity to see the upsell fork; "Continue without AI" must produce the doc with placeholders, "Upgrade" must open the checkout page.
- [ ] **Step 3 (human decision):** merge `plugin-3.0` when satisfied.

---

## Out of scope (deferred, tracked in ledger)

- Production domain for the proxy (workers.dev URL is fine until launch; changing it later = manifest + constant update).
- USD/EUR currency alignment on the Lemon Squeezy store; store activation for live payments.
- Full license lifecycle states beyond v1 (cancelled-until-period-end banner, past-due grace UI) — server already handles the logic; UI shows active/invalid/unreachable only.
- Listing copy, fair-use policy page, privacy policy page (spec §6.6/§6.8) — required before public release, not before manual testing.
