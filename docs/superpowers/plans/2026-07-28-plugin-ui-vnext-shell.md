# Plugin UI vNext — Foundation and Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the design-system foundation and the new plugin shell — side rail, utility header, AI allowance control, theme button — behind a build-time flag, with the legacy UI still the default.

**Architecture:** The framework-free split is preserved. CSS is read from disk by `build.mjs` and embedded in the generated `ui.html`; the TypeScript never imports CSS. All branching logic lives in pure `viewModel/` functions that map existing domain state onto the contracts in `contracts.ts`; DOM builders stay thin enough that they carry no logic worth testing. A build-time `__UI_VNEXT__` define selects legacy or vNext at boot.

**Tech Stack:** TypeScript, esbuild, Vitest, Figma Plugin API. No framework, no runtime dependencies.

## Global Constraints

- **No new runtime dependencies.** The plugin ships as one embedded `ui.html`.
- **No jsdom.** This repo has no DOM test environment and its tests fake the minimal object surface they need (see `packages/plugin/test/loader.test.ts`). Do not add one. Test pure functions; verify DOM in the harness.
- **Coverage is a ratchet** (`vitest.config.ts`: statements 45, branches 40, functions 50, lines 45). It may only go up. Keep DOM builders thin so untested markup does not drag it down.
- **Voice:** never use em dashes in user-facing plugin copy. Plain, honest peer tone. Rules in `docs/plugin-voice-and-copy.md`.
- **Copy:** American English, sentence case. `AI writing`, not `AI quota`. `Library`, not `My Library`. `Create docs` for the component workflow.
- **Frame size:** 480 x 680. No resize handle.
- **Do not modify:** `actions.ts`, `messages.ts`, `docModel.ts`, `foundationState.ts`, `theme.ts`, `proxy.ts`, `docLink.ts`. They are the behavior source of truth.
- **Accessible names:** every icon-only control needs one. Tooltips are supplemental.

**Scope:** PR 1 (Tasks 1-2) and PR 2 (Tasks 3-8) of the eight in `docs/superpowers/specs/2026-07-28-plugin-ui-vnext-design.md`. The five screens get their own plans once the interfaces below exist.

---

### Task 1: Embed the design-system CSS in the built UI

**Files:**
- Create: `packages/plugin/src/ui/design-system/tokens.css`
- Create: `packages/plugin/src/ui/design-system/components.css`
- Create: `packages/plugin/src/ui/design-system/patterns.css`
- Modify: `packages/plugin/build.mjs:50-56`
- Test: `packages/plugin/test/uiHtml.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a `dist/ui.html` whose `<head>` carries the three CSS layers in cascade order. Every later task's markup depends on these class names existing.

Note: the spec described this as an esbuild text loader. Reading the files in `build.mjs` is simpler and avoids a Vite/esbuild disagreement about what `import x from './a.css'` returns, with the same result: one token source, no second copy.

- [ ] **Step 1: Copy the three CSS files into the plugin**

```bash
cd "$(git rev-parse --show-toplevel)"
mkdir -p packages/plugin/src/ui/design-system
cp docs/plugin-ui-vnext/design-system/tokens.css \
   docs/plugin-ui-vnext/design-system/components.css \
   docs/plugin-ui-vnext/design-system/patterns.css \
   packages/plugin/src/ui/design-system/
```

`index.css` is deliberately not copied. It documents the import order, which `build.mjs` now encodes directly.

- [ ] **Step 2: Write the failing test**

Create `packages/plugin/test/uiHtml.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The design system reaches the plugin through build.mjs, not through the
 * TypeScript import graph, so the only honest place to assert it is the
 * built artefact.
 */
const pluginDir = fileURLToPath(new URL('..', import.meta.url));

describe('dist/ui.html', () => {
  let html = '';

  beforeAll(() => {
    execFileSync('node', ['build.mjs'], { cwd: pluginDir, stdio: 'pipe' });
    html = readFileSync(fileURLToPath(new URL('../dist/ui.html', import.meta.url)), 'utf-8');
  });

  it('embeds the design-system tokens', () => {
    expect(html).toContain('--sl-color-canvas');
    expect(html).toContain('--sl-plugin-width');
  });

  it('embeds the layers in cascade order: tokens, components, patterns', () => {
    const tokens = html.indexOf('--sl-plugin-width');
    const components = html.indexOf('.sl-button');
    const patterns = html.indexOf('.sl-plugin-shell');
    expect(tokens).toBeGreaterThan(-1);
    expect(components).toBeGreaterThan(tokens);
    expect(patterns).toBeGreaterThan(components);
  });

  it('still embeds the UI bundle', () => {
    expect(html).toContain('<script>');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/uiHtml.test.ts`
Expected: FAIL — `expected '<!DOCTYPE html>…' to contain '--sl-color-canvas'`.

- [ ] **Step 4: Read and embed the CSS in `build.mjs`**

In `packages/plugin/build.mjs`, immediately after the `const uiEntry = …` line, add:

```js
// The design system is embedded from disk rather than imported through the
// TypeScript graph, so src/ui/design-system/*.css stays the single source and
// no second copy can drift. Order is the documented cascade: tokens define the
// roles, components consume them, patterns compose components.
const designSystemCss = ['tokens.css', 'components.css', 'patterns.css']
  .map((file) => readFileSync(resolve(__dirname, 'src/ui/design-system', file), 'utf-8'))
  .join('\n');
```

Then replace the `const html = …` template (currently `build.mjs:50-56`) with:

```js
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Spec Layer</title>
<style>${designSystemCss}</style>
</head>
<body>
<script>${js}</script>
</body>
</html>`;
```

`readFileSync` and `resolve` are already imported at the top of the file.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/plugin/test/uiHtml.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Verify the legacy UI is unchanged**

Run: `npm test -- packages/plugin/test && npm run typecheck && npm run lint`
Expected: all pass. The legacy UI has its own `<style>` inside the `dom.ts` template and shares no class names with `sl-`, so nothing should shift.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/ui/design-system packages/plugin/build.mjs packages/plugin/test/uiHtml.test.ts
git commit -m "build(plugin): embed the vNext design-system CSS in ui.html"
```

---

### Task 2: Add the presentation contracts

**Files:**
- Create: `packages/plugin/src/ui/viewModel/contracts.ts`
- Test: `packages/plugin/test/contracts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PluginView`, `ThemeMode`, `AllowanceState`, `ComponentScreenState`, `LibraryStatus`, `ChangeGroup`, `LibraryRowView`, `FoundationScreenState`, `LicenseState`, `NavigationItem`, `SectionOption`, `SectionGroupView`, the `navigation` constant, and `assertNever(value: never, context: string): never`. Every later task imports from here.

- [ ] **Step 1: Copy the contracts into the plugin**

```bash
cd "$(git rev-parse --show-toplevel)"
mkdir -p packages/plugin/src/ui/viewModel
cp docs/plugin-ui-vnext/design-system/contracts.ts \
   packages/plugin/src/ui/viewModel/contracts.ts
```

This copy is now the maintained version. The one under `docs/` stays as the handoff record.

- [ ] **Step 2: Write the failing test**

Create `packages/plugin/test/contracts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assertNever, navigation } from '../src/ui/viewModel/contracts';

describe('assertNever', () => {
  it('names the unhandled value and its context', () => {
    expect(() => assertNever('surprise' as never, 'LibraryStatus'))
      .toThrow('Unhandled LibraryStatus: surprise');
  });
});

describe('navigation', () => {
  it('lists the five workflows in rail order', () => {
    expect(navigation.map((item) => item.id)).toEqual([
      'component', 'foundations', 'library', 'settings', 'license',
    ]);
  });

  it('groups them so the rail can draw its two separators', () => {
    expect(navigation.map((item) => item.group)).toEqual([
      'create', 'create', 'library', 'settings', 'settings',
    ]);
  });

  it('gives every item an accessible label', () => {
    for (const item of navigation) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/contracts.test.ts`
Expected: FAIL — cannot resolve `../src/ui/viewModel/contracts` (if Step 1 was skipped) or PASS immediately (if it was not). If it passes, that is fine: the copy is the implementation. Confirm the file exists and move on.

- [ ] **Step 4: Verify the types compile under the repo's strict settings**

Run: `npm run typecheck`
Expected: PASS. If `declaration: true` complains about the exported `const navigation`, add an explicit annotation — it is already typed `readonly NavigationItem[]`, so this should not occur.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/viewModel/contracts.ts packages/plugin/test/contracts.test.ts
git commit -m "feat(plugin): add vNext presentation contracts"
```

---

### Task 3: Inline the shell icon set

**Files:**
- Create: `packages/plugin/src/ui/shell/icons.ts`
- Test: `packages/plugin/test/icons.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ICON_PATHS: Record<IconName, string>` (inner SVG markup, no wrapper), `type IconName`, and `icon(name: IconName, size?: number): string` returning a complete `<svg>` string with `aria-hidden="true"`.

The prototype drew these from `@tabler/icons-react`, which the plugin cannot take: it is a React package and the UI ships as one embedded HTML file. These are hand-authored in the 24-viewBox stroked style the codebase already uses in `theme.ts` and `dom.ts`. `world` is lifted verbatim from `dom.ts:991`; `sun` and `moon` from `theme.ts:47-52`.

`brandLinkedin` is deliberately **not** the mark at `dom.ts:995`. That one is a solid `fill="currentColor"` logo, which cannot survive this module's shared `fill="none"` stroke wrapper. The stroked "in" badge below matches what the prototype's rail actually showed. The legacy header keeps its own solid mark until the legacy UI is deleted, so the two coexist only behind the flag.

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/icons.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ICON_PATHS, icon } from '../src/ui/shell/icons';

describe('ICON_PATHS', () => {
  it('covers every icon the shell renders', () => {
    for (const name of [
      'fileDescription', 'layoutGrid', 'folder', 'settings', 'key',
      'search', 'sun', 'moon', 'world', 'brandLinkedin',
    ] as const) {
      expect(ICON_PATHS[name]).toBeTruthy();
    }
  });

  it('stores inner markup only, so the wrapper stays under our control', () => {
    for (const markup of Object.values(ICON_PATHS)) {
      expect(markup).not.toContain('<svg');
    }
  });
});

describe('icon', () => {
  it('wraps the markup in a sized, decorative svg', () => {
    const svg = icon('search', 16);
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('width="16"');
    expect(svg).toContain('height="16"');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain(ICON_PATHS.search);
  });

  it('defaults to 17px, the rail and header size', () => {
    expect(icon('folder')).toContain('width="17"');
  });

  it('strokes with currentColor so tokens drive the color', () => {
    expect(icon('key')).toContain('stroke="currentColor"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/icons.test.ts`
Expected: FAIL — cannot resolve `../src/ui/shell/icons`.

- [ ] **Step 3: Write the icon module**

Create `packages/plugin/src/ui/shell/icons.ts`:

```ts
/**
 * icons.ts — the shell's icon set as inner SVG markup.
 *
 * Hand-authored in the same 24-viewBox stroked style the plugin already uses
 * (theme.ts, dom.ts) rather than pulled from an icon package: the UI ships as
 * one embedded HTML file and takes no runtime dependencies. `world` and
 * `brandLinkedin` are the existing paths from dom.ts; `sun` and `moon` are the
 * existing paths from theme.ts.
 *
 * Values are inner markup only. `icon()` owns the wrapper so every glyph gets
 * the same sizing, stroke, and aria treatment.
 */

export const ICON_PATHS = {
  /** Generate component docs. */
  fileDescription:
    '<path d="M14 3v4a1 1 0 0 0 1 1h4"/>' +
    '<path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/>' +
    '<path d="M9 13h6"/><path d="M9 17h6"/>',
  /** Generate foundation docs. */
  layoutGrid:
    '<rect x="4" y="4" width="6" height="6" rx="1"/>' +
    '<rect x="14" y="4" width="6" height="6" rx="1"/>' +
    '<rect x="4" y="14" width="6" height="6" rx="1"/>' +
    '<rect x="14" y="14" width="6" height="6" rx="1"/>',
  /** Library. A familiar folder, not a database. */
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  settings:
    '<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>' +
    '<circle cx="12" cy="12" r="3"/>',
  key:
    '<circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4"/>' +
    '<path d="M18 5l2 2"/><path d="M15 8l2 2"/>',
  search:
    '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
  sun:
    '<circle cx="12" cy="12" r="4"/>' +
    '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:
    '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  world:
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/>' +
    '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  brandLinkedin:
    '<rect x="3" y="3" width="18" height="18" rx="2"/>' +
    '<path d="M8 11v5"/><path d="M8 8v.01"/>' +
    '<path d="M12 16v-5"/><path d="M16 16v-3a2 2 0 0 0-4 0"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** A complete decorative svg. Icon-only controls carry their own aria-label. */
export function icon(name: IconName, size = 17): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ' +
    `stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/plugin/test/icons.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/shell/icons.ts packages/plugin/test/icons.test.ts
git commit -m "feat(plugin): add the vNext shell icon set"
```

---

### Task 4: Build the AI allowance view model

**Files:**
- Create: `packages/plugin/src/ui/viewModel/allowance.ts`
- Test: `packages/plugin/test/allowance.test.ts`

**Interfaces:**
- Consumes: `AllowanceState` from `viewModel/contracts`; `ProxyQuota` from `@spec-layer/extractor` (`{ tier: 'free' | 'pro'; used: number; limit: number | null; remaining: number | null; resetsAt: string; licenseReason?: 'invalid' | 'expired' | 'inactive' | 'unreachable' }`).
- Produces:
  - `allowanceState(quota: ProxyQuota | null, fetched: boolean): AllowanceState`
  - `type AllowanceTone = 'loading' | 'normal' | 'low' | 'exhausted' | 'pro' | 'unknown'`
  - `interface AllowanceCopy { tone: AllowanceTone; title: string; detail: string; showUpgrade: boolean; ariaLabel: string; fillPct: number }`
  - `allowanceCopy(state: AllowanceState): AllowanceCopy`
  - `LOW_REMAINING: number`

`LOW_REMAINING` is 5, matching the existing `lowThreshold` default in `proxy.ts:193`, so the header and the license page agree about what "low" means. Combined with a strict `<`, that reproduces the boundary the existing tests already pin in `proxy.test.ts`: **5 remaining is still normal, 4 is low**. Do not change this constant to make a test pass — the boundary tests below exist to catch exactly that.

Note the real free tier is `MONTHLY_LIMIT = 10` (or `BOOST_LIMIT = 20` during a boost), not 5. The prototype's "4 of 5 free uses left" was mock copy, so fixtures here use realistic limits.

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/allowance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ProxyQuota } from '@spec-layer/extractor';
import { allowanceState, allowanceCopy, LOW_REMAINING } from '../src/ui/viewModel/allowance';

const free = (over: Partial<ProxyQuota> = {}): ProxyQuota => ({
  tier: 'free', used: 1, limit: 5, remaining: 4, resetsAt: '2026-08-01T00:00:00Z', ...over,
});

describe('allowanceState', () => {
  it('is loading until the first fetch settles', () => {
    expect(allowanceState(null, false)).toEqual({ kind: 'loading' });
  });

  it('is unknown when a settled fetch produced nothing', () => {
    expect(allowanceState(null, true)).toEqual({
      kind: 'unknown', message: 'Plan status unavailable',
    });
  });

  it('reports pro without a count', () => {
    expect(allowanceState(free({ tier: 'pro' }), true)).toEqual({ kind: 'pro' });
  });

  it('reports the free remaining count', () => {
    expect(allowanceState(free(), true)).toEqual({
      kind: 'free', remaining: 4, limit: 5, resetsAt: '2026-08-01T00:00:00Z',
    });
  });

  it('derives remaining from used when the server omits it', () => {
    const state = allowanceState(free({ remaining: null, used: 3 }), true);
    expect(state).toMatchObject({ kind: 'free', remaining: 2 });
  });

  it('never reports a negative remaining', () => {
    const state = allowanceState(free({ remaining: null, used: 9, limit: 5 }), true);
    expect(state).toMatchObject({ kind: 'free', remaining: 0 });
  });
});

describe('allowanceCopy', () => {
  it('keeps a stable two-line shape while loading', () => {
    const copy = allowanceCopy({ kind: 'loading' });
    expect(copy.tone).toBe('loading');
    expect(copy.title).toBe('AI writing');
    expect(copy.detail).toBe('Checking your plan');
    expect(copy.showUpgrade).toBe(false);
  });

  it('counts remaining free uses and offers the upgrade', () => {
    const copy = allowanceCopy({
      kind: 'free', remaining: 8, limit: 10, resetsAt: '2026-08-01T00:00:00Z',
    });
    expect(copy.tone).toBe('normal');
    expect(copy.detail).toBe('8 of 10 free uses left');
    expect(copy.showUpgrade).toBe(true);
    expect(copy.fillPct).toBe(80);
  });

  it('warns when the remaining count is low', () => {
    const copy = allowanceCopy({
      kind: 'free', remaining: LOW_REMAINING - 1, limit: 20, resetsAt: '',
    });
    expect(copy.tone).toBe('low');
  });

  /**
   * These two pin the same boundary proxy.test.ts already pins for the license
   * page's meter. If the header and the license page ever disagree about what
   * "low" means, one of these fails.
   */
  it('treats 5 remaining as normal, like the license page does', () => {
    expect(allowanceCopy({ kind: 'free', remaining: 5, limit: 20, resetsAt: '' }).tone)
      .toBe('normal');
  });

  it('treats 4 remaining as low, like the license page does', () => {
    expect(allowanceCopy({ kind: 'free', remaining: 4, limit: 20, resetsAt: '' }).tone)
      .toBe('low');
  });

  it('explains exhaustion without blocking anything', () => {
    const copy = allowanceCopy({ kind: 'free', remaining: 0, limit: 5, resetsAt: '' });
    expect(copy.tone).toBe('exhausted');
    expect(copy.detail).toBe('No free uses left');
    expect(copy.showUpgrade).toBe(true);
    expect(copy.fillPct).toBe(0);
  });

  it('shows pro without a count or an upgrade', () => {
    const copy = allowanceCopy({ kind: 'pro' });
    expect(copy.tone).toBe('pro');
    expect(copy.detail).toBe('Unlimited uses');
    expect(copy.showUpgrade).toBe(false);
  });

  it('passes an unknown plan through without demoting it', () => {
    const copy = allowanceCopy({ kind: 'unknown', message: 'Plan status unavailable' });
    expect(copy.tone).toBe('unknown');
    expect(copy.detail).toBe('Plan status unavailable');
    expect(copy.showUpgrade).toBe(false);
  });

  it('gives every state a self-sufficient accessible name', () => {
    const states = [
      { kind: 'loading' },
      { kind: 'free', remaining: 4, limit: 5, resetsAt: '' },
      { kind: 'pro' },
      { kind: 'unknown', message: 'Plan status unavailable' },
    ] as const;
    for (const state of states) {
      const { ariaLabel } = allowanceCopy(state);
      expect(ariaLabel.startsWith('AI writing')).toBe(true);
      expect(ariaLabel).toContain('Open License');
    }
  });

  it('handles a zero limit without dividing by zero', () => {
    const copy = allowanceCopy({ kind: 'free', remaining: 0, limit: 0, resetsAt: '' });
    expect(copy.fillPct).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/allowance.test.ts`
Expected: FAIL — cannot resolve `../src/ui/viewModel/allowance`.

- [ ] **Step 3: Write the view model**

Create `packages/plugin/src/ui/viewModel/allowance.ts`:

```ts
/**
 * allowance.ts — the header's AI writing control, as a pure function.
 *
 * The header shows this on every screen, so it has to survive every quota
 * shape the proxy can return without changing height or lying about the plan.
 * Two states the server cannot distinguish for us are separated here by the
 * `fetched` flag: "we have not asked yet" (loading) and "we asked and got
 * nothing" (unknown). Reporting the second as the first would spin forever;
 * reporting it as free would demote a Pro user who is briefly offline.
 */

import type { ProxyQuota } from '@spec-layer/extractor';
import type { AllowanceState } from './contracts';
import { assertNever } from './contracts';

/** Matches the `lowThreshold` default in proxy.ts, so header and license agree. */
export const LOW_REMAINING = 5;

export function allowanceState(quota: ProxyQuota | null, fetched: boolean): AllowanceState {
  if (!fetched) return { kind: 'loading' };
  if (!quota) return { kind: 'unknown', message: 'Plan status unavailable' };
  if (quota.tier === 'pro') return { kind: 'pro' };

  const limit = quota.limit ?? 0;
  const remaining = quota.remaining ?? Math.max(0, limit - quota.used);
  return { kind: 'free', remaining: Math.max(0, remaining), limit, resetsAt: quota.resetsAt };
}

export type AllowanceTone = 'loading' | 'normal' | 'low' | 'exhausted' | 'pro' | 'unknown';

export interface AllowanceCopy {
  tone: AllowanceTone;
  title: string;
  detail: string;
  showUpgrade: boolean;
  ariaLabel: string;
  /** Progress-ring fill, 0..100. */
  fillPct: number;
}

const TITLE = 'AI writing';

export function allowanceCopy(state: AllowanceState): AllowanceCopy {
  switch (state.kind) {
    case 'loading':
      return {
        tone: 'loading', title: TITLE, detail: 'Checking your plan',
        showUpgrade: false, fillPct: 0,
        ariaLabel: 'AI writing: checking your plan. Open License.',
      };

    case 'pro':
      return {
        tone: 'pro', title: TITLE, detail: 'Unlimited uses',
        showUpgrade: false, fillPct: 100,
        ariaLabel: 'AI writing: Pro plan, unlimited uses. Open License.',
      };

    case 'unknown':
      return {
        tone: 'unknown', title: TITLE, detail: state.message,
        showUpgrade: false, fillPct: 0,
        ariaLabel: `AI writing: ${state.message}. Open License.`,
      };

    case 'free': {
      const { remaining, limit } = state;
      const fillPct = limit > 0 ? Math.max(0, Math.min(100, (remaining / limit) * 100)) : 0;
      if (remaining <= 0) {
        return {
          tone: 'exhausted', title: TITLE, detail: 'No free uses left',
          showUpgrade: true, fillPct: 0,
          ariaLabel: 'AI writing: no free uses left. Open License.',
        };
      }
      return {
        tone: remaining < LOW_REMAINING ? 'low' : 'normal',
        title: TITLE,
        detail: `${remaining} of ${limit} free uses left`,
        showUpgrade: true,
        fillPct,
        ariaLabel: `AI writing: ${remaining} of ${limit} free uses remaining. Open License.`,
      };
    }

    default:
      return assertNever(state, 'AllowanceState');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/plugin/test/allowance.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/viewModel/allowance.ts packages/plugin/test/allowance.test.ts
git commit -m "feat(plugin): add the AI writing allowance view model"
```

---

### Task 5: Build the navigation rail

**Files:**
- Create: `packages/plugin/src/ui/shell/sidebar.ts`
- Test: `packages/plugin/test/sidebar.test.ts`

**Interfaces:**
- Consumes: `navigation`, `NavigationItem`, `PluginView` from `viewModel/contracts`; `icon` from `shell/icons`.
- Produces:
  - `interface RailBlock { group: NavigationItem['group']; items: NavigationItem[] }`
  - `railBlocks(items: readonly NavigationItem[]): RailBlock[]`
  - `railIcon(id: PluginView): IconName`
  - `sidebarMarkup(active: PluginView, badges: Partial<Record<PluginView, number>>): string`

`railBlocks` is the tested part: it turns the flat contract into the three visual groups the rail separates. `sidebarMarkup` is thin string assembly, verified in the harness.

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/sidebar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { navigation } from '../src/ui/viewModel/contracts';
import { railBlocks, railIcon, sidebarMarkup } from '../src/ui/shell/sidebar';

describe('railBlocks', () => {
  it('splits the flat navigation into its three visual groups', () => {
    const blocks = railBlocks(navigation);
    expect(blocks.map((b) => b.group)).toEqual(['create', 'library', 'settings']);
    expect(blocks[0].items.map((i) => i.id)).toEqual(['component', 'foundations']);
    expect(blocks[1].items.map((i) => i.id)).toEqual(['library']);
    expect(blocks[2].items.map((i) => i.id)).toEqual(['settings', 'license']);
  });

  it('keeps every item, so nothing can be dropped by regrouping', () => {
    const kept = railBlocks(navigation).flatMap((b) => b.items);
    expect(kept).toHaveLength(navigation.length);
  });

  it('returns nothing for an empty list', () => {
    expect(railBlocks([])).toEqual([]);
  });
});

describe('railIcon', () => {
  it('gives Library a folder, not a database', () => {
    expect(railIcon('library')).toBe('folder');
  });

  it('maps every workflow to an icon', () => {
    for (const item of navigation) {
      expect(railIcon(item.id)).toBeTruthy();
    }
  });
});

describe('sidebarMarkup', () => {
  it('marks only the active item as current', () => {
    const html = sidebarMarkup('library', {});
    const current = html.match(/aria-current="page"/g) ?? [];
    expect(current).toHaveLength(1);
    expect(html).toContain('data-view="library" aria-current="page"');
  });

  it('gives every rail button an accessible name', () => {
    const html = sidebarMarkup('component', {});
    for (const item of navigation) {
      expect(html).toContain(`aria-label="${item.label}"`);
    }
  });

  it('renders a badge only when there is a count', () => {
    expect(sidebarMarkup('component', {})).not.toContain('sl-sidebar-badge');
    expect(sidebarMarkup('component', { library: 3 })).toContain('>3<');
  });

  it('separates the three groups', () => {
    const html = sidebarMarkup('component', {});
    const separators = html.match(/sl-sidebar-separator/g) ?? [];
    expect(separators).toHaveLength(2);
  });

  it('puts the utility links at the bottom, below the spacer', () => {
    const html = sidebarMarkup('component', {});
    expect(html.indexOf('sl-sidebar-spacer')).toBeLessThan(html.indexOf('Spec Layer website'));
    expect(html).toContain('Spec Layer on LinkedIn');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/sidebar.test.ts`
Expected: FAIL — cannot resolve `../src/ui/shell/sidebar`.

- [ ] **Step 3: Write the sidebar**

Create `packages/plugin/src/ui/shell/sidebar.ts`:

```ts
/**
 * sidebar.ts — the 52px navigation rail.
 *
 * The rail is five workflow destinations in three groups, then a spacer, then
 * the utility links. Selection is a background fill plus a blue icon: no left
 * marker, no outline. Labels are always present as accessible names even
 * though only the tooltip shows them.
 */

import { navigation, type NavigationItem, type PluginView } from '../viewModel/contracts';
import { icon, type IconName } from './icons';

export interface RailBlock {
  group: NavigationItem['group'];
  items: NavigationItem[];
}

/** Collapse the flat contract into consecutive runs of the same group. */
export function railBlocks(items: readonly NavigationItem[]): RailBlock[] {
  const blocks: RailBlock[] = [];
  for (const item of items) {
    const last = blocks[blocks.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else blocks.push({ group: item.group, items: [item] });
  }
  return blocks;
}

const ICONS: Record<PluginView, IconName> = {
  component: 'fileDescription',
  foundations: 'layoutGrid',
  library: 'folder',
  settings: 'settings',
  license: 'key',
};

export function railIcon(id: PluginView): IconName {
  return ICONS[id];
}

const SITE_LABEL = 'Spec Layer website';
const LINKEDIN_LABEL = 'Spec Layer on LinkedIn';

function railButton(item: NavigationItem, active: PluginView, badge: number | undefined): string {
  const current = item.id === active ? ' aria-current="page"' : '';
  const count = badge && badge > 0
    ? `<span class="sl-sidebar-badge" aria-hidden="true">${badge}</span>`
    : '';
  return (
    '<div class="sl-sidebar-item" data-tooltip-trigger>' +
    `<button class="sl-icon-button" type="button" data-view="${item.id}"${current} ` +
    `aria-label="${item.label}">${icon(railIcon(item.id))}${count}</button>` +
    `<span class="sl-tooltip" role="tooltip">${item.label}</span>` +
    '</div>'
  );
}

export function sidebarMarkup(
  active: PluginView,
  badges: Partial<Record<PluginView, number>>,
): string {
  const groups = railBlocks(navigation)
    .map((block) =>
      '<div class="sl-sidebar-group">' +
      block.items.map((item) => railButton(item, active, badges[item.id])).join('') +
      '</div>')
    .join('<span class="sl-sidebar-separator" aria-hidden="true"></span>');

  return (
    '<nav class="sl-sidebar" aria-label="Workflows">' +
    groups +
    '<div class="sl-sidebar-spacer"></div>' +
    '<div class="sl-sidebar-group">' +
    `<a class="sl-icon-button" id="rail-site" href="#" target="_blank" rel="noopener" ` +
    `aria-label="${SITE_LABEL}">${icon('world')}</a>` +
    `<a class="sl-icon-button" id="rail-linkedin" href="#" target="_blank" rel="noopener" ` +
    `aria-label="${LINKEDIN_LABEL}">${icon('brandLinkedin')}</a>` +
    '</div>' +
    '</nav>'
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/plugin/test/sidebar.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/shell/sidebar.ts packages/plugin/test/sidebar.test.ts
git commit -m "feat(plugin): add the vNext navigation rail"
```

---

### Task 6: Build the utility header

**Files:**
- Create: `packages/plugin/src/ui/shell/header.ts`
- Test: `packages/plugin/test/header.test.ts`

**Interfaces:**
- Consumes: `AllowanceState` from `viewModel/contracts`; `allowanceCopy` from `viewModel/allowance`; `icon` from `shell/icons`.
- Produces:
  - `RING_CIRCUMFERENCE: number`
  - `ringOffset(fillPct: number): number`
  - `headerMarkup(): string` — static skeleton, rendered once
  - `renderAllowance(root: HTMLElement, state: AllowanceState): void` — repaints in place
  - `HEADER_IDS: { search: string; allowance: string; theme: string }`

The header renders once and is only ever repainted, never rebuilt: that is what keeps its height stable across the loading, free, low, exhausted, Pro, and unknown states.

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/header.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RING_CIRCUMFERENCE, ringOffset, headerMarkup, HEADER_IDS } from '../src/ui/shell/header';

describe('ringOffset', () => {
  it('is a full offset at zero, so an empty ring reads as empty', () => {
    expect(ringOffset(0)).toBeCloseTo(RING_CIRCUMFERENCE, 3);
  });

  it('is no offset at full', () => {
    expect(ringOffset(100)).toBeCloseTo(0, 3);
  });

  it('is half the circumference at half', () => {
    expect(ringOffset(50)).toBeCloseTo(RING_CIRCUMFERENCE / 2, 3);
  });

  it('clamps values outside 0..100 rather than drawing past the ring', () => {
    expect(ringOffset(-20)).toBeCloseTo(RING_CIRCUMFERENCE, 3);
    expect(ringOffset(140)).toBeCloseTo(0, 3);
  });

  it('matches an r=10 circle, the size component-markup.md specifies', () => {
    expect(RING_CIRCUMFERENCE).toBeCloseTo(62.832, 2);
  });
});

describe('headerMarkup', () => {
  it('renders the three utilities with stable ids', () => {
    const html = headerMarkup();
    expect(html).toContain(`id="${HEADER_IDS.search}"`);
    expect(html).toContain(`id="${HEADER_IDS.allowance}"`);
    expect(html).toContain(`id="${HEADER_IDS.theme}"`);
  });

  it('names every icon-only control', () => {
    const html = headerMarkup();
    expect(html).toContain('aria-label="Open quick search"');
    expect(html).toContain('aria-label="Switch to light theme"');
  });

  it('does not repeat the product name, which Figma already shows', () => {
    expect(headerMarkup()).not.toContain('Spec Layer');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/header.test.ts`
Expected: FAIL — cannot resolve `../src/ui/shell/header`.

- [ ] **Step 3: Write the header**

Create `packages/plugin/src/ui/shell/header.ts`:

```ts
/**
 * header.ts — the 48px utility header.
 *
 * Figma draws the plugin name and icon in its own title bar, so this holds
 * only high-value utilities: quick search, the AI writing allowance, and the
 * theme control. The search control keeps the same position and size on every
 * screen.
 *
 * The allowance is rendered once and repainted in place. Rebuilding it would
 * let the header change height between the loading and loaded states, which
 * the direction explicitly forbids.
 */

import type { AllowanceState } from '../viewModel/contracts';
import { allowanceCopy } from '../viewModel/allowance';
import { icon } from './icons';

export const HEADER_IDS = {
  search: 'sl-header-search',
  allowance: 'sl-header-allowance',
  theme: 'sl-header-theme',
} as const;

/** An r=10 progress ring, per design-system/component-markup.md. */
export const RING_CIRCUMFERENCE = 2 * Math.PI * 10;

export function ringOffset(fillPct: number): number {
  const clamped = Math.max(0, Math.min(100, fillPct));
  return RING_CIRCUMFERENCE * (1 - clamped / 100);
}

export function headerMarkup(): string {
  return (
    '<header class="sl-utility-header">' +

    `<button class="sl-header-search" id="${HEADER_IDS.search}" type="button" ` +
    'aria-label="Open quick search">' +
    `${icon('search', 15)}<span>Search</span>` +
    '<kbd class="sl-shortcut" aria-hidden="true">&#8984;K</kbd>' +
    '</button>' +

    `<button class="sl-ai-allowance" id="${HEADER_IDS.allowance}" type="button" ` +
    'data-state="loading" aria-label="AI writing: checking your plan. Open License.">' +
    '<svg class="sl-allowance-ring" viewBox="0 0 26 26" aria-hidden="true">' +
    '<circle data-track cx="13" cy="13" r="10"></circle>' +
    `<circle data-value cx="13" cy="13" r="10" stroke-dasharray="${RING_CIRCUMFERENCE}" ` +
    `stroke-dashoffset="${RING_CIRCUMFERENCE}"></circle>` +
    '</svg>' +
    '<span class="sl-allowance-copy"><strong>AI writing</strong>' +
    '<small>Checking your plan</small></span>' +
    '<span class="sl-allowance-action" hidden>Upgrade</span>' +
    '</button>' +

    `<button class="sl-icon-button" id="${HEADER_IDS.theme}" type="button" ` +
    `aria-label="Switch to light theme">${icon('moon', 16)}</button>` +

    '</header>'
  );
}

/**
 * Repaint the allowance control in place. `root` is the header element; the
 * control itself is looked up by id so callers cannot pass the wrong node.
 */
export function renderAllowance(root: HTMLElement, state: AllowanceState): void {
  const button = root.querySelector<HTMLButtonElement>(`#${HEADER_IDS.allowance}`);
  if (!button) return;

  const copy = allowanceCopy(state);
  button.dataset.state = copy.tone;
  button.setAttribute('aria-label', copy.ariaLabel);

  const title = button.querySelector('strong');
  const detail = button.querySelector('small');
  if (title) title.textContent = copy.title;
  if (detail) detail.textContent = copy.detail;

  const ring = button.querySelector<SVGCircleElement>('[data-value]');
  if (ring) ring.setAttribute('stroke-dashoffset', String(ringOffset(copy.fillPct)));

  const action = button.querySelector<HTMLElement>('.sl-allowance-action');
  if (action) action.hidden = !copy.showUpgrade;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/plugin/test/header.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/shell/header.ts packages/plugin/test/header.test.ts
git commit -m "feat(plugin): add the vNext utility header"
```

---

### Task 7: Assemble the shell and put it behind the flag

**Files:**
- Create: `packages/plugin/src/ui/shell/shell.ts`
- Modify: `packages/plugin/build.mjs:16`
- Modify: `packages/plugin/src/ui/ui.ts:70`
- Modify: `packages/plugin/src/main.ts:203`
- Create: `packages/plugin/src/ui/globals.d.ts`
- Test: `packages/plugin/test/shell.test.ts`

**Interfaces:**
- Consumes: `sidebarMarkup` from `shell/sidebar`; `headerMarkup`, `renderAllowance`, `HEADER_IDS` from `shell/header`; `PluginView` from `viewModel/contracts`; `applyThemeMode`, `detectFigmaTheme`, `toggleThemeMode` from `ui/theme`.
- Produces:
  - `interface ShellRefs { root; header; sidebar; screen; pageHeader; scroll; footer: HTMLElement; themeButton; searchButton; allowanceButton: HTMLButtonElement }`
  - `shellMarkup(active: PluginView): string`
  - `mountShell(active?: PluginView): ShellRefs`
  - `setActiveView(refs: ShellRefs, view: PluginView): void`
  - `wireShellTheme(refs: ShellRefs): void`
  - `declare const __UI_VNEXT__: boolean` (global)

Screen modules in later plans render into `ShellRefs.screen` and call `setActiveView`.

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/shell.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shellMarkup } from '../src/ui/shell/shell';

describe('shellMarkup', () => {
  it('lays out rail, header, and screen inside one shell', () => {
    const html = shellMarkup('component');
    expect(html).toContain('sl-plugin-shell');
    expect(html).toContain('sl-sidebar');
    expect(html).toContain('sl-utility-header');
    expect(html).toContain('sl-screen');
  });

  /**
   * .sl-plugin-shell is a grid that places the header at `1 / -1`, the rail at
   * column 1, and the screen at column 2. All three have to be direct
   * children: any wrapper element silently breaks the whole layout.
   */
  it('keeps the three regions as direct children of the grid', () => {
    const html = shellMarkup('component');
    expect(html).toContain('<div class="sl-plugin-shell"><header');
    expect(html).not.toContain('sl-main');
  });

  it('reads header, then rail, then screen', () => {
    const html = shellMarkup('component');
    expect(html.indexOf('sl-utility-header')).toBeLessThan(html.indexOf('sl-sidebar'));
    expect(html.indexOf('sl-sidebar')).toBeLessThan(html.indexOf('sl-screen"'));
  });

  it('marks the requested view as current', () => {
    expect(shellMarkup('settings')).toContain('data-view="settings" aria-current="page"');
  });

  it('gives the screen all three of its rows', () => {
    const html = shellMarkup('component');
    expect(html).toContain('sl-page-header');
    expect(html).toContain('sl-screen-scroll');
    expect(html).toContain('sl-screen-footer');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/shell.test.ts`
Expected: FAIL — cannot resolve `../src/ui/shell/shell`.

- [ ] **Step 3: Write the shell**

Create `packages/plugin/src/ui/shell/shell.ts`:

```ts
/**
 * shell.ts — the vNext plugin frame: rail, header, screen.
 *
 * The shell owns chrome and nothing else. Screens render into `refs.screen`
 * and never touch the rail or header directly; they change the active view
 * through setActiveView so selection state has exactly one owner.
 */

import type { PluginView } from '../viewModel/contracts';
import { applyThemeMode, detectFigmaTheme, toggleThemeMode, type ThemeMode } from '../theme';
import { sidebarMarkup } from './sidebar';
import { headerMarkup, HEADER_IDS } from './header';

export interface ShellRefs {
  root: HTMLElement;
  header: HTMLElement;
  sidebar: HTMLElement;
  screen: HTMLElement;
  /** Screen title row. Screens fill it and unhide it. */
  pageHeader: HTMLElement;
  /** The only scrolling region. Screen content goes here. */
  scroll: HTMLElement;
  /** Sticky action row. Hidden until a screen has a primary action. */
  footer: HTMLElement;
  themeButton: HTMLButtonElement;
  searchButton: HTMLButtonElement;
  allowanceButton: HTMLButtonElement;
}

/**
 * .sl-plugin-shell is a two-column, two-row grid and each region is placed
 * explicitly, so the header, the rail, and the screen must all be direct
 * children. Wrapping any of them breaks the layout silently.
 */
export function shellMarkup(active: PluginView): string {
  return (
    '<div class="sl-plugin-shell">' +
    headerMarkup() +
    sidebarMarkup(active, {}) +
    '<main class="sl-screen" id="sl-screen">' +
    '<div class="sl-page-header" id="sl-page-header" hidden></div>' +
    '<div class="sl-screen-scroll" id="sl-screen-scroll"></div>' +
    '<div class="sl-screen-footer" id="sl-screen-footer" hidden></div>' +
    '</main>' +
    '</div>'
  );
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Shell is missing #${id}`);
  return el as T;
}

export function mountShell(active: PluginView = 'component'): ShellRefs {
  document.body.innerHTML = shellMarkup(active);
  const root = document.querySelector<HTMLElement>('.sl-plugin-shell');
  const header = document.querySelector<HTMLElement>('.sl-utility-header');
  const sidebar = document.querySelector<HTMLElement>('.sl-sidebar');
  if (!root || !header || !sidebar) throw new Error('Shell failed to mount');

  return {
    root,
    header,
    sidebar,
    screen: byId<HTMLElement>('sl-screen'),
    pageHeader: byId<HTMLElement>('sl-page-header'),
    scroll: byId<HTMLElement>('sl-screen-scroll'),
    footer: byId<HTMLElement>('sl-screen-footer'),
    themeButton: byId<HTMLButtonElement>(HEADER_IDS.theme),
    searchButton: byId<HTMLButtonElement>(HEADER_IDS.search),
    allowanceButton: byId<HTMLButtonElement>(HEADER_IDS.allowance),
  };
}

/** Move the rail's selection. The rail is the only place this state lives. */
export function setActiveView(refs: ShellRefs, view: PluginView): void {
  for (const button of refs.sidebar.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

/**
 * Wire the header's theme control. Detection and application stay in theme.ts;
 * the shell only owns the button. applyThemeMode sets `title`, so the
 * accessible name is copied from it rather than left to go stale.
 */
export function wireShellTheme(refs: ShellRefs): void {
  let mode: ThemeMode = detectFigmaTheme();
  const paint = (): void => {
    applyThemeMode(refs.themeButton, mode);
    refs.themeButton.setAttribute('aria-label', refs.themeButton.title);
  };
  paint();
  refs.themeButton.addEventListener('click', () => {
    mode = toggleThemeMode(mode);
    paint();
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/plugin/test/shell.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Declare the build-time flag**

Create `packages/plugin/src/ui/globals.d.ts`:

```ts
/**
 * Build-time constants injected by esbuild's `define` (see build.mjs).
 */

/** Selects the vNext shell over the legacy tabbed UI. Set by UI_VNEXT=1. */
declare const __UI_VNEXT__: boolean;
```

- [ ] **Step 6: Define the flag in the build**

In `packages/plugin/build.mjs`, replace line 16:

```js
const define = { __PLUGIN_VERSION__: JSON.stringify(pkg.version) };
```

with:

```js
// The vNext UI is opt-in until every screen has landed. `UI_VNEXT=1 node
// build.mjs` produces the new shell; a plain build produces the legacy tabbed
// UI, so both can be loaded in Figma and compared on the same file.
const uiVNext = process.env.UI_VNEXT === '1';
const define = {
  __PLUGIN_VERSION__: JSON.stringify(pkg.version),
  __UI_VNEXT__: JSON.stringify(uiVNext),
};
```

- [ ] **Step 7: Branch at boot**

In `packages/plugin/src/ui/ui.ts`, add to the import block:

```ts
import { mountShell, wireShellTheme } from './shell/shell';
```

Then replace line 70:

```ts
const refs = mount();
```

with:

```ts
// One branch, at the top: the vNext shell and the legacy tabbed UI never run
// together. Everything below this line is legacy wiring and is deleted with
// the legacy path once every screen has migrated.
if (__UI_VNEXT__) {
  wireShellTheme(mountShell());
}
const refs = mount();
```

Note for the next plan: this deliberately still mounts the legacy DOM underneath so the existing wiring keeps type-checking while screens are migrated one at a time. The screen plans replace `mount()` with the per-screen renderers and delete this scaffold.

- [ ] **Step 8: Set the frame size**

In `packages/plugin/src/main.ts`, replace line 203:

```ts
figma.showUI(__html__, { width: 480, height: 640, themeColors: true });
```

with:

```ts
figma.showUI(__html__, { width: 480, height: 680, themeColors: true });
```

- [ ] **Step 9: Verify both builds work**

```bash
cd packages/plugin && node build.mjs && grep -c 'sl-plugin-shell' dist/ui.html
```
Expected: a count of at least 1 — the CSS is embedded regardless of the flag.

```bash
cd packages/plugin && UI_VNEXT=1 node build.mjs && grep -c 'sl-utility-header' dist/ui.html
```
Expected: a count higher than the previous one, because the shell markup is now in the bundle too.

- [ ] **Step 10: Run the full check**

Run: `npm test -- packages/plugin/test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add packages/plugin/src/ui/shell/shell.ts packages/plugin/src/ui/globals.d.ts \
        packages/plugin/build.mjs packages/plugin/src/ui/ui.ts packages/plugin/src/main.ts \
        packages/plugin/test/shell.test.ts
git commit -m "feat(plugin): assemble the vNext shell behind __UI_VNEXT__"
```

---

### Task 8: Build the dev harness

**Files:**
- Create: `packages/plugin/src/ui/harness.ts`
- Modify: `packages/plugin/build.mjs`
- Test: `packages/plugin/test/uiHtml.test.ts` (extend)

**Interfaces:**
- Consumes: `mountShell`, `setActiveView` from `shell/shell`; `renderAllowance` from `shell/header`; `AllowanceState` from `viewModel/contracts`; `applyThemeMode` from `ui/theme`.
- Produces: `dist/ui-harness.html`, emitted only when `UI_HARNESS=1`. Never referenced by `manifest.json`.

This is the control for the risk that the `sl-` CSS has never rendered these screens: it opens any state at 480 x 680 in a browser for comparison against `docs/plugin-ui-vnext/prototype/*.png`.

- [ ] **Step 1: Write the failing test**

Append to `packages/plugin/test/uiHtml.test.ts`:

```ts
import { existsSync, rmSync } from 'node:fs';

describe('dist/ui-harness.html', () => {
  const harness = fileURLToPath(new URL('../dist/ui-harness.html', import.meta.url));

  it('is not emitted by a normal build, so it can never ship as the plugin UI', () => {
    rmSync(harness, { force: true });
    execFileSync('node', ['build.mjs'], { cwd: pluginDir, stdio: 'pipe' });
    expect(existsSync(harness)).toBe(false);
  });

  it('is emitted when explicitly asked for', () => {
    execFileSync('node', ['build.mjs'], {
      cwd: pluginDir, stdio: 'pipe', env: { ...process.env, UI_HARNESS: '1' },
    });
    expect(existsSync(harness)).toBe(true);
  });

  it('is never referenced by the manifest', () => {
    const manifest = readFileSync(
      fileURLToPath(new URL('../manifest.json', import.meta.url)), 'utf-8');
    expect(manifest).not.toContain('ui-harness');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/plugin/test/uiHtml.test.ts`
Expected: FAIL on "is emitted when explicitly asked for" — the file is never produced.

- [ ] **Step 3: Write the harness entry point**

Create `packages/plugin/src/ui/harness.ts`:

```ts
/**
 * harness.ts — development entry point. Never shipped.
 *
 * Mounts the vNext shell outside Figma and drives it from the URL so any
 * screen in any state can be opened at 480 x 680 and compared against the
 * archived prototype screenshots in docs/plugin-ui-vnext/prototype/.
 *
 *   ui-harness.html?view=library&allowance=exhausted&theme=light
 *
 * It feeds the same shapes the real UI receives. It must never gain behavior
 * of its own: anything it can do that the plugin cannot is a lie about the
 * thing we are verifying.
 */

import type { AllowanceState, PluginView } from './viewModel/contracts';
import { mountShell, setActiveView } from './shell/shell';
import { renderAllowance } from './shell/header';
import { applyThemeMode, type ThemeMode } from './theme';

/**
 * Each fixture must actually render the tone it is named after. `LOW_REMAINING`
 * is 5, so a "normal" fixture needs more than 5 remaining: 4 of 5 would render
 * amber and quietly invalidate every visual check made against it. Limits track
 * the real free tier, `MONTHLY_LIMIT = 10`.
 */
const ALLOWANCES: Record<string, AllowanceState> = {
  loading: { kind: 'loading' },
  normal: { kind: 'free', remaining: 8, limit: 10, resetsAt: '2026-08-01T00:00:00Z' },
  low: { kind: 'free', remaining: 4, limit: 10, resetsAt: '2026-08-01T00:00:00Z' },
  exhausted: { kind: 'free', remaining: 0, limit: 10, resetsAt: '2026-08-01T00:00:00Z' },
  pro: { kind: 'pro' },
  unknown: { kind: 'unknown', message: 'Plan status unavailable' },
};

const VIEWS: PluginView[] = ['component', 'foundations', 'library', 'settings', 'license'];

function param(name: string, fallback: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

const view = param('view', 'component') as PluginView;
const refs = mountShell(VIEWS.includes(view) ? view : 'component');

const theme = param('theme', 'dark') as ThemeMode;
applyThemeMode(refs.themeButton, theme === 'light' ? 'light' : 'dark');
// applyThemeMode sets title but not aria-label. wireShellTheme copies one onto
// the other in the real shell, and the harness has to do the same: showing an
// accessible name the real plugin would never show is its own kind of lie.
refs.themeButton.setAttribute('aria-label', refs.themeButton.title);

setActiveView(refs, VIEWS.includes(view) ? view : 'component');
renderAllowance(refs.header, ALLOWANCES[param('allowance', 'normal')] ?? ALLOWANCES.normal);
```

- [ ] **Step 4: Emit the harness from the build**

In `packages/plugin/build.mjs`, append at the end of the file:

```js
// ---------------------------------------------------------------------------
// Build 3 (opt-in): dev harness → dist/ui-harness.html
//   Renders the vNext shell outside Figma for visual comparison against the
//   archived prototype screenshots. Emitted only under UI_HARNESS=1 and never
//   referenced by manifest.json, so it cannot ship as the plugin's UI.
// ---------------------------------------------------------------------------
if (process.env.UI_HARNESS === '1') {
  const harness = await esbuild.build({
    entryPoints: [resolve(__dirname, 'src/ui/harness.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2017',
    write: false,
    define: { ...define, __UI_VNEXT__: 'true' },
  });
  writeFileSync(resolve(dist, 'ui-harness.html'), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Spec Layer UI harness</title>
<style>${designSystemCss}</style>
<style>html,body{margin:0;width:480px;height:680px;overflow:hidden}</style>
</head>
<body data-theme="dark">
<script>${harness.outputFiles[0].text}</script>
</body>
</html>`, 'utf-8');
  console.log('Built dist/ui-harness.html (dev only)');
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/plugin/test/uiHtml.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5a: Exclude the harness from coverage**

`harness.ts` is now the third literal esbuild entry point, alongside `main.ts`
and `ui.ts`. `vitest.config.ts` already excludes those two by that exact
rationale, and CI gates on `npm run test:coverage`.

In `vitest.config.ts`, in `coverage.exclude`, directly below the
`'packages/plugin/src/ui/ui.ts',` line, add:

```js
        'packages/plugin/src/ui/harness.ts',
```

This applies the existing documented rule to a new entry point. Do not touch
the thresholds: they are a ratchet and only move up.

- [ ] **Step 6: Verify the shell renders**

```bash
cd packages/plugin && UI_HARNESS=1 UI_VNEXT=1 node build.mjs
```

Open `packages/plugin/dist/ui-harness.html` in a browser and check each of these against the matching archived screenshot:

- `?view=component&theme=dark` against `docs/plugin-ui-vnext/prototype/component-final.png`
- `?view=library&theme=dark` against `docs/plugin-ui-vnext/prototype/library-final.png`
- `?view=library&theme=light` against `docs/plugin-ui-vnext/prototype/light-theme-library-final-v2.png`
- `?allowance=exhausted` and `?allowance=pro` against `docs/plugin-ui-vnext/prototype/quota-states-final.png`

Only chrome exists at this point, so compare the rail, header, allowance control, and both themes. The screen area is intentionally empty. Record any drift in the PR description rather than fixing it here — screen-level fidelity belongs to the screen plans.

- [ ] **Step 7: Run the full check, including coverage**

Run: `npm run check`
Expected: lint, typecheck, tests, and both builds pass.

Run: `npm run test:coverage`
Expected: PASS, with every threshold still met (statements 45, branches 40,
functions 50, lines 45). CI runs this and `npm run check` does not, so it is
checked explicitly here.

If a threshold fails, report it rather than lowering it. The fix is more tests
on the pure functions, never a smaller number in the config.

- [ ] **Step 8: Commit**

```bash
git add packages/plugin/src/ui/harness.ts packages/plugin/build.mjs packages/plugin/test/uiHtml.test.ts
git commit -m "feat(plugin): add the vNext dev harness"
```

---

## What this plan does not cover

**The allowance control is rendered but not yet fed.** `renderAllowance` exists
and the harness drives it through all six states, but nothing calls it from
`ui.ts` with live data: that means touching the `refreshQuota` path, which
belongs with the first screen. Under the flag the header therefore sits in its
loading state. This is deliberate, and it is the first thing the component
screen plan wires up.

Also out of scope: the five screens (spec PRs 3-6), the command palette and
accessibility pass (PR 7), and the legacy deletion (PR 8). Each gets its own
plan, written against the interfaces above once they exist:

- `ShellRefs`, `mountShell`, `setActiveView` from `shell/shell`
- `renderAllowance`, `HEADER_IDS` from `shell/header`
- The contracts and `assertNever` from `viewModel/contracts`

Ship order stays as the spec sets it: screens land behind the flag, PR 7 flips the default, PR 8 deletes the legacy path.
