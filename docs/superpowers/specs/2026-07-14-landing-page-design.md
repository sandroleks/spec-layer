# Landing page — Spec Layer plugin

**Date:** 2026-07-14
**Status:** Approved design (brainstorm complete)
**Scope:** A single-page marketing site for the Figma plugin, linking to Lemon Squeezy checkout. Modeled on https://spectral.markaplugin.com/ in scope and simplicity.

---

## 1. Summary

One self-contained static page in `apps/landing/`: `index.html` with inline CSS,
no framework, no build step. Deployed to Cloudflare Pages
(`npx wrangler pages deploy apps/landing`), same account as the proxy worker.

Product name on the page: **Spec Layer: Auto Documentation & Specs**.

## 2. Checkout links

Per-variant Lemon Squeezy buy links, kept as two constants at the top of the
page's script block so they are easy to swap later:

- Monthly: `https://speclayer-docs.lemonsqueezy.com/checkout/buy/bb2d0913-6243-47f5-94f1-dfc24a33b713`
- Yearly: `https://speclayer-docs.lemonsqueezy.com/checkout/buy/22aa893e-96b4-41d6-8846-86e21887c07a`

These may change; nothing else on the page depends on them.

## 3. Page structure

Dark theme matching the existing marketing covers (near-black background,
white type, the plugin's blue accent). Copy follows
`docs/plugin-voice-and-copy.md`: sentence case, no em dashes, no hype words,
honest about limits.

1. **Hero.** Animated logo (`logo.svg`, inline or as `<img>`), product name,
   one-line description, two buttons: "Open in Figma" (Community listing,
   plugin id 1652104411578396548) and "See pricing" (anchor link).
2. **Screenshots.** `2.png` and `3.png` from `screenshots/`, copied into
   `apps/landing/`, in rounded frames.
3. **Pricing.** Two cards:
   - **Free**: all deterministic features listed as free forever, plus
     "10 AI generations a month (20 in your first month)". Button: open in
     Figma.
   - **Pro**: monthly/yearly toggle, $8/mo or $80/yr ("two months free" note).
     Fair-use wording per the freemium spec: "Unlimited AI generation for
     normal individual use", never bare "Unlimited". Button links to the
     buy link matching the toggle state.
4. **FAQ.** Four items: how the license works (buy, key arrives by email,
   paste into plugin Settings), what counts as a generation (only uncached
   successful calls), refunds, fair use.
5. **Footer.** Figma Community link, manage subscription
   (`https://app.lemonsqueezy.com/my-orders`), support email
   (alex@neuronux.com), Lemon Squeezy handles receipts/taxes as merchant of
   record.

## 4. Behavior

- ~15 lines of vanilla JS: monthly/yearly toggle (updates price text and the
  Pro button href) and `<details>`-based FAQ needs no JS at all.
- No analytics, no cookies, no external requests beyond the page's own assets.
- Responsive down to ~360px wide; single column on mobile.

## 5. Out of scope

- Custom domain setup (page works on the default `*.pages.dev` URL).
- Terms/privacy pages (Lemon Squeezy checkout covers purchase terms for v1).
- Screenshot re-exports or new marketing art.
