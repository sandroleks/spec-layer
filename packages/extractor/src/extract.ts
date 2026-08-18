import type { SerializedNode } from './tree';
import { extractAnatomy, type AnatomyPart } from './anatomy';
import { extractProps, extractVariants, extractStates, type ComponentProp, type VariantAxis } from './props';
import { extractTokens, extractGaps, variantAxisModel, type TokenRule, type Gap, type VariantAxisModel } from './tokens';
import { extractLayout, type LayoutSummary } from './layout';
import { extractRawValues, type RawValue } from './rawValues';

/**
 * One physical variant instance under a COMPONENT_SET (or the lone COMPONENT
 * when no set exists). Carries the Figma node id so the docs site can fetch a
 * preview image, and the axis values from the shared axis model (parsed from
 * the variant name, or the raw name keyed under `Variant` when any sibling
 * name is not axis=value shaped) — guaranteed to agree with the conditions on
 * the rules extractTokens emits.
 */
export interface VariantInstance {
  nodeId: string;
  name: string;
  values: Record<string, string>;
}

export interface IntermediateSpec {
  name: string;
  figmaKey: string;
  figmaFile: string;
  figmaNode: string;
  anatomy: AnatomyPart[];
  /** Node id of the default-variant COMPONENT — the coordinate space anatomy
   *  part ids map into, and the node the doc frame screenshots for its diagram. */
  anatomyComponentId: string;
  props: ComponentProp[];
  variants: VariantAxis[];
  variantInstances: VariantInstance[];
  states: string[];
  tokens: TokenRule[];
  related: string[];
  gaps: Gap[];
  layout: LayoutSummary[];
  rawValues: RawValue[];
}

function toVariantInstances(model: VariantAxisModel): VariantInstance[] {
  return model.variants.map((v, i) => ({ nodeId: v.id, name: v.name, values: model.combos[i] }));
}

export function extract(
  root: SerializedNode,
  meta: { figmaFile: string },
): IntermediateSpec {
  const { parts, related, componentId } = extractAnatomy(root);
  // Built once and threaded into both extractTokens and toVariantInstances.
  // This isn't just avoiding duplicate work: variantAxisModel's fallback (every
  // variant collapsing to a Variant pseudo-axis) must fire identically for both
  // consumers, or the conditions on emitted token rules stop agreeing with the
  // `values` recorded on variant instances, and resolveTokensForVariant can no
  // longer match them. One shared model makes that agreement structural instead
  // of relying on both call sites happening to compute the same thing.
  const model = variantAxisModel(root);
  return {
    name: root.name,
    figmaKey: root.key ?? '',
    figmaFile: meta.figmaFile,
    figmaNode: root.id,
    anatomy: parts,
    anatomyComponentId: componentId,
    props: extractProps(root),
    variants: extractVariants(root),
    variantInstances: toVariantInstances(model),
    states: extractStates(root),
    tokens: extractTokens(root, model),
    related,
    gaps: extractGaps(root),
    layout: extractLayout(root),
    rawValues: extractRawValues(root),
  };
}
