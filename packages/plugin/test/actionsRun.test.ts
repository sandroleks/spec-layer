/**
 * actionsRun.test.ts — the My Library run* handlers.
 *
 * These orchestrate extract → optional prose → buildDocModel → send/download.
 * The view layer (banners, loader) and the AI call are mocked so the tests
 * assert on the orchestration itself: what reaches `send`, when prose is
 * skipped, and that a throw anywhere degrades to a banner rather than escaping.
 *
 * Kept separate from actions.test.ts because these need module mocks that the
 * pure-function tests there deliberately do without.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SerializedNode } from '@spec-layer/extractor';
import type { DocConfig } from '../src/docLink';

// --- mocks (must be declared before importing the module under test) -------

vi.mock('../src/ui/render', () => ({
  showBanner: vi.fn(),
  clearBanners: vi.fn(),
  renderPhase: vi.fn(),
  startLoader: vi.fn(),
  stopLoader: vi.fn(),
}));

vi.mock('../src/ui/ai', () => ({
  generateProse: vi.fn(),
}));

import {
  createState,
  ensureExtracted,
  renderOne,
  runUpdateFromSource,
  setAiEnabled,
  setBrandTheme,
  type UiState,
} from '../src/ui/actions';
import { showBanner, clearBanners, startLoader, stopLoader } from '../src/ui/render';
import { generateProse } from '../src/ui/ai';
import type { Refs } from '../src/ui/dom';

// --- fixtures --------------------------------------------------------------

/** A minimal component set: one variant, one bound fill, one text child. */
function buttonNode(): SerializedNode {
  return {
    id: '1:1',
    name: 'Button',
    type: 'COMPONENT_SET',
    visible: true,
    key: 'component-key',
    propertyDefinitions: {
      Type: { type: 'VARIANT', defaultValue: 'Primary', variantOptions: ['Primary', 'Secondary'] },
    },
    children: [
      {
        id: '1:2',
        name: 'Type=Primary',
        type: 'COMPONENT',
        visible: true,
        layout: { mode: 'HORIZONTAL', paddingLeft: 16, paddingRight: 16, itemSpacing: 8 },
        bindings: [{ property: 'fills', token: 'color/bg/brand' }],
        children: [
          { id: '1:3', name: 'Label', type: 'TEXT', visible: true },
        ],
      },
    ],
  };
}

function docConfig(over: Partial<DocConfig> = {}): DocConfig {
  return {
    sections: ['configuration', 'tokens'],
    variantIds: [],
    aiEnabled: false,
    anatomyView: 'diagram',
    measureViews: ['size'],
    ...over,
  };
}

function source(over: Partial<{ config: DocConfig }> = {}) {
  return { docId: 'doc-1', node: buttonNode(), fileKey: 'FILE1', config: docConfig(), ...over };
}

/** Refs is a large DOM surface; these handlers only touch it through the
 *  mocked render helpers, so a permissive stub is enough. */
function refsStub(): Refs {
  return new Proxy({}, {
    get: () => ({ disabled: false, className: '', textContent: '', checked: false }),
  }) as unknown as Refs;
}

let sent: unknown[];
// Patch URL's two object-URL methods onto the real URL rather than replacing
// the global: vitest itself constructs URLs, so swapping the class out leaves
// the worker unable to shut down.
const g = globalThis as Record<string, unknown>;
const realURL = g.URL as { createObjectURL?: unknown; revokeObjectURL?: unknown };
const hadDocument = 'document' in g;

beforeEach(() => {
  sent = [];
  vi.clearAllMocks();
  vi.stubGlobal('parent', {
    postMessage: (m: { pluginMessage: unknown }) => { sent.push(m.pluginMessage); },
  });
  realURL.createObjectURL = () => 'blob:x';
  realURL.revokeObjectURL = () => {};
  g.document = {
    createElement: () => ({ href: '', download: '', click: () => {} }),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete realURL.createObjectURL;
  delete realURL.revokeObjectURL;
  if (!hadDocument) delete g.document;
});

// ---------------------------------------------------------------------------
// renderOne / ensureExtracted
// ---------------------------------------------------------------------------

describe('renderOne', () => {
  it('extracts and renders in one pass, stamping the extraction time', () => {
    const out = renderOne(buttonNode(), 'FILE1');
    expect(out.name).toBe('Button');
    expect(out.spec.figmaFile).toBe('FILE1');
    expect(Number.isNaN(Date.parse(out.extractedAt))).toBe(false);
  });
});

describe('ensureExtracted', () => {
  it('extracts on demand when no spec is cached yet', () => {
    const state = createState();
    state.currentNode = buttonNode();
    state.currentFileKey = 'FILE1';
    expect(ensureExtracted(state)).toBe(true);
    expect(state.currentSpec?.name).toBe('Button');
  });

  it('reuses an existing spec instead of re-extracting', () => {
    const state = createState();
    state.currentNode = buttonNode();
    state.currentSpec = { name: 'Cached' } as unknown as UiState['currentSpec'];
    expect(ensureExtracted(state)).toBe(true);
    expect(state.currentSpec?.name).toBe('Cached');
  });

  it('reports failure when nothing is selected', () => {
    expect(ensureExtracted(createState())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Simple setters
// ---------------------------------------------------------------------------

describe('preference setters', () => {
  it('setAiEnabled updates state and tells main', () => {
    const state = createState();
    setAiEnabled(state, true);
    expect(state.aiEnabled).toBe(true);
    expect(sent).toContainEqual({ type: 'setAiEnabled', value: true });
  });

  it('setBrandTheme updates state and tells main', () => {
    const state = createState();
    const theme = { ...state.brandTheme, accent: '#ff0000' };
    setBrandTheme(state, theme);
    expect(state.brandTheme).toEqual(theme);
    expect(sent).toContainEqual({ type: 'setBrandTheme', value: theme });
  });
});

// ---------------------------------------------------------------------------
// runUpdateFromSource
// ---------------------------------------------------------------------------

describe('runUpdateFromSource', () => {
  it('rebuilds the doc and dispatches renderDocFrame with the source node id', async () => {
    const state = createState();
    const src = source();
    await expect(runUpdateFromSource(refsStub(), state, src)).resolves.toBe(true);

    const msg = sent.find((m) => (m as { type: string }).type === 'renderDocFrame') as {
      type: string; nodeId: string; contentHash: string; config: DocConfig; model: unknown;
    };
    expect(msg).toBeDefined();
    expect(msg.nodeId).toBe('1:1');
    expect(msg.contentHash).toMatch(/^[0-9a-f]+$/);
    expect(msg.config).toEqual(src.config);
    expect(msg.model).toBeTruthy();
  });

  it('clears banners and starts the loader before doing work', async () => {
    await runUpdateFromSource(refsStub(), createState(), source());
    expect(clearBanners).toHaveBeenCalled();
    expect(startLoader).toHaveBeenCalled();
    // The loader is stopped by docFrameDone/docFrameError in ui.ts, not here.
    expect(stopLoader).not.toHaveBeenCalled();
  });

  it('skips prose entirely when the stored config had AI off', async () => {
    const state = createState();
    state.licenseKey = 'LK';
    await runUpdateFromSource(refsStub(), state, source({ config: docConfig({ aiEnabled: false }) }));
    expect(generateProse).not.toHaveBeenCalled();
  });

  it('skips prose when AI is on but no identity is available', async () => {
    const state = createState();
    state.licenseKey = null;
    state.figmaUserId = null;
    await runUpdateFromSource(
      refsStub(),
      state,
      source({ config: docConfig({ aiEnabled: true, sections: ['definition'] }) }),
    );
    expect(generateProse).not.toHaveBeenCalled();
  });

  it('skips prose when the selected sections request no prose keys', async () => {
    const state = createState();
    state.licenseKey = 'LK';
    // tokens/configuration are deterministic sections, so nothing to draft.
    await runUpdateFromSource(
      refsStub(),
      state,
      source({ config: docConfig({ aiEnabled: true, sections: ['tokens', 'configuration'] }) }),
    );
    expect(generateProse).not.toHaveBeenCalled();
  });

  it('generates prose and records the quota callback when AI is on with an identity', async () => {
    const state = createState();
    state.figmaUserId = 'user-1';
    const quota = { used: 3, limit: 20, tier: 'free' };
    vi.mocked(generateProse).mockImplementation((async (
      ..._args: unknown[]
    ) => {
      const onQuota = _args[4] as ((q: unknown) => void) | undefined;
      onQuota?.(quota);
      return { definition: 'A button.', accessibility: '', dos: [], donts: [] };
    }) as unknown as typeof generateProse);

    await runUpdateFromSource(
      refsStub(),
      state,
      source({ config: docConfig({ aiEnabled: true, sections: ['definition'] }) }),
    );

    expect(generateProse).toHaveBeenCalledOnce();
    expect(state.quota).toEqual(quota);
    expect(sent.some((m) => (m as { type: string }).type === 'renderDocFrame')).toBe(true);
  });

  it('still renders the frame when prose generation fails', async () => {
    const state = createState();
    state.figmaUserId = 'user-1';
    vi.mocked(generateProse).mockRejectedValue(new Error('quota exhausted'));

    await expect(
      runUpdateFromSource(
        refsStub(),
        state,
        source({ config: docConfig({ aiEnabled: true, sections: ['definition'] }) }),
      ),
    ).resolves.toBe(true);

    // AI is best-effort garnish: the frame ships with placeholders.
    expect(sent.some((m) => (m as { type: string }).type === 'renderDocFrame')).toBe(true);
    expect(showBanner).not.toHaveBeenCalled();
  });

  it('reports a banner and returns false when extraction throws', async () => {
    const bad = { ...source(), node: null as unknown as SerializedNode };
    await expect(runUpdateFromSource(refsStub(), createState(), bad)).resolves.toBe(false);
    expect(stopLoader).toHaveBeenCalled();
    expect(vi.mocked(showBanner).mock.calls[0][1]).toBe('error');
    expect(String(vi.mocked(showBanner).mock.calls[0][2])).toContain('Update failed');
    expect(sent.some((m) => (m as { type: string }).type === 'renderDocFrame')).toBe(false);
  });
});
