/**
 * actionsRun.test.ts — extraction helpers and preference setters.
 *
 * Kept separate from actions.test.ts because these need module mocks (and a
 * stubbed `document`/`URL`) that the pure-function tests there deliberately do
 * without.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ProseV2, SerializedNode } from '@spec-layer/extractor';

// --- mocks (must be declared before importing the module under test) -------

vi.mock('../src/ui/ai', () => ({
  generateProse: vi.fn(),
}));

import {
  createDocFrame,
  createState,
  ensureExtracted,
  renderOne,
  setAiEnabled,
  setBrandTheme,
  type BuildPresenter,
  type UiState,
} from '../src/ui/actions';
import { generateProse } from '../src/ui/ai';
import { failedBuildScreen } from '../src/ui/viewModel/componentScreen';
import { componentStatusMarkup } from '../src/ui/screens/component';
import type { ComponentScreenState } from '../src/ui/viewModel/contracts';

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
        bindings: [{ property: 'fills', id: 'VariableID:1', name: 'color/bg/brand',
                     kind: 'variable', remote: false, collectionId: 'VariableCollectionId:1' }],
        children: [
          { id: '1:3', name: 'Label', type: 'TEXT', visible: true },
        ],
      },
    ],
  };
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

  it('threads the Figma file name into the spec, and omits it when there is none', () => {
    expect(renderOne(buttonNode(), 'FILE1', 'Design System').spec.figmaFileName)
      .toBe('Design System');
    expect('figmaFileName' in renderOne(buttonNode(), 'FILE1').spec).toBe(false);
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

  it('carries the selection\'s file name into the extracted spec', () => {
    const state = createState();
    state.currentNode = buttonNode();
    state.currentFileKey = 'FILE1';
    state.currentFileName = 'Design System';
    expect(ensureExtracted(state)).toBe(true);
    expect(state.currentSpec?.figmaFileName).toBe('Design System');
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
// The prose seam: what generateProse returns is already validated
// ---------------------------------------------------------------------------

describe('createDocFrame stores the validated v2 draft', () => {
  const presenter = (): BuildPresenter => ({
    clear: vi.fn(), error: vi.fn(), info: vi.fn(),
    setBusy: vi.fn(), startProgress: vi.fn(), stopProgress: vi.fn(),
  });

  /** A state that will actually generate: AI on, a free identity, a selection. */
  function aiState(): UiState {
    const state = createState();
    state.currentNode = buttonNode();
    state.currentFileKey = 'FILE1';
    state.aiEnabled = true;
    state.figmaUserId = 'u1';
    return state;
  }

  const selection = { sections: new Set(['definition' as const]), variantIds: new Set<string>() };

  it('keeps the prose as returned and records the requested v2 key set', async () => {
    const prose: ProseV2 = { v: 2, overview: { lede: 'A Button triggers an action.', body: [] } };
    vi.mocked(generateProse).mockResolvedValue({ prose, dropped: {} });
    const state = aiState();
    await createDocFrame(state, selection, presenter());
    // No upgrade, no second validation: the extractor already did both.
    expect(state.generatedProse).toEqual(prose);
    expect(state.generatedProseKeys).toEqual(new Set(['overview']));
    // The requested set is exactly what the checked section needs.
    expect(vi.mocked(generateProse).mock.calls[0][3]).toEqual(new Set(['overview']));
  });

  it('leaves the draft null when validation dropped everything', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(generateProse).mockResolvedValue({ prose: { v: 2 }, dropped: { keyboard: 2 } });
    const state = aiState();
    await createDocFrame(state, selection, presenter());
    expect(state.generatedProse).toBeNull();
    expect(state.generatedProseKeys).toBeNull();
    // The drop count is logged, so a prompt regression is visible.
    expect(warn).toHaveBeenCalledWith('[Spec Layer] prose items dropped by validation', { keyboard: 2 });
    warn.mockRestore();
  });
});

/**
 * ui-vnext.ts cannot be imported from a test, so this drives the real
 * createDocFrame through a presenter that does exactly what the host's
 * `presenter('create').error` does: route the message through
 * failedBuildScreen and draw the footer status. A pre-render failure has to
 * land on the same banner a docFrameError does, not a toast.
 */
describe('createDocFrame pre-render failures land on the error banner', () => {
  function hostLikePresenter(name: string): BuildPresenter & { screen: () => ComponentScreenState } {
    let screen: ComponentScreenState = { kind: 'building', componentName: name, action: 'create', phase: '' };
    return {
      screen: () => screen,
      clear: vi.fn(),
      error: (message: string) => { screen = failedBuildScreen(name, message); },
      info: vi.fn(),
      setBusy: (busy: boolean) => {
        if (!busy && screen.kind === 'building') screen = { kind: 'ready', componentName: name };
      },
      startProgress: vi.fn(),
      stopProgress: vi.fn(),
    };
  }

  it('an empty section choice stays on screen as the footer banner', async () => {
    const state = createState();
    state.currentNode = buttonNode();
    state.currentFileKey = 'FILE1';
    const ui = hostLikePresenter('Button');
    await createDocFrame(state, { sections: new Set(), variantIds: new Set() }, ui);
    // setBusy(false) follows the error and must not demote it to ready.
    expect(ui.screen()).toEqual({ kind: 'error', componentName: 'Button', message: 'Select at least one section.' });
    expect(componentStatusMarkup(ui.screen())).toContain('sl-footer-error');
  });

  it('an assembly failure stays on screen with the reason', async () => {
    // The dispatch itself throwing is the last step inside createDocFrame's
    // try, so it stands in for any failure there.
    vi.stubGlobal('parent', { postMessage: () => { throw new Error('boom'); } });
    const state = createState();
    state.currentNode = buttonNode();
    state.currentFileKey = 'FILE1';
    const ui = hostLikePresenter('Button');
    await createDocFrame(state, { sections: new Set(['definition' as const]), variantIds: new Set() }, ui);
    const screen = ui.screen();
    expect(screen.kind).toBe('error');
    if (screen.kind === 'error') {
      expect(screen.message).toBe('Couldn’t create the docs. Nothing changed on the canvas. (boom)');
    }
    expect(componentStatusMarkup(screen)).toContain('role="alert"');
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
