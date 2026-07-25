/// <reference types="@figma/plugin-typings" />
import { serializeNode, mainComponentRef } from './serialize';
import type { NodeResolver } from './serialize';
import type { MainToUi, UiToMain, LibraryEntry } from './messages';
import { resolveFileKey } from './fileKey';
import { serializeFoundation, type FoundationReader } from './serializeFoundation';
import { buildDocFrames } from './docFrame';
import { emptyBrandTheme, resolveTheme, migrateBrandColors, type BrandTheme, type BrandColors } from './brandColors';
import { familiesWithRequiredStyles } from './fonts';
import {
  DOC_LINK_KEY, DOC_REGISTRY_KEY,
  parseDocLink, serializeDocLink, parseRegistry, serializeRegistry, addDoc, pruneRegistry,
  textContentHash, type DocLinkData,
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
const resolver: NodeResolver = {
  async variableName(id) {
    try {
      const v = await figma.variables.getVariableByIdAsync(id);
      return v?.name ?? null;
    } catch {
      return null;
    }
  },
  async styleName(id) {
    try {
      const s = await figma.getStyleByIdAsync(id);
      return s?.name ?? null;
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
const foundationReader: FoundationReader = {
  async collections() {
    const colls = await figma.variables.getLocalVariableCollectionsAsync();
    return colls.map((c) => ({
      id: c.id,
      name: c.name,
      modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
      defaultModeId: c.defaultModeId,
      variableIds: c.variableIds,
    }));
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
    };
  },
  async textStyles() {
    const styles = await figma.getLocalTextStylesAsync();
    return styles.map((s) => ({
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
    }));
  },
  async collectionName(id) {
    const c = await figma.variables.getVariableCollectionByIdAsync(id);
    return c?.name ?? null;
  },
};

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
    const msg: MainToUi = { type: 'selection', node: null, fileKey: resolved.fileKey, fileKeySource: resolved.source };
    figma.ui.postMessage(msg);
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node = await serializeNode(component as any, resolver);
    if (seq !== selectionSeq) return; // a newer selection superseded this one
    const msg: MainToUi = { type: 'selection', node, fileKey: resolved.fileKey, fileKeySource: resolved.source };
    figma.ui.postMessage(msg);
  } catch {
    // Serialization failed: show the empty state rather than leaving the panel
    // stuck on the previous component with no feedback.
    if (seq !== selectionSeq) return;
    const msg: MainToUi = { type: 'selection', node: null, fileKey: resolved.fileKey, fileKeySource: resolved.source };
    figma.ui.postMessage(msg);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
figma.showUI(__html__, { width: 480, height: 640, themeColors: true });

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

// React to selection changes.
// Note: selectionchange does not fire on plugin open; the UI sends requestSelection on mount to get the initial selection.
figma.on('selectionchange', () => { void postSelection().catch(() => {/* handled inside */}); });

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
        if (data && data.sourceNodeId === sourceNodeId) return node as SectionNode;
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
        if (!data || data.sourceNodeId === sourceNodeId) return child as SectionNode;
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
          figma.ui.postMessage({ type: 'logoError', message: 'Logo image is too large — pick a smaller node' } as MainToUi);
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
        figma.ui.postMessage({ type: 'componentImage', base64, mediaType: 'image/png' } as MainToUi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'componentImageError', message } as MainToUi);
      }
      break;
    }

    case 'notify':
      figma.notify(msg.message);
      break;

    case 'openBrowser':
      figma.openExternal(msg.url);
      break;

    case 'renderDocFrame': {
      if (docFrameRendering) { figma.notify('Still finishing the previous frame'); break; }
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
        };
        section.setPluginData(DOC_LINK_KEY, serializeDocLink(data));

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
          figma.currentPage.selection = [section];
          figma.viewport.scrollAndZoomIntoView([section]);
        } catch { /* selection/zoom is non-essential */ }

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
      for (const docId of reg.docIds) {
        let node: BaseNode | null = null;
        try { node = await figma.getNodeByIdAsync(docId); } catch { node = null; }
        if (!node || node.type !== 'SECTION') continue; // pruned below
        const section = node as SectionNode;
        const data = parseDocLink(section.getPluginData(DOC_LINK_KEY));
        if (!data) continue; // detached/foreign section still in the index → prune
        alive.add(docId);

        let sourceExists = false;
        try { sourceExists = (await figma.getNodeByIdAsync(data.sourceNodeId)) != null; } catch { sourceExists = false; }
        const selfEdited = textContentHash(collectText(section)) !== data.selfHash;
        const page = pageOf(section);

        entries.push({
          docId,
          componentName: section.name.replace(/: Documentation$/, ''),
          pageName: page?.name ?? '',
          sourceNodeId: data.sourceNodeId,
          sourceExists,
          selfEdited,
          storedContentHash: data.contentHash,
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
          foundationReader, fileKey, new Date().toISOString(),
        );
        figma.ui.postMessage({ type: 'foundation', dump } as MainToUi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'foundationError', message } as MainToUi);
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
      figma.ui.postMessage({ type: 'docDetached', docId: msg.docId } as MainToUi);
      break;
    }

    case 'removeDoc': {
      try {
        const node = await figma.getNodeByIdAsync(msg.docId);
        if (node) node.remove();
      } catch { /* gone already */ }
      writeRegistry({ v: 1, docIds: readRegistry().docIds.filter((id) => id !== msg.docId) });
      figma.ui.postMessage({ type: 'docRemoved', docId: msg.docId } as MainToUi);
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
        figma.ui.postMessage({ type: 'driftSource', docId: msg.docId, node, fileKey } as MainToUi);
      } catch {
        figma.ui.postMessage({ type: 'driftError', docId: msg.docId } as MainToUi);
      }
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
        const src = await figma.getNodeByIdAsync(data.sourceNodeId);
        if (!src || (src.type !== 'COMPONENT' && src.type !== 'COMPONENT_SET')) {
          figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message: 'The source component is gone, so this doc can no longer be rebuilt.' } as MainToUi);
          break;
        }
        const selfEdited = textContentHash(collectText(section)) !== data.selfHash;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const node = await serializeNode(src as any, resolver);
        const { fileKey } = resolveFileKey(figma.fileKey, null);
        figma.ui.postMessage({ type: 'docSource', docId: msg.docId, node, fileKey, config: data.config, selfEdited, intent: msg.intent } as MainToUi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'docSourceError', docId: msg.docId, message } as MainToUi);
      }
      break;
    }
  }
};
