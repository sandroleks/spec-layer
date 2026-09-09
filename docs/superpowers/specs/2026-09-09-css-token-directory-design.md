# Visible outputs: a `tokens/` directory of CSS per collection and mode, and `component-specs/` beside it

Date: 2026-09-09. Status: approved design, awaiting a plan.

Supersedes section 5.1 of
`docs/superpowers/specs/2026-09-08-repository-delivery-design.md` (the
single-file structure) and section 3.1 (component briefs inside the managed
directory), and amends sections 3, 4.1, and 4.2 of that document. Everything
else in it stands: values, naming, selectors, the map and report, the
in-place rule, and the platform and format registry.

## 1. Problem

CLI 0.6.0 is published (npm, 2026-09-09 12:45 UTC). A pull with the web
platform writes the record under `.speclayer/` and one deliverable,
`spec-layer/tokens.css`, holding every collection and every mode in two
selector blocks. A real pull (`Test123`, library `lib_4729c206dd210f9ee3ae9620`,
plugin 5.0.0) produced 19 files:

| Where | Files | What they are |
|---|---|---|
| `.speclayer/tokens/` | 10 | the DTCG record: one JSON per collection and mode, resolver, meta, report |
| `.speclayer/` root, `components/`, `outputs/` | 5 | bundle, manifest, one component brief, CSS name map and report |
| `spec-layer/tokens.css` | 1 | the only deliverable, 515 lines |
| repository root | 3 | `speclayer.json`, `speclayer.local.json`, `AGENTS.md` |

The bundle, the manifest, the DTCG record, and the output maps are not the
problem. A token pipeline reads them by path, and they belong in the hidden
directory. Two things are in the wrong place. The CSS is a second visible
folder named `spec-layer/`, one file, with no way to import one collection or
one mode without the rest. The component briefs sit inside `.speclayer/`,
hidden from IDE trees and review, although a developer and a coding agent
read them the way they read the CSS: as the delivered description of the
design system, not as a record.

The reference the team measured against is a Supernova CSS export of the same
Figma file (`/Users/sandrolek/Downloads/result`): a folder, `index.css`, and
`@import` per part. Its content is wrong in the ways the 2026-09-08 design
already catalogues (sets repeated under every theme, `px` fabricated onto font
weights, a `font` shorthand that drops letter spacing and text case, two
styles flattened onto one name). Its shape is right, and it is the shape a
developer expects from a token package.

## 2. Decision

Two visible directories beside each other, and one hidden record.

The `web` / `css` output writes a **directory**, not a file. The default
path is `tokens/` at the repository root. `spec-layer/` is no longer created.
The component briefs move out of the managed directory into
**`component-specs/`**, also at the repository root by default, written by the same
rules as `tokens/`.

```text
tokens/
  index.css                   imports every file below, in resolver order
  foundation.css              :root
  mapped-density.css          :root
  mapped-radius.css           :root
  effect-styles.css           :root
  typography-styles.css       :root
  semantic-colors.light.css   :root, the modifier's default context
  semantic-colors.dark.css    [data-theme="dark"]
component-specs/
  buttonprimary.yaml          one brief per selected component, byte-identical to Copy for AI
.speclayer/
  bundle.json                 unchanged
  manifest.json               paths now relative to the working directory, see section 7
  tokens/                     unchanged DTCG record
  outputs/
    web-css.map.json          DTCG path -> name, provenance, and now the file that declares it
    web-css.report.json       unchanged
```

One CSS file per resolver source. A set, which by construction has one mode,
is named by its collection alone. A modifier writes one file per context. The
values, selectors, names, `case`, `root`, `modeSelector`, and `modes` options
are exactly those of the 2026-09-08 design; only where declarations land
changes.

The component files are unchanged in name and content: the slug rule of
`componentSlugs` and the YAML from the bundle's `ai` field. Only their
directory moves. `.speclayer/` keeps what a machine reads by path and a
person never opens: the bundle, the manifest, the DTCG JSON, and the output
maps and reports.

Why per mode rather than per collection: a team that wants the operating
system to choose can set the dark file's selector to `:root` through `modes`
and import that file under `@media (prefers-color-scheme: dark)` in its own
stylesheet. With both modes in one file that is impossible. Nothing about a
mode's name still selects a media query; the CLI writes the files, the team
writes the condition.

## 3. File names

Names are derived in the extractor, beside the CSS, so the map can state them
and the CLI never invents one.

- A **set** `S` in `resolver.sets` writes `<slug(S)>.css`, where `slug` is the
  rule the DTCG projection uses for its own file names: lowercase, every run of
  characters outside `a-z0-9` becomes `-`, leading and trailing `-` removed,
  `unnamed` when nothing is left. `Foundation` gives `foundation.css`;
  `Effect styles` gives `effect-styles.css`.
- A **modifier** `M` with context `C` writes `<slug(M)>.<mode>.css`, where
  `<mode>` is the mode part of the context's DTCG file name (the same slug the
  `{mode}` selector placeholder already uses). `semantic-colors.dark.json`
  gives `semantic-colors.dark.css`.
- `index.css` is reserved. A name that is already taken, or reserved, gets
  `-2`, `-3`, and so on, in `resolutionOrder`, the same rule `fileNameFor`
  applies to the JSON record. Two collections whose names slug alike are the
  only way to reach it.
- A source whose every declaration was omitted (all reported) writes **no
  file** and is not imported. The report already says why each token is
  absent; an empty block would say nothing.

File order everywhere (the `files` record, `index.css`, the golden fixture)
is the order `sourcesOf` yields: `resolutionOrder`, and within a modifier its
contexts in the resolver's order. It is stable across runs and machines
because the resolver is.

## 4. File contents

Every file begins with the header from the 2026-09-08 design, unchanged:
library id, Foundation `content_hash`, `platform/format/case`, and the
instruction not to edit. The CLI's overwrite check reads that prefix, so it
applies per file.

A part file holds one selector block with one collection comment:

```css
/* Generated by spec-layer from library lib_..., foundation sha256:..., web/css/kebab.
   Do not edit. Change the design in Figma, republish, and run spec-layer pull. */

[data-theme="dark"] {
  /* Semantic Colors, Dark */
  --color-surface-primary-default: var(--colors-blue-900);
}
```

Two modifiers whose contexts resolve to the same selector no longer share a
block; each has its own file with its own block under that selector, which
cascades identically. The `mode_selector_shared` report is unchanged.

`index.css` holds the header, then one comment and one import per part file,
and no declarations:

```css
/* Generated by spec-layer ... */

/* Semantic Colors, Light */
@import "./semantic-colors.light.css";
/* Semantic Colors, Dark */
@import "./semantic-colors.dark.css";
/* Foundation */
@import "./foundation.css";
```

Plain string imports: browsers, Vite, webpack's css-loader, Lightning CSS,
and postcss-import all resolve them. No `url()`, no `layer()`, no media
condition.

A `var()` reference across files is valid CSS once `index.css` is imported.
The fixed-point pruning that guarantees every reference has a declaration is
unchanged and still runs over the whole export, not per file.

## 5. Writing a visible directory

One rule serves both `tokens/` and `component-specs/`. A **visible directory** is
a path relative to the working directory, a **marker** is the byte prefix
every file we write there begins with, and the CLI owns exactly the files
that carry the marker.

| Directory | Config | Default | Marker |
|---|---|---|---|
| tokens | `outputs[].path` | `tokens` | `/* Generated by spec-layer` (`CSS_HEADER_PREFIX`) |
| component specs | `componentSpecsDir` | `component-specs` | `spec_layer:\n  kind: component` |

The component marker is the first two lines the extractor's YAML already
emits, so the files stay byte-identical to the plugin's Copy for AI and no
comment is prepended.

Before anything is staged, `pull` refuses, naming the path and the fix, when
a visible directory:

- is outside the repository, is the working directory itself, is inside
  `outDir`, or is the same as, or nested in, another visible directory;
- ends in `.css` (tokens only): "0.6.0 wrote one file there. Set `path` to a
  directory, for example `tokens`, delete the old file, and pull again.";
- exists and is not a directory;
- holds any entry, other than a dotfile, that is not a regular file beginning
  with its marker: "`component-specs/` holds files spec-layer did not write.
  Set `componentSpecsDir` in `speclayer.json` to another path, or move
  them." The tokens directory names `outputs[].path` instead. Dotfiles
  (`.DS_Store`, `.gitkeep`) are ignored, never read, never removed.

The marker comparison tolerates `\r\n` where the marker has `\n`. A Git for
Windows checkout with `core.autocrlf` rewrites committed briefs with CRLF
line endings, and the CLI must still recognise its own files.

The name is deliberately not `components/`, which most front-end repositories
already use for their own source. A repository that does have a
`component-specs/` of its own is refused, and the message names the config key.

Then, after the record has swapped into place, for each visible directory:

1. Every file is written to `<name>.partial` and renamed over its target.
2. For tokens, `index.css` is written the same way, **last**, so a reader
   following an import never finds a missing file.
3. Every regular non-dot file in the directory that carries the marker and
   was not written by this pull is removed. A renamed collection, a dropped
   mode, a component removed from the library, or one dropped from
   `include.components` would otherwise leave a stale file. Files without
   the marker cannot be present, because the check above refused them.

The 2026-09-08 sentence "never deleted, only replaced" becomes: a file the
current pull writes is replaced in place; a Spec Layer file it no longer
writes is removed; a file that is not ours is never touched, and its presence
stops the pull.

Selection keeps its meaning. `include.components` still decides which briefs
are written; with stale removal, narrowing it also removes the files it no
longer names. `--only foundation` writes nothing into `component-specs/` and
removes the marked files there, since the manifest then records every
component as not written.

## 6. Configuration and the move from 0.6.0

```json
{
  "libraryId": "lib_...",
  "outDir": ".speclayer",
  "componentSpecsDir": "component-specs",
  "platforms": ["web"],
  "outputs": [
    { "platform": "web", "format": "css", "path": "tokens", "case": "kebab" }
  ]
}
```

`componentSpecsDir` is a new top-level key beside `outDir`, a string path
relative to the working directory, default `component-specs`. `setup` and `init`
write it explicitly, as they write `outDir`, so the path is on record. There
is no flag for it; it is edited in the file.

`setup` and `init` write `"path": "tokens"`. The registry default changes
from `spec-layer/tokens.css` to `tokens`. A `speclayer.json` written by 0.6.0
carries `spec-layer/tokens.css` and no `componentSpecsDir`; `pull` refuses the
`.css` path with the message in section 5, and does not edit the config or
delete the old file. Both are the team's, and the refusal names both steps.
The missing `componentSpecsDir` takes its default, and the first 0.7.0 pull
writes `component-specs/` while its swap of `.speclayer/` drops the old
`.speclayer/components/`, so no stale copy remains there. `status` is
unaffected: it compares the bundle hash only.

Changing `componentSpecsDir` or an `outputs[].path` later leaves the
previous directory in place, since `pull` only ever removes files inside the
directories it writes. When the previous manifest names a different path
that still exists, `pull` prints one line: "The previous pull wrote `<old>/`;
this one wrote `<new>/`. Delete `<old>/` if nothing else uses it." It does
not delete the old directory; the files carry the marker, but the decision to
remove a directory from the team's tree is the team's.

This is CLI **0.7.0**. The default path and the config's meaning changed, and
the published 0.6.0 is a day old.

## 7. The record

`web-css.map.json` entries gain `file`, the part file that declares the name:

```json
"Semantic Colors.surface.primary.default": {
  "name": "--color-surface-primary-default",
  "source": "derived",
  "file": "semantic-colors.light.css"
}
```

A path declared in more than one file (a modifier's token appears in every
context) records the first file in source order that declares it, which for
a modifier with a default is the default context's file. `web-css.report.json` is
unchanged. `manifest.json` records `outputs` as before; its `path` is now the
directory. It gains `componentSpecsDir`, and both are part of the freshness
comparison, so changing either re-projects on the next pull.

**Manifest paths are relative to the working directory**, not to `outDir`,
because artifacts now live in two places: the foundation's `path` is
`.speclayer/tokens/resolver.json` and a component's is
`component-specs/buttonprimary.yaml`. One convention for both, and what `list`
prints is what the developer types. `readManifest` still reads a 0.6.0
manifest; its outDir-relative paths are shown as written until the next pull
rewrites them, which the refusal in section 6 forces anyway.

The freshness rule in `pull` (a 304 is acceptable only when the last pull
wrote what this one would and it is still on disk) now checks `index.css`,
every part file `index.css` imports, and every component `path` in the
manifest, so a deleted file comes back on the next pull rather than being
reported up to date. `index.css` is the authoritative list of written part
files. The map is not: a map entry names the file that *first* declares a
token, which for a two-mode collection is always the default mode's file, so
a non-default mode file such as `semantic-colors.dark.css` never appears in
the map. The first real pull into a 0.6.0 tree found exactly that gap. The
guide's list of part files is read the same way, from the imports.

## 8. Code shape

**Extractor**, `packages/extractor/src/v5/outputs/css.ts`. `cssOutput`
returns `{ files: Record<string, string>; map; report }` instead of `text`.
`files` is insertion-ordered per section 3 and always contains `index.css`
when it contains anything; it is empty when nothing was declared. File naming
(`cssFileNames(sources)`) lives here, exported for tests, and reuses the DTCG
`slug` by importing it from `../dtcg` (export it; it is private today). The
header, selector, value, and naming code is untouched. `CssOutput.text` is
removed, not kept beside `files`: one shape, one reader.

**CLI**, a new `packages/cli/src/visibleDir.ts`. The one implementation of
section 5: `visibleDirProblem(cwd, outDir, dir, marker, others)` returns the
refusal sentence or null, and `writeVisibleDir(cwd, dir, marker, files, last?)`
performs steps 1 to 3, with `last` naming the file written after the others.
Both `tokens/` and `component-specs/` go through it; nothing else writes outside
`outDir`.

**CLI**, `packages/cli/src/outputs.ts`. `FormatSpec.defaultPath` becomes
`tokens`. `outputPathProblem` keeps the `.css` refusal and delegates the rest
to `visibleDirProblem`. `writeOutputFile` is deleted. `renderOutput` returns
the new shape.

**CLI**, `packages/cli/src/config.ts`. `CliConfig` gains `componentSpecsDir`,
parsed as a non-empty string, default `component-specs`; `writeConfig` writes it.

**CLI**, `packages/cli/src/files.ts`. `writeBundleFiles` takes
`componentSpecsDir`, checks every visible directory before staging, stages only
the record into `.speclayer.partial`, swaps, then writes `component-specs/` and
each output directory through `writeVisibleDir`. Manifest paths are
cwd-relative (section 7). The return value lists each visible directory once
with its file count.

**CLI**, `packages/cli/src/commands.ts`. The freshness check reads the map for
CSS file names and the manifest for component paths. The success lines become
`Wrote 14 files under .speclayer/.`, `Wrote component-specs/ (1 file).`, and
`Wrote tokens/ (8 files, web/css, kebab names).` `list` prints the manifest
paths as stored. `show` reads the bundle and is unchanged. The no-platform
and missing-format notes are unchanged.

**CLI**, `packages/cli/src/tools.ts` and `skill.ts`. The `writes` column and
the web platform section say `outputs[].path (default tokens/ for web),
written in place`, and `pull` and `setup` list `componentSpecsDir (default
component-specs/)` among their writes. The guide points the agent at
`component-specs/` instead of `.speclayer/components/`, tells it to import
`tokens/index.css`, lists the part files `index.css` imports, names the file
a token lives in from the map, and shows the `prefers-color-scheme` wiring
through `modes` when a modifier exists. The rule "never edit files under
`.speclayer/`" extends to the two visible directories: the next pull replaces
or removes what it wrote there. The "re-run this guide after" sentence gains "or after
changing `outputs`", since the guide in `Test123` was written 66 seconds
before the pull that added the output and contradicted the disk.

## 9. Documentation

- `CHANGELOG.md`: a new Unreleased entry for CLI 0.7.0 stating the
  directory, the file rule, the default path, the `file` field, the refusal
  for a `.css` path, the two-step move from 0.6.0, `component-specs/` beside
  `tokens/` with `componentSpecsDir`, and cwd-relative manifest paths. The existing 0.6.0
  entry stays where it is (the file keeps one Unreleased section for the
  whole repository) and gains a note that 0.6.0 was published on 2026-09-09.
- `packages/cli/README.md`: the layout tree, the outputs section, and the
  `modes` example.
- `apps/website/content/docs/outputs.html`, `quickstart.html`,
  `configuration.html`, `cli.html`: every `spec-layer/tokens.css` becomes the
  directory, every `.speclayer/components/` becomes `component-specs/`, the file
  trees show the two visible directories beside `.speclayer/`, and the outputs
  page shows `index.css` and one part file.
- The 2026-09-08 spec gets one line under its title pointing here for
  section 5.1.
- `packages/cli/package.json` version `0.7.0`; `CLAUDE.md` status block.

## 10. Invariants

- Rendered implies imported: every part file written is imported by
  `index.css`, and every import names a file written in the same pull.
- One reader of v5: the CSS output still reads the `DtcgExport` only.
- No hash reads any output file.
- Nothing without its directory's marker is ever written over, removed, or
  read beyond its first bytes; a visible directory holding such a file stops
  the pull before anything is staged.
- The component brief on disk is byte-identical to the bundle's `ai` field
  and to the plugin's Copy for AI.
- File names come from resolver labels and DTCG mode slugs by the stated
  rule; nothing is inferred from a token's type or a mode's meaning.
- Output is byte-stable across runs and machines for the same export and
  options.

## 11. Testing

Extractor, `test/v5/outputs/css.test.ts`:

- a set writes `<slug>.css` with one `:root` block; a modifier writes one
  file per context, default at `:root`, others under the template;
- `index.css` lists every written file in source order and nothing else;
- a source with every token omitted writes no file and no import;
- two collections slugging alike get `-2`; a collection named `Index` gets
  `index-2.css`;
- the `file` field of every map entry names a file in `files`, and a
  modifier's token records the default context's file;
- a `var()` across files survives the fixed point exactly as before.

Extractor, `cssGolden.test.ts`: the fixture directory holds, per case, every
file of the synthetic Foundation. Regenerate deliberately, review the diff.

CLI, a new `test/visibleDir.test.ts`, plus `outputs.test.ts` and
`files.test.ts`:

- `.css` path refused with the migration sentence; existing regular file
  refused; directory with a foreign file refused; directory with only
  `.DS_Store` accepted; `component-specs` and `tokens` set to the same path, or one
  nested in the other, refused; a visible directory inside `outDir` refused;
- a pull writes `tokens/` with `index.css` last, and `component-specs/` with one
  marked YAML per selected component, byte-identical to the bundle's `ai`;
- a second pull with a mode removed deletes the stale marked CSS file and
  leaves a dotfile; a second pull with `include.components` narrowed removes
  the brief it no longer names; `--only foundation` empties `component-specs/` of
  marked files;
- nothing is written in `component-specs/` or `tokens/` when a check fails, and a
  failed rename leaves no `.partial`;
- `.speclayer/` no longer contains `components/`; manifest paths are
  cwd-relative for both kinds.

CLI, `config.test.ts`: `componentSpecsDir` parsed, defaulted, written by `setup`
and `init`, rejected when not a string. `commands.test.ts`: freshness
re-fetches when a CSS part file or a component brief is missing; changing
`componentSpecsDir` re-projects; the success lines count files per directory;
`list` prints cwd-relative paths. `skill.test.ts` and
`tools.test.ts`: the new strings. `npm run check` green. The CLI bundle smoke
test only proves the bundle evaluates; the end-to-end proof is a real
`spec-layer pull` into `Test123` after the config is changed to `tokens`,
listing the directory and importing `index.css` in a browser.

## 12. Decisions

Taken 2026-09-09 with the maintainer:

1. **Default path `tokens/`** at the repository root, over `spec-layer/tokens/`.
   A Style Dictionary repository that already has a `tokens/` source folder is
   refused with a message naming the fix, which is the honest outcome.
2. **Sets drop the mode** from their file name (`foundation.css`, not
   `foundation.mode-1.css`). A set has one mode by construction, and Figma's
   `Mode 1` is a placeholder, not information.
3. **Names come from resolver labels**, so style collections are
   `effect-styles.css` and `typography-styles.css`, not the record's
   `styles.effects.json` stems. One rule for every set.
4. **Stale Spec Layer files are removed.** Leaving a file that `index.css` no
   longer imports would keep old values reachable by a direct import.
5. **A `.css` path is refused, not migrated.** The config and the old file
   are the team's; the message gives both steps.
6. **Component briefs are visible, in `component-specs/` beside `tokens/`.** They
   are read by people and agents in review, like the CSS, and a hidden
   directory kept them out of IDE trees and diffs. The YAML's own first two
   lines are the marker, so the file is not altered to be recognisable.
7. **Manifest paths are relative to the working directory.** Artifacts now
   live in two places, and one convention beats two.
8. **One directory writer for both.** `tokens/` and `component-specs/` differ in
   marker and in whether a file is written last; everything else is shared.

## 13. Alternatives considered

- **Supernova's `base/`, `light/`, `dark/` folders with a file per token
  type.** Repeats every set under every theme and splits a collection by
  type, which the resolver model does not do and the `var()` graph does not
  need. Rejected.
- **One file per collection, modes as blocks inside it.** Fewer files, but a
  team cannot import one mode alone, which is the one thing the split buys.
  Rejected.
- **Keep the single file, add `index.css` beside it.** Nothing gained.
- **Accept a `.css` path as the old single-file mode.** Two shapes to test,
  document, and explain, for a version that was published one day. Rejected.
- **Strict one-to-one names with the JSON record** (`foundation.mode-1.css`).
  Honest but noisy; the record keeps that name for tools that want it, and
  the map's `file` field joins the two.
- **Keep the briefs in `.speclayer/components/` and symlink or copy.** Two
  copies of the same file, or a symlink that Windows and many bundlers
  mishandle. Rejected.
- **Put briefs under `tokens/components/`.** Tokens and components are
  different things and a CSS consumer's glob over `tokens/` would pick up
  YAML. Rejected.
- **Prepend a `# Generated by spec-layer` comment to each brief.** Would make
  the on-disk file differ from Copy for AI and from the bundle, for a marker
  the YAML already provides. Rejected.
- **A `--components-dir` flag.** `outDir` has `--out` because CI passes it;
  nothing passes the components path, and `setup` writes it to the config.
  Not added until something needs it.
