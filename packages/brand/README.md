# @spec-layer/brand

Shared Spec Layer identity, based on the approved **Quiet Precision** proposal. The plugin and website both consume this package.

## Source and build

- `src/tokens.json` owns shared fonts, weights, spacing, radii, motion, both semantic palettes, and explicitly separated plugin density roles.
- `assets/` owns the existing static symbol and licensed Manrope font files. The plugin uses its existing Inter/system stack without fetching fonts.
- `build.mjs` validates 152 permitted color pairs and generates `dist/tokens.css`, `dist/plugin.css`, and `dist/contrast-report.json`.
- `src/contrast.mjs` checks sRGB text/control contrast. Disabled colors, composited overlays, arbitrary combinations, and full product accessibility are outside its claim.

Run `npm run build:brand` at the repository root. Consumers must call `buildBrand()` before bundling generated CSS. A contrast failure stops the build. Generated files are ignored by Git and recreated from source on a clean checkout.

The plugin's build already does this automatically. It bundles the shared imports with its adapter, components, and patterns into one embedded stylesheet. The website generates the shared token CSS and copies the identity/font assets during its build and preview startup through `apps/website/scripts/brand.mjs`. Its `public/brand.css` adapter supplies website aliases without importing `plugin.css`. The website check verifies source parity, transitive asset URLs, and theme metadata; do not copy palette values into consumer source.

## Consumer contract

Use `data-theme="dark"` or `data-theme="light"` on the root or body. The default palette is dark. If an application aliases tokens, declare those aliases at the element where the theme changes; an alias resolved on a differently themed ancestor stays frozen to that ancestor's value.

Pair action fills with `on-action`, destructive fills with `on-danger`, and selection surfaces with `accent-text`. Use `control-border` for an identifiable unchecked boundary and `divider` for a quiet separator. Status colors always accompany explicit meaning in text or an accessible label.

Plugin spacing, control density, and type sizes are not website reading-size defaults. Keep website body text comfortable while sharing families, weights, shape roles, colors, and language. Do not apply this palette to customer-generated documentation: those themes remain independent.

Use the existing symbol in a static, monochrome treatment. Keep Manrope for brand/display expression and Inter/system for working controls. The full usage specification remains in `docs/brand/system-v1/README.md`; implementation status is tracked in `docs/strategy/2026-09-07-design-system-implementation.md`.
