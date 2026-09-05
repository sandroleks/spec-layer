# Review quick wins: design

**Date:** 2026-09-05
**Status:** Approved design. Implements items 1 to 11 of the recommended order
in `docs/reviews/2026-09-05-major-review.md`.
**Reads with:** `docs/reviews/2026-09-05-major-review.md`,
`packages/plugin/TESTING.md`, `docs/plugin-voice-and-copy.md`.

## 1. Goal

Land the "now" and "quick wins" tiers of the 2026-09-05 review: push `main`,
run the manual Figma matrix, commit the strategy document, then eight small
code changes to speed, UX, and the clipboard. Nothing here changes an
extraction hash, `EXTRACTOR_VERSION`, a schema, or the v5 contract.

## 2. Sequence

The matrix runs before the code changes, so it baselines the shipped v5 build
and answers the three questions the review could not.

1. On `main`: push. Commit the strategy document with
   `Status: Proposal, decision deferred`. Add TESTING.md rows for the Detach,
   Remove, and hand-edit Update confirmations. Scaffold
   `docs/reviews/2026-09-05-matrix-run.md` with blank fields for the three
   observations. Push again.
2. The user runs the matrix against a development build of that `main` and
   fills in the run notes.
3. Branch `review-quick-wins`. One conventional commit per item, each carrying
   its tests, its CHANGELOG line, and any TESTING.md row change. Merge to
   `main` after `npm run check` passes. The user then runs only the TESTING.md
   rows the branch touched.

## 3. Item designs

### 3.1 Memoize resolver lookups (review E1, S2)

New Figma-free module `packages/plugin/src/resolverMemo.ts`:

```ts
export function memoizedResolver(base: NodeResolver): NodeResolver
```

It caches the promise returned by `variable(id)` and `style(id)` per id for
the life of the wrapper. `mainComponent` passes through, since its argument is
a node, not an id. A rejected or null result is cached too: the base resolver
already converts failures to null, and a pass must see one answer per id.

`main.ts` creates one wrapper per `serializeNode` call in `postSelection`,
`requestDrift`, and `requestDocSource`, and one wrapper shared across the
whole `requestPublishSources` loop. Drift stays one memo per message; sharing
a memo across the Library drift batch is S4 and out of scope.

### 3.2 Bulk-read variables (review E2, S1)

The review also asked to defer per-variable publication reads. This design
keeps them, for a reason the review did not weigh: an absent `publication` on
a variable drops the field from every v5 artifact built from that dump, and
the selection-time dump is the same session cache that `requestPublishSources`
reads. Deferring would silently weaken published bundles and component copies.
Publication reads are already concurrent under `Promise.all`.

What changes: `foundationReader` becomes a factory,
`createFoundationReader()`, called once per `serializeFoundation` pass. Its
first `variable(id)` call awaits `figma.variables.getLocalVariablesAsync()`
once, indexes the result by id, and every `variable(id)` serves from the map.
An id missing from the map falls back to `getVariableByIdAsync(id)`, so a
variable the bulk read did not return is still read rather than reported
missing. The `FoundationReader` interface in `serializeFoundation.ts` is
unchanged.

### 3.3 Stop posting the foundation dump per selection (review S3)

No new message type. `main.ts` keeps `postedFoundationDump`, the dump object
most recently handed to the UI. `postSelection` includes `foundation` on the
`selection` message only when `foundationCache.dump` is not that object, then
records it. `requestFoundation` records the dump it posts. The UI already
calls `onSelectionFoundation` only when the field is present, so both the
structured clone and the `buildFoundation` re-run stop.

Reopening the plugin restarts both realms, so the two sides cannot drift.

### 3.4 In-shell confirmation (review X1)

New `packages/plugin/src/ui/shell/confirmDialog.ts`:

```ts
export function confirmDialog(options: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;      // default 'Cancel'
  tone?: 'danger' | 'primary'; // default 'primary'
}): Promise<boolean>
```

Renders an `.sl-overlay` containing an `.sl-dialog` with `role="dialog"`,
`aria-modal="true"`, and `aria-labelledby`. Focus moves to the cancel button
on open, is trapped inside the dialog, and returns to the previously focused
element on close. Escape, backdrop click, and Cancel resolve false; Confirm
resolves true. The Escape key handler stops propagation so the shell's own
Escape chain does not also fire. One dialog at a time: a second call while one
is open resolves false immediately.

The four `window.confirm` sites in `ui-vnext.ts` become awaits:
`startLibraryUpdates`, the `detach` and `remove` menu cases, and the
`docSource` hand-edit check. Copy follows `docs/plugin-voice-and-copy.md`:
sentence case, second person, no em dashes. Titles name the act, bodies say
what happens and what is kept, the confirm label repeats the verb.

| Site | Title | Confirm label |
|---|---|---|
| Detach | Detach this documentation? | Detach |
| Remove | Remove this frame from the canvas? | Remove |
| Update, one doc with hand edits | Replace your edits to generated content? | Update |
| Update all, N docs with hand edits | Replace hand edits in N documents? | Update all |

### 3.5 Remove the non-component toast (review X2)

Delete the `figma.notify('Select a component or component set')` call in
`postSelection`. The empty state already says it.

### 3.6 Copy for AI on the component screen (review U1)

`componentFooterMarkup` gains a secondary button, `id="sl-copy-component"`,
before Create docs, disabled exactly when Create docs is (the `reading` and
`building` states) and hidden with the footer in the `empty` state. The handler calls the
existing `copyBriefFromSource` with `state.currentNode`, `state.currentFileKey`,
and `state.currentFileName`, prose `null`.

`copyBriefFromSource` takes an options object with `guidelinesNote: boolean`
(default true). The component screen passes false, so the copy does not say
"This document has no saved guidelines" when no document is involved. The
token-values caveat is unchanged.

### 3.7 Minify both bundles (review S5)

`build.mjs` sets `minify: true` on the main and UI builds, and on the
opt-in harness build. The embedded design-system CSS is minified with
`esbuild.transform(css, { loader: 'css', minify: true })`. The sandbox scan
matches globals by name, which minifiers never rename, so it stays valid and
runs against the same file. `uiHtml.test.ts` string assertions are verified
against the minified output and adjusted only if one depends on whitespace.

### 3.8 Compact clipboard and per-row Foundations copy (review E7, U4)

**Compaction.** `foundationDtcgJson` in `actions.ts` emits
`JSON.stringify(document)` with no indentation and a trailing newline. File
output through `dtcgExportFiles` stays two-space, since those are for humans
and the CLI writes them.

**Caveat.** `deliverBrief` and `copyBriefFromSource` measure the payload in
bytes (UTF-8 length) instead of lines. Above 200 KB the notice reads
`N KB, which is large for some chat windows.` A compact document is one line,
so a line count would say nothing. The component YAML keeps its shape but
adopts the same byte measure so the two copies speak one language.

**Per-row copy.** Each collection row and the text styles row on the
Foundations screen gets a `Copy for AI` icon button, `data-foundation-copy`
carrying the collection id or `textStyles`. The handler builds a
`FoundationScope` and calls `copyFoundationBriefForScope` unchanged. The
footer button is relabelled `Copy whole file for AI` and keeps
`copyFoundationBrief`. Row buttons are disabled while a build or refresh runs,
matching the footer.

## 4. Documents that change

- `CHANGELOG.md` Unreleased: one line per item under Changed or Added.
- `packages/plugin/TESTING.md`: confirmation rows (before the matrix run);
  then rows for the missing toast, the component-screen copy, per-row copy,
  the relabelled footer, the compact clipboard, and the selection message
  carrying no dump (observable as the Foundations tab still reflecting a
  refresh after re-selection).
- `docs/reviews/2026-09-05-matrix-run.md`: the run notes.
- `docs/strategy/2026-09-02-design-conformance-pivot.md`: status line only.

## 5. Testing

Unit tests, all Node:

- `resolverMemo.test.ts`: one base call per distinct id across repeated
  lookups; null and rejection cached; `mainComponent` passes through.
- `serializeFoundation` reader factory with a fake variables API: one bulk
  call per pass, per-id fallback for a missing id, unchanged dump shape.
- `foundationPost.test.ts`: the gate hands over a dump once, withholds the
  same object afterwards, and hands over a refreshed object even when equal.
- `confirmDialog.test.ts` in happy-dom: resolves true and false, Escape and
  backdrop cancel, focus returns, single instance.
- `componentScreen.test.ts`: copy button present only in `ready`.
- `copyFoundation.test.ts` and `copyBrief.test.ts`: compact output, byte
  caveat threshold, `guidelinesNote: false` suppresses the note.
- `foundationScreen.test.ts`: per-row copy buttons and footer label.
- `uiHtml.test.ts` passes against minified output.

Figma behaviour is verified by the TESTING.md rows above, not by tests.

## 6. Out of scope

Drift batching (S4), canvas build timing (S6), the semantic diff (U2), the
`main.ts` and `ui-vnext.ts` splits (C1), the `canonical()` pin (E6), and
everything on the review's one-to-two-week and strategy lists.
