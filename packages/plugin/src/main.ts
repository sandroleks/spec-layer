/// <reference types="@figma/plugin-typings" />
import { serializeNode, mainComponentRef } from './serialize';
import type { NodeResolver } from './serialize';
import type { MainToUi, UiToMain } from './messages';
import { resolveFileKey } from './fileKey';
import { buildDocFrames } from './docFrame';
import { emptyBrandTheme, resolveTheme, migrateBrandColors, type BrandTheme, type BrandColors } from './brandColors';

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

async function postSelection(): Promise<void> {
  const resolved = resolveFileKey(figma.fileKey, null);
  const component = findComponent(figma.currentPage.selection);

  if (!component) {
    figma.notify('Select a component or component set');
    const msg: MainToUi = { type: 'selection', node: null, fileKey: resolved.fileKey, fileKeySource: resolved.source };
    figma.ui.postMessage(msg);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const node = await serializeNode(component as any, resolver);
  const msg: MainToUi = { type: 'selection', node, fileKey: resolved.fileKey, fileKeySource: resolved.source };
  figma.ui.postMessage(msg);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
figma.showUI(__html__, { width: 480, height: 640, themeColors: true });

// Send stored Anthropic API key on startup
figma.clientStorage.getAsync('anthropicKey').then((value: string | undefined) => {
  const msg: MainToUi = { type: 'anthropicKey', value: value ?? null };
  figma.ui.postMessage(msg);
}).catch(() => {/* ignore */});

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
figma.on('selectionchange', () => { postSelection(); });

// React to UI messages
figma.ui.onmessage = async (raw: unknown) => {
  const msg = raw as UiToMain;
  switch (msg.type) {
    case 'requestSelection':
      await postSelection();
      break;

    case 'setAnthropicKey':
      await figma.clientStorage.setAsync('anthropicKey', msg.value);
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
        const families = [...new Set(fonts.map((f) => f.fontName.family))].sort();
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
      try {
        const sectionName = `${msg.model.componentName}: Documentation`;

        // Find any prior doc Section with this name BEFORE creating the new one.
        // Scan only top-level children (a deep find can hit node types the
        // API can't resolve); the per-node try/catch keeps one bad child from aborting.
        let existing: SectionNode | null = null;
        for (const child of figma.currentPage.children) {
          try {
            if (child.type === 'SECTION' && child.name === sectionName) {
              existing = child;
              break;
            }
          } catch {
            /* skip a child whose type can't be resolved by this API version */
          }
        }

        let x = 0, y = 0;
        if (existing) {
          x = existing.x; y = existing.y;
        } else {
          try {
            const comp = await figma.getNodeByIdAsync(msg.nodeId);
            if (comp && 'x' in comp && 'width' in comp) {
              const c = comp as SceneNode & { x: number; y: number; width: number };
              x = c.x + c.width + 80; y = c.y;
            }
          } catch {
            /* node gone since extract — fall back to origin */
          }
        }

        const section = await buildDocFrames(msg.model, resolveTheme(brandTheme), brandLogo);
        if (existing) existing.remove();
        figma.currentPage.appendChild(section);
        section.x = x; section.y = y;
        figma.currentPage.selection = [section];
        figma.viewport.scrollAndZoomIntoView([section]);
        figma.ui.postMessage({ type: 'docFrameDone', frameName: section.name } as MainToUi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'docFrameError', message } as MainToUi);
      }
      break;
    }
  }
};
