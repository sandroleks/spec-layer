import type { SerializedNode } from './tree';
import { defaultVariant } from './anatomy';
import { cleanPartName, walkParts } from './naming';

export interface RawValue { part: string; property: string; value: string }

/** Bound-variable property names that cover each measure property. */
const PADDING_BINDINGS = new Set([
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'verticalPadding', 'horizontalPadding',
]);
const RADIUS_BINDINGS = new Set([
  'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
]);

/**
 * Hardcoded (unbound) values on the DEFAULT variant, shaped like token rules so
 * the variant cards can list them alongside real tokens in "unbound" style.
 * Additive: never included in the Markdown spec (content_hash stability).
 */
export function extractRawValues(root: SerializedNode): RawValue[] {
  const out: RawValue[] = [];
  const seen = new Set<string>();
  const push = (part: string, property: string, value: string): void => {
    const k = `${part}\0${property}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ part, property, value });
  };

  const def = defaultVariant(root);
  // skipInvisible=true: pruning has to happen IN THE WALKER, not in this
  // callback. walkParts recurses into every node's children unconditionally
  // once it has decided to visit that node — a callback-level
  // `if (n.visible === false) return` only stops that one node from pushing a
  // value, it cannot stop walkParts from descending into the hidden node's
  // children. So a hidden wrapper's visible descendants would still get
  // visited and leak raw values that were never reachable in the pre-walkParts
  // version of this file (whose private `walk` returned before recursing,
  // pruning the whole hidden subtree). Passing skipInvisible=true here
  // reproduces that exact semantics, because walkParts checks visibility
  // BEFORE calling visit and before recursing into children.
  walkParts(def, root.type === 'COMPONENT_SET' ? 'Container' : cleanPartName(def.name), (n, part) => {
    const bound = new Set((n.bindings ?? []).map((b) => b.property));

    if (n.unboundFill) push(part, 'fill', n.unboundFill);

    const l = n.layout;
    if (l) {
      const t = l.paddingTop ?? 0, r = l.paddingRight ?? 0, b = l.paddingBottom ?? 0, lf = l.paddingLeft ?? 0;
      const hasPad = t > 0 || r > 0 || b > 0 || lf > 0;
      if (hasPad && ![...PADDING_BINDINGS].some((p) => bound.has(p))) {
        if (t === r && r === b && b === lf) push(part, 'padding', String(t));
        else {
          if (lf === r && lf > 0) push(part, 'padding-x', String(lf));
          else {
            if (lf > 0) push(part, 'padding-left', String(lf));
            if (r > 0) push(part, 'padding-right', String(r));
          }
          if (t === b && t > 0) push(part, 'padding-y', String(t));
          else {
            if (t > 0) push(part, 'padding-top', String(t));
            if (b > 0) push(part, 'padding-bottom', String(b));
          }
        }
      }
      if (l.itemSpacing !== undefined && !bound.has('itemSpacing')) {
        push(part, 'gap', String(l.itemSpacing));
      }
      if (l.cornerRadius !== undefined && ![...RADIUS_BINDINGS].some((p) => bound.has(p))) {
        push(part, 'border-radius', String(l.cornerRadius));
      }
    }
  }, true);
  return out;
}
