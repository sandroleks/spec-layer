---
title: Proxy Worker
tags:
  - module
  - proxy
  - cloudflare
  - licensing
status: living
updated: 2026-07-27
source: packages/proxy
---

# Proxy Worker

`@spec-layer/proxy` is a Cloudflare Worker that is authoritative for plugin AI access, quota state, and Pro license validation.

## Responsibilities

- Hold the Anthropic API key.
- Restrict AI requests to the expected model and maximum output size.
- Authenticate a request as a Pro license identity or a free Figma identity.
- Validate and activate/deactivate Lemon Squeezy licenses.
- Enforce free usage limits, Pro fair-use signals, and request rate limits.
- Deduplicate retries using content-derived cache keys.
- Return quota state to the plugin.

## Module structure

| File | Responsibility |
|---|---|
| `src/index.ts` | Cloudflare adapter, bindings, Durable Object bridge |
| `src/handlers.ts` | HTTP routing, CORS, validation, upstream orchestration |
| `src/identity.ts` | Header precedence and salted Figma ID hashing |
| `src/license.ts` | Lemon Squeezy calls, cache, grace behavior |
| `src/quota.ts` | Pure quota and idempotency state machine |
| `src/ratelimit.ts` | In-memory sliding-window limiter for license endpoints |

## Identity model

License identity takes precedence when both identity headers exist.

```text
Authorization: Bearer <license-key>:<instance-id>
```

Legacy clients may send a bare license key without an instance ID.

Free identity:

```text
X-Figma-User: <figma-user-id>
```

The Worker hashes a free Figma ID with `FIGMA_ID_SALT` before it is used as an identity. License quota identities use `sha256(licenseKey)`.

## Quota engine

| Rule | Value |
|---|---|
| Initial free allowance | 20 successful generations |
| Initial window | 30 days from first reservation |
| Later free allowance | 10 successful generations per UTC month |
| Per-identity request rate | 10 attempts per rolling minute |
| Pro hard limit | None |
| Pro fair-use log threshold | 1,000 committed generations per UTC month |
| Same-key reservation lifetime | 120 seconds |
| Successful response replay lifetime | 24 hours |

Only `commit` increments usage. Failed Anthropic requests release the reservation and do not consume quota.

Each identity maps to one `QuotaDO`. Durable Object serialization makes reserve/commit behavior atomic without application-level locks.

## License behavior

- License format is UUID-like and rejected before upstream calls if malformed.
- Status is cached for 24 hours.
- KV entries expire after 30 days.
- A previous verdict is honored for up to 5 days during transient Lemon Squeezy failures.
- `429`, `5xx`, network failures, and bodies missing the endpoint verdict are treated as transient, not invalid.
- Activation validates an existing `instanceId` instead of consuming another device slot.
- Deactivation is best-effort from the plugin's perspective.

## Request safety

`validateProseBody` requires:

- `cacheKey` beginning with `prose:v<integer>:`;
- model exactly `claude-haiku-4-5`;
- numeric `max_tokens` no greater than `3000`;
- a messages array.

This prevents the Worker from becoming a generic Anthropic relay, although message content itself is passed through after validation.

## CORS

The Worker returns:

- `Access-Control-Allow-Origin: *`;
- allowed methods `GET, POST, OPTIONS`;
- allowed headers `Authorization, Content-Type, X-Figma-User`;
- exposed quota headers.

Wildcard origin is intentional because the Figma iframe has an opaque origin, authentication is header-based, and the Worker uses no cookies.

## Bindings

- `LICENSE_CACHE`: Cloudflare KV
- `QUOTA`: Durable Object namespace bound to `QuotaDO`
- `ANTHROPIC_API_KEY`: secret
- `FIGMA_ID_SALT`: secret

See [[Configuration and Secrets]].

## Logging

Expected structured event names:

- `fair_use_flag`
- `upstream_error`

Prompts and generated prose should not be logged.

## Related notes

- [[Proxy API]]
- [[Network and External Services]]
- [[Security and Privacy]]
- [[Deployment and Release]]

