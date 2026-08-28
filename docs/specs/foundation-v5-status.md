---
title: Foundation Context v5 — status and handoff
status: Phase 2 implementation and real-source review complete; compact AI projection added
schema_version: 5.0.0
last_updated: 2026-08-28
---

# Foundation Context v5 — status and handoff

Read this before changing `packages/extractor/src/v5/` or Foundation Copy for
AI. The normative contract is
[foundation-context-v5.md](foundation-context-v5.md), and the executed Phase 2
plan is
[2026-08-28-foundation-v5-phase-2.md](../superpowers/plans/2026-08-28-foundation-v5-phase-2.md).

Phase 2 implementation is on `main`; the implementation/acceptance head is
`f4dea8a`. Phase 1's v4 normalizer remains supported and independently graded.

## Current product behavior

- Whole-file and collection-row Foundation **Copy for AI** first build the full
  Foundation Context schema `5.0.0` artifact directly from `FoundationSpec`
  through `buildFoundationArtifactV5`, then derive the compact `profile: ai`
  clipboard context through `foundationAiContext`.
- The direct path preserves stable collection, mode, and variable ids; source
  scopes; mode-id keyed values; retained RGBA precision; complete local alias
  chains; external reference metadata; read failures; and completeness.
- It never round-trips through `foundationBrief` or `normalizeV4`.
- A collection-row copy contains the requested collection plus complete
  transitive local dependency collections. Frame-only group and four-column
  mode limits do not narrow clipboard output.
- A text-style-only Library-row copy remains on the legacy v4
  `narrowFoundation -> foundationBrief` path. Phase 2 intentionally emits no v5
  composite styles, so moving this path early would copy an empty typography
  list and lose the requested data.
- Generated group descriptions are a `guidelines` annotation outside the
  semantic payload and therefore do not alter the content hash.
- The clipboard profile nests tokens beneath collections, uses readable mode
  and alias labels, removes empty/derived repetition, replaces diagnostic prose
  with issue counts, and restores source ids only for ambiguous names. It keeps
  the canonical semantic hash and does not replace or modify the full artifact.
- The reviewed Company DS artifact measured 9,989 lines / 350,905 bytes in
  canonical form and 2,539 lines / 108,357 bytes in the AI profile.

The plugin package version for the published release is `5.0.0`. This is
separate from Foundation schema `5.0.0` and from `EXTRACTOR_VERSION = '2'`.

## Direct architecture

| Boundary | Responsibility |
|---|---|
| `foundation.ts` | Pure source model, stable provenance, scopes, RGBA facts, unavailable inventory, iterative alias graph |
| `v5/fromFoundation.ts` | Pure synchronous `FoundationSpec -> FoundationArtifactV5` production export |
| `v5/validate.ts` | Level 1 shape validation and independent Level 2 reference/chain replay |
| `v5/canonical.ts` | Semantic payload, envelope, code-unit canonical JSON, semantic hash |
| `v5/statistics.ts` | Statistics derived only from finished artifact sections and final diagnostics |
| `v5/aiContext.ts` | Deterministic prompt-sized projection of a finished artifact; readable references and ambiguity-only ids |
| `ui/actions.ts` | Whole/collection v5 Copy integration and temporary text-style v4 boundary |

The direct builder constructs a complete provisional artifact, requires Level 1
to pass, runs Level 2 once, merges/deduplicates its findings, recomputes final
statistics, and returns the final artifact. Diagnostics do not block Copy:
unresolved library aliases and partial reads are expected to remain useful,
explicit output.

## Mode and alias policy

Mode ids are collection-scoped. Every local hop selects its target mode using
this policy:

1. Within one collection, preserve the source mode id.
2. Across collections, use the one target mode whose display name exactly
   matches the source mode name.
3. More than one exact-name match is ambiguous and unresolved.
4. With no exact match, use the target collection's declared default only when
   that id names a declared mode.
5. Otherwise report `target_mode_unresolvable`; never select the first mode.

Every chain records every `(token_id, mode_id)` hop. Level 2 independently
replays the policy from collection metadata instead of trusting the recorded
chain, verifies every adjacency and terminal literal, and compares the resolved
snapshot with that terminal. Only Figma's raw-type specializations are allowed:
`number <-> dimension` and `string <-> font_family`.

External library variables keep their stable target id and whatever target
path, collection id, and library name Figma exposed. They remain unresolved in
Phase 2 even when their path collides with a local variable. Missing metadata is
`null`/empty, not invented.

## Hash and compatibility boundaries

Three hashes answer different questions:

- `specContentHash` — component canvas drift;
- `foundationContentHash` — Foundation canvas drift;
- `semanticContentHash` — exported artifact identity.

Stable ids, scopes, RGBA channels, alias references/chains, and completeness
move only the semantic hash. They are structurally excluded from the legacy
canvas projection, so existing Foundation frames do not report false updates.
The v4 brief remains keyed by mode display name and does not acquire ids,
scopes, channels, or full chains.

The extractor compatibility id changed once, from `1` to `2`, because the
Foundation extraction/export contract changed. Component briefs also carry
this shared opaque id, so existing connected component docs may request one
rebuild after upgrading even though their canvas projection did not change.
`BRIEF_VERSION` remains `4`; `SCHEMA_VERSION` remains `5.0.0`.

## Acceptance state

The raw publishable fixture
`packages/extractor/test/fixtures/v5/synthetic-foundation-serialized.json`
and its reviewed direct golden independently grade the engine behavior v4 could
not represent. They cover real ids/mode ids, duplicate display names, exact and
lossy colors, unit scopes, a three-hop cross-collection chain, a cycle,
readable/unreadable external aliases, a local path collision, a missing mode
value, a confusable path, and intentionally unmigrated source styles.

The Phase 1 v4 migration fixture and golden remain unchanged except for the
shared extractor compatibility stamp. `phaseCoverage.ts` records
`implementedBy` separately from `gradedBy`, so synthetic engine coverage cannot
be mistaken for Company DS acceptance.

Still open:

- The manual Figma matrix in `packages/plugin/TESTING.md` has not yet been run
  against a development build.
- Real Company DS criteria 1, 2, 4, 5, and 7b passed a manual review of the
  supplied v5 artifact: 6 unique collection ids, 10 unique mode ids, 464 unique
  token ids, complete mode coverage, 354 resolved aliases, the expected 3
  unavailable deprecated-library references, and 214 dimensional values with
  explicit `px` units. The artifact is not committed, so these remain manual
  evidence rather than a repository golden.
- A real v5 artifact must not be committed without explicit approval covering
  stable Figma ids, collection/token/library names, descriptions, code syntax,
  generated guidelines, and diagnostics. `source.file_id` should be redacted to
  `null` by default; envelope source metadata is outside the semantic hash.

## Phase 3 starting points

Phase 3 owns composite typography and effect-style extraction. Start with a
Figma API audit for stable style ids, property bindings, publication state,
remote/library metadata, and lifecycle evidence. Then populate
`styles.typography` and `styles.effects`, move text-style-only Library Copy to
v5, and close combined acceptance criterion 3. Criteria 9–11 remain Plan 3.

Fields the plugin API cannot expose must remain explicitly unavailable; do not
fill permanent `null` fields and call that complete source data.

## Release invariants

- Never fabricate a value, unit, mode, id, or completeness claim.
- Do not use `localeCompare` under `src/v5`; use `compareCodeUnits`.
- Keep the extractor and landing schemas byte-identical.
- Keep `guidelines`, diagnostics, statistics, timestamps, export ids, build ids,
  and source envelope metadata outside `SemanticPayload`.
- Keep the compact AI profile downstream of the validated artifact and outside
  every semantic/canvas hash. Do not weaken the canonical schema to save prompt
  space.
- Do not replace the source-sized alias limit with the old four-hop ceiling.
- A rollback reverts the plugin Copy call sites to `foundationBrief`; it does
  not alter schema/hash code or delete the direct fixture.
- Before a v5 release, verify the permanent schema URL returns the committed
  schema bytes and complete the manual matrix in `packages/plugin/TESTING.md`.
