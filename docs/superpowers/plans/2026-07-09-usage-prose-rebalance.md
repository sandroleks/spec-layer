# Usage Prose Rebalance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Usage frame from repeating the same type rundown across the header, Definition, and Variants — give each surface one job.

**Architecture:** Reshape the AI prose prompt so Definition owns "what it is + constraints" and the Variants guide owns "what varies + which type when." Render the header from the definition's first *sentence*, and render the Variants guide as bullet-aware prose above the matrix.

**Tech Stack:** TypeScript, Figma Plugin API, Vitest. Packages: `@spec-layer/extractor` (prose prompt) and `@spec-layer/plugin` (rendering).

## Global Constraints

- Content ownership: **header = what it is (one sentence)** · **Definition = what it is + key constraint, no per-type content** · **Variants = orientation to axes + the bulleted "when to use which type" guide.**
- No em dashes / en dashes in prose copy (period, comma, colon, or parentheses instead). Hyphen in ranges (`3-5`) is fine.
- Bump `PROSE_PROMPT_VERSION` when prompt shape changes (busts the draft cache).
- `pnpm` is NOT on PATH. Use repo-local binaries: `./node_modules/.bin/vitest run` (from repo root), `./node_modules/.bin/tsc --noEmit -p packages/<pkg>/tsconfig.json`. Build with `node packages/plugin/build.mjs`. Never run bare `tsc` (it emits stray `.js`/`.d.ts`).
- Full suite (617 baseline) stays green.

---

### Task 1: Reshape the prose prompt (Definition ⇄ Variants)

Move the "when to use which type" guide out of Definition and into the Variants guide, in the system prompt, both JSON-key descriptions, and the few-shot exemplar; bump the prompt version.

**Files:**
- Modify: `packages/extractor/src/prose/prompt.ts` (system prompt ~45-56, FEW_SHOT_PROMPT keys ~89-92, buildProsePrompt keys ~226-227, FEW_SHOT_RESPONSE ~104-115)
- Modify: `packages/extractor/src/prose/client.ts` (`PROSE_PROMPT_VERSION` ~13-14)
- Test: `packages/extractor/test/prose.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no schema change — `ProseDrafts` keeps `definition` and `variantsSummary`; only their *content shape* changes (definition = paragraph, no bullets; variantsSummary = orientation + bulleted type guide).

- [ ] **Step 1: Write the failing tests**

Add to `packages/extractor/test/prose.test.ts` (append inside the existing `describe('prose', …)`; `proseFewShot` and `parseProseResponse` are already imported):

```ts
  it('few-shot definition is a plain paragraph with no per-type guide', () => {
    const [, assistant] = proseFewShot();
    const drafts = parseProseResponse(assistant.content);
    expect(drafts.definition).not.toMatch(/^-\s/m);            // no bullet lines
    expect(drafts.definition.toLowerCase()).not.toContain('when to use');
  });

  it('few-shot variantsSummary carries a bulleted when-to-use-which-type guide', () => {
    const [, assistant] = proseFewShot();
    const drafts = parseProseResponse(assistant.content);
    expect(drafts.variantsSummary).toMatch(/-\s\*\*/);         // bold-name bullets
    expect(drafts.variantsSummary?.toLowerCase()).toContain('when to use');
  });

  it('prompt asks for the type guide under variants, not definition', () => {
    const prompt = buildProsePrompt(spec);
    // The "when to use which type" phrasing appears in the variants clause.
    expect(prompt).toMatch(/when to use which type/i);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run prose`
Expected: the three new tests FAIL (definition still has bullets / contains "when to use"; variantsSummary has no bullets; prompt lacks "when to use which type").

- [ ] **Step 3: Reshape the system prompt**

In `packages/extractor/src/prose/prompt.ts`, in `PROSE_SYSTEM_PROMPT`, replace the Definition block:

```ts
  '- Definition: open with a short paragraph (what it is, when to use it, the key constraint).',
  '  When the component has several meaningful variants or types, follow the paragraph with a',
  '  bulleted "when to use which" guide, one per line, with the variant name in bold:',
  '  "- **Filled**: the single most important action.".',
```

with:

```ts
  '- Definition: a short paragraph. The FIRST sentence defines what the component is, standalone.',
  '  Then 1-2 sentences on its core purpose and key constraint. Do NOT enumerate the variants or',
  '  types and do NOT say which type to use; that belongs to the Variants guide below.',
```

and replace the Variants block:

```ts
  '- Variants summary (optional, 1-2 sentences): a quick orientation to what varies across this',
  "  component's variant options, not a decision guide. Do not repeat Definition's \"when to use",
  '  which" guidance.',
```

with:

```ts
  '- Variants guide (optional): 1-2 sentences orienting the reader to what varies across the',
  "  component's options (the axes and their values). Then, when it has several meaningful types,",
  '  a bulleted "when to use which type" guide, one per line, type name in bold:',
  '  "- **Filled**: the single most important action.". Do not restate the plain definition.',
```

- [ ] **Step 4: Reshape both JSON-key descriptions**

In the same file, in `FEW_SHOT_PROMPT`, replace:

```ts
  'Return ONLY a JSON object with keys: definition (a short paragraph, then a bulleted "when to ' +
    'use which" guide with bold variant names when the component has several variants), ' +
    'variantsSummary (1-2 sentences orienting the reader to what varies across the variant ' +
    'options, without repeating Definition\'s "when to use which" guidance), ' +
```

with:

```ts
  'Return ONLY a JSON object with keys: definition (a short paragraph whose first sentence ' +
    'defines what it is, then 1-2 sentences on purpose and the key constraint; no per-type guide), ' +
    'variantsSummary (1-2 sentences on what varies across the options, then a bulleted "when to ' +
    'use which type" guide with bold type names when it has several types), ' +
```

Then in `buildProsePrompt`, replace:

```ts
      "definition (a short paragraph specific to this component's actual props and variants, with no generic filler; when it has several meaningful variants, follow the paragraph with a bulleted \"when to use which\" guide with bold variant names), " +
      "variantsSummary (1-2 sentences orienting the reader to what varies across the variant options, the gist of the axes and their values; do NOT repeat Definition's \"when to use which\" guidance), " +
```

with:

```ts
      "definition (a short paragraph specific to this component's actual props, with no generic filler; the first sentence defines what it is, then 1-2 sentences on purpose and the key constraint; do NOT enumerate the types or say which type to use), " +
      "variantsSummary (1-2 sentences on what varies across the options, the axes and their values, then a bulleted \"when to use which type\" guide with bold type names when it has several meaningful types), " +
```

- [ ] **Step 5: Reshape the few-shot exemplar**

In the same file, replace the `FEW_SHOT_RESPONSE` `definition` and `variantsSummary` fields:

```ts
  definition: [
    'A Button triggers an action when activated. Keep one Filled button per view so the main ' +
      'action stays unambiguous.',
    '',
    '**When to use each type:**',
    '- **Filled**: the single most important action in a view.',
    '- **Outlined**: secondary actions that still need a visible boundary.',
    '- **Text**: low-emphasis actions in dense layouts.',
  ].join('\n'),
  variantsSummary: 'Style controls visual weight, from the solid Filled button to the bordered ' +
    'Outlined button to the borderless Text button. All three share the same anatomy and states.',
```

with:

```ts
  definition:
    'A Button triggers an action when activated. Use it for actions, not navigation, and keep ' +
    'one Filled button per view so the main action stays unambiguous.',
  variantsSummary: [
    'Style sets the visual weight and states cover the interactive feedback; all styles share ' +
      'the same anatomy.',
    '',
    '**When to use each type:**',
    '- **Filled**: the single most important action in a view.',
    '- **Outlined**: secondary actions that still need a visible boundary.',
    '- **Text**: low-emphasis actions in dense layouts.',
  ].join('\n'),
```

- [ ] **Step 6: Bump the prompt version**

In `packages/extractor/src/prose/client.ts`, update the version constant and its comment. Change:

```ts
 * v5 = anatomy summary + per-part role descriptions.
 */
export const PROSE_PROMPT_VERSION = 'v5';
```

to:

```ts
 * v5 = anatomy summary + per-part role descriptions;
 * v6 = definition/variants rebalance (type guide moved from Definition to Variants).
 */
export const PROSE_PROMPT_VERSION = 'v6';
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run prose`
Expected: PASS (new tests green; existing prose tests — including the em-dash-free few-shot check — still green).

- [ ] **Step 8: Typecheck + commit**

Run: `./node_modules/.bin/tsc --noEmit -p packages/extractor/tsconfig.json` (expect exit 0)

```bash
git add packages/extractor/src/prose/prompt.ts packages/extractor/src/prose/client.ts packages/extractor/test/prose.test.ts
git commit -m "feat(prose): rebalance Definition vs Variants (type guide → Variants)"
```

---

### Task 2: Header takes the definition's first sentence

The header subtitle currently swallows the whole first line of the Definition. Make it take only the first sentence; the remainder stays in the Definition body.

**Files:**
- Modify: `packages/plugin/src/ui/docModel.ts` (add exported `firstSentence` near `parseRuns`)
- Modify: `packages/plugin/src/docFrame.ts` (`splitLead` ~73-80; add `firstSentence` to the existing `./ui/docModel` import)
- Test: `packages/plugin/test/docModel.test.ts`

**Interfaces:**
- Produces: `export function firstSentence(text: string): { sentence: string; remainder: string }` in `docModel.ts`.
- `docFrame.ts` `splitLead` consumes `firstSentence`.

- [ ] **Step 1: Write the failing test**

Add to `packages/plugin/test/docModel.test.ts` (import `firstSentence` from `../src/ui/docModel`):

```ts
import { firstSentence } from '../src/ui/docModel';

describe('firstSentence', () => {
  it('splits off the first sentence and keeps the remainder', () => {
    const { sentence, remainder } = firstSentence(
      'A Button triggers an action. Use it for actions, not navigation.',
    );
    expect(sentence).toBe('A Button triggers an action.');
    expect(remainder).toBe('Use it for actions, not navigation.');
  });

  it('does not cut on abbreviations or decimals', () => {
    expect(firstSentence('Pick 3.5 items on average. Then stop.').sentence)
      .toBe('Pick 3.5 items on average.');
    expect(firstSentence('Use e.g. a Toggle instead. Next.').sentence)
      .toBe('Use e.g. a Toggle instead.');
  });

  it('returns the whole text with empty remainder when there is one sentence', () => {
    const { sentence, remainder } = firstSentence('Just one sentence here.');
    expect(sentence).toBe('Just one sentence here.');
    expect(remainder).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run docModel`
Expected: FAIL — `firstSentence` is not exported.

- [ ] **Step 3: Implement `firstSentence`**

In `packages/plugin/src/ui/docModel.ts`, add near the other pure text helpers (e.g. just above `parseRuns`):

```ts
/** Split a paragraph into its first sentence and the remainder. A sentence ends
 *  at the first `.`/`!`/`?` that is followed by whitespace and an uppercase
 *  letter or `(` — so "e.g. a Toggle" and "3.5 items" do not end it. Returns the
 *  whole text as the sentence (empty remainder) when no boundary is found. */
export function firstSentence(text: string): { sentence: string; remainder: string } {
  const t = text.trim();
  const m = /[.!?](?=\s+[A-Z(])/.exec(t);
  if (!m) return { sentence: t, remainder: '' };
  const end = m.index + 1; // include the punctuation
  return { sentence: t.slice(0, end).trim(), remainder: t.slice(end).trim() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run docModel`
Expected: PASS.

- [ ] **Step 5: Use it in `splitLead`**

In `packages/plugin/src/docFrame.ts`, add `firstSentence` to the existing import from `./ui/docModel` (which already imports `parseRuns`). Then replace `splitLead`:

```ts
function splitLead(md: string): { lead: string; rest: string } {
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  const lead = i < lines.length ? lines[i].trim() : '';
  const rest = lines.slice(i + 1).join('\n').trim();
  return { lead, rest };
}
```

with:

```ts
function splitLead(md: string): { lead: string; rest: string } {
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  const firstLine = i < lines.length ? lines[i].trim() : '';
  const following = lines.slice(i + 1).join('\n').trim();
  // The header takes only the first sentence; the rest of the paragraph plus any
  // following lines drop into the Definition body, so the header stays a one-liner.
  const { sentence, remainder } = firstSentence(firstLine);
  const rest = [remainder, following].filter(Boolean).join('\n\n').trim();
  return { lead: sentence, rest };
}
```

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `./node_modules/.bin/tsc --noEmit -p packages/plugin/tsconfig.json` (exit 0) then `./node_modules/.bin/vitest run` (617+ passing).

```bash
git add packages/plugin/src/ui/docModel.ts packages/plugin/src/docFrame.ts packages/plugin/test/docModel.test.ts
git commit -m "feat(plugin): header subtitle uses the definition's first sentence"
```

---

### Task 3: Render the Variants guide as prose above the matrix

The variants summary now carries a bulleted type guide, but it renders as a single flat text node (raw `- **Filled**:` markers). Render it through `buildProse` (bullets + bold) in `docFrame.ts`, and drop summary rendering from the shared matrix builder.

**Files:**
- Modify: `packages/plugin/src/docFrame.ts` (`variantsMatrix` branch ~903-921)
- Modify: `packages/plugin/src/statesSection.ts` (`MatrixBlockData.summary` ~9, summary render ~25-29)

**Interfaces:**
- Consumes: `buildProse(text: string): SceneNode[]` (already in `docFrame.ts`); `section.summary` on the `variantsMatrix` block (set by `buildDocModel`, unchanged).
- Produces: `MatrixBlockData` no longer has a `summary` field; `buildMatrixSection` no longer renders a summary.

- [ ] **Step 1: Remove summary from the shared matrix builder**

In `packages/plugin/src/statesSection.ts`, delete the `summary?` field from `MatrixBlockData`:

```ts
export interface MatrixBlockData {
  summary?: string | null;
  axisName?: string;
```

becomes:

```ts
export interface MatrixBlockData {
  axisName?: string;
```

and delete the summary-rendering block inside `buildMatrixSection`:

```ts
  if (block.summary) {
    const summary = makeText(block.summary, 'Regular', 15, palette.body, 155);
    wrap.appendChild(summary);
    summary.layoutSizingHorizontal = 'FILL';
  }

```

(remove those five lines entirely; `makeText` is still used elsewhere in the file, keep the import).

- [ ] **Step 2: Render the guide via `buildProse` in the variants branch**

In `packages/plugin/src/docFrame.ts`, replace the `variantsMatrix` branch:

```ts
  } else if (section.kind === 'variantsMatrix') {
    // Combine the row-cap disclosure (when the first axis had >4 values) with any
    // held-axis note, so a capped Variants matrix explains its truncation the same
    // way the States matrix does.
    const capNote = section.capped
      ? 'Showing the first 4 values — other variants share the same structure.'
      : null;
    const note = [capNote, section.note].filter(Boolean).join(' ') || null;
    const grid = await buildMatrixSection(
      {
        summary: section.summary,
        columns: section.columns,
        rows: section.rows,
        note,
      },
      CONTENT_WIDTH,
    );
    body.appendChild(grid);
    grid.layoutSizingHorizontal = 'FILL';
```

with:

```ts
  } else if (section.kind === 'variantsMatrix') {
    // The variants guide (orientation + bulleted "when to use which type") renders
    // as prose above the matrix so bold type names and bullet lines format
    // correctly, rather than as a single flat line of raw markdown.
    if (section.summary) {
      for (const node of buildProse(section.summary)) {
        body.appendChild(node);
        (node as TextNode).layoutSizingHorizontal = 'FILL';
      }
    }
    // Combine the row-cap disclosure (when the first axis had >4 values) with any
    // held-axis note, so a capped Variants matrix explains its truncation the same
    // way the States matrix does.
    const capNote = section.capped
      ? 'Showing the first 4 values — other variants share the same structure.'
      : null;
    const note = [capNote, section.note].filter(Boolean).join(' ') || null;
    const grid = await buildMatrixSection(
      {
        columns: section.columns,
        rows: section.rows,
        note,
      },
      CONTENT_WIDTH,
    );
    body.appendChild(grid);
    grid.layoutSizingHorizontal = 'FILL';
```

- [ ] **Step 3: Typecheck + build**

Run: `./node_modules/.bin/tsc --noEmit -p packages/plugin/tsconfig.json` (exit 0). The compiler will flag any remaining `summary:` passed into `buildMatrixSection` — the states branch never passed one, so only the variants branch needed changing.

Run: `node packages/plugin/build.mjs` (expect `Built dist/main.js` + `Built dist/ui.html`).

- [ ] **Step 4: Full tests**

Run: `./node_modules/.bin/vitest run`
Expected: 617+ passing. Note `docModel.test.ts` "sets summary from prose.variantsSummary" still passes — the model still puts the guide on `section.summary`; only the render path changed.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/docFrame.ts packages/plugin/src/statesSection.ts
git commit -m "feat(plugin): render the Variants guide as prose above the matrix"
```

---

### Task 4: Manual Figma verification

No code — regenerate a component and confirm the three surfaces no longer repeat.

**Files:** none.

- [ ] **Step 1: Build**

Run: `node packages/plugin/build.mjs` (expect success).

- [ ] **Step 2: Regenerate and inspect**

In Figma desktop, generate docs for a multi-type component (e.g. Button/buttonPrimary) with **Write with AI on**, then check the Usage frame:

- [ ] **Header** shows a single sentence (what it is) — no type list, no icon/loading rundown.
- [ ] **Definition** shows what-it-is + constraint prose only — no "when to use each type" bullets.
- [ ] **Variants** shows a short orientation line, then a bulleted "when to use each type" guide with bold type names, rendered as real bullets (not raw `- **…**` text), above the matrix.
- [ ] No sentence/idea is repeated across the three surfaces.
- [ ] Re-run once more to confirm the v6 prompt is used (not a cached v5 draft): the new split should appear immediately on first regenerate after the version bump.

- [ ] **Step 3: Record results**

Note any leakage (e.g. the model still restating types in Definition). If wording drift persists, tighten the "do NOT" clauses in Task 1's prompt and regenerate — no code change needed.
