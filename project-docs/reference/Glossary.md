---
title: Glossary
tags:
  - reference
  - glossary
status: living
updated: 2026-07-27
---

# Glossary

| Term | Meaning |
|---|---|
| Component doc | A generated Figma Section documenting one component or set |
| Component set | Figma collection of component variants |
| Content hash | SHA-256 over deterministic rendered/source projection used for drift |
| Deterministic content | Output derived from Figma data without a model |
| Doc link | Plugin data stored on a generated Section linking it to its source |
| Foundation | File-level variable collections, modes, aliases, and text styles |
| Foundation scope | Address of one collection, group split, or text-style unit |
| Foundation unit | One planned, renderable foundation document |
| Free identity | Salted hash derived from the `X-Figma-User` header |
| Judgment content | Human- or AI-authored prose such as accessibility guidance |
| IntermediateSpec | Plain structured component extraction produced by the extractor |
| My Library | Plugin view of generated, source-linked Figma docs |
| Opaque origin | Browser Origin serialized as `null`, used by the Figma iframe |
| Pro identity | License-derived quota identity validated through Lemon Squeezy |
| Prose cache key | Versioned, content-derived idempotency/cache key for AI generation |
| Proxy | Cloudflare Worker between plugin and Anthropic/Lemon Squeezy |
| Raw value | Hardcoded value found in a component without a token binding |
| Reservation | Temporary quota hold for one cache key during an AI call |
| Self hash | Hash of rendered frame text used to detect manual edits |
| SerializedFoundation | Plain dump of local variables, modes, aliases, and text styles |
| SerializedNode | Figma-independent component tree passed to the extractor |
| Sidecar | `.spec-data/*.json` companion containing an `IntermediateSpec` |
| Source drift | Deterministic source content changed since a doc was generated |
| Spec Layer v0.1 | Strict Markdown/frontmatter contract in `spec/SPEC.md` |
| State matrix | Grid of variant/state combinations rendered in a doc frame |

