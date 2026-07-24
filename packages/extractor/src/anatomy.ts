import type { SerializedNode } from './tree';

export interface AnatomyPart {
  id: string; name: string; type: string; nested: boolean;
  /** 0 = direct part; deeper levels indent in the legend/table. */
  depth: number;
  /** Main-component name when nested. */
  component?: string;
}
export interface AnatomyResult { parts: AnatomyPart[]; related: string[]; componentId: string }

const MAX_DEPTH = 3;

/** Default variant = first child of a COMPONENT_SET; a bare COMPONENT is its own default. */
export function defaultVariant(root: SerializedNode): SerializedNode {
  return root.type === 'COMPONENT_SET' && root.children?.length ? root.children[0] : root;
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

  // Anatomy is a list of MEANINGFUL parts: a leading and trailing icon wrapper
  // both named "iconWrapper" only carry one anatomy entry's worth of information.
  // Dedup by name (keep first occurrence) so the list reads cleanly. Dedup is
  // SIBLING-scoped (a fresh Set per parent) so identically-named parts at
  // different nesting levels (e.g. a "label" inside a nested "meta" part) are
  // not silently dropped just because a top-level part shares the name.
  //
  // The walk is depth-first and bounded (MAX_DEPTH): parts push in
  // (parent, then its children, then next sibling) order, matching how a
  // reader would naturally list a component's structure. Instance boundaries
  // stop the walk — an instance's internals belong to its own spec — but the
  // instance's main-component name is still recorded (both as a `related`
  // atom and on the part itself) at whatever depth it's found.
  const addParts = (nodes: SerializedNode[], depth: number, seenNames: Set<string>): void => {
    for (const child of nodes) {
      if (!child.visible) continue;
      const nested = child.type === 'INSTANCE';
      if (nested && child.mainComponent) related.add(child.mainComponent.name);
      if (seenNames.has(child.name)) continue;
      seenNames.add(child.name);
      parts.push({
        id: child.id, name: child.name, type: child.type, nested, depth,
        ...(nested && child.mainComponent ? { component: child.mainComponent.name } : {}),
      });
      if (!nested && depth + 1 < MAX_DEPTH && child.children?.length) {
        addParts(child.children, depth + 1, new Set<string>());
      }
    }
  };
  addParts(children, 0, new Set<string>());
  return { parts, related: [...related], componentId: defaultVariant(root).id };
}
