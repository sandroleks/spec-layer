# Extractor Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate fabricated token bindings, fix wrong-variant extraction, disambiguate colliding part names, unify state detection, widen gap coverage, and add deterministic WCAG AA contrast findings.

**Architecture:** Four sequential phases. Phase 1 fixes correctness bugs in `packages/extractor` and lands a `spec_version` bump so the resulting hash change reads as "rebuild needed" instead of a wall of drift badges. Phase 2 fixes data-quality bugs that silently merge or omit information. Phase 3 is consistency cleanup. Phase 4 adds a new pure `contrast.ts` module that resolves token names to colors through `FoundationSpec` and emits WCAG AA findings. Contrast findings are excluded from `specContentHash` and never rendered into Markdown, exactly matching the existing `rawValues` precedent, so they cannot destabilize drift detection.

**Tech Stack:** TypeScript (strict), vitest, npm workspaces. Packages: `@spec-layer/extractor`, `@spec-layer/format`, `packages/plugin`.

## Global Constraints

- **Never use em dashes in any plugin UI copy.** Plain, honest peer tone. Rules in `docs/plugin-voice-and-copy.md`.
- **`specContentHash` is the single source of truth for drift.** Anything rendered into the Markdown body must be inside the hashed projection. Anything excluded from the hash (currently `rawValues`, and `contrast` as of Phase 4) must be canvas-only.
- **Run `npm run check:ci` before every commit.** A red `verify` is a real regression, not noise.
- All 272 existing extractor tests must stay green unless a task explicitly changes an assertion, in which case the task says so and explains why.
- Extractor code must remain free of Figma globals so it runs under vitest. Figma access goes through the injected `NodeResolver` in `packages/plugin/src/serialize.ts`.
- `SPEC_VERSION` is `'0.2'` after Task 4. `parseFrontmatter` must keep accepting `'0.1'` files.

---

## File Structure

**Created:**
- `packages/extractor/src/naming.ts` — variant-name parsing and part/prop name cleaning, extracted from `tokens.ts` and `props.ts` to break an import cycle and give one home to name handling.
- `packages/extractor/src/contrast.ts` — WCAG math plus `checkContrast`. Pure; takes an `IntermediateSpec` and a `FoundationSpec`.
- `packages/extractor/test/tokensProperty.test.ts` — the round-trip property test that guards the minimizer.
- `packages/extractor/test/naming.test.ts`
- `packages/extractor/test/contrast.test.ts`

**Modified:**
- `packages/extractor/src/tokens.ts` — ABSENT backfill, conflict backstop, sibling-aware part naming, property map completion.
- `packages/extractor/src/anatomy.ts` — declared default variant, sibling-aware part naming.
- `packages/extractor/src/props.ts` — `extractStates` delegates to `detectStateMatrix`.
- `packages/extractor/src/rawValues.ts` — sibling-aware naming, zero handling.
- `packages/extractor/src/extract.ts` — accepts an optional foundation, threads the axis model, adds `contrast`.
- `packages/extractor/src/hash.ts` — excludes `contrast`.
- `packages/extractor/src/tree.ts` — `text` and `strokes` fields on `SerializedNode`.
- `packages/extractor/src/index.ts` — export `naming`, `contrast`.
- `packages/extractor/src/render.ts` — emit `SPEC_VERSION`.
- `packages/format/src/types.ts`, `packages/format/src/frontmatter.ts` — `SPEC_VERSION`, accept 0.1 and 0.2.
- `packages/plugin/src/serialize.ts` — text metrics, stroke paints, fill alpha.
- `packages/plugin/src/docLink.ts` — `specVersion` on `ComponentDocLink`.
- `packages/plugin/src/ui/viewModel/library.ts`, `packages/plugin/src/ui/screens/library.ts`, `packages/plugin/src/ui/ui-vnext.ts` — `staleVersion` drift state.

---

# Phase 1 — Correctness

### Task 1: Stop the minimizer fabricating token bindings

The presence test in `relevantAxes` ([tokens.ts:281](../../../packages/extractor/src/tokens.ts)) asks a *marginal* question per axis: "does this axis's full value set appear somewhere among the cells?" Absence is a **joint** property of a combo. A part can be missing at `(X=1,Y=p)` while X still spans `{1,2}` and Y still spans `{p,q}` across the cells that do exist, so both conditions get dropped and the rule claims a binding on a variant that has no such part.

**Files:**
- Create: `packages/extractor/test/tokensProperty.test.ts`
- Modify: `packages/extractor/src/tokens.ts`

**Interfaces:**
- Consumes: `extractTokens`, `variantAxisModel` from `./tokens`; `resolveTokensForVariant` from `./resolve`.
- Produces: no public API change. `extractTokens(root): TokenRule[]` keeps its signature.

- [ ] **Step 1: Write the failing property test**

Create `packages/extractor/test/tokensProperty.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractTokens, variantAxisModel } from '../src/tokens';
import { resolveTokensForVariant } from '../src/resolve';
import type { SerializedNode } from '../src/tree';

/** Deterministic PRNG so a failure is always reproducible from its trial index. */
function prng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

const AXIS_SHAPES: Record<string, string[]>[] = [
  { Style: ['Filled', 'Outline'], State: ['Default', 'Hover', 'Disabled'] },
  { Size: ['S', 'M', 'L'], Type: ['A', 'B'], On: ['true', 'false'] },
  { A: ['1', '2'], B: ['x', 'y'], C: ['p', 'q'], D: ['m', 'n'] },
  { Only: ['a', 'b', 'c', 'd'] },
];

/** A component set with a random subset of combos, each carrying a random
 *  subset of parts, each bound to a random token. `sparsity` drops whole
 *  variants; `absence` drops individual parts within a variant. */
function makeSet(
  rnd: () => number,
  axes: Record<string, string[]>,
  opts: { sparsity: number; absence: number },
): SerializedNode {
  const TOKENS = ['tok/a', 'tok/b', 'tok/c'];
  const PARTS = ['Label', 'Icon'];
  const names = Object.keys(axes);
  let combos: Record<string, string>[] = [{}];
  for (const a of names) {
    const next: Record<string, string>[] = [];
    for (const c of combos) for (const v of axes[a]) next.push({ ...c, [a]: v });
    combos = next;
  }
  // Always keep the first combo so the set is never empty.
  const kept = combos.filter((_, i) => i === 0 || rnd() > opts.sparsity);
  let uid = 0;
  return {
    id: 'root', name: 'Comp', type: 'COMPONENT_SET', visible: true, key: 'k',
    propertyDefinitions: Object.fromEntries(
      names.map((a) => [a, { type: 'VARIANT' as const, variantOptions: axes[a] }]),
    ),
    children: kept.map((combo) => ({
      id: `v${uid++}`,
      name: names.map((a) => `${a}=${combo[a]}`).join(', '),
      type: 'COMPONENT', visible: true,
      bindings: [{ property: 'fills', token: TOKENS[Math.floor(rnd() * TOKENS.length)] }],
      children: PARTS.filter(() => rnd() >= opts.absence).map((p) => ({
        id: `n${uid++}`, name: p, type: 'FRAME', visible: true,
        bindings: [{ property: 'fills', token: TOKENS[Math.floor(rnd() * TOKENS.length)] }],
      })),
    })),
  };
}

/** What this variant node ACTUALLY carries, independent of the minimizer. */
function groundTruth(variant: SerializedNode): Set<string> {
  const out = new Set<string>([`Container|fill|${variant.bindings![0].token}`]);
  for (const c of variant.children ?? []) out.add(`${c.name}|fill|${c.bindings![0].token}`);
  return out;
}

describe('extractTokens round-trip invariant', () => {
  it('resolves every variant back to exactly the bindings it carries', () => {
    const failures: string[] = [];
    for (let trial = 0; trial < 400; trial++) {
      const rnd = prng(trial + 1);
      const set = makeSet(rnd, AXIS_SHAPES[trial % AXIS_SHAPES.length], {
        sparsity: [0, 0.3, 0.6][trial % 3],
        absence: [0, 0.25, 0.5][Math.floor(trial / 3) % 3],
      });
      const rules = extractTokens(set);
      const { variants, combos } = variantAxisModel(set);
      variants.forEach((v, i) => {
        const expected = groundTruth(v);
        const actual = new Set(
          resolveTokensForVariant(rules, combos[i]).map((r) => `${r.part}|${r.property}|${r.token}`),
        );
        const fabricated = [...actual].filter((x) => !expected.has(x));
        const lost = [...expected].filter((x) => !actual.has(x));
        if (fabricated.length || lost.length) {
          failures.push(
            `trial ${trial} "${v.name}": FABRICATED=${JSON.stringify(fabricated)} LOST=${JSON.stringify(lost)}`,
          );
        }
      });
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it('does not claim a part in a variant that lacks it (minimal case)', () => {
    // L-shaped presence: Label is absent only at (X=1, Y=p). Marginally, X still
    // spans {1,2} and Y still spans {p,q} across the two cells that exist.
    const leaf = (id: string) => ({
      id, name: 'Label', type: 'FRAME', visible: true,
      bindings: [{ property: 'fills', token: 'tok/a' }],
    });
    const set: SerializedNode = {
      id: 'root', name: 'C', type: 'COMPONENT_SET', visible: true, key: 'k',
      propertyDefinitions: {
        X: { type: 'VARIANT', variantOptions: ['1', '2'] },
        Y: { type: 'VARIANT', variantOptions: ['p', 'q'] },
      },
      children: [
        { id: 'v0', name: 'X=1, Y=p', type: 'COMPONENT', visible: true, children: [] },
        { id: 'v1', name: 'X=1, Y=q', type: 'COMPONENT', visible: true, children: [leaf('n1')] },
        { id: 'v2', name: 'X=2, Y=p', type: 'COMPONENT', visible: true, children: [leaf('n2')] },
      ],
    };
    const rules = extractTokens(set);
    const resolved = resolveTokensForVariant(rules, { X: '1', Y: 'p' });
    expect(resolved).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run packages/extractor/test/tokensProperty.test.ts
```

Expected: both tests FAIL. The minimal case reports one fabricated `Label|fill|tok/a`; the property test reports ~109 affected sets out of 400.

- [ ] **Step 3: Add the ABSENT sentinel constant**

In `packages/extractor/src/tokens.ts`, directly above `interface Cell` (currently around line 197):

```ts
/**
 * Marks "this part/property does not exist in this variant". Backfilled into
 * every grid so absence participates in difference-detection like any other
 * value. Never escapes extractTokens: sentinel rules are dropped when the
 * public shape is built.
 *
 * The SOH prefix makes it unspellable as a Figma variable name. It deliberately
 * avoids the NUL that joins composite keys in this file (`${part}\0${property}`
 * and `tokens.join('\0')`), so the sentinel can never be mistaken for a
 * multi-token cell.
 */
const ABSENT = '\u0001ABSENT';
```

- [ ] **Step 4: Backfill the observation grid**

In `extractTokens`, insert immediately before the `// --- Minimize each (part, property) grid into rules ---` comment:

```ts
  // Presence is a JOINT property of a variant's full combo, not a marginal one
  // per axis: a part can be absent at (X=1,Y=p) while X still spans {1,2} and Y
  // still spans {p,q} across the cells that DO exist. relevantAxes' per-axis
  // presence test cannot see that, so both conditions get dropped and the rule
  // claims a binding on a variant with no such part. Backfilling an explicit
  // ABSENT cell for every missing combo turns absence into just another token
  // value, which the difference-detection below already handles correctly.
  // Cells hold combo objects by reference from `combos`, so identity works here.
  for (const cells of cellsByPartProp.values()) {
    const present = new Set(cells.map((c) => c.combo));
    for (const combo of combos) {
      if (!present.has(combo)) cells.push({ combo, tokens: [ABSENT] });
    }
  }
```

- [ ] **Step 5: Drop sentinel rules from the output**

In the finalize loop at the bottom of `extractTokens`, replace:

```ts
      for (const r of rules) out.push(toTokenRule(part, prop, r));
```

with:

```ts
      for (const r of rules) {
        if (r.token === ABSENT) continue;
        out.push(toTokenRule(part, prop, r));
      }
```

- [ ] **Step 6: Run the new test and the full suite**

```bash
npx vitest run packages/extractor
```

Expected: `tokensProperty.test.ts` PASSES (0 fabricated, 0 lost) and all 272 pre-existing tests still pass. The pre-existing suite never covered non-rectangular presence, so this is a strict improvement with no assertion changes.

- [ ] **Step 7: Commit**

```bash
git add packages/extractor/src/tokens.ts packages/extractor/test/tokensProperty.test.ts
git commit -m "fix(extractor): stop minimizer claiming tokens on variants that lack the part"
```

---

### Task 2: Backstop the conflict-repair loop

The repair loop at [tokens.ts:319](../../../packages/extractor/src/tokens.ts) adds axes until the projection is unambiguous, but never re-checks afterwards. If a conflict survives (two variants whose names parse to the same combo, possible with hand-edited variant names), the grouping step unions two different token sets and invents a binding no variant carries. Same failure mode as Task 1, different door.

**Files:**
- Modify: `packages/extractor/src/tokens.ts`
- Test: `packages/extractor/test/tokens.test.ts`

**Interfaces:**
- Consumes: `Cell`, `hasConflict`, `projKey`, `axisOrder` — all already local to `extractTokens`.
- Produces: no public API change.

- [ ] **Step 1: Write the failing test**

Append to `packages/extractor/test/tokens.test.ts`:

```ts
describe('duplicate parsed combos', () => {
  it('does not union conflicting token sets when two variants parse alike', () => {
    // Both names parse to { Size: 'S' } — the duplicate axis makes the second
    // key win, so these two distinct COMPONENT nodes collide in the axis model.
    const set: SerializedNode = {
      id: 'root', name: 'C', type: 'COMPONENT_SET', visible: true, key: 'k',
      propertyDefinitions: { Size: { type: 'VARIANT', variantOptions: ['S'] } },
      children: [
        { id: 'v0', name: 'Size=S', type: 'COMPONENT', visible: true,
          bindings: [{ property: 'fills', token: 'tok/a' }] },
        { id: 'v1', name: 'Size=M, Size=S', type: 'COMPONENT', visible: true,
          bindings: [{ property: 'fills', token: 'tok/b' }] },
      ],
    };
    const rules = extractTokens(set);
    const containerFills = rules.filter((r) => r.part === 'Container' && r.property === 'fill');
    // Exactly one rule survives. Emitting BOTH would tell the reader that one
    // variant carries two different fills at once, which no variant does.
    expect(containerFills).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run packages/extractor/test/tokens.test.ts -t 'duplicate parsed combos'
```

Expected: FAIL, `expected length 1, received 2`.

- [ ] **Step 3: Make `cells` reassignable in `buildRules`**

In `packages/extractor/src/tokens.ts`, change the signature:

```ts
  const buildRules = (cellsIn: Cell[]): DraftRule[] => {
    let cells = cellsIn;
    let relevant = relevantAxes(cells);
```

- [ ] **Step 4: Add the backstop after the repair loop**

Immediately after the existing repair `for` loop and before the `// Project cells onto the relevant axes.` comment:

```ts
    // Backstop. If a conflict survives adding every axis, two variants parse to
    // the SAME combo (hand-edited variant names do this). Unioning their token
    // sets below would invent a binding no variant carries, so fall back to
    // fully-specific conditions and keep only the first cell per combo.
    if (hasConflict(cells, relevant)) {
      relevant = [...axisOrder];
      const byCombo = new Map<string, Cell>();
      for (const c of cells) {
        const k = projKey(c.combo, axisOrder);
        if (!byCombo.has(k)) byCombo.set(k, c);
      }
      cells = [...byCombo.values()];
    }
```

- [ ] **Step 5: Run the test and the full suite**

```bash
npx vitest run packages/extractor
```

Expected: the new test PASSES, everything else still green.

- [ ] **Step 6: Commit**

```bash
git add packages/extractor/src/tokens.ts packages/extractor/test/tokens.test.ts
git commit -m "fix(extractor): never union conflicting token sets in the minimizer"
```

---

### Task 3: Honor Figma's declared default variant

`defaultVariant` returns `children[0]`. Figma's real default is `propertyDefinitions[axis].defaultValue`, which is already serialized and typed. When a designer's default is not first in child order, `extractAnatomy`, `extractGaps`, `extractRawValues`, and `extractLayout` all describe the wrong variant.

`anatomy.ts` needs `parseVariantName`, which lives in `tokens.ts`, which imports `defaultVariant` from `anatomy.ts`. Break the cycle by moving name helpers into a new `naming.ts`.

**Files:**
- Create: `packages/extractor/src/naming.ts`
- Create: `packages/extractor/test/naming.test.ts`
- Modify: `packages/extractor/src/tokens.ts`, `packages/extractor/src/anatomy.ts`, `packages/extractor/src/index.ts`
- Test: `packages/extractor/test/anatomy.test.ts`

**Interfaces:**
- Produces: `naming.ts` exports `parseVariantName(name: string): Record<string, string> | null` and `cleanPartName(name: string): string`, both moved verbatim from `tokens.ts`. `tokens.ts` re-exports both so existing importers (`rawValues.ts`, tests) keep working unchanged.
- Produces: `defaultVariant(root: SerializedNode): SerializedNode` — signature unchanged, behavior corrected.

- [ ] **Step 1: Write the failing test**

Append to `packages/extractor/test/anatomy.test.ts`:

```ts
describe('defaultVariant', () => {
  const variant = (id: string, name: string, partName: string): SerializedNode => ({
    id, name, type: 'COMPONENT', visible: true,
    children: [{ id: `${id}-c`, name: partName, type: 'FRAME', visible: true }],
  });

  it('picks the variant Figma declares as default, not the first child', () => {
    const set: SerializedNode = {
      id: 'r', name: 'Button', type: 'COMPONENT_SET', visible: true, key: 'k',
      propertyDefinitions: {
        Style: { type: 'VARIANT', variantOptions: ['Filled', 'Ghost'], defaultValue: 'Ghost' },
      },
      children: [variant('v0', 'Style=Filled', 'FilledPart'), variant('v1', 'Style=Ghost', 'GhostPart')],
    };
    expect(defaultVariant(set).name).toBe('Style=Ghost');
    expect(extractAnatomy(set).parts.map((p) => p.name)).toEqual(['GhostPart']);
  });

  it('falls back to the first COMPONENT child when no default is declared', () => {
    const set: SerializedNode = {
      id: 'r', name: 'Button', type: 'COMPONENT_SET', visible: true, key: 'k',
      propertyDefinitions: { Style: { type: 'VARIANT', variantOptions: ['Filled', 'Ghost'] } },
      children: [variant('v0', 'Style=Filled', 'FilledPart'), variant('v1', 'Style=Ghost', 'GhostPart')],
    };
    expect(defaultVariant(set).name).toBe('Style=Filled');
  });

  it('falls back to the first child when the declared default matches nothing', () => {
    const set: SerializedNode = {
      id: 'r', name: 'Button', type: 'COMPONENT_SET', visible: true, key: 'k',
      propertyDefinitions: {
        Style: { type: 'VARIANT', variantOptions: ['Filled'], defaultValue: 'Vanished' },
      },
      children: [variant('v0', 'Style=Filled', 'FilledPart')],
    };
    expect(defaultVariant(set).name).toBe('Style=Filled');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run packages/extractor/test/anatomy.test.ts -t 'defaultVariant'
```

Expected: the first test FAILS with `expected 'Style=Filled' to be 'Style=Ghost'`. The other two pass already.

- [ ] **Step 3: Create `naming.ts`**

Create `packages/extractor/src/naming.ts` and move these two declarations out of `tokens.ts` verbatim:

```ts
/** Parse "Style=Filled, State=Enabled" into { Style: 'Filled', State: 'Enabled' };
 *  null if any segment is not Axis=Value. */
export function parseVariantName(name: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const segment of name.split(',')) {
    const [axis, ...rest] = segment.split('=');
    if (!rest.length) return null;
    out[axis.trim()] = rest.join('=').trim();
  }
  return out;
}

/** Layer names carry Figma prop-binding artifacts like "icon-primary#" — strip them. */
export const cleanPartName = (name: string) => name.replace(/#+\s*$/, '').trim();
```

- [ ] **Step 4: Repoint the importers**

Delete both declarations from `packages/extractor/src/tokens.ts` and import them instead, near the top after the existing imports:

```ts
import { parseVariantName, cleanPartName } from './naming';
```

`packages/extractor/src/rawValues.ts:3` currently imports `cleanPartName` from `'./tokens'`. Repoint it:

```ts
import { cleanPartName } from './naming';
```

Do **not** add a re-export from `tokens.ts`: Step 6 adds `export * from './naming'` to the barrel, and a re-export would then be a duplicate export. `packages/plugin/src/ui/docModel.ts` imports `cleanPartName` from the `@spec-layer/extractor` barrel, so it needs no change.

- [ ] **Step 5: Rewrite `defaultVariant`**

In `packages/extractor/src/anatomy.ts`, add the import and replace the function:

```ts
import { parseVariantName } from './naming';
```

```ts
/**
 * The variant Figma treats as the default: the one whose combo matches every
 * VARIANT property's declared `defaultValue`. Child order is NOT the default
 * (a designer can reorder variants freely), so falling back to children[0]
 * would silently document a different variant than the one Figma shows.
 * Falls back to the first COMPONENT child when nothing is declared or the
 * declared combo matches no existing variant.
 */
export function defaultVariant(root: SerializedNode): SerializedNode {
  if (root.type !== 'COMPONENT_SET' || !root.children?.length) return root;
  const variants = root.children.filter((c) => c.type === 'COMPONENT');
  if (!variants.length) return root.children[0];

  const declared = Object.entries(root.propertyDefinitions ?? {})
    .filter(([, d]) => d.type === 'VARIANT' && typeof d.defaultValue === 'string')
    .map(([axis, d]) => [axis, d.defaultValue as string] as const);

  if (declared.length) {
    const match = variants.find((v) => {
      const combo = parseVariantName(v.name);
      return combo != null && declared.every(([axis, value]) => combo[axis] === value);
    });
    if (match) return match;
  }
  return variants[0];
}
```

- [ ] **Step 6: Export the new module from the barrel**

Add to `packages/extractor/src/index.ts`, above the existing `export * from './tokens';` line:

```ts
export * from './naming';
```

This keeps `cleanPartName` and `parseVariantName` reachable from `@spec-layer/extractor` for existing consumers such as `packages/plugin/src/ui/docModel.ts`.

- [ ] **Step 7: Create `naming.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseVariantName, cleanPartName } from '../src/naming';

describe('parseVariantName', () => {
  it('parses a well-formed combo', () => {
    expect(parseVariantName('Style=Filled, State=Enabled')).toEqual({ Style: 'Filled', State: 'Enabled' });
  });
  it('keeps "=" inside a value', () => {
    expect(parseVariantName('Label=a=b')).toEqual({ Label: 'a=b' });
  });
  it('returns null when a segment is not Axis=Value', () => {
    expect(parseVariantName('Filled')).toBeNull();
  });
});

describe('cleanPartName', () => {
  it('strips trailing prop-binding hashes', () => {
    expect(cleanPartName('icon-primary#')).toBe('icon-primary');
    expect(cleanPartName('icon ##  ')).toBe('icon');
  });
  it('leaves an interior hash alone', () => {
    expect(cleanPartName('icon#2')).toBe('icon#2');
  });
});
```

- [ ] **Step 8: Run the full suite**

```bash
npx vitest run packages/extractor && npm run check:ci
```

Expected: all green. If a fixture-based test asserted anatomy from a set whose declared default is not first, update that assertion and note it in the commit body.

- [ ] **Step 9: Commit**

```bash
git add packages/extractor/src/naming.ts packages/extractor/src/tokens.ts packages/extractor/src/anatomy.ts packages/extractor/src/index.ts packages/extractor/test/naming.test.ts packages/extractor/test/anatomy.test.ts
git commit -m "fix(extractor): use Figma's declared default variant, not child order"
```

---

### Task 4: Bump `spec_version` to 0.2 and add a `staleVersion` drift state

Tasks 1 and 3 both change `IntermediateSpec`, so `specContentHash` moves and every committed doc would show "Update available". A version field makes the cause explicit: docs generated by a pre-0.2 extractor read as "Rebuild needed" rather than as content drift.

**Files:**
- Modify: `packages/format/src/types.ts`, `packages/format/src/frontmatter.ts`
- Modify: `packages/extractor/src/render.ts:133`
- Modify: `packages/plugin/src/docLink.ts`
- Modify: `packages/plugin/src/ui/viewModel/library.ts`, `packages/plugin/src/ui/screens/library.ts`, `packages/plugin/src/ui/ui-vnext.ts`
- Test: `packages/format/test/frontmatter.test.ts`, `packages/plugin/test/libraryViewModel.test.ts`

**Interfaces:**
- Produces: `SPEC_VERSION: '0.2'` and `type SpecVersion = '0.1' | '0.2'` from `@spec-layer/format`.
- Produces: `ComponentDocLink.specVersion?: string` — optional, absent on every blob written before this task.
- Produces: `LibraryDriftState` gains `'staleVersion'`; `LibraryRowStatus` gains `'rebuildNeeded'`.

- [ ] **Step 1: Write the failing frontmatter test**

In `packages/format/test/frontmatter.test.ts`, replace the `rejects an unsupported spec_version` test with:

```ts
  it('accepts a 0.1 file written before the bump', () => {
    const md = serializeFrontmatter({ ...fm, spec_version: '0.1' }, 'body');
    expect(parseFrontmatter(md).frontmatter.spec_version).toBe('0.1');
  });

  it('accepts a 0.2 file', () => {
    const md = serializeFrontmatter({ ...fm, spec_version: '0.2' }, 'body');
    expect(parseFrontmatter(md).frontmatter.spec_version).toBe('0.2');
  });

  it('rejects an unsupported spec_version', () => {
    const md = serializeFrontmatter({ ...fm, spec_version: '9.9' as never }, '');
    expect(() => parseFrontmatter(md)).toThrow(/spec_version/i);
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run packages/format
```

Expected: the `0.2` test FAILS with `Unsupported spec_version: 0.2`.

- [ ] **Step 3: Add `SPEC_VERSION` and widen the type**

In `packages/format/src/types.ts`:

```ts
/** The spec format this build writes. Bumped when a change to the extractor
 *  moves specContentHash for reasons unrelated to the design itself, so a
 *  stale doc reads as "rebuild needed" rather than as content drift. */
export const SPEC_VERSION = '0.2' as const;

/** Versions this build can still read. */
export type SpecVersion = '0.1' | '0.2';
```

and change the field:

```ts
  spec_version: SpecVersion;
```

- [ ] **Step 4: Accept both versions when parsing**

In `packages/format/src/frontmatter.ts`:

```ts
import type { SpecFrontmatter, SpecStatus, SpecVersion } from './types';

const STATUSES: SpecStatus[] = ['draft', 'approved', 'deprecated'];
const READABLE_VERSIONS: SpecVersion[] = ['0.1', '0.2'];
```

and replace the version guard:

```ts
  if (!READABLE_VERSIONS.includes(fm.spec_version)) {
    throw new Error(`Unsupported spec_version: ${fm.spec_version}`);
  }
```

- [ ] **Step 5: Emit the new version**

In `packages/extractor/src/render.ts:133`, replace `spec_version: '0.1',` with `spec_version: SPEC_VERSION,` and add the import at the top of the file:

```ts
import { SPEC_VERSION } from '@spec-layer/format';
```

- [ ] **Step 6: Stamp the version onto component doc links**

In `packages/plugin/src/docLink.ts`, add to `ComponentDocLink`:

```ts
  /** Extractor format that produced this doc. Absent on every blob written
   *  before 0.2; treated as stale so the doc is rebuilt once. */
  specVersion?: string;
```

- [ ] **Step 7: Add the drift state**

In `packages/plugin/src/ui/viewModel/library.ts`:

```ts
export type LibraryDriftState =
  | 'pending'
  | 'inSync'
  | 'drifted'
  | 'staleVersion'
  | 'unavailable';

export type LibraryRowStatus =
  | 'pending'
  | 'inSync'
  | 'updateAvailable'
  | 'rebuildNeeded'
  | 'edited'
  | 'orphaned'
  | 'unavailable';
```

In the same file, `resolveStatus`'s caller maps drift to row status. Add the mapping alongside the existing `drifted` branch so a `staleVersion` drift yields `'rebuildNeeded'`, and add it to `sourceDrifted` so the row still counts as needing action:

```ts
    sourceDrifted: drift === 'drifted' || drift === 'staleVersion',
```

- [ ] **Step 8: Add the copy**

In `packages/plugin/src/ui/screens/library.ts`, add to `STATUS_COPY`. No em dashes:

```ts
  rebuildNeeded: 'Rebuild needed',
```

- [ ] **Step 9: Check the version before comparing hashes**

In `packages/plugin/src/ui/ui-vnext.ts`, in the `driftSource` case (around line 2056), check the stored version first. A hash comparison against a doc built by an older extractor is meaningless.

```ts
    case 'driftSource': {
      const baseline = libraryBaseline.get(msg.docId);
      if (baseline === undefined) return;
      // A pre-0.2 doc was produced by an extractor whose hash projection differs,
      // so comparing hashes would report drift for the wrong reason.
      if (librarySpecVersion.get(msg.docId) !== SPEC_VERSION) {
        libraryDrift.set(msg.docId, 'staleVersion');
      } else {
        try {
          const spec = extract(msg.node, { figmaFile: msg.fileKey });
          libraryDrift.set(msg.docId, specContentHash(spec) === baseline ? 'inSync' : 'drifted');
        } catch {
          libraryDrift.set(msg.docId, 'unavailable');
        }
      }
      libraryRefreshing = [...libraryDrift.values()].some((value) => value === 'pending');
      syncLibraryBadge();
      if (view === 'library') paint();
      return;
    }
```

Declare `librarySpecVersion` next to `libraryBaseline` and populate it from the parsed link wherever `libraryBaseline` is populated:

```ts
const librarySpecVersion = new Map<string, string | undefined>();
```

Import `SPEC_VERSION` from `@spec-layer/format` at the top of the file.

- [ ] **Step 10: Run everything**

```bash
npx vitest run && npm run check:ci
```

Expected: all green. Update `packages/plugin/test/libraryViewModel.test.ts` if it exhaustively switches on `LibraryRowStatus`; add a case asserting `staleVersion` maps to `rebuildNeeded`.

- [ ] **Step 11: Commit**

```bash
git add packages/format packages/extractor/src/render.ts packages/plugin/src/docLink.ts packages/plugin/src/ui
git commit -m "feat: bump spec_version to 0.2 and surface stale docs as rebuild needed"
```

---

# Phase 2 — Data quality

### Task 5: Disambiguate same-named sibling layers

Part identity is `cleanPartName(node.name)`. A leading and a trailing icon both named `icon` collapse into one part carrying two contradictory unconditioned fill rules, and `extractAnatomy` drops the second entirely.

Numbering is computed over **all** children including hidden ones, so a part's name does not shift between variants where a same-named sibling is hidden.

**Files:**
- Modify: `packages/extractor/src/naming.ts`, `packages/extractor/src/tokens.ts`, `packages/extractor/src/rawValues.ts`, `packages/extractor/src/anatomy.ts`
- Test: `packages/extractor/test/tokens.test.ts`, `packages/extractor/test/anatomy.test.ts`

**Interfaces:**
- Produces: `siblingPartNames(children: SerializedNode[]): Map<SerializedNode, string>` in `naming.ts`.
- Produces: `walkParts(root, rootName, visit: (n: SerializedNode, part: string) => void, skipInvisible?: boolean): void` in `naming.ts`, replacing the private `walk` in `tokens.ts`.

- [ ] **Step 1: Write the failing test**

Append to `packages/extractor/test/tokens.test.ts`:

```ts
describe('same-named siblings', () => {
  const set: SerializedNode = {
    id: 'root', name: 'Button', type: 'COMPONENT_SET', visible: true, key: 'k',
    propertyDefinitions: { Style: { type: 'VARIANT', variantOptions: ['Filled'] } },
    children: [{
      id: 'v0', name: 'Style=Filled', type: 'COMPONENT', visible: true,
      children: [
        { id: 'a', name: 'icon', type: 'FRAME', visible: true, bindings: [{ property: 'fills', token: 'tok/leading' }] },
        { id: 'b', name: 'label', type: 'TEXT', visible: true, bindings: [{ property: 'fills', token: 'tok/text' }] },
        { id: 'c', name: 'icon', type: 'FRAME', visible: true, bindings: [{ property: 'fills', token: 'tok/trailing' }] },
      ],
    }],
  };

  it('keeps two same-named siblings as distinct parts', () => {
    const byPart = extractTokens(set).map((r) => `${r.part}=${r.token}`);
    expect(byPart).toContain('icon=tok/leading');
    expect(byPart).toContain('icon (2)=tok/trailing');
    // The bug: both landed on `icon`, producing two unconditioned rules for one part.
    expect(byPart.filter((p) => p.startsWith('icon='))).toHaveLength(1);
  });
});
```

Append to `packages/extractor/test/anatomy.test.ts`:

```ts
  it('lists both same-named siblings instead of dropping the second', () => {
    const set: SerializedNode = {
      id: 'root', name: 'Button', type: 'COMPONENT_SET', visible: true, key: 'k',
      children: [{
        id: 'v0', name: 'Style=Filled', type: 'COMPONENT', visible: true,
        children: [
          { id: 'a', name: 'icon', type: 'FRAME', visible: true },
          { id: 'b', name: 'label', type: 'TEXT', visible: true },
          { id: 'c', name: 'icon', type: 'FRAME', visible: true },
        ],
      }],
    };
    expect(extractAnatomy(set).parts.map((p) => p.name)).toEqual(['icon', 'label', 'icon (2)']);
  });
```

- [ ] **Step 2: Run to verify both fail**

```bash
npx vitest run packages/extractor/test/tokens.test.ts packages/extractor/test/anatomy.test.ts
```

Expected: the tokens test FAILS (two `icon=` rules), the anatomy test FAILS (`['icon','label']`).

- [ ] **Step 3: Add the naming helpers**

Append to `packages/extractor/src/naming.ts`:

```ts
import type { SerializedNode } from './tree';

/**
 * Assign each child a part name unique among its SIBLINGS: the first keeps the
 * clean name, later same-named siblings get " (2)", " (3)". Numbering runs over
 * ALL children including hidden ones, so a part keeps the same name in a variant
 * where a same-named sibling happens to be hidden.
 */
export function siblingPartNames(children: SerializedNode[]): Map<SerializedNode, string> {
  const counts = new Map<string, number>();
  const out = new Map<SerializedNode, string>();
  for (const child of children) {
    const base = cleanPartName(child.name);
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    out.set(child, n === 1 ? base : `${base} (${n})`);
  }
  return out;
}

/**
 * Depth-first walk that hands each node its disambiguated part name. Replaces
 * per-call `cleanPartName(n.name)`, which merged same-named siblings into one
 * part. `skipInvisible` prunes hidden subtrees (token extraction wants that so
 * presence-driven conditioning works; gap detection does not).
 */
export function walkParts(
  root: SerializedNode,
  rootName: string,
  visit: (n: SerializedNode, part: string) => void,
  skipInvisible = false,
): void {
  if (skipInvisible && root.visible === false) return;
  visit(root, rootName);
  const kids = root.children ?? [];
  const names = siblingPartNames(kids);
  for (const child of kids) walkParts(child, names.get(child)!, visit, skipInvisible);
}
```

- [ ] **Step 4: Use it in `tokens.ts`**

Delete the private `walk` function from `tokens.ts` and import instead:

```ts
import { parseVariantName, cleanPartName, walkParts } from './naming';
```

In `extractTokens`, replace the walk call:

```ts
    walkParts(variant, isInSet ? 'Container' : cleanPartName(variant.name), (n, part) => {
      for (const { property, token } of normalizeBindings(n.bindings ?? [])) {
        const key = `${part}\0${property}`;
        let set = variantTokens.get(key);
        if (!set) variantTokens.set(key, (set = new Set()));
        set.add(token);
      }
    }, true);
```

In `extractGaps`, replace the walk call:

```ts
  walkParts(def, isInSet ? 'Container' : cleanPartName(def.name), (n, part) => {
```

and delete the now-unused `const part = ...` line inside the callback.

- [ ] **Step 5: Use it in `rawValues.ts`**

Replace the hand-rolled `walk` closure with `walkParts`:

```ts
import { cleanPartName, walkParts } from './naming';
```

```ts
  const def = defaultVariant(root);
  walkParts(def, root.type === 'COMPONENT_SET' ? 'Container' : cleanPartName(def.name), (n, part) => {
    if (n.visible === false) return;
    const bound = new Set((n.bindings ?? []).map((b) => b.property));
    // ...body unchanged, using `part` instead of the deleted local
  });
```

Note `walkParts` is called without `skipInvisible` here because the existing body already returns early on hidden nodes and the surrounding behavior must not change.

- [ ] **Step 6: Use it in `anatomy.ts` and drop the name dedup**

In `extractAnatomy`, replace the `seenNames` dedup with sibling naming. The dedup existed because two entries both reading `iconWrapper` were indistinguishable; with distinct names that reason is gone, and each part has its own node id for the canvas pin anyway.

```ts
  const addParts = (nodes: SerializedNode[], depth: number): void => {
    const names = siblingPartNames(nodes);
    for (const child of nodes) {
      if (!child.visible) continue;
      const nested = child.type === 'INSTANCE';
      if (nested && child.mainComponent) related.add(child.mainComponent.name);
      parts.push({
        id: child.id, name: names.get(child)!, type: child.type, nested, depth,
        ...(nested && child.mainComponent ? { component: child.mainComponent.name } : {}),
      });
      if (!nested && depth + 1 < MAX_DEPTH && child.children?.length) {
        addParts(child.children, depth + 1);
      }
    }
  };
  addParts(children, 0);
```

Update the call site and delete the now-stale dedup paragraph from the function's doc comment, replacing it with:

```
  // Same-named siblings (a leading and a trailing "icon") are numbered rather
  // than deduped: they are two real parts with two real node ids and, often,
  // two different token bindings. An earlier version dropped the second, which
  // hid it from anatomy while tokens.ts silently merged both onto one part.
```

Add the import:

```ts
import { siblingPartNames } from './naming';
```

- [ ] **Step 7: Run everything**

```bash
npx vitest run && npm run check:ci
```

Expected: the two new tests pass. Any fixture test asserting anatomy or token parts for a component with duplicate layer names will need its expectation updated to the numbered form; that is the intended change.

- [ ] **Step 8: Commit**

```bash
git add packages/extractor/src packages/extractor/test
git commit -m "fix(extractor): number same-named sibling layers instead of merging them"
```

---

### Task 6: One definition of "state"

`extractStates` matches only a prop literally named `state`/`states`. `detectStateMatrix` accepts `Status`, a 21-word vocabulary, and a "two or more values in the vocab" fallback. A `Status=[Enabled,Hover,Disabled]` chip reports `["Default"]` in the spec and three states in the matrix.

**Files:**
- Modify: `packages/extractor/src/props.ts`
- Test: `packages/extractor/test/props.test.ts`

**Interfaces:**
- Consumes: `detectStateMatrix(variants: VariantAxis[]): StateMatrixInfo | null` from `./statesMatrix`.
- Produces: `extractStates(root: SerializedNode): string[]` — signature unchanged.

`statesMatrix.ts` imports from `./props`, so `props.ts` importing `detectStateMatrix` creates a cycle. `detectStateMatrix` only needs the `VariantAxis` *type*, and `import type` is erased at compile time, so the cycle is type-only and harmless. Verify the build passes; if the bundler complains, move `detectStateMatrix` into `props.ts` instead.

- [ ] **Step 1: Write the failing test**

Append to `packages/extractor/test/props.test.ts`:

```ts
describe('extractStates agrees with the states matrix', () => {
  const setWith = (prop: string, values: string[]): SerializedNode => ({
    id: 'r', name: 'Chip', type: 'COMPONENT_SET', visible: true, key: 'k',
    propertyDefinitions: { [prop]: { type: 'VARIANT', variantOptions: values } },
    children: [{ id: 'v0', name: `${prop}=${values[0]}`, type: 'COMPONENT', visible: true }],
  });

  it('recognizes a Status axis', () => {
    expect(extractStates(setWith('Status', ['Enabled', 'Hover', 'Disabled'])))
      .toEqual(['Enabled', 'Hover', 'Disabled']);
  });

  it('recognizes a differently-named axis whose values are state words', () => {
    expect(extractStates(setWith('Interaction', ['Rest', 'Hover', 'Pressed'])))
      .toEqual(['Rest', 'Hover', 'Pressed']);
  });

  it('still handles a plain State axis', () => {
    expect(extractStates(setWith('State', ['Default', 'Hover']))).toEqual(['Default', 'Hover']);
  });

  it('falls back to Default when no axis is state-like', () => {
    expect(extractStates(setWith('Size', ['S', 'M']))).toEqual(['Default']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run packages/extractor/test/props.test.ts -t 'agrees with the states matrix'
```

Expected: the first two tests FAIL with `['Default']`.

- [ ] **Step 3: Delegate to the matrix detector**

In `packages/extractor/src/props.ts`, add the import and replace `extractStates`:

```ts
import { detectStateMatrix } from './statesMatrix';
```

```ts
/**
 * The component's states, using the SAME detection the States matrix uses.
 * An earlier version matched only a prop literally named "state", so a
 * `Status=[Enabled,Hover,Disabled]` component reported ["Default"] in the spec
 * while the matrix rendered three columns for the same component.
 * Flag-encoded states ("Default" plus one column per boolean) come back in
 * column order; "Default" is the synthesized base column.
 */
export function extractStates(root: SerializedNode): string[] {
  const info = detectStateMatrix(extractVariants(root));
  if (!info) return ['Default'];
  return info.columns.map((c) => c.label);
}
```

- [ ] **Step 4: Run everything**

```bash
npx vitest run && npm run check:ci
```

Expected: green. `IntermediateSpec.states` is inside the hash, so this changes hashes for components with a non-`State` state axis. That is already covered by the 0.2 bump from Task 4.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/props.ts packages/extractor/test/props.test.ts
git commit -m "fix(extractor): use one state detector for the spec and the states matrix"
```

---

### Task 7: Widen gap detection to strokes, gradients, effects and opacity

`hasUnboundPaint` inspects only `node.fills` and only `SOLID` paints, so a hand-painted stroke colour, a hardcoded gradient, an unbound shadow and a hand-set opacity are all invisible to the gaps report.

**Files:**
- Modify: `packages/extractor/src/tree.ts`, `packages/extractor/src/tokens.ts`, `packages/plugin/src/serialize.ts`
- Test: `packages/extractor/test/tokens.test.ts`, `packages/plugin/test/serialize.test.ts`

**Interfaces:**
- Produces: `SerializedNode` gains `hasUnboundStroke?: boolean`, `unboundStroke?: string`, `hasUnboundGradient?: boolean`, `hasUnboundEffect?: boolean`, `opacity?: number`.
- `Gap { part: string; issue: string }` is unchanged; only new issue strings are emitted.

- [ ] **Step 1: Write the failing extractor test**

Append to `packages/extractor/test/tokens.test.ts`:

```ts
describe('extractGaps coverage', () => {
  const comp = (extra: Partial<SerializedNode>): SerializedNode => ({
    id: 'v0', name: 'Button', type: 'COMPONENT', visible: true, ...extra,
  });

  it('reports a hardcoded stroke colour', () => {
    const gaps = extractGaps(comp({ hasUnboundStroke: true }));
    expect(gaps).toContainEqual({ part: 'Button', issue: 'hardcoded stroke colour (no variable or style)' });
  });

  it('reports a hardcoded gradient or image fill', () => {
    const gaps = extractGaps(comp({ hasUnboundGradient: true }));
    expect(gaps).toContainEqual({ part: 'Button', issue: 'hardcoded gradient or image fill (no style)' });
  });

  it('reports an unbound effect', () => {
    const gaps = extractGaps(comp({ hasUnboundEffect: true }));
    expect(gaps).toContainEqual({ part: 'Button', issue: 'hardcoded shadow or blur (no effect style)' });
  });

  it('reports a hand-set opacity', () => {
    const gaps = extractGaps(comp({ opacity: 0.5 }));
    expect(gaps).toContainEqual({ part: 'Button', issue: 'hardcoded opacity (0.5)' });
  });

  it('does not report opacity when it is fully opaque', () => {
    expect(extractGaps(comp({ opacity: 1 }))).toEqual([]);
  });

  it('does not report opacity when it is bound to a variable', () => {
    const gaps = extractGaps(comp({ opacity: 0.5, bindings: [{ property: 'opacity', token: 'a/b' }] }));
    expect(gaps).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run packages/extractor/test/tokens.test.ts -t 'extractGaps coverage'
```

Expected: FAIL. The new `SerializedNode` fields do not exist yet, so this is a type error first.

- [ ] **Step 3: Extend `SerializedNode`**

In `packages/extractor/src/tree.ts`, add alongside the existing `hasUnboundPaint`:

```ts
  /** True when a stroke paint is hardcoded (no variable/style). */
  hasUnboundStroke?: boolean;
  /** `#rrggbb` of the first hardcoded SOLID stroke (set only when hasUnboundStroke). */
  unboundStroke?: string;
  /** True when a GRADIENT_* or IMAGE fill carries no style. */
  hasUnboundGradient?: boolean;
  /** True when the node has effects but no effect style and no bound effect. */
  hasUnboundEffect?: boolean;
  /** Node opacity when it is not 1 (hand-set or bound). */
  opacity?: number;
```

- [ ] **Step 4: Emit the new gaps**

In `extractGaps` in `packages/extractor/src/tokens.ts`, inside the `walkParts` callback after the existing `hasUnboundPaint` branch:

```ts
    if (n.hasUnboundStroke) {
      pushGap(part, 'hardcoded stroke colour (no variable or style)');
    }
    if (n.hasUnboundGradient) {
      pushGap(part, 'hardcoded gradient or image fill (no style)');
    }
    if (n.hasUnboundEffect) {
      pushGap(part, 'hardcoded shadow or blur (no effect style)');
    }
    if (n.opacity !== undefined && n.opacity !== 1 && !bound.has('opacity')) {
      pushGap(part, `hardcoded opacity (${n.opacity})`);
    }
```

- [ ] **Step 5: Run the extractor test**

```bash
npx vitest run packages/extractor/test/tokens.test.ts -t 'extractGaps coverage'
```

Expected: PASS.

- [ ] **Step 6: Write the failing serializer test**

Append to `packages/plugin/test/serialize.test.ts`:

```ts
describe('unbound paint detection', () => {
  const resolver = { variableName: async () => null, styleName: async () => null, mainComponent: async () => null };

  it('flags a hardcoded stroke and records its hex', async () => {
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME',
      strokes: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
    } as never, resolver);
    expect(n.hasUnboundStroke).toBe(true);
    expect(n.unboundStroke).toBe('#ff0000');
  });

  it('does not flag a stroke bound to a variable', async () => {
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME',
      strokes: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
      boundVariables: { strokes: [{ id: 'V:1' }] },
    } as never, { ...resolver, variableName: async () => 'border/default' });
    expect(n.hasUnboundStroke).toBeUndefined();
  });

  it('flags a gradient fill with no style', async () => {
    const n = await serializeNode({
      id: '1', name: 'Box', type: 'FRAME', fills: [{ type: 'GRADIENT_LINEAR' }],
    } as never, resolver);
    expect(n.hasUnboundGradient).toBe(true);
  });

  it('records a non-default opacity', async () => {
    const n = await serializeNode({ id: '1', name: 'Box', type: 'FRAME', opacity: 0.5 } as never, resolver);
    expect(n.opacity).toBe(0.5);
  });

  it('omits opacity when fully opaque', async () => {
    const n = await serializeNode({ id: '1', name: 'Box', type: 'FRAME', opacity: 1 } as never, resolver);
    expect(n.opacity).toBeUndefined();
  });
});
```

- [ ] **Step 7: Run to verify it fails**

```bash
npx vitest run packages/plugin/test/serialize.test.ts -t 'unbound paint detection'
```

Expected: FAIL.

- [ ] **Step 8: Extend the serializer**

In `packages/plugin/src/serialize.ts`, add to `RawNode`:

```ts
  strokes?: Array<{ type: string; color?: { r: number; g: number; b: number } }>;
  effects?: Array<{ type: string }>;
  opacity?: number;
```

Replace the `hasUnboundPaint` block with:

```ts
  // --- Unbound paints, effects and opacity ---
  const to2 = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
  const hex = (c: { r: number; g: number; b: number }) => `#${to2(c.r)}${to2(c.g)}${to2(c.b)}`;

  const fills = node.fills ?? [];
  const hasSolidFill = fills.some((f) => f.type === 'SOLID');
  const fillsBound = 'fills' in bv || Boolean(node.fillStyleId);
  const hasUnboundPaint = hasSolidFill && !fillsBound ? true : undefined;
  const solidFill = hasUnboundPaint ? fills.find((f) => f.type === 'SOLID' && f.color) : undefined;
  const unboundFill = solidFill?.color ? hex(solidFill.color) : undefined;

  // Gradients and images can't bind to a colour variable, only to a style, so a
  // style id is the only thing that makes them intentional.
  const hasGradient = fills.some((f) => f.type.startsWith('GRADIENT_') || f.type === 'IMAGE');
  const hasUnboundGradient = hasGradient && !node.fillStyleId ? true : undefined;

  const strokes = node.strokes ?? [];
  const hasSolidStroke = strokes.some((s) => s.type === 'SOLID');
  const strokesBound = 'strokes' in bv || Boolean(node.strokeStyleId);
  const hasUnboundStroke = hasSolidStroke && !strokesBound ? true : undefined;
  const solidStroke = hasUnboundStroke ? strokes.find((s) => s.type === 'SOLID' && s.color) : undefined;
  const unboundStroke = solidStroke?.color ? hex(solidStroke.color) : undefined;

  const hasEffects = (node.effects ?? []).length > 0;
  const effectsBound = 'effects' in bv || (typeof node.effectStyleId === 'string' && Boolean(node.effectStyleId));
  const hasUnboundEffect = hasEffects && !effectsBound ? true : undefined;

  const opacity = typeof node.opacity === 'number' && node.opacity !== 1 ? node.opacity : undefined;
```

and add to the `result` object literal, next to the existing spread entries:

```ts
    ...(hasUnboundStroke ? { hasUnboundStroke } : {}),
    ...(unboundStroke ? { unboundStroke } : {}),
    ...(hasUnboundGradient ? { hasUnboundGradient } : {}),
    ...(hasUnboundEffect ? { hasUnboundEffect } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
```

- [ ] **Step 9: Run everything**

```bash
npx vitest run && npm run check:ci
```

Expected: green.

- [ ] **Step 10: Commit**

```bash
git add packages/extractor/src packages/extractor/test packages/plugin/src/serialize.ts packages/plugin/test/serialize.test.ts
git commit -m "feat(extractor): report hardcoded strokes, gradients, effects and opacity as gaps"
```

---

# Phase 3 — Consistency

### Task 8: Complete the property name map

`SIMPLE_PROPERTY_MAP[prop] ?? prop` means any unmapped bound property leaks its raw Figma name, so a spec mixes `fill` and `border-radius` with `strokeWeight`, `effects` and `opacity`.

**Files:**
- Modify: `packages/extractor/src/tokens.ts`
- Test: `packages/extractor/test/tokens.test.ts`

**Interfaces:** no public API change.

- [ ] **Step 1: Write the failing test**

Append to `packages/extractor/test/tokens.test.ts`:

```ts
describe('property name normalization', () => {
  it('maps stroke, effect, opacity and size properties to CSS-like names', () => {
    const set: SerializedNode = {
      id: 'v0', name: 'Box', type: 'COMPONENT', visible: true,
      bindings: [
        { property: 'strokeWeight', token: 'border/width/thin' },
        { property: 'effects', token: 'shadow/sm' },
        { property: 'opacity', token: 'opacity/muted' },
        { property: 'width', token: 'size/track' },
        { property: 'height', token: 'size/thumb' },
      ],
    };
    const props = extractTokens(set).map((r) => r.property);
    expect(props).toEqual(['border-width', 'box-shadow', 'opacity', 'width', 'height']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run packages/extractor/test/tokens.test.ts -t 'property name normalization'
```

Expected: FAIL, receives `['strokeWeight', 'effects', ...]`.

- [ ] **Step 3: Extend the map**

In `packages/extractor/src/tokens.ts`, add to `SIMPLE_PROPERTY_MAP`:

```ts
  strokeWeight: 'border-width',
  strokeTopWeight: 'border-top-width',
  strokeRightWeight: 'border-right-width',
  strokeBottomWeight: 'border-bottom-width',
  strokeLeftWeight: 'border-left-width',
  effects: 'box-shadow',
  counterAxisSpacing: 'row-gap',
  maxWidth: 'max-width',
  minWidth: 'min-width',
  maxHeight: 'max-height',
  minHeight: 'min-height',
```

`opacity`, `width` and `height` already pass through unchanged and are correct CSS names, so they need no entry. Add a comment above the map:

```ts
/**
 * Figma binding property -> CSS-like name used in the spec. Anything absent
 * passes through unchanged, which is correct for names that are already CSS
 * (`opacity`, `width`, `height`) and wrong for anything else, so new Figma
 * binding targets belong here rather than leaking a camelCase name into docs.
 */
```

- [ ] **Step 4: Run everything**

```bash
npx vitest run && npm run check:ci
```

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/tokens.ts packages/extractor/test/tokens.test.ts
git commit -m "refactor(extractor): normalize stroke, effect and size property names"
```

---

### Task 9: Co-locate the two `#` cleaners

`cleanPartName` strips a trailing `#` from layer names; `props.ts`'s local `cleanName` splits on `#` to drop the `#nodeId:n` suffix Figma appends to component property names. They handle **different** artifacts and must not be merged, but they belong side by side with that difference documented.

**Files:**
- Modify: `packages/extractor/src/naming.ts`, `packages/extractor/src/props.ts`
- Test: `packages/extractor/test/naming.test.ts`

**Interfaces:**
- Produces: `cleanPropName(raw: string): string` in `naming.ts`.

- [ ] **Step 1: Write the failing test**

Append to `packages/extractor/test/naming.test.ts`:

```ts
import { cleanPropName } from '../src/naming';

describe('cleanPropName', () => {
  it('drops the #nodeId:n suffix Figma appends to property names', () => {
    expect(cleanPropName('Label#123:4')).toBe('Label');
  });
  it('leaves a plain variant prop alone', () => {
    expect(cleanPropName('Size')).toBe('Size');
  });
  it('differs from cleanPartName, which only strips a TRAILING hash', () => {
    expect(cleanPropName('icon#2')).toBe('icon');
    expect(cleanPartName('icon#2')).toBe('icon#2');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run packages/extractor/test/naming.test.ts
```

Expected: FAIL, `cleanPropName` is not exported.

- [ ] **Step 3: Move the helper**

Append to `packages/extractor/src/naming.ts`:

```ts
/**
 * Component PROPERTY names carry a "#nodeId:n" suffix ("Label#123:4"); take the
 * part before the first hash.
 *
 * Deliberately different from cleanPartName, which strips only a TRAILING hash
 * from LAYER names. They handle different Figma artifacts and merging them
 * would mangle a layer legitimately called "icon#2".
 */
export const cleanPropName = (raw: string) => raw.split('#')[0];
```

- [ ] **Step 4: Use it in `props.ts`**

Delete the local `cleanName` const and its comment, add the import, and rename the two call sites in `extractProps`:

```ts
import { cleanPropName } from './naming';
```

```ts
    name: cleanPropName(raw),
```

- [ ] **Step 5: Run everything**

```bash
npx vitest run && npm run check:ci
```

- [ ] **Step 6: Commit**

```bash
git add packages/extractor/src/naming.ts packages/extractor/src/props.ts packages/extractor/test/naming.test.ts
git commit -m "refactor(extractor): co-locate the layer-name and prop-name cleaners"
```

---

### Task 10: Consistent zero handling in `rawValues`

`extractRawValues` tests `itemSpacing !== undefined` and `cornerRadius !== undefined` but padding `> 0`, so it can emit `gap 0` and `border-radius 0` rows that say nothing.

**Files:**
- Modify: `packages/extractor/src/rawValues.ts`
- Test: `packages/extractor/test/rawValues.test.ts`

**Interfaces:** no public API change.

- [ ] **Step 1: Write the failing test**

Append to `packages/extractor/test/rawValues.test.ts`:

```ts
it('omits zero gap and zero radius rows', () => {
  const node: SerializedNode = {
    id: 'v0', name: 'Box', type: 'COMPONENT', visible: true,
    layout: { mode: 'HORIZONTAL', itemSpacing: 0, cornerRadius: 0 },
  };
  expect(extractRawValues(node)).toEqual([]);
});

it('still reports a non-zero gap', () => {
  const node: SerializedNode = {
    id: 'v0', name: 'Box', type: 'COMPONENT', visible: true,
    layout: { mode: 'HORIZONTAL', itemSpacing: 8 },
  };
  expect(extractRawValues(node)).toContainEqual({ part: 'Box', property: 'gap', value: '8' });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run packages/extractor/test/rawValues.test.ts -t 'omits zero'
```

Expected: FAIL, receives `gap 0` and `border-radius 0`.

- [ ] **Step 3: Align the guards**

In `packages/extractor/src/rawValues.ts`:

```ts
      // Zero is the default for both, so a zero row tells the reader nothing.
      // Matches the `> 0` guard the padding branch above already uses.
      if (l.itemSpacing !== undefined && l.itemSpacing > 0 && !bound.has('itemSpacing')) {
        push(part, 'gap', String(l.itemSpacing));
      }
      if (l.cornerRadius !== undefined && l.cornerRadius > 0
          && ![...RADIUS_BINDINGS].some((p) => bound.has(p))) {
        push(part, 'border-radius', String(l.cornerRadius));
      }
```

- [ ] **Step 4: Run everything**

```bash
npx vitest run && npm run check:ci
```

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/rawValues.ts packages/extractor/test/rawValues.test.ts
git commit -m "fix(extractor): omit zero-valued gap and radius raw rows"
```

---

### Task 11: Compute the axis model once per extract

`extract()` calls `variantAxisModel` via `extractVariantInstances`, then `extractTokens` computes the identical model again.

**Files:**
- Modify: `packages/extractor/src/extract.ts`, `packages/extractor/src/tokens.ts`
- Test: `packages/extractor/test/extract.test.ts`

**Interfaces:**
- Produces: `extractTokens(root: SerializedNode, model?: VariantAxisModel): TokenRule[]` — the second parameter is optional, so every existing caller is unaffected.

- [ ] **Step 1: Write the failing test**

Append to `packages/extractor/test/extract.test.ts`:

```ts
it('extractTokens accepts a precomputed axis model and agrees with computing its own', () => {
  const set: SerializedNode = {
    id: 'root', name: 'C', type: 'COMPONENT_SET', visible: true, key: 'k',
    propertyDefinitions: { Size: { type: 'VARIANT', variantOptions: ['S', 'M'] } },
    children: [
      { id: 'v0', name: 'Size=S', type: 'COMPONENT', visible: true, bindings: [{ property: 'fills', token: 'tok/a' }] },
      { id: 'v1', name: 'Size=M', type: 'COMPONENT', visible: true, bindings: [{ property: 'fills', token: 'tok/b' }] },
    ],
  };
  expect(extractTokens(set, variantAxisModel(set))).toEqual(extractTokens(set));
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run packages/extractor/test/extract.test.ts -t 'precomputed axis model'
```

Expected: FAIL (TypeScript rejects the second argument).

- [ ] **Step 3: Accept the optional model**

In `packages/extractor/src/tokens.ts`:

```ts
export function extractTokens(root: SerializedNode, model?: VariantAxisModel): TokenRule[] {
  const isInSet = root.type === 'COMPONENT_SET';
  // Shared with extractVariantInstances — see variantAxisModel. extract() passes
  // its own copy so the model is built once per component rather than twice.
  const { variants, combos } = model ?? variantAxisModel(root);
```

- [ ] **Step 4: Thread it through `extract`**

In `packages/extractor/src/extract.ts`, replace `extractVariantInstances` and the `extract` body:

```ts
function toVariantInstances(model: VariantAxisModel): VariantInstance[] {
  return model.variants.map((v, i) => ({ nodeId: v.id, name: v.name, values: model.combos[i] }));
}

export function extract(root: SerializedNode, meta: { figmaFile: string }): IntermediateSpec {
  const { parts, related, componentId } = extractAnatomy(root);
  const model = variantAxisModel(root);
  return {
    name: root.name,
    figmaKey: root.key ?? '',
    figmaFile: meta.figmaFile,
    figmaNode: root.id,
    anatomy: parts,
    anatomyComponentId: componentId,
    props: extractProps(root),
    variants: extractVariants(root),
    variantInstances: toVariantInstances(model),
    states: extractStates(root),
    tokens: extractTokens(root, model),
    related,
    gaps: extractGaps(root),
    layout: extractLayout(root),
    rawValues: extractRawValues(root),
  };
}
```

Update the import line to pull `variantAxisModel` and the `VariantAxisModel` type from `./tokens`.

- [ ] **Step 5: Run everything**

```bash
npx vitest run && npm run check:ci
```

- [ ] **Step 6: Commit**

```bash
git add packages/extractor/src/extract.ts packages/extractor/src/tokens.ts packages/extractor/test/extract.test.ts
git commit -m "perf(extractor): build the variant axis model once per extract"
```

---

# Phase 4 — WCAG AA contrast findings

**Scope decision:** for each TEXT part, walk up to the nearest ancestor with a resolvable fill and check that pair against WCAG AA (4.5:1 normal, 3:1 large, where large is >= 24px or >= 18.66px bold). Colours resolve through the collection's **default mode** in this version; per-mode checking is a follow-up. Disabled states are skipped, because WCAG exempts inactive controls and flagging them produces noise on every design system.

**Hash decision:** `contrast` is excluded from `specContentHash` and is **not** rendered into Markdown, matching the `rawValues` precedent exactly. Two reasons: the drift path (`driftSource` in `ui-vnext.ts`) calls `extract()` with no foundation, so a hashed `contrast` would read as permanent drift; and a foundation colour tweak would otherwise flip every component's hash at once.

### Task 12: WCAG math

**Files:**
- Create: `packages/extractor/src/contrast.ts`
- Create: `packages/extractor/test/contrast.test.ts`

**Interfaces:**
- Produces: `relativeLuminance(hex: string): number`, `contrastRatio(a: string, b: string): number`, `blend(fg: string, alpha: number, bg: string): string`, `requiredRatio(fontSize: number | undefined, fontWeight: number | undefined): 3 | 4.5` — all exported from `./contrast`.

- [ ] **Step 1: Write the failing test**

Create `packages/extractor/test/contrast.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { relativeLuminance, contrastRatio, blend, requiredRatio } from '../src/contrast';

const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(near(relativeLuminance('#000000'), 0)).toBe(true);
    expect(near(relativeLuminance('#ffffff'), 1)).toBe(true);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(near(contrastRatio('#000000', '#ffffff'), 21, 0.05)).toBe(true);
  });
  it('is 1:1 for a colour against itself', () => {
    expect(near(contrastRatio('#3366cc', '#3366cc'), 1)).toBe(true);
  });
  it('is symmetric', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(contrastRatio('#abcdef', '#123456'), 10);
  });
  it('matches a known reference pair', () => {
    // #767676 on #ffffff is the canonical "exactly AA" grey.
    expect(near(contrastRatio('#767676', '#ffffff'), 4.54, 0.02)).toBe(true);
  });
});

describe('blend', () => {
  it('returns the foreground at full alpha', () => {
    expect(blend('#ff0000', 1, '#ffffff')).toBe('#ff0000');
  });
  it('returns the background at zero alpha', () => {
    expect(blend('#ff0000', 0, '#ffffff')).toBe('#ffffff');
  });
  it('composites at half alpha', () => {
    expect(blend('#000000', 0.5, '#ffffff')).toBe('#808080');
  });
});

describe('requiredRatio', () => {
  it('is 3 for 24px and above', () => {
    expect(requiredRatio(24, 400)).toBe(3);
  });
  it('is 3 for 18.66px bold', () => {
    expect(requiredRatio(18.66, 700)).toBe(3);
  });
  it('is 4.5 for 18.66px regular', () => {
    expect(requiredRatio(18.66, 400)).toBe(4.5);
  });
  it('is 4.5 for small text and when the size is unknown', () => {
    expect(requiredRatio(14, 700)).toBe(4.5);
    expect(requiredRatio(undefined, undefined)).toBe(4.5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run packages/extractor/test/contrast.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Write the module**

Create `packages/extractor/src/contrast.ts`:

```ts
/**
 * WCAG 2.1 contrast maths. Pure and dependency-free so it runs identically in
 * the plugin sandbox and under vitest.
 */

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('')}`;

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.1 contrast ratio. Symmetric; always >= 1. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Composite `fg` at `alpha` over an opaque `bg`. WCAG is defined on the colour
 * a user actually sees, and semi-transparent text is common in disabled and
 * muted styles, so ignoring alpha would report ratios nobody experiences.
 */
export function blend(fg: string, alpha: number, bg: string): string {
  if (alpha >= 1) return fg;
  if (alpha <= 0) return bg;
  const [fr, fg_, fb] = rgb(fg);
  const [br, bg_, bb] = rgb(bg);
  return toHex(
    fr * alpha + br * (1 - alpha),
    fg_ * alpha + bg_ * (1 - alpha),
    fb * alpha + bb * (1 - alpha),
  );
}

/**
 * The AA threshold for this text. "Large" is >= 24px, or >= 18.66px at weight
 * 700 or above (WCAG 2.1 SC 1.4.3). An unknown size is treated as normal text,
 * which is the stricter and therefore safer assumption.
 */
export function requiredRatio(fontSize: number | undefined, fontWeight: number | undefined): 3 | 4.5 {
  if (fontSize === undefined) return 4.5;
  if (fontSize >= 24) return 3;
  if (fontSize >= 18.66 && (fontWeight ?? 400) >= 700) return 3;
  return 4.5;
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run packages/extractor/test/contrast.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/contrast.ts packages/extractor/test/contrast.test.ts
git commit -m "feat(extractor): add WCAG 2.1 contrast maths"
```

---

### Task 13: Serialize text metrics and fill alpha

Contrast needs each TEXT node's font size and weight to pick a threshold, and each paint's alpha to composite. Neither is serialized today.

**Files:**
- Modify: `packages/extractor/src/tree.ts`, `packages/plugin/src/serialize.ts`
- Test: `packages/plugin/test/serialize.test.ts`

**Interfaces:**
- Produces: `SerializedNode.text?: { fontSize?: number; fontWeight?: number }` and `SerializedNode.unboundFillAlpha?: number`.

- [ ] **Step 1: Write the failing test**

Append to `packages/plugin/test/serialize.test.ts`:

```ts
describe('text metrics and fill alpha', () => {
  const resolver = { variableName: async () => null, styleName: async () => null, mainComponent: async () => null };

  it('records font size and weight for a TEXT node', async () => {
    const n = await serializeNode({
      id: '1', name: 'label', type: 'TEXT',
      fontSize: 18.66, fontName: { family: 'Inter', style: 'Bold' },
    } as never, resolver);
    expect(n.text).toEqual({ fontSize: 18.66, fontWeight: 700 });
  });

  it('maps a regular style to weight 400', async () => {
    const n = await serializeNode({
      id: '1', name: 'label', type: 'TEXT',
      fontSize: 14, fontName: { family: 'Inter', style: 'Regular' },
    } as never, resolver);
    expect(n.text).toEqual({ fontSize: 14, fontWeight: 400 });
  });

  it('omits text metrics on a non-TEXT node', async () => {
    const n = await serializeNode({ id: '1', name: 'box', type: 'FRAME' } as never, resolver);
    expect(n.text).toBeUndefined();
  });

  it('records the alpha of a hardcoded fill', async () => {
    const n = await serializeNode({
      id: '1', name: 'box', type: 'FRAME',
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.38 }],
    } as never, resolver);
    expect(n.unboundFillAlpha).toBe(0.38);
  });

  it('omits alpha when the fill is fully opaque', async () => {
    const n = await serializeNode({
      id: '1', name: 'box', type: 'FRAME',
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
    } as never, resolver);
    expect(n.unboundFillAlpha).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run packages/plugin/test/serialize.test.ts -t 'text metrics and fill alpha'
```

Expected: FAIL.

- [ ] **Step 3: Extend `SerializedNode`**

In `packages/extractor/src/tree.ts`:

```ts
  /** TEXT nodes only: the metrics WCAG needs to pick a contrast threshold. */
  text?: { fontSize?: number; fontWeight?: number };
  /** Alpha of the hardcoded fill in `unboundFill`, when it is not 1. */
  unboundFillAlpha?: number;
```

- [ ] **Step 4: Extend the serializer**

In `packages/plugin/src/serialize.ts`, add to `RawNode`:

```ts
  fontSize?: number | symbol;
  fontName?: { family: string; style: string } | symbol;
```

and widen the `fills` / `strokes` entry type with `opacity?: number`.

Add the weight mapping and the extraction block, after the unbound-paint block:

```ts
/**
 * Figma exposes weight as a style NAME, not a number. Map the common ladder;
 * anything unrecognized falls back to 400, which yields the stricter AA
 * threshold and so cannot produce a false pass.
 */
const WEIGHTS: Record<string, number> = {
  thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300,
  regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600,
  bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900,
};

function fontWeightOf(style: string): number {
  const key = style.toLowerCase().replace(/\s|-|italic|oblique/g, '');
  return WEIGHTS[key] ?? 400;
}
```

```ts
  // --- Text metrics (TEXT nodes only) ---
  let text: { fontSize?: number; fontWeight?: number } | undefined;
  if (node.type === 'TEXT') {
    const size = typeof node.fontSize === 'number' ? node.fontSize : undefined;
    const name = node.fontName;
    const weight = name && typeof name === 'object' && 'style' in name
      ? fontWeightOf((name as { style: string }).style)
      : undefined;
    if (size !== undefined || weight !== undefined) {
      text = { ...(size !== undefined ? { fontSize: size } : {}), ...(weight !== undefined ? { fontWeight: weight } : {}) };
    }
  }
```

In the unbound-fill block from Task 7, capture the alpha alongside the hex:

```ts
  const unboundFillAlpha =
    solidFill && typeof solidFill.opacity === 'number' && solidFill.opacity !== 1
      ? solidFill.opacity
      : undefined;
```

Add both to the `result` literal:

```ts
    ...(text ? { text } : {}),
    ...(unboundFillAlpha !== undefined ? { unboundFillAlpha } : {}),
```

- [ ] **Step 5: Run everything**

```bash
npx vitest run && npm run check:ci
```

- [ ] **Step 6: Commit**

```bash
git add packages/extractor/src/tree.ts packages/plugin/src/serialize.ts packages/plugin/test/serialize.test.ts
git commit -m "feat(plugin): serialize text metrics and fill alpha for contrast checks"
```

---

### Task 14: Resolve token names to colours and emit findings

**Files:**
- Modify: `packages/extractor/src/contrast.ts`
- Test: `packages/extractor/test/contrast.test.ts`

**Interfaces:**
- Consumes: `FoundationSpec`, `FoundationValue` from `./foundation`; `IntermediateSpec` from `./extract`; `resolveTokensForVariant` from `./resolve`.
- Produces:

```ts
export interface ContrastFinding {
  part: string;          // the TEXT part
  variant: string;       // the variant instance name it was measured in
  foreground: string;    // resolved hex, alpha already composited
  background: string;    // resolved hex of the nearest painted ancestor
  backgroundPart: string;
  ratio: number;         // rounded to 2dp
  required: 3 | 4.5;
}

export function resolveTokenColor(foundation: FoundationSpec, token: string): { hex: string; alpha: number } | null;
export function checkContrast(spec: IntermediateSpec, foundation: FoundationSpec): ContrastFinding[];
```

- [ ] **Step 1: Write the failing test**

Append to `packages/extractor/test/contrast.test.ts`:

```ts
import { resolveTokenColor, checkContrast, type ContrastFinding } from '../src/contrast';
import type { FoundationSpec } from '../src/foundation';
import type { IntermediateSpec } from '../src/extract';

const foundation = (vars: Record<string, string>): FoundationSpec => ({
  fileKey: 'f', extractedAt: '', textStyles: [],
  collections: [{
    id: 'c1', name: 'Core', defaultModeId: 'm1', modes: [{ modeId: 'm1', name: 'Light' }],
    variables: Object.entries(vars).map(([name, hex]) => ({
      name, group: 'g', resolvedType: 'COLOR' as const, description: '', codeSyntax: {},
      valuesByMode: { m1: { kind: 'color' as const, hex, alpha: 1 } },
    })),
  }],
});

const baseSpec = (over: Partial<IntermediateSpec>): IntermediateSpec => ({
  name: 'Button', figmaKey: 'k', figmaFile: 'f', figmaNode: 'n',
  anatomy: [], anatomyComponentId: 'n', props: [], variants: [], variantInstances: [],
  states: [], tokens: [], related: [], gaps: [], layout: [], rawValues: [], contrast: [],
  ...over,
});

describe('resolveTokenColor', () => {
  it('resolves a colour variable in its collection default mode', () => {
    expect(resolveTokenColor(foundation({ 'text/muted': '#767676' }), 'text/muted'))
      .toEqual({ hex: '#767676', alpha: 1 });
  });
  it('returns null for an unknown token', () => {
    expect(resolveTokenColor(foundation({}), 'nope')).toBeNull();
  });
});

describe('checkContrast', () => {
  const spec = baseSpec({
    anatomy: [
      { id: 'c', name: 'Container', type: 'FRAME', nested: false, depth: 0 },
      { id: 'l', name: 'label', type: 'TEXT', nested: false, depth: 1 },
    ],
    variantInstances: [{ nodeId: 'v0', name: 'Style=Filled', values: { Style: 'Filled' } }],
    tokens: [
      { part: 'Container', property: 'fill', conditions: {}, token: 'surface/default' },
      { part: 'label', property: 'fill', conditions: {}, token: 'text/faint' },
    ],
  });

  it('flags text below AA against its nearest painted ancestor', () => {
    const f = foundation({ 'surface/default': '#ffffff', 'text/faint': '#bbbbbb' });
    const findings = checkContrast(spec, f);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      part: 'label', backgroundPart: 'Container',
      foreground: '#bbbbbb', background: '#ffffff', required: 4.5,
    });
    expect(findings[0].ratio).toBeLessThan(4.5);
  });

  it('reports nothing when the pair passes AA', () => {
    const f = foundation({ 'surface/default': '#ffffff', 'text/faint': '#595959' });
    expect(checkContrast(spec, f)).toEqual([]);
  });

  it('skips disabled variants, which WCAG exempts', () => {
    const disabled = baseSpec({
      ...spec,
      variantInstances: [{ nodeId: 'v0', name: 'State=Disabled', values: { State: 'Disabled' } }],
    });
    const f = foundation({ 'surface/default': '#ffffff', 'text/faint': '#bbbbbb' });
    expect(checkContrast(disabled, f)).toEqual([]);
  });

  it('reports nothing when the foundation cannot resolve a colour', () => {
    expect(checkContrast(spec, foundation({}))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run packages/extractor/test/contrast.test.ts
```

Expected: FAIL, `resolveTokenColor` and `checkContrast` are not exported. `contrast` on `IntermediateSpec` also does not exist yet; Task 15 adds it, so add the field now as part of this task's Step 3 to keep the test compiling.

- [ ] **Step 3: Add the `contrast` field**

In `packages/extractor/src/extract.ts`, add to `IntermediateSpec` and to the object `extract` returns (`contrast: []`, populated by the caller in Task 15):

```ts
  /** WCAG AA findings. Excluded from specContentHash and never rendered into
   *  Markdown, matching rawValues: the drift path calls extract() with no
   *  foundation, so a hashed value here would read as permanent drift. */
  contrast: ContrastFinding[];
```

Import the type from `./contrast`.

- [ ] **Step 4: Implement resolution and checking**

Append to `packages/extractor/src/contrast.ts`:

```ts
import type { FoundationSpec, FoundationValue } from './foundation';
import type { IntermediateSpec } from './extract';
import { resolveTokensForVariant } from './resolve';

export interface ContrastFinding {
  part: string;
  variant: string;
  foreground: string;
  background: string;
  backgroundPart: string;
  ratio: number;
  required: 3 | 4.5;
}

/** Follow an alias chain to the concrete colour it stands for. */
function concrete(v: FoundationValue): { hex: string; alpha: number } | null {
  if (v.kind === 'color') return { hex: v.hex, alpha: v.alpha };
  if (v.kind === 'alias' && v.resolved) return concrete(v.resolved);
  return null;
}

/**
 * Look a token name up in the foundation and return its colour in the owning
 * collection's DEFAULT mode. Per-mode checking (light against dark) is a
 * deliberate follow-up: text and background can live in different collections
 * with different mode sets, so pairing modes correctly needs its own design.
 */
export function resolveTokenColor(
  foundation: FoundationSpec,
  token: string,
): { hex: string; alpha: number } | null {
  for (const collection of foundation.collections) {
    for (const variable of collection.variables) {
      if (variable.name !== token) continue;
      const value = variable.valuesByMode[collection.defaultModeId];
      return value ? concrete(value) : null;
    }
  }
  return null;
}

/** WCAG exempts inactive controls, and every design system deliberately mutes
 *  disabled text, so checking those produces noise rather than findings. */
function isDisabled(values: Record<string, string>): boolean {
  return Object.values(values).some((v) => v.trim().toLowerCase() === 'disabled')
    || Object.entries(values).some(([k, v]) =>
      k.trim().toLowerCase() === 'disabled' && v.trim().toLowerCase() === 'true');
}

export function checkContrast(spec: IntermediateSpec, foundation: FoundationSpec): ContrastFinding[] {
  const findings: ContrastFinding[] = [];
  const seen = new Set<string>();

  // Anatomy is a depth-ordered depth-first list, so the nearest painted
  // ancestor of the part at index i is the closest earlier entry with a
  // strictly smaller depth that resolves to a colour.
  const textParts = spec.anatomy.filter((p) => p.type === 'TEXT');

  for (const instance of spec.variantInstances) {
    if (isDisabled(instance.values)) continue;
    const resolved = resolveTokensForVariant(spec.tokens, instance.values);
    const fillOf = (part: string) => resolved.find((r) => r.part === part && r.property === 'fill')?.token;

    for (const textPart of textParts) {
      const fgToken = fillOf(textPart.name);
      if (!fgToken) continue;
      const fg = resolveTokenColor(foundation, fgToken);
      if (!fg) continue;

      const index = spec.anatomy.indexOf(textPart);
      let bg: { hex: string; alpha: number } | null = null;
      let bgPart = '';
      for (let i = index - 1; i >= 0; i--) {
        const candidate = spec.anatomy[i];
        if (candidate.depth >= textPart.depth) continue;
        const token = fillOf(candidate.name);
        if (!token) continue;
        const colour = resolveTokenColor(foundation, token);
        if (colour) { bg = colour; bgPart = candidate.name; break; }
      }
      // The default variant's own root is named "Container" and is not in the
      // anatomy list, so fall back to it when no painted ancestor was found.
      if (!bg) {
        const token = fillOf('Container');
        const colour = token ? resolveTokenColor(foundation, token) : null;
        if (colour) { bg = colour; bgPart = 'Container'; }
      }
      if (!bg) continue;

      const background = blend(bg.hex, bg.alpha, '#ffffff');
      const foreground = blend(fg.hex, fg.alpha, background);
      const required = requiredRatio(undefined, undefined);
      const ratio = Math.round(contrastRatio(foreground, background) * 100) / 100;
      if (ratio >= required) continue;

      // One finding per (part, colour pair): the same failure repeated across
      // ten variants is one problem, not ten.
      const key = `${textPart.name}\0${foreground}\0${background}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        part: textPart.name, variant: instance.name,
        foreground, background, backgroundPart: bgPart, ratio, required,
      });
    }
  }
  return findings;
}
```

- [ ] **Step 5: Run the test**

```bash
npx vitest run packages/extractor/test/contrast.test.ts
```

Expected: PASS.

- [ ] **Step 6: Export and commit**

Add `export * from './contrast';` to `packages/extractor/src/index.ts`, then:

```bash
npx vitest run && npm run check:ci
git add packages/extractor/src packages/extractor/test/contrast.test.ts
git commit -m "feat(extractor): resolve token colours and emit WCAG AA contrast findings"
```

---

### Task 15: Wire contrast into extraction and surface it on canvas

`requiredRatio` is called with `undefined` in Task 14 because font metrics live on `SerializedNode`, not on `IntermediateSpec`. Thread them through, keep `contrast` out of the hash, and merge findings into the canvas gaps list.

**Files:**
- Modify: `packages/extractor/src/extract.ts`, `packages/extractor/src/contrast.ts`, `packages/extractor/src/hash.ts`
- Modify: `packages/plugin/src/main.ts`, `packages/plugin/src/messages.ts`, `packages/plugin/src/ui/actions.ts`
- Test: `packages/extractor/test/specHash.test.ts`, `packages/extractor/test/contrast.test.ts`

**Interfaces:**
- Produces: `AnatomyPart` gains `text?: { fontSize?: number; fontWeight?: number }`.
- Produces: `extract(root, meta: { figmaFile: string; foundation?: FoundationSpec }): IntermediateSpec` — `foundation` is optional, so the drift path in `ui-vnext.ts` needs no change.

- [ ] **Step 1: Write the failing tests**

Append to `packages/extractor/test/specHash.test.ts`:

Add this case inside the existing `describe('specContentHash', ...)` block, reusing the `NODE` fixture already declared at the top of the file:

```ts
  it('ignores contrast findings, which depend on the foundation not the component', () => {
    const spec = extract(NODE, { figmaFile: 'FILEKEY' });
    const withFindings = {
      ...spec,
      contrast: [{
        part: 'Label', variant: 'Style=Filled', foreground: '#bbbbbb', background: '#ffffff',
        backgroundPart: 'Container', ratio: 1.9, required: 4.5 as const,
      }],
    };
    expect(specContentHash(withFindings as typeof spec)).toBe(specContentHash(spec));
  });
```

Append to `packages/extractor/test/contrast.test.ts`:

```ts
it('uses the large-text threshold when the part carries bold 24px metrics', () => {
  const spec = baseSpec({
    anatomy: [
      { id: 'c', name: 'Container', type: 'FRAME', nested: false, depth: 0 },
      { id: 'l', name: 'label', type: 'TEXT', nested: false, depth: 1, text: { fontSize: 24, fontWeight: 700 } },
    ],
    variantInstances: [{ nodeId: 'v0', name: 'Style=Filled', values: { Style: 'Filled' } }],
    tokens: [
      { part: 'Container', property: 'fill', conditions: {}, token: 'surface/default' },
      { part: 'label', property: 'fill', conditions: {}, token: 'text/faint' },
    ],
  });
  // 3.5:1 fails AA for normal text but passes for large text.
  const f = foundation({ 'surface/default': '#ffffff', 'text/faint': '#949494' });
  expect(checkContrast(spec, f)).toEqual([]);
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run packages/extractor/test/specHash.test.ts packages/extractor/test/contrast.test.ts
```

Expected: the hash test FAILS (contrast is hashed); the large-text test FAILS (a finding is emitted).

- [ ] **Step 3: Carry text metrics onto anatomy parts**

In `packages/extractor/src/anatomy.ts`, add to `AnatomyPart`:

```ts
  /** TEXT parts only: metrics the contrast check needs to pick a threshold. */
  text?: { fontSize?: number; fontWeight?: number };
```

and in `addParts`, add to the pushed object:

```ts
        ...(child.text ? { text: child.text } : {}),
```

- [ ] **Step 4: Use the real threshold**

In `checkContrast` in `packages/extractor/src/contrast.ts`, replace the `required` line:

```ts
      const required = requiredRatio(textPart.text?.fontSize, textPart.text?.fontWeight);
```

- [ ] **Step 5: Exclude contrast from the hash**

In `packages/extractor/src/hash.ts`, extend the destructure and update the comment:

```ts
/**
 * The drift baseline hash. Computed over a projection that excludes rawValues
 * and contrast (both presentation-only) and reduces anatomy to the legacy
 * depth-0 {id,name,type,nested} shape, so canvas-only additions never flip the
 * hash for existing committed specs.
 *
 * contrast is excluded for a second, load-bearing reason: the library drift
 * check calls extract() with no foundation, so contrast is always [] on that
 * path. Hashing it would make every doc read as permanently drifted.
 */
export function specContentHash(spec: IntermediateSpec): string {
  const { rawValues: _rawValues, contrast: _contrast, ...rest } = spec;
```

Note the anatomy projection already reduces to `{id,name,type,nested}`, so the new `text` field is dropped from the hash automatically.

- [ ] **Step 6: Accept a foundation in `extract`**

In `packages/extractor/src/extract.ts`:

```ts
export function extract(
  root: SerializedNode,
  meta: { figmaFile: string; foundation?: FoundationSpec },
): IntermediateSpec {
  const { parts, related, componentId } = extractAnatomy(root);
  const model = variantAxisModel(root);
  const spec: IntermediateSpec = {
    name: root.name,
    figmaKey: root.key ?? '',
    figmaFile: meta.figmaFile,
    figmaNode: root.id,
    anatomy: parts,
    anatomyComponentId: componentId,
    props: extractProps(root),
    variants: extractVariants(root),
    variantInstances: toVariantInstances(model),
    states: extractStates(root),
    tokens: extractTokens(root, model),
    related,
    gaps: extractGaps(root),
    layout: extractLayout(root),
    rawValues: extractRawValues(root),
    contrast: [],
  };
  // Contrast needs resolved colour values, which only the foundation carries.
  // Callers without one (the library drift check) get an empty list, which is
  // safe because contrast sits outside specContentHash.
  return meta.foundation ? { ...spec, contrast: checkContrast(spec, meta.foundation) } : spec;
}
```

- [ ] **Step 7: Run the extractor suite**

```bash
npx vitest run packages/extractor
```

Expected: both new tests PASS, everything else green.

- [ ] **Step 8: Send the foundation with the selection**

In `packages/plugin/src/main.ts`, memoize the foundation dump per file for the plugin session and include it in the `selection` message. Building it on every selection would be wasteful; it changes far less often than selection does.

```ts
/** Cached for the session: variables and styles change far less often than
 *  selection, and rebuilding the dump on every click is wasteful. The
 *  Foundations tab's own refresh path clears it. */
let foundationCache: { fileKey: string; dump: SerializedFoundation } | null = null;

async function foundationFor(fileKey: string): Promise<SerializedFoundation> {
  if (foundationCache?.fileKey === fileKey) return foundationCache.dump;
  const dump = await serializeFoundation(foundationReader, fileKey, new Date().toISOString());
  foundationCache = { fileKey, dump };
  return dump;
}
```

Add `foundation` to the `selection` message in `packages/plugin/src/messages.ts`:

```ts
  | { type: 'selection'; node: SerializedNode | null; fileKey: string;
      fileKeySource: FileKeySource; foundation?: SerializedFoundation }
```

and populate it in the selection handler around line 189, leaving it absent if the dump throws so a foundation failure never blocks selection.

- [ ] **Step 9: Pass it into `extract`**

In `packages/plugin/src/ui/actions.ts:120`, and at lines 601 and 668, pass the built foundation through:

```ts
  const spec = extract(node, {
    figmaFile: fileKey,
    ...(foundationSpec ? { foundation: foundationSpec } : {}),
  });
```

`foundationSpec` is the module-level `FoundationSpec | null` already declared at `actions.ts:720`; set it from the `selection` message's `foundation` via the existing `buildFoundation` call so both entry points share one instance.

- [ ] **Step 10: Merge findings into the canvas gaps list**

In `packages/plugin/src/docFrame.ts`, where the gaps section is built, append contrast findings as gap rows. Copy uses plain peer tone and no em dashes:

```ts
  const contrastRows = spec.contrast.map((c) => ({
    part: c.part,
    issue: `contrast ${c.ratio}:1 against ${c.backgroundPart}, below AA ${c.required}:1`,
  }));
```

Render `[...spec.gaps, ...contrastRows]` in place of `spec.gaps`. Do **not** touch `render.ts`: Markdown stays hash-covered, and contrast is not in the hash.

- [ ] **Step 11: Run everything**

```bash
npx vitest run && npm run check:ci
```

- [ ] **Step 12: Manual verification in Figma**

Open a real library file, select a component set with a muted text style, and confirm: the doc frame's gaps section lists a contrast row with a plausible ratio, the Library tab does not mark every doc as drifted, and a pre-0.2 doc reads "Rebuild needed". Record the result in `docs/manual-tests/` following the existing file convention.

- [ ] **Step 13: Commit**

```bash
git add packages/extractor/src packages/extractor/test packages/plugin/src docs/manual-tests
git commit -m "feat: surface WCAG AA contrast findings on the component doc frame"
```

---

## Self-Review

**Spec coverage.** Phase 1 → Tasks 1-4 (minimizer fabrication, conflict backstop, default variant, version bump). Phase 2 → Tasks 5-7 (sibling names, state unification, gap coverage). Phase 3 → Tasks 8-11 (property map, name cleaners, zero handling, axis-model reuse). Phase 4 contrast → Tasks 12-15. Every finding from the review has a task.

**Known deferrals, deliberate and stated:** per-mode contrast (light against dark) is out of scope in Task 14 and documented in the code comment; non-text contrast (WCAG 1.4.11) was declined during scoping; the O(n²) subsumption filter noted in the review is left alone because no measured component set makes it hot, and Task 1's backfill grows each grid to the full combo count, which is worth re-measuring on a large set before optimizing.

**Ordering constraint:** Task 3 must land before Task 5 (Task 5's `walkParts` lives in the `naming.ts` that Task 3 creates). Task 7 must land before Task 13 (Task 13 extends the unbound-fill block Task 7 rewrites). Task 12 must land before Task 14. Otherwise phases are independent.

**Risk to watch:** Task 5 changes part names for any component with duplicate layer names, and Task 6 changes `states` for any component whose state axis is not named `State`. Both move `specContentHash`. Both are covered by the single 0.2 bump in Task 4, which is why Task 4 sits at the end of Phase 1 rather than the start of Phase 2.
