/**
 * actionsRun.test.ts — extraction helpers and preference setters.
 *
 * Kept separate from actions.test.ts because these need module mocks (and a
 * stubbed `document`/`URL`) that the pure-function tests there deliberately do
 * without.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SerializedNode } from '@spec-layer/extractor';

// --- mocks (must be declared before importing the module under test) -------

vi.mock('../src/ui/ai', () => ({
  generateProse: vi.fn(),
}));

import {
  createState,
  ensureExtracted,
  renderOne,
  setAiEnabled,
  setBrandTheme,
  type UiState,
} from '../src/ui/actions';

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
