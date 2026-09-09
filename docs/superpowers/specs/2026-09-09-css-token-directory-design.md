# The web token output as a directory: one CSS file per collection and mode

Date: 2026-09-09. Status: approved design, awaiting a plan.

Supersedes section 5.1 of
`docs/superpowers/specs/2026-09-08-repository-delivery-design.md` (the
single-file structure) and amends sections 3, 4.1, and 4.2 of that document.
Everything else in it stands: values, naming, selectors, the map and report,
the in-place rule, and the platform and format registry.

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

The record is not the problem. It is read by path, by Style Dictionary and by
agents, and it belongs in the hidden directory. The deliverable is: a second
visible folder named `spec-layer/`, one file, and no way to import one
collection or one mode without the rest.

The reference the team measured against is a Supernova CSS export of the same
Figma file (`/Users/sandrolek/Downloads/result`): a folder, `index.css`, and
`@import` per part. Its content is wrong in the ways the 2026-09-08 design
already catalogues (sets repeated under every theme, `px` fabricated onto font
weights, a `font` shorthand that drops letter spacing and text case, two
styles flattened onto one name). Its shape is right, and it is the shape a
developer expects from a token package.

## 2. Decision

The `web` / `css` output writes a **directory**, not a file. The default
path is `tokens/` at the repository root. `spec-layer/` is no longer created.

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
.speclayer/
  bundle.json                 unchanged
  manifest.json               unchanged shape; outputs[].path now names a directory
  tokens/                     unchanged DTCG record
  components/*.yaml           unchanged
  outputs/
    web-css.map.json          DTCG path -> name, provenance, and now the file that declares it
    web-css.report.json       unchanged
```

One file per resolver source. A set, which by construction has one mode, is
named by its collection alone. A modifier writes one file per context. The
values, selectors, names, `case`, `root`, `modeSelector`, and `modes` options
are exactly those of the 2026-09-08 design; only where declarations land
changes.

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

## 5. Writing the directory

`outputs[].path` names a directory relative to the working directory. Before
anything is staged, `pull` refuses, naming the path and the fix, when:

- the path is outside the repository or inside `outDir` (unchanged rules);
- the path ends in `.css`: "0.6.0 wrote one file there. Set `path` to a
  directory, for example `tokens`, delete the old file, and pull again.";
- the path exists and is not a directory;
- the directory holds any entry, other than a dotfile, that is not a regular
  file beginning with the Spec Layer header: "`tokens/` holds files spec-layer
  did not write. Choose another path or move them." Dotfiles (`.DS_Store`,
  `.gitkeep`) are ignored, never read, never removed.

Then, after the record has swapped into place:

1. Every part file is written to `<name>.partial` and renamed over its
   target.
2. `index.css` is written the same way, **last**, so a reader following an
   import never finds a missing file.
3. Every regular non-dot file in the directory that carries the header and
   was not written by this pull is removed. A renamed collection or a dropped
   mode would otherwise leave a stale file with old values that `index.css`
   no longer imports. Files without the header cannot be present, because
   the check above refused them.

The 2026-09-08 sentence "never deleted, only replaced" becomes: a file the
current pull writes is replaced in place; a Spec Layer file it no longer
writes is removed; a file that is not ours is never touched, and its presence
stops the pull.

## 6. Configuration and the move from 0.6.0

```json
{
  "libraryId": "lib_...",
  "outDir": ".speclayer",
  "platforms": ["web"],
  "outputs": [
    { "platform": "web", "format": "css", "path": "tokens", "case": "kebab" }
  ]
}
```

`setup` and `init` write `"path": "tokens"`. The registry default changes
from `spec-layer/tokens.css` to `tokens`. A `speclayer.json` written by 0.6.0
carries `spec-layer/tokens.css`; `pull` refuses it with the message in
section 5, and does not edit the config or delete the old file. Both are the
team's, and the refusal names both steps. `status` is unaffected: it compares
the bundle hash only.

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
directory.

The freshness rule in `pull` (a 304 is acceptable only when the last pull
wrote what this one would and it is still on disk) now checks `index.css` and
every distinct `file` named in the map, so a deleted part file comes back on
the next pull rather than being reported up to date.

## 8. Code shape

**Extractor**, `packages/extractor/src/v5/outputs/css.ts`. `cssOutput`
returns `{ files: Record<string, string>; map; report }` instead of `text`.
`files` is insertion-ordered per section 3 and always contains `index.css`
when it contains anything; it is empty when nothing was declared. File naming
(`cssFileNames(sources)`) lives here, exported for tests, and reuses the DTCG
`slug` by importing it from `../dtcg` (export it; it is private today). The
header, selector, value, and naming code is untouched. `CssOutput.text` is
removed, not kept beside `files`: one shape, one reader.

**CLI**, `packages/cli/src/outputs.ts`. `FormatSpec.defaultPath` becomes
`tokens`. `outputPathProblem` gains the directory rules of section 5.
`writeOutputFile` becomes `writeOutputDirectory(cwd, o, files)` implementing
steps 1 to 3. `renderOutput` returns the new shape.

**CLI**, `packages/cli/src/files.ts`. `writeBundleFiles` carries
`deliverables` as `{ output, files }` and calls the directory writer after
the swap. Its return value lists the directory path once per output, as it
lists the file today.

**CLI**, `packages/cli/src/commands.ts`. The freshness check reads the map for
file names. The success line becomes `Wrote tokens/ (8 files, web/css, kebab
names).` The no-platform and missing-format notes are unchanged.

**CLI**, `packages/cli/src/tools.ts` and `skill.ts`. The `writes` column and
the web platform section say `outputs[].path (default tokens/ for web),
written in place`. The guide tells the agent to import `tokens/index.css`,
lists the part files that exist on disk, names the file a token lives in from
the map, and shows the `prefers-color-scheme` wiring through `modes` when a
modifier exists. The "re-run this guide after" sentence gains "or after
changing `outputs`", since the guide in `Test123` was written 66 seconds
before the pull that added the output and contradicted the disk.

## 9. Documentation

- `CHANGELOG.md`: a new Unreleased entry for CLI 0.7.0 stating the
  directory, the file rule, the default path, the `file` field, the refusal
  for a `.css` path, and the two-step move from 0.6.0. The existing 0.6.0
  entry stays where it is (the file keeps one Unreleased section for the
  whole repository) and gains a note that 0.6.0 was published on 2026-09-09.
- `packages/cli/README.md`: the layout tree, the outputs section, and the
  `modes` example.
- `apps/website/content/docs/outputs.html`, `quickstart.html`,
  `configuration.html`, `cli.html`: every `spec-layer/tokens.css` becomes the
  directory, and the outputs page shows `index.css` and one part file.
- The 2026-09-08 spec gets one line under its title pointing here for
  section 5.1.
- `packages/cli/package.json` version `0.7.0`; `CLAUDE.md` status block.

## 10. Invariants

- Rendered implies imported: every part file written is imported by
  `index.css`, and every import names a file written in the same pull.
- One reader of v5: the CSS output still reads the `DtcgExport` only.
- No hash reads any output file.
- Nothing without the Spec Layer header is ever written over, removed, or
  read beyond its first bytes.
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

CLI, `test/outputs.test.ts` and `files.test.ts`:

- `.css` path refused with the migration sentence; existing regular file
  refused; directory with a foreign file refused; directory with only
  `.DS_Store` accepted;
- a pull writes the directory, `index.css` last; a second pull with a mode
  removed deletes the stale header-carrying file and leaves a dotfile;
- a failed rename leaves no `.partial`.

CLI, `commands.test.ts`: freshness re-fetches when a part file named in the
map is missing; the success line counts files. `skill.test.ts` and
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
