/// <reference types="@figma/plugin-typings" />
/**
 * libraryScan.ts: one Library refresh, from registry ids to LibraryEntry rows.
 *
 * This was the body of main.ts's requestLibrary handler. It moved here for
 * one reason: the handler had no try/catch and no failure reply, so any throw
 * left the UI's refreshing flag set forever (Library spinning, Refresh and
 * Update disabled). A test can reach this function with fake nodes; it cannot
 * reach main.ts, which registers Figma listeners on import.
 *
 * The scan never throws. It returns what it collected and, when it stopped
 * early, the error's text. It never prunes; `libraryReply` below is the one
 * place that turns a `LibraryScan` into a reply and a prune decision, so the
 * three shapes (complete, partial with rows, failed with no rows) are covered
 * by a plain unit test rather than only by reading main.ts's control flow.
 * `alive` is a safe prune set only when `error` is null: a rejected read (see
 * `resolveRegistrySections`) is folded in regardless, since it is not
 * evidence the doc is gone, but a scan that stopped before reaching every doc
 * never saw the rest, and pruning on that partial set would drop live docs.
 */
import {
  unitContent, foundationContentHash, type FoundationSpec,
} from '@spec-layer/extractor';
import type { LibraryEntry, MainToUi } from './messages';
import {
  DOC_LINK_KEY, parseDocLink, isFoundationLink, retargetScope, textContentHash,
} from './docLink';
import { collectGeneratedText, type ProseNodeLike } from './canvasProse';
import { scopeIconKind } from './foundationIcon';
import { pageOf, resolveRegistrySections, type NodeLookup } from './registryNodes';

export interface LibraryScanHost extends NodeLookup {
  /** One live foundation extraction, or null when it failed. The scan calls it
   *  lazily and at most once, so a file with only component docs pays nothing
   *  and a file with ten foundation docs pays one read. */
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

/**
 * A component doc's source read. `exists` is false only on a resolved null. A
 * REJECTED read is not evidence the source is gone (under dynamic-page access
 * it is usually an unloaded page), so it keeps the benefit of the doubt, the
 * same rule the foundation branch applies when its extraction fails.
 */
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
    // A rejected read is not evidence the doc is gone (usually an unloaded
    // page under dynamic-page access), so it must never be pruned. It builds
    // no row either, since there is nothing here to build one from.
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
      // Mark alive before branching on kind, so the caller's prune never
      // drops a valid doc's id regardless of which branch builds its row.
      alive.add(docId);
      const selfEdited = textContentHash(collectGeneratedText(section as unknown as ProseNodeLike)) !== data.selfHash;
      const page = pageOf(section);

      if (isFoundationLink(data)) {
        const title = section.name.replace(/^Foundations: /, '');
        const spec = await liveFoundation();
        // A renamed collection still resolves by name: retarget the scope to
        // its current id before hashing, so a re-created collection reads as
        // "Update available" (true: the frame's rendered title changed) and
        // not "Source missing" (false: the collection is still there).
        // retargetScope only does this on an unambiguous single name match;
        // if several live collections share the name it leaves the dead id in
        // place, and the row reads as orphaned rather than silently binding
        // to a collection that may have nothing to do with this doc.
        const scope = spec ? retargetScope(data.scope, spec.collections) : data.scope;
        const currentContentHash = spec ? foundationContentHash(spec, scope) : undefined;
        // A scope that no longer resolves is orphaned. unitContent returns
        // null for a deleted collection, and foundationContentHash turns that
        // into a stable sentinel, so compare against unitContent directly
        // rather than re-deriving the sentinel here. When extraction failed
        // outright, give the doc the benefit of the doubt rather than
        // reporting it missing on no evidence.
        const sourceExists = spec ? unitContent(spec, scope) !== null : true;
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
          // Read from the retargeted scope, so a renamed collection keeps the
          // icon its variables earn rather than falling back to `mixed`.
          foundationIcon: scopeIconKind(spec, scope),
          // The RETARGETED scope, matching foundationIcon above: a renamed
          // collection resolves to its live id, which is the id Copy has to
          // match against the foundation dump the UI holds.
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
        // The source's page, and only that: a locator is worth showing only
        // when it says something the row title does not. Falls back to the
        // name when the source node is gone and there is no page to point at.
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
 * What `requestLibrary` posts for a scan, and whether its self-heal prune
 * should run. Three shapes: a complete scan posts `library` and prunes; a
 * scan that failed after collecting rows posts `library` with `incomplete:
 * true` (rows are real, but the list may be missing docs the scan never
 * reached) and does not prune, since `alive` is not trustworthy past the
 * failure; a scan that failed before any row posts `libraryError` and does
 * not prune either, for the same reason.
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
