/**
 * componentFacts.ts — what the screen needs to know about the selection.
 *
 * `ComponentScreenState` carries the component's name and where the build got
 * to. Three parts of the screen need more than that: the atom notice, the
 * States row, and the variant picker all read the extracted spec. Deriving
 * them once here keeps the screen a function of its inputs and keeps this
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
  /** null while extraction is still reading the component. */
  hasStates: boolean | null;
  variants: VariantRowView[];
  defaultVariantIds: Set<string>;
}

/** Before extraction finishes there are no facts, and the screen must not guess. */
export const NO_FACTS: ComponentFacts = {
  isAtom: false,
  hasStates: null,
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
    if (low === 'true') {
      chips.push({ text: axis, tone: 'flag', title: `${axis}: ${value}` });
    } else {
      chips.push({ text: value, axis, tone: 'value', title: `${axis}: ${value}` });
    }
  }
  if (chips.length === 0) {
    return [{ text: 'Default', tone: 'muted', title: 'Default' }];
  }
  return chips;
}

export function componentFacts(
  spec: IntermediateSpec | null,
  nodeName: string,
): ComponentFacts {
  if (!spec) {
    return isAtomComponentName(nodeName)
      ? { ...NO_FACTS, isAtom: true }
      : NO_FACTS;
  }
  const defaultId = defaultVariantId(spec);
  return {
    isAtom: isAtomComponentName(nodeName),
    hasStates: Boolean(detectStateMatrix(spec.variants)),
    variants: spec.variantInstances.map((instance) => ({
      nodeId: instance.nodeId,
      chips: chipsFor(instance.values),
    })),
    defaultVariantIds: new Set(defaultId ? [defaultId] : []),
  };
}
