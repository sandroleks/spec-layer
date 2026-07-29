import { describe, it, expect, vi } from 'vitest';
import { ALL_SECTIONS, type SectionId } from '../src/ui/docModel';
import {
  applyGroupBulk,
  componentDocSelection,
  DEFAULT_OFF_SECTIONS,
  defaultSections,
  includedLabel,
  sectionGroups,
  sectionIdsInGroup,
  unavailableSections,
  variantCountLabel,
} from '../src/ui/viewModel/componentScreen';
import { createDocFrame, createState, type BuildPresenter } from '../src/ui/actions';
import {
  componentFooterMarkup,
  componentHeaderMarkup,
  componentScrollMarkup,
  componentStatusMarkup,
  createComponentSelection,
} from '../src/ui/screens/component';
import { NO_FACTS, type ComponentFacts } from '../src/ui/viewModel/componentFacts';

const ALL_GROUPS = new Set(['usage', 'specs', 'a11y'] as const);
const READY = { kind: 'ready', componentName: 'Button' } as const;

function facts(over: Partial<ComponentFacts> = {}): ComponentFacts {
  return { ...NO_FACTS, ...over };
}

const TWO_VARIANTS: ComponentFacts = {
  ...NO_FACTS,
  hasStates: true,
  variants: [
    {
      nodeId: '1:1',
      chips: [{ text: 'Small', axis: 'Size', tone: 'value', title: 'Size: Small' }],
    },
    {
      nodeId: '1:2',
      chips: [{ text: 'Large', axis: 'Size', tone: 'value', title: 'Size: Large' }],
    },
  ],
  defaultVariantIds: new Set(['1:2']),
};

describe('defaultSections', () => {
  it('starts with everything except the opt-in sections', () => {
    const selected = defaultSections();
    for (const { id } of ALL_SECTIONS) {
      expect(selected.has(id)).toBe(!DEFAULT_OFF_SECTIONS.has(id));
    }
  });

  it('leaves only Related components off', () => {
    const selected = defaultSections();
    expect(selected.has('related')).toBe(false);
    expect(selected.has('interactions')).toBe(true);
    expect(selected.has('contentConsiderations')).toBe(true);
  });

  it('returns a fresh set each time, so one screen cannot mutate another', () => {
    const first = defaultSections();
    first.clear();
    expect(defaultSections().size).toBeGreaterThan(0);
  });
});

describe('sectionGroups', () => {
  it('covers every section exactly once across the three groups', () => {
    const groups = sectionGroups(defaultSections(), ALL_GROUPS, true);
    const ids = groups.flatMap((g) => g.options.map((o) => o.id));
    expect(ids).toHaveLength(ALL_SECTIONS.length);
    expect(new Set(ids).size).toBe(ALL_SECTIONS.length);
  });

  it('counts included against total per group', () => {
    const groups = sectionGroups(defaultSections(), ALL_GROUPS, true);
    const usage = groups.find((g) => g.id === 'usage')!;
    // Usage holds Overview, Variants, Do's & Don'ts, and Related; Related is off.
    expect(usage.total).toBe(4);
    expect(usage.included).toBe(3);
  });

  it('reports zero included when nothing is selected, without dropping options', () => {
    const groups = sectionGroups(new Set(), ALL_GROUPS, true);
    for (const group of groups) {
      expect(group.included).toBe(0);
      expect(group.total).toBeGreaterThan(0);
    }
  });

  it('marks AI-capable sections only while AI writing is on', () => {
    const on = sectionGroups(defaultSections(), ALL_GROUPS, true);
    const off = sectionGroups(defaultSections(), ALL_GROUPS, false);
    expect(on.flatMap((g) => g.options).some((o) => o.aiCapable)).toBe(true);
    expect(off.flatMap((g) => g.options).every((o) => !o.aiCapable)).toBe(true);
  });

  it('keeps every section selectable with AI off, so docs still build', () => {
    const off = sectionGroups(defaultSections(), ALL_GROUPS, false);
    expect(off.flatMap((g) => g.options).every((o) => !o.disabled)).toBe(true);
  });

  it('reports only the groups asked to be expanded', () => {
    const groups = sectionGroups(defaultSections(), new Set(['usage'] as const), true);
    expect(groups.find((g) => g.id === 'usage')!.expanded).toBe(true);
    expect(groups.find((g) => g.id === 'specs')!.expanded).toBe(false);
  });
});

describe('includedLabel', () => {
  it('reads "{included} of {total} included"', () => {
    const usage = sectionGroups(defaultSections(), ALL_GROUPS, true).find((g) => g.id === 'usage')!;
    expect(includedLabel(usage)).toBe('3 of 4 included');
  });
});

describe('sectionIdsInGroup', () => {
  it('returns the group members and nothing else', () => {
    expect(sectionIdsInGroup('a11y').sort()).toEqual(
      ['accessibility', 'contentConsiderations', 'interactions'].sort(),
    );
  });
});

describe('unavailableSections', () => {
  it('waits for extraction before declaring States unavailable', () => {
    expect(unavailableSections(NO_FACTS).size).toBe(0);
  });

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
      defaultSections(),
      ALL_GROUPS,
      true,
      new Set<SectionId>(['states']),
    );
    const states = groups.flatMap((group) => group.options).find((option) => option.id === 'states')!;
    expect(states.disabled).toBe(true);
    expect(states.note).toBe('none detected');
    expect(states.selected).toBe(false);
  });

  it('counts only selectable sections, matching the group bulk action', () => {
    const specs = sectionGroups(
      defaultSections(),
      ALL_GROUPS,
      true,
      new Set<SectionId>(['states']),
    ).find((group) => group.id === 'specs')!;
    expect(includedLabel(specs)).toBe('4 of 4 included');
  });
});

describe('applyGroupBulk', () => {
  it('selects every available section in a group', () => {
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
    applyGroupBulk(sections, 'specs', true, new Set<SectionId>(['states']));
    expect(sections.has('states')).toBe(false);
    expect(sections.has('tokens')).toBe(true);
  });
});

describe('componentDocSelection', () => {
  it('filters unavailable States and copies both sets', () => {
    const sections = new Set<SectionId>(['states', 'tokens']);
    const variants = new Set(['1:2']);
    const out = componentDocSelection(sections, variants, facts({ hasStates: false }));
    expect([...out.sections]).toEqual(['tokens']);
    expect([...out.variantIds]).toEqual(['1:2']);
    out.sections.clear();
    out.variantIds.clear();
    expect([...sections]).toEqual(['states', 'tokens']);
    expect([...variants]).toEqual(['1:2']);
  });

  it('drops variant ids while Tokens is off', () => {
    const out = componentDocSelection(
      new Set<SectionId>(['definition']),
      new Set(['1:2']),
      facts({ hasStates: true }),
    );
    expect(out.variantIds.size).toBe(0);
  });
});

describe('variantCountLabel', () => {
  it('reads "{selected} of {total} selected"', () => {
    expect(variantCountLabel(1, 2)).toBe('1 of 2 selected');
  });

  it('says nothing when there is nothing to pick', () => {
    expect(variantCountLabel(0, 0)).toBe('');
  });
});

describe('component screen markup', () => {
  it('shows the atom notice only for atom components', () => {
    const selection = createComponentSelection(true);
    const on = componentScrollMarkup(READY, selection, facts({ isAtom: true, hasStates: true }));
    const off = componentScrollMarkup(READY, selection, facts({ isAtom: false, hasStates: true }));
    expect(on).toContain('Atom component');
    expect(on).toContain('data-tone="neutral"');
    expect(off).not.toContain('Atom component');
  });

  it('disables States only after no state axis is known', () => {
    const selection = createComponentSelection(true);
    const reading = componentScrollMarkup(READY, selection, NO_FACTS);
    const unavailable = componentScrollMarkup(READY, selection, facts({ hasStates: false }));
    expect(reading).not.toContain('none detected');
    expect(unavailable).toContain('none detected');
    expect(unavailable).toContain('data-section="states" disabled');
  });

  it('renders one accessible checkbox per variant and starts collapsed', () => {
    const selection = createComponentSelection(true);
    selection.variantIds = new Set(['1:2']);
    const markup = componentScrollMarkup(READY, selection, TWO_VARIANTS);
    expect(markup).toContain('data-variant="1:1" aria-label="Size: Small"');
    expect(markup).toContain('data-variant="1:2" aria-label="Size: Large" checked');
    expect(markup).toContain('id="sl-variant-list" hidden');
  });

  it('explains disabled variant choices while Tokens is off', () => {
    const selection = createComponentSelection(true);
    selection.sections.delete('tokens');
    const markup = componentScrollMarkup(READY, selection, TWO_VARIANTS);
    expect(markup).toContain('Turn on Tokens used to apply');
    expect(markup).toContain('data-variant="1:1" aria-label="Size: Small" disabled');
  });

  it('keeps disclosure and bulk selection as separate category actions', () => {
    const selection = createComponentSelection(true);
    const markup = componentScrollMarkup(READY, selection, facts({ hasStates: false }));
    expect(markup).toContain('data-group="usage"');
    expect(markup).toContain('data-group="specs"');
    expect(markup).toContain('data-group="a11y"');
    expect(markup).toContain('data-group-bulk="usage" aria-label="Select all Usage sections"');
    expect(markup).toContain('data-group-bulk="specs" aria-label="Clear all Specifications sections"');
    expect(markup).toContain('data-group-bulk="a11y" aria-label="Clear all Accessibility sections"');
  });

  it('marks unavailable rows so hover does not imply they can be selected', () => {
    const selection = createComponentSelection(true);
    const markup = componentScrollMarkup(READY, selection, facts({ hasStates: false }));
    expect(markup).toContain(
      '<div class="sl-section-row is-disabled"><label class="sl-choice">',
    );
  });

  it('renders Anatomy and Measurements as compact inline choices', () => {
    const selection = createComponentSelection(true);
    selection.expanded.add('specs');
    const markup = componentScrollMarkup(READY, selection, facts());
    expect(markup).toContain('<span class="sl-inline-options-label">Anatomy as</span>');
    expect(markup).toContain('type="radio" name="anatomy-view" data-anatomy="diagram" checked');
    expect(markup).toContain('<span class="sl-inline-options-label">Measure</span>');
    expect(markup).toContain('type="checkbox" data-measure="padding" checked');
    expect(markup).not.toContain('class="sl-segmented" role="radiogroup"');
    expect(markup).not.toContain('class="sl-chip" type="button" data-measure');
  });

  it('keeps collapsed section controls out of the accessibility tree', () => {
    const selection = createComponentSelection(true);
    selection.expanded.clear();
    const markup = componentScrollMarkup(READY, selection, facts({ hasStates: true }));
    expect(markup).toContain('id="sl-group-usage" hidden');
    expect(markup).toContain('id="sl-group-specs" hidden');
    expect(markup).toContain('id="sl-group-a11y" hidden');
  });

  it('disables Create docs while extraction is reading', () => {
    expect(componentFooterMarkup({ kind: 'reading', componentName: 'Button' }))
      .toContain('id="sl-create" type="button" disabled');
  });

  it('renders the selected-component eyebrow and footer icons', () => {
    const header = componentHeaderMarkup(READY);
    const footer = componentFooterMarkup(READY);
    expect(header).toContain('Selected component');
    expect(footer).toContain('id="sl-create"');
    expect(footer).toContain('<svg');
  });

  it('locks component settings while reading or building', () => {
    const selection = createComponentSelection(true);
    expect(componentScrollMarkup(
      { kind: 'reading', componentName: 'Button' },
      selection,
      NO_FACTS,
    )).toContain('disabled aria-busy="true"');
    expect(componentScrollMarkup(
      { kind: 'building', componentName: 'Button', action: 'create' },
      selection,
      facts({ hasStates: true }),
    )).toContain('disabled aria-busy="true"');
  });

  it('names slow download work accurately', () => {
    const footer = componentFooterMarkup({
      kind: 'building',
      componentName: 'Button',
      action: 'download',
      phase: 'Saving the markdown',
    });
    expect(footer).toContain('Downloading…');
    expect(footer).toContain('Saving the markdown');
    expect(footer).toContain('sl-footer-progress');
  });

  it('keeps a successful build downloadable without rendering a plugin toast', () => {
    const state = {
      kind: 'success',
      componentName: 'Button',
      replaced: false,
      message: 'Docs created. AI did not run',
      warning: true,
    } as const;
    expect(componentStatusMarkup(state)).toBe('');
    expect(componentFooterMarkup(state)).toContain('id="sl-download"');
  });

  it('reuses the original progress treatment for reading and build phases', () => {
    expect(componentStatusMarkup({
      kind: 'reading',
      componentName: 'Button',
    })).toContain('Reading the selected component');
    expect(componentStatusMarkup({
      kind: 'building',
      componentName: 'Button',
      action: 'create',
      phase: 'Placing the frame on the canvas',
    })).toContain('Placing the frame on the canvas');
    expect(componentFooterMarkup({
      kind: 'building',
      componentName: 'Button',
      action: 'create',
      phase: 'Placing the frame on the canvas',
    })).toContain('sl-footer-progress');
  });
});

/**
 * The build path used to read the section checkboxes straight out of the legacy
 * DOM. These pin the replacement: selection arrives as a value, and the two
 * refusals report through the presenter rather than a hardcoded banner.
 */
describe('createDocFrame', () => {
  function fakePresenter(): BuildPresenter & { errors: string[]; busy: boolean[] } {
    const errors: string[] = [];
    const busy: boolean[] = [];
    return {
      errors,
      busy,
      clear: vi.fn(),
      error: (message: string) => { errors.push(message); },
      info: vi.fn(),
      setBusy: (value: boolean) => { busy.push(value); },
      startProgress: vi.fn(),
      stopProgress: vi.fn(),
    };
  }

  it('refuses without a component, and never claims to be busy', async () => {
    const ui = fakePresenter();
    await createDocFrame(createState(), { sections: new Set(), variantIds: new Set() }, ui);
    expect(ui.errors).toEqual(['Select a component first.']);
    expect(ui.busy).toEqual([]);
  });

  it('clears prior status before deciding anything', async () => {
    const ui = fakePresenter();
    await createDocFrame(createState(), { sections: new Set(), variantIds: new Set() }, ui);
    expect(ui.clear).toHaveBeenCalled();
  });
});
