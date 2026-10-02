# Contributing

Thanks for improving Spec Layer. Keep changes focused, testable, and safe for a public repository.

## Setup

Requirements: Node.js 22 or newer (`.nvmrc` names the version CI uses), npm 10 or newer, and Figma Desktop for plugin testing.

Install with `npm ci`. When changing dependencies, npm 10.9 can fail with
`Cannot read properties of null (reading 'edgesOut')` while re-resolving
vitest's optional peers; npm 11 (bundled with Node 24) resolves the same tree,
and `npm ci` under npm 10 installs from the lockfile it writes.

```bash
npm ci
npm run check
```

Build the Figma plugin with `npm run build:plugin`, then import `packages/plugin/manifest.json` as a development plugin.

`npm ci` also runs the `prepare` script, which sets `core.hooksPath` to
`.githooks` so the pre-commit hook that rejects known secret shapes runs in
your clone. If you installed with `--ignore-scripts`, run
`node scripts/install-hooks.mjs` once. The same patterns run in `npm run check`
and in CI over every commit of a pull request, so skipping the hook with
`--no-verify` only moves the failure there. A test fixture that needs a value
of one of those shapes builds it at runtime instead of writing it literally.

## Development rules

- Add or update automated tests for behavior changes. Bug fixes should include a regression test.
- Run the complete quality gate before opening a pull request: `npm run check`.
- Keep package boundaries intact: `extractor` owns pure transformation, `plugin` owns Figma I/O, `proxy` owns the AI relay, quotas, licensing, and published libraries, `cli` owns delivery into a repository and never extracts, and `brand` owns the shared tokens.
- Do not commit environment files, API keys, license keys, or local credentials.
- Use synthetic fixtures. Never submit private Figma file keys, customer names,
  rendered component images, proprietary tokens, or internal component data.
- Avoid unrelated formatting or refactoring in the same pull request.

## Pull requests

Explain the user-visible behavior, architectural tradeoffs, and verification performed. UI changes should include screenshots using synthetic content. The public contract is the Component and Foundation Context v5 JSON Schemas in `packages/extractor/src/v5/schema/`; YAML, Markdown, and DTCG are projections of it. A contract change updates the schema, the golden fixtures, and `CHANGELOG.md` in the same pull request, and ships under a new schema version, because `spec-layer.com/schemas/` never overwrites a published one.

## How releases happen

Nothing ships from a laptop in the normal path. Each surface has one workflow,
and each refuses to run when its tag, versions and changelog disagree
(`scripts/check-release.mjs`).

| Surface | Trigger | Workflow | What it does |
|---|---|---|---|
| `spec-layer` CLI | push a `cli-vX.Y.Z` tag | `release-cli.yml` | `check:ci`, then `npm publish` through npm trusted publishing with a provenance attestation, after approval in the `npm` environment |
| Figma plugin | push a `vX.Y.Z` tag | `release-plugin.yml` | `check:ci`, a reproducible zip of `manifest.json` and `dist/`, a build provenance attestation, and a **draft** GitHub Release with the changelog section and the checklist a person still owns |
| Proxy | merge to `main` touching the proxy, extractor or lockfile | `deploy-proxy.yml` | `check:ci`, staging deploy and smoke test, then production after approval in the `production` environment |

Order matters when a release spans surfaces: the proxy first, then the CLI,
then the plugin listing. Figma has no publishing API, so the Community listing
is updated by hand from the draft release, after the manual pass in
`packages/plugin/TESTING.md` is recorded on it. Running either release workflow
by hand is a dry run.

To cut a CLI release: bump `packages/cli/package.json`, describe the version in
`CHANGELOG.md`, merge, then tag the squash commit `cli-vX.Y.Z` and push the tag.
A plugin release is the same with the root and `packages/plugin` versions, a
dated `## [X.Y.Z] - YYYY-MM-DD` section, and a `vX.Y.Z` tag.

**Emergency CLI publish.** `npm publish --workspace packages/cli` from a clean
checkout of `main` still works: `prepublishOnly` builds the bundle and runs its
smoke test and the CLI tests first. It ships without provenance, so use it only
when the workflow cannot run, and say so in the next changelog entry. The
proxy's emergency path is in `packages/proxy/README.md`.

## CI jobs

| Job | Where | Gate |
|---|---|---|
| `verify` | `ci.yml` | Required on `main`. `check:ci`, plus a secret scan of every commit in a pull request |
| `cli-portability` | `ci.yml` | CLI bundle and tests on Linux, Windows and macOS under Node 22 and 24 |
| `dependency-review` | `ci.yml` | New dependencies: high-severity advisories and the licence allow-list |
| `workflow-lint` | `ci.yml` | actionlint and zizmor over `.github/` |
| CodeQL, Scorecard | `codeql.yml`, `scorecard.yml` | Advisory, reported to the Security tab |
| Site live | `site-live.yml` | Weekly: the live schemas against the committed bytes |

Every action is pinned to a commit SHA with its version in a comment, and
Dependabot moves both. Release and deploy jobs never use the dependency cache.

## Dependency overrides

`package.json` carries an `overrides` block for transitive packages that
`npm audit` flagged before their parents caught up. `package.json` cannot hold
comments, so the provenance lives here. Each entry names the parent whose own
range still asks for the vulnerable version; when `npm explain <package>` no
longer prints an `overridden … (was …)` line for it, the parent has caught up
and the entry should be deleted in the next dependency pull request. Recorded
2026-10-02:

| Override | Parent that asks for less | Drop when |
|---|---|---|
| `minimatch` `^10.2.6` | `eslint@10.11.0` asks for `^10.2.5`, `@eslint/config-array@0.23.5` for `^10.2.4`, `@typescript-eslint/typescript-estree@8.71.0` and `glob@13.0.6` for `^10.2.2` | every parent asks for `^10.2.6` or later |
| `brace-expansion` `^5.0.9` | `minimatch@10.2.6` asks for `^5.0.8` | minimatch asks for `^5.0.9` or later |

`sharp`, `undici` and `nanoid` were dropped on 2026-10-02: `miniflare` now
asks for `sharp@0.35.4` and `undici@7.29.1` itself, and `npm explain nanoid`
showed no override in effect. `npm audit` stays clean without them.

## Reporting security issues

Do not open public issues for vulnerabilities or leaked credentials. Follow [SECURITY.md](SECURITY.md).
