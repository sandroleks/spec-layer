# Website verification record

Verified 6 September 2026. Evidence is in `docs/reviews/2026-09-06-website-implementation/` in the monorepo and the candidate package. This record covers the integrated website candidate, not a public-domain launch.

## Results

| Check | Result | Evidence / limit |
| --- | --- | --- |
| Preview and production builds | Pass | 19 HTML files, 12 canonicals, 29 redirects; links, schema copies, examples, metadata, JSON-LD and indexing modes |
| Published content preservation | Pass | All five support/policy source bodies and links match the public source; manifest records provenance and hashes |
| Required root CI gate | Pass on isolated committed baseline plus website integration | 119 test files; 2,207 tests passed, 9 todo; lint, types, coverage, builds, sandbox/CLI checks, proxy dry run and dependency audit; zero vulnerabilities |
| Browser scenarios | 42 passed, zero failed | Chromium 152.0.7977.76 and WebKit 26.5; `results.json` |
| Responsive layout | Pass | All 12 pages at 320, 390, 720, 760, 761, 768, 1120, 1121 and 1440 CSS pixels in both engines; no page-wide horizontal overflow |
| Automated accessibility | Pass | Axe 4.11.0: no WCAG 2 A/AA or 2.1 AA violations detected on the 12 desktop pages in Chromium; not a full accessibility certification |
| Browser screenshot review | Pass | Actual homepage, CLI and privacy screenshots at 390 and 1440px in both engines; new screenshots are separate from the old site review |
| Local Cloudflare routing | Pass | `cloudflare-local.json`: 50 delivered-response checks, including all 29 redirects; Wrangler 4.127.0, runtime compatibility 2026-09-02 |
| Rollback content | Pass | `rollback.json`: five current support/policy pages, HTTP 200, matching text and links on the existing immutable deployment |
| Diagnostic mobile performance | Measured | Homepage LCP 1.224s / CLS 0.022; CLI LCP 0.644s / CLS 0.030. Local cold-cache Chrome, 390×844, 4× CPU slowdown, 150ms latency, 1.6Mbps download; not field metrics or Lighthouse scores |
| Manual screen reader and native browser zoom | Remaining manual review | Accessibility structure, live-region markup, keyboard focus and 720px reflow were checked; no VoiceOver/NVDA listening session or native 200% browser zoom is claimed |
| Public domain and Search Console | Not launched | Public edge checks and sitemap submission run after launch approval |

The shared checkout contained concurrent extractor changes. Its first root gate run encountered six extractor test failures during that work. To isolate the website, a separate checkout of committed `f6f193bf5d862c2cb499945773fa374602606c2e` plus this website integration ran the complete gate successfully. Those unrelated extractor edits were not changed by this task.

## Browser coverage

| Area | Verified behavior |
| --- | --- |
| Homepage and all content routes | HTTP success, one main landmark and heading, matching canonical, readable layouts across nine widths |
| Mobile menu | Open state, Escape and focus return, outside click, link close, reset on desktop resize |
| Gallery | Three selections, matching full-image links, loaded images, failed request feedback and recovery |
| Pricing | Repeated monthly/yearly toggles, correct amount and pressed state, exact existing checkout variants |
| FAQ | Native disclosure opens with Enter and closes with Space |
| Documentation | Every sidebar destination navigates correctly and has the current-page state |
| Contents | Follow section link, correct current section, deep-link reload and heading clear of the sticky header |
| Mobile docs | Collapsed page navigation and contents expand and navigate correctly |
| Clipboard | Exact native clipboard contents checked in Chromium; native write success feedback in WebKit; simulated NotAllowedError gives useful status feedback in both |
| Downloads | Actual browser YAML download and output-page download responses; schemas/validator checked over HTTP and against source |
| Legacy links | `.html` quickstart query/fragment reaches the intended route; preview bookmark fallback works |
| Keyboard | Skip link reaches main content, visible next focus, forward/back navigation; WebKit uses Option+Tab for links under its macOS default keyboard behavior |
| Reduced motion | Entire browser matrix runs with reduced motion enabled; content and interactions remain usable |
| Policies | Preserved content and local navigation; desktop/mobile screenshots |
| Errors | Unknown root and nested URLs return 404 with noindex and links home/docs |

Browser QA corrected a low-contrast label in the synthetic component example and reduced documentation anchor scroll margin to avoid counting the global scroll padding twice. Regression checks cover the resulting contrast and contents state.

## Repeat static and HTTP checks

```sh
npm run check --prefix apps/website
npm run check:production --prefix apps/website
```

Run the production output in the repository's local Cloudflare runtime:

```sh
npx wrangler pages dev apps/website/dist --ip 127.0.0.1 --port 4622 --compatibility-date 2026-09-02
SPEC_LAYER_SITE_MODE=production WEBSITE_URL=http://127.0.0.1:4622 node apps/website/scripts/check-http.mjs
```

Use a compatibility date supported by the installed runtime. A local emulation pass verifies the candidate's rule files; it does not establish deployed domain/CDN behavior. After public launch, run the same HTTP script with `WEBSITE_URL=https://spec-layer.com`.

For private review, restore preview mode with `npm run check --prefix apps/website`. The local preview server is `npm run dev --prefix apps/website` at `http://127.0.0.1:4621/`.

## Repeat browser checks

Browser testing is optional tooling and does not add dependencies to the static website build. Provision tools in a temporary folder:

```sh
npm install --prefix /tmp/spec-layer-qa playwright@1.62.1 axe-core@4.11.0
PLAYWRIGHT_BROWSERS_PATH=/tmp/spec-layer-qa-browsers node /tmp/spec-layer-qa/node_modules/playwright/cli.js install chromium webkit
```

With the local preview server running:

```sh
PLAYWRIGHT_MODULE=/tmp/spec-layer-qa/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/spec-layer-qa-browsers \
AXE_SCRIPT=/tmp/spec-layer-qa/node_modules/axe-core/axe.min.js \
BROWSER_REPORT_DIR=/tmp/spec-layer-browser-report \
node apps/website/scripts/check-browser.mjs
```

Set `CHROME_PATH` to an existing Chrome executable to use it instead of downloaded Chromium. `BROWSER_ENGINES=chromium` or `webkit` narrows an investigation. The script saves screenshots and a JSON report; failed assertions return a failing exit status. It tests checkout destinations without initiating purchases or sending messages.

## Remaining launch checks

1. Complete the manual screen-reader and native 200% zoom review, or explicitly record an accepted release limitation. Check headings, landmarks, menu state, pricing changes and clipboard announcements.
2. Review the candidate and approve the public switch. Reconfirm the currently live deployment and domain binding immediately before uploading the exact checked production output.
3. Verify all canonical URLs, policy/support pages, schema bytes, redirects, robots directives, sharing image and true 404 responses on the public domain. Verify Cloudflare's managed crawler preferences remain intact.
4. Record the new deployment and source/archive identity. Confirm the documented rollback is still available.
5. Submit the sitemap through the verified Search Console property and record submission. Inspect indexing after recrawl; no ranking outcome is promised.
