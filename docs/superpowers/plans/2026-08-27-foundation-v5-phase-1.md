# Foundation Context v5 — Phase 1: Canonical schema and normalizer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the canonical v5 value model, its schema, its determinism guarantees, and a v4→v5 normalizer — so every later phase has one typed shape to write into and one validator to answer to.

**Architecture:** A new `packages/extractor/src/v5/` directory holds the contract: entity types, value model, colour/unit canonicalization, precision policy, diagnostics vocabulary, deterministic hashing, a hand-written validator, and the v4→v5 normalizer. Nothing in `v5/` reads Figma — it operates on already-extracted data, so it is testable without a plugin host. Phase 1 ships **no change to what the plugin emits**: it ships the target shape plus a migration into it, so the real v4 export can be converted and graded before any extraction code moves.

**Tech Stack:** TypeScript, vitest, `js-sha256` (the extractor's only runtime dependency). `ajv` is added as a **devDependency** for schema cross-validation in tests only.

---

## Revision note — 2026-08-27

This plan was reviewed and rewritten. Six blocking findings, all valid, all
applied:

1. `SemanticPayload` was `unknown[]`, so nothing shared one contract and Task 9's
   own examples would not have type-checked. **Task 1 now defines the concrete
   entity types.**
2. Alias chains were `string[]`, which cannot identify which mode of a target
   collection a cross-collection alias resolved through. **Chains are now
   `ResolutionStep[]`.**
3. Read failures and unavailable libraries are **not** derivable from the
   surviving payload, so two exports where one silently failed to read a library
   hashed identically. **A machine-readable `completeness` block is now part of
   the hashed payload.**
4. `canonicalColor` clamped garbage into plausible colours and `colorFromHex`
   padded malformed strings — both fabricate, in direct conflict with this
   plan's own first constraint. **Both now return a result type and emit
   `INVALID_SOURCE_COLOR`.**
5. `figma-name:<Collection>/<token name>` is not injective when a name contains
   a separator. **Ids are now percent-encoded per segment with an explicit
   entity kind, and v4 alias lookup has stated matching rules.**
6. `INFERRED_LIFECYCLE` was being used for synthetic identity and
   `UNSUPPORTED_VALUE_TYPE` for absent unit metadata. **Five dedicated codes
   added** (§14.1 says "at minimum", so extending the table is spec-compliant).

Plus: task order fixed to remove forward dependencies; `localeCompare` replaced
with a code-unit comparator (verified: it orders `['_','a','ä','B']` where code
units give `['B','_','a','ä']`); alias traversal made iterative; path-collision
scoped to within a collection; `canonicalNumber` fixed (the string-exponent form
returned **NaN** for `1e-7`, `5.5e-7` and `1e21` — verified); `it.skip` replaced
with `it.todo` plus a coverage manifest; the spec committed to the repo.

**One finding implemented differently from the suggestion, flagged for
overrule.** Review item 2 asked for `target_mode_id` on `AliasReference`. A
Figma `VARIABLE_ALIAS` points at a *variable id* and carries no mode — the mode
is chosen at resolution time, from the consuming context or the target
collection's default. Putting `target_mode_id` on the reference would state as
*source data* something the extractor *decided*, and would duplicate the first
chain step, giving one fact two owners (§5.2 forbids exactly that for the
compatibility view). So the mode identity lives in `ResolutionStep`, where every
hop carries `{ token_id, mode_id }` — which is strictly more information than a
single `target_mode_id`, and satisfies the requirement that chains be
mode-aware. If you want the field on the reference anyway, say so and it is a
two-line change.

---

## Scope: this is plan 1 of 4

| Plan | Spec phase | Ships |
|---|---|---|
| **1 (this one)** | §22 Phase 1 | Entity types, canonical value model, units, colour, precision, diagnostics vocabulary, JSON Schema, Level 1-2 validation, deterministic hashing, v4→v5 normalizer |
| 2 | §22 Phase 2 | Stable ids through extraction, mode-id keying, alias graph, resolution chains, external-reference diagnostics |
| 3 | §22 Phase 3 | Composite typography and effect styles with bindings, publication and lifecycle metadata, drift/archive/confusable diagnostics |
| 4 | §22 Phase 4 (partial) + component brief | `validate`/`normalize`/`diff` as library functions, golden fixtures in CI, and the component brief's own hardening items |

Write plan 2 only after plan 1 lands.

---

## Decisions taken

1. **No CLI.** §20 deferred. `validate`, `normalize` and `diff` ship as exported library functions; no `bin`, no flag parsing. The plugin remains the only extraction path.
2. **The component brief aligns to v5 in the same release**, adopting the same envelope, value model, id rules and diagnostics. Phase 1 builds that vocabulary; the component brief adopts it in plan 4 and stays on `BRIEF_VERSION = 4` until then.
3. **The golden fixture is a real export** the user supplies. Tasks 1-9 are testable without it.
4. **Contrast checking stays dropped.** Removed by decision in brief v3 (`brief.ts:37`) and absent from the spec.

---

## Global Constraints

- **No new *runtime* dependencies.** `js-sha256` is the only one. `ajv` and `js-yaml` are devDependencies and must never be imported from `src/`.
- **Nothing in `v5/` may import the Figma plugin API or reference `figma.*`.** These modules run under vitest with no host, which is what keeps `npm run check:sandbox` true.
- **Never fabricate a value.** An unknown unit is an absent unit and a diagnostic. A malformed colour is `missing` and a diagnostic. A clamped, padded or defaulted value that looks measured is the failure mode this artifact exists to prevent. This constraint outranks convenience everywhere, including in error paths.
- **`content_hash` covers the semantic payload: `completeness`, `collections`, `tokens`, `styles`.** Not the envelope, not prose diagnostics, not statistics. `completeness` is in because extraction failures are *not* recoverable from the surviving payload; diagnostics stay out because their prose is a rewording risk, and every fact they carry is either in the payload or in `completeness`.
- **`specContentHash` and `foundationContentHash` in `hash.ts` are different hashes and must not be touched.** They hash only what a canvas frame draws and drive the on-canvas drift badge; altering either flips every committed doc to "update available".
- **Ordering is by code unit, never `localeCompare`.** `localeCompare` without an explicit locale is implementation- and locale-dependent, so it is not a byte-stability guarantee.
- **One precision policy** (Task 2), applied to every number that reaches the artifact.
- **No NUL bytes.** See `brief.ts:398` — it happened, and a NUL separator evades every check in the repo.
- **Verification:** `npx vitest run packages/extractor/test/v5` during a task, `npm test` before its commit, `npm run check` before any commit touching `packages/plugin`. Never pipe `check:ci` — a pipe masks the exit code.

---

## File Structure

**Created — `packages/extractor/src/v5/`:**

| File | Responsibility |
|---|---|
| `entities.ts` | The artifact's typed entities: `CollectionV5`, `ModeV5`, `TokenV5`, `TypographyStyleV5`, `EffectStyleV5`, `EntityIdentity`, publication/lifecycle/source state, `ExtractionCompleteness`. |
| `value.ts` | `CanonicalValue` (`literal`/`alias`/`missing`), `TypedValue`, `ResolutionStep`, guards, and the runtime vocabulary arrays the schema is checked against. |
| `precision.ts` | The numeric precision policy. One function. |
| `color.ts` | Colour canonicalization returning a result type; rejects malformed input rather than repairing it. |
| `units.ts` | Figma scopes → `dimension` + unit or `number`; `null` when the file does not state one. |
| `diagnostics.ts` | The §14.1 table plus five migration codes, severities, constructor, code-unit ordering, strict-mode promotion. |
| `canonical.ts` | Envelope, `SemanticPayload`, `FoundationArtifactV5`, semantic content hash, code-unit comparators. |
| `validate.ts` | Level 1 (schema validity) and Level 2 (referential integrity) as pure functions returning diagnostics. |
| `normalize.ts` | v4 → v5 migration. |
| `schema/foundation-5.0.0.json` | The published JSON Schema. |

**Created — `docs/specs/foundation-context-v5.md`** (Task 0), the authoritative
spec this plan cites by section.

**Created — tests, one per source file, under `packages/extractor/test/v5/`.**

**Modified:** `packages/extractor/src/index.ts` (export the v5 surface), `package.json` (ajv devDependency).

**Why a directory:** the rest of `src/` is flat and that is the established
pattern, but `brief.ts` is 868 lines and `foundation.ts` 780. Ten more flat
files describing a *different* contract would make it impossible to tell which
module speaks v4 and which speaks v5. The directory is the boundary between the
two contracts and disappears when v4 does.

---

### Task 0: Commit the specification

The plan cites `§5.1`, `§9.6`, `§14.1`, `§21.1`, `§22` throughout with no
in-repo source, so a reader six months from now cannot check any of it.

**Files:**
- Create: `docs/specs/foundation-context-v5.md`

- [ ] **Step 1: Commit the spec verbatim**

Paste the *Foundation Extractor Improvement Specification* exactly as written,
with a front-matter block naming its status and version:

```markdown
---
title: Foundation Context v5
status: Proposed
schema_version: 5.0.0
adopted: 2026-08-27
---
```

Do not edit the text while committing it. The plan is allowed to disagree with
the spec; the spec is not allowed to quietly become the plan.

- [ ] **Step 2: Add a pointer from the plan**

Replace this plan's bare `§n` citations with links to
`docs/specs/foundation-context-v5.md` on first use of each section.

- [ ] **Step 3: Commit**

```bash
git add docs/specs/foundation-context-v5.md docs/superpowers/plans/2026-08-27-foundation-v5-phase-1.md
git commit -m "docs: commit the Foundation Context v5 specification"
```

---

### Task 1: Entity types and the canonical value model

§6, §7, §8, §9. Every value is a discriminated object, every entity is typed,
and resolution chains identify a mode at every hop.

**Files:**
- Create: `packages/extractor/src/v5/entities.ts`
- Create: `packages/extractor/src/v5/value.ts`
- Create: `packages/extractor/test/v5/value.test.ts`

**Interfaces:**
- Produces (`value.ts`): `TokenType`, `Unit`, `TypedValue` and its members, `ResolutionStep`, `AliasReference`, `AliasResolution`, `CanonicalValue`, `isLiteral`/`isAlias`/`isMissing`, `resolvedValueOf`, and the runtime arrays `SUPPORTED_UNITS`, `SUPPORTED_TOKEN_TYPES`, `SUPPORTED_VALUE_KINDS`.
- Produces (`entities.ts`): `EntityIdentity`, `ModeV5`, `CollectionV5`, `TokenV5`, `TypographyStyleV5`, `EffectStyleV5`, `PublicationState`, `LifecycleState`, `SourceState`, `StyleProperty`, `StyleBinding`, `EffectV5`, `Completeness`, `ExtractionCompleteness`.
- Consumed by: every other task.

**Note:** typography and effect entities are *defined* here and *populated* in
plan 3. Phase 1 emits empty arrays for them. They are defined now because
`SemanticPayload` must be typed end to end — the review's first finding was
exactly that leaving them loose breaks the contract everywhere else.

- [ ] **Step 1: Write the failing test**

```ts
// packages/extractor/test/v5/value.test.ts
import { describe, it, expect } from 'vitest';
import {
  isLiteral, isAlias, isMissing, resolvedValueOf,
  SUPPORTED_UNITS, SUPPORTED_TOKEN_TYPES,
} from '../../src/v5/value';
import type { CanonicalValue } from '../../src/v5/value';

const LITERAL: CanonicalValue = {
  kind: 'literal',
  value: { type: 'color', color_space: 'srgb', hex: '#006b62', alpha: 1 },
};

const RESOLVED_ALIAS: CanonicalValue = {
  kind: 'alias',
  reference: {
    target_id: 'VariableID:color-teal-500',
    target_collection_id: 'VariableCollectionId:color-base',
    target_path: ['color', 'teal-green', '500'],
    external: false,
  },
  resolved: {
    status: 'resolved',
    value: { type: 'color', color_space: 'srgb', hex: '#006b62', alpha: 1 },
    chain: [{ token_id: 'VariableID:color-teal-500', mode_id: 'base/default' }],
  },
};

const UNRESOLVED_ALIAS: CanonicalValue = {
  kind: 'alias',
  reference: {
    target_id: null, target_collection_id: null,
    target_path: ['coolGray-80'], external: true,
    source_library_name: 'Color base [deprecated]',
  },
  resolved: {
    status: 'unresolved', reason: 'source_library_unavailable',
    value: null, chain: [],
  },
};

const MISSING: CanonicalValue = { kind: 'missing', reason: 'no_value_for_mode' };

describe('canonical value', () => {
  it('discriminates the three kinds', () => {
    expect(isLiteral(LITERAL)).toBe(true);
    expect(isAlias(RESOLVED_ALIAS)).toBe(true);
    expect(isMissing(MISSING)).toBe(true);
    expect(isLiteral(RESOLVED_ALIAS)).toBe(false);
  });

  it('reads through a resolved alias to its typed value', () => {
    expect(resolvedValueOf(RESOLVED_ALIAS)).toEqual(
      { type: 'color', color_space: 'srgb', hex: '#006b62', alpha: 1 });
    expect(resolvedValueOf(LITERAL)).toEqual(LITERAL.value);
  });

  it('reads null through an unresolved alias, never a substituted default', () => {
    expect(resolvedValueOf(UNRESOLVED_ALIAS)).toBeNull();
    expect(resolvedValueOf(MISSING)).toBeNull();
  });

  it('carries a mode id at every hop of a resolution chain', () => {
    // A cross-collection alias points at a VARIABLE, not at a (variable, mode)
    // pair -- Figma's own alias carries no mode. Which mode of the target
    // collection was read is therefore a DECISION the extractor made, and a
    // chain that recorded only token ids would leave it unstated and force a
    // validator to re-guess it from mode names or defaults.
    const chain = (RESOLVED_ALIAS as Extract<CanonicalValue, { kind: 'alias' }>)
      .resolved.chain;
    for (const step of chain) {
      expect(typeof step.token_id).toBe('string');
      expect(typeof step.mode_id).toBe('string');
    }
  });

  it('exposes its vocabularies at runtime for schema cross-checking', () => {
    // Types are erased at compile time and cannot be compared against the
    // published JSON Schema. These arrays are what makes that check possible.
    expect(SUPPORTED_UNITS).toContain('px');
    expect(SUPPORTED_UNITS).not.toContain('pt');
    expect(SUPPORTED_TOKEN_TYPES).toContain('cubic_bezier');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/v5/value.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/v5/value"`.

- [ ] **Step 3: Write `value.ts`**

```ts
// packages/extractor/src/v5/value.ts
/**
 * The canonical value model — spec §9.
 *
 * One discriminated shape for every value in the artifact. v4's `valueOf`
 * emitted FOUR shapes for one `values` field -- an `{alias, resolved}` object,
 * a bare string, a bare number and a `{hex, alpha}` object -- so every consumer
 * needed a four-way type branch to read a single field. Here the branch is on
 * one key, `kind`, and it is always present.
 *
 * The rule this file exists to enforce: a value that is not known is
 * represented as a value that is not known. Never a plausible default. A
 * substituted black is indistinguishable from a measured one downstream, which
 * is how a generator ships something confidently wrong.
 */

export type TokenType =
  | 'color' | 'dimension' | 'number' | 'string' | 'boolean'
  | 'duration' | 'cubic_bezier' | 'font_family';

/** §9.5. `unitless` is deliberately absent: a unitless quantity is
 *  `type: number`, not a dimension with a null unit. */
export type Unit = 'px' | 'rem' | 'em' | '%' | 'deg' | 'ms' | 's';

/** Runtime mirrors of the two unions above. Types are erased at compile time,
 *  so without these the published JSON Schema and this module can drift with
 *  nothing to catch it. Kept adjacent to their types so a new member is one
 *  edit, and asserted equal in the schema test. */
export const SUPPORTED_UNITS: readonly Unit[] =
  ['px', 'rem', 'em', '%', 'deg', 'ms', 's'] as const;
export const SUPPORTED_TOKEN_TYPES: readonly TokenType[] =
  ['color', 'dimension', 'number', 'string', 'boolean',
   'duration', 'cubic_bezier', 'font_family'] as const;
export const SUPPORTED_VALUE_KINDS = ['literal', 'alias', 'missing'] as const;

export interface ColorValue {
  type: 'color';
  color_space: 'srgb';
  /** Lowercase, six digits, leading `#`. §9.6. */
  hex: string;
  /** 0..1, present even when opaque, so "opaque" and "alpha not stated" are
   *  never the same output. §9.6. */
  alpha: number;
  /** Source channels 0..1, emitted ONLY when the 8-bit hex above loses
   *  precision Figma actually had. Emitting them on every colour would triple
   *  a ramp's size for nothing. */
  channels?: [number, number, number];
}

export interface DimensionValue { type: 'dimension'; number: number; unit: Unit }
export interface NumberValue { type: 'number'; value: number }
export interface StringValue { type: 'string'; value: string }
export interface BooleanValue { type: 'boolean'; value: boolean }
export interface DurationValue { type: 'duration'; number: number; unit: 'ms' | 's' }
export interface CubicBezierValue { type: 'cubic_bezier'; value: [number, number, number, number] }
export interface FontFamilyValue { type: 'font_family'; value: string }

export type TypedValue =
  | ColorValue | DimensionValue | NumberValue | StringValue
  | BooleanValue | DurationValue | CubicBezierValue | FontFamilyValue;

/**
 * One hop of a resolution, identifying BOTH the token and the mode it was read
 * under.
 *
 * A Figma `VARIABLE_ALIAS` points at a variable id and carries no mode: which
 * mode of the target collection applies is resolved from the consuming context,
 * falling back to that collection's default. That makes the mode a decision the
 * extractor makes, and a chain of bare token ids leaves the decision unstated --
 * so a validator, a differ, or a second extractor would each have to re-derive
 * it from mode NAMES or defaults, which is the name-matching this artifact
 * exists to eliminate (§10).
 *
 * Deliberately NOT mirrored as a `target_mode_id` on AliasReference: the
 * reference describes what the source file states, the chain describes what
 * resolution did, and duplicating the first hop's mode across both would give
 * one fact two owners.
 */
export interface ResolutionStep { token_id: string; mode_id: string }

/** §9.2 — authoritative for lineage. `resolved` is a portability snapshot, so
 *  changing an alias target without changing the resolved value still shows up
 *  in a semantic diff (§10). */
export interface AliasReference {
  target_id: string | null;
  target_collection_id: string | null;
  /** Segmented, never joined: a segment can contain the separator, and a joined
   *  string makes "one node or two" unanswerable. */
  target_path: string[];
  external: boolean;
  /** Named only when the target lives in a library this export could not read. */
  source_library_name?: string;
}

export type UnresolvedReason =
  | 'source_library_unavailable' | 'target_not_found' | 'cycle'
  | 'type_mismatch' | 'depth_exceeded' | 'ambiguous_target';

export type AliasResolution =
  | { status: 'resolved'; value: TypedValue; chain: ResolutionStep[] }
  | { status: 'unresolved'; reason: UnresolvedReason; value: null; chain: ResolutionStep[] };

export type MissingReason =
  | 'no_value_for_mode' | 'unsupported_value_type'
  | 'invalid_source_value' | 'source_unavailable';

export type CanonicalValue =
  | { kind: 'literal'; value: TypedValue }
  | { kind: 'alias'; reference: AliasReference; resolved: AliasResolution }
  | { kind: 'missing'; reason: MissingReason };

export const isLiteral = (v: CanonicalValue): v is Extract<CanonicalValue, { kind: 'literal' }> =>
  v.kind === 'literal';
export const isAlias = (v: CanonicalValue): v is Extract<CanonicalValue, { kind: 'alias' }> =>
  v.kind === 'alias';
export const isMissing = (v: CanonicalValue): v is Extract<CanonicalValue, { kind: 'missing' }> =>
  v.kind === 'missing';

/**
 * The typed value a consumer would use, or null.
 *
 * Null for BOTH a missing value and an unresolved alias, deliberately: to a
 * generator they are the same fact -- there is no value here -- and the reason
 * they differ is carried by the record and the diagnostics, where it belongs. A
 * helper that papered over that with a default would defeat the model.
 */
export function resolvedValueOf(v: CanonicalValue): TypedValue | null {
  if (v.kind === 'literal') return v.value;
  if (v.kind === 'alias') return v.resolved.status === 'resolved' ? v.resolved.value : null;
  return null;
}
```

- [ ] **Step 4: Write `entities.ts`**

```ts
// packages/extractor/src/v5/entities.ts
/**
 * The artifact's typed entities — spec §6, §7, §8, §11, §12, §13.
 *
 * Concrete types, not `unknown[]`. The schema, the validator, the normalizer
 * and every consumer share exactly these declarations, which is the only way
 * the four can be kept in agreement by the compiler rather than by discipline.
 *
 * Typography and effect entities are DEFINED here and POPULATED in plan 3.
 * Phase 1 emits empty arrays for both. They are declared now because the
 * payload has to be typed end to end for anything else to type-check.
 */
import type {
  CanonicalValue, ColorValue, DimensionValue, TokenType, TypedValue,
} from './value';

/** §6 — id is identity, name and path are source text, and a generated code
 *  name may sit beside them but never replace them. */
export interface EntityIdentity {
  id: string;
  name: string;
  path: string[];
  suggested_code_name?: string;
}

export interface ModeV5 { id: string; name: string; order: number }

export interface PublicationState { published: boolean; hidden_from_publishing: boolean }

export interface SourceState {
  remote: boolean;
  library_file_id: string | null;
  library_name: string | null;
  modified_at: string | null;
}

export type LifecycleStatus = 'active' | 'deprecated' | 'archived';
export interface LifecycleState { status: LifecycleStatus; replacement_id: string | null }

export interface CollectionV5 extends EntityIdentity {
  default_mode_id: string;
  modes: ModeV5[];
  publication?: PublicationState;
  source?: SourceState;
}

export interface TokenV5 extends EntityIdentity {
  collection_id: string;
  type: TokenType;
  /** Required, and an empty string is a legal value: §8.2 distinguishes "has no
   *  description" from "the field was not exported". */
  description: string;
  scopes: string[];
  publication?: PublicationState;
  lifecycle?: LifecycleState;
  /** Keyed by MODE ID, never by mode display name. §7. */
  values: Record<string, CanonicalValue>;
}

/** §11 — a style property keeps its binding AND its resolved value, so a
 *  consumer can generate from the resolved value while a differ can still see
 *  that the binding moved. */
export interface StyleProperty {
  source:
    | { kind: 'literal' }
    | { kind: 'alias'; target_id: string | null; target_path: string[] };
  resolved: TypedValue | null;
}

export interface TypographyStyleV5 extends EntityIdentity {
  description: string;
  publication?: PublicationState;
  lifecycle?: LifecycleState;
  properties: {
    font_family: StyleProperty;
    font_weight: StyleProperty;
    font_size: StyleProperty;
    line_height: StyleProperty;
    letter_spacing: StyleProperty;
    paragraph_spacing: StyleProperty;
    paragraph_indent: StyleProperty;
    text_case: string;
    text_decoration: string;
  };
}

export type EffectKind = 'drop_shadow' | 'inner_shadow' | 'layer_blur' | 'background_blur';

export interface EffectV5 {
  type: EffectKind;
  visible: boolean;
  blend_mode: string;
  color?: ColorValue;
  offset_x?: DimensionValue;
  offset_y?: DimensionValue;
  blur?: DimensionValue;
  spread?: DimensionValue;
  show_behind_node?: boolean;
}

/** §12 — the explicit relationship between a scalar variable and the composite
 *  property it drives. `property` is a path like `effects[0].offset_y`. */
export interface StyleBinding { property: string; token_id: string }

export interface EffectStyleV5 extends EntityIdentity {
  /** The mode this style's values were read under, or null for a file with no
   *  variable modes. Stated rather than implied, for the same reason token
   *  values are keyed by mode id. */
  mode_id: string | null;
  effects: EffectV5[];
  bindings?: StyleBinding[];
  publication?: PublicationState;
  lifecycle?: LifecycleState;
}

export type Completeness = 'complete' | 'partial' | 'unavailable';

/**
 * What this export was actually able to read — and the reason the content hash
 * covers more than the payload.
 *
 * A read failure, an unavailable library, or a permission error is NOT
 * derivable from the data that survived: an export that silently failed to read
 * a library and one that read it and found nothing produce the same
 * `collections`, `tokens` and `styles`, and would hash identically. Hashing
 * this block is what makes those two exports different artifacts.
 *
 * Machine-readable on purpose. The prose diagnostic that accompanies a failure
 * stays OUT of the hash -- rewording a message must not change an artifact's
 * identity -- so the fact has to be carried in a form a reword cannot touch.
 *
 * `unavailable_sources` holds stable ids or library names, sorted by code unit,
 * so two exports failing on the same library agree byte for byte.
 */
export interface ExtractionCompleteness {
  collections: Completeness;
  styles: Completeness;
  unavailable_sources: string[];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/v5/value.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/extractor/src/v5/value.ts packages/extractor/src/v5/entities.ts packages/extractor/test/v5/value.test.ts
git commit -m "feat(v5): typed entities and canonical discriminated value model"
```

---

### Task 2: The numeric precision policy

§16 requires a documented precision policy and forbids binary floating-point
artifacts. The repo has three roundings today — alpha to 4 (`brief.ts:88`),
typography to 2 (`brief.ts:695`), the foundation's `text_styles` to none
(`brief.ts:257`) — which is why two documents disagree about one text style.

**The policy is SIGNIFICANT DIGITS, not decimal places.** An earlier draft of
this task specified six decimal places, which is wrong and was caught by its own
tests: `139.9999976158142` at six decimal places is `139.999998`, not `140`. The
artifacts are *relative*, because Figma stores these as float32 and hands back
the float64 widening — so the policy has to be relative too. Seven significant
digits is float32's own decimal precision (~7.2 digits), which is exactly the
precision the source actually held.

Verified against the corpus: 7 significant digits cleans all four observed
artifacts (`139.9999976158142`→`140`, `120.00000476837158`→`120`,
`0.30000001192092896`→`0.3`, `0.03999999910593033`→`0.04`) while preserving
every value Figma can genuinely express (`0.125`, `0.333333`, `1.005`,
`-0.005`). Eight digits fails — it leaves `0.30000001`. Six also happens to
work on these cases but has no principled basis and less headroom.

**Files:**
- Create: `packages/extractor/src/v5/precision.ts`
- Create: `packages/extractor/test/v5/precision.test.ts`

**Interfaces:** produces `canonicalNumber(n: number): number`. Consumed by Tasks 3, 4, 6, 9.

Two guards come before the rounding, and both are load-bearing:

- **Integers pass through untouched.** `toPrecision(7)` corrupts them:
  `Number.MAX_SAFE_INTEGER.toPrecision(7)` is `9.007199e+15`, silently changing
  the value. `Number.isInteger` also collapses `-0` on the way out.
- **Magnitudes at or above 2^24 pass through untouched.** That is float32's
  integer-exact limit; above it float32 cannot represent the value precisely at
  all, so "cleaning a float32 artifact" is not a meaningful operation and
  rounding would only destroy real digits.

- [ ] **Step 1: Write the failing test**

```ts
// packages/extractor/test/v5/precision.test.ts
import { describe, it, expect } from 'vitest';
import { canonicalNumber } from '../../src/v5/precision';

describe('canonicalNumber', () => {
  it('removes binary floating-point artifacts', () => {
    expect(canonicalNumber(139.9999976158142)).toBe(140);
    expect(canonicalNumber(120.00000476837158)).toBe(120);
    expect(canonicalNumber(0.30000001192092896)).toBe(0.3);
    expect(canonicalNumber(0.03999999910593033)).toBe(0.04);
  });

  it('keeps a value Figma can genuinely express', () => {
    // Figma's percent field expresses 12.5%, and letter spacing routinely
    // carries three decimals. A policy tight enough to erase the artifacts
    // above must be loose enough to keep these.
    expect(canonicalNumber(0.125)).toBe(0.125);
    expect(canonicalNumber(0.333333)).toBe(0.333333);
    expect(canonicalNumber(1.005)).toBe(1.005);
    expect(canonicalNumber(-0.005)).toBe(-0.005);
  });

  it('leaves integers alone, including ones toPrecision would corrupt', () => {
    // MAX_SAFE_INTEGER.toPrecision(7) is "9.007199e+15" -- a different number.
    expect(canonicalNumber(16)).toBe(16);
    expect(canonicalNumber(-1)).toBe(-1);
    expect(canonicalNumber(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(canonicalNumber(1e21)).toBe(1e21);
  });

  it('leaves a non-integer above float32 integer-exact range alone', () => {
    // Above 2^24 float32 cannot hold the value precisely, so there is no
    // artifact to clean and rounding would only discard real digits.
    expect(canonicalNumber(16777216.5)).toBe(16777216.5);
    expect(canonicalNumber(1.7976931348623157e308)).toBe(1.7976931348623157e308);
  });

  it('does not flatten a genuinely tiny number to zero', () => {
    // A small value is a small number, not an artifact. Under a
    // decimal-places policy these all collapsed to 0, which is data loss.
    expect(canonicalNumber(1e-7)).toBe(1e-7);
    expect(canonicalNumber(5.5e-7)).toBe(5.5e-7);
    expect(canonicalNumber(-1e-9)).toBe(-1e-9);
    expect(canonicalNumber(Number.MIN_VALUE)).toBe(Number.MIN_VALUE);
  });

  it('normalizes negative zero', () => {
    // -0 compares equal to 0 but serializes as `-0`, so leaving it makes two
    // semantically identical artifacts byte-different.
    expect(Object.is(canonicalNumber(-0), 0)).toBe(true);
  });

  it('passes a non-finite number through so a validator can reject it by name', () => {
    expect(Number.isNaN(canonicalNumber(NaN))).toBe(true);
    expect(canonicalNumber(Infinity)).toBe(Infinity);
    expect(canonicalNumber(-Infinity)).toBe(-Infinity);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/v5/precision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/extractor/src/v5/precision.ts
/**
 * The numeric precision policy — spec §16.
 *
 * SEVEN SIGNIFICANT DIGITS, applied to every number that reaches the artifact.
 *
 * Significant digits, not decimal places. Figma stores these numbers as float32
 * and hands back the float64 widening, so the error is RELATIVE: 140 arrives as
 * 139.9999976158142 and 0.3 as 0.30000001192092896, and no fixed number of
 * decimal places cleans both. Six decimals leaves 139.999998; eight significant
 * digits leaves 0.30000001. Seven is float32's own decimal precision (~7.2
 * digits), which is exactly the precision the source actually held -- so the
 * policy discards what float32 never carried and keeps everything it did.
 *
 * Why one policy: v4 had three (alpha to 4, typography to 2, foundation text
 * styles to none), and its foundation and component documents ended up
 * disagreeing about the same text style.
 *
 * NaN and Infinity pass through UNCHANGED. Mapping them to 0 would put a
 * fabricated number where an unrepresentable value belongs; passing them
 * through lets Level 1 validation reject them by name.
 */
const SIGNIFICANT_DIGITS = 7;

/** 2^24 -- the largest integer float32 represents exactly. At or above it,
 *  float32 cannot hold the value precisely in the first place, so there is no
 *  artifact to clean and rounding would only discard real digits. */
const FLOAT32_EXACT_LIMIT = 16777216;

export function canonicalNumber(n: number): number {
  if (!Number.isFinite(n)) return n;
  // Integers first, and not merely as a fast path: `toPrecision` CORRUPTS large
  // ones -- Number.MAX_SAFE_INTEGER.toPrecision(7) is "9.007199e+15", a
  // different number. `+ 0` on the way out also collapses -0 to 0, which is
  // required for byte stability: -0 equals 0 in every comparison but serializes
  // as `-0`.
  if (Number.isInteger(n)) return n + 0;
  if (Math.abs(n) >= FLOAT32_EXACT_LIMIT) return n + 0;
  return Number(n.toPrecision(SIGNIFICANT_DIGITS)) + 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/v5/precision.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/v5/precision.ts packages/extractor/test/v5/precision.test.ts
git commit -m "feat(v5): one numeric precision policy at float32 significant precision"
```

---

### Task 3: Colour canonicalization

§9.6. Explicit colour space, lowercase six-digit hex, alpha always present,
source channels preserved when the hex would lose them.

**A malformed or out-of-range colour must not be repaired into a plausible
one.** Clamping `1.4` to `1.0` and padding `#ff` to `#ff0000` both produce a
colour that looks measured and is not. This function returns a result and the
caller emits `missing` plus `INVALID_SOURCE_COLOR`.

The one exception is float noise: Figma's own colour arithmetic can produce
`1.0000000001`, which is not malformed data but a rounding artifact of the same
class `canonicalNumber` exists to erase. Values within one unit of the precision
policy are snapped; anything beyond is rejected.

**Files:**
- Create: `packages/extractor/src/v5/color.ts`
- Create: `packages/extractor/test/v5/color.test.ts`

**Interfaces:**
- Produces: `ColorResult = { ok: true; value: ColorValue } | { ok: false; reason: string }`, `canonicalColor(rgba)`, `colorFromHex(hex, alpha)`, `HEX_PATTERN`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/extractor/test/v5/color.test.ts
import { describe, it, expect } from 'vitest';
import { canonicalColor, colorFromHex } from '../../src/v5/color';

const ok = (r: ReturnType<typeof canonicalColor>) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.value;
};

describe('canonicalColor', () => {
  it('emits a lowercase six-digit hex with an explicit colour space', () => {
    expect(ok(canonicalColor({ r: 0, g: 0.4196078431372549, b: 0.3843137254901961, a: 1 })))
      .toEqual({ type: 'color', color_space: 'srgb', hex: '#006b62', alpha: 1 });
  });

  it('keeps alpha on a fully opaque colour', () => {
    expect(ok(canonicalColor({ r: 1, g: 1, b: 1, a: 1 })).alpha).toBe(1);
  });

  it('preserves source channels only when the hex would lose them', () => {
    const lossy = ok(canonicalColor({ r: 0.5, g: 0.5, b: 0.5, a: 1 }));
    expect(lossy.hex).toBe('#808080');
    expect(lossy.channels).toEqual([0.5, 0.5, 0.5]);

    const exact = ok(canonicalColor({ r: 0, g: 1, b: 0, a: 1 }));
    expect('channels' in exact).toBe(false);
  });

  it('rounds alpha to the documented precision', () => {
    expect(ok(canonicalColor({ r: 0, g: 0, b: 0, a: 0.03999999910593033 })).alpha).toBe(0.04);
  });

  it('snaps float noise at the range boundary', () => {
    // Figma's own colour arithmetic produces this; it is the artifact class
    // canonicalNumber exists for, not malformed data.
    expect(ok(canonicalColor({ r: 1.0000000001, g: 0, b: -1e-12, a: 1 })).hex)
      .toBe('#ff0000');
  });

  it('REJECTS a channel genuinely outside 0..1 instead of clamping it', () => {
    // Clamping 1.4 to 1.0 emits a colour that looks measured and is not. The
    // caller turns this into `missing` plus INVALID_SOURCE_COLOR.
    const r = canonicalColor({ r: -0.2, g: 1.4, b: 0.5, a: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('out of range');
  });

  it('REJECTS a non-finite channel', () => {
    expect(canonicalColor({ r: NaN, g: 0, b: 0, a: 1 }).ok).toBe(false);
  });
});

describe('colorFromHex', () => {
  it('accepts a valid three- or six-digit hex', () => {
    expect(ok(colorFromHex('#FFF', 1)).hex).toBe('#ffffff');
    expect(ok(colorFromHex('#006B62', 1)).hex).toBe('#006b62');
    expect(ok(colorFromHex('006b62', 1)).hex).toBe('#006b62');
  });

  it('REJECTS a malformed hex rather than padding or truncating it', () => {
    // v4's `#colors/blue/200` and a truncated `#ff` are both real defects seen
    // in exports. Padding `#ff` to `#ff0000` invents a colour.
    for (const bad of ['#ff', '#fffff', '#12345g', '#colors/blue/200', '', '#']) {
      expect(colorFromHex(bad, 1).ok).toBe(false);
    }
  });

  it('REJECTS an alpha outside 0..1', () => {
    expect(colorFromHex('#ffffff', 1.5).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/v5/color.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/extractor/src/v5/color.ts
/**
 * Colour canonicalization — spec §9.6.
 *
 * Figma hands out float RGBA in 0..1. v4 discarded the floats at extraction and
 * kept `{ hex, alpha }`, which is lossy by construction: 0.5 is 127.5 in 8 bits
 * and returns as 0.50196. For CSS that is invisible; for a system round-tripping
 * values back into Figma it is drift from nowhere. So the hex is the portable
 * form and the channels sit beside it WHEN, and only when, they carry something
 * the hex does not.
 *
 * This module REJECTS rather than repairs. An earlier draft clamped and padded,
 * which turned a corrupt channel into a plausible colour and a truncated `#ff`
 * into `#ff0000` -- fabrication, and in direct conflict with the rule that a
 * value not stated by the file is never invented. The caller turns a rejection
 * into `kind: missing` plus an INVALID_SOURCE_COLOR diagnostic, so the fact
 * survives in a form a consumer can act on.
 */
import { canonicalNumber } from './precision';
import type { ColorValue } from './value';

export type ColorResult =
  | { ok: true; value: ColorValue }
  | { ok: false; reason: string };

/** Three or six hex digits, with or without a leading `#`. Case-insensitive on
 *  input; output is always lowercase and six digits. */
export const HEX_PATTERN = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** One unit of the precision policy. A channel within this of the boundary is
 *  float noise from Figma's own arithmetic, not corrupt data. */
const EPSILON = 1e-6;

function snap(channel: number): number | null {
  if (!Number.isFinite(channel)) return null;
  if (channel < 0) return channel >= -EPSILON ? 0 : null;
  if (channel > 1) return channel <= 1 + EPSILON ? 1 : null;
  return channel;
}

const toByte = (channel: number): number => Math.round(channel * 255);
const hex2 = (byte: number): string => byte.toString(16).padStart(2, '0');

/** True when the 8-bit round trip does not return the source number, compared
 *  after the precision policy is applied to both sides so a difference below
 *  the policy's resolution is not treated as a loss. */
function lossy(channel: number): boolean {
  return canonicalNumber(toByte(channel) / 255) !== canonicalNumber(channel);
}

export function canonicalColor(
  rgba: { r: number; g: number; b: number; a: number },
): ColorResult {
  const r = snap(rgba.r);
  const g = snap(rgba.g);
  const b = snap(rgba.b);
  const a = snap(rgba.a);
  if (r === null || g === null || b === null || a === null) {
    return {
      ok: false,
      reason: `colour channel out of range or not finite: `
        + `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a})`,
    };
  }
  const value: ColorValue = {
    type: 'color',
    color_space: 'srgb',
    hex: `#${hex2(toByte(r))}${hex2(toByte(g))}${hex2(toByte(b))}`,
    alpha: canonicalNumber(a),
  };
  return {
    ok: true,
    value: (lossy(r) || lossy(g) || lossy(b))
      ? { ...value, channels: [canonicalNumber(r), canonicalNumber(g), canonicalNumber(b)] }
      : value,
  };
}

/**
 * A colour already stored as a hex string — the v4 migration path.
 *
 * No `channels` is emitted, because there are none to emit: v4 threw the floats
 * away. Claiming the hex IS the source precision would be a fabrication, and so
 * would claiming it is not; the absence is the honest statement.
 */
export function colorFromHex(hex: string, alpha: number): ColorResult {
  const trimmed = hex.trim();
  if (!HEX_PATTERN.test(trimmed)) {
    return { ok: false, reason: `not a valid hex colour: ${JSON.stringify(hex)}` };
  }
  const a = snap(alpha);
  if (a === null) return { ok: false, reason: `alpha out of range: ${alpha}` };
  const raw = trimmed.replace(/^#/, '').toLowerCase();
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  return {
    ok: true,
    value: { type: 'color', color_space: 'srgb', hex: `#${full}`, alpha: canonicalNumber(a) },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/v5/color.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/v5/color.ts packages/extractor/test/v5/color.test.ts
git commit -m "feat(v5): canonical colour that rejects malformed input instead of repairing it"
```

---

### Task 4: Units

§9.5. A dimension carries a unit; a unitless quantity is `type: number`. The
unit comes from Figma's `scopes` and never from a token name — our own generator
emitted `font-weight: 600px` because it guessed from a name.

**Files:**
- Create: `packages/extractor/src/v5/units.ts`
- Create: `packages/extractor/test/v5/units.test.ts`

**Interfaces:** produces `numericValue(n, scopes): DimensionValue | NumberValue | null`. `null` means "the file does not state a unit", which the caller turns into a `UNIT_METADATA_UNAVAILABLE` diagnostic.

- [ ] **Step 1: Write the failing test**

```ts
// packages/extractor/test/v5/units.test.ts
import { describe, it, expect } from 'vitest';
import { numericValue } from '../../src/v5/units';

describe('numericValue', () => {
  it('reads px from Figma dimension scopes', () => {
    for (const scope of ['WIDTH_HEIGHT', 'CORNER_RADIUS', 'GAP', 'FONT_SIZE', 'STROKE_FLOAT']) {
      expect(numericValue(16, [scope])).toEqual({ type: 'dimension', number: 16, unit: 'px' });
    }
  });

  it('reads a unitless number from FONT_WEIGHT', () => {
    // The exact case that produced `font-weight: 600px`.
    expect(numericValue(600, ['FONT_WEIGHT'])).toEqual({ type: 'number', value: 600 });
  });

  it('reads a unitless number from OPACITY', () => {
    expect(numericValue(0.5, ['OPACITY'])).toEqual({ type: 'number', value: 0.5 });
  });

  it('returns null rather than guessing when scopes say nothing', () => {
    // ALL_SCOPES is Figma's default: the designer never narrowed it, so the file
    // genuinely does not state a unit.
    expect(numericValue(16, ['ALL_SCOPES'])).toBeNull();
    expect(numericValue(16, [])).toBeNull();
    expect(numericValue(16, undefined)).toBeNull();
  });

  it('returns null when two scopes imply different units', () => {
    expect(numericValue(600, ['FONT_WEIGHT', 'CORNER_RADIUS'])).toBeNull();
  });

  it('returns null for a scope this version does not know', () => {
    // Forward compatibility (§19): a scope Figma adds later must read as "not
    // stated", never as a default.
    expect(numericValue(16, ['SOME_FUTURE_SCOPE'])).toBeNull();
  });

  it('applies the precision policy to the number', () => {
    expect(numericValue(139.9999976158142, ['WIDTH_HEIGHT']))
      .toEqual({ type: 'dimension', number: 140, unit: 'px' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/v5/units.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/extractor/src/v5/units.ts
/**
 * Unit resolution — spec §9.5.
 *
 * The unit comes from Figma's `Variable.scopes` and from nothing else. A token
 * NAME is not evidence: `spacing/400: 16` means 16px and
 * `font-weight/fw-600: 600` does not mean 600px, and the only thing separating
 * them in v4 was a guess a generator made and got wrong -- it emitted
 * `font-weight: 600px`, which no CSS parser rejects loudly.
 *
 * `null` is a first-class answer and the common one. ALL_SCOPES is Figma's
 * default, so an unnarrowed variable does not state its unit; reporting that is
 * useful, because a consumer then knows to ask a human. Guessing is not.
 */
import { canonicalNumber } from './precision';
import type { DimensionValue, NumberValue, Unit } from './value';

/** Figma scopes that pin a unit.
 *
 *  LINE_HEIGHT and LETTER_SPACING are absent on purpose: Figma carries their
 *  unit per style (PIXELS / PERCENT / AUTO), so a variable scoped to either has
 *  no single answer and must be resolved where the style is read (plan 3). */
const UNIT_BY_SCOPE: Record<string, Unit | 'number'> = {
  WIDTH_HEIGHT: 'px',
  CORNER_RADIUS: 'px',
  GAP: 'px',
  FONT_SIZE: 'px',
  STROKE_FLOAT: 'px',
  PARAGRAPH_SPACING: 'px',
  PARAGRAPH_INDENT: 'px',
  EFFECT_FLOAT: 'px',
  FONT_WEIGHT: 'number',
  OPACITY: 'number',
};

export function numericValue(
  n: number,
  scopes: string[] | undefined,
): DimensionValue | NumberValue | null {
  const units = new Set(
    (scopes ?? [])
      .map((s) => UNIT_BY_SCOPE[s])
      .filter((u): u is Unit | 'number' => u !== undefined),
  );
  // Zero known scopes means the file does not state a unit; two different ones
  // mean it states two, and picking one would be this function inventing a
  // decision the designer did not make.
  if (units.size !== 1) return null;
  const unit = [...units][0];
  return unit === 'number'
    ? { type: 'number', value: canonicalNumber(n) }
    : { type: 'dimension', number: canonicalNumber(n), unit };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/v5/units.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/v5/units.ts packages/extractor/test/v5/units.test.ts
git commit -m "feat(v5): resolve units from Figma scopes, never from token names"
```

---

### Task 5: The diagnostics vocabulary

§14. Structured, anchored to stable entity ids, using the §14.1 table — plus
five codes the migration needs. §14.1 says "At minimum", so extending the table
is spec-compliant; **overloading an existing code is not**. An earlier draft
used `INFERRED_LIFECYCLE` for name-derived identity and `UNSUPPORTED_VALUE_TYPE`
for a perfectly valid number whose unit metadata was absent. Both would teach a
consumer to distrust the block.

**Files:**
- Create: `packages/extractor/src/v5/diagnostics.ts`
- Create: `packages/extractor/test/v5/diagnostics.test.ts`

**Interfaces:** produces `DiagnosticCode`, `Severity`, `Diagnostic`, `DEFAULT_SEVERITY`, `diagnostic()`, `sortDiagnostics()`, `promoteToErrors()`, `hasErrors()`, `compareCodeUnits()`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/extractor/test/v5/diagnostics.test.ts
import { describe, it, expect } from 'vitest';
import {
  diagnostic, sortDiagnostics, promoteToErrors, hasErrors,
  DEFAULT_SEVERITY, compareCodeUnits,
} from '../../src/v5/diagnostics';

describe('diagnostics', () => {
  it('carries every code in the spec table with its default severity', () => {
    const expected: Record<string, string> = {
      UNRESOLVED_ALIAS: 'error', UNRESOLVED_EXTERNAL_ALIAS: 'error',
      ALIAS_CYCLE: 'error', ALIAS_TYPE_MISMATCH: 'error',
      MISSING_MODE_VALUE: 'error', DUPLICATE_SOURCE_ID: 'error',
      PATH_COLLISION: 'error', UNSUPPORTED_VALUE_TYPE: 'error',
      INCONSISTENT_VALUE_SHAPE: 'error',
      STYLE_BINDING_DRIFT: 'warning', CONFUSABLE_NAME: 'warning',
      INFERRED_LIFECYCLE: 'warning', DEPRECATED_REFERENCE: 'warning',
      GENERATED_NAME_COLLISION: 'warning',
      MODE_VALUES_IDENTICAL: 'info', MISSING_DESCRIPTION: 'info',
    };
    for (const [code, severity] of Object.entries(expected)) {
      expect(DEFAULT_SEVERITY[code as keyof typeof DEFAULT_SEVERITY]).toBe(severity);
    }
  });

  it('has dedicated codes for the migration facts, not overloaded ones', () => {
    expect(DEFAULT_SEVERITY.SYNTHETIC_IDENTITY).toBe('warning');
    expect(DEFAULT_SEVERITY.AMBIGUOUS_ALIAS_TARGET).toBe('error');
    expect(DEFAULT_SEVERITY.UNIT_METADATA_UNAVAILABLE).toBe('error');
    expect(DEFAULT_SEVERITY.SOURCE_PARTIALLY_UNAVAILABLE).toBe('error');
    expect(DEFAULT_SEVERITY.INVALID_SOURCE_COLOR).toBe('error');
  });

  it('takes its severity from the table without the caller restating it', () => {
    const d = diagnostic('ALIAS_CYCLE', { entity_id: 'V:1', message: 'a -> b -> a' });
    expect(d.severity).toBe('error');
    expect(d.entity_id).toBe('V:1');
  });

  it('orders by code unit, not by locale', () => {
    // localeCompare orders ['_','a','ä','B']; code units give ['B','_','a','ä'].
    // Only the second is a byte-stability guarantee.
    expect(['a', 'B', '_', 'ä'].sort(compareCodeUnits)).toEqual(['B', '_', 'a', 'ä']);
  });

  it('orders deterministically: severity, then code, then entity, then mode', () => {
    const unsorted = [
      diagnostic('MODE_VALUES_IDENTICAL', { entity_id: 'V:2', message: 'm' }),
      diagnostic('UNRESOLVED_ALIAS', { entity_id: 'V:2', message: 'm' }),
      diagnostic('UNRESOLVED_ALIAS', { entity_id: 'V:1', message: 'm' }),
      diagnostic('CONFUSABLE_NAME', { entity_id: 'V:1', message: 'm' }),
    ];
    expect(sortDiagnostics(unsorted).map((d) => [d.code, d.entity_id])).toEqual([
      ['UNRESOLVED_ALIAS', 'V:1'],
      ['UNRESOLVED_ALIAS', 'V:2'],
      ['CONFUSABLE_NAME', 'V:1'],
      ['MODE_VALUES_IDENTICAL', 'V:2'],
    ]);
  });

  it('is total: findings differing only in message or details still order stably', () => {
    // Array.sort is stable, so a comparator that returns 0 here would let the
    // CALLER's order decide -- and the caller's order follows Figma's internal
    // iteration. Two runs would then produce byte-different artifacts with no
    // design change behind them.
    const a = diagnostic('MISSING_MODE_VALUE', { entity_id: 'V:1', message: 'second' });
    const b = diagnostic('MISSING_MODE_VALUE', { entity_id: 'V:1', message: 'first' });
    expect(sortDiagnostics([a, b]).map((d) => d.message)).toEqual(['first', 'second']);
    expect(sortDiagnostics([b, a]).map((d) => d.message)).toEqual(['first', 'second']);

    const c = diagnostic('PATH_COLLISION', { entity_id: 'V:1', message: 'm', details: { n: 2 } });
    const d = diagnostic('PATH_COLLISION', { entity_id: 'V:1', message: 'm', details: { n: 1 } });
    expect(sortDiagnostics([c, d])).toEqual(sortDiagnostics([d, c]));
  });

  it('reports whether any error is present, for §14.2 exit behaviour', () => {
    expect(hasErrors([diagnostic('CONFUSABLE_NAME', { entity_id: 'V:1', message: 'm' })])).toBe(false);
    expect(hasErrors([diagnostic('ALIAS_CYCLE', { entity_id: 'V:1', message: 'm' })])).toBe(true);
  });

  it('promotes only the named codes in strict mode', () => {
    const given = [
      diagnostic('CONFUSABLE_NAME', { entity_id: 'V:1', message: 'm' }),
      diagnostic('MODE_VALUES_IDENTICAL', { entity_id: 'V:2', message: 'm' }),
    ];
    const strict = promoteToErrors(given, ['CONFUSABLE_NAME']);
    expect(strict[0].severity).toBe('error');
    expect(strict[1].severity).toBe('info');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/v5/diagnostics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/extractor/src/v5/diagnostics.ts
/**
 * The diagnostics vocabulary — spec §14.
 *
 * Anchored to stable entity ids rather than display names, so a diagnostic
 * survives a rename and joins back to the token it is about. Same two rules as
 * the v4 `validate.ts`: everything is COMPUTED, and there is nothing below
 * `info` -- a finding nobody should act on should not be emitted.
 *
 * The five codes below the spec table are ADDITIONS, permitted by §14.1's "At
 * minimum". They exist because the alternative was overloading: an earlier
 * draft reported name-derived identity as INFERRED_LIFECYCLE (which is about
 * archive state) and absent unit metadata as UNSUPPORTED_VALUE_TYPE (which is
 * about a value that cannot be represented at all). A code that means two
 * things means neither, and a consumer that learns to ignore one instance of it
 * ignores the other.
 */

export type Severity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
  // -- §14.1, complete --
  | 'UNRESOLVED_ALIAS' | 'UNRESOLVED_EXTERNAL_ALIAS' | 'ALIAS_CYCLE'
  | 'ALIAS_TYPE_MISMATCH' | 'MISSING_MODE_VALUE' | 'DUPLICATE_SOURCE_ID'
  | 'PATH_COLLISION' | 'UNSUPPORTED_VALUE_TYPE' | 'INCONSISTENT_VALUE_SHAPE'
  | 'STYLE_BINDING_DRIFT' | 'CONFUSABLE_NAME' | 'INFERRED_LIFECYCLE'
  | 'DEPRECATED_REFERENCE' | 'MODE_VALUES_IDENTICAL' | 'MISSING_DESCRIPTION'
  | 'GENERATED_NAME_COLLISION'
  // -- additions, per §14.1 "At minimum" --
  /** Identity was derived from a name because the source exposed no stable id.
   *  A rename will read as a delete plus an add until re-extraction. */
  | 'SYNTHETIC_IDENTITY'
  /** An alias names a target that more than one entity could satisfy. Reported
   *  rather than resolved by picking the first match. */
  | 'AMBIGUOUS_ALIAS_TARGET'
  /** A valid number whose unit the source does not state. The NUMBER is fine;
   *  what is missing is the metadata that makes it a dimension. */
  | 'UNIT_METADATA_UNAVAILABLE'
  /** Part of the source could not be read. Not derivable from the surviving
   *  payload, which is why `completeness` is also hashed. */
  | 'SOURCE_PARTIALLY_UNAVAILABLE'
  /** A colour the source states that cannot be canonicalized without inventing
   *  channels. Emitted instead of clamping or padding it into a plausible one. */
  | 'INVALID_SOURCE_COLOR';

export const DEFAULT_SEVERITY: Record<DiagnosticCode, Severity> = {
  UNRESOLVED_ALIAS: 'error',
  UNRESOLVED_EXTERNAL_ALIAS: 'error',
  ALIAS_CYCLE: 'error',
  ALIAS_TYPE_MISMATCH: 'error',
  MISSING_MODE_VALUE: 'error',
  DUPLICATE_SOURCE_ID: 'error',
  PATH_COLLISION: 'error',
  UNSUPPORTED_VALUE_TYPE: 'error',
  INCONSISTENT_VALUE_SHAPE: 'error',
  AMBIGUOUS_ALIAS_TARGET: 'error',
  INVALID_SOURCE_COLOR: 'error',
  SOURCE_PARTIALLY_UNAVAILABLE: 'error',
  // Error, not warning: §18 Level 4 requires every dimension to carry a unit,
  // so an artifact holding units-unknown numbers is genuinely not
  // code-generation ready and must not pass as though it were. The remedy is
  // re-extraction with scopes, which the message says.
  UNIT_METADATA_UNAVAILABLE: 'error',
  STYLE_BINDING_DRIFT: 'warning',
  CONFUSABLE_NAME: 'warning',
  INFERRED_LIFECYCLE: 'warning',
  DEPRECATED_REFERENCE: 'warning',
  GENERATED_NAME_COLLISION: 'warning',
  // Warning, not error: a migrated artifact with synthetic ids is still usable
  // for generation -- what it cannot do is survive a rename, which is a fact
  // about future diffs rather than about this artifact's correctness.
  SYNTHETIC_IDENTITY: 'warning',
  MODE_VALUES_IDENTICAL: 'info',
  MISSING_DESCRIPTION: 'info',
};

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  /** Stable id of the entity this is about. Never a display name. */
  entity_id: string;
  mode_id?: string;
  message: string;
  /** Structured detail, kept as data rather than folded into the message, so a
   *  consumer can act on it without parsing prose. */
  details?: Record<string, unknown>;
}

/**
 * Code-unit ordering.
 *
 * `String.prototype.localeCompare` without an explicit locale is
 * implementation- and locale-dependent -- it orders ['_','a','ä','B'] where
 * code units give ['B','_','a','ä'] -- so it cannot underwrite §16's byte
 * stability. Every sort in the v5 tree uses this comparator.
 */
export const compareCodeUnits = (a: string, b: string): number =>
  (a < b ? -1 : a > b ? 1 : 0);

/** Severity comes from the table, never from the call site: a code that means
 *  different things in different places means nothing. */
export function diagnostic(
  code: DiagnosticCode,
  fields: {
    entity_id: string; message: string;
    mode_id?: string; details?: Record<string, unknown>;
  },
): Diagnostic {
  return {
    code,
    severity: DEFAULT_SEVERITY[code],
    entity_id: fields.entity_id,
    ...(fields.mode_id !== undefined ? { mode_id: fields.mode_id } : {}),
    message: fields.message,
    ...(fields.details !== undefined ? { details: fields.details } : {}),
  };
}

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Worst-first for a human, then fully determined by code, entity and mode so
 *  two runs over one file cannot differ. Never discovery order, which follows
 *  Figma's internal ordering -- exactly what §16 exists to eliminate. */
export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || compareCodeUnits(a.code, b.code)
    || compareCodeUnits(a.entity_id, b.entity_id)
    || compareCodeUnits(a.mode_id ?? '', b.mode_id ?? '')
    // Message and details are tie-breakers, not display order. Without them
    // the comparator is not TOTAL: two findings can agree on severity, code,
    // entity and mode and differ only in what they say -- one token with two
    // malformed modes, or two distinct rules reporting the same code against
    // the same entity. Array.sort is stable, so such a pair would keep
    // whatever order the caller happened to produce, and the caller's order
    // follows Figma's internal iteration. That is precisely the leak §16
    // exists to close, and it would surface as an artifact that differs
    // between runs with no design change behind it.
    || compareCodeUnits(a.message, b.message)
    || compareCodeUnits(JSON.stringify(a.details ?? null), JSON.stringify(b.details ?? null)));
}

export const hasErrors = (diagnostics: Diagnostic[]): boolean =>
  diagnostics.some((d) => d.severity === 'error');

/** §14.2 strict mode promotes a SELECTION, never everything: a blanket
 *  promotion would fail a build on MODE_VALUES_IDENTICAL, which describes a
 *  legitimate design choice. */
export function promoteToErrors(
  diagnostics: Diagnostic[],
  codes: DiagnosticCode[],
): Diagnostic[] {
  const promoted = new Set(codes);
  return diagnostics.map((d) =>
    promoted.has(d.code) ? { ...d, severity: 'error' as const } : d);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/v5/diagnostics.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/v5/diagnostics.ts packages/extractor/test/v5/diagnostics.test.ts
git commit -m "feat(v5): diagnostics vocabulary with dedicated migration codes"
```

---

### Task 6: Envelope, payload, and the semantic content hash

§5.1, §16, §21.1.12.

**Files:**
- Create: `packages/extractor/src/v5/canonical.ts`
- Create: `packages/extractor/test/v5/canonical.test.ts`

**Interfaces:**
- Consumes: `contentHash` from `../hash` — **reuse it**, it already sorts keys recursively before hashing. A second canonicalizer would be a second definition of "the same content".
- Produces: `SCHEMA_VERSION`, `SCHEMA_URI`, `EXTRACTOR_NAME`, `Envelope`, `ArtifactSource`, `SemanticPayload`, `FoundationArtifactV5`, `semanticContentHash()`, `buildEnvelope()`.

**Read before starting:** `version.ts` argues that `EXTRACTOR_VERSION` is an
opaque equality-compared identifier deliberately *not* in semver, and that
bumping it marks every committed doc rebuild-required. §5.1 requires a separate
semver `schema_version`. Both are right; they are different things. Add
`SCHEMA_VERSION` alongside. **Do not** convert `EXTRACTOR_VERSION` to semver and
do not bump it here — Phase 1 changes no extraction output.

- [ ] **Step 1: Write the failing test**

```ts
// packages/extractor/test/v5/canonical.test.ts
import { describe, it, expect } from 'vitest';
import { semanticContentHash, buildEnvelope, SCHEMA_VERSION } from '../../src/v5/canonical';
import type { SemanticPayload } from '../../src/v5/canonical';

const COMPLETE: SemanticPayload = {
  completeness: { collections: 'complete', styles: 'complete', unavailable_sources: [] },
  collections: [],
  tokens: [],
  styles: { typography: [], effects: [] },
};

const SOURCE = {
  provider: 'figma' as const, file_id: 'F:1', file_name: 'DS',
  file_version: null, library_enabled: true,
};

const META = {
  exportId: 'one', generatedAt: '2026-01-01T00:00:00.000Z',
  build: 'abc123', source: SOURCE,
};

describe('semanticContentHash', () => {
  it('is stable across key order', () => {
    const reordered = {
      styles: COMPLETE.styles, tokens: COMPLETE.tokens,
      collections: COMPLETE.collections, completeness: COMPLETE.completeness,
    } as SemanticPayload;
    expect(semanticContentHash(reordered)).toBe(semanticContentHash(COMPLETE));
  });

  it('is prefixed with its algorithm', () => {
    expect(semanticContentHash(COMPLETE)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('distinguishes a complete export from one that could not read a library', () => {
    // THE reason completeness is hashed. Both exports carry the same surviving
    // tokens; one of them silently failed. Without this they hash identically
    // and a consumer diffing two exports sees no change at all.
    const partial: SemanticPayload = {
      ...COMPLETE,
      completeness: {
        collections: 'partial', styles: 'complete',
        unavailable_sources: ['Color base [deprecated]'],
      },
    };
    expect(semanticContentHash(partial)).not.toBe(semanticContentHash(COMPLETE));
  });

  it('moves when the payload moves', () => {
    const changed: SemanticPayload = {
      ...COMPLETE,
      tokens: [{ id: 'V:1' } as unknown as SemanticPayload['tokens'][number]],
    };
    expect(semanticContentHash(changed)).not.toBe(semanticContentHash(COMPLETE));
  });
});

describe('buildEnvelope', () => {
  it('excludes the timestamp, the export id and the build from the hash', () => {
    const a = buildEnvelope(COMPLETE, META);
    const b = buildEnvelope(COMPLETE, {
      ...META, exportId: 'two',
      generatedAt: '2026-12-31T00:00:00.000Z', build: 'def456',
    });
    expect(a.export.content_hash).toBe(b.export.content_hash);
  });

  it('separates schema version from extractor version', () => {
    const env = buildEnvelope(COMPLETE, META);
    expect(env.schema_version).toBe(SCHEMA_VERSION);
    expect(env.schema_version).toMatch(/^\d+\.\d+\.\d+$/);
    // EXTRACTOR_VERSION is an opaque equality-compared identifier and is
    // deliberately not semver. See version.ts.
    expect(env.extractor.version).not.toBe(env.schema_version);
  });

  it('writes null for an unavailable source field, never a placeholder', () => {
    // §5.1 forbids placeholder strings. v4's fileKeyOf already refuses to emit
    // the literal 'unknown' for the same reason.
    expect(buildEnvelope(COMPLETE, META).source.file_version).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/v5/canonical.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/extractor/src/v5/canonical.ts
/**
 * The artifact envelope and the semantic content hash — spec §5.1, §16.
 *
 * THREE hashes now exist in this codebase and they answer different questions:
 *
 *  - `specContentHash` (hash.ts) -- component drift. Hashes a projection of
 *    IntermediateSpec that excludes anything a canvas frame does not draw,
 *    because it drives the on-canvas "update available" badge.
 *  - `foundationContentHash` (hash.ts) -- foundation drift, same job, same rule.
 *  - `semanticContentHash` (here) -- artifact identity, for a consumer diffing
 *    two exported YAML files.
 *
 * Only the third is defined here, and the first two must not be altered to
 * serve it: every committed doc's baseline depends on their current definitions.
 */
import { contentHash } from '../hash';
import { EXTRACTOR_VERSION } from '../version';
import type { Diagnostic } from './diagnostics';
import type {
  CollectionV5, EffectStyleV5, ExtractionCompleteness, TokenV5, TypographyStyleV5,
} from './entities';

export const SCHEMA_VERSION = '5.0.0';
export const SCHEMA_URI = 'https://spec-layer.dev/schemas/foundation-context/v5.json';
export const EXTRACTOR_NAME = 'spec-layer-foundation';

export interface ArtifactSource {
  provider: 'figma';
  file_id: string | null;
  file_name: string | null;
  file_version: string | null;
  library_enabled: boolean;
}

export interface Envelope {
  kind: 'foundation';
  schema_version: string;
  schema_uri: string;
  extractor: { name: string; version: string; build: string | null };
  export: { id: string; generated_at: string; deterministic: boolean; content_hash: string };
  source: ArtifactSource;
}

/**
 * What the content hash covers.
 *
 * `completeness` is IN because extraction failures are not recoverable from the
 * data that survived them: an export that could not read a library and one that
 * read it and found nothing produce identical `collections`, `tokens` and
 * `styles`. Hashing the completeness state is what makes those two different
 * artifacts instead of the same one.
 *
 * `diagnostics` is OUT. Every fact a diagnostic carries is either in the
 * payload or in `completeness`, and its MESSAGE is prose -- rewording one must
 * not change an artifact's identity.
 *
 * `statistics` is OUT: §15 requires it to be derivable from the artifact, and
 * hashing a derived value alongside its source can only ever create false
 * differences.
 *
 * The envelope is OUT: it holds the timestamp, the export id and the build,
 * none of which is design data and all of which would make §21.1.12 false
 * across two builds of the extractor.
 */
export interface SemanticPayload {
  completeness: ExtractionCompleteness;
  collections: CollectionV5[];
  tokens: TokenV5[];
  styles: { typography: TypographyStyleV5[]; effects: EffectStyleV5[] };
}

export interface FoundationArtifactV5 extends SemanticPayload {
  spec_layer: Envelope;
  diagnostics: Diagnostic[];
  statistics: Record<string, unknown>;
}

export function semanticContentHash(payload: SemanticPayload): string {
  return `sha256:${contentHash({
    completeness: payload.completeness,
    collections: payload.collections,
    tokens: payload.tokens,
    styles: payload.styles,
  })}`;
}

export function buildEnvelope(
  payload: SemanticPayload,
  meta: {
    exportId: string; generatedAt: string;
    build: string | null; source: ArtifactSource;
  },
): Envelope {
  return {
    kind: 'foundation',
    schema_version: SCHEMA_VERSION,
    schema_uri: SCHEMA_URI,
    extractor: {
      name: EXTRACTOR_NAME,
      // Opaque, equality-compared, deliberately not semver -- see version.ts.
      // §5.1 requires this and schema_version kept apart precisely because they
      // answer different questions.
      version: EXTRACTOR_VERSION,
      build: meta.build,
    },
    export: {
      id: meta.exportId,
      generated_at: meta.generatedAt,
      deterministic: true,
      content_hash: semanticContentHash(payload),
    },
    source: meta.source,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/v5/canonical.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/v5/canonical.ts packages/extractor/test/v5/canonical.test.ts
git commit -m "feat(v5): envelope and semantic content hash over the completeness-aware payload"
```

---

### Task 7: The JSON Schema and Level 1 validation

§18 Level 1. The schema is **published for consumers**; our own validation is
hand-written so it runs in the plugin sandbox. Both must be proven to agree —
comparing two enum arrays does not do that, so every fixture goes through both.

**Files:**
- Create: `packages/extractor/src/v5/schema/foundation-5.0.0.json`
- Create: `packages/extractor/src/v5/validate.ts` (Level 1 only)
- Create: `packages/extractor/test/v5/validate.test.ts`
- Create: `packages/extractor/test/v5/schemaParity.test.ts`
- Modify: `package.json` (add `ajv` and `ajv-formats` to devDependencies)

**Interfaces:** produces `validateLevel1(artifact: unknown): Diagnostic[]`.

- [ ] **Step 1: Add ajv as a devDependency**

```bash
npm install --save-dev ajv ajv-formats
```

This does not violate the no-new-dependencies constraint: `ajv` is never
imported from `src/`, so nothing reaches the plugin bundle. Confirm with
`npm run check:sandbox` after Step 6.

- [ ] **Step 2: Write the failing Level 1 test**

```ts
// packages/extractor/test/v5/validate.test.ts
import { describe, it, expect } from 'vitest';
import { validateLevel1 } from '../../src/v5/validate';
import { OK_ARTIFACT } from './fixtures';   // see Step 4

describe('validateLevel1', () => {
  it('passes a well-formed artifact', () => {
    expect(validateLevel1(OK_ARTIFACT)).toEqual([]);
  });

  it('rejects a value that is not a discriminated object', () => {
    const bad = structuredClone(OK_ARTIFACT);
    (bad.tokens[0].values as Record<string, unknown>)['1:2/light'] = '#ffffff';
    const found = validateLevel1(bad);
    expect(found.map((d) => d.code)).toContain('INCONSISTENT_VALUE_SHAPE');
    expect(found[0].entity_id).toBe('VariableID:3:4');
    expect(found[0].mode_id).toBe('1:2/light');
  });

  it('rejects a dimension with no unit, and a unit outside the vocabulary', () => {
    for (const value of [
      { type: 'dimension', number: 16 },
      { type: 'dimension', number: 16, unit: 'pt' },
    ]) {
      const bad = structuredClone(OK_ARTIFACT);
      (bad.tokens[0].values as Record<string, unknown>)['1:2/light'] = { kind: 'literal', value };
      expect(validateLevel1(bad).map((d) => d.code)).toContain('UNSUPPORTED_VALUE_TYPE');
    }
  });

  it('rejects an uppercase, short or malformed hex', () => {
    for (const hex of ['#FFF', '#fff', '#ff', '#colors/blue/200']) {
      const bad = structuredClone(OK_ARTIFACT);
      (bad.tokens[0].values as Record<string, unknown>)['1:2/light'] = {
        kind: 'literal', value: { type: 'color', color_space: 'srgb', hex, alpha: 1 },
      };
      expect(validateLevel1(bad).map((d) => d.code)).toContain('UNSUPPORTED_VALUE_TYPE');
    }
  });

  it('rejects a non-finite number and an alpha outside 0..1', () => {
    const nan = structuredClone(OK_ARTIFACT);
    (nan.tokens[0].values as Record<string, unknown>)['1:2/light'] = {
      kind: 'literal', value: { type: 'number', value: Number.NaN },
    };
    expect(validateLevel1(nan).map((d) => d.code)).toContain('UNSUPPORTED_VALUE_TYPE');
  });

  it('rejects a resolution chain step missing its mode id', () => {
    const bad = structuredClone(OK_ARTIFACT);
    (bad.tokens[0].values as Record<string, unknown>)['1:2/light'] = {
      kind: 'alias',
      reference: { target_id: 'V:x', target_collection_id: 'C:1', target_path: ['x'], external: false },
      resolved: { status: 'resolved', value: { type: 'number', value: 1 }, chain: [{ token_id: 'V:x' }] },
    };
    expect(validateLevel1(bad).map((d) => d.code)).toContain('INCONSISTENT_VALUE_SHAPE');
  });

  it('reports a token missing a required field against its own id', () => {
    const bad = structuredClone(OK_ARTIFACT);
    delete (bad.tokens[0] as Record<string, unknown>).description;
    const found = validateLevel1(bad);
    // §8.2: description is required INCLUDING an empty string. An absent
    // description and an empty one are different facts.
    expect(found).toHaveLength(1);
    expect(found[0].entity_id).toBe('VariableID:3:4');
  });

  it('does not throw on input that is not an object at all', () => {
    // A validator that crashes on malformed input cannot report on malformed
    // input, which is the only time it matters.
    for (const input of [null, undefined, 42, 'x', []]) {
      expect(() => validateLevel1(input)).not.toThrow();
      expect(validateLevel1(input).length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/v5/validate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the shared fixture module**

Create `packages/extractor/test/v5/fixtures.ts` exporting `OK_ARTIFACT` (a
minimal valid artifact) and a `VALID_CASES` / `INVALID_CASES` array — one entry
per value type and per rejection rule. Tasks 8 and 9 reuse it, and Step 7 runs
every case through both validators.

- [ ] **Step 5: Write `validateLevel1`**

Requirements, each pinned by a test above:

- **Never throw.** Every check guards its input with `typeof` / `Array.isArray` first; unrecognized input yields a diagnostic.
- Anchor every diagnostic to `entity_id`, adding `mode_id` when the fault is in one mode's value.
- Per token: `id`, `collection_id`, `name`, `path` (non-empty array of strings), `type` in `SUPPORTED_TOKEN_TYPES`, `description` present and a string (empty allowed), `scopes` an array, `values` an object.
- Per value: `kind` in `SUPPORTED_VALUE_KINDS`; `literal` has `value` with a known `type`; `alias` has `reference` and `resolved`, `resolved.status` gates `value` vs `null`, and **every chain step has both `token_id` and `mode_id`**; `missing` has a `reason`.
- Per typed value: hex matches `/^#[0-9a-f]{6}$/`, alpha finite in 0..1, dimension `unit` in `SUPPORTED_UNITS`, every numeric field finite.
- `INCONSISTENT_VALUE_SHAPE` for a value that is not a well-formed discriminated object; `UNSUPPORTED_VALUE_TYPE` for one that is well-formed but carries something unrepresentable.

- [ ] **Step 6: Write the JSON Schema**

`schema/foundation-5.0.0.json`, draft 2020-12, `$id` equal to `SCHEMA_URI`,
`oneOf` on `kind` for the value union, `$defs.unit` and `$defs.token_type`
enums. Add the file to the extractor package's `files` array so it ships.

- [ ] **Step 7: Write the parity test — this is the anti-drift check**

```ts
// packages/extractor/test/v5/schemaParity.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { validateLevel1 } from '../../src/v5/validate';
import { SCHEMA_URI } from '../../src/v5/canonical';
import { VALID_CASES, INVALID_CASES } from './fixtures';

const schema = JSON.parse(
  readFileSync('packages/extractor/src/v5/schema/foundation-5.0.0.json', 'utf8'),
) as Record<string, unknown>;

const ajv = addFormats(new Ajv2020({ allErrors: true, strict: true }));
const compiled = ajv.compile(schema);

describe('schema parity', () => {
  it('is itself a valid 2020-12 schema', () => {
    // strict: true above makes ajv reject an unknown keyword or a malformed
    // $ref at compile time, which is what "validate the schema itself" means
    // in practice.
    expect(() => ajv.compile(schema)).not.toThrow();
    expect(schema.$id).toBe(SCHEMA_URI);
  });

  it('accepts every valid fixture, in both validators', () => {
    for (const { name, artifact } of VALID_CASES) {
      expect(compiled(artifact), `schema rejected ${name}: ${ajv.errorsText(compiled.errors)}`)
        .toBe(true);
      expect(validateLevel1(artifact), `handwritten rejected ${name}`).toEqual([]);
    }
  });

  it('rejects every invalid fixture, in both validators', () => {
    // Agreement on rejection is the check that matters: a schema that is merely
    // laxer than the validator passes an "accepts everything valid" test while
    // silently letting a broken artifact through to a consumer who trusts it.
    for (const { name, artifact } of INVALID_CASES) {
      expect(compiled(artifact), `schema ACCEPTED invalid ${name}`).toBe(false);
      expect(validateLevel1(artifact).length, `handwritten accepted invalid ${name}`)
        .toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 8: Run everything and commit**

Run: `npm test && npm run check:sandbox`

```bash
git add packages/extractor/src/v5 packages/extractor/test/v5 package.json package-lock.json
git commit -m "feat(v5): JSON Schema, Level 1 validation, and a parity test between them"
```

---

### Task 8: Level 2 referential integrity

§18 Level 2 and §10. References resolve, the alias graph is acyclic, types
agree, every token has a record for every declared mode, ids are unique, and
paths do not collide **within a collection**.

**Files:**
- Modify: `packages/extractor/src/v5/validate.ts`, `packages/extractor/test/v5/validate.test.ts`

**Interfaces:** produces `validateLevel2(artifact: FoundationArtifactV5): Diagnostic[]`.

- [ ] **Step 1: Write the failing test**

```ts
describe('validateLevel2', () => {
  it('reports an alias whose target does not exist', () => {
    expect(validateLevel2(artifactWithAlias('VariableID:missing')).map((d) => d.code))
      .toContain('UNRESOLVED_ALIAS');
  });

  it('reports a cycle once, at the lowest id in the ring', () => {
    // Entering from whichever node the walk reached first would make the output
    // depend on token order, which §16 forbids.
    const found = validateLevel2(artifactWithCycle('V:b', 'V:a'));
    const cycles = found.filter((d) => d.code === 'ALIAS_CYCLE');
    expect(cycles).toHaveLength(1);
    expect(cycles[0].entity_id).toBe('V:a');
    expect(cycles[0].details?.chain).toEqual([
      { token_id: 'V:a', mode_id: 'm1' },
      { token_id: 'V:b', mode_id: 'm1' },
      { token_id: 'V:a', mode_id: 'm1' },
    ]);
  });

  it('reports an alias pointing at a token of another type', () => {
    expect(validateLevel2(artifactWithTypeMismatch('color', 'dimension')).map((d) => d.code))
      .toContain('ALIAS_TYPE_MISMATCH');
  });

  it('reports a token with no record for a declared mode', () => {
    const missing = validateLevel2(artifactMissingMode('1:2/dark'))
      .find((d) => d.code === 'MISSING_MODE_VALUE')!;
    expect(missing.mode_id).toBe('1:2/dark');
  });

  it('does not report a token that declares its mode value missing', () => {
    // §7: an ABSENT mode value must be distinguishable from an explicit one. A
    // token that omits the key is the absent case; one carrying
    // `{kind: missing}` has stated itself.
    expect(validateLevel2(artifactWithExplicitMissing('1:2/dark'))
      .some((d) => d.code === 'MISSING_MODE_VALUE')).toBe(false);
  });

  it('reports two entities sharing one stable id', () => {
    expect(validateLevel2(artifactWithDuplicateId()).map((d) => d.code))
      .toContain('DUPLICATE_SOURCE_ID');
  });

  it('reports colliding paths WITHIN one collection', () => {
    expect(validateLevel2(artifactWithPathCollision('C:1', 'C:1')).map((d) => d.code))
      .toContain('PATH_COLLISION');
  });

  it('does NOT report the same path in two different collections', () => {
    // Two collections holding `surface/primary` is the normal, intended shape
    // of a themed system -- a collection IS the namespace. Flagging it would
    // fire on nearly every real file and train a reader to ignore the code.
    expect(validateLevel2(artifactWithPathCollision('C:1', 'C:2'))
      .some((d) => d.code === 'PATH_COLLISION')).toBe(false);
  });

  it('reports a collision that appears only after NFC normalization', () => {
    expect(validateLevel2(artifactWithDecomposedDuplicate()).map((d) => d.code))
      .toContain('PATH_COLLISION');
  });

  it('resolves a 5,000-link chain without recursing or going quadratic', () => {
    // §21.3 forbids quadratic resolution, and a recursive DFS at this depth
    // exceeds the JS call stack regardless of complexity. Traversal must be
    // iterative with an explicit stack AND memoized.
    const found = validateLevel2(artifactWithChainOfLength(5000));
    expect(found.some((d) => d.code === 'ALIAS_CYCLE')).toBe(false);
    expect(found.some((d) => d.code === 'UNRESOLVED_ALIAS')).toBe(false);
  });
});
```

Write the `artifactWith*` helpers in `fixtures.ts`, each cloning `OK_ARTIFACT`.
Do not hand-write ten full artifacts.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/v5/validate.test.ts -t 'validateLevel2'`
Expected: FAIL — `validateLevel2` is not exported.

- [ ] **Step 3: Write the implementation**

Design points, each pinned above:

- **Iterative traversal with an explicit stack**, plus memoization keyed on `(token_id, mode_id)`. Recursion fails at depth long before complexity does; memoization is what keeps it linear.
- **Report a cycle once, at the lowest id in the ring** by code-unit order, and rotate the reported chain to start there — so the output does not depend on which node the walk entered.
- **Distinguish absent from declared-missing:** an omitted mode key is `MISSING_MODE_VALUE`; a `{kind: 'missing'}` record is not.
- **Path collision is scoped to a collection.** Compare `(collection_id, NFC(path))`. Cross-collection duplicates are the normal shape of a themed system.
- **NFC-normalize before comparing** any name or path (§6).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/v5/validate.ts packages/extractor/test/v5
git commit -m "feat(v5): Level 2 referential integrity, iterative and memoized"
```

---

### Task 9: The v4 to v5 normalizer

§19. **This is where v4's losses become visible, and each one must become a
dedicated diagnostic rather than a guess.** v4 carries no stable ids (its rule
was that internal ids stay inside — `brief.ts:120`), no scopes, no publication
state, no lifecycle, and its aliases are bare names.

**Files:**
- Create: `packages/extractor/src/v5/normalize.ts`, `packages/extractor/test/v5/normalize.test.ts`

**Interfaces:** produces `normalizeV4(v4, meta)`, `syntheticId(kind, collection, path)`, `parseV4Path(raw)`.

- [ ] **Step 1: Write the failing test**

```ts
describe('normalizeV4', () => {
  it('collapses all four v4 value shapes into one canonical shape', () => {
    // §21.1.6.
    const { artifact } = normalizeV4(V4_WITH_ALL_FOUR_SHAPES, META);
    for (const token of artifact.tokens) {
      for (const value of Object.values(token.values)) {
        expect(typeof value).toBe('object');
        expect(['literal', 'alias', 'missing']).toContain(value.kind);
      }
    }
  });

  it('mints injective ids that survive a separator inside a name', () => {
    // `figma-name:Color/color/bg/brand` is ambiguous: a token literally named
    // `bg/brand` in group `color` and one named `brand` in group `color/bg`
    // produce the same string. Percent-encoding each segment separates them.
    const a = syntheticId('token', 'Color', ['color', 'bg/brand']);
    const b = syntheticId('token', 'Color', ['color', 'bg', 'brand']);
    expect(a).not.toBe(b);
    expect(a).toBe('figma-name:token:Color/color/bg%2Fbrand');
    // The kind is in the id, so a token and a style with one path never collide.
    expect(syntheticId('style', 'Color', ['color', 'bg', 'brand'])).not.toBe(b);
  });

  it('marks synthetic identity with its own code', () => {
    const { diagnostics } = normalizeV4(V4_MINIMAL, META);
    const d = diagnostics.find((x) => x.code === 'SYNTHETIC_IDENTITY')!;
    expect(d.message).toContain('rename');
  });

  it('keeps a number and reports that its unit metadata is unavailable', () => {
    // The NUMBER is real data and must survive. The unit is not in a v4 export,
    // so the value takes the weaker `number` type and a dedicated code says
    // re-extraction is needed -- not UNSUPPORTED_VALUE_TYPE, which means a value
    // that cannot be represented at all.
    const { artifact, diagnostics } = normalizeV4(V4_WITH_FLOAT, META);
    expect(Object.values(artifact.tokens[0].values)[0])
      .toEqual({ kind: 'literal', value: { type: 'number', value: 16 } });
    expect(diagnostics.map((d) => d.code)).toContain('UNIT_METADATA_UNAVAILABLE');
    expect(diagnostics.map((d) => d.code)).not.toContain('UNSUPPORTED_VALUE_TYPE');
  });

  it('emits missing plus INVALID_SOURCE_COLOR for a malformed colour', () => {
    const { artifact, diagnostics } = normalizeV4(V4_WITH_BAD_HEX, META);
    expect(Object.values(artifact.tokens[0].values)[0])
      .toEqual({ kind: 'missing', reason: 'invalid_source_value' });
    expect(diagnostics.map((d) => d.code)).toContain('INVALID_SOURCE_COLOR');
  });

  it('resolves a bare v4 alias by collection and path when both are available', () => {
    const { artifact } = normalizeV4(V4_WITH_QUALIFIED_ALIAS, META);
    const value = Object.values(artifact.tokens[0].values)[0];
    expect(value.kind).toBe('alias');
  });

  it('accepts a name-only alias match ONLY when it is unique', () => {
    const { artifact } = normalizeV4(V4_WITH_UNIQUE_NAME_ALIAS, META);
    expect(Object.values(artifact.tokens[0].values)[0].kind).toBe('alias');
  });

  it('reports ambiguity instead of taking the first match', () => {
    // Two collections holding `colors/blue/500`, and a bare-name alias. v4
    // cannot say which, so neither can this -- and picking one silently is the
    // failure mode the whole artifact exists to prevent.
    const { artifact, diagnostics } = normalizeV4(V4_WITH_AMBIGUOUS_ALIAS, META);
    const value = Object.values(artifact.tokens[0].values)[0];
    expect(value.kind).toBe('alias');
    if (value.kind === 'alias') expect(value.resolved.status).toBe('unresolved');
    expect(diagnostics.map((d) => d.code)).toContain('AMBIGUOUS_ALIAS_TARGET');
  });

  it('carries an unavailable v4 read into completeness and a diagnostic', () => {
    // v4's FoundationSpec already tracks these (`unavailable?: FoundationRead[]`,
    // foundation.ts:137), so the fact is available and must not be dropped.
    const { artifact, diagnostics } = normalizeV4(V4_WITH_UNAVAILABLE_READ, META);
    expect(artifact.completeness.collections).toBe('partial');
    expect(artifact.completeness.unavailable_sources).toEqual(['Color base [deprecated]']);
    expect(diagnostics.map((d) => d.code)).toContain('SOURCE_PARTIALLY_UNAVAILABLE');
  });

  it('preserves a non-ASCII name and reports it', () => {
    // §21.1.8 -- the Cyrillic С in the Chip path.
    const { artifact, diagnostics } = normalizeV4(V4_WITH_CYRILLIC, META);
    expect(artifact.tokens[0].name).toBe('Background/Chip/Сhip (Hover)');
    expect(diagnostics.map((d) => d.code)).toContain('CONFUSABLE_NAME');
  });

  it('normalizes to NFC without changing what a name says', () => {
    const { artifact } = normalizeV4(V4_WITH_DECOMPOSED_NAME, META);
    expect(artifact.tokens[0].name).toBe('Café/Surface'.normalize('NFC'));
  });

  it('respects the v4 escape when segmenting a path', () => {
    // v4 escaped a literal slash inside a node name as `\/`. A naive split
    // turns one segment into two.
    expect(parseV4Path('Icon\\/.animation/frame')).toEqual(['Icon/.animation', 'frame']);
  });

  it('produces the same semantic hash for two runs over one input', () => {
    const a = normalizeV4(V4_MINIMAL, { exportId: 'one', generatedAt: '2026-01-01T00:00:00.000Z' });
    const b = normalizeV4(V4_MINIMAL, { exportId: 'two', generatedAt: '2026-12-31T00:00:00.000Z' });
    expect(a.artifact.spec_layer.export.content_hash)
      .toBe(b.artifact.spec_layer.export.content_hash);
  });

  it('emits statistics computed from the finished artifact', () => {
    const { artifact } = normalizeV4(V4_WITH_ALL_FOUR_SHAPES, META);
    const stats = artifact.statistics as { tokens: number; aliases: { total: number } };
    expect(stats.tokens).toBe(artifact.tokens.length);
    expect(stats.aliases.total).toBe(
      artifact.tokens.flatMap((t) => Object.values(t.values))
        .filter((v) => v.kind === 'alias').length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/v5/normalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Decisions to encode, each with the reason in a comment:

- **`syntheticId(kind, collection, path)` is injective.** `figma-name:<kind>:<encoded collection>/<encoded segments joined by />`, every segment through `encodeURIComponent` so a literal `/` becomes `%2F` and a literal `%` becomes `%25`. The `figma-name:` prefix stops a consumer mistaking a migrated id for a stable Figma one; the kind stops a token and a style colliding on one path. Readable, unlike a hash, which matters because a human reads the migrated fixture.
- **Synthetic mode ids** use the same encoding: `<collection-id>/<encoded mode name>`. v4 keys values by mode display name (`brief.ts:122`), so the same ambiguity applies.
- **v4 alias resolution is stated, not improvised.** In order: (1) match on `(collection, path)` when the v4 alias carries a collection — v4 emits one only for external aliases today, which is backlog item A4; (2) otherwise match on path alone, and accept **only** if exactly one token matches; (3) if two or more match, emit `kind: alias` with `resolved.status: 'unresolved'`, `reason: 'ambiguous_target'`, and an `AMBIGUOUS_ALIAS_TARGET` diagnostic naming every candidate in `details`. Never take the first match.
- **A number keeps its value and loses its unit claim:** `type: number` plus `UNIT_METADATA_UNAVAILABLE`. `kind: missing` would discard real data; `dimension`/`px` would fabricate.
- **A malformed colour becomes `{kind: 'missing', reason: 'invalid_source_value'}`** plus `INVALID_SOURCE_COLOR`, per Task 3.
- **`completeness` is read from v4's `unavailable` list** (`foundation.ts:137`), with `unavailable_sources` sorted by code unit.
- **Names are NFC-normalized, never rewritten.** §6 forbids substituting generated code names; `suggested_code_name` may sit beside the source name.
- **Statistics are computed from the finished artifact**, never accumulated during the walk — §15 requires them derivable, and computing them from the output makes that true by construction.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/v5/normalize.ts packages/extractor/test/v5
git commit -m "feat(v5): v4 to v5 normalizer with injective ids and stated alias rules"
```

---

### Task 10: Grade the real fixture

**Blocked on** the user committing a real v4 foundation export. Tasks 0-9 are
not.

**Files:**
- Create: `packages/extractor/test/fixtures/v5/company-ds-foundation-v4.yaml`
- Create: `packages/extractor/test/fixtures/v5/company-ds-foundation-v5.yaml`
- Create: `packages/extractor/test/v5/acceptance.test.ts`
- Create: `packages/extractor/test/v5/phaseCoverage.ts`

- [ ] **Step 1: Confidentiality gate — before anything is committed**

The export is a real design system. Before `git add`:

1. Read the file end to end. Not skim — the fabrication risks in this plan are all about things nobody looked at.
2. Confirm it contains no file keys, tokens, URLs or credentials that should not be in a public repo. v4 emits `source.file_key`; decide explicitly whether that ships or is redacted, and if redacted, redact it in the committed fixture and record that the fixture is modified.
3. Confirm with the user that this repo is the right home for it. If the repo is or may become public, the answer may be no — in which case build the synthetic equivalent instead and say so here.

Do not skip to Step 2 until all three are done.

- [ ] **Step 2: Commit the raw export verbatim**

Paste the output of **Copy foundation for AI** into
`company-ds-foundation-v4.yaml` with no hand edits beyond any redaction agreed
in Step 1. A hand edit is exactly what would hide the defects this fixture
exists to catch.

- [ ] **Step 3: Write the phase-coverage manifest**

`it.skip` reads as a pass in several reporters, so an ungraded criterion could
look satisfied indefinitely. A manifest makes the gap an asserted fact:

```ts
// packages/extractor/test/v5/phaseCoverage.ts
/** §21.1's twelve acceptance criteria and the plan that grades each. */
export const ACCEPTANCE_COVERAGE = {
  1: { criterion: 'six collections with stable ids', gradedBy: 'plan-2' },
  2: { criterion: 'every declared mode has a stable id', gradedBy: 'plan-2' },
  3: { criterion: 'every token and style has a stable source id', gradedBy: 'plan-2' },
  4: { criterion: 'internal aliases resolve with complete chains', gradedBy: 'plan-2' },
  5: { criterion: 'three deprecated external refs are unresolved errors', gradedBy: 'plan-2' },
  6: { criterion: 'every value shape normalizes to one canonical shape', gradedBy: 'plan-1' },
  '7a': { criterion: 'dimensional floats keep their numeric value', gradedBy: 'plan-1' },
  '7b': { criterion: 'dimensional floats receive explicit units', gradedBy: 'plan-2' },
  8: { criterion: 'the Cyrillic С is preserved and flagged', gradedBy: 'plan-1' },
  9: { criterion: 'archived text styles get lifecycle + INFERRED_LIFECYCLE', gradedBy: 'plan-3' },
  10: { criterion: 'identical typography mode values are preserved', gradedBy: 'plan-3' },
  11: { criterion: 'card shadow representations stay independent', gradedBy: 'plan-3' },
  12: { criterion: 'repeated extraction produces one semantic hash', gradedBy: 'plan-1' },
} as const;
```

```ts
// in acceptance.test.ts
  it('states which acceptance criteria this phase does NOT grade', () => {
    const ungraded = Object.entries(ACCEPTANCE_COVERAGE)
      .filter(([, v]) => v.gradedBy !== 'plan-1')
      .map(([k]) => k);
    // Asserted, not skipped: the run output names the gap on every CI run, and
    // this test fails the day someone moves a criterion without grading it.
    expect(ungraded).toEqual(['1', '2', '3', '4', '5', '7b', '9', '10', '11']);
  });

  it.todo('1: all six collections have stable ids — plan 2');
  it.todo('2: every declared mode has a stable id — plan 2');
  it.todo('3: every token and style has a stable source id — plan 2');
  it.todo('4: internal aliases resolve with complete chains — plan 2');
  it.todo('5: three deprecated external refs are unresolved errors — plan 2');
  it.todo('7b: dimensional floats receive explicit units — plan 2');
  it.todo('9: archived text styles get lifecycle + INFERRED_LIFECYCLE — plan 3');
  it.todo('10: identical typography mode values are preserved — plan 3');
  it.todo('11: card shadow representations stay independent — plan 3');
```

- [ ] **Step 4: Grade what Phase 1 can grade**

Write real assertions for criteria **6, 7a, 8 and 12** against the normalized
real export. Then run the whole artifact through `validateLevel1` and
`validateLevel2` and assert the diagnostics list matches a committed snapshot.

- [ ] **Step 5: Snapshot the normalized artifact**

Commit the v5 output as `company-ds-foundation-v5.yaml` and assert byte
equality on every run. Any change to precision, ordering, colour handling or
the value model then shows up as a reviewable diff on one file.

- [ ] **Step 6: Read every diagnostic**

Each one is a claim about a real design system. A wrong diagnostic is worse than
no diagnostic — it teaches a reader to ignore the block. Read the whole list
before committing, and if one is wrong, fix the rule rather than the fixture.

- [ ] **Step 7: Run the full check and commit**

Run: `npm run check:ci`

Do **not** pipe it. A pipe masks the exit code, which is how a broken audit gate
went unnoticed before.

```bash
git add packages/extractor/test/fixtures/v5 packages/extractor/test/v5
git commit -m "test(v5): grade the real foundation export against phase 1 criteria"
```

---

## What plans 2, 3 and 4 will cover

**Plan 2 — identity and references (§22 Phase 2).** Stable ids reach the
artifact, which **reverses a documented rule**: "internal ids stay inside" is
argued at `brief.ts:120`, `:138`, `:455` and on `tree.ts`'s `RefIdentity`. Those
comments change with the behaviour rather than being left contradicting it.
Values become keyed by mode id (`brief.ts:122` today). `scopes` reaches
`FoundationVariable` so units become real. Colour floats survive
`serializeFoundation.ts` so §9.6 has something to preserve. The alias graph is
built across libraries with mode-aware chains. **Bump `EXTRACTOR_VERSION` here** —
this is where extraction output genuinely changes, which is what `version.ts`
says the bump is for.

**Plan 3 — composite styles and lifecycle (§22 Phase 3).** Typography as a
composite with per-property bindings; numeric weight beside `font_style` with a
diagnostic instead of a guess; ordered effect composites with bindings;
`STYLE_BINDING_DRIFT`; publication and lifecycle with `INFERRED_LIFECYCLE`
wherever Figma states nothing. **Audit the Figma API first:** `file_version`,
`modified_at` and `library_file_id` (§13) may not be reachable from the plugin
sandbox at all. Confirm before committing to Level 3 completeness; where a field
is unreachable, say so in the schema rather than emitting null forever.

**Plan 4 — tooling and the component brief.** `validate`, `normalize` and `diff`
as library functions. Semantic diff over stable ids with the §17
classification. Golden fixtures in CI. Then the component brief adopts the v5
envelope and value model, and these component-side backlog items land with it —
none of which the v5 spec covers:

| Item | What it is |
|---|---|
| A1 | State precedence, derived from `STATE_ORDER`, emitted only for the flags encoding |
| A5 | `api.modes` — which modes exist versus which the brief resolved |
| A6 | `states` shaped like `variants`, encoding-aware |
| A2 / B5 | Uncovered variant combinations and declared-but-unbound states, counted over `spec.variantInstances` |
| B6 | States that resolve to identical values |
| B8 | Error severity where a hardcoded value is a themed colour |
| B4 | The prose generator's numeric claims — the "44 by 44 px" exemplar at `prompt.ts:191` |
| C1 | Collapse the five identical loader keyframes, name the one that disagrees |
| C2 | Drop `unbound`; `validate.ts` rule 5 computes it identically |
| C3 | `layout` as structured values, labelled default-variant-only |

Task detail for those ten lives in
`docs/superpowers/plans/2026-08-27-export-hardening.md`, whose foundation tasks
are dead.

---

## Open items for the user

1. **The real export** (Task 10), and the Step 1 confidentiality decision that gates it. Nothing before it is blocked.
2. **`SCHEMA_URI`** is written as `https://spec-layer.dev/schemas/foundation-context/v5.json`. It ships inside every artifact, so it must be a URL you control and intend to serve. Confirm or replace before Task 6.
3. **`extractor.build`** (§5.1) has no source — there is no build-id plumbing in `build:plugin`. Phase 1 emits `null`; wiring a git sha belongs with plan 2.
4. **`target_mode_id` on `AliasReference`** — implemented as `ResolutionStep` instead, for the reason in the revision note. Say the word if you want the field on the reference as well.

## Self-review

- **Spec coverage, Phase 1:** §5.1 → Task 6. §6 identity types → Task 1, minted in Task 9, real in plan 2. §9.1-9.6 → Tasks 1-4. §14.1 → Task 5. §15 → Task 9. §16 → Tasks 2, 5, 6, 8, 9. §18 Levels 1-2 → Tasks 7-8. §19 → Task 9. §21.1 → Task 10, with the nine ungraded criteria asserted rather than skipped. §22 Phase 1 → all of it.
- **Deliberately not covered:** §20 (CLI, deferred by decision), §17 semantic diff (plan 4), §21.3 performance targets (plan 4, though Task 8 pins the iterative-and-memoized requirement that makes them reachable), §11-13 composite styles and lifecycle (plan 3 — types defined in Task 1, arrays empty until then).
- **Task order has no forward dependencies:** 0 → 1 (types) → 2 (precision) → 3 (colour, needs 2) → 4 (units, needs 2) → 5 (diagnostics) → 6 (envelope, needs 1 and 5) → 7 (schema/L1, needs 1, 5, 6) → 8 (L2, needs 7) → 9 (normalizer, needs 1-8) → 10 (fixture, needs 9).
- **Type consistency:** `canonicalNumber` is used by Tasks 3, 4, 6, 9 under that one name. `Diagnostic`/`diagnostic`/`compareCodeUnits` from Task 5 are used by 7, 8, 9. `SemanticPayload` from Task 6 is what Task 9 builds. `CanonicalValue` and `ResolutionStep` from Task 1 are the only value types any task emits. `ColorResult` from Task 3 is consumed only by Task 9. `OK_ARTIFACT`, `VALID_CASES`, `INVALID_CASES` and the `artifactWith*` helpers all live in `test/v5/fixtures.ts` and are shared by Tasks 7, 8, 9.
