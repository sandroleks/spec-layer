# DTCG Foundation Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Foundation AI YAML with a Design Tokens Format Module 2025.10 projection of the canonical v5 artifact, delivered on the clipboard, in the published bundle, and as a `tokens/` directory from `spec-layer pull`.

**Architecture:** A new pure module `packages/extractor/src/v5/dtcg.ts` projects a validated `FoundationArtifactV5` into DTCG token trees, a resolver document, a metadata sidecar, and a report. It sits beside `aiContext.ts`, downstream of validation, outside every hash. The plugin calls it for Copy for AI and for `foundation.ai` in the publish bundle; the CLI calls the same function on the canonical artifact in `bundle.json`. `code_syntax` joins the token record as schema 5.1.0 so the sidecar and the AI profile can carry it.

**Tech Stack:** TypeScript, Vitest, esbuild. Style Dictionary 5.5.2 as a root devDependency for the build gate only.

**Spec:** `docs/superpowers/specs/2026-09-03-dtcg-foundation-export-design.md`. Read it before any task. Every table there is normative.

## Global Constraints

- Never fabricate a value, unit, mode, id, type, or completeness claim. Anything DTCG cannot express is omitted and written to the report. Never a plausible default.
- `packages/extractor` stays Figma-free. `dtcg.ts` imports only from `./canonical`, `./entities`, `./value`, `./precision`, `./diagnostics`.
- Do not use `localeCompare` under `src/v5`. Use `compareCodeUnits` from `./diagnostics`.
- `dtcg.ts` never participates in `semanticContentHash`, `specContentHash`, or `foundationContentHash`. `EXTRACTOR_VERSION` stays `'2'`.
- Schema copies must stay byte-identical: `packages/extractor/src/v5/schema/foundation-5.1.0.json` with `apps/landing/schemas/foundation-context/v5.json`, and `component-5.1.0.json` with `apps/landing/schemas/component-context/v5.json`.
- Plugin UI copy: sentence case, second person, no em dashes, no hype. See `docs/plugin-voice-and-copy.md`.
- Commits: single line, lowercase, scoped: `feat(v5): ...`, `feat(cli): ...`, `feat(plugin): ...`, `docs: ...`, `chore: ...`.
- Update `CHANGELOG.md` under `## [Unreleased]` in the task that changes behavior.
- No raw NUL bytes anywhere. `npm run check:nul` guards `packages/`; be careful in `docs/` too. Never build a map key by joining strings with a NUL separator; use `JSON.stringify([a, b])`.
- Run tests with `npx vitest run <path>` from the repo root. The full gate is `npm run check`.
- `LIBRARY_BUNDLE_VERSION` stays `1.0.0`. The bundle shape does not change.

## File structure

| File | Responsibility |
|---|---|
| `packages/extractor/src/v5/entities.ts` | add `code_syntax?: Record<string, string>` to `TokenV5` |
| `packages/extractor/src/v5/fromFoundation.ts` | emit `code_syntax` when the variable has any |
| `packages/extractor/src/v5/validate.ts` | Level 1 shape check for `code_syntax` |
| `packages/extractor/src/v5/aiContext.ts` | carry `code_syntax` on compact tokens |
| `packages/extractor/src/v5/canonical.ts`, `componentContext.ts` | `SCHEMA_VERSION` and `COMPONENT_SCHEMA_VERSION` to `'5.1.0'` |
| `packages/extractor/src/v5/schema/foundation-5.1.0.json`, `component-5.1.0.json` | renamed schemas with the new property; landing copies updated |
| `packages/extractor/src/v5/dtcg.ts` | the projection: names, values, aliases, styles, resolver, sidecar, report, clipboard document |
| `packages/extractor/src/v5/index.ts` | export `./dtcg` |
| `packages/extractor/test/v5/dtcgFixture.ts` | shared test helpers `syntheticArtifact()` and `leaf()` |
| `packages/extractor/test/v5/dtcg.test.ts` | unit tests per rule |
| `packages/extractor/test/v5/dtcgGolden.test.ts` | golden directory test |
| `packages/extractor/test/v5/dtcgStyleDictionary.test.ts` | Style Dictionary build gate |
| `packages/extractor/test/fixtures/v5/synthetic-foundation-dtcg/` | golden output files |
| `packages/plugin/src/ui/actions.ts` | `foundationAiYaml` becomes `foundationDtcgJson` |
| `packages/plugin/src/ui/publish.ts` | `foundation.ai` is the DTCG document |
| `packages/plugin/test/copyFoundation.test.ts` | parse JSON instead of YAML |
| `packages/plugin/TESTING.md` | matrix rows for the DTCG document |
| `packages/cli/src/config.ts` | `dtcg` block in `speclayer.json` |
| `packages/cli/src/files.ts` | write `tokens/` from the canonical artifact |
| `packages/cli/src/commands.ts`, `cli.ts` | thread `dtcg` options; usage text |
| `packages/cli/README.md` | "What pull writes" and configuration |
| `docs/specs/foundation-context-v5.md`, `foundation-v5-status.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `CHANGELOG.md` | contract and status |

---

### Task 1: `code_syntax` on the v5 token record, schema 5.1.0

**Files:**
- Modify: `packages/extractor/src/v5/entities.ts` (the `TokenV5` interface)
- Modify: `packages/extractor/src/v5/fromFoundation.ts:936-949` (the `tokens.push({...})` call)
- Modify: `packages/extractor/src/v5/validate.ts:384` (beside the `suggested_code_name` shape check)
- Modify: `packages/extractor/src/v5/aiContext.ts:257-282` (`compactToken`) and the `FoundationAiToken` interface
- Modify: `packages/extractor/src/v5/canonical.ts:42` (`SCHEMA_VERSION`)
- Modify: `packages/extractor/src/v5/componentContext.ts:40` and `:733` (`COMPONENT_SCHEMA_VERSION` and the literal `'5.0.0'`)
- Rename: `packages/extractor/src/v5/schema/foundation-5.0.0.json` to `foundation-5.1.0.json`; `component-5.0.0.json` to `component-5.1.0.json`
- Modify: `apps/landing/schemas/foundation-context/v5.json`, `apps/landing/schemas/component-context/v5.json` (copies)
- Modify: `packages/extractor/test/v5/schemaParity.test.ts:13`, `packages/extractor/test/v5/componentSchema.test.ts:9,13` (paths)
- Modify: `packages/extractor/test/v5/fromFoundation.test.ts` (new test)
- Regenerate: `packages/extractor/test/fixtures/v5/synthetic-foundation-direct-v5.yaml`, `synthetic-foundation-v5.yaml`, `button-component-ai-v5.yaml`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: `TokenV5.code_syntax?: Record<string, string>` (platform key such as `WEB`, `ANDROID`, `iOS` to identifier). Present only when the source variable has at least one entry. Task 2 onward reads it.

- [ ] **Step 1: Write the failing test**

Append to `packages/extractor/test/v5/fromFoundation.test.ts`, inside the existing top-level `describe`. Look at how the file builds its artifact from `synthetic-foundation-serialized.json` (the acceptance test does it as `buildFoundationArtifactV5(buildFoundation(serialized), DIRECT_META)`) and reuse or copy that helper as `directFixture()`.

```ts
it('carries code_syntax only for variables that state one', () => {
  const { artifact } = directFixture();
  const red = artifact.tokens.find((t) => t.id === 'VariableID:color-exact');
  const gap = artifact.tokens.find((t) => t.id === 'VariableID:gap');
  expect(red?.code_syntax).toEqual({ WEB: '--color-exact-red' });
  expect(gap?.code_syntax).toEqual({ WEB: '--spacing-gap' });
  // The fixture's second variable declares `"codeSyntax": {}`, which must not
  // surface as an empty object.
  const empty = artifact.tokens.filter((t) => !('code_syntax' in t));
  expect(empty.length).toBeGreaterThan(0);
});
```

Check the fixture first: `grep -n codeSyntax packages/extractor/test/fixtures/v5/synthetic-foundation-serialized.json`. The ids in the assertions must match variables whose `codeSyntax` is `{ "WEB": ... }`. Adjust the ids to what the fixture holds; do not edit the fixture.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/extractor/test/v5/fromFoundation.test.ts`
Expected: FAIL, `code_syntax` is undefined on every token.

- [ ] **Step 3: Add the field to the entity and the builder**

In `entities.ts`, inside `TokenV5` after `scopes: string[];`:

```ts
  /** Figma's per-platform code syntax, keyed by platform (`WEB`, `ANDROID`,
   *  `iOS`). Absent when the variable declares none. A cross-check for a code
   *  identifier, never the source of a name. Schema 5.1.0. */
  code_syntax?: Record<string, string>;
```

In `fromFoundation.ts`, inside the `tokens.push({` object after `scopes: uniqueSorted(variable.provenance.scopes),`:

```ts
        ...(Object.keys(variable.codeSyntax).length > 0
          ? { code_syntax: sortedRecord(variable.codeSyntax) }
          : {}),
```

Add a helper near `uniqueSorted` in the same file:

```ts
/** Keys sorted by code unit so two exports of one variable serialize alike. */
function sortedRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => compareCodeUnits(a, b)),
  );
}
```

`compareCodeUnits` is already imported in `fromFoundation.ts`; confirm with `grep -n compareCodeUnits packages/extractor/src/v5/fromFoundation.ts` and add the import from `./diagnostics` if it is not.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/extractor/test/v5/fromFoundation.test.ts`
Expected: PASS for the new test. Other tests in the extractor may now fail on goldens and hashes; that is expected and handled in Step 7.

- [ ] **Step 5: Level 1 validation and the AI profile**

In `validate.ts` directly after the `suggested_code_name` check at line 384:

```ts
  if (token.code_syntax !== undefined) {
    if (!isRecord(token.code_syntax)
      || Object.values(token.code_syntax).some((v) => typeof v !== 'string')) {
      out.push(shape(entityId, 'token.code_syntax must be an object of strings when present.'));
    }
  }
```

`isRecord` and `shape` already exist in `validate.ts`; confirm their names with `grep -n "function isRecord\|function shape\|const isRecord\|const shape" packages/extractor/src/v5/validate.ts`.

In `aiContext.ts`, add to `FoundationAiToken` after `scopes?: string[];`:

```ts
  code_syntax?: Record<string, string>;
```

and in `compactToken` after the `scopes` spread:

```ts
    ...(token.code_syntax ? { code_syntax: token.code_syntax } : {}),
```

- [ ] **Step 6: Bump both schemas to 5.1.0**

```bash
git mv packages/extractor/src/v5/schema/foundation-5.0.0.json packages/extractor/src/v5/schema/foundation-5.1.0.json
git mv packages/extractor/src/v5/schema/component-5.0.0.json packages/extractor/src/v5/schema/component-5.1.0.json
```

In `foundation-5.1.0.json`, inside `$defs.token.allOf[1].properties` after `"scopes"`:

```json
            "code_syntax": {
              "type": "object",
              "additionalProperties": { "type": "string" }
            },
```

Search both schema files for the string `5.0.0` and change each occurrence that is a schema version to `5.1.0`. Do not change the `$id`, which stays `https://spec-layer.com/schemas/foundation-context/v5.json`. Then:

```bash
cp packages/extractor/src/v5/schema/foundation-5.1.0.json apps/landing/schemas/foundation-context/v5.json
cp packages/extractor/src/v5/schema/component-5.1.0.json apps/landing/schemas/component-context/v5.json
```

Set `SCHEMA_VERSION = '5.1.0'` in `canonical.ts:42`, `COMPONENT_SCHEMA_VERSION = '5.1.0'` in `componentContext.ts:40`, and replace the literal `'5.0.0'` at `componentContext.ts:733` with `COMPONENT_SCHEMA_VERSION`. Update the two test paths in `schemaParity.test.ts:13` and `componentSchema.test.ts:9,13` to the `5.1.0` file names. Search for any other hard-coded file name: `grep -rn "5.0.0.json" packages docs ARCHITECTURE.md CLAUDE.md`.

- [ ] **Step 7: Regenerate goldens and run the extractor suite**

```bash
UPDATE_V5_DIRECT_GOLDEN=1 UPDATE_V5_GOLDEN=1 npx vitest run packages/extractor/test/v5/acceptance.test.ts
git diff --stat packages/extractor/test/fixtures/v5/
```

Read the diff. The only changes must be `schema_version: 5.1.0`, new `code_syntax` lines on tokens that have one, and changed `content_hash` values. Anything else is a bug in Step 3. The component AI golden has its own update switch; find it with `grep -rn "UPDATE_" packages/extractor/test/v5/*.ts packages/extractor/test/*.ts` and regenerate the same way, then read that diff too.

Run: `npx vitest run packages/extractor`
Expected: PASS.

- [ ] **Step 8: Changelog and commit**

Add under `## [Unreleased]` / `### Added` in `CHANGELOG.md`:

```markdown
- Foundation Context v5 tokens carry `code_syntax`, Figma's per-platform code
  identifier, when the variable declares one. Schema `5.1.0` for both
  Foundation and Component Context. This moves the semantic content hash of
  every artifact whose tokens declare a code syntax, and nothing else: canvas
  drift hashes and `EXTRACTOR_VERSION` are unchanged. The identifier is a
  cross-check for code, never the source of a name.
```

```bash
git add -A packages/extractor apps/landing/schemas CHANGELOG.md
git commit -m "feat(v5): carry code_syntax on tokens as schema 5.1.0"
```

---

### Task 2: DTCG names, literal values, and one tree per collection and mode

**Files:**
- Create: `packages/extractor/src/v5/dtcg.ts`
- Modify: `packages/extractor/src/v5/index.ts` (add `export * from './dtcg';`)
- Create: `packages/extractor/test/v5/dtcgFixture.ts`
- Create: `packages/extractor/test/v5/dtcg.test.ts`

**Interfaces:**
- Produces:
  - `export type DtcgValueStyle = 'standard' | 'legacy'`
  - `export interface DtcgOptions { values?: DtcgValueStyle; units?: Record<string, 'px' | 'rem'> }`
  - `export type DtcgJson = string | number | boolean | null | DtcgJson[] | { [key: string]: DtcgJson }`
  - `export type DtcgTree = { [key: string]: DtcgJson }`
  - `export interface DtcgReportEntry { code: DtcgReportCode; severity: 'error' | 'warning' | 'info'; path: string; mode?: string; message: string; details: Record<string, DtcgJson> }`
  - `export interface DtcgExport { files: Record<string, DtcgTree>; resolver: DtcgResolverDocument; meta: Record<string, DtcgMetaEntry>; report: DtcgReportEntry[] }`
  - `export function foundationDtcg(artifact: FoundationArtifactV5, options?: DtcgOptions): DtcgExport`
  - `export function dtcgSegments(name: string): { segments: string[]; notes: SegmentNote[] }`
  - `export function dtcgPathOf(collectionName: string, tokenName: string): string` (segments joined with `.`)
  - `export function fileNameFor(collection: { name: string }, mode: { name: string }, taken: Set<string>): string`
  - `export function dtcgLiteral(value: TypedValue, scopes: string[], style: DtcgValueStyle): Converted`
  - `export function sortTree(value: DtcgJson): DtcgJson`
  This task implements files, names, literal values, `$description`, and the report codes `segment_split`, `name_escaped`, `path_collision`, `type_not_expressible`, `unit_not_expressible`. `resolver`, `meta`, aliases, styles, and `options.units` arrive in Tasks 3 to 5; this task returns `resolver` as `{ version: '2025.10', sets: {}, modifiers: {}, resolutionOrder: [] }` and `meta: {}` so the type is complete.

- [ ] **Step 1: Write the shared fixture helpers and the failing tests**

Create `packages/extractor/test/v5/dtcgFixture.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildFoundation, buildFoundationArtifactV5,
  type FoundationArtifactV5, type SerializedFoundation,
} from '../../src/index';

const SERIALIZED = fileURLToPath(
  new URL('../fixtures/v5/synthetic-foundation-serialized.json', import.meta.url),
);

/** A fresh direct-path artifact from the publishable synthetic fixture. */
export function syntheticArtifact(): FoundationArtifactV5 {
  const serialized = JSON.parse(readFileSync(SERIALIZED, 'utf8')) as SerializedFoundation;
  return buildFoundationArtifactV5(buildFoundation(serialized), {
    exportId: 'dtcg-test', generatedAt: '2026-09-03T00:00:00.000Z', build: null,
  }).artifact;
}

/** Reads an object at a dotted path inside a tree, or undefined. */
export function leaf(tree: unknown, path: string): Record<string, unknown> | undefined {
  let node: unknown = tree;
  for (const seg of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return typeof node === 'object' && node !== null ? node as Record<string, unknown> : undefined;
}
```

Create `packages/extractor/test/v5/dtcg.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dtcgPathOf, dtcgSegments, foundationDtcg } from '../../src/index';
import { leaf, syntheticArtifact } from './dtcgFixture';

describe('dtcgSegments', () => {
  it('splits on slash and keeps casing', () => {
    expect(dtcgSegments('Background/Chip/Chip (Hover)').segments)
      .toEqual(['Background', 'Chip', 'Chip (Hover)']);
  });
  it('splits a dotted segment into groups and notes it', () => {
    const out = dtcgSegments('md.sys.color/primary');
    expect(out.segments).toEqual(['md', 'sys', 'color', 'primary']);
    expect(out.notes).toEqual([{ code: 'segment_split', original: 'md.sys.color' }]);
  });
  it('escapes braces, a leading dollar, and empty segments', () => {
    const out = dtcgSegments('$a/{b}//c');
    expect(out.segments).toEqual(['_$a', '_b_', '_', 'c']);
    expect(out.notes.map((n) => n.code)).toEqual(['name_escaped', 'name_escaped', 'name_escaped']);
  });
  it('joins a path with the collection at the head', () => {
    expect(dtcgPathOf('Mapped Colors', 'color/surface/primary')).toBe('Mapped Colors.color.surface.primary');
  });
});

describe('foundationDtcg files and literals', () => {
  const out = foundationDtcg(syntheticArtifact());

  it('writes one file per collection and mode, named by slug, rooted at the collection', () => {
    expect(Object.keys(out.files).sort()).toEqual([
      'primitives.dark.json', 'primitives.light-2.json', 'primitives.light.json',
      'semantic.dark.json', 'semantic.light.json',
    ]);
    expect(Object.keys(out.files['primitives.light.json'])).toEqual(['Primitives']);
  });

  it('emits standard 2025.10 colors with exact components and the hex', () => {
    const red = leaf(out.files['primitives.light.json'], 'Primitives.color.exact.red');
    expect(red).toEqual({
      $type: 'color',
      $value: { colorSpace: 'srgb', components: [1, 0, 0], alpha: 1, hex: '#ff0000' },
      $description: 'Exactly representable source channels.',
    });
    const teal = leaf(out.files['primitives.light.json'], 'Primitives.color.lossy.teal');
    expect(teal?.$value).toEqual({
      colorSpace: 'srgb', components: [0.5001, 0.1001, 0.0001], alpha: 0.125, hex: '#801a00',
    });
  });

  it('emits dimensions as value and unit objects, font weight by scope, and bare numbers otherwise', () => {
    expect(leaf(out.files['primitives.light.json'], 'Primitives.spacing.gap')?.$value)
      .toEqual({ value: 8, unit: 'px' });
    const weight = leaf(out.files['primitives.light.json'], 'Primitives.typography.weight.strong');
    expect(weight?.$type).toBe('fontWeight');
    expect(weight?.$value).toBe(600);
    const n = leaf(out.files['primitives.light.json'], 'Primitives.number.unknown-scope');
    expect(n).toMatchObject({ $type: 'number', $value: 1.5 });
  });

  it('emits font families as fontFamily strings', () => {
    expect(leaf(out.files['primitives.light.json'], 'Primitives.typography.family.body'))
      .toMatchObject({ $type: 'fontFamily', $value: 'Inter' });
  });

  it('omits boolean tokens and reports them once per token', () => {
    const boolToken = syntheticArtifact().tokens.find((t) => t.type === 'boolean');
    if (!boolToken) throw new Error('fixture lost its boolean token');
    const path = dtcgPathOf('Primitives', boolToken.name);
    expect(leaf(out.files['primitives.light.json'], path)).toBeUndefined();
    const entries = out.report.filter((r) => r.code === 'type_not_expressible');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ severity: 'warning', path });
    expect(entries[0].details).toMatchObject({ type: 'boolean', id: boolToken.id });
  });

  it('legacy values are the string forms', () => {
    const legacy = foundationDtcg(syntheticArtifact(), { values: 'legacy' });
    expect(leaf(legacy.files['primitives.light.json'], 'Primitives.color.exact.red')?.$value).toBe('#ff0000');
    expect(leaf(legacy.files['primitives.light.json'], 'Primitives.color.lossy.teal')?.$value).toBe('#801a0020');
    expect(leaf(legacy.files['primitives.light.json'], 'Primitives.spacing.gap')?.$value).toBe('8px');
  });

  it('does not mutate the artifact', () => {
    const artifact = syntheticArtifact();
    const before = JSON.stringify(artifact);
    foundationDtcg(artifact);
    expect(JSON.stringify(artifact)).toBe(before);
  });
});
```

The fixture's `Primitives` collection has two modes named `Light` (ids `ModeID:p-light` and `ModeID:p-light-duplicate`) and one `Dark`, so the file names are `primitives.light.json`, `primitives.dark.json`, `primitives.light-2.json`. The boolean token's name contains a Cyrillic capital letter, which is why the test finds it by type rather than spelling it. `#801a00` with alpha `0.125` is `0x20` in legacy 8-digit form.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/extractor/test/v5/dtcg.test.ts`
Expected: FAIL, `foundationDtcg` is not exported.

- [ ] **Step 3: Create `dtcg.ts` with names, values, and files**

Create `packages/extractor/src/v5/dtcg.ts`:

```ts
/**
 * DTCG projection of a Foundation Context v5 artifact. Spec:
 * docs/superpowers/specs/2026-09-03-dtcg-foundation-export-design.md.
 *
 * Design Tokens Format Module 2025.10 and Resolver Module 2025.10. This is a
 * presentation profile over a validated artifact, like aiContext.ts: it never
 * feeds a hash, never mutates its input, and anything the format cannot state
 * is omitted and written to the report rather than approximated.
 */
import type { FoundationArtifactV5 } from './canonical';
import { compareCodeUnits } from './diagnostics';
import type { CollectionV5, TokenV5 } from './entities';
import { canonicalNumber } from './precision';
import type { ColorValue, TypedValue } from './value';

export type DtcgValueStyle = 'standard' | 'legacy';
export interface DtcgOptions {
  /** `standard` is the 2025.10 object form; `legacy` is the pre-2025 string form. */
  values?: DtcgValueStyle;
  /** `"Collection/name glob": unit` overrides for numbers whose scopes state no unit. */
  units?: Record<string, 'px' | 'rem'>;
}

export type DtcgJson = string | number | boolean | null | DtcgJson[] | { [key: string]: DtcgJson };
export type DtcgTree = { [key: string]: DtcgJson };

export type DtcgReportCode =
  | 'segment_split' | 'name_escaped' | 'path_collision' | 'type_not_expressible'
  | 'unit_not_expressible' | 'unit_override_conflicts_with_scope'
  | 'mode_selection_not_expressible' | 'value_omitted' | 'effect_not_expressible'
  | 'duplicate_code_syntax';

export interface DtcgReportEntry {
  code: DtcgReportCode;
  severity: 'error' | 'warning' | 'info';
  /** DTCG path, collection first, dot-joined. */
  path: string;
  mode?: string;
  message: string;
  details: Record<string, DtcgJson>;
}

export interface DtcgMetaEntry {
  id: string;
  collection_id: string;
  type: string;
  scopes: string[];
  code_syntax?: Record<string, string>;
  publication?: { published: boolean; hidden_from_publishing: boolean };
  omitted?: true;
  /** Canonical values by mode label, only for omitted tokens. */
  values?: Record<string, DtcgJson>;
}

export interface DtcgResolverDocument {
  version: '2025.10';
  name?: string;
  sets: Record<string, { sources: DtcgJson[] }>;
  modifiers: Record<string, { contexts: Record<string, DtcgJson[]>; default?: string }>;
  resolutionOrder: Array<{ $ref: string }>;
}

export interface DtcgExport {
  files: Record<string, DtcgTree>;
  resolver: DtcgResolverDocument;
  meta: Record<string, DtcgMetaEntry>;
  report: DtcgReportEntry[];
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export interface SegmentNote { code: 'segment_split' | 'name_escaped'; original: string }

/**
 * Figma name -> DTCG group segments. `/` groups, as `path` does. A `.` inside
 * a segment splits it further, because DTCG reserves `.` for references and an
 * underscore would flatten a hierarchy the author meant. `{`, `}`, a leading
 * `$`, and an empty segment are escaped and noted.
 */
export function dtcgSegments(name: string): { segments: string[]; notes: SegmentNote[] } {
  const segments: string[] = [];
  const notes: SegmentNote[] = [];
  for (const raw of name.split('/')) {
    const parts = raw.includes('.') ? raw.split('.') : [raw];
    if (parts.length > 1) notes.push({ code: 'segment_split', original: raw });
    for (const part of parts) {
      let out = part;
      if (out === '') out = '_';
      if (/[{}]/.test(out)) out = out.replace(/[{}]/g, '_');
      if (out.startsWith('$')) out = `_${out}`;
      if (out !== part) notes.push({ code: 'name_escaped', original: part });
      segments.push(out);
    }
  }
  return { segments, notes };
}

export function dtcgPathOf(collectionName: string, tokenName: string): string {
  return [...dtcgSegments(collectionName).segments, ...dtcgSegments(tokenName).segments].join('.');
}

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';

/** `<collection>.<mode>.json`, with `-2`, `-3` on a slug collision. */
export function fileNameFor(
  collection: { name: string }, mode: { name: string }, taken: Set<string>,
): string {
  const base = `${slug(collection.name)}.${slug(mode.name)}`;
  let candidate = `${base}.json`;
  let n = 1;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}.json`;
  }
  taken.add(candidate);
  return candidate;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

function hexByte(n: number): string {
  return Math.round(n * 255).toString(16).padStart(2, '0');
}

function colorComponents(color: ColorValue): [number, number, number] {
  if (color.channels) return [color.channels[0], color.channels[1], color.channels[2]];
  const at = (i: number) => canonicalNumber(parseInt(color.hex.slice(i, i + 2), 16) / 255);
  return [at(1), at(3), at(5)];
}

export interface DtcgTyped { $type: string; $value: DtcgJson }
export type Converted =
  | DtcgTyped
  | { omit: 'type_not_expressible' | 'unit_not_expressible'; details: Record<string, DtcgJson> };

/**
 * One typed literal. `fontWeight` is chosen only by the FONT_WEIGHT scope, not
 * the name: units.ts already made the name inadmissible as evidence and this
 * module keeps that rule.
 */
export function dtcgLiteral(
  value: TypedValue, scopes: string[], style: DtcgValueStyle,
): Converted {
  switch (value.type) {
    case 'color': {
      if (style === 'legacy') {
        const alpha = value.alpha === 1 ? '' : hexByte(value.alpha);
        return { $type: 'color', $value: `${value.hex}${alpha}` };
      }
      return {
        $type: 'color',
        $value: {
          colorSpace: 'srgb', components: colorComponents(value), alpha: value.alpha, hex: value.hex,
        },
      };
    }
    case 'dimension': {
      if (value.unit !== 'px' && value.unit !== 'rem') {
        return { omit: 'unit_not_expressible', details: { unit: value.unit, number: value.number } };
      }
      return {
        $type: 'dimension',
        $value: style === 'legacy' ? `${value.number}${value.unit}` : { value: value.number, unit: value.unit },
      };
    }
    case 'duration':
      return {
        $type: 'duration',
        $value: style === 'legacy' ? `${value.number}${value.unit}` : { value: value.number, unit: value.unit },
      };
    case 'number':
      return { $type: scopes.includes('FONT_WEIGHT') ? 'fontWeight' : 'number', $value: value.value };
    case 'cubic_bezier':
      return { $type: 'cubicBezier', $value: [...value.value] };
    case 'font_family':
      return { $type: 'fontFamily', $value: value.value };
    case 'string':
    case 'boolean':
      return { omit: 'type_not_expressible', details: { type: value.type } };
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

function setLeaf(tree: DtcgTree, segments: string[], leaf: DtcgJson): void {
  let node: DtcgTree = tree;
  for (const seg of segments.slice(0, -1)) {
    const next = node[seg];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) node[seg] = {};
    node = node[seg] as DtcgTree;
  }
  node[segments[segments.length - 1]] = leaf;
}

/** Recursively sorts keys by code unit, keeping `$`-keys first in a fixed order. */
const KEY_ORDER = ['$type', '$value', '$description', '$deprecated', '$extensions'];
export function sortTree(value: DtcgJson): DtcgJson {
  if (Array.isArray(value)) return value.map(sortTree);
  if (typeof value !== 'object' || value === null) return value;
  const rank = (k: string) => { const i = KEY_ORDER.indexOf(k); return i === -1 ? KEY_ORDER.length : i; };
  const keys = Object.keys(value).sort((a, b) => rank(a) - rank(b) || compareCodeUnits(a, b));
  return Object.fromEntries(keys.map((k) => [k, sortTree(value[k])]));
}

interface Projection {
  artifact: FoundationArtifactV5;
  options: { values: DtcgValueStyle; units?: Record<string, 'px' | 'rem'> };
  collectionById: Map<string, CollectionV5>;
  /** token id -> dot-joined DTCG path, for every token that survived collision. */
  pathById: Map<string, string>;
  /** token id -> segments including the collection head. */
  segmentsById: Map<string, string[]>;
  omittedIds: Set<string>;
  report: DtcgReportEntry[];
}

function reportOnce(p: Projection, entry: DtcgReportEntry): void {
  const key = JSON.stringify([entry.code, entry.path, entry.mode ?? null, entry.details]);
  const seen = p.report.some((r) => JSON.stringify([r.code, r.path, r.mode ?? null, r.details]) === key);
  if (!seen) p.report.push(entry);
}

/** Resolves every token's DTCG path and drops both sides of a collision. */
function indexPaths(p: Projection): void {
  const owners = new Map<string, TokenV5[]>();
  for (const token of p.artifact.tokens) {
    const collection = p.collectionById.get(token.collection_id);
    if (!collection) continue;
    const head = dtcgSegments(collection.name);
    const tail = dtcgSegments(token.name);
    const segments = [...head.segments, ...tail.segments];
    const path = segments.join('.');
    p.segmentsById.set(token.id, segments);
    for (const note of [...head.notes, ...tail.notes]) {
      reportOnce(p, {
        code: note.code, severity: note.code === 'segment_split' ? 'info' : 'warning', path,
        message: note.code === 'segment_split'
          ? `The segment "${note.original}" contains "." and was split into nested groups.`
          : `The segment "${note.original}" contains a character DTCG forbids and was escaped.`,
        details: { id: token.id, original: note.original },
      });
    }
    owners.set(path, [...(owners.get(path) ?? []), token]);
  }
  for (const [path, tokens] of owners) {
    if (tokens.length === 1) {
      p.pathById.set(tokens[0].id, path);
      continue;
    }
    for (const token of tokens) {
      p.omittedIds.add(token.id);
      reportOnce(p, {
        code: 'path_collision', severity: 'error', path,
        message: `${tokens.length} tokens share this DTCG path after escaping; all were omitted.`,
        details: { id: token.id, ids: tokens.map((t) => t.id) },
      });
    }
  }
}

function modeName(collection: CollectionV5, modeId: string): string {
  return collection.modes.find((m) => m.id === modeId)?.name ?? modeId;
}

export function foundationDtcg(artifact: FoundationArtifactV5, options: DtcgOptions = {}): DtcgExport {
  const p: Projection = {
    artifact,
    options: { values: options.values ?? 'standard', ...(options.units ? { units: options.units } : {}) },
    collectionById: new Map(artifact.collections.map((c) => [c.id, c])),
    pathById: new Map(),
    segmentsById: new Map(),
    omittedIds: new Set(),
    report: [],
  };
  indexPaths(p);
  omitInexpressibleTypes(p);

  const files: Record<string, DtcgTree> = {};
  const taken = new Set<string>();
  for (const collection of artifact.collections) {
    for (const mode of collection.modes) {
      const tree: DtcgTree = {};
      for (const token of artifact.tokens) {
        if (token.collection_id !== collection.id || p.omittedIds.has(token.id)) continue;
        const leaf = tokenLeaf(p, token, collection, mode.id);
        if (leaf) setLeaf(tree, p.segmentsById.get(token.id) ?? [], leaf);
      }
      files[fileNameFor(collection, mode, taken)] = sortTree(tree) as DtcgTree;
    }
  }

  return {
    files,
    resolver: { version: '2025.10', sets: {}, modifiers: {}, resolutionOrder: [] },
    meta: {},
    report: p.report,
  };
}

/** DTCG has no string or boolean type. Such tokens are omitted whole. */
function omitInexpressibleTypes(p: Projection): void {
  for (const token of p.artifact.tokens) {
    if (token.type !== 'string' && token.type !== 'boolean') continue;
    p.omittedIds.add(token.id);
    reportOnce(p, {
      code: 'type_not_expressible', severity: 'warning',
      path: p.pathById.get(token.id) ?? p.segmentsById.get(token.id)?.join('.') ?? token.name,
      message: `DTCG has no ${token.type} type; the token was omitted.`,
      details: { id: token.id, type: token.type },
    });
  }
}

/** The `$type`/`$value`/`$description` leaf for one token in one mode, or null when omitted. */
function tokenLeaf(p: Projection, token: TokenV5, collection: CollectionV5, modeId: string): DtcgTree | null {
  const value = token.values[modeId];
  const path = p.pathById.get(token.id) ?? '';
  const mode = modeName(collection, modeId);
  if (value === undefined || value.kind !== 'literal') return null; // aliases and missing: Task 3
  const converted = dtcgLiteral(value.value, token.scopes, p.options.values);
  if ('omit' in converted) {
    reportOnce(p, {
      code: converted.omit, severity: 'warning', path, mode,
      message: converted.omit === 'type_not_expressible'
        ? `DTCG has no ${String(converted.details.type)} type; the value was omitted.`
        : `DTCG dimensions take px or rem; a ${String(converted.details.unit)} value was omitted.`,
      details: { id: token.id, ...converted.details },
    });
    return null;
  }
  return {
    $type: converted.$type,
    $value: converted.$value,
    ...(token.description.length > 0 ? { $description: token.description } : {}),
  };
}
```

Add `export * from './dtcg';` to `packages/extractor/src/v5/index.ts` after the `aiContext` line.

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run packages/extractor/test/v5/dtcg.test.ts`
Expected: PASS. The `lossy.teal` assertion uses `channels` verbatim; `exact.red` is `[1, 0, 0]` regardless of how `canonicalNumber` rounds.

- [ ] **Step 5: Typecheck and lint, then commit**

Run: `npm run typecheck && npm run lint`
Expected: clean.

```bash
git add packages/extractor/src/v5/dtcg.ts packages/extractor/src/v5/index.ts packages/extractor/test/v5/dtcgFixture.ts packages/extractor/test/v5/dtcg.test.ts
git commit -m "feat(v5): project foundation tokens to dtcg files with names and literals"
```

---

### Task 3: Aliases, omissions, unit overrides, and the sidecar

**Files:**
- Modify: `packages/extractor/src/v5/dtcg.ts` (`tokenLeaf`, new helpers, `meta`)
- Modify: `packages/extractor/test/v5/dtcg.test.ts`

**Interfaces:**
- Consumes: `Projection`, `tokenLeaf`, `reportOnce`, `dtcgLiteral`, `modeName` from Task 2.
- Produces: `meta` populated for every token; internal `unitOverrideFor(p, token, collection): 'px' | 'rem' | undefined`; internal `modeLabels(collection): Map<string, string>`; report codes `value_omitted`, `mode_selection_not_expressible`, `unit_override_conflicts_with_scope`, `duplicate_code_syntax`.

- [ ] **Step 1: Write the failing tests**

Append to `dtcg.test.ts`:

```ts
describe('foundationDtcg aliases and omissions', () => {
  const out = foundationDtcg(syntheticArtifact());

  it('writes a local alias as a reference to the target DTCG path', () => {
    const primary = leaf(out.files['semantic.dark.json'], 'Semantic.color.surface.primary');
    expect(primary).toMatchObject({ $type: 'color', $value: '{Primitives.color.chain.bridge}' });
  });

  it('omits missing values and unresolved aliases with a reason, never a literal or a fake reference', () => {
    expect(leaf(out.files['primitives.light-2.json'], 'Primitives.color.shared')).toBeUndefined();
    expect(out.report).toContainEqual(expect.objectContaining({
      code: 'value_omitted', severity: 'warning', path: 'Primitives.color.shared',
      details: expect.objectContaining({ id: 'VariableID:color-shared', reason: 'no_value_for_mode' }),
    }));
    expect(leaf(out.files['semantic.light.json'], 'Semantic.color.legacy.readable')).toBeUndefined();
    expect(out.report).toContainEqual(expect.objectContaining({
      code: 'value_omitted', path: 'Semantic.color.legacy.readable', mode: 'Light',
      details: expect.objectContaining({
        reason: 'source_library_unavailable', source_library_name: 'Deprecated Core',
      }),
    }));
    expect(leaf(out.files['primitives.light.json'], 'Primitives.cycle.a')).toBeUndefined();
    expect(out.report).toContainEqual(expect.objectContaining({
      code: 'value_omitted', path: 'Primitives.cycle.a', details: expect.objectContaining({ reason: 'cycle' }),
    }));
    for (const text of Object.values(out.files).map((f) => JSON.stringify(f))) {
      expect(text).not.toContain('unresolved');
      expect(text).not.toContain('"$value":null');
    }
  });

  it('keeps the sidecar keyed by DTCG path with the stable id, scopes, and code syntax', () => {
    expect(out.meta['Primitives.color.exact.red']).toEqual({
      id: 'VariableID:color-exact', collection_id: 'CollectionID:primitives', type: 'color',
      scopes: ['FRAME_FILL'], code_syntax: { WEB: '--color-exact-red' },
    });
    const boolToken = syntheticArtifact().tokens.find((t) => t.type === 'boolean');
    if (!boolToken) throw new Error('fixture lost its boolean token');
    const omitted = out.meta[dtcgPathOf('Primitives', boolToken.name)];
    expect(omitted.omitted).toBe(true);
    expect(omitted.values).toEqual({
      'Light [ModeID:p-light]': true, Dark: false, 'Light [ModeID:p-light-duplicate]': true,
    });
  });

  it('promotes a scope-less number to a dimension only under a declared override', () => {
    const forced = foundationDtcg(syntheticArtifact(), { units: { 'Primitives/number/*': 'px' } });
    expect(leaf(forced.files['primitives.light.json'], 'Primitives.number.unknown-scope'))
      .toMatchObject({ $type: 'dimension', $value: { value: 1.5, unit: 'px' } });
    const conflicting = foundationDtcg(syntheticArtifact(), { units: { 'Primitives/typography/weight/*': 'px' } });
    expect(leaf(conflicting.files['primitives.light.json'], 'Primitives.typography.weight.strong')?.$type)
      .toBe('fontWeight');
    expect(conflicting.report).toContainEqual(expect.objectContaining({
      code: 'unit_override_conflicts_with_scope', path: 'Primitives.typography.weight.strong',
    }));
  });

  it('reports a code syntax identifier that two tokens share', () => {
    const artifact = syntheticArtifact();
    const [a, b] = artifact.tokens.filter((t) => t.type === 'color').slice(0, 2);
    a.code_syntax = { WEB: '--dup' };
    b.code_syntax = { WEB: '--dup' };
    const dup = foundationDtcg(artifact).report.filter((r) => r.code === 'duplicate_code_syntax');
    expect(dup).toHaveLength(2);
    expect(dup[0].details).toMatchObject({ platform: 'WEB', identifier: '--dup' });
  });
});
```

The two `Light` modes in `Primitives` both get an id suffix in the sidecar's mode labels, as `readableLabels` in `aiContext.ts` does for duplicate names. Implement the same rule locally rather than importing from `aiContext.ts`. Check the fixture: `Primitives.color.shared` is missing in the duplicate Light mode, and `Semantic.color.surface.primary` is a literal in Light and a three-hop alias in Dark.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/extractor/test/v5/dtcg.test.ts`
Expected: the new `describe` fails; the Task 2 tests still pass.

- [ ] **Step 3: Implement aliases, omissions, overrides, and the sidecar**

In `dtcg.ts`, add these helpers above `foundationDtcg`:

```ts
/** `Collection/glob` -> matcher over a token's Figma name within that collection. */
function unitOverrideFor(p: Projection, token: TokenV5, collection: CollectionV5): 'px' | 'rem' | undefined {
  const units = p.options.units;
  if (!units) return undefined;
  for (const key of Object.keys(units).sort(compareCodeUnits)) {
    const slash = key.indexOf('/');
    if (slash === -1 || key.slice(0, slash) !== collection.name) continue;
    const glob = key.slice(slash + 1);
    const escaped = glob.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    if (new RegExp(`^${escaped}$`).test(token.name)) return units[key];
  }
  return undefined;
}

const STATED_NUMBER_SCOPES = ['FONT_WEIGHT', 'OPACITY'];

/** Mode labels unique within a collection: the name alone, or name plus id when a name repeats. */
function modeLabels(collection: CollectionV5): Map<string, string> {
  const counts = new Map<string, number>();
  for (const m of collection.modes) counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
  return new Map(collection.modes.map((m) => [m.id, counts.get(m.name) === 1 ? m.name : `${m.name} [${m.id}]`]));
}

function asJson(value: unknown): DtcgJson {
  return JSON.parse(JSON.stringify(value)) as DtcgJson;
}

function metaEntry(p: Projection, token: TokenV5, collection: CollectionV5): DtcgMetaEntry {
  const labels = modeLabels(collection);
  const omitted = p.omittedIds.has(token.id);
  const plain = (v: TokenV5['values'][string]): DtcgJson => {
    if (v.kind === 'literal' && (v.value.type === 'boolean' || v.value.type === 'string'
      || v.value.type === 'number' || v.value.type === 'font_family')) return v.value.value;
    return asJson(v);
  };
  return {
    id: token.id,
    collection_id: token.collection_id,
    type: token.type,
    scopes: [...token.scopes],
    ...(token.code_syntax ? { code_syntax: token.code_syntax } : {}),
    ...(token.publication ? { publication: token.publication } : {}),
    ...(omitted
      ? {
          omitted: true,
          values: Object.fromEntries(Object.entries(token.values)
            .map(([modeId, v]) => [labels.get(modeId) ?? modeId, plain(v)])),
        }
      : {}),
  };
}

function reportDuplicateCodeSyntax(p: Projection): void {
  const owners = new Map<string, TokenV5[]>();
  for (const token of p.artifact.tokens) {
    for (const [platform, identifier] of Object.entries(token.code_syntax ?? {})) {
      const key = JSON.stringify([platform, identifier]);
      owners.set(key, [...(owners.get(key) ?? []), token]);
    }
  }
  for (const [key, tokens] of owners) {
    if (tokens.length < 2) continue;
    const [platform, identifier] = JSON.parse(key) as [string, string];
    for (const token of tokens) {
      reportOnce(p, {
        code: 'duplicate_code_syntax', severity: 'warning',
        path: p.pathById.get(token.id) ?? p.segmentsById.get(token.id)?.join('.') ?? token.name,
        message: `${tokens.length} tokens declare the ${platform} identifier "${identifier}".`,
        details: { id: token.id, platform, identifier, ids: tokens.map((t) => t.id) },
      });
    }
  }
}
```

Replace the `tokenLeaf` function from Task 2 with this one:

```ts
function tokenLeaf(p: Projection, token: TokenV5, collection: CollectionV5, modeId: string): DtcgTree | null {
  const value = token.values[modeId];
  const path = p.pathById.get(token.id) ?? '';
  const mode = modeName(collection, modeId);
  const description = token.description.length > 0 ? { $description: token.description } : {};

  if (value === undefined || value.kind === 'missing') {
    reportOnce(p, {
      code: 'value_omitted', severity: 'warning', path, mode,
      message: 'The token has no value for this mode.',
      details: { id: token.id, reason: value?.reason ?? 'no_value_for_mode' },
    });
    return null;
  }

  if (value.kind === 'alias') {
    if (value.resolved.status === 'unresolved') {
      reportOnce(p, {
        code: 'value_omitted', severity: 'warning', path, mode,
        message: `The alias could not be resolved (${value.resolved.reason}); no value was written.`,
        details: {
          id: token.id, reason: value.resolved.reason,
          target_path: value.reference.target_path.join('/'),
          ...(value.reference.target_id !== null ? { target_id: value.reference.target_id } : {}),
          ...(value.reference.source_library_name
            ? { source_library_name: value.reference.source_library_name } : {}),
        },
      });
      return null;
    }
    const targetId = value.reference.target_id;
    const targetPath = targetId !== null && !p.omittedIds.has(targetId) ? p.pathById.get(targetId) : undefined;
    if (targetPath === undefined) {
      reportOnce(p, {
        code: 'value_omitted', severity: 'warning', path, mode,
        message: 'The alias target was itself omitted from the DTCG output.',
        details: { id: token.id, reason: 'target_omitted', ...(targetId !== null ? { target_id: targetId } : {}) },
      });
      return null;
    }
    const target = p.artifact.tokens.find((t) => t.id === targetId);
    const hop = value.resolved.chain[0];
    if (target && hop && target.collection_id !== token.collection_id) {
      const targetCollection = p.collectionById.get(target.collection_id);
      const hopMode = targetCollection ? modeName(targetCollection, hop.mode_id) : hop.mode_id;
      if (hopMode !== mode) {
        reportOnce(p, {
          code: 'mode_selection_not_expressible', severity: 'info', path, mode,
          message: `Figma resolved this alias through the target's "${hopMode}" mode; DTCG resolves it by the consumer's context.`,
          details: {
            id: token.id, target_id: targetId ?? '', target_mode: hopMode,
            resolved: asJson(value.resolved.value),
          },
        });
      }
    }
    const typed = dtcgLiteral(value.resolved.value, token.scopes, p.options.values);
    if ('omit' in typed) {
      reportOnce(p, {
        code: typed.omit, severity: 'warning', path, mode,
        message: 'The alias resolves to a value DTCG cannot state; the value was omitted.',
        details: { id: token.id, ...typed.details },
      });
      return null;
    }
    return { $type: typed.$type, $value: `{${targetPath}}`, ...description };
  }

  const override = unitOverrideFor(p, token, collection);
  let literal: TypedValue = value.value;
  if (override !== undefined && literal.type === 'number') {
    if (token.scopes.some((s) => STATED_NUMBER_SCOPES.includes(s))) {
      reportOnce(p, {
        code: 'unit_override_conflicts_with_scope', severity: 'warning', path,
        message: 'A unit override names this token but its scopes state a unitless number; the override was ignored.',
        details: { id: token.id, override, scopes: [...token.scopes] },
      });
    } else {
      literal = { type: 'dimension', number: literal.value, unit: override };
    }
  }
  const converted = dtcgLiteral(literal, token.scopes, p.options.values);
  if ('omit' in converted) {
    reportOnce(p, {
      code: converted.omit, severity: 'warning', path, mode,
      message: converted.omit === 'type_not_expressible'
        ? `DTCG has no ${String(converted.details.type)} type; the value was omitted.`
        : `DTCG dimensions take px or rem; a ${String(converted.details.unit)} value was omitted.`,
      details: { id: token.id, ...converted.details },
    });
    return null;
  }
  return { $type: converted.$type, $value: converted.$value, ...description };
}
```

In `foundationDtcg`, call `reportDuplicateCodeSyntax(p);` right after `omitInexpressibleTypes(p);`, and build `meta` before the return:

```ts
  const meta: Record<string, DtcgMetaEntry> = {};
  for (const token of artifact.tokens) {
    const collection = p.collectionById.get(token.collection_id);
    if (!collection) continue;
    const path = p.pathById.get(token.id) ?? p.segmentsById.get(token.id)?.join('.') ?? token.name;
    meta[path] = metaEntry(p, token, collection);
  }
  const sortedMeta = Object.fromEntries(Object.entries(meta).sort(([a], [b]) => compareCodeUnits(a, b)));
```

and return `meta: sortedMeta`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/extractor/test/v5/dtcg.test.ts`
Expected: PASS. If the `Semantic.color.surface.primary` Dark test fails on the reference target, print `out.report` and confirm no `path_collision` swallowed `Primitives.color.chain.bridge`.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add packages/extractor/src/v5/dtcg.ts packages/extractor/test/v5/dtcg.test.ts
git commit -m "feat(v5): dtcg references, omissions, unit overrides, and sidecar"
```

---

### Task 4: Typography and effect styles

**Files:**
- Modify: `packages/extractor/src/v5/dtcg.ts`
- Modify: `packages/extractor/test/v5/dtcg.test.ts`

**Interfaces:**
- Consumes: `Projection`, `dtcgLiteral`, `setLeaf`, `sortTree`, `reportOnce`, `dtcgSegments`.
- Produces: `files['styles.typography.json']` rooted at `Typography styles`, `files['styles.effects.json']` rooted at `Effect styles`, both only when the artifact has such styles. Internal `styleFiles(p): Record<string, DtcgTree>`. Report code `effect_not_expressible`.

- [ ] **Step 1: Write the failing tests**

Append to `dtcg.test.ts`:

```ts
describe('foundationDtcg styles', () => {
  const out = foundationDtcg(syntheticArtifact());

  it('maps a text style to the typography composite with references for bound properties', () => {
    const body = leaf(out.files['styles.typography.json'], 'Typography styles.Body.Regular');
    expect(body?.$type).toBe('typography');
    expect(body?.$value).toEqual({
      fontFamily: '{Primitives.typography.family.body}',
      fontWeight: '{Primitives.typography.weight.strong}',
      fontSize: { value: 16, unit: 'px' },
      lineHeight: { value: 24, unit: 'px' },
    });
    expect(body?.$extensions).toEqual({
      'com.spec-layer': {
        letterSpacing: { value: 0, unit: '%' },
        paragraphSpacing: { value: 8, unit: 'px' },
        paragraphIndent: { value: 0, unit: 'px' },
        textCase: 'original',
        textDecoration: 'none',
      },
    });
    expect(body?.$description).toBe('Source style retained for Phase 3.');
    expect(out.report).toContainEqual(expect.objectContaining({
      code: 'unit_not_expressible', path: 'Typography styles.Body.Regular',
      details: expect.objectContaining({ property: 'letterSpacing', unit: '%' }),
    }));
  });

  it('maps an effect style to a shadow array of visible shadows, with every layer under extensions', () => {
    const card = leaf(out.files['styles.effects.json'], 'Effect styles.Shadow.Card');
    expect(card?.$type).toBe('shadow');
    expect(card?.$value).toEqual([{
      color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.2, hex: '#000000' },
      offsetX: { value: 0, unit: 'px' },
      offsetY: { value: 4, unit: 'px' },
      blur: '{Primitives.effect.shadow.blur}',
      spread: { value: 0, unit: 'px' },
      inset: false,
    }]);
    expect(card?.$extensions).toEqual({
      'com.spec-layer': {
        layers: [
          { index: 0, type: 'drop_shadow', visible: true, blend_mode: 'normal' },
          { index: 1, type: 'layer_blur', visible: false, blur: { value: 2, unit: 'px' } },
        ],
      },
    });
  });

  it('writes no style file when the artifact has no styles of that kind', () => {
    const artifact = syntheticArtifact();
    artifact.styles = { typography: [], effects: [] };
    const bare = foundationDtcg(artifact);
    expect(bare.files['styles.typography.json']).toBeUndefined();
    expect(bare.files['styles.effects.json']).toBeUndefined();
  });
});
```

Check the fixture's effect binding first: the direct golden shows `bindings: { "effects[0].blur": Primitives/effect/shadow/blur }`, so `blur` is a reference and the other geometry is literal.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/extractor/test/v5/dtcg.test.ts`
Expected: the new `describe` fails on missing `styles.*.json` files.

- [ ] **Step 3: Implement the style projections**

Extend the `./entities` import in `dtcg.ts` to `import type { CollectionV5, EffectStyleV5, EffectV5, StyleProperty, TokenV5, TypographyStyleV5 } from './entities';` and the `./value` import to include `DimensionValue`.

Add these helpers:

```ts
const SPEC_LAYER_EXT = 'com.spec-layer';

/** A style property as a DTCG composite member: a reference when bound to a
 *  surviving token, else the converted literal; `null` when nothing truthful fits. */
function styleMember(
  p: Projection, property: StyleProperty, scopes: string[], path: string, name: string,
): { value: DtcgJson } | { extension: DtcgJson } | null {
  if (property.source.kind === 'alias' && property.source.target_id !== null
    && !p.omittedIds.has(property.source.target_id)) {
    const target = p.pathById.get(property.source.target_id);
    if (target !== undefined) return { value: `{${target}}` };
  }
  if (property.resolved === null) {
    reportOnce(p, {
      code: 'value_omitted', severity: 'warning', path,
      message: `The ${name} property has no resolved value and was omitted.`,
      details: { property: name, reason: 'source_unavailable' },
    });
    return null;
  }
  const converted = dtcgLiteral(property.resolved, scopes, p.options.values);
  if ('omit' in converted) {
    if (converted.omit === 'unit_not_expressible') {
      reportOnce(p, {
        code: 'unit_not_expressible', severity: 'info', path,
        message: `The ${name} unit is not a DTCG dimension unit; the value is kept under $extensions.`,
        details: { property: name, ...converted.details },
      });
      const d = property.resolved as DimensionValue;
      return { extension: { value: d.number, unit: d.unit } };
    }
    reportOnce(p, {
      code: 'type_not_expressible', severity: 'warning', path,
      message: `The ${name} property has a type DTCG cannot state and was omitted.`,
      details: { property: name, ...converted.details },
    });
    return null;
  }
  return { value: converted.$value };
}

type TypographyKey = 'font_family' | 'font_size' | 'font_weight' | 'line_height'
  | 'letter_spacing' | 'paragraph_spacing' | 'paragraph_indent';
const TYPOGRAPHY_MEMBERS: Array<[TypographyKey, string, string[]]> = [
  ['font_family', 'fontFamily', []],
  ['font_size', 'fontSize', []],
  ['font_weight', 'fontWeight', ['FONT_WEIGHT']],
  ['line_height', 'lineHeight', []],
  ['letter_spacing', 'letterSpacing', []],
];
const TYPOGRAPHY_EXTENSION_MEMBERS: Array<[TypographyKey, string]> = [
  ['paragraph_spacing', 'paragraphSpacing'],
  ['paragraph_indent', 'paragraphIndent'],
];

function typographyLeaf(p: Projection, style: TypographyStyleV5, path: string): DtcgTree {
  const value: DtcgTree = {};
  const ext: DtcgTree = {};
  for (const [key, name, scopes] of TYPOGRAPHY_MEMBERS) {
    const member = styleMember(p, style.properties[key], scopes, path, name);
    if (member === null) continue;
    if ('value' in member) value[name] = member.value;
    else ext[name] = member.extension;
  }
  for (const [key, name] of TYPOGRAPHY_EXTENSION_MEMBERS) {
    const member = styleMember(p, style.properties[key], [], path, name);
    if (member === null) continue;
    ext[name] = 'value' in member ? member.value : member.extension;
  }
  ext.textCase = style.properties.text_case;
  ext.textDecoration = style.properties.text_decoration;
  return {
    $type: 'typography',
    $value: value,
    ...(style.description.length > 0 ? { $description: style.description } : {}),
    $extensions: { [SPEC_LAYER_EXT]: ext },
  };
}

type ShadowKey = 'color' | 'offset_x' | 'offset_y' | 'blur' | 'spread';
const SHADOW_FIELDS: Array<[ShadowKey, string]> = [
  ['color', 'color'], ['offset_x', 'offsetX'], ['offset_y', 'offsetY'], ['blur', 'blur'], ['spread', 'spread'],
];

function effectLeaf(p: Projection, style: EffectStyleV5, path: string): DtcgTree {
  const bindings = new Map((style.bindings ?? []).map((b) => [b.property, b.token_id]));
  const shadows: DtcgJson[] = [];
  const layers: DtcgJson[] = [];
  style.effects.forEach((effect: EffectV5, index) => {
    const isShadow = effect.type === 'drop_shadow' || effect.type === 'inner_shadow';
    const layer: DtcgTree = { index, type: effect.type, visible: effect.visible };
    if (effect.blend_mode !== undefined) layer.blend_mode = effect.blend_mode;
    if (!isShadow && effect.blur) {
      const b = dtcgLiteral(effect.blur, [], p.options.values);
      if (!('omit' in b)) layer.blur = b.$value;
    }
    layers.push(layer);
    if (!isShadow || !effect.visible) return;
    const shadow: DtcgTree = {};
    for (const [field, name] of SHADOW_FIELDS) {
      const boundId = bindings.get(`effects[${index}].${field}`);
      const boundPath = boundId !== undefined && !p.omittedIds.has(boundId) ? p.pathById.get(boundId) : undefined;
      if (boundPath !== undefined) {
        shadow[name] = `{${boundPath}}`;
        continue;
      }
      const raw: TypedValue | undefined = effect[field];
      if (raw === undefined) continue;
      const converted = dtcgLiteral(raw, [], p.options.values);
      if (!('omit' in converted)) shadow[name] = converted.$value;
    }
    shadow.inset = effect.type === 'inner_shadow';
    shadows.push(shadow);
  });
  if (shadows.length === 0) {
    reportOnce(p, {
      code: 'effect_not_expressible', severity: 'warning', path,
      message: 'The style has no visible shadow; DTCG has no blur type, so it is kept only under $extensions.',
      details: { id: style.id },
    });
  }
  return {
    $type: 'shadow',
    $value: shadows,
    $extensions: { [SPEC_LAYER_EXT]: { layers } },
  };
}

function styleFiles(p: Projection): Record<string, DtcgTree> {
  const files: Record<string, DtcgTree> = {};
  const build = <T extends { id: string; name: string }>(
    styles: T[], root: string, file: string, leafOf: (style: T, path: string) => DtcgTree,
  ) => {
    if (styles.length === 0) return;
    const tree: DtcgTree = {};
    const seen = new Map<string, string>();
    for (const style of styles) {
      const segments = [root, ...dtcgSegments(style.name).segments];
      const path = segments.join('.');
      const other = seen.get(path);
      if (other !== undefined) {
        reportOnce(p, {
          code: 'path_collision', severity: 'error', path,
          message: 'Two styles share this DTCG path after escaping; the later one was omitted.',
          details: { id: style.id, ids: [other, style.id] },
        });
        continue;
      }
      seen.set(path, style.id);
      setLeaf(tree, segments, leafOf(style, path));
    }
    files[file] = sortTree(tree) as DtcgTree;
  };
  build(p.artifact.styles.typography, 'Typography styles', 'styles.typography.json',
    (s, path) => typographyLeaf(p, s, path));
  build(p.artifact.styles.effects, 'Effect styles', 'styles.effects.json',
    (s, path) => effectLeaf(p, s, path));
  return files;
}
```

In `foundationDtcg`, after the collection file loop: `Object.assign(files, styleFiles(p));`.

Style collisions differ from token collisions on purpose: the first style keeps its path because styles are ordered by the source artifact, and dropping both would remove a style for a defect in its sibling. Task 9 records this in the spec.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/extractor/test/v5/dtcg.test.ts`
Expected: PASS. If `effect[field]` does not typecheck because `color` is `ColorValue` and the rest are `DimensionValue`, declare `raw` as `effect[field] as TypedValue | undefined`.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add packages/extractor/src/v5/dtcg.ts packages/extractor/test/v5/dtcg.test.ts
git commit -m "feat(v5): dtcg typography and shadow composites from foundation styles"
```

---

### Task 5: Resolver document, guidelines, clipboard document, and golden

**Files:**
- Modify: `packages/extractor/src/v5/dtcg.ts`
- Modify: `packages/extractor/test/v5/dtcg.test.ts`
- Create: `packages/extractor/test/v5/dtcgGolden.test.ts`
- Create: `packages/extractor/test/fixtures/v5/synthetic-foundation-dtcg/` (generated)

**Interfaces:**
- Produces:
  - `foundationDtcg(...).resolver` populated per the spec.
  - `export interface DtcgDocumentExtension { schema_version: string; content_hash: string; source: { provider: 'figma'; file_name?: string }; completeness: FoundationArtifactV5['completeness']; code_syntax: Record<string, Record<string, string>>; report: DtcgReportEntry[] }`
  - `export interface DtcgDocument extends DtcgResolverDocument { $extensions: { 'com.spec-layer': DtcgDocumentExtension } }`
  - `export function foundationDtcgDocument(artifact: FoundationArtifactV5, options?: DtcgOptions): DtcgDocument`
  - `export function dtcgExportFiles(out: DtcgExport): Record<string, string>` returning every file as two-space JSON text with a trailing newline, keyed by relative name including `resolver.json`, `spec-layer.meta.json`, `report.json`. Tasks 7 and 8 use these.

- [ ] **Step 1: Write the failing tests**

Add `dtcgExportFiles, foundationDtcgDocument` to the import from `../../src/index` at the top of `dtcg.test.ts`, then append:

```ts
describe('foundationDtcg resolver and document', () => {
  const artifact = syntheticArtifact();
  const out = foundationDtcg(artifact);

  it('models a multi-mode collection as a modifier and styles as sets, in artifact order', () => {
    expect(out.resolver.version).toBe('2025.10');
    expect(out.resolver.name).toBe('Synthetic Direct Foundation');
    expect(out.resolver.modifiers.Primitives).toEqual({
      contexts: {
        'Light [ModeID:p-light]': [{ $ref: 'primitives.light.json' }],
        Dark: [{ $ref: 'primitives.dark.json' }],
        'Light [ModeID:p-light-duplicate]': [{ $ref: 'primitives.light-2.json' }],
      },
      default: 'Light [ModeID:p-light]',
    });
    expect(out.resolver.modifiers.Semantic.default).toBe('Light');
    expect(out.resolver.sets['Typography styles']).toEqual({ sources: [{ $ref: 'styles.typography.json' }] });
    expect(out.resolver.resolutionOrder).toEqual([
      { $ref: '#/modifiers/Primitives' },
      { $ref: '#/modifiers/Semantic' },
      { $ref: '#/sets/Effect styles' },
      { $ref: '#/sets/Typography styles' },
    ]);
  });

  it('escapes JSON pointer characters in set and modifier names', () => {
    const renamed = syntheticArtifact();
    renamed.collections[1].name = 'a/b~c';
    const r = foundationDtcg(renamed).resolver;
    expect(r.resolutionOrder[1]).toEqual({ $ref: '#/modifiers/a~1b~0c' });
    expect(Object.keys(r.modifiers)).toContain('a/b~c');
  });

  it('puts generated group descriptions on the matching group', () => {
    const annotated = syntheticArtifact();
    annotated.guidelines = { origin: 'generated', group_descriptions: { Primitives: { color: 'Brand ramps.' } } };
    const files = foundationDtcg(annotated).files;
    expect(leaf(files['primitives.light.json'], 'Primitives.color')?.$description).toBe('Brand ramps.');
  });

  it('builds one clipboard document with inline sources and a spec-layer extension', () => {
    const doc = foundationDtcgDocument(artifact);
    expect(doc.version).toBe('2025.10');
    expect(doc.modifiers.Primitives.contexts.Dark[0]).toHaveProperty('Primitives');
    expect(doc.sets['Typography styles'].sources[0]).toHaveProperty('Typography styles');
    const ext = doc.$extensions['com.spec-layer'];
    expect(ext.schema_version).toBe('5.1.0');
    expect(ext.content_hash).toBe(artifact.spec_layer.export.content_hash);
    expect(ext.source).toEqual({ provider: 'figma', file_name: 'Synthetic Direct Foundation' });
    expect(ext.completeness).toEqual(artifact.completeness);
    expect(ext.code_syntax['Primitives.color.exact.red']).toEqual({ WEB: '--color-exact-red' });
    expect(ext.report).toEqual(out.report);
  });

  it('serializes every file deterministically with a trailing newline', () => {
    const texts = dtcgExportFiles(out);
    expect(Object.keys(texts).sort()).toEqual([
      'primitives.dark.json', 'primitives.light-2.json', 'primitives.light.json', 'report.json',
      'resolver.json', 'semantic.dark.json', 'semantic.light.json', 'spec-layer.meta.json',
      'styles.effects.json', 'styles.typography.json',
    ]);
    for (const text of Object.values(texts)) expect(text.endsWith('\n')).toBe(true);
    expect(dtcgExportFiles(foundationDtcg(syntheticArtifact()))).toEqual(texts);
  });
});
```

Style sets are ordered by file name (`styles.effects.json` before `styles.typography.json`) because the artifact gives them no order relative to each other.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/extractor/test/v5/dtcg.test.ts`
Expected: FAIL on resolver contents and missing exports.

- [ ] **Step 3: Implement**

Add to `dtcg.ts`, changing the first import to `import { SCHEMA_VERSION, type FoundationArtifactV5 } from './canonical';`:

```ts
const pointer = (s: string): string => s.replace(/~/g, '~0').replace(/\//g, '~1');

interface FilePlan { collection: CollectionV5; modeId: string; file: string }

const STYLE_ROOTS: Record<string, string> = {
  'styles.typography.json': 'Typography styles',
  'styles.effects.json': 'Effect styles',
};

function buildResolver(p: Projection, plans: FilePlan[], styleFileNames: string[]): DtcgResolverDocument {
  const sets: DtcgResolverDocument['sets'] = {};
  const modifiers: DtcgResolverDocument['modifiers'] = {};
  const order: Array<{ $ref: string }> = [];
  for (const collection of p.artifact.collections) {
    const own = plans.filter((f) => f.collection.id === collection.id);
    if (own.length === 0) continue;
    const labels = modeLabels(collection);
    if (own.length === 1) {
      sets[collection.name] = { sources: [{ $ref: own[0].file }] };
      order.push({ $ref: `#/sets/${pointer(collection.name)}` });
      continue;
    }
    const contexts: Record<string, DtcgJson[]> = {};
    for (const plan of own) contexts[labels.get(plan.modeId) ?? plan.modeId] = [{ $ref: plan.file }];
    const def = labels.get(collection.default_mode_id);
    modifiers[collection.name] = { contexts, ...(def !== undefined ? { default: def } : {}) };
    order.push({ $ref: `#/modifiers/${pointer(collection.name)}` });
  }
  for (const file of styleFileNames) {
    const root = STYLE_ROOTS[file];
    sets[root] = { sources: [{ $ref: file }] };
    order.push({ $ref: `#/sets/${pointer(root)}` });
  }
  const fileName = p.artifact.spec_layer.source.file_name;
  return {
    version: '2025.10',
    ...(typeof fileName === 'string' && fileName.length > 0 ? { name: fileName } : {}),
    sets, modifiers, resolutionOrder: order,
  };
}

/** Generated group descriptions become `$description` on the group they name. */
function annotateGroups(p: Projection, tree: DtcgTree, collection: CollectionV5): void {
  const groups = p.artifact.guidelines?.group_descriptions[collection.name];
  if (!groups) return;
  const head = dtcgSegments(collection.name).segments;
  for (const [folder, text] of Object.entries(groups)) {
    if (text.length === 0) continue;
    let node: DtcgJson | undefined = tree;
    for (const seg of [...head, ...dtcgSegments(folder).segments]) {
      if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
      node = node[seg];
    }
    if (typeof node === 'object' && node !== null && !Array.isArray(node) && !('$value' in node)) {
      node.$description = text;
    }
  }
}
```

Refactor the file loop in `foundationDtcg` to record plans, annotate, and build the resolver:

```ts
  const files: Record<string, DtcgTree> = {};
  const plans: FilePlan[] = [];
  const taken = new Set<string>();
  for (const collection of artifact.collections) {
    for (const mode of collection.modes) {
      const tree: DtcgTree = {};
      for (const token of artifact.tokens) {
        if (token.collection_id !== collection.id || p.omittedIds.has(token.id)) continue;
        const leaf = tokenLeaf(p, token, collection, mode.id);
        if (leaf) setLeaf(tree, p.segmentsById.get(token.id) ?? [], leaf);
      }
      annotateGroups(p, tree, collection);
      const file = fileNameFor(collection, mode, taken);
      plans.push({ collection, modeId: mode.id, file });
      files[file] = sortTree(tree) as DtcgTree;
    }
  }
  const styles = styleFiles(p);
  Object.assign(files, styles);
  const resolver = buildResolver(p, plans, Object.keys(styles).sort(compareCodeUnits));
  p.report.sort((a, b) => compareCodeUnits(a.path, b.path)
    || compareCodeUnits(a.code, b.code) || compareCodeUnits(a.mode ?? '', b.mode ?? ''));
```

and return `{ files, resolver, meta: sortedMeta, report: p.report }`.

Add the document and file serialization:

```ts
export interface DtcgDocumentExtension {
  schema_version: string;
  content_hash: string;
  source: { provider: 'figma'; file_name?: string };
  completeness: FoundationArtifactV5['completeness'];
  code_syntax: Record<string, Record<string, string>>;
  report: DtcgReportEntry[];
}
export interface DtcgDocument extends DtcgResolverDocument {
  $extensions: { 'com.spec-layer': DtcgDocumentExtension };
}

/** The clipboard form: the resolver with sources inlined instead of `$ref`s. */
export function foundationDtcgDocument(artifact: FoundationArtifactV5, options: DtcgOptions = {}): DtcgDocument {
  const out = foundationDtcg(artifact, options);
  const inline = (sources: DtcgJson[]): DtcgJson[] => sources.map((s) =>
    typeof s === 'object' && s !== null && !Array.isArray(s) && typeof s.$ref === 'string'
      ? out.files[s.$ref] ?? s
      : s);
  const sets = Object.fromEntries(Object.entries(out.resolver.sets)
    .map(([k, v]) => [k, { sources: inline(v.sources) }]));
  const modifiers = Object.fromEntries(Object.entries(out.resolver.modifiers).map(([k, v]) => [k, {
    contexts: Object.fromEntries(Object.entries(v.contexts).map(([c, s]) => [c, inline(s)])),
    ...(v.default !== undefined ? { default: v.default } : {}),
  }]));
  const codeSyntax: Record<string, Record<string, string>> = {};
  for (const [path, entry] of Object.entries(out.meta)) {
    if (entry.code_syntax) codeSyntax[path] = entry.code_syntax;
  }
  const fileName = artifact.spec_layer.source.file_name;
  return {
    ...out.resolver, sets, modifiers,
    $extensions: {
      'com.spec-layer': {
        schema_version: SCHEMA_VERSION,
        content_hash: artifact.spec_layer.export.content_hash,
        source: {
          provider: 'figma',
          ...(typeof fileName === 'string' && fileName.length > 0 ? { file_name: fileName } : {}),
        },
        completeness: artifact.completeness,
        code_syntax: codeSyntax,
        report: out.report,
      },
    },
  };
}

/** Every output as file text, two-space JSON with a trailing newline. */
export function dtcgExportFiles(out: DtcgExport): Record<string, string> {
  const text = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  const files: Record<string, string> = {};
  for (const name of Object.keys(out.files).sort(compareCodeUnits)) files[name] = text(out.files[name]);
  files['resolver.json'] = text(out.resolver);
  files['spec-layer.meta.json'] = text(out.meta);
  files['report.json'] = text(out.report);
  return files;
}
```

Check `ArtifactSource.file_name`'s exact type in `canonical.ts`; the `typeof` guards above handle `string | null` and `string | undefined` alike.

- [ ] **Step 4: Run, then write the golden test**

Run: `npx vitest run packages/extractor/test/v5/dtcg.test.ts`
Expected: PASS.

Create `packages/extractor/test/v5/dtcgGolden.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { dtcgExportFiles, foundationDtcg } from '../../src/index';
import { syntheticArtifact } from './dtcgFixture';

const GOLDEN_DIR = fileURLToPath(new URL('../fixtures/v5/synthetic-foundation-dtcg/', import.meta.url));

describe('DTCG golden', () => {
  it('matches the reviewed golden directory file for file', () => {
    const files = dtcgExportFiles(foundationDtcg(syntheticArtifact()));
    if (process.env.UPDATE_V5_DTCG_GOLDEN === '1') {
      mkdirSync(GOLDEN_DIR, { recursive: true });
      for (const [name, text] of Object.entries(files)) writeFileSync(join(GOLDEN_DIR, name), text);
    }
    expect(existsSync(GOLDEN_DIR)).toBe(true);
    expect(readdirSync(GOLDEN_DIR).sort()).toEqual(Object.keys(files).sort());
    for (const [name, text] of Object.entries(files)) {
      expect(readFileSync(join(GOLDEN_DIR, name), 'utf8'), name).toBe(text);
    }
  });
});
```

```bash
UPDATE_V5_DTCG_GOLDEN=1 npx vitest run packages/extractor/test/v5/dtcgGolden.test.ts
```

Read every generated file in `packages/extractor/test/fixtures/v5/synthetic-foundation-dtcg/` against the spec's Format section. Confirm: the `Semantic` dark file references `{Primitives.color.chain.bridge}`; no token file contains the string `unresolved`; `report.json` lists the cycle, the external alias, the missing mode value, the boolean token, and the `%` letter spacing; no `$value` is `null`.

Run: `npx vitest run packages/extractor/test/v5/dtcgGolden.test.ts`
Expected: PASS without the env var.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add packages/extractor/src/v5/dtcg.ts packages/extractor/test/v5/ packages/extractor/test/fixtures/v5/synthetic-foundation-dtcg
git commit -m "feat(v5): dtcg resolver, clipboard document, and golden output"
```

---

### Task 6: Style Dictionary build gate

**Files:**
- Modify: `package.json` (root devDependencies)
- Create: `packages/extractor/test/v5/dtcgStyleDictionary.test.ts`

**Interfaces:**
- Consumes: `foundationDtcg`, `dtcgExportFiles`, `syntheticArtifact`.

- [ ] **Step 1: Add the dependency and check the audit**

```bash
npm install --save-dev style-dictionary@5.5.2
npm audit
```

Expected: `found 0 vulnerabilities`. If not, stop and report the advisory before continuing; do not add an override without reading it.

- [ ] **Step 2: Write the failing test**

Create `packages/extractor/test/v5/dtcgStyleDictionary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import StyleDictionary from 'style-dictionary';
import { dtcgExportFiles, foundationDtcg, type DtcgValueStyle } from '../../src/index';
import { syntheticArtifact } from './dtcgFixture';

/** Mirrors the Neuron Token Sync build: primitives plus one themed mode file
 *  in a single Style Dictionary run, references kept as var() in the CSS. */
async function buildCss(style: DtcgValueStyle): Promise<string> {
  const texts = dtcgExportFiles(foundationDtcg(syntheticArtifact(), { values: style }));
  const dir = mkdtempSync(join(tmpdir(), 'sl-dtcg-sd-'));
  try {
    for (const [name, text] of Object.entries(texts)) writeFileSync(join(dir, name), text);
    const tokens = {
      ...JSON.parse(texts['primitives.dark.json']),
      ...JSON.parse(texts['semantic.dark.json']),
    };
    const sd = new StyleDictionary({
      usesDtcg: true,
      tokens,
      log: { warnings: 'error', errors: { brokenReferences: 'throw' } },
      platforms: {
        css: {
          transforms: ['attribute/cti', 'name/kebab', 'color/css'],
          buildPath: `${dir}/`,
          files: [{ destination: 'tokens.css', format: 'css/variables', options: { outputReferences: true } }],
        },
      },
    });
    await sd.buildAllPlatforms();
    return readFileSync(join(dir, 'tokens.css'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('Style Dictionary reads the DTCG output', () => {
  it('builds the legacy flavour into CSS with resolved references', async () => {
    const css = await buildCss('legacy');
    expect(css).toContain('--primitives-color-exact-red: #ff0000;');
    expect(css).toContain('--primitives-spacing-gap: 12px;');
    expect(css).toMatch(/--semantic-color-surface-primary: var\(--primitives-color-chain-bridge\);/);
  });

  it('resolves every reference in the standard flavour', async () => {
    const out = foundationDtcg(syntheticArtifact());
    const tokens = { ...out.files['primitives.dark.json'], ...out.files['semantic.dark.json'] };
    const sd = new StyleDictionary({
      usesDtcg: true, tokens, log: { warnings: 'error', errors: { brokenReferences: 'throw' } },
      platforms: { json: { transforms: [], buildPath: `${tmpdir()}/`, files: [] } },
    });
    const resolved = await sd.exportPlatform('json') as Record<string, unknown>;
    expect(JSON.stringify(resolved.Semantic)).toContain('"hex":"#000000"');
  });
});
```

The `Dark` mode is used because `Semantic.color.surface.primary` is a literal in Light and an alias in Dark in the fixture. If Style Dictionary 5.5.2 rejects the 2025.10 color object in `exportPlatform`, keep the first test and change the second to assert that `exportPlatform` rejects with a message naming the unsupported shape; record the exact message in the test as the current limit and note it in `CHANGELOG.md`. Do not change the projection to make the tool happy.

- [ ] **Step 3: Run**

Run: `npx vitest run packages/extractor/test/v5/dtcgStyleDictionary.test.ts`
Expected: PASS, or the documented failure path above. If `name/kebab` produces different names than asserted, print the CSS once and fix the assertions to Style Dictionary's actual output; the names are Style Dictionary's, not ours.

- [ ] **Step 4: Run the whole extractor suite, then commit**

Run: `npx vitest run packages/extractor`
Expected: PASS.

```bash
git add package.json package-lock.json packages/extractor/test/v5/dtcgStyleDictionary.test.ts
git commit -m "test(v5): build the dtcg output through style dictionary"
```

---

### Task 7: Plugin: Copy for AI and publish emit the DTCG document

**Files:**
- Modify: `packages/plugin/src/ui/actions.ts:668-687` (`foundationAiYaml`) and its two callers, `copyFoundationBrief` and `copyFoundationBriefForScope`
- Modify: `packages/plugin/src/ui/publish.ts:49` (`foundation.ai`)
- Modify: `packages/plugin/test/copyFoundation.test.ts`
- Modify: `packages/plugin/test/publish.test.ts` if it asserts on `foundation.ai` content (find with `grep -rn "foundation.ai\|foundation: yes\|spec_layer:" packages/plugin/test`)
- Modify: `packages/plugin/TESTING.md:22,78-84` and the Library scoped-copy rows around lines 176 and 185
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `foundationDtcgDocument` from Task 5.
- Produces: `foundationDtcgJson(spec, generatedAt, descriptions, scope?): string` in `actions.ts`, replacing `foundationAiYaml`. The clipboard text is `JSON.stringify(document, null, 2)` plus a newline.

- [ ] **Step 1: Update the tests first**

In `packages/plugin/test/copyFoundation.test.ts`, replace the `ParsedFoundationBrief` interface and every `load(...)` of clipboard text with JSON parsing. Add near the top:

```ts
interface ClipboardDocument {
  version: string;
  name?: string;
  sets: Record<string, { sources: unknown[] }>;
  modifiers: Record<string, { contexts: Record<string, unknown[]>; default?: string }>;
  resolutionOrder: Array<{ $ref: string }>;
  $extensions: { 'com.spec-layer': {
    schema_version: string; content_hash: string; completeness: { collections: string };
    code_syntax: Record<string, Record<string, string>>; report: Array<{ code: string; path: string }>;
  } };
}
const copied = (): ClipboardDocument =>
  JSON.parse(copyText.mock.calls.at(-1)?.[0] as string) as ClipboardDocument;
```

Rewrite the existing assertions to the new shape. The intent of each existing test must survive; the concrete replacements:

- "copies a parseable compact v5 AI profile backed by the canonical content hash" becomes "copies one DTCG resolver document backed by the canonical content hash": assert `copied().version === '2025.10'`, `copied().$extensions['com.spec-layer'].content_hash` matches `/^sha256:[0-9a-f]{64}$/`, and `Object.keys(copied().sets).concat(Object.keys(copied().modifiers))` contains `'Color'`.
- "carries dimensions, unit diagnostics, precise channels, and full/external aliases": walk into `copied().sets.Color.sources[0]` (or the modifier context for a multi-mode collection in the DUMP) and assert a dimension leaf equals `{ $type: 'dimension', $value: { value: 16, unit: 'px' } }`, a color with channels has `components` equal to the channels, a local alias `$value` is a `{Color.…}` string, and the external alias is absent from the tree while `report` contains an entry with `code: 'value_omitted'` for its path. Read the DUMP at the top of the test file to pick the exact token names.
- Guidelines tests: assert the group `$description` on the matching group inside the inline source, and that removing descriptions removes it. The "keeps generated guidelines outside the semantic content hash" test asserts `content_hash` is identical with and without descriptions.
- Size-caveat tests are unchanged in intent; the copy is still text and the 800-line threshold still applies.
- `copyFoundationBriefForScope` tests: "copies only the scoped collection" asserts the document's sets and modifiers name only the scoped collection plus its dependency collections; "copies every text style for a text styles scope" asserts `sets['Typography styles']` exists and no `Effect styles` set.

Run: `npx vitest run packages/plugin/test/copyFoundation.test.ts`
Expected: FAIL, the clipboard is still YAML.

- [ ] **Step 2: Replace the projection in `actions.ts`**

Replace `foundationAiYaml` (lines 668 to 687) with:

```ts
function foundationDtcgJson(
  spec: FoundationSpec,
  generatedAt: string,
  descriptions: Record<string, Record<string, string>>,
  scope?:
    | { target: 'collection'; collectionId: string }
    | { target: 'textStyles' },
): string {
  const { artifact } = buildFoundationArtifactV5(spec, {
    exportId: `foundation:${spec.fileKey && spec.fileKey !== 'unknown' ? spec.fileKey : 'local'}:${generatedAt}`,
    generatedAt,
    build: pluginBuild(),
    ...(scope ? { scope } : {}),
  });
  const guidelines = generatedGuidelines(descriptions);
  if (guidelines) artifact.guidelines = guidelines;
  // The canonical artifact stays the validated source of truth and owns the
  // semantic hash. The clipboard carries a Design Tokens Format Module 2025.10
  // resolver document projected from it, which Style Dictionary and Tokens
  // Studio read and an agent needs no dialect for. What DTCG cannot express is
  // listed under $extensions["com.spec-layer"].report, never approximated.
  return `${JSON.stringify(foundationDtcgDocument(artifact), null, 2)}\n`;
}
```

Update the import at `actions.ts:11` to bring in `foundationDtcgDocument` and drop `foundationAiContext` if nothing else in the file uses it (`grep -n foundationAiContext packages/plugin/src/ui/actions.ts`). Rename the two call sites in `copyFoundationBrief` and `copyFoundationBriefForScope` from `foundationAiYaml` to `foundationDtcgJson`. Keep `deliverBrief` as is; rename its `buildYaml` parameter to `buildText` and update its doc comment.

In `publish.ts:49`, change

```ts
    foundation = { ai: toYaml(foundationAiContext(artifact) as unknown as YamlValue), artifact };
```

to

```ts
    foundation = { ai: `${JSON.stringify(foundationDtcgDocument(artifact), null, 2)}\n`, artifact };
```

and fix the imports (`foundationDtcgDocument` in, `foundationAiContext` out if unused; `toYaml` and `YamlValue` stay for components).

- [ ] **Step 3: Run the plugin tests**

Run: `npx vitest run packages/plugin`
Expected: PASS. If `publish.test.ts` asserted `foundation.ai` starts with `spec_layer:`, change it to `JSON.parse(bundle.foundation.ai).version === '2025.10'`.

- [ ] **Step 4: Update the manual matrix**

In `packages/plugin/TESTING.md`, rewrite row 2 of the overview to "**Generate Foundation docs** and exercise file-wide **Copy for AI**, which copies a DTCG resolver document." Rewrite the Foundations footer row (around line 78) to:

```markdown
4. Click the Foundations footer's **Copy for AI** and paste into a plain text
   editor. Confirm it is JSON with `"version": "2025.10"`, one set or modifier
   per collection named exactly as in Figma, `$type` and `$value` on every
   token, `{Collection.path}` references for aliases, and a
   `$extensions["com.spec-layer"]` block carrying `content_hash`,
   `completeness`, `code_syntax`, and a `report` array. Every unresolved
   library alias in the file must appear in `report` and nowhere else.
   Confirm the complete file-wide vocabulary is present regardless of source
   selection, and no canvas objects are created.
```

Update the Library scoped-copy rows (around lines 176 and 185) so a Foundation row copy is checked for the same JSON shape limited to the scoped collection and its dependency collections.

- [ ] **Step 5: Changelog and commit**

Add under `## [Unreleased]` / `### Changed`:

```markdown
- Foundation **Copy for AI** and the published bundle's foundation context are
  now a Design Tokens Format Module 2025.10 resolver document instead of Spec
  Layer's own YAML profile. Collections become sets or modifiers named as in
  Figma, tokens carry `$type` and `$value`, aliases are `{Collection.path}`
  references, and text and effect styles are `typography` and `shadow`
  composites. Anything the format cannot state, such as an unresolved library
  alias or a boolean variable, is omitted from the tree and listed under
  `$extensions["com.spec-layer"].report`. The canonical v5 artifact is
  unchanged and still owns the content hash. Component Copy for AI is
  unchanged apart from `code_syntax` on the tokens it embeds.
```

```bash
npm run build:plugin && npm run check:sandbox
git add packages/plugin CHANGELOG.md
git commit -m "feat(plugin): copy and publish foundations as a dtcg document"
```

---

### Task 8: CLI: `pull` writes `tokens/`, config carries `dtcg` options

**Files:**
- Modify: `packages/cli/src/config.ts` (`CliConfig`, `readConfig`, `writeConfig`, `ResolvedOptions`, `resolveOptions`)
- Modify: `packages/cli/src/files.ts` (`writeBundleFiles`, `ManifestArtifact` docs)
- Modify: `packages/cli/src/commands.ts` (`runPull` passes `dtcg`; `runSetup` preserves it)
- Modify: `packages/cli/src/cli.ts` (USAGE text)
- Modify: `packages/cli/README.md`, `packages/cli/package.json` (version `0.4.0`)
- Modify: `packages/cli/test/config.test.ts`, `files.test.ts`, `commands.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `foundationDtcg`, `dtcgExportFiles`, `validateLevel1`, `type DtcgOptions`, `type FoundationArtifactV5` from `@spec-layer/extractor` (bundled at build; the CLI still has zero runtime dependencies).
- Produces: `CliConfig.dtcg?: DtcgOptions`; `ResolvedOptions.dtcg?: DtcgOptions`; `writeBundleFiles(opts & { dtcg?: DtcgOptions })` writing `tokens/<file>` for every entry of `dtcgExportFiles`; manifest foundation `aiPath: 'tokens/resolver.json'`.

- [ ] **Step 1: Config tests**

Append to `packages/cli/test/config.test.ts`, using the temp `cwd` its `beforeEach` already creates:

```ts
it('reads a dtcg block with values and units, and rejects a bad one', () => {
  writeFileSync(join(cwd, 'speclayer.json'), JSON.stringify({
    libraryId: 'lib_1', dtcg: { values: 'legacy', units: { 'Foundation/spacing/*': 'px' } },
  }));
  expect(readConfig(cwd)?.dtcg).toEqual({ values: 'legacy', units: { 'Foundation/spacing/*': 'px' } });
  writeFileSync(join(cwd, 'speclayer.json'), JSON.stringify({ libraryId: 'lib_1', dtcg: { values: 'strings' } }));
  expect(() => readConfig(cwd)).toThrow(/speclayer.json/);
  writeFileSync(join(cwd, 'speclayer.json'), JSON.stringify({ libraryId: 'lib_1', dtcg: { units: { 'a/*': 'em' } } }));
  expect(() => readConfig(cwd)).toThrow(/speclayer.json/);
});
```

Run: `npx vitest run packages/cli/test/config.test.ts`
Expected: FAIL, `dtcg` is not read.

- [ ] **Step 2: Implement config**

In `config.ts`:

```ts
import type { DtcgOptions } from '@spec-layer/extractor';

export interface CliConfig { libraryId?: string; outDir?: string; include?: Selection; dtcg?: DtcgOptions }

/** `dtcg` chooses the value flavour and declares unit overrides for the tokens/ output. */
function parseDtcg(value: unknown): DtcgOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalidConfig();
  const record = value as Record<string, unknown>;
  const out: DtcgOptions = {};
  if (record.values !== undefined) {
    if (record.values !== 'standard' && record.values !== 'legacy') throw invalidConfig();
    out.values = record.values;
  }
  if (record.units !== undefined) {
    if (typeof record.units !== 'object' || record.units === null || Array.isArray(record.units)) throw invalidConfig();
    for (const unit of Object.values(record.units as Record<string, unknown>)) {
      if (unit !== 'px' && unit !== 'rem') throw invalidConfig();
    }
    out.units = record.units as Record<string, 'px' | 'rem'>;
  }
  return out;
}
```

In `readConfig`, add `...(record.dtcg !== undefined ? { dtcg: parseDtcg(record.dtcg) } : {}),`. In `writeConfig`, accept and write an optional `dtcg` the same way `include` is written, and make `runSetup` preserve it the way it preserves `include` (read `runSetup` in `commands.ts` to see how). In `ResolvedOptions`, add `dtcg?: DtcgOptions;` and set it from `config?.dtcg` in `resolveOptions`.

Run: `npx vitest run packages/cli/test/config.test.ts`
Expected: PASS.

- [ ] **Step 3: Files tests**

In `packages/cli/test/files.test.ts`, the `makeBundle` fixture's foundation artifact is a stub. Add a real one:

```ts
import { fileURLToPath } from 'node:url';
import {
  buildFoundation, buildFoundationArtifactV5, type SerializedFoundation,
} from '@spec-layer/extractor';

const SERIALIZED = fileURLToPath(new URL(
  '../../extractor/test/fixtures/v5/synthetic-foundation-serialized.json', import.meta.url,
));
function realFoundation() {
  const serialized = JSON.parse(readFileSync(SERIALIZED, 'utf8')) as SerializedFoundation;
  const { artifact } = buildFoundationArtifactV5(buildFoundation(serialized), {
    exportId: 'cli-test', generatedAt: '2026-09-03T00:00:00.000Z', build: null,
  });
  return { ai: '{"version":"2025.10"}\n', artifact };
}
```

Add tests inside `describe('writeBundleFiles')`:

```ts
it('writes the foundation as a tokens/ directory projected from the canonical artifact', () => {
  const bundle = makeBundle({ foundation: realFoundation() });
  const written = writeBundleFiles({
    outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_1',
    publishedAt: '2026-09-03T00:00:00.000Z', bundleHash: 'h'.repeat(64),
  });
  expect(written).toContain('tokens/resolver.json');
  expect(written).toContain('tokens/primitives.light.json');
  expect(written).toContain('tokens/spec-layer.meta.json');
  expect(written).toContain('tokens/report.json');
  expect(written).not.toContain('ai/foundation.yaml');
  const resolver = JSON.parse(readFileSync(join(outDir, 'tokens/resolver.json'), 'utf8'));
  expect(resolver.version).toBe('2025.10');
  const manifest = readManifest(outDir)!;
  expect(manifest.artifacts.find((a) => a.kind === 'foundation')?.aiPath).toBe('tokens/resolver.json');
});

it('honours dtcg options from config', () => {
  const bundle = makeBundle({ foundation: realFoundation() });
  writeBundleFiles({
    outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_1',
    publishedAt: '2026-09-03T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    dtcg: { values: 'legacy' },
  });
  const light = JSON.parse(readFileSync(join(outDir, 'tokens/primitives.light.json'), 'utf8'));
  expect(light.Primitives.color.exact.red.$value).toBe('#ff0000');
});

it('writes no tokens/ when the selection excludes the foundation', () => {
  const bundle = makeBundle({ foundation: realFoundation() });
  const written = writeBundleFiles({
    outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_1',
    publishedAt: '2026-09-03T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    selection: { foundation: false, components: null },
  });
  expect(written.some((f) => f.startsWith('tokens/'))).toBe(false);
  expect(readManifest(outDir)!.artifacts.find((a) => a.kind === 'foundation')?.aiPath).toBeNull();
});

it('fails with a plain sentence when the foundation artifact is not a valid v5 artifact', () => {
  const bundle = makeBundle(); // the stub artifact carries only a content hash
  expect(() => writeBundleFiles({
    outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_1',
    publishedAt: '2026-09-03T00:00:00.000Z', bundleHash: 'h'.repeat(64),
  })).toThrow('The published Foundation context did not pass schema validation. Republish from the plugin, then pull again.');
  expect(existsSync(outDir)).toBe(false);
});
```

Existing tests that pass `makeBundle()` with the stub foundation and expect success must switch to `makeBundle({ foundation: realFoundation() })` or `foundation: null`. Update the byte-for-byte test's expected file list from `ai/foundation.yaml` to the `tokens/` files.

Run: `npx vitest run packages/cli/test/files.test.ts`
Expected: FAIL on the new behaviour.

- [ ] **Step 4: Implement `writeBundleFiles`**

In `files.ts`:

```ts
import {
  dtcgExportFiles, foundationDtcg, validateLevel1,
  type DtcgOptions, type FoundationArtifactV5,
} from '@spec-layer/extractor';
```

Change the signature to accept `dtcg?: DtcgOptions` and replace the foundation block:

```ts
    if (opts.bundle.foundation) {
      let aiPath: string | null = null;
      if (selection.foundation) {
        // A shape check on the wire, so a malformed artifact fails in one
        // sentence rather than deep inside the projection. This does not
        // re-derive v5 output; the projection reads the artifact as published.
        const artifact: unknown = opts.bundle.foundation.artifact;
        if (validateLevel1(artifact).some((d) => d.severity === 'error')) {
          throw new Error('The published Foundation context did not pass schema validation. Republish from the plugin, then pull again.');
        }
        const files = dtcgExportFiles(foundationDtcg(artifact as FoundationArtifactV5, opts.dtcg ?? {}));
        for (const [name, text] of Object.entries(files)) put(`tokens/${name}`, text);
        aiPath = 'tokens/resolver.json';
      }
      artifacts.push({
        kind: 'foundation', name: 'foundation',
        contentHash: opts.bundle.foundation.artifact.spec_layer.export.content_hash,
        aiPath,
      });
    }
```

Update the `ManifestArtifact.aiPath` doc comment: for the foundation it is the resolver path, for components the YAML path. In `commands.ts` `runPull`, pass `dtcg: opts.dtcg` into `writeBundleFiles`.

Run: `npx vitest run packages/cli`
Expected: PASS after updating `commands.test.ts` fixtures the same way (its bundle fixtures also carry a stub foundation; give them a real one or `null`).

- [ ] **Step 5: Usage, README, version, build check**

In `cli.ts` USAGE, change the `pull` description to `fetch the library into DIR (default .speclayer); the foundation lands as DTCG under DIR/tokens/` and the `show` description to `print one artifact (foundation: the DTCG document; component: its AI YAML; --canonical for JSON)`.

In `packages/cli/README.md`, replace the "What `pull` writes" tree with:

```text
.speclayer/
  bundle.json                the published bundle, verbatim
  manifest.json              every artifact indexed by content hash and path, plus the selection
  tokens/                    the Foundation as Design Tokens Format Module 2025.10 files
    <collection>.<mode>.json one file per collection and mode, rooted at the collection name
    styles.typography.json   text styles as typography composites (when present)
    styles.effects.json      effect styles as shadow composites (when present)
    resolver.json            Design Tokens Resolver Module 2025.10: sets, modifiers, order
    spec-layer.meta.json     Figma ids, scopes, code syntax, publication, keyed by DTCG path
    report.json              what DTCG could not express, with reasons and stable ids
  ai/components/<name>.yaml  one file per selected component
```

Add a "Configuring the token output" section:

```markdown
## Configuring the token output

`speclayer.json` may carry a `dtcg` block:

    {
      "libraryId": "lib_...",
      "outDir": ".speclayer",
      "dtcg": {
        "values": "standard",
        "units": { "Foundation/spacing/*": "px", "Foundation/radius/*": "px" }
      }
    }

`values` is `standard` (the 2025.10 object forms, the default) or `legacy`
(the string forms Style Dictionary 4 and Tokens Studio read today). `units`
promotes a number whose Figma scopes state no unit to a dimension. Keys are a
collection name, a slash, and a glob over the variable name. An override that
contradicts a stated scope is ignored and listed in `report.json`. Nothing is
inferred from a name.

Point Style Dictionary at `.speclayer/tokens/` and load the files
`resolver.json` names for the mode you are building. The metadata sidecar and
the report are not token files; exclude them from token globs.
```

Fix the other README sentences that name `ai/foundation.yaml` or say `show foundation` prints YAML. Set `"version": "0.4.0"` in `packages/cli/package.json` and update the README note that says `setup` needs 0.3.0 or later to mention that `tokens/` output needs 0.4.0.

```bash
npm run build:cli && npm run check:cli-bundle
```

Expected: the bundle runs. If esbuild pulls `style-dictionary` into the CLI, the import chain is wrong: `dtcg.ts` must not import from any test file or from `style-dictionary`.

- [ ] **Step 6: Changelog and commit**

Add under `## [Unreleased]` / `### Changed` in `CHANGELOG.md`:

```markdown
- `spec-layer pull` (CLI 0.4.0) writes the Foundation as a `tokens/` directory
  of Design Tokens Format Module 2025.10 files plus `resolver.json`, a Figma
  metadata sidecar, and `report.json`, projected from the canonical artifact
  in `bundle.json` after a schema shape check. `ai/foundation.yaml` is no
  longer written; the manifest points the foundation at
  `tokens/resolver.json`. A `dtcg` block in `speclayer.json` chooses `standard`
  or `legacy` values and declares unit overrides for numbers whose scopes state
  no unit.
```

Do not publish to npm in this task.

```bash
git add packages/cli CHANGELOG.md
git commit -m "feat(cli): pull writes the foundation as dtcg token files"
```

---

### Task 9: Contract and status documentation, full gate

**Files:**
- Modify: `docs/specs/foundation-context-v5.md` (front matter, §5.4, §8, §20)
- Modify: `docs/specs/foundation-v5-status.md`
- Modify: `docs/superpowers/specs/2026-09-03-dtcg-foundation-export-design.md` (status line and the style-collision note from Task 4)
- Modify: `ARCHITECTURE.md`, `CLAUDE.md`
- Modify: `docs/plugin-knowledge-map.md` if it names `foundationAiYaml` or the foundation clipboard YAML (`grep -n "foundationAiYaml\|Copy for AI" docs/plugin-knowledge-map.md`)

- [ ] **Step 1: Foundation Context v5 spec**

In `docs/specs/foundation-context-v5.md`:

- Front matter `schema_version: 5.1.0`.
- §5.4 title becomes "Compact profiles". Keep the AI profile text for the component dependency slice, then add:

```markdown
### 5.5 DTCG profile

Foundation clipboard and repository output is a Design Tokens Format Module
2025.10 projection of the validated artifact, defined in
`docs/superpowers/specs/2026-09-03-dtcg-foundation-export-design.md`. It is
downstream of validation, outside every hash, and it omits and reports what the
format cannot express rather than approximating it. The canonical artifact
remains the sole source of truth.
```

- §8.1 example: add `code_syntax: { WEB: "--background-surface-page" }` after `scopes`. §8.2: add the bullet "Figma code syntax by platform, when the variable declares any, as `code_syntax`."
- §20: add `spec-layer pull` writing `tokens/`, and note `validate`, `normalize`, `diff` remain unimplemented.

- [ ] **Step 2: Status document, architecture, CLAUDE.md**

In `docs/specs/foundation-v5-status.md`: front matter `schema_version: 5.1.0`, `last_updated: 2026-09-03`. In "Current product behavior", replace the clipboard bullets that describe the AI profile with the DTCG document, and add a bullet that `foundationAiContext` now serves only the component dependency slice. Add `v5/dtcg.ts` to the "Direct architecture" table: "DTCG 2025.10 projection of a finished artifact: files, resolver, sidecar, report, clipboard document". In "Hash and compatibility boundaries", record that `code_syntax` moved the semantic hash and that schema is `5.1.0`. In "Release invariants", add "Keep the DTCG profile downstream of the validated artifact and outside every hash; omit and report, never approximate."

In `ARCHITECTURE.md`, find the CLI section and the Copy for AI section and update both: the CLI projects `tokens/` from the canonical artifact after a Level 1 shape check, and the plugin's foundation clipboard is the DTCG document.

In `CLAUDE.md`: in "Where things stand", add a "Shipped" bullet for the DTCG Foundation export and schema 5.1.0, and add to "Invariants":

```markdown
**DTCG is a projection.** `v5/dtcg.ts` reads a validated artifact and never
feeds a hash. What the format cannot express is omitted and written to the
report. Never a plausible default, never a fake reference.
```

Also update the "Manual Figma matrix" open item to mention the DTCG clipboard rows.

Set the design spec's status line to `implemented 2026-09-03` and add to its Names section: "Style paths collide by keeping the first style in artifact order and omitting later ones, because styles are already ordered by the source and dropping both would lose a style for a sibling's defect."

- [ ] **Step 3: Full gate**

```bash
npm run check
```

Expected: every stage passes. Read the exit status directly; do not pipe it. If `check:nul` flags a file, fix the byte and re-run.

- [ ] **Step 4: Commit**

```bash
git add docs ARCHITECTURE.md CLAUDE.md
git commit -m "docs: record the dtcg foundation profile and schema 5.1.0"
```

---

## After the plan

- Publish `spec-layer@0.4.0` only after the manual Figma matrix rows in `packages/plugin/TESTING.md` for foundation copy have been run against a development build. That matrix is the standing release blocker and this plan does not close it.
- The Neuron Token Sync repo is a second, manual gate: run `npx spec-layer pull` in a scratch checkout against a library published from the `Design System Variables` file with `"values": "legacy"`, point its `build/config.js` at the `tokens/` directory, and run `npm run tokens:build`. Green there means the format is real for at least one consumer that predates this work.
