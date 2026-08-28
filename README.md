# Spec Layer

[![CI](https://github.com/sandroleks/spec-layer/actions/workflows/ci.yml/badge.svg)](https://github.com/sandroleks/spec-layer/actions/workflows/ci.yml)
[![Figma Community](https://img.shields.io/badge/Figma-Community-f24e1e?logo=figma&logoColor=white)](https://www.figma.com/community/plugin/1652104411578396548)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-43853d.svg)](https://nodejs.org)

A Figma plugin that turns your components into spec and guideline frames, right on the canvas. Measurements, states, anatomy, tokens, and AI-written usage docs in one click.

**[Open in Figma](https://www.figma.com/community/plugin/1652104411578396548)** · [speclayer-landing.pages.dev](https://speclayer-landing.pages.dev)

## Contents

- [What it generates](#what-it-generates)
- [Free and Pro](#free-and-pro)
- [What leaves your Figma file](#what-leaves-your-figma-file)
- [Install](#install)
- [How it works](#how-it-works)
- [Development](#development)
- [Repository layout](#repository-layout)
- [Content safety](#content-safety)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## What it generates

Select a component or component set, choose the sections you want, and the plugin builds a documentation frame next to it.

- **Measurements.** Spacing, padding, and sizing annotated on the component, with token names where they resolve.
- **States matrix.** Every variant and state laid out together in one grid.
- **Anatomy.** Each part labeled, with a description of what it does.
- **Tokens and theming.** Token tables, plus your brand colors, fonts, and logo on the frame.
- **Usage docs, drafted by AI.** Overview, do's and don'ts, and interaction notes.
- **Library.** Tracks the components you have documented. When a source component changes, its doc is flagged so you can update it in a click.

Everything except the AI prose is deterministic: it reads your file and derives the result, with no model involved. Any document, or a whole variable collection, can also be copied as a compact YAML brief for an AI coding agent to read. Foundation briefs retain the canonical v5 content hash and implementation facts without pasting the audit artifact's repeated IDs, envelopes, and diagnostic prose into the prompt.

## Free and Pro

Every spec feature is free, with no account needed.

| | Free | Pro |
|---|---|---|
| Measurements, states, anatomy, tokens, theming | Yes | Yes |
| On-canvas doc frames and Copy for AI | Yes | Yes |
| AI writing | 20 free uses in your first month, then 10 a month | No fixed monthly cap for normal individual use |
| Priority support | | Yes |

Pro is $7.99/month, or a yearly plan at two months free. Buy it on the [landing page](https://speclayer-landing.pages.dev) and your license key arrives by email. Paste it into the plugin's License page. One key covers your individual use across your files. Payments are handled by Lemon Squeezy as merchant of record.

Some honest detail on the numbers:

- One generation is one successful upstream AI response. Failed upstream calls never count.
- Retrying the same unchanged request within 24 hours hits the idempotency cache
  and does not consume another generation.
- Deterministic sections never consume a generation.
- Pro's no-fixed-cap allowance is for normal individual use. Automated, shared,
  or exceptionally high-volume usage may be limited under the fair-use policy,
  and you get contacted before anything is limited.

## What leaves your Figma file

The deterministic sections run entirely inside the plugin. Nothing leaves your file.

When you generate AI prose, a structured summary of the selected component and,
when it fits the export limits, a rendered image are sent to the Spec Layer
proxy and from there to Anthropic. If image export fails or is too large, the
request falls back to text only. Generated responses are cached for 24 hours
under a content-derived key so an immediate retry does not send the same
request twice.

You do not supply an API key. The plugin keeps an activated license in Figma's
local plugin storage; the proxy sends it to Lemon Squeezy for validation and
uses SHA-256 digests, not raw license keys, for its own cache keys, quota
identities, and logs. See [apps/landing/privacy.html](apps/landing/privacy.html)
and [apps/landing/security.html](apps/landing/security.html) for the published
policies, and [SECURITY.md](SECURITY.md) to report a vulnerability.

## Install

For normal use, install from the [Figma Community listing](https://www.figma.com/community/plugin/1652104411578396548).

To run a local build:

```bash
npm ci
npm run build:plugin
```

Then in Figma desktop choose **Plugins → Development → Import plugin from manifest** and select `packages/plugin/manifest.json`.

## How it works

```text
Figma node
  → plugin serializer (main thread)
  → IntermediateSpec
  → deterministic derivation: anatomy, properties, variants, states, tokens
  → canvas doc frame, or a YAML brief on the clipboard
```

The plugin owns all Figma API access. `@spec-layer/extractor` receives plain JSON and never touches the Figma runtime, which keeps extraction testable against fixtures. AI prose is the one networked path: it routes through `@spec-layer/proxy`, a Cloudflare Worker that holds the Anthropic key, enforces free-tier quotas in a Durable Object, and validates Pro licenses against Lemon Squeezy. All quota and license authority is server-side, so the plugin only displays the state it is told.

Generated frames store their source node id and a content hash, which is what makes drift detection and one-click updates possible.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full data flow and trust boundaries.

## Development

Requires Node.js 22 or newer, npm 10 or newer, and Figma desktop for plugin development.

```bash
npm ci
npm run check           # lint, typecheck, tests, plugin build, sandbox and proxy bundle checks
```

Individual steps:

```bash
npm run lint            # ESLint
npm run typecheck       # all TypeScript workspaces
npm test                # Vitest suite
npm run test:coverage   # with coverage thresholds
npm run build:plugin    # Figma plugin bundle
npm run check:proxy-dry-run # bundle and validate the Worker without deploying
npm run audit           # full dependency audit, including development tools
```

Builds from source use the production proxy at `https://api.spec-layer.com`.
The plugin source and manifest network allowlist must remain aligned.

CI runs the same stages as `npm run check`, adds coverage thresholds, and audits
the full dependency tree on pushes to `main` and pull requests. The proxy check
uses Wrangler's `deploy --dry-run`; it builds and validates the Worker but never
uploads it.

## Repository layout

```text
packages/plugin/       Figma plugin: main-thread serializer and iframe UI
packages/extractor/    deterministic extraction and YAML brief rendering
packages/proxy/        Cloudflare Worker: AI relay, quota, licensing
apps/landing/          static marketing and policy pages
docs/                  specs, plans, reviews, voice and prose guides
```

Release history is in [CHANGELOG.md](CHANGELOG.md).

## Content safety

Do not commit API keys, license keys, private Figma URLs, customer data, or
proprietary component exports. A pre-commit hook in `.githooks/` scans for
common key formats, but it is a backstop, not a guarantee.

Bug reports and test fixtures must use synthetic or explicitly publishable data.

## Roadmap

- Token display mode: raw value, variable name, or Figma `codeSyntax`.
- Configurable units (px / rem).
- Drift detection surfaces beyond the in-Figma badge, using the committed content hash.

Not planned: remote MCP or agentic vision enrichment. See [docs/feature-backlog-2026-07.md](docs/feature-backlog-2026-07.md) for the full backlog and [docs/strategy/](docs/strategy/) for positioning notes.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening a change. Use GitHub private vulnerability reporting for security issues.

## License

MIT. See [LICENSE](LICENSE).
