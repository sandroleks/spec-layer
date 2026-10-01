import type { SerializedNode, LayoutInfo } from './tree';
import { defaultVariant } from './anatomy';
import { cleanPartName, walkParts } from './naming';

export interface LayoutValues { radius?: number; gap?: number }
/**
 * `part` is the raw leaf layer name, `path` the full identity from the root.
 * `path` joins a layout entry to the TokenRule on the SAME node (`part` is
 * unique only among siblings). `part` stays the raw `n.name` because
 * specContentHash hashes it; walkParts' disambiguated name would move every
 * committed doc's hash.
 */
export interface LayoutSummary { part: string; path: string; summary: string; values: LayoutValues }

/** The numbers `fmt()` renders, built from the same LayoutInfo so the prose
 *  and the structured values a finding compares cannot disagree. */
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
 * Layout summaries for the default variant's parts, for the prose prompt and
 * the geometry finding. Uses walkParts like extractTokens, so `path` matches a
 * TokenRule's byte for byte; a second walk would make validate.ts's join
 * silently match nothing.
 */
export function extractLayout(root: SerializedNode): LayoutSummary[] {
  const out: LayoutSummary[] = [];
  // Test the ORIGINAL root: the unwrapped default variant is a COMPONENT, so
  // the root would be named after a variant and every path would miss its join.
  const isInSet = root.type === 'COMPONENT_SET';
  // skipInvisible stays false: the prose prompt includes a hidden node's layout.
  walkParts(defaultVariant(root), isInSet ? 'Container' : cleanPartName(root.name), (n, _part, path) => {
    if (!n.layout) return;
    const summary = fmt(n.layout);
    if (summary) out.push({ part: n.name, path, summary, values: valuesOf(n.layout) });
  }, false);
  return out;
}
