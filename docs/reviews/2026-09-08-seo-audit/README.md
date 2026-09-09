# Spec Layer SEO audit

Audited 8 September 2026 against **https://spec-layer.com**. Read-only audit; no website, DNS, crawler-policy, or Search Console settings were changed.

## Assessment

The main HTTPS site has a sound technical foundation. All 12 sitemap pages return 200, have unique titles and descriptions, self-referencing canonical URLs, one H1, and indexable directives. Rendered JSON-LD is present and parses on every page. All pages are reachable within two links from the homepage, with no broken anchors found between audited pages.

**Fix the HTTP www routing first, then submit the sitemap in the verified Search Console property.** Mobile performance is already strong; image delivery and stylesheet discovery are secondary improvements. A Lighthouse SEO score measures its automated checks, not rankings, content competitiveness, or actual indexing.

The owner confirmed that Search Console is verified and the sitemap has **not** been submitted. Search Console reports, backlink data, search volumes, and real-user performance were not available to this audit.

## Prioritized findings

### 1. High — HTTP www serves a registrar parking page

**Evidence:** A direct GET to `http://www.spec-layer.com/` returns **200**, with Namecheap parking content and no canonical URL. `http://www.spec-layer.com/docs/` and `/docs/cli/?audit=1` return **404**. This was reproduced in separate requests. HTTPS www and HTTP apex already return 301 redirects to the correct HTTPS apex URL, preserving path and query.

**Impact:** Visitors and crawlers following the HTTP www variant reach unrelated content or errors. Links to that variant do not lead to the product or pass through a permanent redirect.

**Fix:** Inspect the domain’s existing redirect rules and www origin. Make www redirect to `https://spec-layer.com` for both HTTP and HTTPS, preserving path and query. Ensure the redirect runs before requests reach the parking origin. Do not rely on a browser upgrading HTTP automatically. Extend release checks to all four protocol/hostname combinations.

**Acceptance:** `http://www.spec-layer.com/docs/cli/?audit=1` returns 301 or 308 with `Location: https://spec-layer.com/docs/cli/?audit=1`; the destination returns 200. [Google’s permanent-redirect guidance](https://developers.google.com/search/docs/crawling-indexing/301-redirects).

Evidence: `host-variants.json`, `host-paths.json`, `http-www-home.html`, `http-www-docs.html`.

### 2. High — Submit the existing sitemap and establish an indexing baseline

**Evidence:** Owner confirmation: domain verified, sitemap not submitted. The live sitemap returns 200 and contains 12 canonical URLs. Robots.txt already advertises it, so discovery is possible without manual submission.

**Impact:** There is no confirmed submission/reporting baseline for the recent launch. This is a monitoring and discovery action, not evidence that Google is blocked or that the site is unindexed.

**Action:** In the verified property’s Sitemaps report, submit `https://spec-layer.com/sitemap.xml`. Inspect the homepage and `/docs/quickstart/`, check Google-selected canonicals and crawl results, and request indexing for those recently updated pages if appropriate. Record Page Indexing and Performance reports before deciding which pages need more content.

A `site:spec-layer.com` search through the available search provider returned no results, while its direct-page extraction showed older copy. Neither establishes Google’s indexing state. The live HTTP and rendered browser checks both showed the revised copy. [Google on sitemap submission and recrawling](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl), [limitations of the site operator](https://developers.google.com/search/docs/monitor-debug/search-operators/all-search-site).

### 3. Medium — Serve smaller gallery images on mobile

**Evidence:** The homepage downloads `screenshots/createdoc.png` at 1440 × 900, **195,441 bytes**, while the Lighthouse mobile layout displays it at about 372 × 233 CSS pixels. Lighthouse estimates **178 KiB** of potential savings. The mobile `<source>` uses the same full-size PNG. The other gallery screenshots are also 1440 × 900, approximately 187–197 kB each.

**Impact:** Unnecessary mobile download weight when the gallery loads. The screenshot is below the fold and lazy-loaded, so it should not be described as the principal cause of the initial headline’s LCP.

**Fix:** Add appropriately sized responsive variants with `srcset` and `sizes`; evaluate WebP or AVIF while checking small UI text remains readable. Preserve the full-resolution originals for image links, the 16:10 ratio, and the user’s selected screenshots. Choose variants for device pixel density, not CSS width alone. Treat Lighthouse’s byte estimate as an opportunity estimate, not a guaranteed saving. [Google image guidance](https://developers.google.com/search/docs/appearance/google-images).

### 4. Medium — Shorten the stylesheet and font request chain

**Evidence:** Lighthouse observes `HTML → styles.css → brand.css → brand/tokens.css`, with font requests discovered through brand.css. The two transferred Manrope TTF files are approximately 42 kB each. Estimated render-blocking opportunity: 1.2 seconds in the simulated mobile run.

**Impact:** Styles and fonts are discovered in stages before the initial text is fully rendered. Current LCP is about 2.4 seconds in both sampled pages, leaving room for improvement on slower connections.

**Fix:** Preserve the shared brand source, but flatten the generated stylesheet delivery or expose required styles directly in the document head. Consider WOFF2 font delivery and preload only the face required above the fold. Re-measure after the change; Lighthouse opportunity estimates are not additive or promised speed gains. [LCP optimization guidance](https://web.dev/articles/optimize-lcp).

### 5. Low — Consolidate the production pages.dev alias

**Evidence:** `https://speclayer-landing.pages.dev/` and `/docs/` return 200. The homepage carries an indexable robots directive and points its canonical to spec-layer.com.

**Impact:** A duplicate public host remains accessible. The correct cross-domain canonical reduces the risk, so this is not an urgent duplicate-content defect.

**Fix:** Redirect the exact production alias to the corresponding custom-domain path. Keep deployment previews separate; avoid applying noindex to the shared build that also serves the public domain. [Google redirect guidance](https://developers.google.com/search/docs/crawling-indexing/301-redirects).

### 6. Low — Remove duplicated robots groups without changing crawler preferences

**Evidence:** Live robots.txt contains Cloudflare’s managed group block followed by matching groups from the site’s static source. The sitemap directive is present, and Googlebot is allowed.

**Impact:** Maintenance ambiguity rather than a current Google crawling failure. Identical duplicate groups do not create an additional block.

**Fix:** Choose one owner for the managed crawler groups and retain the current preferences. Keep the sitemap declaration in the served file. Verify the final delivered output after any Cloudflare change. Do not remove AI crawler restrictions as a presumed Google SEO fix. [Google robots parsing rules](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec).

## Content and on-page opportunities

The updated homepage names Figma documentation and the three product actions. Documentation pages contain substantive instructions, command examples, output explanations, and links to implementation sources. Titles and descriptions are unique. Several descriptions are short, but padding them to a fixed character count would not improve their usefulness. Google recommends descriptive, concise titles and truncates according to available display width. [Title guidance](https://developers.google.com/search/docs/appearance/title-link).

Current coverage is concentrated in one marketing page and six documentation pages. The strongest next content candidates are illustrated task guides for **documenting a Figma component**, **exporting Figma variables as DTCG tokens**, and **giving a coding agent component specs**. These are hypotheses based on the product and current coverage, not validated search-volume opportunities. Use Search Console query data to prioritize. Add task-specific screenshots, expected outputs, and troubleshooting rather than near-duplicate keyword pages.

Suggested intent mapping:

| Page | Main purpose |
| --- | --- |
| Homepage | Evaluate a Figma design system documentation plugin |
| Documentation overview | Find Spec Layer guides and references |
| Quickstart | Create docs, copy context, and set up a first library pull |
| Output formats | Understand component YAML and DTCG token exports |
| CLI | Look up Spec Layer commands and flags |
| Configuration | Configure token output and automated pulls |
| Schemas | Validate canonical component and foundation exports |

No ranking or backlink conclusions are possible from the evidence collected. Existing WebSite, WebPage, and BreadcrumbList markup was confirmed in the rendered DOM. Extra structured-data types are optional; the absence of SoftwareApplication markup is not a technical failure.

## Performance results

Single-run Lighthouse mobile simulations using Lighthouse 13, local Chrome, and the live public URLs. These are lab measurements, not field Core Web Vitals or a measurement of INP.

| Metric | Homepage | Quickstart |
| --- | ---: | ---: |
| Performance | 96/100 | 94/100 |
| SEO automated checks | 100/100 | 100/100 |
| Accessibility automated checks | 100/100 | 100/100 |
| Best Practices | 81/100 | 81/100 |
| First Contentful Paint | 2.0 s | 2.0 s |
| Largest Contentful Paint | 2.4 s | 2.4 s |
| Total Blocking Time | 20 ms | 180 ms |
| Cumulative Layout Shift | 0.001 | 0 |

The Best Practices deductions identify three deprecated API warnings in Cloudflare’s injected challenge script. They do not identify an application-copy defect or an SEO indexing block. Review that with Cloudflare if it persists; do not disable bot protection solely to improve a score.

Google’s PageSpeed API returned a quota error, so field data was not retrieved. Lighthouse ran locally as the fallback. `lighthouse-summary.json` retains the category scores, metrics, SEO audits, and opportunity estimates for both runs; the full multi-megabyte HTML and JSON reports were not kept.

## Checks that passed and limits

- All 12 canonical pages rendered with 200 responses, one H1, unique metadata, self-canonicals, and no noindex directives.
- JSON-LD parsed in the rendered browser on all pages. This is not a Google rich-result eligibility test.
- All 12 pages are within two homepage links; no broken anchors between audited pages or missing image alt attributes were found.
- Twelve responsive checks across homepage, docs overview, quickstart, and outputs at 360, 390, and 768 pixels found no page-level horizontal overflow.
- Fifty delivered-response checks passed for canonical pages, 29 legacy/path redirects, schemas, selected assets, and real 404 responses. These checks previously omitted the HTTP www host, which is the new finding above.
- Of 16 distinct external URLs in the rendered default page states, 14 returned successful HTTP responses. Figma returned 403 to the automated client and remains unverified. The monthly checkout returned 404 to a raw HTTP client but loaded Spec Layer Pro in the browser with the monthly plan selected; it is not classified as broken. No purchase was made. JavaScript-only destinations, such as the annual checkout URL, were not recrawled in this pass.
- The checkout still states annual savings of “about $30”, while its displayed $7.99/month and $79.99/year prices imply $15.89. This previously recorded checkout-copy issue is separate from technical SEO; the website itself states the correct amount.

## Recommended order

1. Correct HTTP www routing and verify path/query preservation.
2. Submit the sitemap and capture Search Console indexing and query baselines.
3. Add responsive gallery variants and reduce stylesheet/font discovery delays.
4. Consolidate the production alias and simplify robots ownership.
5. Use search-query evidence to choose the first illustrated task guide.

Evidence files in this directory contain the crawl, host tests, HTTP checks, external-link results, sitemap, robots response, and the Lighthouse summary. All observations describe the 8 September 2026 audit; no fixes were deployed during it.
