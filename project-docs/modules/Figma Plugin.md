---
title: Figma Plugin
tags:
  - module
  - figma
  - plugin
status: living
updated: 2026-07-27
source: packages/plugin
---

# Figma plugin

`@spec-layer/plugin` is the primary product. It runs as a Figma plugin with a privileged main thread and a browser-like iframe UI.

## Runtime split

### Main thread

Entry: `src/main.ts`

Owns:

- selection resolution and Figma node traversal;
- serialization through `serializeNode`;
- access to variables, styles, component instances, fonts, and exports;
- creation and replacement of Figma documentation Sections;
- foundation reads and foundation frame generation;
- per-device `figma.clientStorage`;
- per-document plugin data and the My Library registry;
- focus, detach, and remove operations;
- opening approved external URLs.

### Iframe UI

Entry: `src/ui/ui.ts`

Owns:

- UI construction and DOM events;
- extraction through `@spec-layer/extractor`;
- selected section and variant configuration;
- UI state and phase transitions;
- optional proxy-routed AI generation;
- quota and license presentation;
- construction of `DocFrameModel`;
- local Markdown and ZIP downloads;
- My Library interaction requests.

The two sides communicate only with typed messages. See [[Plugin Message Protocol]].

## Selection behavior

The main thread walks upward from each selected scene node:

- a `COMPONENT_SET` is used directly;
- a component inside a set resolves to the set;
- a standalone `COMPONENT` resolves to itself;
- non-component selections produce an empty state.

Selection serialization is asynchronous. A monotonically increasing sequence prevents a slow result for selection A from overwriting a newer selection B.

## Component serialization

`serialize.ts` converts live Figma nodes into `SerializedNode`. Injected `NodeResolver` functions resolve:

- variable names;
- style names;
- main-component references for instances.

This keeps extraction pure and serializer tests independent of Figma.

## Canvas documentation

The UI builds a `DocFrameModel` containing only selected sections. Main-thread frame modules create Figma nodes:

- `docFrame.ts`: component guideline cards and section layout;
- `measureSection.ts`: size, padding, and spacing diagrams;
- `statesSection.ts`: state matrix;
- `brandHeader.ts`: shared header band;
- `frameKit.ts`: stacks, text, colors, fonts, theme, and slots;
- `tokenResolve.ts`: best-effort live token value resolution.

Rebuilding replaces the existing Section in place when a linked doc already exists.

## Foundations

The Foundations tab is file-scoped and requires no selection. It reads local variables and text styles, then:

1. serializes them through `serializeFoundation`;
2. builds and plans units through the extractor;
3. optionally generates folder descriptions;
4. renders branded foundation Sections.

Foundation documents join the same registry as component documents.

## My Library

`docLink.ts` defines the persistent model:

- `DOC_LINK_KEY = "specLayerDoc"` on each generated Section;
- `DOC_REGISTRY_KEY = "specLayerDocs"` on the document root;
- component and foundation link variants;
- stored source content hash;
- self hash for manual edits;
- source/generation configuration;
- status resolution: `inSync`, `updateAvailable`, `edited`, `orphaned`.

Legacy component links without an explicit `kind` remain parseable for backward compatibility.

## Client storage

The plugin stores device-local preferences with `figma.clientStorage`:

| Key | Purpose |
|---|---|
| `licenseKey` | Lemon Squeezy license key |
| `licenseInstanceId` | Activated device instance |
| `aiEnabled` | Global Write with AI preference |
| `brandTheme` | Current frame theme |
| `brandColors` | Legacy value migrated into `brandTheme` |
| `brandLogo` | Base64 PNG captured from a selected node |

License activity is probed each session and is not persisted as truth.

## Downloads

Single-component download:

- builds the same selected model used by Create frame;
- writes `<slug>.spec.md`;
- creates a local browser Blob;
- does not call a docs endpoint.

Bulk export:

- writes Markdown plus optional `.spec-data` JSON sidecars;
- creates a ZIP using `fflate`.

## Network

The manifest allowlists only:

`https://spec-layer-proxy.spec-layer-test.workers.dev`

The UI also contains checkout, subscription, storefront, marketing, and author URLs, which are opened through the main thread. The AI request destination is the staging proxy. See [[Network and External Services]].

## Build

`build.mjs` creates:

- `dist/main.js`: IIFE bundle of `src/main.ts`;
- `dist/ui.html`: bundled UI JavaScript embedded in a minimal HTML document.

The plugin package version is injected as `__PLUGIN_VERSION__` and stored in generated doc metadata.

## Dependencies

- `@spec-layer/extractor`
- `@spec-layer/format`
- `fflate`
- build-time `esbuild`
- Figma plugin typings

## Important current-state note

> [!warning]
> Source builds and the manifest point at the staging Worker. Both `src/ui/proxy.ts` and `manifest.json` must move together when a production proxy domain is introduced.

## Related notes

- [[Plugin Message Protocol]]
- [[Proxy Worker]]
- [[Data and Storage]]
- [[Security and Privacy]]
- [[Development and Testing]]

