# Spec Layer — Design system 01

**Status: proposal for review · September 2026.** This package updates the violet direction explored in the standalone plugin concepts. It includes a shared brand foundation, working component specimens, and a preview using the current plugin renderer. It does not adopt these styles in production.

**Implementation update, September 7:** the user approved starting implementation.
This directory remains the dated proposal; the current shared source is
`packages/brand/src/tokens.json`. Progress is tracked in
`docs/strategy/2026-09-07-design-system-implementation.md`.

## The direction: quiet precision

Spec Layer should feel precise, dependable, and considerate. Its interface helps people understand their design decisions and carry them into documentation and implementation.

**Brand promise:** Your design decisions, ready to build from.

**Product descriptor:** Design system documentation and context.

The identity combines the existing four-part symbol, a Manrope wordmark and display voice, graphite or white working surfaces, and violet actions. Violet is the recognizable thread between website and plugin. Typography, shapes, language, and accurate product imagery carry the rest of the identity.

This evolves the earlier visual exploration: it keeps the violet direction while grounding proportions, navigation, terminology, and density in the actual plugin. Generated concept images are directional references; the staged renderer is the more reliable product reference.

## Identity rules

- Write **Spec Layer** in prose; use **spec layer** in the visual wordmark. Avoid introducing alternate product names on different surfaces.
- Retain the existing four-part symbol. The included SVG uses its existing geometry in a static treatment. This is a refinement of the identity, not a new symbol proposal.
- Use a square symbol beside the wordmark in the website header, installation/listing artwork, and brand materials. Keep the plugin's compact navigation; do not add a large decorative brand header.
- Keep clear space around the lockup at least equal to half the symbol's width. Use the symbol at 24px or larger for branded UI placements; inspect smaller host icons separately.
- Keep the symbol monochrome with a clearly contrasting backing. Do not recolor its four parts by feature or animate it in the working plugin.
- Use violet on the main action, selected controls, focus indicators, and restrained identity accents. Avoid violet backgrounds behind every section.

The brand belongs to Spec Layer's interface. Generated customer documents retain the customer's theme, tokens, and logo.

## Color

`tokens.json` is the canonical source for this proposal. Roles describe purpose, so consumers do not choose a violet shade independently.

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Action | `#6845C7` | `#B3A0FF` | Primary action and selected controls |
| On action | `#FFFFFF` | `#17112E` | Text, glyphs, and checked marks on action fill |
| Canvas | `#FFFFFF` | `#1F1F1F` | Main working background |
| Surface | `#FFFFFF` | `#292929` | Grouped working content |
| Selection | `#F0EBFC` | `#30283F` | Selected navigation or row surface |
| Text | `#202026` | `#F3F3F3` | Main reading content |
| Muted | `#595966` | `#B8B8C2` | Supporting explanations |
| Quiet | `#636371` | `#ADADB8` | Short metadata |
| Control boundary | `#7B7B89` | `#90909A` | Visible unchecked controls and field boundaries |

Always pair `action` with `on-action`; dark-theme violet needs dark text. Hover and pressed fills have separately checked pairings. Use `accent-text` for text on `selected`, rather than assuming the action fill works as a text color everywhere.

Dividers and control boundaries are different roles: a quiet separator can be subtle; an unchecked checkbox must remain identifiable. Status uses green, amber, or red plus explicit text. An update is a review state, not automatically an error. AI assistance uses a neutral surface and ordinary selection styling.

The generated contrast report checks 96 foreground/background pairs against 4.5:1 for ordinary text and 3:1 for control boundaries, focus, and relevant graphics. All specified pairs pass. Disabled colors, composited overlays, arbitrary new combinations, and full product accessibility are outside that claim. Recheck new combinations before adding them.

## Typography

Use **Manrope** for the wordmark and expressive website headings. Use **Inter with native system fallbacks** for working UI. Manrope is self-hosted in this package with its license. Inter is not bundled here; the plugin preview can use the operating system fallback. Font parity should be settled during adoption.

| Plugin role | Size | Typical weight | Purpose |
| --- | --- | --- | --- |
| Display | 20px | 700 | Screen title |
| Section | 14px | 600 | Section title |
| Body | 12px | 400 | Change descriptions and reading content |
| Control | 12px | 500 | Buttons, field labels, row names |
| Support | 12px | 400 | Explanations and scope |
| Caption | 11px | 400–500 | Short timestamps and badges |
| Micro | 11px | 400 | Keyboard hints only |

Use a 1.5 line height for multiline change details. Avoid essential information below 12px. Uppercase labels are short orientation cues, never paragraphs. Do not squeeze long component names by shrinking their font.

Website body text should start at 16px with approximately 1.5 line height; editorial headings can scale from 32px to 64px. These are surface-specific applications of the same families and hierarchy. The plugin's 12px working density is not a website body-size rule.

## Shape, spacing, and density

- Spacing tokens: 0, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, and 32px. Favor 4/8/12/16/24/32 for common layouts; retain 2/6/10/14/20 for compact alignment and existing plugin needs.
- Radii: 3px for tiny marks, 4px for checkboxes, 8px for buttons/fields/content blocks, 12px for overlays, and pill for switches/status pills where appropriate.
- Control heights: 24px for compact icon controls, 28px for compact rows or filters, 34px for standard actions, 36px where extra field space helps. Larger website actions can use a surface-specific size while preserving the same states and shape.
- Keep the plugin's navigation rail and footer actions. Prefer dividers and spacing to nested bordered cards. Change details should read as content inside one expandable row.

The preview normalizes existing radius literals in copied styles only. Production adoption should replace each use deliberately with a token.

## Component contracts

| Component | Required behavior and treatment |
| --- | --- |
| Primary action | One dominant action per task region; action/on-action pair; distinct hover, pressed, focus, disabled, and busy states |
| Secondary action | Neutral surface, visible boundary, main text; lower emphasis than primary |
| Quiet action | Text or icon on the surrounding surface; visible hover and keyboard focus |
| Checkbox | Unchecked boundary, checked mark, and mixed state; associated label; Space toggles it |
| Switch | Visible track and thumb in both states; accessible name and checked state; no dependency on color alone |
| Field | Persistent label; useful help; error text associated with the field; invalid state and focus retained after failed validation |
| Disclosure | Button semantics, expanded state, consistent chevron, content tied to its trigger |
| Status | Label explains meaning; color reinforces it; change details remain readable |
| Search/overlay | Visible focus, meaningful result labels, Escape closes, focus returns to the trigger; selection and empty states need separate checks |
| Busy action | Preserve label meaning and button width; block repeated activation; announce progress/results where appropriate |

Use the existing plugin icon set as the source. Match size, stroke, alignment, and optical weight across screens; do not introduce a second decorative set. Keep action glyphs present across states, including disabled and busy states unless a progress indicator deliberately replaces one. Icon-only actions require accessible names.

The catalog demonstrates core states and local feedback. The renderer preview preserves existing behavior; it is not a complete implementation of every contract above. In particular, a CSS disabled appearance is not sufficient to stop keyboard activation: production controls must enforce their disabled state in behavior too.

## Motion and accessibility

Use 120ms for immediate feedback, 180ms for state changes, and up to 260ms for disclosure. Animate opacity or transforms when possible. Honor reduced motion and avoid continuous decorative motion in the plugin. Loading must retain a text or accessible status if animation is suppressed.

Provide a visible focus ring with an offset from the control. Preserve keyboard navigation, input labels, mixed checkbox states, and focus return from overlays. Keep targets usable at the compact plugin density; verify host scaling and zoom rather than inferring accessibility from the token report.

Contrast references: [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

## Voice and product imagery

Speak like a teammate: name the action, describe the result, and explain limits plainly. Use “Create docs”, “Copy for AI”, “Review changes”, and “Library is up to date”. Errors should say what happened and give a useful next step. Avoid vague “AI-powered” claims where the actual assistance can be named.

Show real interface captures when explaining product behavior. Pair an overview of the plugin with what it creates, then use close-ups for details. Keep text readable at the final display size; use straight-on captures with restrained framing. Use one theme consistently within a sequence and label sample content. Standalone explorations can illustrate direction but should not be presented as shipped product screenshots.

## One brand across surfaces

| Shared everywhere | Adapted to the surface |
| --- | --- |
| Product name, symbol, wordmark | Header placement and available space |
| Semantic colors and paired foregrounds | Plugin density and website whitespace |
| Font families, weight roles, voice | Heading sizes and reading sizes |
| Control states, focus, icon family | Layout and navigation |
| Screenshot conventions and product terminology | Narrative website sections and task-oriented plugin screens |

## Review package

- `index.html`, `catalog.css`, and `catalog.js`: interactive catalog with both themes.
- `tokens.json`: proposed semantic source; `tokens.css`: generated CSS.
- `plugin-tokens.css`: generated adapter to existing plugin roles.
- `plugin-patterns.css`: staged readability and control corrections.
- `plugin-preview.html`: actual plugin harness with candidate styles and sample data.
- `contrast-report.json`: generated pairing checks.
- `MIGRATION.md`: staged adoption plan.
- `design-qa.md`: verification evidence and remaining limits.

From the repository root, run `node docs/brand/system-v1/build.mjs` to regenerate the proposal. Serve this directory through a local static server to use the catalog; opening it directly from the filesystem will not load its token data reliably. Review the identity, both themes, actual plugin previews, and website application before adopting the proposal.
