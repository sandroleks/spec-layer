# Repository Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `spec-layer pull` writes a deterministic CSS custom-property file at a declared path in the team's tree, driven by a platform/format/case output model, and the component directory is renamed `components/`.

**Architecture:** A new pure projection in the extractor, `v5/outputs/css.ts`, reads the existing `DtcgExport` (never the artifact) and returns CSS text, a name map, and a report. The CLI gains an `outputs` block in `speclayer.json`, resolves defaults from `platforms`, writes the name map and report into the swapped `.speclayer/outputs/` record, and writes the deliverable in place at the declared path with a header check so it never overwrites a foreign file.

**Tech Stack:** TypeScript, Vitest, Node 22, esbuild (CLI bundle). `postcss` becomes a root dev dependency for the CSS validity test only.

**Spec:** `docs/superpowers/specs/2026-09-08-repository-delivery-design.md`. Section numbers below refer to it.

## Global Constraints

- Never fabricate: no unit, mode, media query, or value is inferred. Names are derived by the stated rule and recorded with provenance. Collisions omit every colliding token and report.
- Under `packages/extractor/src/v5` use `compareCodeUnits` from `v5/diagnostics.ts` for every ordering. Never `localeCompare`.
- The CSS projection reads a `DtcgExport` only. It never touches the artifact, Figma globals, or any hash.
- Same input and options produce the same bytes on every machine. Headers carry a content hash, never a time or CLI version.
- The managed directory (`outDir`, default `.speclayer`) is swapped wholesale. Deliverables are written in place at `outputs[].path`, atomically, never deleted, and never over a file that does not begin with the Spec Layer header.
- No em dashes anywhere in CLI output, guide text, docs, or code comments.
- CLI version becomes `0.6.0`. `EXTRACTOR_VERSION` stays `'2'`. No schema change, no bundle version change.
- Conventional commit subjects, lowercase, scoped: `feat(cli): ...`, `feat(extractor): ...`, `docs: ...`. Every commit ends with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Run every command from the worktree root `/Users/sandrolek/Documents/Projects/Design System Docs/.claude/worktrees/export-strategy`. Tests: `npx vitest run <path>`.

---

## File structure

**Extractor (new):**
- `packages/extractor/src/v5/outputs/naming.ts`: word splitting, the five cases, `deriveName`, `resolveNames` (declared-or-derived with collision omission), report types shared by every output format.
- `packages/extractor/src/v5/outputs/css.ts`: `cssOutput(export, header, options)`: resolver walk, value formatting, typography and shadow members, mode blocks, header.
- `packages/extractor/src/v5/outputs/index.ts`: re-exports.
- `packages/extractor/test/v5/outputs/naming.test.ts`, `css.test.ts`, `cssGolden.test.ts`.
- `packages/extractor/test/fixtures/v5/synthetic-foundation-css/kebab/{tokens.css,map.json,report.json}` and `camel/...`.

**Extractor (modified):**
- `packages/extractor/src/v5/index.ts`: add `export * from './outputs/index';`.

**CLI (new):**
- `packages/cli/src/outputs.ts`: `OutputConfig`, the format registry, `defaultOutputs`, `withDefaults`, `parseOutput`, `renderOutput`, `outputPathProblem`, `writeOutputFile`, `outputId`.
- `packages/cli/test/outputs.test.ts`.

**CLI (modified):**
- `packages/cli/src/config.ts`: `platforms`, `outputs` in `CliConfig`, parse and write.
- `packages/cli/src/files.ts`: `components/` directory, manifest `path` with `aiPath` read fallback, outputs record files, deliverable writes, new return shape.
- `packages/cli/src/commands.ts`: repeatable `--platform` on setup, init, pull, skill; platform and output resolution; messages; `list` outputs rows.
- `packages/cli/src/cli.ts`: `platform` flag `multiple: true`, usage text.
- `packages/cli/src/skill.ts`: `PullSummary.outputs`, web section, step 2 and 6 text, `platformSource: 'config'`.
- `packages/cli/src/tools.ts`: usage and writes for setup, init, pull.
- `packages/cli/package.json`: version `0.6.0`.
- Tests: `files.test.ts`, `commands.test.ts`, `config.test.ts`, `skill.test.ts`, `tools.test.ts`.

**Docs:**
- `packages/cli/README.md`, `CHANGELOG.md`, `ARCHITECTURE.md`, `apps/website/content/docs/outputs.html`, `quickstart.html`, `cli.html`, `configuration.html` (if present, see Task 8).

---

### Task 1: Naming module

**Files:**
- Create: `packages/extractor/src/v5/outputs/naming.ts`
- Create: `packages/extractor/src/v5/outputs/index.ts`
- Modify: `packages/extractor/src/v5/index.ts` (add one export line after `export * from './dtcg';`)
- Test: `packages/extractor/test/v5/outputs/naming.test.ts`

**Interfaces:**
- Produces: `NameCase`, `NAME_CASES`, `splitWords(segment)`, `pathWords(path)`, `joinWords(words, nameCase)`, `deriveName(path, nameCase)`, `OutputMapEntry`, `OutputReportCode`, `OutputReportEntry`, `NameRules`, `ResolvedNames`, `resolveNames(paths, meta, rules)`, `sortReport(entries)`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/extractor/test/v5/outputs/naming.test.ts
import { describe, expect, it } from 'vitest';
import {
  deriveName, joinWords, pathWords, resolveNames, splitWords, type NameCase,
} from '../../../src/index';

describe('splitWords', () => {
  it('splits on non-alphanumeric runs and lowercase-to-uppercase boundaries, not digits', () => {
    expect(splitWords('fontSize')).toEqual(['font', 'Size']);
    expect(splitWords('Blue 500')).toEqual(['Blue', '500']);
    expect(splitWords('h1')).toEqual(['h1']);
    expect(splitWords('surface--primary_default')).toEqual(['surface', 'primary', 'default']);
    expect(splitWords('!!!')).toEqual([]);
  });
});

describe('joinWords and deriveName', () => {
  const cases: Array<[NameCase, string, string]> = [
    ['kebab', 'mapped-colors-surface-primary-default', 'foundation-font-size-850'],
    ['camel', 'mappedColorsSurfacePrimaryDefault', 'foundationFontSize850'],
    ['pascal', 'MappedColorsSurfacePrimaryDefault', 'FoundationFontSize850'],
    ['snake', 'mapped_colors_surface_primary_default', 'foundation_font_size_850'],
    ['constant', 'MAPPED_COLORS_SURFACE_PRIMARY_DEFAULT', 'FOUNDATION_FONT_SIZE_850'],
  ];
  for (const [nameCase, a, b] of cases) {
    it(`derives ${nameCase} names`, () => {
      expect(deriveName('Mapped Colors.surface.primary.default', nameCase)).toBe(a);
      expect(deriveName('Foundation.fontSize.850', nameCase)).toBe(b);
    });
  }
  it('turns a segment with no words into _', () => {
    expect(pathWords('A.!!!.b')).toEqual(['A', '_', 'b']);
    expect(deriveName('A.!!!.b', 'kebab')).toBe('a-_-b');
    expect(joinWords(['x', '_', 'y'], 'camel')).toBe('x_Y');
  });
});

describe('resolveNames', () => {
  const rules = {
    codeSyntaxKey: 'WEB',
    acceptDeclared: (d: string) => (d.startsWith('--') ? d : null),
    affix: (b: string) => `--${b}`,
    nameCase: 'kebab' as NameCase,
  };
  const meta = {
    'P.color.red': { id: 'v1', collection_id: 'c', type: 'color', scopes: [], code_syntax: { WEB: '--red' } },
    'P.color.js': { id: 'v2', collection_id: 'c', type: 'color', scopes: [], code_syntax: { WEB: 'theme.colors.js' } },
  };

  it('uses a declared name verbatim and marks its source', () => {
    const out = resolveNames(['P.color.red'], meta, rules);
    expect(out.names.get('P.color.red')).toBe('--red');
    expect(out.map['P.color.red']).toEqual({ name: '--red', source: 'code_syntax' });
    expect(out.report).toEqual([]);
  });

  it('derives when the declared name is unusable, and reports it', () => {
    const out = resolveNames(['P.color.js'], meta, rules);
    expect(out.names.get('P.color.js')).toBe('--p-color-js');
    expect(out.map['P.color.js']).toEqual({ name: '--p-color-js', source: 'derived' });
    expect(out.report).toEqual([{
      code: 'code_syntax_not_usable', severity: 'info', path: 'P.color.js',
      message: 'The declared WEB identifier "theme.colors.js" is not a name this format can use; the name was derived instead.',
      details: { declared: 'theme.colors.js', platform: 'WEB' },
    }]);
  });

  it('omits every token that reaches the same name and reports each', () => {
    const out = resolveNames(['P.Blue', 'P.blue', 'P.green'], {}, rules);
    expect(out.names.has('P.Blue')).toBe(false);
    expect(out.names.has('P.blue')).toBe(false);
    expect(out.names.get('P.green')).toBe('--p-green');
    expect(Object.keys(out.map)).toEqual(['P.green']);
    expect(out.report.map((r) => [r.code, r.path])).toEqual([
      ['name_collision', 'P.Blue'], ['name_collision', 'P.blue'],
    ]);
    expect(out.report[0].details).toEqual({ name: '--p-blue', paths: ['P.Blue', 'P.blue'] });
  });

  it('never reads code_syntax when the platform key is null', () => {
    const out = resolveNames(['P.color.red'], meta, { ...rules, codeSyntaxKey: null });
    expect(out.names.get('P.color.red')).toBe('--p-color-red');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/v5/outputs/naming.test.ts`
Expected: FAIL, the imports do not exist.

- [ ] **Step 3: Write the module**

```ts
// packages/extractor/src/v5/outputs/naming.ts
/**
 * Names for generated platform outputs. Spec:
 * docs/superpowers/specs/2026-09-08-repository-delivery-design.md, 4.3.
 *
 * A token's identifier is the designer's declared code_syntax when the format
 * can use it, else a documented transform of its DTCG path. Two tokens that
 * reach one identifier are both omitted and reported; nothing picks a winner.
 */
import { compareCodeUnits } from '../diagnostics';
import type { DtcgExport, DtcgJson } from '../dtcg';

export type NameCase = 'kebab' | 'camel' | 'pascal' | 'snake' | 'constant';
export const NAME_CASES: readonly NameCase[] = ['kebab', 'camel', 'pascal', 'snake', 'constant'];

export interface OutputMapEntry { name: string; source: 'code_syntax' | 'derived' }

export type OutputReportCode =
  | 'code_syntax_not_usable' | 'name_collision' | 'reference_target_omitted'
  | 'mode_selector_shared' | 'value_converted' | 'not_expressible';

export interface OutputReportEntry {
  code: OutputReportCode;
  severity: 'error' | 'warning' | 'info';
  /** DTCG path, or a collection label for mode_selector_shared. */
  path: string;
  mode?: string;
  message: string;
  details: Record<string, DtcgJson>;
}

/**
 * A DTCG path segment as words: split on every run of characters outside
 * letters and digits and on every lowercase-to-uppercase boundary. Digits are
 * not a boundary, so `h1` stays one word.
 */
export function splitWords(segment: string): string[] {
  return segment
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

/** Every word of a dot-joined DTCG path; a segment with no words becomes `_`. */
export function pathWords(path: string): string[] {
  return path.split('.').flatMap((seg) => {
    const words = splitWords(seg);
    return words.length > 0 ? words : ['_'];
  });
}

export function joinWords(words: string[], nameCase: NameCase): string {
  const lower = words.map((w) => w.toLowerCase());
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  switch (nameCase) {
    case 'kebab': return lower.join('-');
    case 'snake': return lower.join('_');
    case 'constant': return lower.join('_').toUpperCase();
    case 'camel': return lower.map((w, i) => (i === 0 ? w : cap(w))).join('');
    case 'pascal': return lower.map(cap).join('');
    default: {
      const exhaustive: never = nameCase;
      return exhaustive;
    }
  }
}

/** The derived identifier body for a path, before the format adds its affix. */
export function deriveName(path: string, nameCase: NameCase): string {
  return joinWords(pathWords(path), nameCase);
}

export interface NameRules {
  /** The code_syntax key this platform reads; null when Figma declares none. */
  codeSyntaxKey: string | null;
  /** The declared identifier as the format can use it, or null when it cannot. */
  acceptDeclared: (declared: string) => string | null;
  /** Wraps a derived body in the format's affix, e.g. `--` for CSS. */
  affix: (body: string) => string;
  nameCase: NameCase;
}

export interface ResolvedNames {
  /** DTCG path -> emitted identifier, for every token that survived. */
  names: Map<string, string>;
  map: Record<string, OutputMapEntry>;
  report: OutputReportEntry[];
}

export function sortReport(entries: OutputReportEntry[]): OutputReportEntry[] {
  return [...entries].sort((a, b) => compareCodeUnits(a.path, b.path)
    || compareCodeUnits(a.code, b.code) || compareCodeUnits(a.mode ?? '', b.mode ?? ''));
}

/** `paths` are the DTCG paths the output will emit, tokens and styles alike. */
export function resolveNames(
  paths: string[], meta: DtcgExport['meta'], rules: NameRules,
): ResolvedNames {
  const report: OutputReportEntry[] = [];
  const candidates = new Map<string, Array<{ path: string; source: OutputMapEntry['source'] }>>();
  for (const path of [...paths].sort(compareCodeUnits)) {
    let name: string | null = null;
    let source: OutputMapEntry['source'] = 'derived';
    const declared = rules.codeSyntaxKey ? meta[path]?.code_syntax?.[rules.codeSyntaxKey] : undefined;
    if (declared !== undefined) {
      name = rules.acceptDeclared(declared);
      if (name !== null) {
        source = 'code_syntax';
      } else {
        report.push({
          code: 'code_syntax_not_usable', severity: 'info', path,
          message: `The declared ${rules.codeSyntaxKey} identifier "${declared}" is not a name this format can use; the name was derived instead.`,
          details: { declared, platform: rules.codeSyntaxKey ?? '' },
        });
      }
    }
    if (name === null) name = rules.affix(deriveName(path, rules.nameCase));
    const list = candidates.get(name) ?? [];
    list.push({ path, source });
    candidates.set(name, list);
  }
  const names = new Map<string, string>();
  const map: Record<string, OutputMapEntry> = {};
  for (const [name, list] of candidates) {
    if (list.length > 1) {
      const collided = list.map((c) => c.path).sort(compareCodeUnits);
      for (const c of list) {
        report.push({
          code: 'name_collision', severity: 'error', path: c.path,
          message: `${list.length} tokens would share the name ${name}; all were omitted.`,
          details: { name, paths: collided },
        });
      }
      continue;
    }
    names.set(list[0].path, name);
    map[list[0].path] = { name, source: list[0].source };
  }
  const sortedMap = Object.fromEntries(Object.entries(map).sort(([a], [b]) => compareCodeUnits(a, b)));
  return { names, map: sortedMap, report: sortReport(report) };
}
```

```ts
// packages/extractor/src/v5/outputs/index.ts
export * from './naming';
```

In `packages/extractor/src/v5/index.ts`, after `export * from './dtcg';` add:

```ts
export * from './outputs/index';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/v5/outputs/naming.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add packages/extractor/src/v5/outputs packages/extractor/src/v5/index.ts packages/extractor/test/v5/outputs/naming.test.ts
git commit -m "feat(extractor): name derivation and collision rules for platform outputs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: CSS output projection

**Files:**
- Create: `packages/extractor/src/v5/outputs/css.ts`
- Modify: `packages/extractor/src/v5/outputs/index.ts` (add `export * from './css';`)
- Test: `packages/extractor/test/v5/outputs/css.test.ts`

**Interfaces:**
- Consumes: everything from Task 1; `DtcgExport`, `DtcgJson`, `DtcgTree` from `../dtcg`; `canonicalNumber` from `../precision`; `compareCodeUnits`.
- Produces: `CssOutputOptions { case?, root?, modeSelector?, modes? }`, `CssOutput { text, map, report }`, `OutputHeader { libraryId, contentHash }`, `CSS_DEFAULTS`, `CSS_HEADER_PREFIX`, `acceptCssDeclared(declared)`, `cssOutput(exp, header, options?)`.

- [ ] **Step 1: Write the failing tests**

The tests build a small `DtcgExport` by hand so each rule is visible, and use the synthetic fixture once for structure.

```ts
// packages/extractor/test/v5/outputs/css.test.ts
import { describe, expect, it } from 'vitest';
import {
  CSS_HEADER_PREFIX, acceptCssDeclared, cssOutput, foundationDtcg, type DtcgExport,
} from '../../../src/index';
import { syntheticArtifact } from '../dtcgFixture';

const HEADER = { libraryId: 'lib_test', contentHash: 'sha256:abc' };

const color = (hex: string, alpha = 1) => ({
  $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0], alpha, hex },
});

/** One set (Base) and one modifier (Theme: Light default, Dark). */
function small(overrides: Partial<DtcgExport> = {}): DtcgExport {
  return {
    files: {
      'base.default.json': {
        Base: {
          color: { red: color('#ff0000'), glass: color('#801a00', 0.125) },
          space: { gap: { $type: 'dimension', $value: { value: 8, unit: 'px' } } },
          weight: { $type: 'fontWeight', $value: 700 },
          ratio: { $type: 'number', $value: 1.5 },
          ease: { $type: 'cubicBezier', $value: [0.4, 0, 0.2, 1] },
          time: { $type: 'duration', $value: { value: 200, unit: 'ms' } },
          family: { $type: 'fontFamily', $value: 'Open Sans' },
        },
      },
      'theme.light.json': { Theme: { surface: { $type: 'color', $value: '{Base.color.red}' } } },
      'theme.dark.json': { Theme: { surface: { $type: 'color', $value: '{Base.color.glass}' } } },
    },
    resolver: {
      version: '2025.10',
      sets: { Base: { sources: [{ $ref: 'base.default.json' }] } },
      modifiers: { Theme: { contexts: { Light: [{ $ref: 'theme.light.json' }], Dark: [{ $ref: 'theme.dark.json' }] }, default: 'Light' } },
      resolutionOrder: [{ $ref: '#/sets/Base' }, { $ref: '#/modifiers/Theme' }],
    },
    meta: {
      'Base.color.red': { id: 'v1', collection_id: 'c1', type: 'color', scopes: [], code_syntax: { WEB: '--red' } },
      'Base.space.gap': { id: 'v2', collection_id: 'c1', type: 'dimension', scopes: [], code_syntax: { WEB: 'gap' } },
    },
    report: [],
    ...overrides,
  };
}

describe('acceptCssDeclared', () => {
  it('accepts a custom property, prefixes a bare identifier, rejects anything else', () => {
    expect(acceptCssDeclared('--colors-blue-500')).toBe('--colors-blue-500');
    expect(acceptCssDeclared('colorsBlue500')).toBe('--colorsBlue500');
    expect(acceptCssDeclared('theme.colors.blue500')).toBeNull();
    expect(acceptCssDeclared('--has space')).toBeNull();
  });
});

describe('cssOutput values', () => {
  const text = cssOutput(small(), HEADER).text;

  it('starts with the header carrying library, hash, and output triple, and no timestamp', () => {
    expect(text.startsWith(`${CSS_HEADER_PREFIX} from library lib_test, foundation sha256:abc, web/css/kebab.`)).toBe(true);
    expect(text).toContain('Do not edit. Change the design in Figma, republish, and run spec-layer pull.');
    expect(text).not.toMatch(/20\d\d-\d\d-\d\d/);
  });

  it('writes every type in its CSS form', () => {
    expect(text).toContain('  --red: #ff0000;');
    expect(text).toContain('  --base-color-glass: rgb(128 26 0 / 0.125);');
    expect(text).toContain('  --gap: 8px;');
    expect(text).toContain('  --base-weight: 700;');
    expect(text).toContain('  --base-ratio: 1.5;');
    expect(text).toContain('  --base-ease: cubic-bezier(0.4, 0, 0.2, 1);');
    expect(text).toContain('  --base-time: 200ms;');
    expect(text).toContain('  --base-family: "Open Sans";');
  });

  it('keeps aliases as var() and scopes non-default modes under data-theme', () => {
    const root = text.slice(text.indexOf(':root {'), text.indexOf('}', text.indexOf(':root {')));
    expect(root).toContain('  /* Base */');
    expect(root).toContain('  /* Theme, Light */');
    expect(root).toContain('  --theme-surface: var(--red);');
    const dark = text.slice(text.indexOf('[data-theme="dark"] {'));
    expect(dark).toContain('  /* Theme, Dark */');
    expect(dark).toContain('  --theme-surface: var(--base-color-glass);');
    expect(text.indexOf(':root {')).toBeLessThan(text.indexOf('[data-theme="dark"] {'));
  });

  it('passes legacy string values through verbatim', () => {
    const legacy = small({
      files: { ...small().files, 'base.default.json': { Base: { c: { $type: 'color', $value: '#11223380' }, d: { $type: 'dimension', $value: '1rem' } } } },
    });
    const out = cssOutput(legacy, HEADER).text;
    expect(out).toContain('  --base-c: #11223380;');
    expect(out).toContain('  --base-d: 1rem;');
  });
});

describe('cssOutput names, modes, and reports', () => {
  it('records provenance for every emitted name', () => {
    const { map } = cssOutput(small(), HEADER);
    expect(map['Base.color.red']).toEqual({ name: '--red', source: 'code_syntax' });
    expect(map['Base.space.gap']).toEqual({ name: '--gap', source: 'code_syntax' });
    expect(map['Theme.surface']).toEqual({ name: '--theme-surface', source: 'derived' });
  });

  it('applies the chosen case to derived names only', () => {
    const { text, map } = cssOutput(small(), HEADER, { case: 'camel' });
    expect(text).toContain('  --themeSurface: var(--red);');
    expect(text).toContain('web/css/camel.');
    expect(map['Base.color.red'].name).toBe('--red');
  });

  it('omits a reference whose target was omitted and reports it', () => {
    const exp = small();
    exp.files['theme.light.json'] = { Theme: { surface: { $type: 'color', $value: '{Base.color.missing}' } } };
    const { text, report } = cssOutput(exp, HEADER);
    expect(text).not.toContain('--theme-surface: var(--base-color-missing)');
    expect(report).toContainEqual(expect.objectContaining({
      code: 'reference_target_omitted', path: 'Theme.surface', mode: 'Light', details: { target: 'Base.color.missing' },
    }));
  });

  it('honours root, modeSelector, {collection}, and a per-collection selector', () => {
    const { text } = cssOutput(small(), HEADER, {
      root: 'html', modeSelector: '.{collection}-{mode}',
    });
    expect(text).toContain('html {');
    expect(text).toContain('.theme-dark {');
    const per = cssOutput(small(), HEADER, { modes: { Theme: '[data-mode="{mode}"]' } }).text;
    expect(per).toContain('[data-mode="dark"] {');
  });

  it('reports a shared selector when two modifiers use the default template', () => {
    const exp = small();
    exp.files['density.compact.json'] = { Density: { pad: { $type: 'dimension', $value: { value: 4, unit: 'px' } } } };
    exp.files['density.cozy.json'] = { Density: { pad: { $type: 'dimension', $value: { value: 8, unit: 'px' } } } };
    exp.resolver.modifiers.Density = { contexts: { Compact: [{ $ref: 'density.compact.json' }], Cozy: [{ $ref: 'density.cozy.json' }] }, default: 'Compact' };
    exp.resolver.resolutionOrder.push({ $ref: '#/modifiers/Density' });
    const { report } = cssOutput(exp, HEADER);
    const shared = report.filter((r) => r.code === 'mode_selector_shared');
    expect(shared.map((r) => r.path)).toEqual(['Density', 'Theme']);
    expect(shared[0].details).toEqual({ modifiers: ['Density', 'Theme'], selector: '[data-theme="{mode}"]' });
    const fixed = cssOutput(exp, HEADER, { modes: { Density: '[data-density="{mode}"]' } }).report;
    expect(fixed.some((r) => r.code === 'mode_selector_shared')).toBe(false);
  });
});

describe('cssOutput styles', () => {
  const styled: DtcgExport = {
    files: {
      'base.default.json': { Base: { fam: { $type: 'fontFamily', $value: 'Inter' }, blur: { $type: 'dimension', $value: { value: 8, unit: 'px' } } } },
      'styles.typography.json': {
        'Typography styles': {
          Body: {
            $type: 'typography',
            $value: { fontFamily: '{Base.fam}', fontSize: { value: 16, unit: 'px' }, fontWeight: 400 },
            $extensions: { 'com.spec-layer': {
              lineHeight: { value: 24, unit: 'px' }, letterSpacing: { value: 2, unit: '%' },
              textCase: 'upper', textDecoration: 'strikethrough',
            } },
          },
          Caps: {
            $type: 'typography', $value: { fontSize: { value: 12, unit: 'px' }, lineHeight: 1.2 },
            $extensions: { 'com.spec-layer': { lineHeight: { value: 140, unit: '%' }, textCase: 'small_caps', textDecoration: 'none' } },
          },
        },
      },
      'styles.effects.json': {
        'Effect styles': {
          Card: {
            $type: 'shadow',
            $value: [
              { color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.2, hex: '#000000' }, offsetX: { value: 0, unit: 'px' }, offsetY: { value: 4, unit: 'px' }, blur: '{Base.blur}', spread: { value: 0, unit: 'px' }, inset: false },
              { color: { colorSpace: 'srgb', components: [1, 1, 1], alpha: 1, hex: '#ffffff' }, offsetX: { value: 0, unit: 'px' }, offsetY: { value: 1, unit: 'px' }, blur: { value: 0, unit: 'px' }, spread: { value: 0, unit: 'px' }, inset: true },
            ],
          },
          Blur: { $type: 'shadow', $value: [] },
        },
      },
    },
    resolver: {
      version: '2025.10',
      sets: {
        Base: { sources: [{ $ref: 'base.default.json' }] },
        'Typography styles': { sources: [{ $ref: 'styles.typography.json' }] },
        'Effect styles': { sources: [{ $ref: 'styles.effects.json' }] },
      },
      modifiers: {},
      resolutionOrder: [{ $ref: '#/sets/Base' }, { $ref: '#/sets/Typography styles' }, { $ref: '#/sets/Effect styles' }],
    },
    meta: {},
    report: [],
  };
  const { text, report } = cssOutput(styled, HEADER);

  it('writes typography as one custom property per member, never a font shorthand', () => {
    expect(text).toContain('  --typography-styles-body-font-family: var(--base-fam);');
    expect(text).toContain('  --typography-styles-body-font-size: 16px;');
    expect(text).toContain('  --typography-styles-body-font-weight: 400;');
    expect(text).toContain('  --typography-styles-body-line-height: 24px;');
    expect(text).toContain('  --typography-styles-body-letter-spacing: 0.02em;');
    expect(text).toContain('  --typography-styles-body-text-transform: uppercase;');
    expect(text).toContain('  --typography-styles-body-text-decoration: line-through;');
    expect(text).not.toMatch(/font: /);
  });

  it('keeps a lineHeight already in $value, and reports what it restated or could not say', () => {
    expect(text).toContain('  --typography-styles-caps-line-height: 1.2;');
    expect(text).not.toContain('--typography-styles-caps-line-height: 1.4');
    expect(text).not.toContain('--typography-styles-caps-text-transform');
    expect(report).toContainEqual(expect.objectContaining({
      code: 'value_converted', path: 'Typography styles.Body', details: { property: 'letterSpacing', from: { value: 2, unit: '%' }, to: '0.02em' },
    }));
    expect(report).toContainEqual(expect.objectContaining({
      code: 'not_expressible', path: 'Typography styles.Caps', details: { property: 'textCase', value: 'small_caps' },
    }));
  });

  it('writes shadows as one box-shadow list and omits a style with no visible shadow', () => {
    expect(text).toContain('  --effect-styles-card: 0px 4px var(--base-blur) 0px rgb(0 0 0 / 0.2), inset 0px 1px 0px 0px #ffffff;');
    expect(text).not.toContain('--effect-styles-blur');
    expect(report).toContainEqual(expect.objectContaining({
      code: 'not_expressible', path: 'Effect styles.Blur', details: { reason: 'no_visible_shadow' },
    }));
  });
});

describe('cssOutput on the synthetic foundation', () => {
  it('emits the declared names, the duplicate mode slug, and the shared-selector report', () => {
    const { text, report } = cssOutput(foundationDtcg(syntheticArtifact()), HEADER);
    expect(text).toContain('  --color-exact-red: #ff0000;');
    expect(text).toContain('  --spacing-gap: 8px;');
    expect(text).toContain('  --color-surface-primary: #ffffff;');
    expect(text).toContain('[data-theme="dark"] {');
    expect(text).toContain('[data-theme="light-2"] {');
    expect(text).toContain('  --effect-styles-shadow-card: 0px 4px var(--effect-shadow-blur) 0px rgb(0 0 0 / 0.2);');
    expect(report.filter((r) => r.code === 'mode_selector_shared').map((r) => r.path)).toEqual(['Primitives', 'Semantic']);
  });

  it('is byte-stable across runs', () => {
    const a = cssOutput(foundationDtcg(syntheticArtifact()), HEADER);
    const b = cssOutput(foundationDtcg(syntheticArtifact()), HEADER);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/extractor/test/v5/outputs/css.test.ts`
Expected: FAIL, `cssOutput` is not exported.

- [ ] **Step 3: Write the module**

```ts
// packages/extractor/src/v5/outputs/css.ts
/**
 * CSS custom properties from a DTCG export. Spec:
 * docs/superpowers/specs/2026-09-08-repository-delivery-design.md, section 5.
 *
 * A projection of a projection: it reads the DtcgExport and never the
 * artifact, so v5 keeps one reader. It feeds no hash. Anything CSS cannot
 * state is omitted and reported, never approximated. Sets and every
 * modifier's default context land at the root selector; every other context
 * lands in a block under a declared selector template. Nothing about a
 * mode's name chooses a media query.
 */
import type { DtcgExport, DtcgJson, DtcgTree } from '../dtcg';
import { compareCodeUnits } from '../diagnostics';
import { canonicalNumber } from '../precision';
import {
  joinWords, pathWords, resolveNames, sortReport,
  type NameCase, type OutputMapEntry, type OutputReportEntry,
} from './naming';

export interface CssOutputOptions {
  case?: NameCase;
  /** Selector for sets and default contexts. */
  root?: string;
  /** Template for non-default contexts; `{mode}` and `{collection}` are replaced by their file-name slugs. */
  modeSelector?: string;
  /** Per-collection template, keyed by the resolver's collection label. */
  modes?: Record<string, string>;
}
export interface CssOutput { text: string; map: Record<string, OutputMapEntry>; report: OutputReportEntry[] }
export interface OutputHeader { libraryId: string; contentHash: string }

export const CSS_DEFAULTS: { case: NameCase; root: string; modeSelector: string } = {
  case: 'kebab', root: ':root', modeSelector: '[data-theme="{mode}"]',
};
/** The first bytes of every file this output writes; the CLI refuses to overwrite a file without them. */
export const CSS_HEADER_PREFIX = '/* Generated by spec-layer';
const EXT = 'com.spec-layer';

const CUSTOM_PROPERTY = /^--[A-Za-z0-9_-]+$/;
const BARE_IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** A declared WEB identifier as a custom property name, or null when it is not one. */
export function acceptCssDeclared(declared: string): string | null {
  if (CUSTOM_PROPERTY.test(declared)) return declared;
  if (BARE_IDENT.test(declared)) return `--${declared}`;
  return null;
}

// ---------------------------------------------------------------------------
// Reading the export
// ---------------------------------------------------------------------------

interface Leaf { path: string; type: string; value: DtcgJson; ext: DtcgTree | null }

const asRecord = (v: DtcgJson | undefined): DtcgTree | null =>
  (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null);

function collectLeaves(tree: DtcgJson, prefix: string[], out: Leaf[]): void {
  const node = asRecord(tree);
  if (!node) return;
  if ('$value' in node) {
    const ours = asRecord(asRecord(node.$extensions)?.[EXT]);
    out.push({
      path: prefix.join('.'), type: typeof node.$type === 'string' ? node.$type : '',
      value: node.$value, ext: ours,
    });
    return;
  }
  // Trees arrive key-sorted from sortTree, so this walk is deterministic.
  for (const key of Object.keys(node)) {
    if (key.startsWith('$')) continue;
    collectLeaves(node[key], [...prefix, key], out);
  }
}

interface Source { collection: string; mode: string | null; file: string; isDefault: boolean }

const unpointer = (s: string): string => s.replace(/~1/g, '/').replace(/~0/g, '~');
const refFile = (src: DtcgJson): string | null => {
  const r = asRecord(src);
  return r && typeof r.$ref === 'string' ? r.$ref : null;
};

/** Every file the resolver names, in resolution order, with what it stands for. */
function sourcesOf(resolver: DtcgExport['resolver']): Source[] {
  const out: Source[] = [];
  for (const { $ref } of resolver.resolutionOrder) {
    const set = /^#\/sets\/(.+)$/.exec($ref);
    const mod = /^#\/modifiers\/(.+)$/.exec($ref);
    if (set) {
      const label = unpointer(set[1]);
      for (const src of resolver.sets[label]?.sources ?? []) {
        const file = refFile(src);
        if (file) out.push({ collection: label, mode: null, file, isDefault: true });
      }
    } else if (mod) {
      const label = unpointer(mod[1]);
      const m = resolver.modifiers[label];
      if (!m) continue;
      // A modifier with no default has no context at the root: emitting one
      // would choose a mode Figma did not state.
      for (const [context, srcs] of Object.entries(m.contexts)) {
        for (const src of srcs) {
          const file = refFile(src);
          if (file) out.push({ collection: label, mode: context, file, isDefault: context === m.default });
        }
      }
    }
  }
  return out;
}

/** `primitives.light-2.json` -> `light-2`: the mode part of the file name the DTCG projection chose. */
const modeSlug = (file: string): string => file.replace(/\.json$/, '').split('.').slice(1).join('.');
const collectionSlug = (file: string): string => file.split('.')[0];

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

interface Ctx { names: Map<string, string>; report: OutputReportEntry[]; path: string; mode?: string }

const REF = /^\{(.+)\}$/;

function hexChannels(hex: string): [number, number, number] {
  const at = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return [at(1), at(3), at(5)];
}
const quoteFamily = (f: string): string => `"${f.replace(/["\\]/g, '\\$&')}"`;

function report(ctx: Ctx, entry: Omit<OutputReportEntry, 'path' | 'mode'>): void {
  ctx.report.push({ ...entry, path: ctx.path, ...(ctx.mode !== undefined ? { mode: ctx.mode } : {}) });
}

/** One CSS value, or null when omitted and reported. `property` names a style member. */
function cssValue(ctx: Ctx, type: string, value: DtcgJson, property?: string): string | null {
  const member = property !== undefined ? { property } : {};
  if (typeof value === 'string') {
    const ref = REF.exec(value);
    if (ref) {
      const name = ctx.names.get(ref[1]);
      if (name !== undefined) return `var(${name})`;
      report(ctx, {
        code: 'reference_target_omitted', severity: 'warning',
        message: `References ${ref[1]}, which this output does not emit; the value was omitted.`,
        details: { target: ref[1], ...member },
      });
      return null;
    }
  }
  switch (type) {
    case 'color': {
      if (typeof value === 'string') return value; // legacy `#rrggbb` or `#rrggbbaa`, verbatim
      const c = asRecord(value);
      if (c && typeof c.hex === 'string' && typeof c.alpha === 'number') {
        if (c.alpha === 1) return c.hex;
        const [r, g, b] = hexChannels(c.hex);
        return `rgb(${r} ${g} ${b} / ${c.alpha})`;
      }
      break;
    }
    case 'dimension':
    case 'duration': {
      if (typeof value === 'string') return value;
      const d = asRecord(value);
      if (d && typeof d.value === 'number' && typeof d.unit === 'string') return `${d.value}${d.unit}`;
      break;
    }
    case 'number':
    case 'fontWeight':
      if (typeof value === 'number') return String(value);
      break;
    case 'cubicBezier':
      if (Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number')) {
        return `cubic-bezier(${value.join(', ')})`;
      }
      break;
    case 'fontFamily':
      if (typeof value === 'string') return quoteFamily(value);
      if (Array.isArray(value) && value.every((f) => typeof f === 'string')) {
        return (value as string[]).map(quoteFamily).join(', ');
      }
      break;
    default:
      break;
  }
  report(ctx, {
    code: 'not_expressible', severity: 'warning',
    message: `CSS has no form for this ${type || 'untyped'} value; it was omitted.`,
    details: { type, value, ...member },
  });
  return null;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const TEXT_TRANSFORM: Record<string, string> = { original: 'none', upper: 'uppercase', lower: 'lowercase', title: 'capitalize' };
const TEXT_DECORATION: Record<string, string> = { none: 'none', underline: 'underline', strikethrough: 'line-through' };
const TYPOGRAPHY_MEMBERS: Array<[key: string, suffix: string[], type: string]> = [
  ['fontFamily', ['font', 'family'], 'fontFamily'],
  ['fontSize', ['font', 'size'], 'dimension'],
  ['fontWeight', ['font', 'weight'], 'fontWeight'],
  ['lineHeight', ['line', 'height'], 'number'],
  ['letterSpacing', ['letter', 'spacing'], 'dimension'],
];

function converted(ctx: Ctx, property: string, from: DtcgTree, to: string): void {
  report(ctx, {
    code: 'value_converted', severity: 'info',
    message: `${property} was restated from ${String(from.value)}${String(from.unit)} as ${to}.`,
    details: { property, from, to },
  });
}

/** Members the DTCG projection parked under $extensions because the format had no home for them. CSS does. */
function extensionDimension(
  ctx: Ctx, ext: DtcgTree, key: string, suffix: string[], member: (s: string[]) => string, percentTo: (n: number) => string,
): string | null {
  const d = asRecord(ext[key]);
  if (!d || typeof d.value !== 'number' || typeof d.unit !== 'string') return null;
  if (d.unit === '%') {
    const to = percentTo(canonicalNumber(d.value / 100));
    converted(ctx, key, d, to);
    return `${member(suffix)}: ${to};`;
  }
  return `${member(suffix)}: ${d.value}${d.unit};`;
}

function typographyDecls(ctx: Ctx, leaf: Leaf, member: (suffix: string[]) => string): string[] {
  const decls: string[] = [];
  const value = asRecord(leaf.value) ?? {};
  for (const [key, suffix, type] of TYPOGRAPHY_MEMBERS) {
    if (!(key in value)) continue;
    const css = cssValue(ctx, type, value[key], key);
    if (css !== null) decls.push(`${member(suffix)}: ${css};`);
  }
  const ext = leaf.ext ?? {};
  // A px line height could not be a DTCG multiplier; CSS states px directly.
  // A % letter spacing is a fraction of the font size, which is what em means.
  if (!('lineHeight' in value)) {
    const d = extensionDimension(ctx, ext, 'lineHeight', ['line', 'height'], member, (n) => String(n));
    if (d) decls.push(d);
  }
  if (!('letterSpacing' in value)) {
    const d = extensionDimension(ctx, ext, 'letterSpacing', ['letter', 'spacing'], member, (n) => `${n}em`);
    if (d) decls.push(d);
  }
  const tables: Array<[string, string[], Record<string, string>]> = [
    ['textCase', ['text', 'transform'], TEXT_TRANSFORM],
    ['textDecoration', ['text', 'decoration'], TEXT_DECORATION],
  ];
  for (const [key, suffix, table] of tables) {
    const raw = ext[key];
    if (typeof raw !== 'string') continue;
    const css = table[raw];
    if (css !== undefined) {
      decls.push(`${member(suffix)}: ${css};`);
    } else {
      report(ctx, {
        code: 'not_expressible', severity: 'info',
        message: `CSS text properties have no form for ${key} "${raw}"; it was omitted.`,
        details: { property: key, value: raw },
      });
    }
  }
  return decls;
}

const SHADOW_MEMBERS: Array<[key: string, type: string]> = [
  ['offsetX', 'dimension'], ['offsetY', 'dimension'], ['blur', 'dimension'], ['spread', 'dimension'], ['color', 'color'],
];

function shadowDecl(ctx: Ctx, leaf: Leaf, name: string): string | null {
  const layers = Array.isArray(leaf.value) ? leaf.value : [];
  const omit = (reason: string, message: string): null => {
    report(ctx, { code: 'not_expressible', severity: 'warning', message, details: { reason } });
    return null;
  };
  if (layers.length === 0) return omit('no_visible_shadow', 'The style has no visible shadow, so no box-shadow was written.');
  const parts: string[] = [];
  for (const layer of layers) {
    const l = asRecord(layer);
    if (!l) return omit('layer_not_an_object', 'A shadow layer is not an object; the style was omitted.');
    const members: string[] = [];
    for (const [key, type] of SHADOW_MEMBERS) {
      if (!(key in l)) return omit(`missing_${key}`, `A shadow layer has no ${key}, which box-shadow needs; the style was omitted.`);
      const css = cssValue(ctx, type, l[key], key);
      if (css === null) return null; // already reported by cssValue
      members.push(css);
    }
    parts.push(`${l.inset === true ? 'inset ' : ''}${members.join(' ')}`);
  }
  return `${name}: ${parts.join(', ')};`;
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

function headerText(header: OutputHeader, nameCase: NameCase): string {
  return `${CSS_HEADER_PREFIX} from library ${header.libraryId}, foundation ${header.contentHash}, web/css/${nameCase}.\n`
    + '   Do not edit. Change the design in Figma, republish, and run spec-layer pull. */';
}

export function cssOutput(exp: DtcgExport, header: OutputHeader, options: CssOutputOptions = {}): CssOutput {
  const nameCase = options.case ?? CSS_DEFAULTS.case;
  const root = options.root ?? CSS_DEFAULTS.root;
  const template = options.modeSelector ?? CSS_DEFAULTS.modeSelector;
  const sources = sourcesOf(exp.resolver);

  const leavesByFile = new Map<string, Leaf[]>();
  const paths = new Set<string>();
  for (const s of sources) {
    if (!leavesByFile.has(s.file)) {
      const out: Leaf[] = [];
      collectLeaves(exp.files[s.file] ?? {}, [], out);
      leavesByFile.set(s.file, out);
    }
    for (const leaf of leavesByFile.get(s.file) ?? []) paths.add(leaf.path);
  }

  const resolved = resolveNames([...paths], exp.meta, {
    codeSyntaxKey: 'WEB', acceptDeclared: acceptCssDeclared, affix: (body) => `--${body}`, nameCase,
  });
  const entries: OutputReportEntry[] = [...resolved.report];
  const memberOf = (path: string) => (suffix: string[]) => `--${joinWords([...pathWords(path), ...suffix], nameCase)}`;

  const blocks = new Map<string, string[]>();
  for (const s of sources) {
    const perCollection = options.modes?.[s.collection];
    const selector = s.isDefault ? root : (perCollection ?? template)
      .replace(/\{mode\}/g, modeSlug(s.file))
      .replace(/\{collection\}/g, collectionSlug(s.file));
    const decls: string[] = [];
    for (const leaf of leavesByFile.get(s.file) ?? []) {
      const name = resolved.names.get(leaf.path);
      if (name === undefined) continue; // collided; already reported
      const ctx: Ctx = { names: resolved.names, report: entries, path: leaf.path, ...(s.mode !== null ? { mode: s.mode } : {}) };
      if (leaf.type === 'typography') {
        decls.push(...typographyDecls(ctx, leaf, memberOf(leaf.path)));
      } else if (leaf.type === 'shadow') {
        const d = shadowDecl(ctx, leaf, name);
        if (d !== null) decls.push(d);
      } else {
        const v = cssValue(ctx, leaf.type, leaf.value);
        if (v !== null) decls.push(`${name}: ${v};`);
      }
    }
    if (decls.length === 0) continue;
    const lines = blocks.get(selector) ?? [];
    lines.push(`  /* ${s.collection}${s.mode !== null ? `, ${s.mode}` : ''} */`, ...decls.map((d) => `  ${d}`));
    blocks.set(selector, lines);
  }

  const shared = [...new Set(sources
    .filter((s) => !s.isDefault && options.modes?.[s.collection] === undefined)
    .map((s) => s.collection))].sort(compareCodeUnits);
  if (shared.length > 1) {
    for (const collection of shared) {
      entries.push({
        code: 'mode_selector_shared', severity: 'warning', path: collection,
        message: `${shared.length} collections with modes share the selector template ${template}; one attribute cannot carry both axes. Declare a selector per collection under outputs[].modes.`,
        details: { modifiers: shared, selector: template },
      });
    }
  }

  const body = [...blocks].flatMap(([selector, lines]) => [`${selector} {`, ...lines, '}', '']);
  const text = `${[headerText(header, nameCase), '', ...body].join('\n').trimEnd()}\n`;
  return { text, map: resolved.map, report: sortReport(entries) };
}
```

In `packages/extractor/src/v5/outputs/index.ts` add `export * from './css';`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/extractor/test/v5/outputs/css.test.ts`
Expected: PASS. If the synthetic test's shadow line differs, print `text` and compare against the rule in spec 5.4 before changing either; the fixture's blur is bound to `Primitives.effect.shadow.blur`, whose declared name is `--effect-shadow-blur`.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add packages/extractor/src/v5/outputs packages/extractor/test/v5/outputs/css.test.ts
git commit -m "feat(extractor): css custom-property projection of the dtcg export

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: CSS goldens and parser validity

**Files:**
- Create: `packages/extractor/test/v5/outputs/cssGolden.test.ts`
- Create: `packages/extractor/test/fixtures/v5/synthetic-foundation-css/kebab/{tokens.css,map.json,report.json}`
- Create: `packages/extractor/test/fixtures/v5/synthetic-foundation-css/camel/{tokens.css,map.json,report.json}`
- Modify: root `package.json` devDependencies (add `postcss`)

**Interfaces:**
- Consumes: `cssOutput`, `foundationDtcg`, `syntheticArtifact` from `../dtcgFixture`.

- [ ] **Step 1: Add postcss as a root dev dependency**

```bash
npm install --save-dev postcss@^8
```

Then `git diff --stat package.json package-lock.json`. Expected: `postcss` appears under `devDependencies` in the root `package.json`. It is a test-only parser; the CLI bundle does not import it.

- [ ] **Step 2: Write the golden and validity test**

```ts
// packages/extractor/test/v5/outputs/cssGolden.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import postcss from 'postcss';
import { cssOutput, foundationDtcg, type NameCase } from '../../../src/index';
import { syntheticArtifact } from '../dtcgFixture';

const GOLDEN_ROOT = fileURLToPath(new URL('../../fixtures/v5/synthetic-foundation-css/', import.meta.url));
const HEADER = { libraryId: 'lib_synthetic', contentHash: 'sha256:synthetic' };

function files(nameCase: NameCase): Record<string, string> {
  const out = cssOutput(foundationDtcg(syntheticArtifact()), HEADER, { case: nameCase });
  return {
    'tokens.css': out.text,
    'map.json': `${JSON.stringify(out.map, null, 2)}\n`,
    'report.json': `${JSON.stringify(out.report, null, 2)}\n`,
  };
}

describe('CSS golden', () => {
  for (const nameCase of ['kebab', 'camel'] as NameCase[]) {
    it(`matches the reviewed ${nameCase} golden file for file`, () => {
      const dir = join(GOLDEN_ROOT, nameCase);
      const produced = files(nameCase);
      if (process.env.UPDATE_V5_CSS_GOLDEN === '1') {
        mkdirSync(dir, { recursive: true });
        for (const [name, text] of Object.entries(produced)) writeFileSync(join(dir, name), text);
      }
      expect(existsSync(dir)).toBe(true);
      for (const [name, text] of Object.entries(produced)) {
        expect(readFileSync(join(dir, name), 'utf8'), `${nameCase}/${name}`).toBe(text);
      }
    });
  }
});

describe('CSS validity', () => {
  it('parses, declares only custom properties with values, and resolves every var() in-file', () => {
    const { text } = cssOutput(foundationDtcg(syntheticArtifact()), HEADER);
    const root = postcss.parse(text);
    const declared = new Set<string>();
    const referenced: string[] = [];
    root.walkDecls((decl) => {
      expect(decl.prop.startsWith('--'), decl.prop).toBe(true);
      expect(decl.value.trim().length, decl.prop).toBeGreaterThan(0);
      declared.add(decl.prop);
      for (const m of decl.value.matchAll(/var\((--[^),\s]+)/g)) referenced.push(m[1]);
    });
    expect(declared.size).toBeGreaterThan(10);
    for (const name of referenced) expect(declared.has(name), `var(${name}) has no declaration`).toBe(true);
    let rules = 0;
    root.walkRules((rule) => {
      rules += 1;
      expect(rule.selector === ':root' || rule.selector.startsWith('[data-theme="'), rule.selector).toBe(true);
    });
    expect(rules).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 3: Generate the goldens, then review them against the spec**

```bash
UPDATE_V5_CSS_GOLDEN=1 npx vitest run packages/extractor/test/v5/outputs/cssGolden.test.ts
```

Then read `packages/extractor/test/fixtures/v5/synthetic-foundation-css/kebab/tokens.css` and `report.json`. Check every line against spec section 5 before committing:

- Header carries `lib_synthetic`, `sha256:synthetic`, `web/css/kebab`, and no date.
- `:root {` holds `/* Primitives, Light [ModeID:p-light] */`, `/* Semantic, Light */`, `/* Effect styles */`, `/* Typography styles */`, in that order.
- Declared names appear verbatim: `--color-exact-red`, `--spacing-gap`, `--effect-shadow-blur`, `--color-surface-primary`.
- Derived names carry the collection root: `--primitives-color-chain-bridge: var(--primitives-color-chain-middle);`.
- `--primitives-color-lossy-teal: rgb(128 26 0 / 0.125);` at root and `rgb(64 128 191 / 0.875)` under dark.
- `--primitives-number-unknown-scope: 1.5;` with no unit.
- `[data-theme="dark"] {` and `[data-theme="light-2"] {` blocks exist; no `@media`.
- Typography emits `--typography-styles-body-regular-font-family: var(--primitives-typography-family-body);`, `-font-size: 16px;`, `-font-weight: var(--primitives-typography-weight-strong);`, `-line-height: 24px;`, `-letter-spacing: 0em;`, `-text-transform: none;`, `-text-decoration: none;`.
- `report.json` holds two `mode_selector_shared` entries (Primitives, Semantic) and one `value_converted` for letterSpacing. Read every other entry and confirm the fixture warrants it.

If a line is wrong, fix `css.ts`, regenerate, and re-review. Never edit a golden by hand.

- [ ] **Step 4: Run the test without the update flag**

Run: `npx vitest run packages/extractor/test/v5/outputs/`
Expected: PASS for naming, css, and cssGolden.

- [ ] **Step 5: Commit**

Stage `package.json`, `package-lock.json`, `packages/extractor/test/v5/outputs/cssGolden.test.ts`, and `packages/extractor/test/fixtures/v5/synthetic-foundation-css`. Subject: `test(extractor): css output goldens and parser validity gate`.

---

### Task 4: Rename `ai/components/` to `components/` and `aiPath` to `path`

**Files:**
- Modify: `packages/cli/src/files.ts` (`ManifestArtifact`, `readManifest`, the component path in `writeBundleFiles`, the foundation `aiPath` local)
- Modify: `packages/cli/src/skill.ts:81,102,267,336`
- Modify: `packages/cli/src/commands.ts:335`
- Modify: `packages/cli/src/selection.ts:5` (doc comment says `ai/`)
- Test: `packages/cli/test/files.test.ts`, `packages/cli/test/commands.test.ts`, `packages/cli/test/skill.test.ts`

**Interfaces:**
- Produces: `ManifestArtifact.path: string | null`. `readManifest` returns `path` even for a manifest written with `aiPath`.

- [ ] **Step 1: Update the tests**

In `packages/cli/test/files.test.ts`, `packages/cli/test/commands.test.ts`, and `packages/cli/test/skill.test.ts`, replace every `ai/components/` with `components/` and every `aiPath` with `path`:

```bash
sed -i '' 's#ai/components/#components/#g; s#aiPath#path#g' packages/cli/test/files.test.ts packages/cli/test/commands.test.ts packages/cli/test/skill.test.ts
```

Then `grep -n "ai/components\|aiPath" packages/cli/test/*.ts` must print nothing.

Add one test to `files.test.ts` inside `describe('writeBundleFiles', ...)` after the `beforeEach`:

```ts
  it('reads a manifest written by an earlier CLI that used aiPath', () => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({
      libraryId: 'lib_old', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h', pluginVersion: null, extractorVersion: '2',
      artifacts: [
        { kind: 'foundation', name: 'foundation', contentHash: 'f', aiPath: 'tokens/resolver.json' },
        { kind: 'component', name: 'Button', contentHash: 'c', aiPath: null },
      ],
    }));
    const manifest = readManifest(outDir);
    expect(manifest?.artifacts.map((a) => a.path)).toEqual(['tokens/resolver.json', null]);
    expect(manifest?.artifacts.some((a) => 'aiPath' in a)).toBe(false);
  });
```

- [ ] **Step 2: Run the CLI tests to verify they fail**

Run: `npx vitest run packages/cli/test/files.test.ts packages/cli/test/commands.test.ts packages/cli/test/skill.test.ts`
Expected: FAIL on paths and on `path` being undefined.

- [ ] **Step 3: Rename in the source**

`packages/cli/src/files.ts`:

```ts
/**
 * Every artifact in the bundle; path is null when the selection left it
 * unwritten. For the foundation this is the DTCG resolver path
 * (`tokens/resolver.json`); for a component it is its YAML path under
 * `components/`.
 */
export interface ManifestArtifact {
  kind: 'foundation' | 'component'; name: string; contentHash: string; path: string | null;
}
```

Replace `readManifest`:

```ts
export function readManifest(outDir: string): Manifest | null {
  const path = join(outDir, 'manifest.json');
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Manifest & {
      artifacts: Array<ManifestArtifact & { aiPath?: string | null }>;
    };
    // CLI 0.5.0 and earlier wrote the field as aiPath. Read it as path so
    // list, skill, and status keep working until the next pull rewrites it.
    parsed.artifacts = parsed.artifacts.map(({ aiPath, ...artifact }) => ({
      ...artifact, path: artifact.path ?? aiPath ?? null,
    }));
    return parsed;
  } catch { return null; }
}
```

In `writeBundleFiles`, rename the local `aiPath` to `path` in the foundation block and the component loop, and change the component file path:

```ts
      const path = selected[i] ? `components/${slugs[i]}.yaml` : null;
      if (path) put(path, component.ai);
      artifacts.push({
        kind: 'component', name: component.name,
        contentHash: component.artifact.spec_layer.export.content_hash, path,
      });
```

`packages/cli/src/commands.ts:335`: `a.aiPath` becomes `a.path`.

`packages/cli/src/skill.ts`: line 81 `a.aiPath` becomes `a.path` (twice on that line), line 102 `foundationEntry.aiPath` becomes `foundationEntry.path`, and the two guide strings:

```ts
  lines.push(`- ${code(`${outDir}/components/`)}: one YAML per component.`);
```

```ts
  lines.push(`2. Building or changing a component: read its YAML under ${code(`${outDir}/components/`)}, or ${code('npx spec-layer show component NAME')}. ...
```

(keep the rest of that sentence exactly as it is.)

`packages/cli/src/selection.ts` doc comment: `A component becomes one \`components/\` YAML file;`.

- [ ] **Step 4: Run the whole CLI suite**

Run: `npx vitest run packages/cli`
Expected: PASS.

- [ ] **Step 5: Commit**

Run `npm run typecheck && npm run lint`, stage `packages/cli`, subject: `feat(cli): write component briefs under components/ and record path in the manifest`.

---

### Task 5: Output configuration and the write guards

**Files:**
- Create: `packages/cli/src/outputs.ts`
- Modify: `packages/cli/src/config.ts` (`CliConfig`, `readConfig`, `writeConfig`, `ResolvedOptions`, `resolveOptions`)
- Test: `packages/cli/test/outputs.test.ts`, `packages/cli/test/config.test.ts`

**Interfaces:**
- Consumes: `NAME_CASES`, `NameCase`, `CSS_HEADER_PREFIX`, `cssOutput`, `CssOutput`, `DtcgExport` from `@spec-layer/extractor`; `Platform`, `isPlatform`, `PLATFORMS` from `./detect`.
- Produces (`outputs.ts`): `OutputFormat = 'css'`, `OutputConfig { platform, format, path, case, root?, modeSelector?, modes? }`, `FORMATS`, `knownFormats()`, `defaultOutputs(platforms)`, `withDefaults(existing, platforms)`, `outputId(o)`, `parseOutput(value, index)`, `renderOutput(exp, o, header)`, `outputPathProblem(cwd, outDir, o)`, `writeOutputFile(cwd, o, text)`.
- Produces (`config.ts`): `CliConfig.platforms?: Platform[]`, `CliConfig.outputs?: OutputConfig[]`, same two optional fields on `writeConfig`'s argument and on `ResolvedOptions`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/cli/test/outputs.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  defaultOutputs, outputId, outputPathProblem, parseOutput, withDefaults, writeOutputFile, type OutputConfig,
} from '../src/outputs';

const WEB: OutputConfig = { platform: 'web', format: 'css', path: 'spec-layer/tokens.css', case: 'kebab' };

describe('defaults', () => {
  it('gives web a css output at the default path and other platforms nothing yet', () => {
    expect(defaultOutputs(['web'])).toEqual([WEB]);
    expect(defaultOutputs(['ios', 'android', 'flutter'])).toEqual([]);
    expect(defaultOutputs([])).toEqual([]);
  });

  it('adds a default only for platforms without an entry', () => {
    const custom: OutputConfig = { ...WEB, path: 'src/tokens.css', case: 'camel' };
    expect(withDefaults([custom], ['web'])).toEqual([custom]);
    expect(withDefaults([], ['web'])).toEqual([WEB]);
  });

  it('names the record files by platform and format', () => {
    expect(outputId(WEB)).toBe('web-css');
  });
});

describe('parseOutput', () => {
  it('fills the default path and case and keeps selectors', () => {
    expect(parseOutput({ platform: 'web', format: 'css' }, 0)).toEqual(WEB);
    expect(parseOutput({
      platform: 'web', format: 'css', path: 'a.css', case: 'snake', root: 'html',
      modeSelector: '.{mode}', modes: { Theme: '[data-t="{mode}"]' },
    }, 0)).toEqual({
      platform: 'web', format: 'css', path: 'a.css', case: 'snake', root: 'html',
      modeSelector: '.{mode}', modes: { Theme: '[data-t="{mode}"]' },
    });
  });

  it('rejects an unknown pair with the known list', () => {
    expect(() => parseOutput({ platform: 'web', format: 'scss' }, 1))
      .toThrow('speclayer.json outputs[1]: unknown platform/format "web/scss". Known: web/css.');
    expect(() => parseOutput({ platform: 'ios', format: 'swift' }, 0))
      .toThrow('unknown platform/format "ios/swift"');
  });

  it('rejects a bad case, a non-string path, and a non-object', () => {
    expect(() => parseOutput({ platform: 'web', format: 'css', case: 'Kebab' }, 0))
      .toThrow('speclayer.json outputs[0] "case" takes kebab, camel, pascal, snake, constant.');
    expect(() => parseOutput({ platform: 'web', format: 'css', path: 3 }, 0)).toThrow('"path" must be a string');
    expect(() => parseOutput('x', 2)).toThrow('speclayer.json outputs[2] must be an object.');
    expect(() => parseOutput({ platform: 'web', format: 'css', modes: { Theme: 1 } }, 0)).toThrow('"modes" must map');
  });
});

describe('outputPathProblem and writeOutputFile', () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'sl-out-')); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it('allows a new path inside the directory and refuses one outside or inside outDir', () => {
    expect(outputPathProblem(cwd, '.speclayer', WEB)).toBeNull();
    expect(outputPathProblem(cwd, '.speclayer', { ...WEB, path: '../tokens.css' }))
      .toBe('../tokens.css is outside this directory. Choose a path inside the repository.');
    expect(outputPathProblem(cwd, '.speclayer', { ...WEB, path: '/etc/tokens.css' })).toContain('is outside this directory');
    expect(outputPathProblem(cwd, '.speclayer', { ...WEB, path: '.speclayer/web/tokens.css' }))
      .toBe('.speclayer/web/tokens.css is inside .speclayer, which pull replaces wholesale. Choose a path outside it.');
    expect(outputPathProblem(cwd, '.speclayer', { ...WEB, path: '.speclayer' })).toContain('is inside .speclayer');
  });

  it('refuses an existing file without the header and accepts one with it', () => {
    mkdirSync(join(cwd, 'spec-layer'));
    writeFileSync(join(cwd, WEB.path), ':root { --mine: red; }\n');
    expect(outputPathProblem(cwd, '.speclayer', WEB))
      .toBe('spec-layer/tokens.css exists and was not written by spec-layer. Choose another path or remove the file.');
    writeFileSync(join(cwd, WEB.path), '/* Generated by spec-layer from library x */\n');
    expect(outputPathProblem(cwd, '.speclayer', WEB)).toBeNull();
  });

  it('writes through a .partial rename and creates parent directories', () => {
    writeOutputFile(cwd, { ...WEB, path: 'deep/er/tokens.css' }, '/* Generated by spec-layer */\n');
    expect(readFileSync(join(cwd, 'deep/er/tokens.css'), 'utf8')).toBe('/* Generated by spec-layer */\n');
    expect(existsSync(join(cwd, 'deep/er/tokens.css.partial'))).toBe(false);
  });
});
```

Add to `packages/cli/test/config.test.ts` (inside its existing `describe` for `readConfig`, or a new one):

```ts
  it('reads platforms and outputs, filling output defaults', () => {
    writeFileSync(join(cwd, 'speclayer.json'), JSON.stringify({
      libraryId: 'lib_x', outDir: '.speclayer', platforms: ['web', 'web'],
      outputs: [{ platform: 'web', format: 'css' }],
    }));
    expect(readConfig(cwd)).toEqual({
      libraryId: 'lib_x', outDir: '.speclayer', platforms: ['web'],
      outputs: [{ platform: 'web', format: 'css', path: 'spec-layer/tokens.css', case: 'kebab' }],
    });
  });

  it('rejects a platforms value that is not a list of known platforms', () => {
    writeFileSync(join(cwd, 'speclayer.json'), JSON.stringify({ libraryId: 'lib_x', platforms: ['Web'] }));
    expect(() => readConfig(cwd)).toThrow('speclayer.json "platforms" must be an array of web, ios, android, flutter.');
  });

  it('writes platforms and outputs when given and omits them when not', () => {
    writeConfig(cwd, { libraryId: 'lib_x', outDir: '.speclayer', platforms: ['web'], outputs: [
      { platform: 'web', format: 'css', path: 'spec-layer/tokens.css', case: 'kebab' },
    ] });
    expect(JSON.parse(readFileSync(join(cwd, 'speclayer.json'), 'utf8'))).toEqual({
      libraryId: 'lib_x', outDir: '.speclayer', platforms: ['web'],
      outputs: [{ platform: 'web', format: 'css', path: 'spec-layer/tokens.css', case: 'kebab' }],
    });
    writeConfig(cwd, { libraryId: 'lib_x', outDir: '.speclayer' });
    expect(JSON.parse(readFileSync(join(cwd, 'speclayer.json'), 'utf8'))).toEqual({ libraryId: 'lib_x', outDir: '.speclayer' });
  });
```

Check the top of `config.test.ts` for how `cwd` is created and whether `writeConfig` is imported; add the import if missing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/cli/test/outputs.test.ts packages/cli/test/config.test.ts`
Expected: FAIL, module not found and unknown fields.

- [ ] **Step 3: Write `outputs.ts`**

```ts
// packages/cli/src/outputs.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  CSS_HEADER_PREFIX, NAME_CASES, cssOutput, type CssOutput, type DtcgExport, type NameCase,
} from '@spec-layer/extractor';
import type { Platform } from './detect';

/**
 * Platform outputs: the files the team's build compiles, written in place at a
 * declared path outside the swapped output directory. Spec:
 * docs/superpowers/specs/2026-09-08-repository-delivery-design.md, section 4.
 * One format exists today; the registry is where the next one is added.
 */

export type OutputFormat = 'css';

export interface OutputConfig {
  platform: Platform;
  format: OutputFormat;
  /** Relative to the working directory. */
  path: string;
  case: NameCase;
  root?: string;
  modeSelector?: string;
  modes?: Record<string, string>;
}

interface FormatSpec {
  platform: Platform; format: OutputFormat;
  /** Where the file lands when the config names none; null means a path is required. */
  defaultPath: string | null;
  defaultCase: NameCase;
  /** The first bytes of a file this format writes; anything else at the path is not ours. */
  headerPrefix: string;
}

export const FORMATS: readonly FormatSpec[] = [
  { platform: 'web', format: 'css', defaultPath: 'spec-layer/tokens.css', defaultCase: 'kebab', headerPrefix: CSS_HEADER_PREFIX },
];

export const knownFormats = (): string => FORMATS.map((f) => `${f.platform}/${f.format}`).join(', ');

const specOf = (platform: string, format: string): FormatSpec | null =>
  FORMATS.find((f) => f.platform === platform && f.format === format) ?? null;

/** One default output per platform that has one; ios, android, and flutter have none yet. */
export function defaultOutputs(platforms: Platform[]): OutputConfig[] {
  return FORMATS
    .filter((f) => f.defaultPath !== null && platforms.includes(f.platform))
    .map((f) => ({ platform: f.platform, format: f.format, path: f.defaultPath as string, case: f.defaultCase }));
}

/** The existing entries plus a default for every named platform that has none. */
export function withDefaults(existing: OutputConfig[], platforms: Platform[]): OutputConfig[] {
  const covered = new Set(existing.map((o) => o.platform));
  return [...existing, ...defaultOutputs(platforms.filter((p) => !covered.has(p)))];
}

/** The record file stem under <outDir>/outputs/. */
export const outputId = (o: OutputConfig): string => `${o.platform}-${o.format}`;

/** One outputs[] entry from speclayer.json. Throws a plain error naming the entry. */
export function parseOutput(value: unknown, index: number): OutputConfig {
  const at = `speclayer.json outputs[${index}]`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${at} must be an object.`);
  const r = value as Record<string, unknown>;
  if (typeof r.platform !== 'string' || typeof r.format !== 'string') {
    throw new Error(`${at} needs "platform" and "format". Known: ${knownFormats()}.`);
  }
  const spec = specOf(r.platform, r.format);
  if (!spec) throw new Error(`${at}: unknown platform/format "${r.platform}/${r.format}". Known: ${knownFormats()}.`);
  const str = (key: string): string | undefined => {
    if (r[key] !== undefined && typeof r[key] !== 'string') throw new Error(`${at} "${key}" must be a string.`);
    return r[key] as string | undefined;
  };
  const path = str('path') ?? spec.defaultPath;
  if (path === null) throw new Error(`${at} needs "path": ${spec.platform} has no default location.`);
  const nameCase = str('case');
  if (nameCase !== undefined && !(NAME_CASES as readonly string[]).includes(nameCase)) {
    throw new Error(`${at} "case" takes ${NAME_CASES.join(', ')}.`);
  }
  const root = str('root');
  const modeSelector = str('modeSelector');
  let modes: Record<string, string> | undefined;
  if (r.modes !== undefined) {
    const m = r.modes;
    if (typeof m !== 'object' || m === null || Array.isArray(m) || !Object.values(m).every((v) => typeof v === 'string')) {
      throw new Error(`${at} "modes" must map collection names to selector strings.`);
    }
    modes = m as Record<string, string>;
  }
  return {
    platform: spec.platform, format: spec.format, path, case: (nameCase as NameCase | undefined) ?? spec.defaultCase,
    ...(root !== undefined ? { root } : {}),
    ...(modeSelector !== undefined ? { modeSelector } : {}),
    ...(modes ? { modes } : {}),
  };
}

export function renderOutput(
  exp: DtcgExport, o: OutputConfig, header: { libraryId: string; contentHash: string },
): CssOutput {
  switch (o.format) {
    case 'css':
      return cssOutput(exp, header, {
        case: o.case,
        ...(o.root !== undefined ? { root: o.root } : {}),
        ...(o.modeSelector !== undefined ? { modeSelector: o.modeSelector } : {}),
        ...(o.modes ? { modes: o.modes } : {}),
      });
    default: {
      const exhaustive: never = o.format;
      return exhaustive;
    }
  }
}

const inside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** Why a deliverable cannot be written at its path, or null when it can. */
export function outputPathProblem(cwd: string, outDir: string, o: OutputConfig): string | null {
  const root = resolve(cwd);
  const abs = resolve(cwd, o.path);
  if (!inside(root, abs) || abs === root) return `${o.path} is outside this directory. Choose a path inside the repository.`;
  if (inside(resolve(cwd, outDir), abs)) {
    return `${o.path} is inside ${outDir}, which pull replaces wholesale. Choose a path outside it.`;
  }
  if (existsSync(abs)) {
    const prefix = specOf(o.platform, o.format)?.headerPrefix ?? CSS_HEADER_PREFIX;
    let head: string;
    try { head = readFileSync(abs, 'utf8').slice(0, prefix.length); } catch { return `${o.path} exists and could not be read.`; }
    if (head !== prefix) return `${o.path} exists and was not written by spec-layer. Choose another path or remove the file.`;
  }
  return null;
}

/** Writes to <path>.partial, then renames over the target, so a reader never sees a half file. */
export function writeOutputFile(cwd: string, o: OutputConfig, text: string): void {
  const abs = resolve(cwd, o.path);
  mkdirSync(dirname(abs), { recursive: true });
  const partial = `${abs}.partial`;
  writeFileSync(partial, text);
  renameSync(partial, abs);
}
```

- [ ] **Step 4: Extend `config.ts`**

Imports at the top:

```ts
import { isPlatform, PLATFORMS, type Platform } from './detect';
import { parseOutput, type OutputConfig } from './outputs';
```

Interface and parsers:

```ts
export interface CliConfig {
  libraryId?: string; outDir?: string; include?: Selection; dtcg?: DtcgOptions;
  platforms?: Platform[]; outputs?: OutputConfig[];
}

/** `platforms` names the targets this repository builds for; pull and skill read it before detecting. */
function parsePlatforms(value: unknown): Platform[] {
  if (!Array.isArray(value) || !value.every((p) => typeof p === 'string' && isPlatform(p))) {
    throw new Error(`speclayer.json "platforms" must be an array of ${PLATFORMS.join(', ')}.`);
  }
  return [...new Set(value as Platform[])];
}

/** `outputs` lists the files the team's build compiles; each entry is validated by the format registry. */
function parseOutputs(value: unknown): OutputConfig[] {
  if (!Array.isArray(value)) throw new Error('speclayer.json "outputs" must be an array.');
  return value.map((v, i) => parseOutput(v, i));
}
```

In `readConfig`'s returned object add:

```ts
    ...(record.platforms !== undefined ? { platforms: parsePlatforms(record.platforms) } : {}),
    ...(record.outputs !== undefined ? { outputs: parseOutputs(record.outputs) } : {}),
```

`writeConfig` takes `platforms?: Platform[]; outputs?: OutputConfig[]` and writes them after `dtcg`:

```ts
    ...(config.platforms && config.platforms.length > 0 ? { platforms: config.platforms } : {}),
    ...(config.outputs ? { outputs: config.outputs } : {}),
```

`ResolvedOptions` gains `platforms?: Platform[]; outputs?: OutputConfig[]`, and `resolveOptions` passes them through beside `include` and `dtcg`:

```ts
    ...(config?.platforms ? { platforms: config.platforms } : {}),
    ...(config?.outputs ? { outputs: config.outputs } : {}),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/cli/test/outputs.test.ts packages/cli/test/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

Run `npm run typecheck && npm run lint`, stage `packages/cli/src/outputs.ts packages/cli/src/config.ts packages/cli/test/outputs.test.ts packages/cli/test/config.test.ts`, subject: `feat(cli): outputs block, format registry, and in-place write guards`.

---

### Task 6: Wire outputs into pull, setup, init, status, and list

**Files:**
- Modify: `packages/cli/src/files.ts` (`Manifest`, `writeBundleFiles` signature, output record and deliverable writes)
- Modify: `packages/cli/src/commands.ts` (`Flags.platform`, `sameOutput`, `runInit`, `runSetup`, `runPull`, `runList`, `collectSkillInput`)
- Modify: `packages/cli/src/cli.ts` (`platform` flag `multiple: true`, usage)
- Test: `packages/cli/test/files.test.ts`, `packages/cli/test/commands.test.ts`

**Interfaces:**
- Consumes: Task 5's `outputs.ts` exports; `foundationDtcg` from the extractor.
- Produces: `writeBundleFiles(opts & { platforms?: Platform[]; outputs?: OutputConfig[] }): { written: string[]; outputs: string[] }`. `Manifest.platforms?: Platform[]`, `Manifest.outputs?: OutputConfig[]`. `Flags.platform?: string[]`. `SkillInput.platformSource` gains `'config'` (declared in `skill.ts`, used here).

- [ ] **Step 1: Update `files.test.ts` for the new return shape and the output writes**

Every existing call `const written = writeBundleFiles({...})` becomes `const { written } = writeBundleFiles({...})`. Then add, inside `describe('writeBundleFiles')`:

```ts
  it('writes the output record into outDir and the deliverable in place, and returns both', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    const outputs = [{ platform: 'web' as const, format: 'css' as const, path: 'spec-layer/tokens.css', case: 'kebab' as const }];
    const result = writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_x',
      publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h', platforms: ['web'], outputs,
    });
    expect(result.written).toContain('outputs/web-css.map.json');
    expect(result.written).toContain('outputs/web-css.report.json');
    expect(result.outputs).toEqual(['spec-layer/tokens.css']);
    const css = readFileSync(join(tmpDir, 'spec-layer/tokens.css'), 'utf8');
    expect(css.startsWith('/* Generated by spec-layer from library lib_x, foundation sha256:')).toBe(true);
    expect(css).toContain('--color-exact-red: #ff0000;');
    const manifest = readManifest(outDir) as Manifest;
    expect(manifest.platforms).toEqual(['web']);
    expect(manifest.outputs).toEqual(outputs);
    const map = JSON.parse(readFileSync(join(outDir, 'outputs/web-css.map.json'), 'utf8'));
    expect(map['Primitives.color.exact.red']).toEqual({ name: '--color-exact-red', source: 'code_syntax' });
  });

  it('refuses a foreign file at the output path before writing anything', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    mkdirSync(join(tmpDir, 'spec-layer'), { recursive: true });
    writeFileSync(join(tmpDir, 'spec-layer/tokens.css'), ':root { --mine: 1; }\n');
    expect(() => writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_x',
      publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h',
      outputs: [{ platform: 'web', format: 'css', path: 'spec-layer/tokens.css', case: 'kebab' }],
    })).toThrow('spec-layer/tokens.css exists and was not written by spec-layer.');
    expect(existsSync(outDir)).toBe(false);
    expect(readFileSync(join(tmpDir, 'spec-layer/tokens.css'), 'utf8')).toBe(':root { --mine: 1; }\n');
  });

  it('replaces its own earlier file in place and leaves it alone when the foundation is not selected', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    const outputs = [{ platform: 'web' as const, format: 'css' as const, path: 'spec-layer/tokens.css', case: 'kebab' as const }];
    const base = { outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_x', publishedAt: 'p', bundleHash: 'h', outputs };
    writeBundleFiles(base);
    const first = readFileSync(join(tmpDir, 'spec-layer/tokens.css'), 'utf8');
    writeBundleFiles(base);
    expect(readFileSync(join(tmpDir, 'spec-layer/tokens.css'), 'utf8')).toBe(first);
    const noFoundation = writeBundleFiles({ ...base, selection: { foundation: false, components: null } });
    expect(noFoundation.outputs).toEqual([]);
    expect(readFileSync(join(tmpDir, 'spec-layer/tokens.css'), 'utf8')).toBe(first);
  });
```

`realFoundation()` in that file returns `{ ai, artifact }`; `makeBundle({ foundation: realFoundation() })` is the existing way to get a valid Foundation. Check the file's helpers and match them.

- [ ] **Step 2: Update `commands.test.ts`**

Change every `platform: 'ios'`-style flag in `runSkill` calls to an array (`platform: ['ios']`). Then add these tests. Use the file's existing helpers (`makeIo`, `stub200`, `GOOD_BUNDLE`, the `cwd` temp dir pattern, and `LIB`/key constants); read the neighbouring `runSetup` and `runPull` tests first and copy their setup lines.

```ts
  it('setup --platform web stores platforms and a default output, and pull writes the css file', async () => {
    const io = makeIo();
    expect(await runSetup(cwd, { id: LIB, key: KEY, platform: ['web'] }, {}, io, stub200())).toBe(0);
    expect(readConfig(cwd)).toMatchObject({
      platforms: ['web'],
      outputs: [{ platform: 'web', format: 'css', path: 'spec-layer/tokens.css', case: 'kebab' }],
    });
    expect(existsSync(join(cwd, 'spec-layer/tokens.css'))).toBe(true);
    expect(existsSync(join(cwd, '.speclayer/outputs/web-css.map.json'))).toBe(true);
    expect(io.outLines).toContain('Wrote spec-layer/tokens.css (web/css, kebab names).');
  });

  it('setup without a platform in an empty directory writes no output and says which flag to pass', async () => {
    const io = makeIo();
    expect(await runSetup(cwd, { id: LIB, key: KEY }, {}, io, stub200())).toBe(0);
    expect(readConfig(cwd)).not.toHaveProperty('outputs');
    expect(existsSync(join(cwd, 'spec-layer'))).toBe(false);
    expect(io.outLines).toContain('No target platform detected, so no token file was written for your code. Pass --platform web|ios|android|flutter, or add outputs to speclayer.json.');
  });

  it('setup detects web from package.json and writes the output without a flag', async () => {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies: { react: '^19' } }));
    const io = makeIo();
    expect(await runSetup(cwd, { id: LIB, key: KEY }, {}, io, stub200())).toBe(0);
    expect(readConfig(cwd)).toMatchObject({ platforms: ['web'] });
    expect(existsSync(join(cwd, 'spec-layer/tokens.css'))).toBe(true);
  });

  it('pull honours an empty outputs list and re-projects when the outputs block changes', async () => {
    writeFileSync(join(cwd, 'speclayer.json'), JSON.stringify({ libraryId: LIB, outDir: '.speclayer', platforms: ['web'], outputs: [] }));
    const io = makeIo();
    expect(await runPull(cwd, { key: KEY }, {}, io, stub200())).toBe(0);
    expect(existsSync(join(cwd, 'spec-layer/tokens.css'))).toBe(false);
    writeFileSync(join(cwd, 'speclayer.json'), JSON.stringify({
      libraryId: LIB, outDir: '.speclayer', platforms: ['web'],
      outputs: [{ platform: 'web', format: 'css', path: 'styles/tokens.css', case: 'camel' }],
    }));
    const second = makeIo();
    const fetcher = stub200();
    expect(await runPull(cwd, { key: KEY }, {}, second, fetcher)).toBe(0);
    // A changed outputs block must not send If-None-Match, or the 304 would skip the re-projection.
    const headers = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0][1].headers as Record<string, string>;
    expect(headers['If-None-Match']).toBeUndefined();
    const css = readFileSync(join(cwd, 'styles/tokens.css'), 'utf8');
    expect(css).toContain('web/css/camel.');
    expect(css).toContain('--primitivesColorChainBridge: var(--primitivesColorChainMiddle);');
  });

  it('pull --platform web adds the default output for the run without rewriting speclayer.json', async () => {
    writeFileSync(join(cwd, 'speclayer.json'), JSON.stringify({ libraryId: LIB, outDir: '.speclayer' }));
    const io = makeIo();
    expect(await runPull(cwd, { key: KEY, platform: ['web'] }, {}, io, stub200())).toBe(0);
    expect(existsSync(join(cwd, 'spec-layer/tokens.css'))).toBe(true);
    expect(readConfig(cwd)).toEqual({ libraryId: LIB, outDir: '.speclayer' });
  });

  it('pull refuses a foreign file at the output path and leaves the record untouched', async () => {
    writeFileSync(join(cwd, 'speclayer.json'), JSON.stringify({ libraryId: LIB, outDir: '.speclayer', platforms: ['web'] }));
    mkdirSync(join(cwd, 'spec-layer'));
    writeFileSync(join(cwd, 'spec-layer/tokens.css'), 'body {}\n');
    const io = makeIo();
    expect(await runPull(cwd, { key: KEY }, {}, io, stub200())).toBe(1);
    expect(io.errLines[0]).toBe('spec-layer/tokens.css exists and was not written by spec-layer. Choose another path or remove the file.');
    expect(existsSync(join(cwd, '.speclayer/manifest.json'))).toBe(false);
  });

  it('list prints path for artifacts and a row per output', async () => {
    const io = makeIo();
    expect(await runSetup(cwd, { id: LIB, key: KEY, platform: ['web'] }, {}, io, stub200())).toBe(0);
    const list = makeIo();
    expect(runList(cwd, {}, list)).toBe(0);
    const text = list.outLines.join('\n');
    expect(text).toContain('components/button.yaml');
    expect(text).toMatch(/output\s+web\/css\s+spec-layer\/tokens\.css/);
  });

  it('rejects an unknown --platform on pull before fetching', async () => {
    writeFileSync(join(cwd, 'speclayer.json'), JSON.stringify({ libraryId: LIB, outDir: '.speclayer' }));
    const io = makeIo();
    const fetcher = stub200();
    expect(await runPull(cwd, { key: KEY, platform: ['Web'] }, {}, io, fetcher)).toBe(1);
    expect(io.errLines[0]).toBe('--platform takes web, ios, android, flutter, not "Web".');
    expect((fetcher as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
  });
```

Where the file's existing `stub200` cannot report headers, add a small fetcher in the test that records `init` (see the file's own `serverLike` or equivalent helper) instead of reading `mock.calls`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run packages/cli/test/files.test.ts packages/cli/test/commands.test.ts`
Expected: FAIL on the new tests and on the return shape.

- [ ] **Step 4: Change `files.ts`**

Imports: replace the extractor import with

```ts
import {
  dtcgExportFiles, foundationDtcg, validateLevel1,
  type DtcgOptions, type FoundationArtifactV5,
} from '@spec-layer/extractor';
import type { Platform } from './detect';
import { outputId, outputPathProblem, renderOutput, writeOutputFile, type OutputConfig } from './outputs';
```

`Manifest` gains, after `dtcg?`:

```ts
  /** The targets this pull was made for, when known. */
  platforms?: Platform[];
  /** The outputs this pull wrote or was told to write; part of the freshness comparison. */
  outputs?: OutputConfig[];
```

`writeBundleFiles`:

```ts
export function writeBundleFiles(opts: {
  outDir: string; cwd: string; raw: string; bundle: BundleV1; libraryId: string; publishedAt: string; bundleHash: string;
  selection?: Selection; dtcg?: DtcgOptions; platforms?: Platform[]; outputs?: OutputConfig[];
}): { written: string[]; outputs: string[] } {
  assertReplaceable(opts.outDir, opts.cwd);
  const selection = opts.selection ?? DEFAULT_SELECTION;
  const selected = selectComponents(opts.bundle, selection);
  const slugs = componentSlugs(opts.bundle);
  const outputs = opts.outputs ?? [];
  const willWriteFoundation = Boolean(opts.bundle.foundation) && selection.foundation;
  // Every deliverable path is checked before anything is staged, so a refusal
  // leaves both the record and the team's file exactly as they were.
  if (willWriteFoundation) {
    for (const o of outputs) {
      const problem = outputPathProblem(opts.cwd, opts.outDir, o);
      if (problem) throw new Error(problem);
    }
  }
  const staging = `${opts.outDir}.partial`;
  rmSync(staging, { recursive: true, force: true });
  const written: string[] = [];
  const deliverables: Array<{ output: OutputConfig; text: string }> = [];
  const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  const put = (rel: string, content: string) => {
    const path = join(staging, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    written.push(rel);
  };
  try {
    put('bundle.json', opts.raw);
    const artifacts: ManifestArtifact[] = [];
    if (opts.bundle.foundation) {
      let path: string | null = null;
      if (selection.foundation) {
        const artifact: unknown = opts.bundle.foundation.artifact;
        if (validateLevel1(artifact).some((d) => d.severity === 'error')) {
          throw new Error('The published Foundation context did not pass schema validation. Republish from the plugin, then pull again.');
        }
        const exp = foundationDtcg(artifact as FoundationArtifactV5, opts.dtcg ?? {});
        for (const [name, text] of Object.entries(dtcgExportFiles(exp))) put(`tokens/${name}`, text);
        path = 'tokens/resolver.json';
        const header = { libraryId: opts.libraryId, contentHash: opts.bundle.foundation.artifact.spec_layer.export.content_hash };
        for (const output of outputs) {
          const rendered = renderOutput(exp, output, header);
          put(`outputs/${outputId(output)}.map.json`, json(rendered.map));
          put(`outputs/${outputId(output)}.report.json`, json(rendered.report));
          deliverables.push({ output, text: rendered.text });
        }
      }
      artifacts.push({
        kind: 'foundation', name: 'foundation',
        contentHash: opts.bundle.foundation.artifact.spec_layer.export.content_hash,
        path,
      });
    }
    opts.bundle.components.forEach((component, i) => {
      const path = selected[i] ? `components/${slugs[i]}.yaml` : null;
      if (path) put(path, component.ai);
      artifacts.push({
        kind: 'component', name: component.name,
        contentHash: component.artifact.spec_layer.export.content_hash, path,
      });
    });
    const manifest: Manifest = {
      libraryId: opts.libraryId, publishedAt: opts.publishedAt, bundleHash: opts.bundleHash,
      pluginVersion: opts.bundle.pluginVersion, extractorVersion: opts.bundle.extractorVersion,
      selection, artifacts,
      ...(opts.dtcg && Object.keys(opts.dtcg).length > 0 ? { dtcg: opts.dtcg } : {}),
      ...(opts.platforms && opts.platforms.length > 0 ? { platforms: opts.platforms } : {}),
      ...(opts.outputs ? { outputs: opts.outputs } : {}),
    };
    put('manifest.json', json(manifest));
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  rmSync(opts.outDir, { recursive: true, force: true });
  renameSync(staging, opts.outDir);
  // Deliverables go last and in place: the record is complete before the
  // team's file changes, and the file is never deleted, only replaced.
  const outputPaths: string[] = [];
  for (const d of deliverables) {
    writeOutputFile(opts.cwd, d.output, d.text);
    outputPaths.push(d.output.path);
  }
  return { written, outputs: outputPaths };
}
```

- [ ] **Step 5: Change `commands.ts`**

Imports: add `import { defaultOutputs, withDefaults, type OutputConfig } from './outputs';` and extend the detect import with `type Platform` if not already present.

`Flags.platform` becomes `platform?: string[]`.

Add these helpers after `sortKeys`:

```ts
/** --platform values as platforms, or null after printing the usage error. */
function platformsFromFlags(flags: Flags, io: Io): Platform[] | null | undefined {
  if (flags.platform === undefined || flags.platform.length === 0) return undefined;
  const out: Platform[] = [];
  for (const value of flags.platform) {
    if (!isPlatform(value)) {
      io.err(`--platform takes ${PLATFORMS.join(', ')}, not "${value}".`);
      return null;
    }
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

type PlatformSource = 'flag' | 'config' | 'detected' | 'none';

/** Flags, then speclayer.json, then the repository root. */
function resolvePlatforms(
  cwd: string, fromFlags: Platform[] | undefined, config: { platforms?: Platform[] } | null,
): { platforms: Platform[]; source: PlatformSource } {
  if (fromFlags) return { platforms: fromFlags, source: 'flag' };
  if (config?.platforms && config.platforms.length > 0) return { platforms: config.platforms, source: 'config' };
  const detected = detectRepo(cwd).platforms;
  return { platforms: detected, source: detected.length > 0 ? 'detected' : 'none' };
}

/** The outputs one pull writes: the config's list, or defaults for the platforms, plus defaults for platforms named by flag. */
function outputsForRun(
  fromFlags: Platform[] | undefined, config: { outputs?: OutputConfig[] } | null, platforms: Platform[],
): OutputConfig[] {
  if (fromFlags) return withDefaults(config?.outputs ?? [], fromFlags);
  return config?.outputs ?? defaultOutputs(platforms);
}

const NO_PLATFORM_NOTE = `No target platform detected, so no token file was written for your code. Pass --platform ${PLATFORMS.join('|')}, or add outputs to speclayer.json.`;
```

`sameOutput` compares outputs too:

```ts
function sameOutput(
  a: { selection: Selection; dtcg?: DtcgOptions; outputs?: OutputConfig[] },
  b: { selection: Selection; dtcg?: DtcgOptions; outputs?: OutputConfig[] },
): boolean {
  const selectionKey = (s: Selection) =>
    JSON.stringify([s.foundation, s.components === null ? null : [...new Set(s.components.map(slugify))].sort()]);
  const key = (v: unknown) => JSON.stringify(sortKeys(v ?? {}));
  return selectionKey(a.selection) === selectionKey(b.selection)
    && key(a.dtcg) === key(b.dtcg) && key(a.outputs ?? []) === key(b.outputs ?? []);
}
```

`runInit`, after `include` is parsed:

```ts
  const fromFlags = platformsFromFlags(flags, io);
  if (fromFlags === null) return 1;
  const { platforms } = resolvePlatforms(cwd, fromFlags, null);
  const outputs = defaultOutputs(platforms);
  const outDir = flags.out ?? DEFAULT_OUT_DIR;
  writeConfig(cwd, {
    libraryId: flags.id, outDir, ...(include ? { include } : {}),
    ...(platforms.length > 0 ? { platforms } : {}), ...(outputs.length > 0 ? { outputs } : {}),
  });
  io.out(`Wrote speclayer.json (library ${flags.id}, output ${outDir}${platforms.length > 0 ? `, platforms ${platforms.join(', ')}` : ''}).`);
  for (const o of outputs) io.out(`Token file for ${o.platform}: ${o.path} (${o.format}, ${o.case} names), written by the next pull.`);
```

`runSetup`, replacing the block from `let existing` through `writeConfig(...)` and its `io.out`:

```ts
  let existing: CliConfig | null = null;
  try { existing = readConfig(cwd); } catch { existing = null; }
  const fromFlags = platformsFromFlags(flags, io);
  if (fromFlags === null) return 1;
  const outDir = flags.out ?? existing?.outDir ?? DEFAULT_OUT_DIR;
  const keptInclude = include ?? existing?.include ?? null;
  const keptDtcg = existing?.dtcg ?? null;
  // Platforms follow the same rule as include: a flag wins, else what the
  // committed config says, else detection. Outputs keep every entry the config
  // already has and gain a default for any platform that has none.
  const { platforms } = resolvePlatforms(cwd, fromFlags, existing);
  const outputs = withDefaults(existing?.outputs ?? [], platforms);
  writeConfig(cwd, {
    libraryId: flags.id, outDir,
    ...(keptInclude ? { include: keptInclude } : {}),
    ...(keptDtcg ? { dtcg: keptDtcg } : {}),
    ...(platforms.length > 0 ? { platforms } : {}),
    ...(existing?.outputs !== undefined || outputs.length > 0 ? { outputs } : {}),
  });
  io.out(`Wrote speclayer.json (library ${flags.id}, output ${outDir}${platforms.length > 0 ? `, platforms ${platforms.join(', ')}` : ''}).`);
```

The `runPull` call inside `runSetup` stays `{ ...flags, key }`; pull re-reads the config just written.

`runPull`: after `selection` is resolved and before the etag:

```ts
  const fromFlags = platformsFromFlags(flags, io);
  if (fromFlags === null) return 1;
  const { platforms, source } = resolvePlatforms(cwd, fromFlags, opts);
  const outputs = outputsForRun(fromFlags, opts, platforms);
```

The `sameOutput` call passes `outputs: manifest.outputs` and `outputs` on the two sides. The `writeBundleFiles` call gains `platforms, outputs` and its result is destructured:

```ts
    const result = writeBundleFiles({ ...as before..., platforms, outputs });
    written = result.written;
    outputPaths = result.outputs;
```

(declare `let outputPaths: string[] = [];` beside `let written`.) After the `Wrote N files under` line:

```ts
  for (const path of outputPaths) {
    const o = outputs.find((x) => x.path === path);
    if (o) io.out(`Wrote ${path} (${o.platform}/${o.format}, ${o.case} names).`);
  }
  if (outputPaths.length === 0 && selection.foundation && source === 'none' && (opts.outputs === undefined)) io.out(NO_PLATFORM_NOTE);
```

`runList`: the rows use `a.path`; after the loop over artifact rows, add:

```ts
  for (const o of manifest.outputs ?? []) {
    io.out(['output'.padEnd(widths[0]), `${o.platform}/${o.format}`.padEnd(widths[1]), o.path].join('  '));
  }
```

`collectSkillInput`: replace the platform block with

```ts
  const fromFlags = platformsFromFlags(flags, io);
  if (fromFlags === null) return null;
  const { platforms, source: platformSource } = resolvePlatforms(cwd, fromFlags, config);
```

and in `skill.ts` widen `SkillInput.platformSource` to `'flag' | 'config' | 'detected' | 'none'` (the guide text for `'config'` is written in Task 7; for now the `label` expression in `stackSection` must handle it: `platformSource === 'flag' ? 'chosen with --platform' : platformSource === 'config' ? 'set in speclayer.json' : 'detected'`).

`cli.ts`: `platform: { type: 'string', multiple: true }`, and in `USAGE` add `[--platform P]...` to the `setup`, `init`, and `pull` lines, plus this line under Options:

```text
  --platform web|ios|android|flutter   the target this repo builds for (repeatable); setup and init store it, pull uses it for the run
```

- [ ] **Step 6: Run the CLI suite**

Run: `npx vitest run packages/cli`
Expected: PASS. If `stub200` does not expose request headers for the re-projection test, write a two-line recording fetcher in that test.

- [ ] **Step 7: Build the CLI bundle and smoke it**

```bash
npm run build:cli && npm run check:cli-bundle
```

Expected: both succeed. The bundle now includes `css.ts`; `check:cli-bundle` proves it evaluates.

- [ ] **Step 8: Commit**

Run `npm run typecheck && npm run lint`, stage `packages/cli`, subject: `feat(cli): write platform outputs in place from pull, setup, and init`.

---

### Task 7: Agent guide and tool catalogue

**Files:**
- Modify: `packages/cli/src/skill.ts` (`PullSummary`, `summarizePull`, `stackSection` web branch, `pullSection`, `buildSkillGuide` steps 3 and 6)
- Modify: `packages/cli/src/tools.ts` (setup, init, pull entries)
- Test: `packages/cli/test/skill.test.ts`, `packages/cli/test/tools.test.ts`

**Interfaces:**
- Consumes: `Manifest.outputs`, `OutputConfig`.
- Produces: `PullSummary.outputs: Array<{ platform: string; format: string; path: string; case: string; modeSelector: string; modes: Record<string, string> }>`.

- [ ] **Step 1: Write the failing tests**

In `skill.test.ts`, extend `PULL` with `outputs: []` (the type now requires it) and add a second constant plus tests:

```ts
const PULL_WITH_CSS: NonNullable<SkillInput['pull']> = {
  ...PULL,
  outputs: [{ platform: 'web', format: 'css', path: 'spec-layer/tokens.css', case: 'kebab', modeSelector: '[data-theme="{mode}"]', modes: {} }],
};

describe('buildSkillGuide outputs', () => {
  const web: RepoProfile = { ...EMPTY_PROFILE, platforms: ['web'] };

  it('tells the agent to import the css file, switch modes with data-theme, and read names from the map', () => {
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull: PULL_WITH_CSS }));
    expect(guide).toContain('- `spec-layer/tokens.css`: web/css token file, kebab names, modes under `[data-theme="{mode}"]`.');
    expect(guide).toContain('Import `spec-layer/tokens.css` from the root stylesheet');
    expect(guide).toContain('set `data-theme` on `<html>`');
    expect(guide).toContain('`.speclayer/outputs/web-css.map.json`');
    expect(guide).toContain('source "code_syntax" when the designer declared it in Figma, "derived" when the CLI built it from the DTCG path');
    expect(guide).not.toContain('derive nothing');
  });

  it('says the css is a projection of tokens/ when a pipeline is present', () => {
    const sd: RepoProfile = { ...web, tokenTools: ['style-dictionary'], styleDictionaryMajor: 5 };
    const guide = buildSkillGuide(input({ profile: sd, platforms: ['web'], platformSource: 'detected', pull: PULL_WITH_CSS }));
    expect(guide).toContain('`spec-layer/tokens.css` is a projection of the same `tokens/` files, not a second source. Import one or the other.');
  });

  it('names the flag when web is targeted but no output was written', () => {
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull: PULL }));
    expect(guide).toContain('No token file was written for web.');
    expect(guide).toContain('`"outputs"` in `speclayer.json`');
  });

  it('labels a platform that came from the config', () => {
    const guide = buildSkillGuide(input({ platforms: ['web'], platformSource: 'config', pull: PULL_WITH_CSS }));
    expect(guide).toContain('Target platform (set in speclayer.json): web.');
  });

  it('warns never to edit the output path in step 6', () => {
    const guide = buildSkillGuide(input({ pull: PULL_WITH_CSS }));
    expect(guide).toContain('Never edit `spec-layer/tokens.css` either: pull replaces it in place.');
  });
});
```

In `tools.test.ts`, add:

```ts
  it('names the platform flag and the output paths for setup, init, and pull', () => {
    const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
    for (const name of ['setup', 'init', 'pull']) expect(byName[name].usage).toContain('[--platform web|ios|android|flutter]...');
    expect(byName.setup.writes).toContain('outputs[].path from speclayer.json (default spec-layer/tokens.css for web), written in place');
    expect(byName.pull.writes).toContain('outputs[].path from speclayer.json (default spec-layer/tokens.css for web), written in place');
    expect(byName.init.writes).toEqual(['speclayer.json']);
  });
```

Check that `TOOLS` is imported in `tools.test.ts`; add the import if it is not.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/cli/test/skill.test.ts packages/cli/test/tools.test.ts`
Expected: FAIL.

- [ ] **Step 3: Change `skill.ts`**

`PullSummary` gains:

```ts
  outputs: Array<{
    platform: string; format: string; path: string; case: string; modeSelector: string; modes: Record<string, string>;
  }>;
```

In `summarizePull`'s return, add:

```ts
    outputs: (manifest.outputs ?? []).map((o) => ({
      platform: o.platform, format: o.format, path: o.path, case: o.case,
      modeSelector: o.modeSelector ?? '[data-theme="{mode}"]', modes: o.modes ?? {},
    })),
```

`SkillInput.platformSource` is `'flag' | 'config' | 'detected' | 'none'` (done in Task 6). In `stackSection`, the label line:

```ts
    const label = platformSource === 'flag' ? 'chosen with --platform'
      : platformSource === 'config' ? 'set in speclayer.json' : 'detected';
```

In the `web` branch, replace the first `lines.push(...)` (the one ending with `say in your change that the code name is not declared in Figma.`) with:

```ts
      const cssOut = pull?.outputs.find((o) => o.platform === 'web' && o.format === 'css') ?? null;
      const mapPath = `${input.outDir}/outputs/web-css.map.json`;
      lines.push(
        `The CSS custom property for every token is in ${code(mapPath)}: `
        + 'source "code_syntax" when the designer declared it in Figma, "derived" when the CLI built it from the DTCG path '
        + `by the stated rule (${cssOut ? cssOut.case : 'kebab'} case, collection root included). Use those names; never invent a third. `
        + `${code(`${tokensDir}spec-layer.meta.json`)} still holds the raw ${code('code_syntax.WEB')} the designer declared.`,
        '',
      );
      if (cssOut) {
        lines.push(
          `Import ${code(cssOut.path)} from the root stylesheet. It holds every set and every default mode at ${code(':root')}; `
          + `every other mode is a block under ${code(cssOut.modeSelector)}. To switch, set ${code('data-theme')} on ${code('<html>')} `
          + '(or whatever the selector names). Wire it to prefers-color-scheme yourself if the OS should choose; the file never assumes that.',
          '',
        );
        if (profile.tokenTools.includes('style-dictionary') || profile.tokenTools.includes('tokens-studio')) {
          lines.push(
            `${code(cssOut.path)} is a projection of the same ${code('tokens/')} files, not a second source. Import one or the other.`,
            '',
          );
        }
      } else if (pull?.foundation?.written) {
        lines.push(
          'No token file was written for web. Add `"outputs"` in `speclayer.json` (or run `spec-layer pull --platform web` once) '
          + `and pull again; the default lands at ${code('spec-layer/tokens.css')}.`,
          '',
        );
      }
```

In `pullSection`, after the `components/` line, add:

```ts
  for (const o of pull.outputs) {
    lines.push(`- ${code(o.path)}: ${o.platform}/${o.format} token file, ${o.case} names, modes under ${code(o.modeSelector)}.`
      + ` Names and provenance: ${code(`${outDir}/outputs/${o.platform}-${o.format}.map.json`)}; what it could not express: ${code(`${outDir}/outputs/${o.platform}-${o.format}.report.json`)}.`);
  }
```

In `buildSkillGuide`, step 6 becomes:

```ts
  const outputNote = input.pull?.outputs.length
    ? ` Never edit ${input.pull.outputs.map((o) => code(o.path)).join(', ')} either: pull replaces ${input.pull.outputs.length === 1 ? 'it' : 'them'} in place.`
    : '';
  lines.push(`6. Never edit files under ${code(outDir + '/')}: the next pull replaces the whole directory.${outputNote} Configuration lives in ${code('speclayer.json')}. Never commit ${code(CREDENTIALS_NAME)}, and never print or copy the pull key.`);
```

- [ ] **Step 4: Change `tools.ts`**

`setup.usage`: `'spec-layer setup --id lib_... --key sl_... [--out DIR] [--platform web|ios|android|flutter]... [--only foundation|components] [--component NAME]...'` and `setup.writes` gains `'outputs[].path from speclayer.json (default spec-layer/tokens.css for web), written in place'`.

`init.usage`: `'spec-layer init --id lib_... [--out DIR] [--platform web|ios|android|flutter]... [--only foundation|components] [--component NAME]...'`; `init.summary` becomes `'Writes speclayer.json, with the platforms and default outputs, so later commands need no flags. Stores no key and reaches no server.'`.

`pull.usage`: `'spec-layer pull [--id lib_...] [--key sl_...] [--out DIR] [--platform web|ios|android|flutter]... [--only foundation|components] [--component NAME]...'`; `pull.writes` becomes `['<outDir>/', 'outputs[].path from speclayer.json (default spec-layer/tokens.css for web), written in place']`; `pull.when` gains `or the outputs block` after `include or dtcg block`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/cli`
Expected: PASS.

- [ ] **Step 6: Commit**

Run `npm run typecheck && npm run lint`, stage `packages/cli`, subject: `feat(cli): guide and tool catalogue describe the platform outputs`.

---

### Task 8: Documentation, version, and the full gate

**Files:**
- Modify: `packages/cli/package.json` (`"version": "0.6.0"`)
- Modify: `packages/cli/README.md`
- Modify: `CHANGELOG.md` (Unreleased, Added)
- Modify: `ARCHITECTURE.md` (CLI section)
- Modify: `CLAUDE.md` (layout line for the CLI, and the "Where things stand" list)
- Modify: `apps/website/content/docs/outputs.html`, `apps/website/content/docs/quickstart.html`, `apps/website/content/docs/cli.html`, and the configuration page if `grep -l "dtcg" apps/website/content/docs/*.html` lists one.

- [ ] **Step 1: Version**

Set `"version": "0.6.0"` in `packages/cli/package.json`. Run `npx vitest run packages/cli/test/version.test.ts`; if it pins the number, update the expectation.

- [ ] **Step 2: README**

In `packages/cli/README.md`:

Replace the "What `pull` writes" tree with:

```text
.speclayer/
  bundle.json                the published bundle, verbatim
  manifest.json              every artifact indexed by content hash and path, plus the selection and outputs
  tokens/                    the Foundation as Design Tokens Format Module 2025.10 files
    <collection>.<mode>.json one file per collection and mode, rooted at the collection name
    styles.typography.json   text styles as typography composites (when present)
    styles.effects.json      effect styles as shadow composites (when present)
    resolver.json            Design Tokens Resolver Module 2025.10: sets, modifiers, order
    spec-layer.meta.json     Figma ids, scopes, code syntax, publication, keyed by DTCG path
    report.json              what DTCG could not express, with reasons and stable ids
  components/<name>.yaml     one file per selected component
  outputs/
    web-css.map.json         DTCG path -> CSS custom property, with where the name came from
    web-css.report.json      what the CSS file could not express
spec-layer/
  tokens.css                 the web token file, written in place at outputs[].path
```

Change the sentence after it to: "Point your agent at `.speclayer/components/` and `.speclayer/tokens/`, and import the token file for your platform from where `outputs` puts it." Change `"aiPath": null` to `"path": null`, and add to the version note paragraph in "Installing, or not": "`components/` in place of `ai/components/`, `path` in place of `aiPath` in the manifest, and the `outputs` block need 0.6.0 or later."

Add a new section after "Configuring the token output":

````markdown
## Token files for your code

`pull` also writes a file your build compiles, one per platform output. For
the web that is a CSS file of custom properties:

```css
:root {
  /* Foundation */
  --foundation-colors-blue-500: #2e72d1;
  --foundation-spacing-200: 8px;
  /* Mapped Colors, Light */
  --mapped-colors-surface-primary-default: var(--foundation-colors-blue-500);
}

[data-theme="dark"] {
  /* Mapped Colors, Dark */
  --mapped-colors-surface-primary-default: var(--foundation-colors-blue-900);
}
```

Sets and every collection's default mode sit at `:root`; every other mode is
a block under `[data-theme="<mode>"]`. Aliases stay as `var()`. A number whose
Figma scopes state no unit stays a bare number. Nothing about a mode's name
selects a media query; wire `data-theme` to `prefers-color-scheme` yourself if
the OS should choose.

The file is written **in place** at the path in `speclayer.json`, outside the
managed directory, so your bundler keeps watching it and the diff shows up in
review. It begins with a header naming the library and the Foundation's
content hash, and `pull` refuses to overwrite a file at that path that lacks
the header.

```json
{
  "platforms": ["web"],
  "outputs": [
    { "platform": "web", "format": "css", "path": "spec-layer/tokens.css", "case": "kebab" }
  ]
}
```

`setup` and `init` write this block from `--platform`, or from what they detect
at the repository root, so the path is always on record. `pull` writes every
entry; `"outputs": []` writes none. `case` chooses how derived names are
spelled: `kebab` (default), `camel`, `pascal`, `snake`, or `constant`. A name
the designer declared as `code_syntax` in Figma is used verbatim and never
re-cased. `.speclayer/outputs/web-css.map.json` records every emitted name and
whether it was declared or derived; two tokens that would share a name are
both omitted and listed in `web-css.report.json`.

Two collections with modes share one attribute by default, which cannot be
right for both; the report says so, and `modes` declares a selector per
collection:

```json
{ "platform": "web", "format": "css", "path": "spec-layer/tokens.css",
  "modes": { "Density": "[data-density=\"{mode}\"]" } }
```

`root` and `modeSelector` override the defaults `:root` and
`[data-theme="{mode}"]`; `{mode}` and `{collection}` are replaced by slugs.
A repository that already builds tokens with Style Dictionary can keep reading
`tokens/`: the CSS file is a projection of the same files, not a second
source, so import one or the other.

Commit `.speclayer/`, `speclayer.json`, and the output paths. A repository
that would rather regenerate in CI ignores them and runs `pull` there;
`status` exits `2` when a pull is due.
````

Update the Commands table rows for `setup`, `init`, `pull` to include `[--platform P]...`, and the Quick start to mention `--platform web` for a fresh directory:

```bash
npx spec-layer setup --id lib_... --key sl_... --platform web
```

with the sentence: "`--platform` says what you build; without it, `setup` reads the repository root and writes a token file only when it finds a web signal."

- [ ] **Step 3: CHANGELOG, ARCHITECTURE, CLAUDE.md**

`CHANGELOG.md`, under `## [Unreleased]` / `### Added`, first entry:

```markdown
- **Platform outputs** (CLI 0.6.0). `spec-layer pull` writes a token file
  your build compiles, in place at a path declared under `outputs` in
  `speclayer.json`, outside the swapped `.speclayer/` directory. The first
  format is `web` / `css`: every set and default mode at `:root`, every other
  mode under `[data-theme="<mode>"]`, aliases as `var()`, unitless numbers
  bare, typography as one custom property per member, effects as one
  `box-shadow`. Names come from the designer's `code_syntax.WEB` when Figma
  declares one and otherwise from the DTCG path in a chosen case (`kebab`,
  `camel`, `pascal`, `snake`, `constant`); two tokens that would share a name
  are both omitted and reported. `.speclayer/outputs/web-css.map.json` records
  every name with its provenance and `web-css.report.json` what CSS could not
  say. `setup` and `init` take a repeatable `--platform` and store `platforms`
  and a default output (`spec-layer/tokens.css` for web); `pull` refuses to
  overwrite a file at that path that does not carry the Spec Layer header. The
  projection reads the DTCG export in `packages/extractor/src/v5/outputs/`,
  never the artifact, and feeds no hash.
- **`components/`** replaces `ai/components/` in the pulled directory, and the
  manifest field `aiPath` is now `path`. A manifest written by an earlier CLI
  is still read.
```

`ARCHITECTURE.md`: find the CLI section (`grep -n "spec-layer pull\|tokens/" ARCHITECTURE.md`) and add one paragraph after the description of `tokens/`:

```markdown
`pull` also writes platform outputs: files the team's build compiles, one per
`outputs` entry in `speclayer.json`, written in place at the declared path
rather than inside the swapped directory. Each is a pure projection of the
DTCG export under `packages/extractor/src/v5/outputs/` (today `web` / `css`),
so v5 keeps one reader and no hash moves. The name map and report for each
output land in `.speclayer/outputs/`.
```

`CLAUDE.md`: in the Layout block change the CLI line to `packages/cli/          spec-layer CLI: setup, init, pull, status, list, show, tools, skill; delivery plus pure platform projections, no extraction`. In "Where things stand" under **Delivery**, append: "CLI `0.6.0` adds platform outputs (`web` / `css` written in place at `outputs[].path`) and renames `ai/components/` to `components/`; not yet published."

- [ ] **Step 4: Website docs**

`apps/website/content/docs/outputs.html`, in the `file-layout` section: replace the tree with the README tree above (HTML-escape `<` and `>` as `&lt;` `&gt;`), change `aiPath: null` to `path: null` in the definitions, and add to the `<dl>`:

```html
<div><dt>outputs/</dt><dd>Per platform output, the name map (<code>web-css.map.json</code>: DTCG path to emitted name, with <code>code_syntax</code> or <code>derived</code> as its source) and the report of what the format could not express.</dd></div>
<div><dt>spec-layer/tokens.css</dt><dd>The web token file, written in place at the path in <code>outputs</code>, outside the managed directory. Sets and default modes at <code>:root</code>, other modes under <code>[data-theme="…"]</code>, aliases as <code>var()</code>.</dd></div>
```

Add a section before `updates`:

```html
<section id="web-tokens"><h2>Web token file</h2>
<p>When <code>platforms</code> includes <code>web</code>, <code>pull</code> writes a CSS file of custom properties at <code>outputs[].path</code> (default <code>spec-layer/tokens.css</code>). Names use the designer’s <code>code_syntax.WEB</code> when Figma declares one and otherwise the DTCG path in the chosen case: <code>kebab</code>, <code>camel</code>, <code>pascal</code>, <code>snake</code>, or <code>constant</code>. Two tokens that would share a name are both omitted and reported. A number whose Figma scopes state no unit stays a bare number, and no mode name selects a media query.</p>
<div class="docs-code"><pre tabindex="0"><code>:root {
  /* Foundation */
  --foundation-colors-blue-500: #2e72d1;
  /* Mapped Colors, Light */
  --mapped-colors-surface-primary-default: var(--foundation-colors-blue-500);
}

[data-theme="dark"] {
  /* Mapped Colors, Dark */
  --mapped-colors-surface-primary-default: var(--foundation-colors-blue-900);
}</code></pre></div>
<p>The file is written in place and begins with a header naming the library and Foundation hash; <code>pull</code> refuses to overwrite a file at that path without it. Commit it with <code>.speclayer/</code> and <code>speclayer.json</code>. A repository that already builds tokens with Style Dictionary can keep reading <code>tokens/</code>; the CSS file is a projection of the same files, not a second source.</p></section>
```

In the `updates` section, add a sentence: "Output files declared under <code>outputs</code> are replaced in place, never deleted."

`apps/website/content/docs/quickstart.html`: in the tree replace the `ai/` two lines with `└── components/          <span class="code-comment"># component YAML context</span>` and add a `spec-layer/tokens.css` line with the comment `# web token file (CLI 0.6+)`; change "Point your coding agent at `.speclayer/ai/`" to `.speclayer/components/`; extend the CLI versions notice with "The <code>components/</code> directory, the <code>path</code> manifest field, and platform outputs need 0.6.0 or later." Add `--platform web` to the setup command shown and the sentence "Pass <code>--platform web</code> in a fresh directory so the first pull writes <code>spec-layer/tokens.css</code>."

`apps/website/content/docs/cli.html`: in `setup`, `init`, and `pull`, mention the repeatable `--platform` flag and what each does with it (store; store; use for the run). In `list`, "and a row per platform output". In the `options` table add a row for `--platform web|ios|android|flutter`. In the configuration page found by the grep, add an "outputs" entry beside the `dtcg` block using the JSON from the README section.

- [ ] **Step 5: Run every gate**

```bash
npm run check
```

```bash
npm run check --prefix apps/website
```

Expected: both exit 0. Read the exit codes directly, never through a pipe. If the website check flags copy (for example a curly quote rule or an em dash), fix the copy, not the check.

- [ ] **Step 6: Commit**

Stage the docs, `CLAUDE.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `packages/cli/package.json`, `packages/cli/README.md`, and `apps/website/content`. Subject: `docs: platform outputs, components directory, cli 0.6.0`.

---

## Self-review

**Spec coverage.** Section 3 (record vs deliverable, outputs model): Tasks 5 and 6. 3.1 (rename): Task 4. 4.1 (config fields): Task 5. 4.2 (in-place write, header, refusal, manifest records outputs, freshness): Tasks 5 and 6. 4.3 (names, cases, collisions, map): Tasks 1 and 2. 4.4 (report codes): Tasks 1 and 2. 5.1 to 5.5 (CSS structure, values, styles, modes): Tasks 2 and 3. Section 7 (adoption paths, commit policy, messages): Tasks 6, 7, 8. Section 9 (guide, tools, usage, docs): Tasks 6, 7, 8. Section 11 (tests): Tasks 1 to 7, with the parser gate in Task 3 and the CLI refusals in Tasks 5 and 6. Section 8 (plugin unchanged): no task, by design.

**Not covered, deliberately.** `spec-layer status` reporting "behind" on an outputs change: `status` compares the bundle hash only, and a config change is caught by `pull` itself (it drops the `If-None-Match` and re-projects). Spec section 4.2 was corrected to say exactly that when this plan was written.

**Type consistency.** `OutputConfig` is defined once in `packages/cli/src/outputs.ts` and imported by `config.ts`, `files.ts`, `commands.ts`, `skill.ts`. `writeBundleFiles` returns `{ written, outputs }` in Task 6 and every caller in Task 6 destructures it. `Flags.platform` is `string[]` from Task 6 onward; `platformsFromFlags` returns `Platform[] | null | undefined` (undefined = flag absent, null = bad value after printing). `SkillInput.platformSource` includes `'config'` from Task 6, used in Task 7. `PullSummary.outputs` is required from Task 7; the `PULL` constant in `skill.test.ts` gains `outputs: []` in the same task.
