# Contributing

Thanks for improving Spec Layer. Keep changes focused, testable, and safe for a public repository.

## Setup

Requirements: Node.js 22 or newer, npm 10 or newer, and Figma Desktop for plugin testing.

```bash
npm ci
npm run check
```

Build the Figma plugin with `npm run build:plugin`, then import `packages/plugin/manifest.json` as a development plugin.

`npm ci` also runs the `prepare` script, which sets `core.hooksPath` to
`.githooks` so the pre-commit hook that rejects known secret shapes runs in
your clone. If you installed with `--ignore-scripts`, run
`node scripts/install-hooks.mjs` once.

## Development rules

- Add or update automated tests for behavior changes. Bug fixes should include a regression test.
- Run the complete quality gate before opening a pull request: `npm run check`.
- Keep package boundaries intact: `extractor` owns pure transformation, `plugin` owns Figma I/O, and `proxy` owns the AI relay, quotas, and licensing.
- Do not commit environment files, API keys, license keys, or local credentials.
- Use synthetic fixtures. Never submit private Figma file keys, customer names,
  rendered component images, proprietary tokens, or internal component data.
- Avoid unrelated formatting or refactoring in the same pull request.

## Pull requests

Explain the user-visible behavior, architectural tradeoffs, and verification performed. UI changes should include screenshots using synthetic content. Changes to the YAML brief are changes to the one public contract: update the golden fixtures and the compatibility notes in the same pull request.

## Dependency overrides

`package.json` carries an `overrides` block for transitive packages that
`npm audit` flagged before their parents caught up. `package.json` cannot hold
comments, so the provenance lives here. Each entry names the parent whose own
range still asks for the vulnerable version; when `npm explain <package>` no
longer prints an `overridden … (was …)` line for it, the parent has caught up
and the entry should be deleted in the next dependency pull request. Recorded
2026-09-23:

| Override | Parent that asks for less | Drop when |
|---|---|---|
| `sharp` `^0.35.4` | `miniflare@5.20260826.0-alpha` via `wrangler@4.127.0` asks for `0.35.2` | miniflare's own range reaches `0.35.4` |
| `minimatch` `^10.2.6` | `eslint@9.39.4` asks for `^3.1.5`; `glob@13.0.6` via `style-dictionary@5.5.2` asks for `^10.2.2` | both parents ask for `^10.2.6` or later |
| `brace-expansion` `^5.0.9` | `minimatch@10.2.6` asks for `^5.0.8` | minimatch asks for `^5.0.9` or later |
| `nanoid` `^3.3.18` | `postcss@8.5.28` already asks for `^3.3.18` | now: `npm explain nanoid` shows no override in effect, so remove it in the next dependency PR once `npm audit` stays clean without it |

## Reporting security issues

Do not open public issues for vulnerabilities or leaked credentials. Follow [SECURITY.md](SECURITY.md).
