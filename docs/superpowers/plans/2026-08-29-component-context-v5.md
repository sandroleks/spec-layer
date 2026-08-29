# Component Context v5 Implementation Plan

**Date:** 2026-08-29
**Status:** Implemented
**Packages:** `packages/extractor`, `packages/plugin`

## Goal

Replace the component clipboard's legacy brief-v4 boundary with a deterministic
Component Context v5 AI profile that resolves every component binding by stable
Figma identity and carries only the Foundation definitions that component needs.

The existing component extractor and canvas documentation remain unchanged.
Component Context v5 is an export/adoption layer over the mature
`IntermediateSpec`, not a rewrite of component extraction.

## User workflow

1. Copy Foundation Context once to give an agent the complete vocabulary.
2. Copy one component at a time. The component context names the complete
   Foundation hash and includes a self-contained dependency slice, so it is
   useful both beside the full Foundation context and on its own.

## Contract

The canonical artifact owns:

- a stable component source identity and measured component facts;
- exact `source_id` references and conditional property bindings;
- a Foundation dependency payload containing only referenced variables,
  typography/effect styles, owning collections, and transitive local aliases;
- machine-readable resolution states and diagnostics;
- a semantic content hash that excludes timestamps, build ids, diagnostic
  wording, derived validation, and generated guidelines.

The compact clipboard profile owns presentation only. It uses readable names,
retains source ids for exact joins, and reuses Foundation v5's compact value and
style projection for the dependency slice.

## Compatibility boundaries

- Do not change `IntermediateSpec`, `specContentHash`,
  `foundationContentHash`, or `EXTRACTOR_VERSION`.
- Keep `componentBrief()` and brief v4 exported for existing consumers and
  regression fixtures; only the plugin Copy action moves to v5.
- Never resolve a reference by name when its stable Figma id is available.
- Do not make a component hash move when an unrelated Foundation token changes.
  Hash the dependency slice, not the whole-file Foundation hash.
- Generated guidelines remain clearly marked and outside semantic hashes.
- Missing, external, stale, paint-style, and no-Foundation states remain
  explicit. Never substitute a plausible local token.

## Implementation tasks

### 1. Canonical artifact and dependency closure

- Add Component Context v5 types, envelope, semantic hash, and builder.
- Deduplicate used references and bindings by `(kind, source_id)`.
- Select referenced token/style ids from the validated whole Foundation
  artifact, then walk every local token alias and style property binding to a
  fixed point.
- Include only owning collections and filter Foundation diagnostics to the
  retained entities.
- Recompute the dependency semantic hash, statistics, and referential checks.

### 2. Validation

- Validate each binding joins to one `used` reference.
- Validate every `resolved` reference has a matching dependency entity.
- Preserve exact unresolved reasons: `external`, `unavailable`,
  `not_in_snapshot`, `not_extracted`, and `no_foundation`.
- Treat validator prose as derived output outside the component semantic hash.

### 3. AI projection

- Emit `kind: component`, `version: 5`, and `profile: ai`.
- Carry component and dependency content hashes separately.
- Keep component API, anatomy, layout, inline effects, hardcoded gaps,
  validation, and saved guidelines.
- Embed Foundation dependency collections/styles through the existing compact
  v5 projection, forcing stable ids so references remain exactly joinable.

### 4. Plugin cutover

- Build the whole-file Foundation v5 artifact from the cached live Foundation
  read whenever it is available.
- Build Component Context v5 from the live source component and copy its AI
  profile.
- Preserve the current no-mutation, no-AI-generation, clipboard fallback, and
  user-facing caveat behavior.

### 5. Acceptance and release

- Add extractor tests for deterministic hashing, exact-id collision handling,
  transitive alias closure, style dependencies, unresolved states, and profile
  size/scope.
- Update plugin integration tests and the manual Copy matrix.
- Document the architecture and contract, run `npm run check`, review the
  complete diff, and publish the verified commit to `main`.

## Acceptance criteria

1. Component Copy says `version: 5` and `profile: ai`.
2. Repeated copies of unchanged component/Foundation facts have one component
   semantic hash despite different timestamps or generated guidelines.
3. Two same-named Foundation entities never collapse when their ids differ.
4. A referenced local alias includes its complete local transitive closure.
5. Unrelated collections, tokens, typography styles, and effect styles are
   absent from the component dependency slice.
6. Text/effect style definitions retain exact property-to-token relationships.
7. Missing or external definitions are stated, never silently replaced.
8. Existing component canvas hashes and legacy v4 golden output remain
   byte-for-byte unchanged.
