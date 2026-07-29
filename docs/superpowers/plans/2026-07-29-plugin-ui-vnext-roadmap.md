# Plugin UI vNext — roadmap for every page and function

Date: 2026-07-29
Branch: `foundations-1.0`
Spec: `docs/superpowers/specs/2026-07-28-plugin-ui-vnext-design.md`

This is the inventory and ordering document. Each numbered phase below gets its
own execution-ready plan, written when its dependencies exist. Phase 1 is
written already: `2026-07-29-plugin-ui-vnext-decoupling.md`.

## Where we actually are

Landed and verified:

- The design system, embedded only in builds that render the new shell.
- The shell: rail, utility header, allowance control, theme, dev harness.
- `Generate component docs`, partially: sections, groups, AI switch, anatomy
  segmented control, measurement chips, `Create docs`.
- Phase 1 action decoupling: shared presenters, value-based selections,
  source actions, and a Foundation host with legacy adapters.

Not landed: four of five screens, and several functions inside the one screen
that exists. The plugin is not usable on the new UI yet.

## The blocker that governs the order

The legacy UI keeps user choices **in its DOM**, and `actions.ts` reads them
from there. `assembleDoc` read section selection out of `refs.sectionChecks`;
`onFoundationCheckboxChange` reads and writes foundation rows the same way.
A second UI cannot drive any of it: its controls feed nothing.

The component screen forced the fix for one path. The pattern is proven:

- Selection becomes a **value** passed in (`DocSelection`).
- Status becomes an **interface** (`BuildPresenter`).
- The legacy entry keeps its behavior through a thin adapter.

Every remaining screen hits the same wall. Doing that decoupling once, up
front, is Phase 1. Skipping it means each screen either duplicates logic or
shims fake DOM nodes.

### Remaining legacy-only `Refs` path

| Function | File | Used by |
|---|---|---|
| `runExtract` | actions.ts:133 | legacy only. The vNext screen extracts through `autoExtract`, so this one is not decoupled; it dies with the legacy UI in Phase 8 |

`runAutoExtract`, `runDownload`, `runUpdateFromSource`,
`runDownloadFromSource`, and `onFoundationCheckboxChange` now remain only as
thin legacy adapters. Their reusable actions take state, selections, source
values, presenters, or `FoundationChange` values instead of reading `Refs`.
Foundation repaint, busy state, and progress flow through `FoundationHost`.

All twelve renderers in `render.ts` are also `Refs`-bound, but those are legacy
presentation and get **replaced**, not decoupled. They die in Phase 8.

### Already pure, reuse as-is

`foundationState.ts` is entirely pure: `summarize`, `defaultSelection`,
`toggleCollection`, `toggleMode`, `toggleTextStyles`, `canGenerate`,
`emptyStateLines`, `frameCount`, `framesPerSource`, `selectAll`, `clearAll`,
`allSelected`, `fileSummary`, `collectionMeta`, `textStyleMeta`,
`createButtonLabel`, `hasColorGroups`, `groupBriefs`. The Foundations screen is
mostly a rendering job because of this.

`proxy.ts` gives `resolveLicenseView`, `licenseStatusCopy`, `quotaMeterModel`,
`formatResetDate`, `activationErrorCopy`, `isQuotaExhausted`.

---

## Phase 1 — Decouple the remaining actions

**Plan: `2026-07-29-plugin-ui-vnext-decoupling.md` (written).**

**Completed 2026-07-29.** The shared action layer is now drivable without the
legacy DOM, while the default build and legacy adapters preserve existing
behavior. This gates every phase below.

---

## Phase 2 — Finish `Generate component docs`

The screen exists but is incomplete. Known gaps, all real:

| Gap | Consequence today |
|---|---|
| Variant token picking absent | `build()` passes an empty `variantIds`, so per-variant token tables never appear. Legacy has this. |
| `Download` renders but is inert | The button appears after a successful create and does nothing. |
| Atom notice missing | The "this is an atom" guidance the legacy UI shows is gone. Spec said keep it as a quiet banner. |
| States hint missing | `renderStatesHint` has no vNext equivalent. |
| Group bulk action missing | `sectionIdsInGroup` exists and is unused; group headers cannot select or clear their rows. |
| Reading state unverified | The `reading` state paints, but only against canned harness data. |
| `Content Considerations` label | Title case, violating the sentence-case rule. Changing it changes generated frame headings, so it needs a deliberate call. |

New: `viewModel/componentFacts.ts` and `viewModel/operationGate.ts`, plus
additions to `screens/component.ts`.

**Completed 2026-07-29.** The vNext component workflow now derives selection
facts without touching the legacy DOM, supports per-variant token selection,
atom and state guidance, group bulk controls, working downloads, accurate
reading/download states, and AI fallback warnings. Component operations defer
selection changes until they finish, preventing an async build from mixing two
components. The legacy UI remains the default build.

---

## Phase 3 — Foundation documents

Cheapest screen, because `foundationState.ts` is already pure.

- Flat rows on the shared inclusion checkbox; no collapsible rows.
- Bulk control with native `indeterminate` for the mixed state.
- `Create {count} frames` from `createButtonLabel`, or
  `Select sources to continue` when nothing is selected.
- **Mode selection stays** for collections with more than four modes, as
  decided. `toggleMode` and `MAX_MODE_COLUMNS` already implement it.
- The shared `AI writing` switch drives group descriptions, replacing the
  bespoke checkbox.
- States from the matrix: reading, ready, empty, read failed, generating with
  progress, partial failure, success.

New: `screens/foundations.ts`, `viewModel/foundationScreen.ts`.
Depends on: Phase 1 (`onFoundation*` decoupling).

---

## Phase 4 — Library

Largest screen, and the one with the most honesty requirements.

- Filters as segmented controls with counts contained in the tabs:
  All / Updates / In sync.
- Rows: name, source path, status, age, overflow menu.
- Five statuses already in the code: `checking`, `inSync`, `updateAvailable`,
  `edited`, `orphaned`.
- Clicking row identity focuses the frame in Figma.
- `Update available` rows disclose `Changes`, with the **honest fallback**
  when a detailed comparison is not available. `changeGroups: null` must never
  render as an empty or failed comparison.
- Overflow actions, varying by row state: review/hide changes, update, open
  frame, view source, download Markdown, reconnect, detach, remove. Destructive
  ones after a separator, focus returned to the trigger on close.
- Footer: `Refresh library` and `Update all {count}`.
- Rail badge for the update count. `NavigationItem.badge` is contracted but the
  shell hardcodes `{}` and has no updater; that API has to be added.

New: `screens/library.ts`, `viewModel/libraryRow.ts`, and a menu primitive.
Depends on: Phase 1 (`runUpdateFromSource`, `runDownloadFromSource`).

---

## Phase 5 — Settings

- Frame theme presets: Default, Editorial, Tech, Warm, Custom.
- Custom reveals header background, accent, body text, table header, heading
  font, body font.
- Logo: use selected node, replace, remove, plus success and error states.
- Keeps `BrandTheme`, `THEME_PRESETS`, `resolveTheme`, `matchPreset`,
  `parseBrandHex`, `createFontPicker`, `CornerStyle`.
- Loses the plugin-theme and AI blocks; the theme control lives in the header.

New: `screens/settings.ts`. The font picker is reusable but was written against
legacy markup, so expect to adapt it.

---

## Phase 6 — License

**Known gap: the code models fewer states than the spec requires.**
`LicenseView` is `'none' | 'pro' | 'inactive' | 'unknown'` — four values. The
state matrix specifies twelve: free, checking, pro, expired, inactive, unknown,
invalid, disabled, device-limit, unreachable, removing, removed. The extra
detail exists as `quota.licenseReason` and activation errors, so the screen's
view model has to combine `LicenseView` with the reason to reach twelve. That
combination does not exist yet and is the real work of this phase.

- Free: plan card, Current badge, usage with reset date and progress,
  `Upgrade to Pro`, activation form.
- Pro: Active badge, unlimited, manage subscription, masked key, remove key.
- A network failure must never present as an expiry.

New: `screens/license.ts`, `viewModel/licenseScreen.ts`.

---

## Phase 7 — Command palette, accessibility, flag flip

- ⌘K palette: navigate workflows and jump to library items, keyboard nav,
  focus trap, focus restore. It is what makes the fixed header search slot
  coherent.
- Full accessibility pass against the acceptance checklist: keyboard order,
  screen-reader names, focus visibility, reduced motion.
- Flip the default build to vNext.

Depends on: Phase 4, since the palette searches library items.

---

## Phase 8 — Delete the legacy UI

- Remove `dom.ts`, the legacy half of `ui.ts`, `render.ts`, and the `Refs`
  interface.
- Remove the legacy adapters added in Phase 1 once nothing calls them.
- Update `packages/plugin/TESTING.md`.
- Version bump and Community listing assets, handled separately.

---

## Cross-cutting work that has no natural home

| Item | Where it should land |
|---|---|
| Rail badge updater (`setRailBadge`) | Phase 4, first consumer |
| `Help & feedback` rail item | Deferred by decision; revisit after Phase 7 |
| Resize handle / 420px | Out of scope by decision; checklist item amended |
| `sl-` CSS gaps found only by rendering | Every phase. Two already found: switch track had no `display`, checkbox glyph had no checked-state rule |

## Risks worth stating plainly

1. **The CSS has still never rendered four of five screens.** Two real bugs
   surfaced the moment real markup met it, and neither was visible by reading.
   Every phase must render and measure, not review.
2. **The Figma bridge is untested end to end.** The harness paints canned
   state; it cannot exercise selection, extraction, or frame creation. Only a
   manual Figma pass proves those.
3. **Legacy stays shipped until Phase 7.** Every phase must leave the default
   build on the legacy UI and keep its tests green.
4. **License needs product decisions**, not just code: twelve states with
   distinct copy and recovery actions, from a model with four.

## Suggested order

Phase 1 gates everything. Then 2 and 3 in either order — both are small and
build confidence. Phase 4 is the big one. Phase 6 needs a product conversation
before it can be planned properly. 7 and 8 close it out.
