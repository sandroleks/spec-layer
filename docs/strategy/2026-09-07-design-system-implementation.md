# Shared design-system implementation

Branch: `codex/shared-design-system`.

The September 7 design-system proposal is approved for implementation by the user's request to start. Work is divided into reviewable milestones. Deployment and public listing updates remain separate release actions.

## Phases

| Phase | Deliverable | Status |
| --- | --- | --- |
| 1. Shared foundation | Versioned brand package, semantic tokens, identity assets, contrast gate, consumer contract | Complete |
| 2. Plugin adoption | Shared colors, readable type, control boundaries, shape roles, neutral AI treatment, updated system docs, renderer verification | Implemented and checked in the browser harness; native host review is in phase 5 |
| 3. Website alignment | Consume the shared foundation, align identity and component states, preserve website reading sizes and current content work | Complete; homepage, documentation, and shared page styles checked locally |
| 4. Product imagery and supporting assets | Fresh accepted-interface captures, listing/repository/social artwork, screenshot conventions | Prepared and integrated locally; native product acceptance remains in phase 5 |
| 5. Integrated review and release readiness | Cross-surface checks, native Figma verification, regression checks, release notes and rollback | Planned |

## First milestone scope

Build the shared source and integrate it into the actual plugin CSS pipeline. Keep workflow behavior and generated customer-document branding intact. Use the existing UI font stack with native system fallback; do not add a network font dependency inside Figma. Bundle the existing licensed Manrope assets in the brand package for website consumers.

The proposal remains a dated review artifact. Production consumes `packages/brand`; plugin layout, density, tracking, and elevation remain owned by its adapter. Shared color changes must pass the contrast gate before a plugin build can succeed.

## Existing work

The branch started from `main` with uncommitted website content, styles, checks, and documentation already present, plus the brand proposal and review artifacts. Preserve those changes. This milestone does not rewrite or commit that unrelated website work.

## Verification

- Validate semantic color pairs, including active text and control states in both themes.
- Build an entirely embedded plugin stylesheet without external CSS requests.
- Run relevant renderer/build tests, lint, type checking, and plugin build.
- Inspect actual renderer screens in light and dark themes at supported widths, including busy/empty/error states, controls, and search.
- Record limitations honestly: the local harness does not prove native Figma host operations.

## First milestone result

The plugin now consumes the shared foundation through its real build. All 152
permitted color pairs pass. Relevant coverage totals 177 passing tests across
11 suites; type checking and lint of the changed JavaScript/TypeScript pass.
The plugin build and diff whitespace check pass.

The browser review covered both themes, actual theme switching, Component
docs, Library, Foundations, Settings/custom controls, License, search, and
component empty/busy/error fixtures. Narrow Foundations footers now wrap
without losing labels or icons. Search Escape returned focus to the trigger.
Native Figma actions and host-driven error messages still need phase 5 review.

Review evidence: `docs/reviews/2026-09-07-design-system-implementation/README.md`.
Launch the local review with `UI_HARNESS=1 node packages/plugin/build.mjs`, then
`node packages/plugin/preview-design-system.mjs` (loopback port 4651).

## Website alignment scope

1. Read the existing website diff and its build/asset pipeline before editing.
2. Generate shared brand CSS during the website build; use a website adapter
   for current semantic roles, without importing plugin density tokens.
3. Consolidate symbol and licensed font assets through the shared package.
4. Align primary/secondary/focus states and product terminology while retaining
   readable website type sizes and the user's existing content changes.
5. Verify mobile/desktop layouts and website checks before taking new imagery.

Nothing has been published or released. These changes remain on the
implementation branch for review.

## Website milestone result

The website now builds the same semantic palette, static symbol, and licensed fonts as the plugin. Website components retain readable web density, Manrope headings, and the shared UI font stack for reading text. Primary actions, selected states, focus, surfaces, and shape roles use shared tokens. Existing content and policy revisions are preserved.

Preview and production-mode checks cover 19 HTML routes, 12 canonical URLs, 29 redirects, source preservation for five support/policy pages, and shared brand assets. Browser review covers desktop homepage/CLI documentation, mobile homepage/docs, the mobile menu, billing selection, and narrow-page overflow. This is local review, not a new public release.

Evidence: `docs/reviews/2026-09-07-website-brand-implementation/README.md`. Run `npm run dev --prefix apps/website` to review on loopback port 4621.

## Product imagery scope

Capture the accepted plugin interface in context, then replace the older gallery images and align listing/social/repository artwork. Preserve customer-document colors in output examples. Review native Figma behavior and the combined brand before release.

## Product imagery milestone result

Six unretouched renderer captures cover Component docs, Foundations, and Library in both themes with sample data. The shared source generates three gallery panels, a listing cover, website/repository social cards, and two icon sizes plus the canonical SVG. The website uses the new panels, with raw close-ups on mobile and accurate sample-data captions. A separate review board and downloadable asset set live in `docs/brand/assets-v1/`.

Source/export hashes and image parity checks keep the website copies aligned with the shared master. The listing and repository artwork remain local. Native Figma and generated customer-output captures are still required in phase 5 before coordinated release.

Next: integrated review of the installed plugin, customer-document output, website, listing, and social previews; then release readiness.

## Website release — 7 September 2026

The user explicitly approved publishing the website after reviewing the branding, artwork, and “Copy all for AI” label. The checked website artifact is now live at https://spec-layer.com. All 50 public HTTP checks and exact parity for 32 static assets passed; targeted live desktop/mobile review passed. Evidence and rollback: `docs/reviews/2026-09-07-website-brand-release/`. Plugin distribution, native Figma review, public listing, and repository social settings remain separate work.
