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

First run creates the project and prints the `*.pages.dev` URL.

The v5 schemas are committed at
`apps/landing/schemas/foundation-context/v5.json` and
`apps/landing/schemas/component-context/v5.json`. Their permanent public URIs
are:

```text
https://spec-layer.com/schemas/foundation-context/v5.json
https://spec-layer.com/schemas/component-context/v5.json
```

A successful Pages upload does not by itself prove that either permanent URI works.
Before a release that publishes or relies on v5 artifacts:

1. Confirm `spec-layer.com` is attached as a Cloudflare Pages custom domain and
   its DNS record is active.
2. Fetch both live URIs and confirm each returns HTTP 200 with JSON whose `$id`
   is exactly its permanent URI above.
3. Compare both live responses with their committed files so the schemas served
   at the permanent URIs are the release candidates, not older deployments.

The `*.pages.dev` preview is useful for staging, but it is not a substitute for
custom-domain, DNS, and live-URL verification. Any DNS, HTTP status, `$id`, or
live-versus-committed parity failure is a release blocker.

## Checkout links

The Lemon Squeezy buy links live in the two constants at the top of the
`<script>` block in `index.html` (`CHECKOUT_MONTHLY`, `CHECKOUT_YEARLY`).
Swap them there when the variants change.
