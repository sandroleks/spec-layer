---
title: Foundation Context v5 — status and handoff
status: Phase 1 complete, merged to main
schema_version: 5.0.0
last_updated: 2026-08-28
---

# Foundation Context v5 — status and handoff

Read this before touching `packages/extractor/src/v5/`. It is the state of the
v5 work as of 2026-08-28, written for someone with no prior context.

- **The contract:** [foundation-context-v5.md](foundation-context-v5.md). Cited throughout as §n.
- **The Phase 1 plan, as executed:** [../superpowers/plans/2026-08-27-foundation-v5-phase-1.md](../superpowers/plans/2026-08-27-foundation-v5-phase-1.md)
- **Phase 1 landed on `main` at `4a312eb`.** Not pushed; `main` is 116+ commits ahead of `origin/main`.

## What v5 is, and what it is not

v5 is a new export contract for the foundation half of Copy for AI. Its purpose
is to hand a code-generating agent a foundation description it cannot
misread — explicit types, units, modes, references, and an honest account of
whatever the source did not state.

**Phase 1 changed nothing about what the plugin emits.** The plugin still
produces v4. Phase 1 built the target shape plus a migration into it, so a real
v4 export can be converted and graded before any extraction code moves. Nothing
in `src/v5/` reads Figma; every module runs under vitest with no host.

## The one rule that explains most of the code

**Never fabricate a value.** A value the source did not state is represented as
not-stated — a `missing` record, an `unresolved` alias, an absent field — plus a
diagnostic. Never a plausible default, a clamped number, a padded string, a
guessed unit, or a claim of completeness that is not true.

Several decisions look over-careful until you apply this rule:

- `colorFromHex` **rejects** `#ff` instead of padding it to `#ff0000`.
- `numericValue` returns `null` for an un-narrowed Figma scope instead of guessing `px`. A previous generator guessed from a token name and emitted `font-weight: 600px`, which no CSS parser rejects loudly.
- The collection default mode falls back to a sentinel Level 2 **rejects** (`<no-default-mode-stated>`) rather than to `modes[0]`, which Level 2 would silently accept.
- `completeness.styles` reports `'partial'` when v4 carried styles this phase does not migrate, rather than `'complete'` with empty arrays.

If you find yourself adding a default to make something pass, you are undoing a
deliberate decision. The comment above it will say so.

## Module map — `packages/extractor/src/v5/`

| File | Responsibility |
|---|---|
| `value.ts` | `CanonicalValue` (`literal`/`alias`/`missing`), `TypedValue`, `ResolutionStep`, guards, and the runtime vocabulary arrays |
| `entities.ts` | `CollectionV5`, `TokenV5`, `TypographyStyleV5`, `EffectStyleV5`, `ExtractionCompleteness` |
| `precision.ts` | The numeric precision policy. One function, applied to every number reaching the artifact |
| `color.ts` | Colour canonicalization. Returns a result type; rejects rather than repairs |
| `units.ts` | Figma scopes → `dimension` + unit, or `number`, or `null` |
| `diagnostics.ts` | The §14.1 code table plus 6 additions, severities, `compareCodeUnits`, total-order sorting |
| `canonical.ts` | Envelope, `SemanticPayload`, `canonicalJson`, `semanticContentHash` |
| `validate.ts` | `validateLevel1` (schema validity) and `validateLevel2` (referential integrity) |
| `normalize.ts` | `normalizeV4` — the v4 → v5 migration |
| `schema/foundation-5.0.0.json` | The published JSON Schema. A consumer artifact, not our validation engine |

103 tests in `packages/extractor/test/v5/`; 1601 repo-wide.

## Four invariants that are easy to break by accident

**1. There are THREE content hashes and they must not be conflated.**

- `specContentHash` (`src/hash.ts`) — component drift. Hashes only what a canvas frame draws, because it drives the on-canvas "update available" badge.
- `foundationContentHash` (`src/hash.ts`) — foundation drift, same job, same rule.
- `semanticContentHash` (`src/v5/canonical.ts`) — artifact identity, for a consumer diffing two exported YAML files.

Changing either of the first two flips every committed document to "update
available". Phase 1 left both byte-for-byte untouched and must stay that way.

**2. `src/v5/` must never use `hash.ts`'s `canonical()`.** It sorts keys with
`a.localeCompare(b)`, which is locale-dependent: the same payload hashes
differently under `en_US` and `et_EE`, and `lt_LT` reorders `i`/`y`. The plugin
runs in the user's browser locale. `canonicalJson` in `canonical.ts` is the
code-unit replacement. **Never call `localeCompare` anywhere in `src/v5/`** — use
`compareCodeUnits` from `diagnostics.ts`.

**3. The content hash covers exactly `completeness`, `collections`, `tokens`,
`styles`.** Not the envelope (holds the timestamp and export id), not
`diagnostics` (prose; rewording must not change identity), not `statistics`
(derivable, per §15). `completeness` is inside on purpose: an export that failed
to read a library and one that read it and found nothing produce identical
tokens, so without it those two hash the same.

**4. `ajv` is a devDependency for the schema-parity test only.** Nothing under
`src/` may import it — `npm run check:sandbox` guards the plugin bundle.

## What is outstanding

### Task 10 — blocked on a real export
Nine of the twelve §21.1 acceptance criteria are `it.todo` in
`packages/extractor/test/v5/acceptance.test.ts`, behind a manifest test
(`phaseCoverage.ts`) that asserts which phase owns each, so CI names the gap
rather than implying it passed. Phase 1 grades criteria 6, 7a, 8 and 12 only.

To unblock: export the real Company DS foundation with the current plugin
("Copy foundation for AI"), commit the raw v4 YAML verbatim, and normalize it.
**Read it end to end first** and decide explicitly whether `source.file_key`
ships or is redacted.

### Plans 2, 3, 4 — not written
| Plan | Scope |
|---|---|
| 2 | Stable ids through extraction, mode-id keying, `scopes` on `FoundationVariable`, colour floats surviving `serializeFoundation.ts`, the alias graph, `EXTRACTOR_VERSION` bump |
| 3 | Composite typography and effect styles with bindings, publication and lifecycle metadata, drift/archive/confusable diagnostics |
| 4 | `validate`/`normalize`/`diff` as library functions, golden fixtures in CI, and the component brief's own hardening items |

**Plan 2 reverses a documented rule.** "Internal ids stay inside" is argued at
`brief.ts:120`, `:138`, `:455` and on `tree.ts`'s `RefIdentity`. §6 requires ids
as identity. Those comments must change with the behaviour, not be left
contradicting the output.

**Plan 3 needs a Figma API audit first.** Several §13 fields (`file_version`,
`modified_at`, `library_file_id`) may not be reachable from the plugin sandbox
at all. Confirm before committing to Level 3 completeness; where a field is
unreachable, say so in the schema rather than emitting `null` forever.

**Plan 4 carries ten component-brief items** the v5 spec does not cover. Their
task detail is in
[../superpowers/plans/2026-08-27-export-hardening.md](../superpowers/plans/2026-08-27-export-hardening.md),
whose *foundation* tasks are dead and must not be implemented.

### Deferred to plan 2 — two real gaps, documented in code
- `foundationBrief` never serializes `FoundationSpec.unavailable`, so no real v4 document carries it and `completeness` cannot fire on real input. Wiring it into the v4 emitter belongs with extraction changes.
- The alias rule that matches on `(collection, path)` cannot reach `resolved` with current v4 output: `valueOf` emits `collection` only on external aliases, and those never carry a resolved value. The branch is kept because it becomes reachable when internal aliases gain collection qualifiers (backlog item A4). Do not delete it as dead code.

### Deferred minors — none block anything
- `precision.ts`: non-integers just below 2²⁴ hit a cliff (`16777215.5` → `16777220`). Accepted consequence of the float32 basis; no design value lives there.
- `color.ts:167`: a rejection reason interpolates raw source values with no length bound. Messages are hash-excluded.
- `color.ts`: `EPSILON = 1e-6` is not derived from `precision.ts`'s `SIGNIFICANT_DIGITS`, so the two can drift.
- The schema validates tokens and values field-by-field but only top-level shape for `collections`, `styles`, `diagnostics` and the envelope. Symmetric with the hand-written validator, so not a parity gap — but "Level 1 passes" is a weaker guarantee for those four sections than it looks.
- No `additionalProperties: false` anywhere in the schema, so unknown keys pass both validators. Possibly correct by design: §19 requires consumers to ignore unknown additive fields.
- `validateLevel1`'s outer try/catch means a genuine logic error inside the validator surfaces as a malformed-artifact diagnostic rather than a crash. Judged acceptable twice; the message is distinguishable.
- `parseV4Path` treats a doubled backslash before a slash as literal-backslash plus de-escaped-slash and never splits there. Undocumented reading of a genuinely ambiguous input.
- Stale v4 mode-name values are still dropped silently, and duplicate v4 mode names collapse to one synthetic mode id with no check covering mode ids.

## Settled decisions — do not reopen
- **No CLI.** §20 is deferred. `validate`/`normalize`/`diff` ship as library functions. The plugin remains the only extraction path; no Figma REST API work.
- **The component brief aligns to v5** in the same release (plan 4). It still emits `BRIEF_VERSION = 4` today.
- **Contrast checking stays out.** Removed from the brief by decision in v3 (`brief.ts:37`) because its failure list grew with the file and dominated a payload whose job is to hand an agent a token vocabulary. It is not in the v5 spec.
- **`SCHEMA_URI` is `https://spec-layer.dev/schemas/foundation-context/v5.json`**, confirmed permanent 2026-08-28. Shared by the schema `$id` and every artifact's `schema_uri`; changing it after artifacts ship is a contract break.
- **`extractor.version` stays an opaque non-semver identifier**, separate from `schema_version`. `version.ts` explains why, and §5.1 requires them kept apart.
- **`target_mode_id` lives in `ResolutionStep`, not on `AliasReference`.** A Figma `VARIABLE_ALIAS` points at a variable and carries no mode; the mode is a resolution decision, and putting it on the reference would state it as source data and duplicate the first chain step.

## One process note worth keeping

Phase 1 was executed task-by-task with an independent review after each, and a
whole-branch review at the end. **Five defects were found. All five were in the
plan, not the implementations** — every implementation was a faithful
transcription of what it was given. Four were caught by per-task reviews; the
worst was caught only by the whole-branch review, because it involved what one
task *imported* from outside its own diff:

| Defect | Caught by |
|---|---|
| Precision specified as decimal places; `139.9999976158142` cannot reach `140` that way | Task 2's implementer, which reported the contradiction instead of forcing the test green |
| `sortDiagnostics` not a total order — ties fell through to Figma's iteration order | Task 5 review |
| A `files` array that would have dropped `src/index.ts` from any publish | Task 7 review |
| Alias rule 1 unreachable; `unavailable` a field no real v4 document carries | Task 9 review |
| `semanticContentHash` inheriting a `localeCompare` key sort | Whole-branch review |

The tests never caught any of them. The reviews did.
