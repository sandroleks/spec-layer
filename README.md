# Spec Layer

[![CI](https://github.com/sandroleks/spec-layer/actions/workflows/ci.yml/badge.svg)](https://github.com/sandroleks/spec-layer/actions/workflows/ci.yml)
[![Figma Community](https://img.shields.io/badge/Figma-Community-f24e1e?logo=figma&logoColor=white)](https://www.figma.com/community/plugin/1652104411578396548)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-43853d.svg)](https://nodejs.org)

Spec Layer is a Figma plugin that turns components, variables, and styles into
design-system documentation—on the canvas, on the clipboard, or pulled straight
into your repository as structured context for an AI coding agent.

**[Open in Figma](https://www.figma.com/community/plugin/1652104411578396548)** ·
[Visit spec-layer.com](https://spec-layer.com)

## What it does

- **Component documentation.** Generate measurements, anatomy, properties,
  states, variants, tokens, and theming in a connected canvas frame.
- **Foundation documentation.** Turn variable collections and text styles into
  readable token tables and colour references.
- **Copy for AI.** Copy a component or Foundation as compact YAML with the facts
  an implementation agent needs. Foundation and component copies retain their
  canonical v5 content hashes; component copies include only the exact token
  and style dependency closure they use.
- **Library and updates.** Track generated documents, detect source changes, and
  rebuild outdated frames in one click.
- **Publish and pull.** Publish a library from the plugin, then pull it into a
  repository with the [`spec-layer`](packages/cli/README.md) CLI, so a coding
  agent reads the same component and token facts your designers see in Figma.
- **Optional AI writing.** Draft overviews, usage guidance, do's and don'ts, and
  interaction notes from the selected component.

Extraction, rendering, drift detection, and Copy for AI are deterministic. Only
AI-written prose uses a model.

## Free and Pro

Every documentation feature is free and works without an account. Publishing a
library needs Pro, because it stores the bundle on the Spec Layer proxy;
pulling one only needs the CLI and a pull key.

| | Free | Pro |
|---|---|---|
| Canvas documentation and updates | Yes | Yes |
| Copy for AI | Yes | Yes |
| Publish a library for the CLI | — | Yes |
| AI writing | 20 uses in the first month, then 10/month | No fixed monthly cap for normal individual use |
| Priority support | — | Yes |

Pro costs $7.99/month or $79.99/year. Purchase it on
[spec-layer.com](https://spec-layer.com), then paste the emailed license key into
the plugin's **License** screen. Lemon Squeezy handles payments as merchant of
record.

A generation is counted only after a successful AI response. Failed calls do
not count, and retrying an unchanged request within the 24-hour cache window
does not use another generation. Pro is subject to the published fair-use
policy for automated, shared, or exceptionally high-volume use.

## Privacy

Deterministic work stays inside Figma. Canvas documentation and clipboard YAML
are produced locally.

When you request AI writing, the plugin sends a structured component summary
and, when it fits the export limits, a rendered image through the Spec Layer
proxy to Anthropic. If the image cannot be exported, the request continues with
text only. You do not provide an API key.

Publishing a library is the one feature that stores your content. The bundle
you publish is held on the proxy so the CLI can fetch it, and pulling it
requires a bearer pull key that only you hold: the proxy stores the key's
sha256 digest, never the key itself, so rotating it invalidates every command
already handed out. Publishing is explicit and per-file. Nothing leaves Figma
until you choose it.

The proxy never logs prompts, rendered images, generated text, or raw license
keys. Read the published [Privacy Policy](apps/landing/privacy.html),
[Security overview](apps/landing/security.html), and [security policy](SECURITY.md)
for the complete data flow and reporting instructions.

## Install

Install the plugin from its
[Figma Community listing](https://www.figma.com/community/plugin/1652104411578396548).

To run a local build, you need Node.js 22 or newer, npm 10 or newer, and Figma
desktop:

```bash
npm ci
npm run build:plugin
```

In Figma, choose **Plugins → Development → Import plugin from manifest**, then
select `packages/plugin/manifest.json`.

Local builds use the production proxy at `https://api.spec-layer.com`. Keep the
plugin source and manifest network allowlist aligned when changing that host.

### The CLI

Publishing a library from the plugin's **Library** screen shows a setup command
to run in your repository:

```bash
SPEC_LAYER_KEY=sl_... npx spec-layer pull --id lib_...
```

`npx` needs no install step of its own, though a repo that pulls on a schedule
should pin the CLI as a dev dependency. That writes `.speclayer/`. The CLI is
delivery only: it never talks to Figma, re-derives nothing, and has no runtime
dependencies. `init` records the library id, `status` checks freshness without
writing, and `list` and `show` read the last pull. See the
[CLI README](packages/cli/README.md) for every command, partial pulls, and what
`pull` writes.

## Development

Install dependencies and run the complete local quality gate:

```bash
npm ci
npm run check
```

`npm run check` runs linting, TypeScript checks, the NUL-byte scan, tests, the
plugin and CLI builds, browser-sandbox validation, and a dry-run proxy bundle.
Useful individual commands:

```bash
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build:plugin
npm run build:cli
npm run check:proxy-dry-run
npm run audit
```

CI adds coverage thresholds and a full dependency audit on pushes to `main` and
on pull requests.

## Architecture

```text
Figma node
  → plugin serializer
  → plain IntermediateSpec data
  ├─→ canvas documentation + connected Library entry
  ├─→ compact YAML on the clipboard
  ├─→ published library bundle → proxy → spec-layer CLI → your repository
  └─→ optional AI-writing proxy → Anthropic
```

The plugin owns all Figma API access. The extractor receives plain JSON and has
no Figma runtime dependency, which keeps the transformation layer testable with
synthetic fixtures. The Cloudflare Worker owns the Anthropic credential, quota
enforcement, Lemon Squeezy license validation, and published library bundles.
The CLI parses a bundle through the same extractor parser the proxy uses, so
neither end carries a second interpretation of the format.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full data flow, storage model, and
trust boundaries.

## Repository layout

```text
packages/plugin/       Figma serializer, canvas renderer, and plugin UI
packages/extractor/    deterministic extraction and YAML context generation
packages/proxy/        Cloudflare Worker for AI writing, quotas, licensing, libraries
packages/cli/          spec-layer CLI: pulls a published library into a repo
apps/landing/          marketing site, policies, and public schemas
docs/                  product specs, plans, reviews, and writing guidance
```

Release history is in [CHANGELOG.md](CHANGELOG.md). Current product plans are in
the [feature backlog](docs/feature-backlog-2026-07.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening a change. Use only
synthetic or explicitly publishable fixtures, and never commit credentials,
private Figma URLs, customer data, or proprietary component exports.

## License

Spec Layer is available under the [MIT License](LICENSE).
