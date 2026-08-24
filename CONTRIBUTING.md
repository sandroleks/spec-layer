# Contributing

Thanks for improving Spec Layer. Keep changes focused, testable, and safe for a public repository.

## Setup

Requirements: Node.js 20.9 or newer, npm, and Figma Desktop for plugin testing.

```bash
npm ci
npm run check
```

Build the Figma plugin with `npm run build:plugin`, then import `packages/plugin/manifest.json` as a development plugin.

## Development rules

- Add or update automated tests for behavior changes. Bug fixes should include a regression test.
- Run the complete quality gate before opening a pull request: `npm run check`.
- Keep package boundaries intact: `extractor` owns pure transformation, `plugin` owns Figma I/O, and `proxy` owns the AI relay, quotas, and licensing.
- Do not commit `.spec-data`, `.spec-cache`, `.ds-config.json`, or environment files.
- Use synthetic fixtures. Never submit API keys, private Figma file keys, customer names, proprietary tokens, or internal component data.
- Avoid unrelated formatting or refactoring in the same pull request.

## Pull requests

Explain the user-visible behavior, architectural tradeoffs, and verification performed. UI changes should include screenshots using synthetic content. Changes to the YAML brief are changes to the one public contract: update the golden fixtures and the compatibility notes in the same pull request.

## Reporting security issues

Do not open public issues for vulnerabilities or leaked credentials. Follow [SECURITY.md](SECURITY.md).
