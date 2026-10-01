import type { SerializedNode } from './tree';
import { parseVariantName, siblingPartNames, cleanPartName, cleanPropName, joinPath } from './naming';

export interface AnatomyPart {
  id: string; name: string; type: string; nested: boolean;
  /** Path identity from the component root, shared with `walkParts` (tokens.ts,
   *  gaps.ts). Anatomy is bounded and stops at instances, so a token path can
   *  be deeper than any anatomy path. */
  path: string;
  /** 0 = direct part; deeper levels indent in the legend/table. */
  depth: number;
  /** Main-component name when nested. */
  component?: string;
  /** TEXT parts only, kept for a future WCAG threshold lookup (contrast.ts requiredRatio). No current reader. */
  text?: { fontSize?: number; fontWeight?: number };
  /** Hidden in the default variant and shown by a boolean property. Absent,
   *  never false, when shown by default. Descendants carry it too, so
   *  `anatomyFor` drops the whole subtree. */
  hiddenByDefault?: true;
  /** The boolean property that shows the part (nearest binding on it or an
   *  ancestor), cleaned as props.ts does. Present iff hiddenByDefault. */
  shownBy?: string;
}
export interface AnatomyResult { parts: AnatomyPart[]; related: string[]; componentId: string }

const MAX_DEPTH = 3;

/**
 * The variant Figma treats as default: the one matching every VARIANT
 * property's `defaultValue`, not child order, since variants reorder freely.
 * Falls back to the first COMPONENT child.
 */
export function defaultVariant(root: SerializedNode): SerializedNode {
  if (root.type !== 'COMPONENT_SET' || !root.children?.length) return root;
  const variants = root.children.filter((c) => c.type === 'COMPONENT');
  if (!variants.length) return root.children[0];

  const declared = Object.entries(root.propertyDefinitions ?? {})
    .filter(([, d]) => d.type === 'VARIANT' && typeof d.defaultValue === 'string')
    .map(([axis, d]) => [axis, d.defaultValue as string] as const);

  if (declared.length) {
    const match = variants.find((v) => {
      const combo = parseVariantName(v.name);
      return combo != null && declared.every(([axis, value]) => combo[axis] === value);
    });
    if (match) return match;
  }
  return variants[0];
}

/** The root's BOOLEAN definition keys. A variant's own read throws in Figma,
 *  so definitions are recorded only on the set or standalone component. */
function booleanPropertyKeys(root: SerializedNode): Set<string> {
  return new Set(
    Object.entries(root.propertyDefinitions ?? {})
      .filter(([, def]) => def.type === 'BOOLEAN')
      .map(([key]) => key),
  );
}

/** The root BOOLEAN a hidden node is bound to, or undefined. Only such a node
 *  can a consumer turn on, so only it is documented as a hidden part. */
function hiddenBoundTo(node: SerializedNode, booleans: Set<string>): string | undefined {
  if (node.visible) return undefined;
  if (node.visibleProperty === undefined || !booleans.has(node.visibleProperty)) return undefined;
  return cleanPropName(node.visibleProperty);
}

/** Keep a child when it is visible, or hidden and bound to a root boolean. */
function isDocumentable(node: SerializedNode, booleans: Set<string>): boolean {
  return node.visible || hiddenBoundTo(node, booleans) !== undefined;
}

/** Hidden-layer rules resolved once against a root's BOOLEAN definitions. */
export interface HiddenPartRules {
  /** Hidden and not bound to a root BOOLEAN, so never surfaced. Every walk prunes exactly this. */
  prune(node: SerializedNode): boolean;
  /** The cleaned boolean that shows this node; ignores ancestors. */
  shownBy(node: SerializedNode): string | undefined;
}

/**
 * One definition of "hidden but documentable", shared by anatomy and token
 * extraction so both walks agree on which hidden layers keep their bindings.
 */
export function hiddenPartRules(root: SerializedNode): HiddenPartRules {
  const booleans = booleanPropertyKeys(root);
  return {
    prune: (node) => !isDocumentable(node, booleans),
    shownBy: (node) => hiddenBoundTo(node, booleans),
  };
}

/**
 * A bounded depth-first walk (MAX_DEPTH) from the default variant's direct
 * children that are visible, or hidden but shown by a boolean property
 * (`hiddenByDefault`). Token extraction walks the full tree unbounded, since
 * bindings live on nested layers; the two depths are not meant to align.
 *
 * Single-wrapper descent: when the default variant has exactly one visible
 * FRAME or GROUP child, anatomy descends into it so the wrapper is not the sole
 * part. Hidden bound layers take no part in that decision and are named only
 * after the visible children, so a doc with the option off keeps its parts,
 * names, paths and order. Depth-0 parts are listed in layer order.
 */
export function extractAnatomy(root: SerializedNode): AnatomyResult {
  const parts: AnatomyPart[] = [];
  const related = new Set<string>();

  // The same root name as walkParts' `rootName` in tokens.ts and gaps.ts.
  const isInSet = root.type === 'COMPONENT_SET';
  const def = defaultVariant(root);
  const rootPath = isInSet ? 'Container' : cleanPartName(def.name);

  // Descend through a sole FRAME/GROUP wrapper only when it has a visible
  // child, or the parts list would silently come out empty.
  //
  // The decision uses visible children alone, so a hidden bound layer never
  // changes which wrapper is descended and a doc with the option off keeps its
  // tree shape and hash. Hidden bound layers skipped on the way down are listed
  // at depth 0 after the descended parts.
  //
  // The skipped wrapper still occupies a level in the shared path namespace
  // (walkParts never skips it), so its name folds into `parentPath`.
  const booleans = booleanPropertyKeys(root);

  /** A depth-0 part and its level's path: descended parts sit under the wrapper, skipped hidden ones do not. */
  interface TopLevelEntry { node: SerializedNode; parentPath: string }

  let siblingSet = def.children ?? [];
  let children = siblingSet.filter((c) => c.visible);
  let parentPath = rootPath;
  const skippedHidden: TopLevelEntry[] = [];
  while (
    children.length === 1 &&
    (children[0].type === 'FRAME' || children[0].type === 'GROUP') &&
    (children[0].children ?? []).filter((c) => c.visible).length > 0
  ) {
    for (const node of siblingSet) {
      if (node !== children[0] && hiddenBoundTo(node, booleans) !== undefined) {
        skippedHidden.push({ node, parentPath });
      }
    }
    const names = siblingPartNames(siblingSet);
    parentPath = joinPath(parentPath, names.get(children[0])!);
    siblingSet = children[0].children ?? [];
    children = siblingSet.filter((c) => c.visible);
  }

  // Naming and ordering are separate questions. NAMES use the visible-first
  // basis: visible children, then hidden ones, then hidden ones skipped past a
  // wrapper. Visible parts keep their pre-feature names, hidden ones continue
  // the counters, and no hidden sibling can take a visible part's name.
  const namingOrder: SerializedNode[] = [
    ...children,
    ...siblingSet.filter((c) => hiddenBoundTo(c, booleans) !== undefined),
    ...skippedHidden.map((e) => e.node),
  ];
  const topNames = siblingPartNames(namingOrder);

  // ORDER is layer order, so pins ascend left to right. Parts skipped past a
  // wrapper stay last. With the option off this is `children` again, node for
  // node, which keeps an existing doc's anatomy and specContentHash identical.
  const topLevel: TopLevelEntry[] = [
    ...siblingSet
      .filter((c) => isDocumentable(c, booleans))
      .map((node) => ({ node, parentPath })),
    ...skippedHidden,
  ];

  // Same-named siblings (a leading and a trailing "icon") are numbered, not
  // deduped: they are two real parts, often with different token bindings.
  //
  // Instance boundaries stop the walk (an instance's internals belong to its
  // own spec), but the main-component name is recorded in `related` and on the part.
  //
  // A hidden bound part is kept and marked, and its descendants inherit the
  // mark (nearest binding wins). `related` takes only parts shown by default,
  // because it feeds every existing doc's canvas hash.
  //
  // Depth 1 and deeper name over ALL children, so a visible part keeps its
  // name and position and a hidden bound part takes the name already reserved.
  function pushPart(
    child: SerializedNode, depth: number, childParentPath: string, name: string,
    inheritedShownBy: string | undefined,
  ): void {
    const shownBy = hiddenBoundTo(child, booleans) ?? inheritedShownBy;
    const nested = child.type === 'INSTANCE';
    if (nested && child.mainComponent && shownBy === undefined) related.add(child.mainComponent.name);
    const path = joinPath(childParentPath, name);
    parts.push({
      id: child.id, name, type: child.type, nested, depth, path,
      ...(nested && child.mainComponent ? { component: child.mainComponent.name } : {}),
      ...(child.text ? { text: child.text } : {}),
      ...(shownBy !== undefined ? { hiddenByDefault: true as const, shownBy } : {}),
    });
    if (!nested && depth + 1 < MAX_DEPTH && child.children?.length) {
      addParts(child.children, depth + 1, path, shownBy);
    }
  }

  function addParts(
    nodes: SerializedNode[], depth: number, nodesParentPath: string, inheritedShownBy: string | undefined,
  ): void {
    const names = siblingPartNames(nodes);
    for (const child of nodes) {
      if (!isDocumentable(child, booleans)) continue;
      pushPart(child, depth, nodesParentPath, names.get(child)!, inheritedShownBy);
    }
  }

  for (const entry of topLevel) {
    pushPart(entry.node, 0, entry.parentPath, topNames.get(entry.node)!, undefined);
  }
  return { parts, related: [...related], componentId: def.id };
}

export interface AnatomyOptions {
  /** Include `hiddenByDefault` parts: the doc's `includeHidden` on canvas, always true for the export. */
  includeHidden: boolean;
}

/**
 * The one predicate every canvas consumer and the canvas hash filter anatomy
 * through. Returns the same array when nothing is filtered, so callers can rely on identity.
 */
export function anatomyFor(parts: AnatomyPart[], options: AnatomyOptions): AnatomyPart[] {
  return options.includeHidden ? parts : parts.filter((p) => !p.hiddenByDefault);
}
