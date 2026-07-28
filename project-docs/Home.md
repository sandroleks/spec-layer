---
title: Spec Layer Project Documentation
aliases:
  - Project Documentation
  - Documentation Home
tags:
  - spec-layer
  - documentation
  - index
status: living
updated: 2026-07-27
---

# Spec Layer project documentation

> [!abstract]
> This folder is an Obsidian-ready documentation vault for the Spec Layer repository. It documents the current codebase, including its architecture, packages, runtime boundaries, network calls, proxy, storage, security, development workflow, and deployment model.

## Start here

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
| Format | `packages/format` | Markdown/frontmatter contract and parsing | Active |
| AI and license proxy | `packages/proxy` | Cloudflare Worker for Anthropic, quota, and Lemon Squeezy licensing | Active |
| Landing site | `apps/landing` | Static marketing, pricing, and policy pages | Active |
| Local docs app | `apps/web` | Local Markdown browser/editor and importer | Legacy |
| Formal specification | `spec` | Public Markdown format definition | Active contract |
| Existing project notes | `docs` | Backlog, copy, and product notes | Supporting material |

## Documentation conventions

These notes use Obsidian wikilinks, YAML properties, Mermaid diagrams, and callouts. Open the `project-docs` directory as an Obsidian vault, or read the files in any Markdown viewer.

Source paths are repository-relative. Statements marked **current behavior** are verified against source as of `2026-07-27`. The repository contains older prose that still mentions a plugin-to-docs-app delivery endpoint; the current plugin instead downloads local Markdown/ZIP files and does not call the local app.
