# Spec Layer plugin — holistic review (2026-07-22)

Branch `plugin-3.0`. Read-only audit of `packages/plugin` (and the adjacent
`packages/proxy`, since the plugin's licensing depends on it). Covers
correctness, security/abuse, accessibility, consistency, performance, and test
coverage.

## Baseline health (verified this pass)

- `tsc -p packages/plugin/tsconfig.json --noEmit` — **passes**
- `node packages/plugin/build.mjs` — **passes** (`dist/main.js` ~197 KB, `dist/ui.html` ~458 KB, both unminified)
- `vitest run packages/plugin/test` — **219 tests pass across 16 files**
- `eslint packages/plugin/src` — **clean**

The suite is green. The issues below are things the current checks do not catch
(Figma-API/DOM-bound code, cross-function interactions, docs, tooling).

---

## A. Release gate — RESOLVED for the staging move (2026-07-22)

Decision: the `spec-layer-test` workers.dev account **is** the intended staging
target; keep it. Version → `3.0.0`. Verified: build bakes `3.0.0`, 219 tests
still pass.

**A1 · Proxy targets the `-test` Worker.** `RESOLVED (intentional for staging)`
Confirmed the `-test` host is the staging environment. Left `proxy.ts` and
`manifest.json` pointed at it and added a comment at `proxy.ts:3` marking it
staging and noting the prod-domain swap needed before a public release.
Not a bug for staging; re-open when cutting a production build (split
`allowedDomains` = prod / `devAllowedDomains` = staging, and consider build-time
`define`-ing `PROXY_URL`).

**A2 · Version.** `DONE`
`package.json` bumped `2.0.0 → 3.0.0`; `__PLUGIN_VERSION__` now stamps `3.0.0`
into every doc frame (verified in `dist/main.js`).

**A3 · TESTING.md.** `DONE`
Rewritten to the proxy/freemium model: proxy is the only permitted host (labeled
staging), no Anthropic API key, and steps now cover the quota meter, Pro license
activation / Renew / Remove-key / Manage-subscription, the upsell fork, and the
Frame-theme presets/Custom/logo behavior.

---

## B. Correctness bugs

> **Section B resolved 2026-07-22.** All fixed except B14 (dismissed — see
> below). Verified end-to-end: typecheck ✓, lint ✓, build ✓, 226 tests pass
> (7 new: 5 `isQuotaExhausted`, 2 `parseDocLink` normalization).
>
> | Bug | Status | Where |
> |---|---|---|
> | B1 | FIXED | `main.ts` capture `existingId` before `remove()` |
> | B2 | FIXED | `proxy.ts` `isQuotaExhausted` + `ui.ts` `refreshQuota` reconcile |
> | B3 | FIXED | `main.ts` `collectText` skips INSTANCE subtrees* |
> | B4 | FIXED | `main.ts` `selectionSeq` latest-wins + try/catch |
> | B5 | FIXED | `main.ts` `docFrameRendering` in-flight guard |
> | B6 | FIXED | `measureSection.ts` `removeCanvasSubtree`, `docFrame.ts` section cleanup |
> | B7 | FIXED | `ui.ts` unhide renew row on expired activation |
> | B8 | FIXED | `ui.ts` `refreshQuota` synthesizes free quota carrying the demotion reason |
> | B9 | FIXED | `ui.ts` `syncAllGroups`/label after `renderStatesHint` |
> | B10 | FIXED | `ui.ts` `syncSelectAllLabel` from live state at boot |
> | B11 | FIXED | `ui.ts` `driftSource` ignores replies with no baseline |
> | B12 | FIXED | `docFrameDone.replaced` → "Updated" vs "Created" |
> | B13 | FIXED | `tokenResolve.ts` `indexByUniqueName` drops ambiguous names |
> | B14 | DISMISSED | `Math.min(x/w,…,1)` can't yield 0 from a zero dim (→∞→1); risky sites already in try/catch |
> | B15 | FIXED | `main.ts` `findExistingDoc` won't adopt another source's doc |
> | B16 | FIXED | `docLink.ts` `parseDocLink` normalizes all DocConfig fields |
>
> \*B3 note: changing the self-hash basis means previously-generated docs will
> show "edited" once until regenerated (one-time reset of drift state).
> Also observed: `refreshQuota` gained a `quotaSeq` latest-wins guard in the
> working tree, resolving the concurrent-refresh half of F6.

**B1 · `existing.id` read after `existing.remove()` → new doc unregistered + false error.** `HIGH` — **FIXED**
`main.ts:390` removes the old doc, then `main.ts:399` reads `existing.id`.
Property access on a removed Figma node throws (only `.removed` is safe). This is
past the `committed = true` point, so the throw lands in the catch (`main.ts:410`),
which leaves the new Section placed but **never runs `writeRegistry`** — the doc
has a valid `DOC_LINK_KEY` but is missing from the registry (no Library entry, no
drift tracking) and the user sees a `docFrameError` toast despite a visually
successful regenerate. Hits every "regenerate over an existing doc." **Fix:**
capture `const existingId = existing?.id` before `.remove()` and use it at 399.
(Trivial and safe regardless of the exact throw behavior.)

**B2 · `quotaExhausted` never cleared on refresh or Pro activation.** `HIGH` — **FIXED**
Set `true` at `actions.ts:259`; only reset at `ui.ts:309` ("Continue without AI")
and `actions.ts:88`. `refreshQuota` (`ui.ts:68-85`) updates the quota/tier but
leaves the flag set. With the current uncommitted `render.ts` change,
`renderQuota` hides `primaryActions` whenever `showUpsell = aiEnabled &&
quotaExhausted` (`render.ts:69,75`). **Scenario:** user exhausts free AI →
activates Pro → upsell keeps showing and Create/Download stay hidden even though
they are Pro; same on month rollover. **Fix:** clear `quotaExhausted` in
`refreshQuota` when fresh quota shows `tier==='pro'` or `remaining>0`, or derive
it from `state.quota` instead of storing it.

**B3 · Self-edit hash includes live-instance text → source drift misreported as hand-edit.** `MEDIUM`
`collectText` (`main.ts:181-191`) recurses into embedded component *instances*
(variant slots, matrix cells, anatomy preview), so `selfHash` captures their
rendered labels. When the source component's text changes, the instances
re-render, the hash diverges, and the doc is flagged `selfEdited`/`edited` though
the user never touched it. **Fix:** skip `INSTANCE` subtrees when hashing.

**B4 · No sequencing on `selectionchange` → stale selection can win.** `MEDIUM`
`main.ts:177` fires an un-awaited async `postSelection` per change; `serializeNode`
is async, so A→B can resolve out of order and show A's spec for selection B. The
floating promise also swallows throws (no UI update). **Fix:** latest-wins request
id + try/catch.

**B5 · No in-flight guard on `renderDocFrame`; build mutates module globals.** `MEDIUM`
`main.ts:345` handler is re-entrant; concurrent builds mutate shared state
(`palette`, `CARD_WIDTH`/`CONTENT_WIDTH` in `docFrame.ts:38-39`, font families in
`frameKit.ts:43-53`) assumed single-threaded, and both resolve/remove the same
`existing` → clobbered widths/theme or duplicate docs. **Fix:** add an
`isRendering` guard (mirror the existing license activate guard).

**B6 · Orphaned frames on late build failure (violates "never litter the canvas").** `MEDIUM`
`measureSection.ts:683-715` removes `inst` but not the `box`/`card` frames it
created and re-parented; `docFrame.ts:1271-1274` removes the frames but not the
`section` created at `1249`. A layout/API throw leaves empty frames/Sections on
the page. **Fix:** track and remove `box`/`card`/`section` in the catch blocks.

**B7 · Failed activation of an expired key doesn't surface the Renew link.** `MEDIUM`
`ui.ts:350-358` non-success branches set `licenseStatus.textContent` but never
call `renderLicense`, which is what unhides `licenseRenewRow` (`render.ts:47`).
So an expired key shows the "expired" copy with no Renew affordance. **Fix:** call
`renderLicense(refs, state)` in the error branches.

**B8 · `refreshQuota` drops the demotion reason when there's no Figma user id.** `LOW` — **FIXED**
Fixed 2026-07-22: when the free re-fetch returns null, `refreshQuota` now
synthesizes `{ tier:'free', licenseReason: reason, … }` so the license view
resolves to `inactive` (Renew for an expired key) instead of the ambiguous
"Your Pro key is saved." The resulting 0-left meter is accurate — with no free
identity the user has no usable generations until renewal. Decision path covered
by the existing `resolveLicenseView` expired-reason test.

`ui.ts:76-80`: on a definite demotion it re-fetches with the free identity; if
`figmaUserId` is null the free fetch returns null, `state.quota` becomes null, and
the just-learned reason is lost — an expired key then renders as `unknown` ("Your
Pro key is saved.") with no Renew, contradicting the "expired shows Renew" intent.
Edge case (a user id is almost always present). **Fix:** keep a synthetic
`{tier:'free', licenseReason: reason}` when the free re-fetch is null.

**B9 · `renderStatesHint` toggles the States checkbox without re-syncing its group.** `MEDIUM`
`render.ts:275-276` sets `.checked`/`.disabled` programmatically (no `change`
event), so the group-sync listener (`ui.ts:490-493`) never runs. A component with
no state axis leaves States unchecked but the "Specifications" group's N/M badge
and master checkbox still count it. **Fix:** call `syncGroup('specs')` after
`renderStatesHint`.

**B10 · "Clear all" label unsynced to the mixed default → first click does the opposite.** `MEDIUM`
Defaults are 9/12 on (`dom.ts:29-31`) but the button label is hardcoded "Clear
all" (`dom.ts:932`) and only recomputed after a click; the toggle treats
not-all-on as "select all", so the first click *selects* the 3 off sections.
**Fix:** compute the label from live checkbox state at boot.

**B11 · Drift baseline race → phantom "Update available".** `MEDIUM`
`startDriftChecks` clears `libBaseline` (`ui.ts:145-153`); a `library` refresh
during in-flight drift requests makes a late `driftSource` read `undefined` and
mark the doc `drifted` (`ui.ts:833-836`). **Fix:** include `storedContentHash` in
the reply and compare directly, or ignore replies whose docId left the baseline.

**B12 · `docFrameDone` always says "Created …", even for a library Update.** `LOW`
`runUpdateFromSource` (`actions.ts:528-534`) reuses `renderDocFrame`, whose
success reply shows `Created ${frameName}` (`ui.ts:807-815`). Updating shows
"Created". **Fix:** carry the intent through and word the banner accordingly.

**B13 · Token caches keyed by name only → cross-collection collisions.** `LOW`
`tokenResolve.ts:19-25,64-70,106-116` do `map.set(v.name, v)`; two
variables/text-styles with the same name in different collections collide
(last wins), so a swatch/number/typography value can resolve to the wrong token.
**Fix:** collision-aware keying, or document the limitation.

**B14 · `rescale(0)` when an instance has zero width/height.** `LOW`
`docFrame.ts:637-638` (also `frameKit.ts:182`, `measureSection.ts:679-680`):
`scale = Math.min(maxW/inst.width, …)` yields 0 for a zero-width instance and
`rescale(0)` throws. **Fix:** clamp to a small positive min, or bail on zero.

**B15 · Legacy name-match adoption can hijack an unrelated Section.** `LOW`
`main.ts:229-233` fallback returns the first `SECTION` named `"X: Documentation"`
regardless of `DOC_LINK_KEY`, so a user's own same-named Section can be removed
and replaced. **Fix:** only adopt a name match that has no conflicting
pluginData.

**B16 · `parseDocLink` validates only `config.sections`.** `NIT`
`docLink.ts:54-71` doesn't validate `variantIds`/`measureViews`/`anatomyView`; a
partially corrupt blob passes and is echoed to the UI and used to rebuild.
**Fix:** validate/default the remaining `DocConfig` fields.

---

## C. Security & abuse (proxy)

The enforcement architecture is sound: all license/quota authority is server-side
in the Cloudflare Worker; the plugin only displays state, so client spoofing
cannot mint real Pro generations. No raw license key is logged, stored, or put in
a URL — all server-side keys use `sha256(key)`; auth is header-only. The findings
below are on the server's abuse surface. **Note:** C1 and C2 are logged as
*accepted risks* in `docs/superpowers/plans/2026-07-15-license-key-hardening.md`;
they're included because the plan's own mitigation was not implemented.

**C1 · `/v1/prose` is effectively an open Claude-Haiku relay.** `HIGH (accepted risk)`
`packages/proxy/src/handlers.ts:48-57,105-115`: the client fully controls
`request.system` and `request.messages`; only a fixed model, `max_tokens ≤ 3000`,
and a `cacheKey` prefix regex are checked. Anyone who learns the header format can
POST arbitrary prompts for free Haiku on your Anthropic bill, bounded only by a
spoofable per-identity quota (C2). **Fix:** build the system/few-shot server-side
from a small structured spec payload, or HMAC-sign the request shape.

**C2 · Free tier authenticated only by client-asserted `X-Figma-User`.** `HIGH (accepted risk)`
`identity.ts:25-26`, `quota.ts:58-77`: a never-seen identity gets a fresh
20-generation window, so a random header per request = unlimited free generations.
The plan's stated mitigation ("per-IP limits on `/v1/prose`") was never
implemented. **Fix:** per-IP sliding-window on `/v1/prose`, or a signed
free-identity handshake.

**C3 · IP rate limiter guards only `/v1/license/*`, not `/v1/prose` or `/v1/quota`.** `MEDIUM`
`handlers.ts:59,133` (no limiter) vs `157-159,182-183`. Leaves C2 unthrottled, and
`/v1/quota` with `Bearer <guess>` triggers a Lemon Squeezy validate on every cache
miss and returns `licenseReason` — an unthrottled key-enumeration oracle (Task 3
intended to close this but only gated `/v1/license/*`). **Fix:** apply the IP
limiter to `/v1/quota` and `/v1/prose`; don't return `licenseReason` for keys
that fail the first check.

**C4 · Device-limit enforcement is opt-in by the client.** `MEDIUM`
`identity.ts:20-23`, `license.ts:94-113`, `handlers.ts:72`: a bare `Bearer <key>`
(no `:instanceId`) validates the key alone and grants Pro regardless of activated
device count, so one Pro key can be shared across unlimited devices and
deactivating a device doesn't revoke a bare-key client. The backward-compat
requirement structurally nullifies device enforcement. **Fix:** meter/deprecate
bare-key usage; eventually require instance-qualified bearers (grandfather by key
age).

**C5 · Manifest reasoning understates what leaves the client.** `LOW`
`manifest.json:14` says requests "carry only the component's structured summary",
but the plugin also exports a rendered PNG of the node (`main.ts:313-335`,
`packages/extractor/src/prose/client.ts:141-146`) and sends it to the proxy →
Anthropic. Inaccurate for store review / user trust. **Fix:** mention the rendered
image, or gate it behind opt-in.

**C6 · Pro devices of one subscription share a single 10/min rate window.** `LOW`
`quota.ts:5,89-116` keys the DO identity on the key hash only, so a team sharing a
Pro key shares one `RATE_LIMIT_PER_MIN=10` budget and hits 429s under normal
concurrent use. **Fix:** raise or per-instance the rate limit for Pro.

**C7 · `QuotaEngine` parse / DO fetch lack recovery.** `NIT`
`packages/proxy/src/index.ts:22-23,33,40-43`: `JSON.parse(stored)` inside the DO
fetch has no try/catch (a corrupt record → permanent 500 for that identity), and
`doQuotaClient.call` does `res.json()` without checking `res.ok`. **Fix:** fall
back to `fresh()` on parse failure; check status before `json()`.

---

## D. Accessibility

**D1 · Overflow row-menu (`role="menu"`) has incomplete keyboard support.** `MEDIUM`
`ui.ts:164-188,259-261`: doesn't move focus into the menu on open, no arrow-key
roving between items, and Escape closes without returning focus to the `⋯`
trigger. **Fix:** focus first item on open, handle ArrowUp/Down, restore focus on
close.

**D2 · Tab bar lacks arrow-key navigation for its `role="tablist"`.** `LOW`
`dom.ts:852-861`, `render.ts:320-332`: tabs have the roles/`aria-selected` but no
roving tabindex or Left/Right handling. **Fix:** add arrow handling + roving
tabindex, or drop the tablist roles.

(Verified good: reduced-motion is genuinely handled — `dom.ts:472-479` disables
loader animations under `prefers-reduced-motion`.)

---

## E. Consistency, voice & docs

**E1 · User-facing em dash violates voice rule 1.** `LOW`
`main.ts:294`: `'Logo image is too large — pick a smaller node'`. The voice guide
(`docs/plugin-voice-and-copy.md`) forbids em dashes in user-facing copy. **Fix:**
`"Logo image is too large. Pick a smaller node."`

**E2 · Em dashes in generated doc output.** `NIT`
`modelMarkdown.ts:60` (` — ${p.description}`) and `docModel.ts:382,384` (`'—'`
empty-value placeholders). The voice doc scopes rule 1 to UI chrome and exempts
AI doc prose, so this is borderline — decide whether the rule extends to
generated spec tables. If yes, use a colon separator and `"None"`/`"-"` for
empties.

**E3 · `window.onmessage =` assignment (no `addEventListener`, no default case).** `NIT`
`ui.ts:704-705`: a future second handler would silently clobber this one, and
unknown message types drop with no diagnostic. **Fix:** `addEventListener('message', …)`
+ explicit default branch.

---

## F. Performance / optimizations

**F1 · Full component-set serialization on every `selectionchange`.** `MEDIUM`
`serialize.ts:143-145` recurses every variant + subtree with per-node sequential
awaits, on each reselect (`main.ts:114`). Large sets → big `postMessage` payloads
and many serial round-trips → jank browsing a library. **Fix:** cap/short-circuit
variant recursion for the selection preview, or debounce + memoize by node id.

**F2 · Library list fully rebuilt on every drift reply.** `MEDIUM`
`render.ts:357-395` clears and recreates all rows; one reply per doc
(`ui.ts:145-154,837,844`) → N full rebuilds for N docs, and a focused inline
"Update" button loses focus on rebuild. **Fix:** update only the affected row's
badge/button in the drift handlers.

**F3 · Unminified bundles shipped.** `LOW`
`build.mjs:21-69` has no `minify`; `ui.html` is ~458 KB of inline script parsed on
every open. **Fix:** `minify: true` for release builds (optionally
`sourcemap:'inline'` for dev); log output sizes; consider a try/catch that
distinguishes build failure from crash.

**F4 · Sequential awaits in `serializeNode` binding/style resolution.** `LOW`
`serialize.ts:59-87` resolves `variableName`/`styleName` one await at a time per
node. **Fix:** `Promise.all` the independent lookups.

**F5 · `requestComponentImage` posts base64 with no size guard.** `LOW`
`main.ts:313-335` caps only the long edge at 1568px (vs `captureLogo`'s 700K byte
guard at `main.ts:293`); a wide export can still be a huge `postMessage`. **Fix:**
add a byte-length guard.

**F6 · Concurrent `refreshQuota` / concurrent generation.** `LOW`
Boot fires `refreshQuota` from both `licenseKey` and `userInfo` handlers
(`ui.ts:741,749`) → duplicate LS round-trips + last-writer-wins on `state.quota`.
Separately, Download and Create-frame have independent in-flight locks
(`ui.ts:268-275` vs `318-322`), so both can generate for the same node → double
quota consumption. **Fix:** single-flight `refreshQuota`; share one generation
guard across Download/Create.

---

## G. Tooling & test coverage

**G1 · `noUncheckedIndexedAccess` is off despite index-heavy grid math.** `MEDIUM`
`tsconfig.base.json`: `strict:true` is on, but not `noUncheckedIndexedAccess`.
The core is matrix/grid indexing (`docModel`/`statesSection`, `block.rows[0].cells`,
`variantInstances[…]`) that assumes presence; an empty-axis/missing-variant case
can produce a runtime `undefined` TS would otherwise force you to guard. **Fix:**
enable it (at least for the plugin package) and fix the fallout.

**G2 · The four largest files have no direct test.** `MEDIUM`
`docFrame.ts` (~1275), `dom.ts` (~1518), `ui.ts` (~896), `measureSection.ts`
(~716) — exactly the Figma/DOM code where the 3.0 UI churn lives — are untested;
coverage floor is 45/40/50/45 (`vitest.config.ts`), so they can regress freely.
**Fix:** extract more pure logic from `docFrame`/`measureSection`; add jsdom tests
for the license/quota render branches.

**G3 · No integration test wiring auth + quota + view resolution.** `LOW`
`proxy.test.ts` covers helpers well, but `integration.test.ts` only exercises the
serialize→render→parse pipeline. The subtle license bugs (per git log) are
cross-function. **Fix:** add a matrix integration test:
`effectiveAuth → fetchQuota → resolveLicenseView → licenseStatusCopy` across
active/inactive/expired/unreachable.

**G4 · Repo-wide ESLint is `eslint-config-next`, applied to the plugin.** `LOW`
`eslint.config.mjs`: React/Next rules mean nothing for the plugin's main thread
and iframe DOM code, and there's no `no-floating-promises` against the Figma async
API (which B4/B12 would benefit from). **Fix:** add a plugin-scoped TS config
block.

### Test coverage matrix

| Module | Test | Notes |
|---|---|---|
| `brandColors.ts` | ✅ | thorough |
| `collectComponents.ts` | ⚠️ | only `isAtomComponentName` |
| `docFrame.ts` (~1275) | ❌ | largest file, untested |
| `docLink.ts` | ✅ | round-trip/registry/status |
| `exportFiles.ts` | ✅ | slugging/collisions/sidecars/zip |
| `fileKey.ts` | ✅ | |
| `fonts.ts` | ✅ | |
| `frameKit.ts` | ⚠️ | only radius/corner |
| `main.ts` | ❌ | Figma-bound |
| `measureSection.ts` (~716) | ❌ | only indirect via docModel |
| `messages.ts` | ❌ | types/constants |
| `serialize.ts` | ✅ | strong (+integration) |
| `statesSection.ts` | ⚠️ | only `matrixBandLayout` |
| `tokenResolve.ts` | ❌ | none |
| `ui/actions.ts` | ✅ | canGenerate/license norm |
| `ui/ai.ts` | ❌ | none |
| `ui/docModel.ts` | ✅ | extensive |
| `ui/dom.ts` (~1518) | ❌ | largest file, untested |
| `ui/fontPicker.ts` | ⚠️ | only `computeMenuPlacement` |
| `ui/modelMarkdown.ts` | ✅ | |
| `ui/proxy.ts` | ✅ | excellent (quota/license/copy) |
| `ui/render.ts` | ❌ | none |
| `ui/state.ts` | ✅ | |
| `ui/theme.ts` | ❌ | none |
| `ui/ui.ts` (~896) | ❌ | none |

---

## H. Dead code / cleanup

- `brandColors.ts:30-32` (`emptyBrandColors`), `54-60` (`resolveBrand`) — no
  production callers.
- `docLink.ts:93-95` (`removeDoc`) — unused; `main.ts:477/487` inlines the filter.
- `state.ts` phase machine (`nextStatus`, `reviewing`/`sent`) — largely vestigial;
  `renderPhase` only gates the hidden `extractBtn` (`render.ts:117-122`).
- `removeKeyLink` handler (`ui.ts:372-385`) lacks the double-click guard that
  `licenseActivateBtn` has (`ui.ts:328`) — minor, best-effort/idempotent.

---

## Suggested order of attack

1. **Release gate (A1–A3):** confirm the prod proxy domain, bump to 3.0.0, fix TESTING.md.
2. **Two HIGH functional bugs (B1, B2):** both are small, both hit common paths, B2 is amplified by the in-progress `render.ts` change.
3. **The MEDIUM correctness cluster (B3–B6, B9–B11):** drift mislabeling, selection race, in-flight guard, orphan cleanup, section-list sync.
4. **Server abuse (C3) + accessibility (D1)** as the next tier.
5. **Perf (F1–F2)** and **coverage/tooling (G1–G2)** as follow-through.
