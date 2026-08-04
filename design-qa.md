# Plugin UI vNext — Design QA

## Component documentation settings

### Comparison target

> **Evidence note.** This screen was reviewed against session-local screenshots
> (8 source references, 8 rendered captures, and 9 side-by-side comparisons:
> full-view, focused, Usage mixed-state, anatomy and empty-states,
> section-hierarchy, light-theme, two light-theme workflow contact sheets, and a
> previous-implementation light comparison). Those files lived in a temp
> directory and are gone. The findings and verdicts below are the surviving
> record. The harness URL reproduces the state if a re-shoot is needed. Later
> screens in this document reference committed images under
> `docs/plugin-ui-vnext/prototype/` instead — prefer that for future QA.

- Local implementation:
  `http://127.0.0.1:4173/ui-harness.html?view=component&facts=none&expand=usage,specs&theme=light`
- State: selected `buttonPrimary`, light theme, Usage and Specifications
  expanded, with Usage at `3 of 4 included`, matching the final
  previous-implementation light comparison. The detected-states verification
  uses the same component state with `facts=states`. Earlier focused checks
  cover Tokens with 1 of 36 selected variants and Usage with only Related
  components selected.

The supplied screenshots are problem-state references rather than a pixel-perfect
redesign target. The review therefore compares the requested interaction and
hierarchy changes while preserving the product's existing graphite/blue design
language. Host chrome and expanded-content differences are not treated as drift.

### Normalization

- Source pixels and density: 974 × 1442, 732 × 144, 828 × 120, and
  828 × 488 at 144 DPI. Later sources are 824 × 986, 828 × 464, and
  972 × 1356. The previous-implementation light reference is 968 × 1328.
- The sources are 2× captures and were normalized to 487 × 721, 366 × 72,
  414 × 60, 414 × 244, 412 × 493, 414 × 232, and 486 × 680 for
  comparison.
- Implementation pixels: 480 × 680. The final browser reported device pixel
  ratio 2, while the screenshot API emitted a CSS-sized 1× raster.
- The latest implementation capture is 1280 × 720; its 440 × 720 component
  panel crop is placed beside the normalized latest source.
- The previous-implementation light reference was normalized to 480 × 659 and
  placed beside a 480 × 680 implementation crop. The 21px height difference is
  source-window chrome and is not scored as product drift.
- CSS viewport: 480 × 680.
- The focused comparison uses native implementation crops alongside the
  normalized problem-state crops; no density mismatch is scored as a defect.

### Full-view and focused comparison evidence

The full comparison shows that the old undifferentiated list and clipped footer
have been replaced with distinct category cards, a clear section intro, full-row
selection blocks, and an intact footer. The focused comparison shows the new
parent-controlled measurement settings and the expanded, internally scrollable
variant picker with its mixed bulk checkbox and visible variant rows.
The Usage comparison confirms that checked, unchecked, and keyboard-focused rows
all remain transparent while the indeterminate mark stays centered in the
category checkbox.
The latest comparison confirms that Anatomy is now a single selection row with
no display-mode control and that a component with no detected states does not
show an empty or disabled States row. A separate detected-states capture confirms
that States returns as a normal selectable row when data exists.
The section-hierarchy comparison shows each child checkbox moved beneath the
category icon and each child label aligned beneath the category title. The
category checkbox remains at the card edge, creating a clear parent/child step
without changing row height or the card's full-width click target.
The final light-theme comparison uses the older implementation as visual truth.
It confirms a white canvas and child-row field, softly gray category headers and
AI card, neutral AI badges, restrained dividers, and blue confined to controls
and actionable states. The final workflow contact sheet confirms those neutral
roles across Component, Foundations, Library, License, and Search while the dark
theme remains unchanged.
No separate light-theme focused crop was needed: the paired 486/480px native
frames keep card boundaries, badges, checkboxes, and nested surfaces legible.

Both implementation screenshots retain the 480 × 680 plugin viewport. The
variant list scrolls independently inside a 220px viewport while the Create docs
action remains reachable. The rendered page produced no browser warnings or
errors.

### Required fidelity surfaces

- Fonts and typography: existing Inter/system tokens are preserved. Category
  titles, counts, row titles, option labels, and variant chips now form a clear
  hierarchy without unintended truncation.
- Spacing and layout rhythm: categories are separated as full-width cards;
  headers and rows have larger, consistent hit areas; child rows use a 40px
  inline inset and nested settings align at 63px; the footer no longer clips
  content.
- Colors and visual tokens: selection is communicated by the checkbox rather
  than persistent blue row fills. Light mode now uses `#ffffff` canvas,
  chrome, child rows, and nested detail surfaces; `#f7f7f7` category headers
  and AI surfaces; neutral `#e2e2e2` / `#eeeeee` borders; and neutral AI badge
  roles. Accent, status, control, shadow, overlay, menu, search, and Library
  states resolve through shared `--sl-*` roles with no component-specific
  light override block.
- Image and asset fidelity: this settings screen contains no raster product
  imagery. Check, chevron, section, and action icons use the shared Tabler-style
  icon source; no placeholder imagery or custom CSS illustration is present.
- Copy and content: `Sections to include`, `Diagrams to include`, and
  `Variants to document` describe the selection hierarchy directly. Anatomy no
  longer exposes redundant display-mode copy.
- Accessibility and interaction: rows are native labelled checkboxes, category
  and variant bulk controls expose checked/mixed state, disclosure buttons retain
  expanded state, and measurement controls expose pressed/required state.

### Primary interactions tested

- Clicking a visible variant row changed the count from 1 to 2 while the settings
  scroll remained 504.5, a zero-pixel jump.
- Selecting all variants changed the checked count to 36 of 36 and cleared the
  mixed state.
- Clicking the right side of the Measurements row toggled its checkbox and
  removed all three subordinate controls.
- Measurement options could be independently removed; the last active option
  remained pressed and gained `aria-disabled="true"`.
- Category hover, mixed bulk state, individual row selection, variant-list
  internal scrolling, and parent-controlled nested settings were inspected.
- The exact 1-of-4 Usage state rendered all four row backgrounds transparent.
  The mixed checkbox resolved to one 14px grid row, with both check and
  indeterminate glyphs occupying grid area `1 / 1`.
- With `facts=none`, Specifications rendered `4 of 4 included`, no States row,
  and no Anatomy subsettings. With `facts=states`, it rendered `5 of 5 included`
  and a normal selected States row.
- Document-model and saved-link tests confirmed Anatomy normalizes to `diagram`
  even when an older configuration requests `table` or `both`.
- Usage, Specifications, and Accessibility were expanded in the browser. Their
  child labels all began at x=128 and category title/icon groups at x=103.
  Every child row remained 41px high with equal client and scroll widths, so no
  label wrapping or horizontal overflow was introduced.
- Light-mode Component, Foundations, expanded Library, free License, and open
  Search states were rendered and inspected. Theme switching was checked
  against the dark Component screen.
- Computed light values matched the semantic map: canvas/chrome/rows `#ffffff`,
  category and AI surfaces `#f7f7f7`, AI badge text `#737373` on white with an
  `#e1e1e1` border, and unchecked controls using the neutral `#8a8a8a`
  strong-border role.
- Browser console warnings/errors: none.

### Comparison history

#### Iteration 0 — blocked

- [P1] The variant header reported expanded, but the list stayed visually
  collapsed because the generic adjacent-sibling disclosure selector no longer
  matched the wrapped header.

Fix: added a variant-specific visible-panel rule keyed to the panel's `hidden`
state. Post-fix evidence is the final expanded variant screenshot.

#### Iteration 1 — blocked

- [P1] A real pointer click on a variant moved the outer plugin shell from
  scroll position 0 to 438.5. The 1px hidden checkbox was absolutely positioned
  without a row-local containing block, so focus scrolled the hidden shell.

Fix: anchored choice, bulk, and switch inputs to position-relative visible
controls. The post-fix pointer test kept shell 0, settings 405.5, and variant-list
scroll 0 while the selection changed.

#### Iteration 2 — passed

Evidence: final full and focused comparison images listed above.

No actionable P0, P1, or P2 findings remain.

#### Iteration 3 — blocked

- [P2] Checked rows and the focused unchecked row used persistent blue fills,
  obscuring the simpler checkbox-based selection model.
- [P2] The indeterminate bar occupied a separate implicit grid row from the
  hidden check glyph, placing it against the checkbox edge.

Fix: removed selected and focus-within row fills, retained neutral pointer hover,
and placed the check and mixed glyphs in the same centered grid cell.

#### Iteration 4 — passed

No actionable P0, P1, or P2 findings remain.

#### Iteration 5 — blocked

- [P2] Specifications showed a disabled `States · none detected` row even though
  there was no actionable content.
- [P2] Anatomy exposed Diagram/Table/Both subsettings even though the product
  should consistently generate the diagram.

Fix: omitted unavailable sections from the screen model, removed Anatomy
subsettings from the renderer and interaction harness, and normalized Anatomy to
`diagram` in document creation, update, download, and saved-link parsing.

#### Iteration 6 — passed

No actionable P0, P1, or P2 findings remain. The no-states and detected-states
browser snapshots confirm the conditional row behavior.

#### Iteration 7 — blocked

- [P2] Child section checkboxes started at or before the category checkbox, and
  their labels started left of the category title, flattening the hierarchy.

Fix: increased child-row inline padding from 10px to 40px and moved nested
section-details padding from 33px to 63px, preserving alignment between each
child label and its subordinate settings.

#### Iteration 8 — passed

No actionable P0, P1, or P2 findings remain. All three category groups preserve
41px rows, readable labels, and zero horizontal overflow.

#### Iteration 9 — blocked

- [P2] Canvas, chrome, section cards, nested surfaces, and footer used adjacent
  neutral grays, flattening the light-theme hierarchy.
- [P2] AI badges, Library update states, menus, global Search, status panels,
  overlays, and switch thumbs still contained theme-specific color literals or
  selector-specific light overrides instead of semantic roles.
- [P2] The unchecked-control border resolved to `#b8c3ce` on white, only 1.79:1,
  making unchecked checkboxes unnecessarily faint.

Fix: rebuilt the light palette around white chrome/cards and a cool near-white
canvas, added shared accent/status/control token roles, migrated themed
components to those roles, removed all component-specific light selectors, and
strengthened the light strong-border token to `#8796a5`.

#### Iteration 10 — passed

No actionable P0, P1, or P2 findings remain. The multi-workflow contact sheet
and dark-theme regression capture use the same semantic token graph and show no
broken or unthemed surfaces.

#### Iteration 11 — blocked

- [P2] The connected light-theme token graph was still too cool and blue-gray.
  The canvas, subdued surfaces, borders, typography, and AI badges made gray the
  atmosphere of the screen instead of using it sparingly to define hierarchy.
- [P2] Category headers and child rows did not recreate the older
  implementation's clear gray-header/white-body grouping.

Fix: preserved the semantic token architecture but remapped the light roles to
neutral white canvas and rows, soft-gray group headers and AI card, neutral
typography and dividers, and neutral AI badge roles. Added dedicated semantic
roles for category headers, detail surfaces, AI surfaces/borders, badge styling,
and restrained hover borders.

#### Iteration 12 — passed

No actionable P0, P1, or P2 findings remain. The paired comparison visibly
restores the older implementation's bright, calm hierarchy without reintroducing
obsolete Anatomy controls, empty States rows, or text-link bulk actions. The
neutral workflow contact sheet and dark-theme regression capture show no broken
or unthemed surfaces.

### Findings

No actionable P0/P1/P2 findings remain.

### Residual test gap

- The production Figma iframe was not launched in this pass. The same built UI,
  viewport, selection handlers, and host-independent scrolling were exercised in
  the repository's browser harness.

### Implementation checklist

- [x] Eliminate variant-selection screen jumps.
- [x] Add mixed-state Select all for variants.
- [x] Move group bulk selection to a left-side checkbox.
- [x] Make section and variant rows full-width click targets.
- [x] Add category and row hover/focus states.
- [x] Show nested settings only while their parent section is selected.
- [x] Clarify and enforce measurement-option selection.
- [x] Improve hierarchy, padding, grouping, and internal scrolling.
- [x] Remove persistent row selection/focus fills.
- [x] Center and verify the indeterminate checkbox mark.
- [x] Omit States when the extractor detects none.
- [x] Remove Anatomy display-mode subsettings.
- [x] Always generate Anatomy as a diagram, including older saved documents.
- [x] Indent subsection controls beneath their category title.
- [x] Keep nested settings aligned with their owning subsection.
- [x] Replace the gray-heavy light palette with white hierarchical surfaces.
- [x] Restore the older light implementation's neutral gray-header/white-body
  visual hierarchy.
- [x] Connect themed components to shared accent, status, border, and control roles.
- [x] Remove selector-specific light-theme component overrides.
- [x] Verify Component, Foundations, Library, License, Search, and dark regression.
- [x] Verify dark-theme rendering at 480 × 680.
- [x] Verify browser interactions, console, lint, types, tests, and build.

### Follow-up polish

- [P3] Run one short in-Figma host pass to confirm the Figma iframe preserves
  the same wheel and focus behavior.

final result: passed

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

# Library Screen

## Comparison target

- Source visual truth: `docs/plugin-ui-vnext/prototype/library-icon-folder-final.png`
  and `docs/plugin-ui-vnext/prototype/light-theme-library-final-v2.png`.
- Rendered implementation: `docs/plugin-ui-vnext/prototype/implementation-library-vnext-dark.png`
  and `docs/plugin-ui-vnext/prototype/implementation-library-vnext-light.png`.
- Side-by-side evidence: `docs/plugin-ui-vnext/prototype/qa-library-vnext-dark-comparison.png`
  and `docs/plugin-ui-vnext/prototype/qa-library-vnext-light-comparison.png`.
- Local implementation: `http://127.0.0.1:4189/ui-harness.html?view=library&state=expanded&theme=dark`.

## Normalization and findings

- Source and implementation are both 480 × 680 at one CSS pixel per output
  pixel. Body width/scroll width are both 480px; the Library scroll region is
  417px wide with no horizontal overflow.
- The 48px title row, content-width filters, 49px document rows, 22px identity
  slot, fixed age/menu columns, expanded border, details inset, and 56px footer
  align with the approved final references in dark and light themes.
- Production intentionally renders the approved hash-only fallback rather than
  the prototype's mock itemized change groups. The live protocol can prove that
  a source changed but does not persist a comparable prior specification.
- All, Updates, and In sync filters return accurate counts; disclosure, menu,
  refresh, and batch actions were exercised. The menu exposes only supported
  component/foundation/orphan capabilities. Browser logs contain no errors.

## Implementation checklist

- [x] Enrich rows with honest source labels and generation ages.
- [x] Distinguish pending, unavailable, edited, orphaned, update, and in-sync.
- [x] Keep detailed change copy truthful when only hash drift is available.
- [x] Wire frame/source focus, download, detach, remove, refresh, and updates.
- [x] Run Update all sequentially through the shared operation lock.
- [x] Update the Library rail badge from proven live drift.
- [x] Verify dark/light layout, interactions, overflow, and browser console.

# Global Search

## Comparison target

- Source visual truth: `docs/plugin-ui-vnext/prototype/search-after-fix.png`
  and `docs/plugin-ui-vnext/prototype/search-light-after-fix.png`.
- Rendered implementation: `docs/plugin-ui-vnext/prototype/implementation-search-vnext-dark.png`
  and `docs/plugin-ui-vnext/prototype/implementation-search-vnext-light.png`.
- Side-by-side evidence: `docs/plugin-ui-vnext/prototype/qa-search-vnext-dark-comparison.png`
  and `docs/plugin-ui-vnext/prototype/qa-search-vnext-light-comparison.png`.
- Local implementation: `http://127.0.0.1:4189/ui-harness.html?view=library&theme=dark&search=open`.

## Normalization and findings

- Source and implementation are 480 × 680 at one CSS pixel per output pixel.
  The measured panel is x=12, y=56, width=456, height=519.39, with no body or
  panel horizontal overflow.
- Layer/scrim opacity, panel radius/elevation, 46px search field, grouped
  headings, 41px results, 28px result icons, active row, and 32px keyboard
  footer align in both dark and light themes.
- The implementation intentionally uses the current product names `License`
  and `Generated frame appearance`; the archived reference still says
  `Subscription` and carries the superseded Settings summary.
- Live filtering, four-document default/eight-document query cap, pointer
  state, wrapping arrows, Home/End, Enter, empty/clear, scrim/X/Escape,
  Command/Ctrl+K, Tab containment, active-result scrolling, and trigger focus
  restoration were exercised. Browser logs contain no errors.

## Implementation checklist

- [x] Search every real workflow and connected Library document.
- [x] Share workflow navigation behavior with the rail.
- [x] Open real documentation frames from document results.
- [x] Load Library identities lazily without false no-match results.
- [x] Add full combobox/listbox semantics and keyboard behavior.
- [x] Keep the palette in the global header across every screen.
- [x] Verify dark/light layout, empty state, focus handling, overflow, and logs.

# Full vNext Regression

- Rebuilt the production vNext bundle and development harness from the same
  TypeScript/CSS sources.
- Rechecked Component, Foundations, Settings, License free/Pro, Library, and
  Search dark/light at the native 480 × 680 plugin viewport.
- Every body is exactly 480 × 680 with no body overflow. Component,
  Foundations, Settings, and License scroll regions are 428/428px
  client/scroll width; Library and its Search background are 417/417px.
- Footer visibility matches each workflow: Component, Foundations, and Library
  show actions; Settings and License do not.
- TypeScript, focused lint, all 111 test files (1,423 tests), production build,
  whitespace checks, and browser error logs pass.

# Feedback and Loading States

## Source and implementation

- Source behavior: the original plugin's cycling sparkle loader and foundation
  skeletons in `render.ts`/`dom.ts`.
- Rendered implementation:
  `http://127.0.0.1:4189/ui-harness.html?view=component&state=building&theme=dark`,
  `?view=foundations&state=loading`, `?view=foundations&state=progress`, and
  `?view=library&state=updating`.
- All states were checked at the native 480 × 680 plugin viewport.

## Findings

- Pointer-activated navigation buttons now release pointer focus; moving away
  leaves the tooltip at opacity 0 while keyboard focus remains supported by
  `:focus-visible`.
- Component reading/building, Foundation reading/building, Library refresh,
  batch update, and download preparation share the original loader's sparkle,
  shimmer, phase copy, and reduced-motion behavior.
- Progress is grouped with the action that started it: directly above the
  footer button row with a 6px gap. It no longer displaces page controls,
  source rows, filters, or Library documents. Before/after evidence and the UX
  audit are in `docs/plugin-ui-vnext/audits/2026-07-29-progress-placement/`.
- Progress narration uses one text line. The phase and animated dots remain;
  redundant explanatory copy was removed. Determinate work keeps only its
  progress bar and compact count.
- Foundation and Library batch progress use real `done / total` values and
  accessible progressbar attributes. Indeterminate work does not invent a
  percentage.
- Initial Foundation and Library reads use stable skeleton rows. Each checked
  state stays 480 × 680 with no body or horizontal overflow.
- Operational success/error banners are absent from Component, Foundations,
  and Library. Their production handlers send the shared `notify` message to
  native `figma.notify`, including native error styling and longer error
  timeouts.
- Library download failures no longer fall through to a false success message.
- Browser console warnings/errors: none.

## Verification

- [x] Plugin TypeScript passes.
- [x] Focused lint passes.
- [x] All 112 test files and 1,429 tests pass.
- [x] Production vNext and development harness builds pass.
- [x] Component, Foundation loading/progress, Library batch progress, tooltip
  lifecycle, and absence of in-plugin result toasts pass visual QA.
- [x] No Figma bridge was used.

final result: passed

# Section List Interactions

## Source and implementation

- Source behavior: the original section list allowed selecting or clearing an
  entire category and gave individual rows a pointer hover state.
- Rendered implementation:
  `http://127.0.0.1:4189/ui-harness.html?view=component&state=ready&facts=states&expand=usage&allowance=normal&theme=dark`.
- Source/implementation comparison and interaction evidence are in
  `docs/plugin-ui-vnext/audits/2026-07-29-section-list-interactions/`.

## Findings

- Usage, Specifications, and Accessibility now expose a compact `Select all` or
  `Clear all` action beside the category count.
- Bulk selection is independent from disclosure expansion and preserves focus
  after the screen updates.
- Unavailable sections are excluded from the category total and remain
  disabled when `Select all` runs.
- Available section rows use a full-width hover surface without moving
  surrounding content. Keyboard focus uses the same footprint with an accent
  surface, while disabled rows do not imply interactivity.
- The actions and row states fit the native 480 × 680 viewport in dark and
  light themes.

## Verification

- [x] Category select and clear actions pass live browser interaction checks.
- [x] Unavailable Specifications sections remain disabled and unchecked.
- [x] Disclosure and bulk controls have separate accessible names.
- [x] Dark/light row feedback and category layout pass visual QA.
- [x] All 112 test files (1,430 tests), focused lint, and TypeScript pass.
- [x] No Figma bridge was used.

final result: passed
