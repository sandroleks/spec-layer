# Download as bare .md + hover tooltip

**Date:** 2026-07-14
**Status:** Approved
**Scope:** Figma plugin (`packages/plugin`), single-component Download action

## Problem

The footer "Download" button gives no hint of what it produces. Today it
downloads `<slug>.spec-layer.zip` containing the rendered markdown spec plus a
hidden `.spec-data/<slug>.json` sidecar. The sidecar's only consumer was the
docs site, which the standalone plugin no longer depends on. The zip wrapper
also fights the primary use case: feeding the spec to an AI tool requires
unzipping first, and the dotfile sidecar is invisible in Finder.

## Decision

1. Single-component Download saves a bare markdown file, no zip.
2. A hover/focus tooltip on the button explains what it does and that the
   file is meant to be fed to AI tools.
3. The zip-with-sidecar format survives only in the Library tab's bulk
   export, where re-import matters.

## Design

### Behavior change (`packages/plugin/src/ui/actions.ts`)

- `runDownload` downloads `state.renderedMd` directly as `<slug>.spec.md`
  with MIME type `text/markdown`, reusing the existing `downloadBytes`
  helper with `strToU8`.
- Slug derivation stays as today: `toKebab(spec.name)` with leading/trailing
  dashes stripped, falling back to `component`.
- `buildSingleExportBundle` (actions.ts) and `buildSingleExportFiles`
  (exportFiles.ts) lose their only consumer and are deleted, along with
  their tests.
- `buildExportFiles` and `zipFiles` are untouched; the Library bulk export
  keeps the zip + `.spec-data` sidecar format.

### Tooltip (`packages/plugin/src/ui/dom.ts` + plugin CSS)

- CSS-only pattern: a `data-tooltip="…"` attribute on the button, rendered
  via `::after`.
- Shown on `:hover` and `:focus-visible`; hidden otherwise.
- Positioned above the button, horizontally centered. The footer hugs the
  plugin's bottom edge, so above is the only direction with room.
- `pointer-events: none` on the tooltip; ~300ms show delay (CSS
  `transition-delay`) so it does not flicker during normal clicking.
- Constraint to verify in Figma: no ancestor of the footer may clip the
  tooltip with `overflow: hidden`. If one does, the fix is repositioning
  the tooltip, not loosening the overflow rule.

### Copy

Tooltip text (follows `docs/plugin-voice-and-copy.md`: no em dashes,
sentence case, concrete, no hype):

> Saves the spec as markdown. Drop it into Claude, Cursor, or any AI tool.

Button label stays "Download". The tooltip carries the explanation; the
short label keeps the two-button footer balanced.

## Testing

- Unit: remove the `buildSingleExportBundle` / `buildSingleExportFiles`
  tests; add a test asserting the download filename (`<slug>.spec.md`,
  including the empty-name fallback) and that the downloaded content is the
  rendered markdown.
- Manual in Figma: hover and keyboard-focus the button to confirm the
  tooltip renders above the button without clipping; download a spec and
  confirm the `.md` drops into an AI chat cleanly.

## Out of scope

- Renaming the button or adding a format dropdown.
- Changing the Library tab's bulk export format.
- Any first-run hint or persistent hint line.
