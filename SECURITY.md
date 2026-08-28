# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| Latest Figma Community release | Yes |
| Latest revision of `main` | Yes |
| Earlier public releases | No |

Security fixes are prepared on `main` and shipped in the next Figma Community
release. Upgrade to the latest published plugin before reporting an issue that
may already be fixed.

## Reporting a vulnerability

Use GitHub's private security advisory feature for this repository. Include reproduction steps, affected files, impact, and any suggested mitigation. Do not include real credentials or private design-system data.

If private advisories are unavailable, contact the maintainers privately before disclosing the issue publicly. Allow a reasonable remediation period before publication.

## Current threat model

The shipped product is a Figma plugin backed by a Cloudflare Worker. The former
local docs web app, Markdown import API, and **Send to docs** flow have been
retired and are not supported surfaces.

- Deterministic extraction and canvas rendering stay inside Figma.
- When AI writing is enabled, the plugin sends a derived summary and, when it
  fits the size limits, a rendered component image to the Worker. The Worker
  forwards the allowlisted request to Anthropic. Foundation group writing sends
  token names and resolved values, without a component image.
- The Anthropic API key is a Worker secret and never reaches the plugin.
- The plugin stores an activated license key and device instance in Figma
  `clientStorage`. The Worker must receive the raw key to validate it with Lemon
  Squeezy, but its own cache keys, quota identities, and logs use unsalted
  SHA-256 digests. Free-tier Figma user identifiers use a separate salted
  SHA-256 digest.
- The Worker rejects generic Anthropic request shapes, applies request and
  identity rate limits, and never logs prompts, rendered images, generated
  text, or raw license keys. A 24-hour idempotency cache stores generated
  responses so retries do not consume quota twice.

Treat private component names, text, token values, rendered images, Figma user
identifiers, and license keys as sensitive. If a credential is committed or
otherwise exposed, rotate it immediately.
