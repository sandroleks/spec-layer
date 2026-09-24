/// <reference types="@figma/plugin-typings" />
import { serializeNode, mainComponentRef } from './serialize';
import type { NodeResolver, ResolvedStyle } from './serialize';
import { memoizedResolver } from './resolverMemo';
import type { MainToUi, UiToMain, PublishComponentSource, PublishInfo } from './messages';
import { resolveFileKey } from './fileKey';
import { ProgrammaticSelection } from './programmaticSelection';
import { serializeFoundation } from './serializeFoundation';
import { createFoundationReader } from './foundationReader';
import { FoundationPostGate } from './foundationPost';
import {
  buildFoundation, planFoundationUnits, unitContent, foundationContentHash,
  foundationUnitTitle, groupRowsByFolder, colorContrast, isSemver,
  type FoundationSpec, type FoundationUnit, type FoundationUnitContent,
  type FoundationVariableRow, type SerializedFoundation,
  type ProseV2,
} from '@spec-layer/extractor';
import { buildDocFrames } from './docFrame';
import { buildFoundationFrame, isColorRow } from './foundationFrame';
import { emptyBrandTheme, resolveTheme, migrateBrandColors, type BrandTheme, type BrandColors } from './brandColors';
import { familiesWithRequiredStyles } from './fonts';
import { isComponentFormat, storedComponentFormat } from './componentFormat';
import {
  DOC_LINK_KEY, DOC_REGISTRY_KEY, DOC_PROSE_KEY, DOC_BASELINE_KEY,
  parseDocLink, serializeDocLink, parseRegistry, serializeRegistry, addDoc, removeDoc, pruneRegistry,
  textContentHash, isFoundationLink, foundationScopeKey, retargetScope,
  serializeProse, parseProse, mergeFoundationGroupDescriptions,
  serializeBaseline, baselineFor,
  type DocLinkData, type FoundationDocLink, type DocRegistry, type DocBaseline,
} from './docLink';
import { readCanvasProse, mergeProse, collectGeneratedText, type ProseNodeLike } from './canvasProse';
import { repaintPills } from './pillNode';
import { pageOf, resolveRegistrySections } from './registryNodes';
import { scanLibrary, libraryReply, type LibraryScan } from './libraryScan';
import { CanvasBuildGate, selectionToReplay } from './canvasBuild';
import { writeSetting, deleteSetting, storePublishIdentity } from './settingsStore';
import {
  PUBLISH_RECORD_KEY, parsePublishRecord, serializePublishRecord, pillState,
  type DocPublishRecord, type PillState,
} from './publishPill';

declare const __PLUGIN_VERSION__: string;

// User-customizable brand theme for the generated frame. Loaded from
// clientStorage on boot (migrating the legacy two-color 'brandColors' storage
// once), updated on 'setBrandTheme', and resolved to concrete values when
// building a frame.
let brandTheme: BrandTheme = emptyBrandTheme();
// User-captured logo (base64 PNG), stamped into the frame header.
let brandLogo: string | null = null;

// ---------------------------------------------------------------------------
// NodeResolver — wraps async Figma APIs
// ---------------------------------------------------------------------------
/** BaseStyle.type is a closed union; an unrecognized value cannot occur today
 *  and is dropped rather than guessed at, the same way a null style already is. */
const STYLE_KINDS: Record<string, ResolvedStyle['kind']> = {
  PAINT: 'paint-style', TEXT: 'text-style', EFFECT: 'effect-style', GRID: 'grid-style',
};

const resolver: NodeResolver = {
  async variable(id) {
    try {
      const v = await figma.variables.getVariableByIdAsync(id);
      if (!v) return null;
      // Variable.remote is Figma's own answer about whether this came from a
      // library. Carrying it is what lets the brief say `external` as a fact
      // instead of inferring it from a lookup that found nothing.
      return { id: v.id, name: v.name, remote: v.remote, collectionId: v.variableCollectionId };
    } catch {
      return null;
    }
  },
  async style(id) {
    try {
      const s = await figma.getStyleByIdAsync(id);
      if (!s) return null;
      const kind = STYLE_KINDS[s.type];
      // PublishableMixin.remote, inherited by every style.
      return kind ? { id: s.id, name: s.name, remote: s.remote, kind } : null;
    } catch {
      return null;
    }
  },
  async mainComponent(node) {
    try {
      const n = node as InstanceNode;
      if (typeof n.getMainComponentAsync !== 'function') return null;
      const mc = await n.getMainComponentAsync();
      if (!mc) return null;
      // When mc is a variant, its parent is a COMPONENT_SET carrying the real name/key.
      // BaseNode | null doesn't expose `.key`; narrow on type then cast to ComponentSetNode.
      const rawParent = mc.parent;
      const parent = rawParent
        ? {
            type: rawParent.type,
            name: rawParent.name,
            key: rawParent.type === 'COMPONENT_SET'
              ? (rawParent as ComponentSetNode).key
              : '',
          }
        : null;
      return mainComponentRef({ name: mc.name, key: mc.key, parent });
    } catch {
      return null;
    }
  },
};

// ---------------------------------------------------------------------------
// Foundation dump, cached for the session — the file's variables/styles feed
// token-value resolution in the component brief on every selection, but they
// change far less often than the selection itself, so re-serializing the
// whole file (every collection, every variable, every text style) on each
// click would be wasteful.
//
// Staleness: if a user edits a variable and then re-selects a component
// without visiting the Foundations tab, the brief resolves token values
// against the stale cached value. That is accepted here as a fair trade for
// not re-walking the file on every click; a plugin has no cheap, precise "did
// a variable value change" signal (figma.on('documentchange') fires on any
// document edit, including irrelevant ones, so keying invalidation off it
// would either over-invalidate — defeating the cache — or need per-change
// filtering that is its own project). The cache lives only for the session:
// closing and reopening the plugin always re-fetches. The Foundations tab's
// own fetch (`requestFoundation`, below) refreshes this same cache — both the
// tab's initial load and its "Refresh sources" button — so a user who
// suspects staleness has one discoverable way to clear it.
// ---------------------------------------------------------------------------
let foundationCache: { fileKey: string; dump: SerializedFoundation } | null = null;
const foundationPosts = new FoundationPostGate();

/**
 * One fresh read of the file's variables and styles. `publishStatus` is read
 * only for a dump the v5 projections will see (the selection cache below and
 * the Foundations tab's own reply). The drift, render and change-list paths
 * never read `publication`, and foundationContentHash does not hash it, so
 * they pass false and save one bridge call per variable, collection and style.
 */
async function readFoundationDump(fileKey: string, publishStatus: boolean): Promise<SerializedFoundation> {
  return serializeFoundation(
    createFoundationReader(figma.variables, figma, { publishStatus }),
    fileKey, new Date().toISOString(), figma.root.name,
  );
}

async function foundationFor(fileKey: string): Promise<SerializedFoundation> {
  if (foundationCache?.fileKey === fileKey) return foundationCache.dump;
  const dump = await readFoundationDump(fileKey, true);
  foundationCache = { fileKey, dump };
  return dump;
}

/**
 * The spec the last Library scan hashed every foundation row against.
 * requestDocBaseline diffs against THIS object and never a fresh read: the
 * change list must be computed over the same read that produced the badge, or
 * a list could disagree with the badge beside it. It also saves one whole-file
 * read per expanded row. Replaced on every Library scan; a fresh read is the
 * fallback only when no scan has run for this file.
 */
let lastLibraryFoundation: { fileKey: string; spec: FoundationSpec } | null = null;

// ---------------------------------------------------------------------------
// Find the relevant component in the current selection (walk up if needed)
// ---------------------------------------------------------------------------
function findComponent(
  selection: readonly SceneNode[],
): ComponentNode | ComponentSetNode | null {
  for (const node of selection) {
    let current: BaseNode | null = node;
    while (current) {
      if (current.type === 'COMPONENT_SET') {
        return current as ComponentSetNode;
      }
      if (current.type === 'COMPONENT') {
        const parent = (current as SceneNode).parent;
        if (parent?.type === 'COMPONENT_SET') {
          return parent as ComponentSetNode;
        }
        return current as ComponentNode;
      }
      current = (current as SceneNode).parent ?? null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Post the current selection to the UI
// ---------------------------------------------------------------------------
// The Figma file key (figma.fileKey) is embedded in each extracted spec so a
// downloaded spec can reference its source file. It's read-only here — there's
// no manual override in this build.

// Bumped on every selection change. Serializing a selection is async, so a
// rapid A->B switch can resolve out of order; only the latest request is allowed
// to post, so B never gets overwritten by a late-arriving A.
let selectionSeq = 0;

async function postSelection(): Promise<void> {
  const seq = ++selectionSeq;
  const resolved = resolveFileKey(figma.fileKey, null);
  const component = findComponent(figma.currentPage.selection);

  if (!component) {
    if (seq !== selectionSeq) return;
    const msg: MainToUi = { type: 'selection', node: null, fileKey: resolved.fileKey, fileKeySource: resolved.source, fileName: figma.root.name };
    figma.ui.postMessage(msg);
    return;
  }

  // Best-effort: a foundation failure (or simply none this file has ever
  // needed) must never block the selection. Resolving token values into the
  // component brief is a bonus on top of a successful extraction, not a
  // prerequisite for it, so an unresolved foundation here just means the
  // 'selection' message omits the field and the brief's token bindings omit
  // `value` (and `code`) instead, the same as the drift path already does.
  let foundation: SerializedFoundation | undefined;
  try {
    foundation = await foundationFor(resolved.fileKey);
  } catch (err) {
    // Still non-fatal, but no longer invisible. A persistent failure here is
    // the difference between "token values are missing because no foundation
    // has ever been fetched" (already shown in the brief's own caveat text)
    // and "a fetch was attempted for this selection and failed", and with a
    // bare catch the only symptom of the second was silence.
    console.warn('[Spec Layer] foundation unavailable, token values will be missing from the component brief:', err);
    foundation = undefined;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node = await serializeNode(component as any, memoizedResolver(resolver));
    if (seq !== selectionSeq) return; // a newer selection superseded this one
    const msg: MainToUi = {
      type: 'selection', node, fileKey: resolved.fileKey, fileKeySource: resolved.source,
      // figma.root.name is main-thread only, so the file's NAME has to ride
      // this message alongside its key; the UI cannot read it itself.
      fileName: figma.root.name,
      // Only when the UI does not already hold this exact dump. See
      // FoundationPostGate for why identity is the right test.
      ...(foundation && foundationPosts.fresh(foundation) ? { foundation } : {}),
    };
    figma.ui.postMessage(msg);
    // Whether Create would replace an existing doc, so the button can say
    // "Replace docs". The same lookup renderDocFrame uses, sent separately so
    // the panel never waits on the registry scan to show the selection.
    const docName = `${component.name}: Documentation`;
    void findExistingDoc(component.id, docName).then((doc) => {
      if (seq !== selectionSeq) return;
      figma.ui.postMessage({ type: 'selectionDoc', nodeId: node.id, hasDoc: doc !== null } as MainToUi);
    }).catch(() => { /* the button keeps saying Create docs, which is still true */ });
  } catch (err) {
    // Serialization failed: show the empty state rather than leaving the panel
    // stuck on the previous component with no feedback. Logged for the same
    // reason the foundation catch above is: a bare catch here made "this
    // component cannot be read" look identical to "nothing is selected".
    console.error(
      '[Spec Layer] selection serialization failed for',
      component.type, component.name, component.id, err,
    );
    if (seq !== selectionSeq) return;
    const msg: MainToUi = { type: 'selection', node: null, fileKey: resolved.fileKey, fileKeySource: resolved.source, fileName: figma.root.name };
    figma.ui.postMessage(msg);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
// The window title is the product name alone. Without `title` Figma uses the
// manifest name, which carries the Community listing's search words.
figma.showUI(__html__, { width: 480, height: 680, themeColors: true, title: 'Spec Layer' });

// Send stored license key (+ its activated instance id) and the Figma user id on startup
Promise.all([
  figma.clientStorage.getAsync('licenseKey') as Promise<string | undefined>,
  figma.clientStorage.getAsync('licenseInstanceId') as Promise<string | undefined>,
]).then(([value, instanceId]: [string | undefined, string | undefined]) => {
  const msg: MainToUi = { type: 'licenseKey', value: value ?? null, instanceId: instanceId ?? null };
  figma.ui.postMessage(msg);
}).catch(() => {/* ignore */});
// `figma.currentUser` is a getter that THROWS if the "currentuser" manifest
// permission is absent — optional chaining does not catch that, so guard it.
let figmaUserId: string | null = null;
try {
  figmaUserId = figma.currentUser?.id ?? null;
} catch {
  figmaUserId = null; // no identity → the UI simply hides the quota meter
}
figma.ui.postMessage({ type: 'userInfo', userId: figmaUserId } satisfies MainToUi);

// Send stored "Write with AI" preference on startup (default off)
figma.clientStorage.getAsync('aiEnabled').then((value: boolean | undefined) => {
  const msg: MainToUi = { type: 'aiEnabled', value: value === true };
  figma.ui.postMessage(msg);
}).catch(() => {/* ignore */});

// Send the stored component format on startup (default YAML). Anything but a
// known value reads as YAML, so a corrupt entry cannot choose a format.
figma.clientStorage.getAsync('componentFormat').then((value: unknown) => {
  const msg: MainToUi = { type: 'componentFormat', value: storedComponentFormat(value) };
  figma.ui.postMessage(msg);
}).catch(() => {/* ignore */});

// Send stored frame brand theme on startup (default: no overrides). Reads
// 'brandTheme'; a 1.x install that only has the two-color 'brandColors' key is
// migrated once. The legacy key is left in place so a rollback still finds it.
figma.clientStorage.getAsync('brandTheme').then(async (value: BrandTheme | undefined) => {
  if (value) {
    brandTheme = migrateBrandColors(value);
  } else {
    const legacy = await figma.clientStorage.getAsync('brandColors') as BrandColors | undefined;
    brandTheme = migrateBrandColors(legacy);
    // Persist the migrated theme so the migration runs only once.
    await figma.clientStorage.setAsync('brandTheme', brandTheme);
  }
  const msg: MainToUi = { type: 'brandTheme', value: brandTheme };
  figma.ui.postMessage(msg);
}).catch(() => {/* ignore */});

// Send a previously captured logo, if any.
figma.clientStorage.getAsync('brandLogo').then((value: string | undefined) => {
  brandLogo = value ?? null;
  if (brandLogo) {
    const msg: MainToUi = { type: 'logoCaptured', base64: brandLogo };
    figma.ui.postMessage(msg);
  }
}).catch(() => {/* ignore */});

// The generated doc is selected after a successful build so the user can see
// it. That programmatic selection is not a new component choice and must not
// clear the source component from the UI. A real user selection never matches
// this exact generated Section id, so it still posts normally.
const programmaticDocSelection = new ProgrammaticSelection();

// One build at a time across both frame families: see CanvasBuildGate. The
// message handler is async and re-entrant, and a build mutates shared module
// state (theme palette, layout widths, font families) assumed single-threaded.
const canvasBuild = new CanvasBuildGate();

// React to selection changes.
// Note: selectionchange does not fire on plugin open; the UI sends requestSelection on mount to get the initial selection.
figma.on('selectionchange', () => {
  const selected = figma.currentPage.selection;
  // Consume first, so a programmatic selection that lands while the gate is
  // still held cannot leave its expectation armed for the user's next click.
  if (programmaticDocSelection.consume(selected.map((node) => node.id))) return;
  // A build switches pages to place a doc beside its predecessor and back;
  // each switch reports the new page's selection, which is nobody's choice,
  // and posting it would empty the component pane the moment "Updated"
  // shows. But a real selection the user makes while the gate is held is
  // somebody's choice, and dropping it for good would leave the panel and
  // Copy for AI acting on a stale node once the build finishes. So this does
  // not post it now (posting mid-build is exactly the bug above), it only
  // notes that one was missed; each build's own `finally` block checks that
  // note after the gate releases and replays the selection itself, through
  // `selectionToReplay`, which is what tells a page hop's own selection
  // apart from a genuine one worth telling the UI about.
  if (canvasBuild.busy) {
    canvasBuild.noteSkipped();
    return;
  }
  void postSelection().catch(() => {/* handled inside */});
});

/**
 * The generated lane's text: everything selfHash covers. Editorial slots are
 * skipped because an Update keeps them, so an edit there is not something the
 * user can lose. Instances are skipped because their text mirrors the source
 * component. See canvasProse.ts for the lane rule and its tests.
 */
function collectGeneratedLane(node: BaseNode): string[] {
  return collectGeneratedText(node as unknown as ProseNodeLike);
}

/**
 * The guidelines a doc currently carries: what its canvas says, with the
 * stored blob filling any slot the canvas does not render.
 */
function mergedProse(section: SectionNode): ProseV2 | null {
  const prose = parseProse(section.getPluginData(DOC_PROSE_KEY));
  return mergeProse(prose, readCanvasProse(section as unknown as ProseNodeLike));
}

// Read the registry off figma.root.
/**
 * Publish identity. `figma.fileKey` is undefined for a Community plugin, so
 * the library id is kept in the document itself (root plugin data, shared by
 * every editor of this file) and the pull key per user in clientStorage,
 * keyed by that id. A second device therefore sees the id without the key.
 */
const PUBLISH_LIBRARY_KEY = 'speclayer.publish.libraryId';
/** ISO time of the last recorded publish. Lives in the file, like the id. */
const PUBLISH_DATE_KEY = 'speclayer.publish.publishedAt';
/** The library's current version as the proxy last reported it. In the file, like the date. */
const PUBLISH_VERSION_KEY = 'speclayer.publish.version';
const publishKeyStorageKey = (libraryId: string): string => `publishKey:${libraryId}`;

/** One toast for every setting this device could not keep. True as written:
 *  main.ts (or the UI) holds the new value in memory until the plugin closes. */
function notifySettingNotSaved(): void {
  figma.notify('Couldn’t save this setting on this device, so it applies to this session only.', { error: true });
}

async function readPublishInfo(): Promise<PublishInfo> {
  const libraryId = figma.root.getPluginData(PUBLISH_LIBRARY_KEY) || null;
  if (!libraryId) return { libraryId: null, pullKey: null, publishedAt: null, version: null };
  let pullKey: string | null = null;
  try {
    const raw = await figma.clientStorage.getAsync(publishKeyStorageKey(libraryId)) as unknown;
    pullKey = typeof raw === 'string' && raw ? raw : null;
  } catch { pullKey = null; }
  const publishedAt = figma.root.getPluginData(PUBLISH_DATE_KEY) || null;
  const version = figma.root.getPluginData(PUBLISH_VERSION_KEY) || null;
  return { libraryId, pullKey, publishedAt, version };
}

function readRegistry() {
  return parseRegistry(figma.root.getPluginData(DOC_REGISTRY_KEY));
}
function writeRegistry(r: { v: 1; docIds: string[] }): void {
  figma.root.setPluginData(DOC_REGISTRY_KEY, serializeRegistry(r));
}

/** Every registry id that still names a Section, read in one concurrent batch.
 *  A rejected read is skipped here, same as before: this helper's callers
 *  never prune, so they have no need for `rejected`, only `sections`. */
async function registrySections() {
  return (await resolveRegistrySections(readRegistry().docIds, figma)).sections;
}

// Every foundation doc link currently on canvas, read via the registry. A
// dangling registry id (its Section deleted) is skipped rather than pruned
// here: enumeration elsewhere already owns that cleanup, and this scan's only
// job is to feed mergeFoundationGroupDescriptions.
async function liveFoundationDocLinks(): Promise<FoundationDocLink[]> {
  const links: FoundationDocLink[] = [];
  for (const { section } of await registrySections()) {
    const data = parseDocLink(section.getPluginData(DOC_LINK_KEY));
    if (data && isFoundationLink(data)) links.push(data);
  }
  return links;
}

/**
 * The current truth of every group description on canvas, re-derived fresh
 * rather than trusted from any earlier send/reply.
 *
 * Read after every action that can change which foundation docs exist or
 * what they carry (create, rebuild, detach, remove) so the UI's copy-time
 * cache is refreshed from what actually landed on canvas, not from what a
 * message believed it was sending. This is what closes the staleness gap: a
 * doc's stored `groupDescriptions` can be a narrower set than what was asked
 * for (`descriptionsForUnit` keeps only the folders a unit actually rendered
 * as color rows), so persisted state is the only source that can't drift out
 * of step with a bulk build's own map, or with an old browser-thread cache
 * a Copy click would otherwise read from.
 *
 * Best-effort: a scan failure here must never fail the action it rides along
 * with, so it fails to an empty map rather than throwing. That matches this
 * same fallback already accepted for the plain `requestFoundation` path
 * below, where a failed merge is likewise absorbed rather than surfaced.
 */
async function liveFoundationGroupDescriptions(): Promise<Record<string, Record<string, string>>> {
  try {
    return mergeFoundationGroupDescriptions(await liveFoundationDocLinks());
  } catch {
    return {};
  }
}

// Resolve the existing doc Section for a source, preferring the registry
// (by sourceNodeId, any page); falling back to a legacy name match on the
// current page so pre-2.1 docs are adopted on their next regenerate.
async function findExistingDoc(
  sourceNodeId: string,
  sectionName: string,
): Promise<SectionNode | null> {
  for (const { section } of await registrySections()) {
    const data = parseDocLink(section.getPluginData(DOC_LINK_KEY));
    // Foundation docs have no sourceNodeId and resolve by scope in
    // renderFoundation and updateFoundationDoc, never here.
    if (data && !isFoundationLink(data) && data.sourceNodeId === sourceNodeId) return section;
  }
  // Legacy adoption fallback: name match on the current page. Only adopt a
  // Section that is NOT already another source's doc — a stamped link for a
  // different sourceNodeId means this is someone else's (or another component's)
  // documentation that merely shares the name, and must not be replaced.
  for (const child of figma.currentPage.children) {
    try {
      if (child.type === 'SECTION' && child.name === sectionName) {
        const data = parseDocLink((child as SectionNode).getPluginData(DOC_LINK_KEY));
        // A foundation-linked section sharing this name is another doc, same as
        // a mismatched sourceNodeId below: it must not be adopted.
        if (!data || (!isFoundationLink(data) && data.sourceNodeId === sourceNodeId)) return child as SectionNode;
      }
    } catch { /* skip unresolved child */ }
  }
  return null;
}

// React to UI messages

/**
 * Pull one unit's group descriptions out of the build-wide map.
 *
 * The map arrives keyed `collectionId|folder`; a doc stores plain folders. Only
 * folders this unit actually renders are kept, so a split collection's parts do
 * not each carry the whole collection's descriptions.
 */
function descriptionsForUnit(
  all: Record<string, string> | undefined,
  unit: FoundationUnit,
  content: FoundationUnitContent,
): Record<string, string> | undefined {
  if (!all) return undefined;
  const collectionId = unit.scope.target === 'collection' ? unit.scope.collectionId
    : unit.scope.target === 'textStyles' ? 'text' : 'effect';
  const out: Record<string, string> = {};
  for (const group of groupRowsByFolder(content.rows.filter(isColorRow) as FoundationVariableRow[])) {
    const note = all[`${collectionId}|${group.folder}`];
    if (note) out[group.folder] = note;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

figma.ui.onmessage = async (raw: unknown) => {
  const msg = raw as UiToMain;
  switch (msg.type) {
    case 'requestSelection':
      await postSelection();
      break;

    case 'setLicenseKey': {
      let ok: boolean;
      if (msg.value) {
        ok = await writeSetting(figma.clientStorage, 'licenseKey', msg.value);
        ok = (msg.instanceId
          ? await writeSetting(figma.clientStorage, 'licenseInstanceId', msg.instanceId)
          : await deleteSetting(figma.clientStorage, 'licenseInstanceId')) && ok;
      } else {
        ok = await deleteSetting(figma.clientStorage, 'licenseKey');
        ok = await deleteSetting(figma.clientStorage, 'licenseInstanceId') && ok;
      }
      if (!ok) notifySettingNotSaved();
      break;
    }

    case 'setAiEnabled':
      if (!await writeSetting(figma.clientStorage, 'aiEnabled', msg.value)) notifySettingNotSaved();
      break;

    case 'setComponentFormat':
      // The UI only sends a known value, but this is the storage boundary.
      if (isComponentFormat(msg.value)) {
        if (!await writeSetting(figma.clientStorage, 'componentFormat', msg.value)) notifySettingNotSaved();
      }
      break;

    case 'setBrandTheme':
      brandTheme = msg.value;
      if (!await writeSetting(figma.clientStorage, 'brandTheme', brandTheme)) notifySettingNotSaved();
      break;

    case 'requestFonts': {
      try {
        const fonts = await figma.listAvailableFontsAsync();
        // Only offer families the frame can actually use (Regular+Medium+Bold),
        // so a picked font never silently falls back to Inter.
        const families = familiesWithRequiredStyles(fonts);
        figma.ui.postMessage({ type: 'fontList', families } as MainToUi);
      } catch {
        /* picker falls back to a free-text input */
      }
      break;
    }

    case 'captureLogo': {
      try {
        const sel = figma.currentPage.selection[0];
        if (!sel || !('exportAsync' in sel)) {
          figma.ui.postMessage({ type: 'logoError', message: 'Select a frame or component to use as the logo.' } as MainToUi);
          break;
        }
        // Export at logo scale (target height ~64px @2x = 128px) to keep
        // clientStorage small.
        const scale = Math.min(2, 128 / Math.max(sel.height, 1));
        const bytes = await (sel as SceneNode & { exportAsync: (s: ExportSettings) => Promise<Uint8Array> })
          .exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
        const encoded = figma.base64Encode(bytes);
        // Guard clientStorage (and the postMessage payload) against very wide
        // nodes that stay huge even at logo height: ~700K base64 chars ≈ 500KB.
        if (encoded.length > 700_000) {
          figma.ui.postMessage({ type: 'logoError', message: 'That logo image is too large to save. Select a smaller layer and try again.' } as MainToUi);
          break;
        }
        brandLogo = encoded;
        await figma.clientStorage.setAsync('brandLogo', brandLogo);
        figma.ui.postMessage({ type: 'logoCaptured', base64: brandLogo } as MainToUi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'logoError', message } as MainToUi);
      }
      break;
    }

    case 'clearLogo':
      brandLogo = null;
      await figma.clientStorage.deleteAsync('brandLogo');
      figma.ui.postMessage({ type: 'logoCleared' } as MainToUi);
      break;

    case 'requestComponentImage': {
      try {
        const node = await figma.getNodeByIdAsync(msg.nodeId);
        if (!node || !('exportAsync' in node)) {
          figma.ui.postMessage({ type: 'componentImageError', message: 'Component not found' } as MainToUi);
          break;
        }
        // Cap the long edge ~1568px to stay within vision limits. Pick a scale that
        // keeps the larger dimension under the cap (never upscale beyond 2x).
        const w = 'width' in node ? (node as SceneNode & { width: number }).width : 1;
        const h = 'height' in node ? (node as SceneNode & { height: number }).height : 1;
        const longEdge = Math.max(w, h, 1);
        const scale = Math.min(2, 1568 / longEdge);
        const bytes = await (node as SceneNode & { exportAsync: (s: ExportSettings) => Promise<Uint8Array> })
          .exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
        const base64 = figma.base64Encode(bytes);
        // Anthropic accepts images up to 5 MB. Leave headroom for JSON and
        // message transport; the UI treats this as a text-only fallback.
        if (base64.length > 6_500_000) {
          figma.ui.postMessage({
            type: 'componentImageError',
            message: 'Component image is too large; continuing without it',
          } as MainToUi);
          break;
        }
        figma.ui.postMessage({ type: 'componentImage', base64, mediaType: 'image/png' } as MainToUi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'componentImageError', message } as MainToUi);
      }
      break;
    }

    case 'notify':
      figma.notify(msg.message, {
        error: msg.error ?? false,
        timeout: msg.timeout ?? 3200,
      });
      break;

    case 'openBrowser':
      figma.openExternal(msg.url);
      break;

    case 'renderDocFrame': {
      if (!canvasBuild.begin()) {
        // Reply, never drop. The shared UI lock should stop this from being
        // reached at all, but a guard that notifies and returns nothing leaves
        // the UI holding a button it disabled for a build that will never
        // report back. docFrameError is the failure reply this send site
        // already handles, and the UI shows its message as a toast.
        const message = 'Another build is still running. Try again when it finishes.';
        figma.ui.postMessage({ type: 'docFrameError', message } as MainToUi);
        break;
      }
      // The page the user invoked this build from, and the selection there
      // when this build took the gate. A successful build deliberately
      // leaves the user on the new Section's page with it selected (see the
      // cosmetic tail below), so only a failure needs to hop back to this
      // page — done in the catch block, mirroring renderFoundation's own
      // restore. `programmaticIds` stays null until a programmatic selection
      // actually happens below: null (not `[]`) is what tells
      // selectionToReplay this build has made no claim yet about what its
      // own selection is, so a genuine mid-build deselect (`current` also
      // `[]`) is never mistaken for it.
      const invokingPage = figma.currentPage;
      const atBegin = invokingPage.selection.map((node) => node.id);
      let programmaticIds: string[] | null = null;
      let section: SectionNode | null = null;
      let committed = false; // true once the old doc has been replaced by the new one
      try {
        const sectionName = `${msg.model.componentName}: Documentation`;
        const existing = await findExistingDoc(msg.nodeId, sectionName);
        // Capture the id now: after existing.remove() below, reading any
        // property of a removed node (except `removed`) throws, and this id is
        // needed post-commit to prune the old doc from the registry.
        const existingId = existing ? existing.id : null;
        // The publish record survives a rebuild: rebuilding does not change
        // what was published. Read before remove(), like the position.
        const publishRaw = existing ? existing.getPluginData(PUBLISH_RECORD_KEY) : '';
        const pill: PillState = pillState(parsePublishRecord(publishRaw), msg.contentHash);

        // Regenerate in place: reuse the old doc's position AND its page.
        let targetPage: PageNode = figma.currentPage;
        let x = 0, y = 0;
        if (existing) {
          x = existing.x; y = existing.y;
          const p = pageOf(existing);
          if (p) targetPage = p;
        } else {
          try {
            const comp = await figma.getNodeByIdAsync(msg.nodeId);
            if (comp && 'x' in comp && 'width' in comp) {
              const c = comp as SceneNode & { x: number; y: number; width: number };
              x = c.x + c.width + 80; y = c.y;
            }
          } catch { /* source gone since extract — fall back to origin */ }
        }

        if (targetPage.id !== figma.currentPage.id) {
          await figma.setCurrentPageAsync(targetPage);
        }

        section = await buildDocFrames(msg.model, resolveTheme(brandTheme), brandLogo, pill);

        // Stamp the durable link BEFORE removing the old one, so a failure
        // mid-way never leaves an unstamped orphan replacing a good doc.
        const data: DocLinkData = {
          v: 1,
          sourceNodeId: msg.nodeId,
          contentHash: msg.contentHash,
          selfHash: textContentHash(collectGeneratedLane(section)),
          config: msg.config,
          generatedAt: Date.now(),
          pluginVersion: typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : '',
          // Stamped so a future drift check can tell "extractor changed" apart
          // from "content changed" (see docLink.ts's ComponentDocLink.extractorVersion).
          // Absent only on blobs written before this field existed.
          extractorVersion: msg.extractorVersion,
        };
        section.setPluginData(DOC_LINK_KEY, serializeDocLink(data));
        // Written in the same commit as the link, after the Section build
        // succeeded, so a failed build never leaves guidelines describing a
        // document that does not exist. An over-budget payload serializes to
        // '' and simply stores nothing.
        section.setPluginData(DOC_PROSE_KEY, msg.prose ? serializeProse(msg.prose) : '');
        // The diff baseline: the projection msg.contentHash was computed over,
        // written in the same commit as the link so the two can never disagree.
        // Over budget serializes to '' and the row shows the fallback. An
        // over-budget spec stays over budget on later Updates, so such a doc
        // shows the fallback permanently, which spec section 9 accepts.
        section.setPluginData(DOC_BASELINE_KEY, serializeBaseline({
          v: 1, kind: 'component', contentHash: msg.contentHash, projection: msg.baseline,
        }));
        if (publishRaw) section.setPluginData(PUBLISH_RECORD_KEY, publishRaw);

        // Point of no return: replace the old doc with the new one. After this,
        // `section` IS the doc and must survive any later (cosmetic) failure.
        if (existing) existing.remove();
        // buildDocFrames auto-appends the new section to the (now target) page;
        // re-appending moves it to the end so it sits above siblings predictably.
        targetPage.appendChild(section);
        section.x = x; section.y = y;
        committed = true;

        // Register (idempotent), dropping the replaced doc's id if it changed.
        let reg = readRegistry();
        if (existingId && existingId !== section.id) reg = removeDoc(reg, existingId);
        reg = addDoc(reg, section.id);
        writeRegistry(reg);

        // Cosmetic tail: a focus/zoom hiccup must never fail a placed doc.
        try {
          programmaticDocSelection.expect(section.id);
          figma.currentPage.selection = [section];
          // Captured as its own value, not re-read off `section` later: a
          // failure after this point can still remove `section` (see the
          // outer catch), and a removed node throws on any property read
          // other than `.removed`.
          programmaticIds = [section.id];
        } catch {
          programmaticDocSelection.cancel();
        }
        try {
          figma.viewport.scrollAndZoomIntoView([section]);
        } catch { /* zoom is non-essential */ }

        // `replaced` lets the UI say "Updated" vs "Created": an existing doc was
        // found and swapped out, so this regenerated in place rather than adding.
        figma.ui.postMessage({ type: 'docFrameDone', frameName: section.name, replaced: existingId !== null } as MainToUi);
      } catch (err) {
        // Clean up an orphan only if we failed BEFORE committing the replacement;
        // after commit the section is the live doc and must not be removed.
        if (section && !committed) {
          try { section.remove(); } catch { /* already gone */ }
        }
        // A build that switched pages before failing must not strand the
        // user there: unlike the success path above (which deliberately
        // leaves them on the new Section's page), a failure has no section
        // to show for it, and leaving `figma.currentPage` on the target page
        // would also make `current` below describe a different page than
        // `atBegin`. This is itself a fallible async Figma call, wrapped
        // separately so its own failure can never replace the error the
        // user needs to see.
        try {
          if (figma.currentPage.id !== invokingPage.id) await figma.setCurrentPageAsync(invokingPage);
        } catch {
          // Best-effort only.
        }
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'docFrameError', message } as MainToUi);
      } finally {
        canvasBuild.end();
        // A real selection made while this build held the gate was noted,
        // not posted (see the selectionchange listener above). Replay it now
        // that the gate has released, unless it turns out to be nothing new
        // (unchanged from atBegin) or just this build's own generated
        // Section landing in view (programmaticIds) — either of those would
        // be the original bug, an empty pane, all over again.
        const current = figma.currentPage.selection.map((node) => node.id);
        if (selectionToReplay({
          skipped: canvasBuild.skippedSelection, current, atBegin, programmatic: programmaticIds,
        })) {
          void postSelection().catch(() => {/* handled inside */});
        }
      }
      break;
    }

    case 'requestLibrary': {
      // Foundation drift needs one live extraction to answer every foundation
      // row, unlike component docs, which the UI checks one at a time via
      // requestDrift. scanLibrary calls this lazily and at most once, so a
      // file with only component docs pays nothing. Resolves null on failure
      // rather than rejecting: a foundation that cannot be read is a fact
      // about those rows (badge unavailable), not a reason to drop the list.
      const liveFoundation = async (): Promise<FoundationSpec | null> => {
        try {
          const { fileKey } = resolveFileKey(figma.fileKey, null);
          const spec = buildFoundation(await readFoundationDump(fileKey, false));
          lastLibraryFoundation = { fileKey, spec };
          return spec;
        } catch (err) {
          console.error('[Spec Layer] foundation read failed during the library scan', err);
          return null;
        }
      };
      let scan: LibraryScan;
      try {
        const reg = readRegistry();
        scan = await scanLibrary(reg.docIds, { getNodeByIdAsync: (id) => figma.getNodeByIdAsync(id), liveFoundation });
      } catch (err) {
        scan = { entries: [], alive: new Set<string>(), error: err instanceof Error ? err.message : String(err) };
      }
      if (scan.error !== null) console.error('[Spec Layer] library scan failed', scan.error);
      // libraryReply is the one place that turns a scan into a reply and a
      // prune decision, so its three shapes (complete, partial with rows,
      // failed with no rows) are covered by a plain unit test.
      const { message, prune } = libraryReply(scan);
      if (prune) {
        // Guarded on its own: a self-heal write that throws must not turn a
        // healthy scan's reply into a libraryError the UI was never told to
        // expect. The next Library scan gets another chance to prune.
        try {
          const reg = readRegistry();
          const pruned = pruneRegistry(reg, scan.alive);
          if (pruned.docIds.length !== reg.docIds.length) writeRegistry(pruned);
        } catch (err) {
          console.error('[Spec Layer] could not update the doc registry after a library scan', err);
        }
      }
      figma.ui.postMessage(message);
      break;
    }

    case 'requestFoundation': {
      try {
        const { fileKey } = resolveFileKey(figma.fileKey, null);
        const dump = await readFoundationDump(fileKey, true);
        // This is the Foundations tab's own fetch — both its first load and
        // its "Refresh sources" button — so it is also the one place a user
        // can force a fresh read. Updating the selection-side cache here
        // (rather than only handing the dump to this reply) means that
        // refresh benefits the NEXT selection's token-value resolution too,
        // instead of leaving foundationFor() serving a dump this same click
        // just proved stale.
        foundationCache = { fileKey, dump };
        // Merged from every foundation doc link on canvas so the Copy button
        // can hand the agent the vocabulary the plugin already generated,
        // not just a bare token table. Omitted rather than sent empty so an
        // absent field keeps meaning "nothing on canvas", matching
        // foundationBrief's own absent-vs-empty rule one layer up.
        const merged = await liveFoundationGroupDescriptions();
        const groupDescriptions = Object.keys(merged).length > 0 ? merged : undefined;
        // The 'foundation' reply hands the UI this dump, so the next
        // 'selection' must not send it again.
        foundationPosts.fresh(dump);
        figma.ui.postMessage({ type: 'foundation', dump, groupDescriptions } as MainToUi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'foundationError', message } as MainToUi);
      }
      break;
    }

    case 'renderFoundation': {
      if (!canvasBuild.begin()) {
        // Post the rejection back, don't just notify. The UI holds a lock from
        // the moment it sends, and a request that gets no reply is a lock
        // nobody ever releases.
        const message = 'Another build is still running. Try again when it finishes.';
        figma.ui.postMessage({ type: 'foundationFrameError', message, created: 0 } as MainToUi);
        break;
      }
      // Declared outside the try so the catch block can report how many frames
      // actually landed on the canvas before the failure (frames are appended
      // one at a time and are never rolled back).
      let created = 0;
      // The Section this iteration built but has not yet handed to the
      // registry. buildFoundationFrame appends it to the page, so a throw
      // between there and writeRegistry would leave an untracked duplicate
      // beside the doc it was meant to replace. Cleared once the registry owns
      // it, or, for a replacement, once the predecessor is gone (then it IS
      // the doc, and a later throw must not delete the user's only copy).
      let pending: SectionNode | null = null;
      // The page the user invoked from. A non-replacing unit always lands
      // here; a replacing unit switches to its predecessor's page just long
      // enough to build and place it, then control returns here before the
      // next unit, so this page — and the layout cursor below, which is
      // scoped to it — never drifts partway through the loop. Declared outside
      // the try (rather than after the re-extraction below) so the catch block
      // can restore it too: a throw from buildFoundationFrame, writeRegistry,
      // or prior.remove() happens only after the loop has already switched
      // pages, and skips the loop's own restore near the bottom.
      const invokedPage = figma.currentPage;
      // The selection when this build took the gate; see renderDocFrame's
      // atBegin. Neither Foundation path selects anything of its own, so
      // there is no programmatic id to compare against below.
      const atBegin = invokedPage.selection.map((node) => node.id);
      try {
        // Re-extract rather than trusting the UI's dump: the Foundations tab
        // fetches its data once per session and never refreshes, so the file
        // may have changed by the time the user clicks Create. Re-extracting
        // here keeps the generated frames faithful to the file as it is now.
        const { fileKey } = resolveFileKey(figma.fileKey, null);
        const dump = await readFoundationDump(fileKey, false);
        const spec = buildFoundation(dump);
        const units = planFoundationUnits(spec, msg.selection);

        let replaced = 0;
        let x = 0;
        let y = 0;

        // Place the set to the right of everything already on the page so a
        // generated set never lands on top of existing work.
        for (const child of invokedPage.children) {
          if ('x' in child && 'width' in child) {
            const c = child as SceneNode & { x: number; width: number; y: number };
            x = Math.max(x, c.x + c.width + 120);
            y = Math.min(y, c.y);
          }
        }

        // Index every tracked foundation Section (any page, via the registry —
        // same reach as findExistingDoc's component lookup above) by scope, so
        // a regenerated unit replaces its predecessor in place instead of
        // duplicating it.
        const existingByScope = new Map<string, SectionNode>();
        for (const { section: existing } of await registrySections()) {
          const link = parseDocLink(existing.getPluginData(DOC_LINK_KEY));
          if (link && isFoundationLink(link)) {
            existingByScope.set(foundationScopeKey(link.scope), existing);
          }
        }

        // Measured ONCE for the whole build, not per unit. colorContrast reads
        // the entire foundation on every call and `spec` does not change across
        // this loop, so measuring per unit would repeat identical work for each
        // one. Skipped entirely when the toggle is off, so a user who does not
        // want the check does not pay for it.
        const contrastReport = msg.config.includeContrast ? colorContrast(spec) : undefined;

        for (let i = 0; i < units.length; i++) {
          const unit = units[i];
          // Unreachable in this path: unitContent returns null for a missing
          // collectionId or an empty named group, and every unit here came from
          // planFoundationUnits run against this same spec, which drops
          // collections it can't find and only names groups it found members
          // for. Kept as a defensive guard, not a case that needs
          // progress-count handling.
          const content = unitContent(spec, unit.scope);
          if (!content) continue;

          // Resolve the destination page BEFORE building: a replacing unit
          // belongs on its predecessor's page (wherever that is), same as
          // renderDocFrame and updateFoundationDoc above. Switching first means
          // buildFoundationFrame's figma.createSection() (which auto-appends to
          // the current page) lands the new Section in the right place instead
          // of wherever the user happens to be looking.
          const prior = existingByScope.get(foundationScopeKey(unit.scope));
          const targetPage = prior ? (pageOf(prior) ?? invokedPage) : invokedPage;
          if (targetPage.id !== figma.currentPage.id) await figma.setCurrentPageAsync(targetPage);
          const publishRaw = prior ? prior.getPluginData(PUBLISH_RECORD_KEY) : '';
          const currentHash = foundationContentHash(spec, unit.scope);
          const pill: PillState = pillState(parsePublishRecord(publishRaw), currentHash);

          // The UI sends one map for the whole build, keyed collectionId|folder
          // because two collections can hold a folder of the same name. Each doc
          // stores only its own, keyed by plain folder.
          const descriptions = descriptionsForUnit(msg.groupDescriptions, unit, content);

          // Each collection-scoped unit looks up its own paragraph; a
          // text/effect-styles unit has no collection id to key on.
          const overview = unit.scope.target === 'collection'
            ? msg.collectionOverviews?.[unit.scope.collectionId]
            : undefined;

          const section = await buildFoundationFrame(
            content, unit, resolveTheme(brandTheme),
            msg.config.includeDescriptions, brandLogo, descriptions,
            msg.config.includeContrast, contrastReport, pill,
            overview,
          );
          pending = section;

          const data: FoundationDocLink = {
            v: 1,
            kind: 'foundation',
            scope: unit.scope,
            contentHash: currentHash,
            selfHash: '',   // set below, once the section's text exists
            config: msg.config,
            ...(descriptions ? { groupDescriptions: descriptions } : {}),
            ...(overview ? { collectionOverview: overview } : {}),
            generatedAt: Date.now(),
            pluginVersion: typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : '',
          };

          targetPage.appendChild(section);
          if (prior) {
            section.x = prior.x;
            section.y = prior.y;
          } else {
            section.x = x;
            section.y = y;
          }

          // Stamp the durable link BEFORE removing any predecessor, so a
          // failure mid-way never leaves an unstamped orphan replacing a good
          // doc (mirrors the component doc path in renderDocFrame above).
          data.selfHash = textContentHash(collectGeneratedLane(section));
          section.setPluginData(DOC_LINK_KEY, serializeDocLink(data));
          // `content` is the object foundationContentHash hashed for this
          // link, so it is the baseline verbatim.
          section.setPluginData(DOC_BASELINE_KEY, serializeBaseline({
            v: 1, kind: 'foundation', contentHash: data.contentHash, projection: content,
          }));
          if (publishRaw) section.setPluginData(PUBLISH_RECORD_KEY, publishRaw);

          if (prior) {
            // Compute the registry with the prior id dropped, but don't write
            // it until prior.remove() actually succeeds — same ordering as
            // updateFoundationDoc below. Writing the drop first (as before)
            // meant a throw from remove() left the registry no longer
            // tracking a Section that was still physically on the canvas: an
            // untracked duplicate, invisible to My Library and the self-heal
            // prune.
            const reg: DocRegistry = removeDoc(readRegistry(), prior.id);
            prior.remove();
            pending = null; // the new Section is now the doc, whatever happens next
            writeRegistry(addDoc(reg, section.id));
            replaced++;
          } else {
            writeRegistry(addDoc(readRegistry(), section.id));
            pending = null;
            x += section.width + 80;
            created++;
          }

          // Return to the invoking page so the next non-replacing unit's
          // auto-append (and this loop's own page comparisons) stay anchored
          // there; the next replacing unit switches again to wherever its own
          // predecessor lives.
          if (figma.currentPage.id !== invokedPage.id) await figma.setCurrentPageAsync(invokedPage);

          figma.ui.postMessage({
            type: 'foundationProgress', done: i + 1, total: units.length,
          } as MainToUi);
        }

        // Every Section built above already has its final groupDescriptions
        // stamped in (descriptionsForUnit's filtered subset, not the raw map
        // this handler was sent), so re-deriving from canvas rather than
        // trusting msg.groupDescriptions is what keeps the UI's copy-time
        // cache from drifting out of step with what was actually persisted.
        const groupDescriptions = await liveFoundationGroupDescriptions();
        figma.ui.postMessage({ type: 'foundationDone', created, replaced, groupDescriptions } as MainToUi);
      } catch (err) {
        if (pending) {
          try { pending.remove(); } catch { /* already gone */ }
        }
        const message = err instanceof Error ? err.message : String(err);
        // A throw earlier in the loop (buildFoundationFrame, writeRegistry, or
        // prior.remove(), all of which can run after the loop switched to a
        // predecessor's page) skips the loop's own restore-to-invokedPage
        // statement. Attempt the restore here too so a failed batch never
        // strands the user on a foreign page. This is itself a fallible async
        // Figma call, so it's wrapped separately: if it fails, that failure
        // must never replace the original error the user needs to see.
        try {
          if (figma.currentPage.id !== invokedPage.id) await figma.setCurrentPageAsync(invokedPage);
        } catch {
          // Best-effort only — the original `message` below still wins.
        }
        figma.ui.postMessage({ type: 'foundationFrameError', message, created } as MainToUi);
      } finally {
        canvasBuild.end();
        // Same replay as renderDocFrame above, with programmatic: null, not
        // []: this path never selects anything of its own, so it has no
        // basis to claim its own selection was empty, and a genuine
        // mid-build deselect must still replay (see selectionToReplay).
        // The loop above already returns to invokedPage after every unit,
        // success or replaced, and the catch just above restores it too, so
        // `current` here already describes the same page as `atBegin`.
        const current = figma.currentPage.selection.map((node) => node.id);
        if (selectionToReplay({
          skipped: canvasBuild.skippedSelection, current, atBegin, programmatic: null,
        })) {
          void postSelection().catch(() => {/* handled inside */});
        }
      }
      break;
    }

    case 'updateFoundationDoc': {
      // Shares the gate with renderDocFrame and renderFoundation: all three
      // call into frameKit's shared theme/font module state.
      if (!canvasBuild.begin()) {
        const message = 'Another build is still running. Try again when it finishes.';
        figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message } as MainToUi);
        break;
      }
      // The page the user invoked this Update from, and the selection there
      // when this build took the gate. Unlike renderDocFrame, an Update has
      // no new page for the user to land on: it switches to the prior doc's
      // page to rebuild it (below) and, unlike renderFoundation's per-unit
      // loop, never switches back on its own — so the finally block hops
      // back before checking `current` against `atBegin`, or the two would
      // describe different pages.
      const invokingPage = figma.currentPage;
      const atBegin = invokingPage.selection.map((node) => node.id);
      // The Section this rebuild made but has not yet handed to the registry;
      // see renderFoundation's own `pending` for why. Declared before the try
      // so the catch below can see it.
      let pending: SectionNode | null = null;
      try {
        const node = await figma.getNodeByIdAsync(msg.docId);
        if (!node || node.type !== 'SECTION') {
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId,
            message: 'This doc no longer exists.' } as MainToUi);
          break;
        }
        const prior = node as SectionNode;
        const link = parseDocLink(prior.getPluginData(DOC_LINK_KEY));
        if (!link || !isFoundationLink(link)) {
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId,
            message: 'This doc is no longer linked to its source.' } as MainToUi);
          break;
        }

        const { fileKey } = resolveFileKey(figma.fileKey, null);
        const dump = await readFoundationDump(fileKey, false);
        const spec = buildFoundation(dump);

        // Retarget a renamed/re-created collection by name before giving up,
        // the same rule requestLibrary's drift check uses: a single live
        // collection with the stored name is the same collection renamed, but
        // two or more is a coin flip, and rebuilding this doc from the wrong
        // collection's variables (then stamping that id in) is worse than
        // telling the user it could not be rebuilt.
        const scope = retargetScope(link.scope, spec.collections);

        const content = unitContent(spec, scope);
        if (!content) {
          // unitContent has two reasons to give up, and they are different
          // facts for the user: the collection itself is gone, or the
          // collection is still there but the group this doc covers no longer
          // matches anything (renamed, or its last member deleted). Say which.
          // Pull the id out to a const first: narrowing a mutable `let` does
          // not survive into the `.some` closure, the same trap the retarget
          // above works around.
          const scopedCollectionId = scope.target === 'collection' ? scope.collectionId : null;
          const collectionGone = scopedCollectionId !== null
            && !spec.collections.some((c) => c.id === scopedCollectionId);
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId,
            message: collectionGone
              ? 'Couldn’t update this doc. Its collection is no longer in this file.'
              : `Couldn’t update this doc. Nothing in this file is named “${scope.group}” anymore.` } as MainToUi);
          break;
        }

        const unit: FoundationUnit = {
          scope,
          // One derivation for every title, shared with planFoundationUnits and
          // the renderer, so a rebuilt doc cannot end up named differently from
          // the doc it replaces.
          title: foundationUnitTitle(scope, content),
          rowCount: content.rows.length,
          // content.omittedModeNames is the same value computed the same way;
          // reuse it rather than re-deriving it from spec.collections here, so
          // there is exactly one place that decides which modes were omitted.
          omittedModeNames: content.omittedModeNames,
        };

        const publishRaw = prior.getPluginData(PUBLISH_RECORD_KEY);
        const currentHash = foundationContentHash(spec, scope);
        const pill: PillState = pillState(parsePublishRecord(publishRaw), currentHash);

        // Reuse the descriptions this doc was generated with. An Update is a
        // source refresh, not a reason to re-ask the model and re-bill the quota.
        // An Update re-renders with the config the doc was created under, the
        // same rule its descriptions follow: an Update is a source refresh, not
        // a change of what the doc is.
        const section = await buildFoundationFrame(
          content, unit, resolveTheme(brandTheme), link.config.includeDescriptions,
          brandLogo, link.groupDescriptions,
          link.config.includeContrast,
          link.config.includeContrast ? colorContrast(spec) : undefined,
          pill,
          link.collectionOverview,
        );
        pending = section;

        const data: FoundationDocLink = {
          v: 1, kind: 'foundation', scope,
          contentHash: currentHash,
          selfHash: '',
          config: link.config,
          ...(link.groupDescriptions ? { groupDescriptions: link.groupDescriptions } : {}),
          ...(link.collectionOverview ? { collectionOverview: link.collectionOverview } : {}),
          generatedAt: Date.now(),
          pluginVersion: typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : '',
        };

        // Regenerate in place: reuse the prior doc's page and position, same as
        // renderDocFrame and renderFoundation's replacing units above.
        const targetPage = pageOf(prior) ?? figma.currentPage;
        if (targetPage.id !== figma.currentPage.id) await figma.setCurrentPageAsync(targetPage);
        targetPage.appendChild(section);
        section.x = prior.x;
        section.y = prior.y;

        data.selfHash = textContentHash(collectGeneratedLane(section));
        section.setPluginData(DOC_LINK_KEY, serializeDocLink(data));
        section.setPluginData(DOC_BASELINE_KEY, serializeBaseline({
          v: 1, kind: 'foundation', contentHash: data.contentHash, projection: content,
        }));
        if (publishRaw) section.setPluginData(PUBLISH_RECORD_KEY, publishRaw);

        // Point of no return, matching the component path (renderDocFrame
        // above): the new section is stamped and placed before the old one
        // goes, so a failure here never leaves the user having lost a good doc.
        const reg = removeDoc(readRegistry(), prior.id);
        prior.remove();
        pending = null; // point of no return: the new Section is the doc
        writeRegistry(addDoc(reg, section.id));

        // Stamp the docId so the reply identifies itself as this row's Update
        // rather than the Foundations tab's bulk run, which posts the same
        // message type without one.
        //
        // An Update reuses link.groupDescriptions verbatim (no regeneration,
        // see above), but every OTHER foundation doc's descriptions on canvas
        // are just as able to have drifted from the UI's cache since it was
        // last populated, so this re-derives the whole-canvas truth the same
        // way renderFoundation's reply does rather than special-casing "only
        // this one doc changed".
        const groupDescriptions = await liveFoundationGroupDescriptions();
        figma.ui.postMessage({
          type: 'foundationDone', created: 0, replaced: 1, docId: msg.docId, groupDescriptions,
        } as MainToUi);
      } catch (err) {
        if (pending) {
          try { pending.remove(); } catch { /* already gone */ }
        }
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message } as MainToUi);
      } finally {
        // Hop back to the invoking page before releasing the gate, success
        // or failure: unlike renderDocFrame there is no new page for the
        // user to land on here, and unlike renderFoundation's per-unit loop
        // this path never returns on its own. Left un-hopped, a page the
        // build switched to (the prior doc's own page) leaves `current`
        // below describing that page's remembered selection instead of
        // this one's — replaying it as if the user chose it, or, if it's
        // empty, resolving to node: null and emptying the pane, the
        // original bug. This is itself a fallible async Figma call, guarded
        // so its failure can never skip end() or the replay check after it.
        try {
          if (figma.currentPage.id !== invokingPage.id) await figma.setCurrentPageAsync(invokingPage);
        } catch {
          // Best-effort only.
        }
        canvasBuild.end();
        // Same replay as the two paths above, with programmatic: null, not
        // []: this path never selects anything of its own, so it has no
        // basis to claim its own selection was empty, and a genuine
        // mid-build deselect must still replay (see selectionToReplay).
        const current = figma.currentPage.selection.map((node) => node.id);
        if (selectionToReplay({
          skipped: canvasBuild.skippedSelection, current, atBegin, programmatic: null,
        })) {
          void postSelection().catch(() => {/* handled inside */});
        }
      }
      break;
    }

    case 'focusNode': {
      try {
        const node = await figma.getNodeByIdAsync(msg.nodeId);
        if (!node) { figma.notify('That layer is no longer in this file.'); break; }
        const page = pageOf(node);
        if (page && page.id !== figma.currentPage.id) await figma.setCurrentPageAsync(page);
        if ('x' in node) {
          const sn = node as SceneNode;
          figma.currentPage.selection = [sn];
          figma.viewport.scrollAndZoomIntoView([sn]);
        }
      } catch { figma.notify('Couldn’t open that layer.'); }
      break;
    }

    case 'detachDoc': {
      try {
        const node = await figma.getNodeByIdAsync(msg.docId);
        if (node && node.type === 'SECTION') {
          (node as SectionNode).setPluginData(DOC_LINK_KEY, '');
          (node as SectionNode).setPluginData(DOC_BASELINE_KEY, '');
        }
      } catch { /* gone already */ }
      // Guarded like the read above: a registry write that throws must not
      // swallow the reply, or the UI keeps a row it has already been told is
      // gone and its menu stays disabled. The next Library scan prunes an id
      // this write failed to drop.
      try {
        writeRegistry(removeDoc(readRegistry(), msg.docId));
      } catch (err) {
        console.error('[Spec Layer] could not update the doc registry after detaching', msg.docId, err);
      }
      // Detaching a foundation doc wipes its link, so the merge below no
      // longer sees it: this is the inverse staleness case, where the UI's
      // cache must be told a description set is now GONE, not just told
      // about new ones. Recomputed fresh from canvas rather than assumed, so
      // it is correct whether or not msg.docId was a foundation doc at all.
      const groupDescriptions = await liveFoundationGroupDescriptions();
      figma.ui.postMessage({ type: 'docDetached', docId: msg.docId, groupDescriptions } as MainToUi);
      break;
    }

    case 'removeDoc': {
      try {
        const node = await figma.getNodeByIdAsync(msg.docId);
        if (node) node.remove();
      } catch { /* gone already */ }
      try {
        writeRegistry(removeDoc(readRegistry(), msg.docId));
      } catch (err) {
        console.error('[Spec Layer] could not update the doc registry after deleting', msg.docId, err);
      }
      // Same inverse-staleness reasoning as detachDoc above: a removed
      // foundation doc's descriptions must stop being offered by Copy.
      const groupDescriptions = await liveFoundationGroupDescriptions();
      figma.ui.postMessage({ type: 'docRemoved', docId: msg.docId, groupDescriptions } as MainToUi);
      break;
    }

    case 'requestDrift': {
      try {
        const src = await figma.getNodeByIdAsync(msg.sourceNodeId);
        if (!src || (src.type !== 'COMPONENT' && src.type !== 'COMPONENT_SET')) {
          // Both branches of this case render the same "Check unavailable" row,
          // so without these two logs the row cannot say which one fired.
          console.error(
            '[Spec Layer] drift source unresolved', msg.docId, msg.sourceNodeId,
            'resolved to', src ? src.type : 'null',
          );
          figma.ui.postMessage({ type: 'driftError', docId: msg.docId } as MainToUi);
          break;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const node = await serializeNode(src as any, memoizedResolver(resolver));
        const { fileKey } = resolveFileKey(figma.fileKey, null);
        figma.ui.postMessage({ type: 'driftSource', docId: msg.docId, node, fileKey, fileName: figma.root.name } as MainToUi);
      } catch (err) {
        console.error(
          '[Spec Layer] drift check threw for', msg.docId, msg.sourceNodeId, err,
        );
        figma.ui.postMessage({ type: 'driftError', docId: msg.docId } as MainToUi);
      }
      break;
    }

    case 'requestDocProse': {
      // Same lookup as requestDocSource below, including its error handling:
      // under "dynamic-page" access, getNodeByIdAsync can REJECT (not just
      // resolve null) for a page the plugin hasn't loaded. This handler is a
      // bare async function with no surrounding try/catch, so an unguarded
      // rejection here would propagate out of onmessage and the UI would never
      // get a reply. Treat a reject the same as "not found": no prose.
      let section: SectionNode | null = null;
      try {
        const docNode = await figma.getNodeByIdAsync(msg.docId);
        section = docNode && docNode.type === 'SECTION' ? (docNode as SectionNode) : null;
      } catch { section = null; }
      figma.ui.postMessage({
        type: 'docProse',
        docId: msg.docId,
        prose: section ? mergedProse(section) : null,
      } as MainToUi);
      break;
    }

    case 'requestDocBaseline': {
      // No failure resolves to a partial answer, but the two reads fail into
      // different fallbacks. A failure at or before the baseline read leaves
      // `baseline: null`, which the UI reads as "never updated with this
      // build". A failure in the live foundation read must not claim that: the
      // doc does have a baseline, so keep it and report `live: null`, which
      // resolves to the generic "comparison unavailable" reason instead. Same
      // getNodeByIdAsync caveat as requestDocProse: under dynamic-page access
      // it can reject, not just resolve null.
      let baseline: DocBaseline | null = null;
      let live: FoundationUnitContent | null | undefined;
      let link: DocLinkData | null = null;
      try {
        const docNode = await figma.getNodeByIdAsync(msg.docId);
        const section = docNode && docNode.type === 'SECTION' ? (docNode as SectionNode) : null;
        link = section ? parseDocLink(section.getPluginData(DOC_LINK_KEY)) : null;
        if (section && link) {
          baseline = baselineFor(link, section.getPluginData(DOC_BASELINE_KEY));
        }
      } catch (err) {
        console.error('[Spec Layer] baseline read failed for', msg.docId, err);
        baseline = null;
      }
      if (baseline && link && isFoundationLink(link)) {
        try {
          // The Library's own read, retargeted the way the Library retargets,
          // so the live side of the diff is the object whose hash produced the
          // badge. A fresh read is the fallback only when no Library scan has
          // run for this file yet, which the UI's flow does not reach.
          const { fileKey } = resolveFileKey(figma.fileKey, null);
          const spec = lastLibraryFoundation?.fileKey === fileKey
            ? lastLibraryFoundation.spec
            : buildFoundation(await readFoundationDump(fileKey, false));
          live = unitContent(spec, retargetScope(link.scope, spec.collections));
        } catch (err) {
          console.error('[Spec Layer] baseline read failed for', msg.docId, err);
          live = null;
        }
      }
      figma.ui.postMessage({
        type: 'docBaseline',
        docId: msg.docId,
        baseline,
        ...(live !== undefined ? { live } : {}),
      } as MainToUi);
      break;
    }

    case 'requestDocSource': {
      try {
        const docNode = await figma.getNodeByIdAsync(msg.docId);
        if (!docNode || docNode.type !== 'SECTION') {
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message: 'This doc no longer exists.' } as MainToUi);
          break;
        }
        const section = docNode as SectionNode;
        const data = parseDocLink(section.getPluginData(DOC_LINK_KEY));
        if (!data) {
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message: 'This doc is no longer linked to its source.' } as MainToUi);
          break;
        }
        // Foundation docs have no sourceNodeId to rebuild from here; their
        // rebuild path is updateFoundationDoc. Bail with the same "no longer
        // linked" message rather than reading a field that does not exist.
        if (isFoundationLink(data)) {
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message: 'This doc is no longer linked to its source.' } as MainToUi);
          break;
        }
        const src = await figma.getNodeByIdAsync(data.sourceNodeId);
        if (!src || (src.type !== 'COMPONENT' && src.type !== 'COMPONENT_SET')) {
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message: 'This doc’s source component is no longer in this file, so it can’t be updated or copied.' } as MainToUi);
          break;
        }
        const selfEdited = textContentHash(collectGeneratedLane(section)) !== data.selfHash;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const node = await serializeNode(src as any, memoizedResolver(resolver));
        const { fileKey } = resolveFileKey(figma.fileKey, null);
        figma.ui.postMessage({
          type: 'docSource', docId: msg.docId, node, fileKey, fileName: figma.root.name,
          config: data.config, selfEdited, prose: mergedProse(section), intent: msg.intent,
        } as MainToUi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message } as MainToUi);
      }
      break;
    }

    case 'requestPublishSources': {
      try {
        const { fileKey } = resolveFileKey(figma.fileKey, null);
        let foundation: SerializedFoundation | null = null;
        try { foundation = await foundationFor(fileKey); } catch { foundation = null; }
        const groupDescriptions = await liveFoundationGroupDescriptions();
        const components: PublishComponentSource[] = [];
        const skipped: Array<{ name: string; reason: string }> = [];
        const seenSources = new Set<string>();
        // One memo for the whole publish pass: every doc in a file binds the
        // same few dozen variables, so per-doc caches would refetch them.
        const passResolver = memoizedResolver(resolver);
        for (const { docId, section } of await registrySections()) {
          const data = parseDocLink(section.getPluginData(DOC_LINK_KEY));
          if (!data || isFoundationLink(data)) continue;
          // Two docs for one source publish one context, not two.
          if (seenSources.has(data.sourceNodeId)) continue;
          seenSources.add(data.sourceNodeId);
          let src: BaseNode | null = null;
          try { src = await figma.getNodeByIdAsync(data.sourceNodeId); } catch { src = null; }
          if (!src || (src.type !== 'COMPONENT' && src.type !== 'COMPONENT_SET')) {
            skipped.push({ name: section.name, reason: 'The source component is gone.' });
            continue;
          }
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const node = await serializeNode(src as any, passResolver);
            components.push({ docId, name: node.name, node, prose: mergedProse(section) });
          } catch (err) {
            skipped.push({ name: src.name, reason: err instanceof Error ? err.message : String(err) });
          }
        }
        figma.ui.postMessage({
          type: 'publishSources', foundation, groupDescriptions, components, skipped,
          fileKey, fileName: figma.root.name, publishInfo: await readPublishInfo(),
        } as MainToUi);
      } catch (err) {
        figma.ui.postMessage({
          type: 'publishSourcesError', message: err instanceof Error ? err.message : String(err),
        } as MainToUi);
      }
      break;
    }

    case 'requestPublishInfo': {
      figma.ui.postMessage({ type: 'publishInfo', ...(await readPublishInfo()) } as MainToUi);
      break;
    }

    case 'setPublishInfo': {
      const keyStored = await storePublishIdentity(
        figma.clientStorage, figma.root,
        { libraryIdKey: PUBLISH_LIBRARY_KEY, pullKeyStorageKey: publishKeyStorageKey(msg.libraryId) },
        msg.libraryId, msg.pullKey,
      );
      // The id is in the file either way (see storePublishIdentity). Without
      // the key this device cannot update the library; say so now, while the
      // UI still shows the key it was given.
      if (!keyStored) figma.notify('Couldn’t save the pull key on this device.', { error: true });
      break;
    }

    case 'setPublishedAt': {
      // Only for the library this file currently holds. A reply that races a
      // clearPublishInfo, or belongs to an id the file no longer stores, must
      // not date the wrong library.
      if (figma.root.getPluginData(PUBLISH_LIBRARY_KEY) === msg.libraryId) {
        figma.root.setPluginData(PUBLISH_DATE_KEY, msg.publishedAt);
      }
      break;
    }

    case 'stampPublished': {
      // Same guard as setPublishedAt: never label a library the file no longer holds.
      if (figma.root.getPluginData(PUBLISH_LIBRARY_KEY) !== msg.libraryId) break;
      figma.root.setPluginData(PUBLISH_DATE_KEY, msg.publishedAt);
      // Never fabricate a version on a pill: a malformed or empty string here
      // would otherwise be stamped and shown as if the proxy had assigned it.
      // The date above is still a fact about this publish, so it stays.
      if (!isSemver(msg.version)) break;
      figma.root.setPluginData(PUBLISH_VERSION_KEY, msg.version);
      const bySource = new Map(msg.components.map((c) => [c.sourceNodeId, c.hashes]));
      // The hash is taken over the published dump, never a live re-read, so
      // the record can only describe what was actually published. A dump this
      // build cannot read (a shape buildFoundation does not expect) must not
      // take the whole stamp down with it: component docs still get stamped,
      // and the Foundation doc simply keeps whatever hash it already had.
      let publishedFoundation: FoundationSpec | null = null;
      if (msg.foundation) {
        try {
          publishedFoundation = buildFoundation(msg.foundation);
        } catch (err) {
          console.error('[Spec Layer] could not read the published foundation', err);
        }
      }
      for (const { section } of await registrySections()) {
        const link = parseDocLink(section.getPluginData(DOC_LINK_KEY));
        if (!link) continue;
        let sourceHash: string | null = null;
        if (isFoundationLink(link)) {
          if (!publishedFoundation) continue;
          sourceHash = foundationContentHash(publishedFoundation, retargetScope(link.scope, publishedFoundation.collections));
        } else {
          const hashes = bySource.get(link.sourceNodeId);
          if (!hashes) continue; // this doc's source was not in the publish
          sourceHash = link.config.includeHidden ? hashes.hidden : hashes.visible;
        }
        const record: DocPublishRecord = {
          v: 1, libraryId: msg.libraryId, version: msg.version, publishedAt: msg.publishedAt, sourceHash,
        };
        section.setPluginData(PUBLISH_RECORD_KEY, serializePublishRecord(record));
        try {
          await repaintPills(section, pillState(record, sourceHash));
        } catch (err) {
          console.error('[Spec Layer] could not repaint the publish pill', err);
        }
      }
      break;
    }

    case 'clearPublishInfo': {
      const libraryId = figma.root.getPluginData(PUBLISH_LIBRARY_KEY);
      figma.root.setPluginData(PUBLISH_LIBRARY_KEY, '');
      figma.root.setPluginData(PUBLISH_DATE_KEY, '');
      figma.root.setPluginData(PUBLISH_VERSION_KEY, '');
      if (libraryId) {
        try { await figma.clientStorage.deleteAsync(publishKeyStorageKey(libraryId)); } catch { /* nothing to drop */ }
        // Every doc's record described this library; with the library gone the
        // pills read Not published again. Nothing to sweep when the file never
        // held a library id in the first place.
        for (const { section } of await registrySections()) {
          section.setPluginData(PUBLISH_RECORD_KEY, '');
          try { await repaintPills(section, { kind: 'unpublished' }); } catch { /* cosmetic */ }
        }
      }
      break;
    }
  }
};
