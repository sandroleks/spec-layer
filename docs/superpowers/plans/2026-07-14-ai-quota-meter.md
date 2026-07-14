# AI Quota Meter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat grey "14/20 AI generations left this month" line with a visual meter (bar + count + always-present Upgrade link) that owns every state, and restyle the footer upsell to match.

**Architecture:** A single pure function `quotaMeterModel()` in `proxy.ts` maps a `ProxyQuota` + AI-enabled flag to a view model (state, bar width, count text, link text). `renderQuota()` in `render.ts` applies that model to a small DOM block added in `dom.ts`. No proxy/server changes — everything derives from the existing quota fields.

**Tech Stack:** TypeScript, Vitest, esbuild. Figma plugin UI is a hand-authored DOM string + CSS in `dom.ts`, wired in `ui.ts`, rendered in `render.ts`.

## Global Constraints

- **Voice:** plain, honest, peer tone. Never use em dashes in any UI copy. (docs/plugin-voice-and-copy.md)
- **No server changes:** build only from existing `ProxyQuota` fields (`tier`, `used`, `limit`, `remaining`, `resetsAt`). No proxy edits.
- **Low threshold:** amber when `remaining > 0 && remaining < 5`.
- **Theme:** style only through Figma CSS variables (`--figma-color-*`), including `--figma-color-text-warning` / `--figma-color-bg-warning` for the amber cue, so both light and dark themes stay correct.
- **Node:** >= 20.9.0. Tests via `npm test` (Vitest). Typecheck via `npm run typecheck`. Plugin bundle via `npm run build:plugin`.

## File Structure

- `packages/plugin/src/ui/proxy.ts` — add `QuotaMeterState`, `QuotaMeterModel`, `quotaMeterModel()`, `formatResetDate()`; remove `quotaMeterText()` (Task 2).
- `packages/plugin/test/proxy.test.ts` — add tests for the new functions; remove the old `quotaMeterText` tests (Task 2).
- `packages/plugin/src/ui/dom.ts` — meter markup, CSS, `Refs` fields, `byId` mappings; footer upsell markup + CSS.
- `packages/plugin/src/ui/render.ts` — rewrite `renderQuota()`.
- `packages/plugin/src/ui/ui.ts` — wire the Upgrade button to checkout.

---

### Task 1: Quota presentation model (`proxy.ts`)

**Files:**
- Modify: `packages/plugin/src/ui/proxy.ts` (add near the existing `quotaMeterText` at line 106)
- Test: `packages/plugin/test/proxy.test.ts`

**Interfaces:**
- Consumes: `ProxyQuota` from `@spec-layer/extractor` (`{ tier, used, limit, remaining, resetsAt }`), and the module-level `MONTHS` array already in `proxy.ts`.
- Produces:
  - `type QuotaMeterState = 'hidden' | 'pro' | 'ok' | 'low' | 'empty'`
  - `interface QuotaMeterModel { state: QuotaMeterState; fillPct: number; countText: string; linkText: string }`
  - `function quotaMeterModel(q: ProxyQuota | null, aiEnabled: boolean, lowThreshold?: number): QuotaMeterModel`
  - `function formatResetDate(resetsAt: string | undefined): string`

- [ ] **Step 1: Write the failing tests**

Add to `packages/plugin/test/proxy.test.ts`. First extend the import from `../src/ui/proxy` to include `quotaMeterModel, formatResetDate` (keep everything already imported). Then append:

```ts
describe('formatResetDate', () => {
  it('formats an ISO date as "Mon D" in UTC', () => {
    expect(formatResetDate('2026-08-01T00:00:00.000Z')).toBe('Aug 1');
    expect(formatResetDate('2026-12-25T00:00:00.000Z')).toBe('Dec 25');
  });
  it('returns empty for missing or unparseable input', () => {
    expect(formatResetDate('')).toBe('');
    expect(formatResetDate(undefined)).toBe('');
    expect(formatResetDate('not-a-date')).toBe('');
  });
});

describe('quotaMeterModel', () => {
  const free = (remaining: number, limit = 20): ProxyQuota =>
    ({ tier: 'free', used: limit - remaining, limit, remaining, resetsAt: '2026-08-01T00:00:00.000Z' });

  it('hidden when AI is off', () => {
    expect(quotaMeterModel(free(17), false).state).toBe('hidden');
  });
  it('hidden when quota is unknown (offline)', () => {
    expect(quotaMeterModel(null, true).state).toBe('hidden');
  });
  it('pro shows unlimited, no bar, no link', () => {
    const m = quotaMeterModel({ tier: 'pro', used: 5, limit: null, remaining: null, resetsAt: '' }, true);
    expect(m).toEqual({ state: 'pro', fillPct: 0, countText: 'Unlimited generations · Pro', linkText: '' });
  });
  it('ok state above the low threshold', () => {
    const m = quotaMeterModel(free(17), true);
    expect(m.state).toBe('ok');
    expect(m.fillPct).toBe(85);
    expect(m.countText).toBe('17 of 20 left this month');
    expect(m.linkText).toBe('Upgrade');
  });
  it('boundary: 5 remaining is still ok', () => {
    expect(quotaMeterModel(free(5), true).state).toBe('ok');
  });
  it('boundary: 4 remaining is low', () => {
    const m = quotaMeterModel(free(4), true);
    expect(m.state).toBe('low');
    expect(m.countText).toBe('4 of 20 left this month');
    expect(m.linkText).toBe('Upgrade');
  });
  it('empty at zero remaining names the reset date and offers unlimited', () => {
    const m = quotaMeterModel(free(0), true);
    expect(m.state).toBe('empty');
    expect(m.fillPct).toBe(100);
    expect(m.countText).toBe('0 left · resets Aug 1');
    expect(m.linkText).toBe('Get unlimited');
  });
  it('falls back to used/limit when remaining is null', () => {
    const m = quotaMeterModel({ tier: 'free', used: 18, limit: 20, remaining: null, resetsAt: '2026-08-01T00:00:00.000Z' }, true);
    expect(m.state).toBe('low');
    expect(m.countText).toBe('2 of 20 left this month');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/plugin/test/proxy.test.ts`
Expected: FAIL — `quotaMeterModel is not a function` / `formatResetDate is not a function` (import errors).

- [ ] **Step 3: Implement the model in `proxy.ts`**

Insert directly above the existing `quotaMeterText` function (line 106). Leave `quotaMeterText` in place for now — Task 2 removes it once `render.ts` stops importing it.

```ts
export type QuotaMeterState = 'hidden' | 'pro' | 'ok' | 'low' | 'empty';

export interface QuotaMeterModel {
  state: QuotaMeterState;
  fillPct: number;   // 0..100 bar width
  countText: string; // "" when hidden
  linkText: string;  // "" when no link (pro / hidden)
}

/** ISO timestamp -> "Aug 1" (UTC). Empty for missing/unparseable input. */
export function formatResetDate(resetsAt: string | undefined): string {
  if (!resetsAt) return '';
  const d = new Date(resetsAt);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`;
}

/**
 * View model for the AI-card quota meter. Pure: all branching lives here so
 * render.ts just applies the result. Hidden when AI is off or the quota is
 * unknown (offline). Amber ("low") when remaining < lowThreshold.
 */
export function quotaMeterModel(
  q: ProxyQuota | null,
  aiEnabled: boolean,
  lowThreshold = 5,
): QuotaMeterModel {
  if (!aiEnabled || !q) return { state: 'hidden', fillPct: 0, countText: '', linkText: '' };
  if (q.tier === 'pro') {
    return { state: 'pro', fillPct: 0, countText: 'Unlimited generations · Pro', linkText: '' };
  }
  const limit = q.limit ?? 0;
  const remaining = q.remaining ?? Math.max(0, limit - q.used);
  const fillPct = limit > 0 ? Math.max(0, Math.min(100, (remaining / limit) * 100)) : 0;
  if (remaining <= 0) {
    const reset = formatResetDate(q.resetsAt);
    return {
      state: 'empty',
      fillPct: 100,
      countText: reset ? `0 left · resets ${reset}` : '0 left',
      linkText: 'Get unlimited',
    };
  }
  const state: QuotaMeterState = remaining < lowThreshold ? 'low' : 'ok';
  return { state, fillPct, countText: `${remaining} of ${limit} left this month`, linkText: 'Upgrade' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/plugin/test/proxy.test.ts`
Expected: PASS (new suites green; the existing `quotaMeterText` suite still green).

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/proxy.ts packages/plugin/test/proxy.test.ts
git commit -m "feat(plugin): quota meter presentation model"
```

---

### Task 2: Wire the meter into the AI card (`dom.ts`, `render.ts`, `ui.ts`, `proxy.ts`)

**Files:**
- Modify: `packages/plugin/src/ui/dom.ts` (markup at line 775; CSS after the `.switch` rules ending at line 496; `Refs` interface at line 998; `byId` block at line 1214)
- Modify: `packages/plugin/src/ui/render.ts` (import at line 17; `renderQuota` at lines 51-56)
- Modify: `packages/plugin/src/ui/ui.ts` (add a listener near the AI-toggle handler ~line 362)
- Modify: `packages/plugin/src/ui/proxy.ts` (delete `quotaMeterText`, lines 106-110)
- Test: `packages/plugin/test/proxy.test.ts` (remove the old `quotaMeterText` cases)

**Interfaces:**
- Consumes: `quotaMeterModel()` from Task 1; `send`, `CHECKOUT_URL` already in scope in `ui.ts` (see the existing `upsellUpgradeBtn` listener at ui.ts:287).
- Produces: `Refs` fields `quotaBarFill: HTMLElement`, `quotaCount: HTMLElement`, `quotaUpgrade: HTMLButtonElement` (`quotaMeter` already exists), consumed by `render.ts`.

- [ ] **Step 1: Replace the meter markup in `dom.ts`**

Replace the single line at dom.ts:775:

```html
            <span id="quota-meter" class="hint"></span>
```

with:

```html
            <div id="quota-meter" class="quota-meter" hidden>
              <div class="quota-bar"><span id="quota-bar-fill"></span></div>
              <div class="quota-foot">
                <span class="quota-countwrap">
                  <svg class="quota-check" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                  <span id="quota-count" class="quota-count"></span>
                </span>
                <button id="quota-upgrade" class="quota-upgrade" type="button">Upgrade</button>
              </div>
            </div>
```

- [ ] **Step 2: Add the meter CSS in `dom.ts`**

Immediately after the `.switch input:checked + .track::after { transform: translateX(16px); }` line (dom.ts:496), insert:

```css
    /* ---- Quota meter (inside the AI card) ---- */
    .quota-meter { display: flex; flex-direction: column; gap: 6px; }
    .quota-meter[hidden] { display: none; }
    .quota-bar {
      height: 4px; border-radius: 999px; overflow: hidden;
      background: var(--figma-color-bg-tertiary);
    }
    .quota-bar > span {
      display: block; height: 100%; border-radius: 999px;
      background: var(--figma-color-bg-brand); transition: width .18s ease;
    }
    .quota-meter.low .quota-bar > span,
    .quota-meter.empty .quota-bar > span { background: var(--figma-color-bg-warning); }
    .quota-meter.pro .quota-bar { display: none; }
    .quota-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .quota-countwrap { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
    .quota-check { display: none; width: 13px; height: 13px; flex: 0 0 auto; color: var(--figma-color-bg-brand); }
    .quota-meter.pro .quota-check { display: block; }
    .quota-count { font-size: 11px; color: var(--figma-color-text-secondary); font-variant-numeric: tabular-nums; }
    .quota-meter.low .quota-count,
    .quota-meter.empty .quota-count { color: var(--figma-color-text-warning); }
    .quota-upgrade {
      appearance: none; background: none; border: none; cursor: pointer; padding: 0;
      font-family: inherit; font-size: 11px; color: var(--figma-color-bg-brand); white-space: nowrap;
    }
    .quota-upgrade:hover { text-decoration: underline; }
    .quota-upgrade[hidden] { display: none; }
    .quota-upgrade:focus-visible { outline: 2px solid var(--figma-color-bg-brand); outline-offset: 2px; border-radius: 3px; }
```

- [ ] **Step 3: Add the `Refs` fields in `dom.ts`**

Replace the `quotaMeter: HTMLElement;` line (dom.ts:998) with:

```ts
  quotaMeter: HTMLElement;
  quotaBarFill: HTMLElement;
  quotaCount: HTMLElement;
  quotaUpgrade: HTMLButtonElement;
```

- [ ] **Step 4: Add the `byId` mappings in `dom.ts`**

Replace the `quotaMeter: byId<HTMLElement>('quota-meter'),` line (dom.ts:1214) with:

```ts
    quotaMeter: byId<HTMLElement>('quota-meter'),
    quotaBarFill: byId<HTMLElement>('quota-bar-fill'),
    quotaCount: byId<HTMLElement>('quota-count'),
    quotaUpgrade: byId<HTMLButtonElement>('quota-upgrade'),
```

- [ ] **Step 5: Rewrite `renderQuota` in `render.ts`**

Change the import at render.ts:17 from:

```ts
import { quotaMeterText, upsellText, resolveLicenseView, licenseStatusCopy } from './proxy';
```

to:

```ts
import { quotaMeterModel, upsellText, resolveLicenseView, licenseStatusCopy } from './proxy';
```

Replace the whole `renderQuota` function (render.ts:51-56) with:

```ts
/** Quota meter + upsell visibility. The model owns all state branching. */
export function renderQuota(refs: Refs, state: UiState): void {
  const m = quotaMeterModel(state.quota, state.aiEnabled);
  refs.quotaMeter.hidden = m.state === 'hidden';
  refs.quotaMeter.classList.toggle('pro', m.state === 'pro');
  refs.quotaMeter.classList.toggle('low', m.state === 'low');
  refs.quotaMeter.classList.toggle('empty', m.state === 'empty');
  refs.quotaBarFill.style.width = `${m.fillPct}%`;
  refs.quotaCount.textContent = m.countText;
  refs.quotaUpgrade.hidden = m.linkText === '';
  refs.quotaUpgrade.textContent = m.linkText;

  const showUpsell = state.aiEnabled && state.quotaExhausted;
  refs.upsell.hidden = !showUpsell;
  if (showUpsell) refs.upsellText.textContent = upsellText(state.quota?.resetsAt);
}
```

- [ ] **Step 6: Wire the Upgrade button in `ui.ts`**

Immediately after the AI-toggle `change` listener block (ends at ui.ts:365), add:

```ts
// Quota-meter Upgrade link → checkout (same destination as the footer upsell).
refs.quotaUpgrade.addEventListener('click', () => {
  send({ type: 'openBrowser', url: CHECKOUT_URL });
});
```

- [ ] **Step 7: Remove the dead `quotaMeterText` from `proxy.ts`**

Delete the whole `quotaMeterText` function (proxy.ts:106-110):

```ts
export function quotaMeterText(q: ProxyQuota | null): string {
  if (!q) return '';
  if (q.tier === 'pro') return 'Pro plan active';
  return `${q.remaining ?? 0}/${q.limit ?? 0} AI generations left this month`;
}
```

- [ ] **Step 8: Remove the old `quotaMeterText` tests**

In `packages/plugin/test/proxy.test.ts`, remove `quotaMeterText` from the import (line 4), and in the `describe('copy strings', …)` block delete the three `it` cases that call `quotaMeterText` ('free meter text', 'pro meter text', 'empty when quota unknown'). Keep the 'upsell text names the current month' case.

- [ ] **Step 9: Typecheck, test, and build**

Run: `npm run typecheck`
Expected: PASS (no unresolved references to `quotaMeterText`).

Run: `npx vitest run packages/plugin/test/proxy.test.ts`
Expected: PASS.

Run: `npm run build:plugin`
Expected: bundles without error.

- [ ] **Step 10: Verify in Figma (manual, dark + light)**

Load the built plugin in Figma. Select a component and turn Write with AI on. Confirm:
- Normal free: bar partly filled (brand), "N of M left this month", "Upgrade" visible.
- Force a low quota (< 5 remaining): bar + count turn amber, link still "Upgrade".
- Force empty (0 remaining): bar full amber, "0 left · resets <date>", link reads "Get unlimited".
- With a Pro key: no bar, check + "Unlimited generations · Pro", no link.
- Toggle AI off: meter disappears with no layout jump.
- Click Upgrade: checkout opens.
Repeat the normal state in the opposite Figma theme to confirm the amber and brand colors read correctly.

- [ ] **Step 11: Commit**

```bash
git add packages/plugin/src/ui/dom.ts packages/plugin/src/ui/render.ts packages/plugin/src/ui/ui.ts packages/plugin/src/ui/proxy.ts packages/plugin/test/proxy.test.ts
git commit -m "feat(plugin): visual quota meter with always-present upgrade"
```

---

### Task 3: Restyle the footer upsell to match (`dom.ts`)

**Files:**
- Modify: `packages/plugin/src/ui/dom.ts` (footer markup at lines 952-958; CSS at line 678)

**Interfaces:**
- Consumes: nothing new. `#upsell` behavior (`runCreateWithoutAi`, upgrade → checkout) and `upsellText` copy are unchanged; this task is presentation only.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Update the footer upsell markup**

Replace the block at dom.ts:952-958:

```html
    <div id="upsell" hidden>
      <p id="upsell-text" class="hint"></p>
      <div class="actions">
        <button class="btn btn-primary" id="upsell-upgrade-btn" type="button">Upgrade for $8/mo</button>
        <button class="btn btn-secondary" id="upsell-continue-btn" type="button">Continue without AI</button>
      </div>
    </div>
```

with:

```html
    <div id="upsell" hidden>
      <p id="upsell-text" class="upsell-text"></p>
      <div class="actions">
        <button class="btn btn-primary" id="upsell-upgrade-btn" type="button">Upgrade for unlimited</button>
        <button class="btn btn-secondary" id="upsell-continue-btn" type="button">Continue without AI</button>
      </div>
    </div>
```

- [ ] **Step 2: Update the footer upsell CSS**

Replace the single rule at dom.ts:678:

```css
    #upsell { padding: 8px 0; }
```

with:

```css
    #upsell { padding: 8px 0; }
    #upsell .upsell-text { margin: 0 0 8px; font-size: 11px; color: var(--figma-color-text-warning); }
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build:plugin`
Expected: bundles without error.

- [ ] **Step 4: Verify in Figma (manual)**

With quota exhausted, press Create frame to trigger the footer fork. Confirm the exhaustion line renders in the warning color, the primary button reads "Upgrade for unlimited" and opens checkout, and "Continue without AI" still builds the frame with placeholders.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/dom.ts
git commit -m "feat(plugin): restyle exhausted-quota footer to match the meter"
```

---

## Self-Review

**Spec coverage:**
- Visual meter (bar + count + link) → Task 2 (markup/CSS/render).
- Always-present upgrade on free tier → Task 2 (`linkText` in model, button wired in ui.ts).
- All states (normal/low/empty/Pro/off/offline) → Task 1 model + Task 2 render; verified in Task 2 Step 10.
- Low threshold `remaining < 5` → Task 1 (`lowThreshold = 5`), covered by boundary tests.
- Reset date on empty → Task 1 (`formatResetDate`), Task 2 render.
- Footer upsell restyle + "Upgrade for unlimited" copy → Task 3.
- No proxy/server changes → confirmed; only `proxy.ts` presentation helpers change.

**Placeholder scan:** No TBD/TODO; every code step shows full code; test steps include real assertions.

**Type consistency:** `quotaMeterModel` / `QuotaMeterModel` / `formatResetDate` names match between Task 1 (definition), the tests, and Task 2 (import + usage). `Refs` field names (`quotaBarFill`, `quotaCount`, `quotaUpgrade`) match between the interface, `byId`, and `render.ts`. Element ids (`quota-bar-fill`, `quota-count`, `quota-upgrade`) match between markup and `byId`.
