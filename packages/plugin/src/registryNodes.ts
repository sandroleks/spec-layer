/// <reference types="@figma/plugin-typings" />
/**
 * registryNodes.ts: the doc registry's ids, resolved to the Sections they name.
 *
 * Under "dynamic-page" access getNodeByIdAsync can reject, not only resolve
 * null, for a page the plugin has not loaded. Six walks in main.ts each
 * guarded that in their own loop with one sequential await per id, so a
 * 100-doc registry was 100 bridge round trips in series before any of them
 * could start its real work. This is that loop written once, with the reads
 * issued together. Registry order is kept: the result is in `docIds` order,
 * never completion order, so no caller sees a different doc first.
 *
 * Figma-typed but host-injected, so a test hands in plain objects.
 */

/** The one call this module makes. The `figma` global satisfies it. */
export interface NodeLookup {
  getNodeByIdAsync(id: string): Promise<BaseNode | null>;
}

export interface RegistrySection {
  docId: string;
  section: SectionNode;
}

/**
 * Every registry id that still names a Section, in registry order. An id whose
 * read resolves null, resolves to another node type, or rejects is left out;
 * the caller decides whether that means "prune" (requestLibrary) or "skip"
 * (everything else).
 */
export async function resolveRegistrySections(
  docIds: readonly string[], lookup: NodeLookup,
): Promise<RegistrySection[]> {
  const nodes = await Promise.all(docIds.map(async (docId): Promise<BaseNode | null> => {
    try { return await lookup.getNodeByIdAsync(docId); } catch { return null; }
  }));
  const out: RegistrySection[] = [];
  nodes.forEach((node, i) => {
    if (node && node.type === 'SECTION') out.push({ docId: docIds[i], section: node as SectionNode });
  });
  return out;
}

/** The PageNode a node lives on, or null. Walks parents until a PAGE. */
export function pageOf(node: BaseNode): PageNode | null {
  let cur: BaseNode | null = node;
  while (cur) {
    if (cur.type === 'PAGE') return cur as PageNode;
    cur = (cur as SceneNode).parent ?? null;
  }
  return null;
}
