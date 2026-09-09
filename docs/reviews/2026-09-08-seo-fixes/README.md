# SEO fixes — 8 September 2026

All six technical findings from the [audit](../2026-09-08-seo-audit/README.md) are addressed and verified on https://spec-layer.com. Production deployment: `331f13ec-550a-4d76-b562-02f9c3794d21`.

## Delivered

- Corrected the existing www rule to match both HTTP and HTTPS, retain the requested path and query string, and return a permanent redirect to the HTTPS root domain. The previous rule only matched HTTPS, leaving HTTP requests at the registrar parking origin.
- Submitted the sitemap in the verified Google Search Console property. Google reports **Sitemap processed successfully**, with **12 discovered pages**. The homepage was already indexed; its crawl snapshot showed older content. A homepage indexing request is queued. The quickstart was unknown to Google at baseline; its indexing request was accepted into the priority crawl queue. These requests do not mean the revised pages have already been indexed.
- Generated 480px and 1440px lossless WebP delivery variants for all three approved gallery screenshots. All full-size decoded RGBA pixels match the originals exactly; the original PNGs remain linked downloads and fallback assets. The full-size files are 63–66% smaller; the mobile variants are 80–85% smaller than the original PNGs. Actual selection depends on viewport size and device pixel density.
- Flattened shared tokens, brand CSS, and site CSS into one generated stylesheet. Preserved the brand sources and self-hosted fonts, preloaded the shared heading face, and removed the CSS import discovery chain.
- Enabled an account-level Cloudflare Bulk Redirect for the exact production Pages alias. It preserves paths and queries, with subdomain matching disabled so immutable deployment previews remain available. Cloudflare Pages does not support host-level rules in `_redirects`; the final build contains only supported path redirects. [Cloudflare's supported setup](https://developers.cloudflare.com/pages/how-to/redirect-to-custom-domain/).
- Made Cloudflare the single owner of managed robots groups in production. The site supplies the sitemap declaration. Delivered groups match the previous crawler preferences without duplication. Preview builds retain their crawler source and noindex directives. A documented configuration switch restores static groups if hosting changes.

## Validation

- Preview and production build checks passed: 19 HTML routes, navigation, internal links and anchors, metadata, structured data, 12 sitemap URLs, 29 path redirects, policy parity, brand assets and artwork.
- 44 Chromium/WebKit browser scenarios passed, including mobile layout, gallery switching/failure/recovery, docs navigation, menu and focus behavior, checkout destinations, clipboard feedback, and errors.
- 59 live response checks passed, including all canonical routes, legacy redirects, true 404s, all relevant domain/protocol variants and delivered crawler policy.
- Five optimized assets fetched from production match build bytes, with correct CSS/WebP content types. Full-size screenshot pixel comparisons passed for all three images.

## Performance measurements

Lighthouse mobile simulations on live URLs, not real-user Core Web Vitals. All sampled pages retained 100 SEO and 100 accessibility. Best Practices remained 81 due to Cloudflare challenge script warnings already identified in the audit.

| Run | Performance | FCP | LCP | TBT | CLS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Homepage before | 96 | 1.98 s | 2.35 s | 18 ms | 0.0005 |
| Homepage after, first run | 71 | 1.28 s | 2.97 s | 1159 ms | 0 |
| Homepage after, repeat | 90 | 1.29 s | 2.30 s | 292 ms | 0 |
| Quickstart before | 94 | about 2.0 s | 2.37 s | 176 ms | 0 |
| Quickstart after | 89 | 1.44 s | 2.27 s | 371 ms | 0 |

First paint improved in these samples; aggregate performance scores did not. The first homepage run attributed 2.42 seconds of CPU work to Cloudflare's injected challenge script, and the repeated run varied substantially. No stable score improvement is claimed. Bot protection was preserved. The image byte savings and eliminated CSS imports are directly verified improvements, independent of the varying bot-check overhead. `lighthouse-summary.json` retains the category scores and metrics for all three runs, including the slow one; the full multi-megabyte HTML and JSON reports were not kept.

## Search baseline and content follow-up

Search Console's available performance baseline showed 0 clicks, 1 impression, 0% CTR, average position 1, and no query rows. The Page Indexing overview was still processing data and provided no totals; Google asks to check again in a day or so. This is too little evidence to validate content demand. The audit's task-guide ideas remain candidates, not proven keyword opportunities. Prioritize them when query data becomes useful; no speculative near-duplicate SEO pages were added.

## Release and rollback

`release.json` records the final deployment, previous release, and exact Cloudflare rule/list IDs. Source includes the previously approved, uncommitted website work; unrelated `CLAUDE.md` changes were not edited. The site rollback target is `11c2e3db-d202-4b5c-b189-15fcb8b23d5a`. Account rules are separate from Pages releases: disable the new bulk rule if rolling back alias behavior. The www repair should remain enabled. Rolling back to a release containing static robots groups would restore their duplication under Cloudflare; retain the current ownership configuration when possible.

Evidence: `http.json`, `browser.json`, `images.json`, `delivered-assets.json`, `release.json`, and `lighthouse-summary.json`.
