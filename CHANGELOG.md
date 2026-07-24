# Changelog

All notable changes to Spec Layer are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- License hardening: transient Lemon Squeezy errors (rate limits, 5xx,
  malformed responses) no longer read as invalid keys, and renewals show
  as Pro immediately after Activate instead of a stale cached status.
  Device instances are validated on every request, so a deactivated
  device's slot frees up rather than staying claimed. License endpoints
  are rate-limited and format-gated, and license keys are hashed in
  server-side storage and logs rather than kept in the clear.

### Changed

- The Figma plugin adds a Remove key action and clearer Settings status
  copy that distinguishes a proxy outage from an expired subscription or
  an unactivated key.

## [1.0.0] - 2026-06-15

### Changed

- Simplified the Figma plugin's **Send to docs** flow: the primary action is now a **Send to docs** button beside **Download .md**, and the docs URL plus Figma file source moved to a dedicated **Settings** tab. The common case (saved file, default URL) needs no configuration; missing Figma keys are prompted inline at send time.

### Removed

- Removed the `SPEC_LAYER_TOKEN` access token and its plugin field. For a localhost-only tool the token was setup friction; the plugin's opaque origin is now permitted automatically. Same-origin enforcement and the loopback host allowlist remain the protection for the local API, and unlisted cross-origins are still rejected.

## [0.1.0] - 2026-06-15

### Added

- Open Markdown design-system specification with reference component examples.
- Deterministic Figma component extraction, selected-component review, Markdown download, local delivery, and bulk ZIP export.
- Local Next.js documentation app with filesystem navigation, search, inline section editing, Figma previews, and configurable content roots.
- Inbox workflow with import summaries, individual and bulk save, per-item delete, clear-all, and destination-folder selection.
- Optional Anthropic guideline filling for Definition, Accessibility, and Do's & Don'ts, including bulk placeholder fill, section regeneration, visual context when available, caching, and stale-write protection.
- MIT license, contribution guide, security policy, code of conduct, issue forms, pull request template, CODEOWNERS, Dependabot, and CI.

### Security

- Loopback-by-default server binding and explicit host/origin validation for local APIs.
- Bearer-token authentication for allowed cross-origin clients such as the Figma plugin.
- Request-size and bounded ZIP expansion limits.
- Atomic owner-readable settings writes and strict HTTPS Figma URL validation.
- Generated inbox content, local credentials, caches, sidecars, and editor state excluded from version control.

### Changed

- Upgraded the web app to Next.js 16, React 19, ESLint 9, and Vitest 4.
- Improved keyboard support, focus handling, dialog semantics, visible focus styles, and reduced-motion behavior.
- Clarified that `status` is optional metadata and that Spec Layer does not enforce an approval workflow.

### Known Limitations

- The web app is a trusted localhost tool, not a hosted or multi-user service.
- Workspace packages are private implementation modules and are not published to npm.
- GitHub synchronization, drift detection, and an MCP server remain roadmap items.

[1.0.0]: https://github.com/SamsonHD/spec-layer/releases/tag/v1.0.0
[0.1.0]: https://github.com/SamsonHD/spec-layer/releases/tag/v0.1.0
