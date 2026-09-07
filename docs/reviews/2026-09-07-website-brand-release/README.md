# Website branding release — 7 September 2026

Published to https://spec-layer.com after the user requested “push website live”. The exact checked production output was copied to an isolated staging directory and deployed to the existing `speclayer-landing` Cloudflare Pages project on its production branch.

The release includes shared website colors, identity and fonts; component states; new gallery panels with responsive close-ups; and the refreshed social preview. The Foundations screenshot includes “Copy all for AI”. No plugin package, Figma listing, or repository settings were published.

## Verification

The production build passed all route, link, schema, content-preservation, SEO, brand, and artwork checks. After deployment, all 50 public HTTP checks passed and all 32 delivered static assets matched the frozen candidate byte for byte.

Targeted live browser review verified homepage branding and production indexing metadata at 1440px, the desktop Foundations gallery, the mobile Library close-up at 390px, and the CLI documentation at 390px. No page-wide mobile overflow was found. Browser viewport overrides were reset. The full cross-engine regression suite and manual assistive-technology review were not rerun during this deployment.

## Evidence and rollback

`release.json` records the deployment and rollback identifiers; `candidate.json` records every staged file hash. `production.tar.gz` preserves the exact checked output. `live-http.json` and `live-assets.json` record the public checks. Browser evidence is in `homepage-live.png` and `gallery-mobile-live.png`.

The previous verified production deployment is `2c51cdd0-f871-42e8-97d8-60e70d059a06`, available at https://2c51cdd0.speclayer-landing.pages.dev. Use Cloudflare Pages production rollback to that deployment if necessary; do not substitute the historical local landing source.
