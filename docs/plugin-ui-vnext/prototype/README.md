# Prototype archive

This is a verbatim archive of the React/Vite prototype that produced the
approved plugin UI direction. It was rescued on 2026-07-28 from an ephemeral
scratch directory
(`~/.codex/visualizations/2026/07/27/019fa5b2-.../spec-layer-plugin-prototype`)
that was not backed up and could have been garbage-collected at any time.

## Why it is here

The rest of `docs/plugin-ui-vnext/` describes the approved direction in prose,
and `design-system/` supplies a clean `sl-` prefixed CSS port. Neither of those
is what produced the approved screenshots. This archive is.

Treat it as the **visual record of what was approved**, not as code to ship.

## What is in it

- `src/App.jsx` — the full five-screen prototype, including the icon set,
  the quick-search overlay, and every mocked state.
- `src/styles.css` — the CSS that actually rendered the approved screens.
  Unprefixed class names; light theme is a block of `.light-theme .x` overrides
  starting near the end of the file.
- `src/design-system/` — a separate design-system showcase view. Not the app's
  styling.
- `design-qa.md` — the narrated QA record. Every image path in it has been
  rewritten to be relative to this folder, so the document is self-contained.
- `light-theme-audit.md` — the light-theme contrast pass.
- `source-visual-truth/` — the original design targets the prototype was built
  to match. These came from macOS temp files that would have been purged.
- `*.png` / `*.jpg` — ~170 QA screenshots, including before/after pairs for
  every iteration.

## Differences from the written spec

The archive and the prose specs disagree in a few places. Where they do, neither
is automatically right — see the review notes in the design spec. Known drift:

- The foundations toolbar shows only `Clear all`; `workflows.md` specifies a
  `{selected} of {total} included` count.
- The component screen shows a `SELECTED COMPONENT` eyebrow that no spec
  mentions.
- The rail carries a `Help & feedback` item and a `⌘K` quick-search overlay that
  the specs do not describe.

## Running it

```bash
npm install && npm run dev
```

`worker/`, `scripts/`, and `tests/` are hosting scaffolding from the
environment that generated the prototype. They are not relevant to the plugin.
