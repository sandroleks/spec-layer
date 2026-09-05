# Spec Layer major review (2026-09-05)

Read-only review of `main` at `2bd37a3` plus the untracked
`docs/strategy/2026-09-02-design-conformance-pivot.md`. Covers the plugin, the
extractors, codebase cleanliness, speed, usefulness, UX, and monetization.
Nothing in the working tree was changed by this review.

Where a finding rests on something the repo cannot prove (behaviour inside
Figma, market response), it says so. Severity is about consequence for a user
or for the business, not about effort.

## Baseline, verified this pass

| Check | Result |
|---|---|
| `npm run lint`, `npm run typecheck` | pass |
| `npm test` | 113 files, 2098 passed, 9 todo, 10.3 s |
| `npm run build:plugin` | `dist/main.js` 235 KB, `dist/ui.html` 616 KB, both unminified |
| `npm run check:sandbox` | pass |
| `npm audit`, `npm audit --omit=dev` | 0 vulnerabilities |
| Extractor and landing schemas | byte-identical |
| `localeCompare` under `src/v5` | none (two hits are comments explaining why) |
| Git | 38 commits on `main` not pushed to `origin`, 2 stashes, 8 stale local branches |

Extractor cost, measured with an esbuild-bundled script over the synthetic v5
fixture scaled by replication (Node 22, M-series laptop, median of 5):

| Variables | `buildFoundation` | `foundationContentHash` (all collections) | `buildFoundationArtifactV5` (L1 + L2) | `foundationDtcgDocument` | DTCG clipboard size |
|---|---|---|---|---|---|
| 18 | 0.2 ms | 0.4 ms | 1.7 ms | 0.4 ms | 741 lines |
| 360 | 2.2 ms | 3.8 ms | 9.1 ms | 3.5 ms | 11,931 lines, 424 KB |
| 1080 | 4.4 ms | 8.9 ms | 20.3 ms | 9.8 ms | 44,811 lines, 1.66 MB |

`extract(button)`, `specContentHash`, `buildComponentArtifactV5` and the AI
YAML projection each stay under 1 ms at every scale. Conclusion: the pure
extractor is not where time goes. Every perceptible delay is a Figma API round
trip, a canvas mutation, or payload transport between the two plugin realms.

## The ten findings that matter most

Ranked by consequence. Details and evidence follow in the sections below.

1. **The manual Figma matrix has still never been run for v5.** Every other
   finding here is smaller than not knowing whether the shipped build works.
   `main.ts` and `ui-vnext.ts`, the two largest files, are excluded from
   coverage by design, so nothing automated exercises them.
2. **`window.confirm` guards four destructive or overwriting actions in the
   UI iframe** (Detach, Remove, Update of a hand-edited doc, Update all with
   edited rows). Figma's plugin iframe is sandboxed, and a sandboxed iframe
   without `allow-modals` makes `confirm()` return `false` without showing
   anything. If that holds for Figma's iframe, all four actions silently do
   nothing. Introduced in commit `6d9cd35`, after the last matrix run. Unverified
   from the repo; it is the first thing to check in Figma.
3. **38 unpushed commits on `main`.** Two weeks of work exists on one machine.
4. **The canvas drift hashes are locale-dependent.** `hash.ts` sorts object
   keys with `localeCompare` and runs in the UI iframe, which has full ICU.
   `v5/canonical.ts` documents this and deliberately leaves it. Two
   collaborators with different OS locales can disagree on `specContentHash`
   for a component whose axis names sort differently under their collations,
   and one of them sees a false "Update available". Low probability, real, and
   fixable for free at the next `EXTRACTOR_VERSION` bump.
5. **Copy for AI for a component is only reachable through the Library**, so
   the fastest path to value (paste component context into an agent) requires
   generating a canvas document first. The component screen has one action.
6. **Figma API calls are repeated with no memoization.** `resolver.variable`
   is called once per binding occurrence, not per distinct id; the foundation
   reader calls `getVariableByIdAsync` and `getPublishStatusAsync` once per
   variable instead of using `getLocalVariablesAsync`; Library drift
   re-serializes every component set one message at a time.
7. **The whole foundation dump rides every `selection` message** and the UI
   re-runs `buildFoundation` on every click. That is 114 KB of structured
   clone per selection at 360 variables and 340 KB at 1080.
8. **The Library's "Review detected changes" always lands on a fallback** that
   says a detailed comparison is not available. The menu offers a review the
   product cannot yet perform.
9. **The landing page does not mention publishing or the CLI**, which are the
   only Pro features with a moat. Pro is sold as "no fixed monthly AI cap" and
   "priority support".
10. **There is no usage signal of any kind.** The proxy logs counters for
    abuse only. Nobody can say how many installs create docs, copy for AI, or
    publish, so every monetization decision is made blind.

## 1. Extractors

### What is right

The audit boundary holds. `serialize.ts` and `serializeFoundation.ts` read
Figma and emit plain JSON through injected resolvers, and the extractor is
Figma-free. Identity is carried end to end (`id`, `kind`, `remote`,
`collectionId`), so nothing downstream guesses from a name. `figma.mixed`
symbols are typed and checked at every read site, which is the class of bug
that only shows up in Figma. Unresolvable references become stated status,
not empty maps. The rule minimizer in `tokens.ts` is careful about sparse
grids, joint presence, and same-name refs, and it is the strongest piece of
the codebase. The v5 layer validates in two independent levels, hashes a
canonical code-unit projection, and treats the AI profile and DTCG as
downstream projections that never feed a hash.

### Findings

**E1. No memoization of resolver lookups.** `serializeNode` awaits
`resolver.variable(id)` for every binding entry on every node in every
variant, sequentially within a node. On the small `button.json` fixture that
is 9 lookups for 5 distinct ids. A real component set with 40 variants and a
dozen bound nodes each makes hundreds of `getVariableByIdAsync` round trips
for a few dozen distinct variables, on every selection change and every
drift check. A `Map<string, Promise<ResolvedVariable | null>>` scoped to one
serialization pass (built in `main.ts` around the existing `resolver`) removes
the repeats without touching the extractor. Same for `resolver.style`.

**E2. The foundation reader fetches per id.** `foundationReader.variable`
calls `getVariableByIdAsync` once per variable id, and `publishStatusOf` once
per variable, per collection, per text style, and per effect style. Figma
exposes `getLocalVariablesAsync()` which returns every local variable in one
call, and `tokenResolve.ts` already uses it. Publication status is needed only
by the v5 export, not by selection-time token resolution, so it can be read
lazily or only for collections. This is the single biggest speed lever for
large files, and it runs on first selection, every Foundations load, every
Library refresh, every foundation build and every publish.

**E3. Layout capture is thin for what the product now promises.**
`RawNode.layout` carries padding, item spacing, and corner radius, only for
auto-layout nodes and only when positive. `LayoutValues` carries `radius` and
`gap`. Not captured: width, height, min/max sizes, sizing modes, wrap,
alignment, counter-axis spacing, stroke weight and alignment, dash patterns,
text metrics beyond size and weight (line height, letter spacing, text case,
decoration on unbound text). The conformance proposal depends on exactly these
fields, and the docs already render some of them through live instances, so
the projection is behind the canvas.

**E4. Gaps and raw values come from the default variant only.** `extractGaps`,
`extractRawValues` and `extractLayout` all walk `defaultVariant(root)`. A
hardcoded hover colour on a non-default variant is invisible to the brief and
to the v5 `unbound` list. This is a documented choice, but it is a real
blind spot for the "where is Figma off-system" story.

**E5. Corner-radius gap check is asymmetric.** `extractGaps` skips the radius
gap when `cornerRadius` or `topLeftRadius` is bound, but not when only another
corner is bound, so a node with `topRightRadius` bound and the rest hardcoded
is reported as a hardcoded radius. Minor, one condition.

**E6. `hash.ts` canonicalizes with `localeCompare`.** See finding 4 above.
Object keys in `IntermediateSpec` are fixed ASCII, where collations agree,
but `TokenRule.conditions` is keyed by user-typed axis names, and
`foundationContentHash` hashes the whole `unitContent` output including
user-typed names as keys. An Estonian collation puts Z between S and T; a
Danish one treats "aa" as a letter after Z. The recommendation is not to fix
it now: changing `canonical` flips every committed document to "Update
available". Instead, (a) add a test that pins `canonical()` output for the
golden fixtures against a code-unit sort so any drift between the two is
caught, and (b) switch to `compareCodeUnits` in the same change as the next
`EXTRACTOR_VERSION` bump, since that bump already asks for a rebuild.

**E7. The DTCG clipboard outgrows its own warning.** The "large for some chat
windows" caveat triggers at 800 lines. A 360-variable file produces 11,931
lines, so every real design system trips it, and the whole-file copy has
become a developer artifact rather than something anyone pastes into a chat.
Compact JSON (no indentation) roughly halves it. Better: make the
per-collection copy the default from the Foundations screen and keep the
whole-file document behind Publish, where the CLI already writes it as files.

**E8. `EXTRACTOR_VERSION` drift reporting is coarse but honest.** A doc from
another extractor version reads as "Rebuild needed" without a hash
comparison. Correct, and the copy is right. No change needed; noted because
the pending `code_syntax` change was correctly kept out of the canvas hashes.

## 2. Codebase cleanliness

### What is right

Workspaces are cleanly separated, the invariants in `CLAUDE.md` are
load-bearing and each has a guard (`check:nul`, `check:sandbox`, schema
parity, `compareCodeUnits`). Conventional commits, a changelog kept in step,
specs beside code. The test suite is large and fast. Coverage floors ratchet.
`screens/*` are presentation-only and `viewModel/*` is pure; that split is
consistently held.

### Findings

**C1. Four files carry most of the risk.**

| File | Lines | Role |
|---|---|---|
| `ui/ui-vnext.ts` | 2422 | UI state, message plumbing, library operations, font menu, global search, quota and license flows, all event wiring |
| `main.ts` | 1456 | every Figma API call, one `switch` with 24 cases |
| `docFrame.ts` | 1317 | component canvas renderer |
| `ui/harness.ts` | 1080 | dev-only harness, never shipped |

The first two are excluded from coverage and are the ones the manual matrix
exists for. `ui-vnext.ts` already has the pattern it needs: `publish.ts` is a
controller with module state and an injected host. Library operations
(queue, batch, copy), the font menu, global search, and the quota/license
refresh each deserve the same treatment under `ui/controllers/`. `main.ts`
splits naturally into `handlers/documents.ts`, `handlers/foundation.ts`,
`handlers/publish.ts`, `handlers/settings.ts`, with the two build guards and
the registry helpers in a shared module and a dispatch table in `main.ts`.

**C2. Comment archaeology.** 6,832 of 30,117 source lines in the plugin and
extractor are comments. Most are valuable "why" text, but a share narrates
past bugs and plan tasks by number ("Task 12 gives them their own resolution
path", "Finding 2", "the previous task"). `main.ts` alone has five such
references, and the "Task 12" ones describe work that has since shipped.
Prune the task numbers and the "used to" histories that git already holds;
keep the invariant explanations.

**C3. Legacy branches with no sunset.** Pre-2.1 name-match adoption in
`findExistingDoc`, the `brandColors` to `brandTheme` migration, the
`DocLinkData` blob without `kind`, the proxy's legacy `keyHash` and owner
array, and the `Bearer KEY` without instance id. Each is right to keep for
now; none records when it can go. Add a dated sunset list to
`ARCHITECTURE.md` and remove them at the 5.0.0 release plus one version.

**C4. Type escapes are few and clustered.** 4 `eslint-disable`, 7 `as any`
(all `serializeNode(src as any, resolver)` in `main.ts`), 35 `as unknown as`
(mostly `ProseNodeLike` and `YamlValue` casts). A `serializeNode` overload
that accepts `SceneNode` would remove the `as any` cluster.

**C5. Single-member unions and unused parameters.** `DocSourceIntent = 'update'`
still describes a removed Download; `presenter(action: 'create')` takes a
literal it never branches on; `updateFromSource(_state, ...)` ignores its
first argument. Small, but each is a question the next reader has to answer.

**C6. Repository weight and clutter.**

- `docs/plugin-ui-vnext/prototype/` is 28 MB of PNGs, 218 files, in git. The
  pack is 154 MB. Prototype screenshots belong in a release asset or Git LFS.
- `screenshots/` at the repo root holds 10 unreferenced images.
- `apps/landing/1.png` through `4.png` are not referenced by any page.
- `docs/plugin-ui-vnext/design-system/` holds re-export shims that exist only
  so old plans keep resolving. Delete them and let the plans go stale.
- `project-docs/` is an archived vault, correctly labelled. Move it out of the
  working tree or into a `docs/archive/` folder with the notice.
- 8 local branches, 2 stashes, 1 untracked strategy document.

**C7. Canvas copy contains em dashes.** `docFrame.ts:1021` and `:1041`
("Showing the first 4 values — other rows share the same state behavior.")
and the `—` placeholder cell at `docModel.ts:391`. The voice rules cover
plugin UI copy; rendered documentation is arguably the same audience and the
prose prompt already forbids the character. Decide once and apply.

**C8. The dev harness is a second UI state machine.** `harness.ts` rebuilds
every screen's state by hand so screenshots can be compared against the
prototype. It compiles under `typecheck` but nothing runs it, and its 1080
lines have to be updated whenever a screen's contract changes. Either wire it
into a happy-dom smoke test that renders each state, or move it to
`tools/` and stop counting it as plugin source.

## 3. Speed

Measured facts are in the baseline table. The pure extractor is fast. These
are the places time actually goes, in order of expected payoff.

**S1. Bulk-read the foundation and stop per-id publication reads (E2).**
Estimated from call counts: a 464-variable file makes roughly 470 variable
reads plus 470 publish-status reads on every foundation serialization. One
`getLocalVariablesAsync` call plus per-collection publish status replaces
that.

**S2. Memoize resolver lookups per serialization pass (E1).** Also share one
memo across a whole Library drift batch, since every doc in one file binds
the same few dozen variables.

**S3. Stop posting the foundation dump on every selection (finding 7).** Post
a short `foundationStamp` on `selection`, keep the dump in the UI, and send
`requestFoundation` only when the stamp changes. `onSelectionFoundation` then
runs `buildFoundation` once per file change instead of once per click.

**S4. Batch Library drift.** `startLibraryDriftChecks` sends one
`requestDrift` per component row; `main.ts` answers each with a full
`serializeNode` of the component set. A single `requestDriftBatch` handled
with `Promise.all` and the memo from S2 turns N sequential message round trips
into one.

**S5. Minify the bundles.** `build.mjs` never sets `minify: true`. The iframe
loads a 616 KB HTML document on every plugin open. Minification is a one-line
change; the sandbox scan matches globals, which minifiers do not rename.

**S6. Instrument the canvas build.** `buildDocFrames` creates live instances
for anatomy, measure, variants and states, and loads fonts once per build.
That cost cannot be measured outside Figma. Add `console.time` around each
section builder behind a debug flag so the manual matrix run records real
numbers for a large component set, and the next optimization is chosen from
data.

**S7. Compact the DTCG clipboard (E7).**

## 4. Usefulness

### What is right

Deterministic depth is the differentiator and the code honours it: no
fabricated values anywhere, ambiguity resolved to "unknown" rather than a
guess, drift in both directions with a hash that structurally covers the
render. The two-lane update model (rebuild generated content, keep editorial
text) solves the problem that kills most documentation generators. DTCG
export and a zero-dependency CLI put the output where engineers already are.
The v5 artifact is a genuine machine-readable contract.

### Findings

**U1. Copy for AI is behind canvas generation (finding 5).** A user who wants
component context for an agent must create a documentation Section first,
then find the row in Library, then open its overflow menu. Add "Copy for AI"
as a secondary footer action on the component screen. Everything it needs
(`state.currentSpec`, the cached foundation) is already in the UI.

**U2. "Review detected changes" cannot review (finding 8).** `changeGroups`
is typed `null` and the screen renders "A detailed comparison isn't
available". The v5 artifact, the canonical hash and the stored `DocLinkData`
make a semantic diff feasible: compare the stored `IntermediateSpec`
projection with the live one and list added, removed and changed rules by
part and property. This is also the `diff` command the v5 status document
already plans, so one implementation serves both. Until then, remove the
menu item and let the status pill's disclosure show the fallback.

**U3. Extraction depth versus the conformance direction (E3, E4).** If the
strategy document is adopted, the first engineering phase is widening
`RawNode`, `LayoutInfo` and the gap scan, and deciding which new fields are
hash-neutral. Do that widening whether or not the pivot happens; the docs
already render those values from live instances, so documenting them in the
brief is catching up, not new scope.

**U4. Foundations copy scope.** The whole-file copy "deliberately ignores the
scope selection" so an agent never sees a partial vocabulary. With DTCG that
argument weakens: a resolver document is meant to be split into files, and the
CLI already does. Offer the selected collections as the Foundations copy and
keep the whole file one click away.

**U5. A component has no versioning story.** `generatedAt` and
`pluginVersion` are stamped, but there is no changelog per doc and no way to
see what changed between two generations. The hash makes this cheap to add
later, and it is the natural place for the diff from U2 to surface.

**U6. The atom notice and `.`-prefixed components.** Correct and honest, but
nothing lets a user document a whole page of components in one pass. Batch
creation from a selection of several component sets is the most common
request category for this class of plugin and the main thread already
serializes them one at a time.

## 5. UX

### What is right

The five-destination rail, one shell, consistent header and footer, aria
attributes and focus management, sentence-case copy without hype, honest
empty states, a real progress narration tied to the actual phases, and a
manual-copy fallback when the clipboard API is unavailable. The License screen
distinguishes "unknown" from "free" so an offline Pro user is never demoted on
screen.

### Findings

**X1. `confirm()` dialogs in a sandboxed iframe (finding 2).** Replace the
four `window.confirm` calls with an in-shell confirmation pattern (the
manual-copy modal already shows how modals are done here). Do this regardless
of the verification result, because native dialogs also break the theme and
cannot be styled or focus-trapped.

**X2. Toast on every non-component click.** `postSelection` calls
`figma.notify('Select a component or component set')` whenever the selection
is not a component, which is every time the user clicks a frame, a text node,
or one of the plugin's own documentation Sections while the plugin is open.
The empty state already says the same thing. Remove the toast, or fire it
only for the explicit `requestSelection` on mount.

**X3. Copy for AI placement (U1).**

**X4. Review that cannot review (U2).**

**X5. Fixed 480 x 680 window.** `figma.ui.resize` is never called. Library
rows with long names and the publish screen's setup command truncate. A
resizable window, or at least a taller default when the Library has many
rows, is cheap.

**X6. Pro upsell surfaces disagree.** The header ring, the License plan card,
and the publish screen each phrase the plan differently and link to two
different checkout URLs (`CHECKOUT_URL` in the plugin, and a monthly and yearly
pair on the landing page). The plugin never offers yearly.

**X7. Foundations picker has no search and no counts per collection type.** A
file with twenty collections is a flat list of twenty rows. Group by type icon
or add the filter the Library already has.

**X8. Success state after Create docs does not offer the next step.** The
banner says Created or Updated and the canvas zooms. Offering "Copy for AI"
and "Open in Library" there closes the loop the product is built around.

**X9. Publish screen exposes the pull key in a copyable command.** Correct
and disclosed, but a second device sees the library id without the key and
the only remedy is rotation, which invalidates the first device's key. The
screen should say that before the button is pressed.

## 6. Monetization

### The current model, as the code implements it

Free: every deterministic feature, 20 AI generations in the first 30 days,
then 10 per UTC month. Pro at $7.99 per month or $79.99 per year: no fixed AI
cap (soft threshold 1000, 10 requests per minute), publishing up to 10
libraries, key rotation. Licenses through Lemon Squeezy, validated by the
proxy with a 24 hour cache and a 5 day grace window.

### Findings

**M1. The paywall gates the cheapest thing and hides the valuable one
(finding 9).** A Haiku generation costs the business well under a cent. The
landing page sells Pro as uncapped AI and priority support, and does not
mention publishing, the CLI, DTCG, or the artifact at all. The one feature a
competitor cannot copy from a prompt is invisible to a buyer.

**M2. The buyer is wrong for the price and the price is wrong for the buyer.**
The strategy document makes this case well and this review agrees: an
individual designer paying $7.99 from their own card has no budget line, and
a design system team that would pay tens to hundreds a month cannot buy a
team license because none exists. `identity.ts` keys everything on one
license key with a device limit; a team tier is a new Lemon Squeezy product
and a tier name, not a new licensing system.

**M3. Publishing behind Pro starves the CLI funnel.** Every `spec-layer pull`
begins with a plugin publish, and every publish requires Pro. A free tier
with `LIBRARY_LIMIT` of 1 and a lower `MAX_BUNDLE_BYTES` seeds repositories
with the artifact, which is what creates engineering-side demand. Both are
constants in `libraries.ts`; the UI half is `publishLocked` in `allowance.ts`.

**M4. No funnel data (finding 10).** Add counters, not content: plugin events
(`doc_created`, `copy_component`, `copy_foundation`, `publish`,
`library_update`) posted to the proxy as bare event names against the hashed
identity that already exists, and a daily count of distinct identities.
The privacy policy already covers the hashed identity for quota, so this is a
one-paragraph addition, and it can be opt-out in Settings. Without it the
pivot decision in the strategy document has no phase 2 signal.

**M5. Free-tier identity is client-asserted.** `X-Figma-User` is whatever the
plugin sends. Anyone can mint identities and consume free generations, bounded
only by the per-isolate IP limiter and the Cloudflare rate rules the
architecture document says exist in production. Cost exposure is bounded by
Haiku pricing and the 10 per minute limit, so this is a note, not an alarm.
It does mean the free quota can be burned on behalf of a known Figma user id,
which is public.

**M6. Retiring Pro needs a migration plan before the listing changes.**
Grandfather, migrate or refund is an open decision in the strategy document.
The proxy needs nothing new for grandfathering; the landing page and the
License screen copy do.

**M7. Naming.** The manifest reads "Spec Layer: Auto Docs & Specs" and the
landing descriptor "Auto Documentation & Specs". The code has become a
context and contract exporter with documentation as one output. The Community
listing update on the open list is the moment to rename.

## 7. Security and abuse, briefly

The proxy's request validation is strict and well tested: fixed model, fixed
system prompt and few-shot, bounded output, base64 images only, field
allow-lists, size caps measured in the same unit at every check. CORS `*` is
correct for a null-origin iframe with header auth. License keys are hashed for
identity and never logged. Durable Objects serialize quota. Pull keys are
random, hashed at rest, and never returned after creation.

Open items: client-asserted free identity (M5); per-isolate rate limiting is
a blunt instrument and the deployment-level rules cannot be verified from the
repo; the pull key travels in a copied shell command, which the CLI's `setup`
now handles with a mode `0600` file, so the plugin copy is the only place it
appears in the clear.

## 8. Documentation and process

`ARCHITECTURE.md`, `CLAUDE.md`, the two v5 specs, the status document and
the changelog are current and agree with the code. The knowledge map is a good
first read. Weak points: the comment archaeology (C2), 32 MB of images under
`docs/` (C6), and the strategy document sitting untracked.

## 9. Recommended order of work

**Now, before anything else**

1. Push `main`.
2. Run the manual matrix in `packages/plugin/TESTING.md` against a
   development build. While in Figma, check three things this review could
   not: whether `window.confirm` returns without showing a dialog, how often
   the non-component toast fires in normal use, and the real size and paste
   behaviour of the DTCG clipboard for a real file.
3. Commit the strategy document with a status line, even if the decision is
   "not yet".

**Quick wins, one to two days total**

4. Memoize resolver lookups per pass (E1, S2).
5. Bulk-read variables and defer publication reads (E2, S1).
6. Stop posting the foundation dump per selection (S3).
7. Replace `window.confirm` with the in-shell modal (X1).
8. Remove the non-component toast (X2).
9. Add Copy for AI to the component screen footer (U1).
10. Minify both bundles (S5).
11. Compact the DTCG clipboard and make per-collection copy the default (E7, U4).

**One to two weeks**

12. Split `main.ts` into handler modules and `ui-vnext.ts` into controllers (C1).
13. Fake-`figma` tests for the commit ordering in `renderDocFrame`,
    `renderFoundation` and `updateFoundationDoc`, the paths the matrix exists
    for and the ones that mutate a user's canvas.
14. Semantic diff for Library review, shared with the planned `diff` command (U2).
15. Usage counters at the proxy with a Settings opt-out (M4).
16. Pin `canonical()` against code-unit ordering in a test; schedule the
    switch for the next `EXTRACTOR_VERSION` bump (E6).
17. Widen layout and text capture with a hash-neutrality check per field (E3).

**Strategy**

18. Decide the conformance pivot's phase 1 or reject it in writing.
19. Free publishing with limits (M3), a team tier (M2), landing and listing
    rewrite that sells the artifact and the CLI (M1, M7).
20. Repository hygiene: LFS or release assets for prototype screenshots,
    delete unreferenced images and shims, archive `project-docs/` (C6).

## Appendix: how this was measured

- Gate: `npm run lint && npm run typecheck && npm test && npm run build:plugin
  && npm run check:sandbox`, exit 0.
- Extractor timings: a scratch script bundling
  `packages/extractor/src/index.ts` and `packages/plugin/src/serialize.ts`
  with esbuild, running over
  `test/fixtures/v5/synthetic-foundation-serialized.json` with each
  collection's variables replicated 1x, 20x and 60x under new ids, and
  `test/fixtures/button.json`. Median of five runs after warm-up. The script
  was not committed.
- Resolver call counts: an in-memory `NodeResolver` counting calls while
  `serializeNode` walked `button.json` with `boundVariables` synthesized from
  its recorded bindings.
- Everything about behaviour inside Figma is inferred from source and marked
  as needing verification.
