# Spec Layer website redesign

The static marketing and documentation website for Spec Layer. This directory is the production candidate; `apps/landing` retains the previous source and schema copies used by existing release checks.

[IMPLEMENTATION.md](IMPLEMENTATION.md) records the completed integration and the public launch procedure. [ACCEPTANCE.md](ACCEPTANCE.md) records verification results and remaining manual/launch checks.

- `npm run dev` generates pages and serves `public/` at http://127.0.0.1:4621.
- `npm run build` generates pages and SEO metadata in preview mode, then copies public assets into `dist/` without dependencies.
- `npm run check` builds and checks local routes, links, schemas, examples, SEO metadata, redirects, social image dimensions, and indexing rules.
- `npm run check:production` checks a build with public indexing enabled. This does not deploy it.
- `node scripts/check-http.mjs` verifies delivered responses; set `WEBSITE_URL` and `SPEC_LAYER_SITE_MODE` for the candidate.
- `scripts/check-browser.mjs` provides optional Chromium/WebKit release QA; setup is documented in `ACCEPTANCE.md`.
- Home: product workflow, screenshots, developer entry point, community, pricing and FAQs.
- `/docs/`: documentation overview, quickstart, output formats, CLI commands, configuration, and schemas with a runnable validation example.
- Legacy documentation links remain supported. Production redirect rules send `/docs.html` to `/docs/quickstart/`; normalized legacy section bookmarks also have a preview-host fallback.
- `example-button.yaml` is the synthetic fixture from the extractor tests.

Documentation content lives in `content/docs/`; the page registry and shared generator create consistent navigation, contents links, and page metadata. See [AUTHORING.md](AUTHORING.md) to add a page or sync reference assets from the monorepo. Generated pages should not be edited by hand.

Homepage markup lives in `content/index.html`. Shared SEO settings, canonical domain, and social metadata live in `site.config.mjs` and `scripts/seo.mjs`. See [SEO.md](SEO.md) for preview/production behavior and the remaining public launch steps. The default private build carries `noindex`.

Support and all four policies are integrated at their existing clean URLs, using source verified against the public site on 6 September 2026. The build checks exact content preservation against `content/source-pages/manifest.json`. Checkout URLs are the existing monthly and annual Lemon Squeezy variants. The developer guide matches the published CLI 0.4.0; the canonical CLI README remains linked throughout.

Typography uses self-hosted Manrope under the included SIL Open Font License. No external scripts, trackers, runtime libraries, or font requests are required.

The visual direction uses graphite surfaces, violet action color, product-specific diagrams, open layouts, and restrained typography. Impeccable's public craft-floor guidance informed the typography and visual simplification; its CLI was not installed or run.

The follow-up copy and interaction review is documented in `REVIEW.md`, including product facts corrected, validation, and source discrepancies outside the website edit scope.
