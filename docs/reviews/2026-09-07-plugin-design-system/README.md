# Plugin design-system review

Reviewed September 7, 2026. Production source and current browser-rendered UI, with synthetic harness data. The proposed violet image mockups were not used as implementation evidence. No production UI was changed.

## Verdict

Keep the system and strengthen it. Its separation into semantic tokens, reusable components, and workflow patterns is sound. The highest-value improvements are contrast, readable detail text, more complete token usage, and documentation that matches production. A brand refresh should build on this foundation.

## Findings, in priority order

### 1. High: primary action colors do not provide sufficient text contrast in dark mode

The rendered Create docs button uses 12px white text on `#0B99FF`. The source applies the same color pairing to all primary buttons. Calculated contrast is 2.994:1 at rest, 2.569:1 on hover, and 3.821:1 when pressed. All are below the 4.5:1 minimum for this size of text. Light mode's white on `#0875C1` measures 4.856:1.

The selected-checkbox white glyph also shares the on-accent role. A single accent currently serves filled actions, selection, and some text/icon uses. Those uses need different contrast relationships; changing one blue value to violet will not automatically solve them.

Recommendation: define and verify paired action background/foreground values for each theme and state. Separate action fills from accent text and selection indicators when necessary. Audit danger buttons too: the dark danger primitive specifies white on `#FF716C`, which measures 2.682:1; this pairing was found in source rather than captured in a live dialog.

Sources: [primary button rules](../../../packages/plugin/src/ui/design-system/components.css:151), [dark tokens](../../../packages/plugin/src/ui/design-system/tokens.css:142). Screenshot 1.

### 2. High: Library's important details are styled like incidental metadata

Expanded changes render at 10px. Their main text is `#737373` over `#F7F7F7`, measuring 4.426:1, just below the 4.5:1 threshold. The variant-scope text uses the still lighter `#8A8A8A` on the same background. Scope is necessary to understand which variants a change affects, so making it visually secondary should not make it difficult to read.

This is also a role-level problem: the quiet-text token measures only 3.452:1 on white, and dark quiet text measures 4.289:1 on the dark canvas. Search placeholders, hints, and other consumers need a text/background audit, rather than a Library-only patch.

Recommendation: make meaningful change descriptions and scope annotations at least support-sized (11px), preferably body-sized (12px) when people need to read token paths. Use a text color that passes on the actual surface. Keep 9–10px roles for genuinely secondary short labels. Text size alone is not a WCAG violation; the measured contrast failures are separate from this readability recommendation.

Sources: [change descriptions and scope](../../../packages/plugin/src/ui/design-system/patterns.css:1057), [quiet text](../../../packages/plugin/src/ui/design-system/tokens.css:213). Screenshots 2–3.

### 3. Medium: unchecked controls are too faint in dark mode

The unchecked Related components checkbox has a transparent fill and `#505050` border against the `#292929` group surface: approximately 1.804:1. Its boundary is the visual information that identifies the unchecked control. This falls below the 3:1 non-text contrast threshold for identifying active controls.

Recommendation: introduce a control-boundary role distinct from decorative dividers. A stronger checkbox/radio boundary should not require brightening every list separator. Verify checked, mixed, unchecked, hover, and focus states in both themes.

Sources: [checkbox/radio boundary](../../../packages/plugin/src/ui/design-system/components.css:274), [border token](../../../packages/plugin/src/ui/design-system/tokens.css:135). Screenshot 1; border color confirmed from computed styles.

### 4. Medium: workflow patterns bypass parts of the shape and sizing system

The pattern layer contains 37 literal pixel border-radius declarations. Library filters, for example, use 8px outside and 6px inside while the declared radius scale is 3, 4, 7, and 10px. Fixed 28/34px control sizes also recur instead of always using the corresponding role.

This is not a claim that every literal value is wrong. Icon geometry, optical offsets, and layout clearances can reasonably remain explicit. The issue is that a future token update will change some controls and leave visually related controls behind.

Recommendation: distinguish intentional geometric constants from reusable shape/control values. Map repeated radii and control heights to semantic roles; add a role only when the difference is intentional and useful. Keep screen-specific layout composition separate.

Sources: [Library filters](../../../packages/plugin/src/ui/design-system/patterns.css:755), [radius and control scale](../../../packages/plugin/src/ui/design-system/tokens.css:82).

### 5. Medium: the documentation is no longer a reliable contract

Concrete contradictions:

- The design-system README lists micro/caption/support/control at 8/9/10/11px. Production uses 9/10/11/12px.
- Its footer table still lists Download as the component screen's secondary action. The current screen uses Copy for AI.
- Voice guidance says a blocked primary carries no icon. The component contract explicitly requires the action glyph in every state.

These instructions can cause future work to reintroduce superseded behavior even when contributors follow the documentation carefully.

Recommendation: reconcile the documentation with production, state which file owns each contract, and label archived prototype decisions clearly. Publish a current component/state catalog backed by the production primitives when making the brand changes.

Sources: [documented type scale](../../plugin-ui-vnext/design-system/README.md:63), [documented footer](../../plugin-ui-vnext/design-system/README.md:172), [contradictory icon guidance](../../plugin-voice-and-copy.md:54).

## What is working

- Three explicit CSS layers are embedded into the production build in a predictable order.
- Theme values are expressed as semantic roles; components largely avoid theme-specific branching.
- Role-based type sizes and a deliberate spacing scale are already established.
- Native checkbox inputs, accessible names, selected-state attributes, focus styles, and reduced-motion handling provide a useful accessibility baseline.
- Search accepted arrow navigation and returned focus to its trigger after Escape in the inspected harness.
- Primary actions, secondary actions, disclosure groups, source lists, and status messages share recognizable patterns.
- Screen/view-model tests cover behavior beyond ideal visual states.

## Captured views

1. **Component / dark / ready — coherent hierarchy; action contrast and unchecked boundaries need correction.**

![Current component screen](</Users/sandrolek/Documents/Projects/Design System Docs/docs/reviews/2026-09-07-plugin-design-system/01-component-dark.png>)

2. **Library / light / expanded changes — useful structure; essential details need stronger typography and contrast.**

![Current Library screen](</Users/sandrolek/Documents/Projects/Design System Docs/docs/reviews/2026-09-07-plugin-design-system/02-library-light.png>)

3. **Search / light / open — keyboard behavior worked in this check; secondary text is very small and quiet.**

![Current Search screen](</Users/sandrolek/Documents/Projects/Design System Docs/docs/reviews/2026-09-07-plugin-design-system/03-search-light.png>)

## Validation and limits

- 188 existing tests passed across 10 suites: shell, component, Foundations, Library, Settings, License, Search, confirmation dialog, progress, and publishing.
- 15 existing built-HTML/harness tests passed. Total: 203 tests across 11 suites.
- Plugin build succeeded. Test tooling emitted a Vite configuration compatibility warning unrelated to these visual findings.
- Contrast calculations use source/computed sRGB values and the WCAG relative-luminance formula. They do not sample antialiased screenshot pixels. Disabled controls and decorative dividers were not treated as active-control failures.
- Captures are from the current renderer at 480 × 680 with fixtures. No installed Figma session, native host font rendering, complete assistive-technology flow, 420px layout, or full production task flow was verified. Passing component tests does not establish visual accessibility compliance.
- Inter is declared with system fallbacks; the plugin build inspected does not embed a font face. Verify actual available/rendered fonts and the 450/560/650/720 weights on supported hosts before promising identical typography across surfaces.

Standards used: [W3C text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [W3C non-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

## Recommended sequence

1. Correct foreground/background pairs and active-control boundaries.
2. Increase readability of the Library's substantive detail text.
3. Reconcile documentation and normalize reusable pattern values.
4. Apply the separately approved brand direction through these roles.
5. Compare both themes and affected states in the actual Figma host before release.

The existing compact layout can remain. This review supports targeted improvements, not a wholesale UI rebuild.
