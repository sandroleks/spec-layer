# Definition → Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the first Usage section to "Overview" and make its prose a value-led narrative (why it matters, where it's used, its role, a guiding principle) instead of a terse definition.

**Architecture:** Reshape the `definition` prose prompt + few-shot so the first sentence stays a crisp "what it is" (feeds the header) and the body becomes a benefit-led overview with no style names; bump the prompt version; rename the section label.

**Tech Stack:** TypeScript, Vitest. Packages: `@spec-layer/extractor` (prose) and `@spec-layer/plugin` (label).

## Global Constraints

- Section label: **Overview** (internal `SectionId` stays `'definition'`, prose field stays `definition`).
- Overview prose: first sentence = *what it is* (feeds header); body = value/role/where-used + a guiding principle. **No** variant/style names, **no** "when to use which" guide (those live in Variants). No em dashes.
- Bump `PROSE_PROMPT_VERSION` v6 → v7.
- `pnpm` not on PATH. Use `./node_modules/.bin/vitest run` (repo root) and `./node_modules/.bin/tsc --noEmit -p packages/<pkg>/tsconfig.json`. Never run bare `tsc`.
- Full suite (623 baseline) stays green.

---

### Task 1: Reshape the Overview prose

Turn the `definition` prompt + few-shot from "what it is + constraint" into a value-led overview, and bump the version.

**Files:**
- Modify: `packages/extractor/src/prose/prompt.ts` (system-prompt Definition bullet ~45-47, FEW_SHOT_PROMPT definition key ~89-90, buildProsePrompt definition key ~225-226, FEW_SHOT_RESPONSE.definition ~104-106)
- Modify: `packages/extractor/src/prose/client.ts` (`PROSE_PROMPT_VERSION` ~17-19)
- Test: `packages/extractor/test/prose.test.ts`

**Interfaces:**
- No schema change. `ProseDrafts.definition` stays a string; only its content shape changes (value-led overview, first sentence = what it is).

- [ ] **Step 1: Write the failing test**

Add to `packages/extractor/test/prose.test.ts` (inside `describe('prose', …)`):

```ts
  it('few-shot definition is a value-led overview with no style names', () => {
    const [, assistant] = proseFewShot();
    const drafts = parseProseResponse(assistant.content);
    // Multi-sentence narrative, not a bare one-liner.
    expect(drafts.definition.split(/[.!?]\s/).length).toBeGreaterThan(2);
    // No specific variant/style names leak into the Overview.
    expect(drafts.definition).not.toMatch(/\b(filled|outlined|ghost|brand|neutral|destructive)\b/i);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run prose`
Expected: FAIL — the current few-shot definition is a single "…keep one Filled button per view…" sentence pair (matches "Filled", and is not >2 sentences).

- [ ] **Step 3: Reshape the system-prompt Definition bullet**

In `packages/extractor/src/prose/prompt.ts`, in `PROSE_SYSTEM_PROMPT`, replace:

```ts
  '- Definition: a short paragraph. The FIRST sentence defines what the component is, standalone.',
  '  Then 1-2 sentences on its core purpose and key constraint. Do NOT enumerate the variants or',
  '  types and do NOT say which type to use; that belongs to the Variants guide below.',
```

with:

```ts
  '- Overview: open with ONE sentence defining what the component is (this becomes the header).',
  '  Then a short, benefit-led overview: where and how it is used, the value it gives people, its',
  '  role in the product, and a brief guiding principle. Do NOT name specific variants or styles',
  '  and do NOT give a "when to use which" guide; those belong to the Variants guide below.',
```

- [ ] **Step 4: Reshape both JSON-key `definition` descriptions**

In the same file, in `FEW_SHOT_PROMPT`, replace:

```ts
  'Return ONLY a JSON object with keys: definition (a short paragraph whose first sentence ' +
    'defines what it is, then 1-2 sentences on purpose and the key constraint; no per-type guide), ' +
```

with:

```ts
  'Return ONLY a JSON object with keys: definition (one sentence defining what it is, then a ' +
    'short benefit-led overview: where it is used, the value it gives people, its role, and a ' +
    'guiding principle; no style names and no when-to-use guide), ' +
```

Then in `buildProsePrompt`, replace:

```ts
      "definition (a short paragraph specific to this component's actual props, with no generic filler; the first sentence defines what it is, then 1-2 sentences on purpose and the key constraint; do NOT enumerate the types or say which type to use), " +
```

with:

```ts
      "definition (specific to this component, with no generic filler; one sentence defining what it is, then a short benefit-led overview: where it is used, the value it gives people, its role, and a guiding principle; do NOT name specific variants/styles or give a when-to-use guide), " +
```

- [ ] **Step 5: Reshape the few-shot exemplar definition**

In the same file, replace `FEW_SHOT_RESPONSE.definition`:

```ts
  definition:
    'A Button triggers an action when activated. Use it for actions, not navigation, and keep ' +
    'one Filled button per view so the main action stays unambiguous.',
```

with:

```ts
  definition:
    'A Button triggers an action when activated. Used across products to perform common actions, ' +
    'it gives people a familiar, accessible way to engage with the interface and keeps frequent ' +
    'tasks fast and predictable. It is essential for guiding people through workflows and ' +
    'performing the key actions on a screen. Create buttons that are clear, easy to identify, and ' +
    'accessible.',
```

- [ ] **Step 6: Bump the prompt version**

In `packages/extractor/src/prose/client.ts`, change:

```ts
 * v6 = definition/variants rebalance (type guide moved from Definition to Variants).
 */
export const PROSE_PROMPT_VERSION = 'v6';
```

to:

```ts
 * v6 = definition/variants rebalance (type guide moved from Definition to Variants);
 * v7 = Definition renamed to Overview, value-led prose (no style names).
 */
export const PROSE_PROMPT_VERSION = 'v7';
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run prose`
Expected: PASS. The prior tests stay green: "few-shot definition is a plain paragraph with no per-type guide" (new definition has no bullets and no "when to use"), and "few-shot exemplar uses a Variants type list" (variantsSummary unchanged).

- [ ] **Step 8: Typecheck + commit**

Run: `./node_modules/.bin/tsc --noEmit -p packages/extractor/tsconfig.json` (exit 0)

```bash
git add packages/extractor/src/prose/prompt.ts packages/extractor/src/prose/client.ts packages/extractor/test/prose.test.ts
git commit -m "feat(prose): value-led Overview prose (was Definition)"
```

---

### Task 2: Rename the section label to Overview

**Files:**
- Modify: `packages/plugin/src/ui/docModel.ts` (`ALL_SECTIONS` `definition` entry)
- Test: `packages/plugin/test/docModel.test.ts`

**Interfaces:**
- Consumes: `ALL_SECTIONS` (id `'definition'` unchanged).
- Produces: the `definition` section's `label` is now `'Overview'`; `buildDocModel` therefore emits that block's `heading` as `'Overview'`.

- [ ] **Step 1: Write the failing test**

Add to `packages/plugin/test/docModel.test.ts` (inside `describe('buildDocModel', …)` or alongside the section tests; `buildDocModel`, `prose`, `spec` are already in scope):

```ts
  it('labels the definition section "Overview"', () => {
    const model = buildDocModel(spec, prose, new Set<SectionId>(['definition']));
    expect(model.sections[0].heading).toBe('Overview');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run docModel`
Expected: FAIL — heading is still `'Definition'`.

- [ ] **Step 3: Rename the label**

In `packages/plugin/src/ui/docModel.ts`, in `ALL_SECTIONS`, change the `definition` entry:

```ts
  { id: 'definition',    label: 'Definition',    ai: true,  group: 'usage' },
```

to:

```ts
  { id: 'definition',    label: 'Overview',      ai: true,  group: 'usage' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run docModel`
Expected: PASS.

- [ ] **Step 5: Check for other "Definition" label assertions**

Run: `grep -rn "'Definition'\|\"Definition\"\|>Definition<" packages/plugin/src packages/plugin/test`
Expected: no remaining code/test that asserts the label string `Definition` (the config-window checklist reads the label from `ALL_SECTIONS`, so it updates automatically). If a stale assertion exists, update it to `Overview`.

- [ ] **Step 6: Typecheck, full suite, build, commit**

Run: `./node_modules/.bin/tsc --noEmit -p packages/plugin/tsconfig.json` (exit 0), `./node_modules/.bin/vitest run` (all green), `node packages/plugin/build.mjs` (builds).

```bash
git add packages/plugin/src/ui/docModel.ts packages/plugin/test/docModel.test.ts
git commit -m "feat(plugin): rename the Definition section to Overview"
```

---

### Task 3: Manual Figma verification

**Files:** none.

- [ ] **Step 1: Build** — `node packages/plugin/build.mjs` (expect success).

- [ ] **Step 2: Regenerate and inspect** — in Figma desktop, regenerate a component with Write with AI on, then confirm on the Usage frame:
  - [ ] The first section heading reads **Overview** (not Definition).
  - [ ] The **header** is a one-sentence "what it is".
  - [ ] The **Overview body** reads as a value/role narrative (where used, value to people, role, guiding principle) — no style names, no "when to use which".
  - [ ] **Variants** still owns the style list + when-to-use guide.
  - [ ] First regenerate after the bump uses v7 (no cached v6 draft).

- [ ] **Step 3: Record results** — if the model drifts (dry definition or leaked style names), tighten Task 1's prompt wording and regenerate; no code change needed.
