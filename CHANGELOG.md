# Changelog

All notable changes to Spec Layer are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Foundation export. A new **Foundations** tab in the Figma plugin
  documents the file's variable collections and local text styles, with
  no selection required. It mirrors the file's own structure rather than
  inferring categories: one document per collection, split by top-level
  name group when a collection is large, plus one for text styles. Modes
  render as columns, capped at four, and any modes not shown are named on
  the frame. Aliases show their target and resolved value; an alias into
  a library shows its target with no value, since a library's modes
  cannot be mapped onto local ones.

  Foundation frames are tracked like component docs. They appear in
  **Library** with the same In sync, Update available, Manually edited, and
  Source missing states, and support Update documentation, Copy for AI,
  Detach documentation, and Remove connection.
  Regenerating replaces a frame in place rather than adding a second
  copy, including when the frame lives on another page. Renaming a
  collection reports the doc as out of date rather than as missing.

  Drift covers exactly what a frame draws, in both directions. A split
  frame's "Part 2 of 3" note is part of the tracked content, so it is
  numbered per collection rather than per batch, survives an Update, and
  goes out of date when adding a group renumbers it. Changing a text
  style's letter spacing, text case, or bound variables does not offer an
  Update, because none of those reach the canvas yet. A doc whose group
  was renamed away now reports **Source missing** instead of rebuilding
  to an empty frame.

  Colour variables are documented as a swatch list rather than a grid of
  hex codes: a large chip, the token's name and description, and the
  value as hex, rgb and hsl. An aliased token shows the primitive it
  points at plus the resolved hex, since the primitive's own frame
  carries the formats. Multi-mode collections give each mode its own
  swatch under a heading row naming it once. Numbers, strings and
  booleans stay in the table, and a collection holding both gets both,
  labelled.

  Colours are grouped into blocks by the folder their names sit in, headed
  by the folder's own name ("Blue", "Surface"), so a document's structure
  matches the folders you built in Figma. If two folders would produce the
  same heading, every heading in that document takes one more segment
  ("Color / Surface").

  The mode-heading row above a mapped (multi-mode) table now sits close
  to it, as a caption should, instead of a full group-to-group gap away
  as if it were its own section.

  A mapped (multi-mode) colour table reads less tight: bigger swatches,
  more row and group spacing, and a clear hierarchy between the value that
  matters most (the mapping, or the hex for a plain colour) and the detail
  underneath it (the resolved value, or rgb/hsl), which previously
  rendered as one undifferentiated block of small type.

  Each group can carry an optional AI-written sentence under its heading,
  off by default. One generation covers a whole build however many groups
  it has, the description is stored with the document so an Update keeps
  it without spending another, and a failed or refused AI call still
  produces the frames and says it went without. The model is shown only
  the group's token names and resolved values, and is told not to state
  anything those do not support.

  Because the layout now depends on a variable's declared type,
  retyping one from colour to number reports the doc as out of date, as
  it should: the two are drawn completely differently.

  Foundation frames are laid out as component docs are: one card at a
  fixed width, opening with the branded header band that carries the
  eyebrow, the document title, a count of what it covers, and the logo
  captured in Settings, then a bordered table below. They pick up the
  brand theme in full, including the header colour, which the first
  version applied to the fonts but not to the frame. A card is never
  narrower than a component doc frame and widens to fit its columns.

  The Foundations tab itself reads like the rest of the plugin. Each
  source is a card with its name and what it holds, using the same
  checkbox as the Sections list, and modes are pills rather than a
  stacked list. A **Select all** / **Clear all** link matches the
  Sections header. Placeholder rows show while the file is read, and a
  build shows the same animated loader as a component doc, switching to
  real progress ("Creating frame 3 of 5") once frames start landing.

  The tab now says how many frames a build will make in its included summary
  and on any row that splits, while the action keeps the stable **Create docs**
  label. A finished build also reports its result, which it previously
  computed and then immediately erased.

  Foundation sources and connected Library rows also offer **Copy for AI**.
  It places a structured YAML brief on the clipboard rather than creating a
  second Markdown/sidecar output contract.

- Foundation extraction now builds Foundation Context schema `5.0.0` directly
  from the source model. Whole-file and collection copies are backed by that
  validated artifact and preserve source scopes and units, precise RGBA
  channels, complete mode-aware local alias chains, external-library
  references, diagnostics, and honest completeness.

  **Copy for AI** projects the artifact into a compact v5 AI profile instead
  of pasting the audit representation verbatim. It nests tokens under their
  collections, uses readable mode and alias labels, omits empty and derived
  repetition, summarizes diagnostics by code, and includes source ids only
  when names collide. The canonical semantic content hash stays attached. On
  the reviewed Company DS export this reduced the clipboard payload from 9,989
  lines / 351 KB to 2,539 lines / 108 KB without dropping implementation facts.

  Collection copies also include complete transitive dependency collections,
  so local references never dangle merely because the user copied one row.

  Generated group descriptions remain available as a hash-excluded annotation.
  A text-style-only Library copy temporarily retains the complete v4 style
  payload until v5 composite typography/effects land in Phase 3.

- Added a reproducible raw Foundation fixture and reviewed direct-v5 golden
  artifact covering duplicate mode names, exact/default mode resolution,
  precision colors, units, full chains, cycles, external aliases, missing
  values, confusable names, and source-style incompleteness.

### Security

- License hardening: transient Lemon Squeezy errors (rate limits, 5xx,
  malformed responses) no longer read as invalid keys, and renewals show
  as Pro immediately after Activate instead of a stale cached status.
  Device instances are validated on every request, so a deactivated
  device's slot frees up rather than staying claimed. License endpoints
  are rate-limited and format-gated, and license keys are hashed in
  server-side storage and logs rather than kept in the clear.

### Changed

- Plugin **Upgrade to Pro** and **Renew Pro** actions now open the live,
  product-specific Lemon Squeezy checkout instead of the broken generic
  checkout/store routes.
- Bumped the shared extractor compatibility identifier from `1` to `2` for the
  Foundation v5 extraction/export contract. Existing connected component docs
  may request one rebuild after upgrading because component and Foundation
  links intentionally share this opaque compatibility id; their canvas hash
  projection itself did not change.
- The Figma plugin adds a Remove key action and clearer License status copy
  that distinguishes a proxy outage from an expired subscription or an
  unactivated key.
- The repository now requires Node.js 22, matching Wrangler and Miniflare.
  CI validates a full dependency audit and bundles the proxy with
  `wrangler deploy --dry-run` without uploading it.

### Removed

- Retired the local Next.js docs app, the `@spec-layer/format` package, the
  strict Markdown specification, Markdown/ZIP downloads, and the old **Send
  to docs** path. The supported product is the Figma plugin, its proxy, and
  the landing site; **Copy for AI** is the portable context surface.

## [1.0.0] - 2026-06-15

### Changed

- Simplified the Figma plugin's **Send to docs** flow: the primary action is now a **Send to docs** button beside **Download .md**, and the docs URL plus Figma file source moved to a dedicated **Settings** tab. The common case (saved file, default URL) needs no configuration; missing Figma keys are prompted inline at send time.

### Removed

- Removed the `SPEC_LAYER_TOKEN` access token and its plugin field. For a localhost-only tool the token was setup friction; the plugin's opaque origin is now permitted automatically. Same-origin enforcement and the loopback host allowlist remain the protection for the local API, and unlisted cross-origins are still rejected.

## [0.1.0] - 2026-06-15

### Added

- Open Markdown design-system specification with reference component examples.
- Deterministic Figma component extraction, selected-component review, Markdown download, local delivery, and bulk ZIP export.
- Local Next.js documentation app with filesystem navigation, search, inline section editing, Figma previews, and configurable content roots.
- Inbox workflow with import summaries, individual and bulk save, per-item delete, clear-all, and destination-folder selection.
- Optional Anthropic guideline filling for Definition, Accessibility, and Do's & Don'ts, including bulk placeholder fill, section regeneration, visual context when available, caching, and stale-write protection.
- MIT license, contribution guide, security policy, code of conduct, issue forms, pull request template, CODEOWNERS, Dependabot, and CI.

### Security

- Loopback-by-default server binding and explicit host/origin validation for local APIs.
- Bearer-token authentication for allowed cross-origin clients such as the Figma plugin.
- Request-size and bounded ZIP expansion limits.
- Atomic owner-readable settings writes and strict HTTPS Figma URL validation.
- Generated inbox content, local credentials, caches, sidecars, and editor state excluded from version control.

### Changed

- Upgraded the web app to Next.js 16, React 19, ESLint 9, and Vitest 4.
- Improved keyboard support, focus handling, dialog semantics, visible focus styles, and reduced-motion behavior.
- Clarified that `status` is optional metadata and that Spec Layer does not enforce an approval workflow.

### Known Limitations

- The web app is a trusted localhost tool, not a hosted or multi-user service.
- Workspace packages are private implementation modules and are not published to npm.
- GitHub synchronization, drift detection, and an MCP server remain roadmap items.

[1.0.0]: https://github.com/sandroleks/spec-layer/releases/tag/v1.0.0
[0.1.0]: https://github.com/sandroleks/spec-layer/releases/tag/v0.1.0
