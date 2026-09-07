# Spec Layer shared brand plan

Status: proposed for review. This document authorizes no implementation or publication.

## Outcome

Make the Figma plugin, website, and public product assets recognizably Spec Layer. A visitor should recognize the plugin they install from the website they visited, and both should communicate precision, clarity, and care.

The first deliverable is a visual proposal. Production changes start only after the user approves that proposal. This sequence follows the user's explicit request to review the work before implementation.

## Starting evidence

The September 6 review inspected the live website and the current plugin renderer through its development harness. The harness used fixture content at 480 × 680; the installed Figma plugin and native title bar were not accessible. The Community listing icon and cover still need verification.

| Area | Current condition | Issue to resolve |
| --- | --- | --- |
| Accent | Website uses violet; plugin uses blue | No shared visual identifier |
| Typography | Website uses Manrope; plugin uses an Inter/system stack | No documented relationship between brand typography and working UI |
| Surfaces | Website has cool graphite; plugin has neutral gray and white themes | Surfaces were chosen independently |
| Product imagery | Website combines illustrative workflow UI with product screenshots | Demonstrations need to look related to the installed product |
| Language | Plugin manifest says “Spec Layer: Auto Docs & Specs”; website and plugin use several descriptions | Name, descriptor, promise, and feature vocabulary need distinct, consistent roles |
| Plugin emphasis | AI allowance, AI writing panel, badges, and Copy for AI repeat the AI message | Visual emphasis can obscure the specification and maintenance work |
| Sources | Several logo copies and separate styling systems exist | Future edits can recreate the mismatch |

Relevant implementation sources:

- `packages/plugin/src/ui/design-system/{tokens,components,patterns}.css`
- `packages/plugin/src/ui/shell/` and `packages/plugin/src/ui/screens/`
- `packages/plugin/build.mjs` and `packages/plugin/manifest.json`
- `apps/website/public/styles.css` and `apps/website/public/docs.css`
- `apps/website/content/index.html`, `apps/website/scripts/`, and `apps/website/build.mjs`
- `apps/website/public/logo.svg`, `apps/landing/logo.svg`, and `screenshots/logo.svg`
- `docs/plugin-voice-and-copy.md`

The website already has unrelated uncommitted improvements. Preserve them and reconcile against the latest files before implementation. The production plugin sources take precedence over older prototype documentation.

## Working direction, subject to visual approval

Personality: quiet precision. Helpful, deliberate, technically credible, and comfortable to use every day.

Keep the existing symbol as the starting point. Explore violet as the shared signature color, retaining the plugin's compact layout and the website's spacious presentation. Use one coordinated neutral palette with appropriate surface contrast for each context.

Candidate palette: dark action `#B3A0FF` with `#17112E` text; light action `#6845C7` with white text. These are candidates, not approved tokens. Check contrast and all interactive states before adoption.

Candidate typography: Manrope for brand/display text, Inter for working UI. Compare that treatment with an Inter-only specimen on the proposal board to establish whether the two-font approach feels cohesive enough. Verify actual font availability, licensing, loading, and fallback behavior before deciding how to deliver it inside Figma.

Proposed brand line for review: “Your design decisions, ready to build from.” Supporting descriptions must accurately distinguish documentation, structured context, publishing, and optional AI writing. Do not imply code generation or conformance checking that the product does not provide.

## Phase 1: establish the baseline and brief

Work:

- Inventory the current logo sources, plugin icon, Figma listing assets, website favicon/social image, typography, colors, icon families, and feature names.
- Capture matching baseline views: plugin component screen, Library, Foundations, and License in light/dark; website homepage and a documentation page at desktop/mobile sizes.
- Use the current local website candidate as the implementation baseline, while noting any differences from the live site.
- Record each reference as live product, current renderer with fixture data, or archived asset. Confirm native Figma appearance when access is available.
- Write a one-page brief describing audience, promise, personality, and the distinction between shared identity and surface-specific density.

Deliverable: baseline board, asset inventory with authoritative sources, and short brief.

Complete when every in-scope touchpoint has a current reference or an explicitly recorded access gap.

## Phase 2: make the visual proposal

Create one coherent proposed direction using the existing product as the visual reference. Include:

1. Existing logo and wordmark lockups, plus icon specimens at small sizes on light/dark backgrounds.
2. Palette with assigned roles, typography specimens, and a few real control examples.
3. Component screen in dark mode and Library in light mode at 480 × 680.
4. Website hero at desktop/mobile sizes and a documentation excerpt.
5. Figma listing cover and social-card concepts using the same assets and language.
6. Before/after views and annotations explaining the limited set of proposed changes.

The board must show hover/focus/selected/disabled samples and semantic success/warning/error colors, so the proposal is more than a palette applied to ideal states. Present the typography comparison as a bounded decision within this direction. Show any proposed reduction in AI emphasis explicitly, preserving allowance visibility and feature behavior.

Deliverable: a reviewable visual board with a written change list, clearly identified as proposed design.

**Review point A: user approval of the visual direction.** Resolve color, typography, logo treatment, naming, and AI emphasis here. Revise the board if needed. Do not modify production UI while this decision is pending.

## Phase 3: codify the approved foundation

After visual approval:

- Establish `packages/brand/` as the proposed shared source for brand primitives, font roles, and canonical logo assets.
- Keep semantic mappings close to each consumer: the plugin retains its `--sl-*` roles, while the website maps its roles to the shared values.
- Keep density, control sizing, and responsive layout local to each surface. Share identity without forcing identical layouts.
- Embed shared CSS in the plugin build and copy/generate the website's required assets during its build. The plugin must not depend on fetching website styles at runtime.
- Document the actual icon family, approved naming, feature vocabulary, and small-size logo usage.
- Add a focused build check for missing shared assets or stale generated brand outputs. Avoid duplicating every style value in tests.

Deliverable: shared brand source, consumer mappings, and concise usage guide with contrast results.

Complete when both builds consume the same approved foundation and future changes have one documented entry point.

## Phase 4: apply the identity to the plugin

- Update accent and neutral mappings, then adjust controls only where the approved proposal requires it.
- Verify active navigation, primary actions, checkboxes, switches, focus, and selection in both themes.
- Apply approved AI emphasis changes while retaining accurate badges, quota states, and allowance explanations.
- Align feature labels and the manifest descriptor if approved. Preserve the plugin ID and existing integration identifiers.
- Keep the working layout, extraction behavior, publishing, licensing, and document content unchanged unless separately requested.

Deliverable: local plugin preview with representative normal, empty, busy, error, free, low-allowance, exhausted, and Pro states.

Complete when the approved screens match the proposal and the remaining screens use the same rules without readability or interaction regressions.

## Phase 5: apply the identity to the website and assets

- Align homepage and documentation colors, type roles, icons, and controls.
- Refresh product screenshots from the updated plugin renderer, then confirm installed-product fidelity when Figma access permits.
- Make illustrative diagrams use the same visual language. Keep illustrative/abbreviated examples identified as such.
- Align name, descriptor, feature names, and product claims across homepage, docs, metadata, and local listing copy.
- Produce canonical logo exports, favicon, social card, and Figma listing assets. Verify destination dimensions and requirements when preparing final exports.
- Update any active legacy asset copies through the shared pipeline; leave archived prototypes clearly identified as historical references.

Deliverable: local website preview plus a ready-to-review asset and listing-copy package. Updating public Figma listing content is a separate publishing action.

Complete when the website's product representations match the plugin and the external asset package follows the same identity.

## Phase 6: verify and review the whole family

Visual and accessibility checks:

- Compare baseline, approved proposal, and implementation at matching sizes and states.
- Review website, plugin, documentation, icon, listing cover, and social card together on a final board.
- Test plugin at 480 × 680 and its supported 420px minimum width; test desktop/mobile website layouts.
- Measure text contrast against WCAG AA thresholds and control/focus boundaries where applicable. Check selected and status states have non-color cues.
- Check keyboard focus, hover, tooltips, font fallback, clipping, and reduced-motion behavior where affected.

Engineering checks:

- Run website build/check scripts and affected plugin UI tests, type checks, build, and sandbox checks.
- Test any changed build/asset synchronization behavior directly.
- Verify navigation, theme switching, search, copy actions, and the affected forms. Use fixture previews for presentation checks; record native Figma behavior that still needs verification.
- Do not treat an inaccessible native Figma check as passed. Identify pre-existing failures separately from regressions introduced by branding work.

Deliverable: final comparison board, check results, changed-file summary, remaining limitations, and release notes.

**Review point B: user approval of the implemented previews and asset package.** This is the final design review before release preparation becomes publication.

## Phase 7: coordinated release and maintenance

When publication is explicitly authorized:

- Prepare the plugin build, website deployment, and Figma listing updates as one release package.
- Record the previous plugin build, website deployment reference, and external assets so each surface can be restored independently.
- Publish in a coordinated window and verify the delivered website, installed plugin, metadata, and listing.
- Record the canonical brand sources and the rule for updating screenshots whenever plugin appearance changes.

Complete when the delivered touchpoints match the approved package, with any access-dependent work explicitly identified.

## Scope boundaries

Generated documentation belongs to the customer's design system. Do not overwrite customer colors, themes, or logos as part of Spec Layer's own brand refresh. Review default output templates separately if consistency concerns remain.

This work does not introduce a new logo concept, product pivot, pricing change, workflow redesign, or functional feature. Such changes require their own brief. Success, warning, and error remain semantic colors rather than all becoming violet.

## Sequence and decision ownership

Sequence: baseline → visual proposal → visual approval → shared foundation → plugin → website/assets → verification → final review → authorized release.

Codex prepares evidence, designs, implementation, and verification. The user approves the visual proposal and final result. Existing Figma access limitations must be resolved before claims about the installed plugin or public listing can be verified.

Current next step, after acceptance of this plan: produce the baseline and visual proposal in phases 1–2. Do not begin phase 3 on the strength of the plan alone.
