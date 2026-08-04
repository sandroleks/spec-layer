# Figma Plugin Testing

## Setup

```bash
npm ci
npm run build:plugin
```

Import `packages/plugin/manifest.json` through Figma desktop's development
plugin menu. The plugin needs no local server and no account to run.

`npm run build:plugin` builds vNext. Use `npm run build:plugin:legacy` only to
compare against the temporary rollback UI.

## Pre-merge pass

Before merging a branch that touched the plugin, walk these in order. Each one
covers something unit tests cannot reach, roughly highest risk first:

1. **Generate component docs** (below), on a component set with two variant axes.
2. **Doc frame content**, which is where most rendering regressions show up.
3. **Library**, the newest surface and the least covered by tests.
4. **AI-writing allowance** and **License**, which need a real proxy round
   trip and cannot be faked locally.
5. **Settings**, then the keyboard and visual checks.

Two things worth knowing before you start:

- The manifest points at the **staging** proxy. Activating a real license here
  hits staging, not production.
- Deploy order matters. The plugin sends `Bearer key:instanceId`; an older
  deployed proxy reads that whole string as the key and silently falls back to
  the free tier. If licensing behaves oddly, confirm the proxy is current
  before debugging the plugin.

## Network model

The only network destination the manifest permits is the Spec Layer proxy:
`https://spec-layer-proxy.spec-layer-test.workers.dev` (currently the **staging**
Worker). AI guideline text is generated through this proxy, which enforces
free-tier quotas and Pro licenses. There is **no Anthropic API key** in the
plugin: no key is requested, entered, or stored. Free users generate against a
monthly quota; a Pro **license key** lifts the cap. Requests carry the
component's structured summary and a rendered image of the selected node.

## Generate component docs

1. Select a component or component set and run the plugin.
2. Confirm the component name is shown (and the atom notice appears for
   `.`-prefixed components).
3. Toggle **Write with AI**. On the free plan it enables with no key needed
   (`AI works on the free plan. No key needed.`).
4. Pick sections (and, for a component set, the variants to document) and
   **Create docs**. Confirm a `<Name>: Guidelines` frame is placed on the
   canvas next to the component, and re-running replaces the previous frame in
   place.
5. **Download** and confirm the ZIP contains a Markdown file starting with YAML
   frontmatter plus a `.spec-data` sidecar JSON.

Also verify a nested selection resolves to its enclosing component and a
non-component selection shows an actionable empty state.

## Doc frame content

Build one frame with every section enabled, against a component set that has at
least two variant axes and a hardcoded (unbound) paint somewhere. Then check
each section renders rather than silently dropping out:

1. **Anatomy**: switch the view between **Diagram**, **Table**, and **Both**.
   The diagram numbers each part and the numbers match the table rows. Nested
   components show their depth and main-component name.
2. **Measurements**: toggle the **size**, **padding**, and **spacing** lenses.
   Each selected lens renders its own mini-diagram; deselecting all falls back
   to all three rather than producing an empty section.
3. **States**: with a state axis present, confirm the matrix renders with
   lifecycle-ordered columns. With more than four row values, confirm the
   capped note appears instead of an unbounded grid.
4. **Variants**: confirm the default variant's card lists all rows, and
   non-default cards list only rows that differ, with a "same as default"
   count for the rest.
5. **Tokens used**: confirm condition-aware rows read correctly, and that the
   hardcoded paint appears as a raw value rather than an invented token name.
6. Confirm unchecking a section removes it from the frame, and that unchecking
   every section in a group drops the whole group heading.

## Library

This tab tracks generated docs and is the newest surface, so give it the most
attention. Each entry stores its source node id and the content hash at
generation time.

1. Generate two or three doc frames, then open **Library**. Confirm every
   doc is listed with its component name and page name, and that the summary
   count matches.
2. Click an entry and confirm it focuses the doc frame on canvas.
3. **In sync**: a freshly generated doc reports no pending changes.
4. **Update available**: edit the source component (change a padding value or
   rebind a token), reopen the tab, and confirm the entry flags that an update
   is available. Run **Update** and confirm the frame is replaced in place
   (same position, not a duplicate) and the status returns to in sync.
5. **Edited**: hand-edit text inside a generated frame, reopen the tab, and
   confirm the entry reports the doc was edited. This is hash-based, so
   confirm that re-running Update overwrites the hand edit.
6. **Orphaned**: delete a source component and confirm its doc reports the
   source is missing, and that Update is not offered for it.
7. **Download .md** from an entry. Confirm the file matches what Update would
   have rendered, including AI prose when the stored config had AI on.
8. Confirm **Update** and **Download** both work without disturbing whatever is
   selected on the Selected component tab.
9. **Detach** an entry and confirm it leaves the canvas frame alone but drops
   out of the library. **Remove** and confirm the expected cleanup.
10. Close and reopen the plugin. Confirm the library survives, since it is
    stored in the document rather than per device.

## AI-writing allowance (free plan)

1. With AI enabled and no Pro key, confirm the header allowance shows the
   remaining free uses and the ring fills accordingly.
2. Confirm the allowance offers **Upgrade** and that License owns activation.
3. Exhaust the free quota (or simulate it). Confirm the exhausted state offers
   **Upgrade** and **Continue without AI**, and that the default
   Create/Download row is folded away while the upsell owns the footer.
4. Confirm **Continue without AI** still creates the frame (without AI prose)
   and restores the default action row.

## License

1. On **License**, paste a Pro **license key** and
   **Activate**. Confirm success shows `Pro plan active ✓`, the quota meter
   switches to the Pro state (`Pro plan active`), and the setting persists
   across reopen.
2. Confirm an invalid/expired key shows a clear status and, for an expired key,
   surfaces the **Renew Pro** link.
3. Confirm **Remove key from this device** deactivates the key and returns the
   UI to the free-plan state.
4. Confirm **Manage subscription** opens the billing portal.
5. Confirm behavior when the proxy is unreachable: a transient outage is treated
   as a blip (the saved key stays; no false "expired"), not a lapse.

## Settings

1. **Frame theme** presets: pick a preset and confirm the generated Guidelines
   frame reflects it. Selecting **Custom** reveals the color and font controls;
   other presets hide them. The logo control stays visible in every mode.
2. **Custom colors**: set a header/accent hex (or leave blank for defaults),
   confirm the swatch updates, an invalid hex is rejected with a hint, and
   **Create docs** reflects the chosen colors. Reset returns to defaults.
3. **Logo**: set a logo node and confirm it appears in the frame; confirm an
   oversized logo is rejected with a hint.

## Keyboard and visual checks

- Tab and Shift+Tab reach every input and action in a logical order.
- Focus remains visible in light and dark Figma themes; the theme button follows
  Figma's theme until overridden.
- Reduced-motion mode avoids nonessential transition animation.
- Error messages remain visible and the failed action can be retried.

## Automated checks

```bash
npm test -- packages/plugin/test
npm run typecheck
npm run lint
npm run build:plugin
npm run build:plugin:legacy
```

## Release note

`package.json` `version` is the single in-repo version source; the build stamps
it into every doc frame as `pluginVersion` via `__PLUGIN_VERSION__`. The
Figma-published version (set in the Figma publishing UI) should match it. Before
a public (non-staging) release, swap the staging proxy host in
`src/ui/proxy.ts` and `manifest.json` for the production domain.

Use only synthetic or publishable Figma files in screenshots, fixtures, and bug
reports.
