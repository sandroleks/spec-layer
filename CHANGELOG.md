# Changelog

All notable changes to Spec Layer are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Foundation Context v5 tokens carry `code_syntax`, Figma's per-platform code
  identifier, when the variable declares one. Schema `5.1.0` for both
  Foundation and Component Context. This moves the semantic content hash of
  every artifact whose tokens declare a code syntax, and nothing else: canvas
  drift hashes and `EXTRACTOR_VERSION` are unchanged. The identifier is a
  cross-check for code, never the source of a name.

- `spec-layer setup`, one command for a developer's first run in a repo. It
  writes `speclayer.json`, makes sure git ignores `speclayer.local.json`,
  stores the pull key there at mode `0600`, and pulls. Every later `pull` and
  `status` in that directory needs no key, so the plugin's copied setup
  command is now something a developer runs once rather than a line they keep
  pasting. Keys resolve `--key`, then `SPEC_LAYER_KEY`, then the stored file,
  so CI overrides the working tree without editing it. A stored key issued for
  another library is ignored and named, instead of reaching the server and
  coming back as a rotated-key error.

  This reverses a stated property: the key used to be documented as never
  written to disk. That claim did not remove the secret, it relocated it into
  shell history and hand-edited shell profiles, which are worse homes than a
  mode `0600` file the tool ignores in git and can point at in an error
  message. Outside a git working tree the key is still stored, and the CLI
  says it left `.gitignore` alone. Inside one, setup refuses to store the key
  whenever it cannot confirm `.gitignore` will ignore it, whether because the
  file can't be written, because git itself couldn't be run anywhere inside
  the working tree, or because the entry is there and git still does not
  ignore the file, rather than leaving an un-ignored secret in a working tree.
  That last case is almost always a `speclayer.local.json` that is already
  tracked, which `git check-ignore` reports as un-ignored no matter what the
  ignore rules say, so every success is confirmed with git after the write
  instead of assumed from it, and the refusal names
  `git rm --cached speclayer.local.json` as the way out.

  Re-running setup replaces the stored key and keeps the rest of the setup.
  With no `--out` and no selection flag it preserves the output directory and
  the `include` block already in `speclayer.json`, so the rotation flow of
  re-pasting the plugin's command no longer resets a committed config back to
  `.speclayer/` and leaves the old directory stale. `init` still overwrites,
  which is what a first run is for.

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

  Foundation Context v5 now exports composite typography and effect styles
  with stable Figma style ids, complete supported text properties, ordered
  shadow/blur layers, and exact per-property variable bindings. Collection and
  token publication state is retained when Figma exposes it. An effect binding
  whose token has one mode-independent value now produces
  `STYLE_BINDING_DRIFT` when the style snapshot disagrees.

  Text-style Library rows now use the same compact v5 AI profile and include
  only the local token dependency collections required by their property
  bindings. Figma does not expose a consuming mode, hidden-from-publishing
  state, or lifecycle record for local styles, so those fields stay absent and
  style completeness remains explicitly partial instead of being inferred.

  Generated group descriptions remain available as a hash-excluded annotation.

- Component **Copy for AI** now emits Component Context v5. Component bindings
  join to Foundation definitions by stable Figma id rather than display name,
  and each copy embeds only its referenced variables/styles plus complete local
  alias dependencies. It also carries the whole Foundation hash so an agent can
  match a component to Foundation context already in the conversation.

  Component v5 retains exact anatomy paths, structured default-variant layout,
  inline effect binding ids, hardcoded values, deterministic validation, and
  saved guidelines. Export timestamps, build ids, generated prose, diagnostic
  wording, and unrelated Foundation changes stay outside the component semantic
  hash. The legacy component brief v4 remains available to existing consumers
  and canvas drift hashes are unchanged.

  The compact profile groups otherwise-identical binding rules under an
  ordered `paths` list. Single-use rules keep `path`, and canonical bindings
  remain ungrouped, so this reduces repeated nested-instance output without
  changing fidelity or semantic hashes.

  Typography bindings now produce `STYLE_BINDING_DRIFT` under the same
  mode-independent rule as effect bindings, surfacing stale Figma style/token
  relationships without guessing a consuming mode.

- Added a reproducible raw Foundation fixture and reviewed direct-v5 golden
  artifact covering duplicate mode names, exact/default mode resolution,
  precision colors, units, full chains, cycles, external aliases, missing
  values, confusable names, stable composite styles, publication state,
  property bindings, and effect binding drift.

- Publish for developers: Pro users publish the library's Copy for AI context
  to api.spec-layer.com from the Library screen; a new `spec-layer` CLI
  (`npx spec-layer pull`) writes the canonical v5 bundle and per-artifact
  ai-profile YAML into a repo, with `status` for freshness checks and key
  rotation for revoking access.

- Granular pulls in the `spec-layer` CLI (0.2.0). `pull --only foundation`,
  `pull --only components`, and a repeatable `pull --component NAME` write
  just those entries into `ai/`, matched by slug so `button` finds `Button`;
  an unknown name is an error that lists what the library holds. `init`
  persists the same flags as an `include` block in `speclayer.json`, and
  flags on `pull` replace it for one run. `bundle.json` always holds the
  whole library and `manifest.json` lists every artifact, with `aiPath: null`
  for the ones not written. Two local commands read the last pull without a
  key: `list` prints every artifact with its path or `not written`, and
  `show foundation` / `show component NAME` print one entry's AI YAML, or the
  canonical JSON with `--canonical`, to stdout for piping. Selection stops at
  a whole entry: a per-collection Foundation slice would need the extractor's
  alias closure and is left for a bundle-side change.

### Changed

- `spec-layer pull` (CLI 0.4.0) writes the Foundation as a `tokens/` directory
  of Design Tokens Format Module 2025.10 files plus `resolver.json`, a Figma
  metadata sidecar, and `report.json`, projected from the canonical artifact
  in `bundle.json` after a schema shape check. `ai/foundation.yaml` is no
  longer written; the manifest points the foundation at
  `tokens/resolver.json`. A `dtcg` block in `speclayer.json` chooses `standard`
  or `legacy` values and declares unit overrides for numbers whose scopes state
  no unit.

- Foundation **Copy for AI** and the published bundle's foundation context are
  now a Design Tokens Format Module 2025.10 resolver document instead of Spec
  Layer's own YAML profile. Collections become sets or modifiers named as in
  Figma, tokens carry `$type` and `$value`, aliases are `{Collection.path}`
  references, and text and effect styles are `typography` and `shadow`
  composites. Anything the format cannot state, such as an unresolved library
  alias or a boolean variable, is omitted from the tree and listed under
  `$extensions["com.spec-layer"].report`. A style's line height is one of
  those: the format reads `lineHeight` as a unitless multiplier of the font
  size, so a measured px or % line height is kept under `$extensions` rather
  than divided by the font size, which would state a figure Figma never did.
  The canonical v5 artifact is unchanged and still owns the content hash. Component Copy for AI is
  unchanged apart from `code_syntax` on the tokens it embeds.

- A Library Update keeps what is written in a component doc's writing
  sections. The renderer tags the definition, accessibility, interactions,
  content considerations, dos and don'ts, variants and anatomy summaries, and
  anatomy part descriptions as editorial. Update reads that text back off the
  canvas, rebuilds every generated table and matrix from the live component,
  and renders the two together. It no longer calls the AI, so it spends no
  quota and never replaces prose a designer rewrote. Rebuild needed and
  Update all follow the same path. Copy for AI and Publish read the same
  canvas text, so hand edits reach the coding agent's brief. An empty prose
  field, or an empty dos and don'ts pair, now renders the placeholder instead
  of nothing. When the canvas and the stored guidelines together carry no
  text at all, the doc counts as having no guidelines, so Copy for AI still
  says so rather than sending empty fields.

  "Manually edited" now means an edit to generated content, the only kind an
  Update replaces. Editing the writing sections reads as In sync. The confirm
  before an Update names what is at stake and says the writing sections are
  kept. Creating documentation again from the component screen still starts
  over with fresh AI prose; that is the one way to ask the model again.

- Bold text inside a bulleted line, such as a `**Keyboard:**` lead-in in an
  accessibility bullet, now renders correctly on the canvas and survives an
  Update. Previously, bullet rows re-parsed already-plain text and silently
  dropped bold formatting; this is fixed.

### Fixed

- `spec-layer pull` re-projects `tokens/` when the `dtcg` block in
  `speclayer.json` changes. It used to answer "Already up to date" because
  freshness compared only the selection; the manifest now records the dtcg
  options and compares them too. `show foundation | head` no longer prints an
  EPIPE stack trace when the reader closes early.

- The CLI runs again. Every `spec-layer` command in `0.2.0` died on import with
  `Error: Dynamic require of "crypto" is not supported`, so `npx spec-layer
  pull` never reached the network. Routing bundle parsing through the shared
  extractor parser pulled in js-sha256, which is CommonJS and calls
  `require('crypto')` while it evaluates; esbuild rewrites that into a shim that
  throws in the CLI's ESM output. The bundle now defines a real `require`
  through `node:module` `createRequire`. `0.1.0` is unaffected, since it
  predates the extractor dependency. Hashes are unchanged: js-sha256's Node path
  and its pure-JS path produce the same digests, and a pull verifies against a
  manifest the plugin wrote.

  Nothing caught this, because nothing ran the artifact. Lint, typecheck and the
  test suite all import the TypeScript sources, and `build:cli` proved only that
  esbuild wrote a file. `npm run check:cli-bundle` now executes the built bundle
  and fails the gate when it cannot load.

- Publishing is behind the paywall in the plugin, not only on the server. A
  free plan opening **Publish for developers** saw the full screen and a working
  **Publish library** button, and pressing it collected every component in the
  file before the proxy answered 401 and the screen printed "Publishing needs an
  active Pro license." The screen now names the plan up front: a **Pro plan
  required** group, and **Enter a license key** and **Upgrade to Pro** in place
  of the publish action. A lapsed license keeps its setup command readable,
  since pulling never checked the license, but loses the Pro-only **Rotate key**
  control and the instruction to use it. Only a confirmed free plan locks the
  screen: while the plan is still loading or the proxy is unreachable, the
  publish attempt still carries the answer, so a Pro user who is briefly offline
  is not demoted.
- A component containing a text layer with non-uniform character fills can be
  documented again. Figma returns `figma.mixed` (a symbol) from `fills`,
  `strokes`, `fillStyleId` and `strokeStyleId` when a text node's ranges
  differ, so recolouring one word of one label made `fills ?? []` yield a
  symbol and `.some()` throw. Serialization recurses through `Promise.all`, so
  a single such layer aborted the whole component: the panel fell back to "No
  component selected" and the component's Library row read "Check unavailable",
  neither of which named a cause. Mixed paints are now read as no paint this
  pass can speak for, so no unbound-paint gap or hex is claimed for them, and a
  mixed style id is no longer handed to Figma as an id to look up. Whether a
  paint counts as styled is unchanged, so no existing document's drift baseline
  moves and no rebuild is requested.
- The two silent `catch` blocks behind those states now log the error they
  swallow, and an unresolved drift source logs what the stored node id
  actually resolved to.
- Publish identity now lives in the file, not in one shared slot. Because
  `figma.fileKey` is undefined for a Community plugin, every file used to
  share the `publishInfo:unknown` record, so publishing from one file could
  overwrite the library another file had published. The library id is now
  stored in the document's root plugin data and the pull key per user in
  `clientStorage` keyed by that id. A device that has the id but not the key
  sees the id and can rotate to get a key. Files published before this change
  create a fresh library on their next publish; the old one keeps serving its
  last bundle.
- Publishing no longer silently creates a new library when the server reports
  the stored one gone or owned by another license. It stops, says so, clears
  the stale identity, and leaves the next publish as a deliberate create.
  The persisted identity also rides the `publishSources` reply, so a publish
  started before the `publishInfo` reply lands can no longer mint a
  duplicate.
- The proxy stores the pull key digest and each ownership record in their own
  KV keys, so a rotate racing a republish cannot overwrite the other's write
  and two concurrent first publishes cannot lose a library from the owner
  list. Legacy records are migrated on first use. **Rotate key** is disabled
  while a publish is running, and a successful rotate no longer paints its
  message as an error.
- The publish size cap measures UTF-8 bytes at every check. The
  `content-length` precheck compared bytes to a character limit, so non-ASCII
  libraries were rejected below the real cap with a size reported in the
  wrong unit. The plugin now shows the limit in megabytes.
- The bundle envelope is parsed by one shared function in the extractor. The
  proxy used to accept a bundle without `extractorVersion` that the CLI then
  refused, and the CLI accepted any bundle version; both now share
  `parseLibraryBundle`, and the CLI asks you to update when it meets a bundle
  major it does not know.
- Rotate copy no longer claims the old key stops "immediately"; KV propagation
  can take up to about a minute, and the plugin says so.
- `spec-layer pull` no longer deletes an arbitrary directory. The swap that
  replaces the output directory refused nothing before, so `--out .` removed
  the whole repository; it now rejects the working directory, a parent of it,
  and any existing non-empty directory the CLI did not write.
- An API origin with a trailing slash (`--api https://host/`) built a `//v1`
  path the proxy rejected, reported as "Library not found". The slash is now
  stripped.
- `pull` sends the last pull's hash as `If-None-Match` when the selection is
  unchanged, so an up-to-date repo gets a 304 and writes nothing instead of
  re-downloading the whole bundle on every run.

### Security

- License hardening: transient Lemon Squeezy errors (rate limits, 5xx,
  malformed responses) no longer read as invalid keys, and renewals show
  as Pro immediately after Activate instead of a stale cached status.
  Device instances are validated on every request, so a deactivated
  device's slot frees up rather than staying claimed. License endpoints
  are rate-limited and format-gated, and license keys are hashed in
  server-side storage and logs rather than kept in the clear.

### Changed

- **Publish for developers** is its own screen instead of a section at the
  bottom of the Library's document list. A **Publish** action in the Library
  footer opens it; the rail stays on Library, and the back control or Escape
  returns to the list. The screen also reports a publish in flight, which the
  old section never did: the footer shows "Collecting sources" and then
  "Uploading library" while the primary reads "Publishing…". Nothing about what
  gets published, the bundle, or the pull key changed.

  The screen's content is grouped into **What gets published** and **Developer
  setup**, which puts "anyone with the key can pull it" beside the key instead
  of three sentences above it, and names what a publish actually sends: the
  foundation document and every connected component document. The setup command
  now wraps so the whole command is visible, rather than scrolling the `npx
  spec-layer pull` half out of sight behind a scrollbar. **Rotate key** sits
  beside **Copy setup command** as a secondary button in the danger colour, so
  it reads as the destructive action it is without being buried, and the line
  beneath the two now names rotating rather than appearing to describe both.
  Before the first publish, the screen says where the key will come from.
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
