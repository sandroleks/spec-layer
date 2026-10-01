/** The section picker as pure data, handed to `createDocFrame` rather than read from the DOM. */

import { ALL_SECTIONS, GROUPS, type GroupId, type SectionId } from '../docModel';
import type { AllowanceState, ComponentScreenState, SectionGroupView, SectionOption } from './contracts';
import { formatResetDate } from './allowance';
import type { ComponentFacts } from './componentFacts';

/** The one source for which sections start unchecked. */
export const DEFAULT_OFF_SECTIONS: ReadonlySet<SectionId> = new Set<SectionId>([
  'related',
]);

export function defaultSections(): Set<SectionId> {
  return new Set(ALL_SECTIONS.filter((s) => !DEFAULT_OFF_SECTIONS.has(s.id)).map((s) => s.id));
}

/**
 * On whenever a boolean property hides parts, off otherwise so the flag never
 * claims a doc drew something it did not. Seeded when facts arrive, not at selection.
 */
export function defaultIncludeHidden(facts: ComponentFacts): boolean {
  return facts.hasHiddenParts;
}

/** `aiEnabled` toggles only the AI badges, never availability: deterministic sections are the fallback. */
export function sectionGroups(
  selected: ReadonlySet<SectionId>,
  expanded: ReadonlySet<GroupId>,
  aiEnabled: boolean,
  unavailable: ReadonlySet<SectionId> = new Set<SectionId>(),
): SectionGroupView[] {
  return GROUPS.map(({ id, label }) => {
    const options: SectionOption[] = ALL_SECTIONS
      .filter((s) => s.group === id && !unavailable.has(s.id))
      .map((s) => ({
        id: s.id,
        label: s.label,
        aiCapable: s.ai && aiEnabled,
        selected: selected.has(s.id),
      }));
    return {
      id,
      // GROUPS types labels as string; its values are the contract's literals.
      label: label as SectionGroupView['label'],
      expanded: expanded.has(id),
      included: options.filter((o) => o.selected).length,
      total: options.length,
      options,
    };
  });
}

export function includedLabel(group: SectionGroupView): string {
  return `${group.included} of ${group.total} included`;
}

export function sectionIdsInGroup(id: GroupId): SectionId[] {
  return ALL_SECTIONS.filter((s) => s.group === id).map((s) => s.id);
}

/** Sections the component cannot fill: States without a state-like axis would be an empty table. */
export function unavailableSections(facts: ComponentFacts): Set<SectionId> {
  const out = new Set<SectionId>();
  if (facts.hasStates === false) out.add('states');
  return out;
}

export function variantCountLabel(selected: number, total: number): string {
  return total === 0 ? '' : `${selected} of ${total} selected`;
}

export function variantBulkState(
  selected: ReadonlySet<string>,
  variantIds: readonly string[],
): { checked: boolean; mixed: boolean } {
  const included = variantIds.filter((id) => selected.has(id)).length;
  return {
    checked: variantIds.length > 0 && included === variantIds.length,
    mixed: included > 0 && included < variantIds.length,
  };
}

/** Mutates `selected` in place rather than replacing it. */
export function applyVariantBulk(
  selected: Set<string>,
  variantIds: readonly string[],
  on: boolean,
): void {
  for (const id of variantIds) {
    if (on) selected.add(id);
    else selected.delete(id);
  }
}

/** Select or clear a whole group in place, never adding an unavailable section. */
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

/** Drops unavailable sections even from stale state; variant picks apply only while Tokens is on. */
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

/**
 * Warns before Create that AI sections will be placeholders. Only a spent free
 * tier speaks: Pro has no cap, and `loading` or `unknown` would be a claim the
 * plugin cannot back. The reset date is the proxy's, or left out.
 */
export function exhaustedAiNote(aiEnabled: boolean, allowance: AllowanceState): string | null {
  if (!aiEnabled || allowance.kind !== 'free' || allowance.remaining > 0) return null;
  const reset = formatResetDate(allowance.resetsAt);
  const lead = reset ? `No free AI uses left until ${reset}.` : 'No free AI uses left.';
  return `${lead} Sections marked AI will be drawn as placeholders.`;
}

/** For a `docFrameError` or a pre-render failure; with no component current the panel goes empty. */
export function failedBuildScreen(
  componentName: string,
  message: string,
): ComponentScreenState {
  return componentName
    ? { kind: 'error', componentName, message }
    : { kind: 'empty' };
}

/**
 * What a selection report does to the component screen on its way in.
 * - `keep`: a build error and the same component; a no-op reselection (main.ts
 *   replays one after a build) must not hide an unseen failure.
 * - `toast`: a build error and a different selection or none within
 *   `FAILED_BUILD_TOAST_WINDOW_MS` of painting, so the unread failure toasts.
 * - `replace`: anything else; after the window the banner was seen.
 * `elapsedMs` is how long the error screen has been painted; the host owns the clock.
 */
export type SelectionOutcome = 'keep' | 'toast' | 'replace';

/** How long after a failed build's banner a replacing selection still toasts it. */
export const FAILED_BUILD_TOAST_WINDOW_MS = 1500;

export function selectionOutcome(
  outgoingKind: ComponentScreenState['kind'],
  oldNodeId: string | null | undefined,
  newNodeId: string | null | undefined,
  elapsedMs: number,
): SelectionOutcome {
  if (outgoingKind !== 'error') return 'replace';
  if (newNodeId && newNodeId === oldNodeId) return 'keep';
  return elapsedMs < FAILED_BUILD_TOAST_WINDOW_MS ? 'toast' : 'replace';
}
