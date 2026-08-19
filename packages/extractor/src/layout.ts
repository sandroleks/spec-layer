import type { SerializedNode, LayoutInfo } from './tree';
import { defaultVariant } from './anatomy';

export interface LayoutValues { radius?: number; gap?: number }
export interface LayoutSummary { part: string; summary: string; values: LayoutValues }

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

/** Layout summaries for the default variant's parts — feeds the prose prompt, not the rendered spec. */
export function extractLayout(root: SerializedNode): LayoutSummary[] {
  const out: LayoutSummary[] = [];
  const walk = (n: SerializedNode): void => {
    if (n.layout) {
      const summary = fmt(n.layout);
      if (summary) out.push({ part: n.name, summary, values: valuesOf(n.layout) });
    }
    n.children?.forEach(walk);
  };
  walk(defaultVariant(root));
  return out;
}
