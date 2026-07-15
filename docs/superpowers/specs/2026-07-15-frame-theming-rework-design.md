# Frame theming rework — design

**Date:** 2026-07-15
**Branch:** plugin-3.0
**Status:** Approved

## Goal

Make the Guidelines-frame theming user friendly and give themes real personality.
Presets should set everything (colors, fonts, corner style), the default theme
becomes monochrome with a blue accent, and the font pickers become proper
searchable dropdowns that only offer fonts that will actually work.

## Decisions (user-confirmed)

1. **UI structure:** presets-first, with the per-field customize controls
   visible below (not collapsed, not removed).
2. **Corner radius:** preset-driven only. No separate user control.
3. **Preset lineup:** "personality set" (Default, Editorial, Tech, Warm).
4. **Font pickers:** hide incompatible fonts entirely. Everything listed has
   Regular, Medium, and Bold.

## 1. Theme model

`BrandTheme` (in `packages/plugin/src/brandColors.ts`) gains one field:

```ts
export type CornerStyle = 'sharp' | 'soft' | 'round';

interface BrandTheme {
  headerBg: string | null;
  accent: string | null;
  bodyText: string | null;
  tableHeadBg: string | null;
  headingFont: string | null;
  bodyFont: string | null;
  cornerStyle: CornerStyle | null; // null resolves to 'soft' (today's look)
}
```

- `resolveTheme` returns `cornerStyle: stored?.cornerStyle ?? 'soft'`.
- Migration is free: `migrateBrandColors` already spreads stored values over
  `emptyBrandTheme()`, so legacy themes load with `cornerStyle: null`.
- `emptyBrandTheme()` adds `cornerStyle: null`.

### Presets

Every preset specifies **all** fields. Values below are the starting point;
exact hexes may be tuned during visual QA in Figma without a spec change.

| Preset | headerBg | accent | bodyText | tableHeadBg | headingFont | bodyFont | cornerStyle |
|---|---|---|---|---|---|---|---|
| Default | `#0f172a` | `#2563eb` | `#334155` | `#f8fafc` | Inter | Inter | soft |
| Editorial | `#1c1917` | `#b45309` | `#3f3a36` | `#faf9f7` | Lora | Inter | sharp |
| Tech | `#1e293b` | `#6366f1` | `#334155` | `#f6f7fb` | Space Grotesk | Inter | round |
| Warm | `#2b1b3d` | `#e879a6` | `#3d3450` | `#faf8fb` | DM Sans | Inter | soft |

- The Default preset stores concrete values equal to the defaults (it no
  longer needs to be `emptyBrandTheme()`; either representation resolves the
  same, but concrete values make active-preset detection uniform).
- `DEFAULT_HEADER_BG` becomes `#0f172a`, `DEFAULT_ACCENT` becomes `#2563eb`,
  so blank fields and legacy saved themes land on the new monochrome/blue
  default automatically. `DEFAULT_BODY_TEXT` / `DEFAULT_TABLE_HEAD_BG` are
  unchanged.
- Lora, Space Grotesk, and DM Sans are Google Fonts available in Figma by
  default. The existing build-time fallback to Inter (`tryFamily` in
  `docFrame.ts`) stays as the safety net if a font is missing.

### Active-preset detection

A pure helper `matchPreset(theme: BrandTheme): string | null` deep-compares
the stored theme against each preset's **resolved** values (so `null` fields
and concrete-default fields compare equal) and returns the preset name or
`null` (= custom). Used by the renderer to highlight the active card; editing
any field below naturally deselects.

## 2. Corner style in the frame builder

`packages/plugin/src/frameKit.ts` gets, alongside `setFontFamilies`:

```ts
export function setCornerStyle(style: CornerStyle): void; // reset every build
export function radius(base: number): number;
```

Mapping: `sharp` → 0, `soft` → base (today's values), `round` →
`Math.round(base * 1.75)`.

All hardcoded `cornerRadius` assignments in `docFrame.ts` and `frameKit.ts`
route through `radius(base)`:

- `docFrame.ts`: outer frame 16, cards 8 and 12, tables 8, chips 3 and 6,
  rule 2, dot 3.
- `frameKit.ts`: slot 8.
- **Exception:** the circular state badge (`badge.cornerRadius = size / 2`)
  stays a circle in every corner style.

`buildDocFrames` calls `setCornerStyle(theme.cornerStyle)` next to
`setFontFamilies`, every build, so state never leaks between builds.

## 3. Settings UI — presets-first

The "Frame theme" settings group is restructured:

1. **Preset cards** (2×2 grid) at the top. Each card shows:
   - preset name,
   - a mini palette preview (header-color band with an accent-color dot),
   - a small "Ag" specimen using an approximate CSS font stack (generic
     `serif` for Lora, a geometric-sans stack for Space Grotesk, etc. — the
     iframe cannot load Figma's fonts, approximation is fine),
   - the card's own `border-radius` mirrors its corner style (sharp card has
     square corners, round card is visibly rounder).
   - Active preset (via `matchPreset`) gets a highlighted border. No card is
     highlighted when the theme is custom.
   - Clicking a card applies a **clone** of the full preset theme.
2. **Customize** subheading below, containing the existing controls:
   - four color rows (hex input + swatch), unchanged behavior,
   - the two new font comboboxes (section 4),
   - logo capture row,
   - "Reset to defaults" link (resets to the empty theme, i.e. Default).
3. Hint copy rewritten for the new model, plain tone, no em dashes (per
   `docs/plugin-voice-and-copy.md`): e.g. "Pick a theme, or adjust any value
   below." The old "Fonts need Regular, Medium, and Bold styles" warning is
   dropped from the default view because the picker now guarantees it; a
   fallback note appears only for free-typed unknown fonts (section 4).

## 4. Font comboboxes

Replace the `<input list>` + `<datalist>` with a custom combobox built in
the plugin UI (no dependencies). One reusable component, two instances
(heading font, body font).

Behavior:

- Closed state looks like the existing text inputs and shows the current
  value (placeholder "Inter" when unset).
- Click or typing opens a dropdown panel anchored below the input:
  - "Default (Inter)" pinned at the top as the clear action,
  - scrollable list of compatible families, filtered live by the input text
    (case-insensitive substring),
  - keyboard: ArrowUp/ArrowDown move the highlight, Enter selects, Esc
    closes, Tab/click-outside closes and commits,
  - mouse: click selects.
- Selecting commits via the existing `applyBrandFont` path (empty → null).
- **Free-text escape hatch:** a typed value not in the list can still be
  committed (Enter or blur), but an inline hint appears: "This font may not
  have Regular, Medium, and Bold styles. The frame will fall back to Inter
  if it doesn't." (exact copy follows plugin voice rules).
- If the `fontList` message never arrives (main-thread failure), the input
  degrades to plain free text, same as today.

Main thread (`main.ts`, `requestFonts` handler): filter
`figma.listAvailableFontsAsync()` results to families whose style set
contains all of `Regular`, `Medium`, `Bold` before posting `fontList`. The
filter is a pure exported function (`familiesWithRequiredStyles(fonts)`) so
it is unit-testable. Message shape (`{ type: 'fontList'; families: string[] }`)
is unchanged.

## 5. Out of scope

- Rendering font previews in the actual typeface (would require loading
  webfonts into the plugin iframe).
- A user-facing corner-radius control.
- Any new persisted-settings shape beyond the one `cornerStyle` field.
- Changes to the docs app or landing page.

## Testing

Unit (extend `test/brandColors.test.ts`, new test files as needed):

- every preset specifies every field (no nulls),
- `resolveTheme` defaults `cornerStyle` to `soft`,
- legacy `{ headerBg, accent }` migration still works and yields
  `cornerStyle: null`,
- `matchPreset` identifies each preset, returns null after any field edit,
  and treats null-vs-concrete-default as equal,
- radius mapping: sharp/soft/round over the base values used in docFrame,
- `familiesWithRequiredStyles` filters correctly (missing Bold, missing
  Medium, extra styles, duplicate family entries),
- combobox filter logic (pure function): substring match, case-insensitive,
  pinned default entry.

Visual QA (manual, in Figma): generate a Guidelines frame with each of the
four presets, screenshot, and tune hex values / radii until they look sleek;
verify a custom theme (edited field) renders and that no preset card is
highlighted for it.
