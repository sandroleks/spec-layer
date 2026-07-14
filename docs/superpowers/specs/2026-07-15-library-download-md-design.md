# Download a My Library doc as `.md`

**Date:** 2026-07-15
**Package:** `packages/plugin`
**Status:** Approved, ready for planning

## Problem

The plugin's **My Library** tab lists previously-created documentation frames. Each
row has a `⋯` overflow menu offering *Go to source, Update, Detach, Remove*. There
is no way to download a library doc's spec as a markdown file.

The **Selected** tab already has a Download button (`runDownload`) that saves the
live selection's spec as a bare `.md`. Library docs — already extracted and living
on the canvas — deserve the same one-click download.

## Goal

Add a **Download .md** action to each library row's `⋯` menu that saves the doc's
spec as a bare markdown file, reusing the existing extraction, prose, model, and
download machinery.

## Approach

**Re-extract from source.** Reuse the existing `requestDocSource` → `docSource`
round-trip (today used only by Update). Re-extract the live source component,
rebuild the `DocFrameModel` from the doc's stored config, convert it to markdown,
and download it as a local Blob. No new storage, no new endpoints.

Alternatives considered and rejected:

- **Store markdown at creation time** — most faithful (matches the frame byte-for-byte,
  works for orphaned docs, no quota), but requires new plugin-data storage and a
  migration for docs created before the change. Overkill for the value.
- **Reconstruct markdown from the on-canvas frame** — no new storage and reflects
  manual edits, but reverse-parsing the rendered frame is lossy and fragile.

## AI prose behavior

`runUpdateFromSource` already routes through `generateProse`, which consults an
in-memory cache (`cache` Map in `ui/ai.ts`, keyed by spec content + prose key, alive
for the plugin session). Download inherits this for free:

- Prose generated **earlier in this session** → cache hit → no quota, instant.
- **Fresh session / older doc** → no cache → regenerate, spending quota. Accepted.

Prose regenerates only when the doc's stored `config.aiEnabled` is true and the
selected sections request prose — identical to Update.

## Components & data flow

1. **Menu item** — `openRowMenu` (`ui/ui.ts`) adds a `Download .md` button directly
   below `Update`, rendered **only when `entry.sourceExists`** (orphaned docs cannot
   be re-extracted, so Download is unavailable, consistent with Update).

2. **Intent-tagged round-trip** — the `requestDocSource` / `docSource` message pair
   gains `intent: 'update' | 'download'`:
   - `UiToMain.requestDocSource` adds `intent`.
   - `MainToUi.docSource` echoes `intent` back.
   - `main.ts`'s `requestDocSource` handler passes `intent` through unchanged; no
     other main-side logic changes.

3. **Dispatch branch** — the `docSource` handler (`ui/ui.ts`) branches on `intent`:
   - `'update'` → existing `runUpdateFromSource` (unchanged).
   - `'download'` → new `runDownloadFromSource`.

4. **`runDownloadFromSource`** (new, `ui/actions.ts`, beside `runUpdateFromSource`) —
   shares the first half of the update path:
   - `extract(node, { figmaFile: fileKey })`
   - `generateProse(...)` when `config.aiEnabled` and prose sections are requested
     (best-effort; falls back to placeholders on failure), cache-aware.
   - `buildDocModel(spec, prose, selected, variantIds, { anatomyView, measureViews })`
     from the stored config.

   Then, instead of dispatching `renderDocFrame`:
   - `modelToMarkdown(model)` → bytes
   - `specMarkdownFilename(spec, entry.componentName)` → `<slug>.spec.md`
   - `downloadBytes(bytes, filename, 'text/markdown')`

5. **In-flight guard + loader** — the overflow menu closes on click, so there is no
   persistent button to disable. Guard re-entrancy with a module-level
   "download in progress" flag (ignore a second Download while one is running) and
   show the existing generating loader; clear it on completion or error.

## Edge cases

- **Orphaned doc** (source component deleted): no `Download .md` item shown.
- **Self-edited frame** (manual canvas edits): re-extraction reflects the *source*,
  not the hand-tweaks, so the `.md` may differ from the rendered frame. Download is
  non-destructive, so **no confirmation dialog** (unlike Update, which overwrites the
  frame and keeps its warning). This divergence is accepted and intentional.
- **AI note mid-generate** (quota exhausted, lapsed key, generation error): surfaced
  via the same banner path `runDownload` uses (`state.pendingAiNote`), or a
  best-effort fallback to placeholder prose.
- **Extraction failure**: stop the loader, show an error banner, clear the in-flight
  flag.

## Out of scope

- Persisting generated markdown in plugin data.
- Bulk / multi-doc download.
- Any change to the Selected-tab Download button.
- Downloading orphaned docs.

## Reused, not rebuilt

`extract`, `generateProse` (+ its cache), `buildDocModel`, `modelToMarkdown`,
`specMarkdownFilename`, `downloadBytes`, `startLoader` / `stopLoader`, the banner
helpers, and the `requestDocSource` / `docSource` message pair. New code is limited
to one menu item, one `intent` field on two messages, one dispatch branch, and one
`runDownloadFromSource` function.
