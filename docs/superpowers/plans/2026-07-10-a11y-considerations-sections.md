# Accessibility Group Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three AI-authored sections (Interactions, Design Considerations, Content Considerations) to the plugin's Accessibility group, each with its own checkbox, produced by a single selection-aware prose call so unchecked sections cost zero output tokens.

**Architecture:** `ProseDrafts` gains three optional markdown fields. `buildProsePrompt`/`parseProseResponse` become selection-aware via a requested-`ProseKey` set: the prompt asks only for requested keys and parse requires only requested keys. The plugin maps checked `SectionId`s to `ProseKey`s, threads them through `generateProse`→`draftProse`, and reuses a cached draft only when it covers the current request.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces (`@spec-layer/extractor`, `@spec-layer/plugin`), Anthropic Messages API (Haiku).

## Global Constraints

- No em dashes / en dashes as punctuation (house style; `normalizeProseText` enforces).
- Prose fields are Markdown; never `#`/`##` headings (level-3 `###` max).
- `PROSE_PROMPT_VERSION` bumps v7 → **v8**; it is part of every cache key.
- One API call per generation; `max_tokens` 2000 → **3000**.
- Backward compatibility: `buildProsePrompt(spec)` and `parseProseResponse(text)` with no requested-set argument must preserve today's behavior exactly (existing tests unchanged).
- Canonical `ProseKey` order: `definition, variantsSummary, anatomySummary, anatomyParts, accessibility, interactions, designConsiderations, contentConsiderations, dos, donts`.
- Section→key map: `definition→[definition]`, `variants→[variantsSummary]`, `anatomy→[anatomySummary, anatomyParts]`, `accessibility→[accessibility]`, `interactions→[interactions]`, `designConsiderations→[designConsiderations]`, `contentConsiderations→[contentConsiderations]`, `dosDonts→[dos, donts]`; non-AI sections → `[]`.
- Required-when-requested keys: `definition, accessibility, dos, donts, interactions, designConsiderations, contentConsiderations`. Optional even when requested: `variantsSummary, anatomySummary, anatomyParts`.

---

### Task 1: ProseDrafts fields + ProseKey type + selection-aware buildProsePrompt

**Files:**
- Modify: `packages/extractor/src/prose/prompt.ts`
- Test: `packages/extractor/test/prose.test.ts`

**Interfaces:**
- Produces: `type ProseKey`; `ProseDrafts` with optional `interactions?`, `designConsiderations?`, `contentConsiderations?`; `buildProsePrompt(spec, requested?: Set<ProseKey>): string`; `PROSE_KEY_ORDER: ProseKey[]`.

- [ ] **Step 1: Write failing tests** in `prose.test.ts`:

```ts
it('buildProsePrompt with a requested subset asks only for those keys', () => {
  const prompt = buildProsePrompt(spec, new Set(['definition', 'interactions']));
  expect(prompt).toContain('interactions (');
  expect(prompt).toContain('definition (');
  expect(prompt).not.toContain('dos (');
  expect(prompt).not.toContain('designConsiderations (');
});

it('buildProsePrompt default (no requested set) still asks for the legacy keys', () => {
  const prompt = buildProsePrompt(spec);
  expect(prompt).toContain('anatomyParts');
  expect(prompt).toMatch(/when to use which type/i);
});

it('interactions instruction names the Mouse/Keyboard/Other subheadings', () => {
  const prompt = buildProsePrompt(spec, new Set(['interactions']));
  expect(prompt).toMatch(/### Mouse/);
  expect(prompt).toMatch(/### Keyboard/);
  expect(prompt).toMatch(/### Other/);
});

it('appends the interactions/accessibility overlap note only when both are requested', () => {
  expect(buildProsePrompt(spec, new Set(['accessibility', 'interactions'])))
    .toMatch(/keyboard and mouse mechanics belong to Interactions/i);
  expect(buildProsePrompt(spec, new Set(['accessibility'])))
    .not.toMatch(/belong to Interactions/i);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @spec-layer/extractor test -- prose`
Expected: FAIL (new assertions; `ProseKey` unused).

- [ ] **Step 3: Implement.** In `prompt.ts`:

Add to `ProseDrafts`:
```ts
  interactions?: string;
  designConsiderations?: string;
  contentConsiderations?: string;
```

Add the key type + order + per-key instruction fragments, and rewrite `buildProsePrompt` to compose them:

```ts
export type ProseKey =
  | 'definition' | 'variantsSummary' | 'anatomySummary' | 'anatomyParts'
  | 'accessibility' | 'interactions' | 'designConsiderations'
  | 'contentConsiderations' | 'dos' | 'donts';

export const PROSE_KEY_ORDER: ProseKey[] = [
  'definition', 'variantsSummary', 'anatomySummary', 'anatomyParts',
  'accessibility', 'interactions', 'designConsiderations',
  'contentConsiderations', 'dos', 'donts',
];

/** Per-key output-contract fragment, emitted only for requested keys. */
const KEY_INSTRUCTIONS: Record<ProseKey, string> = {
  definition:
    "definition (specific to this component, no generic filler; one sentence defining what it is, then a short benefit-led overview: where it is used, the value it gives people, its role, and a guiding principle; do NOT name specific variants/styles or give a when-to-use guide)",
  variantsSummary:
    "variantsSummary (1-2 sentences on what varies across the options, the axes and their values, then a bulleted \"when to use which type\" guide with bold type names when it has several meaningful types)",
  anatomySummary:
    "anatomySummary (1-2 sentences describing the overall structure and the role of the key parts; omit when there is no Anatomy above)",
  anatomyParts:
    "anatomyParts (array of { name, description } where each name EXACTLY matches one of the Anatomy part names listed above and description is one concise sentence naming that part's role; omit parts you cannot meaningfully describe, and omit the key entirely when there is no Anatomy above)",
  accessibility:
    "accessibility (a bulleted list; give each bullet a short bold lead-in then the guidance; include one bullet flagging what cannot be known from the design file)",
  interactions:
    "interactions (Markdown grouped under \"### Mouse\", \"### Keyboard\", and \"### Other\" subheadings, 2-3 bullets each; anchor to the States listed above: Hover/Pressed states drive Mouse, a Focused state drives Keyboard (Tab reachability, Enter/Space or arrow activation as fits the component); Other covers screen readers, voice control, and touch-target size; if there is no state axis, write 1-2 bullets total and never invent states)",
  designConsiderations:
    "designConsiderations (3-4 bullets, designer-facing; anchor to the real color tokens and variant axes above: contrast obligations on the actual color tokens, visual distinguishability across the actual variants, and an explicit bullet when an expected state such as Focused is absent from the design)",
  contentConsiderations:
    "contentConsiderations (3-4 bullets; anchor to the text parts in Anatomy: label writing rules for the actual text parts, truncation/overflow behavior, and one internationalization bullet covering text expansion of roughly 30-40% and RTL)",
  dos: "dos (string[], 3 to 5 items, each starting with a bold rule summary then the reason)",
  donts: "donts (string[], 3 to 5 items, same shape)",
};
```

Replace the final instruction block of `buildProsePrompt` (the `lines.push('Return ONLY a JSON object with keys: ' + ...)` call) with:

```ts
  const keys = requested
    ? PROSE_KEY_ORDER.filter((k) => requested.has(k))
    : PROSE_KEY_ORDER;
  lines.push('');
  lines.push(
    'Return ONLY a JSON object with these keys: ' +
      keys.map((k) => KEY_INSTRUCTIONS[k]).join('; ') + '. ' +
      'Use Markdown for structure (bold lead-ins, lists, at most "###" subheadings); never use "#" or "##" headings. ' +
      'Do not include any prose outside the JSON. Do not use em dashes; keep sentences short.',
  );
  if (keys.includes('accessibility') && keys.includes('interactions')) {
    lines.push(
      'Note: keyboard and mouse mechanics belong to Interactions; keep accessibility to semantics, ARIA naming, and the "not in the design file" flag.',
    );
  }
```

Update the `buildProsePrompt` signature to `(spec: IntermediateSpec, requested?: Set<ProseKey>)`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @spec-layer/extractor test -- prose`
Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/prose/prompt.ts packages/extractor/test/prose.test.ts
git commit -m "feat(prose): selection-aware buildProsePrompt + Considerations keys"
```

---

### Task 2: Selection-aware parseProseResponse (conditional required, tolerant extras, new-field parsing)

**Files:**
- Modify: `packages/extractor/src/prose/prompt.ts`
- Test: `packages/extractor/test/prose.test.ts`

**Interfaces:**
- Produces: `parseProseResponse(text: string, requested?: Set<ProseKey>): ProseDrafts`.
- Consumes: `ProseKey`, `PROSE_KEY_ORDER` (Task 1).

- [ ] **Step 1: Write failing tests**:

```ts
it('parses the three new fields when present', () => {
  const out = parseProseResponse(JSON.stringify({
    definition: 'D', accessibility: 'A', dos: [], donts: [],
    interactions: '### Mouse\n- Click activates.',
    designConsiderations: '- Meet 4.5:1 contrast.',
    contentConsiderations: '- Keep labels short.',
  }));
  expect(out.interactions).toContain('### Mouse');
  expect(out.designConsiderations).toContain('4.5:1');
  expect(out.contentConsiderations).toContain('labels');
});

it('coerces a new-field array of lines into bulleted text', () => {
  const out = parseProseResponse(JSON.stringify({
    definition: 'D', accessibility: 'A', dos: [], donts: [],
    designConsiderations: ['Meet contrast.', 'Show focus.'],
  }));
  expect(out.designConsiderations).toBe('- Meet contrast.\n- Show focus.');
});

it('normalizes em dashes out of the new fields', () => {
  const out = parseProseResponse(JSON.stringify({
    definition: 'D', accessibility: 'A', dos: [], donts: [],
    interactions: 'Click — activates.',
  }));
  expect(out.interactions).toBe('Click, activates.');
});

it('when requested, requires only the requested keys', () => {
  // accessibility not requested -> its absence is not fatal
  const out = parseProseResponse(
    JSON.stringify({ definition: 'D', interactions: '- x' }),
    new Set(['definition', 'interactions']),
  );
  expect(out.definition).toBe('D');
  expect(out.interactions).toBe('- x');
});

it('when requested, a missing requested key still throws', () => {
  expect(() =>
    parseProseResponse(JSON.stringify({ definition: 'D' }), new Set(['definition', 'interactions'])),
  ).toThrow(/interactions/);
});

it('no requested set preserves the legacy required contract', () => {
  expect(() => parseProseResponse('{"definition":"D","dos":[],"donts":[]}')).toThrow(/accessibility/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @spec-layer/extractor test -- prose`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `prompt.ts`, replace the body of `parseProseResponse` after `const obj = parsed as Record<string, unknown>;` with a required-set-driven validation. Add the signature arg `requested?: Set<ProseKey>` and this logic:

```ts
  // Keys that must be present AND valid when requested (or, in legacy mode,
  // the historical four). variantsSummary/anatomySummary/anatomyParts are never
  // hard-required — a missing/wrong-typed value simply yields undefined.
  const REQUIREDABLE: ProseKey[] = [
    'definition', 'accessibility', 'interactions',
    'designConsiderations', 'contentConsiderations', 'dos', 'donts',
  ];
  const required = new Set<ProseKey>(
    requested ? REQUIREDABLE.filter((k) => requested.has(k)) : ['definition', 'accessibility', 'dos', 'donts'],
  );

  const wantString = (key: ProseKey, joiner: (i: string[]) => string): string | undefined => {
    const v = asProseText(obj[key], joiner);
    if (v === null) {
      if (required.has(key)) throw new Error(`Prose response missing or invalid field: ${key}`);
      return undefined;
    }
    return v;
  };
  const wantArray = (key: ProseKey): string[] | undefined => {
    const v = asStringArray(obj[key]);
    if (v === null) {
      if (required.has(key)) throw new Error(`Prose response field "${key}" must be a string[]`);
      return undefined;
    }
    return v;
  };

  const definition = wantString('definition', joinParagraphs);
  const accessibility = wantString('accessibility', joinBullets);
  const interactions = wantString('interactions', joinBullets);
  const designConsiderations = wantString('designConsiderations', joinBullets);
  const contentConsiderations = wantString('contentConsiderations', joinBullets);
  const dos = wantArray('dos');
  const donts = wantArray('donts');

  const rawVariantsSummary = asProseText(obj.variantsSummary, joinParagraphs);
  const variantsSummary = rawVariantsSummary === null ? undefined : rawVariantsSummary;
  const rawAnatomySummary = asProseText(obj.anatomySummary, joinParagraphs);
  const anatomySummary = rawAnatomySummary === null ? undefined : rawAnatomySummary;
  const anatomyParts = parseAnatomyParts(obj.anatomyParts);

  const generatedStrings = [
    definition, accessibility, interactions, designConsiderations, contentConsiderations,
    variantsSummary, anatomySummary,
    ...(dos ?? []), ...(donts ?? []),
    ...(anatomyParts?.map((p) => p.description) ?? []),
  ].filter((s): s is string => typeof s === 'string');
  if (generatedStrings.some((value) => /^#{1,2}(?:\s|$)/m.test(value))) {
    throw new Error('Prose response must not contain level-one or level-two markdown headings (use level-three at most)');
  }

  const norm = (s: string | undefined) => (s === undefined ? undefined : normalizeProseText(s));
  return {
    definition: normalizeProseText(definition ?? ''),
    accessibility: normalizeProseText(accessibility ?? ''),
    dos: (dos ?? []).map(normalizeProseText),
    donts: (donts ?? []).map(normalizeProseText),
    ...(variantsSummary !== undefined ? { variantsSummary: normalizeProseText(variantsSummary) } : {}),
    ...(anatomySummary !== undefined ? { anatomySummary: normalizeProseText(anatomySummary) } : {}),
    ...(anatomyParts ? { anatomyParts } : {}),
    ...(norm(interactions) !== undefined ? { interactions: norm(interactions)! } : {}),
    ...(norm(designConsiderations) !== undefined ? { designConsiderations: norm(designConsiderations)! } : {}),
    ...(norm(contentConsiderations) !== undefined ? { contentConsiderations: norm(contentConsiderations)! } : {}),
  };
```

Note: `definition`/`accessibility`/`dos`/`donts` remain non-optional on the returned object (default to `''`/`[]`) so `ProseDrafts`' required-field shape and existing consumers are unchanged; they only become non-fatal when not requested.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @spec-layer/extractor test -- prose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/prose/prompt.ts packages/extractor/test/prose.test.ts
git commit -m "feat(prose): conditional-required parse with Considerations fields"
```

---

### Task 3: Extend the few-shot exemplar with the three new keys

**Files:**
- Modify: `packages/extractor/src/prose/prompt.ts` (`FEW_SHOT_PROMPT`, `FEW_SHOT_RESPONSE`)
- Test: `packages/extractor/test/prose.test.ts`

**Interfaces:**
- Consumes: `proseFewShot()` output shape (unchanged).

- [ ] **Step 1: Write failing test**:

```ts
it('few-shot exemplar carries Interactions and both Considerations sections', () => {
  const drafts = parseProseResponse(proseFewShot()[1].content);
  expect(drafts.interactions).toMatch(/### Mouse/);
  expect(drafts.interactions).toMatch(/### Keyboard/);
  expect(drafts.designConsiderations).toMatch(/^- /m);
  expect(drafts.contentConsiderations).toMatch(/^- /m);
  expect(proseFewShot()[1].content).not.toMatch(/—/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @spec-layer/extractor test -- prose`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `FEW_SHOT_PROMPT`, append `interactions`, `designConsiderations`, `contentConsiderations` to the described key list (mirror `KEY_INSTRUCTIONS` wording). In `FEW_SHOT_RESPONSE`, add:

```ts
  interactions: [
    '### Mouse',
    '- Clicking anywhere on the container activates the action; the whole button is the target, not just the label.',
    '- On hover the surface changes to signal it is interactive, and the cursor becomes a pointer.',
    '### Keyboard',
    '- Tab moves focus to the button in reading order; a visible focus ring shows where focus landed.',
    '- Enter or Space activates the focused button.',
    '### Other',
    '- Screen readers announce the label and the button role; an icon-only button needs an explicit name.',
    '- Keep the touch target at least 44 by 44 px so it is comfortable to tap.',
  ].join('\n'),
  designConsiderations: [
    '- Keep label-to-background contrast at 4.5:1 or better in every style so the action stays legible.',
    '- Make the interactive states visually distinct from each other, so hover, focus, and pressed never look identical.',
    '- Confirm a visible focus state exists in build; focus styling is not always encoded in the design file.',
  ].join('\n'),
  contentConsiderations: [
    '- Write labels as a verb-first action in one to three words ("Save", "Add item"), not a vague "OK".',
    '- Plan for labels that wrap or truncate; do not rely on a fixed width holding every translation.',
    '- Allow for text expansion of roughly 30-40% and mirrored layout in right-to-left languages.',
  ].join('\n'),
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @spec-layer/extractor test -- prose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/prose/prompt.ts packages/extractor/test/prose.test.ts
git commit -m "feat(prose): few-shot exemplar for Interactions + Considerations"
```

---

### Task 4: Client — v8, key-aware cache, thread requested, max_tokens

**Files:**
- Modify: `packages/extractor/src/prose/client.ts`
- Test: `packages/extractor/test/prose.test.ts`, `packages/extractor/test/client.test.ts`

**Interfaces:**
- Consumes: `ProseKey`, `buildProsePrompt(spec, requested)`, `parseProseResponse(text, requested)`.
- Produces: `proseCacheKey(spec, { image?, keys? })`; `DraftOptions.requested?: Set<ProseKey>`; `draftProse` threads `requested`.

- [ ] **Step 1: Write failing tests** (`client.test.ts`):

```ts
it('folds the requested key set into the cache key', () => {
  const a = proseCacheKey(spec, { keys: ['definition', 'interactions'] });
  const b = proseCacheKey(spec, { keys: ['definition'] });
  expect(a).not.toEqual(b);
  expect(a).toContain('v8');
});

it('key is order-independent for the same set', () => {
  expect(proseCacheKey(spec, { keys: ['interactions', 'definition'] }))
    .toEqual(proseCacheKey(spec, { keys: ['definition', 'interactions'] }));
});
```

And in `prose.test.ts`:

```ts
it('passes the requested set to the prompt and requires it on parse', async () => {
  let body: any;
  const fetcher = vi.fn(async (_u: unknown, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return { ok: true, json: async () => ({ content: [{ text: '{"definition":"D","interactions":"- x"}' }] }) };
  }) as unknown as typeof fetch;
  const store = { get: vi.fn(async () => null), set: vi.fn(async () => {}) };
  const out = await draftProse(spec, {
    apiKey: 'k', fetcher, cacheStore: store,
    requested: new Set(['definition', 'interactions']),
  });
  expect(out?.interactions).toBe('- x');
  expect(body.max_tokens).toBe(3000);
  expect(String(body.messages.at(-1).content)).toContain('interactions (');
  expect(String(body.messages.at(-1).content)).not.toContain('accessibility (');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @spec-layer/extractor test`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `client.ts`:

Bump version + doc:
```ts
 * v8 = accessibility group expansion (Interactions, Design/Content Considerations)
 *      + selection-aware prompting/cache keys.
 */
export const PROSE_PROMPT_VERSION = 'v8';
```

Rewrite `proseCacheKey`:
```ts
export function proseCacheKey(
  spec: IntermediateSpec,
  opts: { image?: boolean; keys?: readonly ProseKey[] } = {},
): string {
  const keySig = opts.keys && opts.keys.length
    ? `:keys=${[...opts.keys].slice().sort().join(',')}`
    : '';
  return `prose:${PROSE_PROMPT_VERSION}:${contentHash(spec)}${opts.image ? ':img' : ''}${keySig}`;
}
```

Add `requested?: Set<ProseKey>` to `DraftOptions`; import `ProseKey` from `./prompt`. In `draftProse`:
```ts
  const key = proseCacheKey(spec, {
    image: Boolean(opts.imageUrl || opts.imageBase64),
    keys: opts.requested ? [...opts.requested] : undefined,
  });
  if (!opts.bypassCache) {
    const hit = await opts.cacheStore.get(key);
    if (hit) return parseProseResponse(hit, opts.requested);
  }
  const prompt = buildProsePrompt(spec, opts.requested);
```
Change `max_tokens: 2000` → `max_tokens: 3000`. Change the final parse to `parseProseResponse(raw, opts.requested)`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @spec-layer/extractor test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extractor/src/prose/client.ts packages/extractor/test/*.ts
git commit -m "feat(prose): v8 key-aware cache + thread requested keys through client"
```

---

### Task 5: docModel — new sections, render cases, section→key map

**Files:**
- Modify: `packages/plugin/src/ui/docModel.ts`
- Test: `packages/plugin/test/docModel.test.ts`

**Interfaces:**
- Consumes: `ProseKey` from `@spec-layer/extractor` (re-exported via `prose/prompt`).
- Produces: `SectionId` adds `'interactions' | 'designConsiderations' | 'contentConsiderations'`; `proseKeysForSections(ids: Iterable<SectionId>): Set<ProseKey>`.

- [ ] **Step 1: Write failing tests** (append to `docModel.test.ts`):

```ts
it('renders the three new a11y sections as prose with placeholder fallback', () => {
  const ids = new Set<SectionId>(['interactions', 'designConsiderations', 'contentConsiderations']);
  const noProse = buildDocModel(spec, null, ids);
  for (const id of ids) {
    const block = noProse.sections.find((s) => s.id === id);
    expect(block?.kind).toBe('prose');
    expect((block as any).text).toBe('_To be written._');
  }
  const withProse = buildDocModel(spec, {
    ...prose, interactions: '### Mouse\n- x', designConsiderations: '- y', contentConsiderations: '- z',
  }, ids);
  expect((withProse.sections.find((s) => s.id === 'interactions') as any).text).toContain('### Mouse');
});

it('orders the a11y group Interactions -> Design -> Content -> Accessibility', () => {
  const a11y = ALL_SECTIONS.filter((s) => s.group === 'a11y').map((s) => s.id);
  expect(a11y).toEqual(['interactions', 'designConsiderations', 'contentConsiderations', 'accessibility']);
});

it('maps checked sections to prose keys', () => {
  expect([...proseKeysForSections(['anatomy'])].sort()).toEqual(['anatomyParts', 'anatomySummary']);
  expect([...proseKeysForSections(['interactions', 'related'])]).toEqual(['interactions']);
  expect([...proseKeysForSections(['dosDonts'])].sort()).toEqual(['donts', 'dos']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @spec-layer/plugin test -- docModel`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `docModel.ts`:

Extend `SectionId`:
```ts
export type SectionId =
  | 'definition' | 'anatomy' | 'measurements' | 'configuration' | 'variants'
  | 'states' | 'tokens' | 'interactions' | 'designConsiderations'
  | 'contentConsiderations' | 'accessibility' | 'dosDonts' | 'related';
```

Insert three entries in `ALL_SECTIONS` immediately before the `accessibility` entry:
```ts
  { id: 'interactions',          label: 'Interactions',           ai: true,  group: 'a11y'  },
  { id: 'designConsiderations',  label: 'Design Considerations',  ai: true,  group: 'a11y'  },
  { id: 'contentConsiderations', label: 'Content Considerations', ai: true,  group: 'a11y'  },
```

Add the import and the map (place near the top-level exports):
```ts
import type { ProseKey } from '@spec-layer/extractor';

const PROSE_KEYS_BY_SECTION: Partial<Record<SectionId, ProseKey[]>> = {
  definition: ['definition'],
  variants: ['variantsSummary'],
  anatomy: ['anatomySummary', 'anatomyParts'],
  accessibility: ['accessibility'],
  interactions: ['interactions'],
  designConsiderations: ['designConsiderations'],
  contentConsiderations: ['contentConsiderations'],
  dosDonts: ['dos', 'donts'],
};

export function proseKeysForSections(ids: Iterable<SectionId>): Set<ProseKey> {
  const out = new Set<ProseKey>();
  for (const id of ids) for (const k of PROSE_KEYS_BY_SECTION[id] ?? []) out.add(k);
  return out;
}
```

Add three cases in `buildSection`'s `switch` (beside `accessibility`):
```ts
    case 'interactions':
      return { id, heading: label, kind: 'prose', text: prose?.interactions ?? AI_PLACEHOLDER };
    case 'designConsiderations':
      return { id, heading: label, kind: 'prose', text: prose?.designConsiderations ?? AI_PLACEHOLDER };
    case 'contentConsiderations':
      return { id, heading: label, kind: 'prose', text: prose?.contentConsiderations ?? AI_PLACEHOLDER };
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @spec-layer/plugin test -- docModel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/docModel.ts packages/plugin/test/docModel.test.ts
git commit -m "feat(plugin): Interactions + Considerations sections in docModel"
```

---

### Task 6: Plugin wiring — thread requested keys, coverage-based reuse, default-off checkboxes

**Files:**
- Modify: `packages/plugin/src/ui/ai.ts`, `packages/plugin/src/ui/actions.ts`, `packages/plugin/src/ui/dom.ts`
- Test: `packages/plugin/test/actions.test.ts` (create if the prose path is untested)

**Interfaces:**
- Consumes: `generateProse(spec, apiKey, nodeId, requested?)`; `proseKeysForSections` (Task 5); `draftProse` `requested` option (Task 4).
- Produces: `UiState.generatedProseKeys: Set<ProseKey> | null`.

- [ ] **Step 1: Write failing test.** In `actions.test.ts`, cover the coverage-check helper. Since `willGenerateProse` is module-private, export a pure helper `proseNeedsRegen(state, requested)` from `actions.ts` and test it:

```ts
import { proseNeedsRegen } from '../src/ui/actions';

it('regenerates when the cached draft misses a requested key', () => {
  const state = { generatedProse: { definition: 'd' }, generatedProseKeys: new Set(['definition']) } as any;
  expect(proseNeedsRegen(state, new Set(['definition', 'interactions']))).toBe(true);
});
it('reuses when the cached draft covers the request', () => {
  const state = { generatedProse: { definition: 'd' }, generatedProseKeys: new Set(['definition', 'interactions']) } as any;
  expect(proseNeedsRegen(state, new Set(['interactions']))).toBe(false);
});
it('regenerates when there is no draft yet', () => {
  const state = { generatedProse: null, generatedProseKeys: null } as any;
  expect(proseNeedsRegen(state, new Set(['definition']))).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @spec-layer/plugin test -- actions`
Expected: FAIL (`proseNeedsRegen` not exported).

- [ ] **Step 3: Implement.**

`ai.ts` — thread the set:
```ts
import type { IntermediateSpec, ProseDrafts, ProseKey } from '@spec-layer/extractor';
// ...
export async function generateProse(
  spec: IntermediateSpec, apiKey: string, nodeId: string, requested?: Set<ProseKey>,
): Promise<ProseDrafts | null> {
  const img = await requestImage(nodeId);
  return draftProse(spec, {
    apiKey, fetcher: window.fetch.bind(window), cacheStore,
    imageBase64: img?.base64 ?? null, imageMediaType: img?.mediaType,
    requested,
  });
}
```

`actions.ts` — add state fields, the helper, and rewrite the generation gate:
```ts
import type { IntermediateSpec, ProseDrafts, ProseKey } from '@spec-layer/extractor';
import { ALL_SECTIONS, buildDocModel, proseKeysForSections, type SectionId } from './docModel';
```
Add to `UiState`: `generatedProseKeys: Set<ProseKey> | null;` and initialise to `null` in `createState`.

Add the checked-sections and requested-keys helpers plus the coverage check:
```ts
function checkedSectionIds(refs: Refs): Set<SectionId> {
  const out = new Set<SectionId>();
  for (const { id } of ALL_SECTIONS) if (refs.sectionChecks[id]?.checked) out.add(id);
  return out;
}

/** True when a fresh draft is needed: no draft, or the cached draft was made
 *  for a key set that does not cover everything now requested. */
export function proseNeedsRegen(state: UiState, requested: Set<ProseKey>): boolean {
  if (!state.generatedProse || !state.generatedProseKeys) return true;
  for (const k of requested) if (!state.generatedProseKeys.has(k)) return true;
  return false;
}
```

Rewrite `willGenerateProse` and `ensureProse`:
```ts
function requestedProseKeys(refs: Refs): Set<ProseKey> {
  return proseKeysForSections(checkedSectionIds(refs));
}

function willGenerateProse(refs: Refs, state: UiState): boolean {
  if (!state.aiEnabled || !state.anthropicKey) return false;
  const requested = requestedProseKeys(refs);
  if (requested.size === 0) return false;
  return proseNeedsRegen(state, requested);
}

async function ensureProse(refs: Refs, state: UiState): Promise<void> {
  state.pendingAiNote = '';
  if (!willGenerateProse(refs, state)) return;
  const requested = requestedProseKeys(refs);
  try {
    state.generatedProse = await generateProse(
      state.currentSpec!, state.anthropicKey!, state.currentNode!.id, requested,
    );
    state.generatedProseKeys = state.generatedProse ? requested : null;
  } catch (err) {
    state.generatedProse = null;
    state.generatedProseKeys = null;
    const detail = err instanceof Error ? err.message : String(err);
    state.pendingAiNote = `AI skipped (${detail}) — placeholders used`;
  }
}
```

`dom.ts` — default the three new sections off (opt-in, consistent with the token-thrift goal). Replace line 989 `input.checked = section.id !== 'related';` with:
```ts
      const DEFAULT_OFF = new Set<SectionId>(['related', 'interactions', 'designConsiderations', 'contentConsiderations']);
      input.checked = !DEFAULT_OFF.has(section.id);
```
Add `type SectionId` to the existing `./docModel` import in `dom.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @spec-layer/plugin test`
Expected: PASS.

- [ ] **Step 5: Full build + typecheck**

Run: `pnpm -r build && pnpm -r test`
Expected: All packages build and pass.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/ui/ai.ts packages/plugin/src/ui/actions.ts packages/plugin/src/ui/dom.ts packages/plugin/test/actions.test.ts
git commit -m "feat(plugin): selection-aware prose request + coverage-based reuse"
```

---

## Self-Review

**Spec coverage:** §1 section model → Task 5; §2 payload fields → Tasks 1-2; §3 selection-aware prompting → Tasks 1,4,6; §4 grounding facts → Task 1 (`KEY_INSTRUCTIONS`) + Task 3 (few-shot); §5 overlap control → Task 1; §6 few-shot → Task 3; §7 client (v8, cache key, max_tokens, thread) → Task 4; §8 plugin reuse guard → Task 6. All covered.

**Placeholder scan:** none; every code step carries real code.

**Type consistency:** `ProseKey` defined Task 1, exported via `prose/prompt` (already `export *` in index), consumed by Tasks 4-6. `proseKeysForSections` defined Task 5, used Task 6. `requested?: Set<ProseKey>` signature consistent across `buildProsePrompt`, `parseProseResponse`, `draftProse`, `generateProse`. `generatedProseKeys` added to `UiState` in Task 6.

**Manual Figma check:** after Task 6, load the built plugin in Figma, tick Interactions + both Considerations on a Button, generate, and confirm the Accessibility frame renders the three prose blocks with `### Mouse/Keyboard/Other` subheadings. (Carries the existing plugin-2.0 manual-test debt; not automatable here.)
