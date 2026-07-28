# Light Theme Audit

Date: July 28, 2026

Viewport: native 480 × 680 CSS-pixel Figma plugin frame

## Overall verdict

Needs correction. A light token set exists, but the plugin does not consume it consistently. The design-system catalog uses the newer `--sl-*` semantic tokens while the existing plugin screens still use legacy `--*` variables, dark-mode literals, and scattered selector-specific overrides. This has created two light themes with different behavior.

## Steps

### 1. License

Health: Needs improvement

Evidence: `audit-light-license.png`

- The page remains readable, but canvas, rail, header, card, and field surfaces are too close in value.
- Muted text, disabled controls, rail icons, and the `Current` badge are too faint.
- The blue action is visually light and lacks the authority of the dark-theme action.

### 2. Library

Health: Broken

Evidence: `audit-light-library.png`

- Document names, the `Changes` heading, and change-group headings resolve to the inherited dark-theme foreground and become nearly invisible on light surfaces.
- The expanded row uses several almost-identical grays, so the structure is difficult to scan even where text remains visible.
- Status, timestamps, and supporting copy are too quiet for the density of the list.

### 3. Selected component

Health: Broken

Evidence: `audit-light-component.png`

- The selected component name inherits the dark-theme foreground and disappears on the light canvas.
- The remaining controls are readable, but section counters, rail icons, and AI badges are too subdued.
- The enabled AI surface is only slightly separated from the canvas.

### 4. Design-system catalog

Health: Mixed

Evidence: `audit-light-design-system.png`

- The newer semantic tokens produce a more coherent light hierarchy than the legacy plugin screens.
- The catalog still prints dark-theme hex values while light mode is active, which makes the token reference misleading.
- The catalog token system is not yet the token system used by the real prototype screens.

## Root cause

The base `body` color is computed from the dark `--text` value before the descendant `.light-theme` overrides exist. `.light-theme` changes `--text` but does not set `color: var(--text)`, so any element without a light-theme-specific color rule continues inheriting the dark foreground.

The larger architectural issue is token duplication:

- Existing screens use `--bg`, `--surface`, `--border`, `--text`, and component-level hard-coded colors.
- The catalog uses `--sl-color-*`.
- Light mode relies on a long list of selector overrides instead of one complete semantic mapping.

## Recommended correction

1. Make the semantic `--sl-color-*` layer the single source of truth.
2. Alias the legacy variables to semantic roles during migration.
3. Set the foreground explicitly on the themed app root.
4. Replace selector-specific light colors and remaining dark literals with semantic roles.
5. Strengthen light surfaces and borders:
   - canvas: `#F7F7F8`
   - rail/header: `#F0F1F2`
   - surface: `#FFFFFF`
   - subdued surface: `#F3F4F5`
   - border: `#D5D7DA`
   - strong border: `#B9BDC2`
6. Strengthen foreground roles:
   - primary text: `#1D1F22`
   - secondary text: `#5D6268`
   - quiet text: `#737980`
   - disabled text: `#9CA1A7`
7. Use a darker accessible blue for light surfaces and reserve pale blue for selected backgrounds.
8. Make the catalog display the active theme’s values rather than fixed dark-theme hex labels.

## Accessibility limits

This audit confirms visible contrast and hierarchy problems, but screenshots alone cannot establish WCAG compliance, keyboard focus order, screen-reader output, or contrast ratios for every state. Those require computed-color checks and interaction testing after the token migration.
