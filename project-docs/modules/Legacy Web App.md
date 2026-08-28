---
title: Legacy Web App
tags:
  - module
  - nextjs
  - legacy
status: retired
updated: 2026-07-27
source: apps/web
---

# Legacy web app

> [!warning] Retired and deleted
> `apps/web` was removed in August 2026 and is no longer built, tested, or
> supported. This page is historical only. See [[ARCHIVE-NOTICE]].

`md-ds` is a Next.js App Router application for browsing and editing a filesystem-backed Markdown design system. It remains built and tested but is no longer the primary product direction.

## Runtime model

- Next.js `16`
- React `19`
- server bound to `localhost`
- Markdown content read directly from disk
- server routes for all local mutations and optional external API calls

The default content root is `apps/web/content/components`, resolved at runtime from configuration. Files are always the source of truth.

## User-facing routes

| Route | Purpose |
|---|---|
| `/` | Home and documentation statistics |
| `/components/[...slug]` | Render and edit one Markdown page |
| `/inbox` | Review imported specifications |
| `/settings` | Configure content location and optional keys |

## Major capabilities

- recursively load Markdown documents and derive sidebar navigation;
- render GFM with slugged headings;
- partition content into guideline/spec tabs;
- edit, insert, delete, and reorder Markdown sections;
- create, rename, move, reorder, and delete documents/folders;
- import Markdown, JSON extraction payloads, and ZIP archives;
- preserve `.spec-data` sidecars for structured rendering/regeneration;
- fill empty guideline sections with Anthropic;
- show Figma component and variant previews;
- search component content;
- manage local optional credentials.

## Storage

See [[Data and Storage]] for the full layout. Key areas are:

- content tree;
- `_inbox`;
- `.spec-data`;
- `.spec-cache`;
- `.ds-config.json`;
- `.ds-nav.json` or navigation order sidecars.

## Local request boundary

Every protected API route calls the local access helpers:

1. Host must be loopback or explicitly allowlisted.
2. Same-origin and no-Origin requests are allowed on an allowed host.
3. `Origin: null` is allowed for historical Figma plugin compatibility.
4. Other cross-origin callers require an explicit allowlist entry.

Browser-only settings mutations use a stricter guard that rejects opaque and cross-origin callers.

See [[Legacy Web API]] and [[Security and Privacy]].

## External services

Optional Figma previews use the Figma Images API with `FIGMA_TOKEN`.

Optional guideline generation calls Anthropic directly from the Next.js server with `ANTHROPIC_API_KEY` or the local settings value. It does not use the Cloudflare proxy or its quota system.

## Content rendering

`content.ts` parses frontmatter and documents, builds navigation, and provides file lookup. `sections.ts` classifies canonical headings. `react-markdown`, `remark-gfm`, and `rehype-slug` render bodies.

## Editing and concurrency

Section edits carry an optional `expectedHeading` guard. If the file changed and the indexed heading no longer matches, the route returns a conflict instead of editing the wrong section.

AI enrichment stores the source hash and rejects a write when the source specification changed during generation.

## Import limits

| Input | Limit |
|---|---|
| Markdown | 2 MiB |
| JSON extraction import | 5 MiB |
| ZIP request | 10 MiB compressed |
| ZIP entries | 2,000 current code limit |
| One expanded ZIP file | 2 MiB |
| Total expanded ZIP | 50 MiB |

The root architecture note says 1,000 ZIP entries, but current route code sets `MAX_ENTRIES = 2000` because one component may include both Markdown and a sidecar.

## Limitations

- Not hardened for public exposure or multiple users.
- Uses synchronous filesystem operations in several server paths.
- Current plugin has no direct delivery integration.
- May be removed in a future release.

## Related notes

- [[Legacy Web API]]
- [[Data and Storage]]
- [[Configuration and Secrets]]
- [[Known Constraints and Technical Debt]]
