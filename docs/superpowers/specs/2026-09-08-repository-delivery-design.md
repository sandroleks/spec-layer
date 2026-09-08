# Repository delivery: platform outputs and the two adoption paths

**Date:** 2026-09-08
**Status:** Approved in review on 2026-09-08 with the recommendations in section 12 as written. Ready for an implementation plan.
**Scope:** What `spec-layer pull` and the plugin's Copy for AI put into a repository, for a project started from scratch and for an existing repository. Adds a platform output model and one deterministic projection, CSS, and renames the component directory. Changes no hash, no schema, no extraction.
**Reads with:** `packages/cli/README.md`, `docs/superpowers/specs/2026-09-03-dtcg-foundation-export-design.md`, `docs/strategy/2026-09-08-market-positioning.md`, `docs/strategy/2026-09-02-design-conformance-pivot.md` section 6.4.

## 1. Problem

`spec-layer pull` writes one managed directory:

```text
.speclayer/
  bundle.json                 the published library, verbatim
  manifest.json
  tokens/                     Foundation as DTCG 2025.10: one file per collection and mode,
                              resolver.json, styles.*.json, spec-layer.meta.json, report.json
  ai/components/<slug>.yaml   one compact brief per component
```

`spec-layer skill --install` then writes a guide into the coding agent's
instruction file. The guide tells the agent to read `tokens/resolver.json`,
look up `code_syntax.WEB` in the sidecar, and, if Style Dictionary or Tailwind
is present, how to feed the DTCG files into it.

That is a complete delivery of the **facts**. It is not a complete delivery of
anything a browser reads. Two people receive it very differently.

**A person starting from scratch** has an empty directory or a freshly
scaffolded app. Nothing in it reads DTCG JSON. To get a colour onto a screen
the agent must either add Style Dictionary and a config, which is a build
step and a dependency the person did not ask for, or translate the JSON into
CSS custom properties by hand. Hand translation is where fabrication happens:
inventing `px` for a unitless number, flattening names inconsistently,
inventing a dark value for a collection that has one mode, silently letting
two names collide. Every one of these is a defect the extractor was built to
refuse, and today the product hands the last mile to the one step in the
chain that is not deterministic.

**A person with an existing repository** has components and often a token
pipeline already. They need three things the current layout only partly
answers: a clear statement of which files to commit, a diff that changes only
when the design changed, and output that never claims a place their own
source files occupy. `.speclayer/` is managed and swapped atomically, `status`
gives CI an exit code, and the README says the skill file is meant to be
committed. It does not say the same about `.speclayer/` itself, and the guide
gives pipeline advice only when it detects a pipeline.

The question the user asked in one sentence: **do we have a tool that
normalises tokens for the web?** No. We have DTCG files, the designer's
declared `code_syntax.WEB` in a sidecar, one test proving Style Dictionary
5.5.2 builds our output into CSS, and prose telling the agent to do the rest.

## 2. What Supernova's export teaches

`/Users/sandrolek/Downloads/result` is a Supernova CSS export of a real
Figma file: 16 files, 1,050 lines, `index.css` importing `base/`, `light/`
and `dark/` directories of five files each. It is the closest thing to a
competitor answer to "normalise for the web", and it is a catalogue of what a
deterministic emitter must not do.

| What Supernova wrote | Why it is wrong | Our existing rule |
|---|---|---|
| `--dscolorcolorsblue25`, `--dstypographyheadingl36pxregular` | Every separator dropped. Unreadable, and collision-prone. | DTCG paths keep segments; names are never slugged inside files. |
| `--dstypographyparagraphs14pxregular` appears twice in `base/typography.css` with different weights | Two Figma styles flattened to one name; the second silently overwrites the first. | `path_collision`: omit both, report, never pick one. |
| `--dsdimensiontypographyfontweightfw400: 400px` | A unit fabricated onto a font weight. | A number with no unit in its scopes stays a number; `FONT_WEIGHT` scope pins `fontWeight`. |
| `light/` and `dark/` each repeat all five files; only `color.css` differs, and only its semantic half | Sets with one mode duplicated under every theme. Three copies of every dimension and shadow. | The resolver separates sets from modifiers; a set is emitted once. |
| Themes as `.theme-light` and `.theme-dark` classes over a `:root` that already holds the light values | A theming mechanism chosen for the team, undocumented, and redundant for the default. | Default at `:root`, non-default modes scoped by a declared selector. |
| `400 36px/120% "Open Sans"` | A `font` shorthand cannot carry letter spacing, text case, or decoration. Lost silently. | A composite whose properties cannot all be expressed is not collapsed into one that drops some. |
| `/* - Dropdowns\n- Menus\n- button-focused */` | Multi-line Figma descriptions pasted raw into comments. | Descriptions are data, in the sidecar, not decoration. |
| `--dsstringtypographyfontfamilyprimary: "Open Sans"` in `string.css` | A `string` type invented to carry a font family. | `fontFamily` is a DTCG type; other strings are reported, not emitted. |

What Supernova got right, and we should match: `var()` references in the
semantic layer, so aliases survive into CSS; one entry file; the export works
without a build step.

The lesson is not "do not emit CSS". It is that emitting CSS is a projection
with exactly the rules the DTCG projection already has, and that leaving it to
an agent guarantees a Supernova-shaped result on a random subset of tokens.

## 3. Decision

Two things, one model.

**Record and deliverable are different files in different places.** The
record is what tools and agents read by explicit path: the bundle, the
manifest, the DTCG files, the component briefs, and for every generated
output its name map and report. It stays in `.speclayer/`, which is deleted
and renamed into place on every pull. A deliverable is a file the team's
build compiles. It is written **in place** at a path declared in
`speclayer.json`, inside the team's tree, never inside the swapped directory.
Two reasons. A dev server watching an imported stylesheet loses the watch
when the file's parent directory is removed and recreated, so design updates
stop hot-reloading until a restart. And a hidden directory is excluded by
default from IDE trees, search tools, and many source globs, so the diff a
design change produces goes unreviewed.

**Outputs are platform projections.** An output is `{ platform, format,
path, case }`. This change implements one, `web` / `css`, as a pure function
from the DTCG export in `packages/extractor/src/v5/outputs/css.ts`. The model
leaves room for `ios` / `swift`, `android` / `compose`, `flutter` / `dart`
later, each a projection reading the same DTCG export, each choosing its own
default casing. Nothing about `tokens/`, `ai/components/`, the bundle, the
manifest, or the schemas changes.

```text
speclayer.json                  outputs declared here, written by setup and init
spec-layer/
  tokens.css                    the web deliverable, default path, written in place
.speclayer/
  bundle.json
  manifest.json
  tokens/                       unchanged
  components/*.yaml             was ai/components/, see 3.1
  outputs/
    web-css.map.json            DTCG path -> emitted name, and where the name came from
    web-css.report.json         what this output could not express
```

### 3.1 The component directory

`ai/components/` is renamed `components/`, beside `tokens/`. The old name
described the consumer; the two directories should name what they hold, and
in parallel. The manifest field `aiPath` becomes `path` for the same reason,
and the CLI reads `aiPath` from a manifest written by an earlier version so
`list`, `skill`, and `status` keep working until the next pull rewrites it.
No migration is needed on disk: `pull` replaces the managed directory
wholesale, and the component files are byte-identical under the new path.
The bundle's `ai` field and the plugin's **Copy for AI** are unchanged; they
are the wire format and the button, not the directory.

The person starting from scratch imports one file and has the tokens as
custom properties with the alias graph intact. The person with a pipeline
keeps reading `tokens/` and either ignores the CSS or turns it off. The
projection reads the `DtcgExport`, not the canonical artifact, so there is
still one interpretation of v5.

## 4. Outputs

### 4.1 Configuration

```json
{
  "libraryId": "lib_...",
  "outDir": ".speclayer",
  "platforms": ["web"],
  "outputs": [
    {
      "platform": "web",
      "format": "css",
      "path": "spec-layer/tokens.css",
      "case": "kebab",
      "root": ":root",
      "modeSelector": "[data-theme=\"{mode}\"]",
      "modes": { "Density": "[data-density=\"{mode}\"]" }
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `platforms` | The targets this repository builds for. Written by `setup` and `init` from `--platform` flags, else from root detection at that moment. `pull` and `skill` read it; when absent they fall back to detection at run time, as `skill` does today. |
| `outputs[].platform` | One of `web`, `ios`, `android`, `flutter`. Decides which `code_syntax` key supplies declared names. |
| `outputs[].format` | The emitter. This change ships `css`. The registry rejects an unknown pair with the list it knows. |
| `outputs[].path` | Where the deliverable is written, relative to the repository root. Required for every platform except web, which defaults to `spec-layer/tokens.css`. |
| `outputs[].case` | Casing for derived names: `kebab`, `camel`, `pascal`, `snake`, `constant`. Each format has a default; `css` defaults to `kebab`. |
| `root`, `modeSelector`, `modes` | CSS only; see 5.5. |

`setup` and `init` materialise a default `outputs` entry for every platform in
`platforms` that has a default path, so the path is on record in a file the
team edits, never implicit. `pull` with a config that has `platforms` but no
`outputs` (a config written by an older CLI, or edited by hand) applies the
same defaults and says which path it wrote. `"outputs": []` writes nothing.
An `outputs` entry for a platform absent from `platforms` is still written;
`platforms` chooses defaults and guide advice, `outputs` is the instruction.

### 4.2 Writing in place

An output path is written atomically: to `<path>.partial`, then renamed. It
is never deleted by `pull`. Before the first write to an existing file the CLI
reads its first line; a file that does not begin with the Spec Layer header
is not ours, and `pull` refuses with the path and the sentence "choose
another path or remove the file". A path outside the repository root, or
inside `outDir`, is refused. Parent directories are created.

Every emitted file begins with a header that carries the library id, the
Foundation's `content_hash`, the output's platform, format, and case, and the
instruction not to edit. It carries no timestamp and no CLI version, so the
file changes only when the design data or the output options change.

`manifest.json` records the resolved `outputs` beside `dtcg`. A change to
either makes the next `pull` fetch and re-project even when the bundle has
not moved, the same freshness rule the DTCG block has today. `status`
compares the bundle hash only, as it does now.

### 4.3 Names

The identifier for a token is decided in this order:

1. **Declared.** The token's `code_syntax` entry for the output's platform
   (`WEB` for web), used verbatim when the format accepts it. For `css` that
   means a valid custom property name, `--` followed by `[A-Za-z0-9_-]+`; a
   declared name that is a valid identifier without the prefix gets the
   prefix. A declared value the format cannot use (a JavaScript accessor such
   as `theme.colors.blue500` handed to CSS) falls through to rule 2 and is
   reported `code_syntax_not_usable` with the declared value. `case` never
   touches a declared name: what the designer declared is what the designer
   declared.
2. **Derived.** The DTCG path, collection root included, converted by the
   output's `case`. Each path segment is split into words on every run of
   characters outside letters and digits and on every lowercase-to-uppercase
   boundary, so `fontSize` is two words and `Blue 500` is two words. Digits
   are not a boundary: `h1` stays one word. Words are then joined:

   | `case` | `Mapped Colors` / `surface/primary/default` | `Foundation` / `fontSize/850` |
   |---|---|---|
   | `kebab` | `mapped-colors-surface-primary-default` | `foundation-font-size-850` |
   | `camel` | `mappedColorsSurfacePrimaryDefault` | `foundationFontSize850` |
   | `pascal` | `MappedColorsSurfacePrimaryDefault` | `FoundationFontSize850` |
   | `snake` | `mapped_colors_surface_primary_default` | `foundation_font_size_850` |
   | `constant` | `MAPPED_COLORS_SURFACE_PRIMARY_DEFAULT` | `FOUNDATION_FONT_SIZE_850` |

   The format then adds its own affix: `css` prefixes `--`. A segment with no
   words becomes `_`. A derived name that begins with a digit in a format
   that forbids it gets the format's escape (`css` custom properties allow
   it; Swift and Kotlin will prefix `_`).

Two tokens that reach the same identifier, by either rule, are both omitted
and reported `name_collision` with both DTCG paths. Case folding is the one
new source of collisions this introduces (`Blue` and `blue` fold together in
every case but none), and it is reported rather than resolved. This is the
DTCG `path_collision` rule applied one layer down, and it is how the
Supernova duplicate in section 2 would have surfaced instead of overwriting.

The collection root stays in the derived name. DTCG paths are unique by
construction, and dropping the root reintroduces cross-collection collisions
that the projection would then have to report on every library with a
`Primitives` and a `Semantic` collection sharing a `color` group. A designer
who wants short names declares them in Figma.

`.speclayer/outputs/<platform>-<format>.map.json` records every emitted token:

```json
{
  "Foundation.colors.blue.500": { "name": "--colors-blue-500", "source": "code_syntax" },
  "Mapped Colors.surface.primary.default": { "name": "--mapped-colors-surface-primary-default", "source": "derived" }
}
```

The derivation is a documented, reversible transform of a stated name. It
invents no value, unit, or mode. It does contradict the current guide text,
which tells an agent to derive nothing when `code_syntax.WEB` is absent; that
sentence changes to point at the map, where the derived name and its
provenance are on record. Section 12 asks for this to be confirmed.

### 4.4 Report

`.speclayer/outputs/<platform>-<format>.report.json` has the shape of
`tokens/report.json`: an array of `{ code, severity, path, mode?, message,
details }`. Codes introduced here: `code_syntax_not_usable`,
`name_collision`, `reference_target_omitted`, `mode_selector_shared`,
`value_converted` (a stated fact restated in the format's unit, see 5.3 and
5.4), and `not_expressible` for anything else, with `details.reason`.

## 5. The `css` format

### 5.1 Structure

```css
/* Generated by spec-layer from library lib_..., foundation sha256:...., web/css/kebab.
   Do not edit. Change the design in Figma, republish, and run spec-layer pull. */

:root {
  /* Foundation */
  --foundation-colors-blue-500: #2e72d1;
  --foundation-spacing-200: 8px;
  --foundation-font-weight-700: 700;
  /* Mapped Colors, Light */
  --mapped-colors-surface-primary-default: var(--foundation-colors-blue-500);
}

[data-theme="dark"] {
  /* Mapped Colors, Dark */
  --mapped-colors-surface-primary-default: var(--foundation-colors-blue-900);
}
```

- One block at the root selector holds every set and the **default context**
  of every modifier, in `resolutionOrder`. Within a collection, tokens follow
  the sorted DTCG file order, so output is stable across runs and machines.
- Every non-default context of every modifier gets one block under the mode
  selector, holding only that collection's tokens. Two modifiers whose
  contexts produce the same selector share the block; see 5.5.
- A comment names each collection and mode once. Token descriptions are not
  emitted; they are in the sidecar.

### 5.2 Values

| DTCG type | CSS |
|---|---|
| `color`, alpha 1 | `#rrggbb` from the canonical hex |
| `color`, alpha below 1 | `rgb(R G B / A)`: integer channels from the hex, alpha as the canonical number. Hex alpha would round a stated `0.15` to `0.149`. |
| `dimension` | `<value><unit>`: `16px`, `1rem` |
| `number`, `fontWeight` | the bare number |
| `duration` | `200ms` |
| `cubicBezier` | `cubic-bezier(a, b, c, d)` |
| `fontFamily` | the quoted family |
| reference `{A.b.c}` | `var(<name of A.b.c>)`. When the target was omitted from this output, the referencing token is omitted too and reported `reference_target_omitted`. |

Unit overrides declared under `dtcg.units` in `speclayer.json` have already
been applied by the time the DTCG export exists, so a number promoted to
`dimension` there arrives here with its unit. Nothing is inferred from a name.
A `number` whose scopes state no unit is emitted as a bare number, which is
valid CSS for `line-height`, `opacity`, `flex`, and `font-weight`, and a
type error anywhere that needs a length. That is the correct outcome: the
error is in the consumer's stylesheet, where the browser reports it, rather
than a `px` invented in ours.

### 5.3 Typography styles

A composite is never collapsed into a shorthand that drops a property.
Typography emits one custom property per sub-property under the style's
derived name: `-font-family`, `-font-size`, `-font-weight`, `-line-height`,
`-letter-spacing`, `-text-transform`, `-text-decoration` (the suffixes follow
the output's `case`). A property bound to a token becomes `var()`. Line
height in `%` is written as the unitless multiplier, the same conversion the
DTCG projection makes; a `px` line height, which DTCG could not express, is
written as `Npx` because CSS can. Letter spacing in `%` becomes `em` divided
by 100, since Figma defines it as a fraction of the font size, and is reported
`value_converted`. A property whose resolved value is `null` is omitted and
reported.

### 5.4 Effect styles

One `box-shadow` list per style, layers in source order, `inset` for inner
shadows, each colour by the rule in 5.2. Layer and background blurs have no
`box-shadow` form; a style with no visible shadow is omitted and reported
`not_expressible`, matching the DTCG rule.

No CSS classes are generated. Composition into `.heading-xl { ... }` is the
team's, and generating it was rejected with the composition layer in June.

### 5.5 Modes

The default context of every modifier lives at the root selector. Every other
context gets a block under a **mode selector**. The default template is
`[data-theme="{mode}"]`, with `{mode}` the context's file-name slug;
`{collection}` is also available.

Nothing about a mode's name selects a media query. A collection whose modes
are called Light and Dark is not evidence that the team wants OS-driven
switching, and one called Compact and Comfortable is not a theme. The guide
tells the agent how to wire `data-theme` to `prefers-color-scheme` if that is
what the team wants.

When a Foundation has more than one modifier, one attribute cannot carry both
axes: a page can be dark and comfortable at once. The projection still emits
each context under the default template, reports `mode_selector_shared`
naming the modifiers, and the `modes` map in the output entry declares a
selector per collection. Selectors are written verbatim; the CLI does not
validate CSS.

## 6. Later formats

Not built now. Listed so the output model is checked against them.

| Platform / format | Reads | Default case | Declared name from |
|---|---|---|---|
| `ios` / `swift` | one `enum` or `struct` per collection, modes as a `switch` on a declared theme enum, `Color` from sRGB components | `camel` | `code_syntax.iOS` |
| `android` / `compose` | one `object` per collection, modes as parameters of a theme function | `camel` | `code_syntax.ANDROID` |
| `android` / `xml` | `colors.xml`, `dimens.xml`, modes as resource qualifiers only when declared | `snake` | `code_syntax.ANDROID` |
| `flutter` / `dart` | one class per collection; Figma declares no Dart syntax, so every name is derived | `camel` | none |
| `web` / `scss`, `web` / `ts` | `$variables` or an exported `const` | `kebab`, `camel` | `code_syntax.WEB` |

Each is a projection of the same `DtcgExport`, in its own file under
`v5/outputs/`, with the same name rules, the same map and report, and its own
value table. Tailwind's `@theme` namespaces are not on this list: mapping a
`dimension` collection to `--spacing-*` rather than `--radius-*` is knowledge
the type does not carry, so it stays a declared mapping the team owns.

## 7. The two adoption paths

### 7.1 Starting from scratch

```bash
npx spec-layer setup --id lib_... --key sl_... --platform web
npx spec-layer skill --install
```

An empty directory carries no platform signal, so `--platform web` is how the
person says what they are building. `setup` stores `platforms` and a default
`outputs` entry in `speclayer.json`, pulls, and writes `spec-layer/tokens.css`
in the same run. Without the flag, `setup` detects, finds nothing, writes no
output, and prints the flag to use. The guide's web section then says:

- Import `spec-layer/tokens.css` from the root stylesheet. Do not copy values
  out of it.
- Switch modes by setting `data-theme` on `<html>`; the guide lists the modes
  and the default. Wire it to `prefers-color-scheme` yourself if you want the
  OS to choose.
- Build each component from `.speclayer/components/<slug>.yaml`. Its
  `bindings` name the token per part, property, and condition; the CSS name
  for each is in `.speclayer/outputs/web-css.map.json`.

No scaffolding, no component skeletons, no framework choice. Those were the
hosted composition layer, rejected.

### 7.2 An existing repository

The existing contract holds for the record: everything under one managed
directory, staged and swapped atomically. The deliverable is the one file
written elsewhere, at a path the team declared or can see in `speclayer.json`,
never over a file that is not ours. Four points:

- **Commit policy, stated.** `.speclayer/`, `speclayer.json`, and every
  output path are meant to be committed. The README and the guide say so. A
  team that would rather regenerate in CI adds them to `.gitignore` and runs
  `pull` in the pipeline; `status`'s exit `2` already supports that.
  Generated files change only when design data or output options change,
  and the free-publish work in progress makes a republish of unchanged
  content a no-op at the proxy, so `bundle.json` no longer churns on a
  rebuild.
- **Web detected, so the CSS is written.** Detection of a web dependency at
  `setup` or `init` time puts `web` in `platforms` and the default output in
  `outputs`. A team that does not want it deletes the entry or sets
  `"outputs": []`.
- **A pipeline already present.** When detection finds Style Dictionary or
  Tokens Studio, the guide keeps pointing at `tokens/` and says the CSS is a
  projection of the same files, not a second source; import one or the
  other.
- **Tailwind present.** Tailwind 4 reads CSS custom properties directly, so
  the file is importable as-is. Mapping into Tailwind's namespaces stays with
  the team, as the guide already says.

Components stay in `.speclayer/components/`. Placing a brief beside the
team's own component file would need the anatomy-to-code mapping the
conformance proposal calls `speclayer.map.json`, which does not exist yet.

## 8. Where the projection runs

Only the CLI writes outputs. The plugin's Foundation Copy for AI stays the
DTCG resolver document; a **Copy as CSS** action is one function call away
once `css.ts` exists, but the clipboard's real size and paste behaviour are
still an open row in the manual Figma matrix, and adding a second clipboard
format before the first has been observed in Figma would compound the
unknown. The published bundle is unchanged, so no proxy or bundle version
change.

## 9. Guide and CLI surface changes

- `setup`, `init`, `pull`: repeatable `--platform`. `setup` and `init` store
  it; `pull` overrides for the run. `setup` and `init` write the default
  `outputs` entries. `pull` lists every output path it wrote.
- `list` gains the outputs with their paths and prints `path` instead of
  `aiPath`; `tools` describes what `pull` now writes outside `outDir`.
- `files.ts` writes `components/<slug>.yaml` and a manifest with `path`;
  `readManifest` accepts `aiPath` from older manifests.
- `skill`: the web section gains the import line, the `data-theme` switch,
  the map lookup for names, and the "one source, not two" sentence when a
  pipeline is detected. The sentence telling the agent to derive nothing
  when `code_syntax.WEB` is absent is replaced by a pointer to the map. The
  pull summary lists each output with its path, case, and mode selectors.
- The plugin's Publish screen copies `setup ... && npx spec-layer skill
  --install` today. It cannot know the platform; the command is unchanged.
- `packages/cli/README.md`, the website's outputs and CLI pages, and
  `CHANGELOG.md` document the outputs block, the default path, the casing
  table, the commit policy, and the `components/` rename. The README's
  version note gains: "`components/` in place of `ai/components/`, and
  `path` in place of `aiPath` in the manifest, need 0.6.0 or later."

## 10. Invariants

- **Never fabricate.** No unit, mode, media query, or value is inferred.
  Names are derived by a stated rule and recorded with provenance.
  Collisions are omitted and reported.
- **Projection, not source.** Every output reads a `DtcgExport`; none reads
  Figma, feeds a hash, or justifies a schema change.
- **One interpretation of v5.** The DTCG projection is the only reader of
  v5; outputs read it.
- **`compareCodeUnits` for every ordering** under `src/v5`.
- **Stable output.** Same input and options, same bytes, on every machine.
  Headers carry a content hash, not a time.
- **Two write boundaries, both declared.** The managed directory, swapped;
  the output paths in `speclayer.json`, written in place and never over a
  file without our header.

## 11. Testing

- Golden: the synthetic DTCG fixture projects to committed `tokens.css`,
  map, and report for `kebab`; byte comparison. A second golden for `camel`
  covers the casing path.
- Names: declared name used, declared name without prefix, declared
  non-identifier falls through and reports; the word-splitting rule on every
  segment shape in `dtcgSegments` plus `fontSize`, `Blue 500`, `h1`; every
  `case`; a collision from case folding omits both and reports; a reference
  to an omitted target omits and reports.
- Values: every type in 5.2; typography `%` and `px` line height, `%` letter
  spacing, `null` property; effect with no visible shadow.
- Modes: two modifiers report `mode_selector_shared`; a per-collection
  selector override; `{collection}` in a template.
- Browser truth: the CSS the golden emits is parsed by a real CSS parser in
  the test. `postcss` and `lightningcss` are already in `node_modules` as
  transitive dependencies; one becomes an explicit extractor dev dependency.
  Every declaration must be a valid custom property with a non-empty value,
  and every `var()` target must be declared in the same file.
- CLI: `pull` writes `components/<slug>.yaml` and `path` in the manifest;
  a manifest with `aiPath` is still read. `setup --platform web` writes the
  config entry and the file; `pull`
  refuses a foreign file at the path, a path outside the root, and a path
  inside `outDir`; an existing file with our header is replaced; a changed
  `outputs` block makes `status` report behind; `"outputs": []` writes
  nothing; an unknown platform or format is refused with the known list;
  `skill` names the path, case, and selectors.
- The Style Dictionary gate stays as it is. It is the proof for the other
  adoption path.

## 12. Decisions

Taken on 2026-09-08:

- Outputs are written automatically when the platform is web, from detection
  or `--platform`, and turned off by editing `outputs`.
- The output model carries platform and format so other platforms can be
  added as projections without changing the config shape.
- Derived-name casing is selectable: `kebab`, `camel`, `pascal`, `snake`,
  `constant`.
- Deliverables are written in place at a declared path outside `.speclayer/`;
  the record stays inside it, for the reasons in section 3.
- `ai/components/` becomes `components/`, and `aiPath` becomes `path`.
- The five recommendations below, confirmed in review as written.

Confirmed, with the alternative each was weighed against:

1. **Derive names at all** when `code_syntax` is absent, by the rule in 4.3
   with provenance in the map. The alternative, declared names only,
   produces an almost empty file for most libraries.
2. **Default web path `spec-layer/tokens.css`** at the repository root,
   visible and framework-neutral. Alternatives: `src/styles/tokens.css` when
   `src/` exists, which guesses at layout; or no default, which makes the
   greenfield path one more flag long.
3. **Keep the collection in derived names.** See 4.3.
4. **Default mode selector `[data-theme="{mode}"]`** with a report when two
   modifiers share it, versus `[data-{collection}="{mode}"]`, always correct
   and always awkward.
5. **Colour with alpha as `rgb(R G B / A)`** rather than `#rrggbbaa`.

## 13. Alternatives considered

- **Keep the CSS inside `.speclayer/`.** Simplest to implement and never
  touches the team's tree, but the directory swap breaks file watchers and
  the hidden path keeps the diff out of review. Rejected for the reasons in
  section 3.
- **A visible `spec-layer/` directory for everything, replacing
  `.speclayer/`.** Solves visibility for the record too, at the cost of a
  migration for every existing pull and every published setup command.
  Not worth it while the record is read by path.
- **Scaffold a Style Dictionary config on `init`.** Adds a dependency and a
  build step to a person who wanted a stylesheet, and Style Dictionary does
  not read `resolver.json`, so the mode wiring is hand-written anyway. It is
  the right answer for the pipeline path, where it already exists.
- **Improve the guide only.** Keeps the fabrication risk exactly where it is
  and makes the outcome depend on which agent runs the guide.
- **Emit from the canonical artifact directly.** A second reader of v5,
  which the DTCG design ruled out for the CLI. Reading the DTCG export keeps
  one.
