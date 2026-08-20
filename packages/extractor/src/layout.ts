import type { SerializedNode, LayoutInfo } from './tree';
import { defaultVariant } from './anatomy';
import { cleanPartName, walkParts } from './naming';

export interface LayoutValues { radius?: number; gap?: number }
/**
 * `part` is the leaf layer name, `path` the full identity from the component
 * root down. Both are kept, and they are deliberately NOT the same string:
 *
 *  - `path` exists so a finding can join a layout entry to the TokenRule bound
 *    on the SAME node. `part` cannot do that job, because it is unique only
 *    among siblings (see the grouping comment in tokens.ts): two nodes named
 *    `Icon` in different subtrees share one flat `part` key.
 *  - `part` keeps the raw `n.name` it has always carried rather than being
 *    recomputed through walkParts, because specContentHash hashes it. Swapping
 *    it for walkParts' sibling-disambiguated name would move the content_hash
 *    of every committed doc for a change that alters no rendered output.
 */
export interface LayoutSummary { part: string; path: string; summary: string; values: LayoutValues }

/** The numbers `fmt()` renders into its sentence, kept alongside it so the
 *  prose and the structured numbers a finding can compare against a token's
 *  resolved value are built from the same LayoutInfo and can never disagree. */
function valuesOf(l: LayoutInfo): LayoutValues {
  return {
    ...(l.cornerRadius !== undefined ? { radius: l.cornerRadius } : {}),
    ...(l.itemSpacing !== undefined ? { gap: l.itemSpacing } : {}),
  };
}

function fmt(l: LayoutInfo): string {
  const bits: string[] = [];
  if (l.mode) bits.push(l.mode.toLowerCase());
  const pads = [l.paddingTop ?? 0, l.paddingRight ?? 0, l.paddingBottom ?? 0, l.paddingLeft ?? 0];
  if (pads.some((p) => p > 0)) bits.push(`padding ${pads.join('/')}`);
  if (l.itemSpacing !== undefined) bits.push(`gap ${l.itemSpacing}`);
  if (l.cornerRadius !== undefined) bits.push(`radius ${l.cornerRadius}`);
  return bits.join(', ');
}

/**
 * Layout summaries for the default variant's parts. Feeds the prose prompt and
 * the geometry finding, not the rendered spec.
 *
 * The walk is walkParts, the same one extractTokens and extractGaps use, so
 * `path` here is byte-identical to the `path` on a TokenRule for the same node.
 * Hand-rolling a second walk is what the old version did, and a second
 * vocabulary would make validate.ts's join match nothing and kill the geometry
 * rule silently in production instead of fixing it.
 */
export function extractLayout(root: SerializedNode): LayoutSummary[] {
  const out: LayoutSummary[] = [];
  // Read from the ORIGINAL root, before defaultVariant unwraps it: after
  // unwrapping, a set's default variant is a COMPONENT just like a standalone
  // component, so testing the unwrapped node would name the root after a
  // variant ("Style=Filled, State=Enabled") and every path here would miss the
  // rules it has to join against.
  const isInSet = root.type === 'COMPONENT_SET';
  // skipInvisible stays false: this list also feeds the prose prompt, whose
  // current output includes a hidden node's layout, and changing which parts
  // appear at all is not part of a join fix.
  walkParts(defaultVariant(root), isInSet ? 'Container' : cleanPartName(root.name), (n, _part, path) => {
    if (!n.layout) return;
    const summary = fmt(n.layout);
    if (summary) out.push({ part: n.name, path, summary, values: valuesOf(n.layout) });
  }, false);
  return out;
}
