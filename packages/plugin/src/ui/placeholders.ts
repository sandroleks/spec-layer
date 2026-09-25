/**
 * placeholders.ts — what a writing section says when nobody has written it.
 *
 * A selected section whose whole body is prose used to be left out when there
 * was no prose (AI off, the allowance spent, or a failed request). It is now
 * drawn as a marked placeholder with guidance, in the same shape and the same
 * editorial slots the filled section uses, so someone can type over it on the
 * canvas and an Update keeps what they wrote (see canvasProse.ts,
 * PLACEHOLDER_KEY). Guidance is never prose: it is never stored, exported or
 * hashed as editorial text.
 *
 * Pure data. No Figma globals.
 */
import type { SectionId } from './docModel';

/** The label on every placeholder box. */
export const PLACEHOLDER_TAG = 'Placeholder';

export interface PlaceholderCard { rule: string; reason: string }

/** The shape a placeholder takes: the filled section's own structure, one
 *  guidance entry deep. */
export type PlaceholderShape =
  | { kind: 'paragraph'; slot: 'definition'; text: string }
  | { kind: 'bullets'; slot: 'pointer' | 'semantics' | 'content'; text: string }
  | {
      kind: 'twoColumns';
      left: { heading: string; slot: 'whenToUse'; text: string };
      right: { heading: string; slot: 'whenNotToUse'; text: string };
    }
  | { kind: 'guidelinePair'; do: PlaceholderCard; dont: PlaceholderCard }
  | { kind: 'keyboardRow'; key: string; action: string };

const SHAPES: Partial<Record<SectionId, PlaceholderShape>> = {
  definition: { kind: 'paragraph', slot: 'definition', text: 'Describe what this component is and what it is for.' },
  whenToUse: {
    kind: 'twoColumns',
    left: { heading: 'When to use', slot: 'whenToUse', text: 'Describe the situations where this component is the right choice.' },
    right: { heading: 'When not to use', slot: 'whenNotToUse', text: 'Name the cases where another component fits better, and which one.' },
  },
  dosDonts: {
    kind: 'guidelinePair',
    do: { rule: 'Describe a correct use.', reason: 'Say why it works.' },
    dont: { rule: 'Describe a misuse to avoid.', reason: 'Say what goes wrong.' },
  },
  keyboard: {
    kind: 'keyboardRow',
    key: 'Key',
    action: 'Describe what this key does, for example Tab moves focus to the component.',
  },
  pointer: { kind: 'bullets', slot: 'pointer', text: 'Describe what hover, press, and drag do.' },
  accessibility: {
    kind: 'bullets', slot: 'semantics',
    text: 'Describe the role, the accessible name, and the states a screen reader announces.',
  },
  contentConsiderations: {
    kind: 'bullets', slot: 'content',
    text: 'Describe label length, tone, truncation, and localization rules.',
  },
};

/** The placeholder for a section left empty for lack of writing, or null when
 *  the section is built from the spec and an empty one has nothing to write. */
export function placeholderShapeFor(id: SectionId): PlaceholderShape | null {
  return SHAPES[id] ?? null;
}
