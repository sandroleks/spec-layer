import type { SerializedNode } from './tree';
import { detectStateMatrix } from './statesMatrix';
import { cleanPropName } from './naming';

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

export function extractProps(root: SerializedNode): ComponentProp[] {
  return Object.entries(root.propertyDefinitions ?? {}).map(([raw, def]) => ({
    name: cleanPropName(raw),
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
 * The component's states, from the SAME detection the States matrix uses, so
 * the two cannot disagree. Flag-encoded states come back in column order, with
 * "Default" as the synthesized base column.
 */
export function extractStates(root: SerializedNode): string[] {
  const info = detectStateMatrix(extractVariants(root));
  if (!info) return ['Default'];
  const labels = info.columns.map((c) => c.label);
  // Unreachable from real Figma data; keeps the ['Default'] fallback contract.
  return labels.length ? labels : ['Default'];
}
