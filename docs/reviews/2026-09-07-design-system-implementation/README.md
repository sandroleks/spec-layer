# Shared design system — first implementation milestone

Branch: `codex/shared-design-system`. Reviewed September 7, 2026.

## Implemented

- Shared `@spec-layer/brand` package: accepted semantic palettes, common shape/spacing/font/motion roles, separate plugin density, static existing symbol, and licensed Manrope assets.
- Plugin build regenerates and validates brand CSS before producing any plugin artifact. All imports are bundled into the embedded HTML; no external stylesheet or network font request is introduced.
- Both themes use paired action foregrounds; accent text has its own role. AI assistance uses neutral surfaces. Destructive actions use their own paired fill/foreground.
- Library changes and scope use 12px text with 18px line height, stronger supporting text, and fewer nested borders.
- Controls and fields have distinct boundary/focus roles. Custom Settings fields and the License field were included; a license placeholder no longer uses disabled text color.
- Repeated control/content radius values use named roles. Footer buttons preserve labels and icons, wrapping when necessary at 420px.
- Search and license loading animations respect reduced motion. UI system documentation matches the new type/weight roles and current copy actions.

Customer document themes and production workflow logic were not rebranded. Existing website edits were preserved.

## Verification

177 relevant tests passed across 11 suites: shared contrast, UI build, Component, Library, Foundations, Settings, License, search, header, shell, and confirmation dialog coverage. The three suites covering the contrast gate, build, and Foundations were rerun after the final CSS corrections: 37 passed. Repository type checking, lint of the changed JavaScript/TypeScript, plugin build, and diff whitespace checks pass.

The contrast gate checks 152 permitted text/control pairs in both themes and rejects the previous low-contrast primary pairing in a regression test. The artifact test verifies that both shared palettes reach the shipped stylesheet and all CSS imports are resolved.

Actual browser-rendered primary values were checked: dark `#B3A0FF` with `#17112E`, light `#6845C7` with white, and an 8px radius. Clicking the dark frame's theme control produced the correct light pairing, demonstrating that the body-level alias boundary works.

Visual review covered Component docs at 480px and Library, Foundations, Settings/custom fields, License, and search at 420px in both themes. Component empty and busy states were inspected. The component error fixture was also opened, but host-driven global error presentation is outside this harness. Search Escape closed the focused overlay and returned focus to its trigger. Custom theme selection revealed usable fields while preserving the customer's sample theme values.

Screenshots in this directory show the built renderer with sample data. They are implementation review evidence, not product marketing imagery. `component-error-themes.png` is the error fixture's screen, not a capture of a host error notification.

The browser's computed-style inspection of a navigated nested frame timed out; the Library change text was assessed from rendered screenshots and the source roles instead. Native Figma host operations, full screen-reader/keyboard coverage, zoom/device checks, publishing, licensing, and actual generated documents remain phase 5 checks. No release has been performed.

## Review locally

From the repository root:

```sh
UI_HARNESS=1 node packages/plugin/build.mjs
node packages/plugin/preview-design-system.mjs
```

Open `http://127.0.0.1:4651/`. The review server serves only its review page, built harness, and contrast report. Its controls switch screens and widths while showing both themes. It does not connect host actions.

Next: website consumption of the shared foundation, then accurate product captures and supporting brand assets. See `docs/strategy/2026-09-07-design-system-implementation.md`.
