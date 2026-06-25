import type { SerializedNode } from './tree';

export interface AnatomyPart { id: string; name: string; type: string; nested: boolean }
export interface AnatomyResult { parts: AnatomyPart[]; related: string[]; componentId: string }

/** Default variant = first child of a COMPONENT_SET; a bare COMPONENT is its own default. */
export function defaultVariant(root: SerializedNode): SerializedNode {
  return root.type === 'COMPONENT_SET' && root.children?.length ? root.children[0] : root;
}

/**
 * Anatomy is intentionally a SHALLOW walk: it lists the component's primary
 * named parts (the direct, visible children of the default variant), matching
 * how design systems document anatomy. This differs by design from token/gap
 * extraction (tokens.ts), which walks the full tree because bindings live on
 * nested layers. The two depths are not meant to align.
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

  // Anatomy is a list of MEANINGFUL parts: a leading and trailing icon wrapper
  // both named "iconWrapper" only carry one anatomy entry's worth of information.
  // Dedup by name (keep first occurrence) so the list reads cleanly.
  const seenNames = new Set<string>();
  for (const child of children) {
    const nested = child.type === 'INSTANCE';
    if (nested && child.mainComponent) related.add(child.mainComponent.name);
    if (seenNames.has(child.name)) continue;
    seenNames.add(child.name);
    parts.push({ id: child.id, name: child.name, type: child.type, nested });
  }
  return { parts, related: [...related], componentId: defaultVariant(root).id };
}
