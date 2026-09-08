# Free Publish Quota Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let free plans publish one library with 10 changed publishes per month, while Pro keeps 10 libraries with no fixed cap, and let ownership be proved by either the license key or the Figma identity so upgrading and lapsing need no migration.

**Architecture:** The proxy (`packages/proxy`) gains a second reading of the auth headers that returns every proof a caller carries, a tier-aware library limit, and a second `QuotaEngine` profile that counts publishes under a `publish:` Durable Object name with idempotency on the bundle hash. The plugin (`packages/plugin`) sends both headers when it has both, deletes the paywall from the publish screen, shows an updates meter from the quota response, and maps the new 402 and 403 bodies to result lines. The website and repository docs update the promises.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers (Durable Objects, KV), esbuild, npm workspaces, Node >= 22. No framework.

**Spec:** `docs/superpowers/specs/2026-09-08-free-publish-quota-design.md`.

## Global Constraints

- Never fabricate. Unknown is `null`, absent, or a stated diagnostic. `existing.fileName` in the 403 body is the stored meta value and may be `null`.
- Plugin UI copy: sentence case, second person, no em dashes, no hype words. Rules in `docs/plugin-voice-and-copy.md`. User-facing counts say "Figma file" and "update"; code, CLI, and developer docs keep "library".
- Exact free limits: 1 library, 10 updates per UTC calendar month, no boost window. Pro: 10 libraries, no fixed update cap, `fair_use_flag` at `PRO_SOFT_THRESHOLD`.
- Only a committed KV write counts. An unchanged republish (same bundle hash within the 24-hour response TTL) never counts and never writes.
- Pull (`GET /v1/libraries/:id`) does not change in any way.
- The AI quota path keeps "license wins": `identityFromHeaders` and every existing test for it stay as they are.
- No stored KV record changes shape. `LibraryMeta.licenseId` keeps its name; its value is an identity id (`lic:...` or `free:...`).
- The proxy deploys before the plugin. A plugin build that sends only a bearer must keep working at every step.
- `npm run check:nul` guards `packages/`, `apps/`, and `docs/`. Never write NUL bytes.
- Single-line conventional commits, lowercase, scoped. Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` on its own line.
- Work on the branch `spec/free-publish-quota` (it already holds the spec). Do not push to `main`.
- The working tree carries uncommitted website cleanup from another session in `apps/website/**` and `CLAUDE.md`. Do not revert, stage, or commit those files except for the exact string edits Task 12 names. Stage files by path, never `git add -A`.

## File map

| File | Change |
|---|---|
| `packages/proxy/src/identity.ts` | Add `callerProofs()` returning every proof in the headers. |
| `packages/proxy/src/quota.ts` | Add `QuotaLimits`, `QUOTA_PROFILES`, optional boost; constructor takes limits. |
| `packages/proxy/src/handlers.ts` | `quotaFor(id, profile)`; publish snapshot on `/v1/quota`; export `QuotaProfile`. |
| `packages/proxy/src/index.ts` | DO payload carries `profile`; client passes it. |
| `packages/proxy/src/libraries.ts` | Proved ownership, per-tier limits, publish quota, new errors and headers. |
| `packages/proxy/README.md` | Document the new contract. |
| `packages/proxy/test/identity.test.ts` | `callerProofs` cases. |
| `packages/proxy/test/quota.test.ts` | Publish profile cases. |
| `packages/proxy/test/libraries.test.ts` | Free publish, ownership, limits, idempotency, headers. |
| `packages/proxy/test/router.test.ts` | `publish` snapshot on `/v1/quota`. |
| `packages/proxy/test/handlers.test.ts` | `memQuota` accepts a profile. |
| `packages/extractor/src/prose/client.ts` | `ProxyQuota.publish?` field. |
| `packages/plugin/src/ui/proxy.ts` | `authHeaders` sends both; add `publishAuth()`. |
| `packages/plugin/src/ui/viewModel/allowance.ts` | Delete `publishLocked`; add `publishAllowance()` and `publishAllowanceCopy()`. |
| `packages/plugin/src/ui/publish.ts` | New outcomes `unchanged`, `exhausted`, `limit`; new copy; drop Pro strings. |
| `packages/plugin/src/ui/screens/publish.ts` | Remove paywall, add definition line and updates line. |
| `packages/plugin/src/ui/screens/license.ts` | Pro detail line copy. |
| `packages/plugin/src/ui/ui-vnext.ts` | Use `publishAuth` for publish and rotate; pass allowance to the screen. |
| `packages/plugin/test/proxy.test.ts`, `allowance.test.ts`, `publish.test.ts`, `publishScreen.test.ts`, `licenseScreen.test.ts` | Updated and new cases. |
| `packages/plugin/TESTING.md` | Replace the "Free license" row; add a free publish-and-pull row. |
| `apps/website/content/index.html`, `apps/website/content/docs/quickstart.html` | Pricing, workflow, FAQ, notice copy. |
| `docs/superpowers/specs/2026-07-11-freemium-model-design.md` | Dated pointer note. |
| `CHANGELOG.md` | Proxy, plugin, website entries. |

## Verification commands

```bash
npx vitest run packages/proxy            # proxy suite
npx vitest run packages/plugin/test/<file>.test.ts
npm run typecheck
npm run lint
npm run check:nul
npm run check                            # full local gate, before the PR
npm run check --prefix apps/website      # after Task 12
```

---

### Task 1: `callerProofs` in the proxy identity module

**Files:**
- Modify: `packages/proxy/src/identity.ts`
- Test: `packages/proxy/test/identity.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CallerProofs {
    license: { key: string; instanceId: string | null } | null;
    figmaHash: string | null;
  }
  export function callerProofs(headers: Headers, salt: string): CallerProofs;
  ```
- `identityFromHeaders` is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `packages/proxy/test/identity.test.ts`, inside a new `describe`:

```ts
import { callerProofs } from '../src/identity';

describe('callerProofs', () => {
  it('returns both proofs when both headers are present', () => {
    const h = new Headers({ Authorization: 'Bearer KEY:inst-9', 'X-Figma-User': 'u1' });
    expect(callerProofs(h, 's')).toEqual({
      license: { key: 'KEY', instanceId: 'inst-9' },
      figmaHash: hashFigmaId('u1', 's'),
    });
  });

  it('returns only the license with a bare bearer', () => {
    expect(callerProofs(new Headers({ Authorization: 'Bearer KEY' }), 's'))
      .toEqual({ license: { key: 'KEY', instanceId: null }, figmaHash: null });
  });

  it('returns only the figma hash with no bearer', () => {
    expect(callerProofs(new Headers({ 'X-Figma-User': 'u1' }), 's'))
      .toEqual({ license: null, figmaHash: hashFigmaId('u1', 's') });
  });

  it('returns no proofs for empty headers', () => {
    expect(callerProofs(new Headers(), 's')).toEqual({ license: null, figmaHash: null });
    expect(callerProofs(new Headers({ Authorization: 'Bearer ', 'X-Figma-User': ' ' }), 's'))
      .toEqual({ license: null, figmaHash: null });
  });
});
```

Merge the import into the existing import line from `'../src/identity'`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/proxy/test/identity.test.ts`
Expected: FAIL, `callerProofs` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/proxy/src/identity.ts`:

```ts
export interface CallerProofs {
  license: { key: string; instanceId: string | null } | null;
  figmaHash: string | null;
}

/**
 * Every identity a request can prove, side by side. `identityFromHeaders`
 * picks one for AI metering; library ownership needs all of them, because a
 * library created on a free plan is owned by the Figma identity and the same
 * person later publishes with a license key.
 */
export function callerProofs(headers: Headers, salt: string): CallerProofs {
  const auth = headers.get('Authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  let license: CallerProofs['license'] = null;
  if (bearer) {
    const sep = bearer.indexOf(':');
    license = sep === -1
      ? { key: bearer, instanceId: null }
      : { key: bearer.slice(0, sep), instanceId: bearer.slice(sep + 1) || null };
  }
  const figma = (headers.get('X-Figma-User') ?? '').trim();
  return { license, figmaHash: figma ? hashFigmaId(figma, salt) : null };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/proxy/test/identity.test.ts`
Expected: PASS, all cases including the untouched `identity` block.

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/identity.ts packages/proxy/test/identity.test.ts
git commit -m "feat(proxy): read every identity proof a request carries

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Quota engine profiles

**Files:**
- Modify: `packages/proxy/src/quota.ts`
- Test: `packages/proxy/test/quota.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface QuotaLimits {
    /** null disables the first-sight boost window. */
    boostLimit: number | null;
    boostWindowMs: number;
    monthlyLimit: number;
  }
  export type QuotaProfile = 'ai' | 'publish';
  export const QUOTA_PROFILES: Record<QuotaProfile, QuotaLimits>;
  export const PUBLISH_MONTHLY_LIMIT = 10;
  // constructor(json?: string, limits: QuotaLimits = QUOTA_PROFILES.ai)
  ```
- The existing constants `BOOST_LIMIT`, `BOOST_WINDOW_MS`, `MONTHLY_LIMIT`, `PRO_SOFT_THRESHOLD`, `RATE_LIMIT_PER_MIN` stay exported with the same values.

- [ ] **Step 1: Write the failing tests**

Append to `packages/proxy/test/quota.test.ts`:

```ts
import { QUOTA_PROFILES, PUBLISH_MONTHLY_LIMIT } from '../src/quota';

describe('QuotaEngine publish profile', () => {
  it('has no boost window: the monthly limit applies from first sight', () => {
    const e = new QuotaEngine(undefined, QUOTA_PROFILES.publish);
    const snap = e.snapshot('free', T0);
    expect(snap.limit).toBe(PUBLISH_MONTHLY_LIMIT);
    expect(snap.resetsAt).toBe('2026-08-01T00:00:00.000Z');
    burn(e, PUBLISH_MONTHLY_LIMIT, T0, 'p');
    const r = e.reserve('free', 'p-over', T0 + PUBLISH_MONTHLY_LIMIT * 60_000);
    expect(r).toEqual({ kind: 'exhausted', resetsAt: '2026-08-01T00:00:00.000Z' });
  });

  it('resets on the next UTC month', () => {
    const e = new QuotaEngine(undefined, QUOTA_PROFILES.publish);
    burn(e, PUBLISH_MONTHLY_LIMIT, T0, 'p');
    const august = Date.parse('2026-08-01T00:00:00Z');
    expect(e.reserve('free', 'p-aug', august).kind).toBe('proceed');
  });

  it('rehydrates with the same profile', () => {
    const e = new QuotaEngine(undefined, QUOTA_PROFILES.publish);
    burn(e, 3, T0, 'p');
    const again = new QuotaEngine(e.toJSON(), QUOTA_PROFILES.publish);
    expect(again.snapshot('free', T0 + 3 * 60_000).used).toBe(3);
  });

  it('the ai profile is the default and keeps the boost window', () => {
    expect(QUOTA_PROFILES.ai).toEqual({ boostLimit: BOOST_LIMIT, boostWindowMs: BOOST_WINDOW_MS, monthlyLimit: MONTHLY_LIMIT });
    expect(new QuotaEngine().snapshot('free', T0).limit).toBe(BOOST_LIMIT);
  });
});
```

Merge the import into the existing import line from `'../src/quota'`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/proxy/test/quota.test.ts`
Expected: FAIL, `QUOTA_PROFILES` is not exported.

- [ ] **Step 3: Implement**

In `packages/proxy/src/quota.ts`, after the existing constants add:

```ts
export const PUBLISH_MONTHLY_LIMIT = 10;

export interface QuotaLimits {
  /** null disables the first-sight boost window. */
  boostLimit: number | null;
  boostWindowMs: number;
  monthlyLimit: number;
}

export type QuotaProfile = 'ai' | 'publish';

/**
 * Two things the engine counts, with different shapes. AI writing has a boost
 * because a new user tries many components at once. Publishing is a whole-file
 * action a few times a week, so a flat monthly number is the honest one.
 */
export const QUOTA_PROFILES: Record<QuotaProfile, QuotaLimits> = {
  ai: { boostLimit: BOOST_LIMIT, boostWindowMs: BOOST_WINDOW_MS, monthlyLimit: MONTHLY_LIMIT },
  publish: { boostLimit: null, boostWindowMs: 0, monthlyLimit: PUBLISH_MONTHLY_LIMIT },
};
```

Change the class:

```ts
export class QuotaEngine {
  private s: State;

  constructor(json?: string, private limits: QuotaLimits = QUOTA_PROFILES.ai) {
    this.s = json ? { ...fresh(), ...(JSON.parse(json) as State) } : fresh();
  }
```

Replace `inBoost` and `freeUsage`:

```ts
  private inBoost(now: number): boolean {
    if (this.limits.boostLimit === null) return false;
    const first = this.s.firstSeen ?? now;
    return now < first + this.limits.boostWindowMs;
  }

  private freeUsage(now: number): { used: number; limit: number; resetsAt: string } {
    const first = this.s.firstSeen ?? now;
    if (this.inBoost(now) && this.limits.boostLimit !== null) {
      return {
        used: this.s.boostUsed,
        limit: this.limits.boostLimit,
        resetsAt: new Date(first + this.limits.boostWindowMs).toISOString(),
      };
    }
    return {
      used: this.s.months[monthKey(now)] ?? 0,
      limit: this.limits.monthlyLimit,
      resetsAt: nextMonthStart(now),
    };
  }
```

`reserve`, `commit`, `release`, `snapshot` are unchanged; `commit` already guards `boostUsed` with `inBoost`, which is now `false` for the publish profile.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/proxy/test/quota.test.ts`
Expected: PASS, the existing free-tier, idempotency, and rate-limit cases still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/quota.ts packages/proxy/test/quota.test.ts
git commit -m "feat(proxy): add a publish quota profile without a boost window

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Quota client carries a profile

**Files:**
- Modify: `packages/proxy/src/handlers.ts` (the `HandlerDeps.quotaFor` signature and the re-export)
- Modify: `packages/proxy/src/index.ts` (`QuotaDO.fetch`, `doQuotaClient`)
- Modify: `packages/proxy/test/handlers.test.ts`, `packages/proxy/test/router.test.ts` (`memQuota`)

**Interfaces:**
- Produces: `quotaFor(identityId: string, profile?: QuotaProfile): QuotaClient` on `HandlerDeps`, default `'ai'`. `handlers.ts` re-exports `type QuotaProfile` from `./quota`.
- The DO request payload gains `profile?: QuotaProfile`.

- [ ] **Step 1: Update the test fixtures to the new signature**

In both `packages/proxy/test/handlers.test.ts` and `packages/proxy/test/router.test.ts`, replace the `memQuota` function with:

```ts
/** In-memory QuotaClient over a real engine — same contract the DO fulfils in prod. */
function memQuota(now: () => number) {
  const engines = new Map<string, QuotaEngine>();
  return (id: string, profile: QuotaProfile = 'ai') => {
    const e = engines.get(id) ?? new QuotaEngine(undefined, QUOTA_PROFILES[profile]);
    engines.set(id, e);
    return {
      reserve: async (tier: Tier, k: string): Promise<ReserveResult> => e.reserve(tier, k, now()),
      commit: async (k: string, b: string) => e.commit(k, b, now()),
      release: async (k: string) => e.release(k),
      snapshot: async (tier: Tier): Promise<QuotaSnapshot> => e.snapshot(tier, now()),
    };
  };
}
```

Extend each file's import from `'../src/quota'` with `QUOTA_PROFILES, type QuotaProfile`.

- [ ] **Step 2: Run the proxy suite to see the type error**

Run: `npx vitest run packages/proxy && npm run typecheck`
Expected: vitest passes (the runtime ignores the extra parameter); typecheck FAILS because `HandlerDeps.quotaFor` does not accept a second parameter.

- [ ] **Step 3: Implement**

In `packages/proxy/src/handlers.ts`:

```ts
import type { QuotaProfile, QuotaSnapshot, ReserveResult, Tier } from './quota';

export { licenseIdentityId };
export type { QuotaProfile };
```

and in `HandlerDeps`:

```ts
  /** One engine per identity and profile. `profile` defaults to 'ai'. */
  quotaFor(identityId: string, profile?: QuotaProfile): QuotaClient;
```

In `packages/proxy/src/index.ts`:

```ts
import { QuotaEngine, QUOTA_PROFILES, type QuotaProfile, type ReserveResult, type QuotaSnapshot, type Tier } from './quota';
```

In `QuotaDO.fetch`, read `profile` and construct the engine with it:

```ts
    const { op, tier, cacheKey, body, now, profile } = (await req.json()) as {
      op: 'reserve' | 'commit' | 'release' | 'snapshot';
      tier: Tier; cacheKey?: string; body?: string; now: number; profile?: QuotaProfile;
    };
    const engine = new QuotaEngine(stored ?? undefined, QUOTA_PROFILES[profile ?? 'ai']);
```

(move the `const stored = ...` line above the destructure so both are available; the order of the two awaits does not matter).

In `doQuotaClient`:

```ts
function doQuotaClient(ns: DurableObjectNamespace, identityId: string, profile: QuotaProfile = 'ai'): QuotaClient {
  const stub = ns.get(ns.idFromName(identityId));
  const call = async (payload: Record<string, unknown>) => {
    const res = await stub.fetch('https://do/quota', {
      method: 'POST', body: JSON.stringify({ ...payload, profile, now: Date.now() }),
    });
    return res.json();
  };
```

and in `worker.fetch`: `quotaFor: (id, profile) => doQuotaClient(env.QUOTA, id, profile),`.

- [ ] **Step 4: Verify**

Run: `npx vitest run packages/proxy && npm run typecheck`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/handlers.ts packages/proxy/src/index.ts packages/proxy/test/handlers.test.ts packages/proxy/test/router.test.ts
git commit -m "feat(proxy): thread a quota profile through the durable object client

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Proved ownership and per-tier library limits

**Files:**
- Modify: `packages/proxy/src/libraries.ts`
- Test: `packages/proxy/test/libraries.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const LIBRARY_LIMITS: Record<Tier, number> = { free: 1, pro: 10 };
  export const LIBRARY_LIMIT = LIBRARY_LIMITS.pro;   // kept for existing imports
  interface Caller { tier: Tier; tierIdentity: string; owners: string[] }
  async function resolveCaller(req, deps): Promise<Caller | Response>;
  ```
  `tierIdentity` is `lic:<sha>` for Pro, else `free:<figmaHash>` when present, else `lic:<sha>`. `owners` lists every identity the caller proved.
- This task does not add quota counting or new headers; Task 5 does.

- [ ] **Step 1: Update the test helpers and write the failing tests**

In `packages/proxy/test/libraries.test.ts`:

Replace `publishReq` with a version that takes headers:

```ts
function publishReq(body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${UUID_KEY}` }) {
  return new Request('https://proxy.test/v1/libraries', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const bearer = (key = UUID_KEY) => ({ Authorization: `Bearer ${key}` });
const figma = (id = 'u1') => ({ 'X-Figma-User': id });
```

Update every existing `publishReq({ ... }, OTHER_UUID_KEY)` call to `publishReq({ ... }, bearer(OTHER_UUID_KEY))`. Do the same for `rotateReq`: make its second parameter a headers record with the same default.

Replace the `deps()` `quotaFor` throw with a real in-memory engine, copied from `handlers.test.ts` (Task 3 version), importing `QuotaEngine, QUOTA_PROFILES, type QuotaProfile, type Tier, type ReserveResult, type QuotaSnapshot` from `'../src/quota'`.

Change the test `rejects a free-tier license` to:

```ts
  it('publishes as free when the license is not active but a Figma identity is present', async () => {
    const d = deps();
    await seedFree(d);
    const res = await handlePublish(publishReq({ bundle: BUNDLE }, { ...bearer(), ...figma() }), d);
    expect(res.status).toBe(201);
    expect(res.headers.get('X-Tier')).toBe('free');
  });

  it('rejects a lapsed license with no Figma identity (legacy client)', async () => {
    const d = deps();
    await seedFree(d);
    const res = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toBe('license_not_active');
  });
```

(The `X-Tier` assertion will pass only after Task 5; mark it `// Task 5` and leave it in, the task order runs both before the suite is required green at the PR.)

Add new cases in `describe('handlePublish')`:

```ts
  it('creates a library for a free Figma identity, owned by that identity', async () => {
    const d = deps();
    const res = await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d);
    expect(res.status).toBe(201);
    const { libraryId } = await res.json() as { libraryId: string };
    const meta = JSON.parse((await d.libraryStore.get(`lib:${libraryId}:meta`))!) as LibraryMeta;
    expect(meta.licenseId).toBe(`free:${hashFigmaId('u1', 'salt')}`);
  });

  it('lets a Pro caller sending both headers update a library created while free', async () => {
    const d = deps();
    const created = await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d);
    const { libraryId } = await created.json() as { libraryId: string };
    await seedPro(d);
    const changed = { ...BUNDLE, components: [...BUNDLE.components, { name: 'Card', ai: 'component: Card\n', artifact: {} }] };
    const res = await handlePublish(publishReq({ libraryId, bundle: changed }, { ...bearer(), ...figma() }), d);
    expect(res.status).toBe(200);
  });

  it('lets a lapsed license update the library it created while Pro', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    await seedFree(d);
    const changed = { ...BUNDLE, fileName: 'Renamed' };
    const res = await handlePublish(publishReq({ libraryId, bundle: changed }, { ...bearer(), ...figma() }), d);
    expect(res.status).toBe(200);
  });

  it('caps a free identity at one library and names the existing one', async () => {
    const d = deps();
    const first = await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d);
    const { libraryId } = await first.json() as { libraryId: string };
    const res = await handlePublish(publishReq({ bundle: { ...BUNDLE, fileName: 'Second' } }, figma()), d);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'library_limit', limit: 1, existing: { libraryId, fileName: 'Test File' },
    });
  });

  it('counts libraries across both proved identities', async () => {
    const d = deps();
    await seedPro(d);
    await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d);
    const licenseId = `lic:${sha256(UUID_KEY)}`;
    for (let i = 0; i < LIBRARY_LIMITS.pro - 1; i += 1) {
      await d.libraryStore.put(`libowner:${licenseId}:lib_${String(i).padStart(24, '0')}`, '1');
    }
    const res = await handlePublish(publishReq({ bundle: BUNDLE }, { ...bearer(), ...figma() }), d);
    expect(res.status).toBe(403);
    expect((await res.json() as { limit: number }).limit).toBe(LIBRARY_LIMITS.pro);
  });
```

Update `caps libraries per license` to expect `{ error: 'library_limit', limit: LIBRARY_LIMITS.pro }` and import `LIBRARY_LIMITS` and `hashFigmaId` (from `'../src/identity'`).

In `describe('handleRotate')`, replace `rejects a lapsed license` with:

```ts
  it('rotates for a lapsed license that owns the library', async () => {
    const { deps: d, libraryId } = await publishedLibrary();
    await seedFree(d);
    const res = await handleRotate(rotateReq(libraryId), d, libraryId);
    expect(res.status).toBe(200);
    expect((await res.json() as { pullKey: string }).pullKey).toMatch(PULL_KEY_RE);
  });

  it('rotates for a free owner and refuses a stranger', async () => {
    const d = deps();
    const created = await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d);
    const { libraryId } = await created.json() as { libraryId: string };
    expect((await handleRotate(rotateReq(libraryId, figma('u1')), d, libraryId)).status).toBe(200);
    const stranger = await handleRotate(rotateReq(libraryId, figma('u2')), d, libraryId);
    expect(stranger.status).toBe(403);
    expect(await stranger.json()).toEqual({ error: 'not_owner' });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/proxy/test/libraries.test.ts`
Expected: FAIL on the new cases (401 where 201 is expected, `LIBRARY_LIMITS` missing).

- [ ] **Step 3: Implement**

In `packages/proxy/src/libraries.ts`:

Imports:

```ts
import { callerProofs, licenseIdentityId } from './identity';
import { checkLicense, type LibraryStore } from './license';
import type { Tier } from './quota';
```

Constants:

```ts
export const LIBRARY_LIMITS: Record<Tier, number> = { free: 1, pro: 10 };
/** The Pro limit, kept for callers that predate per-tier limits. */
export const LIBRARY_LIMIT = LIBRARY_LIMITS.pro;
```

Replace `proCaller` with:

```ts
interface Caller {
  tier: Tier;
  /** Identity the quota is counted under: license for Pro, else Figma, else license. */
  tierIdentity: string;
  /** Every identity the request proved. Any of them may own a library. */
  owners: string[];
}

/**
 * Who is calling and what they can prove. A bearer proves the license identity
 * whether or not the license is active, because possession of the key is the
 * proof of ownership; only the tier depends on the license being active.
 */
async function resolveCaller(req: Request, deps: HandlerDeps): Promise<Caller | Response> {
  const proofs = callerProofs(req.headers, deps.salt);
  if (!proofs.license && !proofs.figmaHash) return json(401, { error: 'unauthenticated' });
  const owners: string[] = [];
  let tier: Tier = 'free';
  let licenseId: string | null = null;
  if (proofs.license) {
    licenseId = licenseIdentityId(proofs.license.key);
    owners.push(licenseId);
    const lic = await checkLicense(proofs.license.key, proofs.license.instanceId, {
      fetcher: deps.fetcher, cache: deps.licenseCache, now: deps.now,
    });
    if (lic.tier === 'pro') tier = 'pro';
    else if (!proofs.figmaHash) return json(401, { error: 'license_not_active', reason: lic.reason });
  }
  const figmaId = proofs.figmaHash ? `free:${proofs.figmaHash}` : null;
  if (figmaId) owners.push(figmaId);
  const tierIdentity = tier === 'pro' ? (licenseId as string) : (figmaId ?? (licenseId as string));
  return { tier, tierIdentity, owners };
}
```

`ownedMeta` takes `owners: string[]` and checks `owners.includes(meta.licenseId)`.

`ownedLibraryIds` takes `owners: string[]`, runs the existing body per owner, and returns the concatenation:

```ts
async function ownedLibraryIds(store: LibraryStore, owners: string[]): Promise<string[]> {
  const all: string[] = [];
  for (const owner of owners) {
    const prefix = ownerPrefix(owner);
    const legacyRaw = await store.get(legacyOwnerKey(owner));
    if (legacyRaw !== null) {
      const legacy = JSON.parse(legacyRaw) as string[];
      await Promise.all(legacy.map((id) => store.put(`${prefix}${id}`, '1')));
      await store.delete(legacyOwnerKey(owner));
    }
    const { keys } = await store.list({ prefix });
    all.push(...keys.map((k) => k.name.slice(prefix.length)));
  }
  return all;
}
```

In `handlePublish`, replace the `proCaller` call with `const caller = await resolveCaller(req, deps); if (caller instanceof Response) return caller;`. Use `caller.owners` for `ownedMeta`. Replace the create-path limit check with:

```ts
  const owned = await ownedLibraryIds(store, caller.owners);
  const limit = LIBRARY_LIMITS[caller.tier];
  if (owned.length >= limit) {
    if (caller.tier === 'free') {
      const existingRaw = await store.get(metaKey(owned[0]));
      const existing = existingRaw ? (JSON.parse(existingRaw) as LibraryMeta) : null;
      return json(403, {
        error: 'library_limit', limit,
        existing: { libraryId: owned[0], fileName: existing?.fileName ?? null },
      });
    }
    return json(403, { error: 'library_limit', limit });
  }
```

The new meta's `licenseId` becomes `caller.tierIdentity`, and the owner record key uses `ownerPrefix(caller.tierIdentity)`.

In `handleRotate`, replace `proCaller` with `resolveCaller` and pass `caller.owners` to `ownedMeta`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/proxy/test/libraries.test.ts && npm run typecheck`
Expected: PASS except the single `X-Tier` assertion marked `// Task 5`, which reports `null`. Everything else green.

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/libraries.ts packages/proxy/test/libraries.test.ts
git commit -m "feat(proxy): open publishing to free identities with proved ownership

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Publish quota, idempotent republish, and quota headers

**Files:**
- Modify: `packages/proxy/src/libraries.ts`
- Modify: `packages/proxy/src/quota.ts` (gains `quotaHeaders`)
- Modify: `packages/proxy/src/handlers.ts` (imports `quotaHeaders` from `./quota` instead of defining it)
- Test: `packages/proxy/test/libraries.test.ts`

**Interfaces:**
- Consumes: `deps.quotaFor(id, 'publish')`, `QuotaSnapshot`.
- Produces: `export function quotaHeaders(s: QuotaSnapshot): Record<string, string>` in `quota.ts`. It moves there from `handlers.ts` so `libraries.ts` can import it without a circular import between the two handler modules.
- Produces: publish responses with `X-Tier` and `X-Quota-*`; `402 { error: 'quota_exhausted', resetsAt }`; `429 { error: 'rate_limited', retryAfterMs }`; a cached replay `200 { libraryId, publishedAt, unchanged: true }`.

- [ ] **Step 1: Write the failing tests**

Add to `describe('handlePublish')`:

```ts
  it('counts a free publish and returns quota headers', async () => {
    const d = deps();
    const res = await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d);
    expect(res.headers.get('X-Tier')).toBe('free');
    expect(res.headers.get('X-Quota-Used')).toBe('1');
    expect(res.headers.get('X-Quota-Limit')).toBe('10');
    expect(res.headers.get('X-Quota-Remaining')).toBe('9');
    expect(res.headers.get('X-Quota-Resets-At')).toBe('2026-08-01T00:00:00.000Z');
  });

  it('replays an unchanged republish without counting or writing', async () => {
    const d = deps();
    const created = await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d);
    const { libraryId, publishedAt } = await created.json() as { libraryId: string; publishedAt: string };
    const puts = d.libraryStore.map.size;
    const res = await handlePublish(publishReq({ libraryId, bundle: BUNDLE }, figma()), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ libraryId, publishedAt, unchanged: true });
    expect(res.headers.get('X-Quota-Used')).toBe('1');
    expect(d.libraryStore.map.size).toBe(puts);
  });

  it('refuses the eleventh changed publish in a month with 402', async () => {
    let t = Date.parse('2026-07-01T00:00:00Z');
    const d = deps({ now: () => t, quotaFor: memQuota(() => t) });
    const created = await handlePublish(publishReq({ bundle: BUNDLE }, figma()), d);
    const { libraryId } = await created.json() as { libraryId: string };
    for (let i = 1; i < 10; i += 1) {
      t += 60_000;
      const res = await handlePublish(publishReq({ libraryId, bundle: { ...BUNDLE, fileName: `v${i}` } }, figma()), d);
      expect(res.status).toBe(200);
    }
    t += 60_000;
    const res = await handlePublish(publishReq({ libraryId, bundle: { ...BUNDLE, fileName: 'v10' } }, figma()), d);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'quota_exhausted', resetsAt: '2026-08-01T00:00:00.000Z' });
  });

  it('never blocks a Pro publish and flags fair use past the soft threshold', async () => {
    const log = vi.fn();
    let t = Date.parse('2026-07-01T00:00:00Z');
    const d = deps({ now: () => t, quotaFor: memQuota(() => t), log });
    await seedPro(d);
    const engine = d.quotaFor(`lic:${sha256(UUID_KEY)}`, 'publish');
    for (let i = 0; i < PRO_SOFT_THRESHOLD; i += 1) {
      await engine.reserve('pro', `seed${i}`);
      await engine.commit(`seed${i}`, '{}');
    }
    const res = await handlePublish(publishReq({ bundle: BUNDLE }), d);
    expect(res.status).toBe(201);
    expect(res.headers.get('X-Quota-Limit')).toBe('unlimited');
    expect(log).toHaveBeenCalledWith('fair_use_flag', expect.objectContaining({ tier: 'pro' }));
  });

  it('does not count a create that fails validation', async () => {
    const d = deps();
    await handlePublish(publishReq({ bundle: { schema: 'nope' } }, figma()), d);
    const snap = await d.quotaFor(`free:${hashFigmaId('u1', 'salt')}`, 'publish').snapshot('free');
    expect(snap.used).toBe(0);
  });
```

Import `vi` from vitest and `PRO_SOFT_THRESHOLD` from `'../src/quota'`. The `memQuota` helper needs a `now` parameter as shown in Task 3; the `deps()` factory in this file should build its default `quotaFor` from the same `now` it uses for `deps.now`.

Remove the `// Task 5` note from the Task 4 test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/proxy/test/libraries.test.ts`
Expected: FAIL, no quota headers, `unchanged` missing, 200 where 402 is expected.

- [ ] **Step 3: Implement**

Move `quotaHeaders` out of `packages/proxy/src/handlers.ts` into `packages/proxy/src/quota.ts`, exported, with the same body:

```ts
export function quotaHeaders(s: QuotaSnapshot): Record<string, string> {
  return {
    'X-Tier': s.tier,
    'X-Quota-Used': String(s.used),
    'X-Quota-Limit': s.limit === null ? 'unlimited' : String(s.limit),
    'X-Quota-Remaining': s.remaining === null ? 'unlimited' : String(s.remaining),
    'X-Quota-Resets-At': s.resetsAt,
  };
}
```

In `handlers.ts`, delete the local function and add `quotaHeaders` to the import from `./quota` (it becomes a value import, not type-only).

In `packages/proxy/src/libraries.ts`:

```ts
import { quotaHeaders } from './quota';
import type { HandlerDeps } from './handlers';
```

In `handlePublish`, after body validation and the `stored`/`bundleHash` computation, restructure the two paths so both go through the quota:

```ts
  const quota = deps.quotaFor(caller.tierIdentity, 'publish');
  const respond = async (status: number, payload: Record<string, unknown>) =>
    json(status, payload, quotaHeaders(await quota.snapshot(caller.tier)));

  let libraryId: string | null = null;
  let meta: LibraryMeta | null = null;
  if (body.libraryId !== undefined) {
    if (typeof body.libraryId !== 'string' || !LIBRARY_ID_RE.test(body.libraryId)) {
      return json(400, { error: 'invalid libraryId' });
    }
    const owned = await ownedMeta(store, body.libraryId, caller.owners);
    if (owned instanceof Response) return owned;
    libraryId = body.libraryId;
    meta = owned;
  } else {
    // (the Task 4 library-count block goes here, unchanged)
  }

  const cacheKey = `publish:${libraryId ?? 'new'}:${bundleHash}`;
  const reserved = await quota.reserve(caller.tier, cacheKey);
  switch (reserved.kind) {
    case 'cached': {
      const prior = JSON.parse(reserved.body) as { libraryId: string; publishedAt: string };
      return respond(200, { ...prior, unchanged: true });
    }
    case 'pending':
      return json(409, { error: 'publish_pending' });
    case 'exhausted':
      return json(402, { error: 'quota_exhausted', resetsAt: reserved.resetsAt });
    case 'rate_limited':
      return json(429, { error: 'rate_limited', retryAfterMs: reserved.retryAfterMs });
    case 'proceed':
      break;
    default:
      return json(500, { error: 'internal' });
  }
  if (reserved.kind === 'proceed' && reserved.flagged) {
    deps.log('fair_use_flag', { identityId: caller.tierIdentity, tier: caller.tier, surface: 'publish' });
  }

  try {
    if (libraryId && meta) {
      const next: LibraryMeta = { ...meta, publishedAt, bundleHash, size: bytes.byteLength, fileName };
      await store.put(bundleKey(libraryId), stored);
      await store.put(metaKey(libraryId), JSON.stringify(next));
      await quota.commit(cacheKey, JSON.stringify({ libraryId, publishedAt }));
      deps.log('library_publish', { libraryId, size: bytes.byteLength });
      return respond(200, { libraryId, publishedAt });
    }
    const newId = newLibraryId();
    const pullKey = newPullKey();
    const created: LibraryMeta = {
      licenseId: caller.tierIdentity, publishedAt, bundleHash, size: bytes.byteLength, fileName,
    };
    await store.put(bundleKey(newId), stored);
    await Promise.all([
      store.put(metaKey(newId), JSON.stringify(created)),
      store.put(keyRecord(newId), sha256(pullKey)),
      store.put(`${ownerPrefix(caller.tierIdentity)}${newId}`, publishedAt),
    ]);
    // The replay body never carries the pull key: it is handed out exactly once.
    await quota.commit(cacheKey, JSON.stringify({ libraryId: newId, publishedAt }));
    deps.log('library_publish', { libraryId: newId, size: bytes.byteLength, created: true });
    return respond(201, { libraryId: newId, pullKey, publishedAt });
  } catch (err) {
    await quota.release(cacheKey);
    throw err;
  }
```

Note the reservation is taken after ownership and the library count, so a stranger can never replay a cached response and a blocked create never consumes an update.

- [ ] **Step 4: Run the suite**

Run: `npx vitest run packages/proxy && npm run typecheck && npm run lint`
Expected: PASS. If `router.test.ts` `routes POST /v1/libraries to publish` fails on `quotaFor`, its `baseDeps` already uses `memQuota` from Task 3, so it passes.

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/libraries.ts packages/proxy/src/quota.ts packages/proxy/src/handlers.ts packages/proxy/test/libraries.test.ts
git commit -m "feat(proxy): meter free publishes monthly and replay unchanged republishes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `publish` snapshot on `GET /v1/quota`

**Files:**
- Modify: `packages/proxy/src/handlers.ts` (`handleQuota`)
- Test: `packages/proxy/test/router.test.ts`

**Interfaces:**
- Produces: the quota body gains `publish: QuotaSnapshot`. Existing top-level fields are unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `packages/proxy/test/router.test.ts`, beside the existing quota cases:

```ts
  it('GET /v1/quota carries the publish snapshot for a free identity', async () => {
    const res = await route(new Request('https://p.test/v1/quota', { headers: { 'X-Figma-User': 'u1' } }), baseDeps());
    const body = await res.json() as { tier: string; limit: number; publish: { tier: string; used: number; limit: number | null; resetsAt: string } };
    expect(body.limit).toBe(20);
    expect(body.publish).toEqual({ tier: 'free', used: 0, limit: 10, remaining: 10, resetsAt: '2026-08-01T00:00:00.000Z' });
  });

  it('GET /v1/quota reports an unlimited publish snapshot for pro', async () => {
    const d = baseDeps();
    await d.licenseCache.put(`lic:${sha256(UUID_KEY)}`, JSON.stringify({ status: 'active', validatedAt: d.now() }));
    const res = await route(new Request('https://p.test/v1/quota', { headers: { Authorization: `Bearer ${UUID_KEY}` } }), d);
    const body = await res.json() as { publish: { tier: string; limit: number | null } };
    expect(body.publish.tier).toBe('pro');
    expect(body.publish.limit).toBeNull();
  });

  it('GET /v1/quota meters publishing under the Figma identity when a key is not active', async () => {
    const d = baseDeps();
    d.fetcher = vi.fn(async () => new Response(
      JSON.stringify({ valid: false, license_key: { status: 'expired' } }), { status: 200 },
    )) as unknown as typeof fetch;
    await d.quotaFor(`free:${hashFigmaId('u1', 'salt')}`, 'publish').commit('seed', '{}');
    const res = await route(new Request('https://p.test/v1/quota', {
      headers: { Authorization: `Bearer ${UUID_KEY}`, 'X-Figma-User': 'u1' },
    }), d);
    const body = await res.json() as { tier: string; publish: { used: number } };
    expect(body.tier).toBe('free');
    expect(body.publish.used).toBe(1);
  });
```

Import `hashFigmaId` from `'../src/identity'`. `baseDeps()` uses `salt: 'salt'`, which is what the third case hashes with.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/proxy/test/router.test.ts`
Expected: FAIL, `publish` undefined.

- [ ] **Step 3: Implement**

In `handleQuota`, after `tier` and `identityId` are resolved, compute the publish identity with the same rule `resolveCaller` uses, then include the snapshot:

```ts
  const proofs = callerProofs(req.headers, deps.salt);
  const figmaId = proofs.figmaHash ? `free:${proofs.figmaHash}` : null;
  const publishIdentity = tier === 'pro' ? identityId : (figmaId ?? identityId);
  const publish = await deps.quotaFor(publishIdentity, 'publish').snapshot(tier);
  const s = await deps.quotaFor(identityId).snapshot(tier);
  if (identity.kind === 'license' && tier === 'free') {
    return json(200, { ...s, publish, licenseReason: licResult && licResult.tier === 'free' ? licResult.reason : undefined });
  }
  return json(200, { ...s, publish });
```

Import `callerProofs` from `./identity`.

- [ ] **Step 4: Verify**

Run: `npx vitest run packages/proxy && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/handlers.ts packages/proxy/test/router.test.ts
git commit -m "feat(proxy): report the publish allowance on the quota endpoint

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Proxy README

**Files:**
- Modify: `packages/proxy/README.md`

- [ ] **Step 1: Rewrite the affected sections**

Under `## API`, replace the auth paragraph with:

```markdown
Auth on every endpoint: `Authorization: Bearer <license-key>` (Pro, or a
lapsed key proving ownership) and/or `X-Figma-User: <figma-user-id>` (free;
stored only as a salted SHA-256 hash). AI writing meters against the license
when a bearer is present. Library endpoints read both headers: the tier comes
from the license when it is active, and a library is owned by any identity the
caller proves.
```

Replace the `### POST /v1/libraries` section with:

```markdown
### `POST /v1/libraries`

Body: `{ "libraryId"?: "lib_...", "bundle": <library bundle> }`. The bundle
must carry `schema: "spec-layer-library-bundle"`, a string `version`, and a
`components` array; the proxy validates that shape and nothing else. It never
derives, re-validates, or re-projects v5 output.

Omitting `libraryId` creates a library (201) and returns
`{ libraryId, pullKey, publishedAt }`. That response is the only copy of the
pull key the server ever hands back; only its SHA-256 is stored. A new library
is owned by the license identity on Pro and by the Figma identity on free.

Passing an owned `libraryId` overwrites the bundle in place (200) and returns
`{ libraryId, publishedAt }`. Ownership passes when any identity in the
request owns the library, so a library created on a free plan stays writable
after upgrading, and a library created on Pro stays writable after the license
lapses as long as the key is still sent.

Limits per tier: free 1 library and 10 changed publishes per UTC month; Pro 10
libraries and no fixed publish cap (`fair_use_flag` at the soft threshold).
A publish is counted only when its KV write commits. The quota key is the
bundle hash, so republishing an unchanged bundle within 24 hours returns
`200 { libraryId, publishedAt, unchanged: true }` with no write and no count.
Every publish response carries `X-Tier` and the `X-Quota-*` headers for the
publish allowance.

Errors: `400` invalid JSON or bundle shape, `400
{"error":"unsupported bundle version","version":"2.0.0"}`, `401` no identity,
or a lapsed key with no Figma identity, `402
{"error":"quota_exhausted","resetsAt":…}`, `403 {"error":"not_owner"}`,
`403 {"error":"library_limit","limit":1,"existing":{"libraryId":…,"fileName":…}}`
on free (`fileName` may be null; Pro gets `limit: 10` and no `existing`),
`404` unknown `libraryId`, `409 {"error":"publish_pending"}`, `413
{"error":"bundle_too_large","size":…,"limit":5000000}`, `429` rate limited.
```

In `### POST /v1/libraries/:libraryId/rotate`, replace "Pro license required, and the caller must own the library." with "The caller must own the library; there is no tier check."

In `### GET /v1/quota`, change the arrow line to:

```markdown
→ `{ tier, used, limit, remaining, resetsAt, publish: { tier, used, limit, remaining, resetsAt } }`.
The top-level fields are the AI writing allowance; `publish` is the library
publish allowance, metered under the license identity on Pro and the Figma
identity otherwise.
```

Under `## Quota rules`, add after the Pro line:

```markdown
- Publishing: free 10 changed publishes per UTC calendar month, no boost
  window, one library; Pro 10 libraries, no fixed cap, flagged at the same
  soft threshold. Counted in a separate Durable Object per identity
  (`publish:<identity>`), keyed by bundle hash so unchanged republishes are
  free. Pull is not metered.
```

Add to the accepted-risks list:

```markdown
- **Free libraries are owned by a client-supplied identity.** The Figma user id
  is hashed with a server salt but is not a secret, so a free library has the
  same spoofing exposure the free AI quota accepts. Pro libraries are owned by
  the license hash and are as protected as before.
- **Deploy order.** The proxy ships before any plugin build that sends both
  headers. A bearer-only client keeps working: it proves the license identity
  that owns every library published so far.
```

- [ ] **Step 2: Check and commit**

Run: `npm run check:nul && grep -c "—" packages/proxy/README.md` (the README may already contain em dashes; do not add new ones).

```bash
git add packages/proxy/README.md
git commit -m "docs(proxy): document free publishing, proved ownership, and the publish allowance

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Plugin auth headers and `ProxyQuota.publish`

**Files:**
- Modify: `packages/extractor/src/prose/client.ts` (`ProxyQuota`)
- Modify: `packages/plugin/src/ui/proxy.ts`
- Test: `packages/plugin/test/proxy.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // extractor
  export interface ProxyQuota { ...existing; publish?: { tier: 'free' | 'pro'; used: number; limit: number | null; remaining: number | null; resetsAt: string } }
  // plugin
  export function authHeaders(auth: ProxyAuth): Record<string, string> | null; // sends both when both known
  export function publishAuth(licenseKey: string | null, licenseInstanceId: string | null, figmaUserId: string | null): ProxyAuth;
  ```

- [ ] **Step 1: Write the failing tests**

In `packages/plugin/test/proxy.test.ts`, change the first `authHeaders` case and add two:

```ts
describe('authHeaders', () => {
  it('sends the license key and the figma identity together when both are known', () => {
    expect(authHeaders({ licenseKey: 'LK', licenseInstanceId: null, figmaUserId: 'u1' }))
      .toEqual({ Authorization: 'Bearer LK', 'X-Figma-User': 'u1' });
  });
  it('sends only the bearer without a figma identity', () => {
    expect(authHeaders({ licenseKey: 'LK', licenseInstanceId: null, figmaUserId: null }))
      .toEqual({ Authorization: 'Bearer LK' });
  });
  it('falls back to the figma user id', () => { /* unchanged */ });
  it('returns null with no identity', () => { /* unchanged */ });
});

describe('publishAuth', () => {
  it('keeps the key even when the license is known inactive, since it proves ownership', () => {
    expect(publishAuth('LK', 'i1', 'u1')).toEqual({ licenseKey: 'LK', licenseInstanceId: 'i1', figmaUserId: 'u1' });
    expect(publishAuth(null, null, 'u1')).toEqual({ licenseKey: null, licenseInstanceId: null, figmaUserId: 'u1' });
  });
});
```

Update the `instance-aware auth` cases to expect `'X-Figma-User': 'u1'` alongside the bearer where `figmaUserId: 'u1'` is passed. Import `publishAuth`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/plugin/test/proxy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `packages/extractor/src/prose/client.ts`, add to `ProxyQuota`:

```ts
  /** Library publish allowance, same shape. Absent from proxies that predate it. */
  publish?: { tier: 'free' | 'pro'; used: number; limit: number | null; remaining: number | null; resetsAt: string };
```

In `packages/plugin/src/ui/proxy.ts`, replace `authHeaders`:

```ts
/**
 * Both proofs travel together. The proxy meters AI writing against the license
 * when one is present, and library ownership is proved by whichever identity
 * created the library, so sending both costs nothing and lets a plan change
 * hands without a migration.
 */
export function authHeaders(auth: ProxyAuth): Record<string, string> | null {
  const headers: Record<string, string> = {};
  if (auth.licenseKey) {
    const bearer = auth.licenseInstanceId ? `${auth.licenseKey}:${auth.licenseInstanceId}` : auth.licenseKey;
    headers.Authorization = `Bearer ${bearer}`;
  }
  if (auth.figmaUserId) headers['X-Figma-User'] = auth.figmaUserId;
  return Object.keys(headers).length ? headers : null;
}

/**
 * The identity for publish and rotate. Unlike effectiveAuth, a key known to be
 * inactive is still sent: it no longer buys Pro, but it proves ownership of
 * the libraries it published, and the Figma header carries the free tier.
 */
export function publishAuth(
  licenseKey: string | null,
  licenseInstanceId: string | null,
  figmaUserId: string | null,
): ProxyAuth {
  return { licenseKey, licenseInstanceId: licenseKey ? licenseInstanceId : null, figmaUserId };
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run packages/plugin/test/proxy.test.ts packages/plugin/test/publish.test.ts && npm run typecheck`
Expected: PASS. Every `AUTH` fixture in `publish.test.ts` has `figmaUserId: null`, so its header expectations do not change.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/prose/client.ts packages/plugin/src/ui/proxy.ts packages/plugin/test/proxy.test.ts packages/plugin/test/publish.test.ts
git commit -m "feat(plugin): send both identity proofs and read the publish allowance

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Publish allowance view model

**Files:**
- Modify: `packages/plugin/src/ui/viewModel/allowance.ts`
- Test: `packages/plugin/test/allowance.test.ts`, `packages/plugin/test/publishScreen.test.ts` (delete the `publishLocked` block)

**Interfaces:**
- Produces:
  ```ts
  export type PublishAllowance =
    | { kind: 'hidden' }
    | { kind: 'free'; remaining: number; limit: number; resetsAt: string };
  export function publishAllowance(quota: ProxyQuota | null): PublishAllowance;
  export function publishAllowanceCopy(state: PublishAllowance): string | null;
  export function formatResetDate(iso: string): string;   // 'Oct 1', '' when unparsable
  ```
- Deletes: `publishLocked`.

- [ ] **Step 1: Write the failing tests**

Delete the `describe('publishLocked', ...)` block from `packages/plugin/test/publishScreen.test.ts` and its import. Add to `packages/plugin/test/allowance.test.ts`:

```ts
import { publishAllowance, publishAllowanceCopy, formatResetDate } from '../src/ui/viewModel/allowance';

const withPublish = (publish: NonNullable<ProxyQuota['publish']>): ProxyQuota =>
  ({ tier: publish.tier, used: 0, limit: 20, remaining: 20, resetsAt: '', publish });

describe('publishAllowance', () => {
  it('hides for null, for pro, and for a proxy that sends no publish field', () => {
    expect(publishAllowance(null)).toEqual({ kind: 'hidden' });
    expect(publishAllowance({ tier: 'pro', used: 0, limit: null, remaining: null, resetsAt: '' })).toEqual({ kind: 'hidden' });
    expect(publishAllowance(withPublish({ tier: 'pro', used: 3, limit: null, remaining: null, resetsAt: '' }))).toEqual({ kind: 'hidden' });
  });

  it('reports a free allowance', () => {
    expect(publishAllowance(withPublish({ tier: 'free', used: 7, limit: 10, remaining: 3, resetsAt: '2026-10-01T00:00:00.000Z' })))
      .toEqual({ kind: 'free', remaining: 3, limit: 10, resetsAt: '2026-10-01T00:00:00.000Z' });
  });

  it('never reports a negative remaining', () => {
    expect(publishAllowance(withPublish({ tier: 'free', used: 12, limit: 10, remaining: null, resetsAt: '' })))
      .toMatchObject({ remaining: 0 });
  });
});

describe('publishAllowanceCopy', () => {
  it('names updates and the reset date', () => {
    expect(publishAllowanceCopy({ kind: 'free', remaining: 3, limit: 10, resetsAt: '2026-10-01T00:00:00.000Z' }))
      .toBe('3 of 10 free updates left this month, resets Oct 1');
  });
  it('drops the reset clause when the date is unknown', () => {
    expect(publishAllowanceCopy({ kind: 'free', remaining: 10, limit: 10, resetsAt: '' }))
      .toBe('10 of 10 free updates left this month');
  });
  it('says so at zero', () => {
    expect(publishAllowanceCopy({ kind: 'free', remaining: 0, limit: 10, resetsAt: '2026-10-01T00:00:00.000Z' }))
      .toBe('No free updates left this month, resets Oct 1');
  });
  it('returns null when hidden', () => {
    expect(publishAllowanceCopy({ kind: 'hidden' })).toBeNull();
  });
});

describe('formatResetDate', () => {
  it('formats in UTC as short month and day', () => {
    expect(formatResetDate('2026-10-01T00:00:00.000Z')).toBe('Oct 1');
    expect(formatResetDate('2026-12-31T23:59:59.000Z')).toBe('Dec 31');
  });
  it('returns an empty string for garbage', () => {
    expect(formatResetDate('')).toBe('');
    expect(formatResetDate('nope')).toBe('');
  });
});
```

Import `ProxyQuota` type from `@spec-layer/extractor` if the file does not already.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/plugin/test/allowance.test.ts packages/plugin/test/publishScreen.test.ts`
Expected: allowance FAILS on missing exports; publishScreen still passes.

- [ ] **Step 3: Implement**

In `packages/plugin/src/ui/viewModel/allowance.ts`, delete `publishLocked` and its doc comment. Append:

```ts
export type PublishAllowance =
  | { kind: 'hidden' }
  | { kind: 'free'; remaining: number; limit: number; resetsAt: string };

/**
 * The publish screen's updates line. Pro and "not told yet" both hide it: the
 * server is the authority, and the publish result carries the answer when the
 * meter could not.
 */
export function publishAllowance(quota: ProxyQuota | null): PublishAllowance {
  const publish = quota?.publish;
  if (!publish || publish.tier === 'pro') return { kind: 'hidden' };
  const limit = publish.limit ?? 0;
  const remaining = publish.remaining ?? Math.max(0, limit - publish.used);
  return { kind: 'free', remaining: Math.max(0, remaining), limit, resetsAt: publish.resetsAt };
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Oct 1' in UTC, matching the proxy's UTC month boundary. Empty when unparsable. */
export function formatResetDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function publishAllowanceCopy(state: PublishAllowance): string | null {
  if (state.kind === 'hidden') return null;
  const reset = formatResetDate(state.resetsAt);
  const tail = reset ? `, resets ${reset}` : '';
  if (state.remaining <= 0) return `No free updates left this month${tail}`;
  return `${state.remaining} of ${state.limit} free updates left this month${tail}`;
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run packages/plugin/test/allowance.test.ts packages/plugin/test/publishScreen.test.ts && npm run typecheck`
Expected: allowance PASSES. Typecheck FAILS in `ui-vnext.ts` (imports `publishLocked`). That is fixed in Task 11; proceed.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/viewModel/allowance.ts packages/plugin/test/allowance.test.ts packages/plugin/test/publishScreen.test.ts
git commit -m "feat(plugin): model the publish allowance and drop the publish paywall flag

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Publish outcomes and copy

**Files:**
- Modify: `packages/plugin/src/ui/publish.ts`
- Test: `packages/plugin/test/publish.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PublishOutcome =
    | { kind: 'created'; libraryId: string; pullKey: string; publishedAt: string }
    | { kind: 'updated'; libraryId: string; publishedAt: string }
    | { kind: 'unchanged'; libraryId: string; publishedAt: string }
    | { kind: 'gone' }
    | { kind: 'error'; message: string };
  export const PUBLISH_LIMIT_MESSAGE_PREFIX = 'Free plans publish one Figma file.';
  ```
- `PublishState` is unchanged. `onPublishSources` sets `message` for `unchanged`.

- [ ] **Step 1: Write the failing tests**

In `packages/plugin/test/publish.test.ts`, replace the cases that assert `'Publishing needs an active Pro license.'` and `'Rotating the key needs an active Pro license.'`:

```ts
  it('maps 401 to a plain sign-in problem, not a Pro requirement', async () => {
    const fetcher = vi.fn(async () => jsonResponse(401, { error: 'unauthenticated' }));
    const outcome = await publishBundle(bundle, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({ kind: 'error', message: 'Publishing needs a signed-in Figma account or a license key.' });
  });

  it('maps 402 to the monthly updates message with the reset date', async () => {
    const fetcher = vi.fn(async () => jsonResponse(402, { error: 'quota_exhausted', resetsAt: '2026-10-01T00:00:00.000Z' }));
    const outcome = await publishBundle(bundle, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error',
      message: 'You have used your 10 free updates for this month. Upgrade to Pro or publish again after Oct 1.',
    });
  });

  it('maps a free library_limit to the one-file message naming the other file', async () => {
    const fetcher = vi.fn(async () => jsonResponse(403, {
      error: 'library_limit', limit: 1, existing: { libraryId: 'lib_' + 'a'.repeat(24), fileName: 'Marketing DS' },
    }));
    const outcome = await publishBundle(bundle, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({
      kind: 'error',
      message: 'Free plans publish one Figma file. This account already publishes Marketing DS. Upgrade to Pro to publish up to 10 files.',
    });
  });

  it('says "another file" when the existing library has no stored name', async () => {
    const fetcher = vi.fn(async () => jsonResponse(403, {
      error: 'library_limit', limit: 1, existing: { libraryId: 'lib_' + 'a'.repeat(24), fileName: null },
    }));
    const outcome = await publishBundle(bundle, { auth: AUTH, libraryId: null, fetcher });
    expect((outcome as { message: string }).message)
      .toBe('Free plans publish one Figma file. This account already publishes another file. Upgrade to Pro to publish up to 10 files.');
  });

  it('maps a Pro library_limit to the count', async () => {
    const fetcher = vi.fn(async () => jsonResponse(403, { error: 'library_limit', limit: 10 }));
    const outcome = await publishBundle(bundle, { auth: AUTH, libraryId: null, fetcher });
    expect(outcome).toEqual({ kind: 'error', message: 'This plan already publishes 10 Figma files, which is the limit.' });
  });

  it('reports an unchanged republish as its own outcome', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { libraryId: LIB, publishedAt: '2026-09-01T00:00:00.000Z', unchanged: true }));
    const outcome = await publishBundle(bundle, { auth: AUTH, libraryId: LIB, fetcher });
    expect(outcome).toEqual({ kind: 'unchanged', libraryId: LIB, publishedAt: '2026-09-01T00:00:00.000Z' });
  });
```

These cases go in the `describe('publishBundle')` block that starts near line 145, which defines `AUTH`, `BUNDLE` (the built bundle), and `jsonResponse`. In the snippets above, `bundle` is that block's `BUNDLE`, and add `const LIB = 'lib_' + 'b'.repeat(24);` at the top of the block. Update the existing `maps library_limit (403) with the count` case to the new Pro wording. In the `rotatePullKey` cases (near line 257), replace `'Rotating the key needs an active Pro license.'` with `'Rotating the key needs a signed-in Figma account or a license key.'` for the no-headers case and `'Rotating the key failed with HTTP 401.'` for the 401 response case.

In the controller block (near line 382, the one with `sourcesMsg`, `publish = await import(...)`, `LIB`, and `KEY`), update the rotate 401 expectation near line 652 to `'Rotating the key failed with HTTP 401.'` and add:

```ts
  it('reports nothing changed on an unchanged republish and keeps the key', async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, { libraryId: LIB, publishedAt: '2026-09-02T00:00:00.000Z', unchanged: true }));
    publish.onPublishInfo({ type: 'publishInfo', libraryId: LIB, pullKey: KEY });
    await publish.onPublishSources(sourcesMsg(), AUTH, fetcher as unknown as typeof fetch);
    const s = publish.publishState();
    expect(s.status).toBe('done');
    expect(s.message).toBe('Nothing changed since the last publish.');
    expect(s.pullKey).toBe(KEY);
    expect(sent).toEqual([]);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/plugin/test/publish.test.ts`
Expected: FAIL on the new messages and the `unchanged` kind.

- [ ] **Step 3: Implement**

In `packages/plugin/src/ui/publish.ts`:

```ts
import { formatResetDate } from './viewModel/allowance';

export type PublishOutcome =
  | { kind: 'created'; libraryId: string; pullKey: string; publishedAt: string }
  | { kind: 'updated'; libraryId: string; publishedAt: string }
  | { kind: 'unchanged'; libraryId: string; publishedAt: string }
  | { kind: 'gone' }
  | { kind: 'error'; message: string };

const NO_IDENTITY = 'Publishing needs a signed-in Figma account or a license key.';
const ROTATE_NO_IDENTITY = 'Rotating the key needs a signed-in Figma account or a license key.';

function publishErrorCopy(status: number, body: Record<string, unknown>): string {
  const error = typeof body.error === 'string' ? body.error : '';
  if (status === 401) return NO_IDENTITY;
  if (status === 402) {
    const reset = formatResetDate(typeof body.resetsAt === 'string' ? body.resetsAt : '');
    const after = reset ? ` or publish again after ${reset}` : '';
    return `You have used your 10 free updates for this month. Upgrade to Pro${after}.`;
  }
  if (error === 'bundle_too_large') return `This library is larger than the publish limit (${megabytes(body.size)} of ${megabytes(body.limit)}).`;
  if (error === 'library_limit') {
    const existing = body.existing as { fileName?: unknown } | undefined;
    if (existing) {
      const name = typeof existing.fileName === 'string' && existing.fileName ? existing.fileName : 'another file';
      return `Free plans publish one Figma file. This account already publishes ${name}. Upgrade to Pro to publish up to 10 files.`;
    }
    return `This plan already publishes ${String(body.limit)} Figma files, which is the limit.`;
  }
  if (status === 429) return 'Too many requests just now. Give it a minute.';
  return `Publishing failed with HTTP ${status}.`;
}
```

In `publishBundle`: the `!headers` early return uses `NO_IDENTITY`; after the 201 branch add:

```ts
  if (res.ok && body.unchanged === true) {
    return { kind: 'unchanged', libraryId: String(body.libraryId), publishedAt: String(body.publishedAt) };
  }
```

In `rotatePullKey`: the `!headers` return uses `ROTATE_NO_IDENTITY`; delete the `if (res.status === 401)` line so a 401 falls through to `Rotating the key failed with HTTP 401.`.

In `onPublishSources` add a case:

```ts
    case 'unchanged':
      state = {
        ...state,
        status: 'done',
        libraryId: outcome.libraryId,
        lastPublishedAt: outcome.publishedAt,
        message: 'Nothing changed since the last publish.',
      };
      break;
```

Also update `GONE_MESSAGE`: replace "belongs to another license" with "belongs to another account".

- [ ] **Step 4: Verify**

Run: `npx vitest run packages/plugin/test/publish.test.ts && grep -n "Pro license" packages/plugin/src/ui/publish.ts`
Expected: PASS, and the grep prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/publish.ts packages/plugin/test/publish.test.ts
git commit -m "feat(plugin): map the free publish allowance and limit to result lines

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Publish screen, license copy, and wiring

**Files:**
- Modify: `packages/plugin/src/ui/screens/publish.ts`
- Modify: `packages/plugin/src/ui/screens/license.ts`
- Modify: `packages/plugin/src/ui/ui-vnext.ts`
- Test: `packages/plugin/test/publishScreen.test.ts`, `packages/plugin/test/licenseScreen.test.ts`

**Interfaces:**
- Consumes: `PublishAllowance`, `publishAllowance`, `publishAllowanceCopy` from `viewModel/allowance.ts`; `publishAuth` from `ui/proxy.ts`.
- Produces:
  ```ts
  export function publishScrollMarkup(state: PublishState, allowance: PublishAllowance): string;
  export function publishFooterMarkup(state: PublishState): string;
  export function renderPublishScreen(refs: ShellRefs, state: PublishState, allowance: PublishAllowance): void;
  export const LIBRARY_DEFINITION = 'A library is this Figma file, published for developers to pull with the CLI.';
  ```

- [ ] **Step 1: Rewrite the screen tests**

In `packages/plugin/test/publishScreen.test.ts`:

- Change `proScroll` to `const proScroll = (s: PublishState) => publishScrollMarkup(s, { kind: 'hidden' });` and `proFooter` to `publishFooterMarkup(s)`.
- Delete the whole `describe('publish screen on a free plan', ...)` block and the `is offered on a locked screen too` case.
- Add:

```ts
import type { PublishAllowance } from '../src/ui/viewModel/allowance';

const FREE: PublishAllowance = { kind: 'free', remaining: 3, limit: 10, resetsAt: '2026-10-01T00:00:00.000Z' };

describe('publish screen definition and allowance', () => {
  it('defines a library in one line at the top of every state', () => {
    for (const status of ALL_STATES) {
      const markup = publishScrollMarkup(state({ status }), FREE);
      expect(markup).toContain('A library is this Figma file, published for developers to pull with the CLI.');
      expect(markup.indexOf('A library is this Figma file')).toBeLessThan(markup.indexOf('<h2>What gets published</h2>'));
    }
  });

  it('shows the updates line on a free plan and nothing on pro or unknown', () => {
    expect(publishScrollMarkup(state(), FREE)).toContain('3 of 10 free updates left this month, resets Oct 1');
    expect(publishScrollMarkup(state(), { kind: 'hidden' })).not.toContain('free updates');
  });

  it('keeps Publish enabled at zero remaining, since the server decides', () => {
    const zero: PublishAllowance = { ...FREE, remaining: 0 };
    expect(publishScrollMarkup(state(), zero)).toContain('No free updates left this month, resets Oct 1');
    const footer = publishFooterMarkup(state());
    expect(footer).toContain('data-publish');
    expect(footer).not.toContain('disabled');
  });

  it('always offers rotate to a device holding the key, on every plan', () => {
    expect(publishScrollMarkup(PUBLISHED, FREE)).toContain('data-publish-rotate');
    expect(publishScrollMarkup(state({ libraryId: LIBRARY_ID, pullKey: null }), FREE))
      .toContain('Rotate the key to issue a new one.');
  });

  it('keeps the plugin voice: no em dashes on any plan', () => {
    const all = [
      ...ALL_STATES.map((status) => publishScrollMarkup(state({ status }), FREE)),
      publishScrollMarkup(PUBLISHED, FREE),
      ...ALL_STATES.map((status) => publishFooterMarkup(state({ status }))),
    ].join('');
    expect(all).not.toContain('—');
    expect(all).not.toContain('Pro plan required');
  });
});
```

In `packages/plugin/test/licenseScreen.test.ts` line 68, change the expectation to `'Up to 10 published Figma files, no monthly cap on AI writing or updates'`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/plugin/test/publishScreen.test.ts packages/plugin/test/licenseScreen.test.ts`
Expected: FAIL (signature and copy).

- [ ] **Step 3: Implement the screen**

In `packages/plugin/src/ui/screens/publish.ts`:

- Import `publishAllowanceCopy, type PublishAllowance` from `'../viewModel/allowance'`.
- Delete the `PRO_ONLY` constant and its comment.
- Add:

```ts
/**
 * Defines the noun the screen counts. "Library" is the technical name the CLI
 * and proxy use; the allowance below counts Figma files and updates, so the
 * two have to be tied together once, where both are visible.
 */
export const LIBRARY_DEFINITION =
  'A library is this Figma file, published for developers to pull with the CLI.';
```

- `publishScrollMarkup(state, allowance)`: remove the `locked` parameter and every `locked ? ... : ...` branch (rotate button and hint are always rendered; the id-only paragraph always says "Rotate the key to issue a new one."; the paywall section is gone; `BEFORE_FIRST_PUBLISH` shows whenever `!setup`). Insert, as the first child of `.sl-publish-body`:

```ts
    `<p class="sl-publish-definition">${LIBRARY_DEFINITION}</p>` +
```

and, immediately after the "What gets published" section:

```ts
    (allowanceLine ? `<p class="sl-publish-allowance">${esc(allowanceLine)}</p>` : '') +
```

where `const allowanceLine = publishAllowanceCopy(allowance);`.

- `publishFooterMarkup(state)`: remove the `locked` parameter and the `if (locked)` block.
- `renderPublishScreen(refs, state, allowance)`: pass `allowance` to the scroll markup and nothing to the footer.

In `packages/plugin/src/ui/design-system/patterns.css`, directly after the `.sl-publish-hint` rule (near line 1331), add:

```css
.sl-publish-definition {
  margin: 0 0 var(--sl-space-8);
  color: var(--sl-color-text-quiet);
  font-size: var(--sl-font-size-caption);
}

.sl-publish-allowance {
  margin: var(--sl-space-4) 0 0;
  color: var(--sl-color-text-quiet);
  font-size: var(--sl-font-size-caption);
}
```

In `packages/plugin/src/ui/screens/license.ts`, change the Pro `detail` string to `'Up to 10 published Figma files, no monthly cap on AI writing or updates'`.

- [ ] **Step 4: Wire `ui-vnext.ts`**

- Replace the import of `publishLocked` with `publishAllowance`.
- Delete `isPublishLocked()`.
- In `paint()`: `renderPublishScreen(refs, publishState(), publishAllowance(state.quota));`.
- Import `publishAuth` from `./proxy`. In the three publish call sites (the `[data-publish]` click handler, the `[data-publish-rotate]` click handler, and the `'publishSources'` message case), replace `effectiveAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId, state.licenseActive)` with `publishAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId)` and delete the two `if (isPublishLocked()) return;` guards and their comments.
- In `refreshQuota`, the trailing comment about "the unlocked primary" becomes: "The publish screen paints its updates line from the plan, and the first quota answer usually lands after the panel has drawn a screen."

- [ ] **Step 5: Verify**

Run: `npx vitest run packages/plugin && npm run typecheck && npm run lint && npm run build:plugin && npm run check:sandbox`
Expected: all PASS. Then grep for stale copy:

```bash
grep -rn "Pro plan required\|Publishing is part of Pro\|needs Pro\|publishLocked\|isPublishLocked" packages/plugin/src
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/ui/screens/publish.ts packages/plugin/src/ui/screens/license.ts packages/plugin/src/ui/ui-vnext.ts packages/plugin/src/ui/design-system/patterns.css packages/plugin/test/publishScreen.test.ts packages/plugin/test/licenseScreen.test.ts
git commit -m "feat(plugin): open the publish screen to every plan with an updates line

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Website copy

**Files:**
- Modify: `apps/website/content/index.html`
- Modify: `apps/website/content/docs/quickstart.html`

These two files carry uncommitted edits from another session. Make only the string replacements below, stage only these two files, and leave every other hunk as it is.

- [ ] **Step 1: Replace strings in `index.html`**

Each replacement is one exact substring; use the Edit tool.

1. `Publish your library with Pro, then pull it into your repository with the CLI.` → `Publish your library, then pull it into your repository with the CLI.`
2. In the Free plan list, after `<li>20 AI writing uses in your first 30 days, then 10/month</li>` insert `<li>Publish 1 Figma file as a library, 10 updates a month</li>`.
3. `<li>Publish libraries for developers to pull with the CLI</li>` → `<li>Publish up to 10 files as libraries, unlimited updates</li>`.
4. The FAQ answer beginning `No. Component specs, foundation docs, source-change tracking, and Copy for AI are free.` → replace the whole `<p>` with:
   `<p>No. Component specs, foundation docs, source-change tracking, Copy for AI, and publishing one Figma file with 10 updates a month are free. Only optional AI writing has a free usage allowance. Pro adds up to 10 published files, unlimited updates, more AI writing, and priority support.</p>`
5. After the `</details>` that closes `What uses my AI writing allowance?`, insert:
   `<details><summary>What counts as a publish update?</summary><p>One successful publish that changed the library counts as one update. Failed publishes do not count. Publishing again with nothing changed does not count. Pulling with the CLI never counts.</p></details>`

- [ ] **Step 2: Replace the quickstart notice**

In `apps/website/content/docs/quickstart.html`: `Canvas documentation and Copy for AI are free. Publishing a library requires Pro.` → `Canvas documentation, Copy for AI, and publishing one Figma file are free.`

Then grep the quickstart for any other `Pro` prerequisite in its publish section and remove it:

```bash
grep -n -i "pro\b" apps/website/content/docs/quickstart.html
```

- [ ] **Step 3: Verify**

Run: `npm run check --prefix apps/website`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/website/content/index.html apps/website/content/docs/quickstart.html
git commit -m "feat(website): describe free publishing and the monthly update allowance

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

If `git diff --cached` shows hunks unrelated to the strings above, the other session's edits were caught. Run `git reset apps/website` and re-stage with `git add -p` selecting only the hunks named here.

---

### Task 13: Repository docs and the manual matrix

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-07-11-freemium-model-design.md`
- Modify: `packages/plugin/TESTING.md`

- [ ] **Step 1: CHANGELOG**

Under `## [Unreleased]` → `### Added`, add as the first entry:

```markdown
- **Free library publishing.** A free plan publishes one Figma file as a
  library with 10 changed publishes per UTC month; Pro keeps 10 libraries
  with no fixed cap and the same fair-use flag AI writing has. A publish
  counts only when it commits, and republishing an unchanged bundle is
  answered from a 24-hour cache without a write or a count. Library
  ownership is proved by whichever identity the request carries, the
  license key or the Figma identity, so a library created while free stays
  writable after upgrading and a Pro library stays writable after the
  license lapses. Publish responses carry the quota headers, `GET /v1/quota`
  gains a `publish` snapshot, and the plugin's publish screen replaces its
  paywall with a definition line and an updates meter. Rotation has no tier
  check. Pull is unchanged.
```

Under `### Changed` (create the heading if absent), add:

```markdown
- The plugin sends `X-Figma-User` alongside the license bearer whenever it
  knows both, and publish and rotate keep sending a lapsed key because it
  proves ownership. AI writing still meters against the license when one is
  present.
```

- [ ] **Step 2: Freemium spec pointer**

At the top of `docs/superpowers/specs/2026-07-11-freemium-model-design.md`, after the `**Scope:**` line, add:

```markdown
**Note (2026-09-08):** Library publishing is no longer Pro-only. The free
allowance for publishing and the ownership rule are specified in
`2026-09-08-free-publish-quota-design.md`; the Pro tier table below predates it.
```

- [ ] **Step 3: TESTING.md**

In `## Publish and pull`, replace the row

```
- [ ] Free license: publish shows the Pro copy and publishes nothing. The
      Library footer's **Publish** still opens the screen.
```

with:

```
- [ ] Free plan publish and pull (no license key entered): the screen opens
      with the definition line and "10 of 10 free updates left this month";
      Publish creates a library and shows the setup command; the CLI setup
      command pulls it. Publish again without changes: the status line reads
      "Nothing changed since the last publish." and the meter still shows 9.
      Edit a token and publish: the meter shows 8. Open a second file and
      publish: the status names the first file and offers Upgrade to Pro.
- [ ] Free plan at the cap: after 10 changed publishes in one month the status
      line names the reset date and Publish stays enabled.
- [ ] Lapsed Pro key with a library published while Pro: Publish updates it
      and the meter appears; Rotate key works.
```

In the row `Copy for an AI agent`, change `is present on a locked (free) screen` to `is present on a free plan`.

In the `Gone library` row, change `or belongs to another license` to `or belongs to another account`.

- [ ] **Step 4: Verify and commit**

Run: `npm run check:nul`

```bash
git add CHANGELOG.md docs/superpowers/specs/2026-07-11-freemium-model-design.md packages/plugin/TESTING.md
git commit -m "docs: record free publishing in the changelog, freemium spec, and test matrix

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Full gate and pull request

- [ ] **Step 1: Run the full local gate**

Run: `npm run check`
Expected: lint, typecheck, NUL scan, tests, plugin build, CLI build, bundle smoke, sandbox scan, and proxy deploy dry run all PASS. Read the exit code directly; do not pipe.

Run: `npm run check --prefix apps/website`
Expected: PASS.

- [ ] **Step 2: Mark the plan's checkboxes and commit the plan file**

```bash
git add docs/superpowers/plans/2026-09-08-free-publish-quota.md
git commit -m "docs: free publish quota implementation plan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 3: Push and open the pull request**

```bash
git push -u origin spec/free-publish-quota
gh pr create --title "feat: free library publishing with a monthly update allowance" --body "$(cat <<'EOF'
## Summary
- Free plans publish 1 library with 10 changed publishes per UTC month; Pro keeps 10 libraries with no fixed cap.
- Library ownership is proved by the license key or the Figma identity, so upgrading and lapsing need no migration.
- Publish responses carry quota headers, `/v1/quota` gains a `publish` snapshot, unchanged republishes replay from cache.
- Plugin publish screen drops its paywall for a definition line and an updates meter; website and docs updated.

Spec: `docs/superpowers/specs/2026-09-08-free-publish-quota-design.md`
Plan: `docs/superpowers/plans/2026-09-08-free-publish-quota.md`

## Rollout
Deploy the proxy first (`npm run deploy -w @spec-layer/proxy`), then the plugin, then the website.

## Test plan
- [ ] `npm run check` green
- [ ] `npm run check --prefix apps/website` green
- [ ] Manual matrix rows added in `packages/plugin/TESTING.md` under Publish and pull

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If the push returns 403, the active `gh` account is not the repository owner. Stop and ask the user to switch accounts; do not retry.

- [ ] **Step 4: Report**

State the PR URL, the test counts from `npm run check`, and that the proxy must be deployed before the plugin is republished.
