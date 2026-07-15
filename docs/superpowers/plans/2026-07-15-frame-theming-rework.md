# Frame Theming Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Presets become full theme personalities (colors + fonts + corner style), the default becomes monochrome/blue, the settings UI becomes presets-first with visual cards, and the font datalist becomes a real searchable combobox that only offers fonts guaranteed to work.

**Architecture:** Extend the existing `BrandTheme` stored shape with one `cornerStyle` field (legacy themes migrate for free via the existing spread-over-defaults migration). The frame builder gets a module-level corner scale next to the existing font-family state. The UI work is plain DOM in the plugin iframe, following the existing dom.ts (markup/CSS/refs) + render.ts (paint) + ui.ts (wiring) split; the combobox is a new small module `src/ui/fontPicker.ts`.

**Tech Stack:** TypeScript, Figma plugin API, vitest (run from repo root), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-15-frame-theming-rework-design.md`

## Global Constraints

- All UI copy: plain, honest peer tone, **never em dashes** (see `docs/plugin-voice-and-copy.md`).
- Run all commands from the repo root: `/Users/sandrolek/Documents/Projects/Design System Docs`.
- Tests: `npx vitest run packages/plugin/test/<file>.test.ts` for a single file, `npm test` for all.
- The plugin iframe cannot load Figma's fonts; specimen previews use approximate CSS stacks.
- New default constants: `DEFAULT_HEADER_BG = '#0f172a'`, `DEFAULT_ACCENT = '#2563eb'`. Radius mapping: sharp → 0, soft → base, round → `Math.round(base * 1.75)`.

---

### Task 1: Theme model — corner style, new defaults, full presets, matchPreset

**Files:**
- Modify: `packages/plugin/src/brandColors.ts`
- Test: `packages/plugin/test/brandColors.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `type CornerStyle = 'sharp' | 'soft' | 'round'`; `BrandTheme.cornerStyle: CornerStyle | null`; `resolveTheme(...)` return gains `cornerStyle: CornerStyle`; `matchPreset(theme: BrandTheme | null | undefined): string | null`; new `THEME_PRESETS` (Default, Editorial, Tech, Warm — every field non-null); constants `DEFAULT_HEADER_BG = '#0f172a'`, `DEFAULT_ACCENT = '#2563eb'`.

- [ ] **Step 1: Update existing tests + write failing tests**

In `packages/plugin/test/brandColors.test.ts`, add `matchPreset` to the import list from `'../src/brandColors'`, then replace the whole `describe('brand theme', ...)` block with:

```ts
describe('brand theme', () => {
  it('resolves null fields to defaults', () => {
    expect(resolveTheme(emptyBrandTheme())).toEqual({
      headerBg: '#0f172a', accent: '#2563eb',
      bodyText: '#334155', tableHeadBg: '#f8fafc',
      headingFont: 'Inter', bodyFont: 'Inter',
      cornerStyle: 'soft',
    });
  });

  it('migrates legacy two-color objects', () => {
    expect(migrateBrandColors({ headerBg: '#111111', accent: null })).toEqual({
      headerBg: '#111111', accent: null,
      bodyText: null, tableHeadBg: null, headingFont: null, bodyFont: null,
      cornerStyle: null,
    });
  });

  it('migrates a 2.x theme (no cornerStyle) to cornerStyle null', () => {
    const stored = {
      headerBg: '#111111', accent: '#222222', bodyText: '#333333',
      tableHeadBg: '#444444', headingFont: 'Lora', bodyFont: 'Inter',
    };
    expect(migrateBrandColors(stored as never)).toEqual({ ...stored, cornerStyle: null });
  });

  it('passes a full theme through migration unchanged', () => {
    const t = {
      headerBg: '#111111', accent: '#222222', bodyText: '#333333',
      tableHeadBg: '#444444', headingFont: 'Lora', bodyFont: 'Inter',
      cornerStyle: 'sharp' as const,
    };
    expect(migrateBrandColors(t)).toEqual(t);
  });

  it('ships four fully-specified presets, Default first', () => {
    expect(THEME_PRESETS.map((p) => p.name)).toEqual(['Default', 'Editorial', 'Tech', 'Warm']);
    for (const { name, theme } of THEME_PRESETS) {
      for (const [key, value] of Object.entries(theme)) {
        expect(value, `${name}.${key}`).not.toBeNull();
      }
    }
  });

  it('Default preset equals the built-in defaults', () => {
    expect(resolveTheme(THEME_PRESETS[0].theme)).toEqual(resolveTheme(emptyBrandTheme()));
  });
});

describe('matchPreset', () => {
  it('identifies each preset from its own theme', () => {
    for (const { name, theme } of THEME_PRESETS) {
      expect(matchPreset({ ...theme })).toBe(name);
    }
  });

  it('treats the empty theme as Default (null equals concrete default)', () => {
    expect(matchPreset(emptyBrandTheme())).toBe('Default');
    expect(matchPreset(null)).toBe('Default');
    expect(matchPreset(undefined)).toBe('Default');
  });

  it('returns null once any field is edited away from the preset', () => {
    const edited = { ...THEME_PRESETS[1].theme, accent: '#123456' };
    expect(matchPreset(edited)).toBeNull();
  });

  it('returns null for a fully custom theme', () => {
    expect(matchPreset({
      headerBg: '#101010', accent: '#202020', bodyText: '#303030',
      tableHeadBg: '#404040', headingFont: 'Karla', bodyFont: 'Karla',
      cornerStyle: 'round',
    })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/plugin/test/brandColors.test.ts`
Expected: FAIL — `matchPreset` is not exported; resolveTheme lacks `cornerStyle`; defaults still `#0d2436`/`#12b3a6`; presets are Default/Slate/Forest/Plum.

- [ ] **Step 3: Implement the model changes**

In `packages/plugin/src/brandColors.ts`:

a) Change the two default constants:

```ts
export const DEFAULT_HEADER_BG = '#0f172a';
export const DEFAULT_ACCENT = '#2563eb';
```

Also update the module doc comment's "navy header band and the teal accent" wording to "header band and the accent color" (it no longer ships navy/teal).

b) Below `DEFAULT_FONT`, add the corner style and extend `BrandTheme`:

```ts
export type CornerStyle = 'sharp' | 'soft' | 'round';
export const DEFAULT_CORNER_STYLE: CornerStyle = 'soft';
```

Add to the `BrandTheme` interface:

```ts
  /** Corner style for the generated frame, or null to use 'soft'. */
  cornerStyle: CornerStyle | null;
```

c) `emptyBrandTheme()` gains `cornerStyle: null,`.

d) `resolveTheme` return type gains `cornerStyle: CornerStyle` and the body gains:

```ts
    cornerStyle: stored?.cornerStyle ?? DEFAULT_CORNER_STYLE,
```

(`migrateBrandColors` needs no change: spreading over `emptyBrandTheme()` already defaults the new field to null.)

e) Replace the `THEME_PRESETS` export entirely:

```ts
/**
 * Built-in theme presets. Each preset is a full personality: all four
 * colors, both fonts, and a corner style. "Default" stores concrete values
 * equal to the built-in defaults so active-preset detection is uniform.
 * Heading fonts are Google Fonts available in Figma by default; the build
 * still falls back to Inter if one is missing.
 */
export const THEME_PRESETS: { name: string; theme: BrandTheme }[] = [
  {
    name: 'Default',
    theme: {
      headerBg: '#0f172a', accent: '#2563eb', bodyText: '#334155',
      tableHeadBg: '#f8fafc', headingFont: 'Inter', bodyFont: 'Inter',
      cornerStyle: 'soft',
    },
  },
  {
    name: 'Editorial',
    theme: {
      headerBg: '#1c1917', accent: '#b45309', bodyText: '#3f3a36',
      tableHeadBg: '#faf9f7', headingFont: 'Lora', bodyFont: 'Inter',
      cornerStyle: 'sharp',
    },
  },
  {
    name: 'Tech',
    theme: {
      headerBg: '#1e293b', accent: '#6366f1', bodyText: '#334155',
      tableHeadBg: '#f6f7fb', headingFont: 'Space Grotesk', bodyFont: 'Inter',
      cornerStyle: 'round',
    },
  },
  {
    name: 'Warm',
    theme: {
      headerBg: '#2b1b3d', accent: '#e879a6', bodyText: '#3d3450',
      tableHeadBg: '#faf8fb', headingFont: 'DM Sans', bodyFont: 'Inter',
      cornerStyle: 'soft',
    },
  },
];

/**
 * Which preset (if any) the stored theme currently equals. Compares RESOLVED
 * values so a null field and a concrete field holding the default are equal.
 * Returns the preset name, or null when the theme is custom.
 */
export function matchPreset(theme: BrandTheme | null | undefined): string | null {
  const t = resolveTheme(migrateBrandColors(theme));
  for (const preset of THEME_PRESETS) {
    const p = resolveTheme(preset.theme);
    if (
      p.headerBg === t.headerBg && p.accent === t.accent &&
      p.bodyText === t.bodyText && p.tableHeadBg === t.tableHeadBg &&
      p.headingFont === t.headingFont && p.bodyFont === t.bodyFont &&
      p.cornerStyle === t.cornerStyle
    ) {
      return preset.name;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/plugin/test/brandColors.test.ts`
Expected: PASS (all tests, including the untouched parseBrandHex/resolveBrand blocks — they reference the constants, not literals).

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/brandColors.ts packages/plugin/test/brandColors.test.ts
git commit -m "feat(plugin): theme corner style, monochrome default, full-personality presets"
```

---

### Task 2: Font helpers — compatible-family filtering

**Files:**
- Create: `packages/plugin/src/fonts.ts`
- Modify: `packages/plugin/src/main.ts:258-267` (the `requestFonts` case)
- Test: `packages/plugin/test/fonts.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `familiesWithRequiredStyles(fonts: { fontName: { family: string; style: string } }[]): string[]` (sorted, only families with Regular+Medium+Bold) and `filterFamilies(families: string[], query: string): string[]` (case-insensitive substring). Task 4 uses `filterFamilies`; `main.ts` uses `familiesWithRequiredStyles`.

- [ ] **Step 1: Write the failing tests**

Create `packages/plugin/test/fonts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { familiesWithRequiredStyles, filterFamilies } from '../src/fonts';

const entry = (family: string, style: string) => ({ fontName: { family, style } });

describe('familiesWithRequiredStyles', () => {
  it('keeps families that have Regular, Medium, and Bold', () => {
    const fonts = [
      entry('Inter', 'Regular'), entry('Inter', 'Medium'), entry('Inter', 'Bold'),
      entry('Inter', 'Italic'),
    ];
    expect(familiesWithRequiredStyles(fonts)).toEqual(['Inter']);
  });

  it('drops families missing any required style', () => {
    const fonts = [
      entry('NoBold', 'Regular'), entry('NoBold', 'Medium'),
      entry('NoMedium', 'Regular'), entry('NoMedium', 'Bold'),
      entry('OnlySemi', 'Regular'), entry('OnlySemi', 'SemiBold'), entry('OnlySemi', 'Bold'),
    ];
    expect(familiesWithRequiredStyles(fonts)).toEqual([]);
  });

  it('sorts the result and deduplicates entries', () => {
    const fonts = [
      entry('Zilla', 'Regular'), entry('Zilla', 'Medium'), entry('Zilla', 'Bold'),
      entry('Abel Pro', 'Regular'), entry('Abel Pro', 'Regular'),
      entry('Abel Pro', 'Medium'), entry('Abel Pro', 'Bold'),
    ];
    expect(familiesWithRequiredStyles(fonts)).toEqual(['Abel Pro', 'Zilla']);
  });
});

describe('filterFamilies', () => {
  const families = ['DM Sans', 'Inter', 'Lora', 'Space Grotesk'];

  it('returns everything for an empty or whitespace query', () => {
    expect(filterFamilies(families, '')).toEqual(families);
    expect(filterFamilies(families, '   ')).toEqual(families);
  });

  it('matches case-insensitive substrings', () => {
    expect(filterFamilies(families, 'gro')).toEqual(['Space Grotesk']);
    expect(filterFamilies(families, 'S')).toEqual(['DM Sans', 'Space Grotesk']);
  });

  it('returns empty for no match', () => {
    expect(filterFamilies(families, 'zzz')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/plugin/test/fonts.test.ts`
Expected: FAIL — cannot resolve `../src/fonts`.

- [ ] **Step 3: Implement `src/fonts.ts`**

```ts
/**
 * fonts.ts — pure helpers for the theme font pickers.
 *
 * The generated frame needs Regular, Medium, and Bold faces of any family it
 * uses (see tryFamily in docFrame.ts). The pickers therefore only offer
 * families that have all three, computed here from the raw
 * figma.listAvailableFontsAsync() entries. No DOM, no Figma APIs.
 */

export const REQUIRED_FONT_STYLES = ['Regular', 'Medium', 'Bold'] as const;

export interface FontEntry {
  fontName: { family: string; style: string };
}

/** Families that have every required style, sorted alphabetically. */
export function familiesWithRequiredStyles(fonts: FontEntry[]): string[] {
  const byFamily = new Map<string, Set<string>>();
  for (const { fontName } of fonts) {
    let styles = byFamily.get(fontName.family);
    if (!styles) byFamily.set(fontName.family, (styles = new Set()));
    styles.add(fontName.style);
  }
  const out: string[] = [];
  for (const [family, styles] of byFamily) {
    if (REQUIRED_FONT_STYLES.every((s) => styles.has(s))) out.push(family);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** Case-insensitive substring filter for the picker's type-to-search. */
export function filterFamilies(families: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return families;
  return families.filter((f) => f.toLowerCase().includes(q));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/plugin/test/fonts.test.ts`
Expected: PASS

- [ ] **Step 5: Use it in the main thread**

In `packages/plugin/src/main.ts`, add to the imports:

```ts
import { familiesWithRequiredStyles } from './fonts';
```

In the `requestFonts` case, replace:

```ts
        const families = [...new Set(fonts.map((f) => f.fontName.family))].sort();
```

with:

```ts
        // Only offer families the frame can actually use (Regular+Medium+Bold),
        // so a picked font never silently falls back to Inter.
        const families = familiesWithRequiredStyles(fonts);
```

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc -p packages/plugin/tsconfig.json --noEmit`
Expected: no errors.

```bash
git add packages/plugin/src/fonts.ts packages/plugin/src/main.ts packages/plugin/test/fonts.test.ts
git commit -m "feat(plugin): only offer fonts with Regular, Medium, and Bold styles"
```

---

### Task 3: Corner style in the frame builder

**Files:**
- Modify: `packages/plugin/src/frameKit.ts` (import line 2, new setter/helper near `setFontFamilies` at line ~47, `buildSlot` line 153)
- Modify: `packages/plugin/src/docFrame.ts` (import at lines 13-17, `buildDocFrames` theme block at ~1180, nine `cornerRadius` sites)
- Test: `packages/plugin/test/frameKit.test.ts` (new)

**Interfaces:**
- Consumes: `CornerStyle` type from Task 1.
- Produces: `setCornerStyle(style: CornerStyle): void` and `radius(base: number): number` exported from `frameKit.ts`. `buildDocFrames` applies the theme's corner style each build.

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/frameKit.test.ts` (frameKit's module body touches no Figma APIs at import time, so it loads fine under vitest):

```ts
import { describe, it, expect } from 'vitest';
import { setCornerStyle, radius } from '../src/frameKit';

describe('radius', () => {
  it('soft keeps the base values (the current look)', () => {
    setCornerStyle('soft');
    for (const base of [2, 3, 6, 8, 12, 16]) expect(radius(base)).toBe(base);
  });

  it('sharp squares everything off', () => {
    setCornerStyle('sharp');
    for (const base of [2, 3, 6, 8, 12, 16]) expect(radius(base)).toBe(0);
  });

  it('round scales by 1.75 and rounds to whole pixels', () => {
    setCornerStyle('round');
    expect(radius(16)).toBe(28);
    expect(radius(12)).toBe(21);
    expect(radius(8)).toBe(14);
    expect(radius(6)).toBe(11);
    expect(radius(3)).toBe(5);
    expect(radius(2)).toBe(4);
  });

  it('setCornerStyle replaces the previous style completely', () => {
    setCornerStyle('round');
    setCornerStyle('soft');
    expect(radius(16)).toBe(16);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/frameKit.test.ts`
Expected: FAIL — `setCornerStyle`/`radius` not exported.

- [ ] **Step 3: Implement in frameKit.ts**

Change line 2's import to:

```ts
import { DEFAULT_HEADER_BG, DEFAULT_ACCENT, type CornerStyle } from './brandColors';
```

Directly after the `setFontFamilies` function, add:

```ts
// Mutable like the font families so the theme can swap corner styles.
// buildDocFrames sets it every build; 'soft' (scale 1) is the default look.
let cornerScale = 1;

export function setCornerStyle(style: CornerStyle): void {
  cornerScale = style === 'sharp' ? 0 : style === 'round' ? 1.75 : 1;
}

/** Theme-scaled corner radius. `base` is the soft (default) radius. */
export function radius(base: number): number {
  return Math.round(base * cornerScale);
}
```

In `buildSlot`, change `slot.cornerRadius = 8;` to `slot.cornerRadius = radius(8);`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/plugin/test/frameKit.test.ts`
Expected: PASS

- [ ] **Step 5: Route docFrame through radius() and set the style per build**

In `packages/plugin/src/docFrame.ts`:

a) Extend the frameKit import (lines 13-17) with `radius` and `setCornerStyle`:

```ts
import {
  palette, hex, solidFill, vstack, hstack, makeText, buildSlot, font,
  headingFont, setFontFamilies, matchVariableModes, radius, setCornerStyle,
  type FontStyle,
} from './frameKit';
```

b) In `buildDocFrames`, directly after the four `palette.* = hex(...)` lines (~line 1183), add:

```ts
  // Corner style is module state in frameKit, same as the font families —
  // set it every build so styles never leak into the next build.
  setCornerStyle(theme.cornerStyle);
```

c) Replace these assignments (current line numbers as of this plan; match on the assignment text, not the line):

| Line | Old | New |
|---|---|---|
| 95 | `rule.cornerRadius = 2;` | `rule.cornerRadius = radius(2);` |
| 231 | `table.cornerRadius = 8;` | `table.cornerRadius = radius(8);` |
| 301 | `chip.cornerRadius = 3;` | `chip.cornerRadius = radius(3);` |
| 329 | `chip.cornerRadius = 6;` | `chip.cornerRadius = radius(6);` |
| 397 | `table.cornerRadius = 8;` | `table.cornerRadius = radius(8);` |
| 647 | `card.cornerRadius = 8;` | `card.cornerRadius = radius(8);` |
| 709 | `dot.cornerRadius = 3;` | `dot.cornerRadius = radius(3);` |
| 830 | `card.cornerRadius = 12;` | `card.cornerRadius = radius(12);` |
| 1099 | `frame.cornerRadius = 16;` | `frame.cornerRadius = radius(16);` |

**Do NOT touch** line 529 `badge.cornerRadius = size / 2;` — the state badge stays a circle in every corner style.

- [ ] **Step 6: Typecheck, full test run, commit**

Run: `npx tsc -p packages/plugin/tsconfig.json --noEmit && npm test`
Expected: no type errors, all tests pass.

```bash
git add packages/plugin/src/frameKit.ts packages/plugin/src/docFrame.ts packages/plugin/test/frameKit.test.ts
git commit -m "feat(plugin): theme-driven corner style in the generated frame"
```

---

### Task 4: Font picker combobox component

**Files:**
- Create: `packages/plugin/src/ui/fontPicker.ts`

**Interfaces:**
- Consumes: `filterFamilies` from Task 2.
- Produces: `createFontPicker(opts: { root: HTMLElement; onCommit: (value: string) => void }): { setFamilies(families: string[]): void }`. Expects `root` to contain an `<input type="text">` and a `<div class="font-menu" hidden>` (markup added in Task 5). `onCommit` receives the trimmed family name, `''` meaning "clear to default". Behavior is unit-covered indirectly via `filterFamilies`; the DOM behavior is verified manually in Task 6.

- [ ] **Step 1: Implement the component**

Create `packages/plugin/src/ui/fontPicker.ts`:

```ts
/**
 * fontPicker.ts — a searchable combobox for the theme font fields.
 *
 * Replaces the old <input list> + <datalist>. The menu lists only compatible
 * families (filtered on the main thread, see fonts.ts); typing filters,
 * ArrowUp/Down navigate, Enter or click commits, Esc closes. Free-typed text
 * still commits on Enter/blur so an unlisted family remains possible (the
 * caller shows a fallback hint for those). If setFamilies is never called
 * (main thread could not list fonts) the menu never opens and the input
 * degrades to plain free text.
 */
import { filterFamilies } from '../fonts';

export interface FontPickerOpts {
  /** The .font-picker wrapper containing the input and the .font-menu div. */
  root: HTMLElement;
  /** Called with the trimmed committed value; '' means clear to default. */
  onCommit: (value: string) => void;
}

export interface FontPicker {
  setFamilies(families: string[]): void;
}

export function createFontPicker(opts: FontPickerOpts): FontPicker {
  const input = opts.root.querySelector('input') as HTMLInputElement;
  const menu = opts.root.querySelector('.font-menu') as HTMLElement;
  let families: string[] = [];
  let open = false;
  let activeIndex = -1; // highlighted row, -1 = none

  const rows = (): HTMLElement[] => Array.from(menu.querySelectorAll('.font-option'));

  function renderMenu(): void {
    menu.textContent = '';
    const def = document.createElement('div');
    def.className = 'font-option default';
    def.dataset.value = '';
    def.textContent = 'Default (Inter)';
    menu.appendChild(def);
    for (const family of filterFamilies(families, input.value)) {
      const row = document.createElement('div');
      row.className = 'font-option';
      row.dataset.value = family;
      row.textContent = family;
      menu.appendChild(row);
    }
    activeIndex = -1;
  }

  function openMenu(): void {
    if (families.length === 0) return; // degraded free-text mode
    renderMenu();
    menu.hidden = false;
    open = true;
  }

  function closeMenu(): void {
    menu.hidden = true;
    open = false;
    activeIndex = -1;
  }

  function commit(value: string): void {
    closeMenu();
    opts.onCommit(value.trim());
  }

  function setActive(next: number): void {
    const all = rows();
    if (all.length === 0) return;
    activeIndex = ((next % all.length) + all.length) % all.length;
    all.forEach((row, i) => row.classList.toggle('active', i === activeIndex));
    all[activeIndex].scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('focus', openMenu);
  input.addEventListener('input', () => {
    if (open) renderMenu();
    else openMenu();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) openMenu();
      setActive(e.key === 'ArrowDown' ? activeIndex + 1 : activeIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = open && activeIndex >= 0 ? rows()[activeIndex] : null;
      commit(active ? (active.dataset.value ?? '') : input.value);
    } else if (e.key === 'Escape') {
      closeMenu();
    }
  });
  // mousedown, not click: it fires before focusout would commit the raw text.
  menu.addEventListener('mousedown', (e) => {
    const row = (e.target as HTMLElement).closest('.font-option') as HTMLElement | null;
    if (!row) return;
    e.preventDefault(); // keep focus on the input
    commit(row.dataset.value ?? '');
  });
  opts.root.addEventListener('focusout', (e) => {
    if (opts.root.contains(e.relatedTarget as Node | null)) return;
    closeMenu();
    commit(input.value);
  });

  return {
    setFamilies(next: string[]): void {
      families = next;
      if (open) renderMenu();
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p packages/plugin/tsconfig.json --noEmit`
Expected: no errors (the module is not yet imported anywhere; that happens in Task 5).

- [ ] **Step 3: Commit**

```bash
git add packages/plugin/src/ui/fontPicker.ts
git commit -m "feat(plugin): searchable font picker combobox component"
```

---

### Task 5: Settings UI — preset cards, customize section, wired pickers

**Files:**
- Modify: `packages/plugin/src/ui/dom.ts` (CSS ~lines 296-311, markup ~lines 934-987, `Refs` interface ~lines 1092-1105 region, `mount()` ~lines 1235-1316 region)
- Modify: `packages/plugin/src/ui/render.ts` (`renderBrandTheme`, ~line 285)
- Modify: `packages/plugin/src/ui/ui.ts` (theme section ~lines 528-599, `fontList` case ~line 678)

**Interfaces:**
- Consumes: `THEME_PRESETS`, `resolveTheme`, `matchPreset`, `CornerStyle` (Task 1); `createFontPicker` (Task 4).
- Produces: `Refs` gains `headingFontPicker: HTMLDivElement`, `bodyFontPicker: HTMLDivElement`, `fontFallbackHint: HTMLParagraphElement`; loses `fontDatalist`. Preset cards use class `preset-card` with `dataset.preset` (render.ts toggles `.active` on them).

- [ ] **Step 1: Restyle — replace the preset and font CSS in dom.ts**

Replace the `/* ---- Theme presets (frame theme) ---- */` block (`.preset-row`, `.preset-chip`, and their hover/focus rules) and the `.font-row` rules (keep `.logo-row` rules) with:

```css
    /* ---- Theme presets (frame theme) ----
       A 2x2 grid of preset cards. Each card previews its theme: a band in
       the header color with the accent dot and an "Ag" specimen in an
       approximate font stack. The card's own border radius mirrors the
       preset's corner style (set inline in mount()). The active card is the
       one whose theme matches the stored theme (see renderBrandTheme). */
    .preset-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
    .preset-card {
      display: flex; flex-direction: column; gap: 6px; padding: 5px 5px 6px;
      border: 1px solid var(--figma-color-border); background: var(--figma-color-bg);
      font-family: inherit; text-align: left; cursor: pointer;
      transition: border-color 0.12s ease, box-shadow 0.12s ease;
    }
    .preset-card:hover { border-color: var(--figma-color-bg-brand); }
    .preset-card:focus-visible { outline: 2px solid var(--figma-color-bg-brand); outline-offset: 1px; }
    .preset-card.active {
      border-color: var(--figma-color-bg-brand);
      box-shadow: 0 0 0 1px var(--figma-color-bg-brand);
    }
    .preset-band {
      position: relative; display: flex; align-items: center; justify-content: center;
      height: 36px;
    }
    .preset-ag { color: #ffffff; font-size: 14px; font-weight: 600; line-height: 1; }
    .preset-dot { position: absolute; right: 6px; bottom: 6px; width: 8px; height: 8px; border-radius: 50%; }
    .preset-name { font-size: 11px; font-weight: 500; color: var(--figma-color-text); padding: 0 2px; }

    /* ---- Customize subheading (frame theme) ---- */
    h3.customize-heading {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--figma-color-text-secondary);
      margin: 16px 0 8px;
    }

    /* ---- Font pickers (frame theme) ----
       Searchable combobox: a text input plus an absolutely positioned menu.
       Only families with Regular+Medium+Bold are listed (filtered on the
       main thread); typing filters, arrows navigate, Enter/click commits. */
    .font-picker { position: relative; }
    .font-menu {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20;
      max-height: 190px; overflow-y: auto; padding: 4px;
      background: var(--figma-color-bg); border: 1px solid var(--figma-color-border);
      border-radius: 8px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    }
    .font-option { padding: 6px 8px; border-radius: 5px; font-size: 12px; cursor: pointer; }
    .font-option:hover, .font-option.active { background: var(--figma-color-bg-secondary); }
    .font-option.default { color: var(--figma-color-text-secondary); }
```

- [ ] **Step 2: Restructure the theme-group markup in dom.ts**

Replace the whole `<div class="settings-group" id="theme-group">...</div>` block with:

```html
        <div class="settings-group" id="theme-group">
          <h2>Frame theme</h2>
          <p class="hint" style="margin-top:4px">
            Pick a theme for the generated Guidelines frame, or adjust any value below.
          </p>

          <div class="preset-grid" id="preset-row"></div>

          <h3 class="customize-heading">Customize</h3>

          <label class="field-label" for="header-color-input">Header background</label>
          <div class="color-row">
            <span class="color-swatch" id="header-color-swatch"></span>
            <input type="text" id="header-color-input" placeholder="#0f172a" />
          </div>

          <label class="field-label" for="accent-color-input" style="margin-top:10px">Accent</label>
          <div class="color-row">
            <span class="color-swatch" id="accent-color-swatch"></span>
            <input type="text" id="accent-color-input" placeholder="#2563eb" />
          </div>

          <label class="field-label" for="body-color-input" style="margin-top:10px">Body text</label>
          <div class="color-row">
            <span class="color-swatch" id="body-color-swatch"></span>
            <input type="text" id="body-color-input" placeholder="#334155" />
          </div>

          <label class="field-label" for="tablehead-color-input" style="margin-top:10px">Table header</label>
          <div class="color-row">
            <span class="color-swatch" id="tablehead-color-swatch"></span>
            <input type="text" id="tablehead-color-input" placeholder="#f8fafc" />
          </div>

          <p class="hint" id="brand-color-hint"></p>
          <p class="hint" style="margin-top:6px"><a id="reset-colors-link">Reset to defaults</a></p>

          <label class="field-label" for="heading-font-input" style="margin-top:10px">Heading font</label>
          <div class="font-picker" id="heading-font-picker">
            <input type="text" id="heading-font-input" placeholder="Inter" autocomplete="off" spellcheck="false" />
            <div class="font-menu" hidden></div>
          </div>

          <label class="field-label" for="body-font-input" style="margin-top:10px">Body font</label>
          <div class="font-picker" id="body-font-picker">
            <input type="text" id="body-font-input" placeholder="Inter" autocomplete="off" spellcheck="false" />
            <div class="font-menu" hidden></div>
          </div>
          <p class="hint" id="font-fallback-hint" aria-live="polite"></p>

          <div class="logo-row" style="margin-top:10px">
            <button class="btn btn-secondary" id="capture-logo-btn" type="button">Use selected node as logo</button>
            <img id="logo-preview" alt="" style="display:none; height:24px;" />
            <button class="link-btn" id="clear-logo-btn" type="button" style="display:none;">Remove</button>
          </div>
          <p class="hint" id="logo-error-hint" style="color: var(--figma-color-text-danger)"></p>
        </div>
```

Notes: hex placeholders updated to the new defaults; the `<datalist id="font-families">` and the trailing "Fonts need Regular, Medium, and Bold styles" hint are gone (the picker guarantees compatibility; the fallback hint element covers free-typed exceptions). Also update the swatch fallback `background: #0d2436;` in the `.color-swatch` CSS rule to `background: #0f172a;`.

- [ ] **Step 3: Update Refs and mount() in dom.ts**

a) In the `Refs` interface: delete `fontDatalist: HTMLDataListElement;` and add:

```ts
  headingFontPicker: HTMLDivElement;
  bodyFontPicker: HTMLDivElement;
  fontFallbackHint: HTMLParagraphElement;
```

b) In `mount()`: the dom.ts import from `'../brandColors'` currently pulls `THEME_PRESETS`; extend it to:

```ts
import { THEME_PRESETS, resolveTheme, type CornerStyle } from '../brandColors';
```

Replace the preset-chip injection loop (`// Inject one preset chip per built-in theme...` through the `presetRow.appendChild(chip);` loop end) with:

```ts
  // Inject one preset card per built-in theme (wired to setBrandTheme in
  // ui.ts). Each card previews its theme; the specimen uses an approximate
  // CSS stack since the iframe cannot load Figma's fonts.
  const PRESET_FONT_STACKS: Record<string, string> = {
    Lora: "Georgia, 'Times New Roman', serif",
    'Space Grotesk': "Futura, 'Trebuchet MS', sans-serif",
    'DM Sans': 'Verdana, sans-serif',
  };
  // [card radius, band radius] per corner style, mirroring the frame's look.
  const PRESET_RADII: Record<CornerStyle, [number, number]> = {
    sharp: [0, 0],
    soft: [8, 5],
    round: [14, 10],
  };
  const presetRow = byId<HTMLDivElement>('preset-row');
  for (const preset of THEME_PRESETS) {
    const resolved = resolveTheme(preset.theme);
    const [cardR, bandR] = PRESET_RADII[resolved.cornerStyle];

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'preset-card';
    card.dataset.preset = preset.name;
    card.style.borderRadius = `${cardR}px`;

    const band = document.createElement('span');
    band.className = 'preset-band';
    band.style.background = resolved.headerBg;
    band.style.borderRadius = `${bandR}px`;

    const ag = document.createElement('span');
    ag.className = 'preset-ag';
    ag.style.fontFamily = PRESET_FONT_STACKS[resolved.headingFont] ?? 'Inter, sans-serif';
    ag.textContent = 'Ag';

    const dot = document.createElement('span');
    dot.className = 'preset-dot';
    dot.style.background = resolved.accent;

    band.append(ag, dot);
    const name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = preset.name;
    card.append(band, name);
    presetRow.appendChild(card);
  }
```

c) In the returned refs object: delete the `fontDatalist:` line and add:

```ts
    headingFontPicker: byId<HTMLDivElement>('heading-font-picker'),
    bodyFontPicker: byId<HTMLDivElement>('body-font-picker'),
    fontFallbackHint: byId<HTMLParagraphElement>('font-fallback-hint'),
```

- [ ] **Step 4: Highlight the active preset in render.ts**

Add `matchPreset` to render.ts's import from `'../brandColors'`. At the end of `renderBrandTheme`, add:

```ts
  const active = matchPreset(state.brandTheme);
  refs.presetRow.querySelectorAll<HTMLElement>('.preset-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.preset === active);
  });
```

- [ ] **Step 5: Rewire ui.ts**

a) Add imports:

```ts
import { createFontPicker } from './fontPicker';
```

b) In the "Frame brand theme (Settings)" section, replace `applyBrandFont` and the two `refs.headingFontInput/bodyFontInput` change-listeners with:

```ts
// Compatible families from the main thread; empty until (unless) it arrives.
let fontFamilies: string[] = [];

/**
 * Apply a committed font family (empty → default). A free-typed family that
 * is not in the compatible list still commits, but gets a fallback warning
 * since the build will revert it to Inter if styles are missing.
 */
function applyBrandFont(field: 'headingFont' | 'bodyFont', raw: string): void {
  const trimmed = raw.trim();
  setBrandTheme(state, { ...state.brandTheme, [field]: trimmed || null });
  const unknown =
    trimmed !== '' && trimmed !== 'Inter' &&
    fontFamilies.length > 0 && !fontFamilies.includes(trimmed);
  refs.fontFallbackHint.textContent = unknown
    ? 'Figma does not list Regular, Medium, and Bold styles for this font. The frame will fall back to Inter.'
    : '';
  renderBrandTheme(refs, state);
}

const headingFontPicker = createFontPicker({
  root: refs.headingFontPicker,
  onCommit: (value) => applyBrandFont('headingFont', value),
});
const bodyFontPicker = createFontPicker({
  root: refs.bodyFontPicker,
  onCommit: (value) => applyBrandFont('bodyFont', value),
});
```

c) In the preset click handler: change the selector `'.preset-chip'` to `'.preset-card'` (variable name `chip` → `card` for clarity) and add `refs.fontFallbackHint.textContent = '';` next to the existing `refs.brandColorHint.textContent = '';`. Same addition in the `resetColorsLink` click handler.

d) Replace the `fontList` case body:

```ts
    case 'fontList': {
      fontFamilies = msg.families;
      headingFontPicker.setFamilies(fontFamilies);
      bodyFontPicker.setFamilies(fontFamilies);
      break;
    }
```

- [ ] **Step 6: Verify — typecheck, tests, lint, build**

Run: `npx tsc -p packages/plugin/tsconfig.json --noEmit && npm test && npm run build:plugin`
Expected: all pass. Also run `npx eslint packages/plugin/src` — clean.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/ui/dom.ts packages/plugin/src/ui/render.ts packages/plugin/src/ui/ui.ts
git commit -m "feat(plugin): presets-first theme settings with preset cards and font pickers"
```

---

### Task 6: Full verification + manual visual QA in Figma

**Files:** none (verification only; small value tweaks allowed).

- [ ] **Step 1: Full repo check**

Run: `npm run check`
Expected: lint, typecheck, tests, web build, and plugin build all pass.

- [ ] **Step 2: Manual QA in Figma (requires the user or a Figma session)**

Load the built plugin in Figma and verify, generating a Guidelines frame per preset:

1. Settings tab shows the 2x2 preset cards; Default is highlighted on first run (empty stored theme matches Default).
2. Each preset generates a frame with its palette, heading font (Lora / Space Grotesk / DM Sans actually render, not Inter), and corner style (Editorial fully square, Tech visibly rounder, Default/Warm unchanged radii).
3. Editing any hex field un-highlights all cards; the generated frame uses the custom value.
4. Font picker: opens on focus, filters while typing, arrow keys + Enter work, Esc closes, clicking a family commits it, "Default (Inter)" clears the override.
5. Typing a nonsense family shows the fallback hint and the generated frame uses Inter.
6. Reset to defaults returns to Default (highlighted card, blank fields, no hints).
7. An old saved theme from a previous plugin version still loads (spot-check: set a theme with the released build first if available).

- [ ] **Step 3: Tune values if needed**

If any preset looks off in the screenshots, adjust hex values / the round multiplier in `THEME_PRESETS` / `setCornerStyle` and update the matching test expectations. Commit tweaks as `style(plugin): tune theme preset values`.

- [ ] **Step 4: Final commit / branch state**

Confirm `git status` is clean and all work is committed on `plugin-3.0`.
