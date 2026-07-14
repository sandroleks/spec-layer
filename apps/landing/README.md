# Spec Layer landing page

One static page, no build step. `index.html` plus the logo and two screenshots.

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

## Checkout links

The Lemon Squeezy buy links live in the two constants at the top of the
`<script>` block in `index.html` (`CHECKOUT_MONTHLY`, `CHECKOUT_YEARLY`).
Swap them there when the variants change.
