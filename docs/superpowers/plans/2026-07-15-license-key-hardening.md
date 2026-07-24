# License Key Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every finding from the 2026-07-15 license-workflow review: transient Lemon Squeezy (LS) errors poisoning the license cache, the missing cache write on revalidation, raw keys leaking into logs/storage, device limits not enforced at request time, unthrottled/unvalidated license endpoints, wrong plugin messaging for LS outages and `inactive` keys, double-click activations, stale instance ids, no key-removal UI, and empty-string key persistence.

**Architecture:** All license authority lives in the Cloudflare Worker (`packages/proxy`); the plugin (`packages/plugin`) only displays state and the extractor (`packages/extractor`) carries the shared HTTP client. Server contract changes (status-aware LS parsing, hashed identities, `key:instanceId` bearer, `licenseReason` in quota body, deactivate endpoint) land first; the extractor client and plugin UI adopt them afterwards. Old plugin builds keep working: a bare-key Bearer stays valid, and all response bodies are supersets of today's.

**Tech Stack:** TypeScript, Cloudflare Workers (KV + Durable Objects), Lemon Squeezy License API, Vitest, Figma plugin (vanilla TS UI).

## Global Constraints

- Plugin UI copy: never em dashes; plain, honest peer tone (see `docs/plugin-voice-and-copy.md`).
- Lemon Squeezy keys and instance ids are UUIDs: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.
- Backward compatibility: a bare license key in `Authorization: Bearer <key>` must keep granting Pro (old plugin builds in the wild).
- Never write a license verdict to KV unless it came from a definitive LS response (`typeof data.valid === 'boolean'`, HTTP status < 429, not 5xx).
- Never log, store, or key storage on a raw license key server-side; always `sha256(key)`.
- Run tests per package: `cd packages/<pkg> && npx vitest run <file>`.
- Commit after every task with the repo's conventional-commit style (`fix(proxy): …`, `feat(plugin): …`).

---

### Task 1: Status-aware Lemon Squeezy response parsing (proxy)

Transient LS errors (429 / 5xx / JSON bodies without a verdict) must never be cached as `invalid`. Introduce a shared verdict parser, make `checkLicense` route transient results into the existing grace path, make `validateLicense` write the cache on a definitive verdict (the renewal-shows-inactive bug), and pass LS's `inactive` and `expired` statuses through as distinct reasons.

**Files:**
- Modify: `packages/proxy/src/license.ts`
- Test: `packages/proxy/test/license.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 4, 5, 6, and the plugin later):
  - `export type LicenseReason = 'invalid' | 'expired' | 'inactive' | 'unreachable'`
  - `export type LicenseResult = { tier: 'pro' } | { tier: 'free'; reason: LicenseReason }`
  - `export class LsUnreachable extends Error {}` — thrown by `validateLicense`/`activateLicense` on transient LS failures.
  - `checkLicense(key, deps)` unchanged signature (instance id comes in Task 4).
  - `validateLicense(key, instanceId, deps)` now writes the KV cache on any definitive verdict.

- [ ] **Step 1: Write the failing tests**

Append to `packages/proxy/test/license.test.ts` (the `MemKV`, `lsOk`, `T0` helpers already exist at the top of the file):

```ts
const lsHttp = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('checkLicense transient-error handling', () => {
  it('does NOT cache an LS 429 as invalid; falls back to the cached active status', async () => {
    const cache = new MemKV();
    let now = T0;
    await checkLicense('K', { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => now });
    now = T0 + LICENSE_CACHE_TTL_MS + 1; // cache stale → revalidates → LS is rate-limiting
    const limited = lsHttp(429, { message: 'Too many requests' });
    expect(await checkLicense('K', { fetcher: limited as unknown as typeof fetch, cache, now: () => now }))
      .toEqual({ tier: 'pro' }); // grace path, NOT a cached 'invalid'
    // and the good cache entry survived
    expect(await checkLicense('K', { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => now }))
      .toEqual({ tier: 'pro' });
  });

  it('treats a 5xx JSON body as an outage, not a verdict', async () => {
    const cache = new MemKV();
    const down = lsHttp(500, { message: 'server error' });
    expect(await checkLicense('K', { fetcher: down as unknown as typeof fetch, cache, now: () => T0 }))
      .toEqual({ tier: 'free', reason: 'unreachable' });
    expect(cache.map.size).toBe(0); // nothing cached
  });

  it('treats a 200 body with no boolean `valid` as an outage', async () => {
    const weird = lsHttp(200, { message: 'maintenance' });
    expect(await checkLicense('K', { fetcher: weird as unknown as typeof fetch, cache: new MemKV(), now: () => T0 }))
      .toEqual({ tier: 'free', reason: 'unreachable' });
  });

  it('passes the inactive status through as its own reason', async () => {
    expect(await checkLicense('K', { fetcher: lsOk('inactive', false) as unknown as typeof fetch, cache: new MemKV(), now: () => T0 }))
      .toEqual({ tier: 'free', reason: 'inactive' });
  });
});

describe('validateLicense cache write (renewal fix)', () => {
  it('overwrites a stale negative cache entry on a successful revalidation', async () => {
    const cache = new MemKV();
    let now = T0;
    // A lapse got cached…
    await checkLicense('K', { fetcher: lsOk('expired', false) as unknown as typeof fetch, cache, now: () => now });
    // …then the user renewed and hit Activate (validate path, instance known).
    const active = vi.fn(async () => new Response(JSON.stringify({ valid: true, license_key: { status: 'active' } }), { status: 200 }));
    await validateLicense('K', 'inst-1', { fetcher: active as unknown as typeof fetch, cache, now: () => now });
    // The very next quota check must see Pro from the refreshed cache, no LS call.
    const neverCalled = vi.fn();
    expect(await checkLicense('K', { fetcher: neverCalled as unknown as typeof fetch, cache, now: () => now }))
      .toEqual({ tier: 'pro' });
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it('throws LsUnreachable on a transient LS failure instead of reporting invalid', async () => {
    const limited = lsHttp(429, { message: 'Too many requests' });
    await expect(validateLicense('K', 'inst-1', { fetcher: limited as unknown as typeof fetch, cache: new MemKV(), now: () => T0 }))
      .rejects.toBeInstanceOf(LsUnreachable);
  });
});

describe('activateLicense transient handling', () => {
  it('throws LsUnreachable on an LS 429 instead of reporting invalid', async () => {
    const limited = lsHttp(429, { message: 'Too many requests' });
    await expect(activateLicense('K', 'Figma plugin', { fetcher: limited as unknown as typeof fetch, cache: new MemKV(), now: () => T0 }))
      .rejects.toBeInstanceOf(LsUnreachable);
  });
});
```

Also add `LsUnreachable` to the import list at the top of the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/proxy && npx vitest run test/license.test.ts`
Expected: FAIL — `LsUnreachable` is not exported; the 429 test receives `{ tier: 'free', reason: 'invalid' }`.

- [ ] **Step 3: Implement in `license.ts`**

Replace the body of `packages/proxy/src/license.ts` between the `cacheKey` helper and the end of `activateLicense` with:

```ts
export type LicenseReason = 'invalid' | 'expired' | 'inactive' | 'unreachable';
export type LicenseResult = { tier: 'pro' } | { tier: 'free'; reason: LicenseReason };

/** LS could not give a verdict (429, 5xx, or a body with no boolean `valid`). */
export class LsUnreachable extends Error {
  constructor() { super('lemon squeezy unreachable'); this.name = 'LsUnreachable'; }
}

interface CacheEntry { status: string; validatedAt: number }

const cacheKey = (key: string) => `lic:${key}`;

async function readCache(deps: LicenseDeps, key: string): Promise<CacheEntry | null> {
  const raw = await deps.cache.get(cacheKey(key));
  return raw ? (JSON.parse(raw) as CacheEntry) : null;
}

async function writeCache(deps: LicenseDeps, key: string, entry: CacheEntry): Promise<void> {
  await deps.cache.put(cacheKey(key), JSON.stringify(entry));
}

function toResult(status: string): LicenseResult {
  if (status === 'active') return { tier: 'pro' };
  const reason: LicenseReason =
    status === 'expired' ? 'expired' : status === 'inactive' ? 'inactive' : 'invalid';
  return { tier: 'free', reason };
}

type LsVerdict = { kind: 'verdict'; valid: boolean; status: string } | { kind: 'transient' };

/**
 * Only a response that actually carries a boolean `valid` is a verdict. LS rate
 * limits (429) and server errors (5xx) return JSON error bodies that would
 * otherwise read as 'invalid' and poison the cache for 24h — those, and any
 * body without a verdict, are transient. Defense-in-depth is preserved: a
 * reported 'active' with valid !== true maps to 'invalid', never 'active'.
 */
function parseLsResponse(res: Response, data: unknown): LsVerdict {
  if (res.status === 429 || res.status >= 500) return { kind: 'transient' };
  const d = data as { valid?: unknown; license_key?: { status?: unknown } };
  if (typeof d?.valid !== 'boolean') return { kind: 'transient' };
  const reported = typeof d.license_key?.status === 'string' ? d.license_key.status : 'invalid';
  const valid = d.valid === true && reported === 'active';
  const status = valid ? 'active' : reported === 'active' ? 'invalid' : reported;
  return { kind: 'verdict', valid, status };
}

async function callLs(path: string, body: unknown, deps: LicenseDeps): Promise<LsVerdict & { data?: { activated?: boolean; instance?: { id?: string } } }> {
  let res: Response;
  let data: unknown;
  try {
    res = await deps.fetcher(`${LS_BASE}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    data = await res.json();
  } catch {
    return { kind: 'transient' };
  }
  return { ...parseLsResponse(res, data), data: data as { activated?: boolean; instance?: { id?: string } } };
}

export async function checkLicense(key: string, deps: LicenseDeps): Promise<LicenseResult> {
  const now = deps.now();
  const cached = await readCache(deps, key);
  if (cached && now - cached.validatedAt < LICENSE_CACHE_TTL_MS) return toResult(cached.status);

  const out = await callLs('validate', { license_key: key }, deps);
  if (out.kind === 'transient') {
    // Outage: honor a previously validated status within the grace window.
    if (cached && now - cached.validatedAt < LICENSE_GRACE_MS) return toResult(cached.status);
    return { tier: 'free', reason: 'unreachable' };
  }
  await writeCache(deps, key, { status: out.status, validatedAt: now });
  return toResult(out.status);
}

/**
 * Confirm a license (optionally a specific already-activated instance) without
 * consuming a device slot. Writes the cache on a definitive verdict so a
 * renewal seen here is immediately visible to checkLicense (quota/prose).
 * Throws LsUnreachable when LS gives no verdict.
 */
export async function validateLicense(
  key: string, instanceId: string | null, deps: LicenseDeps,
): Promise<{ valid: boolean; status: string }> {
  const body = instanceId ? { license_key: key, instance_id: instanceId } : { license_key: key };
  const out = await callLs('validate', body, deps);
  if (out.kind === 'transient') throw new LsUnreachable();
  await writeCache(deps, key, { status: out.status, validatedAt: deps.now() });
  return { valid: out.valid, status: out.status };
}

export async function activateLicense(
  key: string, instanceName: string, deps: LicenseDeps,
): Promise<{ valid: boolean; status: string; instanceId?: string }> {
  const out = await callLs('activate', { license_key: key, instance_name: instanceName }, deps);
  if (out.kind === 'transient') throw new LsUnreachable();
  const activated = Boolean(out.data?.activated);
  if (activated) {
    await writeCache(deps, key, { status: out.status, validatedAt: deps.now() });
  }
  return { valid: activated, status: out.status, instanceId: out.data?.instance?.id };
}
```

Note: `activateLicense`'s verdict for `valid` comes from `data.activated`, not `parseLsResponse` (LS's activate response has no top-level `valid`). `parseLsResponse` still supplies the defense-in-depth `status`. Keep `LICENSE_CACHE_TTL_MS`, `LICENSE_GRACE_MS`, `LS_BASE`, `KVLike`, `LicenseDeps` as they are.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/proxy && npx vitest run test/license.test.ts`
Expected: PASS, including all pre-existing tests. One pre-existing test needs updating: `activateLicense` on a transient response now throws instead of returning `valid:false` (no existing test covers that, so the suite should be green as-is).

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/license.ts packages/proxy/test/license.test.ts
git commit -m "fix(proxy): never cache transient LS errors as license verdicts; write cache on revalidation"
```

---

### Task 2: Hash license keys in storage keys, quota identities, and logs (proxy)

A raw license key is a credential. Today it appears verbatim in the KV cache key (`lic:<key>`), the Durable Object name (`lic:<key>`), and the `fair_use_flag` log line. Hash it everywhere server-side.

**Files:**
- Modify: `packages/proxy/src/license.ts` (cache key)
- Modify: `packages/proxy/src/handlers.ts` (identityId)
- Test: `packages/proxy/test/license.test.ts`, `packages/proxy/test/handlers.test.ts`

**Interfaces:**
- Consumes: `sha256` from `js-sha256` (already a proxy dependency via `identity.ts`).
- Produces: `export function licenseIdentityId(key: string): string` in `handlers.ts` returning `` `lic:${sha256(key)}` `` — Tasks 4–5 reuse it.
- Side effect to note in the commit body: existing KV cache entries and pro-tier DO counters are orphaned (cache revalidates on next request; pro quota is unlimited so only the fair-use counter resets).

- [ ] **Step 1: Write the failing tests**

In `license.test.ts`, add:

```ts
import { sha256 } from 'js-sha256';

describe('cache key hygiene', () => {
  it('never stores the raw license key in KV', async () => {
    const cache = new MemKV();
    await checkLicense('SECRET-KEY-123', { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => T0 });
    for (const k of cache.map.keys()) {
      expect(k).not.toContain('SECRET-KEY-123');
      expect(k).toBe(`lic:${sha256('SECRET-KEY-123')}`);
    }
  });
});
```

In `handlers.test.ts`, update the pro-license test's cache seeding and add a log-hygiene test:

```ts
import { sha256 } from 'js-sha256';
// in the existing 'pro license: unlimited headers' test, replace the seed line with:
await d.licenseCache.put(`lic:${sha256('KEY1')}`, JSON.stringify({ status: 'active', validatedAt: Date.parse('2026-07-01T00:00:00Z') }));

it('never logs the raw license key', async () => {
  const d = deps();
  await d.licenseCache.put(`lic:${sha256('KEY1')}`, JSON.stringify({ status: 'active', validatedAt: Date.parse('2026-07-01T00:00:00Z') }));
  await handleProse(proseReq(GOOD_BODY, { Authorization: 'Bearer KEY1' }), d);
  for (const call of (d.log as ReturnType<typeof vi.fn>).mock.calls) {
    expect(JSON.stringify(call)).not.toContain('KEY1');
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/proxy && npx vitest run`
Expected: FAIL — cache keys contain the raw key; the seeded hashed key is not found so the pro test 401s.

- [ ] **Step 3: Implement**

In `license.ts`:

```ts
import { sha256 } from 'js-sha256';

const cacheKey = (key: string) => `lic:${sha256(key)}`;
```

In `handlers.ts`, add near the top and use in both `handleProse` and `handleQuota`:

```ts
import { sha256 } from 'js-sha256';

/** Quota/DO identity for a license — hashed so the raw key never reaches DO names or logs. */
export function licenseIdentityId(key: string): string {
  return `lic:${sha256(key)}`;
}
```

Replace both occurrences of `` identityId = `lic:${identity.key}` `` with `identityId = licenseIdentityId(identity.key)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/proxy && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/license.ts packages/proxy/src/handlers.ts packages/proxy/test
git commit -m "fix(proxy): hash license keys in KV keys, DO identities, and logs

Orphans existing KV cache entries (revalidated on next request) and pro
fair-use counters (pro quota is unlimited, so no user-visible effect)."
```

---

### Task 3: Key format validation, KV TTL, and per-IP rate limiting (proxy)

Close the enumeration oracle: reject non-UUID keys before any LS call, expire KV entries, and rate-limit the license endpoints per IP.

**Files:**
- Create: `packages/proxy/src/ratelimit.ts`
- Modify: `packages/proxy/src/license.ts` (format check + KV TTL)
- Modify: `packages/proxy/src/handlers.ts` (limiter on `/v1/license/*`)
- Modify: `packages/proxy/src/index.ts` (construct the limiter)
- Test: `packages/proxy/test/license.test.ts`, `packages/proxy/test/router.test.ts`, create `packages/proxy/test/ratelimit.test.ts`

**Interfaces:**
- Produces:
  - `export const LICENSE_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` (in `license.ts`)
  - `export class SlidingWindowLimiter { constructor(limit: number, windowMs: number); allow(key: string, now: number): boolean }` (in `ratelimit.ts`)
  - `HandlerDeps` gains `licenseLimiter: SlidingWindowLimiter`.
- Note: existing tests that use short keys like `'K'` must switch to a UUID fixture — define `const UUID_KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';` at the top of `license.test.ts` and replace `'K'` throughout.

- [ ] **Step 1: Write the failing tests**

`packages/proxy/test/ratelimit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SlidingWindowLimiter } from '../src/ratelimit';

describe('SlidingWindowLimiter', () => {
  it('allows up to the limit within the window, then refuses', () => {
    const l = new SlidingWindowLimiter(3, 60_000);
    expect(l.allow('ip1', 0)).toBe(true);
    expect(l.allow('ip1', 1)).toBe(true);
    expect(l.allow('ip1', 2)).toBe(true);
    expect(l.allow('ip1', 3)).toBe(false);
    expect(l.allow('ip2', 3)).toBe(true); // independent keys
  });
  it('frees slots as the window slides', () => {
    const l = new SlidingWindowLimiter(1, 60_000);
    expect(l.allow('ip1', 0)).toBe(true);
    expect(l.allow('ip1', 59_999)).toBe(false);
    expect(l.allow('ip1', 60_000)).toBe(true);
  });
});
```

In `license.test.ts`:

```ts
describe('key format gate', () => {
  it('rejects a malformed key without calling LS or writing KV', async () => {
    const fetcher = vi.fn();
    const cache = new MemKV();
    expect(await checkLicense('not-a-key', { fetcher: fetcher as unknown as typeof fetch, cache, now: () => T0 }))
      .toEqual({ tier: 'free', reason: 'invalid' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(cache.map.size).toBe(0);
  });
});

describe('KV expiry', () => {
  it('writes cache entries with an expirationTtl', async () => {
    const puts: Array<{ opts?: { expirationTtl?: number } }> = [];
    const cache = {
      get: async () => null,
      put: async (_k: string, _v: string, opts?: { expirationTtl?: number }) => { puts.push({ opts }); },
    };
    await checkLicense(UUID_KEY, { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => T0 });
    expect(puts[0].opts?.expirationTtl).toBe(30 * 86400);
  });
});
```

In `router.test.ts` (the `deps()` helper there gains `licenseLimiter: new SlidingWindowLimiter(20, 60_000)`; import it):

```ts
it('429s /v1/license/activate after 20 calls from one IP inside a minute', async () => {
  const d = deps();
  const req = () => new Request('https://proxy.test/v1/license/activate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
    body: JSON.stringify({ key: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }),
  });
  for (let i = 0; i < 20; i++) await route(req(), d);
  const res = await route(req(), d);
  expect(res.status).toBe(429);
});

it('400s a malformed key on /v1/license/activate as a definitive invalid, no LS call', async () => {
  const d = deps();
  const res = await route(new Request('https://proxy.test/v1/license/activate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'hunter2' }),
  }), d);
  expect(res.status).toBe(200); // contract with old plugins: body carries the verdict
  expect(await res.json()).toEqual({ valid: false, status: 'invalid' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/proxy && npx vitest run`
Expected: FAIL — no `ratelimit.ts`, no TTL on puts, malformed keys reach the LS fetcher.

- [ ] **Step 3: Implement**

`packages/proxy/src/ratelimit.ts`:

```ts
/**
 * Per-isolate sliding-window limiter. Best-effort: state resets when the
 * isolate recycles and is not shared across colos — good enough to blunt
 * naive enumeration; a Cloudflare WAF rate rule is the real backstop (README).
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  constructor(private limit: number, private windowMs: number) {}

  allow(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) { this.hits.set(key, recent); return false; }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
```

`license.ts` additions:

```ts
export const LICENSE_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 30 days — comfortably past the 5-day grace window, so grace reads never miss. */
export const LICENSE_CACHE_KV_TTL_S = 30 * 86400;
```

In `writeCache`: `await deps.cache.put(cacheKey(key), JSON.stringify(entry), { expirationTtl: LICENSE_CACHE_KV_TTL_S });`

At the top of `checkLicense`: `if (!LICENSE_KEY_RE.test(key)) return { tier: 'free', reason: 'invalid' };`

`handlers.ts`: add `licenseLimiter: SlidingWindowLimiter` to `HandlerDeps` (import from `./ratelimit`). At the top of `handleActivate`:

```ts
const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
if (!deps.licenseLimiter.allow(ip, deps.now())) {
  return json(429, { error: 'rate_limited' });
}
// … after the existing key presence check:
if (!LICENSE_KEY_RE.test(body.key)) return json(200, { valid: false, status: 'invalid' });
```

(Import `LICENSE_KEY_RE` from `./license`.)

`index.ts`: module scope `const licenseLimiter = new SlidingWindowLimiter(20, 60_000);` and add `licenseLimiter` to the deps object. Update `handlers.test.ts`'s and `router.test.ts`'s `deps()` helpers to include it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/proxy && npx vitest run`
Expected: PASS (after replacing `'K'` fixtures with `UUID_KEY`).

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src packages/proxy/test
git commit -m "fix(proxy): gate license endpoints with key-format check, KV TTL, and per-IP rate limit"
```

---

### Task 4: Instance-bound bearer tokens (proxy)

Enforce the device limit at request time. The plugin will send `Authorization: Bearer <key>:<instanceId>`; the proxy validates that instance with LS, so deactivating a device in the LS dashboard actually revokes its API access (within the cache TTL). Bare keys stay valid for old builds.

**Files:**
- Modify: `packages/proxy/src/identity.ts`
- Modify: `packages/proxy/src/license.ts` (`checkLicense` gains `instanceId`; cache key includes it)
- Modify: `packages/proxy/src/handlers.ts` (thread `identity.instanceId`)
- Test: `packages/proxy/test/identity.test.ts`, `packages/proxy/test/license.test.ts`, `packages/proxy/test/handlers.test.ts`

**Interfaces:**
- Produces:
  - `Identity` license variant becomes `{ kind: 'license'; key: string; instanceId: string | null }`.
  - `checkLicense(key: string, instanceId: string | null, deps: LicenseDeps): Promise<LicenseResult>` — **signature change**; all callers updated in this task.
  - Cache key: `` `lic:${sha256(instanceId ? `${key}:${instanceId}` : key)}` `` — key-only and key+instance verdicts never collide.
- Consumes: `licenseIdentityId` (Task 2) — quota identity stays keyed on the key alone, so one subscription shares one fair-use counter across devices.

- [ ] **Step 1: Write the failing tests**

`identity.test.ts`:

```ts
it('splits key:instanceId bearers', () => {
  expect(identityFromHeaders(new Headers({ Authorization: 'Bearer KEY:inst-9' }), 's'))
    .toEqual({ kind: 'license', key: 'KEY', instanceId: 'inst-9' });
});
it('bare key bearers carry a null instanceId (legacy clients)', () => {
  expect(identityFromHeaders(new Headers({ Authorization: 'Bearer KEY' }), 's'))
    .toEqual({ kind: 'license', key: 'KEY', instanceId: null });
});
```

`license.test.ts`:

```ts
describe('checkLicense with an instance id', () => {
  it('validates the specific instance with LS', async () => {
    const fetcher = lsOk('active');
    await checkLicense(UUID_KEY, 'inst-1', { fetcher: fetcher as unknown as typeof fetch, cache: new MemKV(), now: () => T0 });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ license_key: UUID_KEY, instance_id: 'inst-1' });
  });
  it('caches key-only and key+instance verdicts separately', async () => {
    const cache = new MemKV();
    await checkLicense(UUID_KEY, null, { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => T0 });
    // deactivated instance: LS says valid:false while the key itself is active
    await checkLicense(UUID_KEY, 'inst-dead', { fetcher: lsOk('active', false) as unknown as typeof fetch, cache, now: () => T0 });
    expect(await checkLicense(UUID_KEY, null, { fetcher: vi.fn() as unknown as typeof fetch, cache, now: () => T0 }))
      .toEqual({ tier: 'pro' });
    expect(await checkLicense(UUID_KEY, 'inst-dead', { fetcher: vi.fn() as unknown as typeof fetch, cache, now: () => T0 }))
      .toEqual({ tier: 'free', reason: 'invalid' });
  });
});
```

`handlers.test.ts` — in the pro-license test, seed under the instance-qualified hash and send the combined bearer:

```ts
await d.licenseCache.put(`lic:${sha256('KEY1:inst-1')}`, JSON.stringify({ status: 'active', validatedAt: Date.parse('2026-07-01T00:00:00Z') }));
const res = await handleProse(proseReq(GOOD_BODY, { Authorization: 'Bearer KEY1:inst-1' }), d);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/proxy && npx vitest run`
Expected: FAIL — `identityFromHeaders` has no `instanceId`; `checkLicense` takes two args.

- [ ] **Step 3: Implement**

`identity.ts`:

```ts
export type Identity =
  | { kind: 'license'; key: string; instanceId: string | null }
  | { kind: 'free'; id: string };

export function identityFromHeaders(headers: Headers, salt: string): Identity | null {
  const auth = headers.get('Authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (bearer) {
    const sep = bearer.indexOf(':');
    if (sep === -1) return { kind: 'license', key: bearer, instanceId: null };
    return { kind: 'license', key: bearer.slice(0, sep), instanceId: bearer.slice(sep + 1) || null };
  }
  const figma = (headers.get('X-Figma-User') ?? '').trim();
  if (figma) return { kind: 'free', id: hashFigmaId(figma, salt) };
  return null;
}
```

`license.ts`:

```ts
const cacheKey = (key: string, instanceId: string | null) =>
  `lic:${sha256(instanceId ? `${key}:${instanceId}` : key)}`;
```

Thread `instanceId` through `readCache`/`writeCache` (each gains an `instanceId: string | null` parameter passed to `cacheKey`), and:

```ts
export async function checkLicense(
  key: string, instanceId: string | null, deps: LicenseDeps,
): Promise<LicenseResult> {
  if (!LICENSE_KEY_RE.test(key)) return { tier: 'free', reason: 'invalid' };
  const now = deps.now();
  const cached = await readCache(deps, key, instanceId);
  if (cached && now - cached.validatedAt < LICENSE_CACHE_TTL_MS) return toResult(cached.status);

  const body = instanceId ? { license_key: key, instance_id: instanceId } : { license_key: key };
  const out = await callLs('validate', body, deps);
  if (out.kind === 'transient') {
    if (cached && now - cached.validatedAt < LICENSE_GRACE_MS) return toResult(cached.status);
    return { tier: 'free', reason: 'unreachable' };
  }
  await writeCache(deps, key, instanceId, { status: out.status, validatedAt: now });
  return toResult(out.status);
}
```

`validateLicense` writes under the same instance-qualified key: `await writeCache(deps, key, instanceId, …)`. `activateLicense` writes under `(key, out.data?.instance?.id ?? null)` so the entry matches the bearer the plugin will send next.

`handlers.ts` — both call sites become:

```ts
const lic = await checkLicense(identity.key, identity.instanceId, { fetcher: deps.fetcher, cache: deps.licenseCache, now: deps.now });
```

`identityId` stays `licenseIdentityId(identity.key)` (key only).

Every existing `checkLicense(<key>, { fetcher… })` call in `license.test.ts` (Tasks 1 and 3 added several) gains `null` as the second argument: `checkLicense(<key>, null, { fetcher… })`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/proxy && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src packages/proxy/test
git commit -m "feat(proxy): accept key:instanceId bearers and validate the device instance per request"
```

---

### Task 5: Harden handleActivate and expose licenseReason on /v1/quota (proxy)

`handleActivate` currently throws uncaught on an LS outage (raw 500, no CORS). Catch `LsUnreachable` → clean 502. And `handleQuota` should tell the plugin *why* a key is not Pro so the UI can distinguish "expired" from "unreachable" from "needs activation".

**Files:**
- Modify: `packages/proxy/src/handlers.ts`
- Test: `packages/proxy/test/router.test.ts`

**Interfaces:**
- Produces (consumed by extractor Task 7 / plugin Task 8):
  - `/v1/quota` body for a non-Pro license identity: `{ …QuotaSnapshot, licenseReason: LicenseReason }`.
  - `/v1/license/activate` on LS outage: `502 { error: 'ls_unreachable' }`.
  - 401 on `/v1/prose` keeps its existing body `{ error: 'license_not_active', reason }` — already implemented; add the missing test.

- [ ] **Step 1: Write the failing tests**

In `router.test.ts`:

```ts
it('502s activation cleanly when LS is unreachable (with CORS)', async () => {
  const down = vi.fn(async () => { throw new Error('ls down'); });
  const d = deps({ fetcher: down as unknown as typeof fetch });
  const res = await route(new Request('https://proxy.test/v1/license/activate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }),
  }), d);
  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({ error: 'ls_unreachable' });
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
});

it('includes licenseReason in the quota body when a key is not granting pro', async () => {
  const expired = vi.fn(async () => new Response(
    JSON.stringify({ valid: false, license_key: { status: 'expired' } }), { status: 200 },
  ));
  const d = deps({ fetcher: expired as unknown as typeof fetch });
  const res = await route(new Request('https://proxy.test/v1/quota', {
    headers: { Authorization: 'Bearer aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
  }), d);
  const body = await res.json() as { tier: string; licenseReason?: string };
  expect(body.tier).toBe('free');
  expect(body.licenseReason).toBe('expired');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/proxy && npx vitest run test/router.test.ts`
Expected: FAIL — the outage test gets an unhandled rejection; no `licenseReason` in the quota body.

- [ ] **Step 3: Implement**

In `handleActivate`, wrap both LS calls (import `LsUnreachable` from `./license`):

```ts
try {
  if (typeof body.instanceId === 'string' && body.instanceId) {
    const v = await validateLicense(body.key, body.instanceId, licenseDeps);
    return json(200, { valid: v.valid, status: v.status, instanceId: body.instanceId });
  }
  const out = await activateLicense(body.key, typeof body.instanceName === 'string' ? body.instanceName : 'Figma plugin', licenseDeps);
  return json(200, out);
} catch (err) {
  if (err instanceof LsUnreachable) return json(502, { error: 'ls_unreachable' });
  throw err;
}
```

In `handleQuota`, keep the `lic` result and widen the response:

```ts
const s = await deps.quotaFor(identityId).snapshot(tier);
if (identity.kind === 'license' && tier === 'free') {
  const lic = licResult; // the checkLicense result computed above
  return json(200, { ...s, licenseReason: lic.tier === 'free' ? lic.reason : undefined });
}
return json(200, s);
```

(Restructure the existing `if (identity.kind === 'license')` block so the `checkLicense` result stays in scope — store it in a local `licResult` variable typed `LicenseResult | null`, initialized `null`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/proxy && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/handlers.ts packages/proxy/test/router.test.ts
git commit -m "fix(proxy): clean 502 on LS outage during activation; surface licenseReason on /v1/quota"
```

---

### Task 6: Deactivate endpoint (proxy)

Free a device slot from the plugin: `POST /v1/license/deactivate { key, instanceId }` calls LS deactivate and drops the cached verdicts so the next check revalidates.

**Files:**
- Modify: `packages/proxy/src/license.ts` (`deactivateLicense`, `KVLike.delete`)
- Modify: `packages/proxy/src/handlers.ts` (`handleDeactivate` + route)
- Test: `packages/proxy/test/license.test.ts`, `packages/proxy/test/router.test.ts` (both `MemKV` helpers gain `async delete(k) { this.map.delete(k); }`; same for `handlers.test.ts`'s MemKV since it shares `KVLike`)

**Interfaces:**
- Produces:
  - `KVLike` gains `delete(key: string): Promise<void>` (Cloudflare KV has native `delete`; no `index.ts` change needed).
  - `export async function deactivateLicense(key: string, instanceId: string, deps: LicenseDeps): Promise<{ deactivated: boolean }>` — throws `LsUnreachable` on transient failure; deletes the `(key, instanceId)` and `(key, null)` cache entries on success.
  - Route: `POST /v1/license/deactivate` → 200 `{ deactivated: boolean }`, 400 on missing/malformed input, 429 rate-limited, 502 `{ error: 'ls_unreachable' }`.

- [ ] **Step 1: Write the failing tests**

`license.test.ts`:

```ts
describe('deactivateLicense', () => {
  it('calls LS deactivate and clears both cache entries', async () => {
    const cache = new MemKV();
    await checkLicense(UUID_KEY, null, { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => T0 });
    await checkLicense(UUID_KEY, 'inst-1', { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => T0 });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ deactivated: true }), { status: 200 }));
    const out = await deactivateLicense(UUID_KEY, 'inst-1', { fetcher: fetcher as unknown as typeof fetch, cache, now: () => T0 });
    expect(out).toEqual({ deactivated: true });
    expect(cache.map.size).toBe(0);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/deactivate');
    expect(JSON.parse(String(init.body))).toEqual({ license_key: UUID_KEY, instance_id: 'inst-1' });
  });
  it('throws LsUnreachable on a transient failure', async () => {
    const down = vi.fn(async () => { throw new Error('down'); });
    await expect(deactivateLicense(UUID_KEY, 'inst-1', { fetcher: down as unknown as typeof fetch, cache: new MemKV(), now: () => T0 }))
      .rejects.toBeInstanceOf(LsUnreachable);
  });
});
```

`router.test.ts`:

```ts
it('POST /v1/license/deactivate proxies to LS and returns the outcome', async () => {
  const ls = vi.fn(async () => new Response(JSON.stringify({ deactivated: true }), { status: 200 }));
  const d = deps({ fetcher: ls as unknown as typeof fetch });
  const res = await route(new Request('https://proxy.test/v1/license/deactivate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', instanceId: 'inst-1' }),
  }), d);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ deactivated: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/proxy && npx vitest run`
Expected: FAIL — `deactivateLicense` does not exist; route 404s.

- [ ] **Step 3: Implement**

`license.ts` — extend `KVLike`:

```ts
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
```

```ts
export async function deactivateLicense(
  key: string, instanceId: string, deps: LicenseDeps,
): Promise<{ deactivated: boolean }> {
  const out = await callLs('deactivate', { license_key: key, instance_id: instanceId }, deps);
  if (out.kind === 'transient') throw new LsUnreachable();
  const deactivated = Boolean((out.data as { deactivated?: boolean } | undefined)?.deactivated);
  if (deactivated) {
    // Drop both verdict entries so the next check revalidates against LS.
    await deps.cache.delete(cacheKey(key, instanceId));
    await deps.cache.delete(cacheKey(key, null));
  }
  return { deactivated };
}
```

(Note: `callLs`'s `data` capture from Task 1 also needs `deactivated?: boolean` in its type.)

`handlers.ts`:

```ts
export async function handleDeactivate(req: Request, deps: HandlerDeps): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.licenseLimiter.allow(ip, deps.now())) return json(429, { error: 'rate_limited' });
  let body: { key?: unknown; instanceId?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return json(400, { error: 'invalid json' }); }
  if (typeof body.key !== 'string' || !LICENSE_KEY_RE.test(body.key)) return json(400, { error: 'missing key' });
  if (typeof body.instanceId !== 'string' || !body.instanceId) return json(400, { error: 'missing instanceId' });
  try {
    const out = await deactivateLicense(body.key, body.instanceId, { fetcher: deps.fetcher, cache: deps.licenseCache, now: deps.now });
    return json(200, out);
  } catch (err) {
    if (err instanceof LsUnreachable) return json(502, { error: 'ls_unreachable' });
    throw err;
  }
}
```

Route line in `routeInner`: `if (req.method === 'POST' && pathname === '/v1/license/deactivate') return handleDeactivate(req, deps);`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/proxy && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src packages/proxy/test
git commit -m "feat(proxy): /v1/license/deactivate frees a device slot and clears cached verdicts"
```

---

### Task 7: Extractor client — instance-aware auth and error reasons

The shared HTTP client must send the `key:instanceId` bearer, expose the 401 body's `reason` on `ProseProxyError`, and widen `ProxyQuota` with `licenseReason`.

**Files:**
- Modify: `packages/extractor/src/prose/client.ts`
- Test: `packages/extractor/test/client.test.ts`

**Interfaces:**
- Produces (consumed by plugin Tasks 8–10):
  - `ProxyQuota` gains `licenseReason?: 'invalid' | 'expired' | 'inactive' | 'unreachable'`.
  - `DraftOptions.proxy` gains `licenseInstanceId?: string | null`.
  - `ProseProxyError` gains `public reason?: string` (third constructor arg).

- [ ] **Step 1: Write the failing tests**

Append to `packages/extractor/test/client.test.ts`, following its existing fixture style (check the top of the file for the spec fixture and fetcher mocks; reuse them):

```ts
it('sends key:instanceId in the bearer when the proxy auth has an instance', async () => {
  const fetcher = vi.fn(async () => new Response(
    JSON.stringify({ content: [{ type: 'text', text: '{}' }] }), { status: 200 },
  ));
  await draftProse(spec, {
    apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: memCache(),
    proxy: { url: 'https://p.test', licenseKey: 'LK', licenseInstanceId: 'inst-1' },
  });
  const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer LK:inst-1');
});

it('exposes the 401 reason on ProseProxyError', async () => {
  const fetcher = vi.fn(async () => new Response(
    JSON.stringify({ error: 'license_not_active', reason: 'unreachable' }), { status: 401 },
  ));
  const err = await draftProse(spec, {
    apiKey: null, fetcher: fetcher as unknown as typeof fetch, cacheStore: memCache(),
    proxy: { url: 'https://p.test', licenseKey: 'LK' },
  }).catch((e) => e as ProseProxyError);
  expect(err).toBeInstanceOf(ProseProxyError);
  expect((err as ProseProxyError).code).toBe('license_not_active');
  expect((err as ProseProxyError).reason).toBe('unreachable');
});
```

(If the test file has no `memCache` helper, define one matching `CacheStore`: `const memCache = () => { const m = new Map<string, string>(); return { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); } }; };`)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/extractor && npx vitest run test/client.test.ts`
Expected: FAIL — bearer is `Bearer LK`; `reason` is undefined.

- [ ] **Step 3: Implement in `client.ts`**

```ts
export interface ProxyQuota {
  tier: 'free' | 'pro';
  used: number;
  limit: number | null;
  remaining: number | null;
  resetsAt: string;
  /** Why a stored key is not granting pro; only present on license identities. */
  licenseReason?: 'invalid' | 'expired' | 'inactive' | 'unreachable';
}

export class ProseProxyError extends Error {
  constructor(public code: ProseProxyErrorCode, public resetsAt?: string, public reason?: string) {
    super(code);
    this.name = 'ProseProxyError';
  }
}
```

In `DraftOptions.proxy`, add `licenseInstanceId?: string | null;`. In the proxy branch of `draftProse`:

```ts
const bearer = opts.proxy.licenseKey
  ? opts.proxy.licenseInstanceId
    ? `${opts.proxy.licenseKey}:${opts.proxy.licenseInstanceId}`
    : opts.proxy.licenseKey
  : null;
const auth: Record<string, string> = bearer
  ? { Authorization: `Bearer ${bearer}` }
  : { 'X-Figma-User': opts.proxy.figmaUserId ?? '' };
```

And in the `!res.ok` branch:

```ts
if (!res.ok) {
  const code = PROXY_ERROR_BY_STATUS[res.status] ?? 'upstream';
  let resetsAt: string | undefined;
  let reason: string | undefined;
  try {
    const b = (await res.json()) as { resetsAt?: string; reason?: string };
    resetsAt = b.resetsAt;
    reason = b.reason;
  } catch { /* body optional */ }
  throw new ProseProxyError(code, resetsAt, reason);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/extractor && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/prose/client.ts packages/extractor/test/client.test.ts
git commit -m "feat(extractor): instance-aware proxy bearer and 401 reason on ProseProxyError"
```

---

### Task 8: Plugin proxy module — instance auth, reason-aware copy, robust activation client

**Files:**
- Modify: `packages/plugin/src/ui/proxy.ts`
- Test: `packages/plugin/test/proxy.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 9–10):
  - `ProxyAuth` becomes `{ licenseKey: string | null; licenseInstanceId: string | null; figmaUserId: string | null }`.
  - `effectiveAuth(licenseKey, licenseInstanceId, figmaUserId, licenseActive): ProxyAuth` — **signature change**.
  - `resolveLicenseView(hasKey, quota)`: a free-tier quota with `licenseReason === 'unreachable'` returns `'unknown'` (a blip must never read as cancelled).
  - `licenseStatusCopy(view: LicenseView, reason?: string): string` — **signature change**.
  - `activationErrorCopy` gains an `'inactive'` case.
  - `activateLicense(key, instanceId, fetcher)` throws on `!res.ok` (proxy 429/502) instead of parsing garbage.
  - `export async function deactivateLicense(key: string, instanceId: string, fetcher?): Promise<boolean>` (best-effort, returns false on any failure).

All UI copy: no em dashes, plain peer tone.

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugin/test/proxy.test.ts`:

```ts
describe('instance-aware auth', () => {
  it('sends key:instanceId in the bearer when an instance is known', () => {
    expect(authHeaders({ licenseKey: 'LK', licenseInstanceId: 'i1', figmaUserId: 'u1' }))
      .toEqual({ Authorization: 'Bearer LK:i1' });
  });
  it('falls back to the bare key without an instance', () => {
    expect(authHeaders({ licenseKey: 'LK', licenseInstanceId: null, figmaUserId: 'u1' }))
      .toEqual({ Authorization: 'Bearer LK' });
  });
});

describe('resolveLicenseView with licenseReason', () => {
  it('an unreachable license reads as unknown, never inactive', () => {
    const q: ProxyQuota = { tier: 'free', used: 0, limit: 10, remaining: 10, resetsAt: '', licenseReason: 'unreachable' };
    expect(resolveLicenseView(true, q)).toBe('unknown');
  });
  it('a definite expired reason still reads as inactive', () => {
    const q: ProxyQuota = { tier: 'free', used: 0, limit: 10, remaining: 10, resetsAt: '', licenseReason: 'expired' };
    expect(resolveLicenseView(true, q)).toBe('inactive');
  });
});

describe('licenseStatusCopy reasons', () => {
  it('expired suggests renewing', () => {
    expect(licenseStatusCopy('inactive', 'expired')).toContain('Renew');
  });
  it('inactive suggests re-activating, not renewing', () => {
    const copy = licenseStatusCopy('inactive', 'inactive');
    expect(copy).toContain('Activate');
    expect(copy).not.toContain('Renew');
  });
});

describe('activateLicense error handling', () => {
  it('throws on a non-ok proxy response instead of returning a bogus verdict', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'ls_unreachable' }), { status: 502 }));
    await expect(activateLicense('LK', null, fetcher as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe('deactivateLicense', () => {
  it('POSTs to /v1/license/deactivate and reports the outcome', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ deactivated: true }), { status: 200 }));
    expect(await deactivateLicense('LK', 'i1', fetcher as unknown as typeof fetch)).toBe(true);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${PROXY_URL}/v1/license/deactivate`);
    expect(JSON.parse(String(init.body))).toEqual({ key: 'LK', instanceId: 'i1' });
  });
  it('returns false on any failure (best-effort)', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    expect(await deactivateLicense('LK', 'i1', fetcher as unknown as typeof fetch)).toBe(false);
  });
});
```

Existing `authHeaders` tests need the new `licenseInstanceId` field added to their `ProxyAuth` literals, and existing `effectiveAuth` tests move from 3 arguments to 4: `effectiveAuth(key, instanceId, figmaUserId, licenseActive)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/plugin && npx vitest run test/proxy.test.ts`
Expected: FAIL — type errors on `ProxyAuth`, missing `deactivateLicense`.

- [ ] **Step 3: Implement in `proxy.ts`**

```ts
export interface ProxyAuth {
  licenseKey: string | null;
  licenseInstanceId: string | null;
  figmaUserId: string | null;
}

export function authHeaders(auth: ProxyAuth): Record<string, string> | null {
  if (auth.licenseKey) {
    const bearer = auth.licenseInstanceId ? `${auth.licenseKey}:${auth.licenseInstanceId}` : auth.licenseKey;
    return { Authorization: `Bearer ${bearer}` };
  }
  if (auth.figmaUserId) return { 'X-Figma-User': auth.figmaUserId };
  return null;
}

export function effectiveAuth(
  licenseKey: string | null,
  licenseInstanceId: string | null,
  figmaUserId: string | null,
  licenseActive: boolean | null,
): ProxyAuth {
  const useKey = licenseActive === false ? null : licenseKey;
  return { licenseKey: useKey, licenseInstanceId: useKey ? licenseInstanceId : null, figmaUserId };
}

export function resolveLicenseView(hasKey: boolean, quota: ProxyQuota | null): LicenseView {
  if (!hasKey) return 'none';
  if (!quota) return 'unknown';
  if (quota.tier === 'pro') return 'pro';
  // A proxy that could not reach the license server is a blip, not a lapse.
  return quota.licenseReason === 'unreachable' ? 'unknown' : 'inactive';
}

export function licenseStatusCopy(view: LicenseView, reason?: string): string {
  switch (view) {
    case 'pro': return 'Pro plan active ✓';
    case 'inactive':
      return reason === 'expired'
        ? "Your Pro subscription isn't active right now, so you're on the free plan. Renew to switch Pro back on."
        : "Your Pro key isn't connected to this device right now, so you're on the free plan. Press Activate to reconnect it.";
    case 'unknown': return 'Your Pro key is saved.';
    case 'none': return '';
  }
}

export function activationErrorCopy(status: string): string {
  switch (status) {
    case 'expired': return 'That subscription has expired. Grab Pro again from the store to switch it back on.';
    case 'disabled': return "That key has been turned off. Reach out to support if that's unexpected.";
    case 'inactive': return "That key exists but isn't connected to a device. Press Activate again to link this one.";
    default: return "We couldn't find that key. Double-check it against your purchase email.";
  }
}
```

`activateLicense`: after the fetch, add `if (!res.ok) throw new Error(\`activation failed: ${res.status}\`);` before `res.json()`.

New function:

```ts
/** Best-effort slot release. A failure only means the slot stays used in LS. */
export async function deactivateLicense(
  key: string,
  instanceId: string,
  fetcher: typeof fetch = window.fetch.bind(window),
): Promise<boolean> {
  try {
    const res = await fetcher(`${PROXY_URL}/v1/license/deactivate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, instanceId }),
    });
    if (!res.ok) return false;
    return Boolean(((await res.json()) as { deactivated?: boolean }).deactivated);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/plugin && npx vitest run test/proxy.test.ts`
Expected: PASS. (`ui.ts`/`actions.ts`/`render.ts` will have compile errors until Tasks 9–10; vitest only compiles imported modules, so this file's tests run. If the suite typechecks the whole package, do Tasks 8–10 in one branch sitting and run the full suite at Task 10.)

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/proxy.ts packages/plugin/test/proxy.test.ts
git commit -m "feat(plugin): instance-aware proxy auth, reason-aware license copy, deactivate client"
```

---

### Task 9: Plugin actions — outage-aware 401 handling and key normalization

**Files:**
- Modify: `packages/plugin/src/ui/actions.ts`
- Test: `packages/plugin/test/actions.test.ts`

**Interfaces:**
- Consumes: `effectiveAuth(licenseKey, licenseInstanceId, figmaUserId, licenseActive)` (Task 8), `ProseProxyError.reason` (Task 7).
- Produces: `setLicenseKey(state, value, instanceId)` normalizes: empty/whitespace value clears both key and instance (sends `{ value: '', instanceId: null }`).

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugin/test/actions.test.ts` (match its existing state/refs fixture helpers — check the top of the file; `createState` is exported from actions):

```ts
describe('setLicenseKey normalization', () => {
  it('stores null for an empty value and drops the instance id with it', () => {
    const state = createState();
    setLicenseKey(state, '   ', 'inst-1');
    expect(state.licenseKey).toBeNull();
    expect(state.licenseInstanceId).toBeNull();
  });
  it('trims the stored key', () => {
    const state = createState();
    setLicenseKey(state, '  LK-1  ', 'inst-1');
    expect(state.licenseKey).toBe('LK-1');
    expect(state.licenseInstanceId).toBe('inst-1');
  });
});
```

For the 401-reason branch, `ensureProse` is module-private; test through the exported behavior it feeds. Add a focused unit by exporting the note-derivation as a pure function — in `actions.ts` create and export:

```ts
/** Note + state effect for a failed license during generation. Pure for tests. */
export function licenseFailureNote(reason: string | undefined): { note: string; markInactive: boolean } {
  if (reason === 'unreachable') {
    return {
      note: "We couldn't check your Pro key this time, so AI didn't run. Your key is still saved. Try again in a minute.",
      markInactive: false,
    };
  }
  return {
    note: "Your Pro subscription isn't active, so AI didn't run this time. You're back on the free tier, and the renew option is in Settings.",
    markInactive: true,
  };
}
```

And test it:

```ts
describe('licenseFailureNote', () => {
  it('an unreachable license server never flips the key to inactive', () => {
    const out = licenseFailureNote('unreachable');
    expect(out.markInactive).toBe(false);
    expect(out.note).toContain('still saved');
  });
  it('a definite lapse drops to the free tier', () => {
    expect(licenseFailureNote('expired').markInactive).toBe(true);
    expect(licenseFailureNote(undefined).markInactive).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/plugin && npx vitest run test/actions.test.ts`
Expected: FAIL — `licenseFailureNote` not exported; empty key stored as `null`? (current code stores `'   ' || null` → `'   '`).

- [ ] **Step 3: Implement in `actions.ts`**

`setLicenseKey`:

```ts
export function setLicenseKey(state: UiState, value: string, instanceId: string | null): void {
  const key = value.trim() || null;
  state.licenseKey = key;
  state.licenseInstanceId = key ? instanceId : null;
  send({ type: 'setLicenseKey', value: key ?? '', instanceId: key ? instanceId : null });
}
```

Add `licenseFailureNote` as written in Step 1. In `ensureProse`, replace the `license_not_active` branch:

```ts
if (err.code === 'license_not_active') {
  const { note, markInactive } = licenseFailureNote(err.reason);
  if (markInactive) state.licenseActive = false;
  state.pendingAiNote = note;
  return;
}
```

Update every `effectiveAuth(...)` call in this file (three sites: `ensureProse`, `runUpdateFromSource`, `runDownloadFromSource`) to:

```ts
effectiveAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId, state.licenseActive)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/plugin && npx vitest run test/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/actions.ts packages/plugin/test/actions.test.ts
git commit -m "fix(plugin): treat an unreachable license server as a blip, not a lapse; normalize stored keys"
```

---

### Task 10: Plugin UI wiring — safe Activate flow, Remove key, persistence cleanup

**Files:**
- Modify: `packages/plugin/src/ui/ui.ts` (activate handler, `refreshQuota`, remove-key handler)
- Modify: `packages/plugin/src/ui/render.ts` (`renderLicense`)
- Modify: `packages/plugin/src/ui/dom.ts` (remove-key row + refs)
- Modify: `packages/plugin/src/main.ts` (delete storage on empty key)

**Interfaces:**
- Consumes: `deactivateLicense`, `licenseStatusCopy(view, reason)`, `resolveLicenseView` (Task 8); `setLicenseKey` normalization (Task 9).
- Produces: `Refs` gains `licenseRemoveRow: HTMLElement` and `removeKeyLink: HTMLAnchorElement`.

This task is DOM wiring; there is no unit-test seam, so its verification is the full-suite run plus the manual Figma pass in Task 11. Keep each change minimal.

- [ ] **Step 1: dom.ts — add the remove-key row**

After the `license-renew-row` line in the Settings markup:

```html
<p class="hint" id="license-remove-row" hidden style="margin-top:6px"><a id="remove-key-link" href="#">Remove key from this device</a></p>
```

Add to the `Refs` interface and the `mount()` return:

```ts
licenseRemoveRow: HTMLElement;
removeKeyLink: HTMLAnchorElement;
// in mount():
licenseRemoveRow: byId<HTMLElement>('license-remove-row'),
removeKeyLink: byId<HTMLAnchorElement>('remove-key-link'),
```

- [ ] **Step 2: render.ts — reason-aware status line + remove row visibility**

```ts
export function renderLicense(refs: Refs, state: UiState): void {
  const view = resolveLicenseView(Boolean(state.licenseKey), state.quota);
  refs.licenseStatus.textContent = licenseStatusCopy(view, state.quota?.licenseReason);
  refs.licenseRenewRow.hidden = !(view === 'inactive' && state.quota?.licenseReason === 'expired');
  refs.licenseRemoveRow.hidden = !state.licenseKey;
}
```

- [ ] **Step 3: ui.ts — harden the activate handler**

Replace the `licenseActivateBtn` click handler:

```ts
refs.licenseActivateBtn.addEventListener('click', async () => {
  const key = refs.licenseKeyInput.value.trim();
  if (!key || refs.licenseActivateBtn.disabled) return;
  // In-flight guard: a double click (or Enter twice) on a first-time
  // activation would register two LS device instances and burn two slots.
  refs.licenseActivateBtn.disabled = true;
  refs.licenseStatus.textContent = 'Checking…';
  refs.licenseRenewRow.hidden = true;
  try {
    // A stored instance id belongs to the stored key. If the user pasted a
    // different key, start fresh instead of validating a mismatched pair.
    const knownInstance = key === state.licenseKey ? state.licenseInstanceId : null;
    let out = await activateLicense(key, knownInstance);
    // A stored instance id can go stale (deactivated in the dashboard, or an
    // older build). If revalidating it fails, register a fresh instance.
    if (!out.valid && knownInstance) {
      out = await activateLicense(key, null);
    }
    if (out.valid && out.status === 'active') {
      state.licenseActive = true;
      setLicenseKey(state, key, out.instanceId ?? knownInstance);
      reflectAiToggle();
      // Confirm immediately; refreshQuota repaints from the live quota after.
      refs.licenseStatus.textContent = 'Pro plan active ✓';
      await refreshQuota();
    } else if (out.status === 'active') {
      refs.licenseStatus.textContent = "This key is active but couldn't be activated on this device. It may have reached its device limit. Free up a device in Manage subscription, or reach out to support.";
    } else {
      refs.licenseStatus.textContent = activationErrorCopy(out.status);
    }
  } catch {
    refs.licenseStatus.textContent = "Couldn't reach the license server. Give it another go in a minute.";
  } finally {
    refs.licenseActivateBtn.disabled = false;
  }
  renderQuota(refs, state);
});
```

- [ ] **Step 4: ui.ts — outage-aware refreshQuota and the remove-key handler**

`refreshQuota` becomes:

```ts
async function refreshQuota(): Promise<void> {
  state.quota = await fetchQuota(effectiveAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId, state.licenseActive));
  // Learn the key's real standing from the probe. Only a DEFINITE non-pro
  // verdict demotes the key; licenseReason 'unreachable' (and a null quota)
  // teach us nothing and leave the key in place for the next attempt.
  if (state.licenseKey && state.licenseActive !== false && state.quota) {
    if (state.quota.tier === 'pro') {
      state.licenseActive = true;
    } else if (state.quota.licenseReason !== 'unreachable') {
      state.licenseActive = false;
      state.quota = await fetchQuota(effectiveAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId, false));
    }
  }
  renderLicense(refs, state);
  renderQuota(refs, state);
}
```

Remove-key handler (near the renew-link wiring; import `deactivateLicense` from `./proxy`):

```ts
refs.removeKeyLink.addEventListener('click', async (e) => {
  e.preventDefault();
  refs.licenseStatus.textContent = 'Removing…';
  // Best-effort: free the LS device slot. Local removal happens regardless,
  // so a network failure only means the slot stays used until the dashboard.
  if (state.licenseKey && state.licenseInstanceId) {
    await deactivateLicense(state.licenseKey, state.licenseInstanceId);
  }
  setLicenseKey(state, '', null);
  state.licenseActive = null;
  refs.licenseKeyInput.value = '';
  refs.licenseStatus.textContent = 'Key removed from this device.';
  refs.licenseRemoveRow.hidden = true;
  reflectAiToggle();
  await refreshQuota();
});
```

Note: `refreshQuota` calls `renderLicense`, which will clear the "Key removed" line to the `none` view's empty string on its repaint. That is acceptable; if it feels abrupt in manual testing, set the message after `await refreshQuota()` instead.

- [ ] **Step 5: main.ts — delete storage on an empty key**

```ts
case 'setLicenseKey':
  if (msg.value) {
    await figma.clientStorage.setAsync('licenseKey', msg.value);
    if (msg.instanceId) await figma.clientStorage.setAsync('licenseInstanceId', msg.instanceId);
    else await figma.clientStorage.deleteAsync('licenseInstanceId');
  } else {
    await figma.clientStorage.deleteAsync('licenseKey');
    await figma.clientStorage.deleteAsync('licenseInstanceId');
  }
  break;
```

- [ ] **Step 6: Full plugin suite + typecheck + build**

Run: `cd packages/plugin && npx vitest run && npx tsc --noEmit && npm run build`
Expected: all green. Fix any `effectiveAuth`/`ProxyAuth` call sites the compiler flags (e.g. `ai.ts` passes `auth.licenseInstanceId` into `draftProse`'s `proxy` options: add `licenseInstanceId: auth.licenseInstanceId` there).

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src
git commit -m "feat(plugin): in-flight activate guard, remove-key flow, outage-aware license status"
```

---

### Task 11: Documentation, accepted risks, and manual verification

**Files:**
- Modify: `packages/proxy/README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document accepted risks in `packages/proxy/README.md`**

Add a section (adjust to the README's existing heading style):

```markdown
## Accepted risks and operational notes

- **Free identities are client-asserted.** `X-Figma-User` is not authenticated; rotating
  it re-mints a free identity with a fresh 20-generation boost window. Bounded per
  request by the model/max_tokens allowlist. Escalation if abused: per-IP limits on
  /v1/prose or a signed-identity handshake.
- **Salt rotation resets free identities.** Changing `FIGMA_ID_SALT` renames every free
  identity's Durable Object: quotas reset and every user re-enters the boost window.
  Rotate only with that intent.
- **Cancellations propagate within 24h.** A refunded/cancelled key keeps Pro until its
  cache entry (24h TTL) expires. Deliberate trade-off for LS availability independence.
- **In-code rate limiting is per-isolate.** `SlidingWindowLimiter` is best-effort; the
  durable backstop should be a Cloudflare WAF rate rule on `/v1/license/*` (20/min/IP).
- **License identities are hashed.** KV verdict-cache keys, DO names, and logs carry
  `sha256(key)`, never the raw key.
```

- [ ] **Step 2: CHANGELOG entry**

Add under an Unreleased heading, matching the file's existing format:

```markdown
- License hardening: transient Lemon Squeezy errors no longer read as invalid keys;
  renewals show as Pro immediately after Activate; device instances are checked on
  every request; license endpoints are rate-limited and format-gated; keys are hashed
  in server storage and logs; the plugin adds Remove key and clearer status messages
  for outages, expired subscriptions, and unactivated keys.
```

- [ ] **Step 3: Full verification**

```bash
cd packages/proxy && npx vitest run
cd ../extractor && npx vitest run
cd ../plugin && npx vitest run && npx tsc --noEmit && npm run build
```

Expected: all suites green, plugin builds.

- [ ] **Step 4: Manual Figma pass (cannot be automated)**

In Figma with the built plugin, walk the matrix and record results in the PR description:
1. Fresh activation with a real test key → "Pro plan active ✓", meter shows Unlimited.
2. Repeat Activate → still valid, LS dashboard shows ONE instance (no new slot).
3. Double-click Activate rapidly on a fresh key → LS dashboard still shows one instance.
4. Paste a different (invalid) key over a stored one → "We couldn't find that key", original key restorable by re-pasting.
5. Remove key → LS dashboard slot freed, Settings back to free-plan state, plugin reload shows no key.
6. Deactivate the device in the LS dashboard → within 24h (or after clearing the KV entry manually) generation drops to free with the "Press Activate to reconnect" line.
7. Proxy unreachable (toggle network off) → Settings says "Your Pro key is saved.", never "isn't active".

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/README.md CHANGELOG.md
git commit -m "docs: license hardening notes, accepted risks, and changelog"
```

---

## Deployment order

1. Deploy the proxy first (`packages/proxy`) — it accepts both bearer formats, so live plugins keep working.
2. Ship the plugin update after the proxy is live — it starts sending `key:instanceId` bearers and using `/v1/license/deactivate`.
3. Add the Cloudflare WAF rate rule on `/v1/license/*` (20/min/IP) in the dashboard — code review cannot do this step.

## Finding-to-task map

| Finding | Task |
|---|---|
| Transient LS errors cached as invalid (cache poisoning) | 1 |
| `validateLicense` missing cache write (renewal shows inactive) | 1 |
| LS `inactive` status collapsed into `invalid` | 1 (reason) + 8 (copy) |
| Raw keys in logs / KV keys / DO names | 2 |
| Key enumeration oracle, unbounded KV, no TTL | 3 |
| Device limit not enforced at request time | 4 |
| `handleActivate` uncaught throw → raw 500 | 5 |
| Plugin can't distinguish outage from lapse (401 reason) | 5, 7, 9 |
| Outage misread as cancellation in Settings | 5, 7, 8, 10 |
| Double-click Activate burns device slots | 10 |
| Stale `instanceId` reused with a different key | 10 |
| No remove-key / deactivate affordance | 6, 8, 10 |
| Empty-string key persisted | 9, 10 |
| Post-activation status flicker (optimistic confirm) | 10 |
| Accepted risks undocumented | 11 |
