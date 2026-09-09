# Maintaining the documentation

The website uses plain HTML content and a shared static generator. Pages are readable and navigable without JavaScript. JavaScript adds clipboard actions, mobile navigation, and section tracking.

## Copy terminology

Do not call documentation, specifications, or design context “facts”. Use the specific term: documentation, specifications, design details, design tokens, or context.

## Add a page

1. Add `content/docs/your-topic.html` with the page body. Start with a short `<p class="docs-lead">` introduction. The generator supplies the page title and layout, so do not add another `<h1>`, `<main>`, header, or footer.
2. Add an entry in `docs.config.mjs`. Use a unique, URL-safe `slug`, a `title`, a short `nav` label, a `group`, a `description`, and a repository-relative `source` path. An optional `seoTitle` gives search and social previews a more descriptive title while keeping the visible heading concise. Registry order controls navigation and previous/next links. New pages are automatically included in the sitemap and receive canonical/social metadata. A new group is added automatically.
3. Give each main section an explicit ID and heading using `<section id="example"><h2>Example</h2>`. This exact structure supplies the desktop and mobile contents navigation. Use `<h3>` for subsections and preserve existing section IDs when revising published content.
4. Link to the page with `/docs/your-topic/`. Run `npm run check` from this directory, then review the page in the local preview.

Use the existing content pages as examples for code blocks, accessible tables, notices, and download links. Escape `<`, `>` and `&` inside code examples. Where a copy action is useful, use a real button with `data-copy` containing the exact command; escape HTML attribute characters.

Edit shared header/footer markup in `scripts/layout.mjs`, document markup in `scripts/docs.mjs` and document styles in `public/docs.css`. `public/styles.css` and `public/app.js` are also used by the homepage, so verify existing homepage interactions when changing them. No dependencies or client-side router are required.

## Generate and check

```sh
npm run docs:generate
npm run dev
```

The preview runs at `http://127.0.0.1:4621/docs/`. Content and registry changes need `npm run docs:generate` again, or a server restart. Styles and public asset edits can be refreshed directly.

```sh
npm run check
```

This builds the site and checks document landmarks, unique IDs, metadata, registered page navigation, local links and anchors, canonical schema copies, and DTCG reference files. It does not test browser rendering or external services.

`public/docs/`, `public/docs.html`, `public/index.html`, `public/404.html`, the root crawl/redirect files, and `dist/` are generated output. The old `/docs.html` route redirects to the quickstart to retain existing anchor links, with an HTML fallback for hosts that do not apply redirect files. Change source content rather than these generated files. See `SEO.md` for the indexing mode and public launch process.

## Update reference material

From this directory inside the full Spec Layer monorepo, run:

```sh
npm run docs:sync
npm run check
```

The sync script copies the committed canonical component and foundation schemas, the synthetic Button YAML fixture, and the synthetic foundation DTCG files into `public/`. It also updates CLI and Context version metadata in `content/reference.json`. These snapshots are source assets; commit them so reference generation does not depend on live services. Website builds require the shared `packages/brand` source in this monorepo.

Use `{{cliVersion}}` and `{{schemaVersion}}` in content to show snapshot versions. The schema page’s field tables are generated from the schema files, with human-readable explanations in `scripts/docs.mjs`. When schema fields change, review those explanations too.

Review command examples, behavior descriptions, and links against the implementation when syncing. Copying a version number does not verify prose or prove a package is published. Documentation should describe implemented behavior; keep planned commands and features out of the current reference.

The downloadable `public/examples/validate-context.mjs` is a standalone consumer example that requires Ajv in the consuming project. It registers supplied dependency schemas locally; the component schema needs the foundation schema. Canonical Context schemas do not validate the compact AI projections or outer library bundle.

## Maintain support and policies

`pages.config.mjs` registers the five support/policy URLs and their metadata. `scripts/pages.mjs` wraps the verified authored source in the website layout. Update the original body under `content/source-pages/` deliberately; do not edit generated `public/support.html` or the other policy pages.

`check-pages.mjs` checks exact generated body preservation, allowing only `.html` policy links to become their existing clean paths. The generator may reshape the page around the legal text; it may not change a word of it.

These pages carry published legal disclosures, so treat a wording change as a deliberate act: review what the disclosure now says, confirm the generated page differs only as intended, and deploy so the public URL and this source agree. `apps/website` is the only path to production, so the repository is the source of truth by construction. To confirm the live site actually serves what is committed, run `npm run check:site-live` from the repository root.

## Maintain the shared brand

Edit shared colors, identity, fonts, motion, and shape roles in `packages/brand`; the plugin and website consume the same source. `scripts/brand.mjs` runs during build and preview startup, generating `public/brand/tokens.css` and copying the static `public/logo.svg`, Manrope files, and license from the shared package. Do not edit these copies independently.

Use `public/brand.css` for website aliases and font loading, `public/styles.css` for website components and reading sizes, and `public/docs.css` for documentation layout. The website does not import plugin density. Pair action fills with `on-action`, selection with `accent-text`, and use the shared focus role. Illustrative Figma specimens represent customer content and can retain their own colors.

Run `npm run check` after changes. It checks the shared contrast contract, exact palette and asset parity, transitive CSS/font paths, density separation, and page theme metadata. Review desktop/mobile rendering separately. Product captures and social artwork now come from `docs/brand/assets-v1/`. Run `npm run social:render` to regenerate from that master. The gallery must use the exact original PNGs from `screenshots/updated media/website gallery/` at all viewport sizes. Preserve the complete image, embedded transparency, rounded corners, shadows, and its aspect ratio. Do not add CSS rounding, backgrounds, shadows, or clipping to the gallery frame; do not create cropped, compressed, or lower-resolution substitutes. Keep the displayed image and full-size link on the same original file. Native Figma verification remains in the release review phase.
