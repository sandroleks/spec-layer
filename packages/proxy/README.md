# @spec-layer/proxy

The license + AI proxy for the Spec Layer Figma plugin (spec §6.1). A
Cloudflare Worker that sits between the plugin and the Anthropic API: it
validates Lemon Squeezy licenses, enforces free/pro quotas server-side, and
holds the Anthropic key so the plugin never sees it.

## API

Auth on every endpoint: `Authorization: Bearer <license-key>` (pro) **or**
`X-Figma-User: <figma-user-id>` (free; stored only as a salted SHA-256 hash).

### `POST /v1/prose`

Body: `{ "cacheKey": "prose:v8:<hash>...", "request": <Anthropic messages body> }`

The `request` is forwarded verbatim to `POST /v1/messages`, guarded by an
allowlist: `model === 'claude-haiku-4-5'`, `max_tokens ≤ 3000`. The
`cacheKey` (deterministic content hash from `proseCacheKey`) doubles as the
idempotency key — a retry within 24h replays the stored response without a
second upstream call or quota decrement.

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

## Quota rules

- Free: 20 generations within 30 days of first sight, then 10 per UTC
  calendar month. Only uncached, successful generations count.
- Pro: unlimited; flagged for review at ≥1,000/month (`fair_use_flag` log).
- Rate limit: 10 requests/min per identity, both tiers.
- License status cached 24h; 5-day grace on Lemon Squeezy outages.

Atomicity: one Durable Object per identity (`QuotaDO`) serializes all quota
ops. The only server-side content storage is the 24h idempotency response
cache inside the DO; prompts and prose are never logged.

## Bindings & secrets

| Name | Kind | Purpose |
|---|---|---|
| `LICENSE_CACHE` | KV namespace | License status cache (`lic:<key>`) |
| `QUOTA` | Durable Object → `QuotaDO` | Per-identity quota state |
| `ANTHROPIC_API_KEY` | secret | Upstream auth |
| `FIGMA_ID_SALT` | secret | Salted hashing of Figma user IDs. Rotating it resets all free-tier quotas — don't rotate casually. |

## Deploy

```bash
cd packages/proxy
npx wrangler kv namespace create LICENSE_CACHE   # paste the id into wrangler.toml
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

curl -s -X POST https://spec-layer-proxy.<account>.workers.dev/v1/prose \
  -H 'X-Figma-User: smoke-test-1' -H 'content-type: application/json' \
  -d '{"cacheKey":"prose:v8:smoke1","request":{"model":"claude-haiku-4-5","max_tokens":256,"messages":[{"role":"user","content":"Say OK."}]}}'
# Anthropic response JSON + X-Quota-Used: 1
```

## Development

```bash
npx vitest run packages/proxy      # from the repo root
npm run typecheck
```

All business logic is in pure, dependency-injected modules
(`src/quota.ts`, `src/license.ts`, `src/handlers.ts`) tested without
miniflare; `src/index.ts` is the thin Cloudflare adapter.
