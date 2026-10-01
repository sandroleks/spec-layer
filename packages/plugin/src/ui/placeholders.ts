/**
 * What an unwritten writing section shows: guidance in the filled section's
 * shape and editorial slots, so someone can type over it and an Update keeps
 * it (canvasProse.ts, PLACEHOLDER_KEY). Guidance is never stored, exported or
 * hashed as prose. Pure data.
 */
import type { SectionId } from './docModel';

export const PLACEHOLDER_TAG = 'Placeholder';

export interface PlaceholderCard { rule: string; reason: string }

/** The filled section's structure, one guidance entry deep. */
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

/** Null for a spec-built section, where an empty one has nothing to write. */
export function placeholderShapeFor(id: SectionId): PlaceholderShape | null {
  return SHAPES[id] ?? null;
}
