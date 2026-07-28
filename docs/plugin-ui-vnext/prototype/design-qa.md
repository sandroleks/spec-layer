# Design QA

## Comparison target

- Source visual truth: `./source-visual-truth/call_8Rr55UDB82uHnTNUtmUg8mbZ.png`
- Product direction layered onto the source: persistent free quota; five workflow destinations; Library row click opens the Figma source; detected changes use a separate disclosure; maintenance actions live in overflow; no separate Text styles destination; Foundation documents uses one flat source list.
- Foundations source visual truth: `./source-visual-truth/codex-clipboard-e70c5e53-fd3f-48bc-92a7-7c5eee3fd99d.png`
- Foundations source pixels: 962 × 1346, normalized to 480 × 680.
- Selected component source visual truth: `./source-visual-truth/codex-clipboard-432344f6-46ee-412b-9ae9-61673db950ac.png`
- Source pixels: 1054 × 1492, normalized to 480 × 680.
- Browser-rendered Library implementation: `./library-final.png`
- Browser-rendered latest Library implementation: `./library-local-search.png`
- Browser-rendered balanced-header Library implementation: `./library-balanced-header.png`
- Compact balanced-header implementation: `./library-balanced-header-compact.png`
- Browser-rendered customer-facing quota implementation: `./library-ai-writing-upgrade.png`
- Compact customer-facing quota implementation: `./library-ai-writing-upgrade-compact.jpg`
- Browser-rendered AI writing state sheet: `./quota-writing-states.png`
- Rejected branded-title source: `./library-animated-brand-title.png`
- Browser-rendered clean utility header: `./library-clean-utility-header.png`
- Compact clean utility header: `./library-clean-utility-header-compact.jpg`
- Contextual-header source visual truth: `./source-visual-truth/codex-clipboard-65cfd240-5246-49c2-9a06-c347a0086f71.png`
- Contextual-header source pixels: 1065 × 1477, normalized to 480 × 666 and vertically centered in the 480 × 680 comparison.
- Browser-rendered contextual-header implementation: `./library-contextual-header.png`
- Compact contextual-header implementation: `./library-contextual-header-compact.jpg`
- Browser-rendered Foundations implementation: `./foundations-clean-final.png`
- Latest Foundation flat-selection implementation: `./foundation-selection-after.png`
- Latest Foundation partial-selection state: `./foundation-selection-partial.png`
- Latest Foundation full-view comparison: `./qa-foundation-selection-comparison.png`
- Latest Foundation light-theme comparison: `./qa-foundation-light-comparison.png`
- Latest Foundation evidence uses 480 × 680 source and implementation crops from the same 480 × 680 CSS plugin frame at device pixel ratio 1. The primary comparison state is dark theme, Foundation documents selected, and all five sources included.
- Sidebar-grouping source visual truth: `./sidebar-grouping-before.png`
- Browser-rendered grouped-sidebar implementation: `./sidebar-grouping-final.png`
- Sidebar-grouping full-view comparison: `./qa-sidebar-grouping-comparison.png`
- Sidebar-grouping focused comparison: `./qa-sidebar-grouping-focused.png`
- Sidebar-grouping evidence uses 480 × 680 source and implementation crops from the same 480 × 680 CSS plugin frame at device pixel ratio 1. The focused rail evidence enlarges the top 52 × 330 pixel region to 156 × 990 pixels for legibility.
- Browser-rendered Selected component implementation: `./component-no-preview-final.png`
- Browser-rendered revised Selected component implementation: `./selected-component-accessibility-final-crop.png`
- Browser-rendered Write with AI tooltip: `./selected-component-ai-tooltip.png`
- Browser-rendered utility-header implementation: `./header-utility-final.png`
- Browser-rendered expanded-quota header implementation: `./header-quota-links-final.png`
- Browser-rendered quota-state sheet: `./quota-states-final.png`
- Latest AI-writing card source visual truth: `./source-visual-truth/codex-clipboard-0ab29875-a211-4790-bbc1-8e42bcdc8e13.png`
- Latest source pixels: 638 × 162. The 566 × 104 card region was normalized to 410 × 76 for focused comparison.
- Latest browser-rendered Library implementation: `./library-header-search-ai-card-native.png`
- Latest implementation pixels: 480 × 680 at a 480 × 680 CSS plugin frame and device pixel ratio 1.
- Latest focused AI-writing card comparison: `./qa-ai-card-reference-comparison.png`
- Latest focused implementation region: 205 × 38, normalized to 410 × 76 for comparison.
- Header-search interaction evidence: `./header-quick-search-open.jpg`
- Header-system polish source visual truth: `./header-polish-before.jpg`
- Header-system polish implementation: `./header-polish-final-native.png`
- Header-system focused comparison: `./qa-header-system-final-comparison.png`
- Header-system evidence: source and implementation were captured from the same 480 × 680 CSS plugin frame at device pixel ratio 1. The 480 × 48 header regions were normalized to 960 × 96 before comparison.
- Step 1 audit source capture: `./step1-component-docs-before.png`
- Step 1 browser-rendered implementation: `./step1-component-docs-final.png`
- Step 1 post-create state: `./step1-component-docs-created.png`
- Step 1 full-view comparison: `./qa-step1-component-docs-final-comparison.png`
- Step 1 evidence: source and implementation are both 480 × 680 pixels at a 480 × 680 CSS plugin frame and device pixel ratio 1. The compared state is dark theme, `buttonPrimary` selected, AI writing on, Usage expanded, 4 of 5 free uses remaining, and documentation not yet created.
- Implementation pixels: 480 × 680 at a 480 × 680 CSS viewport and device pixel ratio 1.
- Primary comparison state: dark theme, Library selected, All filter selected, `buttonText` changes expanded, three updates available, free quota at 4 of 5.
- Full-view side-by-side Library evidence: `./qa-comparison-iteration2.png`
- Latest Library search-placement evidence: `./qa-library-local-search-comparison.png`
- Balanced-header evidence: `./qa-library-balanced-header-comparison.png`
- Customer-facing quota evidence: `./qa-library-ai-writing-upgrade-comparison.png`
- Clean utility-header evidence: `./qa-clean-utility-header-comparison.png`
- Contextual-header evidence: `./qa-contextual-header-comparison.png`
- Full-view side-by-side Foundations evidence: `./qa-foundations-flat-comparison.png`
- No-preview Foundations evidence: `./qa-foundations-no-preview-comparison.png`
- No-preview Selected component evidence: `./qa-component-no-preview-comparison.png`
- Revised Selected component evidence: `./qa-selected-component-accessibility-comparison.png`
- Latest Foundations evidence: `./qa-foundations-american-comparison.png`
- Simplified Foundations evidence: `./qa-foundations-simple-comparison.png`
- Clean Foundations evidence: `./qa-foundations-clean-comparison.png`
- Utility-header evidence: `./qa-header-utility-comparison.png`
- Expanded-quota and external-links evidence: `./qa-header-quota-links-comparison.png`
- Iconless quota-state evidence: `./qa-quota-states-comparison.png`
- Compact viewport evidence: `./library-compact-final.png`
- Focused region comparison was required for the latest AI-writing treatment because it occupies only 205 × 38 pixels in the full view. The normalized source/implementation pair makes the ring, two-line hierarchy, border, and Upgrade treatment directly legible.

## Findings

- No actionable P0, P1, or P2 findings remain.

### Required fidelity surfaces

- Fonts and typography: passed. Neutral Inter-compatible UI typography preserves the source hierarchy, including small metadata at the true plugin size. Workflow titles remain in content; header labels truncate safely; AI writing keeps a clear two-line hierarchy; and no required text overlaps.
- Spacing and layout rhythm: passed. The 52px workflow rail, 48px utility header, content column, and sticky 56px footer form a consistent plugin shell. The single Search trigger, 205px allowance card, and three framed utilities fit the native width without duplicating search inside Library.
- Colors and visual tokens: passed. Graphite surfaces, hairline dividers, blue update state, green in-sync state, and blue selection treatment are consistent across the tab badge and list rows.
- Image quality and asset fidelity: passed. The source uses no photographic or illustrative assets. Visible interface icons use a single Tabler outline set. The circular quota meter is a semantic UI visualization rather than a substitute image asset.
- Copy and content: passed. Interface copy uses American English. Persistent allowance copy uses the customer-facing “AI writing” and “free uses” instead of internal quota and generation terminology. “Update documentation” replaces the ambiguous old update label. Detected changes use realistic variant, measurement, state, and token-diff examples.
- Icons: passed. Single-document and batch updates both use refresh semantics. Navigation, source, disclosure, overflow, creation, and destructive actions remain optically consistent.
- States and interactions: passed. Row navigation, status disclosure, overflow actions, header search across workflows and connected documents, filters, AI on/off, quota consumption, flat Foundation selection, Subscription, theme switch, and success feedback were exercised.
- Accessibility: passed for prototype scope. Icon-only buttons have accessible names; tabs, switches, progress, disclosure, and pressed states are exposed semantically; reduced motion is respected.
- Viewport resilience: passed. The 480 × 680 shell and compact 360 × 640 shell have no document-level horizontal overflow. The compact view preserves the rail, quota, content, and sticky footer.

## Intentional differences from the source

- The free-plan quota is persistent and generously sized inside the utility header because the allowance must remain clearly readable on every workflow without consuming a second content row.
- The custom plugin header intentionally omits product identity and close controls because Figma system chrome owns the logo, plugin name, and window close action.
- Workflow titles stay in page content. The utility header contains Search, AI writing, and theme switching without a logo or product-name lockup.
- Website and LinkedIn remain persistently available at the bottom of the left sidebar, where they do not compete with the header workflow.
- The quota uses a circular usage meter and supports four semantic states: Free available, Free low, Free exhausted, and Pro unlimited.
- Every free quota state includes a visible Upgrade action; the Pro state replaces it with a quieter Active status.
- Search intentionally lives once in the header and covers both workflow navigation and connected Library documents. Library no longer duplicates it inside the content region.
- The expanded Library region is change review only. Open, update, reconnect, and remove actions moved into overflow per the revised interaction model.
- Update Queue and Text styles were removed as standalone navigation destinations. Update maintenance stays in Library, while typography is a source within Foundation documents.
- Foundation documents intentionally omits category headings and category descriptions; all five sources share one continuous list.
- Generation workflows intentionally omit Preview actions. Foundations uses one full-width Create action without repeating the selected-frame total.
- Foundation color descriptions are automatic and consume one AI generation; there is no manual switch.
- Sidebar selection uses a blue icon and background fill, without a rail indicator, outline, or selected stroke.
- Foundation documents omits the header overflow action and the Mapped Colors modes subsection.

## Comparison history

### Previous concept pass

- [P2] The sidebar exposed features as destinations rather than modeling the product’s five jobs.
  - Fix: consolidated navigation into Generate component docs, Maintain library, Generate foundation docs, Settings, and Subscription.
- [P2] Library mixed navigation, expansion, and maintenance actions in one row gesture.
  - Fix: separated Figma navigation, detected-change disclosure, and overflow maintenance actions.
- [P2] Update status color and batch update icon did not use the same semantics as the list.
  - Fix: aligned both update markers to blue and replaced the batch download icon with refresh.
- [P2] Selected component included unnecessary progress UI and underspecified AI quota behavior.
  - Fix: removed progress and added a clear Write with AI switch with quota impact in both the control and footer.

### Final pass

- Evidence: `./qa-comparison-iteration2.png`
- All earlier P2 findings are resolved.
- Browser console check: no warnings or errors.
- No additional visual fixes were required after the final comparison.

### Foundations simplification pass

- [P2] Foundation sources were separated by category titles and descriptions that added hierarchy the workflow does not need.
  - Fix: removed the Color system, Core foundations, and Typography wrappers and rendered all five sources as one continuous list.
  - Post-fix evidence: `./qa-foundations-flat-comparison.png`
- Browser console check after the change: no warnings or errors.

### Generation-action simplification pass

- [P2] Foundations repeated “9 frames” in both the footer summary and creation button, and both generation workflows exposed a Preview concept that the product will not support.
  - Fix: removed Preview from Foundations and Selected component, removed the component Review/preview row, removed the redundant Foundation footer summary, and promoted Create to the single full-width Foundation action.
  - Post-fix Foundations evidence: `./qa-foundations-no-preview-comparison.png`
  - Post-fix Selected component evidence: `./qa-component-no-preview-comparison.png`
- [P2] Expanded Library changes repeated the row’s sync age.
  - Fix: kept the compact row timestamp and removed the duplicate “Last synced” detail line.
- Browser console check after the change: no warnings or errors.

### Language and selection simplification pass

- [P2] Foundation AI descriptions were exposed as a manual switch even though generation is automatic.
  - Fix: removed the switch and made Foundation creation consume one AI generation automatically.
- [P2] Sidebar selection combined a background, rail indicator, focus outline, and icon color change.
  - Fix: reduced the persistent selected state to background fill only.
- [P2] One visible label used non-American spelling.
  - Fix: removed the label and recorded American English as the prototype copy standard.
- Post-fix evidence: `./qa-foundations-american-comparison.png`
- Browser console check after the change: no warnings or errors.

### Foundations surface simplification pass

- [P2] The selected sidebar icon lacked a sufficiently clear active signal after the rail and outline were removed.
  - Fix: kept the selected background and restored the blue icon color without reintroducing a rail, outline, or stroke.
- [P2] Mapped Colors exposed an unnecessary modes subsection, and the Foundation header included an unused overflow action.
  - Fix: made Mapped Colors a flat, non-expanding row and removed the Foundation overflow action.
- Post-fix evidence: `./qa-foundations-simple-comparison.png`
- Browser console check after the change: no warnings or errors.

### Foundation status removal pass

- [P2] A redundant “9 existing frames will be updated” status block interrupted the source list and repeated information the workflow does not need.
  - Fix: removed the status block so the list flows directly into the persistent Create action.
- Post-fix evidence: `./qa-foundations-clean-comparison.png`
- Browser console check after the change: no warnings or errors.

### System-header consolidation pass

- [P2] The custom header repeated the plugin logo, product name, and close action already supplied by Figma system chrome, while theme switching lived separately in the sidebar.
  - Fix: converted the custom header into a utility-only bar with Quick search, persistent free-plan AI quota, and theme switching. Removed theme and close controls from the sidebar.
  - Post-fix evidence: `./qa-header-utility-comparison.png`
- Browser console check after the change: no warnings or errors.

### Clean utility-header pass

- [P2] Adding an animated logo and Spec Layer name duplicated Figma-owned identity, compressed the allowance banner, and made the 48px header feel crowded.
  - Fix: removed the custom brand lockup and returned the space to AI writing. Consolidated Website, LinkedIn, and theme switching into one segmented utility control with shared chrome and quiet dividers.
  - Before-and-after evidence: `./qa-clean-utility-header-comparison.png`
  - Final Library evidence: `./library-clean-utility-header.png`
  - Compact evidence: `./library-clean-utility-header-compact.jpg`
- Browser console check after the change: no warnings or errors.

### Contextual workflow-header pass

- [P2] The utility-only header still lacked orientation, while the Library title consumed a separate content row. The supplied reference solved this by making the current workflow the left side of the top bar.
  - Fix: added a blank rail cap and moved the active workflow title into the 52px header. Removed the duplicate Library heading, kept component identity as content, converted Foundation and Settings subtitles to compact introductions, and returned Website, LinkedIn, and theme switching to individually framed actions like the reference.
  - Intentional difference: omitted the reference logo and Spec Layer name per the user’s direction.
  - Source-to-implementation evidence: `./qa-contextual-header-comparison.png`
  - Final Library evidence: `./library-contextual-header.png`
  - Compact evidence: `./library-contextual-header-compact.jpg`
- Browser console check after the change: no warnings or errors.

### Quota and external-link pass

- [P2] The compact AI quota abbreviated the allowance too aggressively, and the utility header omitted the existing Website and LinkedIn links.
  - Fix: widened the quota to 166px with the full “4 of 5 generations left” message and restored Website and LinkedIn as labeled, accessible icon links using the product’s existing destinations.
  - Post-fix evidence: `./qa-header-quota-links-comparison.png`
- Browser console check after the change: no warnings or errors.

### Iconless quota-state pass

- [P2] The sparkle icon consumed scarce width and made the quota copy feel crowded; only the healthy Free state had been resolved.
  - Fix: removed the icon, gave the text the leading width, and designed four message-and-color states: available with a blue meter, low with an amber meter, exhausted with an upgrade prompt, and Pro with an unlimited/active treatment.
  - Post-fix evidence: `./qa-quota-states-comparison.png`
- Browser console check after the change: no warnings or errors.

### Selected component deterministic-flow pass

- [P2] The screen repeated a readiness subtitle, gave AI explanatory copy permanent vertical space, omitted the Accessibility group, repeated section/quota information in the footer, and made the CTA sound AI-dependent.
  - Fix: removed the readiness subtitle and footer summary; reduced Write with AI to a labeled switch with a hover/focus tooltip; added Accessibility with Interactions, Content considerations, and Semantics & focus; and made “Create docs” the stable primary action with a document icon.
  - Post-fix evidence: `./qa-selected-component-accessibility-comparison.png`
  - Tooltip evidence: `./selected-component-ai-tooltip.png`
- Browser console check after the change: no warnings or errors.

### Library refinement and change-detection pass

- [P2] The Library repeated actions and status in its header, full-width filters, and footer, while the expanded row implied that every source change could always be exhaustively itemized.
  - Fix: simplified the sidebar tooltip to “Library”; removed the header overflow and footer status summary; replaced full-width, dotted filters with compact text-count tabs; removed the comparison subline and exact overall change counts; and renamed the expanded section to “Itemized changes.”
  - Detection fallback: supported properties retain structured diffs, while an ambiguous or unsupported source change now shows “Source changed” with a clear route to review the source from the row menu.
  - Before-and-after evidence: `./qa-library-maintenance-comparison.png`
  - Final Library evidence: `./library-maintenance-final.png`
  - Incomplete-diff evidence: `./library-change-fallback.png`
- [P2] “Itemized changes” and its adjustment icon made the expanded row feel more technical than necessary, while the footer offered no way to rescan source state without updating documentation.
  - Fix: shortened the heading to “Changes,” removed its icon, and added a working secondary “Refresh library” action beside the primary batch update action.
  - Before-and-after evidence: `./qa-library-refresh-footer-comparison.png`
  - Final Library evidence: `./library-refresh-footer.png`
- [P2] Per-group captions such as “1 state added” and “3 values changed” repeated information already visible in each concrete change list.
  - Fix: removed every group summary caption so each change group contains only its name and the specific changes.
  - Before-and-after evidence: `./qa-library-no-captions-comparison.png`
  - Final Library evidence: `./library-changes-no-captions.png`
- [P2] The Library subtitle duplicated totals already present in the filter tabs, while the compact tab treatment was slightly undersized for repeated scanning.
  - Fix: removed the duplicate “16 connected docs · 3 updates available” line, tightened the title region, and increased tab height, padding, label size, and count size while preserving content-width behavior.
  - Before-and-after evidence: `./qa-library-readable-tabs-comparison.png`
  - Final Library evidence: `./library-readable-tabs-final.png`
- [P2] Global Quick search occupied persistent header space even though search is important only for Library maintenance.
  - Fix: removed global search and its keyboard palette, right-aligned the remaining header utilities, and added a prominent Library search that matches component names and source paths with working clear and no-result states.
  - Before-and-after evidence: `./qa-library-local-search-comparison.png`
  - Final Library evidence: `./library-local-search.png`
- [P2] Removing global search left a large inactive region in the persistent header and made the quota feel detached from the utility group.
  - Fix: made the quota a flexible banner that fills all available header space and widened its meter, while keeping Website, LinkedIn, and theme controls as a compact group at the right.
  - Before-and-after evidence: `./qa-library-balanced-header-comparison.png`
  - Final Library evidence: `./library-balanced-header.png`
  - Compact evidence: `./library-balanced-header-compact.png`
- [P2] “Free AI quota” and “generations” exposed internal product terminology, while the healthy and low free states lacked a direct upgrade affordance.
  - Fix: renamed the persistent benefit to “AI writing,” described the allowance as “free uses,” and added a compact Upgrade action to every free state. Pro now reads “Unlimited with Pro” with an Active status.
  - Before-and-after evidence: `./qa-library-ai-writing-upgrade-comparison.png`
  - All-state evidence: `./quota-writing-states.png`
  - Compact evidence: `./library-ai-writing-upgrade-compact.jpg`
- Browser console check after the change: no warnings or errors.

### Restored header search and ring-based allowance pass

- [P2] The contextual workflow-title experiment did not provide enough utility and displaced the stronger Search-led header direction.
  - Fix: removed the workflow title from the top bar, restored page titles inside content, and returned one Search trigger to the header. Removed the duplicate Library search field so the product still has one search surface.
- [P2] The earlier allowance banner felt compressed and technically styled compared with the supplied reference.
  - Fix: rebuilt it as a 205 × 38 outlined card with a circular usage meter, “AI writing” hierarchy, friendly free-use copy, and a blue text Upgrade action.
  - Source-to-implementation evidence: `./qa-ai-card-reference-comparison.png`
  - Post-fix full-view evidence: `./library-header-search-ai-card-native.png`
- Post-fix comparison: no actionable P0, P1, or P2 differences remain. The meter deliberately shows quota used, so 4 of 5 free uses left renders as a 20% blue segment.

### Header control-system polish pass

- [P2] Search, AI writing, and the utility buttons used three different heights, radii, surface colors, borders, and vertical offsets. The AI card was 38px high, Search was 36px, and the three utility buttons were 30px.
  - Fix: created one header control system. At the native plugin width, all five controls are 36px high with an 8px radius, `#292929` surface, `#424242` border, shared hover tokens, and the same vertical center.
- [P2] The header’s width distribution and gaps felt accidental after independently iterating each control.
  - Fix: set 8px outer padding, 5px between Search/AI/utilities, 4px between utility icons, a 116px Search trigger, a 220px AI-writing card, and 36 × 36 utility buttons. The resulting 462px control row exactly fills the 478px inner shell after padding.
- [P2] Light mode retained separate utility-button surfaces after dark mode was unified.
  - Fix: moved light header surfaces, borders, and hover colors into the same header-level tokens so both themes preserve the system.
- Focused evidence: `./qa-header-system-final-comparison.png`
- Full-view evidence: `./header-polish-final-native.png`
- Required fidelity surfaces: typography remains legible and unwrapped; spacing and geometry are exact; dark and light color tokens are unified; no raster or substitute assets are introduced; and the existing customer-facing copy is unchanged.
- Post-fix comparison: no actionable P0, P1, or P2 differences remain.

### Step 1 configuration clarity pass

- [P2] Inclusion and completion used the same checkmark convention, while section counters said “selected.”
  - Fix: defined the controls as inclusion toggles with explicit accessible names such as “Remove Overview from docs,” changed every counter to “included,” and verified the count updates immediately when a row changes.
- [P2] “AI writing,” “Write with AI,” quota language, and small AI badges described one model in four different ways.
  - Fix: standardized the feature as “AI writing,” added a visible `On · 1 free use` state, replaced badge-like labels with plain `AI-written` metadata and a sparkle icon, and added a help control explaining that only labeled guideline sections use AI.
- [P2] Download was available before documentation existed.
  - Fix: removed Download from the initial state. It appears only after creation, beside a non-color `Docs created` confirmation.
- [P2] The header gave Search, quota, Upgrade, Website, LinkedIn, and theme controls equal persistent weight.
  - Fix: kept the essential Search, AI allowance, and theme controls in the header, then moved Website and LinkedIn into the bottom sidebar utility cluster.
- [P2] Outlines and low-contrast secondary text made the screen dense without improving hierarchy.
  - Fix: replaced stacked cards with one quiet AI surface plus section dividers, increased metadata and counter contrast, and let the selected-component content use the available canvas.
- [P2] Blue alone carried selected and enabled states.
  - Fix: kept checkmarks inside included controls, added explicit `On`/`Off` copy for AI writing, exposed `aria-pressed` and switch semantics, preserved a visible keyboard focus ring, and gave icon-only controls accessible names.
- Required fidelity surfaces: typography and metadata contrast are legible at the native frame; spacing uses a restrained 14px content rhythm with fewer containers; colors preserve graphite, blue, and green semantic tokens while adding text and icon cues; all interface icons remain from the single Tabler set with no substitute raster assets; and copy consistently uses “included,” “AI writing,” “AI-written,” “free use,” and American English.
- Primary states tested: changed one included row and confirmed the Usage count changed from 3 of 4 to 2 of 4; turned AI writing off and confirmed `Off · no AI use` plus `AI off` row metadata; restored AI writing; created docs and confirmed quota decreased from 4 of 5 to 3 of 5; confirmed Download appeared only after creation; activated Download and received confirmation; opened and keyboard-dismissed Search; and verified Website and LinkedIn as accessible sidebar links.
- Accessibility scope: DOM semantics, accessible control names, pressed/switch states, visible non-color state copy, and keyboard dismissal were inspected. Full screen-reader behavior and production contrast certification still require testing inside the real Figma iframe.
- Browser-rendered evidence: `./step1-component-docs-final.png`
- Post-create evidence: `./step1-component-docs-created.png`
- Post-fix comparison: `./qa-step1-component-docs-final-comparison.png`
- Focused comparison was not needed for this pass because the full 480 × 680 paired evidence keeps the affected header, AI state, counters, row metadata, and footer actions readable together.
- No actionable P0, P1, or P2 findings remain.

### Stable Search and sidebar-link pass

- Source visual truth: `./sidebar-links-search-stability-before-library.png` and `./sidebar-links-search-stability-before-component.png`.
- Browser-rendered implementation: `./sidebar-links-search-stability-final-library.png` and `./sidebar-links-search-stability-final-component.png`.
- Viewport and normalization: every source and implementation crop is 480 × 680 pixels at a 480 × 680 CSS plugin frame and device pixel ratio 1. The same dark-theme Library and Selected component states are compared.
- Full-view comparison evidence: `./qa-sidebar-links-search-stability-comparison.png`.
- Focused comparison was not needed because the four-panel full-view evidence keeps the complete 48px header and 52px sidebar readable at native size.
- [P2] Search changed from 116px in Library to 36px in focused workflows, shifting the AI allowance and creating a noticeable shell jump.
  - Fix: removed the route-specific compact state. Search now remains 116px wide in every 480px workflow; at compact responsive widths it becomes icon-only for every workflow, so it still never changes because of navigation.
- [P2] Website and LinkedIn were hidden one level deep inside Help & feedback instead of remaining available as product utilities.
  - Fix: added both as labeled, focusable external links in a separated bottom sidebar cluster above Help & feedback, and removed their duplicate Help-page buttons.
- Required fidelity surfaces: typography is unchanged and remains legible; spacing preserves the 36px header control system and uses the existing 36px sidebar icon rhythm; graphite, blue, and muted icon tokens remain consistent; both new icons use the existing Tabler library with no substitute assets; and link labels use clear product-facing American English.
- Primary interactions tested: switched from Library to Selected component and confirmed the Search/AI/theme geometry remained visually identical; opened Search in Library and dismissed it with Escape; verified the Website and LinkedIn links expose their production destinations and unique accessible names; and restored Library as the final deliverable state.
- Accessibility scope: both external links have descriptive labels, visible keyboard focus, tooltip labels on hover/focus, and standard link semantics.
- No browser-rendered errors or broken states were observed. Build and interaction checks remained clean.
- No actionable P0, P1, or P2 findings remain.

### Navigation and Library state-polish pass

- Source visual truth: `./navigation-library-states-before.png`.
- Browser-rendered implementation: `./navigation-library-states-final.png`.
- Viewport and normalization: source and implementation are 480 × 680 pixels at a 480 × 680 CSS Figma-plugin frame and device pixel ratio 1. Both show dark-theme Library with `buttonText` expanded.
- Full-view comparison evidence: `./qa-navigation-library-states-comparison.png`.
- Focused icon and expanded-row evidence: `./qa-navigation-library-states-focused.png`.
- Tooltip anchor evidence before and after activation: `./qa-navigation-tooltip-anchor-comparison.png`.
- Immediate expanded-state evidence: `./navigation-library-expanded-immediate.png`.
- [P2] Pressing a navigation item scaled the entire button, so the absolutely positioned tooltip inherited the transform and appeared to move in depth and position.
  - Fix: removed transforms from the navigation container and limited the 120ms press animation to the icon glyph. The tooltip now uses the same anchor before, during, and after activation.
- [P2] The database cylinder suggested storage infrastructure rather than a maintained documentation collection.
  - Fix: replaced it with Tabler’s Books icon in both the sidebar and Quick Search workflow result.
- [P2] Expanded update rows introduced new border edges while transitioning `border-color`; the new edges could briefly resolve from the element’s white text color before reaching blue.
  - Fix: every row now owns a full transparent border while collapsed, with only the bottom separator tinted. Expansion switches all four edges directly to the blue update token without a border-color transition.
- Required fidelity surfaces: fonts and copy are unchanged; sidebar and row geometry preserve the established 36px and 49px rhythms; blue update, graphite surface, and muted icon colors remain token-consistent; the replacement icon comes from the existing Tabler set with no custom asset; and no user-facing terminology changed.
- Primary interactions tested: collapsed and immediately re-expanded `buttonText`; confirmed the disclosure and row were expanded in the accessibility tree; captured the immediate frame with an already-blue outline; keyboard-focused a navigation destination and compared the tooltip before and after activation; and confirmed the Library icon remains active with its update badge.
- Accessibility scope: the new icon retains the existing `Library` accessible name and badge, while tooltip visibility remains available on focus without moving its text.
- Browser-rendered error check: no broken state or runtime error was observed. Build and interaction checks remained clean.
- No actionable P0, P1, or P2 findings remain.

### Selected component AI-label simplification pass

- Source visual truth: `./selected-component-ai-labels-before.png`.
- Browser-rendered implementation: `./selected-component-ai-labels-final.png`.
- Viewport and normalization: source and implementation are both 480 × 680 pixels at a 480 × 680 CSS Figma-plugin frame and device pixel ratio 1. Both show the dark-theme Selected component state with AI writing enabled and Usage expanded.
- Full-view comparison evidence: `./qa-selected-component-ai-labels-comparison.png`.
- Focused AI-control and Usage-row evidence: `./qa-selected-component-ai-labels-focused.png`.
- [P2] The explanatory sentence beside “Sections to include” repeated what the inclusion controls already communicate and weakened the compact heading hierarchy.
  - Fix: removed “Choose what appears in the generated docs.” and retained the standalone section heading.
- [P2] `On · 1 free use` duplicated switch state and quota information without providing an additional action.
  - Fix: removed the visible status/cost caption while retaining the semantic switch, checked state, help tooltip, and persistent header allowance.
- [P2] `AI-written` overstated authorship for sections that can combine deterministic extraction with an AI layer.
  - Fix: replaced the sparkle-plus-authorship label with a compact neutral `AI` capability badge and the accessible label “AI layer.” This pass supersedes the earlier authorship language recorded in the Step 1 clarity pass.
- Required fidelity surfaces: typography remains legible with less competing metadata; spacing and layout rhythm are cleaner without changing row height or the 480 × 680 composition; the neutral blue-gray AI token stays distinct from the brighter inclusion controls; all icons remain from the existing Tabler set and no raster substitutes were introduced; and copy now avoids unsupported claims about how a section was produced.
- Primary interactions tested: switched AI writing off and back on; confirmed the switch changed its semantic checked state; confirmed the neutral AI capability labels remained accurate in both states; and verified the deterministic `Create docs` action remained unchanged.
- Accessibility scope: the switch retains its `AI writing` accessible name and checked state, each compact badge exposes “AI layer,” and the updated help copy explains the one-use consequence without requiring duplicated visible status text.
- Browser-rendered error check: no broken state or runtime error was observed.
- Post-fix comparison: no actionable P0, P1, or P2 differences remain.

### Search command-palette repair pass

- Source visual truth: `./search-before-fix.png`.
- Browser-rendered implementation: `./search-after-fix.png`.
- Additional implementation state: `./search-empty-state.png`.
- Viewport and normalization: source and implementation are 480 × 680 pixels at a 480 × 680 CSS Figma-plugin frame and device pixel ratio 1. The primary comparison uses dark-theme Library with Search open and an empty query.
- Full-view comparison evidence: `./qa-search-before-after-comparison.png`.
- Focused command-palette evidence: `./qa-search-panel-focused-comparison.png`.
- [P1] Search filtered text but did not support keyboard navigation or Enter activation, so the advertised Command/Ctrl+K flow stopped short of completing a result.
  - Fix: added live combined workflow/document results, a selected result, Up/Down/Home/End navigation, Enter activation, Escape close, Command/Ctrl+K toggling, pointer selection, and focus return to the header trigger.
- [P2] The open animation replaced the panel's centering transform, causing the panel to begin at the frame midpoint and clip against the right edge.
  - Fix: anchored the palette with fixed 12px left/right insets inside the plugin shell and moved entrance motion to a dedicated vertical animation that cannot override horizontal placement.
- [P2] Search lacked clear completion and recovery cues.
  - Fix: added an explicit close control, query clear action, specific empty-state copy with a recovery button, selected-row styling, result arrows, and a compact keyboard-hint footer.
- [P2] The first light-theme pass inherited header-only custom properties outside the header, leaving the palette dark while its text switched to dark colors.
  - Fix: assigned the light palette an explicit `#f3f3f3` surface, light border and shadow, readable secondary text, and matching selected/empty/footer tokens.
  - Before-and-after light-theme evidence: `./qa-search-light-comparison.png`.
- Required fidelity surfaces: Inter typography remains consistent with the prototype and gains a clearer selected-result hierarchy; 12px frame insets, 41px result rows, 10px radius, section rhythm, and footer geometry remain consistent at the native viewport; graphite, restrained blue, green source, and light-theme tokens are explicit and readable; all visible icons use the existing Tabler library with no substitute assets; and the empty state, keyboard hints, result labels, and action names use concise American English.
- Primary interactions tested: opened with the header trigger; filtered to a unique Library document and opened it with Enter; navigated a mixed workflow/document result set with Arrow Down; rendered and cleared the no-results state; cycled Tab focus inside the modal; closed with Escape; toggled open and closed with Command+K; verified focus returned to the header trigger; and checked the full palette in dark and light themes.
- Accessibility scope: Search exposes a modal dialog, combobox, controlled listbox, selected option, active descendant, descriptive close and clear buttons, contained Tab focus, and restored trigger focus. Full screen-reader behavior still requires validation inside the production Figma iframe.
- Browser-rendered error check: no broken state or runtime error was observed.
- Post-fix comparison: no actionable P0, P1, or P2 findings remain.

### Foundation flat-selection pass

- Source visual truth: `./foundation-selection-before.png`.
- Browser-rendered implementation: `./foundation-selection-after.png`.
- Additional implementation state: `./foundation-selection-partial.png`.
- Viewport and normalization: source and implementation are 480 × 680 pixels at a 480 × 680 CSS Figma-plugin frame and device pixel ratio 1. Both use dark theme, Foundation documents selected, and all five sources included.
- Full-view comparison evidence: `./qa-foundation-selection-comparison.png`.
- Focused comparison was not needed because the full-view pair keeps the entire title, bulk-selection toolbar, five source rows, checkboxes, metadata, and Create action readable together at native size.
- [P2] The subtitle repeated the page title’s purpose and left unnecessary vertical space above a short list.
  - Fix: removed “Choose the system sources to turn into documentation.” and compacted the title region to the same 48px rhythm used elsewhere.
- [P2] Foundation used a separate gray checkbox treatment while Selected component used the established blue inclusion control.
  - Fix: extracted one reusable `InclusionCheckbox` and now use it in both workflows, including checked, unchecked, and mixed states.
- [P2] Disclosure chevrons suggested hidden configuration even though the rows do not need collapsible content.
  - Fix: removed all disclosure state, chevrons, and details regions; each full row is now a direct inclusion toggle.
- [P2] “Clear all” was a one-way text action that did not explain partial or empty selection states.
  - Fix: made it one state-aware bulk control. It shows the shared checked checkbox with “Clear all” when complete, a minus/mixed checkbox with “Select all” when partial, and an empty checkbox with “Select all” when empty.
- [P2] The first light-theme render inherited muted Foundation text colors with insufficient contrast.
  - Fix: added explicit light-theme Foundation title, row-label, metadata, source-icon, divider, and bulk-control tokens.
  - Before-and-after light-theme evidence: `./qa-foundation-light-comparison.png`.
- Required fidelity surfaces: typography remains legible at native plugin size with a clear title/row/metadata hierarchy; spacing uses one compact title row, one 38px bulk toolbar, and consistent flat source rows; graphite, blue inclusion, green source, and light-theme contrast tokens are explicit; all icons remain from the existing Tabler set with no substitute image assets; and copy uses concise American English with “included,” “Select all,” and “Clear all.”
- Primary interactions tested: cleared all sources and confirmed `0 of 5 included` plus the disabled `Select sources to continue` action; selected all and confirmed `5 of 5 included` plus `Create 9 frames`; deselected Foundation and confirmed the mixed bulk state, `4 of 5 included`, and `Create 4 frames`; restored all sources; and confirmed the accessibility tree exposes no Expand or Collapse controls.
- Browser-rendered error check: no broken state or runtime error was observed.
- Post-fix comparison: no actionable P0, P1, or P2 findings remain.

### Sidebar workflow-grouping pass

- Source visual truth: `./sidebar-grouping-before.png`.
- Browser-rendered implementation: `./sidebar-grouping-final.png`.
- Viewport and normalization: source and implementation are 480 × 680 pixels at a 480 × 680 CSS Figma-plugin frame and device pixel ratio 1. Both use dark theme, Foundation documents selected, and all five sources included.
- Full-view comparison evidence: `./qa-sidebar-grouping-comparison.png`.
- Focused rail evidence: `./qa-sidebar-grouping-focused.png`.
- [P2] The five product jobs appeared as two broad groups that mixed creation and maintenance, making Library feel like a peer of both generators rather than the central maintenance workspace.
  - Fix: grouped Generate component docs and Generate foundation docs first, added a short low-contrast separator, placed Library alone with its update badge, added a second separator, then grouped Settings and License.
- [P2] The sidebar called the plan-and-activation destination “Subscription” while the revised navigation model calls the user’s task “License.”
  - Fix: changed the rail tooltip, Quick Search workflow label, and destination title to “License,” while retaining plan and activation details inside the screen.
- Required fidelity surfaces: typography is unchanged and tooltips retain concise labels; spacing uses the established 36px icon rhythm with two 28px hairline separators and 7px vertical margins; graphite, blue selection, and muted border tokens remain consistent in dark and light themes; all visible navigation icons remain from the existing Tabler set with no substitute assets; and copy uses the requested Generate, Library, Settings, and License terminology.
- Primary interactions tested: navigated to License and confirmed the destination title; returned to Foundation documents; verified the DOM order is Generate component docs, Generate foundation docs, Library, Settings, License; confirmed Library retains its update badge; and checked the grouped rail in dark and light themes.
- Accessibility scope: each group is now a separately labeled navigation region—Create documentation, Library maintenance, and Plugin settings—while all existing button names, selected states, focus treatment, and tooltips remain intact.
- Browser-rendered error check: the final refreshed page produced no warnings or errors.
- Post-fix comparison: no actionable P0, P1, or P2 findings remain.

### Settings frame-theme alignment pass

- Source visual truth: `./source-visual-truth/codex-clipboard-db146e4e-6d3e-40f1-8a3a-e170a21689b4.png`, supported by the current plugin implementation in `packages/plugin/src/ui/dom.ts`, `packages/plugin/src/ui/ui.ts`, and `packages/plugin/TESTING.md`.
- Browser-rendered implementation: `./settings-frame-theme-tech-final.png`.
- Additional implementation state: `./settings-frame-theme-custom-final.png`.
- Viewport and normalization: the current-plugin source is 948 × 1338 pixels and was normalized to 480 × 678 for comparison. The implementation is 480 × 680 pixels at a 480 × 680 CSS Figma-plugin frame and device pixel ratio 1. Both comparison states use dark theme with Tech selected; the Custom state is captured separately.
- Source-to-implementation evidence: `./qa-settings-current-plugin-reference.png`.
- Focused themes-and-logo evidence: `./qa-settings-current-plugin-focused.png`.
- Prototype before-and-after evidence: `./qa-settings-frame-theme-comparison.png`.
- Preset-to-Custom interaction evidence: `./qa-settings-custom-state.png`.
- [P2] Settings duplicated the plugin appearance control even though the header already owns interface theme.
  - Fix: removed Plugin appearance and kept Settings focused on generated-frame output.
- [P2] Settings duplicated the free AI allowance even though plan and license management have a dedicated destination.
  - Fix: removed AI generation from Settings and retained the monthly allowance on License.
- [P2] The four-card Frame theme control omitted the current plugin’s Custom option and did not expose its configuration behavior.
  - Fix: restored Default, Editorial, Tech, Warm, and Custom. Selecting Custom reveals header, accent, body, and table colors plus heading and body fonts; choosing a preset hides those controls without discarding the custom values.
- [P2] The simplified Settings screen omitted the logo control that remains available across all frame themes in the current plugin.
  - Fix: restored the always-visible selected-node logo action, with replace, remove, and attached feedback states.
- [P2] “Changes save automatically” and “Save changes” communicated contradictory persistence models.
  - Fix: removed the footer; controls now behave as direct settings without an unnecessary submit action.
- [P2] The first light-theme pass left the Settings title and section labels at dark-mode contrast values.
  - Fix: added explicit light-theme title, section-label, card, input, and supporting-copy tokens.
  - Before-and-after evidence: `./qa-settings-light-comparison.png`.
- Required fidelity surfaces: typography preserves the prototype’s Inter hierarchy while giving Settings and section labels readable dark/light contrast; spacing keeps the 480 × 680 plugin frame, compact five-card theme row, one clear customization region, and stable logo placement; graphite, restrained blue selection, preset swatches, and custom color values map to explicit tokens; all visible symbols use the existing Tabler icon library and no substitute image assets; and copy uses concise American English with “Frame theme,” “Customize,” and “Use selected node as logo.”
- Primary interactions tested: selected Custom and edited the accent color; attached, replaced, and removed a logo; selected Tech and confirmed Custom controls hide; returned to Custom and confirmed its values persist; opened License and confirmed the AI allowance remains there; switched to light theme and verified the repaired contrast; and restored dark theme with default custom values and no attached logo.
- Browser-rendered error check: no broken state or runtime error was observed.
- Post-fix comparison: no actionable P0, P1, or P2 findings remain.

### License state-system pass

- Source visual truth: `./source-visual-truth/codex-clipboard-db146e4e-6d3e-40f1-8a3a-e170a21689b4.png`, supported by the current plugin state logic in `packages/plugin/src/ui/proxy.ts`, `packages/plugin/src/ui/render.ts`, `packages/plugin/src/ui/ui.ts`, and `packages/plugin/TESTING.md`.
- Browser-rendered implementation: `./license-free-final.png`.
- Additional implementation states: `./license-pro-final.png`, `./license-expired-final.png`, `./license-unverified-final.png`, and `./license-device-limit-final.png`.
- Viewport and normalization: the current-plugin source is 948 × 1338 pixels and was normalized to 480 × 678 for comparison. The prototype captures are 480 × 680 pixels at a 480 × 680 CSS Figma-plugin frame and device pixel ratio 1. The source-to-implementation comparison uses the Pro-active dark state; the prototype before-and-after comparison uses the free dark state.
- Source-to-implementation evidence: `./qa-license-current-plugin-reference.png`.
- Prototype before-and-after evidence: `./qa-license-free-comparison.png`.
- Focused state-system evidence: `./license-state-showcase.png`.
- Intentional product difference: the current-plugin screenshot co-locates Pro activation and Frame theme under Settings. The prototype keeps the original license semantics but moves plan and activation into the dedicated License destination, preserving the previously approved workflow structure.
- [P2] The initial License page represented only a generic free card and an optimistic activation action, while the original plugin distinguishes active, expired, disconnected, saved-but-unverifiable, invalid, disabled, device-limit, unreachable, checking, removing, and removed outcomes.
  - Fix: implemented the complete state model with state-specific copy, semantic status tones, recovery actions, disabled/loading states, and persistent-key behavior.
- [P2] The initial screen repeated a static “Free plan active” footer and a Done action even though the page has no staged changes.
  - Fix: removed the footer and made plan and activation controls direct, leaving one clear current-plan card and one activation/connection region.
- [P2] Free allowance information was split between a generic plan row and the persistent header, leaving the dedicated License destination without a useful monthly usage view.
  - Fix: added a compact AI-writing usage row, remaining-use count, reset date, and meter inside the plan card while keeping the header summary unchanged.
- [P2] A temporarily unreachable license server could incorrectly make a saved Pro key look definitely free or expired.
  - Fix: introduced a dedicated unverified state. The key remains saved, the header says plan status is unavailable, and Retry, Manage subscription, and Remove key remain available without making a false plan claim.
- [P2] The active-Pro treatment duplicated subscription actions and did not clearly separate plan benefits from the device connection.
  - Fix: kept Manage subscription once in the plan card, moved the masked device key and connection status into a dedicated row, and left Remove key as the only device-level action.
- Required fidelity surfaces: typography keeps the prototype’s compact Inter hierarchy with distinct page, plan, section, status-title, and supporting-copy weights; spacing uses one 13px plan card, a 16px section break, 34px activation controls, compact state messages, and no footer chrome; graphite, restrained blue, semantic green/amber/red, disabled, and light-theme tokens remain readable; all visible symbols use the existing Tabler icon library with no generated or substitute image assets; and copy uses concise American English while preserving the original plugin’s recovery meaning.
- Primary interactions tested: submitted a valid Pro key; observed Checking and Pro active; verified the persistent header switches to Unlimited with Pro; removed the key through Removing and returned to free; tested invalid, expired, disconnected, saved/unverified, disabled, device-limit, server-unreachable, and removed states; verified Enter/submit semantics, disabled empty activation, masked key display, Retry, Renew Pro, Manage subscription, Contact support, and Remove key actions; checked dark and light themes; and opened License directly at the native plugin viewport.
- Accessibility scope: the license field has an explicit accessible label; status changes use status or alert roles; disabled and loading buttons remain semantically represented; focus treatment, error copy, and non-color status icons are visible; and reduced-motion mode suppresses the spinner animation.
- Browser-rendered error check: the final page produced no warnings or errors.
- Post-fix comparison: no actionable P0, P1, or P2 findings remain.

## Primary interactions tested

- Confirmed the free quota stays visible in Library, Selected component, Foundations, Settings, and Subscription.
- Confirmed Selected component contains no progress UI.
- Switched AI writing off and verified that “Create docs” remains unchanged and deterministic creation does not consume quota.
- Verified the AI writing help tooltip explains guideline assistance, deterministic Figma extraction, and the one-generation cost.
- Verified Accessibility contains Interactions, Content considerations, and Semantics & focus.
- Verified the Selected component screen has no readiness subtitle, section-count footer summary, or AI-dependent CTA label.
- Clicked a Library item and verified the “Opening … in Figma” response.
- Reviewed concrete detected changes independently from the item row.
- Opened the Library overflow and verified review/hide, update documentation, open frame, view source, reconnect, and remove connection actions.
- Verified the header contains the product’s only Search surface and Library no longer duplicates it inside the page.
- Opened header Search, searched for `buttonPrimary`, selected the connected document, and verified the plugin returned to Library with Figma-opening feedback.
- Verified Search remains centered inside the plugin frame, supports selected-result keyboard navigation and Enter activation, provides clear and empty-state recovery, contains Tab focus, toggles with Command/Ctrl+K, closes with Escape, and restores focus to the header trigger.
- Verified Library filters are content-width, contain no dot indicators, and expose plain text counts.
- Verified the Library header has no overflow action and the footer pairs the secondary refresh action with the primary batch update action.
- Clicked “Refresh library” and verified its completion feedback without mutating existing update statuses.
- Verified the expanded heading is simply “Changes” and has no leading icon.
- Verified expanded change groups contain no aggregate summary captions and retain their concrete change lists.
- Verified the Library title has no duplicate totals beneath it and that the larger filter tabs remain content-width with all three counts visible.
- Verified expanded rows omit the comparison subline and exact overall change totals.
- Verified a source update without a supported structured diff presents the explicit source-review fallback instead of an empty or exhaustive-looking change list.
- Verified Foundation documents contains exactly five flat source rows and no category headers or category descriptions.
- Verified Foundation documents has no subtitle, disclosure chevrons, collapsible content, or hidden details regions.
- Verified Foundation and Selected component use the same inclusion checkbox component.
- Verified the Foundation bulk control changes between checked “Clear all,” mixed “Select all,” and unchecked “Select all” states and that its count and Create action update with the selection.
- Verified the sidebar separates creation workflows, Library maintenance, and Settings/License into three labeled navigation groups.
- Verified License opens the matching destination and Library retains its update badge in the new order.
- Verified Settings contains generated-frame controls only, with no duplicate interface-theme or AI-allowance section.
- Verified Frame theme offers Default, Editorial, Tech, Warm, and Custom, and that Custom reveals color and font fields.
- Verified the logo setting remains available for preset and Custom themes while AI allowance stays on License.
- Verified License is the single owner of plan status, detailed AI allowance, activation, renewal, subscription management, and device-key removal.
- Verified free, Checking, Pro active, expired, disconnected, saved/unverified, invalid, disabled, device-limit, server-unreachable, Removing, and removed License states.
- Verified an unverified saved key is never mislabeled as expired or definitely free, and that Retry, Manage subscription, and Remove key remain available.
- Verified Pro activation changes the persistent header to Unlimited with Pro and removal returns both the page and header to the free state.
- Verified neither generation workflow contains Preview text or controls.
- Verified the Foundation footer contains only the full-width Create action and the Library expanded card contains only one sync age.
- Verified Foundation creation automatically decreases the free AI quota by one.
- Verified Foundation contains no AI-description switch and no non-American interface spelling.
- Verified the active sidebar destination has a blue icon and background fill with no indicator, border, outline, or stroke.
- Verified Mapped Colors has no modes content, expansion control, or hidden details region.
- Verified Foundation documents has no header overflow action.
- Verified Foundation documents contains no update-status block above the Create action.
- Verified Text styles is absent from primary navigation.
- Verified the header contains Search, the reference-inspired AI-writing allowance, and theme switching; duplicated product identity and close controls are absent.
- Verified the header contains no custom logo or Spec Layer product title, the allowance remains prominent, and Website and LinkedIn remain independently accessible at the bottom of the sidebar.
- Verified workflow titles remain in the content region without adding a logo or Spec Layer name to the header.
- Verified Library has one content title and Component retains `buttonPrimary` as the selected source identity.
- Verified the compact quota opens Subscription and the header theme control switches in both directions.
- Verified Website and LinkedIn expose the production destinations and unique accessible labels.
- Verified the 220px quota treatment uses a circular meter with no copy wrapping or overflow at the native 480 × 680 frame.
- Verified Search, AI writing, Website, LinkedIn, and theme are all exactly 36px high with matching 8px radii, surfaces, borders, and vertical positions.
- Verified the unified header treatment remains consistent in light mode and returns to dark mode cleanly.
- Verified the live available-state quota still opens Subscription.
- Verified Step 1 uses `included` terminology and exposes inclusion controls with action-specific accessible names.
- Verified the Step 1 AI switch changes its semantic checked state without adding redundant visible cost text or changing the neutral AI capability badges and deterministic Create docs action.
- Verified the initial Step 1 footer has no Download action; creation reveals Download and decreases the allowance by one.
- Verified Website and LinkedIn now live at the bottom of the left sidebar rather than the persistent header or Help page.
- Verified navigation press feedback scales only the icon glyph and leaves the tooltip anchor unchanged.
- Verified Library uses the Books icon in navigation and Quick Search while retaining the `Library` accessible label.
- Verified expanded update rows render a blue border immediately with no white intermediate edge.
- Verified available, low, and exhausted free states all show the customer-facing “AI writing” label, free-use copy, and a visible Upgrade action; Pro shows “Unlimited with Pro” and Active.
- Clicked the persistent quota/Upgrade surface and verified it opens Subscription.
- Verified the sidebar ends with Help & feedback and no longer duplicates theme or close controls.
- Verified build success, 480 × 680 layout, 360 × 640 compact layout, and an empty browser error/warning log.

## Follow-up polish

- In a real Figma iframe, validate OS-level font rasterization, hover timing, and focus restoration after returning from a source-node jump.

### License free-plan readability pass

- Source visual truth: `./source-visual-truth/codex-clipboard-7fb4bff0-82ab-446c-ba33-197d5a29426c.png`.
- Browser-rendered implementation: `./license-contrast-final.png`.
- Light-theme implementation: `./license-contrast-light-final.png`.
- State and viewport: License, free plan, 4 of 5 free uses remaining, native 480 × 680 CSS-pixel Figma-plugin frame at device pixel ratio 1.
- Density normalization: the source card is 840 × 364 pixels at 144 dpi. The implementation card was captured as a 398 × 166 region from the 480 × 680 browser-rendered frame, then normalized to 840 × 364 only for focused visual comparison.
- Full-view evidence: `./license-contrast-final.png`.
- Focused source-to-implementation evidence: `./qa-license-contrast-comparison.png`.
- [P2] The plan description, reset date, and remaining-use count were too small and quiet against the dark card surface.
  - Fix: increased the plan description from 8.5px to 9.5px, the remaining-use copy from 8.5px to 9.5px, and the reset date from 8px to 9px; raised dark-theme supporting copy to `#c1c1c1` and `#adadad`, and light-theme supporting copy to `#595959`.
  - Post-fix evidence: the focused comparison shows a clearer type scale and stronger foreground separation while retaining the card’s existing hierarchy and density.
- [P2] The License header repeated the explanatory subtitle “Plan, AI usage, and activation,” even though the page sections already communicate those jobs.
  - Fix: removed the subtitle and kept the standalone License title.
- Required fidelity surfaces: Inter remains the active family and the revised small-text sizes preserve hierarchy without truncation; card spacing, grid tracks, radius, divider, and action placement are unchanged; dark and light foreground tokens now provide stronger separation from their surfaces; the existing Tabler icons remain sharp and no raster or substitute assets were introduced; and all visible copy remains concise American English.
- React review: the JSX change only removes an unused `PageHeader` prop and introduces no new state, effects, event listeners, rendering branches, or accessibility regressions.
- Primary interactions tested: opened the free License state directly; confirmed the page subtitle is absent from the rendered accessibility tree; switched between dark and light themes; confirmed the allowance, Upgrade action, and activation field remain intact.
- Browser-rendered error check: no browser warnings or runtime errors were observed.
- Build verification: `npm run test:sites` passed all 4 tests and `npm run build` completed successfully.
- Post-fix comparison: no actionable P0, P1, or P2 findings remain.

### Library navigation icon pass

- Source visual truth: `./library-icon-before.png`.
- Browser-rendered implementation: `./library-icon-folder-final.png`.
- State and viewport: Library selected, first update row expanded, native 480 × 680 CSS-pixel Figma-plugin frame at device pixel ratio 1.
- Density normalization: both source and implementation are 480 × 680 pixel crops from the same in-app browser surface and require no normalization.
- Full-view and focused comparison evidence: `./qa-library-icon-comparison.png`. The complete frame confirms no layout drift, while the aligned 52px rail provides the focused icon comparison.
- [P2] The Tabler Books mark was visually detailed and less immediately recognizable as a general Library destination at the compact 18px rail size.
  - Fix: replaced it with the familiar Tabler Folder icon in both the sidebar destination and Quick Search workflow result.
  - Post-fix evidence: the folder silhouette remains legible at the native rail size, keeps the selected blue treatment, and is clearly distinct from the single-document and Foundations icons.
- Required fidelity surfaces: typography, copy, spacing, layout rhythm, colors, selected state, and badge placement are unchanged; the replacement uses the existing Tabler icon library at the same size and stroke treatment, so it remains sharp without introducing a raster or substitute asset.
- React review: the change replaces one imported icon component and its two static references; it adds no state, effects, listeners, rendering branches, or accessibility changes.
- Primary interactions tested: opened Library directly; confirmed the selected sidebar state; opened Quick Search and confirmed its Library result uses the same Folder icon.
- Browser-rendered error check: no browser warnings or runtime errors were observed.
- Build verification: `npm run test:sites` passed all 4 tests and `npm run build` completed successfully.
- Post-fix comparison: no actionable P0, P1, or P2 findings remain.

### Component inline-configuration pass

- Source visual truth: `./source-visual-truth/codex-clipboard-03c58059-aaaf-4c25-8c47-a8298ab24d57.png`.
- Browser-rendered implementation: `./component-measurements-final.png`.
- Light-theme implementation: `./component-measurements-light-final.png`.
- State and viewport: Selected component, Specifications expanded, Anatomy included as Diagram, Measurements included, Height & width and Children & spacing selected, Inner padding unselected and keyboard-focused; native 480 × 680 CSS-pixel Figma-plugin frame at device pixel ratio 1.
- Density normalization: the source region is 864 × 350 pixels at 144 dpi. The implementation region was captured as a 406 × 167 pixel crop from the native browser-rendered frame, then normalized to 864 × 350 only for focused visual comparison.
- Full-view evidence: `./component-measurements-final.png`.
- Focused source-to-implementation evidence: `./qa-component-measurements-comparison.png`.
- [P2] Anatomy and Measurements were always-visible inline configurations but displayed disclosure chevrons, incorrectly implying that each row could expand or collapse.
  - Fix: removed child-row disclosure icons and the dormant reveal animation while keeping the section-level Specifications chevron intact.
- [P2] Measurement chips looked selected but had no interactive selection behavior or semantic selected state.
  - Fix: added independent chip state, `aria-pressed`, a labeled measurement group, stable check-icon slots, selected and unselected styling, hover and focus feedback, and a disabled state when the Measurements section is excluded.
- [P2] The new unselected dark-theme chip token carried into light mode as an almost-black surface.
  - Fix: added dedicated light-theme selected, unselected, and hover tokens that retain the same semantic hierarchy without the dark surface.
- Required fidelity surfaces: Inter typography, row heights, indentation, dividers, segmented Anatomy control, and surrounding layout are unchanged; selected blue, neutral unselected, focus, disabled, dark, and light tokens are visibly distinct; all checkmarks use the existing Tabler icon library; no raster or generated assets were introduced; and the visible copy remains unchanged and uses American English.
- React review: the measurement choices are a hoisted static array; chip state uses a functional update; controls remain native buttons with explicit `type`, `aria-pressed`, group labeling, and disabled semantics; and no effects, event listeners, derived-state synchronization, or expensive rendering were added.
- Primary interactions tested: opened the direct Selected component + Specifications URL; toggled Inner padding off and on; verified checked and unchecked semantic states; excluded Measurements and verified all chips became disabled while retaining their choices; restored Measurements; checked dark and light themes; and confirmed Anatomy and Measurements no longer expose disclosure icons.
- Browser-rendered error check: no browser warnings or runtime errors were observed.
- Build verification: `npm run test:sites` passed all 4 tests and `npm run build` completed successfully.
- Post-fix comparison: no actionable P0, P1, or P2 findings remain.

### Component AI-badge state pass

- Source visual truth: `./component-ai-badges-on.png`.
- Browser-rendered implementation: `./component-ai-badges-off.png`.
- State and viewport: Selected component, Usage expanded, native 480 × 680 CSS-pixel Figma-plugin frame at device pixel ratio 1. The left comparison state has AI writing enabled; the right state has it disabled.
- Density normalization: both captures are 480 × 680 pixel crops from the same in-app browser surface and require no normalization.
- Full-view and focused state comparison evidence: `./qa-component-ai-badges-comparison.png`. The full frame confirms stable layout; the expanded Usage rows provide the focused badge comparison.
- [P2] Section-level AI badges remained visible after AI writing was turned off, which could imply that AI would still participate in deterministic document creation.
  - Fix: conditionally render the shared AI badge only while AI writing is enabled. Turning the switch off removes all six badges from the visual UI and accessibility tree; turning it back on restores them.
- Required fidelity surfaces: typography, row heights, dividers, checkbox alignment, counts, section spacing, dark tokens, and all deterministic copy are unchanged; no image or icon assets were added; and the off state becomes visually quieter without introducing a replacement label or disabled-looking badge.
- React review: the badge is a simple render-time expression derived from the existing `aiEnabled` boolean; no duplicate state, effects, memoization, listeners, or additional rerenders were introduced. A small query-state initializer supports stable direct inspection of the AI-off prototype state.
- Primary interactions tested: opened the AI-on and AI-off Selected component URLs; verified the switch semantic state; confirmed six AI-layer labels while enabled and zero while disabled; and confirmed the deterministic Create docs action remains unchanged.
- Browser-rendered error check: no browser warnings or runtime errors were observed.
- Build verification: `npm run test:sites` passed all 4 tests and `npm run build` completed successfully.
- Post-fix comparison: no actionable P0, P1, or P2 findings remain.

### Reusable plugin design-system pass

- Source visual truth: the approved native plugin captures at `./library-icon-folder-final.png`, `./component-measurements-final.png`, and `./license-contrast-final.png`.
- Browser-rendered implementation: `./design-system-foundations-dark.png`, `./design-system-inputs-light.png`, and `./design-system-patterns-dark.png`.
- State and viewport: direct-only `?view=system` catalog route; Foundations and Patterns in dark theme, Inputs in light theme; native 480 × 680 CSS-pixel Figma-plugin frame at device pixel ratio 1.
- Density normalization: all six source and implementation captures are 480 × 680 pixels at the same CSS size and density, so no resampling was required.
- Full-view and focused comparison evidence: `./qa-design-system-comparison.png`. The 1440 × 1360 contact sheet places the three approved workflow screens directly above the three catalog captures. The full frames verify shell, header, rail, density, and theme consistency; the native-size controls inside each frame are large enough to judge typography, border, icon, and state fidelity without a separate crop.
- Required fidelity surfaces:
  - Fonts and typography: Inter and the existing system fallback stack are preserved. The 9–16px scale, 1.15/1.4 line-height pair, 450–720 weights, and muted text hierarchy match the dense approved plugin language without visible clipping.
  - Spacing and layout rhythm: the 480 × 680 shell, 52px rail, 48px utility header, 4/8/12/16/24/32 spacing scale, 28/34/36px control heights, 4/7/10px radii, short dividers, and compact catalog cards retain the approved density and alignment.
  - Colors and visual tokens: graphite canvas/surface roles, restrained blue selection and focus, and green/amber/red semantic roles map consistently across dark and light themes. Focus, selected, disabled, error, success, warning, and danger states remain distinguishable without relying on color alone.
  - Image quality and asset fidelity: the system uses the existing Tabler icon library for interface symbols. It introduces no raster assets, custom SVG approximations, emoji, logos, or decorative placeholders; icons remain sharp at native size.
  - Copy and content: labels are concise, workflow-specific, and use American English. Examples preserve the product’s deterministic-docs model and use “AI writing,” “free uses,” “Create docs,” and “Changes” consistently.
- Initial interaction-review findings:
  - [P2] The reusable Button spread could allow an explicit prop to override the loading-disabled state.
    - Fix: destructured `disabled` and combined it with `loading` before passing the native attribute.
    - Post-fix evidence: the Actions example exposes `Working…` as a disabled native button during the loading interval.
  - [P2] The mixed checkbox was visually mixed but did not set the native checkbox’s indeterminate property.
    - Fix: synchronized the native `indeterminate` property and retained `aria-checked="mixed"`.
    - Post-fix evidence: the browser accessibility snapshot reports `checkbox "Mixed group" [checked=mixed]`.
  - [P2] The dialog opened visually but did not provide an initial focus target or Escape dismissal.
    - Fix: moved focus to the labeled close button, connected the description, and added scoped Escape handling with listener cleanup.
    - Post-fix evidence: browser inspection reports `Close dialog` as the active accessible control after opening, and pressing Escape removes the dialog.
- Primary interactions tested: switched all six catalog categories; edited Search and License fields; toggled checkbox, radio, switch, segmented control, and measurement chips; verified mixed, disabled, selected, error, loading, toast, menu, disclosure, dialog, and sticky-footer states; switched between dark and light themes; and confirmed the catalog remains fully contained in the native plugin frame.
- React review: static catalog data is hoisted; state is local to the examples that own it; functional updates are used for toggles; global listeners are scoped to effects with cleanup; every action uses a native control with explicit labeling; and no data waterfalls, expensive render loops, or duplicated derived state were introduced.
- Browser-rendered error check: repeated navigation and interaction through the in-app browser produced no visible runtime errors, broken renders, or failed control actions; the rendered accessibility tree remained available after each interaction.
- Build verification: `npm run test:sites` passed all 4 tests and `npm run build` completed successfully.
- Post-fix comparison: no actionable P0, P1, or P2 findings remain. A future production migration should add automated component tests and formal focus trapping for the reusable dialog primitive.

### Light-theme semantic-token migration

- Source visual truth: the failing light-theme captures from the current prototype audit at `./audit-light-component.png`, `./audit-light-library.png`, and `./audit-light-license.png`, plus the approved dark-theme workflow captures already recorded above.
- Browser-rendered implementation: `./light-theme-component-final-v2.png`, `./light-theme-library-final-v2.png`, `./light-theme-foundations-final-v2.png`, `./light-theme-settings-final-v2.png`, `./light-theme-license-final-v2.png`, and `./light-theme-tokens-final-v2.png`.
- State and viewport: Selected component, expanded Library update, Foundation documents, Settings, free License, and design-system Foundations; light theme at the native 480 × 680 CSS-pixel Figma-plugin frame with device pixel ratio 1. Dark theme was also toggled and visually checked after migration.
- Density normalization: all source and implementation frames are 480 × 680 pixels at the same CSS size and density. No normalization was required.
- Full-view and focused comparison evidence: `./qa-light-theme-token-migration.png`. The 1440 × 1360 comparison places the failing Component, Library, and License states above their corrected equivalents. This gives both complete-frame hierarchy evidence and readable focused evidence for titles, cards, rows, controls, borders, status colors, and supporting text.
- Initial findings and fixes:
  - [P1] Component and Library names inherited the dark foreground and disappeared on the light canvas.
    - Cause: legacy aliases were inherited from `:root` after resolving against dark semantic values; changing descendant semantic variables did not recompute those aliases.
    - Fix: redeclared every legacy alias at `.light-theme` and explicitly set the themed root foreground.
    - Post-fix evidence: `buttonPrimary`, all Library document names, `Changes`, and change-group labels are clearly visible in the bottom comparison row.
  - [P2] Light mode was split between legacy variables, dark literals, selector overrides, and the newer `--sl-color-*` catalog roles.
    - Fix: made semantic roles the source of truth, aliased existing plugin variables to them, and replaced the highest-impact light overrides with semantic surface, border, foreground, accent, and state roles.
    - Post-fix evidence: Component, Library, Foundations, Settings, License, header, rail, and footer now share one canvas/chrome/surface hierarchy.
  - [P2] The Library selected tab used a near-black dark-theme fill in light mode.
    - Fix: mapped selected tabs to a raised white surface with a semantic border and soft shadow; update selection uses the semantic blue-selected surface.
  - [P2] The light License card, field, and chrome were compressed into nearly identical grays.
    - Fix: separated the `#F7F7F8` canvas, `#F0F1F2` chrome, `#FFFFFF` raised card/field, `#D5D7DA` border, and darker `#0875C1` accent.
  - [P2] The design-system catalog showed dark hex labels while light mode was active.
    - Fix: passed the live theme state into the catalog and render the active semantic values.
- Required fidelity surfaces:
  - Fonts and typography: Inter, the 9–20px workflow scale, weights, line heights, and wrapping remain unchanged. Restored foreground mapping makes every title and dense label legible without altering approved dark-theme typography.
  - Spacing and layout rhythm: the 480 × 680 shell, 52px rail, 48px header, page margins, row heights, card radii, dividers, and sticky footer geometry are unchanged. The migration changes color roles only.
  - Colors and visual tokens: light mode now uses `#F7F7F8` canvas, `#F0F1F2` chrome/surface, `#F3F4F5` subdued surface, `#FFFFFF` raised surface, `#D5D7DA` border, `#B9BDC2` strong border, `#1D1F22` primary text, `#5D6268` muted text, and `#0875C1` accent. Success, warning, danger, focus, disabled, selected, and hover states use semantic roles.
  - Image quality and asset fidelity: no raster, illustration, logo, custom SVG, CSS drawing, or replacement asset was introduced. Existing Tabler icons remain sharp and retain the approved stroke treatment.
  - Copy and content: all workflow copy is unchanged and remains American English. The catalog now accurately reports the active theme’s values.
- React review: the only component change passes the existing primitive `isLight` boolean into the catalog and selects from hoisted static light/dark token values during render. It introduces no effects, duplicated state, data fetching, event listeners, render waterfalls, or expensive work.
- Primary interactions tested: navigated among Component, Library, Foundations, Settings, and License; expanded Library changes; toggled Foundation Clear all and Select all; switched the real plugin and catalog between light and dark; and confirmed the active catalog values update with the theme.
- Browser-rendered error check: both the workflow tab and design-system tab returned an empty warning/error log after navigation and theme interaction.
- Build verification: `npm run test:sites` passed all 4 tests and `npm run build` completed successfully after the final semantic-token changes.
- Post-fix comparison: the corrected hierarchy, readable titles, coherent surfaces, stronger status colors, and preserved dark theme leave no actionable P0, P1, or P2 findings.

final result: passed
