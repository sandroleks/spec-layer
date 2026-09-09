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
npx spec-layer setup --id lib_... --key sl_... --platform web
```

`--platform` says what you build; without it, `setup` reads the repository
root and writes a token file only when it finds a web signal.

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
`tools` and `skill` need 0.5.0 or later. `components/` in place of
`ai/components/`, `path` in place of `aiPath` in the manifest, and the
`outputs` block need 0.6.0 or later. `component-specs/` beside `tokens/`,
`componentSpecsDir`, cwd-relative manifest paths, and the `tokens/` directory
need 0.7.0 or later.

## Commands

| Command | What it does |
|---|---|
| `setup --id lib_... --key sl_... [--out DIR] [--platform P]... [selection]` | Writes `speclayer.json`, stores the key in `speclayer.local.json`, then pulls. The command the plugin copies. |
| `init --id lib_... [--out DIR] [--platform P]... [selection]` | Writes `speclayer.json` so later commands need no flags. No key, no network. |
| `pull [--id lib_...] [--key sl_...] [--platform P]... [selection]` | Fetches the library and writes it into `DIR` (default `.speclayer`). |
| `status [--id lib_...] [--key sl_...]` | Checks freshness without writing. Exits `2` when the local copy is behind. |
| `list` | Lists every artifact in the last pull, with its file path or `not written`. |
| `show foundation [--canonical]` | Prints the Foundation's DTCG document to stdout. |
| `show component NAME [--canonical]` | Prints one component's AI YAML to stdout. |
| `tools [--json]` | Lists every command with what it reaches, needs, and writes. |
| `skill [--install] [--agent HOST]... [--platform P] [--json]` | Prints a guide for a coding agent, adapted to this repository and the last pull; `--install` writes it where the agent reads instructions. |

`--api URL` overrides the API origin (default `https://api.spec-layer.com`).

## For a coding agent

The setup command is usually handed to a coding agent, and a bare command
tells the agent nothing about what it just wrote or how to read it. Two
local commands close that gap; neither needs a key or the network.

`spec-layer tools` lists every command with the facts an agent needs before
running one: whether it reaches the network, whether it needs the pull key,
what it writes, and what each exit code means. `--json` prints the same list
in a stable shape for machines.

`spec-layer skill` prints a guide to the pulled files, and `--install` writes
it where the agent reads project instructions:

```bash
npx spec-layer skill --install
```

`setup` names this command as the next step after a successful pull, and the
plugin's Publish screen has a **Copy for an AI agent** button that copies the
setup command already followed by it.

The guide is built from three things and nothing else:

- The tool list above.
- **What the last pull wrote.** Every component with its file path, every
  token collection with its modes and default, the token files, the
  `report.json` counts, and how many tokens landed as plain numbers because
  their Figma scopes state no unit. Before a pull the guide says so and names
  nothing.
- **What the repository root says about the codebase.** Detection reads only
  the top level of the working directory (`package.json` dependency names,
  build files, agent configuration directories) and names the file behind
  every conclusion. A signal it cannot find is reported as absent, never
  guessed. The platform decides which Figma `code_syntax` key the guide points
  at (`WEB`, `iOS`, `ANDROID`; Flutter has none) and which token pipeline
  advice it gives: Tailwind, Style Dictionary (with the `legacy` value form
  suggested when package.json declares a major version below 5), Swift,
  Kotlin or Compose, or Dart.

`--platform web|ios|android|flutter` overrides the detected target, which is
the way to get platform advice in a repository that carries no signal (a new
directory, a monorepo whose apps sit one level down). `--json` prints the
detection, the pull summary, and the install targets instead of the guide.

`--install` writes to every agent host detected at the root, or to the hosts
named with a repeatable `--agent`, or to `AGENTS.md` when nothing is detected
and nothing is named. Each run says which files it wrote, updated, or left
unchanged.

| Host | `--agent` | File |
|---|---|---|
| Claude Code | `claude` | `.claude/skills/spec-layer/SKILL.md` |
| Cursor | `cursor` | `.cursor/rules/spec-layer.mdc` |
| GitHub Copilot | `copilot` | `.github/instructions/spec-layer.instructions.md` |
| Windsurf | `windsurf` | `.windsurf/rules/spec-layer.md` |
| Gemini CLI | `gemini` | `GEMINI.md`, between `<!-- spec-layer:begin -->` and `<!-- spec-layer:end -->` |
| Anything that reads `AGENTS.md` | `agents-md` | `AGENTS.md`, between the same markers |

The dedicated files are replaced whole. The shared files (`AGENTS.md`,
`GEMINI.md`) are yours: only the marked block is replaced, and a file without
the markers gets the block appended. Re-run `skill --install` after a pull
that adds components or when the codebase changes stack. The written files
carry no key and are meant to be committed with the rest of the repository.

## Pulling part of a library

By default `pull` writes the Foundation and every documented component. When
your repo implements only some of them, narrow what lands in `component-specs/`:

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

The selection only decides which `component-specs/` files are written. `bundle.json`
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
  manifest.json              every artifact indexed by content hash and path, plus the selection, outputs, and componentSpecsDir
  tokens/                    the Foundation as Design Tokens Format Module 2025.10 files
    <collection>.<mode>.json one file per collection and mode, rooted at the collection name
    styles.typography.json   text styles as typography composites (when present)
    styles.effects.json      effect styles as shadow composites (when present)
    resolver.json            Design Tokens Resolver Module 2025.10: sets, modifiers, order
    spec-layer.meta.json     Figma ids, scopes, code syntax, publication, keyed by DTCG path
    report.json              what DTCG could not express, with reasons and stable ids
  outputs/
    web-css.map.json         DTCG path -> CSS custom property, where the name came from, and which file declares it
    web-css.report.json      what the CSS files could not express
component-specs/
  <name>.yaml                one brief per selected component, byte-identical to Copy for AI
tokens/
  index.css                  imports every file below, in resolver order
  <collection>.css           one file per single-mode collection, at :root
  <collection>.<mode>.css    one file per mode of a multi-mode collection; the default at :root
```

Point your agent at `component-specs/` and `.speclayer/tokens/`, and import
`tokens/index.css` from the platform's root stylesheet. The component YAML is
the same compact form the plugin's **Copy for AI** puts on your clipboard;
`bundle.json` additionally holds the full canonical artifacts if you need
them.

In `manifest.json`, an artifact the selection left unwritten has `"path":
null`. A manifest from CLI 0.1.0 has no `selection` field and means
everything was written.

Writes stage into `.speclayer.partial` and rename into place, so an
interrupted pull never leaves a half-written directory. `pull` refuses an
output directory that is the current directory, a parent of it, or an existing
non-empty directory it did not write, since the swap replaces that directory.

`component-specs/` and `tokens/` are written in place, not swapped. `pull`
owns exactly the files there that begin with its marker (the CSS header, or
the brief's opening `spec_layer:` lines): it replaces or removes those,
ignores dotfiles, and refuses to run when anything else is present. A
repository that already uses a path can set `componentSpecsDir` or
`outputs[].path`.

When nothing changed since the last pull with the same selection, `pull`
prints `Already up to date` and writes nothing. Every republish stamps a new
export id and time into the canonical artifacts, so `bundle.json` and
`manifest.json` change on each republish even when the content did not. The
`component-specs/` YAML files, the `.speclayer/tokens/` files, and the
`tokens/` CSS stay stable.

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
inferred from a name. Changing the `dtcg` block re-projects `tokens/` on the
next `pull` even when the library has not been republished.

Point Style Dictionary at `.speclayer/tokens/` and load the files
`resolver.json` names for the mode you are building. The metadata sidecar and
the report are not token files; exclude them from token globs.

## Token files for your code

`pull` also writes a `tokens/` directory at `outputs[].path`: one CSS file
per collection and mode plus `index.css`, one per platform output. The
directory is written only when that pull writes the Foundation; with
`--only components` it is left exactly as it was, and `list` shows it as
`not written`.

```css
/* Generated by spec-layer from library lib_..., foundation sha256:..., web/css/kebab.
   Do not edit. Change the design in Figma, republish, and run spec-layer pull. */

:root {
  /* Foundation */
  --foundation-colors-blue-500: #2e72d1;
  --foundation-spacing-200: 8px;
}
```

```css
/* Generated by spec-layer from library lib_..., foundation sha256:..., web/css/kebab.
   Do not edit. Change the design in Figma, republish, and run spec-layer pull. */

[data-theme="dark"] {
  /* Mapped Colors, Dark */
  --mapped-colors-surface-primary-default: var(--foundation-colors-blue-900);
}
```

`index.css` holds the header, then one comment and one import per file, in
resolver order, and no declarations of its own:

```css
/* Generated by spec-layer from library lib_..., foundation sha256:..., web/css/kebab.
   Do not edit. Change the design in Figma, republish, and run spec-layer pull. */

/* Foundation */
@import "./foundation.css";
/* Mapped Colors, Dark */
@import "./mapped-colors.dark.css";
```

A set, which has one mode by construction, writes one file named for the
collection alone, at `:root`. A collection with modes writes one file per
mode: the default mode's file sits at `:root`, every other mode's file under
`[data-theme="<mode>"]`. Aliases stay as `var()`. A number whose Figma scopes
state no unit stays a bare number. Nothing about a mode's name selects a
media query. To let the OS choose a theme, set that collection's selector to
`:root` under `modes` and import the mode's file yourself under `@media
(prefers-color-scheme: dark)`. The CLI never assumes that.

The directory is written **in place** at the path in `speclayer.json`,
outside the managed directory, so your bundler keeps watching it and the diff
shows up in review. Every file begins with a header naming the library and
the Foundation's content hash; `pull` owns exactly the files there that begin
with it, replacing or removing those, ignoring dotfiles, and refusing to run
when anything else is present. A `speclayer.json` written by CLI 0.6.0 names
a `.css` file at this path, and `pull` refuses it: set `path` to a directory
and delete the old file.

```json
{
  "platforms": ["web"],
  "outputs": [
    { "platform": "web", "format": "css", "path": "tokens", "case": "kebab" }
  ]
}
```

`setup` and `init` write this block from `--platform`, or from what they detect
at the repository root, so the path is always on record. `pull` writes every
entry; `"outputs": []` writes none. `case` chooses how derived names are
spelled: `kebab` (default), `camel`, `pascal`, `snake`, or `constant`. A name
the designer declared as `code_syntax` in Figma is used verbatim and never
re-cased. `.speclayer/outputs/web-css.map.json` records every emitted name,
whether it was declared or derived, and which file declares it; two tokens
that would share a name are both omitted and listed in `web-css.report.json`.

Two collections with modes share one attribute by default, which cannot be
right for both; the report says so, and `modes` declares a selector per
collection:

```json
{ "platform": "web", "format": "css", "path": "tokens",
  "modes": { "Density": "[data-density=\"{mode}\"]" } }
```

`root` and `modeSelector` override the defaults `:root` and
`[data-theme="{mode}"]`; `{mode}` and `{collection}` are replaced by slugs.
A repository that already builds tokens with Style Dictionary can keep reading
`.speclayer/tokens/`: the CSS files are a projection of the same record, not a
second source, so import one or the other.

Commit `.speclayer/`, `speclayer.json`, `component-specs/`, and the output
paths. A repository that would rather regenerate in CI ignores them and runs
`pull` there; `status` exits `2` when a pull is due.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success, or `status` found the local copy up to date. |
| `1` | Usage error, bad key or id, unknown component name, a network or server failure, or a file `skill --install` could not write. |
| `2` | `status` only: the local copy is behind, or no local pull exists yet. |

`status` is safe in CI: it writes nothing, and exit `2` is the signal to run
`pull`.

## Requirements

Node 22 or newer. Publishing one Figma file is free; Pro publishes up to ten.
Pulling needs only the library id and pull key.
