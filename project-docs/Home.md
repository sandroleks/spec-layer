---
title: Spec Layer Project Documentation
aliases:
  - Project Documentation
  - Documentation Home
tags:
  - spec-layer
  - documentation
  - index
status: archived
updated: 2026-08-28
---

# Spec Layer project documentation

> [!warning] Archived architecture snapshot
> This Obsidian vault is a mixed-era historical archive, primarily describing
> the repository as it existed on 27 July 2026, with a few later Foundation
> notes. It is retained for context, not as runtime or release truth. In
> August 2026, `apps/web`, `packages/format`, `spec`, Markdown/ZIP output, and
> **Send to docs** were retired. Start with `docs/plugin-knowledge-map.md`,
> `README.md`, `SECURITY.md`, and production source for current behavior.

## Historical index

- [[Product Overview]] explains what the product does and which parts are current or legacy.
- [[System Architecture]] shows the runtime areas and dependency boundaries.
- [[Data Flows]] traces component extraction, canvas generation, export, AI prose, licensing, and legacy imports.
- [[Module Map]] is the package-level directory.
- [[Network and External Services]] is the complete outbound network map.
- [[Configuration and Secrets]] lists runtime configuration and sensitive values.
- [[Security and Privacy]] records trust boundaries and important security assumptions.
- [[Known Constraints and Technical Debt]] distinguishes known limitations from intended behavior.

## Module documentation

- [[Format Package]]
- [[Extractor Package]]
- [[Figma Plugin]]
- [[Proxy Worker]]
- [[Legacy Web App]]
- [[Landing Site]]
- [[Source Catalog]]

## Interfaces and contracts

- [[Markdown Specification]]
- [[Plugin Message Protocol]]
- [[Proxy API]]
- [[Legacy Web API]]
- [[Network and External Services]]

## Operations

- [[Configuration and Secrets]]
- [[Data and Storage]]
- [[Development and Testing]]
- [[Deployment and Release]]

## Reference

- [[Glossary]]
- [[Known Constraints and Technical Debt]]
- [[Source Catalog]]

## Repository at a glance

| Area | Path | Role | Runtime status |
|---|---|---|---|
| Figma plugin | `packages/plugin` | Primary product: extracts components and builds documentation in Figma | Active |
| Extractor | `packages/extractor` | Pure transformation from serialized Figma data to specifications | Active |
| AI and license proxy | `packages/proxy` | Cloudflare Worker for Anthropic, quota, and Lemon Squeezy licensing | Active |
| Landing site | `apps/landing` | Static marketing, pricing, and policy pages | Active |
| Format | `packages/format` | Former Markdown/frontmatter package | Retired and deleted |
| Local docs app | `apps/web` | Former local Markdown browser/editor and importer | Retired and deleted |
| Formal specification | `spec` | Former Markdown format definition | Retired and deleted |
| Existing project notes | `docs` | Backlog, copy, and product notes | Supporting material |

## Documentation conventions

These notes use Obsidian wikilinks, YAML properties, Mermaid diagrams, and callouts. Open the `project-docs` directory as an Obsidian vault, or read the files in any Markdown viewer.

Source paths are repository-relative. Statements marked **current behavior**
mean current as of `2026-07-27`, not current today. The supported portable
context surface is **Copy for AI**, which places a YAML brief on the clipboard;
there is no current Markdown/ZIP download or plugin-to-web-app delivery path.
