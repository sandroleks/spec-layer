# Library publish and pull CLI

Date: 2026-09-01
Status: approved design, not yet planned

## Problem

Copy for AI produces a validated v5 library context, but the only transport is
a designer's clipboard inside Figma. Developers do not live in Figma. There is
no way to get a library's context into a repo, keep it fresh, or notice it is
stale without a designer manually re-copying and re-pasting.

## Decision summary

- **Transport: hosted via the existing proxy.** The plugin publishes a bundle
  to `api.spec-layer.com`; a CLI pulls it. No file-handoff workflow, no CLI
  extraction from the Figma REST API (that would be a second extraction
  implementation, which the v5 invariants forbid).
- **Payload: one library bundle.** The Foundation v5 artifact plus the
  component context for every documented component, published as a single unit
  with a single freshness story.
- **Access: secret pull key per library.** Unguessable, shown in the plugin,
  handed to devs. Rotating the key revokes access. No accounts, no emails.
- **Monetization: publish is Pro-only.** Pulling is free and unlimited for
  anyone holding a key. Hosting cost maps to paying users; devs never pay.
- **Dev side: files in the repo.** `spec-layer init` writes config,
  `spec-layer pull` writes canonical JSON plus ai-profile YAML into the repo,
  `spec-layer status` checks freshness.
- **CLI scope: pull-only (Option A).** Commands are `init`, `pull`, `status`.
  `validate`, `diff`, and `normalize` (backlog item 3, v5 command tooling)
  are explicitly deferred and remain open.

## Plugin publish flow

A **Publish** action next to Copy for AI in the library view, Pro-gated like
AI writing.

- Publish builds the bundle through the existing serialize -> extractor path.
  Nothing new is extracted; publish is a new transport for artifacts that
  already exist.
- The plugin sends the bundle to the proxy with the user's license key. First
  publish of a file creates a library and returns a **library id** and a
  **secret pull key**. The plugin stores both in `figma.clientStorage` keyed
  by file, so republishing overwrites the same library rather than minting a
  new one.
- After publishing, the UI shows the pull key, a "copy setup command" button
  producing `SPEC_LAYER_KEY=sl_... npx spec-layer pull --id lib_...`, and the
  last published time. The command works with no prior setup on the dev side.
- A **rotate key** action invalidates the old key and shows a new one.
  Republishing never rotates.
- If any component fails extraction, publish is blocked and the failing
  components are listed. No silent partial bundles.
- All copy follows `docs/plugin-voice-and-copy.md`: sentence case, second
  person, no em dashes, honest about behavior ("Replaces the previously
  published version. Anyone with the key can pull.").

## Proxy endpoints and storage

Three routes on the existing Worker, alongside the current AI and licensing
handlers.

- `POST /v1/libraries` - publish. License-key authenticated via the existing
  `license.ts` validation, Pro required. Body: the bundle plus metadata
  (plugin version, `EXTRACTOR_VERSION`, per-artifact `semanticContentHash`).
  First publish generates the library id and pull key; later publishes to the
  same id overwrite. Response: id, key (first publish only), publishedAt.
- `GET /v1/libraries/:id` - pull. Pull key in `Authorization: Bearer sl_...`,
  never in the URL. Returns the bundle. Supports `If-None-Match` against the
  bundle hash so repeat pulls and `status` are cheap 304s.
- `POST /v1/libraries/:id/rotate` - license-key authenticated (publisher
  only). Returns a new pull key.

KV layout (existing namespace):

- `lib:<id>:bundle` - the bundle JSON.
- `lib:<id>:meta` - **hash of the pull key** (the key itself is never
  stored), license id, publishedAt, bundle hash, size. Pull auth is a
  constant-time compare against the stored hash.

Limits and lifecycle:

- Bundle size cap enforced on publish, around 5 MB (KV allows 25 MB), with an
  error naming the actual size.
- Publish rate-limited through the existing `ratelimit.ts`; pulls
  rate-limited more loosely per key.
- One library per license per Figma file; a cap of roughly 10 libraries per
  license bounds storage.
- When a license lapses, bundles stay pullable but publish and rotate stop.
  Devs keep a working setup; the bundle goes stale rather than dark.
- No new personal data is stored beyond what licensing already holds.

## CLI package

New workspace `packages/cli`, published to npm as **`spec-layer`** so the
handoff is `npx spec-layer pull`. Node >= 22, TypeScript, esbuild single-file
bundle, effectively zero runtime dependencies (built-in `fetch`,
`util.parseArgs`).

- `spec-layer init` - writes `speclayer.json` at the repo root:
  `{ libraryId, outDir: ".speclayer" }`. Optional convenience: `pull` and
  `status` resolve the library id from `--id`, then `speclayer.json`, then
  the existing manifest, so the plugin's one-line setup command works in a
  bare repo. The pull key is never written to config; it comes from
  `SPEC_LAYER_KEY` or `--key`, and init says so.

  > Superseded by `2026-09-02-cli-stored-pull-key-design.md`. The key is now
  > stored in `speclayer.local.json`, gitignored, at mode 0600.
- `spec-layer pull` - fetches the bundle and writes:
  - `.speclayer/bundle.json` - the canonical validated v5 bundle,
    byte-for-byte as published.
  - `.speclayer/ai/foundation.yaml` and
    `.speclayer/ai/components/<name>.yaml` - the compact ai-profile YAML,
    one file per artifact. This is what devs point CLAUDE.md or agents at.
  - `.speclayer/manifest.json` - library id, publishedAt, per-artifact
    `semanticContentHash`, plugin and extractor versions.

  Writes are deterministic: an unchanged republish produces an empty git
  diff. Pull writes to a temp directory and moves into place only on
  success; a failed pull never leaves a half-written `.speclayer/`.
- `spec-layer status` - conditional request using the manifest's bundle
  hash; prints "up to date" or "behind (published <date>)" and exits nonzero
  when behind, so CI can enforce freshness.

**The CLI does not depend on `packages/extractor`.** The plugin includes both
forms in the published bundle: the canonical artifacts and the ai-profile
YAML projected by the existing `v5/aiContext.ts` at publish time. Exactly one
code path produces v5 output, and the CLI is a dumb, honest transport. When
`validate`/`diff` land later, the extractor (Figma-free by invariant) becomes
a CLI dependency then.

## Error handling

Every failure names its cause and the fix.

Plugin side (plugin voice):

- Not Pro: the existing upgrade path.
- Bundle too large: the size and the cap.
- Partial extraction: publish blocked, failing components listed.

CLI side (plain text, nonzero exit, no stack traces):

- Missing key: "Set SPEC_LAYER_KEY or pass --key".
- 401: "Key was rotated or revoked. Ask the publisher for the current key".
- 404: "Library not found. It may have been unpublished".
- Network or server errors: the HTTP status and a one-line description.

## Testing

- **Proxy:** Vitest with mocked KV and license validation, matching the
  existing `packages/proxy` pattern. Publish/pull/rotate round trips,
  wrong-key and lapsed-license paths, size cap, 304 behavior, constant-time
  key compare.
- **CLI:** Vitest with mocked `fetch` and a temp filesystem. Full pull round
  trip against a synthetic fixture bundle (fixtures invariant applies),
  deterministic re-write producing no diff, every error path above. No
  network in tests.
- **Plugin:** bundle assembly and publish message flow unit-tested. The live
  publish/pull loop against the deployed Worker joins the manual matrix in
  `packages/plugin/TESTING.md`.
- `npm run check` picks up the new workspace; `check:sandbox` is unaffected
  because the CLI never enters the plugin main thread.

## Docs to update alongside implementation

- `CHANGELOG.md`
- `ARCHITECTURE.md` (new package, new endpoints)
- `docs/specs/foundation-v5-status.md` (delivery shipped; validate/diff/
  normalize tooling still open)
- Landing site CLI setup section: later, out of scope for this build.

## Explicitly out of scope

- `validate`, `diff`, `normalize` CLI commands (backlog item 3 stays open).
- Version history on the server (latest bundle only).
- Team accounts, per-dev identity, usage analytics on pulls.
- Any MCP surface (previously considered and rejected).
