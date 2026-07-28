# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Prototype design decisions

- This prototype is intentionally isolated from the Spec Layer production codebase.
- Use American English in all interface copy and documentation.
- Target the native Figma plugin viewport at 480 × 680 logical CSS pixels.
- Use the selected “Native Library” concept as the visual source of truth.
- Keep a compact 52px icon rail so new capabilities can scale without crowding the header.
- Treat Library as the central workspace. Prioritize filtering, inline change review, single-item updates, and batch updates.
- Preserve the dark graphite visual language, restrained blue accent, dense professional information design, and progressive disclosure.
- Show the free-plan AI quota persistently at the top of every workflow.
- Let Figma system chrome own the plugin logo, product name, and close control.
- Keep workflow titles inside page content. The utility header contains Search, the persistent AI-writing allowance, and theme switching. Do not duplicate the product logo or Spec Layer name.
- Search lives only in the header and covers workflows plus connected Library documents. Do not add a second search field inside Library.
- Open Search as a centered command palette inside the 480 × 680 plugin frame. It must support live workflow/document filtering, a useful empty state, pointer selection, Up/Down/Home/End navigation, Enter to open, Escape and Command/Ctrl+K to close, contained Tab focus, and focus return to the header trigger.
- Style the AI-writing allowance as a spacious outlined card with a circular usage ring, two-line friendly copy, and a blue text Upgrade action. Support four clear states: Free available, Free low, Free exhausted with an upgrade prompt, and Pro unlimited.
- Treat the utility header as one 36px control system at the native 480px plugin width: Search, AI writing, and theme share an 8px radius, one surface and border treatment, common hover behavior, and aligned vertical centers. Use 5px between the header controls.
- Keep Search the same width and position across every workflow so navigation never shifts the AI allowance or theme control. The persistent header contains Search, AI writing, and theme only.
- Organize the sidebar around five jobs only: generate a selected component, maintain the Library, generate Foundation documents, configure Settings, and manage Subscription.
- Group the sidebar by job: Generate component docs and Generate foundation docs together, Library in its own separated maintenance group, then Settings and License together below a second separator.
- Settings is for generated-frame configuration only. Do not repeat the plugin theme control or AI allowance there; those live in the header and License respectively.
- Frame theme follows the current plugin: Default, Editorial, Tech, Warm, and Custom. Selecting Custom reveals color and font controls, while the optional logo control remains available in every theme.
- License is the single owner of plan status, AI allowance details, activation, renewal, subscription management, and device-key removal.
- Keep the License page title standalone with no descriptive subtitle. Plan and usage supporting copy must remain comfortably readable in both dark and light themes; do not use extra-small, low-contrast text for allowance details.
- Preserve the original license distinctions: free/no key, checking, Pro active, expired, saved-but-disconnected, temporarily unverifiable, invalid, disabled, device-limit, unreachable, removing, and removed.
- Never label a temporarily unverifiable saved key as expired or definitely free. Keep the key saved, show an unverified state, and offer retry, manage, and remove actions.
- Do not expose Text styles or Update queue as separate sidebar destinations; those belong inside Foundations and Library.
- Present Foundation documents as one flat source list without category titles or category descriptions.
- Keep Foundation documents as a flat, non-collapsible selection workflow with no subtitle. Reuse the same inclusion checkbox as Selected component, and provide one state-aware bulk control that switches between Select all and Clear all with unchecked, mixed, and checked states.
- Foundation color-group descriptions are generated automatically; do not expose a manual AI-description switch.
- Selected sidebar destinations use a blue icon and background fill, with no rail indicator, outline, or selected stroke.
- Use the familiar Tabler Folder icon for Library. It reads as a common collection destination at compact sidebar sizes and remains distinct from the single-document and Foundations icons.
- Keep navigation tooltips spatially anchored during press states. Animate only the icon glyph, never the button container that positions the tooltip.
- Foundation documents has no header overflow menu and Mapped Colors has no modes subsection.
- Do not show a Foundation update-status block above the Create action.
- Do not add Preview functionality to component or Foundation generation. Foundation footer copy should not duplicate the frame count already present in the Create action.
- In expanded Library change details, do not repeat the row's last-synced age.
- On Selected component, omit progress indicators. Make AI a clear on/off switch and explain its quota impact.
- On Selected component, do not show a readiness subtitle or footer section count. Present Write with AI without a subline and explain its guideline-only behavior in a hover/focus tooltip.
- On Selected component, use “AI writing” consistently for the allowance and switch. Do not repeat On/Off or one-use text beside the switch. Mark sections where an AI layer may participate with a compact neutral “AI” badge; never claim the section was entirely AI-written.
- Show section-level “AI” badges only while AI writing is enabled. Hide them completely when AI writing is off so deterministic creation does not appear to use AI.
- Describe section state as “included,” not “selected” or completed. Introduce the groups with “Sections to include,” keep checkmarks as the non-color inclusion cue, and update counts from live selection state.
- Keep “Sections to include” as a standalone heading without an explanatory sentence.
- Do not expose Download before docs exist. The initial footer contains only Create docs; Download appears after successful creation.
- Keep the component configuration visually quiet: one soft AI-writing surface, short group dividers, transparent expanded bodies, higher-contrast counts, and no outlined card around every region.
- Selected component has three section groups: Usage, Specifications, and Accessibility. Accessibility contains Interactions, Content considerations, and Semantics & focus.
- Anatomy and Measurements are always-visible inline configurations, not disclosures; do not show chevrons on those rows. Measurement choices are independent selectable chips with explicit selected, unselected, hover, focus, and disabled states.
- The component-generation CTA is always “Create docs.” AI only enriches written guidelines; component extraction and document creation remain deterministic.
- In Library, clicking the main row jumps to the connected Figma frame. Detected changes expand from their own control, while all maintenance actions live in the row overflow menu.
- Give Library rows a transparent full border in their collapsed state and switch directly to the blue update border when expanded; never animate through the element text color.
- The Library rail tooltip is simply “Library.” Library has no header overflow action and uses compact content-width filters without dot indicators. Its footer pairs the secondary “Refresh library” action with the batch update action.
- Do not repeat Library document or update totals beneath the page title; those counts live in the filter tabs. Keep the tabs content-width but slightly larger for readability.
- Keep theme at the right of the header. Website and LinkedIn are persistent icon links at the bottom of the left sidebar, grouped with Help & feedback.
- Use customer-facing quota language: “AI writing” and “free uses.” Avoid “Free AI quota” and “generations” in the persistent header.
- Every free-plan quota state includes a visible Upgrade control; the Pro state shows Active.
- Label expanded Library diffs simply “Changes” and do not show an icon beside that heading.
- In expanded Library change groups, show only the group name and concrete change list. Do not repeat a summary caption such as “1 state added” or “3 values changed.”
- Do not imply that structured change detection is exhaustive. Itemize supported diffs, avoid exact change-count claims, and always offer a route to review the source for other changes.
- Maintain the reusable plugin design system at the direct-only `?view=system` catalog route. Keep it outside the product sidebar so it functions as an implementation reference rather than a customer workflow.
- Treat the catalog tokens and reusable controls in `src/design-system/` as the prototype source of truth for future production migration. New plugin UI should reuse semantic color, type, spacing, radius, control-height, focus, and motion roles from this layer.
- Keep every design-system example functional and accessible at the native 480 × 680 viewport, in both dark and light themes. Cover foundations, actions, inputs, navigation, feedback, overlays, and workflow-specific patterns.
- Use the semantic `--sl-color-*` tokens as the single source of truth for both themes. Legacy plugin variables may alias these roles during migration, but must be redeclared at the themed app root so light overrides resolve in the correct scope.
- The light theme uses a neutral, high-contrast hierarchy: `#F7F7F8` canvas, `#F0F1F2` chrome/surface, `#F3F4F5` subdued surface, `#FFFFFF` raised surface, `#D5D7DA` border, `#B9BDC2` strong border, `#1D1F22` primary text, `#5D6268` muted text, and `#0875C1` accent.
- The design-system color catalog must display the values for the currently active theme rather than fixed dark-theme hex values.
