import { describe, it, expect, vi } from 'vitest';
import { ALL_SECTIONS } from '../src/ui/docModel';
import {
  DEFAULT_OFF_SECTIONS,
  defaultSections,
  includedLabel,
  sectionGroups,
  sectionIdsInGroup,
} from '../src/ui/viewModel/componentScreen';
import { createDocFrame, createState, type BuildPresenter } from '../src/ui/actions';

const ALL_GROUPS = new Set(['usage', 'specs', 'a11y'] as const);

describe('defaultSections', () => {
  it('starts with everything except the opt-in sections', () => {
    const selected = defaultSections();
    for (const { id } of ALL_SECTIONS) {
      expect(selected.has(id)).toBe(!DEFAULT_OFF_SECTIONS.has(id));
    }
  });

  it('leaves the three token-costly sections off', () => {
    const selected = defaultSections();
    expect(selected.has('related')).toBe(false);
    expect(selected.has('interactions')).toBe(false);
    expect(selected.has('contentConsiderations')).toBe(false);
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
