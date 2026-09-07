# Website shared-brand implementation

Date: 7 September 2026. Branch: `codex/shared-design-system`.
Local review: <http://127.0.0.1:4621/>. This pass has not been deployed.

## What changed

- Website build and preview startup now generate the palette, static symbol, licensed Manrope fonts, and theme metadata from `packages/brand`, also consumed by the plugin.
- Homepage, documentation, and common support/policy styles use shared surfaces, text, violet actions, selected states, focus, and shape roles.
- Manrope supplies headings and identity; the shared Inter/system stack supplies reading text and controls. Website body text and action sizes stay independent of plugin density. Small metadata is at least 12px; recurring controls and navigation labels use larger sizes.
- The hero's component/code panels can grow with their content. Existing website content changes, policy provenance, routes, and interaction behavior are preserved.
- A build gate checks exact palette/asset parity, transitive CSS/font availability, density separation, and theme metadata, preventing silent divergence between consumers.

## Verification

- Preview and production-mode checks passed: 19 HTML routes, 12 canonical URLs, 29 redirects, links, anchors, structured data, reference examples, indexing rules, and exact source preservation for five support/policy pages. The final local output is preview mode with `noindex`.
- The shared build passed its 152 permitted semantic contrast pairs. This is a token contract, not a complete accessibility audit.
- Lint for changed website scripts and the diff whitespace check passed.
- All 50 local HTTP checks passed; see [http.json](http.json).
- Browser review covered the homepage and CLI documentation at 1440 × 900, homepage and documentation at 390 × 844, and homepage overflow at 320px. No page-wide horizontal overflow was found at the checked mobile widths.
- The mobile menu opened and closed with Escape. Yearly billing selected the existing annual checkout URL; Monthly restored the existing monthly URL. No checkout was submitted.
- Computed homepage styles matched shared dark canvas `#1F1F1F`, action fill `#B3A0FF`, and action text `#17112E`.

## Screenshots

These captures show actual local website rendering, not generated mockups.

| Surface | Capture |
| --- | --- |
| Homepage, desktop | [homepage-desktop.png](homepage-desktop.png) |
| Homepage, mobile | [homepage-mobile.png](homepage-mobile.png) |
| Documentation, mobile | [docs-mobile.png](docs-mobile.png) |
| CLI documentation, desktop | [docs-desktop.png](docs-desktop.png) |
| Yearly billing selection, desktop | [pricing-desktop.png](pricing-desktop.png) |

## Remaining phases

Existing product gallery and social images are retained. They do not demonstrate the newly branded plugin and will be replaced in the separate imagery phase after interface acceptance. Illustrative customer-output specimens retain their own design colors.

Native Figma behavior, comprehensive assistive-technology review, and public release checks remain in the integrated review phase. This browser pass is not a cross-engine certification or verification of external services.
