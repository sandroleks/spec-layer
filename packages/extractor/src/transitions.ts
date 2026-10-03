// packages/extractor/src/transitions.ts
/**
 * Variant transitions: prototype interactions whose CHANGE_TO destination is
 * another variant of the same component set. Rendered as the Motion section,
 * so they are hashed (hash.ts routes them); ids and paths stay out of the
 * hash as token rules' do.
 */
import type { SerializedNode, SerializedTrigger, SerializedTransitionEffect } from './tree';
import { cleanPartName, walkParts } from './naming';
import type { VariantAxisModel } from './tokens';
import { canonicalJson } from './v5/canonical';

export interface TransitionRule {
  /** Axis values of the variant holding the trigger, from the shared axis model. */
  from: Record<string, string>;
  fromVariantId: string;
  to: Record<string, string>;
  toVariantId: string;
  trigger: SerializedTrigger;
  /** Display name of the layer carrying the reaction; `triggerPath` is the join key. */
  triggerPart: string;
  triggerPath: string;
  transition: SerializedTransitionEffect;
}

/** A CHANGE_TO whose destination is not a variant of this set. Reported, never listed. */
export interface TransitionIssue { path: string; destinationId: string }

export function extractTransitions(
  root: SerializedNode, model: VariantAxisModel,
): { rules: TransitionRule[]; issues: TransitionIssue[] } {
  const isInSet = root.type === 'COMPONENT_SET';
  const valuesById = new Map<string, Record<string, string>>();
  model.variants.forEach((variant, i) => valuesById.set(variant.id, model.combos[i]));
  const rules: TransitionRule[] = [];
  const issues: TransitionIssue[] = [];
  const seen = new Set<string>();
  model.variants.forEach((variant, i) => {
    const from = model.combos[i];
    walkParts(variant, isInSet ? 'Container' : cleanPartName(variant.name), (n, part, path) => {
      for (const t of n.transitions ?? []) {
        const to = isInSet ? valuesById.get(t.destinationId) : undefined;
        if (to === undefined) {
          issues.push({ path, destinationId: t.destinationId });
          continue;
        }
        const rule: TransitionRule = {
          from, fromVariantId: variant.id, to, toVariantId: t.destinationId,
          trigger: t.trigger, triggerPart: part, triggerPath: path, transition: t.transition,
        };
        const key = canonicalJson({ from, to, trigger: t.trigger, path, transition: t.transition });
        if (seen.has(key)) continue;
        seen.add(key);
        rules.push(rule);
      }
    });
  });
  return { rules, issues };
}
