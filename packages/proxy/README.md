# @spec-layer/proxy

The license + AI proxy for the Spec Layer Figma plugin. A Cloudflare Worker
that sits between the plugin and the Anthropic API: it
validates Lemon Squeezy licenses, enforces free/pro quotas server-side, and
holds the Anthropic key so the plugin never sees it.

## API

Auth on every endpoint: `Authorization: Bearer <license-key>` (pro) **or**
`X-Figma-User: <figma-user-id>` (free; stored only as a salted SHA-256 hash).

### `POST /v1/prose`

Body: `{ "cacheKey": "prose:v8:<hash>...", "request": <shipped prose request> }`

The proxy accepts only the two request contracts built by the extractor:
component prose and Foundation group descriptions. It requires the shipped
model, exact system prompt and few-shot messages, fixed output limit, bounded
generated prompt shape, and supported base64 image blocks. Caller-defined
Anthropic options, remote image URLs, extra fields, and bodies above 7 MB are
rejected. The `cacheKey` doubles as the idempotency key: a retry replays the
stored response without a second upstream call or quota decrement.

Success: the Anthropic response JSON plus headers `X-Tier`,
`X-Quota-Used`, `X-Quota-Limit` (`unlimited` for pro), `X-Quota-Remaining`,
`X-Quota-Resets-At`.

Errors: `400` bad request/allowlist, `401` unauthenticated or license not
active, `402 {"error":"quota_exhausted","resetsAt":…}`,
`409 {"error":"generation_pending"}` (another window is generating the same
component), `429 {"error":"rate_limited","retryAfterMs":…}`, `502` upstream
failure (quota not decremented).

### `GET /v1/quota`

→ `{ tier, used, limit, remaining, resetsAt }` for the quota meter.

### `POST /v1/license/activate`

Body: `{ "key": "...", "instanceName": "Figma plugin" }` →
`{ valid, status, instanceId? }` (proxies Lemon Squeezy's public activate
endpoint and caches the status).

### `POST /v1/libraries`

Pro license required. Body: `{ "libraryId"?: "lib_...", "bundle": <library
bundle> }`. The bundle must carry `schema: "spec-layer-library-bundle"`, a
string `version`, and a `components` array; the proxy validates that shape and
nothing else. It never derives, re-validates, or re-projects v5 output.

Omitting `libraryId` creates a library (201) and returns
`{ libraryId, pullKey, publishedAt }`. That response is the only copy of the
pull key the server ever hands back; only its SHA-256 is stored. Publishing is
capped at `LIBRARY_LIMIT` (10) libraries per license.

Passing an owned `libraryId` overwrites the bundle in place (200) and returns
`{ libraryId, publishedAt }` with no key, since the key does not change.

Errors: `400` invalid JSON or bundle shape, `401` unauthenticated or license
not active, `403 {"error":"not_owner"}` or
`403 {"error":"library_limit","limit":10}`, `404` unknown `libraryId`,
`413 {"error":"bundle_too_large","size":…,"limit":5000000}`, `429` rate
limited per IP.

### `GET /v1/libraries/:libraryId`

Pull key required: `Authorization: Bearer sl_...`. Returns the stored bundle
verbatim with `ETag: "<bundleHash>"` and `X-Published-At`. An `If-None-Match`
matching the current hash gets a bare `304`, which is how `spec-layer status`
decides whether a local pull is behind.

Errors: `401 {"error":"invalid_key"}` (malformed key or digest mismatch),
`404 {"error":"not_found"}`, `429`.

### `POST /v1/libraries/:libraryId/rotate`

Pro license required, and the caller must own the library. Returns
`{ pullKey }` and invalidates the previous key immediately. Errors: `401`,
`403 {"error":"not_owner"}`, `404`, `429`.

## Quota rules

- Free: 20 generations within 30 days of first sight, then 10 per UTC
  calendar month. Only uncached, successful generations count.
- Pro: no fixed monthly quota for normal individual use; flagged for fair-use
  review at ≥1,000/month (`fair_use_flag` log).
- Quota engine rate limit: 10 uncached generation reservations/min per
  identity, both tiers.
- Request edge limiter: 60 prose requests/min and 60 quota reads/min per
  connecting IP, best-effort per isolate.
- License status cached 24h; 5-day grace on Lemon Squeezy outages.

Atomicity: one Durable Object per identity (`QuotaDO`) serializes all quota
ops. The only server-side content storage is the 24h idempotency response
cache inside the DO; prompts and prose are never logged.

## Accepted risks and operational notes

- **License identities are hashed.** License-cache keys, quota Durable Object
  names, and log lines all carry `sha256(key)`, never the raw license key.
- **Device instances are validated per request.** Every call checks the
  `key:instanceId` bearer against Lemon Squeezy; deactivating a device in the
  LS dashboard frees its slot, visible here within the 24h cache TTL.
- **Transient Lemon Squeezy errors are never cached as verdicts.** A 429, a
  5xx, or a response with no verdict body is treated as unknown rather than
  `invalid`, so an LS outage doesn't lock out active subscribers. A 5-day
  grace window honors the last known-good status while LS is down.
- **License verdicts expire after 30 days.** KV verdict-cache entries are
  bounded by TTL, not retained indefinitely.
- **License endpoints are format-gated and rate-limited in-isolate.**
  Non-UUID keys are rejected before they reach Lemon Squeezy, and a per-IP
  limiter caps requests at 20/min. A production Cloudflare rate limiting rule,
  `Protect license endpoints`, is also active: per connecting IP it blocks for
  10 seconds after more than 5 requests in 10 seconds match
  `starts_with(http.request.uri.path, "/v1/license/")`. Reverify this zone-level
  rule after any Cloudflare account or zone migration.
- **Prose and quota endpoints are rate-limited in-isolate.** This is a
  best-effort cost-abuse backstop, not a substitute for a Cloudflare WAF rule.
- **Free identities are client-asserted.** `X-Figma-User` isn't
  authenticated; rotating it re-mints a free identity with a fresh boost
  window, bounded per request by the model/max_tokens allowlist.
- **Salt rotation resets free identities.** Changing `FIGMA_ID_SALT` renames
  every free identity's Durable Object: quotas reset and every user
  re-enters the boost window. Rotate only with that intent.
- **Published libraries live in the license-cache namespace, permanently.**
  `lib:<id>:bundle`, `lib:<id>:meta`, and `libowner:<licenseId>` are written
  with no `expirationTtl` into the KV namespace bound as `LICENSE_CACHE`.
  Recreating or clearing that namespace to "reset the cache" destroys every
  published library, and the pull keys cannot be recovered: only their
  SHA-256 digests were ever stored. Every affected user has to republish and
  redistribute a new setup command.
- **KV writes are eventually consistent.** A publish immediately followed by
  a pull from another region can serve the previous bundle for up to about a
  minute. Republish tests should allow for that before treating a stale
  `status` result as a bug.
- **Cancellations propagate within 24h.** A refunded/cancelled subscription
  keeps Pro access until its cache entry (24h TTL) expires — a deliberate
  trade-off for staying available during Lemon Squeezy outages.
- **A bare-key bearer only checks subscription status, not the seat count.**
  `Authorization: Bearer <key>` with no `:instanceId` suffix validates that
  the key's subscription is active, but skips the per-device instance check,
  so a key used this way grants Pro without occupying a device slot. This is
  intentional backward compat for older plugin builds; the current plugin
  always sends `key:instanceId`. Lemon Squeezy still enforces the
  subscription's overall activation limit, so a bare key can't be shared
  past that ceiling. Bare-key bearers can be sunset once no legacy builds
  remain in the wild.

## Bindings & secrets

| Name | Kind | Purpose |
|---|---|---|
| `LICENSE_CACHE` | KV namespace | Two unrelated datasets. License status cache keyed by a SHA-256 digest (30-day TTL), **and** durable library storage under `lib:` / `libowner:` keys with no expiry. Despite the name, this namespace is not disposable. |
| `QUOTA` | Durable Object → `QuotaDO` | Per-identity quota state |
| `ANTHROPIC_API_KEY` | secret | Upstream auth |
| `FIGMA_ID_SALT` | secret | Salted hashing of Figma user IDs. Rotating it resets all free-tier quotas — don't rotate casually. |

## Deploy

```bash
cd packages/proxy
npx wrangler kv namespace create LICENSE_CACHE   # FIRST DEPLOY ONLY; paste the id into wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put FIGMA_ID_SALT            # long random string
npx wrangler deploy
```

Ops: set a spend alert on the Anthropic workspace; `fair_use_flag` and
`upstream_error` log events are the abuse/outage review queue.

## Smoke test

```bash
curl -s https://spec-layer-proxy.<account>.workers.dev/v1/quota -H 'X-Figma-User: smoke-test-1'
# {"tier":"free","used":0,"limit":20,"remaining":20,"resetsAt":"..."}

# Exercise POST /v1/prose through the plugin or the contract tests. Hand-written
# generic Anthropic requests are intentionally rejected.
```

## Development

```bash
npx vitest run packages/proxy      # from the repo root
npm run typecheck
npm run check:proxy-dry-run        # bundle and validate without uploading
```

All business logic is in pure, dependency-injected modules
(`src/quota.ts`, `src/license.ts`, `src/handlers.ts`) tested without
miniflare; `src/index.ts` is the thin Cloudflare adapter.
