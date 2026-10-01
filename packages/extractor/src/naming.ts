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

/** Tested one character at a time, never against a run, so it stays linear. */
const WHITESPACE = /\s/;

/**
 * Strip Figma prop-binding artifacts like "icon-primary#" (trailing hashes and
 * any whitespace after them), then trim.
 *
 * A reverse scan, because `replace(/#+\s*$/, '')` is quadratic on a long run
 * of `#`. It must reproduce that regex exactly: part names feed anatomy, token
 * paths and `specContentHash`. Read it right to left as `$`, `\s*`, `#+`.
 */
export function cleanPartName(name: string): string {
  let end = name.length;
  while (end > 0 && WHITESPACE.test(name[end - 1])) end--;
  const afterHashes = end;
  while (end > 0 && name[end - 1] === '#') end--;
  // No hash: the regex would replace nothing, so only trim.
  return afterHashes === end ? name.trim() : name.slice(0, end).trim();
}

/**
 * Component PROPERTY names carry a "#nodeId:n" suffix ("Label#123:4"). Not
 * cleanPartName, which strips only TRAILING hashes so a layer called "icon#2"
 * survives.
 */
export const cleanPropName = (raw: string) => raw.split('#')[0];

/**
 * A part name unique among SIBLINGS: later same-named siblings get " (2)",
 * " (3)". Numbering counts hidden children too, so a part keeps its name in a
 * variant where a same-named sibling is hidden.
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
 * Join a parent path and a child part name. A slash inside a layer name is
 * escaped so the path stays unambiguous and still readable by eye.
 */
export function joinPath(parentPath: string, part: string): string {
  const escaped = part.replace(/\//g, '\\/');
  return parentPath ? `${parentPath}/${escaped}` : escaped;
}

/**
 * Depth-first walk handing each node its sibling-disambiguated part name and
 * its path identity from the component root, joined with `/`.
 *
 * `skipInvisible` prunes hidden subtrees; a PREDICATE prunes something
 * narrower (token extraction passes `hiddenPartRules().prune`, which keeps a
 * layer a boolean property can reveal).
 */
export function walkParts(
  root: SerializedNode,
  rootName: string,
  visit: (n: SerializedNode, part: string, path: string) => void,
  skipInvisible: boolean | ((n: SerializedNode) => boolean) = false,
  parentPath = '',
): void {
  if (typeof skipInvisible === 'function' ? skipInvisible(root) : skipInvisible && root.visible === false) return;
  const path = joinPath(parentPath, rootName);
  visit(root, rootName, path);
  const kids = root.children ?? [];
  const names = siblingPartNames(kids);
  for (const child of kids) {
    walkParts(child, names.get(child)!, visit, skipInvisible, path);
  }
}
