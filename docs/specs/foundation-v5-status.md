---
title: Foundation Context v5 — status and handoff
status: Phase 4 component adoption implemented; tooling and real-source gates open
schema_version: 5.0.0
last_updated: 2026-08-29
---

# Foundation Context v5 — status and handoff

Read this before changing `packages/extractor/src/v5/` or Foundation Copy for
AI. The normative contract is
[foundation-context-v5.md](foundation-context-v5.md). The executed plans are
[Phase 2](../superpowers/plans/2026-08-28-foundation-v5-phase-2.md) and
[Phase 3](../superpowers/plans/2026-08-28-foundation-v5-phase-3.md). Component
adoption is recorded in the
[Component Context v5 plan](../superpowers/plans/2026-08-29-component-context-v5.md).

Phase 1's v4 normalizer remains supported and independently graded. Phase 3
changes canonical/clipboard output, not canvas drift inputs, so the shared
`EXTRACTOR_VERSION` remains `2` rather than marking every connected component
document for rebuild.

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
- Whole-file v5 artifacts now populate composite typography and effect styles
  with stable style ids, supported resolved properties, ordered shadow/blur
  layers, and exact property binding ids.
- A text-style-only Library-row copy now uses the compact v5 profile. It carries
  all typography styles plus only collections required by bound token
  dependencies; unrelated collections and effect styles stay out.
- Collection and token publication is emitted when both Figma publication
  facts are available. Style source state is emitted, but style publication,
  lifecycle, and consuming mode stay absent/null because the Plugin API does
  not expose enough evidence to state them.
- Composite typography and effect binding drift is computed only when every
  mode of the bound token has one identical resolved value. The exporter never
  picks a default mode for a mode-less style.
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
| `serializeFoundation.ts` | Figma API audit boundary; stable style ids, publication reads, and exact property binding ids |
| `foundation.ts` | Pure source model, stable provenance, scopes, RGBA facts, unavailable inventory, iterative alias graph |
| `v5/fromFoundation.ts` | Pure synchronous production export for tokens, composite styles, metadata, and binding drift |
| `v5/validate.ts` | Level 1 shape validation and independent Level 2 reference/chain replay |
| `v5/canonical.ts` | Semantic payload, envelope, code-unit canonical JSON, semantic hash |
| `v5/statistics.ts` | Statistics derived only from finished artifact sections and final diagnostics |
| `v5/aiContext.ts` | Deterministic prompt-sized projection of a finished artifact; readable references and ambiguity-only ids |
| `ui/actions.ts` | Whole, collection, and text-style v5 Copy integration |

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
path, collection id, and library name Figma exposed. They remain unresolved
when their remote mode/value graph is unavailable, even when their path
collides with a local variable. Missing metadata is `null`/empty, not invented.

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
value, a confusable path, stable typography/effect ids, property bindings,
ordered effect layers, publication state, and binding drift.

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
- Criteria 3, 10, and 11 now pass the synthetic direct engine/golden: styles
  have stable ids, a bound typography token retains identical per-mode values,
  and independent effect layers plus explicit binding drift survive. Company DS
  grading remains open until a reviewed Phase 3 real artifact is available.
- Criterion 9 cannot be graded from the current Figma Plugin API: local style
  enumeration exposes neither archived styles nor lifecycle evidence. The
  exporter leaves lifecycle absent and does not infer archive state from names.

## Phase 4 starting points

Phase 4 component adoption is implemented: component Copy now joins Foundation
v5 by exact id and embeds a validated dependency closure. Delivery is also
shipped: the plugin publishes a library's canonical v5 artifacts and their
ai-profile YAML to `api.spec-layer.com`, and the `spec-layer` CLI (`init`,
`pull`, `status`) writes them into a repo without re-deriving or re-validating
v5 output. A republish always stamps a fresh export id and `generatedAt`, so
`bundle.json` and `manifest.json` change on every re-pull even when the
underlying content is unchanged, while the `ai` YAML files and the semantic
content hashes stay stable. Remaining Phase 4 work is command tooling and
external adoption: `validate`, `normalize`, and `diff` commands,
consumer-facing fixture publication, CI integration beyond the current
library tests, and the remaining real-source/manual gates. Keep command
tooling outside the Figma sandbox and, when `validate`/`normalize`/`diff`
land, put them in `packages/cli` reusing the canonical validator/hash
implementation rather than creating a second interpretation of v5.

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
- A Foundation rollback reverts its plugin Copy call sites to
  `foundationBrief`; a component rollback reverts its Copy call site to
  `componentBrief`. Neither rollback alters schema/hash code or deletes the
  direct fixtures.
- Before a v5 release, verify the permanent schema URL returns the committed
  schema bytes and complete the manual matrix in `packages/plugin/TESTING.md`.
