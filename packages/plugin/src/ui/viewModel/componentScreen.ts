/**
 * componentScreen.ts — the section picker, as pure data.
 *
 * The legacy UI kept the user's section choice in its checkboxes and read it
 * back out of the DOM at build time. This screen keeps it in a set and hands it
 * to `createDocFrame`, so the choice is inspectable and testable without a DOM.
 */

import { ALL_SECTIONS, GROUPS, type GroupId, type SectionId } from '../docModel';
import type { SectionGroupView, SectionOption } from './contracts';
import type { ComponentFacts } from './componentFacts';

/**
 * Related components is the only section that starts unchecked. The approved
 * component-screen prototype shows every accessibility section included.
 *
 * This is the one source for that default. `dom.ts` imports it too, so the
 * legacy UI and this screen cannot start from different states.
 */
export const DEFAULT_OFF_SECTIONS: ReadonlySet<SectionId> = new Set<SectionId>([
  'related',
]);

export function defaultSections(): Set<SectionId> {
  return new Set(ALL_SECTIONS.filter((s) => !DEFAULT_OFF_SECTIONS.has(s.id)).map((s) => s.id));
}

/**
 * Group the sections for display.
 *
 * `aiEnabled` only controls whether the AI badges show. It never changes which
 * sections are available: turning AI off has to leave every deterministic
 * section selectable, because that is the fallback when the free allowance runs
 * out.
 */
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
        selected: selected.has(s.id) && !blocked,
        ...(blocked ? { disabled: true, note: 'none detected' } : {}),
      };
    });
    return {
      id,
      // GROUPS types its labels as plain strings, but its three values are
      // exactly the literals the contract names.
      label: label as SectionGroupView['label'],
      expanded: expanded.has(id),
      included: options.filter((o) => o.selected).length,
      // Disabled rows remain visible for explanation, but they are not choices
      // and therefore do not belong in the selectable total or bulk action.
      total: options.filter((option) => !option.disabled).length,
      options,
    };
  });
}

/** `{included} of {total} included`, the wording the group headers use. */
export function includedLabel(group: SectionGroupView): string {
  return `${group.included} of ${group.total} included`;
}

/** Every section in a group, for the header's own checkbox-style bulk action. */
export function sectionIdsInGroup(id: GroupId): SectionId[] {
  return ALL_SECTIONS.filter((s) => s.group === id).map((s) => s.id);
}

/**
 * Sections the current component cannot fill.
 *
 * States is the only one today: without a state-like variant axis there is
 * nothing to tabulate, and offering it would promise an empty table.
 */
export function unavailableSections(facts: ComponentFacts): Set<SectionId> {
  const out = new Set<SectionId>();
  if (facts.hasStates === false) out.add('states');
  return out;
}

/** `{selected} of {total} selected`, for the variant picker's header. */
export function variantCountLabel(selected: number, total: number): string {
  return total === 0 ? '' : `${selected} of ${total} selected`;
}

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

/**
 * Copy the screen's picks into the value consumed by build and download.
 *
 * Unavailable sections are removed even if stale selection state still holds
 * them. Variant choices only apply while Tokens is included.
 */
export function componentDocSelection(
  selected: ReadonlySet<SectionId>,
  variantIds: ReadonlySet<string>,
  facts: ComponentFacts,
): { sections: Set<SectionId>; variantIds: Set<string> } {
  const sections = new Set(selected);
  for (const id of unavailableSections(facts)) sections.delete(id);
  return {
    sections,
    variantIds: sections.has('tokens') ? new Set(variantIds) : new Set<string>(),
  };
}
