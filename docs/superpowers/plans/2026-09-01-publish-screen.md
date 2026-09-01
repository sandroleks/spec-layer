# Publish Screen Implementation Plan

**Goal:** Move "Publish for developers" out of the tail of the Library scroll body onto its own Library sub-screen, reached from a third Library footer action.

**Architecture:** `PluginView` is untouched. `ui-vnext.ts` gains a Library-local `libraryPane: 'list' | 'publish'` flag; `case 'library'` branches on it. A new presentation-only `screens/publish.ts` renders the header, body, and footer. The existing `ui/publish.ts` controller (state, proxy calls) is unchanged except that its markup helper moves out of `screens/library.ts`.

**Spec:** `docs/superpowers/specs/2026-09-01-publish-screen-design.md`

## Global Constraints

- Presentation only. No change to publish state, the proxy protocol, or the bundle.
- Plugin UI copy: sentence case, second person, NO EM DASHES (`docs/plugin-voice-and-copy.md`).
- Every footer action carries a glyph in every state, naming the act, never varying with state (button-icon contract in `design-system/components.css`).
- `.sl-screen-footer` is a fixed-height band. Only fixed-height content goes in it; anything variable goes in `.sl-screen-scroll`.
- The main thread has no browser globals. All of this is iframe code, so `npm run check:sandbox` should be unaffected, but run it.
- Commits: single-line conventional, lowercase, scoped.

## Task 1 — two new glyphs

- [ ] Add `upload` to `packages/plugin/src/ui/shell/icons.ts`: arrow up out of a tray, drawn as the mirror of the existing `download`, same 24px viewBox and stroke conventions.
- [ ] Add `chevronLeft`: mirror of the existing `chevronRight`.
- [ ] Both keys land in the `IconName` union automatically via the existing `keyof typeof` derivation; confirm that is how the union is built, and add them to it explicitly if it is not.
- [ ] `npx vitest run packages/plugin` stays green.

Commit: `feat(plugin): add upload and chevronLeft glyphs`

## Task 2 — the publish screen module

- [ ] Create `packages/plugin/src/ui/screens/publish.ts`, presentation only, importing `PublishState` and `setupCommand` from `../publish`, `icon` from `../shell/icons`, `ShellRefs` from `../shell/shell`, and `progressMarkup` from `./progress`.
- [ ] `publishHeaderMarkup()`: a `.sl-icon-button` with `[data-publish-back]`, `aria-label="Back to Library"`, the `chevronLeft` glyph, then `<div class="sl-page-header-copy"><h1>Publish for developers</h1></div>`.
- [ ] `publishScrollMarkup(state)`: the existing description paragraph, then the command box and its two buttons and the rotate hint when both `state.libraryId` and `state.pullKey` are set, then the status line when `state.message` is set. Move the existing `esc`, `PUBLISH_DESCRIPTION`, and the `keySection`/`statusLine` logic verbatim from `publishSectionMarkup`; drop the `<h2>` and the publish button.
- [ ] `publishFooterMarkup(state)`: a `.sl-footer-progress` line when `state.status` is `collecting` or `uploading` (label "Collecting sources…" and "Uploading…" respectively, no `current`/`total`), then `.sl-footer-actions` holding one primary `[data-publish]` with the `upload` glyph. Label "Publish library", or "Publishing…" while collecting or uploading; disabled in those two states.
- [ ] `renderPublishScreen(refs, state)`: set `refs.screen.className = 'sl-screen sl-publish-screen'`, fill and unhide `pageHeader`, fill `scroll`, fill and unhide `footer`.
- [ ] Write `packages/plugin/test/publishScreen.test.ts` first, covering: the back control's `aria-label` and glyph; no command box when `pullKey` or `libraryId` is null; the command box, both buttons, and the hint when both are set; the status line and its `is-error` class; footer label and `disabled` across all five statuses; the progress line present only while collecting or uploading; and that a `message` containing `<` and `&` is escaped.
- [ ] `npx vitest run packages/plugin` green.

Commit: `feat(plugin): add the publish screen`

## Task 3 — Library footer action, and removing the appended section

- [ ] In `packages/plugin/src/ui/screens/library.ts`, add to `libraryFooterMarkup` a first button in `.sl-footer-actions`: `sl-library-publish`, `data-tone="secondary"`, `[data-publish-open]`, `icon('upload', 15)`, label "Publish". Never disabled, including while `busy`; add a short comment saying why (it navigates; the destination owns its own disabling).
- [ ] Delete `publishSectionMarkup` and its long comment from `library.ts`, along with the now-unused `setupCommand`/`PublishState` imports and `PUBLISH_DESCRIPTION`. Keep `esc` — the row markup still uses it.
- [ ] Add footer assertions to `packages/plugin/test/libraryScreen.test.ts`: the publish-open button is present in the idle, refreshing, updating-all, and checks-incomplete states, and is never `disabled`. Remove or rewrite any existing `publishSectionMarkup` test.
- [ ] `npx vitest run packages/plugin` green.

Commit: `feat(plugin): add a publish action to the library footer`

## Task 4 — wire the pane into ui-vnext

- [ ] Add `let libraryPane: 'list' | 'publish' = 'list';` beside the other Library-local state in `ui-vnext.ts`.
- [ ] In `case 'library'`, render `renderPublishScreen(refs, publishState())` and return early when the pane is `'publish'`. Delete the `refs.scroll.insertAdjacentHTML` append and its comment block.
- [ ] In `navigateToView`, reset `libraryPane = 'list'` when `next === 'library'`.
- [ ] Add a click branch for `[data-publish-open]`: set the pane to `'publish'`, call `closeLibraryMenu(false)`, repaint, and move focus to the back control. Add a branch for `[data-publish-back]`: set the pane to `'list'`, repaint, and restore focus to the footer's publish button.
- [ ] Add an Escape branch that returns the pane to `'list'`, placed after the existing modal, search, font-menu, and row-menu Escape branches so it cannot pre-empt them.
- [ ] Leave the `[data-publish]`, `[data-publish-copy-command]`, and `[data-publish-rotate]` branches untouched.
- [ ] `npm run check` green, including `check:sandbox` and `check:nul`.

Commit: `feat(plugin): open publishing as its own library screen`

## Task 5 — CSS

- [ ] In `packages/plugin/src/ui/design-system/patterns.css`, rename `.sl-publish-section` to `.sl-publish-screen`, drop its `border-top` and top margin, and drop the `> h2` rule. Rescope the descendant rules (`.sl-publish-command`, `.sl-publish-command-actions`, `.sl-publish-hint`, `.sl-publish-status`) to the new class where they are scoped by the old one.
- [ ] Replace the obsolete "deliberately NOT in the footer" comment with one that says what the block now is: a screen body whose height varies with publish state.
- [ ] Add whatever the back control needs: `.sl-publish-screen`'s page header puts the icon-button before `.sl-page-header-copy`, so check the `.sl-page-header` flex rules (`align-items: flex-start`, `justify-content: space-between`) render that correctly, and add a scoped rule only if they do not.
- [ ] Verify light and dark, and both Figma themes, in the harness.

Commit: `style(plugin): restyle publish as a screen body`

## Task 6 — harness, docs, changelog

- [ ] In `packages/plugin/src/ui/harness.ts`, read a `pane` param inside the `view === 'library'` block. When it is `publish`, render `renderPublishScreen` with a `PublishState` built from a `publish` param taking `idle`, `published`, `collecting`, `uploading`, and `error`, and wire the back control to flip back to the list. Use a synthetic library id and pull key — no real key.
- [ ] Add the Library's third footer action to the footer table in `docs/plugin-voice-and-copy.md`, and note that "Publish" names an act whose confirmation lives on its own screen.
- [ ] Update `docs/plugin-knowledge-map.md` if it enumerates the screen modules.
- [ ] Add a `CHANGELOG.md` entry.
- [ ] Note in `packages/plugin/TESTING.md` that the manual publish rows now start from the Library footer's "Publish" action.
- [ ] `npm run check` green.

Commit: `docs: document the publish screen`

## Final verification

- [ ] `npm run check` from a clean tree, reading the exit status directly, never through a pipe.
- [ ] Harness pass: `ui-harness.html?view=library` shows three footer buttons that fit at 480px in the widest primary state; `?view=library&pane=publish&publish=published` shows the key box, both buttons, hint, and status; `&publish=error` shows the error tone; `&publish=uploading` shows the progress line and a disabled "Publishing…".
- [ ] Keyboard pass: Tab reaches the footer's "Publish", Enter opens the screen, focus lands on the back control, Escape and the back control both return to the list with focus restored.
- [ ] The manual Figma matrix in `packages/plugin/TESTING.md` remains the release gate. Unit tests do not reach the real publish path.
