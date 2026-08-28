---
title: Source Catalog
tags:
  - reference
  - modules
  - source
status: archived
updated: 2026-07-27
---

# Source catalog

> [!warning] Archived snapshot
> This catalog includes files and directories deleted in August 2026. Use
> `docs/plugin-knowledge-map.md` and the repository tree. See [[ARCHIVE-NOTICE]].

This is a file-level map of production source. Test files mirror these modules and are intentionally summarized by package rather than listed one by one.

## `packages/format`

| File | Responsibility |
|---|---|
| `src/types.ts` | Strict Spec Layer v0.1 frontmatter types |
| `src/frontmatter.ts` | YAML serialization and strict validation |
| `src/markdown.ts` | General Markdown/frontmatter parsing |
| `src/index.ts` | Public barrel |

## `packages/extractor`

| File | Responsibility |
|---|---|
| `src/tree.ts` | Serialized Figma tree, property, token, and layout contracts |
| `src/anatomy.ts` | Default variant choice, anatomy walk, related components |
| `src/props.ts` | Component props, variant axes, and state extraction |
| `src/tokens.ts` | Variant parsing, token rules, conditions, extraction gaps |
| `src/layout.ts` | Layout summaries |
| `src/rawValues.ts` | Hardcoded/unbound presentation values |
| `src/extract.ts` | Assemble `IntermediateSpec` |
| `src/resolve.ts` | Resolve token rules for a concrete variant |
| `src/statesMatrix.ts` | Detect and model bounded state matrices |
| `src/pivot.ts` | Token categorization and Markdown table layouts |
| `src/hash.ts` | Canonical SHA-256 content hashes |
| `src/render.ts` | Strict Spec Layer Markdown renderer |
| `src/foundation.ts` | Foundation types, alias resolution, grouping, planning, projection |
| `src/prose/prompt.ts` | Component prompt, voice, schema, parsing, cache key |
| `src/prose/foundationPrompt.ts` | Foundation group-description prompt and parsing |
| `src/prose/client.ts` | Direct/proxy Anthropic transport and quota parsing |
| `src/index.ts` | Public barrel |

## `packages/plugin` main/shared

| File | Responsibility |
|---|---|
| `src/main.ts` | Figma runtime entry, selection, storage, messages, frame lifecycle |
| `src/messages.ts` | Typed main/UI protocol |
| `src/serialize.ts` | Component node serialization |
| `src/serializeFoundation.ts` | Variable collection and text-style serialization |
| `src/fileKey.ts` | Figma file-key resolution and sentinel behavior |
| `src/collectComponents.ts` | Component collection helpers and atom naming |
| `src/docLink.ts` | Persistent link/registry model and status hashes |
| `src/exportFiles.ts` | Export tree creation and ZIP compression |
| `src/brandColors.ts` | Theme model, defaults, migration, presets |
| `src/brandHeader.ts` | Shared component/foundation branded header |
| `src/fonts.ts` | Font compatibility and filtering |
| `src/frameKit.ts` | Reusable Figma layout and styling primitives |
| `src/docFrame.ts` | Component documentation frame renderer |
| `src/measureSection.ts` | Measurement diagrams and token badges |
| `src/statesSection.ts` | State matrix frame renderer |
| `src/tokenResolve.ts` | Live Figma token value resolution caches |
| `src/foundationFrame.ts` | Foundation tables, color swatches, text styles |
| `build.mjs` | Main/UI esbuild bundles |
| `manifest.json` | Figma capabilities, permissions, network allowlist |

## `packages/plugin/src/ui`

| File | Responsibility |
|---|---|
| `ui.ts` | Iframe entry, event wiring, inbound messages, async coordination |
| `dom.ts` | UI HTML/CSS generation and typed element references |
| `actions.ts` | Extract, assemble, create, download, update, export actions and state |
| `ai.ts` | Plugin-specific prose generation wrapper |
| `docModel.ts` | Configurable canvas/download section model |
| `modelMarkdown.ts` | Render `DocFrameModel` as Markdown |
| `foundationState.ts` | Foundation selection, counts, briefs, empty states |
| `proxy.ts` | Proxy/license URL constants, auth, quota/license view models |
| `render.ts` | UI rendering functions and banners/loaders |
| `state.ts` | UI phases and pure state transitions |
| `theme.ts` | Light/dark UI theme behavior |
| `fontPicker.ts` | Custom font picker behavior |

## `packages/proxy`

| File | Responsibility |
|---|---|
| `src/index.ts` | Cloudflare entry, environment, `QuotaDO`, namespace client |
| `src/handlers.ts` | Endpoint routing, CORS, proxy orchestration |
| `src/identity.ts` | Free/Pro identity parsing and hashing |
| `src/license.ts` | Lemon Squeezy client and cached verdict logic |
| `src/quota.ts` | Pure quota/reservation/response state machine |
| `src/ratelimit.ts` | Sliding-window IP limiter |
| `wrangler.toml` | Worker, KV, and Durable Object configuration |

## `apps/web/src/lib`

### Content and navigation

| File | Responsibility |
|---|---|
| `config.ts` | Content root and config path resolution |
| `content.ts` | Markdown discovery, parse, lookup, frontmatter updates, nav tree |
| `contentCache.ts` | React-cached reads |
| `sections.ts` | Heading classification and guideline/spec partition |
| `sectionEdit.ts` | Pure Markdown section operations |
| `sectionEditFile.ts` | File mutation and stale-heading guard |
| `slug.ts` | Kebab slug conversion |
| `navFs.ts` | Sidecar paths and content-root containment |
| `navOrder.ts` | Persistent manual ordering transformations |
| `navInbox.ts` | Inbox filtering/count helpers |
| `commandPalette.ts` | Search/filter model for commands |
| `homeStats.ts` | Home-page statistics |
| `repo.ts` | Repository URL discovery and normalization |
| `tabs.ts` | Keyboard tab index navigation |

### Inbox and imports

| File | Responsibility |
|---|---|
| `specWriter.ts` | Inbox Markdown/sidecar writes and stored-spec reads |
| `zipImport.ts` | Bounded unzip and archive entry selection |
| `requestLimits.ts` | Declared content-length guard |
| `inboxMove.ts` | Move, rename, batch save, clear, sidecar coordination |
| `inboxSummary.ts` | Inbox counts and source summary |
| `inboxList.ts` | Inbox display filtering/state |
| `inboxSelection.ts` | Selection set logic |
| `inboxSaveFolder.ts` | Persisted destination folder preference |
| `inboxEnrich.ts` | Batch guideline enrichment |

### AI, Figma, settings, and security

| File | Responsibility |
|---|---|
| `figma.ts` | Figma URL parse and Images API client |
| `settings.ts` | Atomic local credential read/write |
| `specCache.ts` | Filesystem AI cache |
| `aiDraftCache.ts` | Read cached prose drafts for a spec |
| `guidelineFill.ts` | Placeholder detection and section content insertion |
| `guidelineFillFile.ts` | Concurrency-safe file enrichment |
| `enrichDeps.ts` | Create AI/image/cache dependencies |
| `localAccess.ts` | Host/Origin policy and CORS decisions |
| `requestSecurity.ts` | Mutation content-type, access, size guards |
| `specApi.ts` | Next.js API authorization and safe slug helpers |

## `apps/web/src/app`

| Path | Responsibility |
|---|---|
| `layout.tsx` | Application shell |
| `page.tsx` | Home |
| `components/[...slug]/page.tsx` | Component document page |
| `inbox/page.tsx` | Inbox workspace |
| `settings/page.tsx` | Settings page |
| `settings/SettingsForm.tsx` | Browser-side settings form |
| `globals.css` | Global design and responsive styling |
| `api/**/route.ts` | Local API documented in [[Legacy Web API]] |

## `apps/web/src/components`

| File/group | Responsibility |
|---|---|
| `Sidebar.tsx`, `EditableNav.tsx` | Navigation display and mutations |
| `CommandPalette.tsx` | Search and command navigation |
| `ComponentTabs.tsx`, `SpecsTab.tsx` | Guideline/spec partition and structured views |
| `EditableSection.tsx` | Section editing controls |
| `FigmaPreview.tsx`, `FigmaSection.tsx`, `FigmaFileEmptyState.tsx` | Figma linking and preview states |
| `InboxWorkspace.tsx`, `InboxComponentList.tsx` | Inbox review UI |
| `InboxDocActions.tsx`, `InboxFolderSelect.tsx` | Per-item save and folder choice |
| `ManualImport.tsx`, `ImportComponent.tsx` | Markdown/ZIP/paste import |
| `GapsAlert.tsx` | Extraction gap display |
| `SectionSkeleton.tsx` | Loading placeholder |
| `ThemeToggle.tsx` | Theme control |
| `inboxBulkRequest.ts`, `inboxClearRequest.ts`, `inboxSaveRequest.ts` | Client Inbox API request helpers |
| `useInboxSaveFolder.ts` | Browser-side save-folder preference hook |
| `manualImportTabs.ts` | Import tab state |

## `apps/landing`

Static files:

- `index.html`: marketing application;
- policy pages: privacy, security, terms, refund;
- `motion.js` and `lenis.min.js`: vendored interaction libraries;
- logo, poster, screenshots, and video assets.

## Root and supporting sources

| Path | Responsibility |
|---|---|
| `spec/SPEC.md` | Normative open format |
| `spec/SIDECAR.md` | Structured sidecar contract/supporting notes |
| `ARCHITECTURE.md` | Existing architecture narrative, some historical statements |
| `README.md` | Product and contributor entry point |
| `docs/*` | Backlog, voice, prose, and plugin/product knowledge |
| `.github/workflows/ci.yml` | Continuous integration |
| `.githooks/pre-commit` | Sensitive-content scanning backstop |
