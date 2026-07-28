# Integration plan

## Current architecture

The plugin UI is intentionally small and framework-free:

- `dom.ts` owns markup and embedded styles.
- `ui.ts` owns event wiring and message dispatch.
- `actions.ts` owns workflow actions and state mutations.
- `render.ts` owns view updates.
- `theme.ts` owns light and dark mode.
- `messages.ts` is the main-thread and iframe protocol.

The redesign should preserve that split. A React rewrite is optional and is not
required for visual parity.

## Phase 0: lock behavior

Before changing markup:

1. Run the plugin tests and build.
2. Record the current `Refs` interface and every `UiToMain` and `MainToUi`
   message used by the UI.
3. Add or retain tests for library status resolution, quota and license models,
   section selection, foundation selection, and theme detection.
4. Use synthetic Figma files for manual screenshots.

## Phase 1: add the design-system foundation

Target:

`packages/plugin/src/ui/design-system/`

Copy:

- `tokens.css`
- `components.css`
- `patterns.css`
- `contracts.ts`

Keep CSS source separate during development. The existing build emits one
embedded `ui.html`, so choose one of these integration methods:

### Low-risk method

Import the CSS files as text in `dom.ts` through an esbuild text loader, then
interpolate them into the existing `<style>` block.

### Temporary method

Paste the files into the current template in the same order. Keep the separate
copies as the maintained source and add a build-time sync check before merging.

The low-risk method is preferable because it avoids a second unsynchronized
token source.

## Phase 2: migrate the shell

Update `dom.ts`:

- Replace top tabs with the 52px side rail.
- Add the 48px utility header.
- Add a stable search button, AI allowance control, and theme button.
- Move website and LinkedIn links to the rail bottom.
- Keep each current panel and existing element ID initially.

Update `render.ts`:

- Map the active view to selected rail state.
- Render the header page context only where needed.
- Keep theme and quota rendering driven by current state.

Update `ui.ts`:

- Wire rail buttons to the existing `switchTab` behavior.
- Preserve focus and request timing.
- Do not change message types in the shell migration.

## Phase 3: migrate Selected component

Map current functionality:

| Current | vNext |
|---|---|
| Selected tab | Generate component docs rail item |
| Write with AI | AI writing switch and help tooltip |
| Group master checkbox | Section disclosure with included count |
| Section checkbox | Shared inclusion checkbox |
| Anatomy radios | Compact segmented control |
| Measurement checkboxes | Selectable chips |
| Create frame | Create docs |
| Download | Post-create action |

Preserve:

- `ALL_SECTIONS` and `GROUPS`.
- `anatomyView` and `measureViews`.
- `runAutoExtract`.
- `runCreateDocFrame`.
- the shared build lock.
- quota exhaustion fallback.

## Phase 4: migrate Foundation documents

Map `renderFoundationPanel` to flat rows:

- Remove mode controls from presentation.
- Keep the underlying `FoundationSelection` and group planning logic.
- Keep automatic group-description generation where current behavior requires
  it.
- Keep progress and partial-failure reporting.
- Use one shared inclusion checkbox and one mixed bulk control.

Confirm with product logic before removing mode selection from the underlying
model. Hiding modes in the UI is not automatically permission to discard saved
mode-specific configuration.

## Phase 5: migrate Library

Keep `LibraryEntry`, `DocSourceIntent`, registry parsing, hash comparison, and
current message actions.

Refactor rendering into small functions:

- `renderLibraryFilters`
- `renderLibraryRow`
- `renderLibraryChanges`
- `renderLibraryMenu`
- `renderLibraryFooter`

Add a view model that separates reliable status from optional change details:

```ts
interface LibraryRowView {
  status: "checking" | "inSync" | "updateAvailable" | "edited" | "orphaned";
  canUpdate: boolean;
  canOpenSource: boolean;
  changeGroups: ChangeGroup[] | null;
}
```

`changeGroups: null` means the content changed but a detailed comparison is not
available. It must not be rendered as an empty or failed comparison.

## Phase 6: migrate Settings and License

Settings:

- Keep `BrandTheme`, `THEME_PRESETS`, font picker, color validation, and logo
  capture.
- Remove plugin-theme and AI settings from this page.

License:

- Keep `resolveLicenseView`, `licenseStatusCopy`, activation, removal, quota
  refresh sequencing, and external URLs.
- Render every state in `state-matrix.md`.
- Do not treat a network failure as an expired key.

## Phase 7: remove legacy presentation

Only after every workflow passes:

1. Delete obsolete tab styles and markup.
2. Remove legacy aliases that are no longer used.
3. Confirm one semantic token source drives both themes.
4. Update `packages/plugin/TESTING.md` with the new navigation and labels.
5. Update screenshots and Community listing assets separately.

## Suggested pull request sequence

1. Design-system tokens and primitives.
2. Shell, header, sidebar, and theme.
3. Selected component.
4. Foundation documents.
5. Library.
6. Settings and License.
7. Legacy cleanup and final accessibility pass.

Each pull request should keep the plugin buildable and manually testable in
Figma.

