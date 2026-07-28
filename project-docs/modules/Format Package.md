---
title: Format Package
tags:
  - module
  - markdown
  - format
status: living
updated: 2026-07-27
source: packages/format
---

# Format package

`@spec-layer/format` is the smallest workspace and the owner of the portable Markdown envelope. It has no Figma or application runtime dependency.

## Responsibilities

- Define the `SpecFrontmatter` and `SpecStatus` TypeScript types.
- Serialize YAML frontmatter and a Markdown body.
- Parse and validate versioned Spec Layer frontmatter.
- Parse general Markdown/frontmatter for the legacy web app.

## Public API

The package barrel in `src/index.ts` exports:

- `SpecStatus`
- `SpecFrontmatter`
- `serializeFrontmatter`
- `parseFrontmatter`
- `parseMarkdown`

## Frontmatter validation

`parseFrontmatter` requires:

- `spec_version` equal to `"0.1"`;
- an optional `status` from `draft`, `approved`, or `deprecated`;
- component name, Figma component key, file key, and node ID;
- a content hash.

It returns `{ frontmatter, body }`, where `body` excludes the YAML fence.

## General Markdown parsing

`parseMarkdown` supports the broader documents used by the legacy web app. That app accepts hand-authored pages whose frontmatter need not match the strict Spec Layer schema.

## Dependencies

Runtime dependency: `yaml`.

## Design rules

- Keep this package unaware of extraction semantics.
- Changes to the open format must update `spec/SPEC.md`, parsers, renderers, tests, examples, and compatibility notes together.
- The package interprets the envelope but does not decide how deterministic component data is derived.

## Related notes

- [[Markdown Specification]]
- [[Extractor Package]]
- [[Legacy Web App]]

