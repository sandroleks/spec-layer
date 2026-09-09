# Pricing release — 8 September 2026

Published the current website at the user's explicit request. Free, Pro, and Teams appear side by side on wide screens. Teams shows Custom with a contact CTA; the suggested $99 package is not a listed price or checkout product. The release also contains the reviewed Free-publishing copy and related documentation, support, privacy, and terms updates.

Production build checks passed. All 59 live HTTP checks passed. Browser checks at 320, 390, 768, 1100, 1101, and 1440px passed, verifying three cards, responsive layout, wide-screen button alignment, billing-toggle behavior, and the Teams contact URL. No email or purchase was sent. Evidence is stored in `http.json`, `browser.json`, and the screenshots.

This deployment changes the website only. The reviewed backend and plugin still contain Pro-only publishing gates; availability of the new Free publishing allowance remains unverified. This limitation was communicated before publishing. The user explicitly requested the website release after the earlier draft-only rollout notes. The implementation findings in the free-publishing review remain open.

An initial Cloudflare upload-token authentication error occurred before upload. One retry succeeded. The final deployment and rollback reference are recorded in `release.json`.
