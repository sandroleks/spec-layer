# Component Versioning and Dev Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every generated doc a per-component revision history with a deterministic "what changed" diff, optional named releases, and a dev-readiness state that automatically expires when the source component changes.

**Architecture:** Two new pure modules carry all the logic. `packages/extractor/src/fingerprint.ts` derives a compact canonical summary of an `IntermediateSpec` and diffs two summaries into typed `Change` records. `packages/plugin/src/docHistory.ts` owns the per-doc history blob: append, retention, promotion, readiness resolution. Neither touches the Figma runtime, mirroring the existing `docLink.ts` / extractor purity boundary. `main.ts` reads and writes a new pluginData key, and three thin surfaces render the result: the doc frame header, the My Library panel, and Markdown frontmatter.

**Tech Stack:** TypeScript, Vitest, Figma Plugin API, npm workspaces.

## Global Constraints

- **Never touch `specContentHash`** ([`packages/extractor/src/hash.ts:29`](../../../packages/extractor/src/hash.ts)). Any change flips `content_hash` on every already-committed spec.
- **Never modify the existing `specLayerDoc` pluginData blob or `DocLinkData`.** History lives under a separate key so the link blob stays byte-identical.
- **Never add a value to `SpecFrontmatter.status`.** It is validated against a closed list at [`frontmatter.ts:15`](../../../packages/format/src/frontmatter.ts) and older parsers throw on unknown values. New optional *keys* are fine.
- **No new Markdown body sections.** The body contract is frozen. Frontmatter keys only.
- **Never write to source components.** The plugin writes only to frames it created. No `description` or `name` mutation on library components.
- **No network, no AI, no quota** anywhere in this feature. Every diff is deterministic.
- **pluginData limit is 100 kB per `(pluginId, key, value)` entry**, enforced by Figma. Budget ceiling for history is `HISTORY_BYTE_LIMIT = 90_000` UTF-8 bytes.
- **UI copy follows [`docs/plugin-voice-and-copy.md`](../../plugin-voice-and-copy.md):** plain, honest, peer tone, and **no em dashes** in any user-visible string.
- **Verification command:** `npm run check` (lint, typecheck, tests, both builds). Individual suites via `npx vitest run <path>`.

## Deviations from the spec, and why

Three corrections found while reading the real types. All three *narrow* the spec's known-limitation 3 rather than widening it, but they are deviations and should be reviewed as such.

1. **`metrics: Record<string, number>` becomes `layout: Record<string, string>`.** The spec assumed numeric measurements. The real field is `LayoutSummary { part, summary }` ([`layout.ts:4`](../../../packages/extractor/src/layout.ts)) where `summary` is already a compact digest like `"vertical, padding 8/16/8/16, gap 4, radius 8"`. Extracting numbers from it would mean parsing that string, which is fragile. Storing the digest verbatim is deterministic and diffs into a readable sentence.
2. **`state` and `prop` are added as change areas.** `spec.states` and `spec.props` are first-class fields, both covered by `specContentHash`, and the spec's own UI copy table already promised the sentence "Removed Loading state". Omitting them would have produced empty diffs for real changes.
3. **`Change.from` / `Change.to` are `string` only**, not `string | number`, since every fingerprint value is now a string.

Net fingerprint coverage: `variants`, `states`, `props`, `parts`, `tokens`, `layout`. Deliberately excluded: `name`, `figmaKey`, `figmaFile`, `figmaNode`, `anatomyComponentId` (identity and node ids, not content), `variantInstances` (node ids derived from `variants`), `related` and `gaps` (derived). A change confined to the excluded set still moves `specContentHash` and yields an empty diff, which Task 8 renders honestly.

## File Structure

| File | Responsibility |
|---|---|
| `packages/extractor/src/fingerprint.ts` (create) | `Fingerprint` type, `fingerprint()`, `diffFingerprints()`, `describeChange()`, `hasRemovals()`. Pure. |
| `packages/extractor/src/index.ts` (modify) | Re-export the new module. |
| `packages/extractor/test/fingerprint.test.ts` (create) | Canonicality, diff coverage, sentence stability. |
| `packages/plugin/src/docHistory.ts` (create) | `DocHistory` blob: types, serialize/parse, `appendRevision`, retention, `promote`, `setReadiness`, `resolveReadiness`, `diffRevisions`, `formatVersionLine`. Pure, Figma-free. |
| `packages/plugin/test/docHistory.test.ts` (create) | Parse defence, append idempotency, retention, readiness expiry. |
| `packages/plugin/src/main.ts` (modify) | Read/write the `specLayerHistory` key at the generate and update sites; include history in the library payload. |
| `packages/plugin/src/messages.ts` (modify) | Carry history on `LibraryEntry`; add readiness and release request messages. |
| `packages/plugin/src/brandHeader.ts` (modify) | Optional `versionLine` rendered in the band. |
| `packages/plugin/src/docFrame.ts` (modify) | Pass the version line through. |
| `packages/plugin/src/ui/viewModel/library.ts` (modify) | Fill the existing `changeGroups` slot; add readiness and timeline fields. |
| `packages/plugin/src/ui/screens/library.ts` (modify) | Render timeline, readiness badge, actions. |
| `packages/extractor/src/render.ts` (modify) | Accept and emit `version` / `revision` frontmatter. |
| `packages/format/src/types.ts` (modify) | Two new optional frontmatter keys. |

Tasks 1 through 6 form a shippable core: history is recorded and correct but not yet visible. Tasks 7 through 10 are the surfaces. If you want to land this in two branches, cut between 6 and 7.

---

### Task 1: Fingerprint type and derivation

**Files:**
- Create: `packages/extractor/src/fingerprint.ts`
- Modify: `packages/extractor/src/index.ts`
- Test: `packages/extractor/test/fingerprint.test.ts`

**Interfaces:**
- Consumes: `IntermediateSpec` from `./extract`, `AnatomyPart` from `./anatomy`, `TokenRule` from `./tokens`, `LayoutSummary` from `./layout`, `ComponentProp` / `VariantAxis` from `./props`.
- Produces: `interface Fingerprint`, `function fingerprint(spec: IntermediateSpec): Fingerprint`. Task 2 diffs these. Task 4 stores them.

- [ ] **Step 1: Write the failing test**

Create `packages/extractor/test/fingerprint.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fingerprint, type Fingerprint } from '../src/fingerprint';
import type { IntermediateSpec } from '../src/extract';

/** Minimal spec with every fingerprinted field populated. */
function spec(over: Partial<IntermediateSpec> = {}): IntermediateSpec {
  return {
    name: 'Button', figmaKey: 'k', figmaFile: 'f', figmaNode: '1:1',
    anatomy: [
      { id: '1:2', name: 'Label', type: 'TEXT', nested: false, depth: 0 },
      { id: '1:3', name: 'Icon', type: 'INSTANCE', nested: true, depth: 0 },
      { id: '1:4', name: 'Deep', type: 'FRAME', nested: false, depth: 1 },
    ],
    anatomyComponentId: '1:1',
    props: [{ name: 'isLoading', kind: 'boolean' }, { name: 'Size', kind: 'variant', options: ['S', 'M'] }],
    variants: [{ prop: 'Size', values: ['M', 'S'] }],
    variantInstances: [],
    states: ['Hover', 'Default'],
    tokens: [
      { part: 'Label', property: 'fill', conditions: {}, token: 'text-default' },
      { part: 'Root', property: 'padding', conditions: { Size: ['S'] }, token: 'space-sm' },
    ],
    related: [], gaps: [],
    layout: [{ part: 'Root', summary: 'vertical, padding 8/16/8/16, gap 4' }],
    rawValues: [],
    ...over,
  };
}

describe('fingerprint', () => {
  it('flattens variants, sorts every array, and keeps depth-0 parts only', () => {
    const fp = fingerprint(spec());
    expect(fp.v).toBe(1);
    expect(fp.variants).toEqual(['Size=M', 'Size=S']);
    expect(fp.states).toEqual(['Default', 'Hover']);
    expect(fp.props).toEqual(['Size:variant', 'isLoading:boolean']);
    expect(fp.parts).toEqual(['Icon', 'Label']);
  });

  it('keys tokens by part.property, with sorted conditions when present', () => {
    const fp = fingerprint(spec());
    expect(fp.tokens).toEqual({
      'Label.fill': 'text-default',
      'Root.padding[Size=S]': 'space-sm',
    });
  });

  it('keys layout by part and keeps the summary verbatim', () => {
    expect(fingerprint(spec()).layout).toEqual({
      Root: 'vertical, padding 8/16/8/16, gap 4',
    });
  });

  it('is canonical: reordered inputs produce an identical fingerprint', () => {
    const a = fingerprint(spec());
    const b = fingerprint(spec({
      variants: [{ prop: 'Size', values: ['S', 'M'] }],
      states: ['Default', 'Hover'],
      props: [{ name: 'Size', kind: 'variant', options: ['M', 'S'] }, { name: 'isLoading', kind: 'boolean' }],
      anatomy: [
        { id: '1:3', name: 'Icon', type: 'INSTANCE', nested: true, depth: 0 },
        { id: '1:2', name: 'Label', type: 'TEXT', nested: false, depth: 0 },
      ],
      tokens: [
        { part: 'Root', property: 'padding', conditions: { Size: ['S'] }, token: 'space-sm' },
        { part: 'Label', property: 'fill', conditions: {}, token: 'text-default' },
      ],
    }));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('produces empty collections rather than throwing on an empty spec', () => {
    const fp: Fingerprint = fingerprint(spec({
      anatomy: [], props: [], variants: [], states: [], tokens: [], layout: [],
    }));
    expect(fp).toEqual({ v: 1, variants: [], states: [], props: [], parts: [], tokens: {}, layout: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/fingerprint.test.ts`
Expected: FAIL — cannot resolve `../src/fingerprint`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/extractor/src/fingerprint.ts`:

```ts
/**
 * fingerprint.ts — a compact, canonical summary of a spec, sufficient to diff
 * but deliberately not sufficient to rebuild.
 *
 * Pure: no Figma runtime, fixture-testable, same boundary the rest of the
 * extractor keeps. Stored per revision by the plugin's docHistory, so it must
 * stay small (target well under 2 kB) and byte-stable for identical input.
 *
 * Coverage is a deliberate subset of what specContentHash covers: variants,
 * states, props, depth-0 parts, token bindings, and layout digests. Identity
 * fields (name, keys, node ids), derived fields (variantInstances, related,
 * gaps), and rawValues are excluded. A change confined to the excluded set
 * moves the hash and yields an empty diff, which callers must report honestly
 * rather than as "no changes".
 */
import type { IntermediateSpec } from './extract';
import type { TokenRule } from './tokens';

export interface Fingerprint {
  v: 1;
  /** Sorted "Prop=Value" across every variant axis. */
  variants: string[];
  /** Sorted state names. */
  states: string[];
  /** Sorted "name:kind" for every component property. */
  props: string[];
  /** Sorted depth-0 anatomy part names. */
  parts: string[];
  /** Token binding key to token name, keys in sorted insertion order. */
  tokens: Record<string, string>;
  /** Part name to layout digest, keys in sorted insertion order. */
  layout: Record<string, string>;
}

/**
 * Canonical key for one token rule. Conditions are included because the same
 * part and property can bind different tokens under different variant
 * conditions, and collapsing them would hide a real change.
 */
function tokenKey(r: TokenRule): string {
  const cond = Object.keys(r.conditions).sort()
    .map((k) => `${k}=${[...r.conditions[k]].sort().join('|')}`)
    .join(';');
  return cond ? `${r.part}.${r.property}[${cond}]` : `${r.part}.${r.property}`;
}

/**
 * Build a record with keys inserted in sorted order. String-keyed objects
 * preserve insertion order, so this makes JSON.stringify output canonical
 * without relying on the caller to sort. Ties on key are broken by value so a
 * duplicate key is still deterministic.
 */
function sortedRecord(entries: readonly [string, string][]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of [...entries].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))) {
    out[k] = v;
  }
  return out;
}

export function fingerprint(spec: IntermediateSpec): Fingerprint {
  return {
    v: 1,
    variants: spec.variants
      .flatMap((axis) => axis.values.map((v) => `${axis.prop}=${v}`))
      .sort((a, b) => a.localeCompare(b)),
    states: [...spec.states].sort((a, b) => a.localeCompare(b)),
    props: spec.props
      .map((p) => `${p.name}:${p.kind}`)
      .sort((a, b) => a.localeCompare(b)),
    // Depth-0 only, matching specContentHash's projection so the fingerprint
    // and the drift baseline agree about what counts as structure.
    parts: spec.anatomy
      .filter((p) => p.depth === 0)
      .map((p) => p.name)
      .sort((a, b) => a.localeCompare(b)),
    tokens: sortedRecord(spec.tokens.map((r) => [tokenKey(r), r.token] as [string, string])),
    layout: sortedRecord(spec.layout.map((l) => [l.part, l.summary] as [string, string])),
  };
}
```

- [ ] **Step 4: Export it**

In `packages/extractor/src/index.ts`, add after the `export * from './extract';` line:

```ts
export * from './fingerprint';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/extractor/test/fingerprint.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add packages/extractor/src/fingerprint.ts packages/extractor/src/index.ts packages/extractor/test/fingerprint.test.ts
git commit -m "feat(extractor): canonical spec fingerprint for revision diffing"
```

---

### Task 2: Fingerprint diff and sentences

**Files:**
- Modify: `packages/extractor/src/fingerprint.ts`
- Test: `packages/extractor/test/fingerprint.test.ts`

**Interfaces:**
- Consumes: `Fingerprint` from Task 1.
- Produces: `type ChangeKind`, `type ChangeArea`, `interface Change`, `function diffFingerprints(from: Fingerprint, to: Fingerprint): Change[]`, `function describeChange(c: Change): string`, `function hasRemovals(changes: readonly Change[]): boolean`. Task 5 and Task 8 consume all four.

- [ ] **Step 1: Write the failing test**

Append to `packages/extractor/test/fingerprint.test.ts`:

```ts
import { diffFingerprints, describeChange, hasRemovals, type Change } from '../src/fingerprint';

const BASE: Fingerprint = {
  v: 1,
  variants: ['Size=M', 'Size=S'],
  states: ['Default', 'Hover'],
  props: ['Size:variant'],
  parts: ['Icon', 'Label'],
  tokens: { 'Label.fill': 'text-default', 'Root.padding': 'padding-md' },
  layout: { Root: 'vertical, gap 4' },
};

describe('diffFingerprints', () => {
  it('returns an empty array for identical fingerprints', () => {
    expect(diffFingerprints(BASE, BASE)).toEqual([]);
  });

  it('detects additions and removals across array areas', () => {
    const to: Fingerprint = {
      ...BASE,
      variants: ['Size=M', 'Size=S', 'Size=XL'],
      states: ['Default'],
      props: ['Size:variant', 'isLoading:boolean'],
      parts: ['Label'],
    };
    expect(diffFingerprints(BASE, to)).toEqual<Change[]>([
      { kind: 'added', area: 'variant', label: 'Size=XL' },
      { kind: 'removed', area: 'state', label: 'Hover' },
      { kind: 'added', area: 'prop', label: 'isLoading:boolean' },
      { kind: 'removed', area: 'part', label: 'Icon' },
    ]);
  });

  it('detects added, removed and changed values across record areas', () => {
    const to: Fingerprint = {
      ...BASE,
      tokens: { 'Label.fill': 'text-muted', 'Icon.fill': 'icon-default' },
      layout: { Root: 'vertical, gap 8' },
    };
    expect(diffFingerprints(BASE, to)).toEqual<Change[]>([
      { kind: 'added', area: 'token', label: 'Icon.fill', to: 'icon-default' },
      { kind: 'changed', area: 'token', label: 'Label.fill', from: 'text-default', to: 'text-muted' },
      { kind: 'removed', area: 'token', label: 'Root.padding', from: 'padding-md' },
      { kind: 'changed', area: 'layout', label: 'Root', from: 'vertical, gap 4', to: 'vertical, gap 8' },
    ]);
  });

  it('orders changes by area then label, deterministically', () => {
    const to: Fingerprint = { ...BASE, variants: [...BASE.variants, 'Size=XL', 'Size=L'] };
    expect(diffFingerprints(BASE, to).map((c) => c.label)).toEqual(['Size=L', 'Size=XL']);
  });
});

describe('hasRemovals', () => {
  it('is true only when a removal is present', () => {
    expect(hasRemovals([{ kind: 'added', area: 'variant', label: 'Size=XL' }])).toBe(false);
    expect(hasRemovals([{ kind: 'changed', area: 'token', label: 'a', from: 'x', to: 'y' }])).toBe(false);
    expect(hasRemovals([{ kind: 'removed', area: 'part', label: 'Icon' }])).toBe(true);
    expect(hasRemovals([])).toBe(false);
  });
});

describe('describeChange', () => {
  it('renders a stable sentence for every area and kind', () => {
    const cases: [Change, string][] = [
      [{ kind: 'added', area: 'variant', label: 'Size=XL' }, 'Added variant Size=XL'],
      [{ kind: 'removed', area: 'variant', label: 'Size=XL' }, 'Removed variant Size=XL'],
      [{ kind: 'added', area: 'state', label: 'Loading' }, 'Added state Loading'],
      [{ kind: 'removed', area: 'state', label: 'Loading' }, 'Removed state Loading'],
      [{ kind: 'added', area: 'prop', label: 'isLoading:boolean' }, 'Added property isLoading:boolean'],
      [{ kind: 'removed', area: 'prop', label: 'isLoading:boolean' }, 'Removed property isLoading:boolean'],
      [{ kind: 'added', area: 'part', label: 'Icon' }, 'Added part Icon'],
      [{ kind: 'removed', area: 'part', label: 'Icon' }, 'Removed part Icon'],
      [{ kind: 'added', area: 'token', label: 'Icon.fill', to: 'icon-default' }, 'Icon.fill now uses icon-default'],
      [{ kind: 'removed', area: 'token', label: 'Root.padding', from: 'padding-md' }, 'Root.padding no longer uses a token'],
      [{ kind: 'changed', area: 'token', label: 'Label.fill', from: 'padding-md', to: 'padding-lg' }, 'Label.fill changed from padding-md to padding-lg'],
      [{ kind: 'added', area: 'layout', label: 'Root', to: 'gap 4' }, 'Added layout for Root'],
      [{ kind: 'removed', area: 'layout', label: 'Root', from: 'gap 4' }, 'Removed layout for Root'],
      [{ kind: 'changed', area: 'layout', label: 'Root', from: 'gap 4', to: 'gap 8' }, 'Root layout changed from gap 4 to gap 8'],
    ];
    for (const [c, expected] of cases) expect(describeChange(c)).toBe(expected);
  });

  it('never emits an em dash', () => {
    const all: Change[] = [
      { kind: 'added', area: 'variant', label: 'a' },
      { kind: 'changed', area: 'token', label: 'a', from: 'x', to: 'y' },
      { kind: 'removed', area: 'layout', label: 'a', from: 'x' },
    ];
    for (const c of all) expect(describeChange(c)).not.toContain('—');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/extractor/test/fingerprint.test.ts`
Expected: FAIL — `diffFingerprints` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/extractor/src/fingerprint.ts`:

```ts
export type ChangeKind = 'added' | 'removed' | 'changed';
export type ChangeArea = 'variant' | 'state' | 'prop' | 'part' | 'token' | 'layout';

export interface Change {
  kind: ChangeKind;
  area: ChangeArea;
  label: string;
  /** Previous value. Set on `removed` and `changed` for record areas only. */
  from?: string;
  /** New value. Set on `added` and `changed` for record areas only. */
  to?: string;
}

/** Fixed area order, so a diff of the same pair is always byte-identical. */
const ARRAY_AREAS: readonly (readonly ['variant' | 'state' | 'prop' | 'part', keyof Fingerprint])[] = [
  ['variant', 'variants'],
  ['state', 'states'],
  ['prop', 'props'],
  ['part', 'parts'],
];

const RECORD_AREAS: readonly (readonly ['token' | 'layout', keyof Fingerprint])[] = [
  ['token', 'tokens'],
  ['layout', 'layout'],
];

function diffArray(area: Change['area'], from: readonly string[], to: readonly string[]): Change[] {
  const a = new Set(from);
  const b = new Set(to);
  const out: Change[] = [];
  for (const label of [...to].filter((x) => !a.has(x)).sort((x, y) => x.localeCompare(y))) {
    out.push({ kind: 'added', area, label });
  }
  for (const label of [...from].filter((x) => !b.has(x)).sort((x, y) => x.localeCompare(y))) {
    out.push({ kind: 'removed', area, label });
  }
  return out;
}

function diffRecord(
  area: Change['area'],
  from: Record<string, string>,
  to: Record<string, string>,
): Change[] {
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])]
    .sort((a, b) => a.localeCompare(b));
  const out: Change[] = [];
  for (const label of keys) {
    const prev = from[label];
    const next = to[label];
    if (prev === next) continue;
    if (prev === undefined) out.push({ kind: 'added', area, label, to: next });
    else if (next === undefined) out.push({ kind: 'removed', area, label, from: prev });
    else out.push({ kind: 'changed', area, label, from: prev, to: next });
  }
  return out;
}

/**
 * Typed changes between two fingerprints, in a fixed area order and sorted by
 * label within each area. An empty result means the fingerprinted projection is
 * identical, which is NOT the same as "the component did not change": a change
 * outside the projection moves specContentHash and lands here as `[]`. Callers
 * must say so rather than reporting no changes.
 */
export function diffFingerprints(from: Fingerprint, to: Fingerprint): Change[] {
  const out: Change[] = [];
  for (const [area, key] of ARRAY_AREAS) {
    out.push(...diffArray(area, from[key] as string[], to[key] as string[]));
  }
  for (const [area, key] of RECORD_AREAS) {
    out.push(...diffRecord(area, from[key] as Record<string, string>, to[key] as Record<string, string>));
  }
  return out;
}

/** Removals are the signature of a breaking change. Advisory only. */
export function hasRemovals(changes: readonly Change[]): boolean {
  return changes.some((c) => c.kind === 'removed');
}

const NOUN: Record<ChangeArea, string> = {
  variant: 'variant', state: 'state', prop: 'property', part: 'part',
  token: 'token', layout: 'layout',
};

/** Deterministic sentence for one change. No em dashes (voice guide). */
export function describeChange(c: Change): string {
  if (c.area === 'token') {
    if (c.kind === 'added') return `${c.label} now uses ${c.to}`;
    if (c.kind === 'removed') return `${c.label} no longer uses a token`;
    return `${c.label} changed from ${c.from} to ${c.to}`;
  }
  if (c.area === 'layout') {
    if (c.kind === 'added') return `Added layout for ${c.label}`;
    if (c.kind === 'removed') return `Removed layout for ${c.label}`;
    return `${c.label} layout changed from ${c.from} to ${c.to}`;
  }
  const verb = c.kind === 'added' ? 'Added' : 'Removed';
  return `${verb} ${NOUN[c.area]} ${c.label}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/extractor/test/fingerprint.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add packages/extractor/src/fingerprint.ts packages/extractor/test/fingerprint.test.ts
git commit -m "feat(extractor): deterministic fingerprint diff and change sentences"
```

---

### Task 3: History blob types, serialize, defensive parse

**Files:**
- Create: `packages/plugin/src/docHistory.ts`
- Test: `packages/plugin/test/docHistory.test.ts`

**Interfaces:**
- Consumes: `Fingerprint` from `@spec-layer/extractor` (Task 1).
- Produces: `DOC_HISTORY_KEY`, `interface Release`, `interface Revision`, `interface RevisionStub`, `type Readiness`, `interface ReadinessMark`, `interface DocHistory`, `function isStub`, `function serializeHistory`, `function parseHistory`, `function currentRev`, `function utf8Length`. Tasks 4, 5, 6, 7, 8 all consume these.

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/docHistory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Fingerprint } from '@spec-layer/extractor';
import {
  serializeHistory, parseHistory, isStub, currentRev, utf8Length,
  type DocHistory, type Revision,
} from '../src/docHistory';

const FP: Fingerprint = {
  v: 1, variants: ['Size=M'], states: [], props: [], parts: ['Label'],
  tokens: { 'Label.fill': 'text-default' }, layout: {},
};

const REV: Revision = { n: 1, at: 1720000000000, hash: 'h1', pluginVersion: '3.0.0', fp: FP };

describe('history serialization', () => {
  it('round-trips a history with a full revision', () => {
    const h: DocHistory = { v: 1, revs: [REV] };
    expect(parseHistory(serializeHistory(h))).toEqual(h);
  });

  it('round-trips stubs, releases and a readiness mark', () => {
    const h: DocHistory = {
      v: 1,
      revs: [
        { n: 1, at: 1, hash: 'h1' },
        { n: 2, at: 2, hash: 'h2', release: { version: '2.0.0', breaking: true, at: 2 } },
        { ...REV, n: 3 },
      ],
      readiness: { state: 'approved', atRev: 3 },
    };
    expect(parseHistory(serializeHistory(h))).toEqual(h);
  });

  it('returns an empty history on empty, garbage and wrong shapes, never throwing', () => {
    const empty: DocHistory = { v: 1, revs: [] };
    expect(parseHistory('')).toEqual(empty);
    expect(parseHistory('not json')).toEqual(empty);
    expect(parseHistory(JSON.stringify({ v: 2, revs: [] }))).toEqual(empty);
    expect(parseHistory(JSON.stringify({ v: 1, revs: 'nope' }))).toEqual(empty);
    expect(parseHistory(JSON.stringify(null))).toEqual(empty);
  });

  it('drops malformed revisions but keeps the good ones', () => {
    const parsed = parseHistory(JSON.stringify({
      v: 1,
      revs: [REV, { n: 'two', at: 2, hash: 'h2' }, { n: 3, at: 3 }, { n: 4, at: 4, hash: 'h4' }],
    }));
    expect(parsed.revs.map((r) => r.n)).toEqual([1, 4]);
  });

  it('drops a readiness mark with an unrecognized state', () => {
    const parsed = parseHistory(JSON.stringify({
      v: 1, revs: [REV], readiness: { state: 'shipped', atRev: 1 },
    }));
    expect(parsed.readiness).toBeUndefined();
  });
});

describe('isStub / currentRev', () => {
  it('distinguishes stubs from full revisions', () => {
    expect(isStub({ n: 1, at: 1, hash: 'h' })).toBe(true);
    expect(isStub(REV)).toBe(false);
  });
  it('reports the newest revision number, or 0 when empty', () => {
    expect(currentRev({ v: 1, revs: [] })).toBe(0);
    expect(currentRev({ v: 1, revs: [REV, { ...REV, n: 7 }] })).toBe(7);
  });
});

describe('utf8Length', () => {
  it('counts bytes, not UTF-16 code units', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('中')).toBe(3);
    expect(utf8Length('🙂')).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/docHistory.test.ts`
Expected: FAIL — cannot resolve `../src/docHistory`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/plugin/src/docHistory.ts`:

```ts
/**
 * docHistory.ts — the pure, Figma-free data model for per-doc revision history.
 *
 * Owns the `specLayerHistory` pluginData blob: revisions, releases, and the
 * readiness mark. Deliberately a SEPARATE key from `specLayerDoc` so the
 * existing DocLinkData blob stays byte-identical and history gets its own
 * 100 kB Figma entry budget.
 *
 * No Figma globals: the main thread reads and writes nodes and calls into these
 * helpers, mirroring docLink.ts.
 */
import type { Fingerprint } from '@spec-layer/extractor';

/** pluginData key on each generated Section, alongside DOC_LINK_KEY. */
export const DOC_HISTORY_KEY = 'specLayerHistory';

/** A deliberate, designer-cut named version. Free-form: semver is suggested in
 *  the UI, never enforced, because teams disagree about semver inside Figma. */
export interface Release {
  version: string;
  breaking: boolean;
  notes?: string;
  at: number;
}

/** A revision that still carries its fingerprint and can therefore be diffed. */
export interface Revision {
  n: number;
  at: number;
  hash: string;
  pluginVersion: string;
  fp: Fingerprint;
  release?: Release;
}

/** A pruned revision: timeline only, no longer diffable. */
export interface RevisionStub {
  n: number;
  at: number;
  hash: string;
  release?: Release;
}

export type AnyRevision = Revision | RevisionStub;

/** Reuses SpecFrontmatter's closed status enum verbatim. `approved` is labelled
 *  "Ready for dev" in the UI; adding a fourth value would break older parsers. */
export type Readiness = 'draft' | 'approved' | 'deprecated';
const READINESS: readonly Readiness[] = ['draft', 'approved', 'deprecated'];

export interface ReadinessMark {
  state: Readiness;
  /** The revision at which this was granted. Drives expiry. */
  atRev: number;
}

export interface DocHistory {
  v: 1;
  /** Ascending by `n`, newest last. */
  revs: AnyRevision[];
  readiness?: ReadinessMark;
}

export function isStub(r: AnyRevision): r is RevisionStub {
  return !('fp' in r);
}

/** Newest revision number, or 0 for an empty history. */
export function currentRev(h: DocHistory): number {
  return h.revs.length ? h.revs[h.revs.length - 1].n : 0;
}

/**
 * Exact UTF-8 byte length. Figma's 100 kB pluginData cap counts bytes, and the
 * plugin sandbox is not guaranteed to expose TextEncoder, so this is computed
 * directly. String length alone would undercount any non-ASCII component name.
 */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

export function serializeHistory(h: DocHistory): string {
  return JSON.stringify(h);
}

function parseRelease(raw: unknown): Release | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== 'string' || !r.version) return null;
  if (typeof r.at !== 'number') return null;
  return {
    version: r.version,
    breaking: r.breaking === true,
    ...(typeof r.notes === 'string' && r.notes ? { notes: r.notes } : {}),
    at: r.at,
  };
}

function parseRevision(raw: unknown): AnyRevision | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.n !== 'number' || typeof r.at !== 'number' || typeof r.hash !== 'string') return null;
  const release = parseRelease(r.release);
  const tail = release ? { release } : {};
  // A fingerprint is trusted structurally: `fp.v === 1` with the six expected
  // containers. Anything else degrades to a stub, which loses diffing for that
  // revision but never corrupts the timeline.
  const fp = r.fp as Partial<Fingerprint> | undefined;
  const fpOk = !!fp && fp.v === 1
    && Array.isArray(fp.variants) && Array.isArray(fp.states)
    && Array.isArray(fp.props) && Array.isArray(fp.parts)
    && !!fp.tokens && typeof fp.tokens === 'object'
    && !!fp.layout && typeof fp.layout === 'object';
  if (fpOk && typeof r.pluginVersion === 'string') {
    return { n: r.n, at: r.at, hash: r.hash, pluginVersion: r.pluginVersion, fp: fp as Fingerprint, ...tail };
  }
  return { n: r.n, at: r.at, hash: r.hash, ...tail };
}

function parseMark(raw: unknown): ReadinessMark | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.atRev !== 'number') return null;
  if (typeof m.state !== 'string' || !READINESS.includes(m.state as Readiness)) return null;
  return { state: m.state as Readiness, atRev: m.atRev };
}

/** Defensive parse: an empty history on empty, malformed or wrong-shaped input.
 *  Never throws. A doc generated before this feature has no key at all, which
 *  is exactly the empty case, so no migration pass is needed. */
export function parseHistory(raw: string): DocHistory {
  if (!raw) return { v: 1, revs: [] };
  let j: Record<string, unknown>;
  try { j = JSON.parse(raw) as Record<string, unknown>; } catch { return { v: 1, revs: [] }; }
  if (!j || j.v !== 1 || !Array.isArray(j.revs)) return { v: 1, revs: [] };
  const revs = j.revs
    .map(parseRevision)
    .filter((r): r is AnyRevision => r !== null)
    .sort((a, b) => a.n - b.n);
  const mark = parseMark(j.readiness);
  return { v: 1, revs, ...(mark ? { readiness: mark } : {}) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/plugin/test/docHistory.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add packages/plugin/src/docHistory.ts packages/plugin/test/docHistory.test.ts
git commit -m "feat(plugin): doc history blob types with defensive parse"
```

---

### Task 4: Append with idempotency, and retention

**Files:**
- Modify: `packages/plugin/src/docHistory.ts`
- Test: `packages/plugin/test/docHistory.test.ts`

**Interfaces:**
- Consumes: `DocHistory`, `Revision`, `serializeHistory`, `utf8Length`, `isStub`, `currentRev` from Task 3; `contentHash` from `@spec-layer/extractor`.
- Produces: `FINGERPRINT_CAP`, `HISTORY_BYTE_LIMIT`, `function appendRevision(h: DocHistory, entry: Omit<Revision, 'n' | 'release'>): DocHistory`. Task 6 calls this on every generate and update.

- [ ] **Step 1: Write the failing test**

Append to `packages/plugin/test/docHistory.test.ts`:

```ts
import { appendRevision, FINGERPRINT_CAP } from '../src/docHistory';

const ENTRY = { at: 1720000000000, hash: 'h1', pluginVersion: '3.0.0', fp: FP };

describe('appendRevision', () => {
  it('seeds r1 on an empty history', () => {
    const h = appendRevision({ v: 1, revs: [] }, ENTRY);
    expect(h.revs).toHaveLength(1);
    expect(h.revs[0].n).toBe(1);
  });

  it('assigns monotonic revision numbers', () => {
    let h = appendRevision({ v: 1, revs: [] }, ENTRY);
    h = appendRevision(h, { ...ENTRY, hash: 'h2' });
    h = appendRevision(h, { ...ENTRY, hash: 'h3' });
    expect(h.revs.map((r) => r.n)).toEqual([1, 2, 3]);
  });

  it('is a no-op when hash and fingerprint both match the newest revision', () => {
    const h = appendRevision({ v: 1, revs: [] }, ENTRY);
    expect(appendRevision(h, ENTRY)).toBe(h);
  });

  it('appends when the hash matches but the fingerprint does not', () => {
    const h = appendRevision({ v: 1, revs: [] }, ENTRY);
    const next = appendRevision(h, { ...ENTRY, fp: { ...FP, variants: ['Size=XL'] } });
    expect(next.revs).toHaveLength(2);
  });

  it('appends after a stub, continuing from its number', () => {
    const h = appendRevision({ v: 1, revs: [{ n: 9, at: 1, hash: 'old' }] }, ENTRY);
    expect(h.revs.map((r) => r.n)).toEqual([9, 10]);
  });

  it('prunes fingerprints beyond the cap to stubs, keeping the timeline complete', () => {
    let h: DocHistory = { v: 1, revs: [] };
    for (let i = 0; i < FINGERPRINT_CAP + 5; i++) {
      h = appendRevision(h, { ...ENTRY, hash: `h${i}` });
    }
    expect(h.revs).toHaveLength(FINGERPRINT_CAP + 5);
    expect(h.revs.filter((r) => !isStub(r))).toHaveLength(FINGERPRINT_CAP);
    expect(h.revs.slice(0, 5).every(isStub)).toBe(true);
  });

  it('never prunes a released revision, however old', () => {
    let h: DocHistory = {
      v: 1,
      revs: [{ n: 1, at: 1, hash: 'h1', pluginVersion: '3.0.0', fp: FP, release: { version: '1.0.0', breaking: false, at: 1 } }],
    };
    for (let i = 0; i < FINGERPRINT_CAP + 5; i++) {
      h = appendRevision(h, { ...ENTRY, hash: `x${i}` });
    }
    expect(isStub(h.revs[0])).toBe(false);
    expect(h.revs[0].release?.version).toBe('1.0.0');
  });

  it('never prunes the newest revision', () => {
    let h: DocHistory = { v: 1, revs: [] };
    for (let i = 0; i < FINGERPRINT_CAP + 5; i++) h = appendRevision(h, { ...ENTRY, hash: `h${i}` });
    expect(isStub(h.revs[h.revs.length - 1])).toBe(false);
  });

  it('sheds the oldest unreleased fingerprint when the blob would exceed the byte limit', () => {
    // A fingerprint fat enough that a handful blows the budget on their own.
    const fat = { ...FP, variants: Array.from({ length: 4000 }, (_, i) => `Prop${i}=Value${i}`) };
    let h: DocHistory = { v: 1, revs: [] };
    for (let i = 0; i < 8; i++) h = appendRevision(h, { ...ENTRY, hash: `f${i}`, fp: fat });
    expect(utf8Length(serializeHistory(h))).toBeLessThanOrEqual(90_000);
    // The timeline still records all eight.
    expect(h.revs).toHaveLength(8);
    expect(isStub(h.revs[h.revs.length - 1])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/docHistory.test.ts`
Expected: FAIL — `appendRevision` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/plugin/src/docHistory.ts` (and add `contentHash` to the extractor import at the top, so it reads `import { contentHash, type Fingerprint } from '@spec-layer/extractor';`):

```ts
/** How many recent revisions keep their fingerprint. Releases are kept on top
 *  of this, regardless of age. At roughly 1 kB per fingerprint this leaves
 *  ample headroom under HISTORY_BYTE_LIMIT for a typical component. */
export const FINGERPRINT_CAP = 40;

/** Ceiling for the serialized blob. Figma enforces 100 kB per pluginData
 *  entry; the margin absorbs a long release-notes string. */
export const HISTORY_BYTE_LIMIT = 90_000;

function toStub(r: Revision): RevisionStub {
  // `release` is omitted rather than set to undefined so the serialized blob
  // stays minimal and byte-stable for an unreleased revision.
  return r.release
    ? { n: r.n, at: r.at, hash: r.hash, release: r.release }
    : { n: r.n, at: r.at, hash: r.hash };
}

/**
 * Reduce fingerprints to stubs until the blob fits.
 *
 * Two passes. The first applies the policy: keep the newest revision, every
 * released revision, and the most recent FINGERPRINT_CAP. The second is a size
 * guard for the pathological case of a component whose fingerprint is enormous
 * (thousands of variants), shedding the oldest unreleased fingerprint until the
 * blob is under budget. Stubs themselves are never dropped, so the timeline
 * stays complete for the life of the doc.
 *
 * Retention is recomputed on every append, so a history written under a
 * different cap converges on the current policy at the next update.
 */
function prune(h: DocHistory): DocHistory {
  if (!h.revs.length) return h;
  const newest = h.revs[h.revs.length - 1].n;
  const keep = new Set<number>([newest]);
  for (const r of h.revs) if (r.release) keep.add(r.n);
  for (const r of h.revs.slice(-FINGERPRINT_CAP)) keep.add(r.n);

  let revs = h.revs.map((r) => (isStub(r) || keep.has(r.n) ? r : toStub(r)));
  let out: DocHistory = { ...h, revs };

  while (utf8Length(serializeHistory(out)) > HISTORY_BYTE_LIMIT) {
    const victim = out.revs.find((r) => !isStub(r) && !r.release && r.n !== newest);
    if (!victim) break; // Nothing left that is safe to shed.
    revs = out.revs.map((r) => (r.n === victim.n ? toStub(r as Revision) : r));
    out = { ...out, revs };
  }
  return out;
}

/**
 * Append a revision, then apply retention.
 *
 * Idempotent on unchanged content: regenerating an untouched component returns
 * the history unchanged rather than recording a duplicate. That operation is
 * already documented as free (it hits the prose cache), so it must not inflate
 * the timeline either.
 *
 * `release` is excluded from the entry: a revision is never born released, only
 * promoted later.
 */
export function appendRevision(
  h: DocHistory,
  entry: Omit<Revision, 'n' | 'release'>,
): DocHistory {
  const last = h.revs[h.revs.length - 1];
  if (
    last && !isStub(last)
    && last.hash === entry.hash
    && contentHash(last.fp) === contentHash(entry.fp)
  ) return h;
  const n = (last?.n ?? 0) + 1;
  return prune({ ...h, revs: [...h.revs, { ...entry, n }] });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/plugin/test/docHistory.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add packages/plugin/src/docHistory.ts packages/plugin/test/docHistory.test.ts
git commit -m "feat(plugin): revision append with idempotency and fingerprint retention"
```

---

### Task 5: Promotion, readiness expiry, revision diffing, version line

**Files:**
- Modify: `packages/plugin/src/docHistory.ts`
- Test: `packages/plugin/test/docHistory.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3 and 4; `diffFingerprints`, `type Change` from `@spec-layer/extractor`.
- Produces: `function promote`, `function setReadiness`, `interface ResolvedReadiness`, `function resolveReadiness`, `function latestRelease`, `function diffRevisions`, `function readinessLabel`, `function formatVersionLine`. Tasks 6, 7 and 8 consume these.

- [ ] **Step 1: Write the failing test**

Append to `packages/plugin/test/docHistory.test.ts`:

```ts
import type { Change } from '@spec-layer/extractor';
import {
  promote, setReadiness, resolveReadiness, latestRelease, diffRevisions,
  readinessLabel, formatVersionLine,
} from '../src/docHistory';

const FP2: Fingerprint = { ...FP, variants: ['Size=M', 'Size=XL'] };

function threeRevs(): DocHistory {
  let h = appendRevision({ v: 1, revs: [] }, { at: 1, hash: 'h1', pluginVersion: '3.0.0', fp: FP });
  h = appendRevision(h, { at: 2, hash: 'h2', pluginVersion: '3.0.0', fp: FP2 });
  h = appendRevision(h, { at: 3, hash: 'h3', pluginVersion: '3.0.0', fp: FP });
  return h;
}

describe('promote', () => {
  it('attaches a release to the named revision', () => {
    const h = promote(threeRevs(), 2, { version: '2.0.0', breaking: true, at: 9 });
    expect(h.revs[1].release).toEqual({ version: '2.0.0', breaking: true, at: 9 });
    expect(h.revs[0].release).toBeUndefined();
  });
  it('throws on an unknown revision rather than silently ignoring it', () => {
    expect(() => promote(threeRevs(), 99, { version: '1.0.0', breaking: false, at: 1 })).toThrow(/r99/);
  });
});

describe('latestRelease', () => {
  it('returns the release on the highest-numbered released revision', () => {
    let h = promote(threeRevs(), 1, { version: '1.0.0', breaking: false, at: 1 });
    h = promote(h, 3, { version: '2.0.0', breaking: false, at: 3 });
    expect(latestRelease(h)?.version).toBe('2.0.0');
  });
  it('returns null when nothing has been released', () => {
    expect(latestRelease(threeRevs())).toBeNull();
  });
});

describe('resolveReadiness', () => {
  it('resolves to draft when there is no mark', () => {
    expect(resolveReadiness(threeRevs())).toEqual({ state: 'draft' });
  });
  it('resolves to approved when the mark is current', () => {
    const h = setReadiness(threeRevs(), 'approved', 3);
    expect(resolveReadiness(h)).toEqual({ state: 'approved' });
  });
  it('expires an approved mark that the component has outgrown', () => {
    const h = setReadiness(threeRevs(), 'approved', 2);
    expect(resolveReadiness(h)).toEqual({ state: 'draft', staleAtRev: 2 });
  });
  it('does not rewrite the stored mark when it expires', () => {
    const h = setReadiness(threeRevs(), 'approved', 2);
    expect(h.readiness).toEqual({ state: 'approved', atRev: 2 });
  });
  it('never expires deprecated', () => {
    const h = setReadiness(threeRevs(), 'deprecated', 1);
    expect(resolveReadiness(h)).toEqual({ state: 'deprecated' });
  });
  it('never expires an explicit draft', () => {
    const h = setReadiness(threeRevs(), 'draft', 1);
    expect(resolveReadiness(h)).toEqual({ state: 'draft' });
  });
});

describe('diffRevisions', () => {
  it('diffs two retained revisions', () => {
    const changes = diffRevisions(threeRevs(), 1, 2);
    expect(changes).toEqual<Change[]>([{ kind: 'added', area: 'variant', label: 'Size=XL' }]);
  });
  it('returns an empty array when the fingerprints match', () => {
    expect(diffRevisions(threeRevs(), 1, 3)).toEqual([]);
  });
  it('returns null when either revision is a stub or missing', () => {
    const h: DocHistory = { v: 1, revs: [{ n: 1, at: 1, hash: 'h1' }, ...threeRevs().revs.slice(1)] };
    expect(diffRevisions(h, 1, 2)).toBeNull();
    expect(diffRevisions(threeRevs(), 1, 99)).toBeNull();
  });
});

describe('readinessLabel / formatVersionLine', () => {
  it('labels each resolved readiness state without em dashes', () => {
    expect(readinessLabel({ state: 'approved' })).toBe('Ready for dev');
    expect(readinessLabel({ state: 'draft' })).toBe('Draft');
    expect(readinessLabel({ state: 'deprecated' })).toBe('Deprecated');
    expect(readinessLabel({ state: 'draft', staleAtRev: 7 }))
      .toBe('Draft. Was ready at r7, changed since.');
    expect(readinessLabel({ state: 'draft', staleAtRev: 7 })).not.toContain('—');
  });

  it('builds the frame version line, omitting absent segments', () => {
    expect(formatVersionLine('Button', threeRevs())).toBe('Button · r3 · Draft');
    const released = setReadiness(
      promote(threeRevs(), 3, { version: 'v2.1.0', breaking: false, at: 3 }),
      'approved', 3,
    );
    expect(formatVersionLine('Button', released)).toBe('Button · v2.1.0 · r3 · Ready for dev');
  });

  it('shows the name alone for a doc with no revisions yet', () => {
    expect(formatVersionLine('Button', { v: 1, revs: [] })).toBe('Button');
  });

  it('renders the version string verbatim, inventing no prefix', () => {
    const h = promote(threeRevs(), 3, { version: '2.1.0', breaking: false, at: 3 });
    expect(formatVersionLine('Button', h)).toContain('· 2.1.0 ·');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/docHistory.test.ts`
Expected: FAIL — `promote` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/plugin/src/docHistory.ts` (extend the extractor import to `import { contentHash, diffFingerprints, type Change, type Fingerprint } from '@spec-layer/extractor';`):

```ts
/** Attach a release to one revision. Throws on an unknown number: silently
 *  dropping a release the designer just cut would be worse than failing. */
export function promote(h: DocHistory, n: number, release: Release): DocHistory {
  if (!h.revs.some((r) => r.n === n)) throw new Error(`Unknown revision r${n}`);
  return { ...h, revs: h.revs.map((r) => (r.n === n ? { ...r, release } : r)) };
}

/** Record a readiness mark against the revision it was granted at. */
export function setReadiness(h: DocHistory, state: Readiness, atRev: number): DocHistory {
  return { ...h, readiness: { state, atRev } };
}

/** The release on the highest-numbered released revision, or null. */
export function latestRelease(h: DocHistory): Release | null {
  for (let i = h.revs.length - 1; i >= 0; i--) {
    const r = h.revs[i].release;
    if (r) return r;
  }
  return null;
}

export interface ResolvedReadiness {
  state: Readiness;
  /** Set only when an `approved` mark has been outlived: the revision it was
   *  granted at. Its presence is what makes the state read as expired. */
  staleAtRev?: number;
}

/**
 * The displayed readiness, applying expiry.
 *
 * `approved` is a claim about a shape, so it expires the moment the component
 * moves past the revision it was granted at. That is what makes "Ready for dev"
 * a guarantee rather than a label someone forgot to update. `deprecated` is a
 * decision about the component rather than a claim about a shape, so it never
 * expires. The stored mark is never rewritten, so who marked what and when
 * survives in history.
 */
export function resolveReadiness(h: DocHistory): ResolvedReadiness {
  const m = h.readiness;
  if (!m || m.state === 'draft') return { state: 'draft' };
  if (m.state === 'deprecated') return { state: 'deprecated' };
  return currentRev(h) > m.atRev
    ? { state: 'draft', staleAtRev: m.atRev }
    : { state: 'approved' };
}

/** Changes between two revisions. Null when either is missing or a stub, which
 *  the caller must report as unavailable rather than as "no changes". */
export function diffRevisions(h: DocHistory, fromN: number, toN: number): Change[] | null {
  const a = h.revs.find((r) => r.n === fromN);
  const b = h.revs.find((r) => r.n === toN);
  if (!a || !b || isStub(a) || isStub(b)) return null;
  return diffFingerprints(a.fp, b.fp);
}

/** User-facing readiness text. Voice guide: plain, honest, no em dashes. */
export function readinessLabel(r: ResolvedReadiness): string {
  if (r.state === 'approved') return 'Ready for dev';
  if (r.state === 'deprecated') return 'Deprecated';
  return r.staleAtRev !== undefined
    ? `Draft. Was ready at r${r.staleAtRev}, changed since.`
    : 'Draft';
}

/**
 * The doc frame's version line, for example
 * `Button · v2.1.0 · r3 · Ready for dev`.
 *
 * Segments are omitted when absent, and the release string is rendered exactly
 * as the designer typed it: the format is free-form, so inventing a `v` prefix
 * would be putting words in their mouth.
 */
export function formatVersionLine(name: string, h: DocHistory): string {
  const rev = currentRev(h);
  if (!rev) return name;
  const release = latestRelease(h);
  return [name, release?.version, `r${rev}`, readinessLabel(resolveReadiness(h))]
    .filter((s): s is string => !!s)
    .join(' · ');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/plugin/test/docHistory.test.ts`
Expected: PASS, 33 tests.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm run check
git add packages/plugin/src/docHistory.ts packages/plugin/test/docHistory.test.ts
git commit -m "feat(plugin): releases, expiring readiness, revision diff and version line"
```

---

### Task 6: Record history on generate and update

**Files:**
- Modify: `packages/plugin/src/main.ts` (import block near line 20; write sites at lines 556, 847, 999; read site near line 321)
- Modify: `packages/plugin/src/messages.ts`
- Test: `packages/plugin/test/docHistory.test.ts` (helper coverage), `packages/plugin/test/integration.test.ts`

**Interfaces:**
- Consumes: `DOC_HISTORY_KEY`, `parseHistory`, `serializeHistory`, `appendRevision`, `currentRev`, `resolveReadiness`, `latestRelease` from Task 5; `fingerprint` from Task 1.
- Produces: a `history?: string` field on `LibraryEntry` (the serialized blob, parsed in the UI layer), plus `setReadiness` / `cutRelease` request messages consumed by Task 8.

- [ ] **Step 1: Write the failing test**

The existing suite drives the main thread through `packages/plugin/test/fakeFigma.ts`. Add to `packages/plugin/test/docHistory.test.ts`:

```ts
describe('history recorded on a node (integration shape)', () => {
  it('seeds r1 on a node with no history key, then appends on change', () => {
    // Mirrors what main.ts does: read the key, append, write it back.
    const node = { data: new Map<string, string>() };
    const read = () => parseHistory(node.data.get('specLayerHistory') ?? '');
    const write = (h: DocHistory) => node.data.set('specLayerHistory', serializeHistory(h));

    write(appendRevision(read(), { at: 1, hash: 'h1', pluginVersion: '3.0.0', fp: FP }));
    expect(currentRev(read())).toBe(1);

    // An unchanged regenerate must not inflate the timeline.
    write(appendRevision(read(), { at: 2, hash: 'h1', pluginVersion: '3.0.0', fp: FP }));
    expect(currentRev(read())).toBe(1);

    write(appendRevision(read(), { at: 3, hash: 'h2', pluginVersion: '3.0.0', fp: FP2 }));
    expect(currentRev(read())).toBe(2);
    expect(diffRevisions(read(), 1, 2)).toEqual([{ kind: 'added', area: 'variant', label: 'Size=XL' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/docHistory.test.ts`
Expected: PASS immediately (this exercises Task 5 code and documents the contract main.ts must honour). If it fails, Tasks 3 to 5 are incomplete — fix those before continuing.

- [ ] **Step 3: Add the fingerprint to the doc model payload**

The UI already sends `contentHash` with the build request. The fingerprint must travel the same path, because `main.ts` has the built `IntermediateSpec` only on the UI side of the protocol.

In `packages/plugin/src/messages.ts` line 85, the `renderDocFrame` message already carries `contentHash`. Add the fingerprint beside it:

```ts
  | { type: 'renderDocFrame'; model: DocFrameModel; nodeId: string; contentHash: string; fingerprint: Fingerprint; config: DocConfig }
```

Import the type at the top of `messages.ts`:

```ts
import type { Fingerprint } from '@spec-layer/extractor';
```

The fingerprint has to travel on this message because `main.ts` never sees the `IntermediateSpec`: it receives an already-built `DocFrameModel`. Compute it wherever `contentHash` is computed for this message (search `renderDocFrame` in `packages/plugin/src/ui/`) and add `fingerprint: fingerprint(spec),` alongside, importing `fingerprint` from `@spec-layer/extractor`.

- [ ] **Step 4: Write history at the generate site**

In `packages/plugin/src/main.ts`, extend the import near line 20:

```ts
import {
  DOC_HISTORY_KEY, parseHistory, serializeHistory, appendRevision,
  currentRev, resolveReadiness, latestRelease,
} from './docHistory';
```

Immediately after line 556 (`section.setPluginData(DOC_LINK_KEY, serializeDocLink(data));`), add:

```ts
        // History is a separate key so DocLinkData stays byte-identical. A new
        // doc starts from an empty history; a replaced doc inherits the prior
        // section's timeline so a regenerate does not reset it to r1.
        const priorHistory = existing
          ? parseHistory((existing as SectionNode).getPluginData(DOC_HISTORY_KEY))
          : { v: 1 as const, revs: [] };
        section.setPluginData(DOC_HISTORY_KEY, serializeHistory(appendRevision(priorHistory, {
          at: data.generatedAt,
          hash: msg.contentHash,
          pluginVersion: data.pluginVersion,
          fp: msg.fingerprint,
        })));
```

- [ ] **Step 5: Write history at both update sites**

Apply the same pattern after line 847 and after line 999 (the two other `section.setPluginData(DOC_LINK_KEY, ...)` calls). At each, the prior section variable differs: at 847 it is `existingNode`, at 999 it is `prior`. Read the surrounding lines to confirm the identifier, then:

```ts
        const priorHistory = parseHistory((<PRIOR_NODE> as SectionNode).getPluginData(DOC_HISTORY_KEY));
        section.setPluginData(DOC_HISTORY_KEY, serializeHistory(appendRevision(priorHistory, {
          at: data.generatedAt,
          hash: msg.contentHash,
          pluginVersion: data.pluginVersion,
          fp: msg.fingerprint,
        })));
```

Replace `<PRIOR_NODE>` with `existingNode` at the first site and `prior` at the second.

- [ ] **Step 6: Include history in the library payload**

In `packages/plugin/src/messages.ts`, add to `LibraryEntry` (line 13) after `storedContentHash`:

```ts
  /** Serialized DocHistory blob, parsed by the UI layer. Absent on a doc
   *  generated before versioning existed, which parses to an empty history. */
  history?: string;
```

At the library enumeration site in `main.ts` near line 321, where each entry is built from `parseDocLink(...)`, add to the emitted entry:

```ts
        history: (node as SectionNode).getPluginData(DOC_HISTORY_KEY) || undefined,
```

- [ ] **Step 7: Add the two request messages**

In `packages/plugin/src/messages.ts`, add to the UI-to-main request union:

```ts
  | { type: 'setReadiness'; docId: string; state: 'draft' | 'approved' | 'deprecated' }
  | { type: 'cutRelease'; docId: string; revision: number; version: string; breaking: boolean; notes?: string }
```

In `main.ts`, add handlers alongside the existing doc message handlers. Both read the history, mutate it purely, and write it back:

```ts
      case 'setReadiness': {
        const node = await figma.getNodeByIdAsync(msg.docId);
        if (!node || node.type !== 'SECTION') break;
        const section = node as SectionNode;
        const h = parseHistory(section.getPluginData(DOC_HISTORY_KEY));
        section.setPluginData(
          DOC_HISTORY_KEY,
          serializeHistory(setReadiness(h, msg.state, currentRev(h))),
        );
        break;
      }
      case 'cutRelease': {
        const node = await figma.getNodeByIdAsync(msg.docId);
        if (!node || node.type !== 'SECTION') break;
        const section = node as SectionNode;
        const h = parseHistory(section.getPluginData(DOC_HISTORY_KEY));
        try {
          section.setPluginData(DOC_HISTORY_KEY, serializeHistory(promote(h, msg.revision, {
            version: msg.version, breaking: msg.breaking,
            ...(msg.notes ? { notes: msg.notes } : {}),
            at: Date.now(),
          })));
        } catch {
          // promote throws only on an unknown revision, which means the UI is
          // stale. Leave the blob untouched; the next library refresh corrects it.
        }
        break;
      }
```

Add `setReadiness` and `promote` to the `./docHistory` import.

- [ ] **Step 8: Verify and commit**

```bash
npm run check
git add packages/plugin/src/main.ts packages/plugin/src/messages.ts packages/plugin/src/ui packages/plugin/test/docHistory.test.ts
git commit -m "feat(plugin): record revision history on generate and update"
```

---

### Task 7: Version line on the doc frame

**Files:**
- Modify: `packages/plugin/src/brandHeader.ts` (`BrandHeaderOptions` at line 22, `buildBrandHeader` at line 48)
- Modify: `packages/plugin/src/docFrame.ts`
- Test: `packages/plugin/test/brandHeader.test.ts`

**Interfaces:**
- Consumes: `formatVersionLine` from Task 5.
- Produces: `BrandHeaderOptions.versionLine?: string | null`.

- [ ] **Step 1: Write the failing test**

Add to `packages/plugin/test/brandHeader.test.ts`, following the existing tests' setup in that file:

```ts
it('renders the version line when one is supplied', async () => {
  const band = await buildBrandHeader({
    eyebrow: 'Components', title: 'Button',
    versionLine: 'Button · v2.1.0 · r7 · Ready for dev',
  });
  const texts = band.findAll((n) => n.type === 'TEXT').map((n) => (n as TextNode).characters);
  expect(texts).toContain('Button · v2.1.0 · r7 · Ready for dev');
});

it('omits the version line when absent, adding no empty text node', async () => {
  const withOut = await buildBrandHeader({ eyebrow: 'Components', title: 'Button' });
  const withNull = await buildBrandHeader({ eyebrow: 'Components', title: 'Button', versionLine: null });
  const count = (f: FrameNode) => f.findAll((n) => n.type === 'TEXT').length;
  expect(count(withNull)).toBe(count(withOut));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/brandHeader.test.ts`
Expected: FAIL — `versionLine` is not a known property.

- [ ] **Step 3: Add the option**

In `packages/plugin/src/brandHeader.ts`, add to `BrandHeaderOptions` after `subtitle`:

```ts
  /**
   * Compact version and readiness line, pre-formatted by
   * docHistory.formatVersionLine. Rendered into the band so it survives a PNG
   * export or a screenshot, which is how most people meet these docs.
   */
  versionLine?: string | null;
```

- [ ] **Step 4: Render it**

In `buildBrandHeader`, after the subtitle node is appended and before the FILL pass, add:

```ts
  if (opts.versionLine) {
    const ver = makeText(opts.versionLine, 'Regular', 13, palette.muted);
    band.appendChild(ver);
    tmp.push(ver);
  }
```

`makeText` is `(chars, style: FontStyle, size, color = palette.body, ...)` ([`frameKit.ts:106`](../../../packages/plugin/src/frameKit.ts)), and `palette.muted` is the key used for overlines and secondary ink ([`frameKit.ts:27`](../../../packages/plugin/src/frameKit.ts)). Pushing onto `tmp` is what gets the node its FILL pass, matching how the eyebrow and subtitle are handled in the same function.

- [ ] **Step 5: Pass it from docFrame**

In `packages/plugin/src/docFrame.ts`, find the `buildBrandHeader({ ... })` call and add `versionLine` to the options object, threading the value in from a new optional parameter on `buildDocFrames`.

**Ordering matters here.** The frame is built at `main.ts:543`, *before* the link and history are written at 556. So restructure the generate site to compute the history first:

```ts
        // Compute the next history BEFORE building, so the frame can render its
        // own version line. The same object is stamped on after the build.
        const priorHistory = existing
          ? parseHistory((existing as SectionNode).getPluginData(DOC_HISTORY_KEY))
          : { v: 1 as const, revs: [] };
        const nextHistory = appendRevision(priorHistory, {
          at: Date.now(),
          hash: msg.contentHash,
          pluginVersion: typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : '',
          fp: msg.fingerprint,
        });

        section = await buildDocFrames(
          msg.model, resolveTheme(brandTheme), brandLogo,
          formatVersionLine(msg.model.name, nextHistory),
        );
```

Then replace the Task 6 write at that site with `serializeHistory(nextHistory)`, and reuse the same `Date.now()` value for `data.generatedAt` so the link and the revision agree on the timestamp. Apply the same reordering at both update sites.

- [ ] **Step 6: Run tests and commit**

```bash
npx vitest run packages/plugin/test/brandHeader.test.ts packages/plugin/test/docHistory.test.ts
npm run check
git add packages/plugin/src/brandHeader.ts packages/plugin/src/docFrame.ts packages/plugin/src/main.ts packages/plugin/test/brandHeader.test.ts
git commit -m "feat(plugin): render version and readiness on the doc frame header"
```

---

### Task 8: Library panel timeline, diff and actions

**Files:**
- Modify: `packages/plugin/src/ui/viewModel/library.ts` (`LibraryRowModel` at line 25, `changeGroups` at line 51, `buildLibraryRow` at line 147)
- Modify: `packages/plugin/src/ui/screens/library.ts`
- Test: `packages/plugin/test/libraryViewModel.test.ts`, `packages/plugin/test/libraryScreen.test.ts`

**Interfaces:**
- Consumes: `parseHistory`, `currentRev`, `resolveReadiness`, `readinessLabel`, `diffRevisions`, `isStub` from Task 5; `describeChange`, `type ChangeArea` from Task 2; `LibraryEntry.history` from Task 6.
- Produces: `interface LibraryChangeGroup`, `interface RowRevision`, `LibraryRowModel.revisions`, `LibraryRowModel.readinessText`, and `changeGroups` widened from `null` to `LibraryChangeGroup[] | null`.

**Two facts about the existing code that shape this task.**

`LibraryRowModel.changeGroups` is currently typed `null` ([`viewModel/library.ts:51`](../../../packages/plugin/src/ui/viewModel/library.ts)) with a comment saying the protocol establishes hash drift but not a reliable itemized diff. This task is what that slot was reserved for. But the presentation layer already defines the shape it expects: `LibraryChangeGroupPresentation { label, items }` ([`screens/library.ts:21`](../../../packages/plugin/src/ui/screens/library.ts)), rendered by `changeGroupMarkup` as a labelled `<section>` with a `<ul>`. So the view model must emit **groups keyed by change area**, not flat sentences. Doing that means `changeGroupMarkup` needs no changes at all.

Second, `changeDetailsMarkup` is only rendered when `isUpdate(row)` is true, that is `status === 'updateAvailable'` ([`screens/library.ts:304`](../../../packages/plugin/src/ui/screens/library.ts)). Readiness and the timeline are meaningful on an in-sync row too, so that gate has to be relaxed.

- [ ] **Step 1: Write the failing test**

Add to `packages/plugin/test/libraryViewModel.test.ts`, following that file's existing `buildLibraryModel` setup:

```ts
it('exposes the revision timeline, newest first', () => {
  const history = serializeHistory(
    promote(
      appendRevision(
        appendRevision({ v: 1, revs: [] }, { at: 1, hash: 'h1', pluginVersion: '3.0.0', fp: FP }),
        { at: 2, hash: 'h2', pluginVersion: '3.0.0', fp: FP2 },
      ),
      2, { version: '2.0.0', breaking: true, at: 2 },
    ),
  );
  const [row] = buildLibraryModel([entry({ docId: 'd1', history })]).allRows;
  expect(row.revisions.map((r) => r.n)).toEqual([2, 1]);
  expect(row.revisions[0].releaseVersion).toBe('2.0.0');
  expect(row.revisions[0].breaking).toBe(true);
  expect(row.revisions[0].diffable).toBe(true);
});

it('groups the diff against the previous revision by area', () => {
  const history = serializeHistory(appendRevision(
    appendRevision({ v: 1, revs: [] }, { at: 1, hash: 'h1', pluginVersion: '3.0.0', fp: FP }),
    { at: 2, hash: 'h2', pluginVersion: '3.0.0', fp: FP2 },
  ));
  const [row] = buildLibraryModel([entry({ docId: 'd1', history })]).allRows;
  expect(row.changeGroups).toEqual([
    { label: 'Variants', items: ['Added variant Size=XL'] },
  ]);
});

it('emits one group per affected area, in fixed order, and omits empty areas', () => {
  const wide: Fingerprint = {
    ...FP, variants: ['Size=M', 'Size=XL'], tokens: { 'Label.fill': 'text-muted' },
  };
  const history = serializeHistory(appendRevision(
    appendRevision({ v: 1, revs: [] }, { at: 1, hash: 'h1', pluginVersion: '3.0.0', fp: FP }),
    { at: 2, hash: 'h2', pluginVersion: '3.0.0', fp: wide },
  ));
  const [row] = buildLibraryModel([entry({ docId: 'd1', history })]).allRows;
  expect(row.changeGroups?.map((g) => g.label)).toEqual(['Variants', 'Tokens']);
});

it('distinguishes an unsummarizable change from no change', () => {
  // Same fingerprint, different hash: the change is outside the projection.
  const history = serializeHistory(appendRevision(
    appendRevision({ v: 1, revs: [] }, { at: 1, hash: 'h1', pluginVersion: '3.0.0', fp: FP }),
    { at: 2, hash: 'h2', pluginVersion: '3.0.0', fp: { ...FP } },
  ));
  const [row] = buildLibraryModel([entry({ docId: 'd1', history })]).allRows;
  expect(row.changeGroups).toEqual([
    { label: 'Source changed', items: ['Changed, but not in a way this can summarize.'] },
  ]);
});

it('marks a stub revision as not diffable', () => {
  const history = JSON.stringify({ v: 1, revs: [{ n: 1, at: 1, hash: 'h1' }] });
  const [row] = buildLibraryModel([entry({ docId: 'd1', history })]).allRows;
  expect(row.revisions[0].diffable).toBe(false);
  expect(row.changeGroups).toBeNull();
});

it('surfaces the readiness label, including expiry', () => {
  const base = appendRevision(
    appendRevision({ v: 1, revs: [] }, { at: 1, hash: 'h1', pluginVersion: '3.0.0', fp: FP }),
    { at: 2, hash: 'h2', pluginVersion: '3.0.0', fp: FP2 },
  );
  const stale = serializeHistory(setReadiness(base, 'approved', 1));
  const [row] = buildLibraryModel([entry({ docId: 'd1', history: stale })]).allRows;
  expect(row.readinessText).toBe('Draft. Was ready at r1, changed since.');
});

it('falls back to an empty timeline for a doc with no history key', () => {
  const [row] = buildLibraryModel([entry({ docId: 'd1' })]).allRows;
  expect(row.revisions).toEqual([]);
  expect(row.readinessText).toBe('Draft');
  expect(row.changeGroups).toBeNull();
});
```

`entry()` is that file's existing `LibraryEntry` factory; extend it to accept `history`. Add these imports to the test file:

```ts
import type { Fingerprint } from '@spec-layer/extractor';
import {
  appendRevision, promote, setReadiness, serializeHistory,
} from '../src/docHistory';
```

and copy the `FP` / `FP2` fixtures from `docHistory.test.ts` rather than importing across test files.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/libraryViewModel.test.ts`
Expected: FAIL — `row.revisions` is not a property of `LibraryRowModel`.

- [ ] **Step 3: Extend the row model**

In `packages/plugin/src/ui/viewModel/library.ts`, add above `LibraryRowModel`:

```ts
export interface RowRevision {
  n: number;
  at: number;
  /** Release version on this revision, when it has been promoted. */
  releaseVersion?: string;
  breaking?: boolean;
  /** False for a pruned revision, which the screen labels honestly. */
  diffable: boolean;
}
```

Add above it, matching the shape `screens/library.ts` already renders:

```ts
/** One labelled group of change sentences. Structurally identical to the
 *  screen's LibraryChangeGroupPresentation, so changeGroupMarkup renders it
 *  unchanged. */
export interface LibraryChangeGroup {
  label: string;
  items: string[];
}
```

Replace the `changeGroups: null` field and its comment with:

```ts
  /**
   * What changed between the two newest revisions, grouped by area.
   *
   * `null` when there is nothing to compare: fewer than two revisions, or
   * either of them pruned to a stub. An EMPTY fingerprint diff is NOT null: it
   * becomes the single "changed, but not in a way this can summarize" group,
   * because a change outside the fingerprint's projection still moved the hash,
   * and reporting it as no change would be a lie.
   */
  changeGroups: LibraryChangeGroup[] | null;
  /** Revision timeline, newest first. */
  revisions: RowRevision[];
  /** Resolved readiness text, expiry included. */
  readinessText: string;
```

- [ ] **Step 4: Populate them**

In `buildLibraryRow`, add before the returned object:

```ts
  const history = parseHistory(entry.history ?? '');
  const revisions: RowRevision[] = [...history.revs].reverse().map((r) => ({
    n: r.n,
    at: r.at,
    ...(r.release ? { releaseVersion: r.release.version, breaking: r.release.breaking } : {}),
    diffable: !isStub(r),
  }));
  const changeGroups = changeGroupsFor(history);
  const readinessText = readinessLabel(resolveReadiness(history));
```

and add these fields to the returned object. Then add the helper and its label table above `buildLibraryRow`:

```ts
const AREA_LABEL: Record<ChangeArea, string> = {
  variant: 'Variants',
  state: 'States',
  prop: 'Properties',
  part: 'Anatomy',
  token: 'Tokens',
  layout: 'Layout',
};

/** Fixed group order, so the same diff always renders identically. */
const AREA_ORDER: readonly ChangeArea[] = ['variant', 'state', 'prop', 'part', 'token', 'layout'];

/**
 * Grouped sentences for the most recent change.
 *
 * Three outcomes, deliberately distinct. `null` means nothing is comparable.
 * A single "Source changed" group means the hash moved but the change sits
 * outside the fingerprint's projection, which must not read as "no changes".
 * Otherwise, the real diff grouped by area with empty areas dropped.
 */
function changeGroupsFor(h: DocHistory): LibraryChangeGroup[] | null {
  const n = currentRev(h);
  if (n < 2) return null;
  const prev = h.revs[h.revs.length - 2];
  const changes = diffRevisions(h, prev.n, n);
  if (changes === null) return null;
  if (changes.length === 0) {
    return [{ label: 'Source changed', items: ['Changed, but not in a way this can summarize.'] }];
  }
  return AREA_ORDER
    .map((area) => ({
      label: AREA_LABEL[area],
      items: changes.filter((c) => c.area === area).map(describeChange),
    }))
    .filter((g) => g.items.length > 0);
}
```

Add the imports at the top of the file:

```ts
import { describeChange, type ChangeArea } from '@spec-layer/extractor';
import {
  parseHistory, currentRev, diffRevisions, isStub, resolveReadiness, readinessLabel,
  type DocHistory,
} from '../../docHistory';
```

`LibraryRowPresentation` in `screens/library.ts` overrides `changeGroups` to `readonly LibraryChangeGroupPresentation[] | null`. That override stays: it is what keeps the presentation layer from importing the view model, and the two shapes are now structurally compatible, so it needs no edit.

- [ ] **Step 5: Run the viewModel tests**

Run: `npx vitest run packages/plugin/test/libraryViewModel.test.ts`
Expected: PASS.

- [ ] **Step 6: Ungate the details region**

In `packages/plugin/src/ui/screens/library.ts`, the details region only renders for a drifted row. Readiness and the timeline apply to every row, so relax the gate.

At line 264, drop the `update &&`:

```ts
  const expanded = row.expanded;
```

At line 265, render the disclosure button unconditionally (it was previously the `update ? ... : statusMarkup(row.status)` ternary). Replace the whole `const status = ...` assignment with:

```ts
  // Every row now has details worth disclosing: a timeline and a readiness
  // state exist even when the doc is in sync.
  const status = (
    '<button class="sl-library-update-disclosure" type="button" ' +
    `data-library-disclosure="${esc(row.docId)}" aria-expanded="${expanded}" ` +
    `aria-controls="sl-library-details-${esc(row.docId)}" ` +
    `aria-label="Review history for ${esc(row.label)}">` +
    `${statusMarkup(row.status)}` +
    `<span class="sl-library-chevron${expanded ? ' is-expanded' : ''}">${icon('chevronDown', 14)}</span>` +
    '</button>'
  );
```

At line 304, always render the details:

```ts
    changeDetailsMarkup({ ...row, expanded }) +
```

`isUpdate` is still used by `menuGroups`, so leave the function in place.

- [ ] **Step 7: Render readiness, timeline and actions**

Replace `changeDetailsMarkup` (line 88) with:

```ts
function revisionLineMarkup(r: RowRevision): string {
  const date = new Date(r.at).toISOString().slice(0, 10);
  const bits = [`r${r.n}`, date];
  if (r.releaseVersion) bits.push(r.releaseVersion);
  if (r.breaking) bits.push('breaking');
  if (!r.diffable) bits.push('too old to compare');
  return `<li>${esc(bits.join(' · '))}</li>`;
}

function readinessActionsMarkup(docId: string): string {
  const id = esc(docId);
  return (
    '<div class="sl-library-readiness-actions">' +
    `<button class="sl-button" data-tone="secondary" type="button" data-library-readiness="approved" data-doc-id="${id}">Mark ready for dev</button>` +
    `<button class="sl-button" data-tone="secondary" type="button" data-library-readiness="draft" data-doc-id="${id}">Back to draft</button>` +
    `<button class="sl-button" data-tone="secondary" type="button" data-library-readiness="deprecated" data-doc-id="${id}">Mark deprecated</button>` +
    '</div>'
  );
}

function changeDetailsMarkup(row: LibraryRowPresentation): string {
  const changes = row.changeGroups?.length
    ? row.changeGroups.map(changeGroupMarkup).join('')
    : (
      '<div class="sl-library-change-fallback">' +
      `${icon('alertCircle', 16)}<span><strong>No comparison available</strong>` +
      '<small>There is only one revision so far, or the earlier one is too old to compare.</small>' +
      '</span></div>'
    );

  const timeline = row.revisions.length
    ? `<ul class="sl-library-timeline">${row.revisions.map(revisionLineMarkup).join('')}</ul>`
    : '<p class="sl-library-timeline-empty">One revision so far. Changes show up here after the next update.</p>';

  return (
    `<div id="sl-library-details-${esc(row.docId)}" class="sl-library-details"` +
    `${row.expanded ? '' : ' hidden'}>` +
    '<div class="sl-library-details-inner">' +
    `<p class="sl-library-readiness">${esc(row.readinessText)}</p>` +
    readinessActionsMarkup(row.docId) +
    '<h2>Changes</h2>' +
    `<div class="sl-library-change-list">${changes}</div>` +
    '<h2>History</h2>' +
    timeline +
    '</div></div>'
  );
}
```

Import `type RowRevision` from `../viewModel/library` alongside the existing type imports.

Wire the three buttons in the file's event delegation (follow how `data-library-filter` and `data-library-disclosure` are already handled) to post `{ type: 'setReadiness', docId, state }` where `state` is the `data-library-readiness` value.

Every user-visible string above matches the spec's copy table and contains no em dashes. The `·` separator is a middle dot, not a dash.

- [ ] **Step 8: Test the screen markup**

Add to `packages/plugin/test/libraryScreen.test.ts`, following its existing render assertions:

```ts
it('renders readiness, grouped changes and the timeline in an expanded row', () => {
  const html = renderLibraryScreen(presentationWith({
    docId: 'd1', expanded: true,
    readinessText: 'Ready for dev',
    changeGroups: [{ label: 'Variants', items: ['Added variant Size=XL'] }],
    revisions: [
      { n: 2, at: 1720000000000, releaseVersion: '2.0.0', breaking: true, diffable: true },
      { n: 1, at: 1719000000000, diffable: false },
    ],
  }));
  expect(html).toContain('Ready for dev');
  expect(html).toContain('Variants');
  expect(html).toContain('Added variant Size=XL');
  expect(html).toContain('r2');
  expect(html).toContain('2.0.0');
  expect(html).toContain('breaking');
  expect(html).toContain('too old to compare');
});

it('renders the details region for an in-sync row, not only a drifted one', () => {
  const html = renderLibraryScreen(presentationWith({
    docId: 'd1', expanded: true, status: 'inSync',
    readinessText: 'Ready for dev',
    changeGroups: null,
    revisions: [{ n: 1, at: 1720000000000, diffable: true }],
  }));
  expect(html).toContain('sl-library-details');
  expect(html).toContain('Ready for dev');
});

it('renders no em dash anywhere in the expanded row', () => {
  const html = renderLibraryScreen(presentationWith({
    docId: 'd1', expanded: true,
    readinessText: 'Draft. Was ready at r1, changed since.',
    changeGroups: [{ label: 'Source changed', items: ['Changed, but not in a way this can summarize.'] }],
    revisions: [{ n: 2, at: 1720000000000, diffable: true }],
  }));
  expect(html).not.toContain('—');
});
```

`presentationWith` is that file's existing presentation factory; extend it to accept the three new row fields.

- [ ] **Step 9: Verify and commit**

```bash
npm run check
git add packages/plugin/src/ui/viewModel/library.ts packages/plugin/src/ui/screens/library.ts packages/plugin/test/libraryViewModel.test.ts packages/plugin/test/libraryScreen.test.ts
git commit -m "feat(plugin): revision timeline, itemized diff and readiness in My Library"
```

---

### Task 9: Release dialog with the breaking-change suggestion

**Files:**
- Modify: `packages/plugin/src/ui/screens/library.ts`
- Test: `packages/plugin/test/libraryViewModel.test.ts`

**Interfaces:**
- Consumes: `hasRemovals` from Task 2, `diffRevisions` and `latestRelease` from Task 5, the `cutRelease` message from Task 6.
- Produces: `LibraryRowModel.releaseSuggestion`.

- [ ] **Step 1: Write the failing test**

Add to `packages/plugin/test/libraryViewModel.test.ts`:

```ts
it('pre-checks breaking and explains why when the diff since the last release has removals', () => {
  let h = appendRevision({ v: 1, revs: [] }, { at: 1, hash: 'h1', pluginVersion: '3.0.0', fp: FP2 });
  h = promote(h, 1, { version: '2.0.0', breaking: false, at: 1 });
  // FP drops Size=XL relative to FP2, so this is a removal.
  h = appendRevision(h, { at: 2, hash: 'h2', pluginVersion: '3.0.0', fp: FP });
  const [row] = buildLibraryModel([entry({ docId: 'd1', history: serializeHistory(h) })]).allRows;
  expect(row.releaseSuggestion).toEqual({
    breaking: true,
    reason: 'Removals since 2.0.0, so this looks breaking. Uncheck if it is not.',
  });
});

it('does not suggest breaking for additions only', () => {
  let h = appendRevision({ v: 1, revs: [] }, { at: 1, hash: 'h1', pluginVersion: '3.0.0', fp: FP });
  h = promote(h, 1, { version: '1.0.0', breaking: false, at: 1 });
  h = appendRevision(h, { at: 2, hash: 'h2', pluginVersion: '3.0.0', fp: FP2 });
  const [row] = buildLibraryModel([entry({ docId: 'd1', history: serializeHistory(h) })]).allRows;
  expect(row.releaseSuggestion).toEqual({ breaking: false });
});

it('compares against r1 when nothing has been released yet', () => {
  let h = appendRevision({ v: 1, revs: [] }, { at: 1, hash: 'h1', pluginVersion: '3.0.0', fp: FP2 });
  h = appendRevision(h, { at: 2, hash: 'h2', pluginVersion: '3.0.0', fp: FP });
  const [row] = buildLibraryModel([entry({ docId: 'd1', history: serializeHistory(h) })]).allRows;
  expect(row.releaseSuggestion).toEqual({
    breaking: true,
    reason: 'Removals since r1, so this looks breaking. Uncheck if it is not.',
  });
});

it('suggests nothing for a single-revision doc', () => {
  const h = appendRevision({ v: 1, revs: [] }, { at: 1, hash: 'h1', pluginVersion: '3.0.0', fp: FP });
  const [row] = buildLibraryModel([entry({ docId: 'd1', history: serializeHistory(h) })]).allRows;
  expect(row.releaseSuggestion).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/libraryViewModel.test.ts`
Expected: FAIL — `releaseSuggestion` is not a property.

- [ ] **Step 3: Implement it**

In `packages/plugin/src/ui/viewModel/library.ts`, add to `LibraryRowModel`:

```ts
  /** Advisory pre-fill for the release dialog. Null when there is nothing to
   *  compare. The tool never records `breaking` the designer has not seen. */
  releaseSuggestion: { breaking: boolean; reason?: string } | null;
```

Add the helper and wire it into `buildLibraryRow` as `releaseSuggestion: releaseSuggestionFor(history)`:

```ts
/**
 * Whether the release dialog should arrive with "breaking" pre-checked.
 *
 * Removals are the signature of a breaking change, so they justify a
 * suggestion, never an assertion: the reason is always shown and the box is
 * always uncheckable. Compares against the last released revision, or r1 when
 * nothing has been released.
 */
function releaseSuggestionFor(h: DocHistory): { breaking: boolean; reason?: string } | null {
  const n = currentRev(h);
  if (n < 2) return null;
  const released = [...h.revs].reverse().find((r) => r.release && r.n !== n);
  const baseline = released ?? h.revs[0];
  if (baseline.n === n) return null;
  const changes = diffRevisions(h, baseline.n, n);
  if (changes === null) return null;
  if (!hasRemovals(changes)) return { breaking: false };
  const since = released?.release?.version ?? `r${baseline.n}`;
  return {
    breaking: true,
    reason: `Removals since ${since}, so this looks breaking. Uncheck if it is not.`,
  };
}
```

Add `hasRemovals` to the `@spec-layer/extractor` import.

- [ ] **Step 4: Render the dialog**

In `packages/plugin/src/ui/screens/library.ts`, add a **Cut a release** action to the expanded row that opens an inline form with:

- A version text input, placeholder `2.1.0`, hint text `Any label works. Semver if your engineers use it.`
- A breaking checkbox, pre-checked from `row.releaseSuggestion.breaking`, with `row.releaseSuggestion.reason` shown beneath when present.
- An optional notes textarea.
- A confirm button emitting `{ type: 'cutRelease', docId, revision: row.revisions[0].n, version, breaking, notes }`.

Empty version input disables confirm: a release with no label is not a release.

- [ ] **Step 5: Verify and commit**

```bash
npm run check
git add packages/plugin/src/ui/viewModel/library.ts packages/plugin/src/ui/screens/library.ts packages/plugin/test/libraryViewModel.test.ts
git commit -m "feat(plugin): cut releases with an advisory breaking-change suggestion"
```

---

### Task 10: Markdown frontmatter

**Files:**
- Modify: `packages/format/src/types.ts`
- Modify: `packages/extractor/src/render.ts` (`renderSpec` at line 123, frontmatter object at line 132)
- Test: `packages/format/test/frontmatter.test.ts`, `packages/extractor/test/render.test.ts`

**Interfaces:**
- Consumes: `latestRelease`, `currentRev`, `resolveReadiness` from Task 5 at the call sites that already pass `status`.
- Produces: `SpecFrontmatter.version?: string`, `SpecFrontmatter.revision?: number`, and two new `renderSpec` options.

- [ ] **Step 1: Write the failing test**

Add to `packages/format/test/frontmatter.test.ts`:

```ts
it('round-trips version and revision', () => {
  const fm: SpecFrontmatter = {
    spec_version: '0.1',
    component: { name: 'Button', figma_key: 'k', figma_file: 'f', figma_node: '1:1' },
    content_hash: 'h', extracted_at: '2026-08-04T00:00:00.000Z',
    version: '2.1.0', revision: 7,
  };
  const parsed = parseFrontmatter(serializeFrontmatter(fm, 'body')).frontmatter;
  expect(parsed.version).toBe('2.1.0');
  expect(parsed.revision).toBe(7);
});

it('still parses frontmatter written without them', () => {
  const fm: SpecFrontmatter = {
    spec_version: '0.1',
    component: { name: 'Button', figma_key: 'k', figma_file: 'f', figma_node: '1:1' },
    content_hash: 'h', extracted_at: '2026-08-04T00:00:00.000Z',
  };
  const parsed = parseFrontmatter(serializeFrontmatter(fm, 'body')).frontmatter;
  expect(parsed.version).toBeUndefined();
  expect(parsed.revision).toBeUndefined();
});
```

Add to `packages/extractor/test/render.test.ts`:

```ts
it('emits version and revision when supplied, and omits them otherwise', () => {
  const withVer = renderSpec(sampleSpec(), {
    prose: null, extractedAt: '2026-08-04T00:00:00.000Z',
    status: 'approved', version: '2.1.0', revision: 7,
  });
  expect(withVer).toContain('version: 2.1.0');
  expect(withVer).toContain('revision: 7');

  const without = renderSpec(sampleSpec(), { prose: null, extractedAt: '2026-08-04T00:00:00.000Z' });
  expect(without).not.toContain('version:');
  expect(without).not.toContain('revision:');
});

it('does not change content_hash when version and revision are added', () => {
  const opts = { prose: null, extractedAt: '2026-08-04T00:00:00.000Z' };
  const hashOf = (md: string) => /content_hash: (\S+)/.exec(md)?.[1];
  expect(hashOf(renderSpec(sampleSpec(), { ...opts, version: '2.1.0', revision: 7 })))
    .toBe(hashOf(renderSpec(sampleSpec(), opts)));
});
```

`sampleSpec()` is that file's existing fixture helper.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/format/test/frontmatter.test.ts packages/extractor/test/render.test.ts`
Expected: FAIL — `version` is not a property of `SpecFrontmatter`.

- [ ] **Step 3: Add the frontmatter keys**

In `packages/format/src/types.ts`, add inside `SpecFrontmatter` after `status`:

```ts
  /**
   * Named release covering this doc, verbatim as the designer typed it.
   * A new OPTIONAL KEY, not a new `status` value: `status` is validated against
   * a closed list, so a fourth value would make older parsers throw.
   */
  version?: string;
  /** Revision number at export time. */
  revision?: number;
```

No `spec_version` bump, and no parser change: unknown-but-absent optional keys were already tolerated.

- [ ] **Step 4: Emit them**

In `packages/extractor/src/render.ts`, extend the `renderSpec` options type at line 125:

```ts
  opts: {
    prose: ProseDrafts | null;
    extractedAt: string;
    status?: SpecFrontmatter['status'];
    version?: string;
    revision?: number;
  },
```

and the frontmatter object at line 132, immediately after the `status` spread:

```ts
    ...(opts.version ? { version: opts.version } : {}),
    ...(opts.revision !== undefined ? { revision: opts.revision } : {}),
```

Both are spread-conditionally so a doc without them serializes byte-identically to one written before this feature. `content_hash` is unaffected because `specContentHash` reads the spec, never the frontmatter.

- [ ] **Step 5: Pass them from the download path**

Find the `renderSpec(` call sites in `packages/plugin/src/` (the Markdown download and ZIP export paths) and add:

```ts
      ...(release ? { version: release.version } : {}),
      revision: currentRev(history),
      status: resolveReadiness(history).state,
```

where `history` is the parsed blob for that doc and `release` is `latestRelease(history)`. A doc with no history yields `revision: 0`; guard that to omit the key rather than exporting a meaningless zero:

```ts
      ...(currentRev(history) ? { revision: currentRev(history) } : {}),
```

- [ ] **Step 6: Verify and commit**

```bash
npm run check
git add packages/format/src/types.ts packages/extractor/src/render.ts packages/plugin/src packages/format/test/frontmatter.test.ts packages/extractor/test/render.test.ts
git commit -m "feat(format): carry version and revision in spec frontmatter"
```

---

### Task 11: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/feature-backlog-2026-07.md`

- [ ] **Step 1: Update the README**

In the "What it generates" list, extend the **Library** bullet to mention the timeline and readiness. Under Roadmap, remove the now-shipped "Drift detection surfaces beyond the in-Figma badge, using the committed content hash" line and add a note that version stamping onto source components is deliberately not planned.

- [ ] **Step 2: Update ARCHITECTURE.md**

Add `specLayerHistory` to the pluginData documentation alongside `specLayerDoc`, stating the separate-key rationale, the 90 kB ceiling, and the two-tier retention. Add `fingerprint.ts` and `docHistory.ts` to the module map, noting both are pure.

- [ ] **Step 3: Update CHANGELOG.md**

Add an entry under an Unreleased heading describing per-component revision history, deterministic change summaries, named releases with an advisory breaking flag, and expiring dev readiness. Note explicitly that no source component is ever modified.

- [ ] **Step 4: Update the backlog**

Mark the versioning item built, referencing the spec at `docs/superpowers/specs/2026-08-04-component-versioning-design.md` and this plan.

- [ ] **Step 5: Verify and commit**

```bash
npm run check
git add README.md CHANGELOG.md ARCHITECTURE.md docs/feature-backlog-2026-07.md
git commit -m "docs: component versioning and dev readiness"
```

---

## Manual Figma verification

The automated suite cannot exercise real pluginData or real frame rendering. Run this pass in Figma desktop before considering the feature done.

- [ ] Build with `npm run build:plugin`, import the manifest, and generate a doc for a component set. Confirm the frame header reads `Name · r1 · Draft`.
- [ ] Regenerate without touching the component. Confirm the frame still reads `r1`, proving append idempotency against real pluginData.
- [ ] Add a variant to the source component, then Update the doc. Confirm the header reads `r2` and My Library shows "Added variant ...".
- [ ] Change something outside the fingerprint's projection (rename the component). Confirm the row says "Changed, but not in a way this can summarize." rather than reporting no changes.
- [ ] Mark ready for dev. Confirm the frame header and the panel both read `Ready for dev`.
- [ ] Edit the source component again and Update. Confirm readiness has fallen back to `Draft. Was ready at rN, changed since.`
- [ ] Cut a release from the panel with a removal in the diff. Confirm the breaking box arrives pre-checked with its reason, and that unchecking it is honoured.
- [ ] Download the Markdown. Confirm `version`, `revision` and `status` appear in frontmatter and `content_hash` is unchanged from a pre-feature export of the same component.
- [ ] Open a doc generated by the previous plugin build. Confirm it loads, shows an empty timeline, and seeds `r1` on its first Update rather than erroring.
- [ ] Confirm no source component's name or description was modified anywhere in the run.
