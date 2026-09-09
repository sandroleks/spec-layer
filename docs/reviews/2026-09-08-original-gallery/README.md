# Restore original gallery screenshots — 8 September 2026

The live gallery now serves the user's exact `createdoc.png`, `foundations.png`, and `library.png` files from `screenshots/updated media/website gallery/`. Each original is 1440 × 900. Website copies and live browser responses are byte-identical to these supplied originals.

Removed the responsive WebP source element, variant selection in the gallery script, and screenshot generation from the asset pipeline. Retired generated variants are removed during builds. CSS bundling remains. The gallery preserves the full image and its native aspect ratio, with no crop or alternate mobile image. A new homepage script version prevents reuse of the old gallery code. Authoring and SEO notes now explicitly require original PNGs.

Production build checks, 44 Chromium/WebKit checks, and 59 live HTTP checks passed. Live browser verification at 1440px/2× density and 390px/3× density loaded all three original PNGs, verified their response bytes, intrinsic dimensions, aspect ratio, and full-size links. See `live-gallery.json`, `browser.json`, `http.json`, and the live screenshots. Release and rollback IDs are in `release.json`.

The initial reported close-up could not be attributed conclusively to a specific cached response. The live gallery at investigation time still selected generated WebP variants. The fix removes all such selection and verifies the delivered originals directly rather than assuming a cause for the reported image.
