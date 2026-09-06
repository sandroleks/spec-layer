# Spec Layer landing page

One static page, no build step. `index.html` plus the logo, screenshots, and
two vendored libraries: `lenis.min.js` (smooth scroll) and `motion.js`
(the vanilla JS build of Motion/Framer Motion, used for entrance reveals,
hover/press feedback, the gallery scroll tween, the pricing toggle, and the
FAQ accordion). Both are plain `<script>` includes, no bundler.

## Preview locally

```sh
npx -y http-server apps/landing -p 4620 -c-1
```

Or use the `landing` config in `.claude/launch.json`.

## Deploy (Cloudflare Pages)

```sh
npx wrangler pages deploy apps/landing --project-name speclayer-landing
```

(After Phase 2 of `docs/superpowers/plans/2026-09-06-website-update.md` lands,
the deploy directory becomes `dist/site`; see that plan.)

First run creates the project and prints the `*.pages.dev` URL.
`spec-layer.com` is attached as the custom domain.

`404.html` is served for every unmatched path. Without it, Pages falls back to
`index.html` with HTTP 200, which on 2026-09-06 hid a missing schema file for
days.

The v5 schemas are committed at
`apps/landing/schemas/foundation-context/v5.json` and
`apps/landing/schemas/component-context/v5.json`. Their permanent public URIs
are:

```text
https://spec-layer.com/schemas/foundation-context/v5.json
https://spec-layer.com/schemas/component-context/v5.json
```

A successful Pages upload does not by itself prove that either permanent URI
works. After every deploy, and before any release that publishes or relies on
v5 artifacts, run the live check against both hosts:

```sh
npm run check:landing-live
npm run check:landing-live -- --base https://speclayer-landing.pages.dev
```

It fetches both URIs, compares the bytes with the committed files, checks the
content type, and confirms a missing path returns 404. Any failure is a release
blocker. The `*.pages.dev` preview is useful for staging, but the custom domain
is what artifacts point at, so the first command is the one that counts.

## Checkout links

The Lemon Squeezy buy links live in the two constants at the top of the
`<script>` block in `index.html` (`CHECKOUT_MONTHLY`, `CHECKOUT_YEARLY`).
Swap them there when the variants change.
