# Figma Plugin Testing

## Setup

```bash
npm ci
npm run build:plugin
```

Import `packages/plugin/manifest.json` through Figma desktop's development
plugin menu. The plugin needs no local server and no account to run.

`npm run build:plugin` builds the current vNext UI. There is one production UI
and one bundle; no legacy build flag or alternate UI artifact remains.

## Pre-merge pass

Before merging a branch that touched the plugin, walk these in order. Each one
covers something unit tests cannot reach, roughly highest risk first:

1. **Generate component docs** on a component set with two variant axes.
2. **Generate Foundation docs** and exercise file-wide **Copy for AI**.
3. **Doc frame content**, where most rendering regressions show up.
4. **Library**, including component and Foundation rows and scoped copies.
5. **AI-writing allowance** and **License**, which need a real proxy round
   trip and cannot be faked locally.
6. **Settings**, global search, keyboard, and visual checks.

Two things worth knowing before you start:

- The manifest points at the production proxy. Activating a real license here
  affects the live service.
- Deploy order matters. The plugin sends `Bearer key:instanceId`; an older
  deployed proxy reads that whole string as the key and silently falls back to
  the free tier. If licensing behaves oddly, confirm the proxy is current
  before debugging the plugin.

## Network model

The only network destination the manifest permits is the Spec Layer proxy:
`https://api.spec-layer.com`. AI writing is generated through this proxy,
which enforces free-tier quotas and Pro licenses. There is **no Anthropic API
key** in the plugin: no API key is requested, entered, or stored.

Free users start with 20 generations for 30 days and then receive 10 per UTC
month. Pro has no fixed monthly cap for normal individual use, subject to fair
use and rate limits. Component requests carry a structured summary and, when it
fits the export limits, a rendered image of the selected node. Foundation group
requests carry token names and resolved values without an image.

## Generate component docs

1. Select a component or component set and run the plugin.
2. Confirm the component name is shown (and the atom notice appears for
   `.`-prefixed components).
3. Toggle **AI writing**. On the free plan it enables without an API or license
   key while allowance remains.
4. Pick sections and, for a component set, the variants to document. Click
   **Create docs** and confirm a `<Name>: Guidelines` Section is placed next to
   the component. Re-running replaces the previous Section in place.
5. Open **Library**, use the row menu's **Copy for AI**, and paste into a plain
   text editor. Confirm it is a YAML brief for the live source. It must not
   download Markdown/ZIP files or change the canvas.

Also verify a nested selection resolves to its enclosing component and a
non-component selection shows an actionable empty state.

## Generate Foundation docs

1. Open **Foundation documents** and wait for local variable collections and
   text styles to finish loading. Use **Refresh sources** after changing the
   Figma file and confirm the list updates without creating Sections.
2. Exercise **Select all** / **Clear all**, individual source selection, and a
   collection large enough to split. Confirm row and button frame counts match
   the Sections that are created.
3. Click **Create docs** and confirm collection and text-style Sections use the
   current frame theme, include only selected sources, and appear in Library.
4. Click the Foundations footer's **Copy for AI** and paste into a plain text
   editor. Confirm it contains the complete file-wide Foundation vocabulary,
   regardless of the current source selection, and creates no canvas objects.
5. If AI group descriptions are enabled, confirm a failed or refused AI
   request still creates deterministic Foundation Sections and reports that it
   went without descriptions.

## Doc frame content

Build one component Section with every section enabled, against a component
set that has at least two variant axes and a hardcoded paint. Check that:

1. **Anatomy** switches between **Diagram**, **Table**, and **Both**. Diagram
   numbers match table rows, and nested components show depth and main name.
2. **Measurements** respects the size, padding, and spacing lenses. Selecting
   none falls back to all three instead of producing an empty section.
3. **States** uses lifecycle-ordered columns and caps large row sets with a
   note rather than an unbounded grid.
4. **Variants** gives the default variant all rows and other variants only
   differences, with a same-as-default count for the rest.
5. **Tokens used** preserves conditions and shows hardcoded paint as a raw
   value instead of inventing a token.
6. Unchecking a section removes it; unchecking a whole group removes its group
   heading.

## Library

1. Generate two or three component and Foundation Sections. Confirm Library
   lists every connection with its source and page name and correct filter
   counts.
2. Use **Open documentation frame** and, for a component, **View source
   component**. Confirm each focuses the intended object.
3. A fresh document reports **In sync**.
4. Change a source and refresh Library. Confirm **Update available**, then run
   **Update documentation** and verify replacement in place and a return to
   **In sync**.
5. Hand-edit generated text. Confirm **Manually edited**, the overwrite warning,
   and that an accepted Update replaces the manual edit.
6. Delete a source component or remove a documented Foundation scope. Confirm
   **Source missing** and that Update and **Copy for AI** are not offered.
7. Run **Copy for AI** on in-sync, update-available, and manually edited
   component rows. Each copy must read the live source, include saved AI
   guidelines when present, and leave the Section and link data unchanged.
8. Run **Copy for AI** on a split or grouped Foundation row. Confirm the copy
   widens to the complete collection and all modes, without including other
   collections. A text-style row copies only text styles.
9. Confirm Update and Copy do not disturb the selection or settings on the
   Selected component screen.
10. **Detach documentation** leaves the canvas Section but removes its Library
    connection. **Remove connection** performs the confirmed cleanup.
11. Close and reopen the plugin. Library must survive because connections live
    in the document, not only on the device.

## AI-writing allowance (free plan)

1. With AI enabled and no Pro key, confirm the header shows remaining free
   uses and the ring reflects the state.
2. Confirm the allowance offers **Upgrade** and License owns activation.
3. Exhaust the free quota or simulate it. Confirm the header reads **No free
   uses left** and offers **Upgrade** while the ordinary **Create docs** action
   remains available.
4. Click **Create docs** with AI writing selected. The build must complete with
   deterministic documentation, omit AI prose, and report the exhausted
   allowance without trapping the user in a dead-end footer state.

## License

1. Paste a Pro license key and click **Activate**. Confirm the plan card reads
   **Pro plan** with an **Active** badge, the header reads **Pro plan active**,
   and the connection persists across reopen.
2. An invalid or expired key shows the matching status; an expired key offers
   **Renew Pro**.
3. **Remove key from this device** deactivates the device and returns the UI to
   the free plan.
4. **Manage subscription** opens the billing portal.
5. If the proxy is unreachable, the saved key remains and the UI reports a
   temporary verification problem rather than falsely marking it expired.

## Settings, search, keyboard, and visuals

1. Test every frame-theme preset. **Custom** reveals color and font controls;
   other presets hide them. Logo remains available in every mode.
2. Test valid, empty, and invalid custom colors, the native color picker, font
   search/fallback, Reset, and generated component and Foundation Sections.
3. Attach and remove a logo. Confirm an oversized logo is rejected clearly.
4. Use global search to open every workflow and a connected Library document.
5. Tab and Shift+Tab reach every input and action logically. Focus remains
   visible in light and dark Figma themes.
6. Reduced-motion mode avoids nonessential animation. Errors remain visible
   and retryable.

## Automated checks

```bash
npm test -- packages/plugin/test
npm run typecheck
npm run lint
npm run build:plugin
npm run check:proxy-dry-run
npm run audit
```

## Release gate

`packages/plugin/package.json` is the plugin's in-repo version source; the
build stamps it into each connected document as `pluginVersion` via
`__PLUGIN_VERSION__`. The Figma-published version should match it.

Repository builds target `https://api.spec-layer.com` in both
`packages/plugin/src/ui/proxy.ts` and `packages/plugin/manifest.json`. Before a
public production build, verify those locations remain aligned, build again,
and rerun this checklist.

Use only synthetic or publishable Figma files in screenshots, fixtures, and
bug reports.
