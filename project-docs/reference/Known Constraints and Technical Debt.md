---
title: Known Constraints and Technical Debt
tags:
  - reference
  - technical-debt
  - constraints
status: archived
updated: 2026-07-27
---

# Known constraints and technical debt

> [!warning] Archived snapshot
> Several items below describe already-retired web, Markdown, and download
> surfaces. Do not treat them as the current backlog. See [[ARCHIVE-NOTICE]].

## Release and infrastructure

### Plugin points to staging

Both plugin source and manifest use:

```text
spec-layer-proxy.spec-layer-test.workers.dev
```

This is intentional for current source builds but must be changed coherently for production.

### WAF rate rule is not represented

License activation/deactivation has a per-isolate limiter. The proxy README calls for a Cloudflare WAF rate rule on `/v1/license/*`, but it remains an operational TODO.

### Free identity is self-asserted

A caller can change `X-Figma-User` and mint another free quota identity. This is an accepted product/cost risk, not strong authentication.

### Bare-key legacy auth

The proxy accepts a license bearer without a device instance for old plugin builds. This weakens current device binding until legacy support is retired.

## Documentation drift already present

### Retired Send to docs path

`ARCHITECTURE.md`, `apps/web/README.md`, and some comments describe plugin delivery to a local docs API. Current plugin source has no endpoint/token settings and explicitly performs local downloads.

### Plugin manifest privacy reasoning

Manifest text says requests carry only a structured summary, but the plugin can include a rendered component image in AI requests. Published privacy/security content should remain synchronized with actual behavior.

### ZIP entry count

The root architecture prose mentions 1,000 entries; current route code permits 2,000 to account for Markdown plus sidecars.

## Plugin architecture debt

### Theme application duplication

`frameKit.applyThemeToKit` and the component doc frame's theme preamble perform overlapping work. Existing architecture notes say they must be changed together until consolidated.

### Foundation Markdown

Foundation frames are generated in Figma, but My Library foundation entries do not offer Markdown download. Foundation output is not part of the strict Markdown specification.

### Token name ambiguity

Live token resolution often starts from a name string without collection context. Identical names across collections can be ambiguous.

### Figma frame width complexity

Component and foundation frames derive widths from content and cap pathological component token widths. Changes to cell padding, columns, or long names can create clipping if the width equation is not updated.

### My Library compatibility

Persistent Figma plugin data requires backward-compatible parsing indefinitely or a deliberate migration strategy. Older component docs may omit the `kind` discriminator.

## Extractor and format constraints

### Format v0.1 is rigid

The strict format requires exact section order and headings. Adding sections is a compatibility change and affects hashes, renderers, parsers, fixtures, and consumers.

### Hash projection is deliberate

Not every extracted field participates in drift hashing. Moving a field into rendering requires moving it into the rendered projection/hash, and removing a field from rendering should prevent noisy hash changes.

### Remote foundation variables

A remote variable alias may have a name but no locally mappable value because remote collection mode IDs cannot be reconciled with local modes.

### Foundation mode/size caps

Only four mode columns render. Collections over 150 rows split by group. Omitted modes and split part numbering must remain visible and stable.

## Legacy web app

### Local-only security model

The app is not suitable for public or multi-user hosting.

### Synchronous filesystem I/O

Several request and render paths use synchronous Node filesystem operations. This is acceptable for the local tool but limits scalable deployment.

### Sidecar dependency

Rich regeneration and variant views depend on `.spec-data`. Raw Markdown imports intentionally lose those structured capabilities.

### Direct Anthropic key path

The web app uses a local direct key, while the plugin uses the proxy. Quotas, caches, failure modes, and privacy boundaries differ.

### Legacy lifecycle

The root README says the web app may be removed. New product features should not silently depend on it.

## Data lifecycle

### Quota month keys

The Durable Object state prunes responses and reservations but not historical monthly counter keys. State growth is slow but unbounded over a very long lifetime.

### Filesystem AI cache

The legacy app's `.spec-cache` has no explicit TTL/size policy. Prompt version changes prevent semantic reuse but do not remove old files.

## Maintenance recommendations

1. Treat this vault and live code as the source for current architecture; clean older README/architecture claims in a separate focused change.
2. Make production/staging environment selection explicit rather than editing two constants manually.
3. Align privacy disclosures with image transmission.
4. Add durable edge rate limiting for license endpoints.
5. Plan a compatibility sunset for bare license keys.
6. Decide whether foundation Markdown is a product requirement before extending the strict format.
7. Add bounded cleanup for proxy month history and local AI cache.
