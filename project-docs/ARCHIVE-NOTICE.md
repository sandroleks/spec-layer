# Archived project-docs vault

The `project-docs` vault is a historical, mixed-era archive. Most of its
architecture snapshot dates to 27 July 2026, while a few files received later
Foundation notes. It is intentionally kept for decision history, but it is not
a current source of truth.

The following surfaces described throughout the snapshot were retired and
deleted in August 2026:

- `apps/web`, the local Next.js docs app and its API;
- `packages/format`;
- `spec`, the strict Markdown specification;
- Markdown and ZIP downloads, `.spec-data` sidecars, and **Send to docs**.

The supported product boundary is the Figma plugin, the extractor, the
Cloudflare proxy, and the static landing site. **Copy for AI** puts YAML briefs
on the clipboard and is the current portable context surface.

For current behavior, use `docs/plugin-knowledge-map.md`, `README.md`,
`SECURITY.md`, `packages/plugin/TESTING.md`, and production source. Current
Foundation v5 contracts live under `docs/specs/`.
