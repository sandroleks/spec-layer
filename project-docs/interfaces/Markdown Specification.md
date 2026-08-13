---
title: Markdown Specification
aliases:
  - Spec Layer Format
tags:
  - contract
  - markdown
  - format
status: normative
updated: 2026-07-27
source: spec/SPEC.md
---

# Markdown specification

The normative contract is `spec/SPEC.md`, titled **Spec Layer Format v0.2**. Writers emit `spec_version: "0.2"`; `"0.1"` files stay readable. This note is an architectural summary; update the normative file first when changing the format.

## File shape

One component corresponds to one `.md` file:

1. YAML frontmatter.
2. Exactly ten canonical level-2 sections in order.
3. Optional `## Extraction gaps` after the canonical sections.

Recommended filename: `<ComponentName>.md`.

## Frontmatter

Required:

```yaml
spec_version: "0.2"
component:
  name: Button
  figma_key: stable-component-key
  figma_file: file-key
  figma_node: "12:34"
content_hash: 64-character-sha256
extracted_at: "2026-07-27T00:00:00.000Z"
```

Optional:

- `status`: `draft`, `approved`, or `deprecated`
- `approved_by`: legacy compatibility field

A 64-zero hash is permitted for hand-authored documents where drift detection is not applicable.

## Canonical sections

| Order | Heading | Kind |
|---:|---|---|
| 1 | `## Definition` | Human or AI judgment |
| 2 | `## Anatomy` | Deterministic |
| 3 | `## Configuration` | Deterministic |
| 4 | `## Variants` | Deterministic |
| 5 | `## States` | Deterministic |
| 6 | `## Tokens used` | Deterministic |
| 7 | `## Code` | Human or AI judgment |
| 8 | `## Accessibility` | Human or AI judgment |
| 9 | `## Do's & Don'ts` | Human or AI judgment |
| 10 | `## Related atoms` | Deterministic |

Judgment sections may contain lists, emphasis, and level-3-or-smaller headings. They must not introduce level-1 or level-2 headings because those levels delimit the document contract.

## Hash semantics

`content_hash` is a SHA-256 digest over the canonical deterministic extraction projection. AI prose and extraction timestamps are excluded.

This makes it a source-drift key and an AI-cache component, not a byte hash of the final Markdown file.

## Token section

Token bindings are grouped into:

- Color
- Typography
- Measurements

Color tables can pivot by state and a dominant variant axis, split boolean modifiers, preserve exceptions, and merge fully unconditioned values into a fixed table.

## Related formats in the plugin

The active plugin's configurable canvas/download model contains more section types than the strict document format:

- overview and variants summary;
- measurements;
- interaction guidance;
- design and content considerations;
- configurable anatomy forms;
- selected per-variant token tables.

`modelToMarkdown` renders that chosen model for plugin downloads. Do not assume every plugin-downloaded note is the exact ten-section strict format unless the renderer is deliberately aligned.

## Sidecar

A `.spec-data/<same-path>.json` file is not part of the Markdown standard. It is a tool-specific companion carrying `IntermediateSpec` for rich legacy app rendering and regeneration.

## Change policy

Format changes require synchronized updates to:

- `spec/SPEC.md`;
- `@spec-layer/format`;
- extractor renderers and hashes;
- fixtures/golden outputs;
- consumers in plugin and web;
- compatibility and release notes.

