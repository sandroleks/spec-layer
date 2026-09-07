# Adoption plan

**This is a proposed sequence, not authorization to change or release the product.** The prepared system is isolated under `docs/brand/system-v1`. Existing plugin and website source changes remain outside this package.

## 1. Review the visible result

Review the retained symbol and refined wordmark, violet action colors in both themes, stronger control boundaries, 12px change details, compact plugin density, and the website application. Agree on the identity and any adjustments before integrating it. Settle whether Inter will be bundled or the native system fallback will be the supported working font.

## 2. Establish the shared source

Move the accepted token schema and static identity assets into a shared brand package consumed by both plugin and website. Generate CSS and surface adapters from that source. Preserve semantic role names; do not maintain independent hex values in two applications. Record font licenses and the accepted version. Keep plugin-only density tokens separate from website layout sizes.

## 3. Adopt in the plugin

Use the candidate `plugin-tokens.css` mapping as the integration reference. Update source components and patterns deliberately rather than copying the generated preview into production.

| Review finding | Proposed treatment | Adoption check |
| --- | --- | --- |
| Blue primary with low-contrast white text in dark mode | Lavender fill with dark on-action text; deep violet with white in light mode | Default, hover, pressed, selected, and focus in both themes |
| Small Library changes and scope | 12px reading content, 1.5 line height, stronger supporting text | Long token paths and variant scope at 420px and 480px |
| Weak unchecked boundaries | Dedicated control-boundary token distinct from dividers | Checkboxes, fields, switches, focus, and empty states |
| Repeated radius literals | Named 3/4/8/12px shape roles | Every affected component and overlay |
| Competing AI treatment | Neutral assistance surface and ordinary selection controls | Main action remains visually dominant |
| Stale system documentation | Document actual type roles, Copy for AI, and retained action glyphs | Documentation matches renderer and states |

Check Component docs, Foundations, Library, Settings, License, search, empty states, errors, busy states, menus, and destructive actions. Verify keyboard operation and focus return. An `aria-disabled` control must also suppress activation in code; pointer styling alone is insufficient.

Run the existing relevant UI tests and build after integration. Test in Figma at supported widths and with native/system theme behavior. The current browser harness does not validate Figma host actions, publishing, licensing, or generated-frame behavior.

## 4. Adopt on the website

Replace duplicate brand values with the shared source. Align product name, static symbol treatment, Manrope headlines, violet action pairs, and terminology. Preserve comfortable website reading sizes and spacing. Keep existing content and unrelated website work intact.

Capture fresh screenshots from the accepted plugin after integration. Use readable product close-ups and output examples; retire generated concepts from any placement that implies current product functionality. Validate the website at mobile and desktop sizes, including focus, reduced motion, and light/dark usage where supported.

## 5. Reconcile supporting surfaces

Update the plugin listing, repository artwork, documentation examples, social preview, and any installation assets from the same identity source. Maintain a capture checklist and date so marketing imagery follows the shipped interface. Do not apply Spec Layer's brand palette to customer-generated documentation by default.

## 6. Verify and release separately

Review the integrated plugin and website together. Check accessibility and regressions beyond color-pair arithmetic. Confirm docs and screenshots describe the final behavior. Release or publish only through a separately authorized deployment step; retain a clear rollback to the previous theme assets.

Completion means both products consume one accepted foundation, visibly share the identity, and have current supporting assets—not simply that their primary buttons have the same hue.
