---
title: Configuration and Secrets
tags:
  - operations
  - configuration
  - secrets
status: living
updated: 2026-07-27
---

# Configuration and secrets

## Root workspace

| Setting | Location | Meaning |
|---|---|---|
| Node engine | root `package.json` | Node `>=20.9.0` |
| Workspaces | root `package.json` | `packages/*`, `apps/*` |
| TypeScript base | `tsconfig.base.json` | Shared compiler configuration |
| Tests | `vitest.config.ts` | Root Vitest configuration and coverage |
| Lint | `eslint.config.mjs` | Shared ESLint configuration |

## Figma plugin

### Manifest

`packages/plugin/manifest.json` configures:

- plugin name and Community ID;
- `main` and `ui` build artifacts;
- `figma` editor support;
- dynamic-page document access;
- `currentuser` permission;
- staging Worker network allowlist.

### Compile-time constants

`packages/plugin/build.mjs` injects the plugin package version as `__PLUGIN_VERSION__`.

### Device-local settings

Stored via `figma.clientStorage`:

- license key;
- license instance ID;
- AI enabled preference;
- brand theme;
- migrated legacy brand colors;
- base64 brand logo.

These values are not environment variables and are local to the Figma client/plugin.

### URL constants

`packages/plugin/src/ui/proxy.ts` defines:

- proxy base URL;
- checkout URL;
- subscription management URL;
- storefront URL;
- marketing site URL;
- author link.

`PROXY_URL` and the manifest network allowlist must change together.

## Proxy Worker

### Secrets

| Name | Required | Purpose |
|---|---:|---|
| `ANTHROPIC_API_KEY` | Yes | Authenticate upstream Anthropic calls |
| `FIGMA_ID_SALT` | Yes | Salt free-user identity hashes |

> [!danger]
> Rotating `FIGMA_ID_SALT` renames every free identity's Durable Object, resets free quotas, and restarts boost windows.

### Bindings

| Binding | Kind | Purpose |
|---|---|---|
| `LICENSE_CACHE` | KV namespace | License verdict cache |
| `QUOTA` | Durable Object namespace | Per-identity quota state |

### Wrangler configuration

`packages/proxy/wrangler.toml` contains:

- Worker name `spec-layer-proxy`;
- source entry;
- compatibility date;
- account ID;
- KV namespace ID;
- Durable Object binding and migration.

Infrastructure identifiers are configuration, not secrets, but changes affect deployment state.

## Legacy web app

### Environment variables

| Name | Required | Purpose |
|---|---:|---|
| `DS_CONTENT_DIR` | No | Markdown content root |
| `SPEC_LAYER_ALLOWED_HOSTS` | No | Extra comma-separated Host allowlist |
| `SPEC_LAYER_ALLOWED_ORIGINS` | No | Extra comma-separated cross-origin allowlist |
| `FIGMA_TOKEN` | No | Figma Images API token |
| `ANTHROPIC_API_KEY` | No | Direct server-side AI generation |
| `DS_CONFIG_PATH` | Test/internal | Override `.ds-config.json` location |

Content directory precedence:

1. `.ds-config.json` `contentDir`;
2. `DS_CONTENT_DIR`;
3. `<web-process-cwd>/content/components`.

Credential precedence:

1. non-empty value in `.ds-config.json`;
2. environment variable.

### `.ds-config.json`

Shape:

```json
{
  "contentDir": "/absolute/or/resolved/path",
  "anthropicKey": "secret",
  "figmaToken": "secret"
}
```

The Settings UI only returns boolean key presence. Writes use a temporary file, atomic rename, and mode `0600` where supported.

## Landing site

The monthly and yearly checkout URLs are JavaScript constants in `apps/landing/index.html`. There is no environment-variable injection or build step.

## Secret handling checklist

- Never commit `.env*`, `.ds-config.json`, real license keys, Anthropic keys, or Figma tokens.
- Never include real private Figma file keys or customer content in fixtures.
- Store Worker secrets with Wrangler secret commands, not `wrangler.toml`.
- Verify plugin manifest network text reflects the real transmitted data.
- Rotate any key exposed through a public deployment or commit.

## Related notes

- [[Data and Storage]]
- [[Security and Privacy]]
- [[Deployment and Release]]

