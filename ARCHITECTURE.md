# Architecture

Spec Layer is an npm-workspaces monorepo with three runtime areas: the pure extractor, the Figma plugin, and the AI proxy.

## Data Flow

```text
Figma node
  → plugin serializer
  → IntermediateSpec
  ├─→ deterministic canvas documentation + connected Library entry
  ├─→ YAML brief on the clipboard (Copy for AI)
  └─→ optional AI-writing proxy → Anthropic
```

The Figma plugin owns Figma API access. `@spec-layer/extractor` receives plain JSON and has no dependency on the Figma runtime, which keeps extraction testable with fixtures. Nothing outside the plugin persists a document: the canvas and the clipboard are the two destinations.

## Workspaces

### `@spec-layer/extractor`

Transforms serialized Figma trees into `IntermediateSpec` data and YAML briefs. Deterministic modules derive anatomy, properties, variants, states, token rules, gaps, and content hashes. The prose module is optional and receives only derived fields.

`foundation.ts` models the layer beneath components: variable collections with their modes, and local text styles. It receives a raw dump and resolves alias chains synchronously, so cycles, depth limits, dangling targets, and cross-file references are fixture-testable rather than dependent on a live Figma runtime. An alias into a library carries its target's name and no value, because a remote variable's `valuesByMode` is keyed by the remote collection's mode ids and cannot be mapped onto local modes. `planFoundationUnits` decides how many documents a file produces: one per collection, split by top-level name group past `SPLIT_THRESHOLD` rows, with mode columns capped at `MAX_MODE_COLUMNS`.

`unitContent(spec, scope)` returns everything one foundation document renders and nothing it does not: its collection name, group, mode columns, rows, the names of any modes left out, and the part numbering of a split unit. Every renderer consumes it, and `foundationContentHash` hashes its entire output rather than a chosen subset of fields. That is what makes "the hash covers exactly what is rendered" structural instead of a matter of discipline, and the property has to hold in both directions to be worth anything.

Rendered implies hashed: any field added to `FoundationUnitContent` is rendered by definition and is therefore hashed, so nothing can reach the canvas outside drift detection. This is why `part` lives here rather than arriving as a render argument. Part numbers are a property of how one collection was split, so `unitContent` derives them from the scope's group and the source's ordered group list; deriving rather than passing is also what makes a whole-batch render and a later single-doc rebuild agree, since `updateFoundationDoc` has no batch around it to count.

Hashed implies rendered: the rendered projection carries only what a frame draws. `FoundationTextMetrics` carries the four values a specimen and its metrics line use, and the rendered text row carries no `boundVariables`. A hash that moved on letter spacing or a rebound colour would offer an Update that produced a byte-identical frame. Extraction stays complete, because `FoundationTextStyle` and `FoundationVariable` keep every field, so rendering more later is a matter of moving fields back into the projection. Ids and `extractedAt` are excluded because they never appear in that output at all.

AI-written group descriptions are the one deliberate exception to "rendered implies hashed", and it is an exception rather than an oversight. A description is not derived from the file: rewording it is not the token layer drifting, and a token changing does not make the sentence wrong. Hashing it would report every doc as out of date for a reason that has nothing to do with the source, which is precisely the noise the invariant exists to prevent. Component prose is excluded from `specContentHash` for the same reason. What does cover it is `selfHash`, the manual-edit check, since the description is part of the rendered document. Descriptions are stored on the doc's own link so an Update re-renders them rather than deleting them or spending another generation, which is the failure the part numbers already taught this branch once.

`resolvedType` is the worked example of that last sentence. It sat outside the projection for as long as nothing drew it, and moved back in when colour variables gained their own layout: it now decides whether a row is drawn as a swatch or as a table cell, which makes it the most consequential field in the projection rather than an unrendered one. Both directions still hold, and the hash moving on a retyped variable is now correct rather than noise. It has to be the declared type and not the resolved value's `kind`, because a colour aliased entirely into a published library resolves to no local value, and inferring "not a colour" from that would drop a whole semantic collection into the numbers table.

`unitContent` returns `null` when the scope's source is gone, which means a missing collection id *or* a named group that matches nothing. A group is derived from names, so a named group with no members cannot legitimately exist; treating zero rows as a valid empty unit would let a doc whose group was renamed away read "In sync" while rebuilding to a headed, rowless frame. A collection-scoped unit with genuinely zero variables is a different case and still returns an empty unit.

### `@spec-layer/plugin`

Runs inside Figma as a small main-thread serializer plus a vanilla-DOM UI. It
supports selected-component extraction, canvas documentation, Copy for AI,
Foundation documents, connected-document maintenance, frame themes, and license
management. There is one UI and one bundle.

A Foundations tab documents the file's variable collections and text styles. Unlike every other tab it needs no selection, because it reads the whole file. `serializeFoundation.ts` produces the raw dump through an injected `FoundationReader`, matching the `NodeResolver` pattern in `serialize.ts`, so the dump logic stays testable and `main.ts` owns the Figma API surface. `foundationFrame.ts` renders one unit as a Section using `frameKit` primitives, so foundation frames inherit the user's brand theme.

A generated document is a generated document, whichever tab produced it: one fixed-width card, the brand header band across the top, then content. `brandHeader.ts` owns that band for both families, and `HEADER_PAD_X` is the single padding value the band and every content column below it use. The band was a private function in `docFrame.ts` while only components had one; foundation frames drew their own plain white heading instead, which is how they came to apply the theme's fonts while ignoring its header colour and never showing the captured logo at all. Two bands that merely agree today would drift the next time either family is restyled, so there is one. What stays with the component doc is the part that is specific to it: its subtitle is markdown lifted from the Definition, so it passes a `styleSubtitle` hook to re-apply the bold runs it parsed.

Colour rows are divided into blocks by folder, headed by the folder's final segment capitalized ("Blue", "Surface") rather than its whole path, since the path is what the tokens spell and not what a heading should read. Two folders can end in the same segment, so `groupTitles` widens every title in a document by one segment when any two would collide, keeping the set uniform instead of leaving one odd heading out. Descriptions key on the folder, never on the title, because the title moves when it widens.

The mode-heading row ("Light Dark Wireframe") sits in its own frame with its own gap (`HEADER_GAP`, small) rather than sharing the group list's own gap (`GROUP_GAP`, deliberately bigger): a single auto-layout frame has one `itemSpacing` for every pair of its children, so the header and the group-to-group break could not both have the right size while living in the same frame. Left as one frame, the header read as one whole group away from the table it's captioning, exactly as far as two unrelated groups sit from each other. `buildSwatchList` returns the outer wrap; the group blocks are always its LAST child, whether or not a heading row precedes them, which is what lets every reader (including the tests) find them without asking "is there a header here or not."

Every value stack in the swatch list carries a primary/secondary hierarchy, applied by `appendSwatchValues` in `foundationFrame.ts`: the first line (the alias target, or the hex for a literal) is Medium and sits one step darker; every line after it is Regular, smaller, and muted. This is deliberately positional rather than content-based: `swatchValueLines` and `valueLines` already put the fact that matters first (the mapping for an alias, the hex for a literal), so styling by index keeps the two branches in one function and stays correct if a third value kind is ever added. The table's `swatchCell` uses the same idea at a smaller scale (11/10, both Regular) for the non-colour rows; the swatch list's version is more pronounced because colour is what these frames exist to show. A build with a mapped (multi-mode) collection widened its row rhythm at the same time (bigger chips, more row padding, wider mode blocks) for the same reason: three or four columns of small type packed tight read as a wall of text rather than a table a reader can scan. `groupOf` (the top-level segment) decides how a large collection splits into separate documents; `folderOf` (a name minus its leaf) decides how one document's rows split into blocks. Both exist because a system that names everything `color/...` has exactly one top-level group and would get no blocking at all from the split key. `groupRowsByFolder` is shared rather than done in the renderer, because the frame builder draws these blocks and any per-group description has to key on the same folders; grouping separately would let a description land on the wrong block. Block titles are derived from row names, which the hash already covers, so grouping adds nothing to the projection.

Colour variables and everything else get different layouts, because a grid of hex codes is the wrong shape for colour: the value a reader wants is the colour itself, and a swatch has to be big enough to judge. A colour row is a swatch, the token's name and description, and the value in the notations a developer pastes; everything else stays a table row. A collection holding both gets both blocks, labelled, in that order. Single-mode collections take the swatch-list shape a published token reference uses, with values right-aligned at the far edge; multi-mode collections cannot, since there is one value slot and several values, so the name leads and each mode follows as its own block under a heading row that names each mode once. `rgb` and `hsl` are derived from the same hex the hash already covers, so they add nothing to the projection and cannot drift from it.

A foundation card's width is derived, not chosen: it is the widest of whichever layouts the card holds, each sized from its own parts (`cardWidth` from the table's columns, gaps and row padding; `swatchRowWidth` from the swatch, name and value columns), floored at the component frame's width so a single-mode collection still carries a 38px title. The card clips its contents, so a width that omits any of those terms is a clipped right-hand column rather than a cosmetic misfit; the row padding was missing from the first version of that sum. No upper cap is needed, because the widest table this can produce is a description column plus the four-mode ceiling.

A document's title is derived rather than stored. `foundationUnitTitle` in the extractor is the one place the format lives, and `planFoundationUnits`, the renderer, and `updateFoundationDoc` all read it: three separate copies of `` `${name} · ${group}` `` had accumulated, one per caller, and a rebuilt document that disagrees with the batch about its own name is a rename the user never asked for. Deriving it from `unitContent` also keeps it inside what the drift hash covers, which a separately stored string would not be.

Foundation Sections join the same doc registry as component docs. `DocLinkData` is a union discriminated on `kind`, and a blob written before foundation support carries no `kind`, so it parses through the original component path unchanged. A foundation link addresses its source by scope rather than by node id, since its source is the file's own collections. Drift for every foundation row resolves from a single extraction during a library refresh, rather than one round trip per row. A scope stores both collection id and name, so a renamed collection retargets by name and reads as out of date rather than as missing.

`frameKit.applyThemeToKit` and the inline theme preamble in `buildDocFrames` do the same job. Migrating `docFrame` onto the shared helper was left out of the foundation work to avoid restructuring a large file mid-feature. The duplication is deliberate and known; the two must be changed together until it is resolved.

### `@spec-layer/proxy`

The Cloudflare Worker owns the Anthropic credential, AI-writing quotas, and
Lemon Squeezy license validation. Prose requests are restricted to the shipped
model, prompts, message shapes, output limits, and base64 image formats; remote
image URLs and caller-defined Anthropic options are rejected. Durable Objects
serialize quota updates per hashed identity. Per-isolate IP throttles blunt
simple abuse, while deployment-level rate rules remain the production
backstop.

## Storage

The plugin persists nothing outside Figma. Three surfaces hold state, each
chosen for its lifetime:

- `figma.clientStorage` holds per-user preferences: the license key and its
  instance id, the `aiEnabled` toggle, the brand theme, and the captured logo.
  It is per user and per machine, which is why license activation re-probes
  each session rather than trusting a stored verdict.
- `figma.root` plugin data holds the document registry, so a file knows which
  documents it contains without scanning every page.
- Each generated Section holds its own doc link and prose under plugin data on
  the node, which is what lets a document be found, drift-checked, and updated
  from the node itself rather than from a registry that could disagree with it.

The proxy holds the only server-side state: a KV namespace caching license
verdicts, and a Durable Object per hashed identity serializing quota updates.
Neither stores a license key in the clear.

## Verification

The root `npm run check` command runs lint, TypeScript checks, a NUL-byte scan,
unit tests, the plugin build, and a scan asserting the main-thread bundle
touches no browser globals the Figma sandbox does not provide. GitHub Actions
adds coverage thresholds and audits the full production dependency tree.
`npm run audit:active` narrows an advisory to the three shipped workspaces.
