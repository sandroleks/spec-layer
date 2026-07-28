# Spec Layer plugin UI vNext

This folder is the handoff package for the approved plugin UI prototype. It is
deliberately separate from `packages/plugin` so the design can be reviewed and
migrated without changing the current production UI.

## What is in this package

- [`approved-direction.md`](approved-direction.md): the decisions established
  during the prototype review.
- [`workflows.md`](workflows.md): the intended behavior for every primary
  plugin screen.
- [`state-matrix.md`](state-matrix.md): loading, empty, error, quota, license,
  and library states that the real plugin must preserve.
- [`integration-plan.md`](integration-plan.md): a staged path from the current
  `dom.ts` UI to the new shell and components.
- [`acceptance-checklist.md`](acceptance-checklist.md): visual, interaction,
  accessibility, and Figma-host checks.
- [`design-system/`](design-system/README.md): portable CSS and TypeScript
  contracts prepared for the existing non-React plugin UI.

## Important boundary

The prototype is a visual and interaction reference. It is not a new source of
product behavior.

During integration:

1. Keep the current message protocol, extraction, document creation, library,
   quota, license, and theme logic.
2. Replace the UI shell and presentation incrementally.
3. Bind each new screen to the existing state and actions.
4. Do not copy prototype timers, demo data, or URL-driven mock states into the
   real plugin.

## Recommended first merge

Start with the design-system foundation only:

1. Copy the three CSS files from `design-system/` into
   `packages/plugin/src/ui/design-system/`.
2. Embed them through the current `dom.ts` style template.
3. Migrate the utility header, sidebar, buttons, fields, checkboxes, tooltips,
   menus, and focus states.
4. Keep all existing panels and behavior intact.
5. Migrate one workflow at a time after the shell is stable.

The first product screen to migrate should be **Selected component**. It has the
most reusable controls and the smallest amount of asynchronous library state.

## Target plugin frame

- Default working size: `480 x 680` CSS pixels.
- Minimum supported width: `420` CSS pixels.
- The shell owns one `52px` left rail and one `48px` utility header.
- Figma owns the native plugin title bar. The in-plugin UI does not repeat the
  product logo or name.
- Persistent actions stay in a sticky footer when the workflow has a primary
  action.

## Source of truth

For behavior, the current source remains authoritative:

- `packages/plugin/src/ui/ui.ts`
- `packages/plugin/src/ui/actions.ts`
- `packages/plugin/src/ui/render.ts`
- `packages/plugin/src/ui/dom.ts`
- `packages/plugin/src/messages.ts`
- `packages/plugin/src/docLink.ts`

For product language, use `docs/plugin-voice-and-copy.md`.

For the approved visual direction, use this package and the latest locally
verified prototype at `http://127.0.0.1:4173/` while it is available.

