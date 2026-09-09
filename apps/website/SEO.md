# Search and sharing setup

The final canonical origin is `https://spec-layer.com`, configured in `site.config.mjs`. The Sites address is a private review location. This work does not move the public domain or change access to the preview.

## Generated on every build

- Unique page titles and descriptions, with an optional `seoTitle` in the docs registry.
- One absolute canonical URL per page. Directory URLs such as `/docs/cli/` avoid `.html` normalization differences across static hosts.
- Open Graph and large-image social card tags with absolute image URLs, dimensions, and alternative text.
- `WebSite` identity on the homepage, `WebPage` data on content pages, and documentation breadcrumbs. No fabricated ratings, offers, publication dates, or search actions.
- `sitemap.xml` with the homepage, six canonical documentation pages, and five support/policy pages. New registered pages are included automatically; aliases, downloads, and the error page are excluded. No synthetic last-modified dates.
- `robots.txt`, preserving the existing domain's crawler preferences. With `cloudflareManagedRobots: true`, production emits the sitemap and Cloudflare supplies crawler groups once. Preview retains the source groups. If moving away from Cloudflare's managed robots service, set this option to false to emit `content/robots.production.txt` in production too. Live checks verify that the delivered policy stays aligned.
- Cloudflare-compatible `_redirects` for old documentation links and duplicate index URLs, plus `_headers` for the selected indexing mode. The local server applies the same redirect map.
- A `404.html` with `noindex`, which prevents a missing route from being treated as a successful homepage on Cloudflare Pages.

These features support discovery and accurate previews; they do not guarantee indexing, rankings, or rich results.

## Preview and public build modes

`npm run build`, `npm run check`, and `npm run dev` default to **preview**. HTML and static response rules carry `noindex`; robots.txt does not advertise the sitemap. Authentication remains the actual access boundary. Crawling is not globally disallowed, so an accessible crawler can read the `noindex` directive.

```sh
npm run check:production
```

This verifies the **production** build locally with indexing enabled on content pages and the sitemap declared in robots.txt. It does not publish anything. `npm run build:production` creates the same public build without checks. Any value other than `preview` or `production` for `SPEC_LAYER_SITE_MODE` fails instead of guessing.

After inspecting a production build, run `npm run build` before publishing to the private Sites preview. The final deployed build for `spec-layer.com` must use production mode. Check the delivered HTML and headers after deployment: a CDN or host can add its own indexing rules.

Canonical and social image URLs intentionally reference the final domain in both modes. The new social image will be publicly fetchable only after the production launch. Social crawlers cannot inspect an authenticated private preview.

The current Sites static preview does not apply the uploaded `_redirects` or `_headers` files. Its native `.html` normalization returns 307 redirects, and content pages carry `noindex` in HTML. A client-side compatibility fallback sends recognized legacy quickstart anchors from `/docs/` to their original sections in `/docs/quickstart/`. Bare `/docs.html` links resolve to the documentation overview on this preview host. Production Cloudflare redirect rules explicitly send that URL to the quickstart. Confirm the delivered behavior again when moving to the public host.

## Social artwork

`public/social/spec-layer.png` is a committed 1200 × 630 image using the site's typography and palette. `scripts/social.mjs` reproduces it using the existing monorepo `sharp` installation and the bundled Manrope font. Run `npm run social:render` from the full monorepo to update it. The gallery uses original PNG files without image processing.

## Delivery improvements and search submission — 8 September 2026

The build combines the shared tokens, brand CSS, and website CSS into `styles.bundle.css`, eliminating chained CSS imports. Source branding and fonts stay unchanged; the shared heading font is preloaded. Edit source styles rather than the generated bundle.

The gallery uses the user's original PNGs, including their embedded transparency, corners, and shadows, for both display and full-size links on every viewport. Do not generate resized versions, crop, recompress, or substitute other captures. The original source folder is `screenshots/updated media/website gallery/`; copies under `public/screenshots/` must remain byte-identical. Builds remove the retired responsive-image directory and optimize only stylesheet delivery.

The production Pages alias redirects to the custom domain through the account-level Bulk Redirect rule `Spec Layer production alias to custom domain`, using the list `spec_layer_production_domain`. It preserves paths and query strings and excludes deployment subdomains; Pages `_redirects` cannot define host-level redirects. Cloudflare's active www rule matches `http.host eq "www.spec-layer.com"`, redirects dynamically to `concat("https://spec-layer.com", http.request.uri.path)`, and preserves query strings for both HTTP and HTTPS requests. The live HTTP check covers all host and protocol variants.

Search Console domain verification was already complete. The sitemap was submitted and processed successfully on 8 September, with 12 discovered pages. The initial performance baseline contained one impression and no query rows; content expansion should use meaningful query evidence once available. See the dated SEO review for release validation and indexing requests.

## URL preservation and launch handoff

Read-only checks on 2026-09-06 found the current public homepage and the following support/policy routes returning 200. Their `.html` forms already redirect to clean URLs. The current production site has no sitemap (404).

| Existing URL | Launch behavior |
| --- | --- |
| `/` and `/#pricing` | Keep the homepage and pricing anchor. |
| `/#features` | Retained as an anchor within the product section. |
| `/docs.html#…` | Redirect to `/docs/quickstart/#…`; existing section IDs remain. |
| `/docs/cli.html` and other old docs URLs | Redirect to the corresponding `/docs/cli/` directory URL. |
| `/privacy`, `/terms`, `/security`, `/refund`, `/support` | Preserve the current pages and their `.html` aliases at the public host. |
| `/schemas/component-context/v5.json` and `/schemas/foundation-context/v5.json` | Keep exact schema URLs and verify extractor parity at launch. |

**Support and policies are now included in this directory.** Their text, links, dates, and disclosures match the public source checked on 6 September 2026. `pages.config.mjs` registers these five clean URLs; their `.html` and trailing-slash aliases redirect to the existing destinations. The sitemap contains all 12 canonical content pages. The build fails if preserved source or generated policy content changes without an explicit source reconciliation.

Once the final deployment and route preservation are approved and complete:

1. Confirm all 12 sitemap URLs return 200 at `spec-layer.com`, with self-referencing canonicals, no login requirement, and no `noindex` response/header on content pages.
2. Confirm old documentation URLs redirect once, old anchors work, policy/support pages remain available, schema URLs serve the expected JSON, and unknown URLs return 404.
3. Verify the existing domain property in Google Search Console, or add one using the verification method provided by Google. No verification token is guessed or embedded in this website.
4. Submit `https://spec-layer.com/sitemap.xml` using the verified property's Sitemaps report, then inspect the homepage and one documentation URL. Check indexing reports after Google recrawls.

Search Console verification/submission remains a public launch operation. It has not been performed against the private preview.

## Reference guidance

- [Google: canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google: sitemaps and submission](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Open Graph metadata](https://ogp.me/)
- [Cloudflare Pages routing and 404 behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- [Cloudflare static redirects](https://developers.cloudflare.com/workers/static-assets/redirects/)
- [Cloudflare static headers](https://developers.cloudflare.com/workers/static-assets/headers/)
