# Plugin UI vNext — design

Date: 2026-07-28
Branch: `plugin-ui-vnext` (stacked on `foundations-1.0`)

## Goal

Migrate the Figma plugin's UI to the approved vNext direction: a five-workflow
side rail, a utility header carrying search and the AI writing allowance, and a
token-driven design system that theme-switches without per-component overrides.

Product behavior does not change except where this document says it does. The
existing message protocol, extraction, document creation, library, quota,
license, and theme logic are the source of truth and stay as they are.

## Background

Three artifacts describe the target, and they do not fully agree:

1. `docs/plugin-ui-vnext/*.md` — the written direction, workflows, state matrix,
   integration plan, and acceptance checklist.
2. `docs/plugin-ui-vnext/design-system/` — a clean `sl-` prefixed CSS port with
   semantic tokens and a proper `body[data-theme]` light theme.
3. `docs/plugin-ui-vnext/prototype/` — the React prototype that actually
   rendered every approved screenshot, archived on 2026-07-28 from an ephemeral
   scratch directory.

The critical fact: (2) and (3) share **zero class names**. The prototype is
3,406 lines of unprefixed CSS whose light theme is ~500 lines of
`.light-theme .x` per-component patches. The `sl-` package is a hand-authored
rewrite that has never rendered a real screen. The approved screenshots
therefore express intent, not a verified rendering of the CSS we are shipping.

## Decisions

| Decision | Choice |
|---|---|
| CSS source of truth | The `sl-` design system. Screenshots are intent; each screen is visually verified against them. The archived prototype CSS is the escape hatch for any pattern that proves hard. |
| Foundation mode selection | Keep it. Mode checkboxes still appear only for collections with more than `MAX_MODE_COLUMNS` (4) modes, restyled. |
| AI colour-group descriptions | Replace the bespoke switch with the shared `AI writing` switch from the component screen. |
| Quick search | Build the command palette as prototyped. `Help & feedback` is deferred. |
| Migration structure | Parallel build behind a build-time flag, legacy path deleted at the end. |
| Framework | No React. The framework-free split is preserved. |

### Rationale for the two non-obvious ones

**Foundation modes.** `workflows.md` says to remove mode subsections, but the
control is not decoration: it is the only way to choose which four modes become
frame columns. The prototype's mock data tops out at four modes, so it never
rendered the case — the omission reads as an accident, not a decision. Removing
it would silently drop modes from any 5+ mode collection and strand saved
mode-specific configuration in `FoundationSelection`.

**AI descriptions.** `workflows.md` says descriptions should happen
automatically with no user-facing switch, but the current control is default-off
precisely because it spends a generation from the free allowance. Using the
shared `AI writing` switch removes the one-off control the direction objects to
while keeping the spend visible and consensual.

## Architecture

Untouched: `actions.ts`, `messages.ts`, `docModel.ts`, `foundationState.ts`,
`theme.ts`, `proxy.ts`, `docLink.ts`.

New structure under `packages/plugin/src/ui/`:

```
design-system/   tokens.css, components.css, patterns.css
shell/           shell.ts, header.ts, sidebar.ts, palette.ts
screens/         component.ts, foundations.ts, library.ts, settings.ts, license.ts
viewModel/       contracts.ts, allowance.ts, libraryRow.ts, componentScreen.ts,
                 foundationScreen.ts, licenseView.ts
```

`viewModel/contracts.ts` is the copy of
`docs/plugin-ui-vnext/design-system/contracts.ts` that ships with the plugin. It
carries the presentation types and `assertNever`, and becomes the maintained
version; the copy under `docs/` stays as the handoff record.

### The view-model layer

Each `viewModel/` module is a pure function from existing domain state to a
contract in `docs/plugin-ui-vnext/design-system/contracts.ts`. No DOM, no
messages, no I/O. Screens take a view model and produce DOM.

This is what makes the state matrix testable without rendering tests, and it is
where `changeGroups: null` — content-hash drift with no reliable itemization —
is enforced rather than hoped for. `licenseView.ts` wraps the existing
`resolveLicenseView` and `licenseStatusCopy` in `proxy.ts` rather than
reimplementing them.

Every discriminated union is exhausted with `assertNever`, so a missed variant
is a compile error instead of a blank panel.

### CSS delivery

`build.mjs` reads the three files from disk and embeds them in a `<style>`
block in the order `index.css` documents. The TypeScript never imports CSS,
which sidesteps the fact that esbuild's text loader and Vite disagree about
what `import x from './a.css'` returns — the same disagreement would otherwise
surface as a broken test run. One token source; no second copy to drift.

**The embed is gated on the build actually rendering the new shell.** These are
not only `sl-` prefixed rules: `components.css` opens with a global reset over
`*`, `html, body`, `button, input, select, textarea`, and `[hidden]`, and
`tokens.css` sets `:root` and `body[data-theme]` rules that the legacy UI also
sets. Shipping them in a plain build measurably restyled the legacy UI, growing
its tab buttons from 79x38 to 85x45 and changing their font. A plain build now
contains no `--sl-` anything. The harness always gets the CSS; `ui.html` gets it
only when `ui.html` is the shell.

The legacy UI keeps its `--figma-color-*` palette untouched. Because the two
UIs never render together under the flag approach, there is no half-migrated
state to reconcile and no reason to alias one palette onto the other.

### The flag

`UI_VNEXT=1` selects a different **entry point**, rather than branching inside a
shared module. `build.mjs` bundles `src/ui/ui-vnext.ts` instead of
`src/ui/ui.ts`, so the legacy module is not in the vNext bundle at all and the
two can never both run. `ui.ts` is untouched by this migration.

This was learned the hard way. The first attempt did branch inside `ui.ts`, and
the flag was inert: `mountShell()` wrote the shell into `document.body`, and the
legacy `mount()` on the next line overwrote it. A flagged build rendered the
legacy UI with no shell in the DOM, and the tests passed because they grepped
the bundle for strings rather than checking what survived boot.

The default stays legacy through PR 6, flips in PR 7, and the legacy entry point
is deleted in PR 8. Screens are wired into `ui-vnext.ts` as their plans land.

### Frame size

The frame becomes 480 x 680. No resize handle is added — `figma.ui.resize` is
not used today. The acceptance checklist's "usable at 420px" item is amended to
"CSS does not break at 420px", which is a styling constraint rather than a
shipped capability.

## Screens

**Generate component docs.** Presentation-only changes over the existing flow
(`ALL_SECTIONS`, `GROUPS`, `DEFAULT_OFF_SECTIONS`, `anatomyView`/`measureViews`,
`runAutoExtract`, `runCreateDocFrame`, `detectStateMatrix`, the shared build
lock, the quota-exhaustion fallback): `Write with AI` becomes the `AI writing`
switch with `role="switch"`, anatomy radios become a segmented control,
measurement checkboxes become `aria-pressed` chips, group headers gain
`{included} of {total} included`, `Create frame` becomes `Create docs`, and
Download appears only after a successful create or for an existing downloadable
document.

**Foundation documents.** Flat rows on the shared inclusion checkbox; a bulk
control using native `indeterminate`; `Create {count} frames`, or
`Select sources to continue` when nothing is selected. Mode selection survives
for >4-mode collections. The shared `AI writing` switch drives group
descriptions. `FoundationSelection`, `planFoundationUnits`, `folderOf`,
`groupTitles`, progress, and partial-failure reporting are unchanged.

**Library.** `LibraryEntry`, `DocSourceIntent`, registry parsing, and hash
comparison are unchanged. Rendering splits into `renderLibraryFilters`,
`renderLibraryRow`, `renderLibraryChanges`, `renderLibraryMenu`, and
`renderLibraryFooter`, fed by `viewModel/libraryRow.ts`. The palette provides
search, so there is no second search field. The overflow menu keeps every real
action, with destructive ones after a separator.

**Settings.** Keeps `BrandTheme`, `THEME_PRESETS`, `resolveTheme`, the font
picker, colour validation, and logo capture. Loses the plugin-theme and AI
blocks.

**License.** Renders all twelve states from `resolveLicenseView`. A network
failure never presents as an expiry.

## Resolved drift

| Conflict | Resolution |
|---|---|
| Foundations toolbar: spec wants `{selected} of {total} included`; prototype shows only `Clear all` | Follow the spec |
| Prototype's `SELECTED COMPONENT` eyebrow | Drop it; the direction removed component captions |
| Palette subtitles Settings as "Output, AI, and appearance" | Correct to "Generated frame appearance" |
| Current atom notice has no home in the spec | Keep it as a quiet `sl-banner` above the sections; it is real information about the selection |
| Current `AI works on the free plan. No key needed.` | Drop it; the always-visible header allowance makes it redundant |
| Library update count on the rail | Already contracted as `NavigationItem.badge`; keep |

## Verification

**Automated.** Exhaustive pure-function tests over `viewModel/`, one case per
state-matrix row. The existing 24 test files stay green; none of them touch
markup, which is why they are safe from the migration and also why they will
catch nothing about it.

**Visual.** A dev harness, `ui-harness.html`, mounts the UI and feeds it canned
`MainToUi` messages. Any screen in any state can be opened at 480 x 680 and
compared against the matching archived screenshot in both themes without
launching Figma. This is the control for the risk that the `sl-` CSS has never
rendered these screens.

The harness is a development artifact. `build.mjs` emits it only outside
production builds, `manifest.json` does not reference it, and it must never be
the file the plugin loads.

**Manual.** The acceptance checklist's Figma pass, run per PR against the slice
that changed: nested selection resolution, frame create and replace, library
focus/update/detach, theme following, keyboard order, and screen-reader names.

## PR sequence

| # | Content | Flag |
|---|---|---|
| 1 | Build plumbing: CSS text loader, design-system files, `__UI_VNEXT__`, dev harness | legacy |
| 2 | Shell: rail, utility header, allowance control, theme button, screen scaffold | legacy |
| 3 | Generate component docs | legacy |
| 4 | Foundation documents | legacy |
| 5 | Library | legacy |
| 6 | Settings and License | legacy |
| 7 | Command palette, accessibility pass, flip default to vNext | vNext |
| 8 | Delete legacy UI, update `TESTING.md` | vNext |

Users do not see the new UI until PR 7 — the same as a rewrite. What the flag
buys is that every PR is separately reviewable and testable, and that old and
new can be compared on the same Figma file while judging fidelity.

Version bump and Community listing assets are a separate follow-up.

## Out of scope

- `Help & feedback` rail item.
- A resize handle.
- Any change to extraction, frame generation, the proxy, or the message
  protocol.
- Merging to `main`. This branch stacks on the unmerged `foundations-1.0`.
