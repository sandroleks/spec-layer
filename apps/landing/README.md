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

## Website release source

The redesigned website and all current support/policy pages are maintained in
`apps/website`. See [the implementation and launch record](../website/IMPLEMENTATION.md).
Build the production candidate with:

```sh
npm run check:production --prefix apps/website
```

The verified existing Cloudflare Pages project is `speclayer-landing`, a direct
upload project bound to `spec-layer.com`. The release output is
`apps/website/dist`. Deploy the reviewed production artifact using the launch
procedure in that record; uploading this older `apps/landing` directory would
restore outdated content and omit the new documentation.

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
