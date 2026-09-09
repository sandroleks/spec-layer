# Free publishing website copy

Prepared 8 September 2026 from the supplied **Free library publishing with a monthly update allowance** design. Local draft only; no production deployment was made for this change.

## Copy decisions

- Free: 1 published Figma file, 10 updates per UTC calendar month. The first successful publish uses one update.
- Pro: up to 10 published Figma files, unlimited updates subject to the existing fair-use terms.
- An update means a successful publish that changes the library. Failed publishes and unchanged republishes do not count.
- CLI pulls require the library ID and pull key, with no Pro license required, and never consume publishing updates.
- Publishing and AI writing remain separate allowances. The existing AI writing allowance, prices, billing options, and checkout destinations are unchanged.
- Free libraries do not expire. Exhausting publishing updates does not stop developers pulling the last published version.
- Use “Figma file” for plan counts and define “library” in the developer documentation.

## Updated surfaces

Homepage pricing heading, both plan cards, workflow column 03, plan FAQ, new publishing-update FAQ, and a link from pricing to that FAQ. Documentation overview, quickstart, CLI introduction, and output behavior copy. Support publishing troubleshooting, the privacy policy's publishing/usage disclosures, and the terms' service/allowance description. The privacy and terms draft dates are 8 September; align them with the actual rollout date if deployment happens later.

The attached design said CLI docs need no changes because pulling is unchanged. The website's CLI introduction nevertheless contained “Publishing requires Pro”; that sentence was corrected without changing command behavior or examples.

## Review finding before rollout

The intended promise that unchanged republishes never count needs more than the proposed 24-hour response cache:

1. `packages/plugin/src/ui/publish.ts` builds new timestamp-based export IDs and `generatedAt` values on each publish (lines 44–45, 61–62, 258 at review). `packages/proxy/src/libraries.ts` currently hashes the complete serialized bundle (lines 117–122). A byte-level hash changes even when the design does not. Use a stable comparison that excludes incidental metadata while retaining meaningful content changes.
2. After the 24-hour response cache expires, compare against the currently published content before charging an update, including at zero remaining allowance. Otherwise an unchanged republish after a day can consume an update or be rejected.
3. A → B → A within the cache window is a changed publish relative to current B. Returning an old cached A response without writing would leave B published. Keep retry idempotency separate from comparison with the current published version.

Acceptance cases: unchanged publish with fresh timestamps; unchanged publish after 25 hours; unchanged publish at zero remaining; A → B → A; a first publish consuming one update; changed publish number 11 returning the reset date; failed writes consuming no update; free library remaining pullable after the monthly allowance is exhausted.

The website copy follows the intended product rules, rather than exposing implementation details to customers. The backend and plugin still contain Pro-only publishing gates in the reviewed checkout. Release the website after the proxy and plugin support the announced rules, as specified in the design's rollout order.

## Checks

`npm run check --prefix apps/website` passed: 19 HTML routes, internal links and anchors, documentation navigation, SEO metadata, 12 sitemap entries, 29 path redirects, authored policy parity, shared brand and artwork checks. Desktop/mobile browser results and screenshots are stored beside this note. No backend, plugin, CLI implementation, checkout, or production configuration was changed.
