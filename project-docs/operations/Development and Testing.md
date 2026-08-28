---
title: Development and Testing
tags:
  - development
  - testing
  - ci
status: archived
updated: 2026-07-27
---

# Development and testing

> [!warning] Archived snapshot
> Commands for the deleted web app and Node 20 are obsolete. Use `package.json`,
> CI, and `packages/plugin/TESTING.md`. See [[ARCHIVE-NOTICE]].

## Requirements

- Node.js `20.9` or newer
- npm
- Figma Desktop for manual plugin testing

## Root commands

| Command | Purpose |
|---|---|
| `npm ci` | Reproduce the lockfile dependency graph |
| `npm run lint` | Lint the monorepo |
| `npm run typecheck` | Type-check format, extractor, plugin, web, and proxy |
| `npm test` | Run Vitest |
| `npm run test:coverage` | Run tests with coverage |
| `npm run build` | Build the legacy Next.js app |
| `npm run build:plugin` | Bundle the Figma plugin |
| `npm run check` | Lint, type-check, test, web build, plugin build |

## Workspace development

### Plugin

1. Build with `npm run build:plugin`.
2. In Figma Desktop, import `packages/plugin/manifest.json` as a development plugin.
3. Rebuild after source changes.

The plugin needs no local server. Its AI and licensing calls use the staging Worker.

### Legacy web app

Start from the root with the `md-ds` workspace development command. The script binds to `localhost`.

Use `apps/web/.env.example` as the optional configuration template.

### Proxy

Proxy business logic is dependency-injected and testable without Miniflare. Unit tests call handlers, quota, identity, license, and router logic with fake fetch/KV/clock implementations.

### Landing

Serve `apps/landing` as a static directory. It has no compilation step.

## Testing layers

| Layer | Coverage |
|---|---|
| Format | YAML/frontmatter and Markdown parsing |
| Extractor | Fixtures, deterministic transforms, hashes, tables, prose contracts |
| Plugin pure modules | serializers, view models, state, file export, doc links, themes |
| Plugin integration | mocked Figma runtime and main/UI behaviors |
| Proxy | routing, identity, license failure modes, quota atomic model |
| Web libraries | content, editing, imports, security, navigation, enrichment |
| Web API routes | local access, body validation, mutation behavior |

## Manual plugin pre-merge pass

`packages/plugin/TESTING.md` is the authoritative checklist. High-risk areas:

1. selected component resolution;
2. every generated frame section;
3. My Library drift/edit/orphan/update states;
4. free quota meter and Pro activation;
5. theme, logo, fonts, keyboard, reduced motion;
6. Markdown and ZIP download contents.

Proxy deployment must precede plugin testing when the message/auth contract changed.

## CI

GitHub Actions runs on pushes to `main` and pull requests:

1. checkout;
2. Node 20 setup with npm cache;
3. `npm ci`;
4. lint;
5. type-check;
6. coverage tests;
7. web build;
8. plugin build;
9. production dependency audit.

CI permissions are read-only for repository contents.

## Change discipline

- Bug fixes should add regression tests.
- Keep package boundaries intact.
- Format changes require cross-package compatibility updates.
- UI changes should include synthetic screenshots.
- Never use customer or private Figma data in tests.

## Related notes

- [[Deployment and Release]]
- [[Source Catalog]]
- [[Security and Privacy]]
