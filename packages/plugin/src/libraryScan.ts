/// <reference types="@figma/plugin-typings" />
/**
 * One Library refresh, from registry ids to LibraryEntry rows. Kept out of
 * main.ts, which registers Figma listeners on import, so tests can reach it.
 * The scan never throws and never prunes; `libraryReply` decides. `alive` is a
 * safe prune set only when `error` is null, and a rejected read is folded in
 * either way, since it is not evidence the doc is gone.
 */
import {
  unitContent, foundationUnitContentHash, type FoundationSpec,
} from '@spec-layer/extractor';
import type { LibraryEntry, MainToUi } from './messages';
import {
  DOC_LINK_KEY, parseDocLink, isFoundationLink, retargetScope, textContentHash,
} from './docLink';
import { collectGeneratedText, type ProseNodeLike } from './canvasProse';
import { scopeIconKind } from './foundationIcon';
import { pageOf, resolveRegistrySections, type NodeLookup } from './registryNodes';

export interface LibraryScanHost extends NodeLookup {
  /** One live foundation extraction, or null when it failed. Called lazily,
   *  at most once per scan. */
  liveFoundation(): Promise<FoundationSpec | null>;
}

export interface LibraryScan {
  entries: LibraryEntry[];
  /** Registry ids that resolved to a Section still carrying a doc link.
   *  Complete only when `error` is null. */
  alive: Set<string>;
  /** The text of the throw that stopped the scan, or null when it ran to the end. */
  error: string | null;
}

/** A component doc's source read. `exists` is false only on a resolved null:
 *  a REJECTED read is usually an unloaded page under dynamic-page access. */
interface SourceRead { node: BaseNode | null; exists: boolean }

async function readSource(lookup: NodeLookup, id: string): Promise<SourceRead> {
  try {
    const node = await lookup.getNodeByIdAsync(id);
    return { node, exists: node !== null };
  } catch {
    return { node: null, exists: true };
  }
}

export async function scanLibrary(
  docIds: readonly string[], host: LibraryScanHost,
): Promise<LibraryScan> {
  const entries: LibraryEntry[] = [];
  const alive = new Set<string>();
  let live: Promise<FoundationSpec | null> | null = null;
  const liveFoundation = (): Promise<FoundationSpec | null> => {
    if (!live) live = host.liveFoundation();
    return live;
  };
  try {
    const { sections, rejected } = await resolveRegistrySections(docIds, host);
    // A rejected read is never pruned, and builds no row.
    for (const docId of rejected) alive.add(docId);
    const linked = sections.map(({ docId, section }) => ({
      docId, section, data: parseDocLink(section.getPluginData(DOC_LINK_KEY)),
    }));
    // Component sources resolve in one batch too, index-aligned with `linked`.
    const sources = await Promise.all(linked.map(({ data }) => (
      data && !isFoundationLink(data) ? readSource(host, data.sourceNodeId) : Promise.resolve(null)
    )));

    for (let i = 0; i < linked.length; i++) {
      const { docId, section, data } = linked[i];
      if (!data) continue; // detached or foreign Section still in the index: the caller prunes it
      // Alive before branching on kind, so no valid doc is pruned.
      alive.add(docId);
      const selfEdited = textContentHash(collectGeneratedText(section as unknown as ProseNodeLike)) !== data.selfHash;
      const page = pageOf(section);

      if (isFoundationLink(data)) {
        const title = section.name.replace(/^Foundations: /, '');
        const spec = await liveFoundation();
        // Retarget before hashing (see retargetScope), so a re-created
        // collection reads as "Update available", not "Source missing".
        const scope = spec ? retargetScope(data.scope, spec.collections) : data.scope;
        // A scope that no longer resolves is orphaned. When extraction failed
        // outright, the doc gets the benefit of the doubt: no evidence.
        const content = spec ? unitContent(spec, scope) : null;
        const currentContentHash = spec ? foundationUnitContentHash(content) : undefined;
        const sourceExists = spec ? content !== null : true;
        entries.push({
          docId,
          kind: 'foundation',
          label: `Foundations · ${title}`,
          componentName: `Foundations · ${title}`,
          pageName: page?.name ?? '',
          sourceLabel: data.scope.target === 'collection'
            ? data.scope.collectionName
            : data.scope.target === 'textStyles' ? 'Text styles' : 'Effect styles',
          generatedAt: data.generatedAt,
          sourceNodeId: '',
          sourceExists,
          selfEdited,
          storedContentHash: data.contentHash,
          currentContentHash,
          // From the retargeted scope, so a renamed collection keeps its icon.
          foundationIcon: scopeIconKind(spec, scope),
          // RETARGETED too: Copy matches this id against the UI's foundation dump.
          foundationScope: scope,
        });
        continue;
      }

      const source = sources[i] ?? { node: null, exists: true };
      const sourcePage = source.node ? pageOf(source.node) : null;
      const name = section.name.replace(/: Documentation$/, '');
      entries.push({
        docId,
        kind: 'component',
        label: name,
        componentName: name,
        pageName: page?.name ?? '',
        // The source's page, else the name when there is no page to point at.
        sourceLabel: sourcePage?.name || name,
        generatedAt: data.generatedAt,
        sourceNodeId: data.sourceNodeId,
        sourceExists: source.exists,
        selfEdited,
        storedContentHash: data.contentHash,
        extractorVersion: data.extractorVersion,
        includeHidden: data.config.includeHidden,
      });
    }
    return { entries, alive, error: null };
  } catch (err) {
    return { entries, alive, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * What `requestLibrary` posts for a scan, and whether to prune. Complete: post
 * and prune. Failed with rows: post them as `incomplete`, no prune. Failed
 * with none: `libraryError`, no prune. `alive` is untrustworthy past a failure.
 */
export function libraryReply(scan: LibraryScan): { message: MainToUi; prune: boolean } {
  if (scan.error === null) {
    return { message: { type: 'library', entries: scan.entries }, prune: true };
  }
  if (scan.entries.length > 0) {
    return { message: { type: 'library', entries: scan.entries, incomplete: true }, prune: false };
  }
  return { message: { type: 'libraryError', message: scan.error }, prune: false };
}
