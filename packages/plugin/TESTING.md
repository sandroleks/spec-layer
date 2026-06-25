# Figma Plugin Testing

## Setup

```bash
npm ci
npm run build:plugin
```

Import `packages/plugin/manifest.json` through Figma desktop's development plugin menu. The only network destination the manifest permits is `https://api.anthropic.com` (used by **Write with AI**); the plugin needs no local server or account.

## Selected component

1. Select a component or component set and run the plugin.
2. Confirm the component name is shown (and the atom notice appears for `.`-prefixed components).
3. Toggle **Write with AI** — with no key it routes to Settings; with a key set it enables.
4. Pick sections (and, for a component set, the variants to document) and **Create frame**. Confirm a `<Name>: Guidelines` frame is placed on the canvas next to the component, and re-running replaces the previous frame in place.
5. **Download** and confirm the ZIP contains a Markdown file starting with YAML frontmatter plus a `.spec-data` sidecar JSON.

Also verify a nested selection resolves to its enclosing component and a non-component selection shows an actionable empty state.

## Settings

1. **Anthropic API key** — paste a key; confirm it persists across reopen and enables the AI toggle.
2. **Frame colors** — set a header/accent hex (or leave blank for defaults), confirm the swatch updates, an invalid hex is rejected with a hint, and **Create frame** reflects the chosen colors. Reset returns to defaults.

## Keyboard and visual checks

- Tab and Shift+Tab reach every input and action in a logical order.
- Focus remains visible in light and dark Figma themes; the theme button follows Figma's theme until overridden.
- Reduced-motion mode avoids nonessential transition animation.
- Error messages remain visible and the failed action can be retried.

## Automated checks

```bash
npm test -- packages/plugin/test
npm run typecheck
npm run lint
npm run build:plugin
```

Use only synthetic or publishable Figma files in screenshots, fixtures, and bug reports.
