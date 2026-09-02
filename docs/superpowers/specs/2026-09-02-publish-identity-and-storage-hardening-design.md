# Publish identity and storage hardening

Date: 2026-09-02
Status: approved design, implemented alongside this document
Builds on: `2026-09-01-library-publish-cli-design.md`

## Problem

A review of the publish and pull work confirmed five defects that share one
theme: the flow trusts identities and storage it does not actually have.

1. `figma.fileKey` is undefined for a Community plugin, so every file's publish
   identity lands in the single `publishInfo:unknown` slot. Publishing file B
   can overwrite file A's library.
2. A `not_owner` or 404 reply is retried as a brand-new library with the
   ordinary success copy, and a late `publishInfo` reply is dropped once a
   publish starts. Both orphan the old library and strand its developers.
3. The owner list and the meta record are whole-value read-modify-writes on
   eventually consistent KV. Concurrent creates lose ids; a rotate during a
   republish clobbers a field.
4. The `content-length` precheck compares UTF-8 bytes to a UTF-16 character
   cap, so non-ASCII libraries are rejected below the real limit.
5. The bundle shape is hand-validated in the plugin, the proxy, and the CLI,
   and the three disagree. The CLI never checks the bundle version.

## Decisions

### Per-file identity lives in the document

The library id is stored in the file itself, as root plugin data under
`speclayer.publish.libraryId`. It travels with the file and is visible to every
editor who runs the plugin, which is exactly the set of people who should
republish the same library rather than mint a second one.

The pull key stays per user, in `figma.clientStorage` under
`publishKey:<libraryId>`. It is a secret and does not belong in the document.
A user who opens a published file on a device without the key sees the library
id and a **Rotate key** action, which issues a fresh key and stores it; that
is the recovery path, and it tells the truth about what rotating does to the
developers already pulling.

`publishInfo` and `setPublishInfo` drop their `fileKey` field. The main thread
resolves everything itself. A new `clearPublishInfo` message removes the
document's library id.

### No silent recreate, no dropped identity

When a republish answers 404 or `not_owner`, the plugin stops. The message
says the library is gone or belongs to another license, that nothing was
published, and that publishing again creates a new library whose setup command
must be shared afresh. It clears the local and stored identity so the next
click is a deliberate create.

The `publishSources` reply carries the persisted identity read in the same
round trip. `onPublishSources` prefers what this session already knows and
falls back to that, so the identity cannot be lost to a slow reply.

### Storage keys that never overlap

- Ownership is one KV key per library, `libowner:<licenseId>:<libraryId>`,
  counted with a prefix list. Two concurrent creates write two keys; nothing is
  read-modify-written. A legacy `libowner:<licenseId>` array is migrated to
  per-key entries the first time that license publishes, then deleted.
- The pull key digest moves to its own key, `lib:<id>:key`. Rotate writes only
  that key; republish writes only the bundle and meta. Pull reads `lib:<id>:key`
  and falls back to `meta.keyHash` for libraries published before this change.
- Independent puts run in parallel after the bundle write, which stays first
  so meta never describes a bundle that is not there yet.
- The plugin disables **Rotate key** while a publish is collecting or
  uploading, and a successful rotate sets the status to `done` so its message
  is not painted as an error.

Two republishes of the same library racing each other remain last-write-wins.
One publisher per license is the product model; this is documented, not
solved.

### One size unit

The cap is `MAX_BUNDLE_BYTES` (5,000,000) and every check measures UTF-8 bytes
of the request body: the `content-length` header, then the body actually
read. The 413 body reports `size` and `limit` in bytes, and the plugin copy
renders them as megabytes. The re-serialized-length check and the 4096 fudge
are gone; the envelope around the bundle is a few dozen bytes.

### One bundle parser

`packages/extractor/src/libraryBundle.ts` defines the wire shape once:
`LIBRARY_BUNDLE_SCHEMA`, `LIBRARY_BUNDLE_VERSION`, the `LibraryBundleV1` type,
and `parseLibraryBundle(input)` which returns the typed bundle or throws a
`LibraryBundleError` carrying a `code`: `not_json`, `not_bundle`,
`unsupported_version`, or `malformed`. It accepts any `1.x` version and
rejects other majors.

- The plugin types its outgoing bundle as `LibraryBundleV1`.
- The proxy validates with `parseLibraryBundle` and answers 400
  `invalid bundle` or 400 `unsupported bundle version`.
- The CLI's `parseBundle` wraps it and turns each code into the plain message
  it already prints, plus a new one for an unsupported version that tells the
  user to update `spec-layer`.

The extractor becomes a build-time dependency of the CLI for this one
Figma-free module; esbuild inlines it, so the published package still has no
runtime dependencies and still never re-derives v5 output. The status doc had
already reserved this step.

## Testing

- Extractor: parser accepts a valid bundle and a null foundation, rejects each
  malformed shape with the right code, gates the major version.
- Proxy: per-key ownership counted by prefix, legacy array migrated, rotate
  leaves meta untouched and only `lib:<id>:key` changes, pull honours the new
  key location and the legacy fallback, byte-based size cap with a
  multi-byte fixture, shared parser rejections.
- Plugin: identity flows through `publishSources`, `gone` clears identity and
  never recreates, rotate is disabled while busy and sets `done` on success,
  the screen shows the id-only group when the key is missing, copy passes the
  voice sweep.
- CLI: unsupported version message.

## Docs to update

`CHANGELOG.md`, `ARCHITECTURE.md` (storage and CLI sections),
`packages/proxy/README.md` (KV layout), `packages/plugin/TESTING.md`
(publish from a second file, publish on a second device).
