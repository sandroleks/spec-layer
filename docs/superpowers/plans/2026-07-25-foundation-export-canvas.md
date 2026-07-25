# Foundation Export v1 — Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Figma file's local variable collections and text styles into a pure `FoundationSpec`, render them as link-tracked on-canvas documentation frames, and manage them in My Library.

**Architecture:** A Figma-free extractor module (`foundation.ts`) owns the data model, alias resolution, unit planning, row building, and hashing. A plugin-side dump builder (`serializeFoundation.ts`) reads Figma through an injected `FoundationReader`, matching the existing `serialize.ts` pattern. `foundationFrame.ts` renders rows to nodes using `frameKit.ts` primitives. `docLink.ts` gains a `kind`-discriminated union so foundation Sections join the existing registry, drift, and My Library machinery without touching component blobs.

**Tech Stack:** TypeScript, Vitest, Figma Plugin API (`@figma/plugin-typings`), esbuild, vanilla DOM plugin UI.

**Spec:** `docs/superpowers/specs/2026-07-25-foundation-export-design.md` — phases 1 through 4. Phases 5 (markdown + docs app) and 6 (AI usage notes) are a separate plan written after this one lands.

## Global Constraints

- **Branch:** `foundations-1.0`. Do not commit to `main`.
- **Tests live in `packages/<pkg>/test/*.test.ts`**, never colocated with source. This is enforced by `vitest.config.ts` `include`.
- **Run tests from the repo root:** `npx vitest run <path>`. There is no per-package test script.
- **`packages/plugin/src/main.ts` and `packages/plugin/src/ui/ui.ts` are excluded from coverage** — they are esbuild entry points and wiring. Put logic in testable modules, not in them.
- **Coverage thresholds are a ratchet that only moves up:** statements 45, branches 40, functions 50, lines 45. Never lower them.
- **Plugin UI copy follows `docs/plugin-voice-and-copy.md`:** plain, honest peer tone, and **never em dashes**. This applies to every user-visible string added in Tasks 7, 10, and 12–14.
- **`SPLIT_THRESHOLD = 150`, `MAX_MODE_COLUMNS = 4`** — named constants in `foundation.ts`, never inline literals.
- **`specContentHash` must not change.** Any diff to it is a bug in this plan.
- **Existing `DocLinkData` blobs carry no `kind` field** and must keep parsing byte-identically. Task 11 has an explicit regression test for this.
- **`npm run check` must pass** before each phase-ending commit. The `verify` CI job is expected red on `npm audit` per the standing Next 16.3.0 decision; that is unrelated to this work.
- Every value written into `FoundationSpec` that is not rendered stays out of the hash. `unitContent()` is the single source of rendered rows.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `packages/extractor/src/foundation.ts` | Types, `groupOf`, `buildFoundation`, alias resolution, `planFoundationUnits`, `unitContent` |
| `packages/extractor/test/foundation.ts` fixtures inline | Fixture builders live in the test file; no JSON fixture needed (the dump is small and hand-written) |
| `packages/extractor/test/foundation.test.ts` | Tasks 1–3 tests |
| `packages/extractor/test/foundationHash.test.ts` | Task 4 tests |
| `packages/plugin/src/serializeFoundation.ts` | `FoundationReader` interface + `serializeFoundation(reader)` |
| `packages/plugin/test/serializeFoundation.test.ts` | Task 5 tests, fake reader |
| `packages/plugin/src/foundationFrame.ts` | Row model → Figma nodes |
| `packages/plugin/src/ui/foundationState.ts` | Pure selection/summary model for the Foundations tab |
| `packages/plugin/test/foundationState.test.ts` | Task 7 tests |

**Modified:**

| Path | Change |
|---|---|
| `packages/extractor/src/hash.ts` | Add `foundationContentHash` |
| `packages/extractor/src/index.ts` | Export `./foundation` |
| `packages/plugin/src/messages.ts` | Foundation message variants, `LibraryEntry.kind` |
| `packages/plugin/src/docLink.ts` | `DocLinkData` union, `parseDocLink` branching |
| `packages/plugin/src/main.ts` | `FoundationReader` impl, foundation handlers, `requestLibrary` narrowing |
| `packages/plugin/src/ui/dom.ts` | Foundations tab markup + refs |
| `packages/plugin/src/ui/actions.ts` | Foundation action wiring |
| `packages/plugin/src/ui/render.ts` | Foundations panel + library row rendering |

---

## Task 1: Foundation types and non-alias value building

**Files:**
- Create: `packages/extractor/src/foundation.ts`
- Create: `packages/extractor/test/foundation.test.ts`
- Modify: `packages/extractor/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SerializedFoundation`, `RawCollection`, `RawVariable`, `RawTextStyle`, `RawExternalRef`, `RawVariableValue`, `FoundationSpec`, `FoundationCollection`, `FoundationVariable`, `FoundationTextStyle`, `FoundationValue`, `FoundationMode`, `FoundationScope`, `SPLIT_THRESHOLD`, `MAX_MODE_COLUMNS`, `groupOf(name)`, `buildFoundation(dump)`.

- [ ] **Step 1: Write the failing test**

Create `packages/extractor/test/foundation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFoundation, groupOf, type SerializedFoundation } from '../src/foundation';

/** Minimal dump with one single-mode collection holding one variable per type. */
function dumpOneOfEach(): SerializedFoundation {
  return {
    fileKey: 'FILE1',
    extractedAt: '2026-07-25T00:00:00.000Z',
    externals: [],
    textStyles: [],
    collections: [{
      id: 'c1',
      name: 'Primitives',
      defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Value' }],
      variables: [
        { id: 'v1', name: 'color/blue/500', resolvedType: 'COLOR', description: 'Brand blue.',
          codeSyntax: { WEB: '--blue-500' },
          valuesByMode: { m1: { r: 0.145, g: 0.388, b: 0.921, a: 1 } } },
        { id: 'v2', name: 'space/4', resolvedType: 'FLOAT', description: '',
          codeSyntax: {}, valuesByMode: { m1: 16 } },
        { id: 'v3', name: 'brand/name', resolvedType: 'STRING', description: '',
          codeSyntax: {}, valuesByMode: { m1: 'Acme' } },
        { id: 'v4', name: 'flags/beta', resolvedType: 'BOOLEAN', description: '',
          codeSyntax: {}, valuesByMode: { m1: true } },
        { id: 'v5', name: 'standalone', resolvedType: 'FLOAT', description: '',
          codeSyntax: {}, valuesByMode: { m1: 2 } },
      ],
    }],
  };
}

describe('groupOf', () => {
  it('takes the segment before the first slash', () => {
    expect(groupOf('color/bg/brand')).toBe('color');
  });
  it('returns the whole name when there is no slash', () => {
    expect(groupOf('standalone')).toBe('standalone');
  });
  it('handles a leading slash without producing an empty group', () => {
    expect(groupOf('/odd')).toBe('/odd');
  });
});

describe('buildFoundation — non-alias values', () => {
  it('carries file identity and collection shape through', () => {
    const spec = buildFoundation(dumpOneOfEach());
    expect(spec.fileKey).toBe('FILE1');
    expect(spec.extractedAt).toBe('2026-07-25T00:00:00.000Z');
    expect(spec.collections).toHaveLength(1);
    expect(spec.collections[0].name).toBe('Primitives');
    expect(spec.collections[0].modes).toEqual([{ modeId: 'm1', name: 'Value' }]);
    expect(spec.collections[0].defaultModeId).toBe('m1');
  });

  it('converts a color to hex plus alpha', () => {
    const spec = buildFoundation(dumpOneOfEach());
    const v = spec.collections[0].variables[0];
    expect(v.name).toBe('color/blue/500');
    expect(v.group).toBe('color');
    expect(v.description).toBe('Brand blue.');
    expect(v.codeSyntax).toEqual({ WEB: '--blue-500' });
    expect(v.valuesByMode.m1).toEqual({ kind: 'color', hex: '#2563eb', alpha: 1 });
  });

  it('preserves fractional alpha', () => {
    const dump = dumpOneOfEach();
    dump.collections[0].variables[0].valuesByMode.m1 = { r: 0, g: 0, b: 0, a: 0.5 };
    const spec = buildFoundation(dump);
    expect(spec.collections[0].variables[0].valuesByMode.m1)
      .toEqual({ kind: 'color', hex: '#000000', alpha: 0.5 });
  });

  it('converts number, string, and boolean values', () => {
    const spec = buildFoundation(dumpOneOfEach());
    const [, num, str, bool] = spec.collections[0].variables;
    expect(num.valuesByMode.m1).toEqual({ kind: 'number', value: 16 });
    expect(str.valuesByMode.m1).toEqual({ kind: 'string', value: 'Acme' });
    expect(bool.valuesByMode.m1).toEqual({ kind: 'boolean', value: true });
  });

  it('derives group for a name with no slash', () => {
    const spec = buildFoundation(dumpOneOfEach());
    expect(spec.collections[0].variables[4].group).toBe('standalone');
  });

  it('marks a mode with no value as missing rather than dropping the row', () => {
    const dump = dumpOneOfEach();
    dump.collections[0].modes.push({ modeId: 'm2', name: 'Other' });
    const spec = buildFoundation(dump);
    expect(spec.collections[0].variables[1].valuesByMode.m2)
      .toEqual({ kind: 'unresolved', reason: 'missing' });
  });

  it('builds text styles with group and full metrics', () => {
    const dump = dumpOneOfEach();
    dump.textStyles = [{
      name: 'Heading/XL', description: 'Page titles.',
      fontFamily: 'Inter', fontStyle: 'Bold', fontSize: 32,
      lineHeight: { unit: 'PIXELS', value: 40 },
      letterSpacing: { unit: 'PERCENT', value: -2 },
      paragraphSpacing: 0, paragraphIndent: 0,
      textCase: 'ORIGINAL', textDecoration: 'NONE',
      boundVariables: { fontSize: 'type/size/xl' },
    }];
    const spec = buildFoundation(dump);
    expect(spec.textStyles).toHaveLength(1);
    expect(spec.textStyles[0].group).toBe('Heading');
    expect(spec.textStyles[0].fontSize).toBe(32);
    expect(spec.textStyles[0].lineHeight).toEqual({ unit: 'PIXELS', value: 40 });
    expect(spec.textStyles[0].boundVariables).toEqual({ fontSize: 'type/size/xl' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/foundation.test.ts`
Expected: FAIL — `Failed to resolve import "../src/foundation"`.

- [ ] **Step 3: Write the implementation**

Create `packages/extractor/src/foundation.ts`:

```ts
/**
 * foundation.ts — the pure, Figma-free model for the file's design foundation:
 * variable collections (with modes and alias chains) and text styles.
 *
 * Mirrors the serialize.ts → extract.ts boundary used for components. The
 * plugin dumps raw Figma data (aliases left as {type,id}); everything here is
 * synchronous and fixture-testable, including alias resolution.
 */

// ---------------------------------------------------------------------------
// Raw dump — produced by packages/plugin/src/serializeFoundation.ts
// ---------------------------------------------------------------------------

export interface RawVariableAlias { type: 'VARIABLE_ALIAS'; id: string }
export interface RawRGBA { r: number; g: number; b: number; a: number }
export type RawVariableValue = RawRGBA | number | string | boolean | RawVariableAlias;

export type FoundationVariableType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';

export interface RawVariable {
  id: string;
  name: string;
  resolvedType: FoundationVariableType;
  description: string;
  codeSyntax: Record<string, string>;
  valuesByMode: Record<string, RawVariableValue>;
}

export interface RawCollection {
  id: string;
  name: string;
  modes: FoundationMode[];
  defaultModeId: string;
  variables: RawVariable[];
}

export interface RawTextStyle {
  name: string;
  description: string;
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  lineHeight: { unit: 'AUTO' | 'PIXELS' | 'PERCENT'; value?: number };
  letterSpacing: { unit: 'PIXELS' | 'PERCENT'; value: number };
  paragraphSpacing: number;
  paragraphIndent: number;
  textCase: string;
  textDecoration: string;
  boundVariables: Record<string, string>;
}

/** An alias target that lives in a library, not in this file's local dump. */
export interface RawExternalRef { id: string; name: string; collectionName: string }

export interface SerializedFoundation {
  fileKey: string;
  collections: RawCollection[];
  textStyles: RawTextStyle[];
  externals: RawExternalRef[];
  extractedAt: string;
}

// ---------------------------------------------------------------------------
// Resolved model
// ---------------------------------------------------------------------------

export interface FoundationMode { modeId: string; name: string }

export type FoundationValue =
  | { kind: 'color'; hex: string; alpha: number }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'alias'; targetName: string; targetCollection: string;
      external: boolean; resolved: FoundationValue | null }
  | { kind: 'unresolved'; reason: 'cycle' | 'missing' | 'external' | 'depth' };

export interface FoundationVariable {
  name: string;
  group: string;
  resolvedType: FoundationVariableType;
  description: string;
  codeSyntax: Record<string, string>;
  valuesByMode: Record<string, FoundationValue>;
}

export interface FoundationCollection {
  id: string;
  name: string;
  modes: FoundationMode[];
  defaultModeId: string;
  variables: FoundationVariable[];
}

export interface FoundationTextStyle extends RawTextStyle { group: string }

export interface FoundationSpec {
  fileKey: string;
  collections: FoundationCollection[];
  textStyles: FoundationTextStyle[];
  extractedAt: string;
}

export type FoundationScope =
  | { target: 'collection'; collectionId: string; collectionName: string;
      group?: string; modeIds: string[] }
  | { target: 'textStyles'; group?: string };

/** Rows per output unit, above which a unit splits by top-level group. */
export const SPLIT_THRESHOLD = 150;
/** Hard ceiling on rendered mode columns. */
export const MAX_MODE_COLUMNS = 4;
/** Alias chain depth ceiling, matching resolveVariableColor in tokenResolve.ts. */
const MAX_ALIAS_DEPTH = 4;

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/** Top-level path segment. "color/bg/brand" → "color"; "standalone" → itself. */
export function groupOf(name: string): string {
  const i = name.indexOf('/');
  return i <= 0 ? name : name.slice(0, i);
}

function hex2(n: number): string {
  return Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
}

function isAlias(v: RawVariableValue): v is RawVariableAlias {
  return typeof v === 'object' && v !== null && (v as RawVariableAlias).type === 'VARIABLE_ALIAS';
}

function isRgba(v: RawVariableValue): v is RawRGBA {
  return typeof v === 'object' && v !== null && 'r' in v;
}

/** Convert one non-alias raw value. Returns null when the shape is unusable. */
function plainValue(raw: RawVariableValue): FoundationValue | null {
  if (isRgba(raw)) {
    return { kind: 'color', hex: `#${hex2(raw.r)}${hex2(raw.g)}${hex2(raw.b)}`, alpha: raw.a };
  }
  if (typeof raw === 'number') return { kind: 'number', value: raw };
  if (typeof raw === 'string') return { kind: 'string', value: raw };
  if (typeof raw === 'boolean') return { kind: 'boolean', value: raw };
  return null;
}

interface VarIndexEntry { variable: RawVariable; collection: RawCollection }

function indexVariables(dump: SerializedFoundation): Map<string, VarIndexEntry> {
  const map = new Map<string, VarIndexEntry>();
  for (const collection of dump.collections) {
    for (const variable of collection.variables) {
      map.set(variable.id, { variable, collection });
    }
  }
  return map;
}

export function buildFoundation(dump: SerializedFoundation): FoundationSpec {
  const index = indexVariables(dump);
  const externals = new Map(dump.externals.map((e) => [e.id, e]));

  const collections: FoundationCollection[] = dump.collections.map((collection) => ({
    id: collection.id,
    name: collection.name,
    modes: collection.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
    defaultModeId: collection.defaultModeId,
    variables: collection.variables.map((variable) => {
      const valuesByMode: Record<string, FoundationValue> = {};
      for (const mode of collection.modes) {
        valuesByMode[mode.modeId] = resolveValue(
          variable.valuesByMode[mode.modeId], mode.name, index, externals, new Set([variable.id]), 0,
        );
      }
      return {
        name: variable.name,
        group: groupOf(variable.name),
        resolvedType: variable.resolvedType,
        description: variable.description,
        codeSyntax: variable.codeSyntax,
        valuesByMode,
      };
    }),
  }));

  return {
    fileKey: dump.fileKey,
    collections,
    textStyles: dump.textStyles.map((s) => ({ ...s, group: groupOf(s.name) })),
    extractedAt: dump.extractedAt,
  };
}

/** Placeholder in Task 1; Task 2 replaces the alias branch. */
function resolveValue(
  raw: RawVariableValue | undefined,
  _modeName: string,
  _index: Map<string, VarIndexEntry>,
  _externals: Map<string, RawExternalRef>,
  _seen: Set<string>,
  _depth: number,
): FoundationValue {
  if (raw === undefined) return { kind: 'unresolved', reason: 'missing' };
  const plain = plainValue(raw);
  if (plain) return plain;
  return { kind: 'unresolved', reason: 'missing' };
}
```

Add to `packages/extractor/src/index.ts`, after the `export * from './extract';` line:

```ts
export * from './foundation';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/foundation.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add packages/extractor/src/foundation.ts packages/extractor/src/index.ts packages/extractor/test/foundation.test.ts
git commit -m "feat(extractor): foundation model and non-alias value building"
```

---

## Task 2: Alias chain resolution

**Files:**
- Modify: `packages/extractor/src/foundation.ts` (replace `resolveValue`)
- Modify: `packages/extractor/test/foundation.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `buildFoundation`, `RawVariableValue`, `VarIndexEntry` index, `RawExternalRef` map from Task 1.
- Produces: no new exports. `FoundationValue` alias and unresolved variants become reachable.

Resolution rules, from the spec:
- Follow up to `MAX_ALIAS_DEPTH` (4) hops; exceeding it → `reason: 'depth'`.
- A variable id already on the current chain → `reason: 'cycle'`.
- Target absent locally but present in `externals` → `{ kind: 'alias', external: true, resolved: null }`.
- Target absent locally and absent from `externals` → `reason: 'missing'`.
- **Target mode selection:** the target collection's mode whose `name` equals the source mode's name, else the target collection's `defaultModeId`.

- [ ] **Step 1: Write the failing test**

Append to `packages/extractor/test/foundation.test.ts`:

```ts
/** Two collections: Primitives (single mode) and Semantic (Light/Dark) aliasing it. */
function dumpWithAliases(): SerializedFoundation {
  return {
    fileKey: 'FILE1',
    extractedAt: '2026-07-25T00:00:00.000Z',
    externals: [],
    textStyles: [],
    collections: [
      {
        id: 'c1', name: 'Primitives', defaultModeId: 'p1',
        modes: [{ modeId: 'p1', name: 'Value' }],
        variables: [
          { id: 'blue', name: 'color/blue/500', resolvedType: 'COLOR', description: '',
            codeSyntax: {}, valuesByMode: { p1: { r: 0, g: 0, b: 1, a: 1 } } },
          { id: 'navy', name: 'color/navy/900', resolvedType: 'COLOR', description: '',
            codeSyntax: {}, valuesByMode: { p1: { r: 0, g: 0, b: 0.2, a: 1 } } },
        ],
      },
      {
        id: 'c2', name: 'Semantic', defaultModeId: 's1',
        modes: [{ modeId: 's1', name: 'Light' }, { modeId: 's2', name: 'Dark' }],
        variables: [
          { id: 'bg', name: 'bg/brand', resolvedType: 'COLOR', description: '',
            codeSyntax: {}, valuesByMode: {
              s1: { type: 'VARIABLE_ALIAS', id: 'blue' },
              s2: { type: 'VARIABLE_ALIAS', id: 'navy' },
            } },
        ],
      },
    ],
  };
}

describe('buildFoundation — alias resolution', () => {
  it('resolves an alias to its target name, collection, and value', () => {
    const spec = buildFoundation(dumpWithAliases());
    const bg = spec.collections[1].variables[0];
    expect(bg.valuesByMode.s1).toEqual({
      kind: 'alias', targetName: 'color/blue/500', targetCollection: 'Primitives',
      external: false, resolved: { kind: 'color', hex: '#0000ff', alpha: 1 },
    });
  });

  it('follows a different target per mode', () => {
    const spec = buildFoundation(dumpWithAliases());
    const bg = spec.collections[1].variables[0];
    expect(bg.valuesByMode.s2).toMatchObject({ targetName: 'color/navy/900' });
  });

  it('prefers the target mode whose name matches the source mode name', () => {
    const dump = dumpWithAliases();
    // Give Primitives its own Light/Dark so name matching has something to do.
    dump.collections[0].modes = [{ modeId: 'p1', name: 'Light' }, { modeId: 'p2', name: 'Dark' }];
    dump.collections[0].variables[0].valuesByMode = {
      p1: { r: 0, g: 0, b: 1, a: 1 },
      p2: { r: 1, g: 1, b: 1, a: 1 },
    };
    dump.collections[1].variables[0].valuesByMode.s2 = { type: 'VARIABLE_ALIAS', id: 'blue' };
    const spec = buildFoundation(dump);
    const bg = spec.collections[1].variables[0];
    // Light → Light (#0000ff), Dark → Dark (#ffffff)
    expect(bg.valuesByMode.s1).toMatchObject({ resolved: { kind: 'color', hex: '#0000ff', alpha: 1 } });
    expect(bg.valuesByMode.s2).toMatchObject({ resolved: { kind: 'color', hex: '#ffffff', alpha: 1 } });
  });

  it('falls back to the target default mode when no name matches', () => {
    const spec = buildFoundation(dumpWithAliases());
    // Primitives has only "Value"; Semantic modes are Light/Dark. Default used.
    expect(spec.collections[1].variables[0].valuesByMode.s1)
      .toMatchObject({ resolved: { kind: 'color', hex: '#0000ff', alpha: 1 } });
  });

  it('follows a chain of three hops', () => {
    const dump = dumpWithAliases();
    dump.collections[0].variables.push(
      { id: 'mid', name: 'color/mid', resolvedType: 'COLOR', description: '',
        codeSyntax: {}, valuesByMode: { p1: { type: 'VARIABLE_ALIAS', id: 'blue' } } },
    );
    dump.collections[1].variables[0].valuesByMode.s1 = { type: 'VARIABLE_ALIAS', id: 'mid' };
    const spec = buildFoundation(dump);
    expect(spec.collections[1].variables[0].valuesByMode.s1).toEqual({
      kind: 'alias', targetName: 'color/mid', targetCollection: 'Primitives',
      external: false, resolved: { kind: 'color', hex: '#0000ff', alpha: 1 },
    });
  });

  it('reports a cycle instead of looping forever', () => {
    const dump = dumpWithAliases();
    dump.collections[0].variables[0].valuesByMode.p1 = { type: 'VARIABLE_ALIAS', id: 'navy' };
    dump.collections[0].variables[1].valuesByMode.p1 = { type: 'VARIABLE_ALIAS', id: 'blue' };
    const spec = buildFoundation(dump);
    expect(spec.collections[0].variables[0].valuesByMode.p1)
      .toMatchObject({ kind: 'alias', resolved: { kind: 'unresolved', reason: 'cycle' } });
  });

  it('reports depth overflow past four hops', () => {
    const dump = dumpWithAliases();
    // a → b → c → d → e → value: five hops, over MAX_ALIAS_DEPTH of 4.
    dump.collections[0].variables = [
      { id: 'a', name: 'a', resolvedType: 'COLOR', description: '', codeSyntax: {},
        valuesByMode: { p1: { type: 'VARIABLE_ALIAS', id: 'b' } } },
      { id: 'b', name: 'b', resolvedType: 'COLOR', description: '', codeSyntax: {},
        valuesByMode: { p1: { type: 'VARIABLE_ALIAS', id: 'c' } } },
      { id: 'c', name: 'c', resolvedType: 'COLOR', description: '', codeSyntax: {},
        valuesByMode: { p1: { type: 'VARIABLE_ALIAS', id: 'd' } } },
      { id: 'd', name: 'd', resolvedType: 'COLOR', description: '', codeSyntax: {},
        valuesByMode: { p1: { type: 'VARIABLE_ALIAS', id: 'e' } } },
      { id: 'e', name: 'e', resolvedType: 'COLOR', description: '', codeSyntax: {},
        valuesByMode: { p1: { r: 1, g: 0, b: 0, a: 1 } } },
    ];
    dump.collections[1].variables[0].valuesByMode.s1 = { type: 'VARIABLE_ALIAS', id: 'a' };
    const spec = buildFoundation(dump);
    const value = spec.collections[1].variables[0].valuesByMode.s1;
    expect(value).toMatchObject({ kind: 'alias', targetName: 'a' });
    expect(JSON.stringify(value)).toContain('"reason":"depth"');
  });

  it('marks a library target as external with a real name and no value', () => {
    const dump = dumpWithAliases();
    dump.externals = [{ id: 'lib1', name: 'core/blue/500', collectionName: 'Core Library' }];
    dump.collections[1].variables[0].valuesByMode.s1 = { type: 'VARIABLE_ALIAS', id: 'lib1' };
    const spec = buildFoundation(dump);
    expect(spec.collections[1].variables[0].valuesByMode.s1).toEqual({
      kind: 'alias', targetName: 'core/blue/500', targetCollection: 'Core Library',
      external: true, resolved: null,
    });
  });

  it('reports a dangling target as missing', () => {
    const dump = dumpWithAliases();
    dump.collections[1].variables[0].valuesByMode.s1 = { type: 'VARIABLE_ALIAS', id: 'ghost' };
    const spec = buildFoundation(dump);
    expect(spec.collections[1].variables[0].valuesByMode.s1)
      .toEqual({ kind: 'unresolved', reason: 'missing' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/foundation.test.ts`
Expected: FAIL — the new alias tests fail; the Task 1 tests still pass. The first failure reads roughly `expected { kind: 'unresolved', reason: 'missing' } to deeply equal { kind: 'alias', … }`.

- [ ] **Step 3: Write the implementation**

In `packages/extractor/src/foundation.ts`, replace the whole placeholder `resolveValue` function from Task 1 with:

```ts
/** Pick the target collection's mode id: name match on the source mode, else default. */
function targetModeId(collection: RawCollection, sourceModeName: string): string {
  const named = collection.modes.find((m) => m.name === sourceModeName);
  return named ? named.modeId : collection.defaultModeId;
}

function resolveValue(
  raw: RawVariableValue | undefined,
  modeName: string,
  index: Map<string, VarIndexEntry>,
  externals: Map<string, RawExternalRef>,
  seen: Set<string>,
  depth: number,
): FoundationValue {
  if (raw === undefined) return { kind: 'unresolved', reason: 'missing' };

  if (!isAlias(raw)) {
    const plain = plainValue(raw);
    return plain ?? { kind: 'unresolved', reason: 'missing' };
  }

  const local = index.get(raw.id);

  if (!local) {
    const ext = externals.get(raw.id);
    if (!ext) return { kind: 'unresolved', reason: 'missing' };
    return {
      kind: 'alias', targetName: ext.name, targetCollection: ext.collectionName,
      external: true, resolved: null,
    };
  }

  const head = {
    kind: 'alias' as const,
    targetName: local.variable.name,
    targetCollection: local.collection.name,
    external: false,
  };

  if (seen.has(raw.id)) return { ...head, resolved: { kind: 'unresolved', reason: 'cycle' } };
  // `depth >= MAX` and NOT `depth + 1 >= MAX`: the guard is evaluated while
  // examining a link, before its target is read, so `depth + 1` refuses the
  // 4th link after only 3 hops completed. Admit 4 hops, refuse the 5th, which
  // matches resolveVariableColor's `depth > 4` in tokenResolve.ts.
  if (depth >= MAX_ALIAS_DEPTH) return { ...head, resolved: { kind: 'unresolved', reason: 'depth' } };

  const nextModeId = targetModeId(local.collection, modeName);
  const nextModeName = local.collection.modes.find((m) => m.modeId === nextModeId)?.name ?? modeName;
  const inner = resolveValue(
    local.variable.valuesByMode[nextModeId], nextModeName, index, externals,
    new Set([...seen, raw.id]), depth + 1,
  );

  // Collapse a chain to one visible hop: the reader sees the immediate target
  // name and the final value. Intermediate hops are an implementation detail of
  // the file's own indirection, not something the doc should enumerate.
  const resolved = inner.kind === 'alias' ? inner.resolved : inner;
  return { ...head, resolved };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/foundation.test.ts`
Expected: PASS, 19 tests.

Note the depth test asserts `"reason":"depth"` appears somewhere in the serialized value rather than at a fixed nesting level, because chain collapsing may surface it at either the head or an inner position depending on where the ceiling is hit.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add packages/extractor/src/foundation.ts packages/extractor/test/foundation.test.ts
git commit -m "feat(extractor): resolve foundation alias chains with cycle, depth, and external handling"
```

---

## Task 3: Unit planning, mode capping, and row building

**Files:**
- Modify: `packages/extractor/src/foundation.ts`
- Modify: `packages/extractor/test/foundation.test.ts`

**Interfaces:**
- Consumes: `FoundationSpec`, `FoundationScope`, `SPLIT_THRESHOLD`, `MAX_MODE_COLUMNS` from Tasks 1–2.
- Produces: `FoundationSelection`, `FoundationUnit`, `FoundationRow`, `FoundationVariableRow`, `FoundationTextRow`, `FoundationUnitContent`, `planFoundationUnits(spec, selection)`, `unitContent(spec, scope)`.

`unitContent` is the single source of rendered rows: Task 4's hash, Task 8's canvas renderer, and the later markdown renderer all consume it. Nothing may render a value that does not come through it.

- [ ] **Step 1: Write the failing test**

Append to `packages/extractor/test/foundation.test.ts`:

```ts
import {
  planFoundationUnits, unitContent, SPLIT_THRESHOLD, MAX_MODE_COLUMNS,
  type FoundationSelection,
} from '../src/foundation';

/** A collection with `count` COLOR variables spread over the given groups. */
function bigDump(count: number, groups: string[]): SerializedFoundation {
  const variables = Array.from({ length: count }, (_, i) => ({
    id: `v${i}`,
    name: `${groups[i % groups.length]}/item${i}`,
    resolvedType: 'COLOR' as const,
    description: '',
    codeSyntax: {},
    valuesByMode: { m1: { r: 0, g: 0, b: 0, a: 1 } },
  }));
  return {
    fileKey: 'FILE1', extractedAt: '2026-07-25T00:00:00.000Z', externals: [], textStyles: [],
    collections: [{
      id: 'c1', name: 'Primitives', defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Value' }],
      variables,
    }],
  };
}

const allOf = (dump: SerializedFoundation): FoundationSelection => ({
  collections: dump.collections.map((c) => ({
    collectionId: c.id, modeIds: c.modes.map((m) => m.modeId),
  })),
  textStyles: dump.textStyles.length > 0,
});

describe('planFoundationUnits', () => {
  it('produces one unit for a collection at the threshold', () => {
    const dump = bigDump(SPLIT_THRESHOLD, ['color']);
    const spec = buildFoundation(dump);
    const units = planFoundationUnits(spec, allOf(dump));
    expect(units).toHaveLength(1);
    expect(units[0].title).toBe('Primitives');
    expect(units[0].rowCount).toBe(SPLIT_THRESHOLD);
    expect(units[0].scope).toEqual({
      target: 'collection', collectionId: 'c1', collectionName: 'Primitives', modeIds: ['m1'],
    });
  });

  it('splits by top-level group past the threshold', () => {
    const dump = bigDump(SPLIT_THRESHOLD + 1, ['color', 'space']);
    const spec = buildFoundation(dump);
    const units = planFoundationUnits(spec, allOf(dump));
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.title)).toEqual(['Primitives · color', 'Primitives · space']);
    expect(units.reduce((n, u) => n + u.rowCount, 0)).toBe(SPLIT_THRESHOLD + 1);
    expect(units[0].scope).toMatchObject({ group: 'color' });
  });

  it('leaves a single-group oversized collection as one tall unit', () => {
    const dump = bigDump(SPLIT_THRESHOLD + 50, ['color']);
    const units = planFoundationUnits(buildFoundation(dump), allOf(dump));
    expect(units).toHaveLength(1);
    expect(units[0].rowCount).toBe(SPLIT_THRESHOLD + 50);
  });

  it('orders split groups by first appearance, stably', () => {
    const dump = bigDump(SPLIT_THRESHOLD + 3, ['radius', 'color', 'space']);
    const units = planFoundationUnits(buildFoundation(dump), allOf(dump));
    expect(units.map((u) => u.title))
      .toEqual(['Primitives · radius', 'Primitives · color', 'Primitives · space']);
  });

  it('omits unselected collections', () => {
    const dump = bigDump(3, ['color']);
    const units = planFoundationUnits(buildFoundation(dump), { collections: [], textStyles: false });
    expect(units).toEqual([]);
  });

  it('caps mode columns and reports the omitted mode names', () => {
    const dump = bigDump(3, ['color']);
    dump.collections[0].modes = ['A', 'B', 'C', 'D', 'E', 'F']
      .map((name, i) => ({ modeId: `m${i}`, name }));
    dump.collections[0].defaultModeId = 'm0';
    for (const v of dump.collections[0].variables) {
      v.valuesByMode = Object.fromEntries(
        dump.collections[0].modes.map((m) => [m.modeId, { r: 0, g: 0, b: 0, a: 1 }]),
      );
    }
    const units = planFoundationUnits(buildFoundation(dump), allOf(dump));
    expect(units[0].scope).toMatchObject({ modeIds: ['m0', 'm1', 'm2', 'm3'] });
    expect(units[0].omittedModeNames).toEqual(['E', 'F']);
    expect(units[0].scope.target === 'collection' && units[0].scope.modeIds.length)
      .toBe(MAX_MODE_COLUMNS);
  });

  it('honors an explicit mode selection over collection order', () => {
    const dump = bigDump(3, ['color']);
    dump.collections[0].modes = ['A', 'B', 'C'].map((name, i) => ({ modeId: `m${i}`, name }));
    dump.collections[0].defaultModeId = 'm0';
    const units = planFoundationUnits(buildFoundation(dump), {
      collections: [{ collectionId: 'c1', modeIds: ['m2'] }], textStyles: false,
    });
    expect(units[0].scope).toMatchObject({ modeIds: ['m2'] });
    expect(units[0].omittedModeNames).toEqual(['A', 'B']);
  });

  it('adds a text styles unit when selected', () => {
    const dump = bigDump(1, ['color']);
    dump.textStyles = [{
      name: 'Body/M', description: '', fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
      lineHeight: { unit: 'PIXELS', value: 24 }, letterSpacing: { unit: 'PERCENT', value: 0 },
      paragraphSpacing: 0, paragraphIndent: 0, textCase: 'ORIGINAL', textDecoration: 'NONE',
      boundVariables: {},
    }];
    const units = planFoundationUnits(buildFoundation(dump), allOf(dump));
    expect(units.map((u) => u.title)).toEqual(['Primitives', 'Text styles']);
    expect(units[1].scope).toEqual({ target: 'textStyles' });
  });
});

describe('unitContent', () => {
  it('builds variable rows with one cell per included mode, keyed by mode name', () => {
    const dump = dumpWithAliases();
    const spec = buildFoundation(dump);
    const content = unitContent(spec, {
      target: 'collection', collectionId: 'c2', collectionName: 'Semantic', modeIds: ['s1', 's2'],
    });
    expect(content).not.toBeNull();
    expect(content!.modeNames).toEqual(['Light', 'Dark']);
    expect(content!.rows).toHaveLength(1);
    const row = content!.rows[0];
    expect(row.kind).toBe('variable');
    expect(row.kind === 'variable' && row.name).toBe('bg/brand');
    expect(row.kind === 'variable' && row.cells.map((c) => c.modeName)).toEqual(['Light', 'Dark']);
  });

  it('filters rows to the scope group', () => {
    const dump = bigDump(SPLIT_THRESHOLD + 2, ['color', 'space']);
    const spec = buildFoundation(dump);
    const content = unitContent(spec, {
      target: 'collection', collectionId: 'c1', collectionName: 'Primitives',
      group: 'space', modeIds: ['m1'],
    });
    expect(content!.rows.every((r) => r.kind === 'variable' && r.name.startsWith('space/'))).toBe(true);
  });

  it('drops mode ids that no longer exist', () => {
    const spec = buildFoundation(dumpWithAliases());
    const content = unitContent(spec, {
      target: 'collection', collectionId: 'c2', collectionName: 'Semantic',
      modeIds: ['s1', 'gone'],
    });
    expect(content!.modeNames).toEqual(['Light']);
  });

  it('returns null for a collection that is gone', () => {
    const spec = buildFoundation(dumpWithAliases());
    expect(unitContent(spec, {
      target: 'collection', collectionId: 'nope', collectionName: 'Nope', modeIds: [],
    })).toBeNull();
  });

  it('builds text style rows with metrics', () => {
    const dump = bigDump(1, ['color']);
    dump.textStyles = [{
      name: 'Body/M', description: 'Default body.', fontFamily: 'Inter', fontStyle: 'Regular',
      fontSize: 16, lineHeight: { unit: 'PIXELS', value: 24 },
      letterSpacing: { unit: 'PERCENT', value: 0 }, paragraphSpacing: 8, paragraphIndent: 0,
      textCase: 'ORIGINAL', textDecoration: 'NONE', boundVariables: { fontSize: 'type/md' },
    }];
    const content = unitContent(buildFoundation(dump), { target: 'textStyles' });
    expect(content!.modeNames).toEqual([]);
    expect(content!.rows[0]).toEqual({
      kind: 'textStyle', name: 'Body/M', description: 'Default body.',
      metrics: {
        fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
        lineHeight: { unit: 'PIXELS', value: 24 },
        letterSpacing: { unit: 'PERCENT', value: 0 },
        paragraphSpacing: 8, paragraphIndent: 0,
        textCase: 'ORIGINAL', textDecoration: 'NONE',
      },
      boundVariables: { fontSize: 'type/md' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/foundation.test.ts`
Expected: FAIL — `planFoundationUnits is not a function` / `unitContent is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `packages/extractor/src/foundation.ts`:

```ts
// ---------------------------------------------------------------------------
// Unit planning
// ---------------------------------------------------------------------------

export interface FoundationSelection {
  /** Collections the user chose, with the mode ids they chose for each. */
  collections: { collectionId: string; modeIds: string[] }[];
  textStyles: boolean;
}

export interface FoundationUnit {
  scope: FoundationScope;
  /** Frame/document title: "Semantic", "Primitives · color", "Text styles". */
  title: string;
  rowCount: number;
  /** Mode names present in the collection but not rendered, for the footer note. */
  omittedModeNames: string[];
}

/** Distinct top-level groups in first-appearance order. */
function groupsInOrder(names: string[]): string[] {
  const seen: string[] = [];
  for (const name of names) {
    const g = groupOf(name);
    if (!seen.includes(g)) seen.push(g);
  }
  return seen;
}

export function planFoundationUnits(
  spec: FoundationSpec, selection: FoundationSelection,
): FoundationUnit[] {
  const units: FoundationUnit[] = [];

  for (const chosen of selection.collections) {
    const collection = spec.collections.find((c) => c.id === chosen.collectionId);
    if (!collection) continue;

    const requested = chosen.modeIds.filter((id) => collection.modes.some((m) => m.modeId === id));
    const source = requested.length > 0 ? requested : collection.modes.map((m) => m.modeId);
    const modeIds = source.slice(0, MAX_MODE_COLUMNS);
    const omittedModeNames = collection.modes
      .filter((m) => !modeIds.includes(m.modeId))
      .map((m) => m.name);

    const base = {
      target: 'collection' as const,
      collectionId: collection.id,
      collectionName: collection.name,
      modeIds,
    };

    if (collection.variables.length <= SPLIT_THRESHOLD) {
      units.push({
        scope: base, title: collection.name,
        rowCount: collection.variables.length, omittedModeNames,
      });
      continue;
    }

    const groups = groupsInOrder(collection.variables.map((v) => v.name));
    if (groups.length <= 1) {
      // Cannot split further. One tall frame is the faithful outcome.
      units.push({
        scope: base, title: collection.name,
        rowCount: collection.variables.length, omittedModeNames,
      });
      continue;
    }

    for (const group of groups) {
      units.push({
        scope: { ...base, group },
        title: `${collection.name} · ${group}`,
        rowCount: collection.variables.filter((v) => v.group === group).length,
        omittedModeNames,
      });
    }
  }

  if (selection.textStyles && spec.textStyles.length > 0) {
    if (spec.textStyles.length <= SPLIT_THRESHOLD) {
      units.push({
        scope: { target: 'textStyles' }, title: 'Text styles',
        rowCount: spec.textStyles.length, omittedModeNames: [],
      });
    } else {
      for (const group of groupsInOrder(spec.textStyles.map((s) => s.name))) {
        units.push({
          scope: { target: 'textStyles', group },
          title: `Text styles · ${group}`,
          rowCount: spec.textStyles.filter((s) => s.group === group).length,
          omittedModeNames: [],
        });
      }
    }
  }

  return units;
}

// ---------------------------------------------------------------------------
// Row building — the single source of rendered content
// ---------------------------------------------------------------------------

export interface FoundationRowCell { modeName: string; value: FoundationValue }

export interface FoundationVariableRow {
  kind: 'variable';
  name: string;
  resolvedType: FoundationVariableType;
  description: string;
  cells: FoundationRowCell[];
}

export interface FoundationTextMetrics {
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  lineHeight: RawTextStyle['lineHeight'];
  letterSpacing: RawTextStyle['letterSpacing'];
  paragraphSpacing: number;
  paragraphIndent: number;
  textCase: string;
  textDecoration: string;
}

export interface FoundationTextRow {
  kind: 'textStyle';
  name: string;
  description: string;
  metrics: FoundationTextMetrics;
  boundVariables: Record<string, string>;
}

export type FoundationRow = FoundationVariableRow | FoundationTextRow;

export interface FoundationUnitContent {
  collectionName: string;   // '' for the text-styles unit
  group?: string;
  modeNames: string[];
  rows: FoundationRow[];
}

/**
 * The rows and mode columns for one output unit. Every renderer AND the drift
 * hash consume this, which is what mechanically guarantees "the hash covers
 * exactly what is rendered". Returns null when the scope's source is gone.
 */
export function unitContent(
  spec: FoundationSpec, scope: FoundationScope,
): FoundationUnitContent | null {
  if (scope.target === 'textStyles') {
    const styles = scope.group
      ? spec.textStyles.filter((s) => s.group === scope.group)
      : spec.textStyles;
    return {
      collectionName: '',
      ...(scope.group ? { group: scope.group } : {}),
      modeNames: [],
      rows: styles.map((s): FoundationTextRow => ({
        kind: 'textStyle',
        name: s.name,
        description: s.description,
        metrics: {
          fontFamily: s.fontFamily, fontStyle: s.fontStyle, fontSize: s.fontSize,
          lineHeight: s.lineHeight, letterSpacing: s.letterSpacing,
          paragraphSpacing: s.paragraphSpacing, paragraphIndent: s.paragraphIndent,
          textCase: s.textCase, textDecoration: s.textDecoration,
        },
        boundVariables: s.boundVariables,
      })),
    };
  }

  const collection = spec.collections.find((c) => c.id === scope.collectionId);
  if (!collection) return null;

  // Drop stale mode ids so a deleted mode narrows the table instead of
  // producing a blank column.
  const modes = scope.modeIds
    .map((id) => collection.modes.find((m) => m.modeId === id))
    .filter((m): m is FoundationMode => m !== undefined);

  const variables = scope.group
    ? collection.variables.filter((v) => v.group === scope.group)
    : collection.variables;

  return {
    collectionName: collection.name,
    ...(scope.group ? { group: scope.group } : {}),
    modeNames: modes.map((m) => m.name),
    rows: variables.map((v): FoundationVariableRow => ({
      kind: 'variable',
      name: v.name,
      resolvedType: v.resolvedType,
      description: v.description,
      cells: modes.map((m) => ({
        modeName: m.name,
        value: v.valuesByMode[m.modeId] ?? { kind: 'unresolved', reason: 'missing' },
      })),
    })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/foundation.test.ts`
Expected: PASS, 32 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add packages/extractor/src/foundation.ts packages/extractor/test/foundation.test.ts
git commit -m "feat(extractor): plan foundation units and build rendered rows"
```

---

## Task 4: Per-scope content hash

**Files:**
- Modify: `packages/extractor/src/hash.ts`
- Create: `packages/extractor/test/foundationHash.test.ts`

**Interfaces:**
- Consumes: `unitContent`, `FoundationSpec`, `FoundationScope` from Task 3; existing `contentHash` from `hash.ts`.
- Produces: `foundationContentHash(spec, scope): string`.

Hashed: `collectionName`, `group`, `modeNames`, `rows`. Excluded: all ids, `extractedAt`, `fileKey`, and anything extracted but unrendered. Because the hash reads `unitContent`'s output directly, exclusion is structural rather than a hand-maintained list.

- [ ] **Step 1: Write the failing test**

Create `packages/extractor/test/foundationHash.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFoundation, type SerializedFoundation, type FoundationScope } from '../src/foundation';
import { foundationContentHash } from '../src/hash';

function dump(): SerializedFoundation {
  return {
    fileKey: 'FILE1', extractedAt: '2026-07-25T00:00:00.000Z', externals: [], textStyles: [],
    collections: [
      {
        id: 'c1', name: 'Semantic', defaultModeId: 's1',
        modes: [{ modeId: 's1', name: 'Light' }, { modeId: 's2', name: 'Dark' }],
        variables: [
          { id: 'bg', name: 'bg/brand', resolvedType: 'COLOR', description: 'Brand fill.',
            codeSyntax: {}, valuesByMode: {
              s1: { r: 0.145, g: 0.388, b: 0.921, a: 1 },
              s2: { r: 0.231, g: 0.510, b: 0.965, a: 1 },
            } },
        ],
      },
      {
        id: 'c2', name: 'Other', defaultModeId: 'o1',
        modes: [{ modeId: 'o1', name: 'Value' }],
        variables: [
          { id: 'x', name: 'x/y', resolvedType: 'FLOAT', description: '',
            codeSyntax: {}, valuesByMode: { o1: 4 } },
        ],
      },
    ],
  };
}

const SEMANTIC: FoundationScope = {
  target: 'collection', collectionId: 'c1', collectionName: 'Semantic', modeIds: ['s1', 's2'],
};
const OTHER: FoundationScope = {
  target: 'collection', collectionId: 'c2', collectionName: 'Other', modeIds: ['o1'],
};

const hashOf = (d: SerializedFoundation, scope: FoundationScope = SEMANTIC) =>
  foundationContentHash(buildFoundation(d), scope);

describe('foundationContentHash', () => {
  it('is stable across re-extraction of identical data', () => {
    expect(hashOf(dump())).toBe(hashOf(dump()));
  });

  it('ignores extractedAt', () => {
    const d = dump();
    d.extractedAt = '2030-01-01T00:00:00.000Z';
    expect(hashOf(d)).toBe(hashOf(dump()));
  });

  it('ignores collection and variable ids', () => {
    const d = dump();
    d.collections[0].id = 'renamed-id';
    d.collections[0].variables[0].id = 'other-id';
    const scope: FoundationScope = { ...SEMANTIC, collectionId: 'renamed-id' };
    expect(foundationContentHash(buildFoundation(d), scope)).toBe(hashOf(dump()));
  });

  it('ignores mode ids but not mode names', () => {
    const idsChanged = dump();
    idsChanged.collections[0].modes = [{ modeId: 'z1', name: 'Light' }, { modeId: 'z2', name: 'Dark' }];
    idsChanged.collections[0].defaultModeId = 'z1';
    idsChanged.collections[0].variables[0].valuesByMode = {
      z1: { r: 0.145, g: 0.388, b: 0.921, a: 1 },
      z2: { r: 0.231, g: 0.510, b: 0.965, a: 1 },
    };
    expect(foundationContentHash(buildFoundation(idsChanged), { ...SEMANTIC, modeIds: ['z1', 'z2'] }))
      .toBe(hashOf(dump()));

    const renamed = dump();
    renamed.collections[0].modes[1].name = 'Night';
    expect(hashOf(renamed)).not.toBe(hashOf(dump()));
  });

  it('changes when a variable is renamed', () => {
    const d = dump();
    d.collections[0].variables[0].name = 'bg/primary';
    expect(hashOf(d)).not.toBe(hashOf(dump()));
  });

  it('changes when a value changes', () => {
    const d = dump();
    d.collections[0].variables[0].valuesByMode.s2 = { r: 1, g: 0, b: 0, a: 1 };
    expect(hashOf(d)).not.toBe(hashOf(dump()));
  });

  it('changes when a variable is added', () => {
    const d = dump();
    d.collections[0].variables.push({
      id: 'new', name: 'bg/subtle', resolvedType: 'COLOR', description: '',
      codeSyntax: {}, valuesByMode: { s1: { r: 1, g: 1, b: 1, a: 1 }, s2: { r: 0, g: 0, b: 0, a: 1 } },
    });
    expect(hashOf(d)).not.toBe(hashOf(dump()));
  });

  it('changes when a description changes', () => {
    const d = dump();
    d.collections[0].variables[0].description = 'Different.';
    expect(hashOf(d)).not.toBe(hashOf(dump()));
  });

  it('changes when the collection is renamed', () => {
    const d = dump();
    d.collections[0].name = 'Tokens';
    expect(foundationContentHash(buildFoundation(d), { ...SEMANTIC, collectionName: 'Tokens' }))
      .not.toBe(hashOf(dump()));
  });

  it('isolates scopes: editing collection c2 leaves c1 unchanged', () => {
    const d = dump();
    d.collections[1].variables[0].valuesByMode.o1 = 999;
    expect(hashOf(d, SEMANTIC)).toBe(hashOf(dump(), SEMANTIC));
    expect(hashOf(d, OTHER)).not.toBe(hashOf(dump(), OTHER));
  });

  it('differs between a group-scoped unit and the whole collection', () => {
    const d = dump();
    d.collections[0].variables.push({
      id: 'text', name: 'text/default', resolvedType: 'COLOR', description: '',
      codeSyntax: {}, valuesByMode: { s1: { r: 0, g: 0, b: 0, a: 1 }, s2: { r: 1, g: 1, b: 1, a: 1 } },
    });
    const whole = hashOf(d, SEMANTIC);
    const scoped = hashOf(d, { ...SEMANTIC, group: 'bg' });
    expect(scoped).not.toBe(whole);
  });

  it('returns a stable sentinel when the scope source is gone', () => {
    const gone: FoundationScope = {
      target: 'collection', collectionId: 'deleted', collectionName: 'Deleted', modeIds: [],
    };
    expect(hashOf(dump(), gone)).toBe(hashOf(dump(), gone));
    expect(hashOf(dump(), gone)).not.toBe(hashOf(dump(), SEMANTIC));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/foundationHash.test.ts`
Expected: FAIL — `foundationContentHash is not exported by ../src/hash`.

- [ ] **Step 3: Write the implementation**

Append to `packages/extractor/src/hash.ts`:

```ts
import { unitContent, type FoundationSpec, type FoundationScope } from './foundation';

/**
 * The drift baseline for one foundation output unit.
 *
 * Hashes exactly what unitContent() renders — collection name, group, mode
 * names, and rows — so "update available" always corresponds to a visible
 * change. Ids, extractedAt, fileKey, and anything extracted but unrendered are
 * excluded structurally: they are simply not in unitContent's output.
 *
 * A scope whose source no longer exists hashes a stable sentinel rather than
 * throwing, so a stale link resolves to a comparable value.
 */
export function foundationContentHash(spec: FoundationSpec, scope: FoundationScope): string {
  const content = unitContent(spec, scope);
  if (!content) return contentHash({ foundationUnit: null });
  return contentHash({
    collectionName: content.collectionName,
    group: content.group,
    modeNames: content.modeNames,
    rows: content.rows,
  });
}
```

The `import` goes at the top of the file with the existing imports, not inline.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/extractor/test/foundationHash.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Verify `specContentHash` is untouched**

Run: `npx vitest run packages/extractor packages/plugin`
Expected: PASS. Every pre-existing test still passes, which is the guard that component hashing did not move.

- [ ] **Step 6: Commit — phase 1 complete**

```bash
npm run check
git add packages/extractor/src/hash.ts packages/extractor/test/foundationHash.test.ts
git commit -m "feat(extractor): per-scope foundation content hash"
```

---

## Task 5: Figma dump builder

**Files:**
- Create: `packages/plugin/src/serializeFoundation.ts`
- Create: `packages/plugin/test/serializeFoundation.test.ts`

**Interfaces:**
- Consumes: `SerializedFoundation`, `RawCollection`, `RawVariable`, `RawTextStyle`, `RawExternalRef`, `RawVariableValue` from `@spec-layer/extractor`.
- Produces: `FoundationReader` interface, `serializeFoundation(reader, fileKey, now): Promise<SerializedFoundation>`.

Follows the injected-resolver pattern from `serialize.ts`: no Figma globals here, so `main.ts` supplies the real implementation and tests supply a fake.

`now` is injected rather than calling `Date.now()` inside, so `extractedAt` is deterministic under test.

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/serializeFoundation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serializeFoundation, type FoundationReader, type ReaderVariable } from '../src/serializeFoundation';

function fakeReader(over: Partial<FoundationReader> = {}): FoundationReader {
  const vars: Record<string, ReaderVariable> = {
    v1: {
      id: 'v1', name: 'color/blue/500', resolvedType: 'COLOR', description: 'Blue.',
      variableCollectionId: 'c1', codeSyntax: { WEB: '--blue' },
      valuesByMode: { m1: { r: 0, g: 0, b: 1, a: 1 } },
    },
    v2: {
      id: 'v2', name: 'bg/brand', resolvedType: 'COLOR', description: '',
      variableCollectionId: 'c1', codeSyntax: {},
      valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'v1' } },
    },
  };
  return {
    async collections() {
      return [{
        id: 'c1', name: 'Primitives',
        modes: [{ modeId: 'm1', name: 'Value' }],
        defaultModeId: 'm1',
        variableIds: ['v1', 'v2'],
      }];
    },
    async variable(id) { return vars[id] ?? null; },
    async textStyles() {
      return [{
        name: 'Body/M', description: 'Body.',
        fontName: { family: 'Inter', style: 'Regular' }, fontSize: 16,
        lineHeight: { unit: 'PIXELS', value: 24 },
        letterSpacing: { unit: 'PERCENT', value: 0 },
        paragraphSpacing: 0, paragraphIndent: 0,
        textCase: 'ORIGINAL', textDecoration: 'NONE',
        boundVariables: { fontSize: { id: 'v1' } },
      }];
    },
    ...over,
  };
}

describe('serializeFoundation', () => {
  it('dumps collections, variables, and text styles', async () => {
    const dump = await serializeFoundation(fakeReader(), 'FILE1', '2026-07-25T00:00:00.000Z');
    expect(dump.fileKey).toBe('FILE1');
    expect(dump.extractedAt).toBe('2026-07-25T00:00:00.000Z');
    expect(dump.collections).toHaveLength(1);
    expect(dump.collections[0].variables.map((v) => v.name))
      .toEqual(['color/blue/500', 'bg/brand']);
    expect(dump.collections[0].variables[0].codeSyntax).toEqual({ WEB: '--blue' });
    expect(dump.textStyles[0]).toMatchObject({
      name: 'Body/M', fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
    });
  });

  it('resolves a text style bound variable id to its name', async () => {
    const dump = await serializeFoundation(fakeReader(), 'FILE1', 'T');
    expect(dump.textStyles[0].boundVariables).toEqual({ fontSize: 'color/blue/500' });
  });

  it('keeps aliases raw for the extractor to resolve', async () => {
    const dump = await serializeFoundation(fakeReader(), 'FILE1', 'T');
    expect(dump.collections[0].variables[1].valuesByMode.m1)
      .toEqual({ type: 'VARIABLE_ALIAS', id: 'v1' });
  });

  it('records an alias target that is not local as an external ref', async () => {
    const reader = fakeReader({
      async variable(id) {
        if (id === 'v1') {
          return {
            id: 'v1', name: 'x', resolvedType: 'COLOR', description: '',
            variableCollectionId: 'c1', codeSyntax: {},
            valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'remote' } },
          };
        }
        if (id === 'v2') return null;
        if (id === 'remote') {
          return {
            id: 'remote', name: 'core/blue', resolvedType: 'COLOR', description: '',
            variableCollectionId: 'remoteColl', codeSyntax: {}, valuesByMode: {},
          };
        }
        return null;
      },
      async collectionName(id) { return id === 'remoteColl' ? 'Core Library' : null; },
    });
    const dump = await serializeFoundation(reader, 'FILE1', 'T');
    expect(dump.externals).toEqual([
      { id: 'remote', name: 'core/blue', collectionName: 'Core Library' },
    ]);
  });

  it('does not list a local variable as external', async () => {
    const dump = await serializeFoundation(fakeReader(), 'FILE1', 'T');
    expect(dump.externals).toEqual([]);
  });

  it('skips variable ids the reader cannot resolve instead of throwing', async () => {
    const reader = fakeReader({ async variable() { return null; } });
    const dump = await serializeFoundation(reader, 'FILE1', 'T');
    expect(dump.collections[0].variables).toEqual([]);
  });

  it('returns an empty dump when the variables API is unavailable', async () => {
    const reader = fakeReader({
      async collections() { throw new Error('no variables API'); },
      async textStyles() { throw new Error('no styles API'); },
    });
    const dump = await serializeFoundation(reader, 'FILE1', 'T');
    expect(dump.collections).toEqual([]);
    expect(dump.textStyles).toEqual([]);
  });

  it('falls back to an empty string for an unnamed external collection', async () => {
    const reader = fakeReader({
      async variable(id) {
        if (id === 'v1') {
          return {
            id: 'v1', name: 'x', resolvedType: 'COLOR', description: '',
            variableCollectionId: 'c1', codeSyntax: {},
            valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'remote' } },
          };
        }
        if (id === 'remote') {
          return {
            id: 'remote', name: 'core/blue', resolvedType: 'COLOR', description: '',
            variableCollectionId: 'gone', codeSyntax: {}, valuesByMode: {},
          };
        }
        return null;
      },
    });
    const dump = await serializeFoundation(reader, 'FILE1', 'T');
    expect(dump.externals[0].collectionName).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/serializeFoundation.test.ts`
Expected: FAIL — `Failed to resolve import "../src/serializeFoundation"`.

- [ ] **Step 3: Write the implementation**

Create `packages/plugin/src/serializeFoundation.ts`:

```ts
/**
 * serializeFoundation.ts — builds the raw foundation dump the extractor turns
 * into a FoundationSpec.
 *
 * Figma-free by construction: it reads through an injected FoundationReader,
 * the same pattern serialize.ts uses with NodeResolver, so the dump logic is
 * unit-testable and main.ts owns the Figma API surface.
 */
import type {
  SerializedFoundation, RawCollection, RawVariable, RawTextStyle, RawExternalRef,
  RawVariableValue, FoundationVariableType, FoundationMode,
} from '@spec-layer/extractor';

export interface ReaderCollection {
  id: string;
  name: string;
  modes: FoundationMode[];
  defaultModeId: string;
  variableIds: string[];
}

export interface ReaderVariable {
  id: string;
  name: string;
  resolvedType: FoundationVariableType;
  description: string;
  variableCollectionId: string;
  codeSyntax: Record<string, string>;
  valuesByMode: Record<string, RawVariableValue>;
}

export interface ReaderTextStyle {
  name: string;
  description: string;
  fontName: { family: string; style: string };
  fontSize: number;
  lineHeight: RawTextStyle['lineHeight'];
  letterSpacing: RawTextStyle['letterSpacing'];
  paragraphSpacing: number;
  paragraphIndent: number;
  textCase: string;
  textDecoration: string;
  boundVariables: Record<string, { id: string }>;
}

/** Injected Figma surface. main.ts supplies the real one; tests a fake. */
export interface FoundationReader {
  collections(): Promise<ReaderCollection[]>;
  variable(id: string): Promise<ReaderVariable | null>;
  textStyles(): Promise<ReaderTextStyle[]>;
  /** Name of a collection that may be remote. Optional: absent → ''. */
  collectionName?(id: string): Promise<string | null>;
}

function isAlias(v: RawVariableValue): v is { type: 'VARIABLE_ALIAS'; id: string } {
  return typeof v === 'object' && v !== null
    && (v as { type?: string }).type === 'VARIABLE_ALIAS';
}

export async function serializeFoundation(
  reader: FoundationReader, fileKey: string, extractedAt: string,
): Promise<SerializedFoundation> {
  let readerCollections: ReaderCollection[] = [];
  try {
    readerCollections = await reader.collections();
  } catch {
    /* variables API unavailable — an empty foundation is the honest result */
  }

  const collections: RawCollection[] = [];
  const localIds = new Set<string>();
  // Alias targets seen while walking, resolved to externals after we know which
  // ids are local. Keyed by id so a target aliased from ten places costs one hop.
  const aliasTargets = new Set<string>();

  for (const rc of readerCollections) {
    const variables: RawVariable[] = [];
    for (const id of rc.variableIds) {
      let rv: ReaderVariable | null = null;
      try { rv = await reader.variable(id); } catch { rv = null; }
      if (!rv) continue;
      localIds.add(rv.id);
      for (const value of Object.values(rv.valuesByMode)) {
        if (isAlias(value)) aliasTargets.add(value.id);
      }
      variables.push({
        id: rv.id, name: rv.name, resolvedType: rv.resolvedType,
        description: rv.description, codeSyntax: rv.codeSyntax,
        valuesByMode: rv.valuesByMode,
      });
    }
    collections.push({
      id: rc.id, name: rc.name,
      modes: rc.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
      defaultModeId: rc.defaultModeId,
      variables,
    });
  }

  // One hop per non-local alias target: capture its name and collection name
  // only. A remote variable's valuesByMode is keyed by the REMOTE collection's
  // mode ids, which cannot be mapped onto local modes, so any value we read
  // would be a guess about mode correspondence. The arrow is real; the value
  // is honestly absent.
  const externals: RawExternalRef[] = [];
  for (const id of aliasTargets) {
    if (localIds.has(id)) continue;
    let rv: ReaderVariable | null = null;
    try { rv = await reader.variable(id); } catch { rv = null; }
    if (!rv) continue;
    let collectionName = '';
    if (reader.collectionName) {
      try { collectionName = (await reader.collectionName(rv.variableCollectionId)) ?? ''; }
      catch { collectionName = ''; }
    }
    externals.push({ id: rv.id, name: rv.name, collectionName });
  }

  let readerStyles: ReaderTextStyle[] = [];
  try {
    readerStyles = await reader.textStyles();
  } catch {
    /* styles API unavailable */
  }

  const textStyles: RawTextStyle[] = [];
  for (const rs of readerStyles) {
    const boundVariables: Record<string, string> = {};
    for (const [property, ref] of Object.entries(rs.boundVariables ?? {})) {
      if (!ref?.id) continue;
      let rv: ReaderVariable | null = null;
      try { rv = await reader.variable(ref.id); } catch { rv = null; }
      if (rv) boundVariables[property] = rv.name;
    }
    textStyles.push({
      name: rs.name, description: rs.description,
      fontFamily: rs.fontName.family, fontStyle: rs.fontName.style,
      fontSize: rs.fontSize, lineHeight: rs.lineHeight, letterSpacing: rs.letterSpacing,
      paragraphSpacing: rs.paragraphSpacing, paragraphIndent: rs.paragraphIndent,
      textCase: rs.textCase, textDecoration: rs.textDecoration,
      boundVariables,
    });
  }

  return { fileKey, collections, textStyles, externals, extractedAt };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/plugin/test/serializeFoundation.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add packages/plugin/src/serializeFoundation.ts packages/plugin/test/serializeFoundation.test.ts
git commit -m "feat(plugin): foundation dump builder with injected Figma reader"
```

---

## Task 6: Messages and the main-thread foundation reader

**Files:**
- Modify: `packages/plugin/src/messages.ts`
- Modify: `packages/plugin/src/main.ts`

**Interfaces:**
- Consumes: `serializeFoundation`, `FoundationReader` (Task 5); `SerializedFoundation`, `FoundationScope` (Tasks 1–3).
- Produces: message variants `{ type: 'requestFoundation' }` (UI→main), `{ type: 'foundation'; dump: SerializedFoundation }` and `{ type: 'foundationError'; message: string }` (main→UI); `foundationReader` in `main.ts`.

`main.ts` is coverage-excluded wiring, so this task has no unit test of its own. Its verification is a typecheck plus a plugin build, and the behavior is proven by the Task 7 UI work that consumes the message.

- [ ] **Step 1: Add the message variants**

In `packages/plugin/src/messages.ts`, add to the imports:

```ts
import type { SerializedFoundation } from '@spec-layer/extractor';
```

Add to the `MainToUi` union:

```ts
  | { type: 'foundation'; dump: SerializedFoundation }
  | { type: 'foundationError'; message: string }
```

Add to the `UiToMain` union:

```ts
  | { type: 'requestFoundation' }
```

- [ ] **Step 2: Add the reader and handler in main.ts**

In `packages/plugin/src/main.ts`, extend the imports:

```ts
import { serializeFoundation, type FoundationReader } from './serializeFoundation';
```

After the existing `resolver` object (it ends with the closing `};` of `mainComponent`), add:

```ts
// ---------------------------------------------------------------------------
// FoundationReader — wraps the variables/styles APIs for serializeFoundation
// ---------------------------------------------------------------------------
const foundationReader: FoundationReader = {
  async collections() {
    const colls = await figma.variables.getLocalVariableCollectionsAsync();
    return colls.map((c) => ({
      id: c.id,
      name: c.name,
      modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
      defaultModeId: c.defaultModeId,
      variableIds: c.variableIds,
    }));
  },
  async variable(id) {
    const v = await figma.variables.getVariableByIdAsync(id);
    if (!v) return null;
    return {
      id: v.id,
      name: v.name,
      resolvedType: v.resolvedType,
      description: v.description ?? '',
      variableCollectionId: v.variableCollectionId,
      // codeSyntax is Partial<Record<CodeSyntaxPlatform, string>>; drop empties.
      codeSyntax: Object.fromEntries(
        Object.entries(v.codeSyntax ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'),
      ),
      valuesByMode: v.valuesByMode as Record<string, never>,
    };
  },
  async textStyles() {
    const styles = await figma.getLocalTextStylesAsync();
    return styles.map((s) => ({
      name: s.name,
      description: s.description ?? '',
      fontName: { family: s.fontName.family, style: s.fontName.style },
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      paragraphSpacing: s.paragraphSpacing,
      paragraphIndent: s.paragraphIndent,
      textCase: String(s.textCase),
      textDecoration: String(s.textDecoration),
      boundVariables: Object.fromEntries(
        Object.entries(s.boundVariables ?? {})
          .filter((e): e is [string, { id: string }] => Boolean((e[1] as { id?: string })?.id))
          .map(([k, v]) => [k, { id: v.id }]),
      ),
    }));
  },
  async collectionName(id) {
    const c = await figma.variables.getVariableCollectionByIdAsync(id);
    return c?.name ?? null;
  },
};
```

If `valuesByMode as Record<string, never>` trips the linter, cast through `unknown` instead: `v.valuesByMode as unknown as ReaderVariable['valuesByMode']`, importing `ReaderVariable` alongside `FoundationReader`. The Figma typing for `VariableValue` is a wider union than `RawVariableValue` and the extractor narrows it defensively at runtime.

Add a case to the `figma.ui.onmessage` switch, next to `case 'requestLibrary':`:

```ts
    case 'requestFoundation': {
      try {
        const fileKey = resolveFileKey().key;
        const dump = await serializeFoundation(
          foundationReader, fileKey, new Date().toISOString(),
        );
        figma.ui.postMessage({ type: 'foundation', dump } as MainToUi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'foundationError', message } as MainToUi);
      }
      break;
    }
```

- [ ] **Step 3: Check how `resolveFileKey` is actually called**

Run: `grep -n "resolveFileKey" packages/plugin/src/main.ts packages/plugin/src/fileKey.ts`

Match the existing call shape exactly. If it returns `{ key, source }` the code above is right; if it takes an argument or returns a bare string, adjust the one line rather than guessing.

- [ ] **Step 4: Typecheck and build**

```bash
npm run typecheck
npm run build:plugin
```

Expected: both succeed with no output errors.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/messages.ts packages/plugin/src/main.ts
git commit -m "feat(plugin): requestFoundation message and main-thread foundation reader"
```

---

## Task 7: Foundations tab — selection model and panel

**Files:**
- Create: `packages/plugin/src/ui/foundationState.ts`
- Create: `packages/plugin/test/foundationState.test.ts`
- Modify: `packages/plugin/src/ui/dom.ts`
- Modify: `packages/plugin/src/ui/render.ts`
- Modify: `packages/plugin/src/ui/actions.ts`

**Interfaces:**
- Consumes: `buildFoundation`, `planFoundationUnits`, `FoundationSpec`, `FoundationSelection`, `MAX_MODE_COLUMNS` (Tasks 1–3); the `foundation` message (Task 6).
- Produces: `FoundationSummary`, `summarize(spec)`, `defaultSelection(spec)`, `toggleCollection(sel, id, on)`, `toggleMode(sel, collectionId, modeId, on)`, `toggleTextStyles(sel, on)`, `emptyStateLines(spec)`, `canGenerate(sel)`.

The pure model lives in `foundationState.ts` and is fully tested. `dom.ts`, `render.ts`, and `actions.ts` get the markup and wiring, verified by the manual pass in Task 10.

**Copy strings — use verbatim, no em dashes:**
- `This file has no local variable collections or text styles.`
- `This file has no local variable collections.`
- `This file has no local text styles.`
- `No color variables found, so the docs will have no swatches.`
- `Pick at least one collection or text styles to generate docs.`
- `Showing 4 modes. Uncheck one to swap in another.`

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/foundationState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFoundation, type SerializedFoundation } from '@spec-layer/extractor';
import {
  summarize, defaultSelection, toggleCollection, toggleMode, toggleTextStyles,
  emptyStateLines, canGenerate,
} from '../src/ui/foundationState';

function dump(over: Partial<SerializedFoundation> = {}): SerializedFoundation {
  return {
    fileKey: 'FILE1', extractedAt: 'T', externals: [], textStyles: [],
    collections: [{
      id: 'c1', name: 'Semantic', defaultModeId: 's1',
      modes: [{ modeId: 's1', name: 'Light' }, { modeId: 's2', name: 'Dark' }],
      variables: [
        { id: 'bg', name: 'bg/brand', resolvedType: 'COLOR', description: '',
          codeSyntax: {}, valuesByMode: { s1: { r: 0, g: 0, b: 1, a: 1 }, s2: { r: 0, g: 0, b: 0, a: 1 } } },
      ],
    }],
    ...over,
  };
}

const bodyStyle = {
  name: 'Body/M', description: '', fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
  lineHeight: { unit: 'PIXELS' as const, value: 24 },
  letterSpacing: { unit: 'PERCENT' as const, value: 0 },
  paragraphSpacing: 0, paragraphIndent: 0, textCase: 'ORIGINAL', textDecoration: 'NONE',
  boundVariables: {},
};

describe('summarize', () => {
  it('counts collections, distinct mode count, variables, and text styles', () => {
    const spec = buildFoundation(dump({ textStyles: [bodyStyle] }));
    expect(summarize(spec)).toEqual({
      collectionCount: 1, maxModeCount: 2, variableCount: 1, textStyleCount: 1,
      collections: [{
        id: 'c1', name: 'Semantic', variableCount: 1,
        modes: [{ modeId: 's1', name: 'Light' }, { modeId: 's2', name: 'Dark' }],
      }],
    });
  });
});

describe('defaultSelection', () => {
  it('selects every collection, capped modes, and text styles when present', () => {
    const spec = buildFoundation(dump({ textStyles: [bodyStyle] }));
    expect(defaultSelection(spec)).toEqual({
      collections: [{ collectionId: 'c1', modeIds: ['s1', 's2'] }],
      textStyles: true,
    });
  });

  it('caps default modes at MAX_MODE_COLUMNS', () => {
    const d = dump();
    d.collections[0].modes = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ modeId: `m${i}`, name }));
    const sel = defaultSelection(buildFoundation(d));
    expect(sel.collections[0].modeIds).toEqual(['m0', 'm1', 'm2', 'm3']);
  });

  it('leaves text styles off when the file has none', () => {
    expect(defaultSelection(buildFoundation(dump())).textStyles).toBe(false);
  });
});

describe('toggles', () => {
  it('removes and re-adds a collection with capped modes', () => {
    const spec = buildFoundation(dump());
    const off = toggleCollection(defaultSelection(spec), spec, 'c1', false);
    expect(off.collections).toEqual([]);
    const on = toggleCollection(off, spec, 'c1', true);
    expect(on.collections).toEqual([{ collectionId: 'c1', modeIds: ['s1', 's2'] }]);
  });

  it('unchecking a mode leaves the others', () => {
    const spec = buildFoundation(dump());
    const sel = toggleMode(defaultSelection(spec), spec, 'c1', 's2', false);
    expect(sel.collections[0].modeIds).toEqual(['s1']);
  });

  it('refuses to check a mode past the cap', () => {
    const d = dump();
    d.collections[0].modes = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ modeId: `m${i}`, name }));
    const spec = buildFoundation(d);
    const sel = toggleMode(defaultSelection(spec), spec, 'c1', 'm4', true);
    expect(sel.collections[0].modeIds).toEqual(['m0', 'm1', 'm2', 'm3']);
  });

  it('keeps mode order matching collection order, not click order', () => {
    const spec = buildFoundation(dump());
    let sel = toggleMode(defaultSelection(spec), spec, 'c1', 's1', false);
    sel = toggleMode(sel, spec, 'c1', 's1', true);
    expect(sel.collections[0].modeIds).toEqual(['s1', 's2']);
  });

  it('unchecking the last mode drops the collection from the selection', () => {
    const spec = buildFoundation(dump());
    let sel = toggleMode(defaultSelection(spec), spec, 'c1', 's1', false);
    sel = toggleMode(sel, spec, 'c1', 's2', false);
    expect(sel.collections).toEqual([]);
  });

  it('toggles text styles', () => {
    const spec = buildFoundation(dump({ textStyles: [bodyStyle] }));
    expect(toggleTextStyles(defaultSelection(spec), false).textStyles).toBe(false);
  });
});

describe('canGenerate', () => {
  it('is false with nothing selected and true with anything selected', () => {
    expect(canGenerate({ collections: [], textStyles: false })).toBe(false);
    expect(canGenerate({ collections: [], textStyles: true })).toBe(true);
    expect(canGenerate({ collections: [{ collectionId: 'c1', modeIds: ['s1'] }], textStyles: false }))
      .toBe(true);
  });
});

describe('emptyStateLines', () => {
  it('reports a file with neither', () => {
    expect(emptyStateLines(buildFoundation(dump({ collections: [] }))))
      .toEqual(['This file has no local variable collections or text styles.']);
  });

  it('reports text styles only', () => {
    expect(emptyStateLines(buildFoundation(dump({ collections: [], textStyles: [bodyStyle] }))))
      .toEqual(['This file has no local variable collections.']);
  });

  it('reports collections only', () => {
    expect(emptyStateLines(buildFoundation(dump())))
      .toEqual(['This file has no local text styles.']);
  });

  it('warns when no collection holds a color variable', () => {
    const d = dump({ textStyles: [bodyStyle] });
    d.collections[0].variables[0] = {
      id: 'x', name: 'space/4', resolvedType: 'FLOAT', description: '',
      codeSyntax: {}, valuesByMode: { s1: 16, s2: 16 },
    };
    expect(emptyStateLines(buildFoundation(d)))
      .toEqual(['No color variables found, so the docs will have no swatches.']);
  });

  it('says nothing when the file has both, including color', () => {
    expect(emptyStateLines(buildFoundation(dump({ textStyles: [bodyStyle] })))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/foundationState.test.ts`
Expected: FAIL — `Failed to resolve import "../src/ui/foundationState"`.

- [ ] **Step 3: Write the implementation**

Create `packages/plugin/src/ui/foundationState.ts`:

```ts
/**
 * foundationState.ts — the pure selection model behind the Foundations tab.
 *
 * dom.ts owns markup and render.ts owns painting; everything decidable without
 * a DOM lives here so it can be tested. Mode selections are always stored in
 * collection order rather than click order, so a rebuilt doc's columns do not
 * silently reorder between generations.
 */
import {
  MAX_MODE_COLUMNS, type FoundationSpec, type FoundationSelection, type FoundationMode,
} from '@spec-layer/extractor';

export interface FoundationSummaryCollection {
  id: string;
  name: string;
  variableCount: number;
  modes: FoundationMode[];
}

export interface FoundationSummary {
  collectionCount: number;
  maxModeCount: number;
  variableCount: number;
  textStyleCount: number;
  collections: FoundationSummaryCollection[];
}

export function summarize(spec: FoundationSpec): FoundationSummary {
  return {
    collectionCount: spec.collections.length,
    maxModeCount: spec.collections.reduce((n, c) => Math.max(n, c.modes.length), 0),
    variableCount: spec.collections.reduce((n, c) => n + c.variables.length, 0),
    textStyleCount: spec.textStyles.length,
    collections: spec.collections.map((c) => ({
      id: c.id,
      name: c.name,
      variableCount: c.variables.length,
      modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
    })),
  };
}

export function defaultSelection(spec: FoundationSpec): FoundationSelection {
  return {
    collections: spec.collections.map((c) => ({
      collectionId: c.id,
      modeIds: c.modes.slice(0, MAX_MODE_COLUMNS).map((m) => m.modeId),
    })),
    textStyles: spec.textStyles.length > 0,
  };
}

/** Reorder a set of mode ids into the collection's own order. */
function inCollectionOrder(spec: FoundationSpec, collectionId: string, ids: string[]): string[] {
  const collection = spec.collections.find((c) => c.id === collectionId);
  if (!collection) return [];
  return collection.modes.map((m) => m.modeId).filter((id) => ids.includes(id));
}

export function toggleCollection(
  sel: FoundationSelection, spec: FoundationSpec, collectionId: string, on: boolean,
): FoundationSelection {
  const collections = sel.collections.filter((c) => c.collectionId !== collectionId);
  if (!on) return { ...sel, collections };
  const collection = spec.collections.find((c) => c.id === collectionId);
  if (!collection) return { ...sel, collections };
  const entry = {
    collectionId,
    modeIds: collection.modes.slice(0, MAX_MODE_COLUMNS).map((m) => m.modeId),
  };
  // Keep selection order matching spec order so units render predictably.
  const next = [...collections, entry].sort(
    (a, b) => spec.collections.findIndex((c) => c.id === a.collectionId)
            - spec.collections.findIndex((c) => c.id === b.collectionId),
  );
  return { ...sel, collections: next };
}

export function toggleMode(
  sel: FoundationSelection, spec: FoundationSpec,
  collectionId: string, modeId: string, on: boolean,
): FoundationSelection {
  const existing = sel.collections.find((c) => c.collectionId === collectionId);
  const current = existing ? existing.modeIds : [];

  let nextIds: string[];
  if (on) {
    if (current.includes(modeId)) return sel;
    // At the cap, ignore the check rather than silently evicting a column the
    // user chose. The UI explains this with the cap note.
    if (current.length >= MAX_MODE_COLUMNS) return sel;
    nextIds = inCollectionOrder(spec, collectionId, [...current, modeId]);
  } else {
    nextIds = current.filter((id) => id !== modeId);
  }

  if (nextIds.length === 0) {
    return { ...sel, collections: sel.collections.filter((c) => c.collectionId !== collectionId) };
  }
  if (!existing) {
    return toggleCollection(
      { ...sel, collections: sel.collections }, spec, collectionId, true,
    );
  }
  return {
    ...sel,
    collections: sel.collections.map((c) =>
      c.collectionId === collectionId ? { ...c, modeIds: nextIds } : c),
  };
}

export function toggleTextStyles(sel: FoundationSelection, on: boolean): FoundationSelection {
  return { ...sel, textStyles: on };
}

export function canGenerate(sel: FoundationSelection): boolean {
  return sel.collections.length > 0 || sel.textStyles;
}

/**
 * Zero or one line explaining what the file does not have. Each case names the
 * reason rather than leaving an unexplained gap in the docs.
 */
export function emptyStateLines(spec: FoundationSpec): string[] {
  const hasCollections = spec.collections.length > 0;
  const hasTextStyles = spec.textStyles.length > 0;

  if (!hasCollections && !hasTextStyles) {
    return ['This file has no local variable collections or text styles.'];
  }
  if (!hasCollections) return ['This file has no local variable collections.'];
  if (!hasTextStyles) return ['This file has no local text styles.'];

  const hasColor = spec.collections.some((c) =>
    c.variables.some((v) => v.resolvedType === 'COLOR'));
  if (!hasColor) return ['No color variables found, so the docs will have no swatches.'];

  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/plugin/test/foundationState.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Add the tab markup**

In `packages/plugin/src/ui/dom.ts`, add the tab button after the `tab-library` button (around line 866):

```html
    <button class="tab" id="tab-foundations" role="tab" aria-selected="false"
            aria-controls="tab-panel-foundations">Foundations</button>
```

Add the panel after the library panel's closing `</section>` (around line 1016):

```html
    <section class="panel" id="tab-panel-foundations" role="tabpanel"
             aria-labelledby="tab-foundations">
      <p class="muted" id="foundation-summary">Reading this file's variables and styles.</p>
      <div id="foundation-notes"></div>
      <div id="foundation-list"></div>
      <div class="footer-row">
        <button class="btn primary" id="foundation-create" disabled>Create foundation frames</button>
      </div>
    </section>
```

Add refs to the interface next to `panelLibrary` (`dom.ts:1160-1162`):

```ts
  tabFoundations: HTMLButtonElement;
  panelFoundations: HTMLElement;
  foundationSummary: HTMLParagraphElement;
  foundationNotes: HTMLDivElement;
  foundationList: HTMLDivElement;
  foundationCreate: HTMLButtonElement;
```

And to the `byId` block (`dom.ts:1463-1465`):

```ts
    panelFoundations: byId<HTMLElement>('tab-panel-foundations'),
```

plus:

```ts
    tabFoundations: byId<HTMLButtonElement>('tab-foundations'),
    foundationSummary: byId<HTMLParagraphElement>('foundation-summary'),
    foundationNotes: byId<HTMLDivElement>('foundation-notes'),
    foundationList: byId<HTMLDivElement>('foundation-list'),
    foundationCreate: byId<HTMLButtonElement>('foundation-create'),
```

- [ ] **Step 6: Register the tab**

In `packages/plugin/src/ui/render.ts`, widen `TabId` (line 321) and the `switchTab` table (lines 324-328):

```ts
export type TabId = 'selected' | 'foundations' | 'library' | 'settings';

export function switchTab(refs: Refs, tab: TabId): void {
  const tabs: Array<[TabId, HTMLButtonElement, HTMLElement]> = [
    ['selected', refs.tabSelected, refs.panelSelected],
    ['foundations', refs.tabFoundations, refs.panelFoundations],
    ['library', refs.tabLibrary, refs.panelLibrary],
    ['settings', refs.tabSettings, refs.panelSettings],
  ];
```

`switchTab` already calls `syncFooter(refs)`, so the Selected-component sticky footer follows automatically provided `syncFooter` keys off the active panel. Confirm which:

Run: `grep -n -A 12 "function syncFooter" packages/plugin/src/ui/render.ts`

If it tests `panelSelected` being active, it already works. If it tests "not settings" or similar, add the Foundations panel to that condition: the Foundations panel carries its own `.footer-row` button and must not also get the floating footer.

- [ ] **Step 7: Render the panel**

Append to `render.ts`:

```ts
// ---------------------------------------------------------------------------
// Foundations
// ---------------------------------------------------------------------------

/**
 * Paint the Foundations panel from the pure model in foundationState.ts.
 *
 * Every user-controlled string (collection name, mode name) is set via
 * textContent and never interpolated into innerHTML, matching renderLibrary.
 */
export function renderFoundationPanel(
  refs: Refs,
  summary: FoundationSummary,
  selection: FoundationSelection,
  notes: string[],
): void {
  refs.foundationSummary.textContent = [
    `${summary.collectionCount} ${summary.collectionCount === 1 ? 'collection' : 'collections'}`,
    `${summary.maxModeCount} ${summary.maxModeCount === 1 ? 'mode' : 'modes'}`,
    `${summary.textStyleCount} text styles`,
  ].join(' · ');

  refs.foundationNotes.textContent = '';
  for (const note of notes) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = note;
    refs.foundationNotes.appendChild(p);
  }

  refs.foundationList.textContent = '';

  for (const c of summary.collections) {
    const chosen = selection.collections.find((s) => s.collectionId === c.id);

    const row = document.createElement('div');
    row.className = 'foundation-row';

    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = Boolean(chosen);
    box.dataset.act = 'toggle-collection';
    box.dataset.collectionId = c.id;
    label.appendChild(box);
    const text = document.createElement('span');
    text.textContent = ` ${c.name} · ${c.variableCount} variables · `
      + `${c.modes.length} ${c.modes.length === 1 ? 'mode' : 'modes'}`;
    label.appendChild(text);
    row.appendChild(label);

    // Mode checkboxes appear only when a collection has more modes than can be
    // rendered, so the user picks which four rather than getting the first four
    // by accident.
    if (c.modes.length > MAX_MODE_COLUMNS) {
      const modes = document.createElement('div');
      modes.className = 'foundation-modes';
      for (const m of c.modes) {
        const ml = document.createElement('label');
        const mb = document.createElement('input');
        mb.type = 'checkbox';
        mb.checked = Boolean(chosen?.modeIds.includes(m.modeId));
        mb.disabled = !chosen;
        mb.dataset.act = 'toggle-mode';
        mb.dataset.collectionId = c.id;
        mb.dataset.modeId = m.modeId;
        ml.appendChild(mb);
        const mt = document.createElement('span');
        mt.textContent = ` ${m.name}`;
        ml.appendChild(mt);
        modes.appendChild(ml);
      }
      const cap = document.createElement('p');
      cap.className = 'muted';
      cap.textContent = 'Showing 4 modes. Uncheck one to swap in another.';
      modes.appendChild(cap);
      row.appendChild(modes);
    }

    refs.foundationList.appendChild(row);
  }

  if (summary.textStyleCount > 0) {
    const row = document.createElement('div');
    row.className = 'foundation-row';
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selection.textStyles;
    box.dataset.act = 'toggle-text-styles';
    label.appendChild(box);
    const text = document.createElement('span');
    text.textContent = ` Text styles · ${summary.textStyleCount} styles`;
    label.appendChild(text);
    row.appendChild(label);
    refs.foundationList.appendChild(row);
  }

  refs.foundationCreate.disabled = !canGenerate(selection);
}
```

Add to `render.ts`'s imports:

```ts
import { MAX_MODE_COLUMNS, type FoundationSelection } from '@spec-layer/extractor';
import { canGenerate, type FoundationSummary } from './foundationState';
```

- [ ] **Step 8: Wire the actions**

Find the existing post helper and the library tab's first-activation fetch:

Run: `grep -n "postMessage\|requestLibrary" packages/plugin/src/ui/actions.ts`

Add to `actions.ts`, matching that helper's real name:

```ts
let foundationSpec: FoundationSpec | null = null;
let foundationSelection: FoundationSelection = { collections: [], textStyles: false };

function paintFoundations(refs: Refs): void {
  if (!foundationSpec) return;
  renderFoundationPanel(
    refs, summarize(foundationSpec), foundationSelection, emptyStateLines(foundationSpec),
  );
}

export function onFoundationMessage(refs: Refs, dump: SerializedFoundation): void {
  foundationSpec = buildFoundation(dump);
  foundationSelection = defaultSelection(foundationSpec);
  paintFoundations(refs);
}

export function onFoundationCheckboxChange(refs: Refs, input: HTMLInputElement): void {
  if (!foundationSpec) return;
  const collectionId = input.dataset.collectionId ?? '';
  switch (input.dataset.act) {
    case 'toggle-collection':
      foundationSelection = toggleCollection(
        foundationSelection, foundationSpec, collectionId, input.checked);
      break;
    case 'toggle-mode':
      foundationSelection = toggleMode(
        foundationSelection, foundationSpec, collectionId,
        input.dataset.modeId ?? '', input.checked);
      break;
    case 'toggle-text-styles':
      foundationSelection = toggleTextStyles(foundationSelection, input.checked);
      break;
    default:
      return;
  }
  // Repaint from the model rather than trusting the DOM: toggleMode returns the
  // selection UNCHANGED when the mode cap is hit, so a checkbox the user just
  // clicked has to be painted back to unchecked. Mutating in place would leave
  // the DOM claiming five modes while the model holds four.
  paintFoundations(refs);
}

/** Read by the create-frames button; exported so ui.ts can post it. */
export function currentFoundationSelection(): FoundationSelection {
  return foundationSelection;
}
```

Then in `ui.ts`: attach one delegated `change` listener on `refs.foundationList` calling `onFoundationCheckboxChange`, post `{ type: 'requestFoundation' }` on the tab's first activation (mirroring the library tab), route the `foundation` message to `onFoundationMessage`, and on `foundationError` set `refs.foundationNotes.textContent` to the error message.

- [ ] **Step 9: Verify the build**

```bash
npm run typecheck
npm run build:plugin
npx vitest run packages/plugin
```

Expected: all pass.

- [ ] **Step 10: Commit — phase 2 complete**

```bash
npm run check
git add packages/plugin/src/ui packages/plugin/test/foundationState.test.ts
git commit -m "feat(plugin): Foundations tab with selection model and empty states"
```

---

## Task 8: Foundation frame rendering

**Files:**
- Create: `packages/plugin/src/foundationFrame.ts`
- Modify: `packages/plugin/src/messages.ts`

**Interfaces:**
- Consumes: `unitContent`, `FoundationUnit`, `FoundationRow`, `FoundationValue` (Task 3); `palette`, `solidFill`, `makeText`, `vstack`, `hstack`, `radius`, `font`, `headingFont`, `hex`, `setCornerStyle`, `setFontFamilies` from `frameKit.ts`; `resolveTheme` from `brandColors.ts`.
- Produces: `applyThemeToKit(theme)` in `frameKit.ts`; `buildFoundationFrame(content, unit, theme, includeDescriptions, unitIndex, unitTotal): Promise<SectionNode>`, `valueLabel(value): string`, `swatchColorOf(value): RGB | null`.

**Three facts about the existing code that this task must respect** — verified against source, do not re-derive:

1. **`makeText`'s signature is `(chars, style, size, color?, lineHeightPct?, trackingPct?)`** — style comes *before* size (`frameKit.ts:106`). Getting this backwards typechecks in neither order but fails confusingly in one.
2. **`frameKit`'s `palette`, corner scale, and font families are module state.** `buildDocFrames` resets every mutable field on every build precisely so a themed build never leaks into the next one (`docFrame.ts:1177-1206`). A foundation frame that skips this inherits whatever the last component build left behind.
3. **There is no exported `ResolvedTheme` type.** `docFrame` types the parameter as `ReturnType<typeof resolveTheme>`; do the same.

`valueLabel` and `swatchColorOf` are pure and tested. Node construction is verified in the Task 10 manual pass, matching how `docFrame.ts` is treated.

**Copy strings — verbatim, no em dashes:**
- `${n} variables · ${m} modes` (header subtitle)
- `${n} text styles` (header subtitle for the text-styles unit)
- `Modes not shown: A, B` (footer, only when omitted modes exist)
- `Part ${i} of ${n}, covering ${group}.` (footer, only on split units)
- `library` (suffix on an external alias)
- `not resolved: cycle` / `not resolved: missing` / `not resolved: depth` / `not resolved: external library variable`
- `Font not available, shown in Inter.`

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/foundationFrame.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { valueLabel, swatchColorOf } from '../src/foundationFrame';
import type { FoundationValue } from '@spec-layer/extractor';

describe('valueLabel', () => {
  it('labels a color as hex, adding alpha only when partial', () => {
    expect(valueLabel({ kind: 'color', hex: '#2563eb', alpha: 1 })).toBe('#2563EB');
    expect(valueLabel({ kind: 'color', hex: '#000000', alpha: 0.5 })).toBe('#000000 50%');
  });

  it('labels numbers without trailing zeros', () => {
    expect(valueLabel({ kind: 'number', value: 16 })).toBe('16');
    expect(valueLabel({ kind: 'number', value: 1.5 })).toBe('1.5');
  });

  it('labels strings and booleans', () => {
    expect(valueLabel({ kind: 'string', value: 'Acme' })).toBe('Acme');
    expect(valueLabel({ kind: 'boolean', value: true })).toBe('true');
  });

  it('labels a resolved alias with the arrow and the final value', () => {
    const v: FoundationValue = {
      kind: 'alias', targetName: 'color/blue/500', targetCollection: 'Primitives',
      external: false, resolved: { kind: 'color', hex: '#0000ff', alpha: 1 },
    };
    expect(valueLabel(v)).toBe('→ color/blue/500  #0000FF');
  });

  it('marks an external alias as a library reference with no value', () => {
    const v: FoundationValue = {
      kind: 'alias', targetName: 'core/blue', targetCollection: 'Core Library',
      external: true, resolved: null,
    };
    expect(valueLabel(v)).toBe('→ core/blue (library)');
  });

  it('states every unresolved reason plainly', () => {
    expect(valueLabel({ kind: 'unresolved', reason: 'cycle' })).toBe('not resolved: cycle');
    expect(valueLabel({ kind: 'unresolved', reason: 'missing' })).toBe('not resolved: missing');
    expect(valueLabel({ kind: 'unresolved', reason: 'depth' })).toBe('not resolved: depth');
    expect(valueLabel({ kind: 'unresolved', reason: 'external' }))
      .toBe('not resolved: external library variable');
  });

  it('labels an alias whose chain failed with the arrow plus the reason', () => {
    const v: FoundationValue = {
      kind: 'alias', targetName: 'a', targetCollection: 'P', external: false,
      resolved: { kind: 'unresolved', reason: 'cycle' },
    };
    expect(valueLabel(v)).toBe('→ a  not resolved: cycle');
  });

  it('contains no em dash in any label', () => {
    const values: FoundationValue[] = [
      { kind: 'color', hex: '#000000', alpha: 0.5 },
      { kind: 'unresolved', reason: 'external' },
      { kind: 'alias', targetName: 'a', targetCollection: 'P', external: true, resolved: null },
    ];
    for (const v of values) expect(valueLabel(v)).not.toContain('—');
  });
});

describe('swatchColorOf', () => {
  it('returns rgb for a color', () => {
    expect(swatchColorOf({ kind: 'color', hex: '#0000ff', alpha: 1 }))
      .toEqual({ r: 0, g: 0, b: 1 });
  });

  it('returns the resolved color through an alias', () => {
    expect(swatchColorOf({
      kind: 'alias', targetName: 'x', targetCollection: 'P', external: false,
      resolved: { kind: 'color', hex: '#ff0000', alpha: 1 },
    })).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('returns null for non-colors and unresolved values', () => {
    expect(swatchColorOf({ kind: 'number', value: 4 })).toBeNull();
    expect(swatchColorOf({ kind: 'unresolved', reason: 'missing' })).toBeNull();
    expect(swatchColorOf({
      kind: 'alias', targetName: 'x', targetCollection: 'L', external: true, resolved: null,
    })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/foundationFrame.test.ts`
Expected: FAIL — `Failed to resolve import "../src/foundationFrame"`.

- [ ] **Step 3: Add the shared theme applier to frameKit**

The theme preamble currently lives inline in `buildDocFrames`. Rather than duplicating it (which would let the two document types drift apart) or refactoring a 1279-line file mid-feature, add the shared helper to `frameKit.ts` and have the new code use it. Migrating `docFrame` onto it is a deliberate follow-up, noted in Task 14's docs step, not a silent omission.

Append to `packages/plugin/src/frameKit.ts`:

```ts
/**
 * Apply a resolved brand theme to this module's mutable state.
 *
 * palette, cornerScale, and the font families are module-level, so EVERY
 * mutable field is set on every call: a Default build after a themed one must
 * fully reset. Loads the requested families, reverting any family that fails to
 * Inter (families missing Medium/Bold are common), then always loads the Inter
 * faces since they are the fallback and are needed for bold runs.
 *
 * buildDocFrames still inlines an equivalent preamble; migrating it onto this
 * helper is a follow-up.
 */
export async function applyThemeToKit(theme: {
  headerBg: string; accent: string; bodyText: string; tableHeadBg: string;
  cornerStyle: CornerStyle; headingFont: string; bodyFont: string;
}): Promise<void> {
  palette.headerBg = hex(theme.headerBg);
  palette.accent = hex(theme.accent);
  palette.body = hex(theme.bodyText);
  palette.tableHeadBg = hex(theme.tableHeadBg);
  setCornerStyle(theme.cornerStyle);

  const tryFamily = async (family: string): Promise<string> => {
    if (family === 'Inter') return 'Inter';
    try {
      await Promise.all((['Regular', 'Medium', 'Bold'] as const).map((style) =>
        figma.loadFontAsync({ family, style })));
      return family;
    } catch {
      return 'Inter';
    }
  };
  const [headingFam, bodyFam] = await Promise.all([
    tryFamily(theme.headingFont), tryFamily(theme.bodyFont),
  ]);
  setFontFamilies(headingFam, bodyFam);

  await Promise.all((['Regular', 'Medium', 'Bold'] as FontStyle[]).map((style) =>
    figma.loadFontAsync({ family: 'Inter', style })));
}
```

Verify the field names against the real `resolveTheme` return shape before running:

Run: `sed -n 105,130p packages/plugin/src/brandColors.ts`

- [ ] **Step 4: Write the pure label helpers plus the frame builder**

Create `packages/plugin/src/foundationFrame.ts`:

```ts
/// <reference types="@figma/plugin-typings" />
/**
 * foundationFrame.ts — renders one foundation output unit as a Figma Section.
 *
 * Deliberately separate from docFrame.ts: that file owns the component
 * document and is already large. Both share frameKit.ts primitives, so a
 * foundation frame inherits the user's brand theme, fonts, and corner style
 * with no new theming code.
 *
 * valueLabel and swatchColorOf are pure and unit-tested. Node construction is
 * verified by the manual Figma pass, the same treatment docFrame.ts gets.
 */
import type {
  FoundationUnit, FoundationUnitContent, FoundationValue, FoundationVariableRow,
  FoundationTextRow,
} from '@spec-layer/extractor';
import {
  palette, solidFill, makeText, vstack, hstack, radius, headingFont, hex,
  applyThemeToKit,
} from './frameKit';
import type { resolveTheme } from './brandColors';

/** Human label for one cell. Never returns an empty string. */
export function valueLabel(value: FoundationValue): string {
  switch (value.kind) {
    case 'color': {
      const h = value.hex.toUpperCase();
      return value.alpha < 1 ? `${h} ${Math.round(value.alpha * 100)}%` : h;
    }
    case 'number':
      // Strip trailing zeros: 16 stays "16", 1.50 becomes "1.5".
      return String(Number(value.value));
    case 'string':
      return value.value;
    case 'boolean':
      return String(value.value);
    case 'alias': {
      if (value.external) return `→ ${value.targetName} (library)`;
      if (!value.resolved) return `→ ${value.targetName}`;
      return `→ ${value.targetName}  ${valueLabel(value.resolved)}`;
    }
    case 'unresolved':
      return value.reason === 'external'
        ? 'not resolved: external library variable'
        : `not resolved: ${value.reason}`;
  }
}

/** The swatch color for a cell, or null when there is nothing to show. */
export function swatchColorOf(value: FoundationValue): RGB | null {
  if (value.kind === 'color') return hex(value.hex);
  if (value.kind === 'alias' && value.resolved) return swatchColorOf(value.resolved);
  return null;
}

const COL_NAME = 240;
const COL_DESC = 220;
const COL_MODE = 180;
const ROW_PAD = 8;

function cellText(label: string, width: number, muted = false): FrameNode {
  const row = hstack(6);
  row.resize(width, 1);
  row.primaryAxisSizingMode = 'FIXED';
  row.counterAxisAlignItems = 'CENTER';
  row.appendChild(makeText(label, 'Regular', 11, muted ? palette.muted : palette.body));
  return row;
}

function swatchCell(value: FoundationValue, width: number): FrameNode {
  const row = hstack(6);
  row.resize(width, 1);
  row.primaryAxisSizingMode = 'FIXED';
  row.counterAxisAlignItems = 'CENTER';

  const color = swatchColorOf(value);
  if (color) {
    const chip = figma.createRectangle();
    chip.resize(14, 14);
    chip.cornerRadius = radius(3);
    chip.fills = solidFill(color);
    chip.strokes = solidFill(palette.border);
    chip.strokeWeight = 1;
    row.appendChild(chip);
  }
  const unresolved = value.kind === 'unresolved'
    || (value.kind === 'alias' && !value.external && value.resolved?.kind === 'unresolved');
  row.appendChild(makeText(valueLabel(value), 'Regular', 11,
    unresolved ? palette.muted : palette.body));
  return row;
}

function headerCell(label: string, width: number): FrameNode {
  const row = hstack(0);
  row.resize(width, 1);
  row.primaryAxisSizingMode = 'FIXED';
  row.appendChild(makeText(label, 'Medium', 10, palette.label));
  return row;
}

function tableRow(children: FrameNode[], withDivider: boolean): FrameNode {
  const row = hstack(12);
  row.paddingTop = ROW_PAD;
  row.paddingBottom = ROW_PAD;
  row.counterAxisAlignItems = 'CENTER';
  row.layoutSizingHorizontal = 'HUG';
  for (const c of children) row.appendChild(c);
  if (withDivider) {
    row.strokes = solidFill(palette.divider);
    row.strokeBottomWeight = 1;
    row.strokeTopWeight = 0;
    row.strokeLeftWeight = 0;
    row.strokeRightWeight = 0;
  }
  return row;
}

/**
 * Build one foundation Section. `loadFonts` reports families that failed so the
 * caller can note the fallback on the affected rows.
 */
export async function buildFoundationFrame(
  content: FoundationUnitContent,
  unit: FoundationUnit,
  theme: ReturnType<typeof resolveTheme>,
  includeDescriptions: boolean,
  unitIndex: number,
  unitTotal: number,
): Promise<SectionNode> {
  // Reset and apply theme state BEFORE any layout reads palette or fonts.
  // Skipping this would inherit whatever the last component build left in
  // frameKit's module state.
  await applyThemeToKit(theme);

  // The column appears only when the user asked for descriptions AND some row
  // in this unit actually has one, so a file with no descriptions never gets a
  // column of blanks.
  const hasDescriptions = includeDescriptions
    && content.rows.some((r) => r.description.length > 0);
  const isText = unit.scope.target === 'textStyles';

  // Load every family a specimen needs. Track failures so a wrong-looking
  // specimen is always acknowledged rather than silently wrong.
  const failedFamilies = new Set<string>();
  if (isText) {
    const wanted = new Map<string, FontName>();
    for (const row of content.rows) {
      if (row.kind !== 'textStyle') continue;
      wanted.set(`${row.metrics.fontFamily}|${row.metrics.fontStyle}`,
        { family: row.metrics.fontFamily, style: row.metrics.fontStyle });
    }
    for (const [key, fontName] of wanted) {
      try { await figma.loadFontAsync(fontName); }
      catch { failedFamilies.add(key); }
    }
  }

  const card = vstack(0);
  card.name = unit.title;
  card.fills = solidFill(palette.bg);
  card.strokes = solidFill(palette.border);
  card.strokeWeight = 1;
  card.cornerRadius = radius(12);
  card.paddingTop = 0;
  card.paddingBottom = 20;
  card.paddingLeft = 24;
  card.paddingRight = 24;

  // --- header band ---
  const header = vstack(4);
  header.paddingTop = 20;
  header.paddingBottom = 16;
  header.appendChild(makeText('Foundations', 'Medium', 10, palette.muted));
  const title = makeText(unit.title, 'Bold', 20, palette.heading);
  title.fontName = headingFont('Bold');
  header.appendChild(title);
  const subtitle = isText
    ? `${content.rows.length} text styles`
    : `${content.rows.length} variables · ${content.modeNames.length} modes`;
  header.appendChild(makeText(subtitle, 'Regular', 11, palette.muted));
  card.appendChild(header);

  // --- table header ---
  const columns: FrameNode[] = [headerCell('Name', COL_NAME)];
  if (hasDescriptions) columns.push(headerCell('Description', COL_DESC));
  if (isText) columns.push(headerCell('Specimen', COL_MODE * 2));
  else for (const m of content.modeNames) columns.push(headerCell(m, COL_MODE));
  const head = tableRow(columns, true);
  head.fills = solidFill(palette.tableHeadBg);
  card.appendChild(head);

  // --- rows ---
  content.rows.forEach((row, i) => {
    const cells: FrameNode[] = [cellText(row.name, COL_NAME)];
    if (hasDescriptions) cells.push(cellText(row.description, COL_DESC, true));

    if (row.kind === 'variable') {
      const v = row as FoundationVariableRow;
      for (const cell of v.cells) cells.push(swatchCell(cell.value, COL_MODE));
    } else {
      const t = row as FoundationTextRow;
      const key = `${t.metrics.fontFamily}|${t.metrics.fontStyle}`;
      const failed = failedFamilies.has(key);
      const pane = vstack(2);
      pane.resize(COL_MODE * 2, 1);
      pane.primaryAxisSizingMode = 'AUTO';
      const specimen = makeText('Ag', 'Regular', Math.min(t.metrics.fontSize, 40), palette.heading);
      if (!failed) {
        specimen.fontName = { family: t.metrics.fontFamily, style: t.metrics.fontStyle };
      }
      pane.appendChild(specimen);
      const lh = t.metrics.lineHeight.unit === 'AUTO'
        ? 'auto' : `${t.metrics.lineHeight.value}${t.metrics.lineHeight.unit === 'PERCENT' ? '%' : ''}`;
      pane.appendChild(makeText(
        `${t.metrics.fontFamily} ${t.metrics.fontStyle} ${t.metrics.fontSize}/${lh}`,
        'Regular', 10, palette.muted));
      if (failed) {
        pane.appendChild(makeText('Font not available, shown in Inter.', 'Regular', 10, palette.muted));
      }
      cells.push(pane);
    }

    card.appendChild(tableRow(cells, i < content.rows.length - 1));
  });

  // --- footer notes ---
  const notes: string[] = [];
  if (unit.omittedModeNames.length > 0) {
    notes.push(`Modes not shown: ${unit.omittedModeNames.join(', ')}`);
  }
  if (unitTotal > 1 && content.group) {
    notes.push(`Part ${unitIndex + 1} of ${unitTotal}, covering ${content.group}.`);
  }
  if (notes.length > 0) {
    const footer = vstack(2);
    footer.paddingTop = 14;
    for (const n of notes) footer.appendChild(makeText(n, 'Regular', 10, palette.muted));
    card.appendChild(footer);
  }

  const section = figma.createSection();
  section.name = `Foundations: ${unit.title}`;
  section.appendChild(card);
  card.x = 40;
  card.y = 40;
  section.resizeWithoutConstraints(card.width + 80, card.height + 80);
  return section;
}
```

Reconcile `vstack`/`hstack` sizing behavior against the real helpers before running:

Run: `sed -n 130,160p packages/plugin/src/frameKit.ts`

Adjust call sites to match rather than changing those helpers. The `makeText` order above is already correct: `(chars, style, size, color)`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/plugin/test/foundationFrame.test.ts`
Expected: PASS, 11 tests.

The `figma.*` calls are never reached by these tests — only `valueLabel` and `swatchColorOf` are imported and exercised — so no Figma mock is needed. If the import itself fails on the `/// <reference>` line, that is a tsconfig issue, not a test issue.

- [ ] **Step 6: Commit**

```bash
npm run typecheck
npm run build:plugin
git add packages/plugin/src/foundationFrame.ts packages/plugin/src/frameKit.ts packages/plugin/test/foundationFrame.test.ts
git commit -m "feat(plugin): render a foundation unit as a Figma Section"
```

---

## Task 9: Generate frames from the UI

**Files:**
- Modify: `packages/plugin/src/messages.ts`
- Modify: `packages/plugin/src/main.ts`
- Modify: `packages/plugin/src/ui/actions.ts`
- Modify: `packages/plugin/src/ui/render.ts`

**Interfaces:**
- Consumes: `planFoundationUnits`, `unitContent`, `buildFoundation` (Tasks 1–3); `buildFoundationFrame` (Task 8); `serializeFoundation` (Task 5).
- Produces: messages `{ type: 'renderFoundation'; selection: FoundationSelection; config: FoundationConfig }` (UI→main), `{ type: 'foundationProgress'; done: number; total: number }`, `{ type: 'foundationDone'; created: number; replaced: number }`, `{ type: 'foundationFrameError'; message: string }` (main→UI).

The main thread re-extracts rather than trusting a dump round-tripped through the UI, so a file edited between preview and generation produces correct frames.

**Copy strings — verbatim:**
- `Creating ${done} of ${total}.`
- `Created ${n} foundation frames.`
- `Updated ${n} foundation frames.`
- `Could not create the foundation frames. ${message}`

- [ ] **Step 1: Add the message variants**

In `packages/plugin/src/messages.ts`, add to the imports:

```ts
import type { FoundationSelection } from '@spec-layer/extractor';
```

Add to `MainToUi`:

```ts
  | { type: 'foundationProgress'; done: number; total: number }
  | { type: 'foundationDone'; created: number; replaced: number }
  | { type: 'foundationFrameError'; message: string }
```

Add to `UiToMain`:

```ts
  | { type: 'renderFoundation'; selection: FoundationSelection; config: FoundationConfig }
```

`FoundationConfig` comes from `./docLink` — add it to the existing `import type { DocConfig } from './docLink';` line as `import type { DocConfig, FoundationConfig } from './docLink';`. Task 11 defines it; until then, declare it locally in `docLink.ts` as the first part of that task, or land Task 11 before this one. **Land Task 11 before Task 9** if you hit an import error; the two are independent otherwise.

- [ ] **Step 2: Add the main-thread handler**

In `packages/plugin/src/main.ts`, extend imports:

```ts
import { buildFoundation, planFoundationUnits, unitContent } from '@spec-layer/extractor';
import { buildFoundationFrame } from './foundationFrame';
```

Add a case to the message switch:

```ts
    case 'renderFoundation': {
      try {
        // Re-extract rather than trusting the UI's dump: the file may have
        // changed since the tab was populated.
        const fileKey = resolveFileKey().key;
        const dump = await serializeFoundation(
          foundationReader, fileKey, new Date().toISOString(),
        );
        const spec = buildFoundation(dump);
        const units = planFoundationUnits(spec, msg.selection);

        let created = 0;
        let replaced = 0;
        let x = 0;
        let y = 0;

        // Place the set to the right of everything already on the page so a
        // generated set never lands on top of existing work.
        for (const child of figma.currentPage.children) {
          if ('x' in child && 'width' in child) {
            const c = child as SceneNode & { x: number; width: number; y: number };
            x = Math.max(x, c.x + c.width + 120);
            y = Math.min(y, c.y);
          }
        }

        for (let i = 0; i < units.length; i++) {
          const unit = units[i];
          const content = unitContent(spec, unit.scope);
          if (!content) continue;

          const section = await buildFoundationFrame(
            content, unit, resolveTheme(brandTheme),
            msg.config.includeDescriptions, i, units.length,
          );
          figma.currentPage.appendChild(section);
          section.x = x;
          section.y = y;
          x += section.width + 80;
          created++;

          figma.ui.postMessage({
            type: 'foundationProgress', done: i + 1, total: units.length,
          } as MainToUi);
        }

        figma.ui.postMessage({ type: 'foundationDone', created, replaced } as MainToUi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'foundationFrameError', message } as MainToUi);
      }
      break;
    }
```

Task 12 replaces the `created`/`replaced` bookkeeping with link stamping and in-place replacement. Leave `replaced` at 0 here.

- [ ] **Step 3: Wire the UI**

In `ui.ts`, on `foundationCreate` click, post (using Task 7's exported getter and the real post-helper name):

```ts
post({
  type: 'renderFoundation',
  selection: currentFoundationSelection(),
  config: { includeDescriptions: true, aiNotes: false },
});
```

`includeDescriptions` is hardcoded true because v1 has no descriptions checkbox in the tab: descriptions render whenever a unit has them, and `buildFoundationFrame` already suppresses the column when none do. The flag is stored in the link config so phase 5's markdown renderer and a later checkbox both read the same field. `aiNotes` is always false until phase 6.

Match the existing post helper's actual name:

Run: `grep -n "parent.postMessage\|function post" packages/plugin/src/ui/actions.ts packages/plugin/src/ui/ui.ts`

Handle `foundationProgress` by painting `Creating ${done} of ${total}.` into `foundationNotes`, `foundationDone` by painting `Created ${created} foundation frames.` (or `Updated ${replaced} foundation frames.` when `replaced > 0`), and `foundationFrameError` by painting `Could not create the foundation frames. ${message}`.

Disable `foundationCreate` while a generation is in flight and re-enable it on `foundationDone` or `foundationFrameError`, matching how the component flow guards `docFrameRendering`.

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npm run build:plugin
npx vitest run packages/plugin packages/extractor
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src
git commit -m "feat(plugin): generate foundation frames from the Foundations tab"
```

---

## Task 10: Manual Figma pass for generation

**Files:**
- Create: `docs/manual-tests/2026-07-25-foundation-frames.md`

**Interfaces:**
- Consumes: everything through Task 9.
- Produces: a recorded pass with findings.

Node construction cannot be unit-tested, so this task is the verification gate for Tasks 8 and 9. Follow the format of the existing manual pass added in commit `4073744`.

Run: `git show 4073744 --stat` to find that file and match its structure.

- [ ] **Step 1: Build the plugin**

```bash
npm run build:plugin
```

- [ ] **Step 2: Work the checklist in Figma**

Import the plugin from `packages/plugin/manifest.json` and record pass/fail plus a screenshot reference for each:

- [ ] A file with two collections (single-mode Primitives, two-mode Semantic aliasing it): both frames generate, aliases show `→ target` with the resolved swatch.
- [ ] Descriptions appear for variables that have them; the Description column is absent entirely when no variable in the unit has one.
- [ ] A file with text styles only: the Text styles frame generates, specimens render in their real fonts, and the note about no variable collections shows in the tab.
- [ ] A file with neither: the tab shows `This file has no local variable collections or text styles.` and the create button stays disabled.
- [ ] A collection with more than 150 variables across at least two groups: splits into one frame per group, and each footer reads `Part i of n, covering <group>.`
- [ ] A collection with 6 modes: 4 columns render, mode checkboxes appear, and the footer reads `Modes not shown: …` naming exactly the two omitted.
- [ ] Unchecking a mode and checking a different one swaps the column and keeps collection order.
- [ ] A text style using a font not available locally: the specimen falls back to Inter and the row shows `Font not available, shown in Inter.`
- [ ] An alias into a library collection: shows `→ name (library)` with no swatch and no fabricated value.
- [ ] Generation progress updates rather than appearing frozen on a large file; note the wall-clock time for the largest file tested.
- [ ] Frames land to the right of existing page content, not on top of it.
- [ ] Frames pick up a customized brand theme (header color, fonts, corner style) from Settings.

- [ ] **Step 3: Record findings and commit**

Write the results into the file, including anything that failed and whether it was fixed in this pass or deferred. A pass with no findings recorded is not a pass.

```bash
git add docs/manual-tests/2026-07-25-foundation-frames.md
git commit -m "test(plugin): manual Figma pass for foundation frame generation"
```

- [ ] **Step 4: Fix anything the pass found**

Fix, re-run the relevant unit tests, re-verify in Figma, and amend the findings file. Do not proceed to Task 11 with an open failure.

---

## Task 11: `DocLinkData` union

**Files:**
- Modify: `packages/plugin/src/docLink.ts`
- Modify: `packages/plugin/test/docLink.test.ts`

**Interfaces:**
- Consumes: `FoundationScope` from `@spec-layer/extractor`.
- Produces: `ComponentDocLink`, `FoundationDocLink`, `FoundationConfig`, `DocLinkData` union, `isFoundationLink(d)`, updated `parseDocLink`.

The critical constraint: **a blob with no `kind` must parse byte-identically to today.** Every existing user's generated frames depend on it.

- [ ] **Step 1: Write the failing test**

Append to `packages/plugin/test/docLink.test.ts`:

```ts
import { isFoundationLink, type FoundationDocLink } from '../src/docLink';

const FOUNDATION: FoundationDocLink = {
  v: 1, kind: 'foundation',
  scope: {
    target: 'collection', collectionId: 'c1', collectionName: 'Semantic',
    modeIds: ['s1', 's2'],
  },
  contentHash: 'fhash', selfHash: 'fself',
  config: { includeDescriptions: true, aiNotes: false },
  generatedAt: 1720000000000, pluginVersion: '3.0.0',
};

describe('docLink foundation variant', () => {
  it('round-trips a foundation link', () => {
    expect(parseDocLink(serializeDocLink(FOUNDATION))).toEqual(FOUNDATION);
  });

  it('round-trips a text-styles scope', () => {
    const d: FoundationDocLink = { ...FOUNDATION, scope: { target: 'textStyles', group: 'Heading' } };
    expect(parseDocLink(serializeDocLink(d))).toEqual(d);
  });

  it('parses a legacy blob with no kind exactly as a component link', () => {
    const legacy = parseDocLink(serializeDocLink(DATA));
    expect(legacy).toEqual(DATA);
    expect(isFoundationLink(legacy!)).toBe(false);
    expect(legacy && 'kind' in legacy && legacy.kind).toBeFalsy();
  });

  it('narrows with isFoundationLink', () => {
    expect(isFoundationLink(FOUNDATION)).toBe(true);
    expect(isFoundationLink(DATA)).toBe(false);
  });

  it('rejects a foundation blob with an unknown scope target', () => {
    const raw = JSON.stringify({ ...FOUNDATION, scope: { target: 'bogus' } });
    expect(parseDocLink(raw)).toBeNull();
  });

  it('rejects a foundation blob with a missing scope', () => {
    const noScope = { ...FOUNDATION } as Record<string, unknown>;
    delete noScope.scope;
    expect(parseDocLink(JSON.stringify(noScope))).toBeNull();
  });

  it('rejects a collection scope with a non-string collectionId', () => {
    const raw = JSON.stringify({
      ...FOUNDATION,
      scope: { target: 'collection', collectionId: 7, collectionName: 'X', modeIds: [] },
    });
    expect(parseDocLink(raw)).toBeNull();
  });

  it('filters non-string modeIds instead of rejecting the blob', () => {
    const raw = JSON.stringify({
      ...FOUNDATION,
      scope: { ...FOUNDATION.scope, modeIds: ['s1', 42, 's2'] },
    });
    const parsed = parseDocLink(raw);
    expect(parsed).not.toBeNull();
    expect(isFoundationLink(parsed!) && parsed.scope.target === 'collection'
      && parsed.scope.modeIds).toEqual(['s1', 's2']);
  });

  it('normalizes missing foundation config fields to safe defaults', () => {
    const raw = JSON.stringify({ ...FOUNDATION, config: {} });
    const parsed = parseDocLink(raw);
    expect(isFoundationLink(parsed!) && parsed.config)
      .toEqual({ includeDescriptions: true, aiNotes: false });
  });

  it('does not require sourceNodeId on a foundation blob', () => {
    const raw = JSON.stringify(FOUNDATION);
    expect(raw).not.toContain('sourceNodeId');
    expect(parseDocLink(raw)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/docLink.test.ts`
Expected: FAIL — `isFoundationLink is not exported`.

- [ ] **Step 3: Write the implementation**

In `packages/plugin/src/docLink.ts`, add to the imports:

```ts
import { contentHash, type FoundationScope } from '@spec-layer/extractor';
```

(replacing the existing `import { contentHash } from '@spec-layer/extractor';`)

Replace the `DocLinkData` interface with:

```ts
/** Everything needed to faithfully regenerate a component doc on Update. */
export interface ComponentDocLink {
  v: 1;
  /** Absent on every blob written before foundation support. */
  kind?: 'component';
  sourceNodeId: string;
  contentHash: string;   // specContentHash of the source at generation
  selfHash: string;      // textContentHash of the built Section
  config: DocConfig;
  generatedAt: number;
  pluginVersion: string;
}

export interface FoundationConfig {
  includeDescriptions: boolean;
  aiNotes: boolean;
}

/** A foundation doc has no source node: its source is the file's own
 *  collections, addressed by scope. */
export interface FoundationDocLink {
  v: 1;
  kind: 'foundation';
  scope: FoundationScope;
  contentHash: string;   // foundationContentHash for this scope at generation
  selfHash: string;
  config: FoundationConfig;
  generatedAt: number;
  pluginVersion: string;
}

export type DocLinkData = ComponentDocLink | FoundationDocLink;

export function isFoundationLink(d: DocLinkData): d is FoundationDocLink {
  return d.kind === 'foundation';
}
```

Replace `parseDocLink` with:

```ts
/** Defensive parse: returns null on empty/garbage/wrong-shape (never throws).
 *  Branches on `kind` FIRST so a blob without one takes the original
 *  component path unchanged. */
export function parseDocLink(raw: string): DocLinkData | null {
  if (!raw) return null;
  let j: Record<string, unknown>;
  try { j = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  if (!j || j.v !== 1) return null;
  return j.kind === 'foundation'
    ? parseFoundationLink(j as unknown as Partial<FoundationDocLink>)
    : parseComponentLink(j as unknown as Partial<ComponentDocLink>);
}

function commonValid(j: { contentHash?: unknown; selfHash?: unknown; generatedAt?: unknown; pluginVersion?: unknown }): boolean {
  return typeof j.contentHash === 'string'
    && typeof j.selfHash === 'string'
    && typeof j.generatedAt === 'number'
    && typeof j.pluginVersion === 'string';
}

function parseComponentLink(j: Partial<ComponentDocLink>): ComponentDocLink | null {
  if (
    typeof j.sourceNodeId !== 'string' || !commonValid(j)
    || !j.config || !Array.isArray(j.config.sections)
  ) return null;

  const c = j.config as Partial<DocConfig>;
  const config: DocConfig = {
    sections: (c.sections ?? []).filter((x): x is SectionId => typeof x === 'string'),
    variantIds: Array.isArray(c.variantIds) ? c.variantIds.filter((x): x is string => typeof x === 'string') : [],
    aiEnabled: c.aiEnabled === true,
    anatomyView: c.anatomyView === 'diagram' || c.anatomyView === 'table' || c.anatomyView === 'both' ? c.anatomyView : 'both',
    measureViews: Array.isArray(c.measureViews)
      ? c.measureViews.filter((x): x is MeasureView => x === 'size' || x === 'padding' || x === 'spacing')
      : [],
  };
  return { ...(j as ComponentDocLink), config };
}

function parseScope(raw: unknown): FoundationScope | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;

  if (s.target === 'textStyles') {
    return typeof s.group === 'string'
      ? { target: 'textStyles', group: s.group }
      : { target: 'textStyles' };
  }
  if (s.target === 'collection') {
    if (typeof s.collectionId !== 'string' || typeof s.collectionName !== 'string') return null;
    const modeIds = Array.isArray(s.modeIds)
      ? s.modeIds.filter((x): x is string => typeof x === 'string')
      : [];
    return {
      target: 'collection',
      collectionId: s.collectionId,
      collectionName: s.collectionName,
      ...(typeof s.group === 'string' ? { group: s.group } : {}),
      modeIds,
    };
  }
  return null;
}

function parseFoundationLink(j: Partial<FoundationDocLink>): FoundationDocLink | null {
  if (!commonValid(j)) return null;
  const scope = parseScope(j.scope);
  if (!scope) return null;
  const c = (j.config ?? {}) as Partial<FoundationConfig>;
  return {
    v: 1,
    kind: 'foundation',
    scope,
    contentHash: j.contentHash as string,
    selfHash: j.selfHash as string,
    config: {
      includeDescriptions: c.includeDescriptions !== false,
      aiNotes: c.aiNotes === true,
    },
    generatedAt: j.generatedAt as number,
    pluginVersion: j.pluginVersion as string,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/plugin/test/docLink.test.ts`
Expected: PASS. Every pre-existing test in the file passes unchanged plus 10 new ones. **If any pre-existing test fails, the component path changed and the fix is wrong, not the test.**

- [ ] **Step 5: Fix the resulting type errors in main.ts**

Run: `npm run typecheck`

`requestLibrary` and `requestDocSource` read `data.sourceNodeId` on the union, which no longer typechecks. Narrow with `isFoundationLink(data)`: skip foundation entries for now (Task 12 handles them) with an early `continue` and a comment pointing at Task 12.

- [ ] **Step 6: Commit**

```bash
npm run check
git add packages/plugin/src/docLink.ts packages/plugin/test/docLink.test.ts packages/plugin/src/main.ts
git commit -m "feat(plugin): kind-discriminated DocLinkData with a foundation variant"
```

---

## Task 12: Stamp and list foundation docs

**Files:**
- Modify: `packages/plugin/src/main.ts`
- Modify: `packages/plugin/src/messages.ts`
- Modify: `packages/plugin/src/ui/render.ts`

**Interfaces:**
- Consumes: `FoundationDocLink`, `isFoundationLink` (Task 11); `foundationContentHash` (Task 4); `buildFoundationFrame` (Task 8).
- Produces: `LibraryEntry` gains `kind: 'component' | 'foundation'` and `label: string`; foundation Sections carry `DOC_LINK_KEY` data and join `DocRegistry`.

**Copy strings — verbatim:**
- Library row label: `Foundations · ${title}`

- [ ] **Step 1: Widen `LibraryEntry`**

In `packages/plugin/src/messages.ts`, replace the `LibraryEntry` interface:

```ts
export interface LibraryEntry {
  docId: string;
  /** Which document type this row is. Absent on no rows: always written. */
  kind: 'component' | 'foundation';
  /** Row label. Component: the component name. Foundation: "Foundations · Semantic". */
  label: string;
  componentName: string;
  pageName: string;
  /** '' for foundation docs, which have no source node. */
  sourceNodeId: string;
  sourceExists: boolean;
  selfEdited: boolean;
  storedContentHash: string;
}
```

`componentName` stays so existing render code keeps compiling; set it equal to `label` for foundation rows.

- [ ] **Step 2: Stamp the link when generating**

In `main.ts`'s `renderFoundation` case from Task 9, after `buildFoundationFrame` returns and before `appendChild`, add:

```ts
          const data: FoundationDocLink = {
            v: 1,
            kind: 'foundation',
            scope: unit.scope,
            contentHash: foundationContentHash(spec, unit.scope),
            selfHash: '',   // set below, once the section's text exists
            config: msg.config,
            generatedAt: Date.now(),
            pluginVersion: typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : '',
          };
```

After `appendChild` and positioning, add:

```ts
          data.selfHash = textContentHash(collectText(section));
          section.setPluginData(DOC_LINK_KEY, serializeDocLink(data));
          writeRegistry(addDoc(readRegistry(), section.id));
```

Replace an existing frame for the same scope instead of duplicating. Before the build loop, index the current page's tracked foundation Sections by a scope key:

```ts
        const scopeKey = (s: FoundationScope): string =>
          s.target === 'textStyles'
            ? `text:${s.group ?? ''}`
            : `coll:${s.collectionId}:${s.group ?? ''}`;

        const existingByScope = new Map<string, SectionNode>();
        for (const docId of readRegistry().docIds) {
          let node: BaseNode | null = null;
          try { node = await figma.getNodeByIdAsync(docId); } catch { node = null; }
          if (!node || node.type !== 'SECTION') continue;
          const link = parseDocLink((node as SectionNode).getPluginData(DOC_LINK_KEY));
          if (link && isFoundationLink(link)) {
            existingByScope.set(scopeKey(link.scope), node as SectionNode);
          }
        }
```

Then per unit, after the new section is stamped and placed:

```ts
          const prior = existingByScope.get(scopeKey(unit.scope));
          if (prior) {
            section.x = prior.x;
            section.y = prior.y;
            writeRegistry({
              v: 1, docIds: readRegistry().docIds.filter((id) => id !== prior.id),
            });
            prior.remove();
            replaced++;
          } else {
            created++;
          }
```

Order matters and mirrors the component path: stamp before removing the old one, so a mid-way failure never leaves an unstamped orphan replacing a good doc. Increment `created` only in the else branch, and drop the unconditional `created++` from Task 9.

Add `FoundationScope` and `foundationContentHash` to the `@spec-layer/extractor` import, and `FoundationDocLink`, `isFoundationLink` to the `./docLink` import.

- [ ] **Step 3: List foundation docs**

In the `requestLibrary` case, replace the Task 11 `continue` for foundation links with real entries. The whole loop body becomes:

```ts
        const data = parseDocLink(section.getPluginData(DOC_LINK_KEY));
        if (!data) continue;
        alive.add(docId);
        const selfEdited = textContentHash(collectText(section)) !== data.selfHash;
        const page = pageOf(section);

        if (isFoundationLink(data)) {
          const title = section.name.replace(/^Foundations: /, '');
          entries.push({
            docId,
            kind: 'foundation',
            label: `Foundations · ${title}`,
            componentName: `Foundations · ${title}`,
            pageName: page?.name ?? '',
            sourceNodeId: '',
            // Resolved against a live extraction in Task 13; a tracked
            // foundation doc is never orphaned merely by existing.
            sourceExists: true,
            selfEdited,
            storedContentHash: data.contentHash,
          });
          continue;
        }

        let sourceExists = false;
        try { sourceExists = (await figma.getNodeByIdAsync(data.sourceNodeId)) != null; }
        catch { sourceExists = false; }
        const name = section.name.replace(/: Documentation$/, '');
        entries.push({
          docId,
          kind: 'component',
          label: name,
          componentName: name,
          pageName: page?.name ?? '',
          sourceNodeId: data.sourceNodeId,
          sourceExists,
          selfEdited,
          storedContentHash: data.contentHash,
        });
```

- [ ] **Step 4: Render the rows**

`renderLibrary` (`render.ts:360`) sets the row title from `e.componentName` at line 397 and writes `row.dataset.sourceId = e.sourceNodeId`. Because Task 12 sets `componentName` equal to `label` for foundation rows, the title needs no change — switch line 397 to `e.label` anyway so the intent is explicit:

```ts
    (row.querySelector('.lib-row-title') as HTMLElement).textContent = e.label;
```

The one behavioral change: a foundation row has `sourceNodeId: ''`, so the "go to source component" action in the `⋯` overflow menu must not appear for it. Find where the menu is built and gate that item on `e.kind === 'component'`:

Run: `grep -n "sourceId\|focusNode\|data-act" packages/plugin/src/ui/render.ts packages/plugin/src/ui/ui.ts`

If the overflow menu is built in `ui.ts` from `row.dataset`, add `row.dataset.kind = e.kind` in `renderLibrary` and gate on that instead of threading the entry through.

- [ ] **Step 5: Verify**

```bash
npm run typecheck
npm run build:plugin
npx vitest run packages/plugin packages/extractor
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src
git commit -m "feat(plugin): track foundation frames in the doc registry and My Library"
```

---

## Task 13: Foundation drift detection

**Files:**
- Modify: `packages/plugin/src/main.ts`
- Modify: `packages/plugin/src/messages.ts`
- Modify: `packages/plugin/src/ui/actions.ts`

**Interfaces:**
- Consumes: `foundationContentHash`, `serializeFoundation`, `buildFoundation`, `isFoundationLink`.
- Produces: `LibraryEntry` gains `currentContentHash?: string`; foundation drift resolved server-side in one extraction.

Component drift stays as it is: the UI asks per doc via `requestDrift`. Foundations differ because one extraction answers every foundation row, so `requestLibrary` resolves them inline and reports the current hash directly. That avoids N extractions of the same data.

A foundation doc whose scope no longer resolves is *orphaned*, which is where `sourceExists: false` comes from for these rows.

- [ ] **Step 1: Add the field**

In `messages.ts`, add to `LibraryEntry`:

```ts
  /** Foundation rows only: the live hash for this scope, for drift comparison.
   *  Component rows resolve drift separately via requestDrift. */
  currentContentHash?: string;
```

- [ ] **Step 2: Resolve foundation drift in requestLibrary**

In `main.ts`'s `requestLibrary` case, before the registry loop, extract once — lazily, so a file with no foundation docs pays nothing:

```ts
      let foundationSpec: FoundationSpec | null = null;
      let foundationExtractionFailed = false;
      const liveFoundation = async (): Promise<FoundationSpec | null> => {
        if (foundationSpec || foundationExtractionFailed) return foundationSpec;
        try {
          const dump = await serializeFoundation(
            foundationReader, resolveFileKey().key, new Date().toISOString(),
          );
          foundationSpec = buildFoundation(dump);
        } catch {
          foundationExtractionFailed = true;
        }
        return foundationSpec;
      };
```

In the foundation branch from Task 12, replace the `sourceExists: true` line and add the hash:

```ts
          const live = await liveFoundation();
          const currentContentHash = live
            ? foundationContentHash(live, data.scope)
            : undefined;
          // A scope that no longer resolves is orphaned. unitContent returns
          // null for a deleted collection, and foundationContentHash turns that
          // into a stable sentinel, so compare against the sentinel rather than
          // re-deriving it here.
          const sourceExists = live
            ? unitContent(live, data.scope) !== null
            : true;
```

then use `sourceExists` and `currentContentHash` in the pushed entry.

Add `FoundationSpec` and `unitContent` to the extractor import.

**Rename resolution.** `parseScope` stores `collectionId` and `collectionName`. When the id no longer resolves but a collection with the stored *name* does, retarget the scope to that collection's id before hashing, so a re-created collection is *Update available* rather than orphaned:

```ts
          let scope = data.scope;
          if (live && scope.target === 'collection'
              && !live.collections.some((c) => c.id === scope.collectionId)) {
            const byName = live.collections.find((c) => c.name === scope.collectionName);
            if (byName) scope = { ...scope, collectionId: byName.id };
          }
```

Use `scope` in place of `data.scope` in both calls above.

- [ ] **Step 3: Feed the existing drift map**

`renderLibrary(refs, entries, drift)` already takes a `drift: Map<string, DriftState>` and derives each badge via `rowStatus(e, drift.get(e.docId))` (`render.ts:360-376`). Foundation rows therefore need no new rendering path: pre-populate the same map from `currentContentHash` instead of waiting for a `requestDrift` round trip.

Where the `library` message is handled, before calling `renderLibrary`:

```ts
for (const e of entries) {
  if (e.kind !== 'foundation') continue;
  // Extraction failed → leave the row un-drifted rather than claiming drift we
  // could not actually verify.
  if (e.currentContentHash === undefined) { drift.set(e.docId, 'clean'); continue; }
  drift.set(e.docId, e.currentContentHash === e.storedContentHash ? 'clean' : 'drifted');
}
```

Confirm the real `DriftState` member names first — `'clean' | 'drifted' | 'checking'` is the expectation, not a certainty:

Run: `grep -n "DriftState\|rowStatus" packages/plugin/src/ui/render.ts`

Use the actual names. Because the map is filled before the first paint, foundation rows never flash `Checking…`, which is correct: their drift was already resolved on the main thread.

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npm run build:plugin
npx vitest run packages/plugin packages/extractor
```

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src
git commit -m "feat(plugin): resolve foundation drift from a single live extraction"
```

---

## Task 14: Update, Detach, Remove, and the final pass

**Files:**
- Modify: `packages/plugin/src/main.ts`
- Modify: `packages/plugin/src/ui/actions.ts`
- Create: `docs/manual-tests/2026-07-25-foundation-library.md`
- Modify: `docs/feature-backlog-2026-07.md`
- Modify: `ARCHITECTURE.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `{ type: 'updateFoundationDoc'; docId: string }` (UI→main); Detach and Remove reuse the existing `detachDoc` / `removeDoc` messages unchanged.

Detach and Remove already operate on the Section and the registry without touching `sourceNodeId`, so they need no changes. Verify that rather than assuming it:

Run: `sed -n 510,535p packages/plugin/src/main.ts`

Update needs a foundation path because the component path asks for a source node.

**Copy strings — verbatim:**
- `Updated ${title}.`
- `This foundation doc could no longer be rebuilt. Its collection is gone from this file.`
- `You edited this frame by hand. Updating replaces those edits.`

- [ ] **Step 1: Add the Update handler**

In `messages.ts`, add to `UiToMain`:

```ts
  | { type: 'updateFoundationDoc'; docId: string }
```

In `main.ts`, add the case:

```ts
    case 'updateFoundationDoc': {
      try {
        const node = await figma.getNodeByIdAsync(msg.docId);
        if (!node || node.type !== 'SECTION') {
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId,
            message: 'This doc no longer exists.' } as MainToUi);
          break;
        }
        const prior = node as SectionNode;
        const link = parseDocLink(prior.getPluginData(DOC_LINK_KEY));
        if (!link || !isFoundationLink(link)) {
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId,
            message: 'This doc is no longer linked.' } as MainToUi);
          break;
        }

        const dump = await serializeFoundation(
          foundationReader, resolveFileKey().key, new Date().toISOString(),
        );
        const spec = buildFoundation(dump);

        // Retarget a renamed/re-created collection by name before giving up.
        let scope = link.scope;
        if (scope.target === 'collection'
            && !spec.collections.some((c) => c.id === scope.collectionId)) {
          const byName = spec.collections.find((c) => c.name === scope.collectionName);
          if (byName) scope = { ...scope, collectionId: byName.id };
        }

        const content = unitContent(spec, scope);
        if (!content) {
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId,
            message: 'This foundation doc could no longer be rebuilt. Its collection is gone from this file.' } as MainToUi);
          break;
        }

        const unit: FoundationUnit = {
          scope,
          title: scope.target === 'textStyles'
            ? (scope.group ? `Text styles · ${scope.group}` : 'Text styles')
            : (scope.group ? `${content.collectionName} · ${scope.group}` : content.collectionName),
          rowCount: content.rows.length,
          omittedModeNames: scope.target === 'collection'
            ? (spec.collections.find((c) => c.id === scope.collectionId)?.modes ?? [])
                .filter((m) => !scope.modeIds.includes(m.modeId)).map((m) => m.name)
            : [],
        };

        const section = await buildFoundationFrame(
          content, unit, resolveTheme(brandTheme), link.config.includeDescriptions, 0, 1,
        );

        const data: FoundationDocLink = {
          v: 1, kind: 'foundation', scope,
          contentHash: foundationContentHash(spec, scope),
          selfHash: '',
          config: link.config,
          generatedAt: Date.now(),
          pluginVersion: typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : '',
        };

        const page = pageOf(prior);
        if (page && page.id !== figma.currentPage.id) await figma.setCurrentPageAsync(page);
        (page ?? figma.currentPage).appendChild(section);
        section.x = prior.x;
        section.y = prior.y;

        data.selfHash = textContentHash(collectText(section));
        section.setPluginData(DOC_LINK_KEY, serializeDocLink(data));

        // Point of no return, matching the component path: the new section is
        // stamped and placed before the old one goes.
        let reg = readRegistry();
        reg = { v: 1, docIds: reg.docIds.filter((id) => id !== prior.id) };
        prior.remove();
        writeRegistry(addDoc(reg, section.id));

        figma.ui.postMessage({
          type: 'foundationDone', created: 0, replaced: 1,
        } as MainToUi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message } as MainToUi);
      }
      break;
    }
```

Add `FoundationUnit` to the extractor import.

- [ ] **Step 2: Route the UI's Update button**

In `actions.ts`, where the library row's Update button posts `requestDocSource`, branch on `entry.kind`: foundation rows post `{ type: 'updateFoundationDoc', docId }` instead. Keep the existing hand-edit confirmation, using `You edited this frame by hand. Updating replaces those edits.`

- [ ] **Step 3: Verify Detach and Remove need no change**

Run: `npx vitest run packages/plugin && npm run typecheck && npm run build:plugin`

Then confirm by reading `main.ts`'s `detachDoc` / `removeDoc` cases that neither reads `sourceNodeId`. If either does, narrow it the same way `requestLibrary` was narrowed.

- [ ] **Step 4: Manual Figma pass for the library flows**

Create `docs/manual-tests/2026-07-25-foundation-library.md` and record:

- [ ] A generated foundation set appears in My Library, one row per frame, labelled `Foundations · <title>`.
- [ ] Badge reads In sync immediately after generation.
- [ ] Adding a variable to a documented collection flips only that collection's row to Update available; other rows stay In sync.
- [ ] Renaming a variable flips the row to Update available.
- [ ] Renaming the *collection* flips the row to Update available, not Source missing.
- [ ] Deleting the collection flips the row to Source missing, and Update reports that it could not be rebuilt.
- [ ] Hand-editing text in the frame flips the row to Manually edited, and Update warns before replacing.
- [ ] Update rebuilds in place: same position, same page, single frame, registry not duplicated.
- [ ] Update after a collection rename retargets by name and rebuilds with the new name in the header.
- [ ] Detach leaves the frame and drops the row.
- [ ] Remove deletes the frame and drops the row.
- [ ] Regenerating from the Foundations tab replaces the existing frames in place rather than duplicating them, and the toast reads `Updated N foundation frames.`
- [ ] Component docs in the same file still show correct badges and still Update correctly. **This is the regression check that the `DocLinkData` union did no harm.**
- [ ] A file whose docs were generated before this branch (component docs with no `kind`) still lists and updates.

- [ ] **Step 5: Update the docs**

`ARCHITECTURE.md` — in the `@spec-layer/extractor` section, note that `foundation.ts` models variable collections and text styles and that `unitContent` is the single source of rendered rows for both the hash and the renderers. In the `@spec-layer/plugin` section, note the Foundations tab and that foundation Sections join the same doc registry.

Also record the one piece of deliberate duplication this branch leaves behind: `frameKit.applyThemeToKit` (Task 8) and the inline theme preamble in `buildDocFrames` do the same job. Migrating `docFrame` onto the shared helper was kept out of this branch to avoid restructuring a 1279-line file mid-feature. Note it as a follow-up so the two cannot quietly drift apart unnoticed.

`CHANGELOG.md` — add an entry for foundation export. Note the CHANGELOG currently stops at v1.0.0 (backlog item 0.3); add this entry without trying to backfill the gap.

`docs/feature-backlog-2026-07.md` — add the foundation export item with its tier placement, marked built for phases 1 through 4 with phases 5 and 6 pending, and cross-reference 2.2 (shares `codeSyntax` capture), 3.3 (effects are the natural next source), and 4.1 (foundation hashes give `spec-layer check` a file-level baseline).

- [ ] **Step 6: Full verification and commit**

```bash
npm run check
```

Expected: lint, typecheck, tests, web build, and plugin build all pass.

```bash
git add -A
git commit -m "feat(plugin): update, detach, and remove foundation docs"
```

- [ ] **Step 7: Request review**

Use the `superpowers:requesting-code-review` skill for a holistic review of the whole branch before merging. The prior branch's final review hit a session limit before completing (backlog 2.1) — budget for it.

---

## Coverage note

This plan adds roughly 1,100 lines of source and 900 lines of test across `foundation.ts`, `serializeFoundation.ts`, `foundationState.ts`, `foundationFrame.ts`, and `docLink.ts`. The heavily-tested pure modules should push coverage up, not down. If `npm run check` fails on the coverage ratchet, the cause is untested branches in the new pure modules — add the missing tests. Do not lower the thresholds.
