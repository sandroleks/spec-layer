# Figma Plugin Testing

## Setup

```bash
npm ci
npm run build:plugin
```

Import `packages/plugin/manifest.json` through Figma desktop's development
plugin menu. The plugin needs no local server and no account to run.

## Network model

The only network destination the manifest permits is the Spec Layer proxy:
`https://spec-layer-proxy.spec-layer-test.workers.dev` (currently the **staging**
Worker). AI guideline text is generated through this proxy, which enforces
free-tier quotas and Pro licenses. There is **no Anthropic API key** in the
plugin: no key is requested, entered, or stored. Free users generate against a
monthly quota; a Pro **license key** lifts the cap. Requests carry the
component's structured summary and a rendered image of the selected node.

## Selected component

1. Select a component or component set and run the plugin.
2. Confirm the component name is shown (and the atom notice appears for
   `.`-prefixed components).
3. Toggle **Write with AI**. On the free plan it enables with no key needed
   (`AI works on the free plan. No key needed.`).
4. Pick sections (and, for a component set, the variants to document) and
   **Create frame**. Confirm a `<Name>: Guidelines` frame is placed on the
   canvas next to the component, and re-running replaces the previous frame in
   place.
5. **Download** and confirm the ZIP contains a Markdown file starting with YAML
   frontmatter plus a `.spec-data` sidecar JSON.

Also verify a nested selection resolves to its enclosing component and a
non-component selection shows an actionable empty state.

## Quota meter (free plan)

1. With AI enabled and no Pro key, confirm the quota meter shows remaining free
   generations (e.g. `17/20 AI generations left this month`), and the bar fills
   accordingly.
2. Confirm the meter offers **Activate license** (routes to Settings, focuses
   the license key field) and **Upgrade**.
3. Exhaust the free quota (or simulate it). Confirm the upsell appears
   (`You've used your free AI generations for July.`) with **Upgrade for
   unlimited** and **Continue without AI**, and that the default
   Create/Download row is folded away while the upsell owns the footer.
4. Confirm **Continue without AI** still creates the frame (without AI prose)
   and restores the default action row.

## Settings — Pro license

1. In **Settings → Auto Docs & Specs Pro**, paste a Pro **license key** and
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

## Settings — Frame theme

1. **Frame theme** presets: pick a preset and confirm the generated Guidelines
   frame reflects it. Selecting **Custom** reveals the color and font controls;
   other presets hide them. The logo control stays visible in every mode.
2. **Custom colors**: set a header/accent hex (or leave blank for defaults),
   confirm the swatch updates, an invalid hex is rejected with a hint, and
   **Create frame** reflects the chosen colors. Reset returns to defaults.
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
```

## Release note

`package.json` `version` is the single in-repo version source; the build stamps
it into every doc frame as `pluginVersion` via `__PLUGIN_VERSION__`. The
Figma-published version (set in the Figma publishing UI) should match it. Before
a public (non-staging) release, swap the staging proxy host in
`src/ui/proxy.ts` and `manifest.json` for the production domain.

Use only synthetic or publishable Figma files in screenshots, fixtures, and bug
reports.
