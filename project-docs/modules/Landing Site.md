---
title: Landing Site
tags:
  - module
  - marketing
  - static-site
status: living
updated: 2026-07-27
source: apps/landing
---

# Landing site

`apps/landing` is a static marketing and policy site with no build step.

## Files

| File | Purpose |
|---|---|
| `index.html` | Product page, pricing, FAQ, checkout links |
| `privacy.html` | Published privacy policy |
| `security.html` | Published security information |
| `terms.html` | Terms |
| `refund.html` | Refund policy |
| `motion.js` | Vendored Motion library |
| `lenis.min.js` | Vendored smooth scrolling |
| images/video/logo assets | Marketing media |

## Runtime behavior

Plain script tags provide:

- entrance animations;
- hover and press feedback;
- gallery scroll motion;
- monthly/yearly pricing toggle;
- FAQ accordion;
- smooth scrolling.

## Commerce

Monthly and yearly Lemon Squeezy checkout URLs are constants in the main script block of `index.html`. The plugin separately defines checkout and subscription-management URLs in `packages/plugin/src/ui/proxy.ts`; these values can drift and should be checked together for a release.

## Deployment

The documented target is Cloudflare Pages project `speclayer-landing`.

See [[Deployment and Release]].

