import type { SerializedNode, SerializedSlotDefinition } from './tree';
import type { PropertyIssue, SlotContentItem } from './slots';
import { detectStateMatrix } from './statesMatrix';
import { cleanPropName } from './naming';

export type PropKind = 'variant' | 'boolean' | 'text' | 'instanceSwap' | 'slot';

export interface ComponentProp {
  name: string;
  kind: PropKind;
  options?: string[];
  default?: string | boolean | undefined;
  /** Kind `slot` only: what Figma states about the slot. */
  slot?: SerializedSlotDefinition;
  /** Kind `slot` only: what the slot holds in the default variant. Absent
   *  when that variant has no slot for the property. */
  defaultContent?: SlotContentItem[];
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
  // Figma gives a SLOT definition no `defaultValue` key, so it carries no default.
  SLOT: 'slot',
};

const isKnownType = (type: string): boolean => Object.prototype.hasOwnProperty.call(KIND_MAP, type);

/** A property of a type Figma adds before the extractor knows it is left out
 *  and reported (`unsupportedProperties`), so it never reaches a renderer
 *  untyped, as SLOT once did. */
export function extractProps(root: SerializedNode): ComponentProp[] {
  return Object.entries(root.propertyDefinitions ?? {})
    .filter(([, def]) => isKnownType(def.type))
    .map(([raw, def]) => ({
      name: cleanPropName(raw),
      kind: KIND_MAP[def.type],
      ...(def.variantOptions !== undefined ? { options: def.variantOptions } : {}),
      default: def.defaultValue,
      ...(def.type === 'SLOT' && def.slot ? { slot: def.slot } : {}),
    }));
}

export function unsupportedProperties(root: SerializedNode): PropertyIssue[] {
  return Object.entries(root.propertyDefinitions ?? {})
    .filter(([, def]) => !isKnownType(def.type))
    .map(([raw, def]) => ({ kind: 'unsupported-property-type', property: cleanPropName(raw), figmaType: String(def.type) }));
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
