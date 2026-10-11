import type { SerializedNode } from './tree';
import { defaultVariant, extractAnatomy, type AnatomyPart } from './anatomy';
import {
  extractProps, extractVariants, extractStates, unsupportedProperties, type ComponentProp, type VariantAxis,
} from './props';
import { separateSlotContent, slotDefaultsByProperty, type PropertyIssue } from './slots';
import { extractTokens, extractGaps, variantAxisModel, type TokenRule, type Gap, type VariantAxisModel } from './tokens';
import { extractLayout, type LayoutSummary } from './layout';
import { extractRawValues, type RawValue } from './rawValues';
import { extractNodeEffects, type NodeEffects } from './effects';
import { extractTransitions, type TransitionRule, type TransitionIssue } from './transitions';

/**
 * One variant instance under a COMPONENT_SET (or the lone COMPONENT). `values`
 * come from the shared axis model (the raw name under `Variant` when any sibling
 * is not axis=value shaped), so they agree with extractTokens' rule conditions.
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
  /** The Figma file's NAME, when known (`figma.root.name` is main-thread only);
   *  omitted, never a placeholder. Rendered, so in specContentHash: a rename is drift. */
  figmaFileName?: string;
  figmaNode: string;
  /** The root's Figma description verbatim, '' when none. Rendered, so in specHashProjection. */
  description: string;
  /** Documentation link URLs on the root. Rendered, so hashed. */
  documentationLinks: string[];
  anatomy: AnatomyPart[];
  /** The default variant COMPONENT: anatomy part ids map into it, and the doc frame screenshots it. */
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
  /** Effect layers on the default variant. Never in specContentHash, like
   *  rawValues. Joined on (path, property), never path alone: one node has several rows. */
  nodeEffects: NodeEffects[];
  /** Variant transitions from prototype reactions. Rendered (Motion section),
   *  so hashed, under a key present only when non-empty. Optional only so the
   *  hand-built specs in tests keep compiling; extract() always sets it. */
  transitions?: TransitionRule[];
  /** CHANGE_TO destinations outside the set. Not rendered, so not hashed;
   *  validate() reports them. */
  transitionIssues?: TransitionIssue[];
  /** Properties and slots the extractor cannot document as asked. Not
   *  rendered, so not hashed; validate() reports them. Optional like
   *  transitionIssues; extract() always sets it. */
  propertyIssues?: PropertyIssue[];
}

function toVariantInstances(model: VariantAxisModel): VariantInstance[] {
  return model.variants.map((v, i) => ({ nodeId: v.id, name: v.name, values: model.combos[i] }));
}

export function extract(
  source: SerializedNode,
  meta: { figmaFile: string; figmaFileName?: string },
): IntermediateSpec {
  // Every walk below reads the separated tree: a slot's default content is an
  // example, so it reaches no part, related name, token rule or gap.
  const { root, defaultContent, issues: slotIssues } = separateSlotContent(source);
  const { parts, related, componentId } = extractAnatomy(root, defaultContent);
  // One model for extractTokens and toVariantInstances, so the Variant
  // pseudo-axis fallback fires identically and rule conditions always match the
  // instances' `values`.
  const model = variantAxisModel(root);
  const transitions = extractTransitions(root, model);
  const slotDefaults = slotDefaultsByProperty(root, defaultVariant(root), defaultContent);
  const props = extractProps(root).map((p) => {
    const content = p.kind === 'slot' ? slotDefaults.get(p.name) : undefined;
    return content ? { ...p, defaultContent: content } : p;
  });
  return {
    name: root.name,
    figmaKey: root.key ?? '',
    figmaFile: meta.figmaFile,
    ...(meta.figmaFileName ? { figmaFileName: meta.figmaFileName } : {}),
    figmaNode: root.id,
    description: root.description ?? '',
    documentationLinks: root.documentationLinks ?? [],
    anatomy: parts,
    anatomyComponentId: componentId,
    props,
    variants: extractVariants(root),
    variantInstances: toVariantInstances(model),
    states: extractStates(root),
    tokens: extractTokens(root, model),
    related,
    gaps: extractGaps(root),
    layout: extractLayout(root),
    rawValues: extractRawValues(root),
    nodeEffects: extractNodeEffects(root),
    transitions: transitions.rules,
    transitionIssues: transitions.issues,
    propertyIssues: [...unsupportedProperties(root), ...slotIssues],
  };
}
