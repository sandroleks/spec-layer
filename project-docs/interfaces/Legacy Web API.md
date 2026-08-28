---
title: Legacy Web API
tags:
  - api
  - nextjs
  - legacy
status: retired
updated: 2026-07-27
source: apps/web/src/app/api
---

# Legacy web API

> [!warning] Retired and deleted
> `apps/web` and every route described here were removed in August 2026. This
> page is historical only. See [[ARCHIVE-NOTICE]].

All routes are Next.js App Router handlers under `/api`. They are intended for a trusted loopback deployment.

## Access policy

Most routes use `authorizeApiRequest`:

- allow loopback Host values or `SPEC_LAYER_ALLOWED_HOSTS`;
- allow missing Origin;
- allow matching same Origin;
- allow `Origin: null`;
- allow explicit `SPEC_LAYER_ALLOWED_ORIGINS`.

JSON mutation helpers additionally enforce content type and declared body limits. Settings POST is browser-only and rejects opaque or other cross-origin callers.

## Read and settings routes

| Method and route | Input | Result |
|---|---|---|
| `GET /api/search?q=` | query of at least 2 characters | Up to 12 scored document hits |
| `GET /api/settings` | none | content directory and boolean key presence |
| `POST /api/settings` | `{ anthropic?, figma? }` | Save/remove local keys; never returns raw values |
| `GET /api/figma-preview` | `url` or `fileKey` + `nodeId` | One Figma image result |
| `GET /api/figma-variants` | `fileKey`, comma-separated `ids` | Batched image map, max 200 IDs |
| `POST /api/component/figma` | `{ slug, figma }` | Set or clear a validated Figma URL |

## Navigation routes

All slugs are arrays of safe path segments.

| Method and route | Body | Effect |
|---|---|---|
| `POST /api/nav/create` | `{ parentSlug, type, name }` | Create folder or draft Markdown page |
| `POST /api/nav/delete` | `{ slug, type }` | Delete page/folder and related sidecars |
| `POST /api/nav/move` | `{ slug, type, toParent, index? }` | Move page/folder and rekey ordering |
| `POST /api/nav/rename` | `{ slug, type, name }` | Rename path and page display label |
| `POST /api/nav/reorder` | `{ parentSlug, order }` | Persist child segment order |

Folder deletion includes a strict “inside content root” guard before recursive removal.

## Import and inbox routes

| Method and route | Body | Effect |
|---|---|---|
| `POST /api/specs/import` | `{ spec, extractedAt?, useAi? }` | Render an `IntermediateSpec` and write it to Inbox with sidecar |
| `POST /api/specs/upload` | Markdown multipart file or `{ markdown, filename? }` | Validate and write Markdown-only Inbox item |
| `POST /api/specs/upload-zip` | multipart `.zip` or raw ZIP body | Import Markdown and paired `.spec-data` sidecars |
| `POST /api/specs/move` | `{ fromSlug, group, name }` | Save one Inbox item under a chosen name |
| `POST /api/specs/move-all` | `{ folder, items }` | Save selected Inbox items |
| `POST /api/specs/clear` | `{ items }` | Remove selected Inbox items and sidecars |

### Current limits

| Route | Limit |
|---|---|
| `/api/specs/upload` | 2 MiB |
| `/api/specs/import` | 5 MiB |
| `/api/specs/upload-zip` | 10 MiB compressed, 2,000 entries, 2 MiB/file, 50 MiB total expanded |
| move/clear/enrich JSON batches | 64 KiB |
| settings | 16 KiB |

## Enrichment and editing routes

| Method and route | Body | Effect |
|---|---|---|
| `POST /api/specs/enrich` | `{ slug, target? }` | Fill placeholders or regenerate one supported guideline |
| `POST /api/specs/enrich-all` | `{ items }` | Batch enrich Inbox items |
| `POST /api/specs/regenerate` | `{ slug }` | Re-render from stored extraction, optionally with AI |
| `POST /api/specs/section` | section edit action | Replace, insert, delete, or reorder one section |
| `POST /api/specs/figma-file` | `{ slug, fileKeyOrUrl }` | Update Markdown and sidecar Figma file key |

Supported guideline targets are Definition, Accessibility, and Do's & Don'ts.

Section request fields:

```text
slug, action, index, content?, heading?, expectedHeading?, to?
```

`expectedHeading` protects against editing the wrong section after concurrent file changes.

## CORS and OPTIONS

Mutation routes generally implement `OPTIONS` and return `204`. CORS headers are emitted only for an allowed origin. Preflight does not perform the mutation.

## Not a public API

> [!danger]
> These routes have no user authentication, tenant isolation, project authorization, or public-deployment secret model. Do not expose the server through a tunnel or permissive reverse proxy.
