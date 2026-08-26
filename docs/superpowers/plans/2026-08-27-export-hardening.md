# Export Hardening Implementation Plan

> **SUPERSEDED, 2026-08-27, PARTIALLY.** The Foundation Context v5 spec replaced
> every FOUNDATION task in this document. See
> [2026-08-27-foundation-v5-phase-1.md](2026-08-27-foundation-v5-phase-1.md).
>
> **Dead — do not implement:** Tasks 1, 2, 3, 4, 13, 15, 16 (identifier
> validation, units, rounding, aliases, source, ordering, summary). All of them
> are rewritten by v5, and doing them against v4 first is throwaway work.
>
> **Still live:** every COMPONENT-brief task — 5 (severity), 6 (collapsed
> states), 7 (state precedence), 8 (coverage findings), 9 (mode coverage),
> 11 (prose numeric claims), plus the Release 2 items. The v5 spec is
> foundation-only and does not touch any of them. They land in v5 plan 4, and
> this document holds their task detail until then.
>
> Task 10 (numeric font weight) splits: the weight mapping moves to v5 plan 3
> (§11); the component brief's use of it stays here.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Copy for AI YAML brief unambiguous to a code-generating agent, by closing resolution holes, reporting design problems instead of hiding them, and cutting repetition — without ever fabricating a fact the Figma file did not state.

**Architecture:** Everything lands in `packages/extractor/src`. The brief is a *projection* (see the `brief.ts` file header), so almost every change belongs in `brief.ts` (shape) or `validate.ts` (findings) and is computed from data already on `IntermediateSpec`/`FoundationSpec`. Only Task 2 changes extraction, and it does so in a field that no canvas frame renders. Work is split into two releases: **Release 1 is purely additive** and stays on `BRIEF_VERSION = 4`; **Release 2 changes or removes existing fields** and bumps to `BRIEF_VERSION = 5` in a single step, so a consumer breaks at most once.

**Tech Stack:** TypeScript (no build step in the extractor package — plain `tsc --noEmit` typecheck), vitest, js-yaml (tests only; the emitter is our own `yaml.ts`), Figma Plugin API (`packages/plugin`).

---

## Source of this plan

This plan implements the *Export Hardening Backlog* artifact
(https://claude.ai/code/artifact/4c08208d-2657-4739-b377-d28dfb7ee6dc), after
reviewing each of its 26 items against the extractor source. Fourteen items are
implemented as written. Eleven needed correction — the backlog was measured
against exported YAML, not against the code that emits it, so several items
misattribute a cause or propose a fix the emitter already refutes. One is
dropped.

**Read this table before starting any task. It is the difference between the
backlog and this plan.**

| Item | Backlog says | What the code says | Plan |
|---|---|---|---|
| **B7** contrast checks | Add a WCAG block; the data is already there | Removed *deliberately* in v3 — `brief.ts:37`: the failure list "grew with the file and dominated a payload whose whole job is to hand an agent a token vocabulary". Contrast lives on the foundation frame via `includeContrast` | **DROPPED** by decision. Do not implement. Do not re-open. |
| **A2** never omit a binding | Emit `value: none` for the 16 uncovered combinations | The exporter cannot know that Outline's rest fill is *transparent* rather than *unspecified*. Emitting `none` fabricates a fact — the exact failure the backlog's own principle forbids | Reframed as Task 8: **report the uncovered combinations as a finding**, computed against `spec.variantInstances` (the variants that really exist), not a synthesized cartesian product |
| **A1** state precedence | Add `state_precedence: [disabled, loading, pressed, focused, hover]` | `statesMatrix.ts:44` already holds `STATE_ORDER`, a 22-name **lifecycle** order running the opposite direction, and `api.states` is already sorted by it. Two opposite orderings of one vocabulary under similar names is a new ambiguity | Task 7: emit `state_precedence` **derived from `STATE_ORDER`**, name the direction in the key, cover the whole vocabulary, and only for `encoding: 'flags'` — an enum state axis is mutually exclusive by construction and needs no precedence |
| **A6** states shape | Give `states` the `variants` shape (a map of booleans with defaults) | `apiOf` (`brief.ts:625`) builds `states` from `detectStateMatrix`, which has **two encodings**. Under `enum`, states are one axis's values — a boolean map would be actively wrong | Task 17: shape depends on `encoding`, which becomes an emitted field |
| **B3** numeric weight | New idea | Already a documented known gap at `brief.ts:655` | Task 10, and cite that comment |
| **B4** prose cross-check | "The guideline generator is not reading the token data it ships" | It is never *given* it: `prompt.ts:269` sends token **names** only, no resolved values. And "at least 44 by 44 px" is copied verbatim from the few-shot exemplar at `prompt.ts:191` | Task 11 fixes the cause (de-number the exemplar, send resolved geometry) *and* adds the guard |
| **C2** drop `unbound` | Justified by "verified as an exact set match" on one file | Stronger than that: `validate.ts` rule 5 performs the *identical* computation over the *identical* source with the *identical* reconciliation. Redundancy is structural, not coincidental | Task 18, with the structural argument in the commit message |
| **C3** restructure `layout` | Two sources of truth; `layout` is wrong for Small buttons | Confirmed and worse: `extractLayout` reads `defaultVariant(root)` only, so it is wrong for *every* non-default variant. `LayoutSummary.values` already carries structured radius/gap — the brief just doesn't emit them (`brief.ts:851`) | Task 19: emit the structured values that already exist, and label the block default-variant-only |
| **C4** round floats | Round at the source | The component brief already rounds (`typographyOf`, `roundN(…, 2)`); the foundation's `text_styles` does not (`brief.ts:257`) | Task 3: one projection, two lines |
| **D2** `source` on foundation | "The foundation export has no `source` block at all" | It has one (`brief.ts:221`) — but it carries **only `file_key`**, and vanishes entirely when the key is unavailable | Task 13: add `file_name`; state unavailability rather than omitting |
| **D5** volatile metadata | Add a `content_hash` | `specContentHash`/`foundationContentHash` already exist and are correct (`hash.ts`) — they are simply never emitted into the brief | Task 12: emit the existing hash |
| **D6** version properly | `extractor: "1"` is a string next to `version: 4`, a number — make them the same kind | `version.ts:20` is explicit that `EXTRACTOR_VERSION` is "an opaque identifier compared for equality… does not need to look like semver". The string is correct; the *undocumented* asymmetry is the defect | Task 22: keep the string, add `$schema`, and let the schema state why the two differ |

Two items are also **already resolved** per the backlog's own closing section
and must not be reopened: the `color/chart/*` family, and the Button label text
styles.

---

## Global Constraints

- **`BRIEF_VERSION` stays 4 for every Release 1 task.** Release 1 adds keys and adds findings. It never renames, reshapes, or removes an emitted field. Bump to 5 exactly once, in Task 16, as the first task of Release 2.
- **Never add a field to `IntermediateSpec`.** `specContentHash` (`hash.ts:29`) spreads `...rest` over the whole spec, so a new top-level field flips the drift hash of every committed on-canvas doc to "update available" for a change nobody can see. Derive new brief fields inside `brief.ts` from data already extracted. Task 2 is the one exception and adds to `FoundationVariable`, which `unitContent()` does not render and `foundationContentHash` therefore does not hash.
- **Never fabricate a value.** If the file does not state something, report the absence as a finding or omit the key. `value: none`, a guessed unit, or an inferred weight are all worse than a reported gap. This is the whole thesis of the export.
- **Absent vs empty is already decided.** `brief.ts:225` and the v4 note: an optional block is *absent*, never `{}` or `[]`. Where a consumer needs to distinguish "not covered" from "nothing here", follow `scopeOf`'s precedent (`brief.ts:196`) and emit an explicit `'included'`/`'excluded'` marker. Do not introduce a third convention.
- **Conditional spreads, not `undefined` values.** Every optional key in `brief.ts` is added with `...(cond ? { k: v } : {})`, because tests inspect the raw object with `'k' in obj` before the YAML round trip. Match that or the tests lie.
- **No NUL bytes.** `ruleKey` (`brief.ts:398`) carries a comment about this: a NUL separator is invisible in a diff and evades every check in the repo. `npm run check:nul` guards `packages/` but not `docs/`. Use a space.
- **Verification command for every task:** `npm test` (vitest). Before any commit that touches the plugin: `npm run check`.
- **The golden fixture moves with the shape.** `packages/extractor/test/briefGolden.test.ts` asserts against `packages/extractor/test/fixtures/button-brief.yaml`. Any task that changes emitted shape updates that fixture in the same commit, and the diff on that fixture is the task's real review surface.

---

## File Structure

**Modified:**
- `packages/extractor/src/brief.ts` — the projection. Most tasks touch it. It is 868 lines and already at the edge of comfortable; Task 1 extracts the new foundation-validation logic into its own file rather than growing it further.
- `packages/extractor/src/validate.ts` — component findings. Tasks 6, 8, 9, 10 add rules; Task 5 changes one severity.
- `packages/extractor/src/foundation.ts` — `FoundationVariable` gains `scopes` (Task 2); ordering (Task 15).
- `packages/extractor/src/prose/prompt.ts` — the exemplar and the payload (Task 11).
- `packages/extractor/src/prose/foundationPrompt.ts` — group-description instructions (Task 20).
- `packages/extractor/src/naming.ts` — path escaping (Task 14).
- `packages/plugin/src/serializeFoundation.ts` + `packages/plugin/src/main.ts` — read `scopes` from Figma (Task 2).

**Created:**
- `packages/extractor/src/foundationValidate.ts` — findings about a *foundation* (identifier collisions, malformed identifiers, style/weight disagreement). The component equivalent is `validate.ts`; this is its foundation sibling, kept separate because it takes a `FoundationSpec` and knows nothing about components.
- `packages/extractor/test/foundationValidate.test.ts`
- `packages/extractor/src/schema/spec-layer-4.json` — the published JSON Schema (Task 22).

---

# RELEASE 1 — additive (`BRIEF_VERSION` stays 4)

Every task below adds keys or findings. A consumer written against today's v4
brief keeps working after all of Release 1.

---

### Task 1: Foundation validation — identifier collisions and malformed identifiers

Backlog **B1** and **B2**. `tokenOf` (`brief.ts:126`) passes Figma's
`codeSyntax` through unchecked, so two tokens can claim one CSS custom property
and last-write-wins silently rewrites a semantic colour.

**Files:**
- Create: `packages/extractor/src/foundationValidate.ts`
- Create: `packages/extractor/test/foundationValidate.test.ts`
- Modify: `packages/extractor/src/brief.ts` (call it from `foundationBrief`)
- Modify: `packages/extractor/src/index.ts` (export the new symbols)

**Interfaces:**
- Produces: `export interface FoundationFinding { id: FoundationFindingId; severity: 'warning' | 'error'; identifier?: string; tokens?: string[]; token?: string; message: string }`
- Produces: `export type FoundationFindingId = 'duplicate-identifier' | 'malformed-identifier' | 'style-weight-mismatch'`
- Produces: `export function validateFoundation(spec: FoundationSpec): FoundationFinding[]`
- Consumed by: Task 10 (adds `style-weight-mismatch` to the same union and the same emitted block).

- [ ] **Step 1: Write the failing test**

```ts
// packages/extractor/test/foundationValidate.test.ts
import { describe, it, expect } from 'vitest';
import { validateFoundation } from '../src/foundationValidate';
import type { FoundationSpec } from '../src/foundation';

const AT = '2026-08-27T10:00:00.000Z';

function foundationWith(
  variables: FoundationSpec['collections'][number]['variables'],
): FoundationSpec {
  return {
    fileKey: 'abc123',
    extractedAt: AT,
    textStyles: [],
    effectStyles: [],
    collections: [{
      id: 'C1', name: 'Mapped Colors',
      modes: [{ modeId: 'm1', name: 'Light' }],
      defaultModeId: 'm1',
      variables,
    }],
  };
}

describe('validateFoundation', () => {
  it('reports one finding per identifier claimed by more than one token', () => {
    const spec = foundationWith([
      {
        name: 'surface/semantic/success/light', group: 'surface', resolvedType: 'COLOR',
        description: '', codeSyntax: { WEB: '--color-surface-semantic-success-light' },
        valuesByMode: { m1: { kind: 'color', hex: '#12B76A', alpha: 1 } },
      },
      {
        name: 'surface/semantic/warning/dark', group: 'surface', resolvedType: 'COLOR',
        description: '', codeSyntax: { WEB: '--color-surface-semantic-success-light' },
        valuesByMode: { m1: { kind: 'color', hex: '#F79009', alpha: 1 } },
      },
    ]);

    const findings = validateFoundation(spec);

    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('duplicate-identifier');
    expect(findings[0].severity).toBe('error');
    expect(findings[0].identifier).toBe('--color-surface-semantic-success-light');
    // Sorted, so the message is stable across runs regardless of read order.
    expect(findings[0].tokens).toEqual([
      'surface/semantic/success/light',
      'surface/semantic/warning/dark',
    ]);
  });

  it('does not report an identifier claimed by exactly one token', () => {
    const spec = foundationWith([{
      name: 'surface/primary/default', group: 'surface', resolvedType: 'COLOR',
      description: '', codeSyntax: { WEB: '--color-surface-primary-default' },
      valuesByMode: { m1: { kind: 'color', hex: '#722ED1', alpha: 1 } },
    }]);

    expect(validateFoundation(spec)).toEqual([]);
  });

  it('reports an identifier that is not a valid CSS custom property name', () => {
    const spec = foundationWith([{
      name: 'colors/blue/200', group: 'colors', resolvedType: 'COLOR',
      description: '', codeSyntax: { WEB: '--colors/blue/200' },
      valuesByMode: { m1: { kind: 'color', hex: '#B8CFF5', alpha: 1 } },
    }]);

    const findings = validateFoundation(spec);

    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('malformed-identifier');
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].token).toBe('colors/blue/200');
    expect(findings[0].message).toContain('--colors-blue-200');
  });

  it('collides on the same platform only', () => {
    // WEB and ANDROID are separate namespaces; sharing a string across them is
    // not a collision, and reporting it would train a reader to ignore the block.
    const spec = foundationWith([
      {
        name: 'a', group: 'g', resolvedType: 'COLOR', description: '',
        codeSyntax: { WEB: '--x' },
        valuesByMode: { m1: { kind: 'color', hex: '#000000', alpha: 1 } },
      },
      {
        name: 'b', group: 'g', resolvedType: 'COLOR', description: '',
        codeSyntax: { ANDROID: '--x' },
        valuesByMode: { m1: { kind: 'color', hex: '#111111', alpha: 1 } },
      },
    ]);

    expect(validateFoundation(spec)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/foundationValidate.test.ts`
Expected: FAIL — `Failed to resolve import "../src/foundationValidate"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/extractor/src/foundationValidate.ts
/**
 * Deterministic findings about one FOUNDATION.
 *
 * The sibling of validate.ts, which does the same job for one component. Split
 * rather than merged because this one takes a FoundationSpec and knows nothing
 * about components, and because brief.ts is already long enough that growing it
 * further is the wrong default.
 *
 * Same two rules as validate.ts: everything here is COMPUTED, never inferred,
 * and there is no `info` severity — a finding nobody should act on should not
 * be emitted at all.
 */
import type { FoundationSpec, FoundationVariable } from './foundation';

export type FoundationFindingId =
  | 'duplicate-identifier'
  | 'malformed-identifier';

export interface FoundationFinding {
  id: FoundationFindingId;
  severity: 'warning' | 'error';
  /** The offending identifier, on both identifier rules. */
  identifier?: string;
  /** Every token claiming it, on `duplicate-identifier`. Sorted. */
  tokens?: string[];
  /** The single owning token, on `malformed-identifier`. */
  token?: string;
  message: string;
}

/** A CSS custom property name: `--` followed by ASCII letters, digits and
 *  hyphens. Deliberately stricter than the CSS grammar (which permits escapes
 *  and a much wider ident set): anything outside this set has always been a
 *  Figma codeSyntax typo in practice, and a permissive check would pass the
 *  literal slashes this rule exists to catch. */
const VALID_IDENTIFIER = /^--[a-zA-Z0-9-]+$/;

/** The name-derived fallback a consumer should use instead of a malformed
 *  identifier. Never emitted AS the identifier — the brief reports the problem
 *  and lets the consumer decide, rather than silently substituting. */
export function derivedIdentifier(name: string): string {
  return `--${name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}`;
}

function allVariables(spec: FoundationSpec): FoundationVariable[] {
  return spec.collections.flatMap((c) => c.variables);
}

export function validateFoundation(spec: FoundationSpec): FoundationFinding[] {
  const findings: FoundationFinding[] = [];
  const variables = allVariables(spec);

  // 1. One identifier claimed by more than one token, per platform.
  //
  // Keyed on (platform, identifier), not on the identifier alone: WEB and
  // ANDROID are separate namespaces, and reporting a cross-platform match as a
  // collision would train a reader to ignore this block.
  const byIdentifier = new Map<string, { platform: string; identifier: string; tokens: string[] }>();
  for (const v of variables) {
    for (const [platform, identifier] of Object.entries(v.codeSyntax)) {
      const key = JSON.stringify([platform, identifier]);
      const entry = byIdentifier.get(key) ?? { platform, identifier, tokens: [] };
      entry.tokens.push(v.name);
      byIdentifier.set(key, entry);
    }
  }
  for (const { platform, identifier, tokens } of byIdentifier.values()) {
    if (tokens.length < 2) continue;
    const sorted = [...tokens].sort();
    findings.push({
      id: 'duplicate-identifier', severity: 'error',
      identifier, tokens: sorted,
      message: `${sorted.length} tokens claim the ${platform} identifier `
        + `${identifier} (${sorted.join(', ')}). Generating from this export `
        + 'lets the last one silently win.',
    });
  }

  // 2. An identifier that is not a usable CSS custom property name.
  for (const v of variables) {
    const identifier = v.codeSyntax.WEB;
    if (identifier === undefined || VALID_IDENTIFIER.test(identifier)) continue;
    findings.push({
      id: 'malformed-identifier', severity: 'warning',
      identifier, token: v.name,
      message: `${identifier} is not a usable CSS custom property name. `
        + `Derived from the token name it would be ${derivedIdentifier(v.name)}.`,
    });
  }

  return findings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/foundationValidate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Emit the block from `foundationBrief`**

In `brief.ts`, import `validateFoundation`, and inside `foundationBrief` build
and spread the block. Place it directly after `scope` and before `collections`,
so a reader meets the caveats before the data:

```ts
  const validation = validateFoundation(foundation).map((f) => ({
    id: f.id,
    severity: f.severity,
    ...(f.identifier !== undefined ? { identifier: f.identifier } : {}),
    ...(f.token !== undefined ? { token: f.token } : {}),
    ...(f.tokens !== undefined ? { tokens: f.tokens } : {}),
    message: f.message,
  }));
```

```ts
    ...(scope !== undefined ? { scope } : {}),
    // Projected into fresh literal objects for the same reason componentBrief
    // projects its own findings: a declared interface will not satisfy
    // YamlValue's index-signature branch. Absent when clean, matching every
    // other optional block here.
    ...(validation.length > 0 ? { validation } : {}),
```

Add to `packages/extractor/src/index.ts`:

```ts
export { validateFoundation, derivedIdentifier } from './foundationValidate';
export type { FoundationFinding, FoundationFindingId } from './foundationValidate';
```

- [ ] **Step 6: Add the brief-level test**

```ts
// append to packages/extractor/test/brief.test.ts
  it('reports a duplicate CSS identifier in the foundation brief', () => {
    const spec: FoundationSpec = {
      ...FOUNDATION,
      collections: [{
        ...FOUNDATION.collections[0],
        variables: FOUNDATION.collections[0].variables.map((v) => ({
          ...v, codeSyntax: { WEB: '--clash' },
        })),
      }],
    };
    const brief = foundationBrief(spec, { generatedAt: AT }) as Record<string, unknown>;
    const validation = brief.validation as { id: string }[];
    expect(validation.some((f) => f.id === 'duplicate-identifier')).toBe(true);
  });

  it('has no validation key when the foundation is clean', () => {
    const brief = foundationBrief(FOUNDATION, { generatedAt: AT }) as Record<string, unknown>;
    expect('validation' in brief).toBe(false);
  });
```

- [ ] **Step 7: Run the full suite and commit**

Run: `npm test`
Expected: PASS. If `briefGolden.test.ts` fails, the fixture's foundation is not clean — read the diff before regenerating, because a finding on the fixture is a real finding.

```bash
git add packages/extractor/src/foundationValidate.ts packages/extractor/test/foundationValidate.test.ts packages/extractor/src/brief.ts packages/extractor/src/index.ts packages/extractor/test/brief.test.ts
git commit -m "feat(brief): report duplicate and malformed CSS identifiers"
```

---

### Task 2: Unit metadata on numeric tokens

Backlog **A3**. `type: float` cannot distinguish 16px from a unitless 600, and
our own generator emitted `font-weight: 600px`. **The unit must come from
Figma's own `scopes`, never from the token name** — inferring a unit from a name
is the class of guess this whole export exists to eliminate.

**Files:**
- Modify: `packages/plugin/src/serializeFoundation.ts` (read `scopes`)
- Modify: `packages/plugin/src/main.ts` (the real Figma reader)
- Modify: `packages/extractor/src/foundation.ts` (`FoundationVariable.scopes`)
- Modify: `packages/extractor/src/brief.ts` (`tokenOf` emits `unit`)
- Modify: `packages/extractor/test/brief.test.ts`, `packages/extractor/test/foundation.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export type TokenUnit = 'px' | 'unitless' | 'percent' | 'ms' | 'unknown'`, `export function unitOf(v: FoundationVariable): TokenUnit` in `foundation.ts`.

**Why this is hash-safe:** `foundationContentHash` hashes `unitContent()`'s
result (`hash.ts:112`), and `scopes` is not part of `FoundationUnitContent`
because no frame renders it. Do **not** add it there.

- [ ] **Step 1: Write the failing test**

```ts
// packages/extractor/test/foundation.test.ts
import { unitOf } from '../src/foundation';
import type { FoundationVariable } from '../src/foundation';

const numeric = (scopes: string[]): FoundationVariable => ({
  name: 'x', group: 'g', resolvedType: 'FLOAT', description: '',
  codeSyntax: {}, valuesByMode: { m1: { kind: 'number', value: 16 } },
  scopes: scopes as FoundationVariable['scopes'],
});

describe('unitOf', () => {
  it('reads a pixel dimension from a Figma dimension scope', () => {
    expect(unitOf(numeric(['WIDTH_HEIGHT']))).toBe('px');
    expect(unitOf(numeric(['CORNER_RADIUS']))).toBe('px');
    expect(unitOf(numeric(['GAP']))).toBe('px');
    expect(unitOf(numeric(['FONT_SIZE']))).toBe('px');
  });

  it('reads a unitless number from FONT_WEIGHT', () => {
    expect(unitOf(numeric(['FONT_WEIGHT']))).toBe('unitless');
  });

  it('reads a percentage from OPACITY', () => {
    expect(unitOf(numeric(['OPACITY']))).toBe('percent');
  });

  it('reports unknown rather than guessing when scopes say nothing', () => {
    // ALL_SCOPES is Figma's default and means the designer never narrowed it.
    // A name-derived guess here is exactly the fabrication this export forbids.
    expect(unitOf(numeric(['ALL_SCOPES']))).toBe('unknown');
    expect(unitOf(numeric([]))).toBe('unknown');
  });

  it('reports unknown when scopes disagree', () => {
    expect(unitOf(numeric(['FONT_WEIGHT', 'CORNER_RADIUS']))).toBe('unknown');
  });

  it('has no unit for a non-numeric variable', () => {
    const color: FoundationVariable = {
      name: 'c', group: 'g', resolvedType: 'COLOR', description: '',
      codeSyntax: {}, valuesByMode: { m1: { kind: 'color', hex: '#000000', alpha: 1 } },
      scopes: ['ALL_SCOPES'],
    };
    expect(unitOf(color)).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/foundation.test.ts`
Expected: FAIL — `unitOf` is not exported, and `scopes` is not a property of `FoundationVariable`.

- [ ] **Step 3: Write minimal implementation**

In `foundation.ts`, add the scope type and the field:

```ts
/** Figma's own VariableScope values, narrowed to the ones that carry a unit.
 *  Anything Figma adds later lands in the string branch and reads as unknown,
 *  which is the truthful answer for a scope we do not understand. */
export type FoundationScopeName =
  | 'ALL_SCOPES' | 'TEXT_CONTENT' | 'CORNER_RADIUS' | 'WIDTH_HEIGHT' | 'GAP'
  | 'STROKE_FLOAT' | 'OPACITY' | 'EFFECT_FLOAT' | 'FONT_WEIGHT' | 'FONT_SIZE'
  | 'LINE_HEIGHT' | 'LETTER_SPACING' | 'PARAGRAPH_SPACING' | 'PARAGRAPH_INDENT'
  | (string & {});

export type TokenUnit = 'px' | 'unitless' | 'percent' | 'ms' | 'unknown';
```

Add to `FoundationVariable`:

```ts
export interface FoundationVariable {
  name: string;
  group: string;
  resolvedType: FoundationVariableType;
  description: string;
  codeSyntax: Record<string, string>;
  valuesByMode: Record<string, FoundationValue>;
  /**
   * Figma's own scopes for this variable. The ONLY sound source of unit
   * information: `resolvedType: 'FLOAT'` cannot separate a 16px dimension from
   * a unitless 600, and deriving a unit from the token's NAME is the guess this
   * export exists to eliminate — a generator that guessed wrong emitted
   * `font-weight: 600px` and no parser rejected it.
   *
   * Optional because every foundation serialized before this field existed
   * lacks it, and a missing scope list must read as "not stated" rather than as
   * "narrowed to nothing". Excluded from FoundationUnitContent, so
   * foundationContentHash does not move for any committed doc.
   */
  scopes?: FoundationScopeName[];
}
```

And the resolver:

```ts
/** Figma scopes that pin a unit. LINE_HEIGHT is absent on purpose: Figma's own
 *  line height carries its own unit (PIXELS/PERCENT/AUTO) per style, so a
 *  variable scoped to it has no single answer. */
const UNIT_BY_SCOPE: Record<string, TokenUnit> = {
  CORNER_RADIUS: 'px', WIDTH_HEIGHT: 'px', GAP: 'px', FONT_SIZE: 'px',
  STROKE_FLOAT: 'px', PARAGRAPH_SPACING: 'px', PARAGRAPH_INDENT: 'px',
  LETTER_SPACING: 'px',
  FONT_WEIGHT: 'unitless',
  OPACITY: 'percent',
};

/**
 * The unit a numeric token carries, read from Figma's scopes and nowhere else.
 *
 * `unknown` is a real answer and the common one: ALL_SCOPES is Figma's default,
 * so an unnarrowed variable genuinely does not state its unit. Reporting that
 * is useful — a consumer knows to ask — while guessing from the name is not.
 * Two scopes that imply different units also resolve to `unknown`, for the same
 * reason: the file states two things and this function's job is to report what
 * the file states.
 */
export function unitOf(v: FoundationVariable): TokenUnit {
  if (v.resolvedType !== 'FLOAT') return 'unknown';
  const units = new Set(
    (v.scopes ?? []).map((s) => UNIT_BY_SCOPE[s]).filter((u): u is TokenUnit => u !== undefined),
  );
  return units.size === 1 ? [...units][0] : 'unknown';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/foundation.test.ts`
Expected: PASS.

- [ ] **Step 5: Read `scopes` in the plugin**

In `packages/plugin/src/serializeFoundation.ts`, add to `ReaderVariable`:

```ts
  /** Figma's `Variable.scopes`. Optional so an older injected reader (and every
   *  test fake written before this field) still satisfies the interface. */
  scopes?: string[];
```

and carry it through the mapping at line ~141:

```ts
        id: rv.id, name: rv.name, resolvedType: rv.resolvedType,
        description: rv.description, codeSyntax: rv.codeSyntax,
        ...(rv.scopes !== undefined ? { scopes: rv.scopes } : {}),
```

In `packages/plugin/src/main.ts`, find the real reader's `variable(id)`
implementation and add `scopes: v.scopes` to the object it returns from the
Figma `Variable`.

- [ ] **Step 6: Emit `unit` from `tokenOf`**

In `brief.ts`, import `unitOf`, and inside `tokenOf` add the key between `type`
and `description`:

```ts
  const unit = unitOf(variable);
  return {
    name: variable.name,
    type: variable.resolvedType.toLowerCase(),
    // Emitted for numeric tokens ONLY, and `unknown` is emitted rather than
    // omitted: for a float, "this file does not state a unit" is information a
    // generator must act on, while for a colour the question is meaningless.
    ...(variable.resolvedType === 'FLOAT' ? { unit } : {}),
    description: variable.description || undefined,
    code: code as YamlValue,
    values,
  };
```

- [ ] **Step 7: Add the brief test, run the suite, commit**

```ts
// packages/extractor/test/brief.test.ts
  it('emits a unit on float tokens and none on colours', () => {
    const spec: FoundationSpec = {
      ...FOUNDATION,
      collections: [{
        ...FOUNDATION.collections[0],
        variables: [
          {
            name: 'spacing/400', group: 'spacing', resolvedType: 'FLOAT',
            description: '', codeSyntax: {}, scopes: ['GAP'],
            valuesByMode: { m1: { kind: 'number', value: 16 } },
          },
          ...FOUNDATION.collections[0].variables,
        ],
      }],
    };
    const tokens = parseBrief(foundationBrief(spec, { generatedAt: AT }))
      .collections[0].tokens;
    expect(tokens[0].unit).toBe('px');
    expect('unit' in tokens[1]).toBe(false);
  });
```

Run: `npm run check`
Expected: PASS. Update `button-brief.yaml` if the golden fixture's foundation carries floats.

```bash
git add packages/extractor/src/foundation.ts packages/extractor/src/brief.ts packages/plugin/src/serializeFoundation.ts packages/plugin/src/main.ts packages/extractor/test
git commit -m "feat(brief): emit unit metadata on numeric tokens from Figma scopes"
```

---

### Task 3: Round foundation text-style metrics

Backlog **C4**. `typographyOf` already rounds to 2 decimals (`brief.ts:695`);
the foundation's `text_styles` projection (`brief.ts:257`) emits the raw double,
so the same style reads `139.9999976158142` in one document and `140` in the
other.

**Files:**
- Modify: `packages/extractor/src/brief.ts:250-260`
- Modify: `packages/extractor/test/brief.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it('rounds foundation text-style metrics the way the component brief does', () => {
    const spec: FoundationSpec = {
      ...FOUNDATION,
      textStyles: [{
        name: 'Body/M', group: 'Body', description: '',
        fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 14.000000476837158,
        lineHeight: { unit: 'PIXELS', value: 139.9999976158142 },
        letterSpacing: { unit: 'PERCENT', value: 0.30000001192092896 },
        paragraphSpacing: 0, paragraphIndent: 0,
        textCase: 'ORIGINAL', textDecoration: 'NONE',
      }],
    };
    const styles = parseBrief(foundationBrief(spec, { generatedAt: AT })).text_styles;
    const font = styles[0].font as { size: number };
    const lh = styles[0].line_height as { value: number };
    const ls = styles[0].letter_spacing as { value: number };
    expect(font.size).toBe(14);
    expect(lh.value).toBe(140);
    expect(ls.value).toBe(0.3);
  });
```

(Match the real `FoundationTextStyle` shape when writing this — read
`foundation.ts:126` and `RawTextStyle` first, and drop any field that does not
exist rather than inventing one.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/brief.test.ts -t 'rounds foundation text-style'`
Expected: FAIL — `expected 139.9999976158142 to be 140`.

- [ ] **Step 3: Write minimal implementation**

`roundN` is already imported at `brief.ts:12`. In the `text_styles` projection:

```ts
      ? { text_styles: foundation.textStyles.map((t) => ({
          name: t.name,
          // Rounded to 2, matching typographyOf. Figma stores these as doubles
          // derived from percentage input, so an unrounded 140 arrives as
          // 139.9999976158142 -- and the component brief, which does round,
          // then disagrees with this one about the same style.
          font: { family: t.fontFamily, style: t.fontStyle, size: roundN(t.fontSize, 2) },
          line_height: {
            unit: t.lineHeight.unit,
            // Conditional for the same reason typographyOf's is: an AUTO line
            // height has no numeric value, and a fabricated 0 would misstate
            // "the renderer decides" as a measured number.
            ...(t.lineHeight.value !== undefined
              ? { value: roundN(t.lineHeight.value, 2) } : {}),
          },
          letter_spacing: {
            unit: t.letterSpacing.unit, value: roundN(t.letterSpacing.value, 2),
          },
        })) }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/brief.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/brief.ts packages/extractor/test/brief.test.ts
git commit -m "fix(brief): round foundation text-style metrics like the component brief"
```

---

### Task 4: Qualify every alias with its collection

Backlog **A4**. `valueOf` (`brief.ts:96`) emits `collection` on external aliases
only, so resolution depends on the *absence* of a field, and a name living in
two collections cannot be resolved at all.

**Files:**
- Modify: `packages/extractor/src/brief.ts` (`valueOf`, `lookupToken`)
- Modify: `packages/extractor/test/brief.test.ts`

**Note for the implementer:** the existing comment at `brief.ts:99-104` argues
*against* this ("a local alias already resolves, so naming its collection adds a
line without adding information"). That argument holds only while no two
collections share a token name. Replace the comment; do not leave both.

- [ ] **Step 1: Write the failing test**

```ts
  it('names the target collection on internal aliases too', () => {
    const spec: FoundationSpec = {
      ...FOUNDATION,
      collections: [{
        ...FOUNDATION.collections[0],
        variables: [{
          name: 'surface/primary', group: 'surface', resolvedType: 'COLOR',
          description: '', codeSyntax: {},
          valuesByMode: {
            m1: {
              kind: 'alias', targetName: 'colors/blue/500',
              targetCollection: 'Foundation',
              resolved: { kind: 'color', hex: '#722ED1', alpha: 1 },
            },
            m2: {
              kind: 'alias', targetName: 'colors/blue/300',
              targetCollection: 'Foundation',
              resolved: { kind: 'color', hex: '#9B6FDF', alpha: 1 },
            },
          },
        }],
      }],
    };
    const token = parseBrief(foundationBrief(spec, { generatedAt: AT }))
      .collections[0].tokens[0];
    const light = (token.values as Record<string, { collection?: string }>).Light;
    expect(light.collection).toBe('Foundation');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/brief.test.ts -t 'names the target collection'`
Expected: FAIL — `expected undefined to be 'Foundation'`.

- [ ] **Step 3: Write minimal implementation**

In `valueOf`'s alias branch, drop the `v.external &&` guard:

```ts
    case 'alias':
      return {
        alias: v.targetName,
        ...(v.resolved ? { resolved: valueOf(v.resolved) } : {}),
        ...(v.external ? { external: true } : {}),
        // On EVERY alias, not just external ones. Qualifying only external
        // aliases made resolution depend on the ABSENCE of a field, and left a
        // name that exists in two collections unresolvable in principle. The
        // earlier argument -- that a local alias already resolves, so its
        // collection adds a line without adding information -- holds only while
        // no two collections share a token name, which is not a property this
        // export can check for a consumer. Still omitted when the name is '',
        // because a blank name is not a name.
        ...(v.targetCollection ? { collection: v.targetCollection } : {}),
      };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. Existing tests that assert `collection` is absent on an internal alias will fail — **read each one before changing it**; they encode the old decision and should be rewritten to assert the new one, not deleted.

- [ ] **Step 5: Confirm `targetCollection` is populated for internal aliases**

Run: `grep -n "targetCollection" packages/extractor/src/foundation.ts packages/plugin/src/serializeFoundation.ts`

If the serializer only resolves a collection name for remote refs, extend it to
name the local collection too — an internal alias's collection is
`variableCollectionId` on the target variable, already available. If this turns
out to require a Figma read the serializer does not currently do, stop and
report it rather than emitting a guessed name.

- [ ] **Step 6: Commit**

```bash
git add packages/extractor/src/brief.ts packages/extractor/src/foundation.ts packages/plugin/src/serializeFoundation.ts packages/extractor/test
git commit -m "feat(brief): qualify every alias with its target collection"
```

---

### Task 5: Raise severity where the consequence is visual

Backlog **B8**. `validate.ts:260` emits every `unbound-value` at
`severity: 'warning'`, so a hardcoded `#ffffff` on a themed label ranks with a
hardcoded gap.

**Files:**
- Modify: `packages/extractor/src/validate.ts:250-266`
- Modify: `packages/extractor/test/validate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/extractor/test/validate.test.ts — follow the fixture helpers already in this file
  it('reports a hardcoded colour as an error and a hardcoded gap as a warning', () => {
    const spec = specWith({
      gaps: [
        { part: 'Label', path: 'Container/Label', property: 'fill', issue: 'hardcoded', value: '#ffffff' },
        { part: 'Container', path: 'Container', property: 'gap', issue: 'hardcoded', value: '8' },
      ],
      tokens: [],
    });

    const findings = validate(spec, new Map());
    const fill = findings.find((f) => f.property === 'fill')!;
    const gap = findings.find((f) => f.property === 'gap')!;

    expect(fill.severity).toBe('error');
    expect(gap.severity).toBe('warning');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/validate.test.ts -t 'hardcoded colour'`
Expected: FAIL — `expected 'warning' to be 'error'`.

- [ ] **Step 3: Write minimal implementation**

```ts
/** Properties whose hardcoded value is visible on every themed surface.
 *  A hardcoded colour survives every mode switch and every variant, so on an
 *  Outline or Ghost variant a hardcoded white fill is a white box inside the
 *  button. A hardcoded gap is wrong, but it is wrong by 4px in one direction. */
const THEMED_PROPERTIES = new Set(['fill', 'border', 'border-color', 'stroke', 'color']);
```

In rule 5:

```ts
    findings.push({
      id: 'unbound-value',
      severity: THEMED_PROPERTIES.has(g.property) ? 'error' : 'warning',
      path: g.path, property: g.property,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. The golden fixture's `validation` severities move — regenerate and read the diff.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/validate.ts packages/extractor/test/validate.test.ts packages/extractor/test/fixtures/button-brief.yaml
git commit -m "feat(validate): report a hardcoded themed colour as an error"
```

---

### Task 6: Report collapsed states

Backlog **B6**. When two states resolve to identical values a consumer
faithfully generates an invisible state, and an accessibility bug ships with the
design system's blessing. `componentBrief` already builds a `resolved` map
(`brief.ts:796`) — but only for numbers.

**Files:**
- Modify: `packages/extractor/src/validate.ts`
- Modify: `packages/extractor/src/brief.ts` (widen the `resolved` map)
- Modify: `packages/extractor/test/validate.test.ts`

**Interfaces:**
- Consumes: `validate(spec, resolved)` — the second parameter widens from `Map<string, number>` to `Map<string, string | number>`. Update `geometryOf`'s call site to skip non-numeric entries.
- Produces: adds `'collapsed-state'` to `FindingId`.

- [ ] **Step 1: Write the failing test**

```ts
  it('reports two states of one property that resolve to the same value', () => {
    const spec = specWith({
      variants: [{ prop: 'State', values: ['Default', 'Focus'] }],
      tokens: [
        rule({ path: 'Container', property: 'fill', name: 'surface/primary/default', conditions: { State: ['Default'] } }),
        rule({ path: 'Container', property: 'fill', name: 'surface/primary/focus', conditions: { State: ['Focus'] } }),
      ],
    });
    const resolved = new Map<string, string | number>([
      ['surface/primary/default', '#722ED1'],
      ['surface/primary/focus', '#722ED1'],
    ]);

    const findings = validate(spec, resolved);
    const collapsed = findings.find((f) => f.id === 'collapsed-state')!;

    expect(collapsed.severity).toBe('warning');
    expect(collapsed.path).toBe('Container');
    expect(collapsed.property).toBe('fill');
    expect(collapsed.message).toContain('#722ED1');
  });

  it('does not report two states that resolve differently', () => {
    const spec = specWith({
      variants: [{ prop: 'State', values: ['Default', 'Focus'] }],
      tokens: [
        rule({ path: 'Container', property: 'fill', name: 'a', conditions: { State: ['Default'] } }),
        rule({ path: 'Container', property: 'fill', name: 'b', conditions: { State: ['Focus'] } }),
      ],
    });
    const resolved = new Map<string, string | number>([['a', '#111111'], ['b', '#222222']]);
    expect(validate(spec, resolved).some((f) => f.id === 'collapsed-state')).toBe(false);
  });

  it('does not report two states bound to the SAME token', () => {
    // One token deliberately covering two states is a design decision, not a
    // collapse. Only two DIFFERENT tokens landing on one value is the defect.
    const spec = specWith({
      variants: [{ prop: 'State', values: ['Default', 'Focus'] }],
      tokens: [
        rule({ path: 'Container', property: 'fill', name: 'a', conditions: { State: ['Default'] } }),
        rule({ path: 'Container', property: 'fill', name: 'a', conditions: { State: ['Focus'] } }),
      ],
    });
    const resolved = new Map<string, string | number>([['a', '#111111']]);
    expect(validate(spec, resolved).some((f) => f.id === 'collapsed-state')).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/validate.test.ts -t 'collapsed'`
Expected: FAIL — no finding with `id: 'collapsed-state'`.

- [ ] **Step 3: Write minimal implementation**

Add to the `FindingId` union in `validate.ts`, then:

```ts
  // 6. Two DIFFERENT tokens on one path/property that resolve to one value.
  //
  // A consumer generates both states faithfully and one of them is invisible --
  // a focus state pixel-identical to rest is an accessibility bug shipping with
  // the design system's blessing. Two states bound to the SAME token are not
  // reported: that is a stated decision, not an accident.
  //
  // Only rules that CONDITION on a state axis are compared. An unconditioned
  // rule applies everywhere and has no sibling to collapse against.
  const byProperty = new Map<string, { path: string; property: string; byValue: Map<string, Set<string>> }>();
  for (const t of spec.tokens) {
    if (!conditionsNameAStateAxis(t.conditions, spec.variants)) continue;
    const value = resolved.get(t.name);
    if (value === undefined) continue;
    const key = JSON.stringify([t.path, t.property]);
    const entry = byProperty.get(key)
      ?? { path: t.path, property: t.property, byValue: new Map<string, Set<string>>() };
    const names = entry.byValue.get(String(value)) ?? new Set<string>();
    names.add(t.name);
    entry.byValue.set(String(value), names);
    byProperty.set(key, entry);
  }
  for (const { path, property, byValue } of byProperty.values()) {
    for (const [value, names] of byValue) {
      if (names.size < 2) continue;
      const sorted = [...names].sort();
      findings.push({
        id: 'collapsed-state', severity: 'warning',
        path, property,
        message: `${sorted.join(' and ')} both resolve to ${value}, so these `
          + `states are indistinguishable in ${property}.`,
      });
    }
  }
```

Note: `conditionsNameAStateAxis` already exists at `validate.ts:88` — read its
signature and pass its real arguments rather than the sketch above.

- [ ] **Step 4: Widen the `resolved` map in `componentBrief`**

At `brief.ts:796`, keep the existing numeric branch and add a string branch, so
colour hexes reach the finding:

```ts
  const resolved = new Map<string, string | number>();
  for (const t of spec.tokens) {
    const looked = lookupToken(opts.foundation, t);
    const v = looked.resolved;
    if (typeof v === 'number' || typeof v === 'string') {
      resolved.set(t.name, v);
    } else if (v && typeof v === 'object') {
      // A colour resolves to `{ hex, alpha }` when alpha < 1 and to a bare hex
      // string otherwise (valueOf), and an alias-of-alias leaves one nested
      // `resolved` key. Flatten both so the collapsed-state comparison sees a
      // comparable scalar rather than skipping every semi-transparent colour.
      const o = v as { resolved?: unknown; hex?: unknown; alpha?: unknown };
      if (typeof o.resolved === 'number' || typeof o.resolved === 'string') {
        resolved.set(t.name, o.resolved);
      } else if (typeof o.hex === 'string') {
        resolved.set(t.name, `${o.hex}@${String(o.alpha)}`);
      }
    }
  }
```

Then update `geometryOf`'s comparison in `validate.ts` to ignore non-numeric
values (`typeof value !== 'number'` → skip), so the widened map cannot make the
geometry rule compare a hex against a radius.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/extractor/src/validate.ts packages/extractor/src/brief.ts packages/extractor/test
git commit -m "feat(validate): report states that resolve to identical values"
```

---

### Task 7: Declare state precedence

Backlog **A1**, corrected. `api.states` is already ordered — by `STATE_ORDER`
(`statesMatrix.ts:44`), a **lifecycle** order that runs the opposite direction
from precedence. Emitting a second, contrary order under a similar name would
add an ambiguity rather than remove one, so precedence is **derived from
`STATE_ORDER`** and its direction is named in the key.

**Files:**
- Modify: `packages/extractor/src/statesMatrix.ts` (export the order)
- Modify: `packages/extractor/src/brief.ts` (`apiOf`)
- Modify: `packages/extractor/test/statesMatrix.test.ts`, `packages/extractor/test/brief.test.ts`

**Interfaces:**
- Produces: `export function statePrecedence(states: string[]): string[]` in `statesMatrix.ts` — the given state names, most-specific-first.

- [ ] **Step 1: Write the failing test**

```ts
// packages/extractor/test/statesMatrix.test.ts
import { statePrecedence } from '../src/statesMatrix';

describe('statePrecedence', () => {
  it('orders the states it is given from most to least specific', () => {
    expect(statePrecedence(['hover', 'disabled', 'pressed', 'focused', 'loading']))
      .toEqual(['disabled', 'loading', 'pressed', 'focused', 'hover']);
  });

  it('covers every state given, not a fixed five', () => {
    // The vocabulary is 22 names. A component using `selected` must get an
    // answer, or the field re-introduces the hole it exists to close.
    expect(statePrecedence(['hover', 'selected'])).toEqual(['selected', 'hover']);
  });

  it('sorts an unrecognized state last but keeps it', () => {
    expect(statePrecedence(['hover', 'sparkly'])).toEqual(['hover', 'sparkly']);
  });

  it('is the exact reverse of the lifecycle order the states list uses', () => {
    const lifecycle = ['hover', 'focused', 'pressed', 'disabled'];
    expect(statePrecedence(lifecycle)).toEqual([...lifecycle].reverse());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/statesMatrix.test.ts -t 'statePrecedence'`
Expected: FAIL — `statePrecedence` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * The given states, most-specific-first: the order a consumer must apply when
 * two `when` clauses both match.
 *
 * DERIVED from STATE_ORDER by reversal, never hand-listed. STATE_ORDER is a
 * LIFECYCLE order (default -> hover -> ... -> disabled) and is what `api.states`
 * is already sorted by; precedence runs the other way, because the states a
 * designer reaches for last are the ones that win. Hand-listing a second order
 * would put two contrary orderings of one vocabulary in one document under
 * similar names -- a new ambiguity, not a closed one.
 *
 * Every given state comes back, including one outside the vocabulary. An
 * unrecognized state sorts LAST (lowest precedence) and keeps its relative
 * order, matching orderStates: this function must never silently drop a state,
 * or a consumer's lookup falls through to no rule at all.
 */
export function statePrecedence(states: string[]): string[] {
  return states
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const ra = stateRank(a.v);
      const rb = stateRank(b.v);
      // Unranked names (rank === STATE_ORDER.length) stay last under reversal,
      // rather than being flipped to the front by a naive `rb - ra`.
      const unrankedA = ra === STATE_ORDER.length;
      const unrankedB = rb === STATE_ORDER.length;
      if (unrankedA !== unrankedB) return unrankedA ? 1 : -1;
      if (unrankedA && unrankedB) return a.i - b.i;
      return rb - ra || a.i - b.i;
    })
    .map((x) => x.v);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/statesMatrix.test.ts`
Expected: PASS.

- [ ] **Step 5: Emit it, for the flags encoding only**

In `apiOf` (`brief.ts:590`), after `states` is built:

```ts
  if (states.length > 0) {
    result.states = states;
    // Precedence ONLY under the flags encoding. Under `enum` the states are
    // values of a single axis and are mutually exclusive by construction, so
    // no two `when` clauses can both match and a precedence list would imply a
    // conflict that cannot occur.
    //
    // The key names its direction. `api.states` is already ordered, by the
    // opposite (lifecycle) rule, and two ordered lists of one vocabulary with
    // nothing saying which is which is the ambiguity this field exists to
    // close.
    if (matrix?.encoding === 'flags') {
      result.state_precedence_high_to_low = statePrecedence(states);
    }
  }
```

- [ ] **Step 6: Add the brief test, run the suite, commit**

```ts
  it('emits precedence for a flags-encoded component and not an enum-encoded one', () => {
    const flags = componentBrief(specWithFlagStates(), OPTS) as { api: Record<string, unknown> };
    expect(flags.api.state_precedence_high_to_low).toEqual(['disabled', 'pressed', 'hover']);

    const enumEncoded = componentBrief(specWithEnumStates(), OPTS) as { api: Record<string, unknown> };
    expect('state_precedence_high_to_low' in enumEncoded.api).toBe(false);
  });
```

(Build the two specs from the helpers already in `brief.test.ts`; do not invent
new fixture shapes.)

Run: `npm test`

```bash
git add packages/extractor/src/statesMatrix.ts packages/extractor/src/brief.ts packages/extractor/test packages/extractor/test/fixtures/button-brief.yaml
git commit -m "feat(brief): declare state precedence, derived from the lifecycle order"
```

---

### Task 8: Report uncovered state combinations and declared-but-unbound states

Backlog **B5** and **A2**, merged and reframed. A2 asked for a synthesized
`value: none`; the exporter cannot know whether Outline's rest fill is
transparent or simply unspecified, so it reports the gap instead. Coverage is
computed against `spec.variantInstances` — the variants that **actually exist**
in the file — never a synthesized cartesian product.

**Files:**
- Modify: `packages/extractor/src/validate.ts`
- Modify: `packages/extractor/test/validate.test.ts`

**Interfaces:**
- Produces: adds `'unbound-state'` and `'uncovered-combination'` to `FindingId`.
- Consumes: `ruleMatchesConfig` from `./pivot` (already imported at `validate.ts:14`) — the same matcher the pivot uses, so a finding and a rendered frame can never disagree about whether a rule matches a variant.

- [ ] **Step 1: Write the failing test**

```ts
  it('reports a declared state that constrains no binding', () => {
    const spec = specWith({
      variants: [
        { prop: 'hover', values: ['False', 'True'] },
        { prop: 'loading', values: ['False', 'True'] },
      ],
      tokens: [
        rule({ path: 'Container', property: 'fill', name: 'a', conditions: { hover: ['True'] } }),
      ],
    });

    const finding = validate(spec, new Map()).find((f) => f.id === 'unbound-state')!;

    expect(finding.severity).toBe('warning');
    expect(finding.message).toContain('loading');
  });

  it('reports a property left uncovered on some real variants', () => {
    const spec = specWith({
      variants: [{ prop: 'type', values: ['Primary', 'Ghost'] }],
      variantInstances: [
        { nodeId: '1', name: 'type=Primary', values: { type: 'Primary' } },
        { nodeId: '2', name: 'type=Ghost', values: { type: 'Ghost' } },
      ],
      tokens: [
        rule({ path: 'Container', property: 'fill', name: 'a', conditions: { type: ['Primary'] } }),
      ],
    });

    const finding = validate(spec, new Map()).find((f) => f.id === 'uncovered-combination')!;

    expect(finding.path).toBe('Container');
    expect(finding.property).toBe('fill');
    expect(finding.message).toContain('1 of 2');
    // Names the gap without asserting what the value should be. The file does
    // not say, so neither does the brief.
    expect(finding.message).not.toContain('transparent');
  });

  it('does not report a property bound unconditionally', () => {
    const spec = specWith({
      variants: [{ prop: 'type', values: ['Primary', 'Ghost'] }],
      variantInstances: [
        { nodeId: '1', name: 'type=Primary', values: { type: 'Primary' } },
        { nodeId: '2', name: 'type=Ghost', values: { type: 'Ghost' } },
      ],
      tokens: [rule({ path: 'Container', property: 'fill', name: 'a', conditions: {} })],
    });
    expect(validate(spec, new Map()).some((f) => f.id === 'uncovered-combination')).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/validate.test.ts -t 'uncovered'`
Expected: FAIL — neither finding id exists.

- [ ] **Step 3: Write minimal implementation**

```ts
  // 7. A state declared in the API that constrains no binding at all.
  //
  // Either dead, or an unfinished design, and a consumer cannot tell which. The
  // brief says which state, and says nothing about what it should look like.
  const stateProps = stateAxisProps(spec.variants);
  const constrained = new Set(spec.tokens.flatMap((t) => Object.keys(t.conditions)));
  for (const prop of stateProps) {
    if (constrained.has(prop)) continue;
    findings.push({
      id: 'unbound-state', severity: 'warning',
      message: `${prop} is declared as a state but constrains no binding, so `
        + `the component's appearance while ${prop} is undefined.`,
    });
  }

  // 8. A property bound on SOME real variants and not others.
  //
  // Counted over spec.variantInstances -- the variants the file actually
  // contains -- and never over a synthesized cartesian product of the axes: a
  // combination Figma has no variant for is not a gap, and counting it would
  // inflate every finding on every component with boolean state flags.
  //
  // Reports the hole. Does NOT emit a value for it: whether an unbound fill
  // means transparent or means unspecified is exactly what the file fails to
  // say, and answering it here would fabricate the fact this finding exists to
  // surface.
  const total = spec.variantInstances.length;
  if (total > 0) {
    const byTargetCoverage = new Map<string, { path: string; property: string; covered: Set<string> }>();
    for (const t of spec.tokens) {
      const key = JSON.stringify([t.path, t.property]);
      const entry = byTargetCoverage.get(key)
        ?? { path: t.path, property: t.property, covered: new Set<string>() };
      for (const inst of spec.variantInstances) {
        if (ruleMatchesConfig(t.conditions, inst.values)) entry.covered.add(inst.nodeId);
      }
      byTargetCoverage.set(key, entry);
    }
    for (const { path, property, covered } of byTargetCoverage.values()) {
      if (covered.size === total) continue;
      findings.push({
        id: 'uncovered-combination', severity: 'warning',
        path, property,
        message: `${property} is bound on ${covered.size} of ${total} variants. `
          + 'The remaining variants state no value, so a consumer has no rule '
          + 'for them and this export does not invent one.',
      });
    }
  }
```

Read `ruleMatchesConfig`'s real signature in `pivot.ts` before writing this —
pass its arguments in the order it declares, and if it takes a `TokenRule`
rather than a conditions map, pass the rule.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. The golden fixture gains findings — read every new line before regenerating. Each one is a real statement about the sample Button.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/validate.ts packages/extractor/test packages/extractor/test/fixtures/button-brief.yaml
git commit -m "feat(validate): report unbound states and uncovered variant coverage"
```

---

### Task 9: State mode coverage explicitly

Backlog **A5**. `lookupToken` (`brief.ts:459`) resolves at the owning
collection's **default mode** and emits `mode:` per binding, but nothing states
which modes exist and which the export covers — so a consumer either ships a
light-only component or cross-references two documents to find out.

**Files:**
- Modify: `packages/extractor/src/brief.ts` (`componentBrief`)
- Modify: `packages/extractor/test/brief.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it('states which modes exist and which the component brief covers', () => {
    const brief = componentBrief(SPEC, { ...OPTS, foundation: FOUNDATION }) as {
      api: { modes?: Record<string, { available: string[]; exported: string[] }> };
    };
    expect(brief.api.modes).toEqual({
      Color: { available: ['Light', 'Dark'], exported: ['Light'] },
    });
  });

  it('omits modes when there is no foundation to state them from', () => {
    const brief = componentBrief(SPEC, { ...OPTS, foundation: undefined }) as {
      api: Record<string, unknown>;
    };
    expect('modes' in brief.api).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/brief.test.ts -t 'which modes exist'`
Expected: FAIL — `expected undefined to equal { Color: … }`.

- [ ] **Step 3: Write minimal implementation**

Add to `brief.ts`, above `componentBrief`:

```ts
/**
 * Which modes each bound collection has, and which this brief resolved under.
 *
 * `lookupToken` resolves at the owning collection's DEFAULT mode -- a real
 * decision, made per collection rather than against a fixed mode -- and states
 * it per binding. What was missing is the denominator: nothing said a Dark mode
 * existed and went unexported, so a consumer silently shipped a light-only
 * component.
 *
 * Keyed by collection, and covering only the collections this component
 * actually binds into: a file's other collections are the foundation brief's
 * business, and listing them here would make a component brief grow with a file
 * it does not describe.
 *
 * `exported` is a LIST, not a single name, so the day a brief resolves more than
 * one mode this field needs no shape change.
 */
function modesOf(
  spec: IntermediateSpec,
  foundation: FoundationSpec | undefined,
): YamlValue | undefined {
  if (!foundation) return undefined;
  const bound = new Set(spec.tokens.filter((t) => t.kind === 'variable').map((t) => t.name));
  const out: Record<string, YamlValue> = {};
  for (const c of foundation.collections) {
    if (!c.variables.some((v) => bound.has(v.name))) continue;
    const defaultName = c.modes.find((m) => m.modeId === c.defaultModeId)?.name;
    out[c.name] = {
      available: c.modes.map((m) => m.name),
      // Omitted rather than guessed when the default mode id is stale, the same
      // staleness tokenOf and lookupToken already handle by dropping the name.
      ...(defaultName !== undefined ? { exported: [defaultName] } : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
```

Call it inside `apiOf`… **no** — `apiOf` takes only `spec`. Call it in
`componentBrief` and merge into the api block there:

```ts
  const api = apiOf(spec);
  const modes = modesOf(spec, opts.foundation);
  const apiBlock = api !== undefined || modes !== undefined
    ? { ...(api as Record<string, YamlValue> | undefined), ...(modes !== undefined ? { modes } : {}) }
    : undefined;
```

and use `apiBlock` in the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/brief.ts packages/extractor/test packages/extractor/test/fixtures/button-brief.yaml
git commit -m "feat(brief): state available and exported modes on the component api"
```

---

### Task 10: Numeric font weight, and a style/weight disagreement finding

Backlog **B3**. Already a documented known gap at `brief.ts:655`: `font_style`
is a Figma style name, not a numeric weight, so a consumer maps it itself. And a
style named "Medium" whose `font_style` is `Regular` makes a model emit the
wrong weight with full confidence.

**Files:**
- Modify: `packages/extractor/src/brief.ts` (`typographyOf`, `text_styles`)
- Modify: `packages/extractor/src/foundationValidate.ts` (the mismatch finding)
- Modify: `packages/extractor/test/brief.test.ts`, `packages/extractor/test/foundationValidate.test.ts`

**Interfaces:**
- Consumes: `FoundationFindingId` from Task 1; adds `'style-weight-mismatch'`.
- Produces: `export function weightOf(fontStyle: string): number | undefined` in `foundationValidate.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/extractor/test/foundationValidate.test.ts
import { weightOf, validateFoundation } from '../src/foundationValidate';

describe('weightOf', () => {
  it('maps the CSS-named weights', () => {
    expect(weightOf('Thin')).toBe(100);
    expect(weightOf('Regular')).toBe(400);
    expect(weightOf('Medium')).toBe(500);
    expect(weightOf('SemiBold')).toBe(600);
    expect(weightOf('Semi Bold')).toBe(600);
    expect(weightOf('Bold')).toBe(700);
    expect(weightOf('Black')).toBe(900);
  });

  it('ignores an italic qualifier', () => {
    expect(weightOf('Bold Italic')).toBe(700);
  });

  it('returns undefined for a name it does not know', () => {
    // Better a missing field than a fabricated 400.
    expect(weightOf('Condensed Display')).toBeUndefined();
  });
});

describe('style-weight-mismatch', () => {
  it('reports a style whose NAME claims a weight its font_style contradicts', () => {
    const spec = { /* FoundationSpec with one text style */ } as FoundationSpec;
    // name: 'Body/M Medium', fontStyle: 'Regular'
    const finding = validateFoundation(spec).find((f) => f.id === 'style-weight-mismatch')!;
    expect(finding.severity).toBe('warning');
    expect(finding.message).toContain('Medium');
    expect(finding.message).toContain('Regular');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/foundationValidate.test.ts`
Expected: FAIL — `weightOf` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
/** Figma font style names mapped to CSS numeric weights. Keys are compared
 *  case-insensitively with spaces and hyphens removed, so "Semi Bold",
 *  "SemiBold" and "semi-bold" are one entry. */
const WEIGHT_BY_STYLE: Record<string, number> = {
  thin: 100, hairline: 100,
  extralight: 200, ultralight: 200,
  light: 300,
  regular: 400, normal: 400, book: 400,
  medium: 500,
  semibold: 600, demibold: 600,
  bold: 700,
  extrabold: 800, ultrabold: 800,
  black: 900, heavy: 900,
};

/** Strip an italic qualifier and normalize separators. `Bold Italic` is weight
 *  700 with a slant, not an unknown weight. */
function normalizeStyle(fontStyle: string): string {
  return fontStyle.toLowerCase()
    .replace(/italic|oblique/g, '')
    .replace(/[\s_-]+/g, '')
    .trim();
}

/**
 * The numeric CSS weight a Figma style name states, or undefined.
 *
 * Undefined is emitted as an ABSENT field rather than as a default 400: a
 * fabricated weight is exactly the confident-and-wrong output this export
 * exists to prevent, and a consumer that sees no weight knows to look at
 * `font_style` itself.
 */
export function weightOf(fontStyle: string): number | undefined {
  return WEIGHT_BY_STYLE[normalizeStyle(fontStyle)];
}
```

Add the finding to `validateFoundation`:

```ts
  // 3. A text style whose NAME claims one weight and whose font_style states
  //    another. The name is the more semantic signal, so a model trusts it over
  //    the payload and emits the wrong weight with full confidence.
  for (const style of spec.textStyles) {
    const claimed = Object.keys(WEIGHT_BY_STYLE)
      .find((w) => normalizeStyle(style.name).includes(w));
    const actual = normalizeStyle(style.fontStyle);
    if (claimed === undefined || actual === '' || claimed === actual) continue;
    if (weightOf(claimed) === weightOf(style.fontStyle)) continue;
    findings.push({
      id: 'style-weight-mismatch', severity: 'warning',
      token: style.name,
      message: `${style.name} is named for a ${claimed} weight but its font `
        + `style is ${style.fontStyle}. The name is the more semantic signal, `
        + 'so a generator will trust it over the payload.',
    });
  }
```

- [ ] **Step 4: Emit `font_weight` in both briefs**

In `typographyOf` (`brief.ts:692`), replace the "Known gap" comment (the gap is
being closed) and add the field:

```ts
      font_style: style.fontStyle,
      // Resolved numerically so no consumer has to map Figma's style names
      // itself. Absent, never defaulted, when the name is one weightOf does not
      // know: a fabricated 400 is worse than a missing field.
      ...(weightOf(style.fontStyle) !== undefined
        ? { font_weight: weightOf(style.fontStyle) } : {}),
```

And the same inside the foundation `text_styles` projection's `font` object.

- [ ] **Step 5: Run the suite and commit**

Run: `npm test`

```bash
git add packages/extractor/src/foundationValidate.ts packages/extractor/src/brief.ts packages/extractor/test packages/extractor/test/fixtures/button-brief.yaml
git commit -m "feat(brief): emit numeric font weights and report style/name disagreement"
```

---

### Task 11: Stop the prose generator making numeric claims it cannot check

Backlog **B4**, with the real cause. `guidelines.interactions` claims "Keep the
button at least 44 by 44 px" while `button/lg-height` resolves to 36. Two
findings from reading `prose/prompt.ts`:

1. That exact sentence is in the **few-shot exemplar** at `prompt.ts:191`. The
   model is copying house style, not reasoning about this component.
2. `buildProsePrompt` sends token **names** only (`prompt.ts:269`) and layout as
   a **prose sentence** (`prompt.ts:285`). The model has never seen the number
   36, so it could not have checked even if asked.

Fix the cause, then keep the guard.

**Files:**
- Modify: `packages/extractor/src/prose/prompt.ts`
- Modify: `packages/extractor/test/prose.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/extractor/test/prose.test.ts
import { FEW_SHOT_RESPONSE, buildProsePrompt } from '../src/prose/prompt';

describe('prose prompt', () => {
  it('has no bare pixel claim in the exemplar', () => {
    // The exemplar anchors voice and length, not numbers. A measurement in it
    // is copied verbatim into output about a component whose tokens contradict
    // it -- which is how "at least 44 by 44 px" shipped beside a 36px button.
    const text = JSON.stringify(FEW_SHOT_RESPONSE);
    expect(text).not.toMatch(/\b\d+\s*(px|by)\b/i);
  });

  it('sends resolved geometry, not only token names', () => {
    const prompt = buildProsePrompt(SPEC_WITH_RESOLVED_TOKENS, ALL_KEYS);
    expect(prompt).toContain('lg-height');
    expect(prompt).toContain('36');
  });

  it('instructs the model not to state a measurement the tokens do not carry', () => {
    const prompt = buildProsePrompt(SPEC, ALL_KEYS);
    expect(prompt.toLowerCase()).toContain('do not state a measurement');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/prose.test.ts`
Expected: FAIL — the exemplar contains "44 by 44 px".

- [ ] **Step 3: De-number the exemplar**

At `prompt.ts:191`, replace:

```ts
    '- Keep the touch target at least 44 by 44 px so it is comfortable to tap.',
```

with:

```ts
    // No measurement here on purpose. The exemplar anchors voice and length;
    // a number in it gets copied verbatim into guidance about a component whose
    // own tokens contradict it -- which is exactly how a 44px touch-target claim
    // shipped beside a button whose Large height token resolves to 36.
    '- Give the button a touch target comfortable on a phone; check the size tokens rather than assuming the visual height is the target.',
```

Check the rest of the exemplar for the same defect: `prompt.ts:180` ("at least
3:1") and `prompt.ts:196` ("4.5:1") are **WCAG constants, not measurements of
this file**, so they stay. `prompt.ts:201`'s "30-40%" is a general localization
rule of thumb and also stays. Only claims about *this component's geometry* are
the problem.

- [ ] **Step 4: Send resolved geometry**

In `buildProsePrompt`'s Tokens section (`prompt.ts:266`), append the resolved
value where one is known. The function currently takes `spec` only, so widen it
to accept the same `resolved` map `componentBrief` already builds, and thread it
from the caller in `ui/actions.ts`:

```ts
    for (const t of spec.tokens) {
      const condition = formatConditions(t.conditions);
      const qualifier = condition === '—' ? '' : ` [${condition}]`;
      const value = resolved?.get(t.name);
      // The resolved value, when the foundation supplies one. Without it the
      // model can only reason about token NAMES, which is why it could state a
      // 44px target for a 36px button and not notice.
      const suffix = value !== undefined ? ` = ${String(value)}` : '';
      lines.push(`  ${t.part}.${t.property}${qualifier} → ${t.name}${suffix}`);
    }
```

- [ ] **Step 5: Add the instruction**

In the system prompt (`prompt.ts:110` area), add one line:

```ts
  'Do not state a measurement, ratio, or count unless it appears in the token values above. If a',
  'recommendation you would make is not met by the tokens, say that plainly instead of stating the',
  'recommendation as if it held.',
```

- [ ] **Step 6: Run the suite and commit**

Run: `npm test`

```bash
git add packages/extractor/src/prose packages/extractor/test/prose.test.ts packages/plugin/src/ui/actions.ts
git commit -m "fix(prose): stop the exemplar seeding measurements the tokens contradict"
```

---

### Task 12: Emit the content hash

Backlog **D5**. `generated:` changes on every run, so every diff is non-empty
even when the design has not moved. `specContentHash` and
`foundationContentHash` already exist and are already correct — they are simply
never emitted.

**Files:**
- Modify: `packages/extractor/src/brief.ts` (`envelope`, both callers)
- Modify: `packages/extractor/test/brief.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it('emits a content hash that ignores the generated timestamp', () => {
    const a = componentBrief(SPEC, { ...OPTS, generatedAt: '2026-01-01T00:00:00.000Z' }) as
      { spec_layer: { content_hash: string } };
    const b = componentBrief(SPEC, { ...OPTS, generatedAt: '2026-12-31T00:00:00.000Z' }) as
      { spec_layer: { content_hash: string } };
    expect(a.spec_layer.content_hash).toBe(b.spec_layer.content_hash);
    expect(a.spec_layer.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/brief.test.ts -t 'content hash'`
Expected: FAIL — `content_hash` is undefined.

- [ ] **Step 3: Write minimal implementation**

```ts
function envelope(
  kind: 'component' | 'foundation',
  generatedAt: string,
  contentHash?: string,
): YamlValue {
  return {
    kind, version: BRIEF_VERSION, extractor: EXTRACTOR_VERSION,
    generated: generatedAt,
    // The existing drift hash, surfaced. `generated` moves on every run, so
    // without this a diff of two exports is never empty and "did anything
    // actually change?" is unanswerable without reading the whole file. Computed
    // by hash.ts, not here: one definition, so the brief and on-canvas drift
    // detection can never disagree.
    ...(contentHash !== undefined ? { content_hash: contentHash } : {}),
  };
}
```

In `componentBrief`: `envelope('component', opts.generatedAt, specContentHash(spec))`.

For `foundationBrief`, `foundationContentHash` takes a `FoundationScope`. If the
brief covers the whole file rather than one scope, do **not** invent a scope —
either add a whole-spec variant to `hash.ts` alongside the scoped one, or omit
`content_hash` from the foundation brief in this task and note it. Read
`hash.ts:96-124` and `unitContent` before deciding, and state which you chose in
the commit message.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. `briefGolden.test.ts` gains a hash line — it is deterministic, so it belongs in the fixture.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/brief.ts packages/extractor/test packages/extractor/test/fixtures/button-brief.yaml
git commit -m "feat(brief): emit the content hash so runs are diffable"
```

---

### Task 13: Complete the foundation `source` block

Backlog **D2**, corrected. The block exists (`brief.ts:221`) but carries only
`file_key`, and vanishes entirely when the key is unavailable — so "no source"
and "unavailable source" look identical.

**Files:**
- Modify: `packages/extractor/src/foundation.ts` (`FoundationSpec.fileName`)
- Modify: `packages/extractor/src/brief.ts`
- Modify: `packages/plugin/src/ui/actions.ts` (pass the file name through)

- [ ] **Step 1: Write the failing test**

```ts
  it('names the file the foundation came from', () => {
    const brief = foundationBrief({ ...FOUNDATION, fileName: 'Design System' },
      { generatedAt: AT }) as { source: Record<string, string> };
    expect(brief.source.file_key).toBe('abc123');
    expect(brief.source.file_name).toBe('Design System');
  });

  it('states that the source is unavailable rather than omitting the block', () => {
    const brief = foundationBrief({ ...FOUNDATION, fileKey: 'unknown', fileName: undefined },
      { generatedAt: AT }) as { source: Record<string, string> };
    // An absent block reads as "this export has no provenance concept". The
    // truth is "Figma exposed no key here", which is a different fact and the
    // one a consumer needs.
    expect(brief.source).toEqual({ availability: 'unavailable' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/brief.test.ts -t 'foundation came from'`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Add `fileName?: string` to `FoundationSpec` (documented the same way
`IntermediateSpec.figmaFileName` is at `extract.ts:27`, including that it is
excluded from the content hash), then in `foundationBrief`:

```ts
  const source = {
    ...fileKeyOf(foundation.fileKey),
    ...(foundation.fileName ? { file_name: foundation.fileName } : {}),
  };
  return {
    spec_layer: envelope('foundation', opts.generatedAt),
    // ALWAYS present. The earlier rule -- omit entirely, because `source: {}`
    // reads as a measured verdict rather than an absence -- was right about
    // `{}` and wrong about the remedy: an absent block reads as "this format
    // has no provenance", when the fact is "Figma exposed no file key". An
    // explicit marker states the second, following scopeOf's precedent below
    // rather than inventing a third convention.
    source: Object.keys(source).length > 0 ? source : { availability: 'unavailable' },
```

Ensure `fileName` reaches `buildFoundation` from `ui/actions.ts` on the same
message that already carries the file key.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src packages/plugin/src packages/extractor/test
git commit -m "feat(brief): name the source file and state when it is unavailable"
```

---

### Task 14: Escape paths consistently

Backlog **D4**. The escaping mechanism exists and is applied in one place and
not another: `Icon\/.animation` correctly escapes a slash inside a node name,
while `Container/iconLeft/Plus, Add, More, Maximize/Vector` does not — so a
consumer cannot tell a separator from a literal, and one node or two is
unresolvable.

**Files:**
- Modify: `packages/extractor/src/naming.ts`
- Modify: `packages/extractor/test/naming.test.ts`

- [ ] **Step 1: Read first**

Run: `grep -n "\\\\\\\\/" packages/extractor/src/naming.ts packages/extractor/src/tree.ts`

Find where the escape is applied and where the path is assembled. There is one
escaping helper and at least one path-building site that bypasses it; the fix is
to route every site through the helper, not to add a second helper.

- [ ] **Step 2: Write the failing test**

```ts
// packages/extractor/test/naming.test.ts
  it('escapes a separator inside a node name at every path-building site', () => {
    const paths: string[] = [];
    walkParts(nodeTree({
      name: 'Container',
      children: [{ name: 'Plus, Add, More, Maximize', children: [{ name: 'Vector' }] }],
    }), 'Container', (_n, _part, path) => { paths.push(path); }, false);

    // A node name containing no slash is unchanged...
    expect(paths).toContain('Container/Plus, Add, More, Maximize');
    // ...and one containing a slash is escaped, so the separator count is
    // always the depth.
    const withSlash: string[] = [];
    walkParts(nodeTree({ name: 'Container', children: [{ name: 'Icon/.animation' }] }),
      'Container', (_n, _part, path) => { withSlash.push(path); }, false);
    expect(withSlash).toContain('Container/Icon\\/.animation');
  });
```

Build the node fixtures with the helpers already in `naming.test.ts`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/naming.test.ts`
Expected: FAIL on whichever site bypasses the helper.

- [ ] **Step 4: Route every site through the escaping helper**

- [ ] **Step 5: Run the suite and commit**

Run: `npm test`
Expected: PASS. Paths appear in `tokens.bindings`, `unbound`, `validation`, `layout` and `effects_inline`, and they are joined on — so a change here moves several fixture lines at once. Confirm the joins still line up in the regenerated golden file before committing.

```bash
git add packages/extractor/src/naming.ts packages/extractor/test packages/extractor/test/fixtures/button-brief.yaml
git commit -m "fix(extractor): escape path separators at every path-building site"
```

---

### Task 15: Order deterministically

Backlog **C5**. `foundation.ts` contains no sort at all, so Figma's internal
ordering leaks through: the colour ramps interleave (33 family runs where 9
would do) and two exports of an unchanged file are not byte-identical.

**Files:**
- Modify: `packages/extractor/src/brief.ts` (sort in the projection)
- Modify: `packages/extractor/test/brief.test.ts`

**Important:** sort in **`brief.ts`, not `foundation.ts`**. `unitContent()`
feeds `foundationContentHash`, and reordering `FoundationSpec.collections`
in-place would flip the hash of every committed foundation doc for a change no
frame renders. The brief is a projection; ordering is a projection concern.

- [ ] **Step 1: Write the failing test**

```ts
  it('groups token families and sorts leaves numerically', () => {
    const spec: FoundationSpec = {
      ...FOUNDATION,
      collections: [{
        ...FOUNDATION.collections[0],
        variables: ['colors/blue/1000', 'colors/purple/25', 'colors/blue/25', 'colors/blue/100']
          .map((name) => ({
            name, group: 'colors', resolvedType: 'COLOR' as const, description: '',
            codeSyntax: {}, valuesByMode: { m1: { kind: 'color' as const, hex: '#000000', alpha: 1 } },
          })),
      }],
    };
    const names = parseBrief(foundationBrief(spec, { generatedAt: AT }))
      .collections[0].tokens.map((t) => t.name);
    expect(names).toEqual([
      'colors/blue/25', 'colors/blue/100', 'colors/blue/1000', 'colors/purple/25',
    ]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/brief.test.ts -t 'groups token families'`
Expected: FAIL — the input order comes back unchanged, and `1000` sorts before `25` under a plain string compare.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Group path first, then a NATURAL sort on the leaf, so `100` precedes `1000`
 * and a family's ramp reads as one run.
 *
 * Applied in the PROJECTION, never to FoundationSpec itself: unitContent() feeds
 * foundationContentHash, so reordering the spec would flip the hash of every
 * committed foundation doc for a change no frame renders. Ordering is a
 * projection concern; the extracted spec keeps the file's own order.
 *
 * `numeric: true` with `sensitivity: 'base'` is Intl's own natural sort, which
 * is available in the Figma sandbox (no Intl constructor is used, only the
 * comparison option on String.prototype.localeCompare).
 */
function byTokenName(a: FoundationVariable, b: FoundationVariable): number {
  const ga = a.name.slice(0, a.name.lastIndexOf('/'));
  const gb = b.name.slice(0, b.name.lastIndexOf('/'));
  if (ga !== gb) return ga.localeCompare(gb);
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}
```

Apply in `foundationBrief`:

```ts
        tokens: [...c.variables].sort(byTokenName).map((v) => tokenOf(v, modeName)),
```

Sort `text_styles` and `effect_styles` by name the same way. Do **not** sort
collections — their order is the file's own and carries meaning (Foundation
before Mapped Colors reads as base before semantic).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. The golden fixture's token order changes wholesale; that diff *is* the feature.

- [ ] **Step 5: Add the determinism test**

```ts
  it('produces byte-identical YAML for two exports of one spec', () => {
    const a = toYaml(foundationBrief(FOUNDATION, { generatedAt: AT }));
    const b = toYaml(foundationBrief(structuredClone(FOUNDATION), { generatedAt: AT }));
    expect(a).toBe(b);
  });
```

- [ ] **Step 6: Commit**

```bash
git add packages/extractor/src/brief.ts packages/extractor/test packages/extractor/test/fixtures/button-brief.yaml
git commit -m "feat(brief): order tokens deterministically by group and natural leaf"
```

---

### Task 16: Add the `summary:` header

Backlog **D1**. A model must read ~1,900 lines before it knows what the file
contains, and for a larger system it will not fit in context at all with no way
to decide what to read.

**Files:**
- Modify: `packages/extractor/src/brief.ts`
- Modify: `packages/extractor/test/brief.test.ts`

**Depends on:** Task 1 (the `validation` block it counts) and Task 15 (so
`groups` comes out ordered).

- [ ] **Step 1: Write the failing test**

```ts
  it('puts the shape of the file up front', () => {
    const brief = foundationBrief(FOUNDATION, { generatedAt: AT }) as {
      summary: {
        totals: Record<string, number>;
        collections: { name: string; modes: string[]; tokens: number }[];
        groups: string[];
        findings?: Record<string, number>;
      };
    };
    expect(brief.summary.totals).toEqual({
      collections: 1, tokens: 2, text_styles: 1, effect_styles: 0,
    });
    expect(brief.summary.collections[0]).toEqual({
      name: 'Color', modes: ['Light', 'Dark'], tokens: 2,
    });
    expect(brief.summary.groups).toEqual(['color']);
  });

  it('counts findings by severity in the summary', () => {
    const brief = foundationBrief(FOUNDATION_WITH_DUPLICATE_IDENTIFIER, { generatedAt: AT }) as
      { summary: { findings: Record<string, number> } };
    expect(brief.summary.findings).toEqual({ error: 1 });
  });
```

Adjust the expected numbers to whatever `FOUNDATION` actually holds — read the
fixture rather than assuming.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/brief.test.ts -t 'shape of the file'`
Expected: FAIL — no `summary` key.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * The shape of this document, first, so a model can decide what to read.
 *
 * Counts and names only -- never a sample of the data. The whole point is that
 * a reader who stops after this block knows what is here and what is missing;
 * a block that restated values would just be a second copy of the payload.
 *
 * `findings` counts by severity rather than in total: "5 warnings" and "5
 * errors" are different decisions, and a single number hides which one this is.
 * Absent when clean, matching `validation` itself.
 */
function summaryOf(
  foundation: FoundationSpec,
  findings: { severity: string }[],
): YamlValue {
  const tokenCount = foundation.collections.reduce((n, c) => n + c.variables.length, 0);
  const groups = [...new Set(
    foundation.collections.flatMap((c) => c.variables.map((v) => v.group)),
  )].sort();
  const bySeverity: Record<string, number> = {};
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  return {
    totals: {
      collections: foundation.collections.length,
      tokens: tokenCount,
      text_styles: foundation.textStyles.length,
      effect_styles: foundation.effectStyles.length,
    },
    collections: foundation.collections.map((c) => ({
      name: c.name,
      modes: c.modes.map((m) => m.name),
      tokens: c.variables.length,
    })),
    groups,
    ...(Object.keys(bySeverity).length > 0 ? { findings: bySeverity } : {}),
  };
}
```

Emit it directly after `spec_layer`, before `source`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/brief.ts packages/extractor/test packages/extractor/test/fixtures/button-brief.yaml
git commit -m "feat(brief): lead the foundation brief with a summary header"
```

---

### Task 17: Make group descriptions decision-useful

Backlog **C6**. 28 descriptions, ~2,500 characters, of which the sample is "Blue
color scale from very light to very dark." A description earns its tokens when
it says **when to use this rather than its sibling**.

**Files:**
- Modify: `packages/extractor/src/prose/foundationPrompt.ts`
- Modify: `packages/extractor/test/foundationPrompt.test.ts`

- [ ] **Step 1: Read the current instruction**

Run: `sed -n '1,124p' packages/extractor/src/prose/foundationPrompt.ts`

- [ ] **Step 2: Write the failing test**

```ts
  it('forbids restating the group name and asks for the sibling distinction', () => {
    const prompt = buildFoundationPrompt(FOUNDATION_GROUPS);
    const lower = prompt.toLowerCase();
    expect(lower).toContain('when to reach for this group rather than');
    expect(lower).toContain('do not restate the group name');
  });

  it('tells the model which sibling groups resolve to the same values', () => {
    // In the real file colors/blue and colors/purple are byte-identical ramps
    // at all 11 shared steps, so surface/primary and surface/secondary resolve
    // to one colour. One sentence saying that is worth more than both current
    // descriptions combined -- but the model can only write it if it is told.
    const prompt = buildFoundationPrompt(FOUNDATION_WITH_IDENTICAL_RAMPS);
    expect(prompt).toContain('colors/blue and colors/purple resolve to identical values');
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/foundationPrompt.test.ts`
Expected: FAIL.

- [ ] **Step 4: Rewrite the instruction and add the identical-ramp fact**

Replace the description instruction with one that states the job and the
prohibition, then compute identical-ramp pairs (two groups whose leaf sets and
resolved values match at every shared step) and hand them to the model as facts.
Computing the pairs is 15 lines and belongs in `foundationValidate.ts` beside
the other computed facts — export it and import it here.

- [ ] **Step 5: Run the suite and commit**

Run: `npm test`

```bash
git add packages/extractor/src/prose/foundationPrompt.ts packages/extractor/src/foundationValidate.ts packages/extractor/test
git commit -m "feat(prose): ask group descriptions for the sibling distinction"
```

---

**Release 1 checkpoint.** Before starting Release 2:

- [ ] Run `npm run check:ci` and confirm it exits 0. **Never pipe it** — a pipe masks the exit code (see `docs/` CI notes).
- [ ] Copy a real component and a real foundation out of the plugin in Figma and read both YAML files end to end. Every new finding is a claim about a real design; confirm each one before shipping the release.
- [ ] Confirm `BRIEF_VERSION` is still `4` and no existing key changed shape.

---
