# Figma Plugin Testing

## Setup

```bash
npm ci
npm run build:plugin
npm run dev -w md-ds
```

Import `packages/plugin/manifest.json` through Figma desktop's development plugin menu. The manifest permits `http://localhost:3000` and `http://localhost:3001` (hostname only — Figma rejects raw IP literals like `127.0.0.1`).

For **Send to docs**, make sure the web app is running. No token or account is needed — the plugin posts to the local docs app, whose URL lives in the plugin's **Settings** tab (default `http://localhost:3000`). Use the `localhost` hostname there, not `127.0.0.1`, or the fetch is blocked with `Failed to fetch`.

## Selected Component

1. Select a component or component set and run the plugin.
2. Confirm the component name and file source are shown.
3. Extract and inspect the Markdown preview.
4. Download the spec and confirm the ZIP contains a Markdown file starting with YAML frontmatter.
5. Send it to the docs app and confirm the imported file appears in the inbox.
6. Change the plugin token and confirm the request is rejected without writing a file.

Also verify a nested selection resolves to its enclosing component and a non-component selection shows an actionable empty state.

## Bulk Export

1. Open the **Export all** tab without requiring a selected component.
2. Enter a folder name and start export.
3. Confirm progress advances and the action is disabled while running.
4. Confirm a ZIP downloads and contains one kebab-cased Markdown file per component.
5. Confirm duplicate component names receive numeric suffixes.

## Keyboard And Visual Checks

- Arrow Left/Right, Home, and End move between plugin tabs.
- Tab and Shift+Tab reach every input and action in a logical order.
- Focus remains visible in light and dark Figma themes.
- Reduced-motion mode avoids nonessential transition animation.
- Error messages remain visible and the failed action can be retried.

## Automated Checks

```bash
npm test -- packages/plugin/test
npm run typecheck
npm run build:plugin
```

Use only synthetic or publishable Figma files in screenshots, fixtures, and bug reports.
