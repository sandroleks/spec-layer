# Grouped Sections → Three-Frame Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the plugin's ten doc sections into three groups (Usage / Specifications / Accessibility) that drive both a three-frame Figma output (wrapped in one Section) and a collapsible, tri-state config window.

**Architecture:** A single grouping map on `ALL_SECTIONS` is the source of truth. A pure `groupSections()` helper partitions the flat doc model into groups. The frame builder emits one frame per non-empty group inside a Figma `SectionNode`; the config window renders one collapsible group per `GROUPS` entry with a tri-state master checkbox.

**Tech Stack:** TypeScript, Figma Plugin API, Vitest. Two build targets (plugin sandbox `main.ts`, UI iframe `ui/*`). Package: `packages/plugin`.

## Global Constraints

- Group order everywhere: **Usage → Specifications → Accessibility**.
- Section→group map: `definition`,`variants`,`dosDonts`,`related` → `usage`; `anatomy`,`measurements`,`configuration`,`states`,`tokens` → `specs`; `accessibility` → `a11y`.
- Section (node) name: `` `${componentName}: Documentation` `` (e.g. `Button: Documentation`).
- Frame node names: the group label — `Usage`, `Specifications`, `Accessibility`.
- Frames laid **side by side**, left→right in group order, gap **80px**.
- No new AI calls, no new component instancing. Section-internal rendering is unchanged.
- No group descriptions in the config window. Accessibility stays a single-member group (no subsection split).
- Markdown export (`renderSpec`) stays flat — out of scope.
- Run the full plugin check suite (`pnpm --filter @spec-layer/plugin test`, plus lint/typecheck/build) — it must stay green (604 tests baseline).

---

### Task 1: Grouping map + `groupSections` helper

Adds the source-of-truth grouping metadata and the pure partition helper. No behavior change to existing callers yet (`buildDocModel` still returns the same shape after this task except the field rename in Task 2 — this task only adds the map + helper).

**Files:**
- Modify: `packages/plugin/src/ui/docModel.ts` (`SectionId` block ~7-22, add types/consts/helper near there)
- Test: `packages/plugin/test/docModel.test.ts`

**Interfaces:**
- Produces:
  - `type GroupId = 'usage' | 'specs' | 'a11y'`
  - `ALL_SECTIONS` entries gain `group: GroupId`
  - `const GROUPS: { id: GroupId; label: string }[]`
  - `interface DocGroup { id: GroupId; label: string; sections: SectionBlock[] }`
  - `function groupSections(sections: SectionBlock[]): DocGroup[]`

- [ ] **Step 1: Write the failing test**

Add to `packages/plugin/test/docModel.test.ts` (append a new `describe` block; `groupSections`, `GROUPS`, `ALL_SECTIONS` are imported from `../src/ui/docModel`):

```ts
import { groupSections, GROUPS, ALL_SECTIONS, type SectionBlock } from '../src/ui/docModel';

describe('groupSections', () => {
  const mk = (id: SectionBlock['id']): SectionBlock =>
    ({ id, heading: id, kind: 'prose', text: 'x' });

  it('every section id has a group', () => {
    for (const s of ALL_SECTIONS) {
      expect(['usage', 'specs', 'a11y']).toContain(s.group);
    }
  });

  it('partitions into the three groups in canonical order', () => {
    const groups = groupSections([
      mk('accessibility'), mk('states'), mk('definition'), mk('variants'),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['usage', 'specs', 'a11y']);
    expect(groups[0].sections.map((s) => s.id)).toEqual(['definition', 'variants']);
    expect(groups[1].sections.map((s) => s.id)).toEqual(['states']);
    expect(groups[2].sections.map((s) => s.id)).toEqual(['accessibility']);
  });

  it('omits groups with no sections', () => {
    const groups = groupSections([mk('definition')]);
    expect(groups.map((g) => g.id)).toEqual(['usage']);
  });

  it('GROUPS is Usage → Specifications → Accessibility', () => {
    expect(GROUPS.map((g) => g.label)).toEqual(['Usage', 'Specifications', 'Accessibility']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spec-layer/plugin test -- docModel`
Expected: FAIL — `groupSections`/`GROUPS` are not exported (import error or "is not a function").

- [ ] **Step 3: Implement the map, constants, and helper**

In `packages/plugin/src/ui/docModel.ts`, replace the `SectionId`/`ALL_SECTIONS` block (lines ~7-22) with:

```ts
export type SectionId =
  | 'definition' | 'anatomy' | 'measurements' | 'configuration' | 'variants'
  | 'states' | 'tokens' | 'accessibility' | 'dosDonts' | 'related';

export type GroupId = 'usage' | 'specs' | 'a11y';

export const ALL_SECTIONS: { id: SectionId; label: string; ai: boolean; group: GroupId }[] = [
  { id: 'definition',    label: 'Definition',    ai: true,  group: 'usage' },
  { id: 'anatomy',       label: 'Anatomy',       ai: true,  group: 'specs' },
  { id: 'measurements',  label: 'Measurements',  ai: false, group: 'specs' },
  { id: 'configuration', label: 'Configuration', ai: false, group: 'specs' },
  { id: 'variants',      label: 'Variants',      ai: true,  group: 'usage' },
  { id: 'states',        label: 'States',        ai: false, group: 'specs' },
  { id: 'tokens',        label: 'Tokens used',   ai: false, group: 'specs' },
  { id: 'accessibility', label: 'Accessibility', ai: true,  group: 'a11y'  },
  { id: 'dosDonts',      label: "Do's & Don'ts", ai: true,  group: 'usage' },
  { id: 'related',       label: 'Related atoms', ai: false, group: 'usage' },
];

/** The three output groups, in canonical display/build order. */
export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'usage', label: 'Usage' },
  { id: 'specs', label: 'Specifications' },
  { id: 'a11y',  label: 'Accessibility' },
];
```

Then add near the `DocFrameModel` declaration (after line ~110):

```ts
export interface DocGroup { id: GroupId; label: string; sections: SectionBlock[] }

/** Partition doc sections into their groups. Groups are emitted in GROUPS order;
 *  within a group, the input section order is preserved. Empty groups are omitted
 *  (this is what drives empty-frame skipping in the frame builder). */
export function groupSections(sections: SectionBlock[]): DocGroup[] {
  const groupOf = new Map<SectionId, GroupId>(ALL_SECTIONS.map((s) => [s.id, s.group]));
  return GROUPS
    .map(({ id, label }) => ({
      id, label,
      sections: sections.filter((s) => groupOf.get(s.id) === id),
    }))
    .filter((g) => g.sections.length > 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spec-layer/plugin test -- docModel`
Expected: PASS (all `groupSections` tests green; existing `buildDocModel` tests still green).

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/docModel.ts packages/plugin/test/docModel.test.ts
git commit -m "feat(plugin): section grouping map + groupSections helper"
```

---

### Task 2: Rename model field `title` → `componentName`

The frame Section name is now `` `${componentName}: Documentation` ``, so the model should carry the bare component name instead of the `"…: Guidelines"` title string. This is a focused rename across the model, its type, the message type, and the two builder-side consumers.

**Files:**
- Modify: `packages/plugin/src/ui/docModel.ts` (`DocFrameModel` ~110, `buildDocModel` return ~524)
- Modify: `packages/plugin/src/docFrame.ts` (`componentName` derivation ~1109, `frame.name` ~1134 — will be superseded in Task 3, but keep compiling)
- Modify: `packages/plugin/test/docModel.test.ts` (assertions on `model.title`)

**Interfaces:**
- Consumes: `DocFrameModel` from Task 1.
- Produces: `interface DocFrameModel { componentName: string; sections: SectionBlock[] }`; `buildDocModel` returns `{ componentName: spec.name, sections }`.

- [ ] **Step 1: Update the failing test**

In `packages/plugin/test/docModel.test.ts`, change the two `model.title` assertions. Find:

```ts
    expect(model.title).toBe('Button: Guidelines');
```

Replace with:

```ts
    expect(model.componentName).toBe('Button');
```

(There is one such assertion in the "emits only selected sections" test; search the file for `.title` and update every occurrence to `.componentName` with the bare name `'Button'`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spec-layer/plugin test -- docModel`
Expected: FAIL — `model.componentName` is `undefined` (still `title`).

- [ ] **Step 3: Implement the rename**

In `packages/plugin/src/ui/docModel.ts`:

Change the interface (line ~110):

```ts
export interface DocFrameModel { componentName: string; sections: SectionBlock[] }
```

Change the `buildDocModel` return (line ~524):

```ts
  return { componentName: spec.name, sections: out };
```

In `packages/plugin/src/docFrame.ts`, replace the title-derived name (lines ~1109 and ~1134). Find:

```ts
  const componentName = model.title.replace(/:\s*Guidelines$/i, '');
```

Replace with:

```ts
  const componentName = model.componentName;
```

And find:

```ts
  frame.name = model.title;
```

Replace with:

```ts
  frame.name = componentName;
```

(This keeps `docFrame.ts` compiling; Task 3 replaces this function wholesale.)

- [ ] **Step 4: Run test + typecheck to verify green**

Run: `pnpm --filter @spec-layer/plugin test -- docModel && pnpm --filter @spec-layer/plugin typecheck`
Expected: PASS; typecheck clean (message type in Task 3 covers `main.ts` — if typecheck flags `msg.model.title` in `main.ts`, that reference is removed in Task 3; if it blocks here, apply the Task 3 `main.ts` edit early).

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/docModel.ts packages/plugin/src/docFrame.ts packages/plugin/test/docModel.test.ts
git commit -m "refactor(plugin): DocFrameModel carries componentName, not title"
```

---

### Task 3: Emit three frames wrapped in a Section

Replaces the single-frame `buildDocFrame` with `buildDocFrames`, which runs the one-time setup, lifts the definition lead into the Usage subtitle, builds one frame per non-empty group via an extracted `buildGroupFrame`, and wraps them side-by-side in a `SectionNode`. Also parameterizes the header eyebrow with the group label, and updates `main.ts` to place the Section. No unit tests (Figma-API-bound); covered by the manual matrix in Task 5.

**Files:**
- Modify: `packages/plugin/src/docFrame.ts` (`buildHeader` ~934, `buildDocFrame` ~1057-1185)
- Modify: `packages/plugin/src/main.ts` (`renderDocFrame` handler ~258-312, import ~6)

**Interfaces:**
- Consumes: `DocFrameModel` (Task 2), `groupSections`/`DocGroup`/`GROUPS` (Task 1).
- Produces:
  - `buildHeader(componentName, subtitleMd, eyebrow, logoBase64?)` — new `eyebrow` param.
  - `buildGroupFrame(group: DocGroup, componentName: string, subtitle: string | null, logoBase64?: string | null): Promise<FrameNode>`
  - `export async function buildDocFrames(model, theme, logo?): Promise<SectionNode>` (replaces `buildDocFrame`).

- [ ] **Step 1: Parameterize the header eyebrow**

In `packages/plugin/src/docFrame.ts`, change `buildHeader` (line ~934) signature and the hard-coded eyebrow (line ~951). Find:

```ts
async function buildHeader(
  componentName: string,
  subtitleMd: string | null,
  logoBase64?: string | null,
): Promise<FrameNode> {
```

Replace with:

```ts
async function buildHeader(
  componentName: string,
  subtitleMd: string | null,
  eyebrow: string,
  logoBase64?: string | null,
): Promise<FrameNode> {
```

Find:

```ts
  const eyebrow = makeText('GUIDELINES', 'Medium', 12, palette.onHeaderMuted);
```

Replace with (rename the local to avoid shadowing the new param):

```ts
  const eyebrowNode = makeText(eyebrow.toUpperCase(), 'Medium', 12, palette.onHeaderMuted);
```

Then update the three later references to the old local `eyebrow` node in `buildHeader` (the `row.appendChild(eyebrow)` / `eyebrow.layoutSizingHorizontal` / `band.appendChild(eyebrow)` / `tmp.push(eyebrow)` lines ~957-973) to use `eyebrowNode`.

- [ ] **Step 2: Extract `buildGroupFrame` and add `buildDocFrames`**

In `packages/plugin/src/docFrame.ts`, first add `groupSections` (value) and `DocGroup` (type) to the **existing** import from `./ui/docModel` (the line that already brings in `DocFrameModel` / `SectionBlock`). Then replace the entire `buildDocFrame` function (lines ~1057-1185) with the following two functions. This reuses the existing root-card + content-loop body verbatim, moved into `buildGroupFrame`, and hoists the one-time setup into `buildDocFrames`:

```ts
/** Build one group's frame: root card + header band + content column. */
async function buildGroupFrame(
  group: DocGroup,
  componentName: string,
  subtitle: string | null,
  logoBase64?: string | null,
): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = group.label; // "Usage" | "Specifications" | "Accessibility"
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'FIXED';
  frame.itemSpacing = 0;
  frame.fills = solidFill(palette.bg);
  frame.cornerRadius = 16;
  frame.clipsContent = true;
  frame.strokes = solidFill(palette.border);
  frame.strokeWeight = 1;
  frame.resize(CARD_WIDTH, frame.height);
  frame.effects = [
    {
      type: 'DROP_SHADOW',
      color: { r: 0.06, g: 0.09, b: 0.16, a: 0.08 },
      offset: { x: 0, y: 12 },
      radius: 32,
      spread: 0,
      visible: true,
      blendMode: 'NORMAL',
    },
  ];

  try {
    const header = await buildHeader(componentName, subtitle, group.label, logoBase64);
    frame.appendChild(header);
    header.layoutSizingHorizontal = 'FILL';

    const content = vstack(40);
    content.paddingTop = 48;
    content.paddingBottom = 56;
    content.paddingLeft = PAD_X;
    content.paddingRight = PAD_X;
    frame.appendChild(content);
    content.layoutSizingHorizontal = 'FILL';

    for (const section of group.sections) {
      const built = await buildSection(section);
      content.appendChild(built);
      built.layoutSizingHorizontal = 'FILL';
    }
  } catch (err) {
    frame.remove();
    throw err;
  }

  return frame;
}

/** Lift the definition's lead sentence into a header subtitle. Returns the
 *  subtitle plus the section list with the definition block rewritten to its
 *  remainder (or dropped if fully lifted). Mirrors the pre-split behavior. */
function liftDefinitionLead(
  sections: SectionBlock[],
): { subtitle: string | null; sections: SectionBlock[] } {
  const def = sections.find(
    (s) => s.id === 'definition' && s.kind === 'prose',
  ) as Extract<SectionBlock, { kind: 'prose' }> | undefined;
  if (!def) return { subtitle: null, sections };
  if (emphasisOnly(def.text) !== null) return { subtitle: null, sections }; // placeholder
  const { lead, rest } = splitLead(def.text);
  const rebuilt = sections.flatMap((s) =>
    s === def
      ? (rest ? [{ ...def, kind: 'prose' as const, text: rest }] : [])
      : [s],
  );
  return { subtitle: lead || null, sections: rebuilt };
}

export async function buildDocFrames(
  model: DocFrameModel,
  theme: ReturnType<typeof resolveTheme>,
  logoBase64?: string | null,
): Promise<SectionNode> {
  resetTokenResolveCaches();

  palette.headerBg = hex(theme.headerBg);
  palette.accent = hex(theme.accent);
  palette.body = hex(theme.bodyText);
  palette.tableHeadBg = hex(theme.tableHeadBg);

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
    tryFamily(theme.headingFont),
    tryFamily(theme.bodyFont),
  ]);
  setFontFamilies(headingFam, bodyFam);

  await Promise.all(
    (['Regular', 'Medium', 'Bold'] as FontStyle[]).map((style) =>
      figma.loadFontAsync({ family: 'Inter', style })),
  );

  // Shared width across all frames — measured over the full (flat) model.
  fitFrameWidthToTokens(model);

  const componentName = model.componentName;

  // Definition lead → Usage subtitle. Fall back to keeping the definition as a
  // body section if lifting would leave nothing to render.
  let { subtitle, sections } = liftDefinitionLead(model.sections);
  let groups = groupSections(sections);
  if (groups.length === 0 && model.sections.length > 0) {
    subtitle = null;
    groups = groupSections(model.sections);
  }
  if (groups.length === 0) throw new Error('No sections selected.');

  // Build frames (auto-appended to the page by createFrame), then wrap + lay out.
  const GAP = 80;
  const frames: FrameNode[] = [];
  try {
    for (const group of groups) {
      const sub = group.sections.some((s) => s.id === 'definition') ? subtitle : null;
      frames.push(await buildGroupFrame(group, componentName, sub, logoBase64));
    }

    const section = figma.createSection();
    section.name = `${componentName}: Documentation`;
    let cursorX = 0;
    for (const frame of frames) {
      section.appendChild(frame);
      frame.x = cursorX;
      frame.y = 0;
      cursorX += frame.width + GAP;
    }
    return section;
  } catch (err) {
    for (const f of frames) f.remove(); // never litter the canvas on failure
    throw err;
  }
}
```

- [ ] **Step 3: Update `main.ts` to place the Section**

In `packages/plugin/src/main.ts`, change the import (line ~6):

```ts
import { buildDocFrames } from './docFrame';
```

Replace the body of the `renderDocFrame` handler (lines ~260-306) with a version that finds/places a `SECTION` named `` `${componentName}: Documentation` ``:

```ts
        const sectionName = `${msg.model.componentName}: Documentation`;

        // Find any prior doc Section with this name BEFORE creating the new one.
        // Scan only top-level children (a deep find can hit node types the API
        // can't resolve); the per-node try/catch keeps one bad child from aborting.
        let existing: SectionNode | null = null;
        for (const child of figma.currentPage.children) {
          try {
            if (child.type === 'SECTION' && child.name === sectionName) {
              existing = child;
              break;
            }
          } catch {
            /* skip a child whose type can't be resolved by this API version */
          }
        }

        let x = 0, y = 0;
        if (existing) {
          x = existing.x; y = existing.y;
        } else {
          try {
            const comp = await figma.getNodeByIdAsync(msg.nodeId);
            if (comp && 'x' in comp && 'width' in comp) {
              const c = comp as SceneNode & { x: number; y: number; width: number };
              x = c.x + c.width + 80; y = c.y;
            }
          } catch {
            /* node gone since extract — fall back to origin */
          }
        }

        const section = await buildDocFrames(msg.model, resolveTheme(brandTheme), brandLogo);
        if (existing) existing.remove();
        figma.currentPage.appendChild(section);
        section.x = x; section.y = y;
        figma.currentPage.selection = [section];
        figma.viewport.scrollAndZoomIntoView([section]);
        figma.ui.postMessage({ type: 'docFrameDone', frameName: section.name } as MainToUi);
```

- [ ] **Step 4: Typecheck, build, and full test suite**

Run: `pnpm --filter @spec-layer/plugin typecheck && pnpm --filter @spec-layer/plugin build && pnpm --filter @spec-layer/plugin test`
Expected: typecheck clean, both builds succeed, all tests PASS (604 baseline). If `SectionNode`/`FontStyle` type names differ, resolve against the Figma typings already imported in the file.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/docFrame.ts packages/plugin/src/main.ts
git commit -m "feat(plugin): emit Usage/Specs/Accessibility frames in a Section"
```

---

### Task 4: Config window — collapsible groups with tri-state masters

Wrap the section rows in three collapsible group containers, each with a master checkbox (tri-state) and a live count, and add a zero-selection guard on generate. Selection state stays a flat per-section set. The existing anatomy/measure disclosures continue to nest under their rows.

**Files:**
- Modify: `packages/plugin/src/ui/dom.ts` (styles ~433-457, `Refs` ~828-853, `mount` group build ~918-969, refs return ~1001)
- Modify: `packages/plugin/src/ui/ui.ts` (select-all ~165-170, add group wiring)
- Modify: `packages/plugin/src/ui/actions.ts` (`runCreateDocFrame` guard ~206-230)

**Interfaces:**
- Consumes: `GROUPS`, `ALL_SECTIONS`, `GroupId` (Task 1).
- Produces on `Refs`: `groupChecks: Record<string, HTMLInputElement>`, `groupCounts: Record<string, HTMLElement>`, `groupContainers: Record<string, HTMLElement>`.

- [ ] **Step 1: Build grouped markup in `mount()`**

In `packages/plugin/src/ui/dom.ts`, add `GROUPS` to the existing import from `./docModel` (the file already imports `ALL_SECTIONS`). Then replace the section-list build loop (lines ~918-945) with a grouped build. Find the block starting `const sectionList = byId<HTMLDivElement>('section-list');` through the loop that appends each `group` to `sectionList`, and replace with:

```ts
  const sectionList = byId<HTMLDivElement>('section-list');
  const groupChecks: Record<string, HTMLInputElement> = {};
  const groupCounts: Record<string, HTMLElement> = {};
  const groupContainers: Record<string, HTMLElement> = {};

  for (const grp of GROUPS) {
    const container = document.createElement('div');
    container.className = 'sec-groupbox';
    container.dataset.group = grp.id;

    const head = document.createElement('div');
    head.className = 'sec-grouphead';

    const master = document.createElement('input');
    master.type = 'checkbox';
    master.className = 'group-check';
    master.id = `group-${grp.id}`;
    master.setAttribute('aria-label', `Toggle all ${grp.label} sections`);

    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.setAttribute('aria-hidden', 'true');
    chev.innerHTML =
      '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const name = document.createElement('span');
    name.className = 'group-name';
    name.textContent = grp.label;

    const count = document.createElement('span');
    count.className = 'group-count';

    head.appendChild(master);
    head.appendChild(chev);
    head.appendChild(name);
    head.appendChild(count);

    const body = document.createElement('div');
    body.className = 'sec-groupbody';

    for (const section of ALL_SECTIONS.filter((s) => s.group === grp.id)) {
      const group = document.createElement('div');
      group.className = 'sec-group';

      const row = document.createElement('div');
      row.className = 'sec-row';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `sec-${section.id}`;
      input.checked = section.id !== 'related';

      const label = document.createElement('label');
      label.htmlFor = input.id;
      label.textContent = section.label;
      if (section.ai) {
        const badge = document.createElement('span');
        badge.className = 'ai-badge';
        badge.textContent = 'AI';
        label.appendChild(badge);
      }

      row.appendChild(input);
      row.appendChild(label);
      group.appendChild(row);
      body.appendChild(group);
    }

    container.appendChild(head);
    container.appendChild(body);
    sectionList.appendChild(container);

    groupChecks[grp.id] = master;
    groupCounts[grp.id] = count;
    groupContainers[grp.id] = container;
  }
```

- [ ] **Step 2: Add the group refs to the `Refs` interface and return**

In `packages/plugin/src/ui/dom.ts`, add to the `Refs` interface (after `sectionChecks` ~852):

```ts
  groupChecks: Record<string, HTMLInputElement>;
  groupCounts: Record<string, HTMLElement>;
  groupContainers: Record<string, HTMLElement>;
```

And in the refs object returned by `mount()` (near `sectionChecks,` ~1001), add:

```ts
    groupChecks,
    groupCounts,
    groupContainers,
```

- [ ] **Step 3: Add group styles**

In `packages/plugin/src/ui/dom.ts`, in the `<style>` block near the section-list styles (~444), add:

```css
    .sec-groupbox { border: 1px solid var(--figma-color-border); border-radius: 10px; margin-bottom: 8px; overflow: hidden; }
    .sec-grouphead { display: flex; align-items: center; gap: 8px; padding: 9px 10px; cursor: pointer; user-select: none; background: var(--figma-color-bg-secondary); }
    .sec-grouphead:hover { background: var(--figma-color-bg-tertiary); }
    .sec-grouphead .chev { flex: 0 0 auto; width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; color: var(--figma-color-text-secondary); transition: transform .16s ease; }
    .sec-groupbox.collapsed .chev { transform: rotate(-90deg); }
    .group-name { flex: 1; font-weight: 600; font-size: 12px; }
    .group-count { font-size: 10.5px; color: var(--figma-color-text-secondary); background: var(--figma-color-bg); border: 1px solid var(--figma-color-border); border-radius: 999px; padding: 1px 7px; }
    .sec-groupbody { padding: 4px 6px 6px; }
    .sec-groupbox.collapsed .sec-groupbody { display: none; }
    /* indeterminate master checkbox: a horizontal bar */
    .sec-grouphead input.group-check { appearance: none; -webkit-appearance: none; margin: 0; width: 15px; height: 15px; flex: 0 0 auto; position: relative; cursor: pointer; border: 1.5px solid var(--figma-color-border); border-radius: 4px; background: var(--figma-color-bg); }
    .sec-grouphead input.group-check:hover { border-color: var(--figma-color-bg-brand); }
    .sec-grouphead input.group-check:checked, .sec-grouphead input.group-check:indeterminate { background: var(--figma-color-bg-brand); border-color: var(--figma-color-bg-brand); }
    .sec-grouphead input.group-check:checked::after { content: ""; position: absolute; left: 4.5px; top: 1.5px; width: 4px; height: 8px; box-sizing: border-box; border: solid var(--figma-color-text-onbrand); border-width: 0 2px 2px 0; transform: rotate(45deg); }
    .sec-grouphead input.group-check:indeterminate::after { content: ""; position: absolute; left: 3px; top: 6px; width: 7px; border-top: 2px solid var(--figma-color-text-onbrand); }
    .sec-grouphead input.group-check:focus-visible { outline: 2px solid var(--figma-color-bg-brand); outline-offset: 1px; }
```

- [ ] **Step 4: Wire group behavior in `ui.ts`**

In `packages/plugin/src/ui/ui.ts`, add after the existing `selectAllBtn` handler (~170) a group-sync block. This defines `syncGroup`/`syncAllGroups`, wires each master + collapse, and resyncs on any section change:

```ts
// ---- Group masters (tri-state) + collapse ----
function sectionsInGroup(groupId: string): HTMLInputElement[] {
  return ALL_SECTIONS
    .filter((s) => s.group === groupId)
    .map((s) => refs.sectionChecks[s.id])
    .filter(Boolean) as HTMLInputElement[];
}

function syncGroup(groupId: string): void {
  const kids = sectionsInGroup(groupId);
  const on = kids.filter((c) => c.checked).length;
  const master = refs.groupChecks[groupId];
  if (master) {
    master.checked = on === kids.length && on > 0;
    master.indeterminate = on > 0 && on < kids.length;
  }
  const count = refs.groupCounts[groupId];
  if (count) count.textContent = `${on}/${kids.length}`;
}

function syncAllGroups(): void {
  for (const g of GROUPS) syncGroup(g.id);
}

for (const g of GROUPS) {
  const master = refs.groupChecks[g.id];
  master?.addEventListener('change', () => {
    for (const c of sectionsInGroup(g.id)) {
      if (c.checked !== master.checked) {
        c.checked = master.checked;
        c.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    syncGroup(g.id);
  });

  // Collapse on header click, except when the click lands on the master checkbox.
  const head = refs.groupContainers[g.id]?.querySelector('.sec-grouphead');
  head?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.group-check')) return;
    refs.groupContainers[g.id]?.classList.toggle('collapsed');
  });
}

// Any section checkbox change re-syncs its group's master + count.
byId<HTMLElement>('section-list').addEventListener('change', (e) => {
  const t = e.target as HTMLElement;
  if (t instanceof HTMLInputElement && t.id.startsWith('sec-')) syncAllGroups();
});

syncAllGroups(); // initial state
```

Note: `ALL_SECTIONS`, `GROUPS`, and `byId` must be imported in `ui.ts` if not already — check the existing imports from `./docModel` and `./dom` and add the missing names.

Also update the existing **select-all** handler (lines ~165-170) to resync groups after toggling. Find:

```ts
refs.selectAllBtn.addEventListener('click', () => {
  const checks = Object.values(refs.sectionChecks);
  const allOn = checks.every((c) => c.checked);
  for (const c of checks) c.checked = !allOn;
  refs.selectAllBtn.textContent = allOn ? 'Select all' : 'Clear all';
});
```

Replace with:

```ts
refs.selectAllBtn.addEventListener('click', () => {
  const checks = Object.values(refs.sectionChecks);
  const allOn = checks.every((c) => c.checked);
  for (const c of checks) {
    if (c.checked === allOn) {
      c.checked = !allOn;
      c.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  refs.selectAllBtn.textContent = allOn ? 'Select all' : 'Clear all';
  syncAllGroups();
});
```

- [ ] **Step 5: Guard zero-selection in `actions.ts`**

In `packages/plugin/src/ui/actions.ts`, inside `runCreateDocFrame`, after the `selected` set is built (after line ~230), add a guard:

```ts
    if (selected.size === 0) {
      showBanner(refs, 'error', 'Select at least one section.');
      refs.createFrameBtn.disabled = false;
      stopLoader(refs);
      return;
    }
```

(Place it after the `for … selected.add(id)` loop and before the `variantIds` block. `showBanner`, `stopLoader`, and `refs.createFrameBtn` are already used in this file.)

- [ ] **Step 6: Typecheck, build, test**

Run: `pnpm --filter @spec-layer/plugin typecheck && pnpm --filter @spec-layer/plugin build && pnpm --filter @spec-layer/plugin test`
Expected: clean typecheck, successful UI build, all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/ui/dom.ts packages/plugin/src/ui/ui.ts packages/plugin/src/ui/actions.ts
git commit -m "feat(plugin): collapsible section groups with tri-state masters"
```

---

### Task 5: Manual Figma verification matrix

No code — this is the human canvas test that the automated suite can't cover (Figma-API layout). Run in Figma desktop with the plugin loaded from the `plugin-2.0` build.

**Files:** none.

- [ ] **Step 1: Build the plugin for manual load**

Run: `pnpm --filter @spec-layer/plugin build`
Expected: `packages/plugin/dist` updated (manifest points at `dist/`).

- [ ] **Step 2: Run the canvas matrix**

Load the plugin in Figma desktop, select a component set (e.g. Button), and verify each:

- [ ] Generate emits **one Section** named `<Component>: Documentation` containing three frames: `Usage`, `Specifications`, `Accessibility`, left→right with ~80px gaps.
- [ ] Each frame's header eyebrow shows the group label; only Usage shows the definition-lead subtitle.
- [ ] All three frames share the same width; token chips in Specs are not clipped.
- [ ] Regenerating the same component **replaces** the prior Section in place (no duplicate), reusing its position.
- [ ] Empty-group skipping: clear every Specifications section → output has only Usage + Accessibility frames, no empty Specs frame.
- [ ] Single-group case: select only Usage sections → one frame, still wrapped in the Section.
- [ ] Zero-selection: clear all → generate shows "Select at least one section." banner, no frame built.
- [ ] Config window: group masters go tri-state correctly; collapsing a group hides its rows without changing selection; anatomy view toggle + measure lenses still appear under their rows.
- [ ] Variable-mode fidelity: measure/anatomy/matrix instances resolve at correct padding/gap in all frames (no offset/overhang regressions).
- [ ] Themed build (custom brand colors/fonts) and default build both render across all three frames.

- [ ] **Step 3: Record results**

Note any failures against the responsible task and fix before merge. When green, the feature is ready to fold into the `plugin-2.0` release checklist.

---

## Notes for the release checklist (not tasks here)

- Update `plugin-2.0` hero screenshots to show the three-frame Section.
- The `plugin-2-0-release-status` memory's pending list (manual test, version bump, listing) now also covers this change.
