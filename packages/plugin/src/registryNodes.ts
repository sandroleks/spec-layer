/// <reference types="@figma/plugin-typings" />
/**
 * The doc registry's ids, resolved to their Sections in one concurrent batch.
 * Under "dynamic-page" access getNodeByIdAsync can reject, not only resolve
 * null, for an unloaded page. Results keep `docIds` order, never completion
 * order. Host-injected, so a test hands in plain objects.
 */

/** The `figma` global satisfies it. */
export interface NodeLookup {
  getNodeByIdAsync(id: string): Promise<BaseNode | null>;
}

export interface RegistrySection {
  docId: string;
  section: SectionNode;
}

export interface RegistryScan {
  sections: RegistrySection[];
  /** Ids whose read rejected (usually an unloaded page). A resolved null is
   *  evidence about the doc; a reject is not, so a caller that prunes on
   *  absence from `sections` must spare these. */
  rejected: string[];
}

/** An id that resolves null or to a non-Section is in neither list; the
 *  caller decides whether that means prune (requestLibrary) or skip. */
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

/** The PageNode a node lives on, or null. */
export function pageOf(node: BaseNode): PageNode | null {
  let cur: BaseNode | null = node;
  while (cur) {
    if (cur.type === 'PAGE') return cur as PageNode;
    cur = (cur as SceneNode).parent ?? null;
  }
  return null;
}
