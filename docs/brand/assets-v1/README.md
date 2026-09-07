# Spec Layer — screenshots and artwork 01

Prepared 7 September 2026 on `codex/shared-design-system`. Local review only; no website deployment, Figma listing update, or repository settings change has been made.

Open <http://127.0.0.1:4652/> for the standalone review board, theme switching, individual downloads, and the complete ZIP. The website gallery at <http://127.0.0.1:4621/#canvas> uses the new artwork and responsive close-ups.

## The set

| Asset | Size | File |
| --- | --- | --- |
| Plugin listing cover | 1920 × 1080 | [figma-cover.png](exports/figma-cover.png) |
| Component documentation panel | 1920 × 1080 | [gallery-component-docs.png](exports/gallery-component-docs.png) |
| Foundations panel | 1920 × 1080 | [gallery-foundations.png](exports/gallery-foundations.png) |
| Library and updates panel | 1920 × 1080 | [gallery-library-updates.png](exports/gallery-library-updates.png) |
| Website social preview | 1200 × 630 | [social-card.png](exports/social-card.png) |
| Repository social preview | 1280 × 640 | [repository-social.png](exports/repository-social.png) |
| Plugin icon | 128 × 128 | [icon-128.png](exports/icon-128.png) |
| Large icon | 512 × 512 | [icon-512.png](exports/icon-512.png) |
| Existing vector symbol | SVG | [symbol.svg](exports/symbol.svg) |
| Three raw UI views, both themes | 480 × 680 each | [captures](captures/) |

The listing cover and icon use Figma's currently recommended sizes in its [plugin publishing guidance](https://help.figma.com/hc/en-us/articles/43029200314135-Publish-generative-plugins-to-the-Figma-Community). The repository image follows [GitHub's 1280 × 640 recommendation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview). Confirm the destination uploader during the final release review.

## Visual rules

Use the existing static four-part symbol, lower-case visual wordmark, Manrope display typography, graphite canvas, and shared violet accent. Preserve the source geometry and clear space. Do not animate or color-code the symbol by feature.

The cover and social cards use the website's existing message: “Your design system. Ready to build.” The gallery gives each workflow a specific action and result. No new product name or alternate palette is introduced.

Screenshots are straight-on with no perspective or retouching. The surrounding artwork is authored from the shared tokens and vector source. It does not invent a Figma window, completed document, or product behavior. Dark captures form the website sequence; light captures are included for other contexts. Always label synthetic content as sample data in the composition or adjacent caption.

On the website, desktop images are composed panels. At 760px and below, a `picture` source shows the raw interface capture. Full-size links point to that same uncluttered capture. The captions and alternative text describe controls visible in the image, rather than claiming to show generated canvas output.

## Capture provenance

Captured through the browser from the built plugin renderer at `http://127.0.0.1:4651/ui-harness.html`, at a 480 × 680 viewport:

- Component: `view=component&state=ready&facts=variants&expand=specs`
- Foundations: `view=foundations`
- Library: `view=library&state=expanded`
- Each view was captured with `theme=dark` and `theme=light`.

These are real renderer captures with synthetic fixtures from `packages/plugin/src/ui/harness.ts`. They are not AI-generated UI, native Figma screenshots, or evidence of successful host operations. Capture hashes and source-build hashes are recorded in `captures/provenance.json`. Existing customer-output examples remain archived in earlier review records. Fresh native canvas-output captures belong to the integrated product review.

## Rebuild and maintain

From the repository root:

```sh
UI_HARNESS=1 node packages/plugin/build.mjs
node packages/plugin/preview-design-system.mjs
```

Visit each capture URL at 480 × 680 and save an unretouched viewport screenshot under `captures/`. Check both themes, labels, footer actions, selection, and scroll position. Record provenance again when recapturing; do not update a hash to conceal a changed source.

```sh
node docs/brand/assets-v1/render.mjs
npm run check --prefix apps/website
node docs/brand/assets-v1/serve.mjs
```

`render.mjs` is the editable master for all composed artwork. It uses the existing optional `sharp` authoring dependency, the shared token source, licensed Manrope font, static symbol, and raw captures. `npm run social:render --prefix apps/website` runs the same master. Ordinary website builds consume the committed PNGs and require no image-authoring library.

The artwork manifest records source and export hashes. The website check catches stale artwork after token, font, symbol, screenshot, or master changes; verifies dimensions; and compares seven website image copies. Regenerate after intentional source changes, then inspect the result. Refresh the download ZIP after changing deliverables.

Website copies are `public/gallery-*.png`, `public/screenshots/*-dark.png`, and `public/social/spec-layer.png`. Edit the master and captures rather than these copies. Listing and repository exports remain local until release.

## Release review

Inspect the installed plugin in Figma against these captures, verify generated customer output, and check the final listing thumbnail crop. Review website/social previews and the plugin release together before publication. This package does not claim native host verification or complete accessibility coverage.
