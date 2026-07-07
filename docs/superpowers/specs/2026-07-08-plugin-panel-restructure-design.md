# Plugin panel restructure — design

**Date:** 2026-07-08
**Branch:** plugin-2.0
**Scope:** `packages/plugin/src/ui/` (dom.ts, render.ts, ui.ts, actions.ts touch-ups) + affected tests

## Problem

The "Selected component" panel stacks per-section sub-options ("Anatomy as",
"Measure") and the "Variants to document" card *underneath* the two-column
section grid, disconnected from the checkboxes that trigger them. Each new
per-section option adds another orphaned row, and the panel doesn't scale.

## Approved design

### 1. Single-column section list with inline disclosure rows

- `#section-list` changes from a 2-column grid to a single column of
  section groups.
- Each group = the existing checkbox row, plus (for sections that have
  options) an options area nested directly beneath, indented past the
  checkbox (~22px).
- The options area is visible **only while the section is checked**.
- Expanded-row treatment is **quiet**: indent + hairline left rule
  (1px `--figma-color-border`), no box fill, no border wrap — visual weight
  stays on the section names (critique amendment #2).
- Moved inside their parent groups, keeping existing ids so `Refs` and
  wiring survive:
  - **Anatomy** → `#anatomy-view` radios ("Show as ◉ Diagram ○ Table ○ Both")
  - **Measurements** → `#measure-setup` checkboxes ("Height & width /
    Inner padding / Children & spacing")
- **States row**: detection hint becomes a muted `· none detected` suffix
  span (not a full label swap). When no state variants are detected the
  checkbox is **disabled and unchecked** (auto-restored to checked when a
  selection with states arrives) so the UI never accepts input it ignores
  (critique amendment #1). `renderStatesHint` owns this.

### 2. Variant picker → collapsed summary card

- Stays a standalone card below the section list (forward-compatible if
  variants later drive more than Tokens).
- **Collapsed by default**: header row `Variants to document · 1 of 36`
  + chevron; muted hint line "Applies to the Tokens section".
- Header is a real `<button aria-expanded aria-controls>` that toggles the
  body: the existing scrollable checkbox list + "Select all"
  (critique amendment #3).
- Shown whenever the extracted spec has `variantInstances` (no longer
  blinks with the Tokens checkbox).
- **Gated on Tokens** (critique amendment #1): when "Tokens used" is
  unchecked the card mutes (reduced opacity, body collapses) and the hint
  becomes an actionable link — "Turn on Tokens used to apply" — which
  checks the Tokens box.
- Live count in the header reuses `updateVariantCount`.
- Raise the expanded list max-height from 220px to ~300px.

### 3. Compact Write-with-AI card

- Title + ⓘ + switch on a single row; the explanatory hint paragraph moves
  entirely into the ⓘ disclosure (`#ai-info`).
- The `#ai-nokey` "Add your Anthropic API key…" line still renders beneath
  the row when no key is set; card-as-shortcut-to-Settings behavior kept.
- Card stays at the top of the panel (slot unchanged).

### 4. Accessibility wiring (critique amendment #3)

- Option-bearing section checkboxes get `aria-expanded` +
  `aria-controls="<options id>"`, updated on toggle.
- Variant-card header button gets `aria-expanded` + `aria-controls`.

### Unchanged

Tabs, sticky footer (Download / Create frame), banners, loader, Settings
tab, theming, extraction flow, doc model, main thread. No changes outside
`src/ui/` and tests.

## Implementation notes

- `dom.ts`: restructure `#section-list` markup generation (mount loop
  wraps each section in a `.sec-group`; Anatomy/Measurements groups embed
  the existing `#anatomy-view` / `#measure-setup` elements). New CSS for
  single column, indent + left rule, collapsed variant card, compact AI
  card. Delete the old standalone option-row placement. New refs:
  `variantToggle` (header button), `variantBody`, `variantHint`.
- `render.ts`: `renderVariantPicker` renders header count + collapsed
  state + Tokens gating; `renderStatesHint` handles disable/uncheck +
  suffix span; `updateVariantCount` also feeds the header.
- `ui.ts`: option visibility flips move from `display` toggling to the
  group expansion class; add variant header toggle listener; Tokens
  checkbox change re-renders the variant card; hint link checks Tokens.
- Radii tidy-up in touched CSS only: 6px controls, 10px cards.
- Tests: update DOM-structure assertions in `test/` (state/actions tests
  that query `.sec-row`, variant list, or option rows).

## Out of scope

- Moving the AI card below the section list (critique #4 — revisit later).
- Variant-list grouping/filtering of state variants.
- Any change to generated frames, extraction, or Settings.
