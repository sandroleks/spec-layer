import type { SerializedNode } from './tree';
import { parseVariantName, siblingPartNames } from './naming';

export interface AnatomyPart {
  id: string; name: string; type: string; nested: boolean;
  /** 0 = direct part; deeper levels indent in the legend/table. */
  depth: number;
  /** Main-component name when nested. */
  component?: string;
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

/**
 * Anatomy is a BOUNDED depth-first walk (MAX_DEPTH levels) starting from the
 * direct, visible children of the default variant: it lists the component's
 * primary named parts plus their meaningful nested structure, matching how
 * design systems document anatomy (a top-level part can itself have labeled
 * sub-parts). This still differs by design from token/gap extraction
 * (tokens.ts), which walks the full tree unbounded because bindings live on
 * nested layers — the two depths are not meant to align. Markdown rendering
 * (render.ts) only surfaces depth-0 parts, to keep the prose list simple; the
 * deeper levels are for the canvas anatomy frame only.
 *
 * Single-wrapper descent: when the default variant has exactly ONE visible
 * child whose type is FRAME or GROUP (the common "everything in one auto-layout
 * wrapper" pattern), anatomy descends into that child's children before listing
 * parts, so the wrapper itself is not surfaced as the sole anatomy element.
 */
export function extractAnatomy(root: SerializedNode): AnatomyResult {
  const parts: AnatomyPart[] = [];
  const related = new Set<string>();

  // Resolve which children to list as anatomy parts, descending through any
  // sole FRAME/GROUP container so we surface real parts instead of a wrapper.
  // Guard: only descend when the sole FRAME/GROUP child itself has at least one
  // visible child — otherwise we would surface an empty parts list instead of
  // the wrapper, which is a silent failure.
  let children = (defaultVariant(root).children ?? []).filter((c) => c.visible);
  while (
    children.length === 1 &&
    (children[0].type === 'FRAME' || children[0].type === 'GROUP') &&
    (children[0].children ?? []).filter((c) => c.visible).length > 0
  ) {
    children = (children[0].children ?? []).filter((c) => c.visible);
  }

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
  const addParts = (nodes: SerializedNode[], depth: number): void => {
    const names = siblingPartNames(nodes);
    for (const child of nodes) {
      if (!child.visible) continue;
      const nested = child.type === 'INSTANCE';
      if (nested && child.mainComponent) related.add(child.mainComponent.name);
      parts.push({
        id: child.id, name: names.get(child)!, type: child.type, nested, depth,
        ...(nested && child.mainComponent ? { component: child.mainComponent.name } : {}),
      });
      if (!nested && depth + 1 < MAX_DEPTH && child.children?.length) {
        addParts(child.children, depth + 1);
      }
    }
  };
  addParts(children, 0);
  return { parts, related: [...related], componentId: defaultVariant(root).id };
}
