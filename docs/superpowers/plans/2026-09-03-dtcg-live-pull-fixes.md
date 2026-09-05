# DTCG Live Pull Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the defects the first live `spec-layer pull` of a real design system exposed in the DTCG export, and calibrate v5 diagnostic severities so "error" means a value is missing or wrong.

**Architecture:** Four targeted changes in `packages/extractor/src/v5/dtcg.ts` and its tests (dropped style bindings reported, mode-selection noise removed, percent line heights converted to multipliers), one CLI change (the manifest records `dtcg` options so a config change re-projects on pull, and stdout EPIPE is handled), and one diagnostics change (`UNIT_METADATA_UNAVAILABLE` becomes a once-per-token warning; the metadata-only and scope-only uses of `SOURCE_PARTIALLY_UNAVAILABLE` move to new info codes). Nothing here touches a hash, the schema payload, or `EXTRACTOR_VERSION`.

**Tech Stack:** TypeScript, Vitest, esbuild.

**Evidence:** the live pull of `Design System Variables` (a 5.0.0 bundle) on 2026-09-03: 208 report entries of which 187 were `mode_selection_not_expressible` for aliases into the single-mode Foundation; 21 `%` line heights parked under `$extensions`; five style bindings to unavailable variables silently rendered as literals; `pull` answered "Already up to date" after `dtcg.values` changed; `show foundation | head` crashed with EPIPE; the canonical artifact reported 70 errors of which 64 were `UNIT_METADATA_UNAVAILABLE`.

## Global Constraints

- Never fabricate a value, unit, mode, id, type, or completeness claim. A dropped binding is reported, never hidden. A percent line height becomes a multiplier by dividing by 100, which is a unit conversion of the same fact; a px line height is never divided by a font size.
- `packages/extractor` stays Figma-free. `dtcg.ts` imports only from `./canonical`, `./entities`, `./value`, `./precision`, `./diagnostics`.
- Do not use `localeCompare` under `src/v5`. Use `compareCodeUnits`.
- Diagnostics, statistics, and the DTCG report are outside every hash. No change here may move `semanticContentHash`, `foundationContentHash`, or `specContentHash`, and `EXTRACTOR_VERSION` stays `'2'`. The JSON schemas do not change; if a task finds the schema enumerates diagnostic codes, stop and report instead of editing it.
- Plugin UI copy: sentence case, second person, no em dashes.
- Commits: single line, lowercase, scoped. `CHANGELOG.md` updated under `## [Unreleased]` in the task that changes behavior.
- No raw NUL bytes anywhere. Composite map keys use `JSON.stringify([a, b])`.
- Run tests with `npx vitest run <path>` from the repo root. The full gate is `npm run check`.
- The design spec `docs/superpowers/specs/2026-09-03-dtcg-foundation-export-design.md` must describe the code after each task; update the named section in the same commit.

## File structure

| File | Responsibility |
|---|---|
| `packages/cli/src/files.ts` | `Manifest.dtcg`, written by `writeBundleFiles` |
| `packages/cli/src/commands.ts` | freshness comparison includes `dtcg`; `sameSelection` becomes `sameOutput` |
| `packages/cli/src/cli.ts` | EPIPE on stdout exits quietly |
| `packages/cli/test/files.test.ts`, `commands.test.ts` | tests |
| `packages/cli/README.md` | one sentence on re-projection after a config change |
| `packages/extractor/src/v5/dtcg.ts` | `binding_dropped` report code; mode-selection rule; percent line height |
| `packages/extractor/test/v5/dtcg.test.ts` | tests per rule |
| `packages/extractor/src/v5/diagnostics.ts` | severities; new codes `METADATA_UNAVAILABLE`, `EXPORT_SCOPED` |
| `packages/extractor/src/v5/fromFoundation.ts`, `normalize.ts` | emission sites |
| `packages/extractor/test/fixtures/v5/*` | regenerated goldens |
| `docs/specs/foundation-context-v5.md` | §14.1 table |
| `docs/superpowers/specs/2026-09-03-dtcg-foundation-export-design.md` | Aliases, Styles, Report sections |
| `CHANGELOG.md` | entries |

---

### Task 1: CLI re-projects when `dtcg` options change; EPIPE exits quietly

**Files:**
- Modify: `packages/cli/src/files.ts` (`Manifest` interface, `writeBundleFiles`)
- Modify: `packages/cli/src/commands.ts` (`sameSelection` at line 33, `runPull` ETag decision at line 229)
- Modify: `packages/cli/src/cli.ts` (top of `main`, or before `process.exitCode = await main()`)
- Modify: `packages/cli/test/files.test.ts`, `packages/cli/test/commands.test.ts`
- Modify: `packages/cli/README.md`, `CHANGELOG.md`

**Interfaces:**
- Produces: `Manifest.dtcg?: DtcgOptions` (absent when the pull used defaults); `sameOutput(a: { selection: Selection; dtcg?: DtcgOptions }, b: { selection: Selection; dtcg?: DtcgOptions }): boolean` replacing `sameSelection`.

- [ ] **Step 1: Write the failing tests**

In `packages/cli/test/commands.test.ts`, inside `describe('runPull with a selection')` or a new `describe('runPull with dtcg options')`, using the same fake fetcher and temp `cwd` the file already uses (read a neighbouring test to copy the setup exactly):

```ts
it('re-projects tokens/ when the dtcg block changes, instead of answering up to date', async () => {
  // First pull with defaults.
  writeFileSync(join(cwd, 'speclayer.json'), JSON.stringify({ libraryId: 'lib_1' }));
  expect(await runPull(cwd, { key: 'sl_k' }, {}, io, fetcher)).toBe(0);
  const standard = JSON.parse(readFileSync(join(cwd, '.speclayer/tokens/primitives.light.json'), 'utf8'));
  expect(standard.Primitives.color.exact.red.$value).toMatchObject({ hex: '#ff0000' });
  // Same bundle, new dtcg config.
  writeFileSync(join(cwd, 'speclayer.json'), JSON.stringify({ libraryId: 'lib_1', dtcg: { values: 'legacy' } }));
  expect(await runPull(cwd, { key: 'sl_k' }, {}, io, fetcher)).toBe(0);
  expect(io.lines().join('\n')).not.toContain('Already up to date');
  const legacy = JSON.parse(readFileSync(join(cwd, '.speclayer/tokens/primitives.light.json'), 'utf8'));
  expect(legacy.Primitives.color.exact.red.$value).toBe('#ff0000');
  // And a third pull with nothing changed is up to date again.
  expect(await runPull(cwd, { key: 'sl_k' }, {}, io, fetcher)).toBe(0);
  expect(io.lines().at(-1)).toContain('Already up to date');
});
```

Adapt `io.lines()` to however the file's fake `Io` records output. The fake fetcher must return the real synthetic foundation bundle (the `realFoundation()` helper from Task 8 of the previous plan exists in `files.test.ts`; move or copy it) and answer 304 when the request carries the matching ETag, as the existing "re-pull with unchanged content" test already arranges.

In `packages/cli/test/files.test.ts`:

```ts
it('records the dtcg options in the manifest, and omits the field for defaults', () => {
  const bundle = makeBundle({ foundation: realFoundation() });
  writeBundleFiles({
    outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_1',
    publishedAt: '2026-09-03T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    dtcg: { values: 'legacy', units: { 'Primitives/number/*': 'px' } },
  });
  expect(readManifest(outDir)!.dtcg).toEqual({ values: 'legacy', units: { 'Primitives/number/*': 'px' } });
  writeBundleFiles({
    outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_1',
    publishedAt: '2026-09-03T00:00:00.000Z', bundleHash: 'h'.repeat(64),
  });
  expect(readManifest(outDir)!).not.toHaveProperty('dtcg');
});
```

Run: `npx vitest run packages/cli`
Expected: both new tests FAIL.

- [ ] **Step 2: Implement**

`files.ts`: add `dtcg?: DtcgOptions;` to `Manifest` with the comment "The dtcg options the tokens/ directory was projected with; absent for defaults. Part of the freshness comparison, since a config change must re-project even when the bundle did not move." In `writeBundleFiles`, when building `manifest`, add `...(opts.dtcg && Object.keys(opts.dtcg).length > 0 ? { dtcg: opts.dtcg } : {})`.

`commands.ts`: replace `sameSelection` with

```ts
/** Two pulls write the same files when they agree on the selection and on the dtcg options. */
function sameOutput(
  a: { selection: Selection; dtcg?: DtcgOptions },
  b: { selection: Selection; dtcg?: DtcgOptions },
): boolean {
  const selectionKey = (s: Selection) =>
    JSON.stringify([s.foundation, s.components === null ? null : [...new Set(s.components.map(slugify))].sort()]);
  const dtcgKey = (d: DtcgOptions | undefined) => JSON.stringify(sortKeys(d ?? {}));
  return selectionKey(a.selection) === selectionKey(b.selection) && dtcgKey(a.dtcg) === dtcgKey(b.dtcg);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]));
  }
  return value;
}
```

and in `runPull` compute `etag` as `manifest && sameOutput({ selection: manifest.selection ?? DEFAULT_SELECTION, dtcg: manifest.dtcg }, { selection, dtcg: opts.dtcg }) ? manifest.bundleHash : undefined`. Import `DtcgOptions` from `@spec-layer/extractor` (type only). Update the comment above the ETag line: "Ask for a 304 only when the last pull wrote the same files this one would; a changed selection or dtcg block needs the bundle again to re-project."

`cli.ts`: before `process.exitCode = await main();` add

```ts
// `spec-layer show foundation | head` closes stdout early. That is not an
// error worth a stack trace; exit quietly with the code the command chose.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(process.exitCode ?? 0);
  throw err;
});
```

- [ ] **Step 3: Run, README, changelog, commit**

Run: `npx vitest run packages/cli && npm run typecheck && npm run lint && npm run build:cli && npm run check:cli-bundle`
Expected: PASS.

Manual check of the EPIPE path: `node packages/cli/dist/cli.js --help | head -1` should print one line and no stack trace (usage goes to stderr, so use `node packages/cli/dist/cli.js list 2>/dev/null | head -1` in a directory with a pull if one exists; otherwise note the check as not run).

In `packages/cli/README.md`, in the "Configuring the token output" section, add: "Changing the `dtcg` block re-projects `tokens/` on the next `pull` even when the library has not been republished."

`CHANGELOG.md` under `## [Unreleased]` / `### Fixed`:

```markdown
- `spec-layer pull` re-projects `tokens/` when the `dtcg` block in
  `speclayer.json` changes. It used to answer "Already up to date" because
  freshness compared only the selection; the manifest now records the dtcg
  options and compares them too. `show foundation | head` no longer prints an
  EPIPE stack trace when the reader closes early.
```

```bash
git add packages/cli CHANGELOG.md
git commit -m "fix(cli): re-project tokens when dtcg options change and exit quietly on epipe"
```

---

### Task 2: Report a style binding whose target is unavailable or omitted

**Files:**
- Modify: `packages/extractor/src/v5/dtcg.ts` (`styleMember`, `effectLeaf`, `DtcgReportCode`)
- Modify: `packages/extractor/test/v5/dtcg.test.ts`
- Modify: `docs/superpowers/specs/2026-09-03-dtcg-foundation-export-design.md` (Report codes; Styles section)

**Interfaces:**
- Produces: report code `binding_dropped`, severity `warning`, `path` = the style's DTCG path, `details: { property, target_id, reason: 'target_unavailable' | 'target_omitted' }`. `target_unavailable` when the id is not a token in the artifact; `target_omitted` when it is a token this projection omitted.

- [ ] **Step 1: Write the failing tests**

```ts
it('reports a typography property whose bound token is not in the artifact, and keeps the literal', () => {
  const artifact = syntheticArtifact();
  const style = artifact.styles.typography[0];
  style.properties.font_size.source = { kind: 'alias', target_id: 'VariableID:not-here', target_path: [] };
  const out = foundationDtcg(artifact);
  const body = leaf(out.files['styles.typography.json'], 'Typography styles.Body.Regular');
  expect(body?.$value).toMatchObject({ fontSize: { value: 16, unit: 'px' } });
  expect(out.report).toContainEqual(expect.objectContaining({
    code: 'binding_dropped', severity: 'warning', path: 'Typography styles.Body.Regular',
    details: { property: 'fontSize', target_id: 'VariableID:not-here', reason: 'target_unavailable' },
  }));
});

it('reports a shadow field whose bound token was omitted, and keeps the literal', () => {
  const artifact = syntheticArtifact();
  const blur = artifact.tokens.find((t) => t.id === 'VariableID:shadow-blur');
  if (!blur) throw new Error('fixture lost shadow-blur');
  blur.type = 'boolean'; // boolean tokens are omitted by the projection
  const out = foundationDtcg(artifact);
  const card = leaf(out.files['styles.effects.json'], 'Effect styles.Shadow.Card');
  expect((card?.$value as Array<Record<string, unknown>>)[0].blur).toEqual({ value: 12, unit: 'px' });
  expect(out.report).toContainEqual(expect.objectContaining({
    code: 'binding_dropped', path: 'Effect styles.Shadow.Card',
    details: { property: 'effects[0].blur', target_id: 'VariableID:shadow-blur', reason: 'target_omitted' },
  }));
});
```

Confirm the fixture ids (`VariableID:shadow-blur`, the `Body/Regular` font size of 16 px, the `Shadow/Card` blur of 12 px) against `synthetic-foundation-direct-v5.yaml` first. Setting a token's `type` to `boolean` while its values stay dimensions is only a way to make the projection omit it; if `foundationDtcg` rejects that mutation, instead rename the blur token to collide with another token's path, which also omits it.

Run: `npx vitest run packages/extractor/test/v5/dtcg.test.ts`
Expected: FAIL, no `binding_dropped` entries.

- [ ] **Step 2: Implement**

Add `'binding_dropped'` to `DtcgReportCode`. In `styleMember`, the alias branch currently falls through to the literal when the target path is missing. Make it report first:

```ts
  if (property.source.kind === 'alias' && property.source.target_id !== null) {
    const targetId = property.source.target_id;
    const target = p.omittedIds.has(targetId) ? undefined : p.pathById.get(targetId);
    if (target !== undefined) return { value: `{${target}}` };
    reportOnce(p, {
      code: 'binding_dropped', severity: 'warning', path,
      message: `The ${name} property is bound to a token this export does not carry; the resolved literal is written instead.`,
      details: {
        property: name, target_id: targetId,
        reason: p.artifact.tokens.some((t) => t.id === targetId) ? 'target_omitted' : 'target_unavailable',
      },
    });
  }
```

Build a `tokenIds: Set<string>` on `Projection` once rather than scanning `artifact.tokens` per call. In `effectLeaf`, where `boundId` is defined but `boundPath` is `undefined`, emit the same report with `property: \`effects[${index}].${field}\`` before falling through to the literal.

- [ ] **Step 3: Spec, run, commit**

Spec Report section: add `binding_dropped` to the code list with one sentence. Spec Styles section: "A property bound to a token the export does not carry keeps its resolved literal and is reported `binding_dropped` with the target id and whether the target was unavailable or omitted."

Run: `npx vitest run packages/extractor && npm run typecheck && npm run lint`
Expected: PASS; the golden is unchanged because the fixture has no such binding.

```bash
git add packages/extractor docs/superpowers/specs/2026-09-03-dtcg-foundation-export-design.md
git commit -m "fix(v5): report a dtcg style binding whose target is not exported"
```

---

### Task 3: `mode_selection_not_expressible` only for multi-mode targets

**Files:**
- Modify: `packages/extractor/src/v5/dtcg.ts` (the `mode_selection_not_expressible` block in `tokenLeaf`)
- Modify: `packages/extractor/test/v5/dtcg.test.ts`
- Modify: the design spec's Aliases section

- [ ] **Step 1: Write the failing test**

```ts
it('does not report mode selection for an alias into a single-mode collection', () => {
  const artifact = syntheticArtifact();
  const primitives = artifact.collections.find((c) => c.id === 'CollectionID:primitives');
  if (!primitives) throw new Error('fixture lost Primitives');
  // Collapse Primitives to one mode so every cross-collection hop lands on it.
  const keep = primitives.modes[0];
  primitives.modes = [keep];
  primitives.default_mode_id = keep.id;
  for (const token of artifact.tokens) {
    if (token.collection_id !== primitives.id) continue;
    token.values = { [keep.id]: token.values[keep.id] };
  }
  const out = foundationDtcg(artifact);
  expect(out.report.filter((r) => r.code === 'mode_selection_not_expressible')).toEqual([]);
  expect(leaf(out.files['semantic.dark.json'], 'Semantic.color.surface.primary')?.$value)
    .toBe('{Primitives.color.chain.bridge}');
});
```

The existing `mode_selection_not_expressible` test (a renamed hop mode on the three-mode Primitives) must keep passing.

Run: `npx vitest run packages/extractor/test/v5/dtcg.test.ts`
Expected: the new test FAILS with entries present.

- [ ] **Step 2: Implement**

In the block that compares `hopMode !== mode`, add the guard `targetCollection !== undefined && targetCollection.modes.length > 1 &&` so a single-mode target never reports. Add a comment: "A single-mode target set resolves the same way in every context, so nothing is lost. Only a multi-mode target can resolve differently under the consumer's contexts than Figma did."

- [ ] **Step 3: Spec, run, commit**

Spec Aliases section: after the sentence about `mode_selection_not_expressible`, add "The entry is emitted only when the target collection has more than one mode; a single-mode target resolves identically in every context."

Run: `npx vitest run packages/extractor && npm run typecheck && npm run lint`
Expected: PASS; the golden is unchanged.

```bash
git add packages/extractor docs/superpowers/specs/2026-09-03-dtcg-foundation-export-design.md
git commit -m "fix(v5): report dtcg mode selection only for multi-mode targets"
```

---

### Task 4: Percent line height becomes a multiplier

**Files:**
- Modify: `packages/extractor/src/v5/dtcg.ts` (`typographyLeaf` line-height handling)
- Modify: `packages/extractor/test/v5/dtcg.test.ts`
- Modify: the design spec's Styles section
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the failing test**

```ts
it('writes a percent line height as a multiplier and keeps a px line height under extensions', () => {
  const artifact = syntheticArtifact();
  const style = artifact.styles.typography[0];
  style.properties.line_height = { source: { kind: 'literal' }, resolved: { type: 'dimension', number: 140, unit: '%' } };
  const out = foundationDtcg(artifact);
  const body = leaf(out.files['styles.typography.json'], 'Typography styles.Body.Regular');
  expect((body?.$value as Record<string, unknown>).lineHeight).toBe(1.4);
  expect((body?.$extensions as Record<string, Record<string, unknown>>)['com.spec-layer']).not.toHaveProperty('lineHeight');
  expect(out.report.filter((r) => r.code === 'unit_not_expressible' && r.details.property === 'lineHeight')).toEqual([]);
});
```

The existing test for the fixture's `24px` line height (under `$extensions`, reported) must keep passing.

Run: `npx vitest run packages/extractor/test/v5/dtcg.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

In `typographyLeaf`, where `line_height` is intercepted: if `property.source.kind === 'literal'` (or the alias target was not exported) and `property.resolved?.type === 'dimension' && property.resolved.unit === '%'`, set `value.lineHeight = canonicalNumber(property.resolved.number / 100)` and do not report. Keep the px branch as it is. A `%` line height bound to a token stays a reference only if the target's projected `$type` is `number`; a dimension-typed target follows the px rule (extensions plus report), since a reference cannot carry a conversion. Use `canonicalNumber` from `./precision` so `140 / 100` does not emit floating-point noise.

- [ ] **Step 3: Spec, changelog, run, commit**

Spec Styles section: "A percent line height is written as a unitless multiplier by dividing by 100, which restates the same fact in the unit DTCG defines; a px line height cannot be converted without the font size and stays under `$extensions` with a report entry."

`CHANGELOG.md` under `### Changed`: "DTCG typography composites write a percent line height as the multiplier DTCG defines (140% becomes 1.4). A px line height stays under `$extensions["com.spec-layer"].lineHeight`."

Run: `npx vitest run packages/extractor && npm run typecheck && npm run lint`
Expected: PASS; golden unchanged.

```bash
git add packages/extractor docs/superpowers/specs/2026-09-03-dtcg-foundation-export-design.md CHANGELOG.md
git commit -m "feat(v5): write a percent line height as a dtcg multiplier"
```

---

### Task 5: Diagnostic severities that mean what they say

**Files:**
- Modify: `packages/extractor/src/v5/diagnostics.ts` (`DiagnosticCode`, `DEFAULT_SEVERITY`)
- Modify: `packages/extractor/src/v5/fromFoundation.ts` (emission sites around lines 137, 297, 504, 558, 579, 758, 790, 798, 815, 890, 899; verify with grep first)
- Modify: `packages/extractor/src/v5/normalize.ts:429` (the v4 path's `UNIT_METADATA_UNAVAILABLE`)
- Modify: `docs/specs/foundation-context-v5.md` §14.1 table
- Regenerate: `packages/extractor/test/fixtures/v5/synthetic-foundation-direct-v5.yaml`, `synthetic-foundation-v5.yaml`, `button-component-ai-v5.yaml` and any test asserting severities or counts
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: new codes `METADATA_UNAVAILABLE` (info) and `EXPORT_SCOPED` (info) in `DiagnosticCode` and `DEFAULT_SEVERITY`; `UNIT_METADATA_UNAVAILABLE` at `warning`, emitted once per token with no `mode_id`.

Before starting, run `grep -n "code\b.*enum\|DiagnosticCode\|UNIT_METADATA" packages/extractor/src/v5/schema/foundation-5.1.0.json`. If the schema enumerates diagnostic codes, stop and report NEEDS_CONTEXT; the plan assumes it does not.

- [ ] **Step 1: Write the failing tests**

In `packages/extractor/test/v5/fromFoundation.test.ts`:

```ts
it('reports a scope-less number once per token as a warning', () => {
  const { artifact } = directFixture();
  const entries = artifact.diagnostics.filter((d) => d.code === 'UNIT_METADATA_UNAVAILABLE');
  const ids = entries.map((d) => d.entity_id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const d of entries) {
    expect(d.severity).toBe('warning');
    expect(d).not.toHaveProperty('mode_id');
  }
});

it('files metadata the Plugin API never exposes as info, not error', () => {
  const { artifact } = directFixture();
  const meta = artifact.diagnostics.filter((d) => d.code === 'METADATA_UNAVAILABLE');
  expect(meta.length).toBeGreaterThan(0);
  for (const d of meta) expect(d.severity).toBe('info');
  const partial = artifact.diagnostics.filter((d) => d.code === 'SOURCE_PARTIALLY_UNAVAILABLE');
  for (const d of partial) expect(d.severity).toBe('error');
});
```

The synthetic fixture has `permission:styles-metadata` in `unavailable_sources`, so at least the composite-style metadata site fires. Check which of the other sites the fixture reaches and adjust the second assertion's expectation if `METADATA_UNAVAILABLE` cannot fire on it; do not weaken it to "zero or more".

Run: `npx vitest run packages/extractor/test/v5/fromFoundation.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`diagnostics.ts`: add `| 'METADATA_UNAVAILABLE' | 'EXPORT_SCOPED'` to `DiagnosticCode` with doc comments: `METADATA_UNAVAILABLE`: "A metadata field the source API does not expose (publication, lifecycle, consuming mode, progressive blur detail). No value depends on it." `EXPORT_SCOPED`: "The artifact was deliberately scoped to one collection or to text styles; completeness records the scope." Set `METADATA_UNAVAILABLE: 'info'`, `EXPORT_SCOPED: 'info'`, and change `UNIT_METADATA_UNAVAILABLE` to `'warning'`, replacing its comment with: "Warning, not error: the number is retained and usable, and Level 4 readiness is a consumer's judgment. What the consumer must decide is the unit; the message says so and `units` overrides in the CLI are the remedy."

`fromFoundation.ts`: switch the emission sites: composite-style metadata (message "Composite styles are emitted, but Figma exposes no complete style publication..."), collection and token publication status unreadable, and progressive blur to `METADATA_UNAVAILABLE`; the scoped-artifact site to `EXPORT_SCOPED`; leave the style-id-unavailable, variable-read-failed, and style-read-failed sites on `SOURCE_PARTIALLY_UNAVAILABLE`. For `UNIT_METADATA_UNAVAILABLE`, emit once per variable: move the check out of the per-mode `projectValue` into the token loop (after `values` is built, if `variable.resolvedType === 'FLOAT' && numericValue(0, scopes) === null`, push one diagnostic with `entity_id` and no `mode_id`), and delete the two per-mode emissions. Apply the same once-per-token rule in `normalize.ts:429` if that path emits per mode.

Check `validateLevel2` and `statistics.ts` for anything that recomputes or asserts these codes: `grep -n "UNIT_METADATA_UNAVAILABLE\|SOURCE_PARTIALLY_UNAVAILABLE" packages/extractor/src/v5/*.ts`.

- [ ] **Step 3: Regenerate goldens and read the diffs**

```bash
UPDATE_V5_DIRECT_GOLDEN=1 UPDATE_V5_GOLDEN=1 npx vitest run packages/extractor/test/v5/acceptance.test.ts
grep -rn "UPDATE_" packages/extractor/test --include=*.ts | grep -v acceptance
```

Regenerate the component AI golden with its own switch. Read every diff: only diagnostic `code`, `severity`, and `mode_id` lines, `statistics.diagnostics` counts, and `issue_counts` may change. No `content_hash` may change. If one does, stop; something entered the semantic payload.

Run: `npx vitest run packages/extractor packages/plugin`
Expected: PASS after updating any test that asserted the old severities or counts (search `grep -rn "UNIT_METADATA_UNAVAILABLE\|SOURCE_PARTIALLY_UNAVAILABLE\|error: [0-9]" packages/extractor/test packages/plugin/test`).

- [ ] **Step 4: Spec, changelog, commit**

`docs/specs/foundation-context-v5.md` §14.1: change `UNIT_METADATA_UNAVAILABLE` to warning if listed, add rows for `METADATA_UNAVAILABLE` (info, "A metadata field the source API does not expose; no value depends on it.") and `EXPORT_SCOPED` (info, "The artifact was deliberately scoped."), and keep `SOURCE_PARTIALLY_UNAVAILABLE` at error with the meaning "A source read failed." Add after the table: "Severity policy: `error` means a value is missing, wrong, or would be fabricated if used; `warning` means the value is present but a consumer has a decision to make; `info` means metadata is absent and no value depends on it."

`CHANGELOG.md` under `### Changed`:

```markdown
- Foundation Context v5 diagnostics follow one severity policy: `error` means a
  value is missing or wrong, `warning` means a value is present but a consumer
  must decide something, `info` means metadata is absent and no value depends on
  it. `UNIT_METADATA_UNAVAILABLE` is now a warning emitted once per token rather
  than once per mode. Metadata the Plugin API never exposes (style publication
  and lifecycle, publication status, progressive blur detail) is reported as
  `METADATA_UNAVAILABLE` at info, and a deliberately scoped copy as
  `EXPORT_SCOPED` at info; `SOURCE_PARTIALLY_UNAVAILABLE` now means a source
  read failed. Diagnostics are outside every content hash, so no artifact
  identity moves.
```

```bash
git add packages/extractor docs/specs/foundation-context-v5.md CHANGELOG.md
git commit -m "fix(v5): calibrate diagnostic severities to missing or wrong values"
```

---

### Task 6: Full gate and status

**Files:**
- Modify: `docs/specs/foundation-v5-status.md` (one bullet under "Current product behavior" for the live pull; the severity policy under "Release invariants")
- Modify: `CLAUDE.md` "Where things stand": note the live pull ran on 2026-09-03 against a 5.0.0 library and what it found, keep the manual Figma matrix as the standing blocker

- [ ] **Step 1: Docs**

Add to `foundation-v5-status.md` "Still open": "A live `spec-layer pull` of a real 5.0.0 library on 2026-09-03 produced a complete `tokens/` directory that Style Dictionary 5.5.2 built; the sidecar carries no `code_syntax` until the plugin republishes with schema 5.1.0." Update the CLAUDE.md open-items list accordingly.

- [ ] **Step 2: Gate**

```bash
npm run check
```

Read the exit status directly. Expected: 0.

```bash
git add docs CLAUDE.md
git commit -m "docs: record the live dtcg pull and the diagnostic severity policy"
```

## After the plan

The controller re-runs the live pull in the scratch directory with `dtcg: { values: 'legacy', units: { 'Foundation/spacing/*': 'px', 'Foundation/radius/*': 'px' } }` and confirms: `pull` re-projects, spacing and radius are dimensions, density aliases carry `$type: dimension`, the report has no `mode_selection_not_expressible` entries for Foundation targets, the five dropped bindings appear as `binding_dropped`, and the 21 line heights are multipliers.
