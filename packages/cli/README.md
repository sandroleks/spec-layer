# spec-layer

Pull design-system context published by the [Spec Layer](https://spec-layer.com)
Figma plugin into your repository, so a coding agent reads the same component
and token facts your designers see in Figma.

This CLI is delivery only. It never talks to Figma, never re-derives anything,
and has zero runtime dependencies: it fetches the bundle the plugin published
and writes it to disk.

## Quick start

After publishing a library from the plugin's Library screen, it shows a setup
command. Run it once in your repository:

```bash
npx spec-layer setup --id lib_... --key sl_...
```

That records the library id, stores the key in a gitignored
`speclayer.local.json`, and writes `.speclayer/`. Every later command needs no
flags at all:

```bash
npx spec-layer pull
```

`init` still writes the config without a key or a network call, for a repo
that supplies the key from the environment instead.

## Installing, or not

`npx` needs no install step: it fetches the package and runs it. That is the
right choice for trying this once, and for a repo that pulls by hand.

Two cases want a real install instead. On a cold cache `npx` has to fetch the
package first, and confirming that is a prompt you do not want in an
unattended run. `--yes` answers it up front:

```bash
npx --yes spec-layer status
```

And a repo that pulls on a schedule should pin the version rather than
resolving the latest release on every run, so a CLI update never changes a
build you did not touch:

```bash
npm install --save-dev spec-layer
```

`npx spec-layer` then runs the pinned local copy, no `--yes` needed. Pinning
also keeps `.speclayer/manifest.json` on one format: 0.1.0 wrote no
`selection` field, and 0.2.0 onward does. `setup` needs 0.3.0 or later; earlier
versions have no such command, so the setup command the plugin copies fails
against them. The Foundation landing under `tokens/` as Design Tokens Format
Module 2025.10 files, rather than `ai/foundation.yaml`, needs 0.4.0 or later.

## Commands

| Command | What it does |
|---|---|
| `setup --id lib_... --key sl_... [--out DIR] [selection]` | Writes `speclayer.json`, stores the key in `speclayer.local.json`, then pulls. The command the plugin copies. |
| `init --id lib_... [--out DIR] [selection]` | Writes `speclayer.json` so later commands need no flags. No key, no network. |
| `pull [--id lib_...] [--key sl_...] [selection]` | Fetches the library and writes it into `DIR` (default `.speclayer`). |
| `status [--id lib_...] [--key sl_...]` | Checks freshness without writing. Exits `2` when the local copy is behind. |
| `list` | Lists every artifact in the last pull, with its file path or `not written`. |
| `show foundation [--canonical]` | Prints the Foundation's DTCG document to stdout. |
| `show component NAME [--canonical]` | Prints one component's AI YAML to stdout. |

`--api URL` overrides the API origin (default `https://api.spec-layer.com`).

## Pulling part of a library

By default `pull` writes the Foundation and every documented component. When
your repo implements only some of them, narrow what lands in `ai/`:

```bash
npx spec-layer pull --only foundation            # tokens and styles, no components
npx spec-layer pull --only components            # components, no foundation
npx spec-layer pull --component Button --component "Text field"
```

Names match by slug, so `button`, `Button`, and `icon-button` all find the
component they name. A name that matches nothing is an error listing what the
library holds, and nothing is written.

Record a selection once with `init` and plain `pull` reuses it:

```bash
npx spec-layer init --id lib_... --component Button --component Card
```

That stores an `include` block in `speclayer.json`:

```json
{
  "libraryId": "lib_...",
  "outDir": ".speclayer",
  "include": { "foundation": true, "components": ["Button", "Card"] }
}
```

Selection flags on `pull` replace the stored selection for that run; they are
never merged with it.

The selection only decides which `ai/` files are written. `bundle.json`
always holds the whole library, so `list` and `show` can answer for any
artifact, written or not, and `status` compares one hash.

## Reading one artifact

`show` prints exactly one artifact and nothing else, so it pipes cleanly:

```bash
npx spec-layer show component Button            # the compact AI YAML
npx spec-layer show foundation --canonical      # the canonical v5 JSON artifact
```

Both read the last pull from disk and need no key. When two components share a
name, `show` refuses to guess and points you at `list`.

## The pull key

`spec-layer setup` stores the key in `speclayer.local.json` next to
`speclayer.json` and makes sure git ignores it before writing it. Every later
command in that directory needs no key. On POSIX systems the file is written
at mode `0600`; on Windows there is no equivalent permission bit, so it
inherits whatever the directory allows.

Commands that talk to the server resolve the key in this order:

1. `--key sl_...`
2. `SPEC_LAYER_KEY` in the environment
3. `speclayer.local.json`, when it was issued for the same library

Environment sits above the file so CI can supply a key without touching the
working tree. A stored key issued for a different library is ignored, and the
CLI says which library it belongs to rather than letting the server answer 401.

Treat the key as a secret: it grants read access to the published bundle.
`speclayer.local.json` is gitignored, never printed by any command, and never
copied into `speclayer.json`, `bundle.json`, `manifest.json`, or anything under
the output directory. If it leaks, rotate it from the plugin's Library screen,
then run the new setup command. The old key stops working once the change
propagates, which can take up to about a minute.

Re-running `setup` replaces the stored key and keeps the rest of your setup:
with no `--out` and no selection flag it preserves the output directory and the
`include` block already in `speclayer.json` rather than resetting them to the
defaults. Pass `--out` or a selection flag to change them. (`init` still
overwrites `speclayer.json` outright, which is what a first run is for.)

Outside a git working tree, the key is still stored and the CLI says it left
`.gitignore` alone. Inside one, `setup` refuses to write the key whenever it
cannot confirm the file will be ignored, and says what to do instead. Three
cases refuse:

- `.gitignore` cannot be written.
- git itself could not be run, anywhere inside a working tree.
- the entry is in `.gitignore`, but git still does not ignore the file. That
  almost always means `speclayer.local.json` is already tracked, and the CLI
  names `git rm --cached speclayer.local.json` as the way out.

git decides in every case. The entry sitting in `.gitignore` is not taken as
proof, because `git check-ignore` does not report a tracked file as ignored no
matter what the ignore rules say.

## What `pull` writes

```text
.speclayer/
  bundle.json                the published bundle, verbatim
  manifest.json               every artifact indexed by content hash and path, plus the selection
  tokens/                    the Foundation as Design Tokens Format Module 2025.10 files
    <collection>.<mode>.json one file per collection and mode, rooted at the collection name
    styles.typography.json   text styles as typography composites (when present)
    styles.effects.json      effect styles as shadow composites (when present)
    resolver.json            Design Tokens Resolver Module 2025.10: sets, modifiers, order
    spec-layer.meta.json     Figma ids, scopes, code syntax, publication, keyed by DTCG path
    report.json              what DTCG could not express, with reasons and stable ids
  ai/components/<name>.yaml  one file per selected component
```

Point your agent at `.speclayer/ai/` and `.speclayer/tokens/`. The component
YAML is the same compact form the plugin's **Copy for AI** puts on your
clipboard; `bundle.json` additionally holds the full canonical artifacts if
you need them.

In `manifest.json`, an artifact the selection left unwritten has `"aiPath":
null`. A manifest from CLI 0.1.0 has no `selection` field and means
everything was written.

Writes stage into `.speclayer.partial` and rename into place, so an
interrupted pull never leaves a half-written directory. `pull` refuses an
output directory that is the current directory, a parent of it, or an existing
non-empty directory it did not write, since the swap replaces that directory.

When nothing changed since the last pull with the same selection, `pull`
prints `Already up to date` and writes nothing. Every republish stamps a new
export id and time into the canonical artifacts, so `bundle.json` and
`manifest.json` change on each republish even when the content did not. The
`ai/` YAML files, the `tokens/` files, and the content hashes stay stable.

## Configuring the token output

`speclayer.json` may carry a `dtcg` block:

    {
      "libraryId": "lib_...",
      "outDir": ".speclayer",
      "dtcg": {
        "values": "standard",
        "units": { "Foundation/spacing/*": "px", "Foundation/radius/*": "px" }
      }
    }

`values` is `standard` (the 2025.10 object forms, the default) or `legacy`
(the string forms Style Dictionary 4 and Tokens Studio read today). `units`
promotes a number whose Figma scopes state no unit to a dimension. Keys are a
collection name, a slash, and a glob over the variable name. An override that
contradicts a stated scope is ignored and listed in `report.json`. Nothing is
inferred from a name.

Point Style Dictionary at `.speclayer/tokens/` and load the files
`resolver.json` names for the mode you are building. The metadata sidecar and
the report are not token files; exclude them from token globs.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success, or `status` found the local copy up to date. |
| `1` | Usage error, bad key or id, unknown component name, or a network or server failure. |
| `2` | `status` only: the local copy is behind, or no local pull exists yet. |

`status` is safe in CI: it writes nothing, and exit `2` is the signal to run
`pull`.

## Requirements

Node 22 or newer. Publishing requires a Spec Layer Pro license; pulling does
not.
