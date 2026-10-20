/**
 * What a designer still has to write, per doc: empty description fields in
 * Figma and doc sections nobody has written. Pure, shared by the main thread
 * (component gaps, from the raw node) and the UI (Foundation gaps, from the
 * dump it already holds). Every gap is anchored to a stable id, never a
 * display name, so it survives a rename. Nothing here enters a hash.
 */
import {
  durationLabel, easingLabel,
  type FoundationScope, type FoundationSpec, type FoundationValue,
} from '@spec-layer/extractor';
import { ALL_SECTIONS, type SectionId } from './ui/docModel';
import { PLACEHOLDER_SECTION_IDS } from './ui/placeholders';

export type WritingGapKind = 'component' | 'slot' | 'section' | 'variable' | 'style';

export interface WritingGap {
  kind: WritingGapKind;
  /** Node id (component, slot), variable id, style id, or the doc id (section). */
  id: string;
  /** Slot only. */
  propertyName?: string;
  /** Section only. */
  sectionId?: SectionId;
  /** The component name, "Component / property", the token path, the style name, or the section heading. */
  name: string;
  /** Variable: one entry per mode, "Light = #FFFFFF". Style: "typography" or "effect". */
  facts?: string[];
}

/** The sections a person writes: every one the plugin draws as a placeholder
 *  (ui/placeholders.ts), so the two lists can never disagree. Frame order. */
export const WRITING_SECTIONS: readonly SectionId[] = PLACEHOLDER_SECTION_IDS;

export interface RawComponentFields {
  id: string;
  name: string;
  /** The raw Figma field. Text Annotate wrote counts as filled: this list is
   *  about what Figma shows, so no provenance stripping here. */
  description: string;
  componentPropertyDefinitions?: Record<string, { type: string; description?: string | null }>;
}

const blank = (text: string | null | undefined): boolean => typeof text !== 'string' || text.trim() === '';

/** The component's own description, then each SLOT property without one, in
 *  Figma's property order. Other property types have no description field. */
export function componentWritingGaps(raw: RawComponentFields): WritingGap[] {
  const out: WritingGap[] = [];
  if (blank(raw.description)) out.push({ kind: 'component', id: raw.id, name: raw.name });
  for (const [propertyName, def] of Object.entries(raw.componentPropertyDefinitions ?? {})) {
    if (def.type !== 'SLOT' || !blank(def.description)) continue;
    // "Content#1:2" shows as "Content": Figma suffixes a property with its id.
    const shown = propertyName.replace(/#.*$/, '');
    out.push({ kind: 'slot', id: raw.id, propertyName, name: `${raw.name} / ${shown}` });
  }
  return out;
}

const headingOf = (id: SectionId): string => ALL_SECTIONS.find((s) => s.id === id)?.label ?? id;

/** Unwritten sections the doc still has ticked on, in frame order. An older
 *  link without the field claims nothing. */
export function sectionWritingGaps(
  docId: string,
  unwritten: readonly SectionId[] | undefined,
  ticked: readonly SectionId[],
): WritingGap[] {
  if (!unwritten) return [];
  const on = new Set(ticked);
  const open = new Set(unwritten);
  return WRITING_SECTIONS
    .filter((id) => open.has(id) && on.has(id))
    .map((id) => ({ kind: 'section' as const, id: docId, sectionId: id, name: headingOf(id) }));
}

const percent = (alpha: number): string => `${Math.round(alpha * 100)}%`;

/** A value as the Foundation frame would show it, never a guess. */
export function valueLabel(value: FoundationValue): string {
  switch (value.kind) {
    case 'color': return value.alpha < 1 ? `${value.hex} ${percent(value.alpha)}` : value.hex;
    case 'number': return String(value.value);
    case 'string': return value.value;
    case 'boolean': return String(value.value);
    case 'duration': return durationLabel(value.seconds);
    case 'easing': return easingLabel(value.easing);
    case 'alias': return value.resolved ? `${valueLabel(value.resolved)} (${value.targetName})` : value.targetName;
    case 'unresolved': return 'Not resolved';
  }
}

/** Blank variables, or blank styles, within the doc's scope. No scope, no claim. */
export function foundationWritingGaps(spec: FoundationSpec, scope: FoundationScope | undefined): WritingGap[] {
  if (!scope) return [];
  if (scope.target === 'collection') {
    const collection = spec.collections.find((c) => c.id === scope.collectionId);
    if (!collection) return [];
    return collection.variables
      .filter((v) => (scope.group === undefined || v.group === scope.group) && blank(v.description))
      .map((v) => ({
        kind: 'variable' as const,
        id: v.provenance.id,
        name: v.name,
        facts: collection.modes.map((m) => {
          const value = v.valuesByMode[m.modeId];
          return `${m.name} = ${value ? valueLabel(value) : 'Not set'}`;
        }),
      }));
  }
  const styles = scope.target === 'textStyles' ? spec.textStyles : spec.effectStyles;
  const family = scope.target === 'textStyles' ? 'typography' : 'effect';
  return styles
    .filter((s) => typeof s.id === 'string' && (scope.group === undefined || s.group === scope.group) && blank(s.description))
    .map((s) => ({ kind: 'style' as const, id: s.id as string, name: s.name, facts: [family] }));
}
