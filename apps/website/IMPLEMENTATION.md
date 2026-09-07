# Spec Layer website implementation and launch

**Latest release, 7 September 2026:** shared branding and refreshed screenshot/social assets are live at https://spec-layer.com. All 50 public HTTP checks and exact parity for 32 static assets passed. See `docs/reviews/2026-09-07-website-brand-release/` for the current release and rollback record. The earlier launch record below is historical.

Updated 6 September 2026. The website is live at [spec-layer.com](https://spec-layer.com). The user authorized production publishing with “push to prod”. The exact checked production artifact was deployed to the existing Cloudflare Pages project; all 50 public HTTP checks and 42 browser scenarios passed. See `docs/reviews/2026-09-06-website-production/` for delivered-response, browser, screenshot, and deployment evidence.

Review the [private website](https://spec-layer-next.oleksandr-kurchev.chatgpt.site/) and [documentation](https://spec-layer-next.oleksandr-kurchev.chatgpt.site/docs/). See [ACCEPTANCE.md](ACCEPTANCE.md) for measured results, browser evidence, and the remaining manual/launch checks.

## Completed integration

- Homepage, six documentation pages, support, privacy, terms, security, and refunds share the website design and navigation. All five support/policy bodies match the published text and links checked on 6 September 2026; their dates and disclosures are preserved.
- The policy source was recovered from `aac056d2c1f30604e2a873672055bbc4a683fc46`, compared with the live pages, and recorded in `content/source-pages/manifest.json`. Only internal `.html` policy links are normalized to their existing clean URLs.
- `.github/workflows/ci.yml` now verifies preview and production website builds after the unchanged root CI gate. No CI deployment is added.
- Both build modes check 19 HTML files, 12 canonical pages, 29 redirects, metadata, examples, schema parity, and exact policy content preservation.
- Chromium and WebKit verification covers all 12 pages and nine viewport widths. Browser QA corrected a low-contrast example label and double-counted anchor spacing that left the contents highlight on the previous section.
- The existing Cloudflare project and a complete rollback deployment are verified. Local Cloudflare Pages verification exercises the generated routing/header files, including 50 delivered-response checks.

## Scope and architecture

The implementation uses plain HTML, CSS, browser JavaScript, and a dependency-free Node 22+ generator. It changes the website and repository website checks only. Plugin, extractor, CLI, proxy, checkout variants, pricing behavior, and product contracts are outside this implementation.

| Surface | Editable source |
| --- | --- |
| Homepage | `content/index.html` |
| Documentation | `content/docs/*.html`, `docs.config.mjs`, `scripts/docs.mjs` |
| Support and policies | `content/source-pages/`, `pages.config.mjs`, `scripts/pages.mjs` |
| Shared header/footer | `scripts/layout.mjs` (homepage retains its own source markup) |
| Styles and interactions | `public/styles.css`, `public/docs.css`, `public/app.js` |
| Metadata, sitemap, redirects | `site.config.mjs`, `scripts/seo.mjs` |
| References | `public/schemas/`, `public/examples/`, `public/example-button.yaml` |
| Verification | `scripts/check*.mjs`, `ACCEPTANCE.md` |

Generated HTML/crawl files and `dist/` are output. See [AUTHORING.md](AUTHORING.md) to extend the docs. Keep both permanent schema files byte-identical to the extractor; `public/schemas/` is now the only copy, and the extractor's parity tests and `npm run check:site-live` both read it.

## Verified public host

| Setting | Observed value, 6 September 2026 |
| --- | --- |
| Platform and project | Cloudflare Pages, `speclayer-landing` |
| Domains | `spec-layer.com`, `speclayer-landing.pages.dev` |
| Deployment model | Direct upload; no Git provider configured |
| Current production branch | `main` |
| Current production deployment | `84a48c4f-90b1-48f4-867f-a3128929215a` |
| Current production source | `bc763e4bcc55022758718c75b1bb6d078e1b73fa` |
| Previous production deployment / rollback | `a24d34c5-c24b-4957-b0db-8f52f46f318d` |
| Rollback deployment URL | `https://a24d34c5.speclayer-landing.pages.dev` |
| Previous source metadata reported by host | `f6f193b`; use actual content verification because direct uploads can contain uncommitted source |

These values were read through authenticated Wrangler project/deployment listing. All five support/policy URLs on the rollback deployment return 200 with text and links matching the verified source. Evidence is in `docs/reviews/2026-09-06-website-implementation/rollback.json` in the monorepo.

A direct-upload project has no Git build integration to repoint. The production build/check happens locally or in CI; the reviewed `dist/` output is uploaded explicitly. The superseded `apps/landing` source was deleted on 7 September 2026; it survives only in Git history and must never be deployed, because it predates published disclosures.

## Release procedure

1. Review the candidate and remaining manual accessibility checks in `ACCEPTANCE.md`. Keep the Sites review private and in preview mode.
2. Check the prepared production archive's SHA-256 against the candidate record under `docs/handoffs/`. It contains only `dist/` and no private Sites configuration. Extract it to a fresh directory and deploy that exact checked output after public-launch approval.
3. Reconfirm the project/domain and currently live deployment immediately before launch. If another deployment has appeared, reconcile it before replacing it and update rollback evidence.
4. Upload the extracted production `dist/` using the repository's authenticated Wrangler:

   ```sh
   npx wrangler pages deploy /absolute/path/to/extracted/dist --project-name speclayer-landing --branch main
   ```

5. Wait for successful deployment. Record its identifier, URL, source revision, and archive digest. Verify the delivered public site, not only the upload result:

   ```sh
   SPEC_LAYER_SITE_MODE=production WEBSITE_URL=https://spec-layer.com node apps/website/scripts/check-http.mjs
   ```

6. Check the homepage and docs in a browser, including old bookmarks and all policy/support links. Preserve the domain's existing Cloudflare crawler preferences. Confirm public canonical pages have no `noindex` in HTML or headers.
7. Use the verified Search Console property to submit `https://spec-layer.com/sitemap.xml`; inspect the homepage and one docs URL. Record submission and review indexing reports after recrawl. No verification token is guessed or embedded in this source.

For a fresh source build, run `npm run check:production --prefix apps/website`; that leaves a production-mode `dist/`. For private Sites publishing, rebuild with `npm run check --prefix apps/website` first. Build mode changes do not change host access.

## Rollback

In the existing Cloudflare Pages project's production deployment history, roll back to `a24d34c5-c24b-4957-b0db-8f52f46f318d` if the public release fails its checks. Recheck the homepage, all five policy/support pages, and both permanent schemas after rollback. Do not rebuild the deleted `apps/landing` source from Git history as a substitute: it predates some published disclosures.

## Route contract

| URL | Intended production behavior |
| --- | --- |
| `/`, `/#features`, `/#pricing` | Homepage and preserved anchors |
| `/docs/` | Documentation overview, 200 |
| `/docs/quickstart/`, `/docs/outputs/`, `/docs/cli/`, `/docs/configuration/`, `/docs/schemas/` | Documentation content, 200 |
| `/docs.html#…` | One 301 to quickstart; query preserved and browser keeps fragment |
| Old docs `.html`, extensionless, and `index.html` aliases | One 301 to canonical directory URL |
| `/support`, `/privacy`, `/terms`, `/security`, `/refund` | Current content, 200; `.html` and trailing-slash aliases 301 |
| `/schemas/component-context/v5.json`, `/schemas/foundation-context/v5.json` | 200 JSON; fixed `$id` and exact source bytes |
| `/sitemap.xml`, `/robots.txt`, `/social/spec-layer.png` | 200 with correct MIME type |
| Unknown root or nested URL | HTTP 404 with useful navigation and HTML `noindex` |

Both the local Cloudflare runtime and the public domain passed this contract on 6 September 2026. The Sites preview uses its own `.html` normalization and ignores Cloudflare rule files; its HTML `noindex` and bookmark fallback remain intentional.

## Source delivery

The website implementation is saved on the isolated monorepo review branch `codex/website-production-integration`. The shared working tree also retains the editable website source. The private Sites source is separately versioned and published. Other work is actively changing extractor files in this checkout, so the root CI gate was run against an isolated copy of committed `f6f193bf5d862c2cb499945773fa374602606c2e` plus the website integration. No extractor edits were included or modified by this task.

The new candidate package includes standalone website source, a scoped repository-integration patch, production output, and verification evidence. The earlier implementation-handoff archive is historical and has not been replaced.
