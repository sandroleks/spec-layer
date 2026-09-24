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

export interface RegistryScan {
  /** Every registry id that still names a Section, in registry order. */
  sections: RegistrySection[];
  /** Registry ids whose read REJECTED rather than resolving, in registry
   *  order. Distinct from an id that resolved null or to a non-Section node:
   *  those are simply absent from `sections`, because a resolved value is
   *  real evidence about the doc. A reject (under dynamic-page access,
   *  usually an unloaded page) is not, so a caller that prunes on absence
   *  from `sections` must first add these ids back in, or it deletes a
   *  registry entry for a doc it never actually got to read. */
  rejected: string[];
}

/**
 * Every registry id resolved in one concurrent batch, split into the ones
 * that still name a Section and the ones whose read rejected. An id whose
 * read resolves null or to another node type is left out of both lists; the
 * caller decides whether that absence means "prune" (requestLibrary) or
 * "skip" (everything else).
 */
export async function resolveRegistrySections(
  docIds: readonly string[], lookup: NodeLookup,
): Promise<RegistryScan> {
  interface Read { docId: string; node: BaseNode | null; rejected: boolean }
  const reads = await Promise.all(docIds.map(async (docId): Promise<Read> => {
    try { return { docId, node: await lookup.getNodeByIdAsync(docId), rejected: false }; } catch { return { docId, node: null, rejected: true }; }
  }));
  const sections: RegistrySection[] = [];
  const rejected: string[] = [];
  for (const read of reads) {
    if (read.rejected) { rejected.push(read.docId); continue; }
    if (read.node && read.node.type === 'SECTION') sections.push({ docId: read.docId, section: read.node as SectionNode });
  }
  return { sections, rejected };
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
