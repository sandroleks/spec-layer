# Granular pull and read for the spec-layer CLI

Date: 2026-09-02
Status: approved design, implemented alongside this document
Builds on: `2026-09-01-library-publish-cli-design.md`

## Problem

`spec-layer pull` is all or nothing. A library with eighty documented
components lands eighty files under `.speclayer/ai/components/`, and a repo
that only implements three of them has no way to say so. There is also no way
to read one artifact without guessing its slug or opening a multi-megabyte
`bundle.json`, which is exactly the situation a coding agent is in when it
wants "the Button context" and nothing else.

The CLI stays a delivery tool. It never talks to Figma, and it never
re-derives, re-validates, or re-projects v5 output. Granularity has to be
selection over what the plugin already published, not new extraction.

## Decision summary

- **The unit of granularity is a bundle entry.** The Foundation, or one
  documented component. Selection picks whole entries and copies them
  verbatim.
- **No slicing below an entry.** A per-collection Foundation slice is not
  honest without the alias-closure logic that `copyFoundationBriefForScope`
  runs inside the extractor. Doing that in the CLI would be a second
  interpretation of v5, which the invariants forbid. The path to
  collection-level pulls is for the plugin to publish per-collection entries
  in a later bundle version; the CLI would then select them like any other
  entry. That is out of scope here and recorded as follow-up work.
- **`pull` always mirrors the whole bundle into `bundle.json`.** The bundle is
  one unit with one freshness story, and `status` compares one hash.
  Selection controls only which `ai/` files are written, so the agent-facing
  directory is small while `show` and `list` can still answer for anything the
  library contains.
- **Selection is persistent and overridable.** `speclayer.json` gains an
  optional `include` block; `pull` flags override it for one run. CI runs
  `pull` with no flags and reproduces the committed selection.
- **Two read commands, local only.** `list` prints the inventory from the
  manifest. `show` prints one artifact's AI YAML, or its canonical JSON with
  `--canonical`, to stdout from `bundle.json`. Neither touches the network;
  `status` already says when the local copy is behind.

## Selection model

```ts
interface Selection {
  foundation: boolean;          // write ai/foundation.yaml
  components: string[] | null;  // null = every component; [] = none
}
```

Default: `{ foundation: true, components: null }`, which is today's behavior.

Flags on `pull` (and `init`, which persists them):

| Flag | Effect |
|---|---|
| `--only foundation` | `{ foundation: true, components: [] }` |
| `--only components` | `foundation: false`; components as otherwise chosen |
| `--component NAME` (repeatable) | `components: [NAME, ...]` |

`--only foundation` together with `--component` is a contradiction and is
rejected with a usage error. Any other `--only` value is a usage error.

Config form in `speclayer.json`:

```json
{
  "libraryId": "lib_...",
  "outDir": ".speclayer",
  "include": { "foundation": true, "components": ["Button", "Text field"] }
}
```

`include` is optional. Inside it, `foundation` defaults to `true` and a
missing `components` means all. A malformed `include` (wrong types) is
rejected with the same "not valid" message the rest of the config uses.

Precedence: any selection flag on the command line replaces the config
selection entirely for that run. Flags and config are never merged, so a run
is always explainable from one source.

### Name matching

A component is selected when `slugify(input) === slugify(component.name)`,
using the slug function `files.ts` already uses for file names. So `button`
matches `Button`, and `icon-button` matches `Icon Button`. A name that
matches nothing is an error that lists the component names the bundle does
contain, and nothing is written. A filter that silently matched nothing
would let `pull` report success for work it did not do.

Duplicate names select every component carrying that name, mirroring how the
writer already dedupes their slugs.

## What `pull` writes

Unchanged: `bundle.json` verbatim, atomic staging through `<outDir>.partial`,
deterministic bytes for an unchanged bundle.

Changed:

- `ai/foundation.yaml` is written only when `selection.foundation` is true
  and the bundle has a Foundation.
- `ai/components/<slug>.yaml` is written only for selected components.
- `manifest.json` lists **every** artifact in the bundle, so `list` can show
  what exists as well as what was written. `aiPath` is `null` for an artifact
  that was not written. The manifest also records the effective `selection`.

A manifest written by CLI 0.1.0 has no `selection` field and every `aiPath`
is a string; readers treat that as the default selection.

The summary line names the selection honestly, for example
`Pulled DS: foundation + 2 of 14 components (published ...)` or
`Pulled DS: 14 components, no foundation (published ...)`.

## `list`

```text
spec-layer list
```

Reads `manifest.json` under the resolved output directory. Prints the library
id and publish time, then one line per artifact: kind, name, the `ai/` path
or `not written`, and the content hash. Exit `1` with
`No local pull found. Run spec-layer pull.` when there is no manifest.

## `show`

```text
spec-layer show foundation [--canonical]
spec-layer show component NAME [--canonical]
```

Reads `bundle.json` under the resolved output directory, finds the entry, and
writes exactly its `ai` YAML to stdout. With `--canonical` it writes the
canonical artifact as two-space-indented JSON instead. Nothing else goes to
stdout, so the output pipes cleanly. Name matching uses the same slug rule as
selection. When a name matches more than one component, `show` prints an
error naming the count and asks for `list`; it never picks one silently.

Errors, all exit `1` on stderr: no local pull, no Foundation in this library,
component not found (listing available names), and an unreadable
`bundle.json`.

`show` and `list` do not need a key or a library id. They resolve only the
output directory, from `--out`, then `speclayer.json`, then the default.

## Error handling

Every new failure names its cause and the fix, as plain text, exit `1`. No
stack traces. Contradictory flags and unknown `--only` values are usage
errors; the message states the accepted forms.

## Testing

Vitest, temp filesystem, no network (mocked `fetch`), synthetic fixture bundle
only.

- Config: `include` parsing, malformed `include` rejected, flag selection
  replaces config selection, default when neither present.
- Selection: each flag form, the contradiction error, unknown `--only`, slug
  matching, unknown name error listing available names, duplicate names.
- Files: filtered write produces only the selected `ai/` files, manifest lists
  all artifacts with `aiPath: null` for unwritten ones and carries the
  selection, unchanged bundle still writes identical bytes.
- Commands: `pull --only foundation`, `pull --component`, `pull --only
  components`, summary line wording, `list` output and missing-pull error,
  `show foundation`, `show component` by slug, `--canonical`, not found,
  ambiguous name, no Foundation.

## Docs to update alongside implementation

- `packages/cli/README.md`: commands table, selection, `list`, `show`.
- `CHANGELOG.md`.
- `ARCHITECTURE.md` CLI section.
- `docs/specs/foundation-v5-status.md`: note collection-level entries as the
  bundle-side follow-up.

## Explicitly out of scope

- Per-collection or per-style Foundation slices (needs a bundle-side change
  in the plugin, see above).
- Remote `show` or `list` without a prior pull.
- Glob or regex component filters.
- `validate`, `diff`, `normalize` (backlog item 3, still open).
