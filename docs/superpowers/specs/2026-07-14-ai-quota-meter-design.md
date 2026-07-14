# AI quota meter + always-visible upgrade

**Date:** 2026-07-14
**Status:** Approved
**Scope:** Figma plugin (`packages/plugin`), "Write with AI" card + footer upsell

## Problem

The free-tier AI quota renders as one flat grey line inside the "Write with AI"
card:

```
14/20 AI generations left this month
```

Two gaps:

1. **No upgrade path until the wall.** The only upgrade CTA in this flow is the
   footer `#upsell` block, which stays hidden until a generation is blocked by
   `quota_exhausted`. A user at 14/20 sees nothing telling them Pro exists or
   that it removes the limit. They discover it only by hitting zero or digging
   into Settings.
2. **Not visual.** Grey body text with no sense of how much is left. The count
   carries no weight and the card reads as inert.

## Decision

Turn the flat line into a compact **meter**: a thin progress bar plus a count
and a quiet, always-present **Upgrade** link. The meter owns every state
(normal / running low / empty / Pro). The footer upsell keeps its job as the
mid-action fork but is restyled to share the meter's visual language.

Chosen direction: **"Quiet meter"** (Approach A from the options artifact).
Rationale: clarity first, upgrade second. The bar does the visual work; the
upgrade link is present in every free-tier state without competing with the
toggle. Same card height as today, so no layout shift.

## States

All copy follows the plugin voice (plain, honest, no em dashes).

| State | Bar | Count text | Link |
|-------|-----|------------|------|
| Free, normal | brand fill, `remaining/limit` | `14 of 20 left this month` | `Upgrade` |
| Free, running low | amber fill + amber track | `2 of 20 left this month` (count in amber) | `Upgrade` |
| Free, empty | amber, full track | `0 left · resets Aug 1` | `Get unlimited` |
| Pro | none | `Unlimited generations · Pro` (with check) | none |
| AI toggle off | meter hidden entirely | — | — |
| Quota unknown (offline) | meter hidden entirely | — | — |

**"Running low" threshold:** amber when `remaining > 0 && remaining <= 3`. A
single named constant so it is trivial to tune. (Open for review — see gate.)

**Reset date:** the empty state derives "Aug 1" from `quota.resetsAt`. Free
normal/low states omit it to stay quiet; only the dead end needs to say when it
comes back.

## Design

### 1. Presentation model (`packages/plugin/src/ui/proxy.ts`)

`quotaMeterText()` is replaced by a pure model function so the branching stays
testable and out of the DOM layer:

```ts
export type QuotaMeterState = 'hidden' | 'pro' | 'ok' | 'low' | 'empty';

export interface QuotaMeterModel {
  state: QuotaMeterState;
  fillPct: number;      // 0..100, bar width
  countText: string;    // "" when hidden
  linkText: string;     // "" when no link (pro/hidden)
}

export function quotaMeterModel(
  q: ProxyQuota | null,
  aiEnabled: boolean,
  lowThreshold = 3,
  now?: Date,
): QuotaMeterModel;
```

- `aiEnabled === false` or `q === null` → `state: 'hidden'`.
- `q.tier === 'pro'` → `state: 'pro'`, `countText: 'Unlimited generations · Pro'`,
  no link, no bar.
- Free tier: compute `remaining`/`limit` (fall back to `used`/`limit` when
  `remaining` is null), derive `fillPct = remaining/limit * 100`, pick
  `ok | low | empty`, and build the count + link text per the table.
- Empty state calls a small `formatResetDate(resetsAt, now)` helper (reuses the
  existing `MONTHS` array) to produce `"Aug 1"`. `upsellText` keeps using the
  same helper.

`quotaMeterText` and its tests are deleted; `quotaMeterModel` gets unit tests
covering each state, the null/offline case, the low boundary, and reset-date
formatting.

### 2. Markup (`packages/plugin/src/ui/dom.ts`)

Replace the single span at the current `#quota-meter` line:

```html
<div id="quota-meter" class="quota-meter">
  <div class="quota-bar"><span id="quota-bar-fill"></span></div>
  <div class="quota-foot">
    <span id="quota-count" class="quota-count"></span>
    <button id="quota-upgrade" class="quota-upgrade" type="button">Upgrade</button>
  </div>
</div>
```

Notes:
- The upgrade control is a real `<button>` (not an `<a>`) for keyboard focus and
  to match how the footer's upgrade action already works.
- The Pro state hides `.quota-bar` and the button, leaving only the count line
  with a leading check (rendered as an inline SVG toggled via a `pro` class on
  `.quota-meter`).

### 3. Styles (`packages/plugin/src/ui/dom.ts`, near `.ai-card`)

- `.quota-meter { display: flex; flex-direction: column; gap: 6px; }`
- `.quota-bar`: 4px tall, `border-radius: 999px`, track
  `var(--figma-color-bg-tertiary)`, `overflow: hidden`.
- `.quota-bar > span`: brand fill (`var(--figma-color-bg-brand)`),
  `transition: width .18s ease`.
- `.quota-meter.low .quota-bar` / `.quota-meter.empty .quota-bar`: amber track +
  amber fill via a `--quota-warn` custom property (single place to set the amber;
  default `#ffb020`, verify against Figma dark/light).
- `.quota-foot`: row, space-between, `align-items: center`.
- `.quota-count`: 11px, `var(--figma-color-text-secondary)`,
  `font-variant-numeric: tabular-nums`. `.low`/`.empty` tint the count amber.
- `.quota-upgrade`: link-style button (reuse the existing `.link-btn` look:
  brand color, no border/background, 11px, underline on hover),
  `focus-visible` outline.
- `.quota-meter.pro` hides bar + button, shows the check.

### 4. Render (`packages/plugin/src/ui/render.ts`)

`renderQuota` is rewritten to consume the model:

```ts
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
  // footer upsell fork unchanged here (still gated on quotaExhausted below)
  const showUpsell = state.aiEnabled && state.quotaExhausted;
  refs.upsell.hidden = !showUpsell;
  if (showUpsell) refs.upsellText.textContent = upsellText(state.quota?.resetsAt);
}
```

The `hidden` attribute replaces the old empty-string trick, so the element is a
stable landmark that shows/hides cleanly.

### 5. Refs + wiring (`packages/plugin/src/ui/dom.ts`, `ui.ts`)

- `Refs` gains `quotaBarFill`, `quotaCount`, `quotaUpgrade`; `byId` maps them.
  `quotaMeter` already exists.
- In `ui.ts`, the upgrade button opens checkout, reusing the footer handler:
  `refs.quotaUpgrade.addEventListener('click', () => send({ type: 'openBrowser', url: CHECKOUT_URL }));`

### 6. Footer upsell, restyled (`packages/plugin/src/ui/dom.ts`)

Keep the `#upsell` markup and both behaviors (`runCreateWithoutAi`, upgrade →
checkout) exactly as they are. Restyle only:

- Add an amber count line above the buttons, matching the meter's empty state
  (`0 free generations left this month`), replacing the plain `.hint` look.
- Primary button copy: `Upgrade for unlimited` (drops the `$8/mo` from the
  button; price stays in Settings). Secondary stays `Continue without AI`.
- Buttons keep the existing `.btn`/`.btn-primary`/`.btn-secondary` classes; the
  only new styling is the amber cue so it reads as the same family as the meter.

No proxy or generate-flow logic changes in this file.

## Out of scope

- No proxy/server changes. The meter is built entirely from the existing
  `ProxyQuota` fields (`tier`, `used`, `limit`, `remaining`, `resetsAt`).
- Settings-panel license copy is untouched.
- The Pro price and checkout URL are unchanged.

## Testing

- **Unit (Vitest):** `quotaMeterModel` across all states, null/offline, the
  low boundary (`remaining === 3` low, `=== 4` ok, `=== 0` empty), Pro, and
  `formatResetDate` output. These are pure and cover the branching.
- **Manual in Figma (dark + light):** verify each state renders — set a low
  `remaining`, force empty, and a Pro key — and that the bar width, amber
  threshold, and Upgrade link (opens checkout) behave. Confirm no layout shift
  versus today at the normal state.
