import type { SerializedNode } from './tree';
import { parseVariantName, siblingPartNames, cleanPartName, cleanPropName, joinPath } from './naming';

export interface AnatomyPart {
  id: string; name: string; type: string; nested: boolean;
  /** Path identity from the component root, the same identity `walkParts`
   *  produces for tokens.ts and gaps.ts. Anatomy is a bounded (MAX_DEPTH),
   *  instance-stopping view of the same namespace, so a token path can be
   *  deeper than any anatomy path reaches — that's expected, not a mismatch. */
  path: string;
  /** 0 = direct part; deeper levels indent in the legend/table. */
  depth: number;
  /** Main-component name when nested. */
  component?: string;
  /** TEXT parts only: font size/weight, kept for a future WCAG contrast
   *  threshold lookup (see contrast.ts's requiredRatio). No current reader. */
  text?: { fontSize?: number; fontWeight?: number };
  /** True when the part is hidden in the default variant and a boolean
   *  component property shows it. Absent, never false, on parts shown by
   *  default. Descendants of a hidden part carry it too: they are hidden in
   *  practice, and one predicate (`anatomyFor`) has to drop the whole subtree. */
  hiddenByDefault?: true;
  /** Cleaned name of the boolean property that shows the part (the nearest
   *  binding on the part or an ancestor). Same cleaning as props.ts, so it
   *  matches the Configuration table's spelling. Present iff hiddenByDefault. */
  shownBy?: string;
}
export interface AnatomyResult { parts: AnatomyPart[]; related: string[]; componentId: string }

const MAX_DEPTH = 3;

/**
 * The variant Figma treats as the default: the one whose combo matches every
 * VARIANT property's declared `defaultValue`. Child order is NOT the default
 * (a designer can reorder variants freely), so falling back to children[0]
 * would silently document a different variant than the one Figma shows.
 * Falls back to the first COMPONENT child when nothing is declared or the
 * declared combo matches no existing variant.
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

/** Raw keys of the root's BOOLEAN property definitions. Definitions live on
 *  the COMPONENT_SET (or standalone COMPONENT); a variant's own read throws in
 *  Figma, so the serializer never records any there. */
function booleanPropertyKeys(root: SerializedNode): Set<string> {
  return new Set(
    Object.entries(root.propertyDefinitions ?? {})
      .filter(([, def]) => def.type === 'BOOLEAN')
      .map(([key]) => key),
  );
}

/** The boolean property a hidden node is bound to, or undefined when the node
 *  is visible, unbound, or bound to a property the root does not define as a
 *  BOOLEAN. Only such a node can be turned on by a consumer, so only such a
 *  node is worth documenting as a hidden part. */
function hiddenBoundTo(node: SerializedNode, booleans: Set<string>): string | undefined {
  if (node.visible) return undefined;
  if (node.visibleProperty === undefined || !booleans.has(node.visibleProperty)) return undefined;
  return cleanPropName(node.visibleProperty);
}

/** Keep a child when it is visible, or hidden and bound to a root boolean. */
function isDocumentable(node: SerializedNode, booleans: Set<string>): boolean {
  return node.visible || hiddenBoundTo(node, booleans) !== undefined;
}

/** The two questions any extractor asks about a hidden layer, resolved once
 *  against a root's BOOLEAN property definitions. */
export interface HiddenPartRules {
  /** True when the node can never be surfaced: hidden, and not bound to a root
   *  BOOLEAN a consumer could turn on. Every walk prunes exactly this. */
  prune(node: SerializedNode): boolean;
  /** The cleaned boolean property that shows this node, or undefined when the
   *  node is visible or unbound. Does not look at ancestors. */
  shownBy(node: SerializedNode): string | undefined;
}

/**
 * One definition of "hidden but documentable", shared by anatomy and token
 * extraction.
 *
 * `extractTokens` used to prune every invisible subtree, so a layer a boolean
 * property reveals had its bindings dropped before any consumer could ask for
 * them: the Tokens section showed nothing for a revealed icon, whatever the
 * doc's option said. Both walks now agree, because both come through here.
 */
export function hiddenPartRules(root: SerializedNode): HiddenPartRules {
  const booleans = booleanPropertyKeys(root);
  return {
    prune: (node) => !isDocumentable(node, booleans),
    shownBy: (node) => hiddenBoundTo(node, booleans),
  };
}

/**
 * Anatomy is a BOUNDED depth-first walk (MAX_DEPTH levels) starting from the
 * direct children of the default variant that are visible, or hidden but
 * shown by a boolean component property (marked `hiddenByDefault`): it lists
 * the component's primary named parts plus their meaningful nested structure,
 * matching how design systems document anatomy (a top-level part can itself
 * have labeled sub-parts). This still differs by design from token/gap
 * extraction (tokens.ts), which walks the full tree unbounded because
 * bindings live on nested layers — the two depths are not meant to align.
 * Markdown rendering (render.ts) only surfaces depth-0 parts, to keep the
 * prose list simple; the deeper levels are for the canvas anatomy frame only.
 *
 * Single-wrapper descent: when the default variant has exactly ONE VISIBLE
 * child whose type is FRAME or GROUP (the common "everything in one auto-layout
 * wrapper" pattern), anatomy descends into that child's children before listing
 * parts, so the wrapper itself is not surfaced as the sole anatomy element.
 * Hidden bound layers take no part in that decision and no part in the depth-0
 * NAMING basis until after the visible children have taken their names, so
 * the parts a doc draws with the option off are exactly the parts it drew
 * before this feature existed, down to their names, paths and order. Depth-0
 * parts are then LISTED in layer order, hidden ones interleaved where they
 * really sit, so the canvas callouts ascend in reading order.
 */
export function extractAnatomy(root: SerializedNode): AnatomyResult {
  const parts: AnatomyPart[] = [];
  const related = new Set<string>();

  // The path namespace anatomy shares with tokens.ts/gaps.ts: both start a
  // walk from the same root name (walkParts' `rootName` argument there).
  const isInSet = root.type === 'COMPONENT_SET';
  const def = defaultVariant(root);
  const rootPath = isInSet ? 'Container' : cleanPartName(def.name);

  // Resolve which children to list as anatomy parts, descending through any
  // sole FRAME/GROUP container so we surface real parts instead of a wrapper.
  // Guard: only descend when the sole FRAME/GROUP child itself has at least one
  // visible child — otherwise we would surface an empty parts list instead of
  // the wrapper, which is a silent failure.
  //
  // The decision is made on VISIBLE children alone, exactly as it was before
  // hidden bound layers were documented at all. A hidden bound layer can
  // therefore never change which wrapper is descended, nor whether a wrapper is
  // listed instead of descended into, so a doc with the option off keeps the
  // tree shape and the hash it already had. Hidden bound layers skipped on the
  // way down are collected and listed at depth 0 after the descended parts.
  //
  // The skipped wrapper still occupies a level in the shared path namespace
  // (walkParts never skips it), so its name is folded into `parentPath` as we
  // descend, keeping a nested part's path identical to what tokens.ts/gaps.ts
  // would produce for the same node.
  const booleans = booleanPropertyKeys(root);

  /** A depth-0 part together with the path of the level it was found on:
   *  descended parts sit under the wrapper, skipped hidden ones do not. */
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

  // Naming and ordering are two separate questions, and conflating them is
  // what made the canvas callouts read "2, 1, 4".
  //
  // NAMES come from the visible-first basis: visible children in their
  // original order, then the hidden ones, then the hidden ones skipped past a
  // descended wrapper. `siblingPartNames` therefore hands every visible part
  // exactly the name the pre-feature code gave it, and the hidden ones
  // continue the same counters, so no two depth-0 parts share a name and no
  // hidden sibling can take a visible part's name by preceding it.
  const namingOrder: SerializedNode[] = [
    ...children,
    ...siblingSet.filter((c) => hiddenBoundTo(c, booleans) !== undefined),
    ...skippedHidden.map((e) => e.node),
  ];
  const topNames = siblingPartNames(namingOrder);

  // ORDER is real layer order, so a horizontal component's pins ascend left to
  // right. Parts skipped past a descended wrapper were found on an outer level
  // and have no position among the descended siblings, so they stay last,
  // exactly where they already were. With the option off the hidden parts are
  // filtered out and this is `children` again, node for node, which is what
  // keeps an existing doc's anatomy and specContentHash byte-identical.
  const topLevel: TopLevelEntry[] = [
    ...siblingSet
      .filter((c) => isDocumentable(c, booleans))
      .map((node) => ({ node, parentPath })),
    ...skippedHidden,
  ];

  // Same-named siblings (a leading and a trailing "icon") are numbered rather
  // than deduped: they are two real parts with two real node ids and, often,
  // two different token bindings. An earlier version dropped the second, which
  // hid it from anatomy while tokens.ts silently merged both onto one part.
  //
  // The walk is depth-first and bounded (MAX_DEPTH): parts push in
  // (parent, then its children, then next sibling) order, matching how a
  // reader would naturally list a component's structure. Instance boundaries
  // stop the walk — an instance's internals belong to its own spec — but the
  // instance's main-component name is still recorded (both as a `related`
  // atom and on the part itself) at whatever depth it's found.
  //
  // A hidden part bound to a boolean is kept and marked; its descendants
  // inherit the mark (nearest binding wins) so one filter drops the subtree.
  // `related` is built from parts shown by default only: it feeds the canvas
  // hash of every existing doc, and a hidden nested instance still names its
  // component on the part itself.
  //
  // Depth 1 and deeper keep the pre-feature naming basis: names are computed
  // over ALL children, and a child is skipped only when it is neither visible
  // nor hidden-and-bound. A visible part therefore keeps the name and position
  // it always had, and a hidden bound part simply takes the name that basis
  // already reserved for it.
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
  /** Include parts marked `hiddenByDefault`. The canvas model and the canvas
   *  hash pass a doc's `includeHidden` config; the export always passes true. */
  includeHidden: boolean;
}

/**
 * The one predicate every canvas consumer and the canvas hash filter anatomy
 * through, so they cannot disagree about which parts a doc draws. Returns the
 * same array when nothing is filtered, so callers can rely on identity.
 */
export function anatomyFor(parts: AnatomyPart[], options: AnatomyOptions): AnatomyPart[] {
  return options.includeHidden ? parts : parts.filter((p) => !p.hiddenByDefault);
}
