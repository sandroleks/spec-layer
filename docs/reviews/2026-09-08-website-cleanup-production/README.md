# Website cleanup production release

Published all approved website cleanup and the three supplied gallery screenshots to https://spec-layer.com on 8 September 2026.

- Removed the illustration title and closing note; expanded the destination rows, aligned panel titles, removed the header arrow, and tightened list spacing.
- Hid View full size, removed the developer note, and removed the shared footer tagline.
- Component docs, Foundations, and Library & updates use createdoc.png, foundations.png, and library.png from the supplied website gallery folder, on desktop and mobile.
- Production build, route/link/schema/brand/artwork checks passed. Live verification passed 44 Chromium/WebKit scenarios and 50 HTTP checks.
- Homepage markup, scripts, styles, and all three images match the release. The homepage comparison ignores only Cloudflare’s injected challenge-platform security script.

See release.json for deployment and rollback identifiers, browser.json and http.json for test results, and content-parity.json for asset verification. The production output and scoped source patch remain in /tmp/spec-layer-cleanup-release/. No unrelated CLAUDE.md edits were included in the deployment.
