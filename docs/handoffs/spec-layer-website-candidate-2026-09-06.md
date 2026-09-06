# Spec Layer website production candidate

Prepared 6 September 2026. The website implementation is saved on `codex/website-production-integration` at source commit `bc763e4bcc55022758718c75b1bb6d078e1b73fa`.

[Review the private website](https://spec-layer-next.oleksandr-kurchev.chatgpt.site/) and [documentation](https://spec-layer-next.oleksandr-kurchev.chatgpt.site/docs/).

## Delivered

- Developer/community homepage, six documentation pages, and all five current support/policy pages.
- Preview and production CI checks; 12 canonical pages, 29 permanent redirects, preserved schemas, examples, metadata and disclosures.
- Chromium/WebKit regression script and screenshots: 42 scenarios passed; all 12 pages fit nine viewport widths.
- Twelve desktop pages passed axe WCAG A/AA checks. Keyboard and native clipboard behavior were verified; a manual screen-reader session and native 200% zoom review remain.
- Full root CI passed on the isolated committed baseline plus the website integration: 2,207 tests passed, 9 todo, zero dependency vulnerabilities. Concurrent extractor work was kept separate.
- Fifty production responses verified in the local Cloudflare runtime. Public edge verification is a post-launch step.

## Files

- `spec-layer-website-candidate-2026-09-06.zip`: standalone website source, scoped monorepo integration patch, verification evidence, and production archive.
- `spec-layer-website-production-2026-09-06.tar.gz`: exact checked production `dist/` directory; no private Sites binding.
- `spec-layer-website-production-2026-09-06.manifest.json`: per-file SHA-256 hashes and source identity.

Candidate ZIP SHA-256: `f3c99a8cdff9e6874ac779cb67b7e15a339693f759e1ba2e339c20ba7f05e384`.

Production archive SHA-256: `9a504eda55d1e036d2a9e8bf86fb72b05016d3540cdd6ecf8993bdaa20e1e946`.

The extracted standalone source passes its build/check command. Production artifact bytes match the local Cloudflare candidate. Archives are delivered alongside this record in the task workspace; generated deployment archives are not source-controlled.

## Public launch

The verified target is Cloudflare Pages project `speclayer-landing`, direct upload, with `spec-layer.com` attached. There is no Git-provider build setting to repoint. The reviewed production `dist/` is the deployment input.

The existing deployment `a24d34c5-c24b-4957-b0db-8f52f46f318d` is the recorded rollback target. Its support/policy pages were checked at `https://a24d34c5.speclayer-landing.pages.dev` and match the current authored source.

Finish the remaining manual accessibility review, review/approve the public switch, reconfirm the current host/deployment, and publish the exact checked artifact. Then run the public HTTP/browser checks and submit the sitemap through the verified Search Console property. The public switch and Search Console submission have not been performed.

See `apps/website/IMPLEMENTATION.md` for the launch/rollback procedure and `apps/website/ACCEPTANCE.md` for the verification record. The prior implementation-handoff archive is preserved as history.

## Private preview delivery

Version 6 of the existing owner-only Sites preview is live. Post-deployment checks passed for all 12 canonical pages: HTTP 200, correct canonical URLs, HTML noindex; an unknown URL returns HTTP 404. Private deployment source is `ee589ad6dee4e1205a18f9e0943f8d5e2c083ad1`. The preview is a separate build mode of the same website implementation.

## Production launch completed

The user authorized production publication with “push to prod”. The exact checked archive above is now live at [spec-layer.com](https://spec-layer.com), through Cloudflare production deployment `84a48c4f-90b1-48f4-867f-a3128929215a` and immutable URL `https://84a48c4f.speclayer-landing.pages.dev`.

All 50 public HTTP checks and 42 Chromium/WebKit browser scenarios passed. The existing crawler preferences are preserved; all 12 canonical pages are indexable, the sitemap is public, schemas match source, and unknown URLs return 404. The previous deployment remains available for rollback. Production evidence is in `docs/reviews/2026-09-06-website-production/`.

Search Console submission and the documented manual accessibility follow-ups remain pending. The earlier candidate package and its hashes are unchanged; this launch record supersedes its pre-launch status.
