import type { SerializedNode } from './tree';
import { detectStateMatrix } from './statesMatrix';

export type PropKind = 'variant' | 'boolean' | 'text' | 'instanceSwap';

export interface ComponentProp {
  name: string;
  kind: PropKind;
  options?: string[];
  default?: string | boolean;
}

export interface VariantAxis {
  prop: string;
  values: string[];
}

const KIND_MAP: Record<string, PropKind> = {
  VARIANT: 'variant',
  BOOLEAN: 'boolean',
  TEXT: 'text',
  INSTANCE_SWAP: 'instanceSwap',
};

/** Figma encodes non-variant prop names as "Name#nodeId:n" — strip the suffix. */
const cleanName = (raw: string) => raw.split('#')[0];

export function extractProps(root: SerializedNode): ComponentProp[] {
  return Object.entries(root.propertyDefinitions ?? {}).map(([raw, def]) => ({
    name: cleanName(raw),
    kind: KIND_MAP[def.type],
    ...(def.variantOptions !== undefined ? { options: def.variantOptions } : {}),
    default: def.defaultValue,
  }));
}

export function extractVariants(root: SerializedNode): VariantAxis[] {
  return extractProps(root)
    .filter((p) => p.kind === 'variant')
    .map((p) => ({ prop: p.name, values: p.options ?? [] }));
}

/**
 * The component's states, using the SAME detection the States matrix uses.
 * An earlier version matched only a prop literally named "state", so a
 * `Status=[Enabled,Hover,Disabled]` component reported ["Default"] in the spec
 * while the matrix rendered three columns for the same component.
 * Flag-encoded states ("Default" plus one column per boolean) come back in
 * column order; "Default" is the synthesized base column.
 */
export function extractStates(root: SerializedNode): string[] {
  const info = detectStateMatrix(extractVariants(root));
  if (!info) return ['Default'];
  return info.columns.map((c) => c.label);
}
