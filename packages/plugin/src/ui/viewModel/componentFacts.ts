/** What the Component screen derives from the extracted spec, computed once outside the DOM. */

import { detectStateMatrix, type IntermediateSpec } from '@spec-layer/extractor';
import { isAtomComponentName } from '../../collectComponents';
import { defaultVariantId } from '../docModel';

export interface VariantChip {
  text: string;
  /** Shown as a muted prefix. Absent on flag and muted chips. */
  axis?: string;
  tone: 'value' | 'flag' | 'muted';
  /** The full axis and value, for the tooltip. */
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
  /** Any anatomy part hidden by default; shows the "Document hidden elements" option. */
  hasHiddenParts: boolean;
}

/** Before extraction finishes there are no facts, and the screen must not guess. */
export const NO_FACTS: ComponentFacts = {
  isAtom: false,
  hasStates: null,
  variants: [],
  defaultVariantIds: new Set<string>(),
  hasHiddenParts: false,
};

/**
 * An enum value keeps its axis, a true boolean is a flag, a false one is
 * dropped. An emptied row says "All off" (it need not be the default variant),
 * titled with the axes that are off: the row checkbox's accessible name is
 * built from the titles.
 */
function chipsFor(values: Record<string, string>): VariantChip[] {
  const chips: VariantChip[] = [];
  const off: string[] = [];
  for (const [axis, value] of Object.entries(values)) {
    const low = value.toLowerCase();
    if (low === 'false') {
      off.push(`${axis}: ${value}`);
      continue;
    }
    if (low === 'true') {
      chips.push({ text: axis, tone: 'flag', title: `${axis}: ${value}` });
    } else {
      chips.push({ text: value, axis, tone: 'value', title: `${axis}: ${value}` });
    }
  }
  if (chips.length === 0) {
    return [{ text: 'All off', tone: 'muted', title: off.length ? off.join(', ') : 'All off' }];
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
    hasHiddenParts: spec.anatomy.some((part) => part.hiddenByDefault === true),
  };
}
