import type { SerializedNode } from './tree';
import { defaultVariant } from './anatomy';
import { cleanPartName, walkParts } from './naming';
import { RADIUS_BINDINGS } from './tokens';

/** `path` is the walkParts identity; `part` the display name, unique only
 *  among siblings. Same split as TokenRule and Gap. */
export interface RawValue { part: string; path: string; property: string; value: string }

const PADDING_BINDINGS = new Set([
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'verticalPadding', 'horizontalPadding',
]);

/**
 * Hardcoded (unbound) values on the DEFAULT variant, shaped like token rules.
 * Excluded from specContentHash, so nothing here can mark a doc as drifted.
 * Keyed by path, not part: layers in different branches share names.
 */
export function extractRawValues(root: SerializedNode): RawValue[] {
  const out: RawValue[] = [];
  const seen = new Set<string>();
  const push = (part: string, path: string, property: string, value: string): void => {
    const k = JSON.stringify([path, property]);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ part, path, property, value });
  };

  const def = defaultVariant(root);
  // skipInvisible=true prunes IN THE WALKER: a callback-level visibility check
  // cannot stop walkParts descending into a hidden wrapper's children.
  walkParts(def, root.type === 'COMPONENT_SET' ? 'Container' : cleanPartName(def.name), (n, part, path) => {
    const bound = new Set((n.bindings ?? []).map((b) => b.property));

    if (n.unboundFill) push(part, path, 'fill', n.unboundFill);

    const l = n.layout;
    if (l) {
      const t = l.paddingTop ?? 0, r = l.paddingRight ?? 0, b = l.paddingBottom ?? 0, lf = l.paddingLeft ?? 0;
      const hasPad = t > 0 || r > 0 || b > 0 || lf > 0;
      if (hasPad && ![...PADDING_BINDINGS].some((p) => bound.has(p))) {
        if (t === r && r === b && b === lf) push(part, path, 'padding', String(t));
        else {
          if (lf === r && lf > 0) push(part, path, 'padding-x', String(lf));
          else {
            if (lf > 0) push(part, path, 'padding-left', String(lf));
            if (r > 0) push(part, path, 'padding-right', String(r));
          }
          if (t === b && t > 0) push(part, path, 'padding-y', String(t));
          else {
            if (t > 0) push(part, path, 'padding-top', String(t));
            if (b > 0) push(part, path, 'padding-bottom', String(b));
          }
        }
      }
      // Zero is the default, so a zero row tells the reader nothing.
      if (l.itemSpacing !== undefined && l.itemSpacing > 0 && !bound.has('itemSpacing')) {
        push(part, path, 'gap', String(l.itemSpacing));
      }
      if (l.cornerRadius !== undefined && l.cornerRadius > 0
          && ![...RADIUS_BINDINGS].some((p) => bound.has(p))) {
        push(part, path, 'border-radius', String(l.cornerRadius));
      }
    }
  }, true);
  return out;
}
