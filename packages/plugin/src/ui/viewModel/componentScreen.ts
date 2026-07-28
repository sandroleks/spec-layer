/**
 * componentScreen.ts — the section picker, as pure data.
 *
 * The legacy UI kept the user's section choice in its checkboxes and read it
 * back out of the DOM at build time. This screen keeps it in a set and hands it
 * to `createDocFrame`, so the choice is inspectable and testable without a DOM.
 */

import { ALL_SECTIONS, GROUPS, type GroupId, type SectionId } from '../docModel';
import type { SectionGroupView, SectionOption } from './contracts';

/**
 * Sections that start unchecked: Related components is rarely wanted, and the
 * two verbose accessibility additions are token-costly, so they are opt-in.
 *
 * This is the one source for that default. `dom.ts` imports it too, so the
 * legacy UI and this screen cannot start from different states.
 */
export const DEFAULT_OFF_SECTIONS: ReadonlySet<SectionId> = new Set<SectionId>([
  'related',
  'interactions',
  'contentConsiderations',
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
): SectionGroupView[] {
  return GROUPS.map(({ id, label }) => {
    const options: SectionOption[] = ALL_SECTIONS.filter((s) => s.group === id).map((s) => ({
      id: s.id,
      label: s.label,
      aiCapable: s.ai && aiEnabled,
      selected: selected.has(s.id),
    }));
    return {
      id,
      // GROUPS types its labels as plain strings, but its three values are
      // exactly the literals the contract names.
      label: label as SectionGroupView['label'],
      expanded: expanded.has(id),
      included: options.filter((o) => o.selected).length,
      total: options.length,
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
