# DTCG Foundation export

**Date:** 2026-09-03
**Status:** implemented 2026-09-03
**Scope:** Foundation Copy for AI in the plugin, the published bundle's foundation `ai` field, and the CLI `pull` output. Component Context v5 is unchanged except that its embedded tokens gain `code_syntax`.
**Reads with:** `docs/specs/foundation-context-v5.md`, `docs/specs/foundation-v5-status.md`, `packages/cli/README.md`, `docs/strategy/2026-09-02-design-conformance-pivot.md` section 6.1.

## Problem

Foundation Copy for AI and `spec-layer pull` deliver our own YAML dialect.
Nothing consumes it. An agent has to learn `alias / resolved / chain`, mode
labels like `Light [ModeID:p-light]`, and `{ number: 8, unit: px }`. The
synthetic fixture with about fifteen tokens renders to 235 lines; the reviewed
Company DS profile measured 2,539 lines and 108 KB. Neither Style Dictionary
nor Tokens Studio can read it, so a team that wants tokens in code writes a
second exporter.

The Neuron Token Sync repo shows the target shape: one DTCG file per
collection and mode, `{path}` references, a metadata sidecar, and Style
Dictionary building CSS from it directly. It also shows the traps: string
values that predate the stable format, unit inference by token name, lossy
slugging that cost a Figma rename, and unresolved aliases written as an invalid
value. Our canonical v5 artifact already holds every fact the DTCG format
needs, more precisely than Neuron's canonical map does. The gap is a
projection, not extraction.

## Decision

Add a **DTCG projection** as a third profile beside canonical and AI, in
`packages/extractor/src/v5/dtcg.ts`. It is downstream of validation, outside
every hash, and the canonical artifact stays the source of truth. The
projection replaces the AI YAML for foundations everywhere it was used:

| Surface | Before | After |
|---|---|---|
| Plugin Copy for AI, whole file and Library row scopes | AI profile YAML | one DTCG resolver document as JSON |
| Published bundle `foundation.ai` | AI profile YAML | the same DTCG resolver document |
| CLI `pull` | `ai/foundation.yaml` | `tokens/` directory: one DTCG file per collection and mode, `resolver.json`, style files, `spec-layer.meta.json`, `report.json` |
| CLI `show foundation` | AI YAML | the DTCG resolver document; `--canonical` unchanged |
| Component Copy for AI and `ai/components/*.yaml` | component AI YAML | unchanged, tokens in the dependency slice gain `code_syntax` |

`foundationAiContext` stays as a module because `componentAiContext` uses it
for the dependency slice. It is no longer a clipboard or bundle output for
foundations.

The four decisions taken on 2026-09-03:

1. Values default to the stable Design Tokens Format Module 2025.10 object
   forms. A `legacy` option emits the string forms Style Dictionary 4 and
   Tokens Studio read today.
2. DTCG replaces AI YAML for foundations. Component YAML improves later.
3. The projection runs in the CLI from the canonical artifact in
   `bundle.json`, and the plugin runs the same function for the clipboard and
   for the bundle's `foundation.ai`. One function, no second interpretation of
   v5.
4. A float whose Figma scopes state no unit stays `number` with the existing
   `UNIT_METADATA_UNAVAILABLE` diagnostic. Declared per-path overrides in
   `speclayer.json` may promote it to `dimension`. No name heuristics.

## Format

### Files

```text
tokens/
  <collection-slug>.<mode-slug>.json     one per collection and mode
  styles.typography.json                 typography styles, when present
  styles.effects.json                    effect styles, when present
  resolver.json                          Design Tokens Resolver Module 2025.10
  spec-layer.meta.json                   per-token Figma metadata, keyed by DTCG path
  report.json                            what the projection could not express
```

Slugs appear only in file names, lowercase, `[a-z0-9-]`, with a numeric
suffix on collision. The five fixed names above are reserved, so a collection
named "Styles" with a mode "Typography" takes `styles.typography-2.json`
rather than overwriting the style file. Inside a file every group key is the
source segment verbatim.

### Token tree

Each mode file is rooted at the collection name so a reference resolves
without re-nesting:

```json
{
  "Mapped Colors": {
    "color": {
      "surface": {
        "primary": {
          "default": {
            "$type": "color",
            "$value": "{Foundation.colors.blue.500}",
            "$description": "Primary surface."
          }
        }
      }
    }
  }
}
```

`$description` is emitted when the source description is non-empty.
Generated group descriptions from `guidelines` become `$description` on the
matching group.

### Names

Figma names split on `/` into segments, as `path` already does. DTCG forbids
`.`, `{`, `}` in a name and a leading `$`. Rules, in order:

- A `.` inside a segment splits that segment into nested groups. Material
  style names such as `md.sys.color.primary` become the groups `md`, `sys`,
  `color`, `primary`. Reported as `segment_split`, severity info.
- `{` and `}` become `_`, a leading `$` becomes `_$`. Reported as
  `name_escaped`, severity warning, with the original name.
- An empty segment becomes `_`. Reported as `name_escaped`.
- Two tokens that reach the same DTCG path after these rules are both omitted
  and reported as `path_collision`, severity error. Picking one would be a
  fabrication.

Casing is preserved. There is no slugging inside files.

Style paths collide by keeping the first style in artifact order and omitting
later ones, because styles are already ordered by the source and dropping both
would lose a style for a sibling's defect.

### Values

`standard` is the default. `legacy` is the alternative.

| Canonical | `standard` | `legacy` |
|---|---|---|
| `color` | `{ "colorSpace": "srgb", "components": [r, g, b], "alpha": a, "hex": "#rrggbb" }`; components from `channels` when present, else `hex / 255` rounded through `canonicalNumber` | `"#rrggbb"`, or `"#rrggbbaa"` when alpha is below 1 |
| `dimension` px or rem | `{ "value": n, "unit": "px" }` | `"16px"` |
| `dimension` `%`, `em`, `deg` | not a DTCG dimension unit; omitted and reported `unit_not_expressible` | same |
| `number` with `FONT_WEIGHT` scope | `$type: fontWeight`, numeric | same |
| `number` otherwise | `$type: number`, numeric | same |
| `duration` | `{ "value": n, "unit": "ms" }` | `"200ms"` |
| `cubic_bezier` | `$type: cubicBezier`, four numbers | same |
| `font_family` | `$type: fontFamily`, string | same |
| `string`, `boolean` | no DTCG type; omitted, reported `type_not_expressible`, values kept in the sidecar | same |

Only a scope pins `fontWeight`, matching the rule in `units.ts` that a name is
never evidence.

### Units

Unit overrides are declared in `speclayer.json`:

```json
{
  "dtcg": {
    "values": "standard",
    "units": { "Foundation/spacing/*": "px", "Foundation/radius/*": "px" }
  }
}
```

A key is a collection name, `/`, then a glob over the Figma name with `*`
matching any run of characters. An override applies to a `number` token whose
scopes state no unit and promotes it to `dimension` with that unit. An override
that contradicts a stated scope such as `FONT_WEIGHT` or `OPACITY` is ignored
and reported `unit_override_conflicts_with_scope`. The plugin has no config, so
the clipboard document carries no overrides.

### Aliases

A local alias becomes `"{Collection.segment.segment}"` with the target's DTCG
path. Its `$type` is the type the token it references projects to, not the type
its own scopes would give the resolved value, because DTCG requires a
referencing token's `$type` to match the referenced token's. A unit override or
a `FONT_WEIGHT` scope on the target therefore reaches every alias to it. A
chain takes the type of the token that holds the literal, which is the same
answer as asking each direct target for its own projected type in turn.

Which mode of the target applies is decided by the consumer's resolver
contexts, which matches the artifact's mode policy of exact name match. When a
chain hop was resolved by the collection default instead of a same-named mode,
the reference is still emitted and the token is reported
`mode_selection_not_expressible` with the resolved snapshot, because DTCG has
no per-alias mode. The entry is emitted only when the target collection has
more than one mode; a single-mode target resolves identically in every
context.

A value that is `missing`, an unresolved alias of any reason, or an external
alias produces no leaf in that mode file and a `report.json` entry with the
reason, the target path, and the library name when Figma stated one. An
unresolved value is never written as a literal and never as a fake reference.

### Styles

Typography styles map to the `typography` composite:

```json
{
  "Typography styles": {
    "Heading": {
      "XL": {
        "$type": "typography",
        "$value": {
          "fontFamily": "Open Sans",
          "fontSize": "{Foundation.font-size.850}",
          "fontWeight": 700,
          "letterSpacing": { "value": 0, "unit": "px" }
        },
        "$extensions": {
          "com.spec-layer": {
            "lineHeight": { "value": 50, "unit": "px" },
            "paragraphSpacing": { "value": 0, "unit": "px" },
            "paragraphIndent": { "value": 0, "unit": "px" },
            "textCase": "original",
            "textDecoration": "none"
          }
        }
      }
    }
  }
}
```

A property whose source is an alias becomes a reference. A property whose
resolved value is `null` is omitted from `$value` and reported. Letter spacing
in `%` cannot be a DTCG dimension: it goes under `$extensions` as
`{ "value": n, "unit": "%" }` and is reported `unit_not_expressible`.

A property bound to a token the export does not carry keeps its resolved
literal and is reported `binding_dropped` with the target id and whether the
target was unavailable or omitted.

Line height follows the same shape for a different reason. The stable format
says `lineHeight` MUST be a number or a reference to a number token, read as a
multiplier of the font size, so a measured `px` or `%` line height has no home
in `$value`. Dividing it by the font size would derive a figure Figma never
stated. A `dimension` line height, whether a literal or a binding, goes under
`$extensions["com.spec-layer"].lineHeight` as `{ "value": n, "unit": u }` and is
reported `unit_not_expressible` with `details.property = "lineHeight"`. A
`number` line height, which is what Figma's auto line height and a multiplier
produce, stays in `$value`, as a reference when it is bound to a number token.

Effect styles map to `shadow`. Visible drop and inner shadows become the
`$value` array in source order, each
`{ "color", "offsetX", "offsetY", "blur", "spread", "inset" }`, with `inset`
true for inner shadows. A bound property becomes a reference. Layer and
background blurs, and hidden layers, have no DTCG home: they go under
`$extensions["com.spec-layer"].layers` in source order with their kind and
visibility, and the style is reported `effect_not_expressible` when it has no
visible shadow at all.

Style files are resolver sets, ordered after every collection.

### Resolver

```json
{
  "version": "2025.10",
  "name": "Company Foundations",
  "sets": {
    "Foundation": { "sources": [{ "$ref": "foundation.mode-1.json" }] },
    "Typography styles": { "sources": [{ "$ref": "styles.typography.json" }] }
  },
  "modifiers": {
    "Mapped Colors": {
      "contexts": {
        "Light": [{ "$ref": "mapped-colors.light.json" }],
        "Dark": [{ "$ref": "mapped-colors.dark.json" }]
      },
      "default": "Light"
    }
  },
  "resolutionOrder": [
    { "$ref": "#/sets/Foundation" },
    { "$ref": "#/modifiers/Mapped Colors" },
    { "$ref": "#/sets/Typography styles" }
  ]
}
```

A single-mode collection is a set. A multi-mode collection is a modifier named
by the collection, one context per mode in source order, `default` from
`default_mode_id`. Two collections that share mode names are still two
modifiers; merging them would name a modifier the file never named. Keys in
`resolutionOrder` are JSON pointers with `~` and `/` escaped per RFC 6901.
Collection order follows the artifact.

Figma allows two collections to share a display name, so a set or modifier is
keyed by the collection **label**, by the same rule modes use: the bare name
when it is unique across the artifact, otherwise `Name [collection id]`. The
`resolutionOrder` pointer uses the same label. Each colliding collection is
reported `collection_name_collision`, severity warning, with `path` set to the
label and `details.ids` listing every colliding id. The group root inside each
token file is unchanged: it stays the escaped collection name, so DTCG paths
and references do not move. Two collections whose names collide already produce
`path_collision` for any token paths that collide as a result.

### Sidecar

`spec-layer.meta.json` is keyed by DTCG path:

```json
{
  "Foundation.colors.blue.500": {
    "id": "VariableID:1240:39140",
    "collection_id": "VariableCollectionId:1239:1",
    "type": "color",
    "scopes": ["ALL_SCOPES"],
    "code_syntax": { "WEB": "--colors-blue-500" },
    "publication": { "published": true, "hidden_from_publishing": false }
  }
}
```

Omitted tokens keep an entry with `"omitted": true` and their canonical values
by mode label, so nothing the plugin read is lost on the way to disk. A token
omitted for `path_collision` is keyed `"<path> [<token id>]"` instead, because
the colliding tokens share a path and the path alone would let one record
overwrite the other.

### Report

`report.json` is an array of `{ code, severity, path, mode?, message,
details }`. Codes: `segment_split`, `name_escaped`, `path_collision`,
`type_not_expressible`, `unit_not_expressible`,
`unit_override_conflicts_with_scope`, `mode_selection_not_expressible`,
`value_omitted` with `details.reason` copied from the canonical value,
`effect_not_expressible`, `duplicate_code_syntax`,
`collection_name_collision`, `binding_dropped` with `details.target_id` and
`details.reason` (`target_unavailable` when the id is not a token in the
artifact, `target_omitted` when it is a token this projection omitted). The
report is the DTCG
counterpart of `diagnostics`; it never replaces them. Paths are DTCG paths,
and `details.id` carries the stable Figma id.

`mode` is the resolver context label, not the raw display name, so an entry
about one of two same-named modes names the context and the file it came from.
`details.target_mode` on `mode_selection_not_expressible` is the target
collection's label for the hop mode by the same rule. Whether that entry is
raised is still decided by comparing display names, because an exact name match
is the mode policy Figma applied.

### Clipboard document

The plugin copies one JSON document: the resolver document with inline
sources instead of `$ref` files, plus

```json
"$extensions": {
  "com.spec-layer": {
    "schema_version": "5.1.0",
    "content_hash": "sha256:...",
    "source": { "provider": "figma", "file_name": "Company Foundations" },
    "completeness": { "collections": "complete", "styles": "complete", "unavailable_sources": [] },
    "code_syntax": { "Foundation.colors.blue.500": { "WEB": "--colors-blue-500" } },
    "report": [ ... ]
  }
}
```

The resolver module allows inline token objects as sources. Whether it allows
`$extensions` at the document root is not stated in the draft; the projection
emits it because the format's own extension rule is that unknown
`$`-prefixed members are for tools, and the report is the honest place for
what the document could not express. `content_hash` points at the canonical
artifact the document was projected from.

## `code_syntax` in Foundation Context v5

The plugin reads `codeSyntax` at the audit boundary and v5 drops it. Add an
optional `code_syntax` object keyed by platform to the token record, in the
semantic payload, as the pivot document proposed. This is schema `5.1.0` for
both Foundation and Component Context, since the component schema references
the foundation token definition by URI. It moves `semanticContentHash` for
every artifact whose tokens carry a code syntax. It does not touch
`specContentHash`, `foundationContentHash`, or `EXTRACTOR_VERSION`. The AI
profile carries `code_syntax` on tokens so component copies see it.

## Where the projection runs

`packages/extractor/src/v5/dtcg.ts` exports:

```ts
export function foundationDtcg(artifact: FoundationArtifactV5, options?: DtcgOptions): DtcgExport;
export function foundationDtcgDocument(artifact: FoundationArtifactV5, options?: DtcgOptions): DtcgDocument;
```

`DtcgExport` holds `files`, `resolver`, `meta`, and `report` as plain objects
keyed by relative file name. `foundationDtcgDocument` builds the clipboard
document from the same pieces. Both are pure, synchronous, ordered by
`compareCodeUnits` wherever the source gives no order, and they never mutate
the artifact. Neither participates in a hash.

The plugin calls `foundationDtcgDocument` in `foundationAiYaml`'s place for
the whole-file and scoped copies and in `buildPublishBundle` for
`foundation.ai`. The CLI calls `foundationDtcg` inside `writeBundleFiles` on
the bundle's canonical foundation artifact, after a Level 1 validation so a
malformed artifact fails with a plain sentence rather than a stack trace. That
validation is a shape check on the wire, not a re-derivation of v5 output, and
`ARCHITECTURE.md` records it.

## Acceptance

- Unit tests per rule in `packages/extractor/test/v5/dtcg.test.ts`, using the
  synthetic direct fixture and small hand-built artifacts.
- A golden `packages/extractor/test/fixtures/v5/synthetic-foundation-dtcg/`
  directory, one file per output, regenerated only by an explicit update
  command and reviewed in the diff.
- Style Dictionary 5.5.2 as a root devDependency. A test builds the `legacy`
  flavour of the synthetic fixture through Style Dictionary with `usesDtcg:
  true` to a temp directory and asserts the CSS contains resolved `var()`
  references, and loads the `standard` flavour and asserts every reference
  resolves. This is the Neuron gate made automatic. `npm audit` must stay
  clean after the dependency lands.
- Plugin copy tests parse the clipboard JSON and assert the resolver shape,
  the `$extensions` block, and that scoped copies keep their closure.
- CLI tests assert `pull` writes `tokens/` with the resolver and sidecar,
  `--only components` writes none of it, and `show foundation` prints the
  document from the bundle.
- The manual matrix in `packages/plugin/TESTING.md` rows 2 and 4 and the
  Library scoped-copy rows are rewritten for the DTCG document and remain the
  release gate.

## Out of scope

- Component Context changes beyond `code_syntax` on embedded tokens.
- Writing tokens back to Figma. This export is one direction.
- A `diff`, `validate`, or `check` command. They stay in the pivot plan.
- Publishing the DTCG files in the bundle. The CLI projects from canonical, so
  the bundle shape and `LIBRARY_BUNDLE_VERSION` stay at 1.0.0. Older CLIs
  write the new `foundation.ai` JSON into `ai/foundation.yaml`, which is valid
  YAML.
