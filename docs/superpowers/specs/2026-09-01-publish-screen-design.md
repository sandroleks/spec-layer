# Publish for developers: its own screen

Design for moving "Publish for developers" out of the tail of the Library
scroll body and onto a dedicated screen, reached from a Library footer action.

## Problem

`publishSectionMarkup` renders below the document list, appended into
`.sl-screen-scroll` by the Library render in `ui-vnext.ts`. Three things are
wrong with that placement:

- **It is found by scrolling past everything else.** Publishing is the only
  thing in the plugin that sends a library off the machine. It reads as a
  footnote to the document list.
- **It shares a viewport with an unrelated model.** The list above it filters,
  expands rows, opens menus, and reflows during refreshes and batch updates.
  The publish key box and status line move with all of it.
- **An in-flight publish reports nothing.** `collecting` and `uploading` only
  disable the button. Every other long action in the plugin has a footer
  progress line.

The section could not simply move into the Library footer:
`.sl-screen-footer` is a fixed-height band in the screen grid, and a
variable-height section there grows it on every Library visit, shrinking the
scroll viewport and reflowing the list under the cursor. That constraint is
documented at `patterns.css` `.sl-footer-progress` and is why the section was
appended to the scroll body in the first place.

## Shape

A Library sub-screen. The rail keeps Library selected; the page header carries
a back control.

### Navigation and state

`PluginView` stays five entries. Adding `'publish'` would force a rail icon and
a `navigation` entry, because `sidebar.ts` holds an exhaustive
`Record<PluginView, IconName>` — and publish is not a peer of Component,
Foundations, and Library.

The Library owns one local pane flag in `ui-vnext.ts`:

```ts
let libraryPane: 'list' | 'publish' = 'list';
```

- `case 'library'` branches on it. The publish pane renders
  `renderPublishScreen(refs, publishState())`; otherwise
  `renderLibraryScreen(...)` as today.
- The rail keeps Library highlighted with no extra work, because `view` is
  still `'library'`.
- `navigateToView('library')` resets the flag to `'list'`. Leaving the Library
  and returning lands on the list, never a stale publish page.
- Entering the pane calls `closeLibraryMenu(false)`. An open row menu is
  positioned against a list that is no longer rendered.
- Escape returns to the list, as a branch placed *after* the existing modal,
  search, font-menu, and row-menu branches of the keydown handler, so it cannot
  steal their Escape.

The existing `requestPublishInfo` seed on the first Library visit is unchanged.
The publish pane is only reachable through the Library, so it is always seeded
by the time it can be opened.

### The screen

New `packages/plugin/src/ui/screens/publish.ts`. It shares a basename with the
existing `ui/publish.ts` controller, matching the `screens/library.ts` and
`viewModel/library.ts` precedent: the controller owns publish state and the
proxy calls, the screen module is presentation only.

| Region | Content |
| --- | --- |
| Page header | Back icon-button (`chevronLeft`, "Back to Library") then `<h1>Publish for developers</h1>` |
| Scroll body | Description paragraph, `SPEC_LAYER_KEY=…` command box, Copy setup command and Rotate key, rotate hint, status line |
| Footer | Primary `[data-publish]` "Publish library" / "Publishing…" with the `upload` glyph, plus a `.sl-footer-progress` line while collecting or uploading |

Everything in the scroll body exists today inside `publishSectionMarkup`. The
`<h2>` is dropped (the `<h1>` replaces it) and the publish button moves to the
footer.

The footer progress line is new behaviour, not a move. `ProgressPresentation`
already accepts a label with no `current`/`total`, which is how Foundations
uses it, and the button-icon contract's spinner exception assumes a footer that
has a progress line keeps a static glyph.

The header's `<small>` eyebrow is **not** reused as a "Library" breadcrumb.
That slot means "what kind of thing the h1 names" ("Selected component"), and
giving it a second, navigational meaning is the one-slot-two-categories mistake
the button-icon contract was written to fix.

### Library footer

A third button, leftmost in `.sl-footer-actions`: secondary tone, `upload`
glyph, label "Publish", `[data-publish-open]`.

Never disabled. It navigates, and navigating during a refresh or a batch update
is harmless; the destination's own primary handles its own disabling.

Width at 480px minus the 52px rail: "Publish" (about 75px), "Refresh library"
(about 130px), the widest primary state "Refresh to retry" (about 125px), and
two gaps come to about 340px in about 424px of content width.

### Glyphs

`icons.ts` has `download` but no upload and no left arrow. Two additions:

- `upload` — arrow up out of a tray, the mirror of `download`. Worn by both the
  Library's "Publish" and the publish screen's "Publish library". They are on
  different screens, so the tie-break rule about two identical glyphs in one
  row does not apply.
- `chevronLeft` — the back control only.

Both join `IconName`.

### CSS

`.sl-publish-section` becomes `.sl-publish-screen`. The `border-top` and top
margin only made sense for a section appended after a list, so they go, as does
the `> h2` rule. The command box, command actions, hint, and status rules carry
over unchanged.

The long comment at `patterns.css` `.sl-publish-section` and its twin above
`publishSectionMarkup` in `screens/library.ts` both exist to explain why this
section is not in the footer. That reasoning is obsolete once the content has
its own screen, so both are rewritten rather than left to mislead the next
reader.

## Not doing

- **No staleness indicator on the footer button.** Telling the user the
  published bundle is behind the canvas documents needs drift detection between
  a published bundle and current sources. That is new machinery, not a
  refinement of placement.
- **No state-aware footer label.** "Publish" before the first publish and
  "Published" after puts status in an action slot and changes the button's
  width, which is the rule that turned "Update all 3" into "Update all docs".

## Verification

- `libraryScreen.test.ts` gains footer assertions: the publish-open button is
  present in every state and never disabled.
- New `publishScreen.test.ts`: the back control, the command box appearing only
  when both `libraryId` and `pullKey` are known, status and busy labels, the
  progress line during collecting and uploading, and HTML escaping.
- `harness.ts` gains the pane at `?view=library&pane=publish` with idle,
  published, and error states. The harness renders no publish surface today, so
  this screen has never been viewable outside a real Pro publish.
- `docs/plugin-voice-and-copy.md` footer table gains the Library's third
  action. `CHANGELOG.md` updated.
- The manual Figma pass in `packages/plugin/TESTING.md` still owns the real
  publish path; unit tests cover presentation only.
