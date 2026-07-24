# Plugin Knowledge Map: "Auto Guidelines & Specs"

*Systematized reference for the Figma plugin and its supporting packages. Compiled 2026-07-11 on branch `plugin-2.0` (HEAD `e831c7d` plus uncommitted states-matrix work). Update this document when the architecture shifts, not for every commit.*

## 1. What the plugin is

**Auto Guidelines & Specs** (Figma plugin id `1652104411578396548`, internally `@spec-layer/plugin`) is a standalone Figma plugin that turns a selected component or component set into:

1. An **on-canvas documentation Section** with up to three card frames: Usage, Specifications, Accessibility.
2. A **downloadable zip** with a Markdown spec (`<slug>.md`) plus a `.spec-data/<slug>.json` sidecar carrying the full `IntermediateSpec`.

AI prose (Overview, Accessibility, Do's & Don'ts, Interactions, Considerations, variant/anatomy guidance) is optional and BYO-key: the plugin calls `https://api.anthropic.com` directly from the UI iframe using an Anthropic API key the user enters in Settings (stored in `clientStorage`). That is the only allowed network domain in the manifest. Everything else is deterministic extraction; the strategy is extraction depth over AI (see `docs/strategy/2026-06-22-positioning-and-pivot.md`).

### How it got here

- `main` (v1.0.0): the plugin was a satellite of the local Next.js docs app ("Send to docs" via localhost).
- `plugin-standalone`: nominally a throwaway prototype (in-plugin AI, on-canvas guidelines frame). It graduated instead of being thrown away.
- `plugin-v1-publish`: dropped Send-to-docs and Export-all, added brand theming; repositioned as a publishable standalone plugin.
- `plugin-2.0` (current): Measure section, states matrix, anatomy depth, diff-aware variant cards, three-frame grouping, Overview rename, a11y section expansion, selection-aware prose with v8 key-aware cache.

Known staleness: the root README still documents the old localhost/Send-to-docs architecture, and CHANGELOG.md stops at the pre-pivot v1.0.0. The web app's import API endpoints still exist but the published plugin no longer targets them.

## 2. Package layout and responsibilities

npm workspaces monorepo (`spec-layer`), Node >= 20.9:

| Package | Role |
|---|---|
| `packages/plugin` (`@spec-layer/plugin`) | Figma main thread + UI iframe. Serializes nodes, orchestrates extraction/AI, builds canvas frames, zips exports. |
| `packages/extractor` (`@spec-layer/extractor`) | Pure, Figma-API-free brain. `SerializedNode` JSON in, `IntermediateSpec` out; Markdown rendering; AI prose subsystem. |
| `packages/format` (`@spec-layer/format`) | Spec Markdown contract: frontmatter types, strict parse/serialize, lenient `parseMarkdown` for uploads. |
| `apps/web` (`md-ds`) | Next.js docs/authoring app. Shares the extractor; no longer the plugin's target, but its import APIs remain. |

The extractor is deliberately free of Figma globals so it runs under vitest. The plugin's `serialize.ts` is the boundary: it walks live Figma nodes and produces plain JSON, resolving variables/styles to token names through an injected `NodeResolver`.

## 3. Runtime architecture

Two JS contexts connected by a typed message protocol (`packages/plugin/src/messages.ts`).

### Main thread (`src/main.ts`)

- Boots UI (480x640), loads settings from `clientStorage` (`anthropicKey`, `aiEnabled`, `brandTheme` with migration from legacy `brandColors`, `brandLogo`) and pushes them to the UI.
- On selection change: `findComponent()` walks up to the enclosing COMPONENT/COMPONENT_SET, `serializeNode()` serializes it, posts `selection`.
- Handles `renderDocFrame`: replaces any prior `"<Name>: Documentation"` SECTION, calls `buildDocFrames`, positions beside the source component, zooms to it.
- Exports PNGs on request (`captureLogo`, `requestComponentImage`, capped ~1568px) and font lists.

### UI iframe (`src/ui/`)

| File | Responsibility |
|---|---|
| `ui.ts` | Entry point; wires DOM events and the `MainToUi` message switch. |
| `dom.ts` | All static markup + CSS (`TEMPLATE`), typed `Refs`; `DEFAULT_OFF_SECTIONS` (Related + three verbose a11y sections are opt-in). |
| `actions.ts` | Business logic + `UiState`: extract, create frame, download, prose reuse guards, settings setters. |
| `ai.ts` | `generateProse`: request screenshot from main (15s fail-open), call extractor `draftProse` with `window.fetch`; in-memory cache. |
| `docModel.ts` | The bridge: `buildDocModel(spec, prose, sections, variantIds, opts)` -> `DocFrameModel`. Owns `ALL_SECTIONS`, `GROUPS`, `proseKeysForSections`. |
| `render.ts` | View updates only: banners, loader, variant picker, states hint, theme swatches. |
| `state.ts` | Pure helpers: `nextStatus` phase machine (`idle -> extracting -> reviewing -> sent`), `toKebab`. |
| `theme.ts` | Light/dark detection from Figma classes/CSS vars; no persistence. |

### Message protocol

- **Main -> UI**: `selection`, `anthropicKey`, `aiEnabled`, `brandTheme`, `fontList`, `logoCaptured`/`logoCleared`/`logoError`, `componentImage`/`componentImageError`, `docFrameDone`/`docFrameError`.
- **UI -> Main**: `requestSelection`, `notify`, `openBrowser`, `setAnthropicKey`, `setAiEnabled`, `setBrandTheme`, `requestFonts`, `captureLogo`/`clearLogo`, `requestComponentImage`, `renderDocFrame` (the core command, carries the full `DocFrameModel`).

### End-to-end flow

1. Boot: settings pushed to UI; UI sends `requestSelection` + `requestFonts`.
2. Selection: main serializes the enclosing component and posts it; UI auto-extracts immediately (`extract` + `renderSpec`), so Download/Create-frame never block.
3. AI (optional): only when the toggle is on, a key exists, and at least one AI-backed section is checked. Screenshot -> `draftProse` -> cached `ProseDrafts`. Any failure degrades to `_To be written._` placeholders; it never aborts the frame.
4. `buildDocModel` assembles a `DocFrameModel` from checked sections + selected variant ids.
5. `renderDocFrame`: main builds the Section via `buildDocFrames`, replaces the old one, zooms.
6. Alternative output: `runDownload` zips md + JSON sidecar locally (no network).

## 4. The documentation frame: groups, sections, builders

Three group cards (empty groups skipped): **Usage / Specifications / Accessibility**. 13 sections defined in `ui/docModel.ts` (`ALL_SECTIONS`); one grouping map drives both the config UI (tri-state collapsible groups) and frame output.

| Section (id) | Group | AI? | Canvas rendering |
|---|---|---|---|
| Overview (`definition`) | Usage | yes | Prose; first sentence lifted into the header subtitle (`liftDefinitionLead`). |
| Variants (`variants`) | Usage | summary | Live-instance preview matrix (`buildMatrixSection`) + AI decision-guide prose. |
| Do's & Don'ts (`dosDonts`) | Usage | yes | Bullet rows with check/cross markers. |
| Related atoms (`related`) | Usage | no | Bullets. |
| Anatomy (`anatomy`) | Specs | part roles | Numbered-pin callout diagram over a live instance + legend, and/or table. |
| Measurements (`measurements`) | Specs | no | `buildMeasureSection`: unified 4-rail redline diagram (blue padding, pink gap, red size badges); lens toggles size/padding/spacing; falls back to a table. |
| Configuration (`configuration`) | Specs | no | Table of non-variant props. |
| States (`states`) | Specs | no | Preview matrix from `detectStateMatrix`; auto-hidden when no state axis. |
| Tokens used (`tokens`) | Specs | no | Token chips with resolved color swatches and value suffixes, grouped by part; per-variant tables with diff-vs-default. |
| Interactions (`interactions`) | A11y | yes | Prose (Mouse/Keyboard/Other), opt-in by default. |
| Design Considerations (`designConsiderations`) | A11y | yes | Prose bullets, opt-in. |
| Content Considerations (`contentConsiderations`) | A11y | yes | Prose bullets, opt-in. |
| Accessibility (`accessibility`) | A11y | yes | Prose. |

Key builder files:

- `docFrame.ts`: `buildDocFrames(model, theme, logo)`; group cards, header band, section dispatcher, tables, token chips, anatomy diagram, `fitFrameWidthToTokens` (880 -> up to 1440px for long token paths).
- `frameKit.ts`: shared primitives — mutable `palette`, `vstack`/`hstack`, `makeText`, `buildSlot` (live instance rescaled into a bordered box), and `matchVariableModes` (forces instances to resolve variables in the source component's modes; load-bearing for density-mode correctness).
- `statesSection.ts`: `buildMatrixSection` shared by States and Variants; pure `matrixBandLayout` helper (unit-tested).
- `measureSection.ts`: the redlines diagram; `computeGeom`, rail placement, bindings row.
- `tokenResolve.ts`: token -> color/number/typography resolution with per-build caches (`resetTokenResolveCaches` at each build).
- `brandColors.ts`: pure `BrandTheme` model, `THEME_PRESETS` (Default/Slate/Forest/Plum), legacy migration. Defaults: header `#0d2436`, accent `#12b3a6`.

## 5. The extractor: data model and pipeline

`extract(root, { figmaFile })` composes sub-extractors into the central **`IntermediateSpec`**:

```
name, figmaKey, figmaFile, figmaNode
anatomy: AnatomyPart[]        // flattened DFS list, depth <= 3; { id, name, type, nested, depth, component? }
anatomyComponentId
props: ComponentProp[]        // variant | boolean | text | instanceSwap
variants: VariantAxis[]       // { prop, values }
variantInstances: VariantInstance[]  // { nodeId, name, values }
states: string[]
tokens: TokenRule[]           // { part, property, conditions, token } - minimized rules
related: string[]
gaps: Gap[]                   // hygiene issues: hardcoded colors, unbound spacing, missing text styles
layout: LayoutSummary[]       // prompt-only
rawValues: RawValue[]         // presentation-only, excluded from content_hash
```

File map: `tree.ts` (the `SerializedNode` wire format), `extract.ts` (orchestrator), `anatomy.ts` (bounded DFS with single-wrapper descent; `defaultVariant`), `props.ts`, `tokens.ts` (rule minimization across variants; `variantAxisModel` shared with variant instances; CSS-like property normalization; `extractGaps`), `layout.ts`, `rawValues.ts`, `pivot.ts` (Material-style Markdown pivot tables), `statesMatrix.ts` (state detection), `resolve.ts` (`resolveTokensForVariant`), `render.ts` (canonical Markdown), `hash.ts` (`contentHash`: canonical JSON -> SHA-256).

**Hash-stability invariant**: `content_hash` is computed over a projection that excludes `rawValues` and reduces anatomy to the legacy depth-0 shape. All plugin-2.0 extractor additions were additive precisely so committed specs don't churn — this hash is the foundation of the drift-detection strategy bet. Do not change `render.ts` output or the hash projection casually.

**States detection** (`detectStateMatrix`): recognizes a states concept either as an enum axis (`State`/`Status` or value-vocabulary match) or as synthesized flags (boolean axes whose names are state words), returns lifecycle-ordered `StateColumn[]` with per-column variant overrides; `stateAxisProps` tells the Variants section which axes to exclude.

## 6. The prose (AI) subsystem

Lives in `packages/extractor/src/prose/`; called from the plugin UI iframe (and server-side by apps/web).

- **Model**: `claude-haiku-4-5`, `max_tokens` 3000, direct browser access header, optional component image content block (base64 from plugin, URL from web).
- **Prompt**: `buildProsePrompt` emits a compact derived summary (never raw node JSON) + per-key output contracts assembled from `KEY_INSTRUCTIONS` for **only the requested keys** — unchecked sections cost zero output tokens. One hand-curated Button few-shot pair. `PROSE_SYSTEM_PROMPT` carries house style (imperative voice, "people" not "the user", rule + reason, no em/en dashes, JSON only).
- **Keys** (`ProseKey`, 10): `definition`, `accessibility`, `dos`, `donts`, `variantsSummary`, `anatomySummary`, `anatomyParts`, `interactions`, `designConsiderations`, `contentConsiderations`. When both accessibility and interactions are requested, the prompt instructs de-duplication (mechanics vs semantics).
- **Parse**: `parseProseResponse` is defensive (fence stripping, arrays-as-prose tolerance, punctuation normalization, heading rejection); requested-set-aware requiredness.
- **Cache**: `proseCacheKey = prose:v8:{contentHash(spec)}[:img][:keys=sorted,list]`. `PROSE_PROMPT_VERSION` (`v8`) must be bumped whenever prompt/system/few-shot voice changes, or stale-voice drafts get served. The image URL is never in the key (rotating signed URLs); only an `:img` marker.
- **Failure posture**: fail-open everywhere. No key -> `null`; API/parse error -> placeholders + banner note; screenshot timeout (15s) -> prose without vision.

## 7. Build, test, release

- `npm test` — vitest across the monorepo (66 files / 653 tests, all green as of this writing).
- `npm run typecheck` — per-package tsc (format, extractor, plugin, web). Clean.
- `npm run build:plugin` — `packages/plugin/build.mjs` (esbuild): `src/main.ts` -> `dist/main.js` (IIFE, es2017); `src/ui/ui.ts` bundled and inlined into `dist/ui.html` as a single script tag.
- `npm run check` — lint + typecheck + test + build + build:plugin (the full gate; CI mirrors it plus `npm audit --omit=dev`).
- Manual testing: import `packages/plugin/manifest.json` via Figma desktop dev-plugin menu (`TESTING.md`).
- Publishing is manual (no automated Community pipeline). Manifest now carries the real plugin id and an `api.anthropic.com`-only network allowlist with written reasoning.

## 8. Design invariants worth protecting

1. **Extractor purity**: no Figma globals in `packages/extractor` or `packages/plugin/src/serialize.ts`; the `NodeResolver` injection is what keeps everything unit-testable.
2. **Hash stability**: `render.ts` Markdown and the `content_hash` projection are a compatibility contract (see section 5).
3. **AI is best-effort garnish**: no AI failure may block deterministic output. Extraction always completes; prose degrades to placeholders.
4. **Selection-aware token economy**: `proseKeysForSections` -> `requested` set -> prompt fragments -> cache key. Adding an AI section means touching all four (docModel `ALL_SECTIONS`, `KEY_INSTRUCTIONS`, `parseProseResponse`, and a `PROSE_PROMPT_VERSION` bump).
5. **One grouping map**: `GROUPS`/`ALL_SECTIONS` in `docModel.ts` drive both the config UI and the frame layout; never fork them.
6. **Variable-mode fidelity**: preview instances must go through `matchVariableModes` or measurements/previews drift from the source component.
7. **Prose house style**: `docs/prose-style-guide.md` (no em dashes etc.) is enforced in the system prompt and `normalizeProseText`.

## 9. Current state and open items (as of 2026-07-11)

**Uncommitted WIP on `plugin-2.0`** — one coherent feature: legible wide state matrices for input-field-style components.

- Extractor `statesMatrix.ts`: `stateBaseName()` strips parenthetical qualifiers (`active (Filled)` -> `active`); vocabulary expanded with `filled`, `warning`, `success`, `checked`, `invalid`.
- Plugin `statesSection.ts`: column-banding layout — `matrixBandLayout(columnCount, contentWidth)` wraps columns into stacked bands with `MIN_CELL_W = 160`, taller two-line headers (`HEADER_H = 30`).
- New `packages/plugin/test/statesSection.test.ts` covers the band math.
- `docFrame.ts`: 24px breathing room between variant guide prose and the preview matrix.
- `manifest.json`: real plugin id (publishing prep).

**Pending before release** (per plan docs and memory): manual Figma matrix test of plugin 2.0, version bump, Community listing update.

**Documentation debt**: README describes the retired Send-to-docs architecture; CHANGELOG stops at pre-pivot 1.0.0; the strategy doc's "one-way exporter" framing predates the standalone pivot.

**Strategic direction** (`docs/strategy/2026-06-22-positioning-and-pivot.md`): the crown jewels are the token-binding map and `content_hash`. Ranked bets: (1) `spec-layer check` drift detection in CI, (2) MCP agent-context layer, (3) keep but de-emphasize the doc browser.
