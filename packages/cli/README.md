# spec-layer

Pull design-system context published by the [Spec Layer](https://spec-layer.com)
Figma plugin into your repository, so a coding agent reads the same component
and token facts your designers see in Figma.

This CLI is delivery only. It never talks to Figma, never re-derives anything,
and has zero runtime dependencies: it fetches the bundle the plugin published
and writes it to disk.

## Quick start

After publishing a library from the plugin's Library screen, it shows a setup
command. Run it in your repository:

```bash
SPEC_LAYER_KEY=sl_... npx spec-layer pull --id lib_...
```

That writes `.speclayer/` and is enough on its own. To avoid repeating the
library id, record it once:

```bash
npx spec-layer init --id lib_...
```

## Commands

| Command | What it does |
|---|---|
| `init --id lib_... [--out DIR]` | Writes `speclayer.json` so later commands need no flags. |
| `pull [--id lib_...] [--key sl_...]` | Fetches the library and writes it into `DIR` (default `.speclayer`). |
| `status [--id lib_...] [--key sl_...]` | Checks freshness without writing. Exits `2` when the local copy is behind. |

`--api URL` overrides the API origin (default `https://api.spec-layer.com`).

## The pull key

Every command reads the pull key from `SPEC_LAYER_KEY` or `--key`. It is never
written to disk, and `speclayer.json` never contains it. Treat it as a secret:
it grants read access to the published bundle. If it leaks, rotate it from the
plugin's Library screen, which invalidates the old key immediately.

## What `pull` writes

```text
.speclayer/
  bundle.json              the published bundle, verbatim
  manifest.json            every artifact indexed by content hash and ai path
  ai/foundation.yaml       tokens, styles, and modes (when the library has a Foundation)
  ai/components/<name>.yaml one file per documented component
```

Point your agent at `.speclayer/ai/`. The YAML there is the same compact form
the plugin's **Copy for AI** puts on your clipboard; `bundle.json` additionally
holds the full canonical artifacts if you need them.

Writes stage into `.speclayer.partial` and rename into place, so an
interrupted pull never leaves a half-written directory.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success, or `status` found the local copy up to date. |
| `1` | Usage error, bad key or id, or a network or server failure. |
| `2` | `status` only: the local copy is behind, or no local pull exists yet. |

`status` is safe in CI: it writes nothing, and exit `2` is the signal to run
`pull`.

## Requirements

Node 22 or newer. Publishing requires a Spec Layer Pro license; pulling does
not.
