---
title: Foundation Context v5
status: Proposed
schema_version: 5.0.0
adopted: 2026-08-27
---

# Foundation Extractor Improvement Specification

**Status:** Proposed
**Target schema:** Foundation Context v5
**Audience:** Extractor engineers, design-system engineers, code-generator authors
**Primary use case:** Produce a deterministic, self-describing foundation export that can safely bootstrap and update a code design system.

## 1. Purpose

The extractor must convert a Figma foundation library into a portable context artifact that is:

- complete enough to generate code foundations;
- deterministic across repeated exports;
- explicit about types, units, modes, references, and unresolved dependencies;
- traceable back to stable Figma entities;
- safe to validate, diff, migrate, and compile;
- loss-aware: unsupported or ambiguous source data must be reported, not silently discarded.

The exported artifact is an interchange contract. It is not itself the public code-token API, and it must not silently apply product-design opinions or "correct" source values.

## 2. Normative language

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** describe requirement strength.

## 3. Goals

The v5 export MUST support:

1. Primitive tokens: color, dimension, number, string, boolean, duration, cubic Bézier, and font family.
2. Semantic tokens with one or more modes.
3. Internal and cross-library aliases.
4. Both original and resolved values.
5. Composite typography, shadow, blur, and ring styles.
6. Stable source identity for collections, modes, variables, and styles.
7. Publication and lifecycle metadata.
8. Machine-readable diagnostics.
9. Deterministic serialization and semantic diffing.
10. Forward-compatible handling of unknown fields and unsupported Figma types.

## 4. Non-goals

## 5. Export contract

### 5.1 Envelope

Every export MUST have a top-level envelope:

```yaml
spec_layer:
  kind: foundation
  schema_version: "5.0.0"
  schema_uri: "https://example.company/schemas/foundation-context/v5.json"
  extractor:
    name: spec-layer-foundation
    version: "2.0.0"
    build: "git-sha-or-build-id"
  export:
    id: "stable-or-random-export-id"
    generated_at: "2026-08-27T12:00:00.000Z"
    deterministic: true
    content_hash: "sha256:..."
  source:
    provider: figma
    file_id: "stable-file-id"
    file_name: "Company Foundations"
    file_version: "figma-version-id-if-available"
    library_enabled: true
```

Requirements:

- `schema_version` MUST use semantic versioning.
- Extractor version and schema version MUST be separate.
- Timestamps MUST use ISO 8601 UTC strings.
- `content_hash` MUST exclude volatile fields such as `generated_at` and `export.id`.
- If a source field is unavailable, it MUST be `null` or omitted according to the schema; placeholder strings are forbidden.

### 5.2 Top-level sections

The artifact MUST expose these sections:

```yaml
collections: []
tokens: []
styles:
  typography: []
  effects: []
diagnostics: []
statistics: {}
```

Tokens SHOULD be stored in a flat top-level array and reference a collection by ID. A nested compatibility view MAY also be emitted, but it must not become a second source of truth.

## 6. Stable identity and names

Every collection, mode, token, and style MUST include:

```yaml
id: "figma-stable-id-or-namespaced-source-id"
name: "Source display name"
path: ["Source", "Display", "Segments"]
```

Rules:

- `id` MUST be stable across renames and moves whenever Figma exposes stable identity.
- `name` and `path` MUST preserve source text after Unicode NFC normalization.
- The extractor MUST NOT replace source names with generated code names.
- An optional `suggested_code_name` MAY be emitted for convenience.
- The extractor MUST detect normalized-path collisions.
- Non-ASCII or confusable characters MUST be preserved and reported with a diagnostic.
- Consumers MUST use `id`, not `name`, as identity.

Example:

```yaml
id: "VariableID:123:456"
name: "Background/Chip/Chip (Hover)"
path: ["Background", "Chip", "Chip (Hover)"]
suggested_code_name: "background.chip.hover"
```

## 7. Collections and modes

```yaml
collections:
  - id: "VariableCollectionId:1:2"
    name: "Display mode"
    path: ["Display mode"]
    default_mode_id: "1:2/light"
    modes:
      - id: "1:2/light"
        name: "light"
        order: 0
      - id: "1:2/dark"
        name: "dark"
        order: 1
    publication:
      published: true
      hidden_from_publishing: false
    source:
      remote: false
```

Requirements:

- Modes MUST have stable IDs, names, and source order.
- Token values MUST be keyed by mode ID, not mode display name.
- The default mode MUST reference a declared mode ID.
- An absent mode value MUST be distinguishable from an explicit `null` value.
- Identical values across every mode MAY produce an informational diagnostic; they MUST NOT be automatically collapsed.

## 8. Token model

### 8.1 Token record

```yaml
- id: "VariableID:3:4"
  collection_id: "VariableCollectionId:1:2"
  name: "Background/Surface/Page"
  path: ["Background", "Surface", "Page"]
  type: color
  description: "Use for a page or screen background."
  scopes: ["FRAME_FILL", "SHAPE_FILL"]
  publication:
    published: true
    hidden_from_publishing: false
  lifecycle:
    status: active
    replacement_id: null
  values:
    "1:2/light": { ... }
    "1:2/dark": { ... }
```

### 8.2 Required metadata

Each token MUST include:

- stable token ID;
- collection ID;
- original name and segmented path;
- explicit token type;
- description, including an empty string when none exists;
- available Figma scopes;
- publication state;
- lifecycle state;
- one value entry for every declared mode, or an explicit missing-value record.

## 9. Canonical value representation

Every value MUST be a discriminated object. A mode value MUST never alternate between a raw string, number, and object.

### 9.1 Literal

```yaml
kind: literal
value:
  type: color
  color_space: srgb
  hex: "#006b62"
  alpha: 1
```

### 9.2 Alias

```yaml
kind: alias
reference:
  target_id: "VariableID:color-teal-500"
  target_collection_id: "VariableCollectionId:color-base"
  target_path: ["color", "teal-green", "500"]
  external: false
resolved:
  status: resolved
  value:
    type: color
    color_space: srgb
    hex: "#006b62"
    alpha: 1
  chain:
    - "VariableID:color-teal-500"
```

### 9.3 Unresolved alias

```yaml
kind: alias
reference:
  target_id: null
  target_collection_id: null
  target_path: ["coolGray-80"]
  external: true
  source_library_name: "Color base [deprecated]"
resolved:
  status: unresolved
  reason: source_library_unavailable
  value: null
  chain: []
```

An unresolved alias MUST NOT be serialized as though it were an ordinary literal. It MUST create an error diagnostic.

### 9.4 Missing value

```yaml
kind: missing
reason: no_value_for_mode
```

### 9.5 Dimensions and numbers

Dimensions MUST include a unit:

```yaml
kind: literal
value:
  type: dimension
  number: 16
  unit: px
```

Supported units SHOULD include `px`, `rem`, `em`, `%`, `deg`, `ms`, and `s`. Unitless numbers MUST use `type: number` rather than `type: dimension`.

Examples:

- spacing, corner radius, border width, font size, line height in pixels, and shadow geometry: `dimension` + `px`;
- font weight and opacity: `number`;
- letter spacing: `dimension` with the original unit;
- duration: `duration` with `ms` or `s`.

### 9.6 Colors

- Colors MUST use an explicit color space.
- Hex MUST use six lowercase hexadecimal digits.
- Alpha MUST be a number from 0 through 1.
- Fully opaque colors MUST still include `alpha: 1`.
- The extractor MUST preserve source color channels when they are more precise than an 8-bit hex value.
- A color alias plus a local alpha override MUST retain both facts if the source format exposes them.

## 10. Alias graph

The extractor MUST build an alias graph across all available source libraries.

It MUST report:

- unresolved targets;
- alias cycles;
- type mismatches between alias and target;
- missing mode mappings;
- references to unavailable libraries;
- references to deprecated tokens;
- resolution chains exceeding a configurable depth.

Resolved values MUST be included as a snapshot for portability, while the reference remains authoritative for lineage.

Changing an alias target without changing the resolved value MUST still appear in a semantic diff.

## 11. Typography styles

Typography MUST be represented as a composite style, not only as unrelated primitive tokens:

```yaml
styles:
  typography:
    - id: "S:typography-heading-xl"
      name: "Heading/XL"
      path: ["Heading", "XL"]
      description: ""
      publication:
        published: true
      lifecycle:
        status: active
      properties:
        font_family:
          source: { kind: literal }
          resolved: { type: font_family, value: "Open Sans" }
        font_weight:
          source: { kind: literal }
          resolved: { type: number, value: 700 }
        font_size:
          source:
            kind: alias
            target_id: "VariableID:font-size-850"
          resolved: { type: dimension, number: 42, unit: px }
        line_height:
          source:
            kind: alias
            target_id: "VariableID:line-height-950"
          resolved: { type: dimension, number: 50, unit: px }
        letter_spacing:
          source: { kind: literal }
          resolved: { type: dimension, number: -1, unit: "%" }
        paragraph_spacing:
          source: { kind: literal }
          resolved: { type: dimension, number: 0, unit: px }
        text_case: original
        text_decoration: none
```

Requirements:

- Every supported Figma text-style property MUST be exported.
- Each property MUST preserve its variable binding when available.
- Each property MUST include a resolved value.
- Font style names such as `SemiBold` MUST be accompanied by a numeric weight when determinable.
- Missing font metadata MUST produce a diagnostic rather than a guessed weight.
- Mixed units such as zero pixels versus zero percent MUST be preserved at source level and MAY be normalized downstream.

## 12. Effect styles

Effects MUST be exported as ordered composites:

```yaml
styles:
  effects:
    - id: "S:shadow-card"
      name: "Shadow/Card"
      mode_id: "1:2/light"
      effects:
        - type: drop_shadow
          visible: true
          blend_mode: normal
          color:
            type: color
            color_space: srgb
            hex: "#000000"
            alpha: 0.02
          offset_x: { type: dimension, number: 0, unit: px }
          offset_y: { type: dimension, number: 2, unit: px }
          blur: { type: dimension, number: 8, unit: px }
          spread: { type: dimension, number: 0, unit: px }
          show_behind_node: false
```

Requirements:

- Effect order MUST be preserved.
- Drop shadow, inner shadow, layer blur, and background blur MUST be distinguished.
- All geometry MUST have units.
- Variable bindings MUST be preserved per effect property when available.
- If scalar variables and a style describe the same composite effect, their relationship MUST be exported explicitly through `bindings`.
- The extractor MUST NOT infer that similarly named effects are equivalent.
- Conflicting resolved values between declared bindings and style values MUST produce a drift diagnostic.

Example binding metadata:

```yaml
bindings:
  - property: effects[0].offset_y
    token_id: "VariableID:shadow-card-0-offset-y"
```

## 13. Publication and source metadata

Where available, export:

```yaml
publication:
  published: true
  hidden_from_publishing: false
source:
  remote: false
  library_file_id: null
  library_name: null
  modified_at: null
```

This allows consumers to exclude local experiments, archived styles, or unavailable remote dependencies without relying on display-name patterns.

## 14. Diagnostics

Diagnostics MUST be structured and refer to stable entity IDs:

```yaml
diagnostics:
  - code: UNRESOLVED_EXTERNAL_ALIAS
    severity: error
    entity_id: "VariableID:3:4"
    mode_id: "1:2/dark"
    message: "Alias coolGray-80 could not be resolved because its source library is unavailable."
    details:
      source_library: "Color base [deprecated]"
```

### 14.1 Required diagnostic codes

At minimum:

| Code | Default severity | Meaning |
|---|---|---|
| `UNRESOLVED_ALIAS` | error | Internal alias target is missing. |
| `UNRESOLVED_EXTERNAL_ALIAS` | error | External target could not be loaded. |
| `ALIAS_CYCLE` | error | Alias graph contains a cycle. |
| `ALIAS_TYPE_MISMATCH` | error | Alias and target types differ. |
| `MISSING_MODE_VALUE` | error | A token has no value for a declared mode. |
| `DUPLICATE_SOURCE_ID` | error | Two entities share a stable ID. |
| `PATH_COLLISION` | error | Two entities normalize to the same collection path. |
| `UNSUPPORTED_VALUE_TYPE` | error | A source value cannot be represented. |
| `INCONSISTENT_VALUE_SHAPE` | error | Legacy compatibility output contains mixed shapes. |
| `STYLE_BINDING_DRIFT` | warning | Bound token value and style property differ. |
| `CONFUSABLE_NAME` | warning | A name contains non-ASCII/confusable characters. |
| `INFERRED_LIFECYCLE` | warning | Lifecycle was inferred from a name. |
| `DEPRECATED_REFERENCE` | warning | An active entity references a deprecated entity. |
| `MODE_VALUES_IDENTICAL` | info | Every mode resolves to the same value. |
| `MISSING_DESCRIPTION` | info | A published semantic token lacks documentation. |
| `GENERATED_NAME_COLLISION` | warning | Suggested code names collide. |

### 14.2 Exit behavior

- Extraction SHOULD finish and emit an artifact even when diagnostics contain errors, unless source access fails completely.
- Validation MUST return a non-zero status when error diagnostics exist.
- Strict mode MAY promote selected warnings to errors.

## 15. Statistics

Every export SHOULD include summary statistics:

```yaml
statistics:
  collections: 6
  modes: 9
  tokens: 464
  styles:
    typography: 99
    effects: 39
  aliases:
    total: 357
    resolved: 354
    unresolved: 3
  lifecycle:
    active: 402
    deprecated: 0
    archived: 62
  diagnostics:
    error: 3
    warning: 0
    info: 0
```

Statistics are informative and MUST be derivable from the artifact. Validators SHOULD verify them.

## 16. Determinism

Given the same Figma source version and extractor version, repeated exports MUST produce semantically identical artifacts.

Rules:

- Collections and modes preserve source order.
- Tokens and styles use a documented stable ordering, preferably collection order followed by source order.
- Object keys use schema-defined ordering in YAML output or canonical ordering for hashing.
- Hex casing, numeric precision, booleans, nulls, and enum casing are normalized.
- Volatile metadata is excluded from the content hash.
- Floating-point values MUST use a documented precision policy and MUST NOT contain binary floating-point artifacts.

## 17. Semantic diff

The extractor package SHOULD provide a diff command that classifies changes:

```text
added
removed
renamed
moved
value_changed
alias_target_changed
mode_added
mode_removed
publication_changed
lifecycle_changed
description_changed
binding_changed
```

Diff identity MUST be based on stable source IDs. A rename or move MUST NOT appear as deletion plus addition.

The diff SHOULD distinguish source changes from resolved-value changes.

## 18. Validation levels

### Level 1: Schema validity

- Required fields exist.
- Enums, units, and discriminated value shapes are valid.
- IDs have the correct form.

### Level 2: Referential integrity

- Collection, mode, alias, replacement, and binding references resolve.
- Alias graphs are acyclic.
- Types are compatible.

### Level 3: Export completeness

- Every source entity in scope appears exactly once.
- Every token contains a record for every collection mode.
- All supported style properties are present.
- Unsupported data has a diagnostic.

### Level 4: Code-generation readiness

- No error diagnostics.
- No unresolved aliases.
- All dimensions have units.
- Published entities have unique generated code names.
- Composite styles have complete resolved values.

Design quality and accessibility validation are separate optional stages and MUST NOT be conflated with extractor fidelity.

## 19. Backward compatibility

- Schema breaking changes require a new major `schema_version`.
- Additive optional fields require a minor version.
- Clarifications or validator fixes require a patch version.
- The extractor repository MUST include migrations from supported prior major versions.
- Unknown additive fields MUST be ignored by consumers unless strict schema mode is requested.
- Removed fields MUST be documented with migration guidance.

## 20. CLI/API surface

Recommended CLI:

```bash
spec-layer extract foundation --file <figma-file-id> --out foundation.yaml
spec-layer validate foundation.yaml
spec-layer normalize foundation-v4.yaml --out foundation-v5.yaml
spec-layer diff previous.yaml current.yaml
```

Recommended flags:

```text
--strict
--include-archived
--include-unpublished
--resolve-remote-libraries
--emit-legacy-nested-view
--format yaml|json
--diagnostics-file <path>
```

The programmatic API SHOULD return the artifact and diagnostics separately so callers can decide whether to persist partially valid exports.

## 21. Acceptance criteria

The extractor is ready for v5 when all of the following pass.

### 21.1 Golden fixture

Using the current Company DS foundation fixture:

1. All six collections are exported with stable IDs.
2. Every declared mode has a stable ID.
3. Every token and style has a stable source ID.
4. All internal aliases resolve with complete resolution chains.
5. The three deprecated external references are represented as unresolved aliases and create error diagnostics.
6. Raw color strings and `{hex, alpha}` records normalize to the same canonical color shape.
7. Dimensional floats receive explicit units without changing their numeric values.
8. The Cyrillic `С` in the Chip path is preserved and creates `CONFUSABLE_NAME`.
9. Archived text styles retain their source names and receive `lifecycle.status: archived` plus `INFERRED_LIFECYCLE` when explicit metadata is unavailable.
10. Identical typography mode values are preserved and MAY create `MODE_VALUES_IDENTICAL` information diagnostics.
11. Card shadow representations are preserved independently; any explicit binding disagreement creates `STYLE_BINDING_DRIFT`.
12. Repeated extraction produces the same semantic content hash.

### 21.2 Automated tests

Required test suites:

- schema fixtures for every value type;
- alias chains, cycles, missing targets, and type mismatches;
- cross-library alias resolution;
- mode completeness;
- Unicode normalization and confusable names;
- stable ID rename and move behavior;
- typography property completeness;
- ordered multi-effect shadows;
- numeric precision and unit preservation;
- deterministic output and hashing;
- v4-to-v5 migration;
- semantic diff classification;
- large-file performance regression.

### 21.3 Performance target

For a foundation file containing up to 10,000 tokens and 2,000 styles, the extractor SHOULD:

- complete normalization and validation in under 5 seconds after source data has been fetched;
- use less than 500 MB of memory;
- produce actionable progress and failure messages;
- avoid quadratic alias resolution by memoizing resolved chains.

## 22. Recommended implementation sequence

### Phase 1 — Canonical schema and normalizer

- Define the v5 JSON Schema.
- Implement discriminated value objects.
- Add explicit units and color-space metadata.
- Provide v4-to-v5 normalization.
- Add schema and deterministic-output tests.

### Phase 2 — Identity and references

- Export stable source IDs for all entities.
- Key values by mode ID.
- Build and validate the alias graph.
- Preserve resolved snapshots and resolution chains.
- Implement external-reference diagnostics.

### Phase 3 — Composite styles and lifecycle

- Export complete typography properties and bindings.
- Export ordered effect composites and bindings.
- Add publication and lifecycle metadata.
- Add drift, archive-inference, and confusable-name diagnostics.

### Phase 4 — Tooling and adoption

- Add `validate`, `normalize`, and semantic `diff` commands.
- Publish golden fixtures.
- Integrate validation into CI.
- Build the first CSS/TypeScript token compiler against normalized v5—not against raw Figma output.

## 23. Definition of done

The improved extractor is done when a downstream compiler can generate a deterministic foundation package without:

- guessing units;
- switching on multiple shapes for the same value type;
- using display names as identity;
- silently dropping unsupported values;
- accessing the original Figma file to resolve ordinary aliases;
- choosing arbitrarily between duplicate token and style representations;
- parsing archive, mode, or publication state from names.

The artifact may still contain explicit diagnostics, but it must always explain what is incomplete and preserve enough source context to repair or re-extract it.
