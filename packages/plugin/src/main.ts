/// <reference types="@figma/plugin-typings" />
import { serializeNode, mainComponentRef } from './serialize';
import type { NodeResolver, ResolvedStyle } from './serialize';
import type { MainToUi, UiToMain, LibraryEntry } from './messages';
import { resolveFileKey } from './fileKey';
import { ProgrammaticSelection } from './programmaticSelection';
import { serializeFoundation, type FoundationReader } from './serializeFoundation';
import {
  buildFoundation, planFoundationUnits, unitContent, foundationContentHash,
  foundationUnitTitle, groupRowsByFolder, colorContrast,
  type FoundationSpec, type FoundationUnit, type FoundationUnitContent,
  type FoundationVariableRow, type SerializedFoundation, type RawEffect,
} from '@spec-layer/extractor';
import { scopeIconKind } from './foundationIcon';
import { buildDocFrames } from './docFrame';
import { buildFoundationFrame, isColorRow } from './foundationFrame';
import { emptyBrandTheme, resolveTheme, migrateBrandColors, type BrandTheme, type BrandColors } from './brandColors';
import { familiesWithRequiredStyles } from './fonts';
import {
  DOC_LINK_KEY, DOC_REGISTRY_KEY, DOC_PROSE_KEY,
  parseDocLink, serializeDocLink, parseRegistry, serializeRegistry, addDoc, pruneRegistry,
  textContentHash, isFoundationLink, foundationScopeKey, retargetScope,
  serializeProse, parseProse, mergeFoundationGroupDescriptions,
  type DocLinkData, type FoundationDocLink, type DocRegistry,
} from './docLink';

declare const __PLUGIN_VERSION__: string;

// User-customizable brand theme for the generated frame. Loaded from
// clientStorage on boot (migrating the legacy two-color 'brandColors' storage
// once), updated on 'setBrandTheme', and resolved to concrete values when
// building a frame.
let brandTheme: BrandTheme = emptyBrandTheme();
// User-captured logo (base64 PNG), used by Task 14 to stamp the frame.
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
// FoundationReader — wraps the variables/styles APIs for serializeFoundation
// ---------------------------------------------------------------------------
async function publishStatusOf(
  source: { getPublishStatusAsync(): Promise<PublishStatus> },
): Promise<PublishStatus | null> {
  try { return await source.getPublishStatusAsync(); } catch { return null; }
}

const foundationReader: FoundationReader = {
  async collections() {
    const colls = await figma.variables.getLocalVariableCollectionsAsync();
    return Promise.all(colls.map(async (c) => ({
      id: c.id,
      name: c.name,
      modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
      defaultModeId: c.defaultModeId,
      variableIds: c.variableIds,
      hiddenFromPublishing: c.hiddenFromPublishing,
      publishStatus: await publishStatusOf(c),
      remote: c.remote,
    })));
  },
  async variable(id) {
    const v = await figma.variables.getVariableByIdAsync(id);
    if (!v) return null;
    return {
      id: v.id,
      name: v.name,
      resolvedType: v.resolvedType,
      description: v.description ?? '',
      variableCollectionId: v.variableCollectionId,
      // codeSyntax is Partial<Record<CodeSyntaxPlatform, string>>; drop empties.
      codeSyntax: Object.fromEntries(
        Object.entries(v.codeSyntax ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'),
      ),
      valuesByMode: v.valuesByMode as Record<string, never>,
      scopes: [...v.scopes],
      remote: v.remote,
      hiddenFromPublishing: v.hiddenFromPublishing,
      publishStatus: await publishStatusOf(v),
    };
  },
  async textStyles() {
    const styles = await figma.getLocalTextStylesAsync();
    return Promise.all(styles.map(async (s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? '',
      fontName: { family: s.fontName.family, style: s.fontName.style },
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      paragraphSpacing: s.paragraphSpacing,
      paragraphIndent: s.paragraphIndent,
      textCase: String(s.textCase),
      textDecoration: String(s.textDecoration),
      boundVariables: Object.fromEntries(
        Object.entries(s.boundVariables ?? {})
          .filter((e): e is [string, VariableAlias] => Boolean(e[1]?.id))
          .map(([k, v]) => [k, { id: v.id }]),
      ),
      remote: s.remote,
      publishStatus: await publishStatusOf(s),
    })));
  },
  async effectStyles() {
    const styles = await figma.getLocalEffectStylesAsync();
    return Promise.all(styles.map(async (s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? '',
      // Handed to effectLayerOf as-is: it is structurally typed for exactly this,
      // which is what keeps the effect union in the extractor rather than here.
      effects: s.effects as unknown as RawEffect[],
      remote: s.remote,
      publishStatus: await publishStatusOf(s),
    })));
  },
  async collectionName(id) {
    const c = await figma.variables.getVariableCollectionByIdAsync(id);
    return c?.name ?? null;
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
// suspects staleness has an existing, discoverable way to clear it without
// this task inventing a second refresh affordance.
// ---------------------------------------------------------------------------
let foundationCache: { fileKey: string; dump: SerializedFoundation } | null = null;

async function foundationFor(fileKey: string): Promise<SerializedFoundation> {
  if (foundationCache?.fileKey === fileKey) return foundationCache.dump;
  const dump = await serializeFoundation(
    foundationReader, fileKey, new Date().toISOString(), figma.root.name,
  );
  foundationCache = { fileKey, dump };
  return dump;
}

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
    figma.notify('Select a component or component set');
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
    const node = await serializeNode(component as any, resolver);
    if (seq !== selectionSeq) return; // a newer selection superseded this one
    const msg: MainToUi = {
      type: 'selection', node, fileKey: resolved.fileKey, fileKeySource: resolved.source,
      // figma.root.name is main-thread only, so the file's NAME has to ride
      // this message alongside its key; the UI cannot read it itself.
      fileName: figma.root.name,
      ...(foundation ? { foundation } : {}),
    };
    figma.ui.postMessage(msg);
  } catch {
    // Serialization failed: show the empty state rather than leaving the panel
    // stuck on the previous component with no feedback.
    if (seq !== selectionSeq) return;
    const msg: MainToUi = { type: 'selection', node: null, fileKey: resolved.fileKey, fileKeySource: resolved.source, fileName: figma.root.name };
    figma.ui.postMessage(msg);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
figma.showUI(__html__, { width: 480, height: 680, themeColors: true });

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

// Send stored frame brand theme on startup (default: no overrides). Prefers
// the new 'brandTheme' key; falls back to a one-time migration from the 1.x
// two-color 'brandColors' storage. The old key is left in place (harmless,
// keeps rollback safe).
figma.clientStorage.getAsync('brandTheme').then(async (value: BrandTheme | undefined) => {
  if (value) {
    brandTheme = migrateBrandColors(value);
  } else {
    const legacy = await figma.clientStorage.getAsync('brandColors') as BrandColors | undefined;
    brandTheme = migrateBrandColors(legacy);
    // Persist the migrated theme so this branch runs only once; the legacy
    // key stays untouched for rollback.
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

// React to selection changes.
// Note: selectionchange does not fire on plugin open; the UI sends requestSelection on mount to get the initial selection.
figma.on('selectionchange', () => {
  const selected = figma.currentPage.selection;
  if (programmaticDocSelection.consume(selected.map((node) => node.id))) return;
  void postSelection().catch(() => {/* handled inside */});
});

// Collect a node subtree's TEXT characters in document order (DFS). Used to
// compute the self-hash that detects hand-edits to a generated Section.
function collectText(node: BaseNode): string[] {
  const out: string[] = [];
  const visit = (n: BaseNode): void => {
    if (n.type === 'TEXT') out.push((n as TextNode).characters);
    // Do NOT descend into embedded component instances (variant slots, matrix
    // cells, anatomy preview): their text mirrors the SOURCE component, so
    // including it would make a source-side text change read as a hand-edit to
    // the doc. Only the doc's own generated/editable text should be hashed.
    if (n.type === 'INSTANCE') return;
    if ('children' in n) {
      for (const c of (n as BaseNode & ChildrenMixin).children) visit(c);
    }
  };
  visit(node);
  return out;
}

// The PageNode a node lives on, or null. Walks parents until a PAGE.
function pageOf(node: BaseNode): PageNode | null {
  let cur: BaseNode | null = node;
  while (cur) {
    if (cur.type === 'PAGE') return cur as PageNode;
    cur = (cur as SceneNode).parent ?? null;
  }
  return null;
}

// Read the registry off figma.root.
function readRegistry() {
  return parseRegistry(figma.root.getPluginData(DOC_REGISTRY_KEY));
}
function writeRegistry(r: { v: 1; docIds: string[] }): void {
  figma.root.setPluginData(DOC_REGISTRY_KEY, serializeRegistry(r));
}

// Every foundation doc link currently on canvas, read via the registry. A
// dangling registry id (its Section deleted) is skipped rather than pruned
// here: enumeration elsewhere already owns that cleanup, and this scan's only
// job is to feed mergeFoundationGroupDescriptions.
async function liveFoundationDocLinks(): Promise<FoundationDocLink[]> {
  const links: FoundationDocLink[] = [];
  for (const docId of readRegistry().docIds) {
    let node: BaseNode | null = null;
    try { node = await figma.getNodeByIdAsync(docId); } catch { node = null; }
    if (!node || node.type !== 'SECTION') continue;
    const data = parseDocLink((node as SectionNode).getPluginData(DOC_LINK_KEY));
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
  const reg = readRegistry();
  for (const docId of reg.docIds) {
    try {
      const node = await figma.getNodeByIdAsync(docId);
      if (node && node.type === 'SECTION') {
        const data = parseDocLink((node as SectionNode).getPluginData(DOC_LINK_KEY));
        // Foundation docs have no sourceNodeId and can never match a component
        // lookup; Task 12 gives them their own resolution path.
        if (data && !isFoundationLink(data) && data.sourceNodeId === sourceNodeId) return node as SectionNode;
      }
    } catch { /* dangling id; enumerate task prunes these */ }
  }
  // Legacy adoption fallback: name match on the current page. Only adopt a
  // Section that is NOT already another source's doc — a stamped link for a
  // different sourceNodeId means this is someone else's (or another component's)
  // documentation that merely shares the name, and must not be replaced.
  for (const child of figma.currentPage.children) {
    try {
      if (child.type === 'SECTION' && child.name === sectionName) {
        const data = parseDocLink((child as SectionNode).getPluginData(DOC_LINK_KEY));
        // A foundation-linked section sharing this name is someone else's doc
        // (a foundation doc, not this component's), same as a mismatched
        // sourceNodeId below: must not be adopted. Task 12 gives foundation
        // docs their own resolution path.
        if (!data || (!isFoundationLink(data) && data.sourceNodeId === sourceNodeId)) return child as SectionNode;
      }
    } catch { /* skip unresolved child */ }
  }
  return null;
}

// React to UI messages
// True while a doc-frame build is in progress. The message handler is async and
// re-entrant, and a build mutates shared module state (theme palette, layout
// widths, font families) assumed single-threaded; a second overlapping build
// would corrupt widths/theme or duplicate the doc. One build at a time.
let docFrameRendering = false;
// Same guard as docFrameRendering, for the Foundations tab's multi-unit build:
// a second overlapping renderFoundation would corrupt the shared theme/font
// state in frameKit and could duplicate frames on canvas.
let foundationRendering = false;

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
  const collectionId = unit.scope.target === 'textStyles' ? 'text' : unit.scope.collectionId;
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

    case 'setLicenseKey':
      if (msg.value) {
        await figma.clientStorage.setAsync('licenseKey', msg.value);
        if (msg.instanceId) await figma.clientStorage.setAsync('licenseInstanceId', msg.instanceId);
        else await figma.clientStorage.deleteAsync('licenseInstanceId');
      } else {
        await figma.clientStorage.deleteAsync('licenseKey');
        await figma.clientStorage.deleteAsync('licenseInstanceId');
      }
      break;

    case 'setAiEnabled':
      await figma.clientStorage.setAsync('aiEnabled', msg.value);
      break;

    case 'setBrandTheme':
      brandTheme = msg.value;
      await figma.clientStorage.setAsync('brandTheme', brandTheme);
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
          figma.ui.postMessage({ type: 'logoError', message: 'Select a frame or component to use as logo' } as MainToUi);
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
          figma.ui.postMessage({ type: 'logoError', message: 'That image is too big. Pick a smaller node.' } as MainToUi);
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
      if (docFrameRendering) {
        // Same rule as the two foundation paths below: reply, never drop. The
        // shared UI lock should stop this from being reached at all, but a
        // guard that notifies and returns nothing leaves the UI holding a
        // button it disabled for a build that will never report back.
        // docFrameError is the failure reply this send site already handles.
        const message = 'Still finishing the previous frame.';
        figma.notify(message);
        figma.ui.postMessage({ type: 'docFrameError', message } as MainToUi);
        break;
      }
      docFrameRendering = true;
      let section: SectionNode | null = null;
      let committed = false; // true once the old doc has been replaced by the new one
      try {
        const sectionName = `${msg.model.componentName}: Documentation`;
        const existing = await findExistingDoc(msg.nodeId, sectionName);
        // Capture the id now: after existing.remove() below, reading any
        // property of a removed node (except `removed`) throws, and this id is
        // needed post-commit to prune the old doc from the registry.
        const existingId = existing ? existing.id : null;

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

        section = await buildDocFrames(msg.model, resolveTheme(brandTheme), brandLogo);

        // Stamp the durable link BEFORE removing the old one, so a failure
        // mid-way never leaves an unstamped orphan replacing a good doc.
        const data: DocLinkData = {
          v: 1,
          sourceNodeId: msg.nodeId,
          contentHash: msg.contentHash,
          selfHash: textContentHash(collectText(section)),
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
        if (existingId && existingId !== section.id) reg = { v: 1, docIds: reg.docIds.filter((id) => id !== existingId) };
        reg = addDoc(reg, section.id);
        writeRegistry(reg);

        // Cosmetic tail: a focus/zoom hiccup must never fail a placed doc.
        try {
          programmaticDocSelection.expect(section.id);
          figma.currentPage.selection = [section];
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
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'docFrameError', message } as MainToUi);
      } finally {
        docFrameRendering = false;
      }
      break;
    }

    case 'requestLibrary': {
      const reg = readRegistry();
      const entries: LibraryEntry[] = [];
      const alive = new Set<string>();
      // Foundation drift needs one live extraction to answer every foundation
      // row, unlike component docs, which the UI checks one at a time via
      // requestDrift. Lazy so a file with only component docs pays nothing.
      // Caches both the success and the failure so it runs at most once here.
      let foundationSpec: FoundationSpec | null = null;
      let foundationExtractionFailed = false;
      const liveFoundation = async (): Promise<FoundationSpec | null> => {
        if (foundationSpec || foundationExtractionFailed) return foundationSpec;
        try {
          const { fileKey } = resolveFileKey(figma.fileKey, null);
          const dump = await serializeFoundation(
            foundationReader, fileKey, new Date().toISOString(), figma.root.name,
          );
          foundationSpec = buildFoundation(dump);
        } catch {
          foundationExtractionFailed = true;
        }
        return foundationSpec;
      };
      for (const docId of reg.docIds) {
        let node: BaseNode | null = null;
        try { node = await figma.getNodeByIdAsync(docId); } catch { node = null; }
        if (!node || node.type !== 'SECTION') continue; // pruned below
        const section = node as SectionNode;
        const data = parseDocLink(section.getPluginData(DOC_LINK_KEY));
        if (!data) continue; // detached/foreign section still in the index → prune
        // Mark alive before branching on kind, so the self-heal prune below
        // never drops a valid doc's registry id regardless of which branch
        // below builds its LibraryEntry.
        alive.add(docId);
        const selfEdited = textContentHash(collectText(section)) !== data.selfHash;
        const page = pageOf(section);

        if (isFoundationLink(data)) {
          const title = section.name.replace(/^Foundations: /, '');
          const live = await liveFoundation();
          // A renamed collection still resolves by name: retarget the scope to
          // its current id before hashing, so a re-created collection reads as
          // "Update available" (true: the frame's rendered title changed) and
          // not "Source missing" (false: the collection is still there).
          // retargetScope only does this on an unambiguous single name match;
          // if several live collections share the name it leaves the dead id in
          // place, and the row reads as orphaned rather than silently binding
          // to a collection that may have nothing to do with this doc.
          const scope = live ? retargetScope(data.scope, live.collections) : data.scope;
          const currentContentHash = live ? foundationContentHash(live, scope) : undefined;
          // A scope that no longer resolves is orphaned. unitContent returns
          // null for a deleted collection, and foundationContentHash turns that
          // into a stable sentinel, so compare against unitContent directly
          // rather than re-deriving the sentinel here. When extraction failed
          // outright, give the doc the benefit of the doubt rather than
          // reporting it missing on no evidence.
          const sourceExists = live ? unitContent(live, scope) !== null : true;
          entries.push({
            docId,
            kind: 'foundation',
            label: `Foundations · ${title}`,
            componentName: `Foundations · ${title}`,
            pageName: page?.name ?? '',
            sourceLabel: data.scope.target === 'collection'
              ? data.scope.collectionName
              : 'Text styles',
            generatedAt: data.generatedAt,
            sourceNodeId: '',
            sourceExists,
            selfEdited,
            storedContentHash: data.contentHash,
            currentContentHash,
            // Read from the retargeted scope, so a renamed collection keeps the
            // icon its variables earn rather than falling back to `mixed`.
            foundationIcon: scopeIconKind(live, scope),
            // The RETARGETED scope, matching foundationIcon above: a renamed
            // collection resolves to its live id, which is the id Copy has to
            // match against the foundation dump the UI holds.
            foundationScope: scope,
          });
          continue;
        }

        let sourceNode: BaseNode | null = null;
        try { sourceNode = await figma.getNodeByIdAsync(data.sourceNodeId); } catch { sourceNode = null; }
        const sourceExists = sourceNode != null;
        const sourcePage = sourceNode ? pageOf(sourceNode) : null;
        const name = section.name.replace(/: Documentation$/, '');
        entries.push({
          docId,
          kind: 'component',
          label: name,
          componentName: name,
          pageName: page?.name ?? '',
          // The source's page, and only that. This used to concatenate the doc
          // name onto it, which made every consumer render the name twice — once
          // as the row title, once inside its own subtitle ("buttonText" over
          // "Components · buttonText"). A locator is only worth showing when it
          // says something the title doesn't. Falls back to the name when the
          // source node is gone and there's no page left to point at.
          sourceLabel: sourcePage?.name || name,
          generatedAt: data.generatedAt,
          sourceNodeId: data.sourceNodeId,
          sourceExists,
          selfEdited,
          storedContentHash: data.contentHash,
          extractorVersion: data.extractorVersion,
        });
      }
      // Self-heal: keep only ids that resolved to a real, still-linked doc.
      const pruned = pruneRegistry(reg, alive);
      if (pruned.docIds.length !== reg.docIds.length) writeRegistry(pruned);
      figma.ui.postMessage({ type: 'library', entries } as MainToUi);
      break;
    }

    case 'requestFoundation': {
      try {
        const { fileKey } = resolveFileKey(figma.fileKey, null);
        const dump = await serializeFoundation(
          foundationReader, fileKey, new Date().toISOString(), figma.root.name,
        );
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
        figma.ui.postMessage({ type: 'foundation', dump, groupDescriptions } as MainToUi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'foundationError', message } as MainToUi);
      }
      break;
    }

    case 'renderFoundation': {
      if (foundationRendering) {
        // Post the rejection back, don't just notify. The UI holds a lock from
        // the moment it sends, and a request that gets no reply is a lock
        // nobody ever releases: the Foundations tab's Create button stayed
        // disabled for the rest of the session.
        const message = 'Another build is still finishing.';
        figma.notify(message);
        figma.ui.postMessage({ type: 'foundationFrameError', message, created: 0 } as MainToUi);
        break;
      }
      foundationRendering = true;
      // Declared outside the try so the catch block can report how many frames
      // actually landed on the canvas before the failure (Finding 2: frames are
      // appended one at a time and are never rolled back).
      let created = 0;
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
      try {
        // Re-extract rather than trusting the UI's dump: the Foundations tab
        // fetches its data once per session and never refreshes, so the file
        // may have changed by the time the user clicks Create. Re-extracting
        // here keeps the generated frames faithful to the file as it is now.
        const { fileKey } = resolveFileKey(figma.fileKey, null);
        const dump = await serializeFoundation(
          foundationReader, fileKey, new Date().toISOString(), figma.root.name,
        );
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
        for (const docId of readRegistry().docIds) {
          let existingNode: BaseNode | null = null;
          try { existingNode = await figma.getNodeByIdAsync(docId); } catch { existingNode = null; }
          if (!existingNode || existingNode.type !== 'SECTION') continue;
          const link = parseDocLink((existingNode as SectionNode).getPluginData(DOC_LINK_KEY));
          if (link && isFoundationLink(link)) {
            existingByScope.set(foundationScopeKey(link.scope), existingNode as SectionNode);
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

          // The UI sends one map for the whole build, keyed collectionId|folder
          // because two collections can hold a folder of the same name. Each doc
          // stores only its own, keyed by plain folder.
          const descriptions = descriptionsForUnit(msg.groupDescriptions, unit, content);

          const section = await buildFoundationFrame(
            content, unit, resolveTheme(brandTheme),
            msg.config.includeDescriptions, brandLogo, descriptions,
            msg.config.includeContrast, contrastReport,
          );

          const data: FoundationDocLink = {
            v: 1,
            kind: 'foundation',
            scope: unit.scope,
            contentHash: foundationContentHash(spec, unit.scope),
            selfHash: '',   // set below, once the section's text exists
            config: msg.config,
            ...(descriptions ? { groupDescriptions: descriptions } : {}),
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
          data.selfHash = textContentHash(collectText(section));
          section.setPluginData(DOC_LINK_KEY, serializeDocLink(data));

          if (prior) {
            // Compute the registry with the prior id dropped, but don't write
            // it until prior.remove() actually succeeds — same ordering as
            // updateFoundationDoc below. Writing the drop first (as before)
            // meant a throw from remove() left the registry no longer
            // tracking a Section that was still physically on the canvas: an
            // untracked duplicate, invisible to My Library and the self-heal
            // prune.
            const reg: DocRegistry = { v: 1, docIds: readRegistry().docIds.filter((id) => id !== prior.id) };
            prior.remove();
            writeRegistry(addDoc(reg, section.id));
            replaced++;
          } else {
            writeRegistry(addDoc(readRegistry(), section.id));
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
        foundationRendering = false;
      }
      break;
    }

    case 'updateFoundationDoc': {
      // Shares renderFoundation's guard: both call buildFoundationFrame, which
      // mutates frameKit's shared theme/font module state, so the two must
      // never run concurrently any more than two renderFoundation calls could.
      if (foundationRendering) {
        // Same rule as renderFoundation above: reply, never drop. docSourceError
        // is the failure reply this send site already handles, so the row's
        // Update releases its lock instead of wedging the button it disabled.
        const message = 'Another build is still finishing.';
        figma.notify(message);
        figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message } as MainToUi);
        break;
      }
      foundationRendering = true;
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
            message: 'This doc is no longer linked.' } as MainToUi);
          break;
        }

        const { fileKey } = resolveFileKey(figma.fileKey, null);
        const dump = await serializeFoundation(
          foundationReader, fileKey, new Date().toISOString(), figma.root.name,
        );
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
              ? 'This foundation doc could no longer be rebuilt. Its collection is gone from this file.'
              : `This foundation doc could no longer be rebuilt. Nothing in this file is named "${scope.group}" any more.` } as MainToUi);
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
        );

        const data: FoundationDocLink = {
          v: 1, kind: 'foundation', scope,
          contentHash: foundationContentHash(spec, scope),
          selfHash: '',
          config: link.config,
          ...(link.groupDescriptions ? { groupDescriptions: link.groupDescriptions } : {}),
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

        data.selfHash = textContentHash(collectText(section));
        section.setPluginData(DOC_LINK_KEY, serializeDocLink(data));

        // Point of no return, matching the component path (renderDocFrame
        // above): the new section is stamped and placed before the old one
        // goes, so a failure here never leaves the user having lost a good doc.
        let reg = readRegistry();
        reg = { v: 1, docIds: reg.docIds.filter((id) => id !== prior.id) };
        prior.remove();
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
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message } as MainToUi);
      } finally {
        foundationRendering = false;
      }
      break;
    }

    case 'focusNode': {
      try {
        const node = await figma.getNodeByIdAsync(msg.nodeId);
        if (!node) { figma.notify('That item no longer exists'); break; }
        const page = pageOf(node);
        if (page && page.id !== figma.currentPage.id) await figma.setCurrentPageAsync(page);
        if ('x' in node) {
          const sn = node as SceneNode;
          figma.currentPage.selection = [sn];
          figma.viewport.scrollAndZoomIntoView([sn]);
        }
      } catch { figma.notify("Couldn't open that item"); }
      break;
    }

    case 'detachDoc': {
      try {
        const node = await figma.getNodeByIdAsync(msg.docId);
        if (node && node.type === 'SECTION') (node as SectionNode).setPluginData(DOC_LINK_KEY, '');
      } catch { /* gone already */ }
      writeRegistry({ v: 1, docIds: readRegistry().docIds.filter((id) => id !== msg.docId) });
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
      writeRegistry({ v: 1, docIds: readRegistry().docIds.filter((id) => id !== msg.docId) });
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
          figma.ui.postMessage({ type: 'driftError', docId: msg.docId } as MainToUi);
          break;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const node = await serializeNode(src as any, resolver);
        const { fileKey } = resolveFileKey(figma.fileKey, null);
        figma.ui.postMessage({ type: 'driftSource', docId: msg.docId, node, fileKey, fileName: figma.root.name } as MainToUi);
      } catch {
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
        prose: section ? parseProse(section.getPluginData(DOC_PROSE_KEY)) : null,
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
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message: 'This doc is no longer linked.' } as MainToUi);
          break;
        }
        // Foundation docs have no sourceNodeId to rebuild from here; Task 12
        // gives them their own source-resolution path. The equivalent of an
        // early `continue` for this non-loop site: bail with the same
        // "no longer linked" message rather than reading a field that doesn't exist.
        if (isFoundationLink(data)) {
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message: 'This doc is no longer linked.' } as MainToUi);
          break;
        }
        const src = await figma.getNodeByIdAsync(data.sourceNodeId);
        if (!src || (src.type !== 'COMPONENT' && src.type !== 'COMPONENT_SET')) {
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message: 'The source component is gone, so this doc can no longer be rebuilt.' } as MainToUi);
          break;
        }
        const selfEdited = textContentHash(collectText(section)) !== data.selfHash;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const node = await serializeNode(src as any, resolver);
        const { fileKey } = resolveFileKey(figma.fileKey, null);
        figma.ui.postMessage({ type: 'docSource', docId: msg.docId, node, fileKey, fileName: figma.root.name, config: data.config, selfEdited, intent: msg.intent } as MainToUi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message } as MainToUi);
      }
      break;
    }
  }
};
