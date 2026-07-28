---
title: Data and Storage
tags:
  - storage
  - persistence
  - data
status: living
updated: 2026-07-27
---

# Data and storage

## Storage overview

| Runtime | Store | Data |
|---|---|---|
| Figma plugin device | `figma.clientStorage` | License, AI preference, theme, logo |
| Figma document root | plugin data registry | IDs of generated docs |
| Generated Figma Section | plugin link data | Source, hashes, config, descriptions |
| Local docs app | Markdown tree | Page source of truth |
| Local docs app | `.spec-data` | Structured `IntermediateSpec` sidecars |
| Local docs app | `.spec-cache` | AI completion cache |
| Local docs app | `.ds-config.json` | Content path and optional credentials |
| Proxy | Durable Object | Quota, reservations, 24-hour responses |
| Proxy | KV | Hashed-key license verdict cache |

## Figma document persistence

### Registry

The document root's `specLayerDocs` plugin data contains:

```text
{ v: 1, docIds: [...] }
```

The plugin prunes missing entries and can adopt older generated Sections from the current page.

### Doc links

Each generated Section stores serialized `DocLinkData` under `specLayerDoc`.

Component link data addresses a source node. Foundation link data addresses a collection/group/text-style scope. Both include hashes and generation configuration.

### Hash roles

| Hash | Detects |
|---|---|
| Component/foundation content hash | Deterministic source drift |
| Text/self hash | Manual edits to the generated frame |
| Prose cache key | Identical AI request and prompt version |

## Plugin device persistence

`figma.clientStorage` is per client/device rather than embedded in the Figma file. A team member opening the same file gets the document registry but not another person's license, theme preference, or captured logo.

The brand logo is stored as base64 PNG and size-limited during capture.

## Local content tree

Default:

```text
apps/web/content/components/
```

Conceptual structure:

```text
components/
├── group/
│   └── component.md
├── _inbox/
│   └── imported-component.md
├── .spec-data/
│   ├── group/component.json
│   └── _inbox/imported-component.json
└── .ds-nav.json or navigation sidecars
```

Folders become navigation groups. Markdown is read fresh and written in place.

## Local AI cache

Preferred location is a sibling `.spec-cache` beside the content root. If it is not writable, the app falls back to:

```text
<operating-system-temp>/spec-layer-cache
```

Cache keys are hashed into safe filenames. Cache entries do not have an application-level TTL in the filesystem store; the versioned prompt/cache key invalidates stale prompt shapes.

## Inbox and sidecars

Imports first land in `_inbox`.

- A structured import writes Markdown and `.spec-data`.
- A raw Markdown upload writes no sidecar.
- ZIP imports pair mirrored `.spec-data` entries when present.
- Moving or deleting an Inbox document also moves or deletes the matching sidecar.

Sidecars enable regeneration and rich variant/anatomy rendering. Markdown remains usable without them.

## Proxy Durable Object state

One object per hashed identity stores:

- first-seen timestamp;
- boost usage;
- monthly usage map;
- in-flight cache-key reservations;
- successful response bodies and timestamps;
- recent attempt timestamps for rate limiting.

Expired 24-hour responses and 120-second reservations are pruned during operations. Historical month counters are not currently explicitly pruned.

## Proxy KV state

License cache keys are SHA-256 based and never contain raw keys. Entries store a status and validation timestamp, with a 30-day KV expiration.

## Data retention summary

| Data | Retention behavior |
|---|---|
| Generated Figma Sections | Until user detaches/removes/deletes them |
| Plugin client settings | Until changed, plugin storage cleared, or device reset |
| Local Markdown/sidecars | Until user deletes them |
| Local AI cache | Until manually removed or temp cleanup |
| Proxy response replay | 24 hours |
| Proxy reservation | 120 seconds |
| License KV verdict | Up to 30 days, normally revalidated after 24 hours |
| Proxy quota history | Durable Object lifetime; monthly keys accumulate |

## Related notes

- [[Figma Plugin]]
- [[Legacy Web App]]
- [[Proxy Worker]]
- [[Security and Privacy]]

