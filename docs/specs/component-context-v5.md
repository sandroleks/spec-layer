---
title: Component Context v5
status: Implemented; manual real-Figma gate open
schema_version: 5.0.0
last_updated: 2026-08-29
---

# Component Context v5

Component Context v5 is the canonical and clipboard contract for one Figma
component. It combines measured component facts with exact references into a
validated Foundation Context v5 dependency slice.

The contract does not generate implementation advice. Every semantic field is
read from Figma or deterministically derived from extracted facts. Previously
saved AI-written guidelines are retained under a clearly marked `guidelines`
block and excluded from semantic hashes.

## Product workflow

Foundation Context establishes the complete token/style vocabulary. Component
Context then describes one component and references that vocabulary by stable
Figma identity. A component copy carries both:

- `foundation_hash`, which identifies the complete Foundation Context an agent
  may already have in its conversation; and
- a self-contained dependency slice containing only the collections, tokens,
  typography styles, effect styles, and local alias closure that this component
  uses.

The dependency slice makes a component copy useful on its own without repeating
an entire design system for every component.

## Canonical envelope

The canonical artifact uses the published schema at:

`https://spec-layer.com/schemas/component-context/v5.json`

Its envelope separates schema version, extractor compatibility, volatile export
metadata, and source identity:

```yaml
spec_layer:
  kind: component
  schema_version: 5.0.0
  schema_uri: https://spec-layer.com/schemas/component-context/v5.json
  extractor: { name: spec-layer-component, version: "2", build: null }
  export:
    id: component:1:100:...
    generated_at: ...
    deterministic: true
    content_hash: sha256:...
  source:
    provider: figma
    file_id: ...
    file_name: Design System
    file_version: null
    library_enabled: null
    node_id: "1:100"
    node_name: Button
    component_key: ...
```

## Semantic payload

The component semantic hash covers:

- component identity visible to an implementer (`name`, `related`);
- API, exact-path anatomy, and default-variant layout facts;
- exact used references and minimized conditional bindings;
- the canonical Foundation dependency semantic payload;
- inline effects and hardcoded/unbound facts.

It excludes source/envelope metadata, whole-file `foundation_hash`, generated
guidelines, diagnostic wording, and derived component validation. An unrelated
Foundation change therefore moves the whole Foundation hash but does not move a
component hash whose dependency slice is unchanged.

Existing `specContentHash` and `foundationContentHash` remain separate canvas
drift contracts. Component Context v5 does not change either one.

## Reference identity and resolution

Every used reference carries:

```yaml
- source_id: VariableID:1
  name: color/surface/primary
  kind: variable
  remote: false
  collection_id: VariableCollectionId:1
  status: resolved
```

Bindings join to `used` on `(kind, source_id)`, never on display name:

```yaml
- path: Container/label
  property: fill
  source_id: VariableID:1
  kind: variable
  when: { Style: [Outlined] }
```

Resolution status is one of:

| Status | Meaning |
|---|---|
| `resolved` | The exact id has a definition in the dependency slice. |
| `external` | Figma states that the resource belongs to a library. |
| `unavailable` | The Foundation read listed this exact id as unavailable. |
| `not_in_snapshot` | A local id is absent from the current Foundation read. |
| `not_extracted` | The resource kind (currently paint styles) has no definition table. |
| `no_foundation` | The component was copied without a Foundation snapshot. |

Names remain readable labels. They never select a definition when an id lookup
fails, so two same-named resources cannot collapse.

## Foundation dependency closure

The closure starts with every component-bound variable, text style, and effect
style id. It then repeatedly adds:

1. every local variable targeted by any retained token alias;
2. every variable targeted by a retained typography property; and
3. every variable targeted by a retained effect property binding.

Only owning collections are retained. Entity order follows the canonical source
artifact, not closure discovery order. The slice receives its own Foundation
semantic hash and Level 1/Level 2 validation pass.

## Component facts

- Anatomy nodes retain both their display part and exact path identity.
- Layout is explicitly marked `scope: default_variant` and carries structured
  values beside its readable summary.
- Conditional bindings retain the extractor's minimized axis conditions.
- Inline effect field bindings retain stable ids and resource kinds.
- Hardcoded values and deterministic component findings stay available as
  `unbound` and `validation`.
- Typography/effect definitions come only from Foundation v5, including exact
  property bindings and any `STYLE_BINDING_DRIFT` diagnostics.

## Compact AI profile

Copy for AI emits a projection of the finished artifact:

```yaml
spec_layer:
  kind: component
  version: 5
  profile: ai
  content_hash: sha256:...
  foundation_hash: sha256:...
references:
  used: ...
  bindings: ...
  foundation:
    dependency_hash: sha256:...
    completeness: ...
    collections: ...
    styles: ...
```

The embedded Foundation projection forces `source_id` on every dependency,
while whole-Foundation Copy continues its quieter ambiguity-only id policy.
Repeated diagnostics become `issue_counts`; actionable component validation
retains its concise messages.

## Validation and compatibility

The runtime validator requires every binding to join to `used` and every
`resolved` reference to have the matching kind/id definition. The published
JSON Schema validates the canonical shape and reuses Foundation Context v5's
entity definitions.

Legacy `componentBrief()` version 4 remains exported and its golden fixture is
unchanged. The plugin's Copy action is the adoption boundary that now emits v5.
Canvas docs, stored links, update badges, and extractor compatibility remain
unchanged.
