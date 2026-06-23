/// <reference types="@figma/plugin-typings" />
import { serializeNode, mainComponentRef } from './serialize';
import type { NodeResolver } from './serialize';
import type { MainToUi, UiToMain } from './messages';
import { resolveFileKey } from './fileKey';
import { collectExportPlan } from './collectComponents';
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
// File key override — set by the UI when figma.fileKey is unavailable (dev
// plugins) or when the user explicitly wants to attach a specific Figma file.
// The main thread is the single source of truth for the effective file key;
// the UI only displays/uses what it receives.
let fileKeyOverride: string | null = null;

// Resolves once the stored override has been loaded, so postSelection never
// races ahead of clientStorage on boot.
const fileKeyOverrideReady: Promise<void> = figma.clientStorage
  .getAsync('fileKeyOverride')
  .then((value: string | undefined) => {
    fileKeyOverride = value ?? null;
  })
  .catch(() => {/* ignore */});

function postFileKeyOverride(): void {
  const resolved = resolveFileKey(figma.fileKey, fileKeyOverride);
  const msg: MainToUi = {
    type: 'fileKeyOverride',
    value: fileKeyOverride,
    effectiveFileKey: resolved.fileKey,
    fileKeySource: resolved.source,
  };
  figma.ui.postMessage(msg);
}

async function postSelection(): Promise<void> {
  await fileKeyOverrideReady;
  const resolved = resolveFileKey(figma.fileKey, fileKeyOverride);
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
// Enumerate every component in the file (all pages) and return deduplicated
// export targets. Requires documentAccess: "dynamic-page" in manifest.json
// so that findAllWithCriteria is allowed across pages.
// ---------------------------------------------------------------------------
async function collectAllComponents(includeAtoms: boolean) {
  // Load all pages before scanning — required under dynamic-page access mode.
  await figma.loadAllPagesAsync();
  const found = figma.root.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] });
  const candidates = found.map(n => ({
    id: n.id,
    name: n.name,
    type: n.type,
    parentType: n.parent?.type ?? null,
  }));
  return collectExportPlan(candidates, { includeAtoms });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
figma.showUI(__html__, { width: 480, height: 640, themeColors: true });

// Send stored docs endpoint on startup
figma.clientStorage.getAsync('docsEndpoint').then((value: string | undefined) => {
  const msg: MainToUi = { type: 'docsEndpoint', value: value ?? null };
  figma.ui.postMessage(msg);
}).catch(() => {/* ignore */});

// Send stored Anthropic API key on startup
figma.clientStorage.getAsync('anthropicKey').then((value: string | undefined) => {
  const msg: MainToUi = { type: 'anthropicKey', value: value ?? null };
  figma.ui.postMessage(msg);
}).catch(() => {/* ignore */});

// Send stored Figma file key override (and the effective file key computed
// from it) on startup; the UI uses it for the input and display only.
fileKeyOverrideReady.then(() => { postFileKeyOverride(); });

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

    case 'setDocsEndpoint':
      await figma.clientStorage.setAsync('docsEndpoint', msg.value);
      break;

    case 'setAnthropicKey':
      await figma.clientStorage.setAsync('anthropicKey', msg.value);
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

    case 'setFileKeyOverride':
      // Wait for the boot-time load so it cannot clobber a user-set value.
      await fileKeyOverrideReady;
      fileKeyOverride = msg.value && msg.value !== '' ? msg.value : null;
      await figma.clientStorage.setAsync('fileKeyOverride', fileKeyOverride);
      // Echo back the new effective key — the UI never derives it itself.
      postFileKeyOverride();
      break;

    case 'notify':
      figma.notify(msg.message);
      break;

    case 'openBrowser':
      figma.openExternal(msg.url);
      break;

    case 'requestExportAll': {
      // Stream every component in the file to the UI one at a time.
      // Sequential await (not Promise.all) is intentional: it keeps each
      // postMessage payload small, gives ordered progress to the UI, and
      // avoids large memory spikes from parallelising many serializations.
      try {
        // Signal the (potentially long) enumeration phase BEFORE doing it, so
        // the UI isn't silent while loadAllPagesAsync + findAllWithCriteria run.
        // A Figma toast also shows even while the editor is busy.
        figma.ui.postMessage({ type: 'exportAllScanning' } as MainToUi);
        figma.notify('Scanning file for components…');
        const t0 = Date.now();
        console.log('[export-all] scanning: loadAllPagesAsync + findAllWithCriteria…');

        // Honor the file key override before reading it, matching postSelection.
        await fileKeyOverrideReady;
        const fileKey = resolveFileKey(figma.fileKey, fileKeyOverride).fileKey;

        const plan = await collectAllComponents(msg.includeAtoms);
        const targets = plan.targets;
        const total = targets.length;
        console.log(`[export-all] found ${total} component(s) in ${Date.now() - t0}ms`);

        const startMsg: MainToUi = {
          type: 'exportAllStart',
          total,
          fileKey,
          skippedAtoms: plan.skippedAtoms,
        };
        figma.ui.postMessage(startMsg);

        let serialized = 0;
        let skipped = 0;
        const tSerialize = Date.now();
        for (let i = 0; i < targets.length; i++) {
          const target = targets[i];
          try {
            const rawNode = await figma.getNodeByIdAsync(target.id);
            if (!rawNode) { skipped++; continue; } // deleted between enumeration and fetch

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const node = await serializeNode(rawNode as any, resolver);
            // index is 1-based (1 … total) so the UI can display "1 of N"
            const compMsg: MainToUi = { type: 'exportComponent', index: i + 1, total, node };
            figma.ui.postMessage(compMsg);
            serialized++;
          } catch (compErr) {
            // One bad component must not abort the whole export.
            skipped++;
            const m = compErr instanceof Error ? compErr.message : String(compErr);
            console.warn(`[export-all] skipped "${target.name}" (${target.id}): ${m}`);
          }

          // Yield to the main thread every 20 components so the Figma editor
          // can repaint and stay responsive during a large export.
          if (i % 20 === 19) await new Promise((r) => setTimeout(r, 0));
        }
        console.log(
          `[export-all] serialized ${serialized}, skipped ${skipped} in ${Date.now() - tSerialize}ms`,
        );

        const doneMsg: MainToUi = { type: 'exportAllDone' };
        figma.ui.postMessage(doneMsg);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[export-all] failed:', message);
        const errMsg: MainToUi = { type: 'exportAllError', message };
        figma.ui.postMessage(errMsg);
      }
      break;
    }

    case 'renderDocFrame': {
      try {
        const frame = await buildDocFrame(msg.model);
        // Replace an existing frame with the same name on the current page.
        const existing = figma.currentPage.findOne(
          n => n.type === 'FRAME' && n.name === msg.model.title,
        ) as FrameNode | null;
        let x = 0, y = 0;
        if (existing) {
          x = existing.x; y = existing.y;
          existing.remove();
        } else {
          // Re-resolve the component by id (selection may have changed since extract).
          const comp = await figma.getNodeByIdAsync(msg.nodeId);
          if (comp && 'x' in comp && 'width' in comp) {
            const c = comp as SceneNode & { x: number; y: number; width: number };
            x = c.x + c.width + 80; y = c.y;
          }
        }
        frame.x = x; frame.y = y;
        figma.currentPage.appendChild(frame);
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
