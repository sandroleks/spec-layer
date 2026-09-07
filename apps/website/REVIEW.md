# Website copy and interface review

Reviewed 6 September 2026 against the plugin, extractor, CLI, and quota implementation in this checkout. This was a source and interaction review, not a live Figma runtime audit.

## Corrections applied

- Distinguished component YAML from Foundation DTCG JSON, including direct per-source copying without first creating canvas documentation. Grounding: `packages/plugin/src/ui/actions.ts`, `screens/component.ts`, and `screens/foundations.ts`.
- Rewrote the quickstart with the plugin's actual actions: Create docs, Refresh library, Update documentation, Update all docs, Publish, Publish library, and Copy setup command.
- Made publishing and pulling explicit. CLI freshness compares with the last published bundle, not unpublished Figma changes. Grounding: `packages/plugin/src/ui/publish.ts` and `packages/cli/README.md`.
- Clarified that the publisher needs Pro and developers need the library ID and pull key. Key rotation takes effect within about a minute.
- Separated optional AI writing from deterministic extraction and Copy for AI. Corrected the initial free allowance to the first 30 days and explained successful responses, failures, and cached retries. Grounding: `packages/proxy/src/quota.ts`.
- Removed the decorative connected status from the illustrative hero. Matched its default Button example to the synthetic fixture's no-icon default.
- Replaced vague calls to action and filler with explicit Figma, documentation, contribution, and release actions.

## Interface polish

- Raised small navigation and control labels, improved narrow-layout wrapping, and preserved the full screenshot aspect ratio on mobile.
- Added accurate section highlighting to the documentation contents navigation.
- Added visible copy success feedback, preserved failure guidance, and prevented copy-label width changes.
- Added screenshot error feedback, announced selected captions and billing changes, and made code and table regions keyboard focusable.
- Closed the mobile menu on outside click, navigation, Escape, and desktop breakpoint changes.
- Matched the docs footer to the homepage and added font MIME types to the preview server.

## Validation

The static build and JavaScript syntax checks passed. DOM-based checks passed for both routes: unique IDs, landmarks, every local link and anchor, menu closing, monthly/yearly checkout mapping, all gallery selections and image-error recovery, clipboard success/failure, and documentation section tracking. Copy assertions cover DTCG JSON, unpublished Figma changes, and the 30-day free allowance.

Browser rendering, assistive technology, checkout completion, Figma installation, and live plugin operation were not exercised. Existing gallery images were retained; they are product output examples, not captures made during this review.

## Source copy discrepancies noted for a separate plugin edit

The website is the edit surface for this pass. The plugin source itself was not changed.

- `packages/plugin/src/ui/screens/license.ts`: the Pro detail says “No monthly cap on AI writing or library maintenance.” Library updates are free, and the wording omits Pro publishing. Its expired-state message similarly focuses only on removing a cap.
- `docs/plugin-voice-and-copy.md`: the footer reference still lists Download for the selected-component screen; the actual footer now uses Copy for AI.
- The root README's summary still describes foundation clipboard context as YAML. The current Foundation export implementation produces DTCG JSON.

These source discrepancies should be reconciled if plugin and repository copy are included in a later pass.

## Documentation expansion

Added a six-page documentation section with overview, quickstart, output formats, CLI commands, configuration, and canonical schemas. A shared static generator supplies page navigation, current-page state, section contents, previous/next links, metadata, and source links. The original quickstart route and anchors remain available.

The command reference follows the implemented CLI commands and flags, including selection behavior, API/key precedence, exit codes, and the difference between published-bundle freshness and local output settings. It does not advertise planned commands. Canonical schemas and synthetic export examples are copied from the extractor, and field tables are generated from those copies.

The downloadable validation example loads the foundation schema dependency required by the component schema. Validation checks cover schema compilation, acceptance of a synthetic canonical component shape, and rejection of invalid data. This establishes structural validity only.

The expanded site passed its static route, link, anchor, metadata, schema parity, and example-reference checks. DOM-based checks covered contents tracking and clipboard actions on all six pages. Browser rendering and live external services were not exercised for this expansion. See `AUTHORING.md` for adding future pages and updating reference assets.

## SEO and sharing pass

Added shared search/social metadata, absolute canonical URLs, a generated sitemap, WebSite/WebPage and breadcrumb JSON-LD, and a branded 1200 × 630 social image. Homepage source moved to `content/index.html` so build-specific metadata is generated consistently with the documentation.

Documentation now uses directory URLs, with permanent redirects and fallback HTML for older `.html` links. The public homepage’s `#features` anchor is retained. A proper 404 page avoids a missing-route homepage fallback. Preview mode defaults to `noindex`; production indexing requires an explicit build mode. The existing public domain’s crawler preferences were read and preserved.

Both preview and production builds passed checks for 14 HTML routes, seven canonical sitemap URLs, 19 redirect rules without chains, metadata consistency, JSON-LD, social-image dimensions, schemas, and links. Local HTTP checks verified all canonical routes, download MIME types, preview response headers, redirects preserving query strings, and 404 status responses. Documentation DOM interaction checks passed again. The sharing image was inspected directly; page rendering in a browser was not tested in this pass.

Read-only checks of the public site confirmed its policy/support routes and missing sitemap. No production-domain, DNS, crawler-management, or Search Console settings were changed. The policy/support route handoff and Search Console submission are documented in `SEO.md` for the public launch.

The published preview served canonical pages and the social image successfully, exposed the sitemap and robots file, included HTML `noindex`, and returned 404 for an unknown page. Sites did not apply the uploaded Cloudflare redirect/header rules, so the preview relies on HTML metadata and a compatibility fallback for normalized legacy quickstart bookmarks. The public-host rules remain separately checked in source and the local HTTP server.

## Further copy, links, and docs menu pass

The follow-up fixes clipped sidebar padding and keyboard focus, aligns section headings with navigation labels, clarifies homepage and documentation copy, and expands link/menu regression coverage. Preview/production checks and 50 local HTTP checks pass; Chromium and WebKit pass 44 browser scenarios across nine viewport widths.

The link audit verified 39 HTTP destinations: 36 responded directly, and the two checkout destinations worked in a browser with the correct selected plan. Figma blocks automated access and remains unverified live. Lemon Squeezy's annual checkout copy incorrectly says “Save about $30”; the website correctly states $15.89. See `docs/reviews/2026-09-06-website-improvements/` in the monorepo for the complete record and screenshots. These changes, including the final terminology revisions, are deployed to spec-layer.com. Final production verification passed 44 browser scenarios and 50 HTTP checks. Live verification also corrected Cloudflare email rewriting of versioned CLI commands. See the review directory’s release.json for the deployment and rollback records.

## Shared brand adoption — 7 September 2026

The implementation branch now connects the website to `packages/brand`, which also powers the plugin. Shared semantic colors, static identity, font assets, action/selection/focus states, and shape roles replace independently authored website branding. Web reading sizes stay separate from plugin density, with Manrope headings and the shared Inter/system stack for body text. Existing content edits and policy provenance remain intact.

Preview and production-mode checks, shared asset/contrast gates, and local browser review are recorded in `docs/reviews/2026-09-07-website-brand-implementation/`. These branding changes are local and have not been deployed. Existing gallery and social images remain pending the separate imagery phase.

## Screenshot and supporting artwork adoption — 7 September 2026

Replaced the three local website gallery panels and social preview with assets generated from the shared brand source. Six unretouched browser captures show the actual implementation renderer in light/dark themes with synthetic data. Gallery descriptions now describe the visible interface, and mobile sources show a raw close-up rather than a reduced desktop panel. Full-size links open the matching raw screenshot.

The standalone package includes listing/repository artwork and icons, source/capture provenance, a rebuildable master, and a download archive. Review and verification: `docs/brand/assets-v1/README.md` and `docs/reviews/2026-09-07-brand-artwork/README.md`. No public assets or listing settings have been updated in this pass. Native Figma verification remains outstanding.
