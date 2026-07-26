# Architecture

Spec Layer is an npm-workspaces monorepo with four runtime areas: the Markdown format, the pure extractor, the Figma plugin, and the local docs app.

## Data Flow

```text
Figma node
  → plugin serializer
  → IntermediateSpec
  → deterministic Markdown renderer
  → download, ZIP export, or local docs API
  → Markdown content directory
  → Next.js renderer and editor
```

The Figma plugin owns Figma API access. `@spec-layer/extractor` receives plain JSON and has no dependency on the Figma runtime, which keeps extraction testable with fixtures. `@spec-layer/format` owns frontmatter validation and serialization. The web app owns local persistence, inbox review, navigation, editing, optional guideline generation, and previews.

## Workspaces

### `@spec-layer/format`

Defines `SpecFrontmatter`, validates format version and optional lifecycle status, and parses or serializes YAML frontmatter. It does not interpret the Markdown body.

### `@spec-layer/extractor`

Transforms serialized Figma trees into `IntermediateSpec` data and Markdown. Deterministic modules derive anatomy, properties, variants, states, token rules, gaps, and content hashes. The prose module is optional and receives only derived fields.

`foundation.ts` models the layer beneath components: variable collections with their modes, and local text styles. It receives a raw dump and resolves alias chains synchronously, so cycles, depth limits, dangling targets, and cross-file references are fixture-testable rather than dependent on a live Figma runtime. An alias into a library carries its target's name and no value, because a remote variable's `valuesByMode` is keyed by the remote collection's mode ids and cannot be mapped onto local modes. `planFoundationUnits` decides how many documents a file produces: one per collection, split by top-level name group past `SPLIT_THRESHOLD` rows, with mode columns capped at `MAX_MODE_COLUMNS`.

`unitContent(spec, scope)` returns everything one foundation document renders and nothing it does not: its collection name, group, mode columns, rows, the names of any modes left out, and the part numbering of a split unit. Every renderer consumes it, and `foundationContentHash` hashes its entire output rather than a chosen subset of fields. That is what makes "the hash covers exactly what is rendered" structural instead of a matter of discipline, and the property has to hold in both directions to be worth anything.

Rendered implies hashed: any field added to `FoundationUnitContent` is rendered by definition and is therefore hashed, so nothing can reach the canvas outside drift detection. This is why `part` lives here rather than arriving as a render argument. Part numbers are a property of how one collection was split, so `unitContent` derives them from the scope's group and the source's ordered group list; deriving rather than passing is also what makes a whole-batch render and a later single-doc rebuild agree, since `updateFoundationDoc` has no batch around it to count.

Hashed implies rendered: the rendered projection carries only what a frame draws. `FoundationTextMetrics` carries the four values a specimen and its metrics line use, and the rendered text row carries no `boundVariables`. `FoundationVariableRow` carries a name, a description, and one cell per rendered mode, and no `resolvedType`, since a cell's swatch and label come from the resolved value's own `kind` and nothing draws the declared type. A hash that moved on letter spacing, a rebound colour, or a retyped variable would offer an Update that produced a byte-identical frame. Extraction stays complete, because `FoundationTextStyle` and `FoundationVariable` keep every field, so rendering more later is a matter of moving fields back into the projection. Ids and `extractedAt` are excluded because they never appear in that output at all.

`unitContent` returns `null` when the scope's source is gone, which means a missing collection id *or* a named group that matches nothing. A group is derived from names, so a named group with no members cannot legitimately exist; treating zero rows as a valid empty unit would let a doc whose group was renamed away read "In sync" while rebuilding to a headed, rowless frame. A collection-scoped unit with genuinely zero variables is a different case and still returns an empty unit.

### `@spec-layer/plugin`

Runs inside Figma as a small main-thread serializer plus a vanilla-DOM UI. It supports selected-component extraction, Markdown download, token-authenticated delivery to the docs app, and bulk ZIP export. The docs endpoint and token are stored in Figma `clientStorage`.

A Foundations tab documents the file's variable collections and text styles. Unlike every other tab it needs no selection, because it reads the whole file. `serializeFoundation.ts` produces the raw dump through an injected `FoundationReader`, matching the `NodeResolver` pattern in `serialize.ts`, so the dump logic stays testable and `main.ts` owns the Figma API surface. `foundationFrame.ts` renders one unit as a Section using `frameKit` primitives, so foundation frames inherit the user's brand theme.

Foundation Sections join the same doc registry as component docs. `DocLinkData` is a union discriminated on `kind`, and a blob written before foundation support carries no `kind`, so it parses through the original component path unchanged. A foundation link addresses its source by scope rather than by node id, since its source is the file's own collections. Drift for every foundation row resolves from a single extraction during a library refresh, rather than one round trip per row. A scope stores both collection id and name, so a renamed collection retargets by name and reads as out of date rather than as missing.

Foundation Markdown does not exist yet, so the library row for a foundation doc offers no Markdown download.

`frameKit.applyThemeToKit` and the inline theme preamble in `buildDocFrames` do the same job. Migrating `docFrame` onto the shared helper was left out of the foundation work to avoid restructuring a large file mid-feature. The duplication is deliberate and known; the two must be changed together until it is resolved.

### `md-ds`

The Next.js App Router app renders a filesystem content tree and exposes local APIs for import, inbox actions, AI guideline filling, editing, navigation, settings, search, and Figma previews. Files remain the source of truth; refreshes read current content rather than requiring a publishing step.

## Storage

The content root resolves from `DS_CONTENT_DIR`, then falls back to `apps/web/content/components`. Each page is a Markdown file and folders form navigation groups.

Runtime artifacts are intentionally untracked:

- `_inbox/` contains imported files waiting to be organized.
- `.spec-data/` stores source extractions used for regeneration.
- `.spec-cache/` stores generated prose cache entries.
- `.ds-config.json` stores optional local settings and credentials.

Settings writes use a temporary file, atomic rename, and mode `0600` where supported.

## Local API Boundary

The app is designed to bind to loopback. API requests are checked in this order:

1. The request `Host` must be loopback or listed in `SPEC_LAYER_ALLOWED_HOSTS`.
2. Requests without an `Origin`, and same-origin requests, are accepted on an allowed host.
3. Cross-origin requests are accepted only from `Origin: null` (the Figma plugin) or an origin listed in `SPEC_LAYER_ALLOWED_ORIGINS`; all other origins are rejected.

This policy covers read and write APIs that expose local content or credentials. CORS headers are emitted only for allowed origins. Figma URLs are accepted only over HTTPS on `figma.com` or `www.figma.com`.

Browser mutations use JSON-only request guards with explicit body limits. CORS preflight requests return without performing authorization; disallowed origins receive no `Access-Control-Allow-Origin`, while the corresponding request is still rejected by the host/origin/token policy.

The boundary reduces exposure during local development. A public deployment would still require user authentication, per-project authorization, tenant isolation, CSRF analysis, durable secret management, rate limiting, and deployment-specific network controls.

## Imports

Import endpoints validate paths and constrain input size. Markdown uploads are limited to 2 MiB. JSON imports are limited to 5 MiB. ZIP uploads are limited to 10 MiB compressed, 1,000 entries, 2 MiB expanded per file, and 50 MiB expanded in total. ZIP limits are enforced while entries stream, before unrestricted expansion can occur.

## Rendering And Editing

The app parses frontmatter with `gray-matter`, identifies sections by Markdown headings, and renders bodies with `react-markdown`, GFM, and slugged headings. Section edits update only the selected section. Navigation operations validate every slug segment before joining filesystem paths.

Interactive tabs, dialogs, command search, and plugin tabs implement keyboard navigation and visible focus. Reduced-motion preferences disable nonessential transitions and animations.

## Optional Integrations

- Figma preview APIs use `FIGMA_TOKEN` or the token stored in Settings.
- Prose generation uses `ANTHROPIC_API_KEY` or the key stored in Settings.

Neither integration is required for structural extraction, Markdown import, editing, or rendering.

AI guideline filling writes only Definition, Accessibility, and Do's & Don'ts. Bulk fill replaces placeholder sections only. A reviewer can explicitly regenerate one supported section, and the app rejects the write if the source spec changes while generation is running.

## Verification

The root `npm run check` command runs lint, TypeScript checks, unit tests, the production web build, and the plugin build. GitHub Actions runs the same stages plus `npm audit --omit=dev` on pushes to `main` and pull requests.
