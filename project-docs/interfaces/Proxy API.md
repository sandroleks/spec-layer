---
title: Proxy API
tags:
  - api
  - proxy
  - network
status: archived
updated: 2026-08-28
source: packages/proxy/src/handlers.ts
---

# Proxy API

> [!warning] Archived snapshot
> This page is retained for the July 2026 architecture record. Use
> `packages/proxy/README.md` and production source for the current API. See
> [[ARCHIVE-NOTICE]].

Base URL in current plugin builds:

```text
https://spec-layer-proxy.spec-layer-test.workers.dev
```

## Authentication

Protected endpoints accept one identity:

```http
Authorization: Bearer <license-key>:<instance-id>
```

or:

```http
X-Figma-User: <figma-user-id>
```

License authentication wins when both are present. License activation and deactivation accept the key in the JSON body and are separately rate-limited by source IP.

## `POST /v1/prose`

Generates or replays component prose.

### Request

```json
{
  "cacheKey": "prose:v8:<content-derived-value>",
  "request": {
    "model": "claude-haiku-4-5",
    "max_tokens": 3000,
    "messages": []
  }
}
```

The real request may also include Anthropic system and message content fields. Validation requires the exact model, `max_tokens <= 3000`, messages array, and a versioned prose cache key.

### Success

Status `200`, body is the Anthropic Messages response JSON.

Response headers:

- `X-Tier`
- `X-Quota-Used`
- `X-Quota-Limit`
- `X-Quota-Remaining`
- `X-Quota-Resets-At`

For Pro, limit and remaining are the string `unlimited`.

### Errors

| Status | Meaning |
|---|---|
| `400` | Invalid JSON or request outside the allowlist |
| `401` | Missing identity or license not active |
| `402` | Free quota exhausted |
| `409` | Same cache key already has a live generation reservation |
| `429` | Per-identity rate limit exceeded |
| `502` | Anthropic unreachable or returned an error |

An upstream failure releases the reservation and does not decrement quota.

## `GET /v1/quota`

Returns the current meter:

```json
{
  "tier": "free",
  "used": 3,
  "limit": 20,
  "remaining": 17,
  "resetsAt": "2026-08-26T12:00:00.000Z"
}
```

When a stored license is not granting Pro, the free response can also include `licenseReason` with `invalid`, `expired`, `inactive`, or `unreachable`.

## `POST /v1/license/activate`

New device:

```json
{
  "key": "00000000-0000-0000-0000-000000000000",
  "instanceName": "Figma plugin"
}
```

Known device:

```json
{
  "key": "00000000-0000-0000-0000-000000000000",
  "instanceId": "existing-instance-id"
}
```

The known-device form validates rather than consuming another activation slot.

Success shape:

```json
{
  "valid": true,
  "status": "active",
  "instanceId": "..."
}
```

Malformed UUID-like keys are returned as invalid without an upstream request. Lemon Squeezy transient failure returns `502 { "error": "ls_unreachable" }`.

## `POST /v1/license/deactivate`

```json
{
  "key": "00000000-0000-0000-0000-000000000000",
  "instanceId": "..."
}
```

Returns the Lemon Squeezy deactivation result.

## `OPTIONS *`

Returns `204` with CORS headers. Preflight performs no identity or license work.

## Quota behavior

See [[Proxy Worker]] for limits and persistence.
