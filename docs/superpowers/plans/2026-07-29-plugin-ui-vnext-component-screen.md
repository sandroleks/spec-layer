# Phase 2: Finish the component docs screen

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `Generate component docs` to parity with the legacy tab, so a user on the new shell can produce the same document the old one produces.

**Architecture:** Everything the screen needs to know about the selected component that is not in `ComponentScreenState` becomes one derived value, `ComponentFacts`, computed by a pure function from the extracted spec. The screen renders from `(state, selection, facts)` and nothing else. Selection grows to hold variant ids, which `build()` already has a slot for.

**Tech Stack:** TypeScript, esbuild, Vitest. No framework, no new dependencies.

## Global Constraints

- **No new runtime dependencies.** The plugin ships as one embedded `ui.html`.
- **No jsdom.** Pure functions get unit tests; markup is verified by rendering in the harness and reading it back.
- **Legacy stays default.** `node build.mjs` with no flag must still emit the legacy UI. Only `UI_VNEXT=1` builds the new shell.
- **Coverage is a ratchet** (`vitest.config.ts`: statements 45, branches 40, functions 50, lines 45). It may only go up.
- **Voice:** never em dashes in user-facing plugin copy. Plain, honest, peer tone. Rules in `docs/plugin-voice-and-copy.md`.
- **Do not modify `docModel.ts`.** Its `ALL_SECTIONS` labels are also the generated frame headings. Renaming `Content Considerations` to sentence case would silently change every document the plugin produces, so it is a product decision held outside this phase, not a styling fix.
- **Every string in this phase is moved from the legacy UI, not invented.** Where a new string is genuinely required, this plan gives its exact text.

**Scope:** Phase 2 of `docs/superpowers/plans/2026-07-29-plugin-ui-vnext-roadmap.md`.
**Depends on:** Phase 1 (`2026-07-29-plugin-ui-vnext-decoupling.md`), specifically `downloadDoc` from its Task 3 and the widened `BuildPresenter` from its Task 1.

## What is missing, and why each matters

| Gap | Consequence today |
|---|---|
| Variant token picking | `build()` sends an empty `variantIds`, so per-variant token tables never appear. The legacy tab has this. |
| `Download` inert | The button appears on success and does nothing. |
| Atom notice | Legacy tells the user a selected atom is normally used inside larger components. The new screen does not. |
| States hint | Legacy disables and unchecks `States` when the component has no state axis. The new screen offers a section it cannot fill. |
| Group bulk action | `sectionIdsInGroup` exists, unused. Group headers cannot select or clear their rows. |

---

### Task 1: Derive the facts the screen is missing

Three of the five gaps need the same thing: something read off the extracted
spec that `ComponentScreenState` does not carry. One pure function supplies all
three, so the screen keeps taking data rather than reaching for `state`.

**Files:**
- Create: `packages/plugin/src/ui/viewModel/componentFacts.ts`
- Test: `packages/plugin/test/componentFacts.test.ts`

**Interfaces:**
- Produces:
  - `interface VariantChip { text: string; axis?: string; tone: 'value' | 'flag' | 'muted'; title: string }`
  - `interface VariantRowView { nodeId: string; chips: VariantChip[] }`
  - `interface ComponentFacts { isAtom: boolean; hasStates: boolean; variants: VariantRowView[]; defaultVariantIds: Set<string> }`
  - `const NO_FACTS: ComponentFacts`
  - `function componentFacts(spec: IntermediateSpec | null, nodeName: string): ComponentFacts`

- [ ] **Step 1: Write the failing test**

Create `packages/plugin/test/componentFacts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { IntermediateSpec } from '@spec-layer/extractor';
import { componentFacts, NO_FACTS } from '../src/ui/viewModel/componentFacts';

/** The smallest spec shape these facts read. Everything else is irrelevant here. */
function spec(over: Partial<IntermediateSpec> = {}): IntermediateSpec {
  return {
    name: 'Button',
    props: [],
    variants: [],
    variantInstances: [],
    ...over,
  } as unknown as IntermediateSpec;
}

describe('componentFacts', () => {
  it('reports nothing usable when no spec has been extracted', () => {
    expect(componentFacts(null, 'Button')).toEqual(NO_FACTS);
  });

  it('flags an atom from its name, the same rule the legacy notice used', () => {
    expect(componentFacts(spec(), '.Button base').isAtom).toBe(true);
    expect(componentFacts(spec(), 'Button').isAtom).toBe(false);
  });

  it('has no states when no variant axis looks like a state', () => {
    expect(componentFacts(spec(), 'Button').hasStates).toBe(false);
  });

  it('renders an enum axis as an attributed chip', () => {
    const facts = componentFacts(
      spec({ variantInstances: [{ nodeId: '1:2', values: { Size: 'Small' } }] as never }),
      'Button',
    );
    expect(facts.variants).toHaveLength(1);
    expect(facts.variants[0].chips).toEqual([
      { text: 'Small', axis: 'Size', tone: 'value', title: 'Size: Small' },
    ]);
  });

  it('renders a true boolean as a flag named after its axis', () => {
    const facts = componentFacts(
      spec({ variantInstances: [{ nodeId: '1:2', values: { Disabled: 'true' } }] as never }),
      'Button',
    );
    expect(facts.variants[0].chips).toEqual([
      { text: 'Disabled', tone: 'flag', title: 'Disabled: true' },
    ]);
  });

  it('drops a false boolean as noise, and never leaves a row with no chip', () => {
    const facts = componentFacts(
      spec({ variantInstances: [{ nodeId: '1:2', values: { Disabled: 'false' } }] as never }),
      'Button',
    );
    expect(facts.variants[0].chips).toEqual([
      { text: 'Default', tone: 'muted', title: 'Default' },
    ]);
  });

  it('preselects the default variant, so a build is never empty by accident', () => {
    const facts = componentFacts(
      spec({
        props: [{ kind: 'variant', name: 'Size', default: 'Medium' }] as never,
        variantInstances: [
          { nodeId: '1:1', values: { Size: 'Small' } },
          { nodeId: '1:2', values: { Size: 'Medium' } },
        ] as never,
      }),
      'Button',
    );
    expect([...facts.defaultVariantIds]).toEqual(['1:2']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/plugin/test/componentFacts.test.ts`
Expected: FAIL, cannot resolve `../src/ui/viewModel/componentFacts`.

- [ ] **Step 3: Write the implementation**

Create `packages/plugin/src/ui/viewModel/componentFacts.ts`:

```ts
/**
 * componentFacts.ts — what the screen needs to know about the selection.
 *
 * `ComponentScreenState` carries the component's name and where the build got
 * to. Three parts of the screen need more than that: the atom notice, the
 * States row, and the variant picker all read the extracted spec. Deriving
 * them once, here, keeps the screen a function of its inputs and keeps this
 * logic testable without a DOM.
 */

import { detectStateMatrix, type IntermediateSpec } from '@spec-layer/extractor';
import { isAtomComponentName } from '../../collectComponents';
import { defaultVariantId } from '../docModel';

export interface VariantChip {
  /** What the chip reads. */
  text: string;
  /** The axis name, shown as a muted prefix. Absent on flag and muted chips. */
  axis?: string;
  tone: 'value' | 'flag' | 'muted';
  /** The full axis and value, for the chip's tooltip. */
  title: string;
}

export interface VariantRowView {
  nodeId: string;
  chips: VariantChip[];
}

export interface ComponentFacts {
  isAtom: boolean;
  hasStates: boolean;
  variants: VariantRowView[];
  defaultVariantIds: Set<string>;
}

/** Before extraction finishes there are no facts, and the screen must not guess. */
export const NO_FACTS: ComponentFacts = {
  isAtom: false,
  hasStates: false,
  variants: [],
  defaultVariantIds: new Set<string>(),
};

/**
 * One variant's chips.
 *
 * An enum value keeps its axis so "Default" stays attributed to the property it
 * came from. A true boolean renders as a flag named after the axis, since the
 * value is implied. A false boolean is dropped as noise, which can empty a row,
 * so a row with nothing left says "Default" rather than rendering blank.
 */
function chipsFor(values: Record<string, string>): VariantChip[] {
  const chips: VariantChip[] = [];
  for (const [axis, value] of Object.entries(values)) {
    const low = value.toLowerCase();
    if (low === 'false') continue;
    if (low === 'true') chips.push({ text: axis, tone: 'flag', title: `${axis}: ${value}` });
    else chips.push({ text: value, axis, tone: 'value', title: `${axis}: ${value}` });
  }
  if (chips.length === 0) return [{ text: 'Default', tone: 'muted', title: 'Default' }];
  return chips;
}

export function componentFacts(
  spec: IntermediateSpec | null,
  nodeName: string,
): ComponentFacts {
  if (!spec) return NO_FACTS;
  const defaultId = defaultVariantId(spec);
  return {
    isAtom: isAtomComponentName(nodeName),
    hasStates: Boolean(detectStateMatrix(spec.variants)),
    variants: spec.variantInstances.map((inst) => ({
      nodeId: inst.nodeId,
      chips: chipsFor(inst.values),
    })),
    defaultVariantIds: new Set(defaultId ? [defaultId] : []),
  };
}
```

If `detectStateMatrix` or `IntermediateSpec` is not exported from
`@spec-layer/extractor`, take the same import path `render.ts:16-19` uses.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/plugin/test/componentFacts.test.ts && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/viewModel/componentFacts.ts packages/plugin/test/componentFacts.test.ts
git commit -m "feat(plugin): derive the component facts the vNext screen needs"
```

---

### Task 2: Show the atom notice and the States availability

The screen takes facts as a fourth argument. Two gaps close at once, and the
harness gains a way to paint them.

**Files:**
- Modify: `packages/plugin/src/ui/viewModel/contracts.ts`
- Modify: `packages/plugin/src/ui/viewModel/componentScreen.ts`
- Modify: `packages/plugin/src/ui/screens/component.ts`
- Modify: `packages/plugin/src/ui/ui-vnext.ts`
- Modify: `packages/plugin/src/ui/harness.ts`
- Test: `packages/plugin/test/componentScreen.test.ts`

**Interfaces:**
- Consumes: `ComponentFacts`, `NO_FACTS` from Task 1.
- Produces:
  - `SectionOption` gains `note?: string`.
  - `sectionGroups(selected, expanded, aiEnabled, unavailable?: ReadonlySet<SectionId>)`.
  - `componentScrollMarkup(state, selection, facts)`, `renderComponentScreen(refs, state, selection, facts)`.
  - `unavailableSections(facts: ComponentFacts): Set<SectionId>`.

- [ ] **Step 1: Write the failing test**

Append to `packages/plugin/test/componentScreen.test.ts`:

```ts
import { componentScrollMarkup } from '../src/ui/screens/component';
import { createComponentSelection } from '../src/ui/screens/component';
import { unavailableSections } from '../src/ui/viewModel/componentScreen';
import { NO_FACTS, type ComponentFacts } from '../src/ui/viewModel/componentFacts';

const READY = { kind: 'ready', componentName: 'Button' } as const;

function facts(over: Partial<ComponentFacts> = {}): ComponentFacts {
  return { ...NO_FACTS, ...over };
}

describe('unavailableSections', () => {
  it('marks States unavailable when the component has no state axis', () => {
    expect([...unavailableSections(facts({ hasStates: false }))]).toEqual(['states']);
  });

  it('marks nothing unavailable when states are detected', () => {
    expect(unavailableSections(facts({ hasStates: true })).size).toBe(0);
  });
});

describe('sectionGroups with unavailable sections', () => {
  it('disables the row and explains why, rather than dropping it', () => {
    const groups = sectionGroups(
      defaultSections(), ALL_GROUPS, true, new Set(['states'] as const),
    );
    const states = groups
      .flatMap((g) => g.options)
      .find((o) => o.id === 'states')!;
    expect(states.disabled).toBe(true);
    expect(states.note).toBe('none detected');
  });

  it('does not count an unavailable section as included', () => {
    const groups = sectionGroups(
      defaultSections(), ALL_GROUPS, true, new Set(['states'] as const),
    );
    const specs = groups.find((g) => g.id === 'specs')!;
    expect(specs.options.find((o) => o.id === 'states')!.selected).toBe(false);
  });
});

describe('the atom notice', () => {
  it('appears only for an atom', () => {
    const selection = createComponentSelection(true);
    const on = componentScrollMarkup(READY, selection, facts({ isAtom: true }));
    const off = componentScrollMarkup(READY, selection, facts({ isAtom: false }));
    expect(on).toContain('Atom component');
    expect(off).not.toContain('Atom component');
  });

  it('is a quiet banner, not a warning', () => {
    const markup = componentScrollMarkup(
      READY, createComponentSelection(true), facts({ isAtom: true }),
    );
    expect(markup).toContain('data-tone="neutral"');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/plugin/test/componentScreen.test.ts`
Expected: FAIL, `unavailableSections` is not exported and `sectionGroups` takes
three arguments.

- [ ] **Step 3: Add `note` to the contract**

In `viewModel/contracts.ts`, replace the `SectionOption` interface with:

```ts
export interface SectionOption {
  id: string;
  label: string;
  aiCapable: boolean;
  selected: boolean;
  disabled?: boolean;
  /**
   * Why this row is disabled, shown as a muted suffix after the label. The
   * label itself never changes: a row that reads something other than its
   * section name is a row the user cannot match to the document it produces.
   */
  note?: string;
}
```

- [ ] **Step 4: Extend the view model**

In `viewModel/componentScreen.ts`, add the import and the new function at the
end of the file:

```ts
import type { ComponentFacts } from './componentFacts';

/**
 * Sections the current component cannot fill.
 *
 * States is the only one today: with no state-like variant axis there is
 * nothing to tabulate, and offering the section would promise a table that
 * comes back empty.
 */
export function unavailableSections(facts: ComponentFacts): Set<SectionId> {
  const out = new Set<SectionId>();
  if (!facts.hasStates) out.add('states');
  return out;
}
```

Then change `sectionGroups` to take the fourth parameter and honour it:

```ts
export function sectionGroups(
  selected: ReadonlySet<SectionId>,
  expanded: ReadonlySet<GroupId>,
  aiEnabled: boolean,
  unavailable: ReadonlySet<SectionId> = new Set<SectionId>(),
): SectionGroupView[] {
  return GROUPS.map(({ id, label }) => {
    const options: SectionOption[] = ALL_SECTIONS.filter((s) => s.group === id).map((s) => {
      const blocked = unavailable.has(s.id);
      return {
        id: s.id,
        label: s.label,
        aiCapable: s.ai && aiEnabled,
        // An unavailable section never reads as included, whatever the
        // selection set still holds: the build will not produce it.
        selected: selected.has(s.id) && !blocked,
        ...(blocked ? { disabled: true, note: 'none detected' } : {}),
      };
    });
    return {
      id,
      label: label as SectionGroupView['label'],
      expanded: expanded.has(id),
      included: options.filter((o) => o.selected).length,
      total: options.length,
      options,
    };
  });
}
```

- [ ] **Step 5: Render the notice and the note**

In `screens/component.ts`:

Add the import:

```ts
import type { ComponentFacts } from '../viewModel/componentFacts';
import { unavailableSections } from '../viewModel/componentScreen';
```

Add the notice, above `checkboxRow`:

```ts
const ATOM_NOTICE =
  'Atom component. It is normally used to build larger components, but you ' +
  'can still document it on its own.';

/** A quiet statement of fact about the selection, not a warning. */
function atomNoticeMarkup(): string {
  return `<div class="sl-banner" data-tone="neutral">${ATOM_NOTICE}</div>`;
}
```

Change `checkboxRow` to accept and render the note and the disabled state.
Replace its signature and its `<input>` and copy lines with:

```ts
function checkboxRow(option: {
  id: string;
  label: string;
  aiCapable: boolean;
  selected: boolean;
  disabled?: boolean;
  note?: string;
}): string {
  const badge = option.aiCapable
    ? '<span class="sl-badge" data-tone="accent">AI</span>'
    : '';
  const note = option.note
    ? `<span class="sl-type-support"> · ${esc(option.note)}</span>`
    : '';
  return (
    '<div class="sl-section-row">' +
    '<label class="sl-choice">' +
    `<input class="sl-choice-input" type="checkbox" data-section="${esc(option.id)}"` +
    `${option.selected ? ' checked' : ''}${option.disabled ? ' disabled' : ''} />` +
    '<span class="sl-checkbox-box" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
    'stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20 6L9 17l-5-5"/></svg>' +
    '</span>' +
    `<span class="sl-choice-copy"><strong>${esc(option.label)}</strong>${note}</span>` +
    '</label>' +
    badge +
    '</div>'
  );
}
```

Then take facts in `componentScrollMarkup`:

```ts
export function componentScrollMarkup(
  state: ComponentScreenState,
  selection: ComponentSelection,
  facts: ComponentFacts,
): string {
  if (state.kind === 'empty') return emptyMarkup();

  const groups = sectionGroups(
    selection.sections, selection.expanded, selection.aiEnabled, unavailableSections(facts),
  )
    .map((g) => groupMarkup(g, selection))
    .join('');

  return (
    (facts.isAtom ? atomNoticeMarkup() : '') +
    aiControlMarkup(selection.aiEnabled) +
    '<p class="sl-section-intro">Sections to include</p>' +
    groups +
    '<div class="sl-screen-status" id="sl-component-status" role="status" aria-live="polite"></div>'
  );
}
```

And thread facts through the entry point:

```ts
export function renderComponentScreen(
  refs: ShellRefs,
  state: ComponentScreenState,
  selection: ComponentSelection,
  facts: ComponentFacts,
): void {
  refs.pageHeader.innerHTML = componentHeaderMarkup(state);
  refs.pageHeader.hidden = state.kind === 'empty';
  refs.scroll.innerHTML = componentScrollMarkup(state, selection, facts);
  // ... the rest of the function is unchanged
```

- [ ] **Step 6: Supply facts from both entry points**

In `ui-vnext.ts`, add the import and a module-level value:

```ts
import { componentFacts, NO_FACTS, type ComponentFacts } from './viewModel/componentFacts';

/** Recomputed whenever extraction finishes; NO_FACTS until then. */
let facts: ComponentFacts = NO_FACTS;
```

Change `paint()`'s last line to `renderComponentScreen(refs, screen, selection, facts);`.

In the `selection` message handler, reset facts when the selection changes and
recompute after extraction. Replace the handler's body from `state.currentSpec
= null;` through the end of its `requestAnimationFrame` callback with:

```ts
      state.currentSpec = null;
      facts = NO_FACTS;
      if (!node) {
        screen = { kind: 'empty' };
        paint();
        return;
      }
      screen = { kind: 'reading', componentName: node.name };
      paint();
      // Extraction is synchronous and can be slow on a large component, so let
      // the reading state paint before it blocks the thread.
      requestAnimationFrame(() => {
        ensureExtracted(state);
        facts = componentFacts(state.currentSpec, node.name);
        screen = { kind: 'ready', componentName: node.name };
        paint();
      });
```

In `harness.ts`, add a `?facts=` switch so both states can be rendered outside
Figma. Add the import, the fixture map above the `if (view === 'component')`
block, and pass it to the render call:

```ts
import { componentFacts, NO_FACTS, type ComponentFacts } from './viewModel/componentFacts';

/** Canned facts. Real components produce these from componentFacts(). */
const FACTS: Record<string, ComponentFacts> = {
  none: NO_FACTS,
  atom: { ...NO_FACTS, isAtom: true },
  states: { ...NO_FACTS, hasStates: true },
};
```

and change the render call to:

```ts
  renderComponentScreen(refs, screen, selection, FACTS[param('facts', 'none')] ?? NO_FACTS);
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run packages/plugin/test && npm run typecheck`
Expected: all pass. `componentScreen.test.ts`'s existing `sectionGroups` cases
still pass, because the fourth parameter defaults to empty.

- [ ] **Step 8: Render it and look**

```bash
cd packages/plugin && UI_HARNESS=1 node build.mjs
```

Open `dist/ui-harness.html?view=component&facts=atom` and
`...&facts=none` at 480 x 680, in both themes. Confirm:

- The atom banner sits above the AI control, reads as neutral, and wraps
  without pushing the layout wide.
- `States · none detected` renders muted, its checkbox is unchecked and
  visibly disabled, and it does not count toward `Specifications`' included
  count.

Measure anything that looks wrong before changing it. Two CSS bugs in this
project were found only this way.

- [ ] **Step 9: Commit**

```bash
git add packages/plugin/src/ui packages/plugin/test/componentScreen.test.ts
git commit -m "feat(plugin): show the atom notice and states availability on the vNext screen"
```

---

### Task 3: Variant token picking

The last piece of the document the new screen cannot produce.

**Files:**
- Modify: `packages/plugin/src/ui/screens/component.ts`
- Modify: `packages/plugin/src/ui/ui-vnext.ts`
- Modify: `packages/plugin/src/ui/harness.ts`
- Test: `packages/plugin/test/componentScreen.test.ts`

**Interfaces:**
- Consumes: `VariantRowView`, `ComponentFacts` from Task 1.
- Produces:
  - `ComponentSelection` gains `variantIds: Set<string>` and `variantsExpanded: boolean`.
  - `variantCountLabel(selected: number, total: number): string` in `viewModel/componentScreen.ts`.

- [ ] **Step 1: Write the failing test**

Append to `packages/plugin/test/componentScreen.test.ts`:

```ts
import { variantCountLabel } from '../src/ui/viewModel/componentScreen';

const TWO_VARIANTS: ComponentFacts = {
  ...NO_FACTS,
  variants: [
    { nodeId: '1:1', chips: [{ text: 'Small', axis: 'Size', tone: 'value', title: 'Size: Small' }] },
    { nodeId: '1:2', chips: [{ text: 'Large', axis: 'Size', tone: 'value', title: 'Size: Large' }] },
  ],
  defaultVariantIds: new Set(['1:2']),
};

describe('variantCountLabel', () => {
  it('reads "{selected} of {total} selected"', () => {
    expect(variantCountLabel(1, 2)).toBe('1 of 2 selected');
  });

  it('says nothing when there is nothing to pick', () => {
    expect(variantCountLabel(0, 0)).toBe('');
  });
});

describe('the variant picker', () => {
  it('is absent when the component has no variant instances', () => {
    const markup = componentScrollMarkup(READY, createComponentSelection(true), NO_FACTS);
    expect(markup).not.toContain('data-variant');
  });

  it('renders one checkbox per variant instance', () => {
    const markup = componentScrollMarkup(READY, createComponentSelection(true), TWO_VARIANTS);
    expect(markup).toContain('data-variant="1:1"');
    expect(markup).toContain('data-variant="1:2"');
  });

  it('checks the ones in the selection and no others', () => {
    const selection = createComponentSelection(true);
    selection.variantIds = new Set(['1:2']);
    const markup = componentScrollMarkup(READY, selection, TWO_VARIANTS);
    expect(markup).toContain('data-variant="1:2" checked');
    expect(markup).toContain('data-variant="1:1" />');
  });

  it('explains itself when Tokens is off rather than vanishing', () => {
    const selection = createComponentSelection(true);
    selection.sections.delete('tokens');
    const markup = componentScrollMarkup(READY, selection, TWO_VARIANTS);
    expect(markup).toContain('Turn on Tokens used to apply');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/plugin/test/componentScreen.test.ts`
Expected: FAIL, `variantCountLabel` is not exported.

- [ ] **Step 3: Add the count label**

At the end of `viewModel/componentScreen.ts`:

```ts
/** `{selected} of {total} selected`, for the variant picker's header. */
export function variantCountLabel(selected: number, total: number): string {
  return total === 0 ? '' : `${selected} of ${total} selected`;
}
```

- [ ] **Step 4: Grow the selection**

In `screens/component.ts`, add the two fields to `ComponentSelection` and seed
them in `createComponentSelection`:

```ts
export interface ComponentSelection {
  sections: Set<SectionId>;
  expanded: Set<GroupId>;
  aiEnabled: boolean;
  anatomyView: 'diagram' | 'table' | 'both';
  measureViews: Set<'size' | 'padding' | 'spacing'>;
  /** Which variants the Tokens section documents. Seeded per component. */
  variantIds: Set<string>;
  variantsExpanded: boolean;
}

export function createComponentSelection(aiEnabled: boolean): ComponentSelection {
  return {
    sections: defaultSections(),
    expanded: new Set<GroupId>(['usage']),
    aiEnabled,
    anatomyView: 'diagram',
    measureViews: new Set(['size', 'padding', 'spacing'] as const),
    variantIds: new Set<string>(),
    variantsExpanded: false,
  };
}
```

- [ ] **Step 5: Render the picker**

In `screens/component.ts`, add the imports and the markup helpers above
`detailsFor`:

```ts
import type { ComponentFacts, VariantChip } from '../viewModel/componentFacts';
import { variantCountLabel } from '../viewModel/componentScreen';

function chipMarkup(chip: VariantChip): string {
  const axis = chip.axis ? `<span class="sl-chip-axis">${esc(chip.axis)}</span>` : '';
  return (
    `<span class="sl-chip" data-tone="${chip.tone}" title="${esc(chip.title)}">` +
    axis + esc(chip.text) +
    '</span>'
  );
}

/**
 * The variant picker, shown under the Tokens row.
 *
 * With Tokens off the rows stay visible but inert, and the header says which
 * switch turns them back on. Hiding them instead would leave a user who
 * unticked Tokens with no way to discover why their choices disappeared.
 */
function variantPickerMarkup(facts: ComponentFacts, selection: ComponentSelection): string {
  if (facts.variants.length === 0) return '';
  const tokensOn = selection.sections.has('tokens');
  const rows = facts.variants
    .map((v) => {
      const checked = selection.variantIds.has(v.nodeId);
      return (
        '<div class="sl-section-row">' +
        '<label class="sl-choice">' +
        `<input class="sl-choice-input" type="checkbox" data-variant="${esc(v.nodeId)}"` +
        `${checked ? ' checked' : ''}${tokensOn ? '' : ' disabled'} />` +
        '<span class="sl-checkbox-box" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
        'stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M20 6L9 17l-5-5"/></svg>' +
        '</span>' +
        `<span class="sl-choice-copy sl-chip-group">${v.chips.map(chipMarkup).join('')}</span>` +
        '</label>' +
        '</div>'
      );
    })
    .join('');

  const hint = tokensOn
    ? esc(variantCountLabel(
        facts.variants.filter((v) => selection.variantIds.has(v.nodeId)).length,
        facts.variants.length,
      ))
    : 'Turn on Tokens used to apply';

  return (
    '<div class="sl-section-details">' +
    '<div class="sl-disclosure">' +
    '<button class="sl-disclosure-trigger" type="button" data-variants ' +
    `aria-expanded="${selection.variantsExpanded}" aria-controls="sl-variant-list">` +
    '<span class="sl-section-group-title">Variants to document</span>' +
    `<span class="sl-section-count">${hint}</span>` +
    `<span data-chevron aria-hidden="true">${icon('chevronDown', 16)}</span>` +
    '</button>' +
    '<div class="sl-disclosure-panel" id="sl-variant-list">' +
    `<div><div class="sl-section-rows">${rows}</div></div>` +
    '</div>' +
    '</div>' +
    '</div>'
  );
}
```

`detailsFor` now needs the facts, so change its signature and add the tokens
branch. Replace its declaration line and add the new branch before the final
`return ''`:

```ts
function detailsFor(
  sectionId: string,
  selection: ComponentSelection,
  facts: ComponentFacts,
): string {
```

```ts
  if (sectionId === 'tokens') return variantPickerMarkup(facts, selection);
  return '';
```

`groupMarkup` passes it through. Change its signature and its `rows` line:

```ts
function groupMarkup(
  group: ReturnType<typeof sectionGroups>[number],
  selection: ComponentSelection,
  facts: ComponentFacts,
): string {
  const panelId = `sl-group-${group.id}`;
  const rows = group.options
    .map((o) => checkboxRow(o) + (o.selected ? detailsFor(o.id, selection, facts) : ''))
    .join('');
```

The Tokens row is a special case: its picker must render whether or not Tokens
is selected, so the picker can explain itself. Replace that `rows` line with:

```ts
  const rows = group.options
    .map((o) => {
      const details = o.selected || o.id === 'tokens' ? detailsFor(o.id, selection, facts) : '';
      return checkboxRow(o) + details;
    })
    .join('');
```

Finally, in `componentScrollMarkup`, pass facts into `groupMarkup`:

```ts
    .map((g) => groupMarkup(g, selection, facts))
```

Add `.sl-chip-axis` to `design-system/components.css`, beside the existing
`.sl-chip` rules, and mirror the change into the `docs/plugin-ui-vnext/design-system/`
copy so the two do not drift:

```css
/* The axis name in front of a variant chip's value: present so "Default" stays
   attributed to the property it came from, muted so the value still leads. */
.sl-chip-axis {
  color: var(--sl-color-text-muted);
  margin-right: 4px;
}
```

- [ ] **Step 6: Wire the clicks**

In `ui-vnext.ts`, seed the variant selection when facts arrive. In the
`requestAnimationFrame` callback added in Task 2, after the `facts = ...` line:

```ts
        // Start from the component's default variant, the same one the legacy
        // picker pre-checked. An empty set means "no variants" to the model,
        // not "all of them", so seeding is what makes the first build match
        // what the screen shows.
        selection.variantIds = new Set(facts.defaultVariantIds);
```

In the click listener, add two handlers above the `#sl-create` line:

```ts
  if (target.closest('[data-variants]')) {
    selection.variantsExpanded = !selection.variantsExpanded;
    paint();
    return;
  }
```

In the change listener, add above the `data-section` block:

```ts
  const variantId = input.dataset.variant;
  if (variantId) {
    if (input.checked) selection.variantIds.add(variantId);
    else selection.variantIds.delete(variantId);
    paint();
    return;
  }
```

Then make the build send them. Replace the `build()` body:

```ts
function build(): void {
  void createDocFrame(
    state,
    {
      sections: new Set(selection.sections),
      // Only meaningful with the Tokens section on; the model reads an empty
      // set as "no variant tables", which is exactly right when it is off.
      variantIds: selection.sections.has('tokens')
        ? new Set(selection.variantIds)
        : new Set<string>(),
    },
    presenter(),
  );
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run packages/plugin/test && npm run typecheck`
Expected: all pass.

- [ ] **Step 8: Render it and look**

Add a variant fixture to `harness.ts`'s `FACTS` map:

```ts
  variants: {
    ...NO_FACTS,
    hasStates: true,
    variants: [
      { nodeId: '1:1', chips: [{ text: 'Small', axis: 'Size', tone: 'value', title: 'Size: Small' }] },
      { nodeId: '1:2', chips: [{ text: 'Large', axis: 'Size', tone: 'value', title: 'Size: Large' }] },
      { nodeId: '1:3', chips: [{ text: 'Disabled', tone: 'flag', title: 'Disabled: true' }] },
    ],
    defaultVariantIds: new Set(['1:1']),
  },
```

Rebuild the harness and open
`dist/ui-harness.html?view=component&facts=variants&expand=specs`. Confirm the
picker sits under Tokens, the chips read left to right without wrapping mid
chip, the disabled state is visible in both themes, and the disclosure opens.

- [ ] **Step 9: Commit**

```bash
git add packages/plugin/src/ui packages/plugin/test/componentScreen.test.ts docs/plugin-ui-vnext/design-system
git commit -m "feat(plugin): let the vNext screen pick variants for the tokens section"
```

---

### Task 4: Group bulk selection

`sectionIdsInGroup` has been written and unused since the screen landed.

**Files:**
- Modify: `packages/plugin/src/ui/screens/component.ts`
- Modify: `packages/plugin/src/ui/ui-vnext.ts`
- Test: `packages/plugin/test/componentScreen.test.ts`

**Interfaces:**
- Produces: `applyGroupBulk(sections: Set<SectionId>, group: GroupId, on: boolean, unavailable: ReadonlySet<SectionId>): void` in `viewModel/componentScreen.ts`.

- [ ] **Step 1: Write the failing test**

Append to `packages/plugin/test/componentScreen.test.ts`:

```ts
import { applyGroupBulk } from '../src/ui/viewModel/componentScreen';

describe('applyGroupBulk', () => {
  it('selects every section in the group', () => {
    const sections = new Set<SectionId>();
    applyGroupBulk(sections, 'a11y', true, new Set());
    expect([...sections].sort()).toEqual(
      ['accessibility', 'contentConsiderations', 'interactions'].sort(),
    );
  });

  it('clears every section in the group and touches no other', () => {
    const sections = defaultSections();
    applyGroupBulk(sections, 'usage', false, new Set());
    expect(sections.has('definition')).toBe(false);
    expect(sections.has('anatomy')).toBe(true);
  });

  it('never selects a section the component cannot fill', () => {
    const sections = new Set<SectionId>();
    applyGroupBulk(sections, 'specs', true, new Set(['states'] as const));
    expect(sections.has('states')).toBe(false);
    expect(sections.has('tokens')).toBe(true);
  });
});
```

Add `import type { SectionId } from '../src/ui/docModel';` to the file's
imports if it is not already there.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/plugin/test/componentScreen.test.ts`
Expected: FAIL, `applyGroupBulk` is not exported.

- [ ] **Step 3: Implement it**

At the end of `viewModel/componentScreen.ts`:

```ts
/**
 * Select or clear a whole group in place.
 *
 * Unavailable sections are skipped on the way in: a bulk select must not put
 * back a section the component cannot fill, which the row itself refuses.
 */
export function applyGroupBulk(
  sections: Set<SectionId>,
  group: GroupId,
  on: boolean,
  unavailable: ReadonlySet<SectionId>,
): void {
  for (const id of sectionIdsInGroup(group)) {
    if (on && !unavailable.has(id)) sections.add(id);
    if (!on) sections.delete(id);
  }
}
```

- [ ] **Step 4: Add the control**

The group header is already a `<button>`, so the bulk control cannot be nested
inside it. It goes beside it. In `screens/component.ts`, replace `groupMarkup`'s
return with:

```ts
  const allOn = group.included === group.total;
  return (
    '<div class="sl-disclosure sl-section-group">' +
    `<button class="sl-disclosure-trigger" type="button" data-group="${group.id}" ` +
    `aria-expanded="${group.expanded}" aria-controls="${panelId}">` +
    `<span class="sl-section-group-title">${esc(group.label)}</span>` +
    `<span class="sl-section-count">${includedLabel(group)}</span>` +
    `<span data-chevron aria-hidden="true">${icon('chevronDown', 16)}</span>` +
    '</button>' +
    `<button class="sl-button" data-tone="ghost" type="button" data-group-bulk="${group.id}" ` +
    `data-on="${!allOn}">${allOn ? 'Clear all' : 'Select all'}</button>` +
    `<div class="sl-disclosure-panel" id="${panelId}">` +
    `<div><div class="sl-section-rows">${rows}</div></div>` +
    '</div>' +
    '</div>'
  );
```

- [ ] **Step 5: Wire it**

In `ui-vnext.ts`'s click listener, add above the existing `[data-group]`
handler. Order matters: the bulk button is not inside the trigger, but
`closest('[data-group]')` would still match if the bulk check ran second and
the markup ever changed.

```ts
  const bulk = target.closest<HTMLButtonElement>('[data-group-bulk]');
  if (bulk?.dataset.groupBulk) {
    applyGroupBulk(
      selection.sections,
      bulk.dataset.groupBulk as GroupId,
      bulk.dataset.on === 'true',
      unavailableSections(facts),
    );
    paint();
    return;
  }
```

Add `applyGroupBulk` and `unavailableSections` to the `./viewModel/componentScreen`
import.

- [ ] **Step 6: Run the tests and render it**

Run: `npx vitest run packages/plugin/test && npm run typecheck`

Rebuild the harness and confirm the bulk button reads `Select all` when a group
is partly included, flips to `Clear all` at full, and does not sit on top of
the count at 480px wide.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/ui packages/plugin/test/componentScreen.test.ts
git commit -m "feat(plugin): let a group header select or clear its sections"
```

---

### Task 5: Wire Download

The button has rendered on success since the screen landed, and has never done
anything.

**Files:**
- Modify: `packages/plugin/src/ui/ui-vnext.ts`
- Test: none. This is three lines of wiring against `downloadDoc`, which
  Phase 1 Task 3 covers with its own tests. A test here could only restate the
  click listener.

**Interfaces:**
- Consumes: `downloadDoc(state, selection, ui)` from Phase 1 Task 3.

- [ ] **Step 1: Extract the selection**

`build()` and the download path need the same value. In `ui-vnext.ts`, add
above `build()`:

```ts
/** What a build or a download documents, read from the current picks. */
function docSelection(): DocSelection {
  return {
    sections: new Set(selection.sections),
    variantIds: selection.sections.has('tokens')
      ? new Set(selection.variantIds)
      : new Set<string>(),
  };
}
```

and reduce `build()` to:

```ts
function build(): void {
  void createDocFrame(state, docSelection(), presenter());
}
```

Add `downloadDoc` and `type DocSelection` to the `./actions` import.

- [ ] **Step 2: Handle the click**

In the click listener, replace the final line with:

```ts
  if (target.closest('#sl-download')) {
    void downloadDoc(state, docSelection(), presenter());
    return;
  }
  if (target.closest('#sl-create')) build();
```

- [ ] **Step 3: Verify the presenter reports it**

`presenter()`'s `info` is a documented no-op, chosen because `docFrameDone`
already tells the component screen about success. A download has no such
message: nothing else reports it. Replace `presenter()`'s `info` member with:

```ts
    info: (message) => {
      // Unlike a build, a download has no main-thread reply, so this is the
      // only place the user learns it happened.
      screen = { kind: 'success', componentName: currentName(), replaced: false };
      paint();
      const status = document.getElementById('sl-component-status');
      if (status) {
        status.innerHTML = `<div class="sl-banner" data-tone="success">${message}</div>`;
      }
    },
```

- [ ] **Step 4: Run the gates**

Run: `npx vitest run packages/plugin/test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/ui/ui-vnext.ts
git commit -m "feat(plugin): wire Download on the vNext component screen"
```

---

### Task 6: Prove the screen against the legacy tab

The claim this phase makes is parity. That is checked by producing the same
document twice, not by reading the diff.

**Files:**
- No source changes expected.

- [ ] **Step 1: Run every gate**

```bash
npm run lint && npm run typecheck && npm test && npm run test:coverage && npm run build:plugin
```

Judge lint by exit code. Report the real coverage numbers against the floors
(statements 45, branches 40, functions 50, lines 45). Do not lower a threshold.

- [ ] **Step 2: Confirm the default build is still legacy**

```bash
cd packages/plugin
node build.mjs
grep -c "tab-panel-selected" dist/ui.html   # expect 3
grep -c "sl-color-canvas" dist/ui.html      # expect 0
UI_VNEXT=1 node build.mjs
grep -c "sl-plugin-shell" dist/ui.html      # expect at least 1
```

- [ ] **Step 3: Render every component state in the harness**

```bash
UI_HARNESS=1 node build.mjs
```

At 480 x 680, in light and dark, open each of:

- `?view=component&state=empty`
- `?view=component&state=reading`
- `?view=component&state=ready&facts=variants&expand=usage,specs,a11y`
- `?view=component&state=building`
- `?view=component&state=success`
- `?view=component&state=error`
- `?view=component&facts=atom`
- `?view=component&facts=none&expand=specs` (States unavailable)

Nothing may overflow horizontally, and no control may be identifiable by colour
alone.

- [ ] **Step 4: Build the same document twice in Figma**

Import `packages/plugin/manifest.json` from a `UI_VNEXT=1` build. On one
component with variants and a state axis:

- Create docs with every section on and two variants picked.
- Note the frame's sections and its per-variant token tables.

Then rebuild from a plain (legacy) build and repeat the same picks on the old
tab. The two frames must contain the same sections, the same token tables, and
the same variant rows. Any difference is a defect in this phase.

Also confirm on the new shell:

- Selecting an atom shows the notice.
- Selecting a component with no state axis disables States.
- `Download` saves markdown matching the frame.
- A second `Create docs` click during a build is refused.

- [ ] **Step 5: Commit any fixes**

```bash
git commit -am "fix(plugin): <what the parity pass caught>"
```

If the pass is clean there is nothing to commit and the phase is done.
