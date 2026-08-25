# Brief Resolution Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the YAML brief stop emitting values it cannot back and stop leaving gaps unexplained: bindings carry Figma's own identity (id, kind, `remote`) end to end, effect styles and effect layers become real extracted data, and every remaining `{}` becomes a stated status.

**Architecture:** Two phases. **Phase A** widens the reference model — the plugin's `NodeResolver` returns identity instead of a bare name, `TokenRef`/`TokenRule` carry that identity, and it survives minimization — while changing **no output at all**, guarded by pinned content hashes and a byte-for-byte golden brief. **Phase B** spends that identity: a nine-shape `EffectLayer` union, effect styles in the foundation, inline node effects, a `resolution` block with six statuses each decided by a stated fact, and the remaining honesty fixes (alias collection name, alpha rounding, omitted empty containers, a `scope` block). `BRIEF_VERSION` goes 3 → 4 at the end of Phase B.

**Tech Stack:** TypeScript 5.6 (ESM, `strict`), Vitest 4, esbuild, `@figma/plugin-typings` 1.100, npm workspaces (`packages/extractor`, `packages/plugin`, `packages/proxy`).

## Global Constraints

- **The extractor must contain no Figma globals.** `packages/plugin/src/serialize.ts` and `serializeFoundation.ts` convert live Figma data into plain inputs; everything in `packages/extractor` is synchronous, pure and fixture-testable.
- **`specContentHash` must not move.** `BUTTON_HASH = adcffcb7d2eec911d960bb883794cf1e387d8b8d729064670b708abce8490516`. Every component doc on a user's canvas stores a baseline computed this way. No task in this plan re-cuts it.
- **`foundationContentHash` must not move.** `unitContent` builds explicit row objects, so new `FoundationSpec` fields are excluded structurally, not by discipline. Never add a field to `FoundationUnitContent` in this plan.
- **The plugin voice: never em dashes or en dashes in user-facing or payload-facing copy.** Plain, honest peer tone. Rules in `docs/plugin-voice-and-copy.md`. This applies to every `reason` string added in Task 9.
- **No raw NUL (0x00) bytes in tracked source.** `npm run check:nul` enforces it. Task 4 extends that check to the `\0` escape and to raw C0 control bytes.
- **Coverage floor is a ratchet:** statements 72, branches 77, functions 88, lines 71. It only moves up. New code needs tests or `npm run check:ci` fails.
- **Verify with `npm run check`** (lint, typecheck, check:nul, test, build:plugin, check:sandbox). Never verify CI through a pipe that masks the exit code.
- **`EXTRACTOR_VERSION` stays `'1'`.** Nothing in this plan changes what `extract()` produces for an unchanged `SerializedNode` in a way that requires every committed doc to rebuild. Only `BRIEF_VERSION` moves, and only in Task 11.

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `packages/extractor/src/effects.ts` | The `EffectLayer` union (nine shapes plus `unknown`), the pure `effectLayerOf` converter from a raw Figma-shaped effect, and `extractNodeEffects`. Its own file because `brief.ts` (680 lines) and `tokens.ts` (649 lines) are already at the limit of what stays readable. |
| `packages/extractor/src/resolution.ts` | The six-status vocabulary and `resolutionOf`, which decides a status from Phase A's identity plus the foundation's own recorded state. Separate from `brief.ts` so the status rules can be unit-tested without building a brief. |
| `packages/extractor/test/effects.test.ts` | Round-trip coverage for every effect shape. |
| `packages/extractor/test/resolution.test.ts` | One test per status, plus the unreachability proofs. |

**Modified (each keeps its current responsibility):**

- `packages/extractor/src/tree.ts` — `RefIdentity`, `RefKind`, widened `TokenRef`, `SerializedNode.effects`.
- `packages/extractor/src/tokens.ts` — `TokenRule` identity, ref-keyed minimization, control-character purge.
- `packages/extractor/src/foundation.ts` — effect styles, `narrowedTo`, `unavailable`, alias collection.
- `packages/extractor/src/brief.ts` — `used` as a list, `resolution`, the `effects:` block, alpha rounding, `source`/`scope`.
- `packages/extractor/src/hash.ts` — the `token`→`name` projection fix, `nodeEffects` exclusion.
- `packages/extractor/src/extract.ts` — `nodeEffects` on `IntermediateSpec`.
- `packages/extractor/src/{validate,pivot,resolve,rawValues}.ts`, `src/prose/prompt.ts` — rename consumers.
- `packages/plugin/src/serialize.ts` — widened `NodeResolver`, full refs, effect layers.
- `packages/plugin/src/serializeFoundation.ts` — effect styles, `unavailable`.
- `packages/plugin/src/main.ts` — the real resolver and reader.
- `packages/plugin/src/ui/{docModel,docFrame}.ts` — rename consumers.
- `scripts/check-nul-bytes.mjs` — widened scan.

**Deliberately deferred** (state them, do not build them):

- Paint style extraction. Paint styles get `kind: 'paint-style'` and `status: 'not-extracted'`; building the table is a separate change.
- Per-field variable bindings on effect STYLE layers. B3 scopes per-field bindings to node-level inline effects; a style layer emits its literal values with no `bindings` key. `ReaderVariable` would need a `remote` field and every fake reader would need updating for a case the spec's own B2 example does not show.
- Resolving foundation lookups by id rather than by name. All six statuses are decided from ref identity, never from the name lookup, so the lookup is only used to fetch a value and a name collision there is pre-existing behaviour.
- `effects` → `box-shadow` property mapping in `SIMPLE_PROPERTY_MAP`. Capturing the effect type finally makes the `tokens.ts:100` decision possible, but that is a property-naming change.
- Effect swatches on canvas. Putting effects in a rendered frame means putting them in `foundationContentHash`.

---

## Task 0: Land the committed baseline

The working tree holds finished, uncommitted work implementing `BRIEF_VERSION` 3 (the foundation `contrast` block removal). This plan's version bump goes 3 → 4, and every Phase A guard compares against a baseline, so that work must be committed on its own before anything here starts.

**Files:**
- Commit: `packages/extractor/src/brief.ts`, `packages/extractor/test/brief.test.ts`, `packages/extractor/test/fixtures/button-brief.yaml`, `packages/plugin/src/ui/actions.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a clean working tree with `BRIEF_VERSION === 3`, so `git diff` from here on shows only this plan's changes.

- [ ] **Step 1: Confirm the tree is green before committing**

```bash
npm run check
```

Expected: PASS. 78 test files, 1433 tests.

- [ ] **Step 2: Confirm the diff is only the contrast removal**

```bash
git status --porcelain
```

Expected: exactly four modified files — `packages/extractor/src/brief.ts`, `packages/extractor/test/brief.test.ts`, `packages/extractor/test/fixtures/button-brief.yaml`, `packages/plugin/src/ui/actions.ts` — and the untracked spec `docs/superpowers/specs/2026-08-25-brief-resolution-fidelity-design.md`. If anything else appears, stop and ask.

- [ ] **Step 3: Commit**

```bash
git add packages/extractor/src/brief.ts packages/extractor/test/brief.test.ts packages/extractor/test/fixtures/button-brief.yaml packages/plugin/src/ui/actions.ts && git commit -m "$(cat <<'EOF'
feat(brief): drop the contrast block from the foundation brief

A WCAG check is measured over every colour pair, so its failure list grows
with the file and crowds out the token vocabulary the brief exists to carry.
Contrast is a thing to look at, so it stays on the foundation frame, which
still draws its matrices when includeContrast is on.

BRIEF_VERSION 2 to 3.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Commit the design spec**

```bash
git add docs/superpowers/specs/2026-08-25-brief-resolution-fidelity-design.md docs/superpowers/plans/2026-08-25-brief-resolution-fidelity.md && git commit -m "$(cat <<'EOF'
docs: add the brief resolution fidelity spec and plan

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

# Phase A — reference identity

No output changes. Every task here is covered by a test asserting byte-identical briefs and hashes.

## Task 1: Phase A regression guards

Written first and expected to stay green through the whole of Phase A. These are the only thing standing between a pure identity refactor and every committed document on every user's canvas reporting "update available".

**Files:**
- Modify: `packages/extractor/test/specHash.test.ts` (append)
- Modify: `packages/extractor/test/foundationHash.test.ts` (append)
- Modify: `packages/extractor/test/briefGolden.test.ts` (append)

**Interfaces:**
- Consumes: `specContentHash`, `foundationContentHash`, `extract`, `componentBrief` (all existing).
- Produces: `CHIP_HASH` as a second pinned component baseline, and a `FoundationSpec`-widening guard, both referenced by later tasks' verification steps.

- [ ] **Step 1: Write the second pinned component baseline**

`button.json` has 3 variants and 9 bindings; `chip.json` exercises a `fontSize` binding and a `States` enum axis, so the two together cover both minimization paths. Append to `packages/extractor/test/specHash.test.ts`:

```ts
/** Cut on 2026-08-25 before Phase A of the brief-resolution-fidelity plan, from
 *  the tree as it stood at BRIEF_VERSION 3. Its whole job is to fail loudly if
 *  the `token` to `name` rename, the ref-keyed minimization, or the composite-key
 *  change moves the drift baseline. Same rule as BUTTON_HASH above: only a task
 *  that says it re-cuts the baseline may change it, and no task in this plan does. */
const CHIP_HASH = 'f2f7e6432f44b8405f31a9094a7494bdf89f68483a52dedd222a0d48e006d12b';

it('is unchanged across the whole of Phase A, on both fixtures', () => {
  for (const [file, expected] of [
    ['packages/extractor/test/fixtures/button.json', BUTTON_HASH],
    ['packages/extractor/test/fixtures/chip.json', CHIP_HASH],
  ] as const) {
    const node = JSON.parse(readFileSync(file, 'utf8'));
    expect(specContentHash(extract(node, { figmaFile: 'FILE1' }))).toBe(expected);
  }
});
```

- [ ] **Step 2: Run it to confirm it passes on the unchanged tree**

Run: `npx vitest run packages/extractor/test/specHash.test.ts`
Expected: PASS. A guard that fails before the change it guards is testing the wrong thing.

- [ ] **Step 3: Write the foundation-widening guard**

`FoundationSpec` gains `effectStyles`, `narrowedTo` and `unavailable` in Tasks 5 and 7. `unitContent` builds explicit row objects, so none of them can leak into `foundationContentHash` — but that is exactly the kind of structural invariant that is true until someone spreads a field. Append to `packages/extractor/test/foundationHash.test.ts`:

```ts
it('is unchanged by FoundationSpec fields that reach no rendered row', () => {
  const spec = buildFoundation(dump());
  const before = foundationContentHash(spec, SEMANTIC);

  // Cast, not a typed literal: this test has to keep working while the fields
  // below are still being added, and it must fail if unitContent ever starts
  // spreading the spec instead of naming the rows it renders.
  const widened = {
    ...spec,
    effectStyles: [{ id: 'S:1', name: 'Focused/Primary', description: '', group: 'Focused', effects: [] }],
    narrowedTo: { target: 'collection', collectionId: 'c1' },
    unavailable: ['effectStyles'],
  } as unknown as typeof spec;

  expect(foundationContentHash(widened, SEMANTIC)).toBe(before);
});
```

- [ ] **Step 4: Write the golden-brief guard for the second fixture**

`briefGolden.test.ts` already diffs `button-brief.yaml` byte for byte. That covers the rendered document. What it does not cover is that the SHAPE of `tokens.used` and `tokens.bindings` survives the rename, on a fixture with a non-colour binding. Append to `packages/extractor/test/briefGolden.test.ts`:

```ts
import chip from './fixtures/chip.json';

describe('phase A output stability', () => {
  // Frozen here rather than in a golden file because the point is not the whole
  // document (button-brief.yaml already covers that) but that these exact token
  // names still reach these exact keys after `TokenRef.token` becomes
  // `TokenRef.name` and minimization starts keying on (kind, id).
  it('emits the same token names and binding rows for chip.json', () => {
    const brief = componentBrief(extract(chip as SerializedNode, { figmaFile: 'FILE1' }),
      { generatedAt: AT }) as unknown as {
        tokens: {
          used: Record<string, unknown> | Array<{ token: string }>;
          bindings: Array<{ path: string; property: string; token: string }>;
        };
      };
    const used = Array.isArray(brief.tokens.used)
      ? brief.tokens.used.map((u) => u.token)
      : Object.keys(brief.tokens.used);
    expect(used.sort()).toEqual(['Text Color/Body/Primary', 'font-size/fs-100']);
    // The literal rows, frozen. chip.json binds one text colour on three nodes
    // and one font size on one, and every one of those has to survive the
    // rename and the ref-keyed minimization landing on the same path and
    // property it does today. `icon` and `icon (2)` are sibling-disambiguated
    // names, which is exactly the pair a name-keyed grouping used to merge.
    expect(brief.tokens.bindings.map((b) => `${b.path} ${b.property} ${b.token}`).sort())
      .toEqual([
        'Container/Contents/Label fill Text Color/Body/Primary',
        'Container/Contents/Label font-size font-size/fs-100',
        'Container/Contents/icon (2) fill Text Color/Body/Primary',
        'Container/Contents/icon fill Text Color/Body/Primary',
      ]);
  });
});
```

Note the `Array.isArray` branch: `used` becomes a list in Task 9, and this guard has to survive that without being rewritten mid-plan.

- [ ] **Step 5: Run the full suite to confirm all three guards pass green**

Run: `npm test`
Expected: PASS, 78 files, now 1436 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/extractor/test/specHash.test.ts packages/extractor/test/foundationHash.test.ts packages/extractor/test/briefGolden.test.ts && git commit -m "$(cat <<'EOF'
test: pin the baselines Phase A must not move

A second component hash on chip.json, a guard that FoundationSpec fields
reaching no rendered row stay out of the foundation hash, and a shape guard on
the chip brief's tokens block. All three are expected to stay green through
every Phase A change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: The resolver returns identity, not a name (A1)

**Files:**
- Modify: `packages/plugin/src/serialize.ts:17-22` (the `NodeResolver` interface), `:81-111` (the resolve loops)
- Modify: `packages/plugin/src/main.ts:38-56` (the real resolver)
- Test: `packages/plugin/test/serialize.test.ts`, `packages/plugin/test/integration.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface ResolvedVariable { id: string; name: string; remote: boolean; collectionId: string }`
  - `interface ResolvedStyle { id: string; name: string; remote: boolean; kind: 'paint-style' | 'text-style' | 'effect-style' | 'grid-style' }`
  - `NodeResolver.variable(id: string): Promise<ResolvedVariable | null>` replacing `variableName`
  - `NodeResolver.style(id: string): Promise<ResolvedStyle | null>` replacing `styleName`
  - `NodeResolver.mainComponent` is unchanged.

`SerializedNode.bindings` still emits `{ property, token }` at the end of this task. Widening `TokenRef` is Task 3's job, so this task is provably output-identical on its own.

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugin/test/serialize.test.ts`:

```ts
describe('NodeResolver identity', () => {
  it('carries remote from Figma rather than inferring it from a lookup', async () => {
    const r = {
      variable: async (id: string) => ({
        id, name: 'color/brand', remote: true, collectionId: 'VariableCollectionId:9',
      }),
      style: async () => null,
      mainComponent: async () => null,
    };
    const out = await serializeNode(
      { id: '1', name: 'N', type: 'FRAME', boundVariables: { fills: { id: 'VariableID:7' } } } as never,
      r,
    );
    // The name still reaches `token` here: TokenRef does not widen until the
    // next task, so this task is output-identical by construction.
    expect(out.bindings).toEqual([{ property: 'fills', token: 'color/brand' }]);
  });

  it('asks the style for its own kind instead of guessing from the property', async () => {
    const seen: string[] = [];
    const r = {
      variable: async () => null,
      style: async (id: string) => {
        seen.push(id);
        return { id, name: 'Focused/Primary', remote: false, kind: 'effect-style' as const };
      },
      mainComponent: async () => null,
    };
    const out = await serializeNode(
      { id: '1', name: 'N', type: 'FRAME', effectStyleId: 'S:effect,1:1' } as never, r,
    );
    expect(seen).toEqual(['S:effect,1:1']);
    expect(out.bindings).toEqual([{ property: 'effects', token: 'Focused/Primary' }]);
  });

  it('drops a binding whose resolver returns null, exactly as before', async () => {
    const r = { variable: async () => null, style: async () => null, mainComponent: async () => null };
    const out = await serializeNode(
      { id: '1', name: 'N', type: 'FRAME', fillStyleId: 'S:paint,1:1' } as never, r,
    );
    expect('bindings' in out).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/plugin/test/serialize.test.ts`
Expected: FAIL — the fakes supply `variable`/`style`, the implementation calls `variableName`/`styleName`, so every binding comes out missing.

- [ ] **Step 3: Widen the interface in `serialize.ts`**

Replace lines 17-22:

```ts
/** What Figma says about a variable a node binds. Ids and `remote` come from the
 *  API (`Variable.remote`), never from a failed lookup somewhere downstream. */
export interface ResolvedVariable {
  id: string;
  name: string;
  remote: boolean;
  collectionId: string;
}

/**
 * What Figma says about a style a node binds.
 *
 * `kind` maps from `BaseStyle.type`, which is a closed four-value union
 * (`PAINT | TEXT | EFFECT | GRID`). Asking the style is the point: the property
 * a style id was read from is a strong hint and not an answer, and an `effects`
 * binding in particular is the one the property map at tokens.ts:100 records as
 * unresolvable without it.
 */
export interface ResolvedStyle {
  id: string;
  name: string;
  remote: boolean;
  kind: 'paint-style' | 'text-style' | 'effect-style' | 'grid-style';
}

/** Injected resolver — keeps serialize.ts free of Figma globals so it runs under vitest. */
export interface NodeResolver {
  variable(id: string): Promise<ResolvedVariable | null>;
  style(id: string): Promise<ResolvedStyle | null>;
  mainComponent(node: unknown): Promise<{ name: string; key: string } | null>;
}
```

- [ ] **Step 4: Route the four resolve sites through it**

Replace `serialize.ts:81-111`:

```ts
  // --- Resolve boundVariables ---
  const bv = node.boundVariables ?? {};
  for (const [property, value] of Object.entries(bv)) {
    // Resolve ALL entries of array-valued variables.
    const entries: RawBoundVar[] = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (!entry?.id) continue;
      const v = await resolver.variable(entry.id);
      if (v && !bindings.some((b) => b.property === property && b.token === v.name)) {
        bindings.push({ property, token: v.name });
      }
    }
  }

  // --- Resolve style ids ---
  // The property each id was read from decides the BINDING property; the style
  // itself decides what kind of thing it is. Those are two different questions
  // and this task stops answering the second by guessing at the first.
  const styleBinding = async (id: string, property: string): Promise<void> => {
    const s = await resolver.style(id);
    if (s) bindings.push({ property, token: s.name });
  };
  if (node.fillStyleId) await styleBinding(node.fillStyleId, 'fills');
  if (node.strokeStyleId) await styleBinding(node.strokeStyleId, 'strokes');
  if (typeof node.textStyleId === 'string' && node.textStyleId) {
    await styleBinding(node.textStyleId, 'typography');
  }
  if (typeof node.effectStyleId === 'string' && node.effectStyleId) {
    await styleBinding(node.effectStyleId, 'effects');
  }
```

- [ ] **Step 5: Implement the real resolver in `main.ts`**

Replace `main.ts:38-56` (the `variableName` and `styleName` members), keeping `mainComponent` exactly as it is:

```ts
/** BaseStyle.type is a closed union; an unrecognized value cannot occur today
 *  and is dropped rather than guessed at, the same way a null style already is. */
const STYLE_KINDS: Record<string, ResolvedStyle['kind']> = {
  PAINT: 'paint-style', TEXT: 'text-style', EFFECT: 'effect-style', GRID: 'grid-style',
};

const resolver: NodeResolver = {
  async variable(id) {
    try {
      const v = await figma.variables.getVariableByIdAsync(id);
      if (!v) return null;
      // Variable.remote is Figma's own answer about whether this came from a
      // library. Carrying it is what lets the brief say `external` as a fact
      // instead of inferring it from a lookup that found nothing.
      return { id: v.id, name: v.name, remote: v.remote, collectionId: v.variableCollectionId };
    } catch {
      return null;
    }
  },
  async style(id) {
    try {
      const s = await figma.getStyleByIdAsync(id);
      if (!s) return null;
      const kind = STYLE_KINDS[s.type];
      // PublishableMixin.remote, inherited by every style.
      return kind ? { id: s.id, name: s.name, remote: s.remote, kind } : null;
    } catch {
      return null;
    }
  },
  async mainComponent(node) { /* unchanged */ },
};
```

Update the import on `main.ts:3`:

```ts
import type { NodeResolver, ResolvedStyle } from './serialize';
```

- [ ] **Step 6: Update the existing fakes**

`packages/plugin/test/serialize.test.ts` and `packages/plugin/test/integration.test.ts` build fake resolvers with `variableName`/`styleName`. Rewrite each to the new shape. The mechanical transform is:

```ts
// before
variableName: async (id: string) => (MAP[id] ?? null),
styleName: async (_id: string) => null,

// after
variable: async (id: string) =>
  MAP[id] ? { id, name: MAP[id], remote: false, collectionId: 'VariableCollectionId:1' } : null,
style: async (_id: string) => null,
```

and for a fake that returned a style name:

```ts
// before
styleName: async () => 'md.sys.elevation.level1',
// after
style: async (id: string) => ({ id, name: 'md.sys.elevation.level1', remote: false, kind: 'effect-style' as const }),
```

Pick the `kind` that matches what the test is exercising: `'paint-style'` for a `fillStyleId`/`strokeStyleId` test, `'text-style'` for `textStyleId`, `'effect-style'` for `effectStyleId`.

- [ ] **Step 7: Run the full suite**

Run: `npm run check`
Expected: PASS. In particular `specHash.test.ts` and `briefGolden.test.ts` must still pass untouched — this task changed no output.

- [ ] **Step 8: Commit**

```bash
git add packages/plugin/src/serialize.ts packages/plugin/src/main.ts packages/plugin/test/serialize.test.ts packages/plugin/test/integration.test.ts && git commit -m "$(cat <<'EOF'
refactor(plugin): the node resolver returns identity, not a name

variableName/styleName returned v?.name ?? null, discarding the id, the
collection, and remote. Figma answers all three directly (Variable.remote,
PublishableMixin.remote, BaseStyle.type), and discarding them is what forces
the brief to guess a status from a failed lookup.

No output change: bindings still carry the resolved name and nothing else.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `TokenRef` and `TokenRule` carry identity (A2)

The single highest-risk change in the plan is one line: `hash.ts:45`'s projection must emit the old `token` key from the new `name` field, or every committed document drifts on a rename that changes no content.

**Files:**
- Modify: `packages/extractor/src/tree.ts:43-46`
- Modify: `packages/extractor/src/tokens.ts:14-21` (`TokenRule`), `:205-220` (`normalizeBindings`), `:527` (`toTokenRule`)
- Modify: `packages/extractor/src/hash.ts:45`
- Modify: `packages/extractor/src/resolve.ts:23`
- Modify: `packages/extractor/src/validate.ts:137,147,201,207,222`
- Modify: `packages/extractor/src/pivot.ts:69,203,204,248,259`
- Modify: `packages/extractor/src/prose/prompt.ts:272`
- Modify: `packages/extractor/src/brief.ts:287,403,407,408,411,421,548,612,615,621`
- Modify: `packages/plugin/src/serialize.ts` (emit full refs)
- Modify: `packages/plugin/src/ui/docModel.ts:337,357,522`
- Modify: `packages/extractor/test/fixtures/button.json`, `packages/extractor/test/fixtures/chip.json`
- Test: `packages/extractor/test/tokens.test.ts`, `packages/plugin/test/serialize.test.ts`

**Interfaces:**
- Consumes: `ResolvedVariable`, `ResolvedStyle` (Task 2).
- Produces:
  - `type RefKind = 'variable' | 'paint-style' | 'text-style' | 'effect-style'`
  - `interface RefIdentity { id: string; name: string; kind: RefKind; remote: boolean; collectionId?: string }`
  - `interface TokenRef extends RefIdentity { property: string }`
  - `interface TokenRule extends RefIdentity { part: string; path: string; property: string; conditions: Record<string, string[]> }`
  - `ResolvedToken` keeps its `token` field name (it is a canvas view model, not a ref).

- [ ] **Step 1: Write the failing tests**

Append to `packages/extractor/test/tokens.test.ts`:

```ts
describe('ref identity', () => {
  const ref = (over: Partial<TokenRef> & { property: string }): TokenRef => ({
    id: 'VariableID:1', name: 'color/brand', kind: 'variable', remote: false, ...over,
  });

  it('carries id, kind and remote onto the emitted rule', () => {
    const root: SerializedNode = {
      id: '1:1', name: 'Card', type: 'COMPONENT', visible: true,
      bindings: [ref({ property: 'fills', id: 'VariableID:9', remote: true,
        collectionId: 'VariableCollectionId:3' })],
    } as SerializedNode;
    const [rule] = extractTokens(root);
    expect(rule.name).toBe('color/brand');
    expect(rule.id).toBe('VariableID:9');
    expect(rule.kind).toBe('variable');
    expect(rule.remote).toBe(true);
    expect(rule.collectionId).toBe('VariableCollectionId:3');
  });

  it('has no `token` field left on a rule', () => {
    const root: SerializedNode = {
      id: '1:1', name: 'Card', type: 'COMPONENT', visible: true,
      bindings: [ref({ property: 'fills' })],
    } as SerializedNode;
    // `in`, not an undefined comparison: a leftover `token: undefined` would
    // still satisfy every consumer that reads it and silently emit nothing.
    expect('token' in extractTokens(root)[0]).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/extractor/test/tokens.test.ts`
Expected: FAIL with `rule.name` undefined and `'token' in rule` true.

- [ ] **Step 3: Widen `tree.ts`**

Replace `tree.ts:43-46`:

```ts
/** What kind of Figma resource a binding names. A closed set: `getStyleByIdAsync`
 *  can also return a GRID style, but no node property this file reads produces a
 *  grid binding, so a grid style never becomes a TokenRef. */
export type RefKind = 'variable' | 'paint-style' | 'text-style' | 'effect-style';

/**
 * A resolved reference to one Figma resource, with everything Figma stated
 * about it. Shared by node bindings (TokenRef), minimized rules (TokenRule) and
 * per-field effect bindings, so all three answer the same questions the same way.
 */
export interface RefIdentity {
  /** Figma id. Drives resolution. Never emitted: the brief's rule is that
   *  internal ids stay inside. */
  id: string;
  /** Display and join identity, as `token` was. */
  name: string;
  kind: RefKind;
  /** Figma's own answer (Variable.remote / PublishableMixin.remote), not
   *  inferred from a failed lookup. */
  remote: boolean;
  /** Variables only. */
  collectionId?: string;
}

/** A binding on one node: an identity plus the property it is bound to. */
export interface TokenRef extends RefIdentity {
  property: string; // fills | strokes | itemSpacing | cornerRadius | ...
}
```

Also update the doc comment on `SerializedNode.bindings` at `tree.ts:10`:

```ts
  /** Variable and style bindings with the identity Figma stated for each:
   *  e.g. { property: "fills", id: "VariableID:7", name: "md.sys.color.primary",
   *  kind: "variable", remote: false }. */
  bindings?: TokenRef[];
```

- [ ] **Step 4: Widen `TokenRule`**

Replace `tokens.ts:14-21`:

```ts
export interface TokenRule extends RefIdentity {
  part: string;
  /** Path identity from the component root. The join key every consumer uses;
   *  `part` is the leaf name and is for display only. */
  path: string;
  property: string;
  /** axis -> matching values, axes in variant-name order, values in axis order. */
  conditions: Record<string, string[]>;
}
```

Add `RefIdentity` to the import on `tokens.ts:1`:

```ts
import type { SerializedNode, TokenRef, RefIdentity } from './tree';
```

- [ ] **Step 5: Thread refs through `normalizeBindings`**

Replace `tokens.ts:205-220` (the body of `normalizeBindings`, keeping its doc comment):

```ts
function normalizeBindings(raw: TokenRef[]): TokenRef[] {
  // Keyed on the WHOLE ref, not on its name: two different resources sharing a
  // name are two bindings, and collapsing them on the name is the defect this
  // change exists to remove.
  const byProp = new Map<string, TokenRef[]>();
  for (const b of raw) {
    const refs = byProp.get(b.property) ?? [];
    if (!refs.some((r) => r.kind === b.kind && r.id === b.id)) refs.push(b);
    byProp.set(b.property, refs);
  }

  const out: TokenRef[] = [];
  const emit = (property: string, ref: TokenRef) => {
    if (out.some((o) => o.property === property && o.kind === ref.kind && o.id === ref.id)) return;
    // The ref travels through with its identity intact; only the PROPERTY is
    // renamed. Reconstructing `{ property, token }` here is what used to flatten
    // every binding back to a string one stage after it was resolved.
    out.push({ ...ref, property });
  };

  // Corner radii
  const radii = RADIUS_PROPS.filter((p) => byProp.has(p));
  const radiusRefs = radii.flatMap((p) => byProp.get(p)!);
  const distinctRadius = new Set(radiusRefs.map((r) => `${r.kind}|${r.id}`));
  if (radii.length === RADIUS_PROPS.length && distinctRadius.size === 1) {
    emit('border-radius', radiusRefs[0]);
  } else {
    for (const p of radii) for (const r of byProp.get(p)!) emit(RADIUS_INDIVIDUAL_MAP[p], r);
  }

  // Padding
  const sideRefs = (...props: string[]) => props.flatMap((p) => byProp.get(p) ?? []);
  for (const { property, value } of paddingSides(
    sideRefs('paddingTop', 'verticalPadding'),
    sideRefs('paddingRight', 'horizontalPadding'),
    sideRefs('paddingBottom', 'verticalPadding'),
    sideRefs('paddingLeft', 'horizontalPadding'),
  )) {
    emit(property, value);
  }

  // Everything else
  const hasTypography = byProp.has('typography');
  for (const [prop, refs] of byProp) {
    if (RADIUS_PROPS.includes(prop) || PADDING_RAW_PROPS.has(prop)) continue;
    if (hasTypography && TYPOGRAPHY_SUBPROPS.has(prop)) continue;
    const mapped = simpleProperty(prop);
    for (const r of refs) emit(mapped, r);
  }
  return out;
}
```

`paddingSides` is already generic over `T` and compares with `Set` identity plus `===`. With `T = TokenRef` its "all four sides agree" test becomes object-identity, which is wrong: four sides bound to the same variable hold four DISTINCT ref objects. Fix it by keying the comparison, replacing the body of `paddingSides` at `tokens.ts:166-190`:

```ts
function paddingSides<T>(
  top: T[], right: T[], bottom: T[], left: T[],
  key: (v: T) => string = String,
): Array<{ property: string; value: T }> {
  const single = (xs: T[]): T | null => (xs.length === 1 ? xs[0] : null);
  const sameKey = (a: T[], b: T[]): boolean => {
    const x = single(a), y = single(b);
    return x !== null && y !== null && key(x) === key(y);
  };
  const sides = [top, right, bottom, left];
  const out: Array<{ property: string; value: T }> = [];
  // Compared through `key`, not by identity: four sides bound to ONE variable
  // are four distinct ref objects, and a Set of them has size 4.
  if (sides.every((s) => single(s) !== null)
      && new Set(sides.map((s) => key(single(s)!))).size === 1) {
    out.push({ property: 'padding', value: single(top)! });
    return out;
  }
  if (left.length && sameKey(left, right)) {
    out.push({ property: 'padding-x', value: single(left)! });
  } else {
    for (const t of left) out.push({ property: 'padding-left', value: t });
    for (const t of right) out.push({ property: 'padding-right', value: t });
  }
  if (top.length && sameKey(top, bottom)) {
    out.push({ property: 'padding-y', value: single(top)! });
  } else {
    for (const t of top) out.push({ property: 'padding-top', value: t });
    for (const t of bottom) out.push({ property: 'padding-bottom', value: t });
  }
  return out;
}
```

The default `key = String` keeps `extractGaps`'s numeric call site working unchanged. In `normalizeBindings`, pass the ref key:

```ts
  for (const { property, value } of paddingSides(
    sideRefs('paddingTop', 'verticalPadding'),
    sideRefs('paddingRight', 'horizontalPadding'),
    sideRefs('paddingBottom', 'verticalPadding'),
    sideRefs('paddingLeft', 'horizontalPadding'),
    (r) => `${r.kind}|${r.id}`,
  )) {
```

- [ ] **Step 6: Fix the hash projection**

Replace `hash.ts:45` (inside `specContentHash`'s `hashable`), keeping the surrounding comment and adding to it:

```ts
    // `path` is a new identity for data already hashed under `part`, so it must
    // not enter the hash: every committed doc compares against a baseline
    // computed without it, and including it would flip all of them to "update
    // available" for a change that alters no rendered output. Same reasoning, and
    // same shape, as the anatomy reduction above.
    //
    // The projection emits the OLD key `token` from the NEW field `name`. The
    // rename carries no content: it is the same string, resolved from the same
    // Figma resource, and every committed doc's baseline was computed with it
    // under the old key. Emitting `name` here instead would drift every document
    // on every canvas for a field rename. The new identity fields (`id`, `kind`,
    // `remote`, `collectionId`) stay out for the same reason `path` does.
    tokens: spec.tokens.map(({ part, property, conditions, name }) =>
      ({ part, property, conditions, token: name })),
```

- [ ] **Step 7: Rename at the emit site and every consumer**

`tokens.ts` — `DraftRule` keeps its `token: string` field (the NAME) for this task; Task 4 replaces it with a `(kind, id)` key. Record each name's identity while collecting the grid, and read it back at emit time. Inside `extractTokens`, beside `partByPath`:

```ts
  /** Identity by NAME, for this task only. A name is still the grouping key
   *  here, exactly as it was before, so two references sharing one still
   *  collapse: that is Task 4's job, not this one's. */
  const identityByName = new Map<string, RefIdentity>();
```

set it in the `walkParts` callback beside the existing `set.add(token)`:

```ts
      for (const ref of normalizeBindings(n.bindings ?? [])) {
        const key = `${path}\0${ref.property}`;
        partByPath.set(path, part);
        identityByName.set(ref.name, ref);
        let set = variantTokens.get(key);
        if (!set) variantTokens.set(key, (set = new Set()));
        set.add(ref.name);
      }
```

and read it back in `toTokenRule` at `tokens.ts:527`:

```ts
  const toTokenRule = (path: string, property: string, r: DraftRule): TokenRule => {
    const conditions: Record<string, string[]> = {};
    for (const axis of axisOrder) {
      const vs = r.values.get(axis);
      if (!vs) continue;
      conditions[axis] = axisValues.get(axis)!.filter((v) => vs.has(v));
    }
    // Spread the identity, not just the name: `name` is one of its fields, so
    // the rule carries the id, kind and remote that resolution needs.
    return { part: partByPath.get(path)!, path, property, conditions, ...identityByName.get(r.token)! };
  };
```

`resolve.ts:23` — keep the view model's field name, map from the new one:

```ts
    // `token` stays the field name here: ResolvedToken feeds the canvas view
    // models in docModel.ts and docFrame.ts, which are not references and have
    // no id or kind to carry.
    .map(({ part, property, name }) => ({ part, property, token: name }));
```

`validate.ts` — `t.token` → `t.name` at lines 137, 147, 201, 207, 222 (`resolved.get(rule.name)`, `` `${rule.name} resolves to` ``, `entry.tokens.add(t.name)`).

`pivot.ts` — `r.token` → `r.name` at lines 69, 203, 204, 205, 248, 259.

`prose/prompt.ts:272` — `${t.token}` → `${t.name}`.

`brief.ts` — `t.token`/`r.token` → `t.name`/`r.name` at lines 287, 403, 407, 408, 411, 421, 548, 612, 615, 621. The EMITTED key stays `token:` at line 421 and stays the `used` map key at 411; only the field read from the rule changes.

`docModel.ts` — `t.token` → `t.name` at lines 337, 357, 522. The view model's own `token` field (line 77) is unchanged.

- [ ] **Step 8: Emit full refs from `serialize.ts`**

Replace the two resolve blocks written in Task 2:

```ts
  // --- Resolve boundVariables ---
  const bv = node.boundVariables ?? {};
  for (const [property, value] of Object.entries(bv)) {
    const entries: RawBoundVar[] = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (!entry?.id) continue;
      const v = await resolver.variable(entry.id);
      // Deduped on the resolved ID, not on the name: two ids resolving to one
      // name are two bindings, which is exactly what this change stops losing.
      if (v && !bindings.some((b) => b.property === property && b.id === v.id)) {
        bindings.push({ property, ...variableRef(v) });
      }
    }
  }

  // --- Resolve style ids ---
  const styleBinding = async (id: string, property: string): Promise<void> => {
    const s = await resolver.style(id);
    const ref = s ? styleRef(s) : null;
    if (ref) bindings.push({ property, ...ref });
  };
  if (node.fillStyleId) await styleBinding(node.fillStyleId, 'fills');
  if (node.strokeStyleId) await styleBinding(node.strokeStyleId, 'strokes');
  if (typeof node.textStyleId === 'string' && node.textStyleId) {
    await styleBinding(node.textStyleId, 'typography');
  }
  if (typeof node.effectStyleId === 'string' && node.effectStyleId) {
    await styleBinding(node.effectStyleId, 'effects');
  }
```

and add the two converters near `mainComponentRef`:

```ts
/** A resolved variable as a reference identity. `collectionId` is spread in only
 *  when Figma gave one, so an absent collection is an absent key. */
export function variableRef(v: ResolvedVariable): RefIdentity {
  return {
    id: v.id, name: v.name, kind: 'variable', remote: v.remote,
    ...(v.collectionId ? { collectionId: v.collectionId } : {}),
  };
}

/** A resolved style as a reference identity, or null for a GRID style. No node
 *  property this file reads can produce a grid binding, so a grid style here
 *  means the id was not what it claimed and dropping it is the honest result. */
export function styleRef(s: ResolvedStyle): RefIdentity | null {
  return s.kind === 'grid-style'
    ? null
    : { id: s.id, name: s.name, kind: s.kind, remote: s.remote };
}
```

Import `RefIdentity` on `serialize.ts:1`.

- [ ] **Step 9: Update the two node fixtures**

Both fixtures carry `bindings: [{ property, token }]`, and every binding in both is a variable. Transform them mechanically so each distinct name gets one stable id:

```bash
node -e "
const fs = require('fs');
for (const f of ['button', 'chip']) {
  const p = 'packages/extractor/test/fixtures/' + f + '.json';
  const ids = new Map();
  const idOf = (n) => { if (!ids.has(n)) ids.set(n, 'VariableID:' + (ids.size + 1)); return ids.get(n); };
  const walk = (n) => {
    if (Array.isArray(n.bindings)) n.bindings = n.bindings.map((b) => ({
      property: b.property, id: idOf(b.token), name: b.token,
      kind: 'variable', remote: false, collectionId: 'VariableCollectionId:1',
    }));
    (n.children || []).forEach(walk);
  };
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  walk(d);
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
}
"
```

One id per distinct NAME is deliberate: it reproduces today's behaviour exactly, where a name was the identity. If the transform assigned one id per binding OCCURRENCE, the same variable bound on three nodes would become three refs, minimization would stop collapsing them, and both pinned hashes would move for a fixture change rather than a code change.

- [ ] **Step 10: Run the guards**

Run: `npm run check`
Expected: PASS. `BUTTON_HASH` and `CHIP_HASH` unchanged; `button-brief.yaml` byte-identical.

If `BUTTON_HASH` moves here, the cause is almost always Step 6 — check the projection emits `token:` and not `name:` — or Step 9 assigning ids per occurrence.

- [ ] **Step 11: Commit**

```bash
git add -A packages/extractor packages/plugin && git commit -m "$(cat <<'EOF'
refactor(extractor): TokenRef carries Figma's identity, not just a name

A binding was { property, token }, where token was a display string. It is now
an id, a name, a kind, and Figma's own `remote` answer. TokenRule follows.

specContentHash projects `name` back onto the old `token` key: the rename
carries no content, and emitting the new key would flip every committed
document to "update available" for a field rename.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Identity survives minimization, and the control characters go (A3)

**Files:**
- Modify: `packages/extractor/src/tokens.ts:255-265` (`ABSENT`), `:268-276` (`Cell`, `DraftRule`), `:325-360` (grid collection), `:370-375` (`tokensKey`, `projKey`), `:455-470` (`conditionKey`), `:495-515` (dedupe/subsumption), `:530-560` (`ruleSortKey`, output loop)
- Modify: `packages/extractor/src/rawValues.ts:24`
- Modify: `packages/extractor/src/pivot.ts:190`
- Modify: `packages/extractor/src/validate.ts:220`
- Modify: `scripts/check-nul-bytes.mjs`
- Modify: `packages/extractor/test/tokens.test.ts:469` (a comment containing the escape)
- Test: `packages/extractor/test/tokens.test.ts`

**Interfaces:**
- Consumes: `RefIdentity`, `TokenRef`, `TokenRule` (Task 3).
- Produces:
  - `const refKey = (r: RefIdentity): string => \`${r.kind}|${r.id}\`` — module-private to `tokens.ts`.
  - No exported API change.

- [ ] **Step 1: Write the failing tests**

Append to `packages/extractor/test/tokens.test.ts`:

```ts
describe('identity through minimization', () => {
  const base = (bindings: TokenRef[]): SerializedNode => ({
    id: '1:1', name: 'Card', type: 'COMPONENT', visible: true, bindings,
  } as SerializedNode);

  it('keeps a variable and an effect style that share one name as two rules', () => {
    const rules = extractTokens(base([
      { property: 'fills', id: 'VariableID:1', name: 'Elevation/1', kind: 'variable', remote: false },
      { property: 'effects', id: 'S:effect,1:1', name: 'Elevation/1', kind: 'effect-style', remote: false },
    ]));
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.kind).sort()).toEqual(['effect-style', 'variable']);
  });

  it('keeps two variables that share one name as two rules', () => {
    const rules = extractTokens(base([
      { property: 'fills', id: 'VariableID:1', name: 'brand', kind: 'variable', remote: false },
      { property: 'strokes', id: 'VariableID:2', name: 'brand', kind: 'variable', remote: false },
    ]));
    expect(rules).toHaveLength(2);
    expect(new Set(rules.map((r) => r.id)).size).toBe(2);
  });

  it('collapses one variable bound twice on the same property to one rule', () => {
    const rules = extractTokens(base([
      { property: 'fills', id: 'VariableID:1', name: 'brand', kind: 'variable', remote: false },
      { property: 'fills', id: 'VariableID:1', name: 'brand', kind: 'variable', remote: false },
    ]));
    expect(rules).toHaveLength(1);
  });
});

describe('composite keys', () => {
  // Built from char codes, never written as literals. A test that spells the
  // sequence it forbids puts that sequence into a tracked source file, and
  // check:nul would then fail on the test rather than on the defect.
  const BACKSLASH_ZERO = String.fromCharCode(92) + '0';
  const CONTROL = new RegExp('[' + "\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f" + ']');

  it('uses no control character in any key these modules build', () => {
    // Read the source, not the behaviour: a control character in a key is
    // invisible in a diff, survives grep without -P, and sat past git's
    // binary-detection window every time it reached this repo.
    for (const file of ['tokens.ts', 'rawValues.ts', 'pivot.ts', 'validate.ts']) {
      const src = readFileSync(`packages/extractor/src/${file}`, 'utf8');
      expect(CONTROL.test(src), `${file} holds a raw control character`).toBe(false);
      expect(src.includes(BACKSLASH_ZERO), `${file} holds a NUL escape`).toBe(false);
    }
  });
});
```

Add `import { readFileSync } from 'node:fs';` and `import type { TokenRef } from '../src/tree';` at the top of the file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/extractor/test/tokens.test.ts`
Expected: FAIL — the shared-name cases collapse to one rule, and the source scan finds the SOH byte at `tokens.ts:263` plus twelve `\0` escapes.

- [ ] **Step 3: Replace the ABSENT sentinel with an out-of-band key**

Replace `tokens.ts:255-276`:

```ts
/**
 * The identity key for one reference: what makes two bindings the same binding.
 *
 * `${kind}|${id}`, not the name. A name is a display string and two different
 * Figma resources can share one; keying on it is what used to make a variable
 * and an effect style called "Elevation/1" a single rule.
 */
const refKey = (r: RefIdentity): string => `${r.kind}|${r.id}`;

/**
 * Marks "this part/property does not exist in this variant". Backfilled into
 * every grid so absence participates in difference-detection like any other
 * value. Never escapes extractTokens: absent rules are dropped when the public
 * shape is built.
 *
 * A plain word rather than a control-character prefix, and safe because a real
 * refKey ALWAYS contains a `|` and this never does. The previous version began
 * with a raw SOH byte, which is exactly the class of invisible source that
 * `npm run check:nul` exists to catch and that its NUL-only scan missed.
 */
const ABSENT_KEY = 'absent';

/** One observed data point: in the variant identified by `combo`, the
 *  part/property carries the references named by `keys`. */
interface Cell {
  combo: Record<string, string>;
  keys: string[]; // sorted refKeys, or exactly [ABSENT_KEY]
}

/** Work-in-progress rule: one reference plus conditioned axes mapped to accepted value sets. */
interface DraftRule {
  key: string;
  values: Map<string, Set<string>>;
}
```

- [ ] **Step 4: Collect the grid on structured keys**

Replace the observation-grid block at `tokens.ts:325-360`:

```ts
  // Grouped by (path, property), NOT (part, property). `part` is unique only
  // among SIBLINGS, so two nodes with the same cleaned name in DIFFERENT
  // subtrees ("header > label" and "footer > label") would still share a flat
  // `part` key. `path`, threaded from walkParts, is the real identity.
  //
  // The composite key is JSON, not a separator-joined string. A separator has
  // to be a character neither component can contain, which in this repo has
  // meant a NUL or a SOH: invisible in a diff, silent under `grep`, and past
  // git's binary-detection window. JSON.stringify escapes its own components,
  // so the key is unambiguous AND readable in a debugger.
  const gridKey = (path: string, property: string): string => JSON.stringify([path, property]);

  const cellsByPathProp = new Map<string, Cell[]>();
  const pathOrder: string[] = [];
  const propOrder = new Map<string, string[]>();
  const partByPath = new Map<string, string>();
  /** Every reference seen anywhere in this component, by refKey, so a rule can
   *  be turned back into a full identity at emit time. Two refs sharing a
   *  (kind, id) are the same Figma resource, so overwriting is a no-op.
   *
   *  This REPLACES `identityByName` from the previous task, which was keyed by
   *  name and so could only ever hold one of two references that shared one.
   *  Delete that map and its two uses. */
  const refsByKey = new Map<string, RefIdentity>();

  variants.forEach((variant, idx) => {
    const combo = combos[idx];
    // Outer key path-and-property, inner key refKey, so two refs sharing a name
    // stay two refs all the way through.
    const variantRefs = new Map<string, Map<string, RefIdentity>>();
    walkParts(variant, isInSet ? 'Container' : cleanPartName(variant.name), (n, part, path) => {
      for (const ref of normalizeBindings(n.bindings ?? [])) {
        const key = gridKey(path, ref.property);
        partByPath.set(path, part);
        let inner = variantRefs.get(key);
        if (!inner) variantRefs.set(key, (inner = new Map()));
        const rk = refKey(ref);
        inner.set(rk, ref);
        refsByKey.set(rk, ref);
      }
    }, true);
    for (const [key, inner] of variantRefs) {
      let cells = cellsByPathProp.get(key);
      if (!cells) {
        cellsByPathProp.set(key, (cells = []));
        const [path, prop] = JSON.parse(key) as [string, string];
        if (!propOrder.has(path)) {
          pathOrder.push(path);
          propOrder.set(path, []);
        }
        propOrder.get(path)!.push(prop);
      }
      cells.push({ combo, keys: [...inner.keys()].sort() });
    }
  });
```

The `ABSENT` backfill loop at `tokens.ts:362-368` becomes:

```ts
  for (const cells of cellsByPathProp.values()) {
    const present = new Set(cells.map((c) => c.combo));
    for (const combo of combos) {
      if (!present.has(combo)) cells.push({ combo, keys: [ABSENT_KEY] });
    }
  }
```

- [ ] **Step 5: Replace the remaining joined keys**

`tokens.ts:372-373`:

```ts
  // JSON, not a joined string, for the reason gridKey gives: an axis value is
  // whatever a designer typed, so no separator character is safely unavailable.
  const cellKey = (c: Cell) => JSON.stringify(c.keys);
  const projKey = (combo: Record<string, string>, axes: string[]) =>
    JSON.stringify(axes.map((a) => combo[a]));
```

and replace every `tokensKey(` call with `cellKey(`.

`tokens.ts:455-470` (`conditionKey` and its two call sites):

```ts
    const conditionKey = (r: DraftRule, excludeAxis: string | null) =>
      JSON.stringify(axisOrder
        .filter((a) => a !== excludeAxis)
        .map((a) => (r.values.has(a) ? [...r.values.get(a)!].sort() : null)));
    for (const axis of relevant) {
      const merged = new Map<string, DraftRule>();
      for (const r of rules) {
        const k = JSON.stringify([r.key, conditionKey(r, axis)]);
```

and at `tokens.ts:499`:

```ts
      const k = JSON.stringify([r.key, conditionKey(r, null)]);
```

Note the `null` in `conditionKey`: the old code used the string `'*'` for an unconditioned axis, which collides with an axis whose only value is literally `*`. `null` cannot be a string, so it cannot collide.

`tokens.ts:508` (subsumption) — `other.token === r.token` becomes `other.key === r.key`.

The candidate-rule build at `tokens.ts:445-450`:

```ts
    let rules: DraftRule[] = [];
    for (const g of groups.values()) {
      for (const key of [...g.keys].sort()) {
        rules.push({ key, values: new Map(relevant.map((a) => [a, new Set([g.combo[a]])])) });
      }
    }
```

with the grouping above it rewritten to accumulate `keys` instead of `tokens`:

```ts
    const groups = new Map<string, { combo: Record<string, string>; keys: Set<string> }>();
    for (const c of cells) {
      const k = projKey(c.combo, relevant);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { combo: c.combo, keys: new Set() }));
      c.keys.forEach((t) => g!.keys.add(t));
    }
```

- [ ] **Step 6: Make the sort key an array, not a joined string**

This is the one place a separator change could reorder output, because it is the only key compared with `<`/`>` rather than used as a map key. An array compared field by field removes the question entirely: fields never bleed into each other, so ordering between two rules is decided by exactly the fields that differ.

Replace `tokens.ts:530-560`:

```ts
  /**
   * Sort fields, compared one at a time. Deliberately an array rather than a
   * separator-joined string: a joined key makes ordering depend on how the
   * separator sorts against whatever the previous field's last characters were,
   * which is why the old version needed an unspellable NUL to be correct. Field
   * by field, that question does not arise.
   *
   * Field 4 is the reference's NAME, so rules still sort the way a reader
   * expects to see them. Field 5 is the refKey, which only ever breaks a tie
   * between two references that genuinely share a name.
   */
  const ruleSortKey = (r: DraftRule): string[] => {
    const matchesDefault = [...r.values.entries()].every(([a, vs]) => vs.has(defaultCombo[a]));
    const axisBits = axisOrder
      .map((a, i) => {
        const vs = r.values.get(a);
        if (!vs) return '';
        const indices = axisValues.get(a)!
          .map((v, vi) => (vs.has(v) ? String(vi).padStart(3, '0') : ''))
          .filter(Boolean)
          .join('.');
        return `${i}:${indices}`;
      })
      .filter(Boolean)
      .join('|');
    return [
      matchesDefault ? '0' : '1',
      String(r.values.size).padStart(3, '0'),
      axisBits,
      // An absent rule has no reference and sorts first, exactly as the old
      // control-character sentinel did. It is dropped below either way.
      refsByKey.get(r.key)?.name ?? '',
      r.key,
    ];
  };

  const compareKeys = (a: string[], b: string[]): number => {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  };

  const out: TokenRule[] = [];
  for (const path of pathOrder) {
    for (const prop of propOrder.get(path)!) {
      const cells = cellsByPathProp.get(gridKey(path, prop))!;
      const rules = buildRules(cells);
      rules.sort((a, b) => compareKeys(ruleSortKey(a), ruleSortKey(b)));
      for (const r of rules) {
        if (r.key === ABSENT_KEY) continue;
        out.push(toTokenRule(path, prop, r));
      }
    }
  }
  return out;
```

and `toTokenRule` reads the identity back out:

```ts
  const toTokenRule = (path: string, property: string, r: DraftRule): TokenRule => {
    const conditions: Record<string, string[]> = {};
    for (const axis of axisOrder) {
      const vs = r.values.get(axis);
      if (!vs) continue;
      conditions[axis] = axisValues.get(axis)!.filter((v) => vs.has(v));
    }
    return { part: partByPath.get(path)!, path, property, conditions, ...refsByKey.get(r.key)! };
  };
```

- [ ] **Step 7: Purge the remaining composite-key control characters**

`rawValues.ts:24`:

```ts
    const k = JSON.stringify([part, property]);
```

`pivot.ts:190`:

```ts
    const cellKey = (p: string, s: string, c: string) => JSON.stringify([p, s, c]);
```

`validate.ts:220` (currently three raw SOH bytes):

```ts
    const key = JSON.stringify([t.path, t.property, t.conditions]);
```

The comment above it already explains why `path`/`property` are carried alongside rather than recovered from the key; leave it.

`tokens.ts:259-260`'s comment referenced the old sentinel and the old separator. It is replaced wholesale in Step 3.

`packages/extractor/test/tokens.test.ts:469`'s comment spells the escape. Reword:

```ts
  // Regression (code review, Task 3): pushGap's dedupe key joined part and issue
  // only, so two different properties on one part collapsed into one gap.
```

- [ ] **Step 8: Extend `check:nul`**

`scripts/check-nul-bytes.mjs` currently scans for the raw 0x00 byte only. Widen it to the two neighbouring failure modes. Replace the scan loop and add the code-extension set:

```js
/**
 * Extensions where a NUL ESCAPE (`\0` in source) is a defect rather than
 * content. Deliberately narrower than TEXT_EXTENSIONS: `patterns.css` contains
 * `content: "\00b7"`, a legitimate CSS escape for a middle dot, and a blanket
 * substring scan would flag it forever.
 */
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** C0 controls that are never legitimate in source: everything below 0x20
 *  except tab, line feed and carriage return. NUL is the one that has actually
 *  bitten this repo; SOH reached tokens.ts and validate.ts as a key separator
 *  and passed every check because the scan was NUL-only. */
function firstControlByte(buf) {
  for (const b of buf) {
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) return b;
  }
  return null;
}

const offenders = [];
for (const file of trackedFiles()) {
  if (!inScope(file) || !hasTextExtension(file)) continue;
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue;
  }
  const control = firstControlByte(buf);
  if (control !== null) {
    offenders.push(`${file} (raw control byte 0x${control.toString(16).padStart(2, '0')})`);
    continue;
  }
  const dot = file.lastIndexOf('.');
  if (CODE_EXTENSIONS.has(file.slice(dot).toLowerCase()) && buf.toString('utf8').includes('\\0')) {
    offenders.push(`${file} (NUL escape in source)`);
  }
}

if (offenders.length > 0) {
  console.error('Found NUL or other control characters in tracked source files:');
  for (const file of offenders) console.error(`  ${file}`);
  console.error(
    "\nA control byte can sit past git's binary-detection window and pass `grep` "
    + 'silently, and a NUL escape used as a key separator is invisible in a diff. '
    + 'Use JSON.stringify for composite keys instead.',
  );
  process.exit(1);
}
```

- [ ] **Step 9: Run the extended check and the guards**

Run: `npm run check:nul`
Expected: PASS with no output. If it reports `packages/extractor/src/validate.ts` or `packages/extractor/src/tokens.ts`, Step 7 is incomplete.

Run: `npm run check`
Expected: PASS. `BUTTON_HASH` and `CHIP_HASH` unchanged, `button-brief.yaml` byte-identical.

If a hash moved here, the likely cause is Step 6: confirm `ruleSortKey` field 4 is the reference NAME and not the refKey. Sorting by `variable|VariableID:1` instead of `md.sys.color.primary` reorders every rule.

- [ ] **Step 10: Commit**

```bash
git add -A packages/extractor scripts && git commit -m "$(cat <<'EOF'
refactor(extractor): identity survives minimization, control characters do not

normalizeBindings reduced bindings to Map<string, string[]> of property to
token NAMES and re-emitted fresh objects; extractTokens then keyed path and
property into one NUL-joined string. Every stage flattened to a string, so a
variable and an effect style sharing a name could not both be represented.

The grid now keys on (kind, id) throughout, and every composite key is
JSON.stringify of its components: the third component was the moment to stop
adding separators nobody can see. That removes twelve NUL escapes plus the raw
SOH bytes in tokens.ts and validate.ts, and check:nul now catches both classes.

The sort key is an array compared field by field, so ordering no longer depends
on how a separator sorts against the previous field.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Narrowing and failed reads record themselves (A4, A5)

Two prerequisites for Phase B's status vocabulary. `not-in-scope` is unreachable without `narrowedTo`, and `unavailable` is unreachable without `SerializedFoundation.unavailable`.

**Files:**
- Modify: `packages/extractor/src/foundation.ts:53-59` (`SerializedFoundation`), `:94-99` (`FoundationSpec`), `:136-149` (`narrowFoundation`), `:302-336` (`buildFoundation`)
- Modify: `packages/plugin/src/serializeFoundation.ts:83-192`
- Test: `packages/extractor/test/narrowFoundation.test.ts`, `packages/plugin/test/serializeFoundation.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type FoundationRead = 'variables' | 'textStyles' | 'effectStyles'`
  - `SerializedFoundation.unavailable?: FoundationRead[]`
  - `FoundationSpec.unavailable?: FoundationRead[]` (carried through by `buildFoundation`)
  - `FoundationSpec.narrowedTo?: FoundationCopyTarget`

- [ ] **Step 1: Write the failing tests**

Append to `packages/extractor/test/narrowFoundation.test.ts`:

```ts
it('records what a narrowed spec covers', () => {
  const spec = buildFoundation(dumpTwoCollections());
  const narrowed = narrowFoundation(spec, { target: 'collection', collectionId: 'sem' })!;
  // The distinction this exists for: a token absent from THIS spec because the
  // narrowing excluded its collection is not the same as one absent from the
  // file, and without this field a resolver cannot tell them apart.
  expect(narrowed.narrowedTo).toEqual({ target: 'collection', collectionId: 'sem' });
});

it('leaves a whole-file spec unnarrowed', () => {
  const spec = buildFoundation(dumpTwoCollections());
  // `in`, not an undefined comparison: `{ narrowedTo: undefined }` would still
  // read as "narrowed to nothing" for a consumer checking presence.
  expect('narrowedTo' in spec).toBe(false);
});
```

Append to `packages/plugin/test/serializeFoundation.test.ts`:

```ts
describe('unavailable reads', () => {
  it('records a variables read that threw instead of reporting an empty file', async () => {
    const reader = fakeReader({ collections: async () => { throw new Error('nope'); } });
    const dump = await serializeFoundation(reader, 'FILE1', 'T');
    expect(dump.collections).toEqual([]);
    // Without this, a total API failure and a file with no variables at all
    // produce byte-identical dumps, and the brief reports the second.
    expect(dump.unavailable).toEqual(['variables']);
  });

  it('records a text styles read that threw', async () => {
    const reader = fakeReader({ textStyles: async () => { throw new Error('nope'); } });
    const dump = await serializeFoundation(reader, 'FILE1', 'T');
    expect(dump.unavailable).toEqual(['textStyles']);
  });

  it('leaves the key absent on a clean read', async () => {
    const dump = await serializeFoundation(fakeReader(), 'FILE1', 'T');
    expect('unavailable' in dump).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/extractor/test/narrowFoundation.test.ts packages/plugin/test/serializeFoundation.test.ts`
Expected: FAIL — `narrowedTo` and `unavailable` are undefined.

- [ ] **Step 3: Add the types**

In `foundation.ts`, above `SerializedFoundation`:

```ts
/** One read serializeFoundation performs. Named so a failure can be reported as
 *  a fact rather than inferred from an empty result. */
export type FoundationRead = 'variables' | 'textStyles' | 'effectStyles';
```

Add to `SerializedFoundation`:

```ts
  /**
   * Which reads failed. Absent on a clean read, never `[]`.
   *
   * serializeFoundation catches an API failure and returns an empty foundation,
   * which makes total failure indistinguishable from a file that genuinely has
   * no variables. This is the difference, and it is a prerequisite for the
   * `unavailable` resolution status rather than a nicety.
   */
  unavailable?: FoundationRead[];
```

Add to `FoundationSpec`:

```ts
  /** Carried straight through from the dump. See SerializedFoundation. */
  unavailable?: FoundationRead[];
  /**
   * Present only on a narrowed spec. Lets a resolver distinguish "excluded by
   * scope" from "not present locally" — two causes that a lookup returning
   * nothing collapses into one.
   */
  narrowedTo?: FoundationCopyTarget;
```

- [ ] **Step 4: Set them**

`narrowFoundation`, replacing its two returns:

```ts
  if (target.target === 'textStyles') {
    if (spec.textStyles.length === 0) return null;
    return { ...spec, collections: [], textStyles: spec.textStyles, narrowedTo: target };
  }
  const collection = spec.collections.find((c) => c.id === target.collectionId);
  if (!collection) return null;
  return { ...spec, collections: [collection], textStyles: [], narrowedTo: target };
```

`buildFoundation`, in its return:

```ts
  return {
    fileKey: dump.fileKey,
    collections,
    textStyles: dump.textStyles.map((s) => ({ ...s, group: groupOf(s.name) })),
    extractedAt: dump.extractedAt,
    // Spread, not `unavailable: dump.unavailable`: a clean read has no key at
    // all rather than one holding undefined, matching how every other optional
    // field in this model behaves.
    ...(dump.unavailable ? { unavailable: dump.unavailable } : {}),
  };
```

`serializeFoundation`, replacing the two `catch` blocks and the return:

```ts
  const unavailable: FoundationRead[] = [];

  let readerCollections: ReaderCollection[] = [];
  try {
    readerCollections = await reader.collections();
  } catch {
    // An empty foundation is no longer "the honest result" on its own: it is
    // indistinguishable from a file with no variables. Say which one it is.
    unavailable.push('variables');
  }

  // ... unchanged ...

  let readerStyles: ReaderTextStyle[] = [];
  try {
    readerStyles = await reader.textStyles();
  } catch {
    unavailable.push('textStyles');
  }

  // ... unchanged ...

  return {
    fileKey, collections, textStyles, externals, extractedAt,
    ...(unavailable.length > 0 ? { unavailable } : {}),
  };
```

Import `FoundationRead` in `serializeFoundation.ts:9-12`.

- [ ] **Step 5: Run the guards**

Run: `npm run check`
Expected: PASS, including the Task 1 guard that a widened `FoundationSpec` does not move `foundationContentHash`.

- [ ] **Step 6: Commit**

```bash
git add -A packages/extractor packages/plugin && git commit -m "$(cat <<'EOF'
feat(extractor): narrowing and failed reads record themselves

Absence from local foundation data has at least six causes and the brief
reports all of them identically. Two of the six are now facts on the model
rather than guesses: narrowFoundation stamps what it covers, and
serializeFoundation records which reads threw instead of returning an empty
foundation that reads as "this file has none".

No output change: nothing reads either field yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5b: Phase A sign-off

- [ ] **Step 1: Confirm the three Phase A guards**

Run: `npm run check`
Expected: PASS. Then confirm explicitly, reading the output rather than assuming:

```bash
git diff --stat HEAD~4 -- packages/extractor/test/fixtures/button-brief.yaml
```

Expected: **no output**. The golden brief is byte-identical to what Task 0 committed. If it changed, Phase A leaked output and must be fixed before Phase B starts.

- [ ] **Step 2: Confirm both hashes are still the committed constants**

```bash
git diff HEAD~4 -- packages/extractor/test/specHash.test.ts | grep -E '^[-+].*HASH ='
```

Expected: **no output**. Neither constant was edited.

---

# Phase B — output

## Task 6: The `EffectLayer` union and the serializer read (B1)

Figma's `Effect` is nine concrete shapes, not four: `BlurEffect` and `NoiseEffect` are themselves unions.

**Files:**
- Create: `packages/extractor/src/effects.ts`
- Create: `packages/extractor/test/effects.test.ts`
- Modify: `packages/extractor/src/index.ts` (export)
- Modify: `packages/extractor/src/tree.ts` (`SerializedNode.effects`)
- Modify: `packages/plugin/src/serialize.ts:37` (the `effects` read shape)

**Interfaces:**
- Consumes: `RefIdentity` (Task 3).
- Produces:
  - `interface Rgba { hex: string; alpha: number }`, `interface Vec2 { x: number; y: number }`
  - `type EffectField = 'color' | 'radius' | 'spread' | 'offsetX' | 'offsetY'`
  - `type EffectBindings = Partial<Record<EffectField, RefIdentity>>`
  - `type EffectLayer = ...` (the ten-branch union below)
  - `interface RawEffect { type: string; [k: string]: unknown }`
  - `function effectLayerOf(raw: RawEffect, bindings?: EffectBindings): EffectLayer`
  - `const roundN: (n: number, places: number) => number`
  - `SerializedNode.effects?: EffectLayer[]`

- [ ] **Step 1: Write the failing tests**

Create `packages/extractor/test/effects.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { effectLayerOf, type EffectLayer } from '../src/effects';

const rgba = (r: number, g: number, b: number, a: number) => ({ r, g, b, a });

describe('effectLayerOf', () => {
  it('reads a drop shadow whole, geometry included', () => {
    expect(effectLayerOf({
      type: 'DROP_SHADOW', color: rgba(0, 0, 0, 0.08), offset: { x: 0, y: 2 },
      radius: 4, spread: 0, visible: true, blendMode: 'NORMAL',
    })).toEqual({
      type: 'drop-shadow', visible: true, blendMode: 'NORMAL',
      color: { hex: '#000000', alpha: 0.08 }, offset: { x: 0, y: 2 },
      radius: 4, spread: 0,
    });
  });

  it('keeps an invisible layer rather than dropping it', () => {
    const l = effectLayerOf({
      type: 'INNER_SHADOW', color: rgba(1, 0, 0, 1), offset: { x: 1, y: 1 },
      radius: 2, visible: false, blendMode: 'NORMAL',
    }) as Extract<EffectLayer, { type: 'inner-shadow' }>;
    expect(l.visible).toBe(false);
    // spread is optional on Figma's own type; an absent one is an absent key,
    // never a fabricated 0.
    expect('spread' in l).toBe(false);
  });

  it('reads a normal blur', () => {
    expect(effectLayerOf({ type: 'LAYER_BLUR', blurType: 'NORMAL', radius: 8, visible: true }))
      .toEqual({ type: 'layer-blur', blurType: 'normal', visible: true, radius: 8 });
  });

  it('reads a progressive blur with both offsets', () => {
    expect(effectLayerOf({
      type: 'BACKGROUND_BLUR', blurType: 'PROGRESSIVE', radius: 12, visible: true,
      startRadius: 0, startOffset: { x: 0, y: 0 }, endOffset: { x: 0, y: 1 },
    })).toEqual({
      type: 'background-blur', blurType: 'progressive', visible: true, radius: 12,
      startRadius: 0, startOffset: { x: 0, y: 0 }, endOffset: { x: 0, y: 1 },
    });
  });

  it('emits no radius key on a noise layer rather than a zero', () => {
    const l = effectLayerOf({
      type: 'NOISE', noiseType: 'MONOTONE', color: rgba(0, 0, 0, 1), visible: true,
      blendMode: 'NORMAL', noiseSize: 2, density: 0.5,
    });
    // NoiseEffectBase has no radius field. Fabricating one to make the union
    // rectangular would be inventing a measurement.
    expect('radius' in l).toBe(false);
    expect(l).toEqual({
      type: 'noise', noiseType: 'monotone', visible: true, blendMode: 'NORMAL',
      color: { hex: '#000000', alpha: 1 }, noiseSize: 2, density: 0.5,
    });
  });

  it('reads a duotone noise secondary colour and a multitone opacity', () => {
    const duo = effectLayerOf({
      type: 'NOISE', noiseType: 'DUOTONE', color: rgba(0, 0, 0, 1), visible: true,
      blendMode: 'NORMAL', noiseSize: 2, density: 0.5, secondaryColor: rgba(1, 1, 1, 1),
    }) as Extract<EffectLayer, { type: 'noise' }>;
    expect(duo.secondaryColor).toEqual({ hex: '#ffffff', alpha: 1 });

    const multi = effectLayerOf({
      type: 'NOISE', noiseType: 'MULTITONE', color: rgba(0, 0, 0, 1), visible: true,
      blendMode: 'NORMAL', noiseSize: 2, density: 0.5, opacity: 0.4,
    }) as Extract<EffectLayer, { type: 'noise' }>;
    expect(multi.opacity).toBe(0.4);
  });

  it('reads texture and glass', () => {
    expect(effectLayerOf({
      type: 'TEXTURE', visible: true, noiseSize: 3, radius: 1, clipToShape: true,
      noiseSizeVector: { x: 3, y: 4 },
    })).toEqual({
      type: 'texture', visible: true, noiseSize: 3, radius: 1, clipToShape: true,
      noiseSizeVector: { x: 3, y: 4 },
    });
    expect(effectLayerOf({
      type: 'GLASS', visible: true, radius: 6, lightIntensity: 0.5, lightAngle: 45,
      refraction: 0.2, depth: 2, dispersion: 0.1,
    })).toEqual({
      type: 'glass', visible: true, radius: 6, lightIntensity: 0.5, lightAngle: 45,
      refraction: 0.2, depth: 2, dispersion: 0.1,
    });
  });

  it('reports a type it cannot model instead of dropping it', () => {
    // Noise, texture and glass were all recent additions. A runtime can hand us
    // a type this union does not know, and silently dropping it would
    // reintroduce exactly the truncation this whole change exists to remove.
    expect(effectLayerOf({ type: 'HOLOGRAM', visible: true }))
      .toEqual({ type: 'unknown', figma_type: 'HOLOGRAM' });
  });

  it('attaches a binding to its field, not to the layer', () => {
    const l = effectLayerOf({
      type: 'DROP_SHADOW', color: rgba(0, 0, 0, 0.08), offset: { x: 0, y: 2 },
      radius: 4, spread: 0, visible: true, blendMode: 'NORMAL',
    }, {
      color: { id: 'VariableID:5', name: 'color/shadow/default', kind: 'variable', remote: false },
    }) as Extract<EffectLayer, { type: 'drop-shadow' }>;
    expect(l.bindings?.color?.name).toBe('color/shadow/default');
    // The geometry survives alongside the binding. A shadow with a bound colour
    // and a hardcoded radius used to count as fully bound and lose all four
    // numbers.
    expect(l.radius).toBe(4);
    expect(l.offset).toEqual({ x: 0, y: 2 });
  });

  it('rounds alpha to four decimals and geometry to two', () => {
    const l = effectLayerOf({
      type: 'DROP_SHADOW', color: rgba(0, 0, 0, 0.03999999910593033),
      offset: { x: 0, y: 2.0000001 }, radius: 4.239999999, visible: true, blendMode: 'NORMAL',
    }) as Extract<EffectLayer, { type: 'drop-shadow' }>;
    expect(l.color.alpha).toBe(0.04);
    expect(l.radius).toBe(4.24);
    expect(l.offset.y).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/extractor/test/effects.test.ts`
Expected: FAIL — `Cannot find module '../src/effects'`.

- [ ] **Step 3: Write `effects.ts`**

```ts
/**
 * effects.ts — the effect layer model, and the pure converter from Figma's own
 * effect shapes into it.
 *
 * Pure and Figma-free, like everything else in this package: `effectLayerOf`
 * takes a structurally-typed plain object, so the plugin's serializers can hand
 * it a live `Effect` and a test can hand it a literal.
 */
import type { RefIdentity } from './tree';

/** A colour with its opacity, both already rounded. */
export interface Rgba { hex: string; alpha: number }
export interface Vec2 { x: number; y: number }

/** The fields Figma lets a variable bind on an effect
 *  (`VariableBindableEffectField`). Blurs accept only `radius`; noise, texture
 *  and glass accept none, and their own typings declare `boundVariables?: {}`. */
export type EffectField = 'color' | 'radius' | 'spread' | 'offsetX' | 'offsetY';
export type EffectBindings = Partial<Record<EffectField, RefIdentity>>;

/**
 * One effect layer.
 *
 * Nine concrete shapes plus `unknown`, matching Figma's `Effect` union exactly.
 * `radius` is deliberately NOT universal: `NoiseEffectBase` has no radius field,
 * and a union that fabricated one to look rectangular would be inventing a
 * measurement nobody made.
 *
 * Bindings attach to their FIELD, never to the layer, because that is where
 * Figma puts them: node-level `boundVariables.effects` is a flat `VariableAlias[]`
 * with no field or layer identity, while the real per-field bindings sit on each
 * effect object.
 */
export type EffectLayer =
  | { type: 'drop-shadow' | 'inner-shadow'; visible: boolean; blendMode: string;
      color: Rgba; offset: Vec2; radius: number; spread?: number;
      showShadowBehindNode?: boolean; bindings?: EffectBindings }
  | { type: 'layer-blur' | 'background-blur'; blurType: 'normal';
      visible: boolean; radius: number; bindings?: { radius?: RefIdentity } }
  | { type: 'layer-blur' | 'background-blur'; blurType: 'progressive';
      visible: boolean; radius: number;
      startRadius: number; startOffset: Vec2; endOffset: Vec2;
      bindings?: { radius?: RefIdentity } }
  | { type: 'noise'; noiseType: 'monotone' | 'duotone' | 'multitone';
      visible: boolean; blendMode: string; color: Rgba; noiseSize: number;
      density: number; secondaryColor?: Rgba; opacity?: number }
  | { type: 'texture'; visible: boolean; noiseSize: number;
      noiseSizeVector?: Vec2; radius: number; clipToShape: boolean }
  | { type: 'glass'; visible: boolean; radius: number; lightIntensity: number;
      lightAngle: number; refraction: number; depth: number; dispersion: number }
  | { type: 'unknown'; figma_type: string };

/** Whatever a runtime hands us. Structurally typed so this module needs no
 *  Figma globals and no @figma/plugin-typings dependency. */
export interface RawEffect { type: string; [k: string]: unknown }

/**
 * Trim binary-float noise off a measurement.
 *
 * Figma stores these as doubles derived from percentage and pixel inputs, so a
 * line height typed as 140 arrives as 139.9999976158142 and an alpha of 4%
 * as 0.03999999910593033. Emitted raw, an agent reproduces the noise verbatim
 * in generated CSS.
 *
 * Two places, two precisions. Geometry gets 2 decimals, which is past any
 * precision a type ramp or a shadow expresses while keeping a real 137.5 intact.
 * Alpha gets 4, because Figma's own percent field can express 0.125 and two
 * decimals would silently round it to 0.13.
 */
export const roundN = (n: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

const round2 = (n: number): number => roundN(n, 2);

const hex2 = (c: number): string => Math.round(c * 255).toString(16).padStart(2, '0');

const rgbaOf = (c: { r: number; g: number; b: number; a: number }): Rgba => ({
  hex: `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`,
  alpha: roundN(c.a, 4),
});

const vec2Of = (v: { x: number; y: number }): Vec2 => ({ x: round2(v.x), y: round2(v.y) });

const NOISE_TYPES: Record<string, 'monotone' | 'duotone' | 'multitone'> = {
  MONOTONE: 'monotone', DUOTONE: 'duotone', MULTITONE: 'multitone',
};

/**
 * One raw effect as an EffectLayer.
 *
 * `bindings` is supplied by the caller rather than read here, because resolving
 * a variable id to a name is asynchronous and Figma-side; this function stays
 * pure so every shape can be covered from a literal.
 *
 * An unrecognized `type` becomes `{ type: 'unknown', figma_type }` rather than
 * being dropped. Noise, texture and glass are recent additions and there will be
 * more; a shape we cannot describe is still worth making visible.
 */
export function effectLayerOf(raw: RawEffect, bindings?: EffectBindings): EffectLayer {
  const r = raw as Record<string, never> & RawEffect;
  const visible = Boolean(r.visible);
  const bound = bindings && Object.keys(bindings).length > 0 ? { bindings } : {};

  switch (raw.type) {
    case 'DROP_SHADOW':
    case 'INNER_SHADOW': {
      const shadow = raw as unknown as {
        color: { r: number; g: number; b: number; a: number };
        offset: { x: number; y: number }; radius: number; spread?: number;
        blendMode: string; showShadowBehindNode?: boolean;
      };
      return {
        type: raw.type === 'DROP_SHADOW' ? 'drop-shadow' : 'inner-shadow',
        visible,
        blendMode: String(shadow.blendMode),
        color: rgbaOf(shadow.color),
        offset: vec2Of(shadow.offset),
        radius: round2(shadow.radius),
        // Optional on Figma's own type. An absent spread is an absent key, not
        // a fabricated 0, so a reader cannot mistake "not set" for "set to 0".
        ...(shadow.spread !== undefined ? { spread: round2(shadow.spread) } : {}),
        ...(shadow.showShadowBehindNode !== undefined
          ? { showShadowBehindNode: shadow.showShadowBehindNode } : {}),
        ...bound,
      };
    }
    case 'LAYER_BLUR':
    case 'BACKGROUND_BLUR': {
      const blur = raw as unknown as {
        radius: number; blurType?: string;
        startRadius?: number; startOffset?: { x: number; y: number };
        endOffset?: { x: number; y: number };
      };
      const type = raw.type === 'LAYER_BLUR' ? 'layer-blur' as const : 'background-blur' as const;
      const radiusBinding = bindings?.radius ? { bindings: { radius: bindings.radius } } : {};
      if (blur.blurType === 'PROGRESSIVE' && blur.startOffset && blur.endOffset) {
        return {
          type, blurType: 'progressive', visible, radius: round2(blur.radius),
          startRadius: round2(blur.startRadius ?? 0),
          startOffset: vec2Of(blur.startOffset),
          endOffset: vec2Of(blur.endOffset),
          ...radiusBinding,
        };
      }
      return { type, blurType: 'normal', visible, radius: round2(blur.radius), ...radiusBinding };
    }
    case 'NOISE': {
      const noise = raw as unknown as {
        noiseType: string; color: { r: number; g: number; b: number; a: number };
        blendMode: string; noiseSize: number; density: number;
        secondaryColor?: { r: number; g: number; b: number; a: number };
        opacity?: number;
      };
      const noiseType = NOISE_TYPES[noise.noiseType];
      // An unknown noiseType is an unknown shape, reported as one rather than
      // guessed at: the secondary colour and opacity fields differ per subtype.
      if (!noiseType) return { type: 'unknown', figma_type: `NOISE/${noise.noiseType}` };
      return {
        type: 'noise', noiseType, visible,
        blendMode: String(noise.blendMode),
        color: rgbaOf(noise.color),
        noiseSize: round2(noise.noiseSize),
        density: round2(noise.density),
        ...(noise.secondaryColor ? { secondaryColor: rgbaOf(noise.secondaryColor) } : {}),
        ...(noise.opacity !== undefined ? { opacity: roundN(noise.opacity, 4) } : {}),
      };
    }
    case 'TEXTURE': {
      const tex = raw as unknown as {
        noiseSize: number; noiseSizeVector?: { x: number; y: number };
        radius: number; clipToShape: boolean;
      };
      return {
        type: 'texture', visible,
        noiseSize: round2(tex.noiseSize),
        ...(tex.noiseSizeVector ? { noiseSizeVector: vec2Of(tex.noiseSizeVector) } : {}),
        radius: round2(tex.radius),
        clipToShape: Boolean(tex.clipToShape),
      };
    }
    case 'GLASS': {
      const g = raw as unknown as {
        radius: number; lightIntensity: number; lightAngle: number;
        refraction: number; depth: number; dispersion: number;
      };
      return {
        type: 'glass', visible,
        radius: round2(g.radius),
        lightIntensity: round2(g.lightIntensity),
        lightAngle: round2(g.lightAngle),
        refraction: round2(g.refraction),
        depth: round2(g.depth),
        dispersion: round2(g.dispersion),
      };
    }
    default:
      return { type: 'unknown', figma_type: raw.type };
  }
}
```

- [ ] **Step 4: Export it and widen `SerializedNode`**

`packages/extractor/src/index.ts`, after the `tree` export:

```ts
export * from './effects';
```

`packages/extractor/src/tree.ts`, on `SerializedNode` beside `hasUnboundEffect`:

```ts
  /** The node's own effect layers, present when the node has effects and no
   *  effect style. `hasUnboundEffect` still reports the gap; this reports what
   *  the gap is made of. Additive: excluded from specContentHash, same contract
   *  as rawValues. */
  effects?: EffectLayer[];
```

with `import type { EffectLayer } from './effects';` at the top.

- [ ] **Step 5: Widen the serializer's read shape**

`packages/plugin/src/serialize.ts:37`, replacing `effects?: Array<{ type: string }>`:

```ts
  // The whole effect object, not just its type. Reading only `.length` is what
  // made a shadow with a variable-bound colour and hardcoded radius, offset and
  // spread count as fully bound while silently dropping every geometry value.
  effects?: RawEffect[];
```

with `RawEffect` added to the `@spec-layer/extractor` type import on line 1. Nothing reads the new fields yet — Task 8 does.

- [ ] **Step 6: Run**

Run: `npm run check`
Expected: PASS. No output changed; both hashes and the golden brief are untouched.

- [ ] **Step 7: Commit**

```bash
git add -A packages/extractor packages/plugin && git commit -m "$(cat <<'EOF'
feat(extractor): the complete effect layer union

serialize.ts typed effects as Array<{ type: string }> and read only .length,
so every geometry value was dropped. Figma's Effect is nine concrete shapes,
not four: BlurEffect and NoiseEffect are themselves unions.

radius is not universal (NoiseEffectBase has none), so the union reflects that
rather than fabricating one, and an unrecognized type lands as
{ type: 'unknown', figma_type } rather than being dropped.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Effect styles reach the foundation (B2)

Mirrors `textStyles` at every layer.

**Files:**
- Modify: `packages/extractor/src/foundation.ts` (`RawEffectStyle`, `SerializedFoundation`, `FoundationEffectStyle`, `FoundationSpec`, `buildFoundation`, `narrowFoundation`)
- Modify: `packages/plugin/src/serializeFoundation.ts` (`ReaderEffectStyle`, `FoundationReader.effectStyles`, the read)
- Modify: `packages/plugin/src/main.ts` (the real reader)
- Test: `packages/extractor/test/foundation.test.ts`, `packages/plugin/test/serializeFoundation.test.ts`

**Interfaces:**
- Consumes: `EffectLayer`, `effectLayerOf` (Task 6); `FoundationRead` (Task 5).
- Produces:
  - `interface RawEffectStyle { name: string; description: string; effects: EffectLayer[] }`
  - `SerializedFoundation.effectStyles: RawEffectStyle[]`
  - `interface FoundationEffectStyle extends RawEffectStyle { group: string }`
  - `FoundationSpec.effectStyles: FoundationEffectStyle[]`
  - `FoundationReader.effectStyles(): Promise<ReaderEffectStyle[]>`
  - `interface ReaderEffectStyle { name: string; description: string; effects: RawEffect[] }`

Both new arrays are REQUIRED, not optional, exactly as `textStyles` is: an optional array would let a caller forget it and produce a spec that silently claims a file has no effect styles.

- [ ] **Step 1: Write the failing tests**

Append to `packages/extractor/test/foundation.test.ts`:

```ts
describe('effect styles', () => {
  const withEffects = (): SerializedFoundation => ({
    fileKey: 'FILE1', extractedAt: 'T', externals: [], collections: [], textStyles: [],
    effectStyles: [{
      name: 'Focused/Primary', description: 'Focus ring.',
      effects: [{
        type: 'drop-shadow', visible: true, blendMode: 'NORMAL',
        color: { hex: '#722ed1', alpha: 0.2 }, offset: { x: 0, y: 0 },
        radius: 4, spread: 2,
      }],
    }],
  });

  it('groups an effect style by its top-level path segment', () => {
    const spec = buildFoundation(withEffects());
    expect(spec.effectStyles[0].group).toBe('Focused');
    expect(spec.effectStyles[0].effects[0].type).toBe('drop-shadow');
  });

  it('narrows effect styles away exactly as it narrows text styles', () => {
    const spec = buildFoundation({ ...withEffects(), textStyles: [] });
    // A collection copy covers one collection. Carrying the file's effect
    // styles into it would make a scoped copy quietly wider than its scope.
    const narrowed = narrowFoundation(spec, { target: 'textStyles' });
    expect(narrowed?.effectStyles).toEqual([]);
  });
});
```

Append to `packages/plugin/test/serializeFoundation.test.ts`:

```ts
describe('effect styles', () => {
  it('converts each style layer through the shared effect union', async () => {
    const reader = fakeReader({
      effectStyles: async () => [{
        name: 'Focused/Primary', description: '',
        effects: [{
          type: 'DROP_SHADOW', color: { r: 0.447, g: 0.18, b: 0.82, a: 0.2 },
          offset: { x: 0, y: 0 }, radius: 4, spread: 2, visible: true, blendMode: 'NORMAL',
        }],
      }],
    });
    const dump = await serializeFoundation(reader, 'FILE1', 'T');
    expect(dump.effectStyles[0].effects[0]).toEqual({
      type: 'drop-shadow', visible: true, blendMode: 'NORMAL',
      color: { hex: '#722ed1', alpha: 0.2 }, offset: { x: 0, y: 0 },
      radius: 4, spread: 2,
    });
  });

  it('records an effect styles read that threw', async () => {
    const reader = fakeReader({ effectStyles: async () => { throw new Error('nope'); } });
    const dump = await serializeFoundation(reader, 'FILE1', 'T');
    expect(dump.effectStyles).toEqual([]);
    expect(dump.unavailable).toEqual(['effectStyles']);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/extractor/test/foundation.test.ts packages/plugin/test/serializeFoundation.test.ts`
Expected: FAIL — `effectStyles` is not a property of either type.

- [ ] **Step 3: Add the foundation types**

In `foundation.ts`, after `RawTextStyle`:

```ts
/**
 * One effect style from the file, with each layer already converted through the
 * shared EffectLayer union.
 *
 * Per-field variable bindings on a style's layers are deliberately NOT resolved
 * here. Node-level inline effects carry them (see extractNodeEffects); a style
 * layer emits its literal values. Resolving them would need `remote` on
 * ReaderVariable and a second resolution path for a case the design does not
 * cover; when that changes, this comment is the place to start.
 */
export interface RawEffectStyle {
  name: string;
  description: string;
  effects: EffectLayer[];
}
```

with `import type { EffectLayer } from './effects';` at the top.

Add to `SerializedFoundation`, beside `textStyles`:

```ts
  effectStyles: RawEffectStyle[];
```

After `FoundationTextStyle`:

```ts
export interface FoundationEffectStyle extends RawEffectStyle { group: string }
```

Add to `FoundationSpec`, beside `textStyles`:

```ts
  effectStyles: FoundationEffectStyle[];
```

- [ ] **Step 4: Build and narrow them**

`buildFoundation`'s return gains:

```ts
    effectStyles: dump.effectStyles.map((s) => ({ ...s, group: groupOf(s.name) })),
```

`narrowFoundation` sets `effectStyles: []` on BOTH branches:

```ts
  if (target.target === 'textStyles') {
    if (spec.textStyles.length === 0) return null;
    // Effect styles are narrowed away here as well as on the collection branch:
    // FoundationCopyTarget has no effect-styles target, so no scoped copy claims
    // to cover them and the whole-file copy is where they appear.
    return { ...spec, collections: [], textStyles: spec.textStyles, effectStyles: [], narrowedTo: target };
  }
  const collection = spec.collections.find((c) => c.id === target.collectionId);
  if (!collection) return null;
  return { ...spec, collections: [collection], textStyles: [], effectStyles: [], narrowedTo: target };
```

- [ ] **Step 5: Read them in the plugin**

`serializeFoundation.ts`, after `ReaderTextStyle`:

```ts
export interface ReaderEffectStyle {
  name: string;
  description: string;
  effects: RawEffect[];
}
```

and on `FoundationReader`:

```ts
  effectStyles(): Promise<ReaderEffectStyle[]>;
```

In `serializeFoundation`, beside the text-styles read:

```ts
  let readerEffects: ReaderEffectStyle[] = [];
  try {
    readerEffects = await reader.effectStyles();
  } catch {
    unavailable.push('effectStyles');
  }
  const effectStyles: RawEffectStyle[] = readerEffects.map((rs) => ({
    name: rs.name,
    description: rs.description,
    effects: rs.effects.map((e) => effectLayerOf(e)),
  }));
```

and add `effectStyles` to the return. Import `effectLayerOf` and the two types from `@spec-layer/extractor`.

`main.ts`'s `foundationReader` gains:

```ts
  async effectStyles() {
    const styles = await figma.getLocalEffectStylesAsync();
    return styles.map((s) => ({
      name: s.name,
      description: s.description ?? '',
      // Handed to effectLayerOf as-is: it is structurally typed for exactly this,
      // which is what keeps the effect union in the extractor rather than here.
      effects: s.effects as unknown as RawEffect[],
    }));
  },
```

- [ ] **Step 6: Update every construction site**

Adding a required `effectStyles` to `SerializedFoundation` and `FoundationSpec` breaks every literal that builds one. Find them:

```bash
npx tsc -p packages/extractor/tsconfig.json --noEmit; npx tsc -p packages/plugin/tsconfig.json --noEmit
```

Add `effectStyles: []` to each reported literal. Expect hits in `packages/extractor/test/{foundation,foundationHash,narrowFoundation,brief}.test.ts` and `packages/plugin/test/{serializeFoundation,foundationHost,foundationFrame,foundationState,copyFoundation}.test.ts`, plus `fakeReader` in `serializeFoundation.test.ts` needing an `effectStyles: async () => []` default.

- [ ] **Step 7: Run**

Run: `npm run check`
Expected: PASS. `foundationContentHash` is unmoved — Task 1's widening guard proves it structurally, and `foundationHash.test.ts`'s pinned constant proves it on the fixture.

- [ ] **Step 8: Commit**

```bash
git add -A packages/extractor packages/plugin && git commit -m "$(cat <<'EOF'
feat(extractor): effect styles reach the foundation

serialize.ts turned effectStyleId into a binding carrying the style's NAME and
nothing extracted what the style contained, so lookupToken walked the variables,
found nothing, and returned {}. FoundationSpec now carries effectStyles the way
it carries textStyles, at every layer.

Clipboard only: unitContent builds explicit row objects, so putting effects on
canvas would mean putting them in the drift hash.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Inline node effects, with per-field bindings (B3)

**Files:**
- Modify: `packages/plugin/src/serialize.ts:136-138` (`hasUnboundEffect`, plus the new `effects` emit)
- Modify: `packages/extractor/src/effects.ts` (`NodeEffects`, `extractNodeEffects`)
- Modify: `packages/extractor/src/extract.ts` (`IntermediateSpec.nodeEffects`)
- Modify: `packages/extractor/src/hash.ts:34` (destructure it out)
- Test: `packages/plugin/test/serialize.test.ts`, `packages/extractor/test/effects.test.ts`, `packages/extractor/test/specHash.test.ts`

**Interfaces:**
- Consumes: `EffectLayer`, `effectLayerOf`, `EffectBindings` (Task 6); `NodeResolver.variable` (Task 2); `variableRef` (Task 3).
- Produces:
  - `interface NodeEffects { part: string; path: string; effects: EffectLayer[] }`
  - `function extractNodeEffects(root: SerializedNode): NodeEffects[]`
  - `IntermediateSpec.nodeEffects: NodeEffects[]`

`hasUnboundEffect` keeps its EXACT current firing conditions. It is what `tokens.ts:612` keys the gap on, and `gaps` is inside `specContentHash`, so changing when it fires would move every committed baseline. The richer data rides the hash-excluded channel instead.

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugin/test/serialize.test.ts`:

```ts
describe('inline node effects', () => {
  const shadow = (over: Record<string, unknown> = {}) => ({
    type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 2 },
    radius: 4, spread: 0, visible: true, blendMode: 'NORMAL', ...over,
  });

  it('emits the layers when the node has effects and no effect style', async () => {
    const r = { variable: async () => null, style: async () => null, mainComponent: async () => null };
    const out = await serializeNode(
      { id: '1', name: 'N', type: 'FRAME', effects: [shadow()] } as never, r,
    );
    expect(out.effects).toHaveLength(1);
    expect(out.effects![0]).toMatchObject({ type: 'drop-shadow', radius: 4, spread: 0 });
    // Unchanged semantics: a fully hardcoded effect is still an unbound effect.
    expect(out.hasUnboundEffect).toBe(true);
  });

  it('emits the layers for a PARTIALLY bound shadow, and still reports no gap', async () => {
    const r = {
      variable: async (id: string) => ({
        id, name: 'color/shadow/default', remote: false, collectionId: 'VariableCollectionId:1',
      }),
      style: async () => null,
      mainComponent: async () => null,
    };
    const out = await serializeNode({
      id: '1', name: 'N', type: 'FRAME',
      effects: [shadow({ boundVariables: { color: { id: 'VariableID:5' } } })],
      boundVariables: { effects: [{ id: 'VariableID:5' }] },
    } as never, r);
    // hasUnboundEffect keeps its exact current semantics: `effects` is in bv, so
    // no gap. That flag is inside specContentHash and must not move.
    expect('hasUnboundEffect' in out).toBe(false);
    // The geometry survives anyway, which is the whole point: a bound colour used
    // to make Figma report the layer as fully bound and drop radius, offset and
    // spread with nothing saying so.
    expect(out.effects![0]).toMatchObject({ radius: 4, spread: 0, offset: { x: 0, y: 2 } });
    expect((out.effects![0] as { bindings?: { color?: { name: string } } }).bindings?.color?.name)
      .toBe('color/shadow/default');
  });

  it('emits nothing when an effect STYLE governs the node', async () => {
    const r = {
      variable: async () => null,
      style: async (id: string) => ({ id, name: 'Focused/Primary', remote: false, kind: 'effect-style' as const }),
      mainComponent: async () => null,
    };
    const out = await serializeNode({
      id: '1', name: 'N', type: 'FRAME', effects: [shadow()], effectStyleId: 'S:effect,1:1',
    } as never, r);
    // The style name is the pointer, and the style's own layers are extracted
    // once in the foundation. Inlining them here would give the brief two owners
    // for the same values.
    expect('effects' in out).toBe(false);
  });
});
```

Append to `packages/extractor/test/effects.test.ts`:

```ts
describe('extractNodeEffects', () => {
  it('records one entry per node carrying effects, keyed by path', () => {
    const root = {
      id: '1:1', name: 'Card', type: 'COMPONENT', visible: true,
      children: [{
        id: '1:2', name: 'Wrapper', type: 'FRAME', visible: true,
        effects: [{ type: 'drop-shadow', visible: true, blendMode: 'NORMAL',
          color: { hex: '#000000', alpha: 0.08 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0 }],
      }],
    } as unknown as SerializedNode;
    expect(extractNodeEffects(root)).toEqual([
      { part: 'Wrapper', path: 'Card/Wrapper', effects: root.children![0].effects },
    ]);
  });
});
```

Append to `packages/extractor/test/specHash.test.ts`:

```ts
it('is unchanged by nodeEffects', () => {
  const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json', 'utf8'));
  const spec = extract(node, { figmaFile: 'FILE1' });
  const withEffects = {
    ...spec,
    nodeEffects: [{ part: 'Container', path: 'Container', effects: [{ type: 'unknown', figma_type: 'X' }] }],
  };
  // Same contract as rawValues: additive detail that alters no rendered output
  // must never mark a committed document as drifted.
  expect(specContentHash(withEffects as typeof spec)).toBe(BUTTON_HASH);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/plugin/test/serialize.test.ts packages/extractor/test/effects.test.ts packages/extractor/test/specHash.test.ts`
Expected: FAIL — `out.effects` undefined, `extractNodeEffects` not exported, `nodeEffects` unknown.

- [ ] **Step 3: Emit layers from the serializer**

Replace `serialize.ts:136-138`:

```ts
  const rawEffects = node.effects ?? [];
  const hasEffects = rawEffects.length > 0;
  const effectStyled = typeof node.effectStyleId === 'string' && Boolean(node.effectStyleId);
  // UNCHANGED semantics, deliberately. hasUnboundEffect is what extractGaps
  // keys the `effects` gap on, and gaps are inside specContentHash. Changing
  // when this fires would move every committed document's drift baseline for a
  // change that adds detail rather than altering a verdict.
  const effectsBound = 'effects' in bv || effectStyled;
  const hasUnboundEffect = hasEffects && !effectsBound ? true : undefined;

  // The layers themselves, whenever the node has effects and no effect STYLE --
  // not only when nothing is bound. A style name is a pointer to a definition
  // extracted once in the foundation; a node-level effect has no name to point
  // at, so it is inlined. Per-field bindings are read from each effect's own
  // boundVariables, which is where Figma actually puts them: node-level
  // boundVariables.effects is a flat VariableAlias[] with no field or layer
  // identity at all.
  let effects: EffectLayer[] | undefined;
  if (hasEffects && !effectStyled) {
    effects = [];
    for (const raw of rawEffects) {
      const bv2 = (raw as { boundVariables?: Record<string, { id?: string }> }).boundVariables ?? {};
      const bindings: EffectBindings = {};
      for (const field of EFFECT_FIELDS) {
        const id = bv2[field]?.id;
        if (!id) continue;
        const v = await resolver.variable(id);
        if (v) bindings[field] = variableRef(v);
      }
      effects.push(effectLayerOf(raw, bindings));
    }
  }
```

with, near the top of the file:

```ts
/** VariableBindableEffectField. Shadows accept all five; blurs accept `radius`
 *  alone; noise, texture and glass accept none and declare `boundVariables?: {}`.
 *  Reading all five off every effect is safe because an effect that cannot bind
 *  a field simply has no entry for it. */
const EFFECT_FIELDS = ['color', 'radius', 'spread', 'offsetX', 'offsetY'] as const;
```

and `effects` spread into the result object beside `hasUnboundEffect`:

```ts
    ...(effects && effects.length > 0 ? { effects } : {}),
```

Import `EffectLayer`, `EffectBindings` and `effectLayerOf` from `@spec-layer/extractor`.

- [ ] **Step 4: Extract them**

Append to `packages/extractor/src/effects.ts`:

```ts
/** One node's effect layers, joined to everything else by `path`. */
export interface NodeEffects {
  part: string;
  path: string;
  effects: EffectLayer[];
}

/**
 * Effect layers on the DEFAULT variant, path-keyed.
 *
 * Walks exactly the way extractGaps does (default variant, hidden subtrees
 * INCLUDED) so an entry here and a gap there always describe the same set of
 * nodes. rawValues walks with skipInvisible and would not line up.
 */
export function extractNodeEffects(root: SerializedNode): NodeEffects[] {
  const out: NodeEffects[] = [];
  const def = defaultVariant(root);
  walkParts(def, root.type === 'COMPONENT_SET' ? 'Container' : cleanPartName(def.name),
    (n, part, path) => {
      if (n.effects && n.effects.length > 0) out.push({ part, path, effects: n.effects });
    });
  return out;
}
```

with `import { defaultVariant } from './anatomy';`, `import { cleanPartName, walkParts } from './naming';` and `import type { SerializedNode } from './tree';` added to the file's imports.

- [ ] **Step 5: Put it on the spec and out of the hash**

`extract.ts`, on `IntermediateSpec`:

```ts
  /** Effect layers on the default variant. Additive: never included in
   *  specContentHash, same contract as rawValues. Joined to `gaps` and
   *  `tokens` on (path, property) -- never on path alone, because one node
   *  routinely has several unbound rows (fill, border, effects, spacing) at
   *  the same path. */
  nodeEffects: NodeEffects[];
```

and in `extract()`'s return: `nodeEffects: extractNodeEffects(root),`.

`hash.ts:34`:

```ts
  const {
    rawValues: _rawValues,
    figmaFileName: _figmaFileName,
    // Same contract as rawValues: additive detail that alters no rendered
    // output, so including it would flip every committed document to "update
    // available" for a change nobody can see on canvas.
    nodeEffects: _nodeEffects,
    ...rest
  } = spec;
```

- [ ] **Step 6: Run**

Run: `npm run check`
Expected: PASS. `BUTTON_HASH` and `CHIP_HASH` unchanged.

- [ ] **Step 7: Commit**

```bash
git add -A packages/extractor packages/plugin && git commit -m "$(cat <<'EOF'
feat(extractor): inline node effects with per-field bindings

Because effectsBound was `'effects' in bv || effectStyleId`, a shadow with a
variable-bound colour and a hardcoded radius, offset and spread counted as
fully bound: no gap was raised, the variable name was emitted with nothing
saying what it bound, and every geometry value was silently dropped.

The layers now ride a hash-excluded channel beside rawValues, so a partially
bound layer becomes visible without any committed document drifting.
hasUnboundEffect keeps its exact firing conditions.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `resolution` replaces every bare `{}` (B4, B5)

**Files:**
- Create: `packages/extractor/src/resolution.ts`
- Create: `packages/extractor/test/resolution.test.ts`
- Modify: `packages/extractor/src/index.ts` (export)
- Modify: `packages/extractor/src/brief.ts` (`tokensOf`, `typographyOf`, a new `effectsOf`, `componentBrief`)
- Test: `packages/extractor/test/brief.test.ts`

**Interfaces:**
- Consumes: `RefIdentity`, `RefKind` (Task 3); `FoundationSpec.unavailable`/`narrowedTo` (Task 5); `FoundationSpec.effectStyles` (Task 7).
- Produces:
  - `type ResolutionStatus = 'external' | 'not-extracted' | 'unavailable' | 'not-in-snapshot' | 'not-in-scope' | 'no-foundation'`
  - `interface Resolution { status: ResolutionStatus; reason: string }`
  - `function resolutionOf(foundation: FoundationSpec | undefined, ref: RefIdentity): Resolution`

- [ ] **Step 1: Write the failing tests**

Create `packages/extractor/test/resolution.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolutionOf, type ResolutionStatus } from '../src/resolution';
import { buildFoundation, narrowFoundation, type FoundationSpec } from '../src/foundation';
import type { RefIdentity } from '../src/tree';

const ref = (over: Partial<RefIdentity> = {}): RefIdentity => ({
  id: 'VariableID:1', name: 'color/brand', kind: 'variable', remote: false, ...over,
});

const spec = (): FoundationSpec => buildFoundation({
  fileKey: 'FILE1', extractedAt: 'T', externals: [], textStyles: [], effectStyles: [],
  collections: [{
    id: 'c1', name: 'Semantic', defaultModeId: 'm1', modes: [{ modeId: 'm1', name: 'Light' }],
    variables: [{ id: 'VariableID:1', name: 'color/brand', resolvedType: 'COLOR',
      description: '', codeSyntax: {}, valuesByMode: { m1: { r: 0, g: 0, b: 0, a: 1 } } }],
  }],
});

describe('resolutionOf', () => {
  it('reports a remote resource as external, from Figma and not from a lookup', () => {
    const r = resolutionOf(spec(), ref({ remote: true, name: 'color/surface/primary/opacity-focus' }));
    expect(r.status).toBe('external');
    expect(r.reason).toContain('library');
  });

  it('reports a paint style as not extracted whatever its remoteness', () => {
    for (const remote of [true, false]) {
      // Kind-determined, checked before `remote`, so every paint style gets the
      // same answer. There is no table to look in either way, and "we do not
      // extract these" is the actionable half.
      expect(resolutionOf(spec(), ref({ kind: 'paint-style', remote })).status)
        .toBe('not-extracted');
    }
  });

  it('reports a read that failed as unavailable, not as an empty file', () => {
    const s = { ...spec(), unavailable: ['effectStyles' as const] };
    expect(resolutionOf(s, ref({ kind: 'effect-style', id: 'S:1' })).status).toBe('unavailable');
  });

  it('reports a scope exclusion separately from an absence', () => {
    const narrowed = narrowFoundation(spec(), { target: 'textStyles' })!;
    const r = resolutionOf(narrowed, ref({ collectionId: 'c1' }));
    expect(r.status).toBe('not-in-scope');
  });

  it('reports a local resource missing from the cached dump as not in snapshot', () => {
    const r = resolutionOf(spec(), ref({ id: 'VariableID:99', name: 'color/new' }));
    expect(r.status).toBe('not-in-snapshot');
    expect(r.reason).toMatch(/read the foundations again/i);
  });

  it('reports no foundation at all as its own status', () => {
    expect(resolutionOf(undefined, ref()).status).toBe('no-foundation');
  });

  it('has exactly six statuses and no `missing`', () => {
    // A binding's name comes from Figma resolving a real id, so a name pointing
    // at nothing is unreachable, and this codebase does not emit findings that
    // cannot occur.
    const all: ResolutionStatus[] = ['external', 'not-extracted', 'unavailable',
      'not-in-snapshot', 'not-in-scope', 'no-foundation'];
    expect(all).toHaveLength(6);
  });

  it('writes no em dash or en dash in any reason', () => {
    const reasons = [
      resolutionOf(undefined, ref()),
      resolutionOf(spec(), ref({ remote: true })),
      resolutionOf(spec(), ref({ kind: 'paint-style' })),
      resolutionOf({ ...spec(), unavailable: ['variables' as const] }, ref()),
      resolutionOf(narrowFoundation(spec(), { target: 'textStyles' })!, ref()),
      resolutionOf(spec(), ref({ id: 'VariableID:99' })),
    ].map((r) => r.reason);
    for (const reason of reasons) expect(reason).not.toMatch(/[–—]/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/extractor/test/resolution.test.ts`
Expected: FAIL — `Cannot find module '../src/resolution'`.

- [ ] **Step 3: Write `resolution.ts`**

```ts
/**
 * resolution.ts — why a reference could not be resolved, stated as a fact.
 *
 * Absence from local foundation data has at least six causes, and a name-only
 * lookup collapses them into one bare `{}`. Every status here is decided from
 * something Figma or this codebase RECORDED, never inferred from a lookup that
 * found nothing:
 *
 * | status           | decided by                                          |
 * |------------------|-----------------------------------------------------|
 * | not-extracted    | `kind` is `paint-style`. No table exists to look in. |
 * | external         | `remote: true` from Figma. Not inferred.            |
 * | no-foundation    | The caller passed none, as the drift path does.     |
 * | unavailable      | serializeFoundation recorded that read as failed.   |
 * | not-in-scope     | `narrowedTo` excludes it.                            |
 * | not-in-snapshot  | Local, not remote, absent from the cached dump.     |
 *
 * There is deliberately no `missing`. A reference's name comes from Figma
 * resolving a real id, so a name pointing at nothing is unreachable, and this
 * codebase does not emit findings that cannot occur (see validate.ts).
 */
import type { FoundationSpec, FoundationRead, FoundationCopyTarget } from './foundation';
import type { RefIdentity, RefKind } from './tree';

export type ResolutionStatus =
  | 'external' | 'not-extracted' | 'unavailable'
  | 'not-in-snapshot' | 'not-in-scope' | 'no-foundation';

export interface Resolution { status: ResolutionStatus; reason: string }

/** Which foundation read backs each kind. Paint styles have none: that is the
 *  whole content of `not-extracted`. */
const READ_OF: Record<RefKind, FoundationRead | null> = {
  variable: 'variables',
  'text-style': 'textStyles',
  'effect-style': 'effectStyles',
  'paint-style': null,
};

const KIND_WORD: Record<RefKind, string> = {
  variable: 'variable',
  'text-style': 'text style',
  'effect-style': 'effect style',
  'paint-style': 'paint style',
};

const READ_WORD: Record<FoundationRead, string> = {
  variables: 'variables', textStyles: 'text styles', effectStyles: 'effect styles',
};

/** What a narrowed copy covers, named from the spec it produced rather than
 *  from the target's ids, so the sentence reads the way the user's own file does. */
function scopeWord(spec: FoundationSpec, target: FoundationCopyTarget): string {
  if (target.target === 'textStyles') return 'text styles only';
  const names = spec.collections.map((c) => c.name).filter(Boolean);
  return names.length > 0 ? `the ${names.join(' and ')} collection` : 'one variable collection';
}

/** Whether a narrowed copy's target covers this kind of reference at all. */
function covers(target: FoundationCopyTarget, ref: RefIdentity): boolean {
  if (target.target === 'textStyles') return ref.kind === 'text-style';
  return ref.kind === 'variable' && ref.collectionId === target.collectionId;
}

/**
 * Why this reference has no definition in `foundation`.
 *
 * Only ever called once a lookup has already come back empty. The ORDER of the
 * checks is the design: kind-determined causes first, so every paint style gets
 * one answer whatever its remoteness; then Figma's own stated facts; then what
 * this codebase recorded about its own reads; and only last the residual
 * "local, present in the file, absent from the dump we cached".
 */
export function resolutionOf(
  foundation: FoundationSpec | undefined,
  ref: RefIdentity,
): Resolution {
  const read = READ_OF[ref.kind];
  if (read === null) {
    return { status: 'not-extracted', reason: 'paint style definitions are not extracted.' };
  }
  if (ref.remote) {
    return {
      status: 'external',
      reason: `Figma reports this ${KIND_WORD[ref.kind]} as belonging to a library.`,
    };
  }
  if (!foundation) {
    return {
      status: 'no-foundation',
      reason: 'no foundation was read, so no definition could be looked up.',
    };
  }
  if (foundation.unavailable?.includes(read)) {
    return {
      status: 'unavailable',
      reason: `the ${READ_WORD[read]} read failed, so nothing could be looked up.`,
    };
  }
  if (foundation.narrowedTo && !covers(foundation.narrowedTo, ref)) {
    return {
      status: 'not-in-scope',
      reason: `this copy covers ${scopeWord(foundation, foundation.narrowedTo)}, `
        + `which does not include this ${KIND_WORD[ref.kind]}.`,
    };
  }
  return {
    status: 'not-in-snapshot',
    reason: 'local to this file but absent from the foundation snapshot, which is read '
      + 'once per session. Read the foundations again to pick it up.',
  };
}
```

Export it from `index.ts`: `export * from './resolution';`.

- [ ] **Step 4: Write the failing brief tests**

Append to `packages/extractor/test/brief.test.ts`:

```ts
describe('tokens.used as a list', () => {
  const specWith = (refs: Array<Partial<TokenRule>>): IntermediateSpec => ({
    ...EMPTY_SPEC,
    tokens: refs.map((r) => ({
      part: 'Container', path: 'Container', property: 'fills', conditions: {},
      id: 'VariableID:1', name: 'color/brand', kind: 'variable' as const, remote: false, ...r,
    })),
  });

  it('holds a variable and an effect style that share one name', () => {
    const brief = componentBrief(specWith([
      { id: 'VariableID:1', name: 'Elevation/1', kind: 'variable', property: 'fills' },
      { id: 'S:1', name: 'Elevation/1', kind: 'effect-style', property: 'effects' },
    ]), { generatedAt: AT }) as unknown as {
      tokens: { used: Array<{ token: string; kind: string; resolution?: { status: string } }> };
    };
    // A map keyed by name cannot hold both, and a conditional key that only
    // qualifies on collision is the kind of thing that bites later.
    expect(brief.tokens.used).toHaveLength(2);
    expect(brief.tokens.used.map((u) => u.kind).sort()).toEqual(['effect-style', 'variable']);
  });

  it('gives a paint style a kind and a stated status, never a bare {}', () => {
    const brief = componentBrief(specWith([
      { id: 'S:2', name: 'Brand/Card', kind: 'paint-style', property: 'fills' },
    ]), { generatedAt: AT }) as unknown as {
      tokens: { used: Array<{ token: string; kind: string; resolution: { status: string; reason: string } }> };
    };
    expect(brief.tokens.used[0]).toEqual({
      token: 'Brand/Card', kind: 'paint-style',
      resolution: { status: 'not-extracted', reason: 'paint style definitions are not extracted.' },
    });
  });

  it('carries kind on every binding so it joins to used on (token, kind)', () => {
    const brief = componentBrief(specWith([{ kind: 'effect-style', id: 'S:1', property: 'effects' }]),
      { generatedAt: AT }) as unknown as {
        tokens: { bindings: Array<{ token: string; kind: string }> };
      };
    expect(brief.tokens.bindings[0].kind).toBe('effect-style');
  });

  it('makes a style entry a pointer, never a copy of its definition', () => {
    const foundation = foundationWithEffectStyle('Focused/Primary');
    const brief = componentBrief(specWith([
      { id: 'S:1', name: 'Focused/Primary', kind: 'effect-style', property: 'effects' },
    ]), { generatedAt: AT, foundation }) as unknown as {
      tokens: { used: Array<Record<string, unknown>> };
      effects: Record<string, { source_name: string; layers: unknown[] }>;
    };
    // Inlining would give the brief two owners for the same values, which is the
    // failure componentBrief already guards against for `unbound` vs `tokens`.
    expect(brief.tokens.used[0]).toEqual({ token: 'Focused/Primary', kind: 'effect-style' });
    expect(brief.effects['Focused/Primary'].source_name).toBe('Focused/Primary');
    expect(brief.effects['Focused/Primary'].layers).toHaveLength(1);
  });

  it('cannot produce not-in-scope, because componentBrief is never given a narrowed spec', () => {
    // actions.ts:512 always passes the unnarrowed currentFoundationSpec(). A
    // status that cannot occur on a path does not belong in that path's
    // vocabulary, so this asserts the absence rather than trusting the call site.
    const foundation = oneCollectionFoundation();
    expect('narrowedTo' in foundation).toBe(false);
    const brief = componentBrief(specWith([
      { id: 'VariableID:99', name: 'color/new', kind: 'variable' },
    ]), { generatedAt: AT, foundation }) as unknown as {
      tokens: { used: Array<{ resolution?: { status: string } }> };
    };
    expect(brief.tokens.used[0].resolution?.status).toBe('not-in-snapshot');
  });

  it('calls a text style binding text-style, not typography', () => {
    const brief = componentBrief(specWith([
      { id: 'S:3', name: 'Paragraph/S', kind: 'text-style', property: 'typography' },
    ]), { generatedAt: AT }) as unknown as { tokens: { used: Array<{ kind: string }> } };
    // The style kinds share one vocabulary now: `typography` named the PROPERTY,
    // not the kind of thing bound.
    expect(brief.tokens.used[0].kind).toBe('text-style');
  });
});
```

Add whatever local `EMPTY_SPEC` / `foundationWithEffectStyle` helpers the file needs, modelled on the existing helpers in `brief.test.ts`.

- [ ] **Step 5: Rewrite `tokensOf`**

Replace `brief.ts`'s `tokensOf` (and delete the `typographyTokens` special case it contains):

```ts
/** (name, kind) is the join identity between `used` and `bindings`. Two
 *  references sharing a name are two entries; the same reference bound in five
 *  places is one. */
const usedKey = (r: TokenRule): string => JSON.stringify([r.kind, r.name]);

function tokensOf(
  spec: IntermediateSpec,
  foundation: FoundationSpec | undefined,
  definedNames: (kind: RefKind) => Set<string>,
): YamlValue {
  const seen = new Set<string>();
  const rules: TokenRule[] = [];
  for (const t of spec.tokens) {
    const key = ruleKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(t);
  }

  // A LIST, not a map. A map keyed by name cannot hold a variable and an effect
  // style that share one, and a conditional key that only qualifies on collision
  // is the kind of thing that bites later.
  //
  // First-use order, so reading top to bottom introduces a reference before the
  // bindings that name it.
  const used: YamlValue[] = [];
  const usedSeen = new Set<string>();
  for (const r of rules) {
    const key = usedKey(r);
    if (usedSeen.has(key)) continue;
    usedSeen.add(key);

    // A style entry is a POINTER, not a copy: the definitions live in
    // `typography:` and `effects:`, so restating them here would give the brief
    // two owners for the same values.
    if (r.kind === 'text-style' || r.kind === 'effect-style') {
      used.push(definedNames(r.kind).has(r.name)
        ? { token: r.name, kind: r.kind }
        : { token: r.name, kind: r.kind, resolution: resolutionOf(foundation, r) as YamlValue });
      continue;
    }

    const looked = lookupToken(foundation, r);
    used.push(Object.keys(looked).length > 0
      ? { token: r.name, kind: r.kind, ...looked }
      : { token: r.name, kind: r.kind, resolution: resolutionOf(foundation, r) as YamlValue });
  }

  return {
    used,
    bindings: rules.map((r) => ({
      path: r.path,
      property: r.property,
      token: r.name,
      // Carried so a binding joins to `used` on (token, kind) rather than on a
      // name that two references can share.
      kind: r.kind,
      ...(Object.keys(r.conditions).length > 0 ? { when: r.conditions } : {}),
    })),
  };
}
```

`lookupToken` keeps its body but takes a rule and only ever looks at variables:

```ts
function lookupToken(
  foundation: FoundationSpec | undefined,
  ref: RefIdentity,
): { alias?: string; resolved?: YamlValue; external?: boolean; code?: YamlValue; mode?: string } {
  // Variables only. A style name has no entry in any collection, so walking
  // them for one was the lookup whose empty result used to be emitted as `{}`.
  if (!foundation || ref.kind !== 'variable') return {};
  for (const collection of foundation.collections) {
    for (const variable of collection.variables) {
      if (variable.name !== ref.name) continue;
      /* ...unchanged body... */
    }
  }
  return {};
}
```

Update its one other caller in `componentBrief` (the `resolved` map for `validate`) to pass the rule: `lookupToken(opts.foundation, t)`.

- [ ] **Step 6: Restate `typographyOf` and add `effectsOf`**

In `typographyOf`, replace the not-found branch:

```ts
    if (!style) {
      // Restated in the resolution vocabulary rather than as its own ad-hoc
      // sentence, so `typography` and `tokens.used` cannot disagree about what
      // "not in this file" means. The rule is looked up rather than
      // reconstructed from the name, so the resolution reads Figma's own
      // `remote` and reports `external` where that is the real cause.
      const ref = spec.tokens.find((t) => t.kind === 'text-style' && t.name === name)!;
      out[name] = { resolution: resolutionOf(foundation, ref) as YamlValue };
      continue;
    }
```

Change `typographyOf`'s name set to select on kind rather than property:

```ts
  const names = new Set(
    spec.tokens.filter((t) => t.kind === 'text-style').map((t) => t.name));
```

Add `effectsOf`, mirroring it:

```ts
/**
 * Every effect style this component binds, resolved to its layers.
 *
 * Beside `typography:` and for the same reason: `tokens.used` carries the kind
 * and this block carries the definition, so the brief has exactly one owner for
 * the values. Keyed by style name, which is the join key `used` and `bindings`
 * both carry.
 *
 * `source_name` keeps the raw Figma style name, stray double spaces included,
 * because that string is what a designer searches for in the file.
 */
function effectsOf(
  spec: IntermediateSpec,
  foundation: FoundationSpec | undefined,
): YamlValue | undefined {
  const names = new Set(
    spec.tokens.filter((t) => t.kind === 'effect-style').map((t) => t.name));
  if (names.size === 0) return undefined;

  const out: Record<string, YamlValue> = {};
  for (const name of names) {
    const style = foundation?.effectStyles.find((s) => s.name === name);
    if (!style) {
      const ref = spec.tokens.find((t) => t.kind === 'effect-style' && t.name === name)!;
      out[name] = { resolution: resolutionOf(foundation, ref) as YamlValue };
      continue;
    }
    out[name] = {
      source_name: style.name,
      description: style.description || undefined,
      layers: style.effects as unknown as YamlValue,
    };
  }
  return out;
}
```

- [ ] **Step 7: Wire both blocks and `effects_inline` into `componentBrief`**

In `componentBrief`, before the return:

```ts
  const typography = typographyOf(spec, opts.foundation);
  const effects = effectsOf(spec, opts.foundation);
  // The definitions this brief actually carries, so `tokens.used` knows whether
  // a style entry is a pointer to something real or needs a resolution instead.
  const definedNames = (kind: RefKind): Set<string> => new Set(
    kind === 'text-style'
      ? (opts.foundation?.textStyles ?? []).map((s) => s.name)
      : (opts.foundation?.effectStyles ?? []).map((s) => s.name),
  );
  // Joined to `unbound` and `bindings` on (path, property), never on path alone:
  // one node routinely has several rows -- fill, border, effects, spacing -- at
  // the same path.
  const effectsInline = spec.nodeEffects.map((n) => ({
    path: n.path,
    // Inline here, unlike the style entries above, because a node-level effect
    // has no style name to point at.
    layers: n.effects as unknown as YamlValue,
  }));
```

and in the returned object, after `tokens`:

```ts
    tokens: tokensOf(spec, opts.foundation, definedNames),
    ...(effectsInline.length > 0 ? { effects_inline: effectsInline } : {}),
    ...(unbound.length > 0 ? { unbound } : {}),
    ...(typography !== undefined ? { typography } : {}),
    ...(effects !== undefined ? { effects } : {}),
```

- [ ] **Step 8: Regenerate the golden fixture and read its diff**

`button-brief.yaml` legitimately changes shape here. Regenerate it in the SAME commit as the change that moved it, so the suite is green at every commit on this branch and `npm run check` never has a known-failing state anyone has to remember to ignore.

```bash
npx tsx packages/extractor/test/fixtures/buttonBrief.ts && git diff packages/extractor/test/fixtures/button-brief.yaml
```

Read the diff before continuing. Never accept it wholesale — a golden file edited to match a bug documents the bug. Confirm:

- `tokens.used` is a list of `- token: ... / kind: variable`, not a map.
- Every `used` entry has a `kind`, and no entry is a bare `{}`.
- Every `bindings` entry has a `kind`.
- No `resolution` block appears where a token DID resolve. `button.json` is extracted with no foundation here, so every entry SHOULD carry `resolution: { status: no-foundation, ... }`; a `not-in-snapshot` or an absent resolution is a bug.
- `button.json` binds no styles and has no effects, so there is no `effects:`, no `effects_inline:` and no `typography:` block. If any appears, something is fabricating one.
- Block order is unchanged apart from the new keys.

- [ ] **Step 9: Run**

Run: `npm run check`
Expected: PASS. The two component hashes are unmoved — the brief is never hashed, so its shape changes freely.

- [ ] **Step 10: Commit**

```bash
git add -A packages/extractor && git commit -m "$(cat <<'EOF'
feat(brief): a stated resolution replaces every bare {}

Three lines in one real export -- Focused/Primary, Focused/Error and
color/surface/primary/opacity-focus -- were all `{}`, with three different
causes. Every one of them now carries a kind and, where it cannot be resolved,
one of six statuses each decided by a stated fact rather than by a lookup that
found nothing.

tokens.used is a list: a map keyed by name cannot hold a variable and an effect
style that share one. Style entries point at `typography:` and the new
`effects:` block rather than restating their definitions.

The golden brief fixture is regenerated in this commit, so every commit on the
branch leaves the suite green.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Alias collection, alpha, `source`, `scope` (B6, B7)

Independent of Tasks 6 through 9 and could ship alone.

**Files:**
- Modify: `packages/extractor/src/brief.ts` (`valueOf`, `round2`, `foundationBrief`)
- Test: `packages/extractor/test/brief.test.ts`

**Interfaces:**
- Consumes: `roundN` (Task 6); `FoundationSpec.narrowedTo`/`effectStyles` (Tasks 5, 7).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `packages/extractor/test/brief.test.ts`:

```ts
describe('honest values and containers', () => {
  it('names the collection an external alias points into', () => {
    // In one real export, 13 external target names also existed locally and 4
    // did not. Without the collection, the payload prints a name matching a
    // local token of different identity with nothing to separate them.
    const brief = foundationBrief(aliasFoundation(), { generatedAt: 'T' }) as unknown as BriefShape;
    expect(brief.collections[0].tokens[1].values['Mode 1'])
      .toEqual({ alias: 'colors/gray/200', external: true, collection: 'Core Palette' });
  });

  it('omits the collection when the reader could not name it', () => {
    const brief = foundationBrief(aliasFoundation(''), { generatedAt: 'T' }) as unknown as BriefShape;
    expect('collection' in (brief.collections[0].tokens[1].values['Mode 1'] as object)).toBe(false);
  });

  it('leaves a local alias alone', () => {
    // A local alias already resolves, so naming its collection adds a line
    // without adding information.
    const brief = foundationBrief(localAliasFoundation(), { generatedAt: 'T' }) as unknown as BriefShape;
    expect('collection' in (brief.collections[0].tokens[1].values['Mode 1'] as object)).toBe(false);
  });

  it('trims float noise off alpha without flattening a real 0.125', () => {
    const brief = foundationBrief(alphaFoundation(0.03999999910593033), { generatedAt: 'T' }) as unknown as BriefShape;
    expect((brief.collections[0].tokens[0].values['Mode 1'] as { alpha: number }).alpha).toBe(0.04);
    const fine = foundationBrief(alphaFoundation(0.125), { generatedAt: 'T' }) as unknown as BriefShape;
    // Four decimals, not two: Figma's own percent field can express 0.125 and
    // two decimals would round it to 0.13.
    expect((fine.collections[0].tokens[0].values['Mode 1'] as { alpha: number }).alpha).toBe(0.125);
  });

  it('omits source entirely when Figma exposes no file key', () => {
    const brief = foundationBrief({ ...oneCollection(), fileKey: 'unknown' },
      { generatedAt: 'T' }) as unknown as Record<string, unknown>;
    // `source: {}` is not an honest empty: it reads as a measured verdict.
    expect('source' in brief).toBe(false);
  });

  it('omits empty text_styles and effect_styles rather than emitting []', () => {
    const brief = foundationBrief(oneCollection(), { generatedAt: 'T' }) as unknown as Record<string, unknown>;
    expect('text_styles' in brief).toBe(false);
    expect('effect_styles' in brief).toBe(false);
  });

  it('says what a narrowed copy covers, and says nothing on a whole-file copy', () => {
    const whole = buildFoundation(twoCollectionDump());
    expect('scope' in (foundationBrief(whole, { generatedAt: 'T' }) as object)).toBe(false);

    const narrowed = narrowFoundation(whole, { target: 'collection', collectionId: 'sem' })!;
    const brief = foundationBrief(narrowed, { generatedAt: 'T' }) as unknown as {
      scope: { collections: string[]; text_styles: string; effect_styles: string };
    };
    // `text_styles: []` used to read as "this file has no text styles". It means
    // "this copy does not cover them".
    expect(brief.scope).toEqual({
      collections: ['Semantic'], text_styles: 'excluded', effect_styles: 'excluded',
    });
  });
});
```

Add the `aliasFoundation`, `localAliasFoundation`, `alphaFoundation` and `twoCollectionDump` helpers alongside the file's existing ones.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/extractor/test/brief.test.ts`
Expected: FAIL on all seven.

- [ ] **Step 3: Fix `valueOf`**

```ts
/** A resolved value flattened to what a consumer can act on. */
function valueOf(v: FoundationValue): YamlValue {
  switch (v.kind) {
    case 'color':
      // Four decimals on alpha. Figma stores it as a double derived from a
      // percentage input, so 4% arrives as 0.03999999910593033 and an agent
      // reproduces that verbatim in generated CSS. Two decimals is not enough:
      // 0.04, 0.08 and 0.12 survive it, but Figma's own percent field can
      // express 0.125.
      return v.alpha === 1 ? v.hex : { hex: v.hex, alpha: roundN(v.alpha, 4) };
    case 'number': return v.value;
    case 'string': return v.value;
    case 'boolean': return v.value;
    case 'alias':
      return {
        alias: v.targetName,
        resolved: v.resolved ? valueOf(v.resolved) : undefined,
        external: v.external ? true : undefined,
        // The alias's target collection, on EXTERNAL aliases only. An external
        // alias prints a name that may also exist locally as a different token,
        // with nothing to separate them; a local alias already resolves, so
        // naming its collection adds a line without adding information.
        // Omitted when readCollectionName yielded '', because a blank name is
        // not a name.
        collection: v.external && v.targetCollection ? v.targetCollection : undefined,
      };
    case 'unresolved': return { unresolved: v.reason };
  }
}
```

Delete the local `round2` definition and replace its two uses in `typographyOf` with `roundN(n, 2)`, importing `roundN` from `./effects`. Its doc comment moves to `roundN` (already written in Task 6).

- [ ] **Step 4: Fix the foundation brief's containers**

Replace `foundationBrief`'s return:

```ts
  const source = fileKeyOf(foundation.fileKey);
  const scope = scopeOf(foundation);
  return {
    spec_layer: envelope('foundation', opts.generatedAt),
    // Omitted ENTIRELY when Figma exposes no file key. fileKeyOf already refuses
    // to emit the literal 'unknown'; spreading its empty result into a key
    // anyway produced `source: {}`, and an empty container reads as a measured
    // verdict rather than as an absence.
    ...(Object.keys(source).length > 0 ? { source } : {}),
    // Present only on a narrowed copy. A whole-file copy covers everything, so
    // there is nothing to state.
    ...(scope !== undefined ? { scope } : {}),
    collections: foundation.collections.map((c) => { /* unchanged */ }),
    // Omitted when empty, for the reason `source` is: `text_styles: []` reads as
    // "this file has no text styles" when it means "this copy does not cover
    // them", and narrowFoundation sets exactly that on every scoped copy.
    ...(foundation.textStyles.length > 0
      ? { text_styles: foundation.textStyles.map((t) => ({
          name: t.name,
          font: { family: t.fontFamily, style: t.fontStyle, size: t.fontSize },
          line_height: { unit: t.lineHeight.unit, value: t.lineHeight.value },
          letter_spacing: { unit: t.letterSpacing.unit, value: t.letterSpacing.value },
        })) }
      : {}),
    ...(foundation.effectStyles.length > 0
      ? { effect_styles: foundation.effectStyles.map((s) => ({
          name: s.name,
          description: s.description || undefined,
          effects: s.effects as unknown as YamlValue,
        })) }
      : {}),
    ...(hasDescriptions
      ? { guidelines: { origin: 'generated', group_descriptions: descriptions } }
      : {}),
  };
```

and add `scopeOf` above it:

```ts
/**
 * What a narrowed copy covers, stated rather than implied by an empty container.
 *
 * Derived from `narrowedTo`, which narrowFoundation stamps, so
 * copyFoundationBriefForScope gets a scope block and copyFoundationBrief does
 * not without either caller passing anything extra. Neither changes WHAT it
 * covers: copyFoundationBrief still deliberately ignores the scope selection
 * that document generation respects.
 */
function scopeOf(foundation: FoundationSpec): YamlValue | undefined {
  const target = foundation.narrowedTo;
  if (!target) return undefined;
  if (target.target === 'textStyles') {
    return { collections: 'excluded', text_styles: 'included', effect_styles: 'excluded' };
  }
  return {
    collections: foundation.collections.map((c) => c.name),
    text_styles: 'excluded',
    effect_styles: 'excluded',
  };
}
```

- [ ] **Step 5: Regenerate the golden fixture and read its diff**

Nothing in this task touches a component brief, so `button-brief.yaml` should be **unchanged**. Regenerate it anyway and confirm that:

```bash
npx tsx packages/extractor/test/fixtures/buttonBrief.ts && git diff --stat packages/extractor/test/fixtures/button-brief.yaml
```

Expected: **no output**. A diff here means one of B6's changes reached the component brief when it was only supposed to reach the foundation brief. Investigate before continuing rather than blessing it.

- [ ] **Step 6: Run**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A packages/extractor && git commit -m "$(cat <<'EOF'
feat(brief): name the alias collection, trim alpha, drop the empty containers

An external alias printed a name matching a local token of different identity
with nothing separating them, though targetCollection was carried end to end
and dropped in one line. Alpha shipped as 0.03999999910593033. `source: {}` and
`text_styles: []` both read as measured verdicts when one meant "no file key"
and the other meant "this copy does not cover them".

A narrowed copy now says what it covers instead.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `BRIEF_VERSION` 4, fixtures, documentation

**Files:**
- Modify: `packages/extractor/src/brief.ts:20-43` (the version doc and constant)
- Modify: `packages/extractor/test/brief.test.ts` (the version assertion)
- Regenerate: `packages/extractor/test/fixtures/button-brief.yaml`
- Modify: `docs/plugin-knowledge-map.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `BRIEF_VERSION === 4`.

- [ ] **Step 1: Bump the version and document why**

Append to the `BRIEF_VERSION` doc comment and change the constant:

```ts
 * 4: reference identity reaches the payload. Every entry in `tokens.used`
 * carries a `kind`, and one that cannot be resolved carries a `resolution`
 * with one of six statuses instead of a bare `{}`. `used` is a LIST, because a
 * map keyed by name cannot hold a variable and an effect style that share one.
 * `kind: 'typography'` became `kind: 'text-style'`, so the style kinds share a
 * vocabulary. New blocks: `effects` (effect style definitions, beside
 * `typography`), `effects_inline` (node-level effect layers with their
 * per-field bindings), `effect_styles` on the foundation brief, and `scope` on
 * a narrowed copy. External aliases name their collection; colour alpha rounds
 * to four decimals; `source`, `text_styles` and `effect_styles` are absent
 * rather than empty.
 */
export const BRIEF_VERSION = 4;
```

Update the assertion in `brief.test.ts` from `toBe(3)` to `toBe(4)`.

- [ ] **Step 2: Regenerate the golden fixture**

```bash
npx tsx packages/extractor/test/fixtures/buttonBrief.ts
```

- [ ] **Step 3: Read the diff, do not accept it wholesale**

```bash
git diff packages/extractor/test/fixtures/button-brief.yaml
```

Expected: **exactly one changed line**, `version: 3` becoming `version: 4`. Tasks 9 and 10 each regenerated this fixture and reviewed their own shape changes, so nothing else is left to move. Any other line in this diff is a shape change that arrived without a task claiming it — investigate it rather than blessing it.

For the record, the shape the fixture should now hold (verified at Task 9, re-confirmed here):

- `tokens.used` is a list of `- token: ... / kind: variable`, not a map.
- Every `used` entry has a `kind`, and no entry is a bare `{}`.
- Every `bindings` entry has a `kind`.
- `button.json` binds no styles and has no effects, so there is no `effects:`, no `effects_inline:` and no `typography:` block.
- Block order is unchanged apart from the new keys.

- [ ] **Step 4: Run the whole suite**

Run: `npm run check`
Expected: PASS, including `briefGolden.test.ts` against the regenerated fixture.

- [ ] **Step 5: Confirm the two component hashes never moved across the whole plan**

```bash
git log --oneline -p -- packages/extractor/test/specHash.test.ts | grep -E '^[-+].*_HASH ='
```

Expected: exactly two `+` lines (the original `BUTTON_HASH` and the `CHIP_HASH` added in Task 1) and no `-` line for either. A `-` means a baseline was re-cut, which this plan does not authorize.

- [ ] **Step 6: Update the knowledge map**

In `docs/plugin-knowledge-map.md`, change the `Updated:` date to `2026-08-25` and extend invariant 2:

```markdown
2. Do not change the YAML brief or hash projections casually. `specContentHash`
   projects `TokenRule.name` back onto the old `token` key on purpose: the
   projection is what keeps a field rename from drifting every committed
   document. `nodeEffects`, `rawValues` and `figmaFileName` are excluded from it
   for the same reason.
```

and add to the Packages table row for `packages/extractor`:

```markdown
| `packages/extractor` | Pure serialized-node extraction, Foundation planning, YAML briefs, hashes, AI prompts/parsers. Bindings carry Figma's own identity (id, kind, `remote`) end to end; `resolution.ts` turns an unresolvable one into a stated status rather than an empty map. |
```

- [ ] **Step 7: Commit**

```bash
git add -A packages/extractor docs && git commit -m "$(cat <<'EOF'
feat(brief): BRIEF_VERSION 4

Reference identity reaches the payload: every used entry carries a kind, an
unresolvable one carries one of six stated statuses, effect styles and effect
layers are real extracted data, and the empty containers either go away or say
why they are empty.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Manual verification

Nothing in this plan can be proven from unit tests alone, because the whole point is what a REAL file produces. Before merging, in Figma:

- [ ] Open a file with an effect style bound on a component. Copy the component brief. Confirm the `effects:` block names the style and lists its layers, and that `tokens.used` points at it rather than restating it.
- [ ] Bind a colour variable to a shadow's colour and leave its radius hardcoded. Confirm `effects_inline` shows both the binding and the geometry.
- [ ] Bind a LIBRARY variable. Confirm the brief says `status: external`, not `not-in-snapshot`.
- [ ] Create a variable, then copy a component brief WITHOUT visiting the Foundations tab. Confirm `status: not-in-snapshot` and that its reason tells you to read the foundations again.
- [ ] Copy one collection with "Copy for AI" from a foundation row. Confirm the `scope` block names that collection and marks text styles and effect styles excluded.
- [ ] Copy the whole file's foundation. Confirm there is no `scope` key, and that `effect_styles` lists the file's effect styles.
- [ ] Confirm no component or foundation document on canvas flipped to "Update available" after installing the build.

Record the results in `docs/manual-tests/`.
