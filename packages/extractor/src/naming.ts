import type { SerializedNode } from './tree';

/** Parse "Style=Filled, State=Enabled" into { Style: 'Filled', State: 'Enabled' };
 *  null if any segment is not Axis=Value. */
export function parseVariantName(name: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const segment of name.split(',')) {
    const [axis, ...rest] = segment.split('=');
    if (!rest.length) return null;
    out[axis.trim()] = rest.join('=').trim();
  }
  return out;
}

/** Layer names carry Figma prop-binding artifacts like "icon-primary#" — strip them. */
export const cleanPartName = (name: string) => name.replace(/#+\s*$/, '').trim();

/**
 * Component PROPERTY names carry a "#nodeId:n" suffix ("Label#123:4"); take the
 * part before the first hash.
 *
 * Deliberately different from cleanPartName, which strips only a TRAILING hash
 * from LAYER names. They handle different Figma artifacts and merging them
 * would mangle a layer legitimately called "icon#2".
 */
export const cleanPropName = (raw: string) => raw.split('#')[0];

/**
 * Assign each child a part name unique among its SIBLINGS: the first keeps the
 * clean name, later same-named siblings get " (2)", " (3)". Numbering runs over
 * ALL children including hidden ones, so a part keeps the same name in a variant
 * where a same-named sibling happens to be hidden.
 */
export function siblingPartNames(children: SerializedNode[]): Map<SerializedNode, string> {
  const counts = new Map<string, number>();
  const out = new Map<SerializedNode, string>();
  for (const child of children) {
    const base = cleanPartName(child.name);
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    out.set(child, n === 1 ? base : `${base} (${n})`);
  }
  return out;
}

/**
 * Depth-first walk that hands each node its disambiguated part name. Replaces
 * per-call `cleanPartName(n.name)`, which merged same-named siblings into one
 * part. `skipInvisible` prunes hidden subtrees (token extraction wants that so
 * presence-driven conditioning works; gap detection does not).
 */
export function walkParts(
  root: SerializedNode,
  rootName: string,
  visit: (n: SerializedNode, part: string) => void,
  skipInvisible = false,
): void {
  if (skipInvisible && root.visible === false) return;
  visit(root, rootName);
  const kids = root.children ?? [];
  const names = siblingPartNames(kids);
  for (const child of kids) walkParts(child, names.get(child)!, visit, skipInvisible);
}
