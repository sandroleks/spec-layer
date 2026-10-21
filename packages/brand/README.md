# @spec-layer/brand

Shared Spec Layer identity, based on the approved **Quiet Precision** proposal. The plugin and website both consume this package.

## Source and build

- `src/tokens.json` owns shared fonts, weights, spacing, radii, motion, both semantic palettes, and explicitly separated plugin density roles.
- `assets/` owns the existing static symbol and licensed Manrope font files. The plugin uses its existing Inter/system stack without fetching fonts.
- `build.mjs` validates 152 permitted color pairs and generates `dist/tokens.css`, `dist/plugin.css`, and `dist/contrast-report.json`.
- `src/contrast.mjs` checks sRGB text/control contrast. Disabled colors, composited overlays, arbitrary combinations, and full product accessibility are outside its claim.

Run `npm run build:brand` at the repository root. Consumers must call `buildBrand()` before bundling generated CSS. A contrast failure stops the build. Generated files are ignored by Git and recreated from source on a clean checkout.

The plugin's build already does this automatically. It bundles the shared imports with its adapter, components, and patterns into one embedded stylesheet. The website is the other consumer. It lives in the private repository, where its own build generates the shared token CSS from this package, copies the identity and font assets, and checks source parity, transitive asset URLs, and theme metadata. A change to the tokens here is not live on the site until that build runs. Do not copy palette values into consumer source.

## Consumer contract

Use `data-theme="dark"` or `data-theme="light"` on the root or body. The default palette is dark. If an application aliases tokens, declare those aliases at the element where the theme changes; an alias resolved on a differently themed ancestor stays frozen to that ancestor's value.

Pair action fills with `on-action`, destructive fills with `on-danger`, and selection surfaces with `accent-text`. Use `control-border` for an identifiable unchecked boundary and `divider` for a quiet separator. Status colors always accompany explicit meaning in text or an accessible label.

Plugin spacing, control density, and type sizes are not website reading-size defaults. Keep website body text comfortable while sharing families, weights, shape roles, colors, and language. Do not apply this palette to customer-generated documentation: those themes remain independent.

Use the existing symbol in a static, monochrome treatment. Keep Manrope for brand/display expression and Inter/system for working controls. The full usage specification and the implementation status live in the private repository.

## Logo files

`assets/logo/` holds the final variant matrix files. Every file is plain paths and shapes, with no font dependency.

| File | Use |
|---|---|
| `spec-layer-lockup-{black,white}.svg` | Symbol and wordmark, the default wherever there is room |
| `spec-layer-symbol-{black,white}.svg` | Symbol alone, 20 px and up |
| `spec-layer-wordmark-{black,white}.svg` | Wordmark alone, where the symbol already appears nearby |
| `spec-layer-favicon.svg` | Browser tab and 16 px slots; black, white under `prefers-color-scheme: dark` |
| `spec-layer-app-icon.svg` | 512 px square tile, white symbol on black |

The symbol sits on a 48 unit grid: 20 unit cells, an 8 unit gap, and 3.5 unit inside strokes, so outlined and filled shapes share outer bounds and the outlines match the wordmark's stem weight. The favicon is its own 16 px drawing (7 px cells, 2 px gap, 1.5 px strokes), not a scaled symbol. In the lockup the symbol is 1.4 times the wordmark's cap height, centered on it, with one cell of space before the wordmark. Use black or white only, and keep clear space of at least one cell around every file.
