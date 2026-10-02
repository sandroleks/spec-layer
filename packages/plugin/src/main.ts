/// <reference types="@figma/plugin-typings" />
import { dispatchUiMessage, type DispatchDeps } from './uiDispatch';
import { serializeNode, mainComponentRef } from './serialize';
import type { NodeResolver, ResolvedStyle } from './serialize';
import { memoizedResolver } from './resolverMemo';
import type { MainToUi, UiToMain, PublishComponentSource, PublishInfo } from './messages';
import { ProgrammaticSelection } from './programmaticSelection';
import { serializeFoundation } from './serializeFoundation';
import { createFoundationReader } from './foundationReader';
import { FoundationPostGate } from './foundationPost';
import {
  buildFoundation, planFoundationUnits, unitContent, foundationContentHash, foundationUnitContentHash,
  foundationUnitTitle, groupRowsByFolder, colorContrast, isSemver,
  type FoundationSpec, type FoundationUnit, type FoundationUnitContent,
  type FoundationVariableRow, type SerializedFoundation, type ColorContrastReport,
  type ProseV2,
  UNKNOWN_FILE_KEY,
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
import { CanvasBuildGate, selectionToReplay, settleBuild } from './canvasBuild';
import { writeSetting, deleteSetting, storePublishIdentity } from './settingsStore';
import {
  PUBLISH_RECORD_KEY, parsePublishRecord, serializePublishRecord, pillState,
  type DocPublishRecord, type PillState,
} from './publishPill';
import { DocumentDirtyFlag } from './libraryDirty';
import { DriftPassResolvers, countSerializedNodes } from './driftPass';
import { FingerprintBaseline, foundationFingerprint } from './foundationFingerprint';
import { BlockWatch } from './timing';
import { SelectionCache } from './selectionCache';

declare const __PLUGIN_VERSION__: string;

// The frame's brand theme: loaded on boot, updated on 'setBrandTheme'.
let brandTheme: BrandTheme = emptyBrandTheme();
// User-captured logo (base64 PNG) for the frame header.
let brandLogo: string | null = null;

// ---------------------------------------------------------------------------
// NodeResolver — wraps async Figma APIs
// ---------------------------------------------------------------------------
/** An unrecognized BaseStyle.type is dropped, never guessed at. */
const STYLE_KINDS: Record<string, ResolvedStyle['kind']> = {
  PAINT: 'paint-style', TEXT: 'text-style', EFFECT: 'effect-style', GRID: 'grid-style',
};

const resolver: NodeResolver = {
  async variable(id) {
    try {
      const v = await figma.variables.getVariableByIdAsync(id);
      if (!v) return null;
      // Figma's own answer on library origin, so the brief states `external`
      // as a fact rather than inferring it from a failed lookup.
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
      // A variant's parent COMPONENT_SET carries the real name and key.
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
// Foundation dump, cached for the session to feed token values into the
// component brief. Only a Foundations tab read refreshes it: Figma sends no
// variable event, and documentchange fires on every edit.
// ---------------------------------------------------------------------------
let foundationCache: { fileKey: string; dump: SerializedFoundation } | null = null;
const foundationPosts = new FoundationPostGate();

/**
 * One fresh read of the file's variables and styles. Pass `publishStatus` only
 * for a dump a v5 projection sees: foundationContentHash does not hash it, and
 * it costs a bridge call per variable, collection and style.
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
 * requestDocBaseline diffs against this, never a fresh read, so a change list
 * cannot disagree with its badge. Read WITHOUT publish status, so it must
 * never reach a v5 projection, Copy for AI or Publish.
 */
let lastLibraryFoundation: { fileKey: string; spec: FoundationSpec } | null = null;

/** Whether the document changed since the last Library scan: the current
 *  page's nodechange and the document's stylechange. */
const libraryDirty = new DocumentDirtyFlag();

/** True once `libraryDirty.attach` succeeded. `requestLibrary`'s shortcut
 *  needs this as well as `!isDirty`, since `consume()` clears the flag even
 *  with nothing listening. It also lets the fingerprint leave styles out. */
let libraryDirtyWatched = false;
const dirtyHost = {
  currentPage: () => figma.currentPage,
  onPageChange: (cb: () => void) => figma.on('currentpagechange', cb),
  onStyleChange: (cb: () => void) => figma.on('stylechange', cb),
};
try {
  libraryDirty.attach(dirtyHost);
  libraryDirtyWatched = true;
} catch (err) {
  console.error('[Spec Layer] could not watch for document edits; every Library visit will re-check', err);
}

/** The same watch for the selection panel, which clears it on its own schedule. */
const selectionDirty = new DocumentDirtyFlag();
let selectionDirtyWatched = false;
try {
  selectionDirty.attach(dirtyHost);
  selectionDirtyWatched = true;
} catch { /* every selection reads its component again */ }
const selectionCache = new SelectionCache(selectionDirty, selectionDirtyWatched);

/** One resolver memo per drift pass; see driftPass.ts. */
const driftPassResolvers = new DriftPassResolvers(resolver);
/** The same, per Library update run (`batchId`), for its requestDocSource reads. */
const updateBatchResolvers = new DriftPassResolvers(resolver);

/** The Foundation read and contrast report one Library update run shares.
 *  A new batch id replaces it; a request without one reads fresh. */
interface UpdateFoundation { batchId: string | null; fileKey: string; spec: FoundationSpec; contrast(): ColorContrastReport }
let updateBatchFoundation: UpdateFoundation | null = null;

async function foundationForUpdate(batchId: string | undefined, fileKey: string): Promise<UpdateFoundation> {
  const held = updateBatchFoundation;
  if (batchId && held && held.batchId === batchId && held.fileKey === fileKey) return held;
  const spec = buildFoundation(await readFoundationDump(fileKey, false));
  let report: ColorContrastReport | undefined;
  const read: UpdateFoundation = { batchId: batchId ?? null, fileKey, spec, contrast: () => (report ??= colorContrast(spec)) };
  updateBatchFoundation = batchId ? read : null;
  return read;
}

/**
 * Identity of local variables at the last Library scan. Variables have no
 * event, yet a rename, deletion or number edit can move a drift hash, so the
 * probe compares this for equality. Set as each scan starts.
 */
const lastFoundationFingerprint = new FingerprintBaseline();

/** Every variable's name, plus FLOAT variables' raw per-mode values (layout
 *  summaries carry resolved padding, gap and radius). No mode resolution. */
async function readFoundationFingerprint(): Promise<string> {
  const variables = await figma.variables.getLocalVariablesAsync();
  return foundationFingerprint(variables.map((v) => ({
    id: v.id, name: v.name, collectionId: v.variableCollectionId,
    ...(v.resolvedType === 'FLOAT' ? { values: v.valuesByMode } : {}),
  })));
}

/** True only in a `DRIFT_TIMING=1` build (see build.mjs). Read it directly at
 *  each use so esbuild drops the branch; an alias const would stop that. */
declare const __DRIFT_TIMING__: boolean;

/** `DRIFT_TIMING=1` only: logs every main-thread stall over 100ms and what
 *  ran in it (see timing.ts). */
const mainBlocks = __DRIFT_TIMING__
  ? new BlockWatch(() => Date.now(), 100, (ms, during) => {
    console.log(`[Spec Layer] timing main blocked ${ms}ms during ${during.join(', ')}`);
  })
  : null;
if (__DRIFT_TIMING__ && mainBlocks) setInterval(() => mainBlocks.tick(50), 50);

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

/** `figma.fileKey`, which a Community plugin never sees, or the placeholder. */
function currentFileKey(): string {
  return figma.fileKey || UNKNOWN_FILE_KEY;
}

/** The component the newest selection resolved to, or null for none. A read
 *  posts only while it is still this, so a late read of A never replaces B. */
let selectionTarget: string | null = null;

/** Post the current selection. An unchanged component sends nothing (see
 *  SelectionCache); `force` posts anyway, for the UI's own request. */
async function postSelection(force = false): Promise<void> {
  const fileKey = currentFileKey();
  const component = findComponent(figma.currentPage.selection);
  const componentId = component ? component.id : null;
  selectionTarget = componentId;

  if (!component || componentId === null) {
    selectionCache.clear();
    figma.ui.postMessage({ type: 'selection', node: null, fileKey, fileName: figma.root.name } satisfies MainToUi);
    return;
  }
  if (!force && await selectionCache.unchanged(componentId, readFoundationFingerprint)) return;
  if (selectionTarget !== componentId) return; // a newer selection arrived meanwhile

  selectionCache.begin(componentId, readFoundationFingerprint().catch(() => null));
  // A foundation failure never blocks the selection: the message omits the
  // field and the brief omits `value` and `code`.
  const [foundation, read] = await Promise.all([
    foundationFor(fileKey).catch((err: unknown) => {
      console.warn('[Spec Layer] foundation unavailable, token values will be missing from the component brief:', err);
      return undefined;
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serializeNode(component as any, memoizedResolver(resolver)).then(
      (node) => ({ node, err: null }),
      (err: unknown) => ({ node: null, err }),
    ),
  ]);
  const current = selectionTarget === componentId;
  selectionCache.end(componentId, current && read.node !== null);
  if (!current) return;

  if (read.node === null) {
    // The empty state, not the previous component; the log tells "cannot be
    // read" apart from "nothing is selected".
    console.error('[Spec Layer] selection serialization failed for', component.type, component.name, componentId, read.err);
    selectionCache.clear();
    figma.ui.postMessage({ type: 'selection', node: null, fileKey, fileName: figma.root.name } satisfies MainToUi);
    return;
  }
  const node = read.node;
  figma.ui.postMessage({
    type: 'selection', node, fileKey,
    // figma.root.name is main-thread only, so the file's name rides along.
    fileName: figma.root.name,
    // Only when the UI does not already hold this exact dump (FoundationPostGate).
    ...(foundation && foundationPosts.fresh(foundation) ? { foundation } : {}),
  } satisfies MainToUi);
  // Whether Create would replace a doc ("Replace docs"). Sent separately so
  // the panel never waits on the registry.
  void findExistingDoc(componentId, `${component.name}: Documentation`).then((doc) => {
    if (selectionTarget !== componentId) return;
    figma.ui.postMessage({ type: 'selectionDoc', nodeId: node.id, hasDoc: doc !== null } satisfies MainToUi);
  }).catch(() => { /* the button keeps saying Create docs, which is still true */ });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
// Without `title` Figma shows the manifest name, which carries the listing's search words.
figma.showUI(__html__, { width: 480, height: 680, themeColors: true, title: 'Spec Layer' });

Promise.all([
  figma.clientStorage.getAsync('licenseKey') as Promise<string | undefined>,
  figma.clientStorage.getAsync('licenseInstanceId') as Promise<string | undefined>,
]).then(([value, instanceId]: [string | undefined, string | undefined]) => {
  const msg: MainToUi = { type: 'licenseKey', value: value ?? null, instanceId: instanceId ?? null };
  figma.ui.postMessage(msg);
}).catch(() => {/* ignore */});
// `figma.currentUser` THROWS without the "currentuser" manifest permission,
// which optional chaining does not catch.
let figmaUserId: string | null = null;
try {
  figmaUserId = figma.currentUser?.id ?? null;
} catch {
  figmaUserId = null; // no identity → the UI simply hides the quota meter
}
figma.ui.postMessage({ type: 'userInfo', userId: figmaUserId } satisfies MainToUi);

figma.clientStorage.getAsync('aiEnabled').then((value: boolean | undefined) => {
  const msg: MainToUi = { type: 'aiEnabled', value: value === true };
  figma.ui.postMessage(msg);
}).catch(() => {/* ignore */});

// Default YAML; a corrupt entry cannot choose a format.
figma.clientStorage.getAsync('componentFormat').then((value: unknown) => {
  const msg: MainToUi = { type: 'componentFormat', value: storedComponentFormat(value) };
  figma.ui.postMessage(msg);
}).catch(() => {/* ignore */});

// A 1.x install's two-color 'brandColors' is migrated once and left in
// place, so a rollback still finds it.
figma.clientStorage.getAsync('brandTheme').then(async (value: BrandTheme | undefined) => {
  if (value) {
    brandTheme = migrateBrandColors(value);
  } else {
    const legacy = await figma.clientStorage.getAsync('brandColors') as BrandColors | undefined;
    brandTheme = migrateBrandColors(legacy);
    await figma.clientStorage.setAsync('brandTheme', brandTheme);
  }
  const msg: MainToUi = { type: 'brandTheme', value: brandTheme };
  figma.ui.postMessage(msg);
}).catch(() => {/* ignore */});

figma.clientStorage.getAsync('brandLogo').then((value: string | undefined) => {
  brandLogo = value ?? null;
  if (brandLogo) {
    const msg: MainToUi = { type: 'logoCaptured', base64: brandLogo };
    figma.ui.postMessage(msg);
  }
}).catch(() => {/* ignore */});

// A build selects its generated doc. That selection must not replace the
// source component in the UI; a user's click never matches the Section id.
const programmaticDocSelection = new ProgrammaticSelection();

// One build at a time (see CanvasBuildGate): the handler is re-entrant, and a
// build mutates shared module state (theme palette, layout widths, fonts).
const canvasBuild = new CanvasBuildGate();

// selectionchange does not fire on plugin open; the UI sends requestSelection on mount.
figma.on('selectionchange', () => {
  const selected = figma.currentPage.selection;
  // Consume first, so an expectation armed while the gate is held cannot
  // swallow the user's next click.
  if (programmaticDocSelection.consume(selected.map((node) => node.id))) return;
  // A build's page hops report each page's selection, which would empty the
  // pane. A click during a build is only noted; the build replays it once
  // the gate releases (see selectionToReplay).
  if (canvasBuild.busy) {
    canvasBuild.noteSkipped();
    return;
  }
  void postSelection().catch(() => {/* handled inside */});
});

/** The generated lane's text, everything selfHash covers. Editorial slots (an
 *  Update keeps them) and instances (they mirror the source) are skipped; see
 *  canvasProse.ts. */
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

/**
 * Publish identity. `figma.fileKey` is undefined for a Community plugin, so
 * the library id lives in root plugin data (shared by every editor) and the
 * pull key per user in clientStorage. A second device sees the id, not the key.
 */
const PUBLISH_LIBRARY_KEY = 'speclayer.publish.libraryId';
/** ISO time of the last recorded publish. Lives in the file, like the id. */
const PUBLISH_DATE_KEY = 'speclayer.publish.publishedAt';
/** The library's current version as the proxy last reported it. In the file, like the date. */
const PUBLISH_VERSION_KEY = 'speclayer.publish.version';
const publishKeyStorageKey = (libraryId: string): string => `publishKey:${libraryId}`;

/** The toast for a setting this device could not keep; the value still holds
 *  in memory until the plugin closes. */
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

/** The doc registry, kept in root plugin data. */
function readRegistry() {
  return parseRegistry(figma.root.getPluginData(DOC_REGISTRY_KEY));
}
function writeRegistry(r: { v: 1; docIds: string[] }): void {
  figma.root.setPluginData(DOC_REGISTRY_KEY, serializeRegistry(r));
}

/** Every registry id that still names a Section. A rejected read is skipped:
 *  these callers never prune. */
async function registrySections() {
  return (await resolveRegistrySections(readRegistry().docIds, figma)).sections;
}

// Every foundation doc link on canvas. A dangling id is skipped, not pruned:
// the Library scan owns that cleanup.
async function liveFoundationDocLinks(): Promise<FoundationDocLink[]> {
  const links: FoundationDocLink[] = [];
  for (const { section } of await registrySections()) {
    const data = parseDocLink(section.getPluginData(DOC_LINK_KEY));
    if (data && isFoundationLink(data)) links.push(data);
  }
  return links;
}

/**
 * Every group description on canvas, read fresh after any action that changes
 * the foundation docs, so the UI's copy-time cache follows what landed, not
 * what was sent (see descriptionsForUnit). A failed read is an empty map.
 */
async function liveFoundationGroupDescriptions(): Promise<Record<string, Record<string, string>>> {
  try {
    return mergeFoundationGroupDescriptions(await liveFoundationDocLinks());
  } catch {
    return {};
  }
}

// A source's doc: from the registry (any page), else a name match on the
// current page, which adopts pre-2.1 docs.
async function findExistingDoc(
  sourceNodeId: string,
  sectionName: string,
): Promise<SectionNode | null> {
  for (const { section } of await registrySections()) {
    const data = parseDocLink(section.getPluginData(DOC_LINK_KEY));
    // Foundation docs resolve by scope, never here.
    if (data && !isFoundationLink(data) && data.sourceNodeId === sourceNodeId) return section;
  }
  // Adopt only an unstamped Section or this source's own. Another source's
  // doc, or a foundation doc, that merely shares the name is not replaced.
  for (const child of figma.currentPage.children) {
    try {
      if (child.type === 'SECTION' && child.name === sectionName) {
        const data = parseDocLink((child as SectionNode).getPluginData(DOC_LINK_KEY));
        if (!data || (!isFoundationLink(data) && data.sourceNodeId === sourceNodeId)) return child as SectionNode;
      }
    } catch { /* skip unresolved child */ }
  }
  return null;
}

/** The doc a component build replaces: the one a Library Update names while
 *  it is still this source's doc (no registry read), else a lookup. */
async function docToReplace(docId: string | undefined, sourceNodeId: string, sectionName: string): Promise<SectionNode | null> {
  if (docId) {
    try {
      const node = await figma.getNodeByIdAsync(docId);
      if (node && node.type === 'SECTION') {
        const link = parseDocLink((node as SectionNode).getPluginData(DOC_LINK_KEY));
        if (link && !isFoundationLink(link) && link.sourceNodeId === sourceNodeId) return node as SectionNode;
      }
    } catch { /* fall back to the lookup */ }
  }
  return findExistingDoc(sourceNodeId, sectionName);
}

/**
 * One unit's group descriptions from the build-wide map, keyed
 * `collectionId|folder` because two collections can share a folder name. A
 * doc stores plain folders, and only those it renders.
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

const handleUiMessage = async (raw: unknown): Promise<void> => {
  const msg = raw as UiToMain;
  switch (msg.type) {
    case 'requestSelection':
      await postSelection(true);
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
        // Long edge capped near 1568px for vision limits, never above 2x.
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
        // Reply, never just notify: the UI holds a lock until this reports back.
        const message = 'Another build is still running. Try again when it finishes.';
        figma.ui.postMessage({ type: 'docFrameError', message } as MainToUi);
        break;
      }
      // Success leaves the user on the new Section's page, selected; only a
      // failure hops back. `programmaticIds` stays null, not [], until this
      // build selects something, so a real mid-build deselect still replays.
      const invokingPage = figma.currentPage;
      const atBegin = invokingPage.selection.map((node) => node.id);
      let programmaticIds: string[] | null = null;
      let section: SectionNode | null = null;
      let committed = false; // true once the old doc has been replaced by the new one
      try {
        const sectionName = `${msg.model.componentName}: Documentation`;
        const existing = await docToReplace(msg.docId, msg.nodeId, sectionName);
        // Read now: a removed node throws on any property read but `.removed`,
        // and the registry prune after commit needs this id.
        const existingId = existing ? existing.id : null;
        // The publish record survives a rebuild. Read before remove(), like the position.
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
          // See ComponentDocLink.extractorVersion.
          extractorVersion: msg.extractorVersion,
        };
        section.setPluginData(DOC_LINK_KEY, serializeDocLink(data));
        // Written with the link, after the build succeeded, so a failed build
        // leaves no guidelines behind. Over budget serializes to '' (nothing).
        section.setPluginData(DOC_PROSE_KEY, msg.prose ? serializeProse(msg.prose) : '');
        // The diff baseline is the projection msg.contentHash covers, written
        // with the link so the two never disagree. Over budget it is '' and the
        // row shows the fallback for good, which spec section 9 accepts.
        section.setPluginData(DOC_BASELINE_KEY, serializeBaseline({
          v: 1, kind: 'component', contentHash: msg.contentHash, projection: msg.baseline,
        }));
        if (publishRaw) section.setPluginData(PUBLISH_RECORD_KEY, publishRaw);

        // Point of no return: after this, `section` IS the doc and must survive
        // any later (cosmetic) failure.
        if (existing) existing.remove();
        // Re-appending moves it to the end, above its siblings.
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
          // Its own value, not re-read off `section`: a removed node throws on
          // any property read but `.removed`.
          programmaticIds = [section.id];
        } catch {
          programmaticDocSelection.cancel();
          // The doc's page kept its old selection, which is not a choice made
          // during this build: claim it so finally does not replay it. A failed
          // read leaves null and must not fail a placed doc.
          try {
            if (figma.currentPage.id !== invokingPage.id) {
              programmaticIds = figma.currentPage.selection.map((node) => node.id);
            }
          } catch { /* leave null */ }
        }
        try {
          figma.viewport.scrollAndZoomIntoView([section]);
        } catch { /* zoom is non-essential */ }

        // `replaced` lets the UI say "Updated" rather than "Created".
        figma.ui.postMessage({
          type: 'docFrameDone', frameName: section.name, replaced: existingId !== null, docId: section.id,
        } satisfies MainToUi);
      } catch (err) {
        // Clean up an orphan only if we failed BEFORE committing the replacement;
        // after commit the section is the live doc and must not be removed.
        if (section && !committed) {
          try { section.remove(); } catch { /* already gone */ }
        }
        // Hop back, so `current` below describes `atBegin`'s page. Guarded so
        // it never replaces the real error.
        try {
          if (figma.currentPage.id !== invokingPage.id) await figma.setCurrentPageAsync(invokingPage);
        } catch {
          // Best-effort only.
        }
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'docFrameError', message } as MainToUi);
      } finally {
        canvasBuild.end();
        // Replay a click noted during the build (see the selectionchange listener).
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
      // Scan on a dirty flag or a changed variable fingerprint. An unreadable
      // fingerprint, or no live watch, scans too.
      let fingerprint: string | null = null;
      let probed = false;
      if (msg.ifChanged === true && libraryDirtyWatched && !libraryDirty.isDirty) {
        probed = true;
        const probeStarted = __DRIFT_TIMING__ ? Date.now() : 0;
        try { fingerprint = await readFoundationFingerprint(); } catch { fingerprint = null; }
        if (__DRIFT_TIMING__) console.log(`[Spec Layer] probe timing ${Date.now() - probeStarted}ms, dirty ${libraryDirty.isDirty}`);
        // isDirty again after the awaits: an edit that landed while the
        // probe read, or while it waited on a scan's read, scans now.
        if (await lastFoundationFingerprint.matches(fingerprint) && !libraryDirty.isDirty) {
          figma.ui.postMessage({ type: 'libraryUnchanged' } as MainToUi);
          break;
        }
      }
      // Cleared as the scan STARTS, so an edit during the scan or its drift
      // pass marks the next visit dirty. The fingerprint is taken now for the
      // same reason, unawaited, reusing the probe's result when it ran.
      libraryDirty.consume();
      driftPassResolvers.reset();
      // A scan ends any update run's shared reads.
      updateBatchResolvers.reset();
      updateBatchFoundation = null;
      lastFoundationFingerprint.set(probed ? Promise.resolve(fingerprint) : readFoundationFingerprint());
      // One live extraction answers every foundation row; scanLibrary calls
      // it lazily, at most once. Null on failure, never a rejection: an
      // unreadable foundation marks those rows unavailable, not the list.
      let foundationMs = 0;
      const liveFoundation = async (): Promise<FoundationSpec | null> => {
        const foundationStarted = __DRIFT_TIMING__ ? Date.now() : 0;
        if (__DRIFT_TIMING__) mainBlocks?.doing('requestLibrary foundation read');
        try {
          const fileKey = currentFileKey();
          const spec = buildFoundation(await readFoundationDump(fileKey, false));
          lastLibraryFoundation = { fileKey, spec };
          return spec;
        } catch (err) {
          console.error('[Spec Layer] foundation read failed during the library scan', err);
          return null;
        } finally {
          if (__DRIFT_TIMING__) {
            foundationMs = Date.now() - foundationStarted;
            mainBlocks?.doing('requestLibrary');
          }
        }
      };
      let scan: LibraryScan;
      const scanStarted = __DRIFT_TIMING__ ? Date.now() : 0;
      try {
        const reg = readRegistry();
        scan = await scanLibrary(reg.docIds, { getNodeByIdAsync: (id) => figma.getNodeByIdAsync(id), liveFoundation });
      } catch (err) {
        scan = { entries: [], alive: new Set<string>(), error: err instanceof Error ? err.message : String(err) };
      }
      if (__DRIFT_TIMING__) {
        const ms = Date.now() - scanStarted;
        console.log(`[Spec Layer] timing scan ${scan.entries.length} docs in ${ms}ms (foundation read ${foundationMs}ms, registry and doc frames ${ms - foundationMs}ms)`);
      }
      if (scan.error !== null) console.error('[Spec Layer] library scan failed', scan.error);
      const { message, prune } = libraryReply(scan);
      if (prune) {
        // A failed self-heal write must not fail the reply; the next scan prunes again.
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
        const fileKey = currentFileKey();
        const dump = await readFoundationDump(fileKey, true);
        // The Foundations tab's load and "Refresh sources" are the one forced
        // fresh read, so the selection cache takes it too.
        foundationCache = { fileKey, dump };
        // Lets Copy hand over the generated vocabulary. Omitted, never sent
        // empty, so absent keeps meaning "nothing on canvas".
        const merged = await liveFoundationGroupDescriptions();
        const groupDescriptions = Object.keys(merged).length > 0 ? merged : undefined;
        // This reply carries the dump, so the next 'selection' must not.
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
        // Reply, never just notify; see renderDocFrame.
        const message = 'Another build is still running. Try again when it finishes.';
        figma.ui.postMessage({ type: 'foundationFrameError', message, created: 0 } as MainToUi);
        break;
      }
      // Frames already placed are never rolled back; the catch reports them.
      let created = 0;
      // Built and already on the page, but not yet owned by the registry: a
      // throw before writeRegistry would leave an untracked duplicate. Cleared
      // once the registry owns it or its predecessor is gone (then it IS the
      // doc, and a later throw must not delete the user's only copy).
      let pending: SectionNode | null = null;
      // New units land here; a replacing unit visits its predecessor's page
      // and returns before the next, so the layout cursor never drifts.
      const invokedPage = figma.currentPage;
      const atBegin = invokedPage.selection.map((node) => node.id);
      try {
        // Re-extract: the UI's dump may be stale by the time the user clicks Create.
        const fileKey = currentFileKey();
        const dump = await readFoundationDump(fileKey, false);
        const spec = buildFoundation(dump);
        const units = planFoundationUnits(spec, msg.selection);

        let replaced = 0;
        let x = 0;
        let y = 0;

        // Right of everything on the page, never on top of existing work.
        for (const child of invokedPage.children) {
          if ('x' in child && 'width' in child) {
            const c = child as SceneNode & { x: number; width: number; y: number };
            x = Math.max(x, c.x + c.width + 120);
            y = Math.min(y, c.y);
          }
        }

        // Tracked foundation Sections on any page, by scope, so a regenerated
        // unit replaces its predecessor in place.
        const existingByScope = new Map<string, SectionNode>();
        for (const { section: existing } of await registrySections()) {
          const link = parseDocLink(existing.getPluginData(DOC_LINK_KEY));
          if (link && isFoundationLink(link)) {
            existingByScope.set(foundationScopeKey(link.scope), existing);
          }
        }

        // Once per build, and only with the toggle on: colorContrast reads the
        // whole foundation.
        const contrastReport = msg.config.includeContrast ? colorContrast(spec) : undefined;

        for (let i = 0; i < units.length; i++) {
          const unit = units[i];
          // Never null here: every unit came from planFoundationUnits on this spec.
          const content = unitContent(spec, unit.scope);
          if (!content) continue;

          // Switch to the destination page BEFORE building, because
          // figma.createSection() appends to the current page.
          const prior = existingByScope.get(foundationScopeKey(unit.scope));
          const targetPage = prior ? (pageOf(prior) ?? invokedPage) : invokedPage;
          if (targetPage.id !== figma.currentPage.id) await figma.setCurrentPageAsync(targetPage);
          const publishRaw = prior ? prior.getPluginData(PUBLISH_RECORD_KEY) : '';
          const currentHash = foundationUnitContentHash(content);
          const pill: PillState = pillState(parsePublishRecord(publishRaw), currentHash);

          const descriptions = descriptionsForUnit(msg.groupDescriptions, unit, content);

          // Each collection unit looks up its own overview; a styles unit has none.
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

          // Stamp before removing the predecessor; see renderDocFrame.
          data.selfHash = textContentHash(collectGeneratedLane(section));
          section.setPluginData(DOC_LINK_KEY, serializeDocLink(data));
          // `content` is the object foundationContentHash hashed for this
          // link, so it is the baseline verbatim.
          section.setPluginData(DOC_BASELINE_KEY, serializeBaseline({
            v: 1, kind: 'foundation', contentHash: data.contentHash, projection: content,
          }));
          if (publishRaw) section.setPluginData(PUBLISH_RECORD_KEY, publishRaw);

          if (prior) {
            // Write the registry only after prior.remove() succeeds, or a throw
            // there leaves the prior Section on canvas untracked.
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

          // Back to the invoking page, where the next new unit must land.
          if (figma.currentPage.id !== invokedPage.id) await figma.setCurrentPageAsync(invokedPage);

          figma.ui.postMessage({
            type: 'foundationProgress', done: i + 1, total: units.length,
          } as MainToUi);
        }

        // From canvas, not msg.groupDescriptions: each doc kept only its subset.
        const groupDescriptions = await liveFoundationGroupDescriptions();
        figma.ui.postMessage({ type: 'foundationDone', created, replaced, groupDescriptions } as MainToUi);
      } catch (err) {
        if (pending) {
          try { pending.remove(); } catch { /* already gone */ }
        }
        const message = err instanceof Error ? err.message : String(err);
        // A mid-loop throw skips the loop's restore, so restore here. Guarded
        // so it never replaces the original error.
        try {
          if (figma.currentPage.id !== invokedPage.id) await figma.setCurrentPageAsync(invokedPage);
        } catch {
          // Best-effort only.
        }
        figma.ui.postMessage({ type: 'foundationFrameError', message, created } as MainToUi);
      } finally {
        canvasBuild.end();
        // The loop and the catch both return to invokedPage, so no hop here.
        // programmatic is null: this path selects nothing of its own.
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
      if (!canvasBuild.begin()) {
        const message = 'Another build is still running. Try again when it finishes.';
        figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message } as MainToUi);
        break;
      }
      // An Update has no page to land on, so finally hops back here before
      // replying and replaying.
      const invokingPage = figma.currentPage;
      const atBegin = invokingPage.selection.map((node) => node.id);
      // See renderFoundation's `pending`.
      let pending: SectionNode | null = null;
      // Posted from finally after the hop (see settleBuild); posted earlier,
      // Update all's next request would reach a gate this build still holds.
      let reply: MainToUi | null = null;
      try {
        const node = await figma.getNodeByIdAsync(msg.docId);
        if (!node || node.type !== 'SECTION') {
          reply = { type: 'docSourceError', docId: msg.docId,
            message: 'This doc no longer exists.' };
          break;
        }
        const prior = node as SectionNode;
        const link = parseDocLink(prior.getPluginData(DOC_LINK_KEY));
        if (!link || !isFoundationLink(link)) {
          reply = { type: 'docSourceError', docId: msg.docId,
            message: 'This doc is no longer linked to its source.' };
          break;
        }

        const foundation = await foundationForUpdate(msg.batchId, currentFileKey());
        const spec = foundation.spec;

        // Same retarget rule as the drift check; see retargetScope.
        const scope = retargetScope(link.scope, spec.collections);

        const content = unitContent(spec, scope);
        if (!content) {
          // Say which: the collection is gone, or nothing matches the doc's
          // group anymore. A const, since narrowing a `let` does not reach the
          // `.some` closure.
          const scopedCollectionId = scope.target === 'collection' ? scope.collectionId : null;
          const collectionGone = scopedCollectionId !== null
            && !spec.collections.some((c) => c.id === scopedCollectionId);
          reply = { type: 'docSourceError', docId: msg.docId,
            message: collectionGone
              ? 'Couldn’t update this doc. Its collection is no longer in this file.'
              : `Couldn’t update this doc. Nothing in this file is named “${scope.group}” anymore.` };
          break;
        }

        const unit: FoundationUnit = {
          scope,
          // The shared title derivation, so a rebuilt doc keeps its name.
          title: foundationUnitTitle(scope, content),
          rowCount: content.rows.length,
          omittedModeNames: content.omittedModeNames,
        };

        const publishRaw = prior.getPluginData(PUBLISH_RECORD_KEY);
        const currentHash = foundationUnitContentHash(content);
        const pill: PillState = pillState(parsePublishRecord(publishRaw), currentHash);

        // An Update is a source refresh: it keeps the doc's config and
        // descriptions, and never re-asks the model or re-bills the quota.
        const section = await buildFoundationFrame(
          content, unit, resolveTheme(brandTheme), link.config.includeDescriptions,
          brandLogo, link.groupDescriptions,
          link.config.includeContrast,
          link.config.includeContrast ? foundation.contrast() : undefined,
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

        // Regenerate in place, on the prior doc's page and position.
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

        // Stamped and placed before the old doc goes; see renderDocFrame.
        const reg = removeDoc(readRegistry(), prior.id);
        prior.remove();
        pending = null; // point of no return: the new Section is the doc
        writeRegistry(addDoc(reg, section.id));

        // The docId marks a row's Update, not the bulk build.
        const groupDescriptions = await liveFoundationGroupDescriptions();
        reply = {
          type: 'foundationDone', created: 0, replaced: 1, docId: msg.docId, groupDescriptions,
        };
      } catch (err) {
        if (pending) {
          try { pending.remove(); } catch { /* already gone */ }
        }
        const message = err instanceof Error ? err.message : String(err);
        reply = { type: 'docSourceError', docId: msg.docId, message };
      } finally {
        // settleBuild owns the order: hop back, reply, release, replay.
        const settled = reply;
        await settleBuild({
          restorePage: async () => {
            if (figma.currentPage.id !== invokingPage.id) await figma.setCurrentPageAsync(invokingPage);
          },
          reply: () => {
            if (settled) figma.ui.postMessage(settled);
          },
          release: () => canvasBuild.end(),
          // programmatic is null, as in renderFoundation.
          replay: () => {
            const current = figma.currentPage.selection.map((node) => node.id);
            if (selectionToReplay({
              skipped: canvasBuild.skippedSelection, current, atBegin, programmatic: null,
            })) {
              void postSelection().catch(() => {/* handled inside */});
            }
          },
        });
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
      // A failed registry write must not swallow the reply, or the UI's menu
      // stays disabled. The next Library scan prunes the id.
      try {
        writeRegistry(removeDoc(readRegistry(), msg.docId));
      } catch (err) {
        console.error('[Spec Layer] could not update the doc registry after detaching', msg.docId, err);
      }
      // Fresh from canvas, so the UI's cache also drops descriptions now gone.
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
      const groupDescriptions = await liveFoundationGroupDescriptions();
      figma.ui.postMessage({ type: 'docRemoved', docId: msg.docId, groupDescriptions } as MainToUi);
      break;
    }

    case 'requestDrift': {
      try {
        const started = __DRIFT_TIMING__ ? Date.now() : 0;
        const src = await figma.getNodeByIdAsync(msg.sourceNodeId);
        if (!src || (src.type !== 'COMPONENT' && src.type !== 'COMPONENT_SET')) {
          // Both branches show the same row; the logs tell them apart.
          console.error(
            '[Spec Layer] drift source unresolved', msg.docId, msg.sourceNodeId,
            'resolved to', src ? src.type : 'null',
          );
          figma.ui.postMessage({ type: 'driftError', docId: msg.docId, passId: msg.passId } as MainToUi);
          break;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const node = await serializeNode(src as any, driftPassResolvers.forPass(msg.passId));
        if (__DRIFT_TIMING__) {
          console.log(`[Spec Layer] drift timing ${msg.docId} ${Date.now() - started}ms, ${countSerializedNodes(node)} nodes, ${JSON.stringify(node).length} bytes`);
        }
        const fileKey = currentFileKey();
        figma.ui.postMessage({
          type: 'driftSource', docId: msg.docId, passId: msg.passId, node, fileKey, fileName: figma.root.name,
        } as MainToUi);
      } catch (err) {
        console.error(
          '[Spec Layer] drift check threw for', msg.docId, msg.sourceNodeId, err,
        );
        figma.ui.postMessage({ type: 'driftError', docId: msg.docId, passId: msg.passId } as MainToUi);
      }
      break;
    }

    case 'requestDocProse': {
      // Under "dynamic-page" access getNodeByIdAsync can REJECT, not just
      // resolve null, and an unguarded rejection leaves the UI with no reply.
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
      // A failed baseline read is `baseline: null` ("never updated with this
      // build"); a failed live read is `live: null` ("comparison unavailable").
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
          // The Library's own read, retargeted the same way, so the diff covers
          // the object behind the badge (see lastLibraryFoundation).
          const fileKey = currentFileKey();
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
        // Foundation docs rebuild through updateFoundationDoc.
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
        const memo = msg.batchId ? updateBatchResolvers.forPass(msg.batchId) : memoizedResolver(resolver);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const node = await serializeNode(src as any, memo);
        const fileKey = currentFileKey();
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
        const fileKey = currentFileKey();
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
      // The id is stored either way. Without the key this device cannot update
      // the library, so say so while the UI still shows the key.
      if (!keyStored) figma.notify('Couldn’t save the pull key on this device.', { error: true });
      break;
    }

    case 'setPublishedAt': {
      // Only for the library this file holds: a reply racing clearPublishInfo
      // must not date the wrong library.
      if (figma.root.getPluginData(PUBLISH_LIBRARY_KEY) === msg.libraryId) {
        figma.root.setPluginData(PUBLISH_DATE_KEY, msg.publishedAt);
      }
      break;
    }

    case 'stampPublished': {
      // Same guard as setPublishedAt: never label a library the file no longer holds.
      if (figma.root.getPluginData(PUBLISH_LIBRARY_KEY) !== msg.libraryId) break;
      figma.root.setPluginData(PUBLISH_DATE_KEY, msg.publishedAt);
      // Never fabricate a version on a pill. The date is still a fact, so it stays.
      if (!isSemver(msg.version)) break;
      figma.root.setPluginData(PUBLISH_VERSION_KEY, msg.version);
      const bySource = new Map(msg.components.map((c) => [c.sourceNodeId, c.hashes]));
      // Hashed over the published dump, never a live re-read, so the record
      // describes what was published. An unreadable dump skips only the
      // Foundation docs, which keep their old hash.
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
        // With the library gone, every pill reads Not published again.
        for (const { section } of await registrySections()) {
          section.setPluginData(PUBLISH_RECORD_KEY, '');
          try { await repaintPills(section, { kind: 'unpublished' }); } catch { /* cosmetic */ }
        }
      }
      break;
    }
  }
};

/** `DRIFT_TIMING=1` only: each handler's run time, awaits included. A long
 *  handler with no mainBlocks stall was waiting on Figma. */
async function timedUiMessage(raw: unknown): Promise<void> {
  const msg = raw as { type?: string; docId?: string };
  const label = msg.type === 'requestDrift' ? `requestDrift ${msg.docId ?? ''}` : (msg.type ?? 'unknown');
  const started = Date.now();
  mainBlocks?.doing(label);
  try {
    await handleUiMessage(raw);
  } finally {
    mainBlocks?.done();
    const ms = Date.now() - started;
    if (ms >= 30) console.log(`[Spec Layer] timing main ${label} took ${ms}ms`);
  }
}

const dispatchDeps: DispatchDeps = {
  commitUndo: () => figma.commitUndo(),
  notifyError: (message) => { figma.notify(message, { error: true }); },
  log: (message, err) => console.error(message, err),
};

figma.ui.onmessage = (raw: unknown) => dispatchUiMessage(raw, __DRIFT_TIMING__ ? timedUiMessage : handleUiMessage, dispatchDeps);
