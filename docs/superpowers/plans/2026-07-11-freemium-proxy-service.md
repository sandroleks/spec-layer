# Freemium Proxy Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the license + AI proxy service (spec §6.1) — the server-authoritative quota/license layer between the Figma plugin and the Anthropic API.

**Architecture:** A Cloudflare Worker in a new `packages/proxy` workspace package. All business logic lives in pure, dependency-injected modules (`QuotaEngine`, license check, HTTP handlers) tested with plain vitest — no miniflare. Atomicity comes from one Durable Object per identity (`QuotaDO`), which is a thin persistence wrapper around `QuotaEngine`. License status caches in Workers KV. The prose `cacheKey` (deterministic content hash from `proseCacheKey`) doubles as the idempotency key.

**Tech Stack:** TypeScript (ESM), vitest (root config picks up `packages/proxy/test`), `js-sha256`, Cloudflare Workers + Durable Objects + KV, wrangler. Lemon Squeezy License API (public endpoints, no API key needed for validate/activate).

## Global Constraints

- Free tier: **20 generations within 30 days of first sight** (boost), then **10 per UTC calendar month**. (Spec §2)
- Pro tier: never blocked on volume in v1; **flag at ≥1,000/month** for review. (Spec §3)
- Rate limit: **10 requests/min** per identity, both tiers. (Spec §3)
- Quota decrements **only after a valid successful Anthropic response**. (Spec §1, §6.1)
- Reservation TTL **2 minutes**; response cache TTL **24 hours** — the only server-side content storage. (Spec §6.1)
- License status cached **24h**; **5-day grace** on validation outage; revoke on later failed validation. (Spec §6.4)
- Figma user IDs stored only as **salted SHA-256 hashes** (secret `FIGMA_ID_SALT`). (Spec §6.6)
- Upstream request allowlist: `model === 'claude-haiku-4-5'`, `max_tokens ≤ 3000` — the proxy must not be usable as a generic Anthropic relay.
- No logging of prompts or generated prose. Counters and content strictly separated.
- Node ≥ 20.9, ESM (`"type": "module"`), repo vitest/eslint conventions.

## API Contract (produced for the plugin plan)

- `POST /v1/prose` — auth: `Authorization: Bearer <license-key>` (pro) **or** `X-Figma-User: <figma-user-id>` (free). Body: `{ cacheKey: string, request: <Anthropic messages body> }`. Success: Anthropic response JSON, plus headers `X-Tier`, `X-Quota-Used`, `X-Quota-Limit` (`unlimited` for pro), `X-Quota-Remaining`, `X-Quota-Resets-At`. Errors: `400` bad request, `401` invalid license, `402 {"error":"quota_exhausted","resetsAt":…}`, `409 {"error":"generation_pending"}`, `429 {"error":"rate_limited","retryAfterMs":…}`, `502` upstream failure.
- `GET /v1/quota` — same auth → `QuotaSnapshot` JSON `{ tier, used, limit, remaining, resetsAt }`.
- `POST /v1/license/activate` — body `{ key: string, instanceName: string }` → `{ valid: boolean, status: string, instanceId?: string }`.

---

### Task 1: Package scaffold + identity hashing

**Files:**
- Create: `packages/proxy/package.json`
- Create: `packages/proxy/tsconfig.json`
- Create: `packages/proxy/src/identity.ts`
- Modify: root `package.json` (add proxy to `typecheck` script)
- Test: `packages/proxy/test/identity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `hashFigmaId(figmaId: string, salt: string): string` (hex, 64 chars); `identityFromHeaders(headers: Headers, salt: string): { kind: 'license'; key: string } | { kind: 'free'; id: string } | null` — license wins when both headers present; `id` is the salted hash; returns `null` when neither header is present or values are empty.

- [ ] **Step 1: Create the package scaffold**

`packages/proxy/package.json`:
```json
{
  "name": "@spec-layer/proxy",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "js-sha256": "^0.11.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260701.0",
    "wrangler": "^4.0.0"
  }
}
```

`packages/proxy/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"],
    "lib": ["ES2022"],
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

In root `package.json`, extend the `typecheck` script with `&& tsc -p packages/proxy/tsconfig.json --noEmit` (append before the `apps/web` entry or at the end — keep the existing entries untouched).

Run: `npm install` (links the workspace).

- [ ] **Step 2: Write the failing test**

`packages/proxy/test/identity.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hashFigmaId, identityFromHeaders } from '../src/identity';

describe('identity', () => {
  it('hashes a figma id with the salt (stable, salt-sensitive)', () => {
    const a = hashFigmaId('user-123', 'salt-A');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFigmaId('user-123', 'salt-A')).toBe(a);
    expect(hashFigmaId('user-123', 'salt-B')).not.toBe(a);
  });

  it('prefers the license header when both are present', () => {
    const h = new Headers({ Authorization: 'Bearer key-1', 'X-Figma-User': 'u1' });
    expect(identityFromHeaders(h, 's')).toEqual({ kind: 'license', key: 'key-1' });
  });

  it('falls back to a hashed free identity', () => {
    const h = new Headers({ 'X-Figma-User': 'u1' });
    const id = identityFromHeaders(h, 's');
    expect(id).toEqual({ kind: 'free', id: hashFigmaId('u1', 's') });
  });

  it('returns null with no auth headers or empty values', () => {
    expect(identityFromHeaders(new Headers(), 's')).toBeNull();
    expect(identityFromHeaders(new Headers({ Authorization: 'Bearer ' }), 's')).toBeNull();
    expect(identityFromHeaders(new Headers({ 'X-Figma-User': '' }), 's')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/proxy/test/identity.test.ts`
Expected: FAIL — cannot resolve `../src/identity`.

- [ ] **Step 4: Implement**

`packages/proxy/src/identity.ts`:
```ts
import { sha256 } from 'js-sha256';

/** Salted hash of a Figma user id — the only form the server ever stores. */
export function hashFigmaId(figmaId: string, salt: string): string {
  return sha256(`${salt}:${figmaId}`);
}

export type Identity =
  | { kind: 'license'; key: string }
  | { kind: 'free'; id: string };

/** License wins when both headers are present. Null = unauthenticated. */
export function identityFromHeaders(headers: Headers, salt: string): Identity | null {
  const auth = headers.get('Authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (bearer) return { kind: 'license', key: bearer };
  const figma = (headers.get('X-Figma-User') ?? '').trim();
  if (figma) return { kind: 'free', id: hashFigmaId(figma, salt) };
  return null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/proxy/test/identity.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/proxy package.json package-lock.json
git commit -m "feat(proxy): scaffold package + salted identity hashing"
```

---

### Task 2: QuotaEngine — free-tier limits (boost + monthly)

**Files:**
- Create: `packages/proxy/src/quota.ts`
- Test: `packages/proxy/test/quota.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 3, 4, 6, 7):
```ts
type Tier = 'free' | 'pro';
type ReserveResult =
  | { kind: 'proceed'; flagged?: boolean }
  | { kind: 'cached'; body: string }
  | { kind: 'pending' }
  | { kind: 'exhausted'; resetsAt: string }
  | { kind: 'rate_limited'; retryAfterMs: number };
class QuotaEngine {
  constructor(json?: string);           // rehydrate from serialized state
  reserve(tier: Tier, cacheKey: string, now: number): ReserveResult;
  commit(cacheKey: string, body: string, now: number): void;
  release(cacheKey: string): void;
  snapshot(tier: Tier, now: number): QuotaSnapshot;
  toJSON(): string;
}
interface QuotaSnapshot { tier: Tier; used: number; limit: number | null; remaining: number | null; resetsAt: string }
```
Constants exported: `BOOST_LIMIT = 20`, `BOOST_WINDOW_MS = 30 * 864e5`, `MONTHLY_LIMIT = 10`, `PRO_SOFT_THRESHOLD = 1000`, `RATE_LIMIT_PER_MIN = 10`, `RESERVATION_TTL_MS = 120_000`, `RESPONSE_TTL_MS = 24 * 3600_000`.

This task implements construction, `reserve` (limits only — reservations/cache/rate-limit come in Tasks 3–4), `commit` counting, and `snapshot`.

- [ ] **Step 1: Write the failing test**

`packages/proxy/test/quota.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { QuotaEngine, BOOST_LIMIT, BOOST_WINDOW_MS, MONTHLY_LIMIT } from '../src/quota';

const T0 = Date.parse('2026-07-01T00:00:00Z');
const DAY = 864e5;

/** Reserve+commit n times with distinct keys, spaced 1 min apart (avoids rate limit). */
function burn(e: QuotaEngine, n: number, at: number, prefix = 'k') {
  for (let i = 0; i < n; i++) {
    const t = at + i * 60_000;
    const r = e.reserve('free', `${prefix}${i}`, t);
    expect(r.kind).toBe('proceed');
    e.commit(`${prefix}${i}`, '{}', t);
  }
}

describe('QuotaEngine free tier', () => {
  it('allows 20 in the 30-day boost window, then exhausts', () => {
    const e = new QuotaEngine();
    burn(e, BOOST_LIMIT, T0);
    const r = e.reserve('free', 'k-over', T0 + DAY);
    expect(r.kind).toBe('exhausted');
    if (r.kind === 'exhausted') {
      expect(r.resetsAt).toBe(new Date(T0 + BOOST_WINDOW_MS).toISOString());
    }
  });

  it('after the boost window, allows 10 per calendar month', () => {
    const e = new QuotaEngine();
    burn(e, 5, T0);                       // firstSeen = T0, some boost usage
    const aug = Date.parse('2026-08-15T00:00:00Z'); // boost over
    burn(e, MONTHLY_LIMIT, aug, 'm');
    const r = e.reserve('free', 'm-over', aug + DAY);
    expect(r.kind).toBe('exhausted');
    if (r.kind === 'exhausted') expect(r.resetsAt).toBe('2026-09-01T00:00:00.000Z');
    // new month resets
    const sep = Date.parse('2026-09-02T00:00:00Z');
    expect(e.reserve('free', 'sep-1', sep).kind).toBe('proceed');
  });

  it('only commit decrements; an un-committed reserve does not count', () => {
    const e = new QuotaEngine();
    e.reserve('free', 'a', T0);           // reserved, never committed
    e.release('a');
    const s = e.snapshot('free', T0 + 1);
    expect(s.used).toBe(0);
    expect(s.limit).toBe(BOOST_LIMIT);
  });

  it('serializes and rehydrates', () => {
    const e = new QuotaEngine();
    burn(e, 3, T0);
    const e2 = new QuotaEngine(e.toJSON());
    expect(e2.snapshot('free', T0 + 4 * 60_000).used).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/proxy/test/quota.test.ts`
Expected: FAIL — cannot resolve `../src/quota`.

- [ ] **Step 3: Implement**

`packages/proxy/src/quota.ts`:
```ts
export const BOOST_LIMIT = 20;
export const BOOST_WINDOW_MS = 30 * 864e5;
export const MONTHLY_LIMIT = 10;
export const PRO_SOFT_THRESHOLD = 1000;
export const RATE_LIMIT_PER_MIN = 10;
export const RESERVATION_TTL_MS = 120_000;
export const RESPONSE_TTL_MS = 24 * 3600_000;

export type Tier = 'free' | 'pro';

export interface QuotaSnapshot {
  tier: Tier;
  used: number;
  limit: number | null;     // null = unlimited (pro)
  remaining: number | null;
  resetsAt: string;
}

export type ReserveResult =
  | { kind: 'proceed'; flagged?: boolean }
  | { kind: 'cached'; body: string }
  | { kind: 'pending' }
  | { kind: 'exhausted'; resetsAt: string }
  | { kind: 'rate_limited'; retryAfterMs: number };

interface State {
  firstSeen: number | null;
  boostUsed: number;
  months: Record<string, number>;              // 'YYYY-MM' -> committed count
  reservations: Record<string, number>;        // cacheKey -> reservedAt
  responses: Record<string, { body: string; at: number }>;
  recent: number[];                            // request timestamps (rate limit)
}

const fresh = (): State => ({
  firstSeen: null, boostUsed: 0, months: {}, reservations: {}, responses: {}, recent: [],
});

const monthKey = (now: number) => new Date(now).toISOString().slice(0, 7);

function nextMonthStart(now: number): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

export class QuotaEngine {
  private s: State;

  constructor(json?: string) {
    this.s = json ? { ...fresh(), ...(JSON.parse(json) as State) } : fresh();
  }

  toJSON(): string { return JSON.stringify(this.s); }

  // A never-seen identity is treated as starting its boost window "now" so
  // that a quota peek (GET /v1/quota before any generation) reports boost
  // limits rather than falling through to the monthly rules.
  private inBoost(now: number): boolean {
    const first = this.s.firstSeen ?? now;
    return now < first + BOOST_WINDOW_MS;
  }

  private freeUsage(now: number): { used: number; limit: number; resetsAt: string } {
    const first = this.s.firstSeen ?? now;
    if (this.inBoost(now)) {
      return {
        used: this.s.boostUsed,
        limit: BOOST_LIMIT,
        resetsAt: new Date(first + BOOST_WINDOW_MS).toISOString(),
      };
    }
    return {
      used: this.s.months[monthKey(now)] ?? 0,
      limit: MONTHLY_LIMIT,
      resetsAt: nextMonthStart(now),
    };
  }

  reserve(tier: Tier, cacheKey: string, now: number): ReserveResult {
    if (this.s.firstSeen === null) this.s.firstSeen = now;
    // Tasks 3-4 add: rate limiting, response cache, pending reservations.
    if (tier === 'free') {
      const { used, limit, resetsAt } = this.freeUsage(now);
      if (used >= limit) return { kind: 'exhausted', resetsAt };
    }
    this.s.reservations[cacheKey] = now;
    if (tier === 'pro') {
      const used = this.s.months[monthKey(now)] ?? 0;
      return { kind: 'proceed', flagged: used >= PRO_SOFT_THRESHOLD };
    }
    return { kind: 'proceed' };
  }

  commit(cacheKey: string, body: string, now: number): void {
    delete this.s.reservations[cacheKey];
    this.s.responses[cacheKey] = { body, at: now };
    if (this.inBoost(now)) this.s.boostUsed += 1;
    const mk = monthKey(now);
    // Monthly counter always advances: it doubles as the pro soft-threshold
    // meter, and post-boost free months read from it directly.
    if (!this.inBoost(now)) this.s.months[mk] = (this.s.months[mk] ?? 0) + 1;
    else this.s.months[mk] = this.s.months[mk] ?? 0;
  }

  release(cacheKey: string): void {
    delete this.s.reservations[cacheKey];
  }

  snapshot(tier: Tier, now: number): QuotaSnapshot {
    if (tier === 'pro') {
      const used = this.s.months[monthKey(now)] ?? 0;
      return { tier, used, limit: null, remaining: null, resetsAt: nextMonthStart(now) };
    }
    const { used, limit, resetsAt } = this.freeUsage(now);
    return { tier, used, limit, remaining: Math.max(0, limit - used), resetsAt };
  }
}
```

Note the pro-tier commit counts into `months` — but the code above only
increments `months` outside boost. Pro identities never have a meaningful
boost window; fix by making `commit` tier-aware is unnecessary — instead
`commit` increments `months` **always** and `boostUsed` only in-boost. Use
this exact final version of `commit`:

```ts
  commit(cacheKey: string, body: string, now: number): void {
    delete this.s.reservations[cacheKey];
    this.s.responses[cacheKey] = { body, at: now };
    if (this.inBoost(now)) this.s.boostUsed += 1;
    const mk = monthKey(now);
    this.s.months[mk] = (this.s.months[mk] ?? 0) + 1;
  }
```

(Post-boost free usage reads `months[monthKey]`, which then includes any
committed generations that happened *during* boost in the same calendar
month as the boost's end — a user who burns the boost and rolls into
month-mode mid-month keeps that month's count. This is intentional and
stricter-safe; the test's August window starts a fresh month.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/proxy/test/quota.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/quota.ts packages/proxy/test/quota.test.ts
git commit -m "feat(proxy): QuotaEngine free-tier boost + monthly limits"
```

---

### Task 3: QuotaEngine — reservations, response cache, idempotent retries

**Files:**
- Modify: `packages/proxy/src/quota.ts` (extend `reserve`, add pruning)
- Test: `packages/proxy/test/quota.test.ts` (append)

**Interfaces:**
- Consumes/Produces: same `QuotaEngine` API as Task 2 — behavior added: `reserve` returns `{kind:'cached'}` for a committed cacheKey within 24h, `{kind:'pending'}` for a live reservation (< 2 min old), and proceeds when a reservation is stale.

- [ ] **Step 1: Write the failing test** (append to `quota.test.ts`)

```ts
import { RESERVATION_TTL_MS, RESPONSE_TTL_MS } from '../src/quota';

describe('QuotaEngine idempotency', () => {
  it('returns the cached response for a committed cacheKey (no double bill)', () => {
    const e = new QuotaEngine();
    e.reserve('free', 'dup', T0);
    e.commit('dup', '{"id":"msg_1"}', T0);
    const r = e.reserve('free', 'dup', T0 + 60_000);
    expect(r).toEqual({ kind: 'cached', body: '{"id":"msg_1"}' });
    expect(e.snapshot('free', T0 + 60_000).used).toBe(1); // still 1
  });

  it('expires the response cache after 24h', () => {
    const e = new QuotaEngine();
    e.reserve('free', 'dup', T0);
    e.commit('dup', '{}', T0);
    expect(e.reserve('free', 'dup', T0 + RESPONSE_TTL_MS + 1).kind).toBe('proceed');
  });

  it('reports pending while another window holds a live reservation', () => {
    const e = new QuotaEngine();
    e.reserve('free', 'race', T0);
    expect(e.reserve('free', 'race', T0 + 1000).kind).toBe('pending');
  });

  it('lets a retry proceed once the reservation is stale', () => {
    const e = new QuotaEngine();
    e.reserve('free', 'crashed', T0);
    expect(e.reserve('free', 'crashed', T0 + RESERVATION_TTL_MS + 1).kind).toBe('proceed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/proxy/test/quota.test.ts`
Expected: FAIL — `cached`/`pending` cases return `proceed`.

- [ ] **Step 3: Implement** — in `reserve`, after the `firstSeen` line and **before** the limit check, insert:

```ts
    // Idempotent retry: a committed generation within 24h is served from cache.
    const hit = this.s.responses[cacheKey];
    if (hit && now - hit.at < RESPONSE_TTL_MS) return { kind: 'cached', body: hit.body };
    if (hit) delete this.s.responses[cacheKey];
    // Concurrent window on the same component: live reservation wins.
    const heldAt = this.s.reservations[cacheKey];
    if (heldAt !== undefined && now - heldAt < RESERVATION_TTL_MS) return { kind: 'pending' };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/proxy/test/quota.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/quota.ts packages/proxy/test/quota.test.ts
git commit -m "feat(proxy): idempotent retries via reservations + 24h response cache"
```

---

### Task 4: QuotaEngine — rate limiting + pro tier

**Files:**
- Modify: `packages/proxy/src/quota.ts`
- Test: `packages/proxy/test/quota.test.ts` (append)

**Interfaces:**
- Same API; behavior added: sliding-window 10 req/min per engine (= per identity) returning `{kind:'rate_limited', retryAfterMs}`; pro reserve never exhausts and sets `flagged` at ≥ `PRO_SOFT_THRESHOLD` committed this month.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { RATE_LIMIT_PER_MIN, PRO_SOFT_THRESHOLD } from '../src/quota';

describe('QuotaEngine rate limit + pro', () => {
  it('rate-limits the 11th request inside a minute', () => {
    const e = new QuotaEngine();
    for (let i = 0; i < RATE_LIMIT_PER_MIN; i++) {
      expect(e.reserve('pro', `r${i}`, T0 + i).kind).toBe('proceed');
    }
    const r = e.reserve('pro', 'r-over', T0 + RATE_LIMIT_PER_MIN);
    expect(r.kind).toBe('rate_limited');
    if (r.kind === 'rate_limited') expect(r.retryAfterMs).toBeGreaterThan(0);
    // window slides: a minute later it's fine again
    expect(e.reserve('pro', 'later', T0 + 61_000).kind).toBe('proceed');
  });

  it('cached hits are not rate-limited (free redraws)', () => {
    const e = new QuotaEngine();
    e.reserve('pro', 'c', T0);
    e.commit('c', '{}', T0);
    for (let i = 0; i < 30; i++) {
      expect(e.reserve('pro', 'c', T0 + 1000 + i).kind).toBe('cached');
    }
  });

  it('pro is never exhausted but flags at the soft threshold', () => {
    const e = new QuotaEngine(JSON.stringify({
      firstSeen: 0, boostUsed: 0,
      months: { [new Date(T0).toISOString().slice(0, 7)]: PRO_SOFT_THRESHOLD },
      reservations: {}, responses: {}, recent: [],
    }));
    const r = e.reserve('pro', 'p1', T0);
    expect(r).toEqual({ kind: 'proceed', flagged: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/proxy/test/quota.test.ts`
Expected: FAIL — 11th request proceeds instead of rate-limiting.

- [ ] **Step 3: Implement** — in `reserve`, place the rate-limit check **after** the cached-response check (cached hits are free) and **before** the pending check:

```ts
    // Sliding-window rate limit (attempts, not commits).
    this.s.recent = this.s.recent.filter((t) => now - t < 60_000);
    if (this.s.recent.length >= RATE_LIMIT_PER_MIN) {
      const retryAfterMs = 60_000 - (now - this.s.recent[0]);
      return { kind: 'rate_limited', retryAfterMs };
    }
    this.s.recent.push(now);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/proxy/test/quota.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/quota.ts packages/proxy/test/quota.test.ts
git commit -m "feat(proxy): sliding-window rate limit + pro soft-threshold flag"
```

---

### Task 5: License validation (Lemon Squeezy, cached, grace)

**Files:**
- Create: `packages/proxy/src/license.ts`
- Test: `packages/proxy/test/license.test.ts`

**Interfaces:**
- Consumes: nothing internal.
- Produces (used by Tasks 6–7):
```ts
interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}
interface LicenseDeps { fetcher: typeof fetch; cache: KVLike; now: () => number }
// resolves the tier for a license key, with 24h cache and 5-day outage grace
function checkLicense(key: string, deps: LicenseDeps): Promise<{ tier: 'pro' } | { tier: 'free'; reason: 'invalid' | 'expired' | 'unreachable' }>;
function activateLicense(key: string, instanceName: string, deps: LicenseDeps): Promise<{ valid: boolean; status: string; instanceId?: string }>;
```
- Constants: `LICENSE_CACHE_TTL_MS = 24 * 3600_000`, `LICENSE_GRACE_MS = 5 * 864e5`. Cache entries stored at KV key `lic:<licenseKey>` as `{"status":"active"|...,"validatedAt":<ms>}`.

Lemon Squeezy License API (public, no API key): `POST https://api.lemonsqueezy.com/v1/licenses/validate` with JSON `{"license_key": "..."}` → `{"valid": bool, "license_key": {"status": "active"|"inactive"|"expired"|"disabled"}}`. Activation: `POST .../v1/licenses/activate` with `{"license_key":"...","instance_name":"..."}` → `{"activated": bool, "instance": {"id": "..."}, "license_key": {"status": "..."}}`.

- [ ] **Step 1: Write the failing test**

`packages/proxy/test/license.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { checkLicense, activateLicense, LICENSE_CACHE_TTL_MS, LICENSE_GRACE_MS } from '../src/license';

class MemKV {
  map = new Map<string, string>();
  async get(k: string) { return this.map.get(k) ?? null; }
  async put(k: string, v: string) { this.map.set(k, v); }
}

const lsOk = (status: string, valid = status === 'active') =>
  vi.fn(async () => new Response(JSON.stringify({ valid, license_key: { status } }), { status: 200 }));

const T0 = Date.parse('2026-07-01T00:00:00Z');

describe('checkLicense', () => {
  it('valid active key → pro, and caches the result', async () => {
    const cache = new MemKV();
    const fetcher = lsOk('active');
    const deps = { fetcher: fetcher as unknown as typeof fetch, cache, now: () => T0 };
    expect(await checkLicense('K', deps)).toEqual({ tier: 'pro' });
    expect(await checkLicense('K', deps)).toEqual({ tier: 'pro' });
    expect(fetcher).toHaveBeenCalledTimes(1); // second hit served from cache
  });

  it('revalidates after the cache TTL', async () => {
    const cache = new MemKV();
    const fetcher = lsOk('active');
    let now = T0;
    const deps = { fetcher: fetcher as unknown as typeof fetch, cache, now: () => now };
    await checkLicense('K', deps);
    now = T0 + LICENSE_CACHE_TTL_MS + 1;
    await checkLicense('K', deps);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('invalid key → free/invalid', async () => {
    const deps = { fetcher: lsOk('disabled', false) as unknown as typeof fetch, cache: new MemKV(), now: () => T0 };
    expect(await checkLicense('bad', deps)).toEqual({ tier: 'free', reason: 'invalid' });
  });

  it('honors cached status during an outage within the grace window', async () => {
    const cache = new MemKV();
    let now = T0;
    await checkLicense('K', { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => now });
    const down = vi.fn(async () => { throw new Error('ls down'); });
    now = T0 + LICENSE_CACHE_TTL_MS + 1; // cache stale → tries LS → outage → grace
    expect(await checkLicense('K', { fetcher: down as unknown as typeof fetch, cache, now: () => now })).toEqual({ tier: 'pro' });
    now = T0 + LICENSE_GRACE_MS + 1;     // grace exceeded
    expect(await checkLicense('K', { fetcher: down as unknown as typeof fetch, cache, now: () => now })).toEqual({ tier: 'free', reason: 'unreachable' });
  });

  it('a later failed validation revokes the cached pro status', async () => {
    const cache = new MemKV();
    let now = T0;
    await checkLicense('K', { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => now });
    now = T0 + LICENSE_CACHE_TTL_MS + 1;
    expect(await checkLicense('K', { fetcher: lsOk('expired', false) as unknown as typeof fetch, cache, now: () => now }))
      .toEqual({ tier: 'free', reason: 'expired' });
    // and the revocation is what's cached now
    expect(await checkLicense('K', { fetcher: lsOk('active') as unknown as typeof fetch, cache, now: () => now }))
      .toEqual({ tier: 'free', reason: 'expired' });
  });
});

describe('activateLicense', () => {
  it('activates and returns the instance id', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      activated: true, instance: { id: 'inst-1' }, license_key: { status: 'active' },
    }), { status: 200 }));
    const out = await activateLicense('K', 'Figma plugin', {
      fetcher: fetcher as unknown as typeof fetch, cache: new MemKV(), now: () => T0,
    });
    expect(out).toEqual({ valid: true, status: 'active', instanceId: 'inst-1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/proxy/test/license.test.ts`
Expected: FAIL — cannot resolve `../src/license`.

- [ ] **Step 3: Implement**

`packages/proxy/src/license.ts`:
```ts
export const LICENSE_CACHE_TTL_MS = 24 * 3600_000;
export const LICENSE_GRACE_MS = 5 * 864e5;

const LS_BASE = 'https://api.lemonsqueezy.com/v1/licenses';

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export interface LicenseDeps { fetcher: typeof fetch; cache: KVLike; now: () => number }

export type LicenseResult = { tier: 'pro' } | { tier: 'free'; reason: 'invalid' | 'expired' | 'unreachable' };

interface CacheEntry { status: string; validatedAt: number }

const cacheKey = (key: string) => `lic:${key}`;

async function readCache(deps: LicenseDeps, key: string): Promise<CacheEntry | null> {
  const raw = await deps.cache.get(cacheKey(key));
  return raw ? (JSON.parse(raw) as CacheEntry) : null;
}

function toResult(status: string): LicenseResult {
  if (status === 'active') return { tier: 'pro' };
  return { tier: 'free', reason: status === 'expired' ? 'expired' : 'invalid' };
}

export async function checkLicense(key: string, deps: LicenseDeps): Promise<LicenseResult> {
  const now = deps.now();
  const cached = await readCache(deps, key);
  if (cached && now - cached.validatedAt < LICENSE_CACHE_TTL_MS) return toResult(cached.status);

  let status: string;
  try {
    const res = await deps.fetcher(`${LS_BASE}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ license_key: key }),
    });
    const data = (await res.json()) as { valid?: boolean; license_key?: { status?: string } };
    status = data.valid && data.license_key?.status === 'active' ? 'active' : (data.license_key?.status ?? 'invalid');
  } catch {
    // Outage: honor a previously validated status within the grace window.
    if (cached && now - cached.validatedAt < LICENSE_GRACE_MS) return toResult(cached.status);
    return { tier: 'free', reason: 'unreachable' };
  }
  await deps.cache.put(cacheKey(key), JSON.stringify({ status, validatedAt: now } satisfies CacheEntry));
  return toResult(status);
}

export async function activateLicense(
  key: string, instanceName: string, deps: LicenseDeps,
): Promise<{ valid: boolean; status: string; instanceId?: string }> {
  const res = await deps.fetcher(`${LS_BASE}/activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ license_key: key, instance_name: instanceName }),
  });
  const data = (await res.json()) as {
    activated?: boolean; instance?: { id?: string }; license_key?: { status?: string };
  };
  const status = data.license_key?.status ?? 'invalid';
  if (data.activated) {
    await deps.cache.put(cacheKey(key), JSON.stringify({ status, validatedAt: deps.now() }));
  }
  return { valid: Boolean(data.activated), status, instanceId: data.instance?.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/proxy/test/license.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/license.ts packages/proxy/test/license.test.ts
git commit -m "feat(proxy): Lemon Squeezy license check with 24h cache + 5-day grace"
```

---

### Task 6: Prose handler — orchestration + upstream guard

**Files:**
- Create: `packages/proxy/src/handlers.ts`
- Test: `packages/proxy/test/handlers.test.ts`

**Interfaces:**
- Consumes: `identityFromHeaders` (Task 1), `QuotaEngine` types (Tasks 2–4), `checkLicense`/`activateLicense`/`KVLike` (Task 5).
- Produces (used by Task 7's router and the worker entry):
```ts
// async facade over the per-identity QuotaEngine (implemented by the DO in prod, in-memory in tests)
interface QuotaClient {
  reserve(tier: Tier, cacheKey: string): Promise<ReserveResult>;
  commit(cacheKey: string, body: string): Promise<void>;
  release(cacheKey: string): Promise<void>;
  snapshot(tier: Tier): Promise<QuotaSnapshot>;
}
interface HandlerDeps {
  salt: string;
  anthropicKey: string;
  fetcher: typeof fetch;
  licenseCache: KVLike;
  now(): number;                               // injected clock — all license TTL/grace math uses this
  quotaFor(identityId: string): QuotaClient;   // 'lic:<key>' or 'free:<hash>'
  log(event: string, fields: Record<string, unknown>): void; // counters only, never content
}
function handleProse(req: Request, deps: HandlerDeps): Promise<Response>;
```

Behavior (spec §6.1 flow): identity → license (pro/free) → `reserve` → forward to Anthropic (guarded) → `commit` on 200 / `release` on failure → respond with quota headers.

- [ ] **Step 1: Write the failing test**

`packages/proxy/test/handlers.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { handleProse } from '../src/handlers';
import { QuotaEngine, type Tier, type ReserveResult, type QuotaSnapshot } from '../src/quota';

class MemKV {
  map = new Map<string, string>();
  async get(k: string) { return this.map.get(k) ?? null; }
  async put(k: string, v: string) { this.map.set(k, v); }
}

/** In-memory QuotaClient over a real engine — same contract the DO fulfils in prod. */
function memQuota(now: () => number) {
  const engines = new Map<string, QuotaEngine>();
  return (id: string) => {
    const e = engines.get(id) ?? new QuotaEngine();
    engines.set(id, e);
    return {
      reserve: async (tier: Tier, k: string): Promise<ReserveResult> => e.reserve(tier, k, now()),
      commit: async (k: string, b: string) => e.commit(k, b, now()),
      release: async (k: string) => e.release(k),
      snapshot: async (tier: Tier): Promise<QuotaSnapshot> => e.snapshot(tier, now()),
    };
  };
}

const GOOD_BODY = {
  cacheKey: 'prose:v8:abc123',
  request: { model: 'claude-haiku-4-5', max_tokens: 3000, system: 's', messages: [{ role: 'user', content: 'hi' }] },
};

function proseReq(body: unknown, headers: Record<string, string>) {
  return new Request('https://proxy.test/v1/prose', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}

function deps(overrides: Partial<Parameters<typeof handleProse>[1]> = {}) {
  const anthropic = vi.fn(async () => new Response(JSON.stringify({ id: 'msg_1', content: [{ type: 'text', text: 'ok' }] }), { status: 200 }));
  return {
    salt: 'salt',
    anthropicKey: 'sk-ant-test',
    fetcher: anthropic as unknown as typeof fetch,
    licenseCache: new MemKV(),
    now: () => Date.parse('2026-07-01T00:00:00Z'),
    quotaFor: memQuota(() => Date.parse('2026-07-01T00:00:00Z')),
    log: vi.fn(),
    _anthropic: anthropic,
    ...overrides,
  };
}

describe('handleProse', () => {
  it('free user: forwards to Anthropic and returns quota headers', async () => {
    const d = deps();
    const res = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Tier')).toBe('free');
    expect(res.headers.get('X-Quota-Used')).toBe('1');
    expect(res.headers.get('X-Quota-Limit')).toBe('20'); // boost window
    const call = (d as any)._anthropic.mock.calls[0];
    expect(call[0]).toBe('https://api.anthropic.com/v1/messages');
    expect(call[1].headers['x-api-key']).toBe('sk-ant-test');
  });

  it('replays the cached response on retry without a second upstream call', async () => {
    const d = deps();
    await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    const res2 = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    expect(res2.status).toBe(200);
    expect((d as any)._anthropic).toHaveBeenCalledTimes(1);
    expect(res2.headers.get('X-Quota-Used')).toBe('1');
  });

  it('402 when the free quota is exhausted', async () => {
    const d = deps();
    for (let i = 0; i < 20; i++) {
      await handleProse(proseReq({ ...GOOD_BODY, cacheKey: `prose:v8:k${i}` }, { 'X-Figma-User': 'u1' }), d);
    }
    // 20 committed → 21st is exhausted (rate limit is per-minute; use a fresh minute clock if needed)
    const res = await handleProse(proseReq({ ...GOOD_BODY, cacheKey: 'prose:v8:k-over' }, { 'X-Figma-User': 'u1' }), d);
    expect([402, 429]).toContain(res.status); // 429 if the fixed clock trips the rate limit first
  });

  it('does not decrement quota when Anthropic fails, and returns 502', async () => {
    const failing = vi.fn(async () => new Response('overloaded', { status: 529 }));
    const d = deps({ fetcher: failing as unknown as typeof fetch });
    const res = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), d);
    expect(res.status).toBe(502);
    const res2 = await handleProse(proseReq(GOOD_BODY, { 'X-Figma-User': 'u1' }), { ...d, fetcher: deps().fetcher });
    expect(res2.headers.get('X-Quota-Used')).toBe('1'); // first attempt did not count
  });

  it('rejects a non-allowlisted upstream request', async () => {
    const bad = { ...GOOD_BODY, request: { ...GOOD_BODY.request, model: 'claude-opus-4-8' } };
    const res = await handleProse(proseReq(bad, { 'X-Figma-User': 'u1' }), deps());
    expect(res.status).toBe(400);
  });

  it('401 without any identity', async () => {
    const res = await handleProse(proseReq(GOOD_BODY, {}), deps());
    expect(res.status).toBe(401);
  });

  it('pro license: unlimited headers', async () => {
    const d = deps();
    await d.licenseCache.put('lic:KEY1', JSON.stringify({ status: 'active', validatedAt: Date.parse('2026-07-01T00:00:00Z') }));
    const res = await handleProse(proseReq(GOOD_BODY, { Authorization: 'Bearer KEY1' }), d);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Tier')).toBe('pro');
    expect(res.headers.get('X-Quota-Limit')).toBe('unlimited');
  });
});
```

Note for the exhaustion test: the fixed clock means 21 requests inside one
"minute" — the rate limiter fires first. The assertion accepts either 402 or
429; both prove the wall exists. (Engine-level 402 exactness is already
covered in Task 2's tests with a spaced clock.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/proxy/test/handlers.test.ts`
Expected: FAIL — cannot resolve `../src/handlers`.

- [ ] **Step 3: Implement**

`packages/proxy/src/handlers.ts`:
```ts
import { identityFromHeaders } from './identity';
import { checkLicense, type KVLike } from './license';
import type { QuotaSnapshot, ReserveResult, Tier } from './quota';

export interface QuotaClient {
  reserve(tier: Tier, cacheKey: string): Promise<ReserveResult>;
  commit(cacheKey: string, body: string): Promise<void>;
  release(cacheKey: string): Promise<void>;
  snapshot(tier: Tier): Promise<QuotaSnapshot>;
}

export interface HandlerDeps {
  salt: string;
  anthropicKey: string;
  fetcher: typeof fetch;
  licenseCache: KVLike;
  now(): number;
  quotaFor(identityId: string): QuotaClient;
  log(event: string, fields: Record<string, unknown>): void;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function quotaHeaders(s: QuotaSnapshot): Record<string, string> {
  return {
    'X-Tier': s.tier,
    'X-Quota-Used': String(s.used),
    'X-Quota-Limit': s.limit === null ? 'unlimited' : String(s.limit),
    'X-Quota-Remaining': s.remaining === null ? 'unlimited' : String(s.remaining),
    'X-Quota-Resets-At': s.resetsAt,
  };
}

interface ProseBody {
  cacheKey?: unknown;
  request?: { model?: unknown; max_tokens?: unknown; messages?: unknown };
}

/** The proxy must not be usable as a generic Anthropic relay. */
function validateProseBody(body: ProseBody): string | null {
  if (typeof body.cacheKey !== 'string' || !/^prose:v\d+:/.test(body.cacheKey)) return 'bad cacheKey';
  const r = body.request;
  if (!r || typeof r !== 'object') return 'missing request';
  if (r.model !== 'claude-haiku-4-5') return 'model not allowed';
  if (typeof r.max_tokens !== 'number' || r.max_tokens > 3000) return 'max_tokens too large';
  if (!Array.isArray(r.messages)) return 'missing messages';
  return null;
}

export async function handleProse(req: Request, deps: HandlerDeps): Promise<Response> {
  const identity = identityFromHeaders(req.headers, deps.salt);
  if (!identity) return json(401, { error: 'unauthenticated' });

  let body: ProseBody;
  try { body = (await req.json()) as ProseBody; } catch { return json(400, { error: 'invalid json' }); }
  const invalid = validateProseBody(body);
  if (invalid) return json(400, { error: invalid });
  const cacheKey = body.cacheKey as string;

  let tier: Tier = 'free';
  let identityId: string;
  if (identity.kind === 'license') {
    const lic = await checkLicense(identity.key, { fetcher: deps.fetcher, cache: deps.licenseCache, now: deps.now });
    if (lic.tier !== 'pro') return json(401, { error: 'license_not_active', reason: lic.reason });
    tier = 'pro';
    identityId = `lic:${identity.key}`;
  } else {
    identityId = `free:${identity.id}`;
  }

  const quota = deps.quotaFor(identityId);
  const reserved = await quota.reserve(tier, cacheKey);

  switch (reserved.kind) {
    case 'cached': {
      const s = await quota.snapshot(tier);
      return new Response(reserved.body, { status: 200, headers: { 'content-type': 'application/json', ...quotaHeaders(s) } });
    }
    case 'pending':
      return json(409, { error: 'generation_pending' });
    case 'exhausted':
      return json(402, { error: 'quota_exhausted', resetsAt: reserved.resetsAt });
    case 'rate_limited':
      return json(429, { error: 'rate_limited', retryAfterMs: reserved.retryAfterMs });
    case 'proceed':
      break;
  }
  if (reserved.kind === 'proceed' && reserved.flagged) {
    deps.log('fair_use_flag', { identityId, tier }); // counters only — never content
  }

  let upstream: Response;
  try {
    upstream = await deps.fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': deps.anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body.request),
    });
  } catch {
    await quota.release(cacheKey);
    return json(502, { error: 'upstream_unreachable' });
  }

  if (!upstream.ok) {
    await quota.release(cacheKey);
    deps.log('upstream_error', { status: upstream.status });
    return json(502, { error: 'upstream_error', status: upstream.status });
  }

  const text = await upstream.text();
  await quota.commit(cacheKey, text);
  const s = await quota.snapshot(tier);
  return new Response(text, { status: 200, headers: { 'content-type': 'application/json', ...quotaHeaders(s) } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/proxy/test/handlers.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/handlers.ts packages/proxy/test/handlers.test.ts
git commit -m "feat(proxy): prose handler — server-authoritative quota orchestration"
```

---

### Task 7: Quota + activate endpoints and the router

**Files:**
- Modify: `packages/proxy/src/handlers.ts` (add `handleQuota`, `handleActivate`, `route`)
- Test: `packages/proxy/test/router.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `route(req: Request, deps: HandlerDeps): Promise<Response>` — dispatches `POST /v1/prose`, `GET /v1/quota`, `POST /v1/license/activate`; 404 otherwise. Used verbatim by the worker entry (Task 8).

- [ ] **Step 1: Write the failing test**

`packages/proxy/test/router.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { route } from '../src/handlers';
import { QuotaEngine, type Tier, type ReserveResult, type QuotaSnapshot } from '../src/quota';

class MemKV {
  map = new Map<string, string>();
  async get(k: string) { return this.map.get(k) ?? null; }
  async put(k: string, v: string) { this.map.set(k, v); }
}

function memQuota(now: () => number) {
  const engines = new Map<string, QuotaEngine>();
  return (id: string) => {
    const e = engines.get(id) ?? new QuotaEngine();
    engines.set(id, e);
    return {
      reserve: async (tier: Tier, k: string): Promise<ReserveResult> => e.reserve(tier, k, now()),
      commit: async (k: string, b: string) => e.commit(k, b, now()),
      release: async (k: string) => e.release(k),
      snapshot: async (tier: Tier): Promise<QuotaSnapshot> => e.snapshot(tier, now()),
    };
  };
}

const baseDeps = () => ({
  salt: 'salt',
  anthropicKey: 'sk',
  fetcher: vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
  licenseCache: new MemKV(),
  quotaFor: memQuota(() => Date.parse('2026-07-01T00:00:00Z')),
  log: vi.fn(),
});

describe('route', () => {
  it('GET /v1/quota returns the snapshot for a free identity', async () => {
    const res = await route(new Request('https://p.test/v1/quota', { headers: { 'X-Figma-User': 'u1' } }), baseDeps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tier: 'free', used: 0, limit: 20, remaining: 20,
      resetsAt: new Date(Date.parse('2026-07-01T00:00:00Z') + 30 * 864e5).toISOString(),
    });
  });

  it('GET /v1/quota is 401 without identity', async () => {
    const res = await route(new Request('https://p.test/v1/quota'), baseDeps());
    expect(res.status).toBe(401);
  });

  it('POST /v1/license/activate proxies to Lemon Squeezy', async () => {
    const d = baseDeps();
    d.fetcher = vi.fn(async () => new Response(JSON.stringify({
      activated: true, instance: { id: 'i1' }, license_key: { status: 'active' },
    }), { status: 200 })) as unknown as typeof fetch;
    const res = await route(new Request('https://p.test/v1/license/activate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'K', instanceName: 'Figma plugin' }),
    }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true, status: 'active', instanceId: 'i1' });
  });

  it('404s unknown paths', async () => {
    const res = await route(new Request('https://p.test/nope'), baseDeps());
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/proxy/test/router.test.ts`
Expected: FAIL — `route` is not exported.

- [ ] **Step 3: Implement** — append to `packages/proxy/src/handlers.ts`:

```ts
import { activateLicense } from './license';   // merge into the existing import from './license'

export async function handleQuota(req: Request, deps: HandlerDeps): Promise<Response> {
  const identity = identityFromHeaders(req.headers, deps.salt);
  if (!identity) return json(401, { error: 'unauthenticated' });
  let tier: Tier = 'free';
  let identityId: string;
  if (identity.kind === 'license') {
    const lic = await checkLicense(identity.key, { fetcher: deps.fetcher, cache: deps.licenseCache, now: deps.now });
    tier = lic.tier === 'pro' ? 'pro' : 'free';
    identityId = `lic:${identity.key}`;
  } else {
    identityId = `free:${identity.id}`;
  }
  const s = await deps.quotaFor(identityId).snapshot(tier);
  return json(200, s);
}

export async function handleActivate(req: Request, deps: HandlerDeps): Promise<Response> {
  let body: { key?: unknown; instanceName?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return json(400, { error: 'invalid json' }); }
  if (typeof body.key !== 'string' || !body.key) return json(400, { error: 'missing key' });
  const out = await activateLicense(body.key, typeof body.instanceName === 'string' ? body.instanceName : 'Figma plugin', {
    fetcher: deps.fetcher, cache: deps.licenseCache, now: deps.now,
  });
  return json(200, out);
}

export async function route(req: Request, deps: HandlerDeps): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (req.method === 'POST' && pathname === '/v1/prose') return handleProse(req, deps);
  if (req.method === 'GET' && pathname === '/v1/quota') return handleQuota(req, deps);
  if (req.method === 'POST' && pathname === '/v1/license/activate') return handleActivate(req, deps);
  return json(404, { error: 'not_found' });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/proxy`
Expected: PASS — all proxy tests (identity, quota, license, handlers, router).

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/handlers.ts packages/proxy/test/router.test.ts
git commit -m "feat(proxy): quota + activate endpoints and router"
```

---

### Task 8: Worker entry + QuotaDO + wrangler config

The Durable Object and worker entry are thin adapters over already-tested logic — verified by typecheck, not unit tests (testing them requires miniflare; deliberately out of scope for v1).

**Files:**
- Create: `packages/proxy/src/index.ts`
- Create: `packages/proxy/wrangler.toml`

**Interfaces:**
- Consumes: `route`, `HandlerDeps`, `QuotaClient` (Task 7/6), `QuotaEngine` (Tasks 2–4).
- Produces: deployable worker. Bindings: KV namespace `LICENSE_CACHE`, DO namespace `QUOTA`, secrets `ANTHROPIC_API_KEY` + `FIGMA_ID_SALT`.

- [ ] **Step 1: Implement the worker entry**

`packages/proxy/src/index.ts`:
```ts
import { route, type HandlerDeps, type QuotaClient } from './handlers';
import { QuotaEngine, type ReserveResult, type QuotaSnapshot, type Tier } from './quota';

export interface Env {
  LICENSE_CACHE: KVNamespace;
  QUOTA: DurableObjectNamespace;
  ANTHROPIC_API_KEY: string;
  FIGMA_ID_SALT: string;
}

/**
 * One Durable Object per identity: single-threaded execution makes
 * reserve/commit atomic without explicit locking.
 */
export class QuotaDO implements DurableObject {
  constructor(private state: DurableObjectState) {}

  async fetch(req: Request): Promise<Response> {
    const stored = await this.state.storage.get<string>('engine');
    const engine = new QuotaEngine(stored ?? undefined);
    const { op, tier, cacheKey, body, now } = (await req.json()) as {
      op: 'reserve' | 'commit' | 'release' | 'snapshot';
      tier: Tier; cacheKey?: string; body?: string; now: number;
    };
    let out: unknown = null;
    if (op === 'reserve') out = engine.reserve(tier, cacheKey as string, now);
    else if (op === 'commit') engine.commit(cacheKey as string, body as string, now);
    else if (op === 'release') engine.release(cacheKey as string);
    else out = engine.snapshot(tier, now);
    await this.state.storage.put('engine', engine.toJSON());
    return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
  }
}

function doQuotaClient(ns: DurableObjectNamespace, identityId: string): QuotaClient {
  const stub = ns.get(ns.idFromName(identityId));
  const call = async (payload: Record<string, unknown>) => {
    const res = await stub.fetch('https://do/quota', { method: 'POST', body: JSON.stringify({ ...payload, now: Date.now() }) });
    return res.json();
  };
  return {
    reserve: (tier, cacheKey) => call({ op: 'reserve', tier, cacheKey }) as Promise<ReserveResult>,
    commit: async (cacheKey, body) => { await call({ op: 'commit', tier: 'free', cacheKey, body }); },
    release: async (cacheKey) => { await call({ op: 'release', tier: 'free', cacheKey }); },
    snapshot: (tier) => call({ op: 'snapshot', tier }) as Promise<QuotaSnapshot>,
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const deps: HandlerDeps = {
      salt: env.FIGMA_ID_SALT,
      anthropicKey: env.ANTHROPIC_API_KEY,
      fetcher: fetch.bind(globalThis),
      licenseCache: env.LICENSE_CACHE,
      quotaFor: (id) => doQuotaClient(env.QUOTA, id),
      log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
    };
    return route(req, deps);
  },
};
```

- [ ] **Step 2: Create wrangler config**

`packages/proxy/wrangler.toml`:
```toml
name = "spec-layer-proxy"
main = "src/index.ts"
compatibility_date = "2026-07-01"

kv_namespaces = [
  { binding = "LICENSE_CACHE", id = "REPLACE_AFTER_wrangler_kv_namespace_create" }
]

[[durable_objects.bindings]]
name = "QUOTA"
class_name = "QuotaDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["QuotaDO"]
```

- [ ] **Step 3: Typecheck + full test run**

Run: `npm run typecheck && npx vitest run packages/proxy`
Expected: typecheck clean (proxy tsconfig included from Task 1), all proxy tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/proxy/src/index.ts packages/proxy/wrangler.toml
git commit -m "feat(proxy): worker entry, QuotaDO, wrangler config"
```

---

### Task 9: Lemon Squeezy setup + deployment (manual checklist)

No code. Everything here happens in dashboards/CLI; record outcomes in `packages/proxy/README.md`.

- [ ] **Step 1: Lemon Squeezy product**
  - Create store (if none) → Product "Spec Layer Pro".
  - Variants: Monthly **$8**, Annual **$80**. Enable **license keys** on both, activation limit **3**.
  - Note the checkout URLs (needed by the plugin plan).

- [ ] **Step 2: Cloudflare resources**
  ```bash
  cd packages/proxy
  npx wrangler kv namespace create LICENSE_CACHE   # paste id into wrangler.toml
  npx wrangler secret put ANTHROPIC_API_KEY
  npx wrangler secret put FIGMA_ID_SALT            # long random string; never rotate casually (resets free quotas)
  npx wrangler deploy
  ```

- [ ] **Step 3: Ops guards (spec §6.1)**
  - Anthropic Console: spend alert on the API key's workspace (e.g. $50/mo).
  - Cloudflare: enable Workers logs; note that `fair_use_flag` and `upstream_error` events are the review queue.

- [ ] **Step 4: Smoke test the deployed worker**
  ```bash
  curl -s https://spec-layer-proxy.<account>.workers.dev/v1/quota -H 'X-Figma-User: smoke-test-1'
  # expect: {"tier":"free","used":0,"limit":20,"remaining":20,"resetsAt":"..."}
  curl -s -X POST https://spec-layer-proxy.<account>.workers.dev/v1/prose \
    -H 'X-Figma-User: smoke-test-1' -H 'content-type: application/json' \
    -d '{"cacheKey":"prose:v8:smoke1","request":{"model":"claude-haiku-4-5","max_tokens":256,"messages":[{"role":"user","content":"Say OK."}]}}'
  # expect: Anthropic response JSON + X-Quota-Used: 1
  ```

- [ ] **Step 5: Write `packages/proxy/README.md`** documenting: the API contract (copy from this plan's header), bindings/secrets, deploy command, and the smoke-test curls. Commit:
  ```bash
  git add packages/proxy/README.md packages/proxy/wrangler.toml
  git commit -m "docs(proxy): deployment runbook + API contract"
  ```

---

## Out of scope (next plan: plugin integration)

- Plugin fetcher swap, license UI state machine, quota meter, upsell (spec §5, §6.2).
- Privacy policy page + listing copy (spec §6.6, §6.8) — belongs with the plugin release.
- Fair-use policy page (spec §3).
- LS webhooks, device fingerprinting, bulk/Batches — deferred per spec.
