# Library Publish and Pull CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pro users publish their library's Copy for AI context (Foundation v5 + component contexts) from the Figma plugin to the proxy; developers pull it into their repo with `npx spec-layer pull`.

**Architecture:** Three new routes on the existing Cloudflare Worker store an opaque "library bundle" in KV, license-gated for publish and pull-key-gated for read. The plugin UI assembles the bundle from the same extractor code paths Copy for AI already uses (one code path produces all v5 output) and POSTs it. A new zero-dependency Node CLI (`packages/cli`, npm name `spec-layer`) pulls the bundle and writes canonical JSON + ai-profile YAML files into the dev's repo.

**Tech Stack:** TypeScript, Vitest, esbuild, Cloudflare Workers KV, Node >= 22 built-ins (`fetch`, `util.parseArgs`, `node:crypto`, `node:fs`).

**Spec:** `docs/superpowers/specs/2026-09-01-library-publish-cli-design.md`

## Global Constraints

- Node >= 22. The CLI uses only Node built-ins at runtime (no runtime deps).
- The CLI must NOT depend on `@spec-layer/extractor`. The plugin publishes both the canonical artifacts and the ai-profile YAML; the CLI is a dumb transport.
- `packages/extractor` must never touch Figma globals (existing invariant — unchanged, but publish code lives in the plugin UI iframe, never the main thread).
- No `localeCompare` anywhere in this work. Component ordering uses `compareCodeUnits` from `@spec-layer/extractor` (plugin side); the CLI preserves bundle order and never sorts.
- Plugin UI copy: sentence case, second person, NO EM DASHES, honest about limits (`docs/plugin-voice-and-copy.md`).
- Commits: single-line conventional, lowercase, scoped (`feat(proxy): ...`, `feat(cli): ...`, `feat(plugin): ...`, `docs: ...`).
- Never store a pull key server-side — only its sha256. Never put a key in a URL.
- Bundle size cap: `MAX_BUNDLE_CHARS = 5_000_000`. Library cap per license: `LIBRARY_LIMIT = 10`.
- Bundle schema string: `'spec-layer-library-bundle'`, bundle version `'1.0.0'`.
- Id formats: library id `lib_` + 24 hex; pull key `sl_` + 48 hex.
- Tests must use synthetic fixtures only (existing invariant).
- Run `npm test` scoped where possible (`npx vitest run packages/proxy` etc.); run `npm run check` at the end of plugin tasks and the final task.

## Shared wire contracts (reference for every task)

**Bundle** (built by plugin, stored verbatim by proxy, parsed by CLI):

```jsonc
{
  "schema": "spec-layer-library-bundle",
  "version": "1.0.0",
  "fileName": "Design System" /* or null */,
  "pluginVersion": "5.0.0" /* or null */,
  "extractorVersion": "2",
  "foundation": { "ai": "<yaml string>", "artifact": { /* FoundationArtifactV5 */ } } /* or null */,
  "components": [ { "name": "Button", "ai": "<yaml string>", "artifact": { /* ComponentArtifactV5 */ } } ]
}
```

Each artifact already carries its own hash at `artifact.spec_layer.export.content_hash` — the bundle adds no duplicate hash fields.

**Proxy API:**

- `POST /v1/libraries` — body `{ "libraryId"?: "lib_...", "bundle": {...} }`, auth `Authorization: Bearer <licenseKey[:instanceId]>`, Pro required. Create (no libraryId): 201 `{ libraryId, pullKey, publishedAt }`. Republish: 200 `{ libraryId, publishedAt }`. Errors: 401 `unauthenticated` / `license_not_active`, 400 `invalid bundle` / `invalid libraryId` / `invalid json`, 403 `not_owner` / `library_limit`, 404 `not_found`, 413 `bundle_too_large`, 429 `rate_limited`.
- `GET /v1/libraries/:id` — auth `Authorization: Bearer sl_...`. 200: stored bundle bytes verbatim, headers `ETag: "<sha256 of body>"`, `X-Published-At: <iso>`. `If-None-Match` matching the ETag: 304 with the same headers, empty body. Errors: 401 `invalid_key`, 404 `not_found`, 429 `rate_limited`.
- `POST /v1/libraries/:id/rotate` — license auth, Pro, owner only. 200 `{ pullKey }`. Errors as publish plus 403 `not_owner`.

**KV layout** (existing `LICENSE_CACHE` namespace, new `libraryStore` dep in `HandlerDeps` wired to the same binding):

- `lib:<id>:bundle` → bundle JSON string (exactly `JSON.stringify(body.bundle)`)
- `lib:<id>:meta` → `{ keyHash, licenseId, publishedAt, bundleHash, size, fileName }`
- `libowner:<licenseId>` → JSON array of owned library ids

---

### Task 1: Proxy library module — ids, keys, meta, publish handler

**Files:**
- Modify: `packages/proxy/src/identity.ts` (move `licenseIdentityId` here from handlers.ts)
- Modify: `packages/proxy/src/handlers.ts` (re-export `licenseIdentityId` from identity, add `libraryStore: KVLike` to `HandlerDeps`)
- Create: `packages/proxy/src/libraries.ts`
- Test: `packages/proxy/test/libraries.test.ts`

**Interfaces:**
- Consumes: `identityFromHeaders`, `checkLicense`, `KVLike` (from `./license`), `HandlerDeps`, `SlidingWindowLimiter`, `sha256` from `js-sha256`.
- Produces: `handlePublish(req: Request, deps: HandlerDeps): Promise<Response>`, `newLibraryId(): string`, `newPullKey(): string`, `LIBRARY_ID_RE`, `PULL_KEY_RE`, `MAX_BUNDLE_CHARS`, `LIBRARY_LIMIT`, `interface LibraryMeta { keyHash: string; licenseId: string; publishedAt: string; bundleHash: string; size: number; fileName: string | null }`. Tasks 2–3 add `handlePull`/`handleRotate` to the same file; Task 3 wires routing.

- [ ] **Step 1: Move `licenseIdentityId` to identity.ts**

In `packages/proxy/src/identity.ts` add (import of `sha256` already exists):

```ts
/** Quota/DO identity for a license — hashed so the raw key never reaches DO names or logs. */
export function licenseIdentityId(key: string): string {
  return `lic:${sha256(key)}`;
}
```

In `packages/proxy/src/handlers.ts`, delete the local definition and replace with a re-export so existing imports keep working:

```ts
import { identityFromHeaders, licenseIdentityId } from './identity';
export { licenseIdentityId };
```

Remove `licenseIdentityId`'s use of the handlers-local `sha256` import only if it becomes unused (it is still used by `validateProseBody`? No — check; `sha256` is used at line 14 only, so remove the import if the linter flags it. `handlers.ts` imports `sha256` solely for `licenseIdentityId`; delete the import).

- [ ] **Step 2: Add `libraryStore` to `HandlerDeps`**

In `packages/proxy/src/handlers.ts`:

```ts
export interface HandlerDeps {
  // ...existing fields unchanged...
  /** Library bundle storage. Wired to the same KV namespace as licenseCache
   *  today; a separate dep so a dedicated namespace later is a one-line change. */
  libraryStore: KVLike;
}
```

Update every `deps(...)` builder in `packages/proxy/test/handlers.test.ts` and `packages/proxy/test/router.test.ts` to add `libraryStore: new MemKV()`.

- [ ] **Step 3: Run existing proxy tests to confirm the refactor is clean**

Run: `npx vitest run packages/proxy`
Expected: PASS (typecheck failures would surface here via vitest's TS transform only partially — also run `npm run typecheck`).

- [ ] **Step 4: Commit the refactor**

```bash
git add packages/proxy/src/identity.ts packages/proxy/src/handlers.ts packages/proxy/test/handlers.test.ts packages/proxy/test/router.test.ts
git commit -m "refactor(proxy): move licenseIdentityId to identity, add libraryStore dep"
```

- [ ] **Step 5: Write failing tests for publish**

Create `packages/proxy/test/libraries.test.ts`. Reuse the `MemKV` class shape from `handlers.test.ts` (copy it — tests don't import from other test files here). The license fixture: `checkLicense` hits the fetcher; the simplest Pro setup mirrors `license.test.ts` — seed the license cache the way `handlers.test.ts` does for its Pro cases (read that file's Pro fixture and copy the exact seeding). Key test cases:

```ts
import { describe, it, expect } from 'vitest';
import { sha256 } from 'js-sha256';
import { handlePublish, newLibraryId, newPullKey, LIBRARY_ID_RE, PULL_KEY_RE, MAX_BUNDLE_CHARS, LIBRARY_LIMIT, type LibraryMeta } from '../src/libraries';

const BUNDLE = {
  schema: 'spec-layer-library-bundle', version: '1.0.0', fileName: 'Test File',
  pluginVersion: '5.0.0', extractorVersion: '2',
  foundation: { ai: 'tokens: {}\n', artifact: { spec_layer: { export: { content_hash: 'aaa' } } } },
  components: [{ name: 'Button', ai: 'component: Button\n', artifact: { spec_layer: { export: { content_hash: 'bbb' } } } }],
};

function publishReq(body: unknown, key = UUID_KEY) {
  return new Request('https://proxy.test/v1/libraries', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
}

describe('id and key generation', () => {
  it('generates well-formed ids and keys', () => {
    expect(newLibraryId()).toMatch(LIBRARY_ID_RE);
    expect(newPullKey()).toMatch(PULL_KEY_RE);
    expect(newPullKey()).not.toBe(newPullKey());
  });
});

describe('handlePublish', () => {
  it('rejects unauthenticated requests', async () => { /* no Authorization header -> 401 unauthenticated */ });
  it('rejects a free-tier license', async () => { /* seeded free license -> 401 license_not_active */ });
  it('creates a library on first publish', async () => {
    // Pro-seeded deps. Expect 201, body { libraryId matching LIBRARY_ID_RE,
    // pullKey matching PULL_KEY_RE, publishedAt ISO string }.
    // KV assertions: lib:<id>:bundle === JSON.stringify(BUNDLE);
    // meta.keyHash === sha256(pullKey); meta.licenseId === `lic:${sha256(UUID_KEY)}`;
    // meta.bundleHash === sha256(JSON.stringify(BUNDLE));
    // libowner:<licenseId> === [libraryId]. And the raw pullKey appears in NO stored value.
  });
  it('republishes to an owned library without rotating the key', async () => {
    // Publish once, capture id+key, publish again with { libraryId, bundle }.
    // Expect 200, body has NO pullKey field, same libraryId, meta.keyHash unchanged,
    // bundle overwritten, owner list still length 1.
  });
  it('rejects republish to a library owned by another license', async () => { /* 403 not_owner */ });
  it('404s a republish to an unknown libraryId', async () => { /* 404 not_found */ });
  it('rejects a malformed bundle', async () => { /* bundle without schema field -> 400 invalid bundle */ });
  it('rejects an oversized bundle', async () => {
    // components[0].ai = 'x'.repeat(MAX_BUNDLE_CHARS) -> 413 with { error: 'bundle_too_large', size, limit }
  });
  it('caps libraries per license', async () => {
    // Pre-seed libowner list with LIBRARY_LIMIT ids -> 403 { error: 'library_limit', limit: 10 }
  });
  it('rate limits per IP', async () => { /* limiter with limit 1: second call -> 429 */ });
});
```

Write the cases in full (the comments above describe the assertions to write, not placeholders to leave).

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run packages/proxy/test/libraries.test.ts`
Expected: FAIL — `Cannot find module '../src/libraries'`.

- [ ] **Step 7: Implement `packages/proxy/src/libraries.ts` (publish half)**

```ts
import { sha256 } from 'js-sha256';
import { identityFromHeaders, licenseIdentityId } from './identity';
import { checkLicense } from './license';
import type { HandlerDeps } from './handlers';

export const MAX_BUNDLE_CHARS = 5_000_000;
export const LIBRARY_LIMIT = 10;
export const LIBRARY_ID_RE = /^lib_[0-9a-f]{24}$/;
export const PULL_KEY_RE = /^sl_[0-9a-f]{48}$/;

export interface LibraryMeta {
  /** sha256 of the pull key. The key itself is never stored. */
  keyHash: string;
  licenseId: string;
  publishedAt: string;
  bundleHash: string;
  size: number;
  fileName: string | null;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const newLibraryId = (): string => `lib_${randomHex(12)}`;
export const newPullKey = (): string => `sl_${randomHex(24)}`;

/** License-authenticated Pro caller, or the error Response to return. */
async function proCaller(req: Request, deps: HandlerDeps): Promise<{ licenseId: string } | Response> {
  const identity = identityFromHeaders(req.headers, deps.salt);
  if (!identity || identity.kind !== 'license') return json(401, { error: 'unauthenticated' });
  const lic = await checkLicense(identity.key, identity.instanceId, {
    fetcher: deps.fetcher, cache: deps.licenseCache, now: deps.now,
  });
  if (lic.tier !== 'pro') return json(401, { error: 'license_not_active', reason: lic.reason });
  return { licenseId: licenseIdentityId(identity.key) };
}

export async function handlePublish(req: Request, deps: HandlerDeps): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.licenseLimiter.allow(`libpub:${ip}`, deps.now())) return json(429, { error: 'rate_limited' });
  const caller = await proCaller(req, deps);
  if (caller instanceof Response) return caller;

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BUNDLE_CHARS + 4096) {
    return json(413, { error: 'bundle_too_large', size: declared, limit: MAX_BUNDLE_CHARS });
  }
  let raw: string;
  try { raw = await req.text(); } catch { return json(400, { error: 'invalid body' }); }
  if (raw.length > MAX_BUNDLE_CHARS + 4096) {
    return json(413, { error: 'bundle_too_large', size: raw.length, limit: MAX_BUNDLE_CHARS });
  }
  let body: { libraryId?: unknown; bundle?: unknown };
  try { body = JSON.parse(raw) as typeof body; } catch { return json(400, { error: 'invalid json' }); }

  const bundle = body.bundle as Record<string, unknown> | null;
  if (
    !bundle || typeof bundle !== 'object' || Array.isArray(bundle) ||
    bundle.schema !== 'spec-layer-library-bundle' ||
    typeof bundle.version !== 'string' ||
    !Array.isArray(bundle.components)
  ) {
    return json(400, { error: 'invalid bundle' });
  }
  const stored = JSON.stringify(bundle);
  if (stored.length > MAX_BUNDLE_CHARS) {
    return json(413, { error: 'bundle_too_large', size: stored.length, limit: MAX_BUNDLE_CHARS });
  }
  const fileName = typeof bundle.fileName === 'string' ? bundle.fileName : null;
  const publishedAt = new Date(deps.now()).toISOString();
  const bundleHash = sha256(stored);

  if (body.libraryId !== undefined) {
    if (typeof body.libraryId !== 'string' || !LIBRARY_ID_RE.test(body.libraryId)) {
      return json(400, { error: 'invalid libraryId' });
    }
    const metaRaw = await deps.libraryStore.get(`lib:${body.libraryId}:meta`);
    if (metaRaw === null) return json(404, { error: 'not_found' });
    const meta = JSON.parse(metaRaw) as LibraryMeta;
    if (meta.licenseId !== caller.licenseId) return json(403, { error: 'not_owner' });
    const next: LibraryMeta = { ...meta, publishedAt, bundleHash, size: stored.length, fileName };
    await deps.libraryStore.put(`lib:${body.libraryId}:bundle`, stored);
    await deps.libraryStore.put(`lib:${body.libraryId}:meta`, JSON.stringify(next));
    deps.log('library_publish', { libraryId: body.libraryId, size: stored.length });
    return json(200, { libraryId: body.libraryId, publishedAt });
  }

  const ownerKey = `libowner:${caller.licenseId}`;
  const owned = JSON.parse((await deps.libraryStore.get(ownerKey)) ?? '[]') as string[];
  if (owned.length >= LIBRARY_LIMIT) return json(403, { error: 'library_limit', limit: LIBRARY_LIMIT });
  const libraryId = newLibraryId();
  const pullKey = newPullKey();
  const meta: LibraryMeta = {
    keyHash: sha256(pullKey), licenseId: caller.licenseId, publishedAt, bundleHash, size: stored.length, fileName,
  };
  await deps.libraryStore.put(`lib:${libraryId}:bundle`, stored);
  await deps.libraryStore.put(`lib:${libraryId}:meta`, JSON.stringify(meta));
  await deps.libraryStore.put(ownerKey, JSON.stringify([...owned, libraryId]));
  deps.log('library_publish', { libraryId, size: stored.length, created: true });
  return json(201, { libraryId, pullKey, publishedAt });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run packages/proxy/test/libraries.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/proxy/src/libraries.ts packages/proxy/test/libraries.test.ts
git commit -m "feat(proxy): add library publish endpoint storing bundles in kv"
```

---

### Task 2: Proxy pull handler with conditional requests

**Files:**
- Modify: `packages/proxy/src/libraries.ts`
- Test: `packages/proxy/test/libraries.test.ts` (extend)

**Interfaces:**
- Consumes: `LibraryMeta`, `PULL_KEY_RE`, KV layout from Task 1.
- Produces: `handlePull(req: Request, deps: HandlerDeps, libraryId: string): Promise<Response>`.

- [ ] **Step 1: Write failing tests**

Add to `packages/proxy/test/libraries.test.ts` (a helper that first publishes via `handlePublish` and returns `{ deps, libraryId, pullKey }` keeps these short):

```ts
function pullReq(libraryId: string, key: string, etag?: string) {
  return new Request(`https://proxy.test/v1/libraries/${libraryId}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}`, ...(etag ? { 'If-None-Match': etag } : {}) },
  });
}

describe('handlePull', () => {
  it('returns the stored bundle bytes verbatim with ETag and X-Published-At', async () => {
    // 200; await res.text() === JSON.stringify(BUNDLE) (byte-for-byte);
    // ETag === `"${sha256(JSON.stringify(BUNDLE))}"`; X-Published-At is the publish time;
    // content-type application/json.
  });
  it('returns 304 with headers and empty body on a matching If-None-Match', async () => {});
  it('returns the full body when If-None-Match does not match', async () => {});
  it('rejects a malformed key', async () => { /* 'Bearer nope' -> 401 invalid_key */ });
  it('rejects a well-formed wrong key', async () => { /* sl_ + 48 zeros -> 401 invalid_key */ });
  it('404s an unknown library id', async () => {});
  it('still serves pulls after the license lapses', async () => {
    // Publish while Pro, then flip the license fixture to free (re-seed cache) and pull: 200.
    // This is the spec's "bundles stay pullable" guarantee.
  });
  it('rate limits pulls per IP', async () => { /* requestLimiter limit 1 -> second call 429 */ });
});
```

Write the assertions in full.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/proxy/test/libraries.test.ts`
Expected: FAIL — `handlePull` is not exported.

- [ ] **Step 3: Implement `handlePull`**

Append to `packages/proxy/src/libraries.ts`:

```ts
export async function handlePull(req: Request, deps: HandlerDeps, libraryId: string): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.requestLimiter.allow(`libpull:${ip}`, deps.now())) return json(429, { error: 'rate_limited' });
  const auth = req.headers.get('Authorization') ?? '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!PULL_KEY_RE.test(key)) return json(401, { error: 'invalid_key' });
  const metaRaw = await deps.libraryStore.get(`lib:${libraryId}:meta`);
  if (metaRaw === null) return json(404, { error: 'not_found' });
  const meta = JSON.parse(metaRaw) as LibraryMeta;
  // Digest-vs-digest comparison: timing over two fixed-length hashes reveals
  // nothing about the key itself, so plain equality is safe here.
  if (sha256(key) !== meta.keyHash) return json(401, { error: 'invalid_key' });
  const headers: Record<string, string> = {
    ETag: `"${meta.bundleHash}"`,
    'X-Published-At': meta.publishedAt,
    'content-type': 'application/json',
  };
  if (req.headers.get('If-None-Match') === `"${meta.bundleHash}"`) {
    return new Response(null, { status: 304, headers });
  }
  const bundle = await deps.libraryStore.get(`lib:${libraryId}:bundle`);
  if (bundle === null) return json(404, { error: 'not_found' });
  return new Response(bundle, { status: 200, headers });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/proxy/test/libraries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/libraries.ts packages/proxy/test/libraries.test.ts
git commit -m "feat(proxy): add key-gated library pull with etag conditional requests"
```

---

### Task 3: Proxy rotate handler, routing, CORS, worker wiring

**Files:**
- Modify: `packages/proxy/src/libraries.ts` (add `handleRotate`)
- Modify: `packages/proxy/src/handlers.ts` (`routeInner`, `CORS_HEADERS`)
- Modify: `packages/proxy/src/index.ts` (wire `libraryStore: env.LICENSE_CACHE`)
- Test: `packages/proxy/test/libraries.test.ts`, `packages/proxy/test/router.test.ts` (extend)

**Interfaces:**
- Consumes: `handlePublish`, `handlePull` from Tasks 1–2.
- Produces: `handleRotate(req: Request, deps: HandlerDeps, libraryId: string): Promise<Response>`; live routes `POST /v1/libraries`, `GET /v1/libraries/:id`, `POST /v1/libraries/:id/rotate`.

- [ ] **Step 1: Write failing tests**

Rotate cases in `libraries.test.ts`:

```ts
describe('handleRotate', () => {
  it('rotates the key: old key stops pulling, new key pulls', async () => {
    // 200 { pullKey } matching PULL_KEY_RE and !== old key.
    // handlePull with old key -> 401; with new key -> 200.
    // meta.bundleHash and publishedAt unchanged.
  });
  it('rejects a non-owner license', async () => { /* 403 not_owner */ });
  it('rejects a lapsed license', async () => { /* free-seeded -> 401 license_not_active */ });
  it('404s an unknown library', async () => {});
});
```

Routing cases in `router.test.ts`, following its existing style:

```ts
it('routes POST /v1/libraries to publish', async () => { /* unauthenticated -> 401, NOT 404 */ });
it('routes GET /v1/libraries/lib_<24hex> to pull', async () => { /* bad key -> 401 invalid_key */ });
it('routes POST /v1/libraries/lib_<24hex>/rotate to rotate', async () => { /* unauthenticated -> 401 */ });
it('404s a malformed library id path', async () => { /* GET /v1/libraries/nope -> 404 not_found */ });
it('exposes ETag and X-Published-At through CORS', async () => {
  // Any routed response: Access-Control-Expose-Headers contains 'ETag' and 'X-Published-At'.
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/proxy`
Expected: new cases FAIL (`handleRotate` missing; routes 404).

- [ ] **Step 3: Implement rotate and routing**

`handleRotate` in `libraries.ts`:

```ts
export async function handleRotate(req: Request, deps: HandlerDeps, libraryId: string): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.licenseLimiter.allow(`librot:${ip}`, deps.now())) return json(429, { error: 'rate_limited' });
  const caller = await proCaller(req, deps);
  if (caller instanceof Response) return caller;
  const metaRaw = await deps.libraryStore.get(`lib:${libraryId}:meta`);
  if (metaRaw === null) return json(404, { error: 'not_found' });
  const meta = JSON.parse(metaRaw) as LibraryMeta;
  if (meta.licenseId !== caller.licenseId) return json(403, { error: 'not_owner' });
  const pullKey = newPullKey();
  await deps.libraryStore.put(`lib:${libraryId}:meta`, JSON.stringify({ ...meta, keyHash: sha256(pullKey) }));
  deps.log('library_rotate', { libraryId });
  return json(200, { pullKey });
}
```

In `handlers.ts` add to `routeInner` before the 404 line (and import the three handlers from `./libraries`):

```ts
if (req.method === 'POST' && pathname === '/v1/libraries') return handlePublish(req, deps);
const pull = /^\/v1\/libraries\/(lib_[0-9a-f]{24})$/.exec(pathname);
if (req.method === 'GET' && pull) return handlePull(req, deps, pull[1]);
const rotate = /^\/v1\/libraries\/(lib_[0-9a-f]{24})\/rotate$/.exec(pathname);
if (req.method === 'POST' && rotate) return handleRotate(req, deps, rotate[1]);
```

In `CORS_HEADERS`, extend `Access-Control-Expose-Headers` with `, ETag, X-Published-At` and `Access-Control-Allow-Headers` with `, If-None-Match`.

In `index.ts` deps: `libraryStore: env.LICENSE_CACHE,`.

- [ ] **Step 4: Run the proxy suite and dry-run deploy**

Run: `npx vitest run packages/proxy && npm run typecheck && npm run check:proxy-dry-run`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src packages/proxy/test
git commit -m "feat(proxy): add library rotate endpoint and route library api"
```

---

### Task 4: CLI package scaffold and bundle parser

**Files:**
- Modify: `package.json` (root: rename to `spec-layer-monorepo`, add cli to typecheck, add `build:cli`)
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/build.mjs`
- Create: `packages/cli/src/bundle.ts`
- Test: `packages/cli/test/bundle.test.ts`

**Interfaces:**
- Produces: npm package `spec-layer` with bin `spec-layer`; `parseBundle(raw: string): BundleV1` (throws `Error` with a user-readable message on bad input); types `BundleV1 { schema: 'spec-layer-library-bundle'; version: string; fileName: string | null; pluginVersion: string | null; extractorVersion: string; foundation: { ai: string; artifact: ArtifactLike } | null; components: Array<{ name: string; ai: string; artifact: ArtifactLike }> }` and `ArtifactLike { spec_layer: { export: { content_hash: string } } }`.

- [ ] **Step 1: Scaffold the package**

Root `package.json`: change `"name": "spec-layer"` to `"name": "spec-layer-monorepo"` (the CLI claims the `spec-layer` name; two workspace packages cannot share one name). Extend the typecheck script with ` && tsc -p packages/cli/tsconfig.json --noEmit`, and add `"build:cli": "node packages/cli/build.mjs"` plus insert `npm run build:cli && ` into the `check` and `check:ci` pipelines right after `npm run build:plugin`.

`packages/cli/package.json`:

```json
{
  "name": "spec-layer",
  "version": "0.1.0",
  "description": "Pull design-system context published by the Spec Layer Figma plugin",
  "license": "MIT",
  "type": "module",
  "bin": { "spec-layer": "dist/cli.js" },
  "files": ["dist"],
  "engines": { "node": ">=22.0.0" },
  "scripts": { "build": "node build.mjs" },
  "devDependencies": { "esbuild": "^0.28.1" }
}
```

`packages/cli/tsconfig.json` (mirrors proxy's):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"], "lib": ["ES2022"], "noEmit": true },
  "include": ["src/**/*.ts"]
}
```

`packages/cli/build.mjs`:

```js
import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  outfile: 'dist/cli.js',
  absWorkingDir: new URL('.', import.meta.url).pathname,
});
```

Note: `build:cli` will fail until `src/cli.ts` exists (Task 7). Until then create a minimal `packages/cli/src/cli.ts` placeholder that only prints usage and exits 1 — Task 7 replaces it entirely:

```ts
process.stderr.write('spec-layer: commands arrive in a later task\n');
process.exitCode = 1;
```

Run `npm install` once so the workspace registers.

- [ ] **Step 2: Write failing tests for parseBundle**

`packages/cli/test/bundle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseBundle } from '../src/bundle';

const GOOD = {
  schema: 'spec-layer-library-bundle', version: '1.0.0', fileName: 'DS',
  pluginVersion: '5.0.0', extractorVersion: '2',
  foundation: { ai: 'a: 1\n', artifact: { spec_layer: { export: { content_hash: 'f'.repeat(64) } } } },
  components: [{ name: 'Button', ai: 'b: 2\n', artifact: { spec_layer: { export: { content_hash: 'c'.repeat(64) } } } }],
};

describe('parseBundle', () => {
  it('parses a valid bundle', () => {
    const b = parseBundle(JSON.stringify(GOOD));
    expect(b.components[0].name).toBe('Button');
    expect(b.foundation?.ai).toBe('a: 1\n');
  });
  it('accepts a null foundation', () => { /* GOOD with foundation: null */ });
  it('rejects non-JSON', () => { expect(() => parseBundle('nope')).toThrow(/not valid JSON/); });
  it('rejects a wrong schema', () => { /* schema: 'other' -> /not a Spec Layer library bundle/ */ });
  it('rejects a component without name, ai, or content hash', () => { /* three cases */ });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/cli`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement `packages/cli/src/bundle.ts`**

```ts
export interface ArtifactLike { spec_layer: { export: { content_hash: string } } }
export interface BundleEntry { name: string; ai: string; artifact: ArtifactLike }
export interface BundleV1 {
  schema: 'spec-layer-library-bundle';
  version: string;
  fileName: string | null;
  pluginVersion: string | null;
  extractorVersion: string;
  foundation: { ai: string; artifact: ArtifactLike } | null;
  components: BundleEntry[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function contentHash(artifact: unknown): string | null {
  if (!isRecord(artifact) || !isRecord(artifact.spec_layer)) return null;
  const exp = (artifact.spec_layer as Record<string, unknown>).export;
  if (!isRecord(exp) || typeof exp.content_hash !== 'string') return null;
  return exp.content_hash;
}

function entry(v: unknown, where: string): BundleEntry {
  if (!isRecord(v) || typeof v.name !== 'string' || typeof v.ai !== 'string' || contentHash(v.artifact) === null) {
    throw new Error(`The ${where} entry in this bundle is malformed.`);
  }
  return v as unknown as BundleEntry;
}

export function parseBundle(raw: string): BundleV1 {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('The server response is not valid JSON.'); }
  if (!isRecord(parsed) || parsed.schema !== 'spec-layer-library-bundle') {
    throw new Error('The server response is not a Spec Layer library bundle.');
  }
  if (typeof parsed.version !== 'string' || typeof parsed.extractorVersion !== 'string' || !Array.isArray(parsed.components)) {
    throw new Error('This bundle is missing required fields.');
  }
  const foundation = parsed.foundation ?? null;
  if (foundation !== null) {
    if (!isRecord(foundation) || typeof foundation.ai !== 'string' || contentHash(foundation.artifact) === null) {
      throw new Error('The foundation entry in this bundle is malformed.');
    }
  }
  const components = (parsed.components as unknown[]).map((c, i) => entry(c, `component ${i}`));
  return {
    schema: 'spec-layer-library-bundle',
    version: parsed.version,
    fileName: typeof parsed.fileName === 'string' ? parsed.fileName : null,
    pluginVersion: typeof parsed.pluginVersion === 'string' ? parsed.pluginVersion : null,
    extractorVersion: parsed.extractorVersion,
    foundation: foundation as BundleV1['foundation'],
    components,
  };
}
```

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `npx vitest run packages/cli && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json packages/cli
git commit -m "feat(cli): scaffold spec-layer package with bundle parser"
```

---

### Task 5: CLI config and option resolution

**Files:**
- Create: `packages/cli/src/config.ts`
- Test: `packages/cli/test/config.test.ts`

**Interfaces:**
- Consumes: `readManifest` arrives in Task 6 — to avoid a forward dependency, `resolveOptions` takes the manifest's libraryId as an injected loader: `manifestLibraryId: (outDir: string) => string | null`. Task 7 wires the real loader.
- Produces:
  - `readConfig(cwd: string): { libraryId?: string; outDir?: string } | null` (reads `<cwd>/speclayer.json`; returns null when absent; throws with a readable message when unparsable)
  - `writeConfig(cwd: string, config: { libraryId: string; outDir: string }): void`
  - `resolveOptions(cwd: string, flags: { id?: string; out?: string; key?: string; api?: string }, env: Record<string, string | undefined>, manifestLibraryId: (outDir: string) => string | null): { libraryId: string | null; outDir: string; api: string; key: string | null }`
  - `DEFAULT_API = 'https://api.spec-layer.com'`, `DEFAULT_OUT_DIR = '.speclayer'`

- [ ] **Step 1: Write failing tests**

`packages/cli/test/config.test.ts`, using `fs.mkdtempSync(join(tmpdir(), 'sl-'))` for isolation:

```ts
describe('resolveOptions precedence', () => {
  it('flag beats config beats manifest for libraryId', () => {});
  it('falls back to the manifest loader when no flag or config', () => {});
  it('returns null libraryId when nothing supplies one', () => {});
  it('key comes from --key, then SPEC_LAYER_KEY, else null', () => {});
  it('api comes from --api, then SPEC_LAYER_API, else DEFAULT_API', () => {});
  it('outDir comes from --out, then config, else .speclayer', () => {});
});
describe('config file round trip', () => {
  it('writeConfig then readConfig round-trips', () => {});
  it('readConfig returns null when the file is absent', () => {});
  it('readConfig throws a readable error on invalid json', () => { /* /speclayer.json is not valid JSON/ */ });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/cli/test/config.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `packages/cli/src/config.ts`**

```ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_API = 'https://api.spec-layer.com';
export const DEFAULT_OUT_DIR = '.speclayer';
const CONFIG_NAME = 'speclayer.json';

export interface CliConfig { libraryId?: string; outDir?: string }

export function readConfig(cwd: string): CliConfig | null {
  const path = join(cwd, CONFIG_NAME);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch {
    throw new Error(`${CONFIG_NAME} is not valid JSON. Fix or delete it, then retry.`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${CONFIG_NAME} is not valid JSON. Fix or delete it, then retry.`);
  }
  const record = parsed as Record<string, unknown>;
  return {
    ...(typeof record.libraryId === 'string' ? { libraryId: record.libraryId } : {}),
    ...(typeof record.outDir === 'string' ? { outDir: record.outDir } : {}),
  };
}

export function writeConfig(cwd: string, config: { libraryId: string; outDir: string }): void {
  writeFileSync(join(cwd, CONFIG_NAME), `${JSON.stringify(config, null, 2)}\n`);
}

export interface ResolvedOptions { libraryId: string | null; outDir: string; api: string; key: string | null }

export function resolveOptions(
  cwd: string,
  flags: { id?: string; out?: string; key?: string; api?: string },
  env: Record<string, string | undefined>,
  manifestLibraryId: (outDir: string) => string | null,
): ResolvedOptions {
  const config = readConfig(cwd);
  const outDir = flags.out ?? config?.outDir ?? DEFAULT_OUT_DIR;
  const libraryId = flags.id ?? config?.libraryId ?? manifestLibraryId(join(cwd, outDir));
  return {
    libraryId,
    outDir,
    api: flags.api ?? env.SPEC_LAYER_API ?? DEFAULT_API,
    key: flags.key ?? env.SPEC_LAYER_KEY ?? null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/cli/test/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/config.ts packages/cli/test/config.test.ts
git commit -m "feat(cli): add config file and option resolution"
```

---

### Task 6: CLI file writer — slugs, atomic writes, manifest

**Files:**
- Create: `packages/cli/src/files.ts`
- Test: `packages/cli/test/files.test.ts`

**Interfaces:**
- Consumes: `BundleV1` from `./bundle`.
- Produces:
  - `slugify(name: string): string`
  - `interface Manifest { libraryId: string; publishedAt: string; bundleHash: string; pluginVersion: string | null; extractorVersion: string; artifacts: Array<{ kind: 'foundation' | 'component'; name: string; contentHash: string; aiPath: string }> }`
  - `readManifest(outDir: string): Manifest | null`
  - `writeBundleFiles(opts: { outDir: string; raw: string; bundle: BundleV1; libraryId: string; publishedAt: string; bundleHash: string }): string[]` (returns relative paths written)

- [ ] **Step 1: Write failing tests**

`packages/cli/test/files.test.ts` (temp dirs again):

```ts
describe('slugify', () => {
  it('lowercases and hyphenates', () => { expect(slugify('Icon Button / Large')).toBe('icon-button-large'); });
  it('falls back for a name with no usable characters', () => { expect(slugify('***')).toBe('component'); });
});
describe('writeBundleFiles', () => {
  it('writes bundle.json byte-for-byte, ai yaml per artifact, and a manifest', () => {
    // bundle.json content === opts.raw exactly (no added newline).
    // ai/foundation.yaml === bundle.foundation.ai; ai/components/button.yaml === components[0].ai.
    // manifest.json parses to the Manifest shape with the right hashes and aiPaths.
  });
  it('dedupes colliding slugs in bundle order', () => {
    // components named 'Button' and 'button' -> button.yaml and button-2.yaml.
  });
  it('is atomic: a second write replaces the directory, a failed write leaves the old one', () => {
    // Write once; write again with different content -> old files gone, new present,
    // no .partial directory left behind. Then make writing fail (bundle with a
    // component whose slug path is unwritable is awkward — instead assert the
    // .partial staging dir is removed on success and that outDir from write #1
    // is intact if parseable-but-unwritable input throws before the swap).
  });
  it('skips the foundation file when foundation is null', () => {});
  it('readManifest returns null when absent and the manifest after a write', () => {});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/cli/test/files.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `packages/cli/src/files.ts`**

```ts
import { mkdirSync, writeFileSync, readFileSync, rmSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { BundleV1 } from './bundle';

export function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'component';
}

export interface ManifestArtifact { kind: 'foundation' | 'component'; name: string; contentHash: string; aiPath: string }
export interface Manifest {
  libraryId: string;
  publishedAt: string;
  bundleHash: string;
  pluginVersion: string | null;
  extractorVersion: string;
  artifacts: ManifestArtifact[];
}

export function readManifest(outDir: string): Manifest | null {
  const path = join(outDir, 'manifest.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as Manifest; } catch { return null; }
}

/** Stage into <outDir>.partial, then swap. A failed pull never half-writes. */
export function writeBundleFiles(opts: {
  outDir: string; raw: string; bundle: BundleV1; libraryId: string; publishedAt: string; bundleHash: string;
}): string[] {
  const staging = `${opts.outDir}.partial`;
  rmSync(staging, { recursive: true, force: true });
  const written: string[] = [];
  const put = (rel: string, content: string) => {
    const path = join(staging, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    written.push(rel);
  };
  try {
    put('bundle.json', opts.raw);
    const artifacts: ManifestArtifact[] = [];
    if (opts.bundle.foundation) {
      put('ai/foundation.yaml', opts.bundle.foundation.ai);
      artifacts.push({
        kind: 'foundation', name: 'foundation',
        contentHash: opts.bundle.foundation.artifact.spec_layer.export.content_hash,
        aiPath: 'ai/foundation.yaml',
      });
    }
    const used = new Map<string, number>();
    for (const component of opts.bundle.components) {
      const base = slugify(component.name);
      const count = (used.get(base) ?? 0) + 1;
      used.set(base, count);
      const aiPath = `ai/components/${count === 1 ? base : `${base}-${count}`}.yaml`;
      put(aiPath, component.ai);
      artifacts.push({
        kind: 'component', name: component.name,
        contentHash: component.artifact.spec_layer.export.content_hash, aiPath,
      });
    }
    const manifest: Manifest = {
      libraryId: opts.libraryId, publishedAt: opts.publishedAt, bundleHash: opts.bundleHash,
      pluginVersion: opts.bundle.pluginVersion, extractorVersion: opts.bundle.extractorVersion, artifacts,
    };
    put('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  rmSync(opts.outDir, { recursive: true, force: true });
  renameSync(staging, opts.outDir);
  return written;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/cli/test/files.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/files.ts packages/cli/test/files.test.ts
git commit -m "feat(cli): add atomic bundle file writer with manifest"
```

---

### Task 7: CLI api client, commands, entry point

**Files:**
- Create: `packages/cli/src/api.ts`, `packages/cli/src/commands.ts`
- Rewrite: `packages/cli/src/cli.ts` (replaces the Task 4 placeholder)
- Test: `packages/cli/test/api.test.ts`, `packages/cli/test/commands.test.ts`

**Interfaces:**
- Consumes: `parseBundle` (Task 4), `resolveOptions`/`writeConfig`/`DEFAULT_OUT_DIR` (Task 5), `writeBundleFiles`/`readManifest` (Task 6).
- Produces:
  - `fetchBundle(opts: { api: string; libraryId: string; key: string; etag?: string; fetcher?: typeof fetch }): Promise<{ kind: 'ok'; raw: string; publishedAt: string; bundleHash: string } | { kind: 'not_modified' } | { kind: 'error'; message: string }>`
  - `runInit(cwd: string, flags: Flags): number`
  - `runPull(cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io, fetcher?: typeof fetch): Promise<number>`
  - `runStatus(cwd: string, flags: Flags, env, io, fetcher?): Promise<number>`
  - `type Flags = { id?: string; out?: string; key?: string; api?: string }`, `type Io = { out(line: string): void; err(line: string): void }`
  - Exit codes: 0 success/up-to-date, 1 error, 2 status-behind.

- [ ] **Step 1: Write failing api tests**

`packages/cli/test/api.test.ts` with a stub fetcher (`vi.fn`):

```ts
describe('fetchBundle', () => {
  it('returns raw body, hash, and publishedAt on 200', async () => {
    // Stub 200 with body JSON.stringify(GOOD), headers ETag '"<hash>"' and X-Published-At.
    // bundleHash is computed locally with node:crypto sha256 of the body (assert it
    // equals the known digest), publishedAt read from the header.
    // Assert the request URL is `${api}/v1/libraries/${id}` and the key travels in
    // the Authorization header, never the URL.
  });
  it('returns not_modified on 304 and sends If-None-Match when etag given', async () => {});
  it('maps 401 to the rotated-key message', async () => { /* /rotated or revoked/ */ });
  it('maps 404 to the not-found message', async () => { /* /not found/i and /unpublished/ */ });
  it('maps other statuses to an HTTP message', async () => { /* 500 -> /HTTP 500/ */ });
  it('maps a thrown fetch to an unreachable message', async () => { /* /Could not reach/ */ });
});
```

- [ ] **Step 2: Write failing command tests**

`packages/cli/test/commands.test.ts` (temp cwd, captured Io, stub fetcher):

```ts
describe('runInit', () => {
  it('writes speclayer.json from --id and prints where the key comes from', () => {
    // exit 0; config { libraryId, outDir: '.speclayer' }; output mentions SPEC_LAYER_KEY.
  });
  it('fails without --id', () => { /* exit 1, err mentions --id */ });
});
describe('runPull', () => {
  it('pulls and writes files with config present', async () => {
    // init first, SPEC_LAYER_KEY in env, stub 200. exit 0.
    // .speclayer/bundle.json, ai/foundation.yaml, ai/components/button.yaml, manifest.json exist.
    // Output names the file count and publishedAt.
  });
  it('works bare with --id and --key (no config), then status resolves id from the manifest', async () => {});
  it('errors without a key', async () => { /* exit 1, 'Set SPEC_LAYER_KEY or pass --key.' */ });
  it('errors without a library id', async () => { /* exit 1, mentions --id and spec-layer init */ });
  it('propagates api errors with exit 1 and no partial directory', async () => { /* stub 401 */ });
  it('re-pull with unchanged content leaves identical bytes', async () => {
    // Pull twice with the same stub; read all files between and after; identical.
  });
});
describe('runStatus', () => {
  it('reports up to date on 304 with exit 0', async () => {});
  it('reports behind on 200 with exit 2 and names the remote publishedAt', async () => {});
  it('reports no local pull with exit 2 when manifest is missing', async () => {});
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/cli`
Expected: new files FAIL — modules missing.

- [ ] **Step 4: Implement `api.ts`**

```ts
import { createHash } from 'node:crypto';

export type FetchBundleResult =
  | { kind: 'ok'; raw: string; publishedAt: string; bundleHash: string }
  | { kind: 'not_modified' }
  | { kind: 'error'; message: string };

export async function fetchBundle(opts: {
  api: string; libraryId: string; key: string; etag?: string; fetcher?: typeof fetch;
}): Promise<FetchBundleResult> {
  const doFetch = opts.fetcher ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${opts.api}/v1/libraries/${opts.libraryId}`, {
      headers: {
        Authorization: `Bearer ${opts.key}`,
        ...(opts.etag ? { 'If-None-Match': `"${opts.etag}"` } : {}),
      },
    });
  } catch {
    return { kind: 'error', message: `Could not reach ${opts.api}.` };
  }
  if (res.status === 304) return { kind: 'not_modified' };
  if (res.status === 401) return { kind: 'error', message: 'Key was rotated or revoked. Ask the publisher for the current key.' };
  if (res.status === 404) return { kind: 'error', message: 'Library not found. It may have been unpublished.' };
  if (!res.ok) return { kind: 'error', message: `Request failed with HTTP ${res.status}.` };
  const raw = await res.text();
  return {
    kind: 'ok',
    raw,
    publishedAt: res.headers.get('X-Published-At') ?? 'unknown',
    bundleHash: createHash('sha256').update(raw).digest('hex'),
  };
}
```

- [ ] **Step 5: Implement `commands.ts`**

```ts
import { join } from 'node:path';
import { parseBundle } from './bundle';
import { resolveOptions, writeConfig, DEFAULT_OUT_DIR } from './config';
import { fetchBundle } from './api';
import { readManifest, writeBundleFiles } from './files';

export type Flags = { id?: string; out?: string; key?: string; api?: string };
export type Io = { out(line: string): void; err(line: string): void };

const manifestLibraryId = (outDir: string): string | null => readManifest(outDir)?.libraryId ?? null;

export function runInit(cwd: string, flags: Flags, io: Io): number {
  if (!flags.id) {
    io.err('spec-layer init needs --id lib_... (shown in the plugin after publishing).');
    return 1;
  }
  const outDir = flags.out ?? DEFAULT_OUT_DIR;
  writeConfig(cwd, { libraryId: flags.id, outDir });
  io.out(`Wrote speclayer.json (library ${flags.id}, output ${outDir}).`);
  io.out('The pull key is never stored here. Set SPEC_LAYER_KEY in your environment or pass --key.');
  return 0;
}

/** Shared option gate for pull and status. */
function resolved(cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io) {
  const opts = resolveOptions(cwd, flags, env, manifestLibraryId);
  if (!opts.libraryId) {
    io.err('No library id. Pass --id lib_..., or run spec-layer init first.');
    return null;
  }
  if (!opts.key) {
    io.err('No pull key. Set SPEC_LAYER_KEY or pass --key.');
    return null;
  }
  return opts as typeof opts & { libraryId: string; key: string };
}

export async function runPull(
  cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io, fetcher?: typeof fetch,
): Promise<number> {
  const opts = resolved(cwd, flags, env, io);
  if (!opts) return 1;
  const result = await fetchBundle({ api: opts.api, libraryId: opts.libraryId, key: opts.key, ...(fetcher ? { fetcher } : {}) });
  if (result.kind === 'error') { io.err(result.message); return 1; }
  if (result.kind === 'not_modified') { io.out('Already up to date.'); return 0; } // unreachable without etag; kept honest
  let written: string[];
  try {
    const bundle = parseBundle(result.raw);
    written = writeBundleFiles({
      outDir: join(cwd, opts.outDir), raw: result.raw, bundle,
      libraryId: opts.libraryId, publishedAt: result.publishedAt, bundleHash: result.bundleHash,
    });
    const components = bundle.components.length;
    io.out(`Pulled ${bundle.fileName ?? opts.libraryId}: ${bundle.foundation ? 'foundation + ' : ''}${components} component${components === 1 ? '' : 's'} (published ${result.publishedAt}).`);
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 1;
  }
  io.out(`Wrote ${written.length} files under ${opts.outDir}/.`);
  return 0;
}

export async function runStatus(
  cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io, fetcher?: typeof fetch,
): Promise<number> {
  const opts = resolved(cwd, flags, env, io);
  if (!opts) return 1;
  const manifest = readManifest(join(cwd, opts.outDir));
  if (!manifest) { io.err('No local pull found. Run spec-layer pull.'); return 2; }
  const result = await fetchBundle({
    api: opts.api, libraryId: opts.libraryId, key: opts.key, etag: manifest.bundleHash, ...(fetcher ? { fetcher } : {}),
  });
  if (result.kind === 'error') { io.err(result.message); return 1; }
  if (result.kind === 'not_modified') { io.out(`Up to date (published ${manifest.publishedAt}).`); return 0; }
  io.out(`Behind: remote published ${result.publishedAt}. Run spec-layer pull.`);
  return 2;
}
```

- [ ] **Step 6: Implement `cli.ts`**

```ts
import { parseArgs } from 'node:util';
import { runInit, runPull, runStatus, type Io } from './commands';

const USAGE = `spec-layer <command>

Commands:
  init    --id lib_... [--out DIR]        write speclayer.json
  pull    [--id lib_...] [--key sl_...]   fetch the library into DIR (default .speclayer)
  status  [--id lib_...] [--key sl_...]   check freshness; exits 2 when behind

Options:
  --api URL   override the API origin (default https://api.spec-layer.com)
The pull key comes from --key or the SPEC_LAYER_KEY environment variable.`;

const io: Io = { out: (l) => console.log(l), err: (l) => console.error(l) };

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    id: { type: 'string' }, out: { type: 'string' },
    key: { type: 'string' }, api: { type: 'string' },
  },
});

const command = positionals[0];
const cwd = process.cwd();
let code: number;
if (command === 'init') code = runInit(cwd, values, io);
else if (command === 'pull') code = await runPull(cwd, values, process.env, io);
else if (command === 'status') code = await runStatus(cwd, values, process.env, io);
else { io.err(USAGE); code = 1; }
process.exitCode = code;
```

- [ ] **Step 7: Run tests, build, and smoke the binary**

Run: `npx vitest run packages/cli && npm run build:cli && node packages/cli/dist/cli.js`
Expected: tests PASS; build succeeds; bare invocation prints usage and exits 1 (`echo $?` → 1).

- [ ] **Step 8: Full local gate**

Run: `npm run check`
Expected: PASS (this is the first task where `build:cli` runs inside check).

- [ ] **Step 9: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): add init, pull, and status commands"
```

---

### Task 8: Plugin messages and main-thread publish sources

**Files:**
- Modify: `packages/plugin/src/messages.ts`
- Modify: `packages/plugin/src/main.ts`
- Test: none (main.ts is wiring, excluded from coverage by repo convention; the live path joins the manual matrix in Task 11)

**Interfaces:**
- Consumes: `foundationFor(fileKey)`, `liveFoundationGroupDescriptions()`, `readRegistry()`, `parseDocLink`, `isFoundationLink`, `serializeNode(src, resolver)`, `resolveFileKey`, `parseProse`, `DOC_LINK_KEY`, `DOC_PROSE_KEY` — all already present in `main.ts`.
- Produces (message contract Tasks 9–10 build against):

```ts
// messages.ts additions
export interface PublishComponentSource {
  docId: string;
  name: string;                 // the live source node's name
  node: SerializedNode;
  prose: ProseDrafts | null;
}
// MainToUi additions:
  | { type: 'publishSources'; foundation: SerializedFoundation | null;
      groupDescriptions: Record<string, Record<string, string>>;
      components: PublishComponentSource[];
      skipped: Array<{ name: string; reason: string }>;
      fileKey: string; fileName: string }
  | { type: 'publishSourcesError'; message: string }
  | { type: 'publishInfo'; fileKey: string; libraryId: string | null; pullKey: string | null }
// UiToMain additions:
  | { type: 'requestPublishSources' }
  | { type: 'requestPublishInfo' }
  | { type: 'setPublishInfo'; fileKey: string; libraryId: string; pullKey: string }
```

- [ ] **Step 1: Add the message types above to `messages.ts`**

Import `ProseDrafts`/`SerializedFoundation`/`SerializedNode` types only if not already imported there (they are — check the existing imports at the top).

- [ ] **Step 2: Add the three handlers to `main.ts`'s message switch**

```ts
case 'requestPublishSources': {
  try {
    const { fileKey } = resolveFileKey(figma.fileKey, null);
    let foundation: SerializedFoundation | null = null;
    try { foundation = await foundationFor(fileKey); } catch { foundation = null; }
    const groupDescriptions = await liveFoundationGroupDescriptions();
    const reg = readRegistry();
    const components: PublishComponentSource[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];
    const seenSources = new Set<string>();
    for (const docId of reg.docIds) {
      let section: SectionNode | null = null;
      try {
        const n = await figma.getNodeByIdAsync(docId);
        section = n && n.type === 'SECTION' ? (n as SectionNode) : null;
      } catch { section = null; }
      if (!section) continue;
      const data = parseDocLink(section.getPluginData(DOC_LINK_KEY));
      if (!data || isFoundationLink(data)) continue;
      // Two docs for one source publish one context, not two.
      if (seenSources.has(data.sourceNodeId)) continue;
      seenSources.add(data.sourceNodeId);
      let src: BaseNode | null = null;
      try { src = await figma.getNodeByIdAsync(data.sourceNodeId); } catch { src = null; }
      if (!src || (src.type !== 'COMPONENT' && src.type !== 'COMPONENT_SET')) {
        skipped.push({ name: section.name, reason: 'The source component is gone.' });
        continue;
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const node = await serializeNode(src as any, resolver);
        components.push({ docId, name: node.name, node, prose: parseProse(section.getPluginData(DOC_PROSE_KEY)) });
      } catch (err) {
        skipped.push({ name: src.name, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    figma.ui.postMessage({
      type: 'publishSources', foundation, groupDescriptions, components, skipped,
      fileKey, fileName: figma.root.name,
    } as MainToUi);
  } catch (err) {
    figma.ui.postMessage({
      type: 'publishSourcesError', message: err instanceof Error ? err.message : String(err),
    } as MainToUi);
  }
  break;
}

case 'requestPublishInfo': {
  const { fileKey } = resolveFileKey(figma.fileKey, null);
  let info: { libraryId?: string; pullKey?: string } | null = null;
  try {
    const raw = await figma.clientStorage.getAsync(`publishInfo:${fileKey}`) as string | undefined;
    info = raw ? JSON.parse(raw) as typeof info : null;
  } catch { info = null; }
  figma.ui.postMessage({
    type: 'publishInfo', fileKey,
    libraryId: info?.libraryId ?? null, pullKey: info?.pullKey ?? null,
  } as MainToUi);
  break;
}

case 'setPublishInfo': {
  await figma.clientStorage.setAsync(
    `publishInfo:${msg.fileKey}`,
    JSON.stringify({ libraryId: msg.libraryId, pullKey: msg.pullKey }),
  );
  break;
}
```

Import `PublishComponentSource` in main.ts's type import from `./messages`.

- [ ] **Step 3: Verify with the build gates (no unit tests reach main.ts)**

Run: `npm run typecheck && npm run build:plugin && npm run check:sandbox`
Expected: all PASS (sandbox scan matters: these handlers must not drag browser globals into `dist/main.js`).

- [ ] **Step 4: Commit**

```bash
git add packages/plugin/src/messages.ts packages/plugin/src/main.ts
git commit -m "feat(plugin): add publish source collection and publish info storage"
```

---

### Task 9: Plugin publish module — bundle assembly and proxy calls

**Files:**
- Modify: `packages/plugin/src/ui/actions.ts` (export the private `pluginBuild` and `generatedGuidelines`)
- Create: `packages/plugin/src/ui/publish.ts`
- Test: `packages/plugin/test/publish.test.ts`

**Interfaces:**
- Consumes: from `@spec-layer/extractor`: `extract`, `buildFoundation`, `buildFoundationArtifactV5`, `foundationAiContext`, `buildComponentArtifactV5`, `componentAiContext`, `toYaml`, `compareCodeUnits`, `EXTRACTOR_VERSION`, types `FoundationArtifactV5`, `YamlValue`. From `./actions`: `pluginBuild`, `generatedGuidelines`. From `./proxy`: `PROXY_URL`, `authHeaders`, `type ProxyAuth`. Message payload shape from Task 8.
- Produces:
  - `interface PublishBundleV1 { schema: 'spec-layer-library-bundle'; version: '1.0.0'; fileName: string | null; pluginVersion: string | null; extractorVersion: string; foundation: { ai: string; artifact: FoundationArtifactV5 } | null; components: Array<{ name: string; ai: string; artifact: unknown }> }`
  - `buildPublishBundle(sources: PublishSources, generatedAt: string): PublishBundleV1` where `PublishSources` is the `publishSources` message minus `type`
  - `publishBundle(bundle: PublishBundleV1, opts: { auth: ProxyAuth; libraryId: string | null; fetcher?: typeof fetch }): Promise<PublishOutcome>` with `type PublishOutcome = { kind: 'created'; libraryId: string; pullKey: string; publishedAt: string } | { kind: 'updated'; libraryId: string; publishedAt: string } | { kind: 'gone' } | { kind: 'error'; message: string }` (`gone` = 404/`not_owner` on republish, so the caller can retry as a fresh create)
  - `rotatePullKey(libraryId: string, auth: ProxyAuth, fetcher?: typeof fetch): Promise<{ kind: 'rotated'; pullKey: string } | { kind: 'error'; message: string }>`
  - `setupCommand(libraryId: string, pullKey: string): string` → `` `SPEC_LAYER_KEY=${pullKey} npx spec-layer pull --id ${libraryId}` ``

- [ ] **Step 1: Export the two private helpers from actions.ts**

Change `const pluginBuild = ...` to `export const pluginBuild = ...` and `function generatedGuidelines(` to `export function generatedGuidelines(`. Nothing else moves.

- [ ] **Step 2: Write failing tests**

`packages/plugin/test/publish.test.ts`. For sources, reuse the synthetic fixtures the existing `copyBrief.test.ts` and `copyFoundation.test.ts` build their `SerializedNode`/`SerializedFoundation` inputs from — read those two files first and lift their fixture builders (do not invent a new serialized-node shape by hand).

```ts
describe('buildPublishBundle', () => {
  it('builds a bundle with foundation and components sorted by code units', () => {
    // Two components named 'button' and 'Badge': 'Badge' first (code-unit order).
    // schema/version/extractorVersion fields exact; fileName from sources.
    // foundation.ai is a non-empty YAML string; each component ai likewise.
    // Every artifact has spec_layer.export.content_hash (string, 64 hex).
  });
  it('embeds the foundation into component artifacts', () => {
    // With a foundation present, a component artifact gains foundation_content_hash.
  });
  it('applies group descriptions as generated guidelines', () => {
    // Non-empty groupDescriptions -> bundle.foundation.artifact.guidelines.origin === 'generated'.
  });
  it('builds foundation: null when sources.foundation is null', () => {});
  it('is deterministic for a fixed generatedAt', () => {
    // Two calls with identical inputs produce identical JSON.stringify output.
  });
});
describe('publishBundle', () => {
  it('creates on 201 and returns the pull key', async () => { /* stub fetch; assert POST body { bundle } without libraryId */ });
  it('updates on 200 with libraryId in the body', async () => {});
  it('maps 404/not_owner on republish to gone', async () => { /* two stubs */ });
  it('maps license errors to plugin-voice copy', async () => {
    // 401 license_not_active -> message 'Publishing needs an active Pro license.'
    // Assert NO em dash in any error message this module can produce.
  });
  it('maps bundle_too_large with the sizes', async () => {});
  it('maps network failure to unreachable copy', async () => {});
});
describe('rotatePullKey', () => { it('returns the new key on 200 and copy on error', async () => {}); });
describe('setupCommand', () => {
  it('produces the exact one-liner', () => {
    expect(setupCommand('lib_aaaaaaaaaaaaaaaaaaaaaaaa', 'sl_' + 'b'.repeat(48)))
      .toBe('SPEC_LAYER_KEY=sl_' + 'b'.repeat(48) + ' npx spec-layer pull --id lib_aaaaaaaaaaaaaaaaaaaaaaaa');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/plugin/test/publish.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement `packages/plugin/src/ui/publish.ts`**

```ts
import {
  extract, buildFoundation, compareCodeUnits, toYaml, EXTRACTOR_VERSION,
  buildFoundationArtifactV5, foundationAiContext,
  buildComponentArtifactV5, componentAiContext,
  type FoundationArtifactV5, type YamlValue, type SerializedFoundation, type SerializedNode, type ProseDrafts,
} from '@spec-layer/extractor';
import { pluginBuild, generatedGuidelines } from './actions';
import { PROXY_URL, authHeaders, type ProxyAuth } from './proxy';
import type { PublishComponentSource } from '../messages';

export interface PublishSources {
  foundation: SerializedFoundation | null;
  groupDescriptions: Record<string, Record<string, string>>;
  components: PublishComponentSource[];
  fileKey: string;
  fileName: string;
}

export interface PublishBundleV1 {
  schema: 'spec-layer-library-bundle';
  version: '1.0.0';
  fileName: string | null;
  pluginVersion: string | null;
  extractorVersion: string;
  foundation: { ai: string; artifact: FoundationArtifactV5 } | null;
  components: Array<{ name: string; ai: string; artifact: unknown }>;
}

export function buildPublishBundle(sources: PublishSources, generatedAt: string): PublishBundleV1 {
  const build = pluginBuild();
  let foundation: PublishBundleV1['foundation'] = null;
  let foundationArtifact: FoundationArtifactV5 | undefined;
  if (sources.foundation) {
    const spec = buildFoundation(sources.foundation);
    const { artifact } = buildFoundationArtifactV5(spec, {
      exportId: `foundation:${spec.fileKey && spec.fileKey !== 'unknown' ? spec.fileKey : 'local'}:${generatedAt}`,
      generatedAt,
      build,
    });
    const guidelines = generatedGuidelines(sources.groupDescriptions);
    if (guidelines) artifact.guidelines = guidelines;
    foundationArtifact = artifact;
    foundation = { ai: toYaml(foundationAiContext(artifact) as unknown as YamlValue), artifact };
  }
  const components = [...sources.components]
    .sort((a, b) => compareCodeUnits(a.name, b.name))
    .map(({ name, node, prose }) => {
      const spec = extract(node, {
        figmaFile: sources.fileKey,
        ...(sources.fileName ? { figmaFileName: sources.fileName } : {}),
      });
      const artifact = buildComponentArtifactV5(spec, {
        exportId: `component:${node.id}:${generatedAt}`,
        generatedAt,
        build,
        ...(foundationArtifact ? { foundation: foundationArtifact } : {}),
        prose,
      });
      return { name, ai: toYaml(componentAiContext(artifact) as unknown as YamlValue), artifact };
    });
  return {
    schema: 'spec-layer-library-bundle',
    version: '1.0.0',
    fileName: sources.fileName || null,
    pluginVersion: build,
    extractorVersion: EXTRACTOR_VERSION,
    foundation,
    components,
  };
}

export type PublishOutcome =
  | { kind: 'created'; libraryId: string; pullKey: string; publishedAt: string }
  | { kind: 'updated'; libraryId: string; publishedAt: string }
  | { kind: 'gone' }
  | { kind: 'error'; message: string };

function publishErrorCopy(status: number, body: Record<string, unknown>): string {
  const error = typeof body.error === 'string' ? body.error : '';
  if (status === 401) return 'Publishing needs an active Pro license.';
  if (error === 'bundle_too_large') return `This library is larger than the publish limit (${String(body.size)} of ${String(body.limit)} characters).`;
  if (error === 'library_limit') return `This license already publishes ${String(body.limit)} libraries, which is the limit.`;
  if (status === 429) return 'Too many requests just now. Give it a minute.';
  return `Publishing failed with HTTP ${status}.`;
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  try { return await res.json() as Record<string, unknown>; } catch { return {}; }
}

export async function publishBundle(
  bundle: PublishBundleV1,
  opts: { auth: ProxyAuth; libraryId: string | null; fetcher?: typeof fetch },
): Promise<PublishOutcome> {
  const headers = authHeaders(opts.auth);
  if (!headers) return { kind: 'error', message: 'Publishing needs an active Pro license.' };
  const doFetch = opts.fetcher ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${PROXY_URL}/v1/libraries`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ ...(opts.libraryId ? { libraryId: opts.libraryId } : {}), bundle }),
    });
  } catch {
    return { kind: 'error', message: 'Could not reach the publish service. Check your connection and try again.' };
  }
  const body = await bodyOf(res);
  if (res.status === 201) {
    return { kind: 'created', libraryId: String(body.libraryId), pullKey: String(body.pullKey), publishedAt: String(body.publishedAt) };
  }
  if (res.ok) return { kind: 'updated', libraryId: String(body.libraryId), publishedAt: String(body.publishedAt) };
  if (opts.libraryId && (res.status === 404 || body.error === 'not_owner')) return { kind: 'gone' };
  return { kind: 'error', message: publishErrorCopy(res.status, body) };
}

export async function rotatePullKey(
  libraryId: string, auth: ProxyAuth, fetcher?: typeof fetch,
): Promise<{ kind: 'rotated'; pullKey: string } | { kind: 'error'; message: string }> {
  const headers = authHeaders(auth);
  if (!headers) return { kind: 'error', message: 'Rotating the key needs an active Pro license.' };
  const doFetch = fetcher ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${PROXY_URL}/v1/libraries/${libraryId}/rotate`, { method: 'POST', headers });
  } catch {
    return { kind: 'error', message: 'Could not reach the publish service. Check your connection and try again.' };
  }
  const body = await bodyOf(res);
  if (res.ok) return { kind: 'rotated', pullKey: String(body.pullKey) };
  if (res.status === 401) return { kind: 'error', message: 'Rotating the key needs an active Pro license.' };
  return { kind: 'error', message: `Rotating the key failed with HTTP ${res.status}.` };
}

export function setupCommand(libraryId: string, pullKey: string): string {
  return `SPEC_LAYER_KEY=${pullKey} npx spec-layer pull --id ${libraryId}`;
}
```

Type note: if `SerializedFoundation`/`SerializedNode`/`ProseDrafts` are not exported from the extractor root, import them from wherever `actions.ts` imports them (check its import block and mirror it exactly).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/plugin/test/publish.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/ui/actions.ts packages/plugin/src/ui/publish.ts packages/plugin/test/publish.test.ts
git commit -m "feat(plugin): assemble and publish library bundles to the proxy"
```

---

### Task 10: Publish UI in the library screen

**Files:**
- Modify: `packages/plugin/src/ui/publish.ts` (add the controller)
- Modify: `packages/plugin/src/ui/screens/library.ts` (publish section markup)
- Modify: `packages/plugin/src/ui/ui-vnext.ts` (wiring: message routing + click handlers)
- Test: `packages/plugin/test/publish.test.ts` (controller), `packages/plugin/test/libraryScreen.test.ts` (markup)

**Interfaces:**
- Consumes: Task 9's functions; `effectiveAuth` from `./proxy`; the shell's existing clipboard helper `copyText` from `./clipboard`; message types from Task 8.
- Produces in `publish.ts`, following the module-state + host pattern `actions.ts` uses for foundations:

```ts
export interface PublishState {
  status: 'idle' | 'collecting' | 'uploading' | 'done' | 'error';
  message: string | null;          // error or success copy for the status line
  libraryId: string | null;
  pullKey: string | null;
  lastPublishedAt: string | null;  // ISO, from the last publish this session
}
export interface PublishHost { repaint(): void; send(msg: UiToMain): void }
export function setPublishHost(host: PublishHost): void
export function publishState(): Readonly<PublishState>
export function onPublishClick(auth: ProxyAuth): void            // -> collecting; host.send requestPublishSources
export function onPublishSources(msg: publishSources payload, auth: ProxyAuth, fetcher?: typeof fetch): Promise<void>
export function onPublishSourcesError(message: string): void
export function onPublishInfo(msg: publishInfo payload): void    // seeds libraryId/pullKey from clientStorage
export function onRotateClick(auth: ProxyAuth, fetcher?: typeof fetch): Promise<void>
```

  and in `screens/library.ts`: `publishSectionMarkup(state: PublishState, busy: boolean): string` appended to the library screen's footer markup, with `data-publish`, `data-publish-copy-command`, `data-publish-rotate` attributes for wiring.

- [ ] **Step 1: Write failing controller tests**

Extend `packages/plugin/test/publish.test.ts`:

```ts
describe('publish controller', () => {
  // A fake host capturing sent messages and repaint counts, reset per test.
  it('onPublishClick moves to collecting and requests sources', () => {});
  it('blocks publish when sources arrive with skipped components', async () => {
    // skipped: [{ name: 'Button', reason: '...' }] -> status 'error',
    // message names Button and says nothing was published. No fetch happened.
  });
  it('publishes fresh sources and stores the new key', async () => {
    // stub fetch 201 -> status 'done', pullKey set,
    // host.send called with { type: 'setPublishInfo', ... }.
  });
  it('republishes with the known libraryId', async () => { /* body carries libraryId; 200 -> done, key unchanged */ });
  it('retries as a fresh create when the republish target is gone', async () => {
    // first stub response 404, second 201 -> done with NEW id and key, setPublishInfo sent again.
  });
  it('surfaces publish errors verbatim in state', async () => {});
  it('onRotateClick replaces the stored key', async () => { /* 200 { pullKey } -> state + setPublishInfo */ });
});
```

- [ ] **Step 2: Write failing markup tests**

Extend `packages/plugin/test/libraryScreen.test.ts` following its existing style:

```ts
describe('publish section', () => {
  it('renders the publish button and honest description when idle', () => {
    // Copy: 'Publish for developers' heading; body copy mentions replacing the
    // previous version and that anyone with the key can pull. Assert no em dash
    // ('—') anywhere in the markup.
  });
  it('shows the setup command copy button and rotate action once a key exists', () => {});
  it('disables the publish button while collecting or uploading', () => {});
  it('renders the error message when state.status is error', () => {});
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/plugin/test/publish.test.ts packages/plugin/test/libraryScreen.test.ts`
Expected: FAIL — controller and markup functions missing.

- [ ] **Step 4: Implement the controller in `publish.ts`**

Module state mirroring the foundation pattern in `actions.ts` (module-scope `let state`, a `noop` host default, `setPublishHost`). Behavior:

- `onPublishClick`: ignore when already collecting/uploading; set `collecting`, clear message, `host.send({ type: 'requestPublishSources' })`, repaint.
- `onPublishSources`: if `msg.skipped.length > 0` → `status: 'error'`, message `` `Nothing was published. ${msg.skipped.length} component${...} could not be read: ${names}. Fix or remove those docs, then publish again.` `` (names = skipped names joined with ', '), repaint, return. Otherwise `status: 'uploading'`, repaint; `buildPublishBundle(msg, new Date().toISOString())`; `publishBundle(bundle, { auth, libraryId: state.libraryId, fetcher })`. On `gone`: retry once with `libraryId: null`. On `created`: store id + key in state, `host.send({ type: 'setPublishInfo', fileKey: msg.fileKey, libraryId, pullKey })`, `status: 'done'`, message `'Published. Anyone with the key can pull this version.'`. On `updated`: `status: 'done'`, message `'Published. Developers get this version on their next pull.'`. On `error`: `status: 'error'`, message from the outcome. Repaint after every transition.
- `onPublishSourcesError(message)`: `status: 'error'`, message `` `Could not read the library. Nothing was published. ${message}` ``.
- `onPublishInfo`: seed `libraryId`/`pullKey` when state is idle; repaint.
- `onRotateClick`: call `rotatePullKey`; on success update `pullKey`, send `setPublishInfo` (requires `libraryId` and the current `fileKey` — keep the last-seen fileKey in module state, captured from `onPublishInfo`/`onPublishSources`), message `'Key rotated. The old key no longer works. Share the new command with your developers.'`.

- [ ] **Step 5: Implement `publishSectionMarkup` in `screens/library.ts`**

A footer block using the screen's existing `esc` helper and `sl-button` classes. Content:

- Heading `Publish for developers`.
- Body copy (idle, no key yet): `Publishes this library's AI context so developers can pull it with the spec-layer CLI. Publishing replaces the previously published version. Anyone with the key can pull it.` (Requires Pro; when publish fails on license the error copy says so.)
- `<button class="sl-button" type="button" data-publish${busy ? ' disabled' : ''}>Publish library</button>`
- When `state.pullKey && state.libraryId`: a monospace one-line box showing `setupCommand(...)` output (escaped), `<button ... data-publish-copy-command>Copy setup command</button>`, and `<button ... data-publish-rotate>Rotate key</button>` with helper copy `Rotating invalidates the current key for everyone.`
- When `state.message`: a status line, styled as error when `state.status === 'error'`.

- [ ] **Step 6: Wire in `ui-vnext.ts`**

Wiring only (this file is coverage-excluded): register a `PublishHost` whose `repaint` re-renders the library screen and whose `send` posts to the main thread; route `publishSources`/`publishSourcesError`/`publishInfo` messages to the controller; on library screen mount send `requestPublishInfo` once; delegate clicks on `[data-publish]`, `[data-publish-copy-command]` (uses `copyText(setupCommand(...))`), `[data-publish-rotate]`. Build `auth` the same way the AI actions do, via `effectiveAuth(...)` with the UI's stored license fields — find the existing call site in `ui-vnext.ts` and reuse its arguments.

- [ ] **Step 7: Run the full plugin suite and gates**

Run: `npx vitest run packages/plugin && npm run check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/plugin/src packages/plugin/test
git commit -m "feat(plugin): add publish for developers to the library screen"
```

---

### Task 11: Docs, changelog, manual test rows, final gate

**Files:**
- Modify: `CHANGELOG.md`, `ARCHITECTURE.md`, `docs/specs/foundation-v5-status.md`, `packages/plugin/TESTING.md`

- [ ] **Step 1: CHANGELOG entry**

Add under a new unreleased heading (match the file's existing format):

```markdown
- Publish for developers: Pro users publish the library's Copy for AI context
  to api.spec-layer.com from the Library screen; a new `spec-layer` CLI
  (`npx spec-layer pull`) writes the canonical v5 bundle and per-artifact
  ai-profile YAML into a repo, with `status` for freshness checks and key
  rotation for revoking access.
```

- [ ] **Step 2: ARCHITECTURE.md**

Add `packages/cli/` to the layout description (pull-only delivery CLI, zero runtime deps, no extractor dependency) and the three `/v1/libraries` routes plus the KV layout to the proxy section. State the transport invariant explicitly: the plugin publishes both canonical artifacts and ai YAML; the CLI never re-derives v5 output.

- [ ] **Step 3: foundation-v5-status.md**

Update the tooling paragraph (around line 166): delivery (publish + pull) is shipped; `validate`, `normalize`, `diff` remain open, and when they land they belong in `packages/cli` reusing the canonical validator and hash.

- [ ] **Step 4: TESTING.md manual matrix rows**

Add a "Publish and pull" section to the manual matrix:

```markdown
## Publish and pull

- [ ] Publish (Pro license, file with foundation + 2 component docs): Library
      screen shows the setup command; response arrived in under 30s.
- [ ] Pull: run the copied setup command in an empty directory; `.speclayer/`
      contains bundle.json, manifest.json, ai/foundation.yaml, and one YAML per
      component; the YAML matches what Copy for AI puts on the clipboard.
- [ ] Republish after editing a token: `spec-layer status` exits 2 and names
      the new publish time; `spec-layer pull` then `status` exits 0.
- [ ] Rotate key: old command fails with the rotated-key message; new command
      pulls.
- [ ] Free license: publish shows the Pro copy and publishes nothing.
- [ ] Broken source: delete a doc's source component, publish; the error names
      the component and nothing was published.
```

- [ ] **Step 5: Full gate and NUL scan sanity**

Run: `npm run check`
Expected: PASS. Also run `node scripts/check-nul-bytes.mjs` if `check` succeeded too fast to be believed — the docs edited here are outside its guard, so also grep the touched docs: `grep -rlP '\x00' docs/ CHANGELOG.md ARCHITECTURE.md || echo clean` → `clean`.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md ARCHITECTURE.md docs/specs/foundation-v5-status.md packages/plugin/TESTING.md
git commit -m "docs: record library publish and pull cli across architecture and testing"
```

---

## Self-review notes (already applied)

- Spec coverage: publish flow (Tasks 8–10), proxy endpoints/storage/limits (1–3), CLI init/pull/status with atomic writes and manifest (4–7), error copy on both sides (7, 9, 10), testing (every task), docs (11). The spec's "one library per license per Figma file" is enforced client-side by `publishInfo:<fileKey>` storage plus the server's per-license cap, as the spec intends.
- Deliberately out of scope, per spec: validate/diff/normalize commands, server version history, unpublish endpoint, npm publishing of the `spec-layer` package (releasing to npm is a release step, not a build step).
- Type consistency spot-checks: `HandlerDeps.libraryStore` (Tasks 1–3), `LibraryMeta` (1–3), `BundleV1`/`parseBundle` (4, 6, 7), `Manifest.bundleHash` vs `fetchBundle` local hash (6–7), `PublishComponentSource` (8–10), `PublishOutcome.gone` retry (9–10).
