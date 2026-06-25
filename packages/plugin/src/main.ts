/// <reference types="@figma/plugin-typings" />
import { serializeNode, mainComponentRef } from './serialize';
import type { NodeResolver } from './serialize';
import type { MainToUi, UiToMain } from './messages';
import { resolveFileKey } from './fileKey';
import { buildDocFrame } from './docFrame';

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
        // Find any prior frame with this title BEFORE creating the new one.
        // figma.createFrame() auto-appends to the current page, so searching
        // after buildDocFrame would match (and then remove) our own new frame.
        const existing = figma.currentPage.findOne(
          n => n.type === 'FRAME' && n.name === msg.model.title,
        ) as FrameNode | null;

        // Decide placement up front. Reuse the old frame's position if present;
        // otherwise sit 80px to the right of the source component. The component
        // lookup is best-effort: a stale/removed id must not abort frame creation.
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

        const frame = await buildDocFrame(msg.model);
        if (existing) existing.remove();
        figma.currentPage.appendChild(frame);
        frame.x = x; frame.y = y;
        figma.currentPage.selection = [frame];
        figma.viewport.scrollAndZoomIntoView([frame]);
        figma.ui.postMessage({ type: 'docFrameDone', frameName: frame.name } as MainToUi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        figma.ui.postMessage({ type: 'docFrameError', message } as MainToUi);
      }
      break;
    }
  }
};
