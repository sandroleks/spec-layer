# Selected Component Screen — Design QA

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

final result: passed
