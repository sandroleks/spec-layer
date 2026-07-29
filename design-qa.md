# Plugin UI vNext — Design QA

## Comparison target

- Source visual truth: `/var/folders/5y/xjxr2sfx789g4dvc14fmgks80000gn/T/codex-clipboard-7aa0234f-32b3-4419-8c2a-f612cd292192.png`
- Normalized source: `docs/plugin-ui-vnext/component-screen-reference-normalized-qa.png`
- Rendered implementation: `docs/plugin-ui-vnext/component-screen-production-final-qa.png`
- Side-by-side evidence: `docs/plugin-ui-vnext/component-screen-final-comparison-qa.png`
- Local implementation: `http://127.0.0.1:4189/ui-harness.html?view=component&state=ready&facts=states&expand=a11y&allowance=normal&theme=dark`
- State: selected `buttonPrimary`, dark theme, AI writing on, Usage and Specifications collapsed, Accessibility expanded, ready to create.

## Normalization

- Source pixels: 974 × 1378.
- The source contains a 2× 480 × 680 plugin capture plus surrounding window pixels. It was cropped to the 960 × 1360 plugin region and downsampled to 480 × 680.
- Implementation pixels: 480 × 680.
- CSS viewport: 480 × 680.
- Effective density used for comparison: 1 CSS pixel to 1 output pixel after source normalization.
- The remaining two-pixel right-edge difference belongs to the source window frame/crop, not the plugin layout.

## Full-view comparison evidence

The final side-by-side comparison preserves both screens at their original 480 × 680 comparison size. The selected-component eyebrow, 20px component title, AI card, section intro, 14px group inset, 41px group headers, 36px rows, outlined AI badges, navigation rail, 56px footer, and 30px primary action now align with the source composition. The implementation has no horizontal overflow (`clientWidth` and `scrollWidth` are both 428px; `overflow-x` is `hidden`) and produced no browser console errors.

No separate focused crop was needed: the equal-density side-by-side artifact retains every source and implementation pixel, and the header, controls, row labels, badges, and footer remain legible at 1:1. Those regions were also reviewed individually while measuring their computed boxes.

## Required fidelity surfaces

- Fonts and typography: Inter/system fallback stack matches; component title is 20px/690 with source letter spacing; header utility, eyebrow, group, count, row, badge, and CTA sizes were restored to the prototype values. No unintended wraps or truncation are visible.
- Spacing and layout rhythm: the double horizontal inset and 24px row indentation are removed. Header is 67px, AI control is 402 × 44 at x=66, footer is 56px, and CTA is 118 × 30. Group and row rhythm matches the reference.
- Colors and visual tokens: canvas, chrome, border, muted text, selected surface, accent blue, checkbox, and badge treatments use the existing production tokens and visibly match the source.
- Image and asset fidelity: there are no raster illustrations or product images in this screen. Visible icons use the shared Tabler-style source paths; no placeholder assets are present.
- Copy and content: selected-component labels and sentence casing match. The local allowance fixture says “8 of 10” instead of the screenshot’s “4 of 5,” and the library badge is data-dependent; these do not change layout and are expected runtime-content differences.

## Comparison history

### Iteration 0 — blocked

- [P1] Content had nested horizontal padding: the AI card started around 28px into the main panel and section rows added another 24px.
- [P1] Selected-component hierarchy drifted: eyebrow and 20px title were missing.
- [P1] Group anatomy drifted: semantic icons were absent and visible Select/Clear controls displaced counts and chevrons.
- [P1] AI control anatomy was reversed: the toggle sat beside the label while help was pushed to the far edge.
- [P2] Accessibility defaulted to 1 of 3 instead of 3 of 3.
- [P2] AI badges were filled pills instead of compact outlined rectangles.
- [P2] Footer action was 34px high and iconless; horizontal overflow exposed a bottom scrollbar.

Fixes: restored the archived component-screen structure and exact spacing values, made Related components the only default-off section, removed visible group bulk controls, added semantic group/footer icons, restored sentence casing, hid x-overflow, and aligned shell/header/footer/sidebar proportions.

### Iteration 1 — blocked

Evidence: `docs/plugin-ui-vnext/component-screen-production-qa.png`

- [P2] Bottom rail lacked Help & feedback and therefore sat too low relative to the source.
- [P2] Dark mode showed the moon/current-theme icon instead of the source’s sun/switch-target icon.
- [P2] Header search and allowance copy retained larger generic type sizes.

Fixes: restored the bottom utility divider and Help item, made the theme icon represent the destination theme, and applied the prototype’s header utility type sizes.

### Iteration 2 — passed

Evidence: `docs/plugin-ui-vnext/component-screen-final-comparison-qa.png`

Post-fix evidence shows no actionable P0, P1, or P2 mismatch. Residual runtime-copy and host-frame differences are expected and do not affect component layout.

## Findings

No actionable P0/P1/P2 findings remain.

## Open questions

- Help & feedback is intentionally visual-only in this phase because the approved selected-component layout includes it but the production help destination is not yet implemented.

## Implementation checklist

- [x] Match selected-component header hierarchy.
- [x] Remove nested horizontal padding and row indentation.
- [x] Restore AI control anatomy and switch sizing.
- [x] Restore group icons, counts, chevrons, and section defaults.
- [x] Match row typography, dividers, badges, and casing.
- [x] Match header, rail, footer, and CTA geometry.
- [x] Eliminate horizontal overflow.
- [x] Verify at 480 × 680 with same theme and expanded state.
- [x] Check browser console errors.

## Follow-up polish

- [P3] Add the live Library count to the new shell when the host exposes that data.
- [P3] Wire Help & feedback when that workflow is implemented.

---

# Foundation Documents Screen

## Comparison target

- Source visual truth (dark): `docs/plugin-ui-vnext/prototype/foundation-selection-after.png`
- Source visual truth (light): `docs/plugin-ui-vnext/prototype/light-theme-foundations-final-v2.png`
- Rendered implementation (dark): `docs/plugin-ui-vnext/prototype/implementation-foundations-vnext.png`
- Rendered implementation (light): `docs/plugin-ui-vnext/prototype/implementation-foundations-vnext-light.png`
- Side-by-side evidence: `docs/plugin-ui-vnext/prototype/qa-foundations-vnext-comparison.png` and `docs/plugin-ui-vnext/prototype/qa-foundations-vnext-light-comparison.png`
- Local implementation: `http://127.0.0.1:4189/ui-harness.html?view=foundations&state=ready&selection=all`
- State: all five sources included, nine generated frames, ready to create.

## Normalization

- Source pixels: 480 × 680 in both themes.
- Implementation pixels: 480 × 680 in both themes.
- CSS viewport: 480 × 680.
- Density: 1 CSS pixel to 1 output pixel; no crop or resampling.

## Full-view and focused comparison evidence

The equal-density side-by-side artifacts preserve every pixel and keep all five
rows, their secondary metadata, the bulk control, and footer action legible.
No separate focused crop was needed. The 48px header, 38px toolbar, 54px rows,
14px horizontal row margin, 56px footer, and full-width 30px primary action
align with the source in dark and light themes.

The implementation has no horizontal overflow (`clientWidth` and `scrollWidth`
are both 428px for the main screen) and produced no browser warnings or errors.
The select-all control, individual Foundation source toggle, frame-count update,
mixed state, clear-all state, and disabled zero-selection action were exercised.

## Required fidelity surfaces

- Fonts and typography: heading, toolbar, row title, secondary metadata, and CTA
  use the source hierarchy, weights, and sizes without wrapping or truncation.
- Spacing and layout rhythm: header, toolbar, row cadence, divider insets, rail,
  and footer geometry match at the native viewport.
- Colors and visual tokens: dark/light canvas, chrome, borders, accent blue,
  muted text, success-green source icons, hover states, and disabled action use
  the production token set and visibly align with the references.
- Image and asset fidelity: the screen has no raster imagery. The source icon is
  the shared official Tabler puzzle path, not a handcrafted substitute.
- Copy and content: flat-source labels, count copy, `+ 5 frames` metadata,
  Select/Clear all labels, and `Create 9 frames` match the prototype.

## Comparison history

### Iteration 0 — blocked

- [P2] The harness fixture planned one frame for the large Foundation collection,
  so the row omitted the split and the CTA said `Create 5 frames`.
- [P2] The runtime metadata used the older `splits into 5 frames` copy instead of
  the approved compact `+ 5 frames` treatment.

Fixes: modeled the five real top-level Foundation groups in the harness and
updated the shared frame metadata copy.

### Iteration 1 — passed

Evidence: `docs/plugin-ui-vnext/prototype/qa-foundations-vnext-comparison.png`
and `docs/plugin-ui-vnext/prototype/qa-foundations-vnext-light-comparison.png`.

No actionable P0, P1, or P2 findings remain. The allowance fixture reads
`8 of 10` rather than the source capture’s `4 of 5`; this is expected dynamic
runtime content and does not change shell geometry.

## Implementation checklist

- [x] Match flat source list and exact native spacing.
- [x] Preserve real frame planning and five-group Foundation split.
- [x] Implement individual, mixed, select-all, and clear-all states.
- [x] Match dark and light themes.
- [x] Verify overflow and browser console.

---

# Settings Screen

## Comparison target

- Source visual truth: `docs/plugin-ui-vnext/prototype/settings-frame-theme-tech-final.png`, `docs/plugin-ui-vnext/prototype/settings-frame-theme-custom-final.png`, and `docs/plugin-ui-vnext/prototype/light-theme-settings-final-v2.png`
- Rendered implementation: `docs/plugin-ui-vnext/prototype/implementation-settings-vnext-tech.png`, `docs/plugin-ui-vnext/prototype/implementation-settings-vnext-custom.png`, and `docs/plugin-ui-vnext/prototype/implementation-settings-vnext-light.png`
- Side-by-side evidence: `docs/plugin-ui-vnext/prototype/qa-settings-vnext-tech-comparison.png`, `docs/plugin-ui-vnext/prototype/qa-settings-vnext-custom-comparison.png`, and `docs/plugin-ui-vnext/prototype/qa-settings-vnext-light-comparison.png`
- Local implementation: `http://127.0.0.1:4189/ui-harness.html?view=settings&frameTheme=tech`
- States: Tech preset, Custom theme controls, and light-theme Tech preset.

## Normalization

- Source and implementation pixels: 480 × 680 for every state.
- CSS viewport: 480 × 680.
- Density: 1 CSS pixel to 1 output pixel; no crop or resampling.

## Full-view and focused comparison evidence

The equal-density comparisons retain the full screen and readable custom-field
detail, so no separate focused crop was necessary. The 67px title/subtitle
header, 16px left content inset, five-column theme grid, compact field grid,
section dividers, and logo action align with the source. There is no horizontal
overflow (`clientWidth` and `scrollWidth` are both 428px) and the browser
reported no warnings or errors.

Preset switching, Custom activation, valid and invalid color entry, persisted
swatch updates, and logo capture/removal were exercised in the rendered harness.

## Required fidelity surfaces

- Fonts and typography: heading, subtitle, section heading, helper copy, preset
  labels, micro field labels, input copy, and logo action match the prototype
  hierarchy and remain unwrapped.
- Spacing and layout rhythm: theme cards, Custom divider, two-column fields,
  font row, logo divider, and rail alignment match at the native viewport.
- Colors and visual tokens: theme previews use their approved palettes; selected,
  focus, dark, light, field, border, and error states map to existing tokens.
- Image and asset fidelity: no raster imagery is required. The Custom and check
  marks use shared official Tabler paths.
- Copy and content: all fixed labels, subtitle, field names, logo instructions,
  color-validation copy, and attached-logo status match the workflow.

## Comparison history

### Iteration 0 — blocked

- [P2] Generic card tokens made the theme choices too light and two pixels too
  tall, pushing the logo section down.
- [P2] The custom fields inherited the body line height, making each grid row
  taller than the reference.
- [P2] Custom activated from Tech by editing the Tech values, while the approved
  custom state starts from the stored custom/default palette.
- [P2] The Custom icon swallowed center clicks in the harness because SVG event
  targets were rejected.

Fixes: restored the prototype surface, line-height, inset, and action geometry;
added a separate custom draft; handled SVG event targets; and verified live
color validation and logo controls.

### Iteration 1 — passed

Post-fix evidence is in all three `qa-settings-vnext-*-comparison.png` files.
No actionable P0, P1, or P2 findings remain. The dark focused Custom comparison
and unfocused light Tech comparison intentionally preserve their source states.

## Implementation checklist

- [x] Wire stored presets and custom colors/fonts to production persistence.
- [x] Wire logo capture, replace, remove, success, and error states.
- [x] Match Tech, Custom, dark, and light visual states.
- [x] Verify color validation, preset switching, overflow, and console.

---

# License Screen

## Comparison target

- Source visual truth: `docs/plugin-ui-vnext/prototype/license-free-final.png`, `license-pro-final.png`, `license-expired-final.png`, `license-device-limit-final.png`, `license-unverified-final.png`, and `light-theme-license-final-v2.png`
- Current product override: `docs/plugin-ui-vnext/prototype/AGENTS.md` and the current prototype `App.jsx` require the standalone `License` title without a subtitle. The newest light reference already reflects that decision; the older dark state captures retain the superseded subtitle.
- Rendered implementation: `docs/plugin-ui-vnext/prototype/implementation-license-vnext-free.png`, `implementation-license-vnext-pro.png`, `implementation-license-vnext-expired.png`, `implementation-license-vnext-device-limit.png`, `implementation-license-vnext-unknown.png`, and `implementation-license-vnext-light.png`
- Side-by-side evidence: the six corresponding `qa-license-vnext-*-comparison.png` files.
- Local implementation: `http://127.0.0.1:4189/ui-harness.html?view=license&licenseState=free`

## Normalization

- Source and implementation pixels: 480 × 680 for every state.
- CSS viewport: 480 × 680.
- Density: 1 CSS pixel to 1 output pixel; no crop or resampling.
- The old dark subtitle is classified as superseded product copy, not a spacing
  target. Plan-card and activation content remain aligned at the same y=119
  content origin.

## Full-view and focused comparison evidence

Full-view evidence covers free, Pro, expired, device-limit, unverified, and
light states. The plan card, quota meter, recovery alert, activation form,
connected-device row, and action groups remain legible at 1:1, so a separate
focused crop was not required. The main screen has no horizontal overflow
(`clientWidth` and `scrollWidth` are both 428px) and no browser warnings or
errors.

Activation, invalid/recovery rendering, Pro connection, key removal, removed
confirmation, and unverified Retry → Reconnect were exercised. Production
activation/deactivation uses the existing proxy and client-storage messages;
the quota refresh now reconciles active, expired/inactive, unreachable, and
free fallback identities instead of leaving stale plan state.

## Required fidelity surfaces

- Fonts and typography: standalone title, plan title/detail, badge, quota copy,
  alerts, masked key, support actions, and form copy match the approved scale.
- Spacing and layout rhythm: 67px header, y=119 plan-card origin, 398px card,
  compact plan sections, 16px account separation, 34px form, and action groups
  align with the current prototype.
- Colors and visual tokens: dark/light cards, Pro emphasis, accent meter,
  success/warning/danger/unknown states, disabled activation, and focus states
  use the production semantic tokens.
- Image and asset fidelity: no raster imagery is required. Bolt, key, check,
  alert, refresh, and external-link marks use shared official Tabler paths.
- Copy and content: plan, quota, recovery, activation, removal, connected-device,
  renewal, management, and support copy is state-specific and matches the
  approved workflow.

## Comparison history

### Iteration 0 — blocked

- [P2] Treating the standalone License header like the 48px Foundations header
  pulled the entire account workflow 21px too high.
- [P2] Free-plan usage inherited loose body line height and made the plan card
  nine pixels too tall.
- [P2] Quiet recovery/removal actions were bare text instead of bordered buttons.
- [P2] Device-limit harness data lost the entered key, leaving the recovery form
  disabled and visually unlike the real failure state.

Fixes: restored the global 67px header, matched compact quota rhythm, restored
quiet-button surfaces, retained failed key input, and added light-theme raised
surfaces.

### Iteration 1 — passed

The newest light source and implementation now share the exact y=119 card
origin and current no-subtitle header. Dark state differences are limited to
the archived subtitle and dynamic allowance data: the current free plan is
4 of 10 rather than the older 4 of 5 capture, so its meter and low-allowance
ring correctly differ. No actionable P0, P1, or P2 findings remain.

## Implementation checklist

- [x] Wire active/free/expired/inactive/unknown quota reconciliation.
- [x] Wire first activation, stored-instance retry, device limit, and outage.
- [x] Wire subscription/store/support destinations.
- [x] Wire best-effort deactivation and free-quota refresh.
- [x] Verify all key visual states, interactions, overflow, and console.

final result: passed
