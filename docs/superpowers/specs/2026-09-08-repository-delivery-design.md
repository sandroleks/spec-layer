# Repository delivery: the web token layer and the two adoption paths

**Date:** 2026-09-08
**Status:** Proposal. Not committed direction; the decisions in section 11 are open.
**Scope:** What `spec-layer pull` and the plugin's Copy for AI put into a repository, for a project started from scratch and for an existing repository. Adds one deterministic projection. Changes no hash, no schema, no extraction.
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

Add a **web projection**: a pure function from the DTCG export to CSS custom
properties, in `packages/extractor/src/v5/css.ts`, downstream of the DTCG
projection and outside every hash. The CLI writes it into the managed
directory when the target platform is web. Nothing about `tokens/`,
`ai/components/`, the bundle, the manifest, or the schemas changes.

```text
.speclayer/
  bundle.json
  manifest.json
  tokens/                     unchanged
  ai/components/*.yaml        unchanged
  web/
    tokens.css                every set and every modifier default at :root;
                              each other mode in one scoped block
    css.map.json              DTCG path -> custom property name, and where the name came from
    report.json               what CSS could not express, same shape as tokens/report.json
```

The same layout serves both people. The person starting from scratch imports
one file and has the design system's tokens as custom properties with the
alias graph intact. The person with a pipeline keeps reading `tokens/` and
ignores `web/`, or turns it off. The projection reads the `DtcgExport`, not
the canonical artifact, so there is still one interpretation of v5.

## 4. Format of `web/tokens.css`

### 4.1 Structure

```css
/* Generated by spec-layer from library lib_..., foundation sha256:....
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
  contexts produce the same selector share the block; see 4.5.
- The header carries the library id and the Foundation's
  `content_hash`, not a timestamp, so the file changes only when the design
  data does. This keeps the existing promise that generated files stay stable
  across a republish of unchanged content.
- A comment names each collection and mode once. Token descriptions are not
  emitted; they are in the sidecar.

### 4.2 Names

The custom property for a token is decided in this order:

1. **Declared.** `code_syntax.WEB` from the sidecar, when it is a valid custom
   property name (`--` followed by `[A-Za-z0-9_-]+`). A declared name without
   the `--` prefix that is otherwise a valid identifier gets the prefix. Any
   other declared value (a JavaScript accessor such as `theme.colors.blue500`)
   is not a CSS name; the token falls through to rule 2 and is reported
   `code_syntax_not_css_ident` with the declared value.
2. **Derived.** `--` plus the DTCG path segments, each lowercased with every
   run of characters outside `[a-z0-9]` replaced by `-` and trimmed, joined
   with `-`. A segment that trims to nothing becomes `_`. `Mapped Colors` /
   `surface/primary/default` becomes
   `--mapped-colors-surface-primary-default`.

Two tokens that reach the same custom property name, by either rule, are
both omitted and reported `css_name_collision` with both DTCG paths. This is
the DTCG `path_collision` rule applied one layer down, and it is how the
Supernova duplicate in section 2 would have surfaced instead of overwriting.

`css.map.json` records every emitted token:

```json
{
  "Foundation.colors.blue.500": { "name": "--colors-blue-500", "source": "code_syntax" },
  "Mapped Colors.surface.primary.default": { "name": "--mapped-colors-surface-primary-default", "source": "derived" }
}
```

The derivation is a documented, reversible transform of a stated name. It
invents no value, unit, or mode. It does contradict the current guide text,
which tells an agent to derive nothing when `code_syntax.WEB` is absent; that
sentence changes to point at `css.map.json`, where the derived name and its
provenance are on record. Section 11 asks for this to be confirmed.

### 4.3 Values

| DTCG type | CSS |
|---|---|
| `color`, alpha 1 | `#rrggbb` from the canonical hex |
| `color`, alpha below 1 | `rgb(R G B / A)`: integer channels from the hex, alpha as the canonical number. Hex alpha would round a stated `0.15` to `0.149`. |
| `dimension` | `<value><unit>`: `16px`, `1rem` |
| `number`, `fontWeight` | the bare number |
| `duration` | `200ms` |
| `cubicBezier` | `cubic-bezier(a, b, c, d)` |
| `fontFamily` | the quoted family |
| reference `{A.b.c}` | `var(<name of A.b.c>)`. When the target was omitted from CSS, the referencing token is omitted too and reported `css_reference_target_omitted`. |

Unit overrides declared under `dtcg.units` in `speclayer.json` have already
been applied by the time the DTCG export exists, so a number promoted to
`dimension` there arrives here with its unit. Nothing is inferred from a name.
A `number` whose scopes state no unit is emitted as a bare number, which is
valid CSS for `line-height`, `opacity`, `flex`, and `font-weight`, and a
type error anywhere that needs a length. That is the correct outcome: the
error is in the consumer's stylesheet, where the browser reports it, rather
than a `px` invented in ours.

### 4.4 Styles

Typography and effect styles are composites. Following the section 2 lesson,
a composite is never collapsed into a shorthand that drops a property.

**Typography** emits one custom property per sub-property under the style's
derived name: `-font-family`, `-font-size`, `-font-weight`, `-line-height`,
`-letter-spacing`, `-text-transform`, `-text-decoration`. A property bound to
a token becomes `var()`. Line height in `%` is written as the unitless
multiplier, the same conversion the DTCG projection makes; a `px` line height,
which DTCG could not express, is written as `Npx` because CSS can. Letter
spacing in `%` becomes `em` divided by 100, since Figma defines it as a
fraction of the font size, and is recorded in the report as a conversion. A
property whose resolved value is `null` is omitted and reported.

**Effects** emit one `box-shadow` list per style, layers in source order,
`inset` for inner shadows, each colour by the rule in 4.3. Layer and
background blurs have no `box-shadow` form; a style with no visible shadow is
omitted and reported `effect_not_expressible`, matching the DTCG rule.

No CSS classes are generated. Composition into `.heading-xl { ... }` is the
team's, and generating it was rejected with the composition layer in June.

### 4.5 Modes

The default context of every modifier lives at the root selector. Every other
context gets a block under a **mode selector**. The default selector template
is `[data-theme="{mode}"]`, with `{mode}` the context's file-name slug.

Nothing about a mode's name selects a media query. A collection whose modes
are called Light and Dark is not evidence that the team wants OS-driven
switching, and one called Compact and Comfortable is not a theme. The guide
tells the agent how to wire `data-theme` to `prefers-color-scheme` if that is
what the team wants.

When a Foundation has more than one modifier, one attribute cannot carry both
axes: a page can be dark and comfortable at once. The projection still emits
each context under the default template and reports `mode_selector_shared`
naming the modifiers, and `speclayer.json` can declare a selector per
collection:

```json
{
  "web": {
    "css": true,
    "root": ":root",
    "modeSelector": "[data-theme=\"{mode}\"]",
    "modes": { "Density": "[data-density=\"{mode}\"]" }
  }
}
```

`{collection}` is also available in a template. Selectors are written
verbatim; the CLI does not validate CSS.

## 5. The two adoption paths

### 5.1 Starting from scratch

```bash
npx spec-layer setup --id lib_... --key sl_... --platform web
npx spec-layer skill --install
```

An empty directory carries no platform signal, so `--platform web` on
`setup` (or `init`, or `pull`) is how the person says what they are building.
`setup` and `init` store it as `"platforms": ["web"]` in `speclayer.json`;
`pull` without the flag reads that, and without either falls back to root
detection exactly as `skill` does today. The result is `web/tokens.css` on the
first pull, and a guide whose web section says:

- Import `.speclayer/web/tokens.css` from the root stylesheet. Do not copy
  values out of it.
- Switch modes by setting `data-theme` on `<html>`; the file lists the modes
  and their default. Wire it to `prefers-color-scheme` yourself if you want
  the OS to choose.
- Build each component from `ai/components/<slug>.yaml`. Its `bindings`
  name the token per part, property, and condition; the CSS name for each is
  in `web/css.map.json`.

No scaffolding, no component skeletons, no framework choice. Those were the
hosted composition layer, rejected.

### 5.2 An existing repository

The existing contract holds: everything lands under one managed directory,
staged and swapped atomically, never outside it except the agent guide the
person asked for. Three additions:

- **Commit policy, stated.** `.speclayer/` is meant to be committed, all of
  it. The README and the guide say so. A team that would rather regenerate
  in CI adds it to `.gitignore` and runs `pull` in the pipeline; `status`'s
  exit `2` already supports that. Generated files change only when design
  data changes, and the free-publish work in progress makes a republish of
  unchanged content a no-op at the proxy, so `bundle.json` no longer churns
  on a rebuild.
- **A pipeline already present.** When detection finds Style Dictionary or
  Tokens Studio, the guide keeps pointing at `tokens/` and says that
  `web/tokens.css` is a projection of the same files, not a second source;
  import one or the other. `"web": { "css": false }` turns the file off for a
  team that finds the duplicate confusing.
- **Tailwind present.** Tailwind 4 reads CSS custom properties directly, so
  `web/tokens.css` is importable as-is. Mapping tokens into Tailwind's
  namespaces (`--color-*`, `--spacing-*`, `--radius-*`) needs to know that a
  `dimension` collection is spacing rather than radius, which the type alone
  does not say. That mapping stays with the team, as today's guide already
  says. A declared `web.tailwind` mapping is a possible later addition, not
  part of this change.

Components stay in `ai/components/`. Placing a brief beside the team's own
component file would need the anatomy-to-code mapping the conformance
proposal calls `speclayer.map.json`, which does not exist yet.

## 6. Where the projection runs

Only the CLI writes `web/`. The plugin's Foundation Copy for AI stays the DTCG
resolver document; a **Copy as CSS** action is one function call away once
`css.ts` exists, but the clipboard's real size and paste behaviour are still
an open row in the manual Figma matrix, and adding a second clipboard format
before the first has been observed in Figma would compound the unknown. The
published bundle is unchanged, so no proxy or bundle version change.

`pull` writes `web/` when `platforms` includes `web` and `web.css` is not
`false`. `manifest.json` records the `web` options beside `dtcg` so a config
change re-projects on the next pull without a republish, the same freshness
rule the DTCG block has.

## 7. Guide changes

`skill.ts` gains, in its web section: the import line, the `data-theme`
switch, the `css.map.json` lookup for names, and the "one source, not two"
sentence when a pipeline is detected. The sentence that currently tells the
agent to derive nothing when `code_syntax.WEB` is absent is replaced by a
pointer to `css.map.json`, which now holds the derived name and marks it
`derived`. The pull summary lists `web/tokens.css` and its mode selectors.

The plugin's Publish screen copies `setup ... && npx spec-layer skill
--install` today. It cannot know the platform; the command is unchanged, and
the greenfield path in 5.1 adds `--platform web` by hand or through the
guide's own advice.

## 8. Invariants

- **Never fabricate.** No unit, mode, media query, or value is inferred.
  Names are derived by a stated rule and recorded with provenance.
  Collisions are omitted and reported.
- **Projection, not source.** `css.ts` reads a `DtcgExport`; it never reads
  Figma, never feeds a hash, never justifies a schema change.
- **One interpretation of v5.** The CLI still re-derives nothing from the
  artifact; the DTCG projection is the only reader of v5, and CSS reads it.
- **`compareCodeUnits` for every ordering** under `src/v5`.
- **Stable output.** Same input, same bytes, on every machine. The header
  carries a content hash, not a time.
- **The managed directory is the boundary.** Nothing is written outside it
  except the agent guide.

## 9. Testing

- Golden: the synthetic DTCG fixture projects to a committed `tokens.css`,
  `css.map.json`, and `report.json`; byte comparison.
- Rules: declared name used, declared name without prefix, declared
  non-identifier falls through and reports; derived name for every segment
  shape in `dtcgSegments`; collision omits both and reports; reference to an
  omitted target omits and reports; every value type in 4.3; typography
  `%` and `px` line height, `%` letter spacing, `null` property; effect with
  no visible shadow; two modifiers report `mode_selector_shared`; per
  collection selector override; `web.css: false` writes nothing.
- Browser truth: the CSS the golden emits is parsed by a real CSS parser in
  the test. `postcss` and `lightningcss` are already in `node_modules` as
  transitive dependencies; one of them becomes an explicit extractor dev
  dependency. Every declaration must be a valid custom property with a
  non-empty value, and every `var()` target must be declared in the same
  file.
- CLI: `pull --platform web` writes `web/`; a manifest with a different `web`
  block is not up to date; `skill` names the file and the selectors.
- The Style Dictionary gate stays as it is. It is the proof for the other
  adoption path.

## 10. Not doing

- Tailwind namespace mapping, Sass or Less output, JavaScript token modules.
- CSS classes for typography or any composition.
- A `prefers-color-scheme` block chosen from a mode's name.
- Placing files outside `.speclayer/`.
- A CSS clipboard action in the plugin, until the matrix has observed the
  DTCG one.
- Renaming `.speclayer/` or moving `bundle.json`. Both were considered for
  the existing-repository path and neither earns its migration.

## 11. Open decisions

1. **Derive names at all.** Emitting CSS requires a name for every token
   without `code_syntax.WEB`. The recommendation is the rule in 4.2 with
   provenance in `css.map.json`. The alternative, emitting only declared
   names, produces an almost empty file for most libraries.
2. **Lowercase derived names.** Recommended, because CSS convention is
   lowercase kebab and collisions from case folding are reported rather than
   hidden. The alternative keeps source casing, which never collides but
   yields `--Foundation-colors-blue-500`.
3. **Include the collection in derived names.** Recommended, because DTCG
   paths are unique by construction and dropping the root reintroduces
   cross-collection collisions. Designers who want short names declare them.
4. **Default mode selector** `[data-theme="{mode}"]`, with a report when two
   modifiers share it. The alternative, `[data-{collection}="{mode}"]`, is
   always correct and always awkward.
5. **Write `web/` on web detection without an explicit flag.** Recommended,
   with `web.css: false` to opt out. The alternative is opt-in only, which
   makes the greenfield path one more flag long.
6. **Colour with alpha as `rgb(R G B / A)`** rather than `#rrggbbaa`.

## 12. Alternatives considered

- **Scaffold a Style Dictionary config on `init`.** Adds a dependency and a
  build step to a person who wanted a stylesheet, and Style Dictionary does
  not read `resolver.json`, so the mode wiring is hand-written anyway. It is
  the right answer for the pipeline path, where it already exists.
- **Improve the guide only.** Keeps the fabrication risk exactly where it is
  and makes the outcome depend on which agent runs the guide.
- **Emit CSS from the canonical artifact directly.** A second reader of v5,
  which the DTCG design ruled out for the CLI. Reading the DTCG export keeps
  one.
