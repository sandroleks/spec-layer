---
title: System Architecture
tags:
  - architecture
  - runtime
  - monorepo
status: living
updated: 2026-07-27
---

# System architecture

Spec Layer is an npm-workspaces monorepo with several runtime areas connected by data contracts rather than a shared server application.

## Runtime topology

```mermaid
flowchart TB
  subgraph Figma["Figma desktop"]
    Main["Plugin main thread<br/>Figma API access"]
    UI["Plugin iframe UI<br/>DOM, state, downloads"]
    Canvas["Figma document<br/>components and generated sections"]
    Main <--> |"typed postMessage protocol"| UI
    Main <--> Canvas
  end

  Format["@spec-layer/format<br/>frontmatter and Markdown parsing"]
  Extractor["@spec-layer/extractor<br/>pure derivation and rendering"]

  UI --> Extractor
  Extractor --> Format
  Main --> Extractor

  UI -->|"HTTPS"| Proxy["Cloudflare Worker proxy"]
  Proxy -->|"HTTPS"| Anthropic["Anthropic Messages API"]
  Proxy -->|"HTTPS"| Lemon["Lemon Squeezy license API"]
  Proxy --> KV["Cloudflare KV"]
  Proxy --> DO["Quota Durable Objects"]

  subgraph Local["Optional local machine"]
    Web["Legacy Next.js docs app"]
    Files["Markdown content tree"]
    Config[".ds-config.json"]
    Cache[".spec-data / .spec-cache"]
    Web <--> Files
    Web <--> Config
    Web <--> Cache
  end

  Web -->|"optional HTTPS"| FigmaAPI["Figma Images API"]
  Web -->|"optional HTTPS"| Anthropic
  UI -->|"local Markdown/ZIP download"| Export["Exported files"]
  Export -. "manual import" .-> Web
```

## Package dependency direction

```mermaid
flowchart LR
  Format["@spec-layer/format"]
  Extractor["@spec-layer/extractor"]
  Plugin["@spec-layer/plugin"]
  Web["md-ds"]
  Proxy["@spec-layer/proxy"]
  Landing["apps/landing"]

  Extractor --> Format
  Plugin --> Extractor
  Plugin --> Format
  Web --> Extractor
  Web --> Format
  Proxy -. "development/test contract only" .-> Extractor
  Landing -. "independent static site" .-> Plugin
```

The intended dependency rule is:

- `format` owns the portable Markdown envelope.
- `extractor` owns pure, Figma-independent derivation.
- `plugin` owns Figma API access and the primary product UI.
- `proxy` owns server authority for AI access, quota, and licensing.
- `apps/web` owns legacy local persistence and authoring.
- `apps/landing` owns public marketing and policy content.

## Architectural boundaries

### Figma API boundary

Only plugin main-thread code should call privileged Figma APIs. It converts Figma nodes and foundation APIs into plain serializable objects before the extractor sees them.

The iframe communicates with the main thread through the union types in `packages/plugin/src/messages.ts`. See [[Plugin Message Protocol]].

### Pure extraction boundary

`@spec-layer/extractor` accepts `SerializedNode` and `SerializedFoundation` values. It must not import or depend on the Figma runtime. This makes extraction deterministic and fixture-testable.

### Markdown contract boundary

`@spec-layer/format` validates the versioned frontmatter and parses Markdown sections. The normative format lives in `spec/SPEC.md`. See [[Markdown Specification]].

### Network authority boundary

The plugin cannot call arbitrary domains because its Figma manifest allowlists only the Spec Layer staging proxy. The proxy, not the plugin, holds `ANTHROPIC_API_KEY` and decides quota and license status.

### Local filesystem boundary

The legacy web app runs as a loopback-only local tool. Its Markdown content tree is the source of truth. It is not a public, authenticated, or multi-tenant service.

## Core invariants

1. Deterministic component content is reproducible from a serialized source tree.
2. Content hashes exclude non-deterministic prose so rewriting prose does not create source-drift noise.
3. Foundation hashes cover the rendered projection, not extraction metadata or unrendered fields.
4. Generated Figma docs persist a link to their source and a self hash for manual-edit detection.
5. Only successful, uncached AI generations consume quota.
6. Raw license keys and raw Figma user IDs must not become Durable Object names or log fields.
7. The local web app must constrain filesystem paths to the configured content root.

## See also

- [[Data Flows]]
- [[Module Map]]
- [[Data and Storage]]
- [[Security and Privacy]]
