import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProseDrafts, SerializedNode } from '@spec-layer/extractor';

// Prove Update never reaches the AI: the module is mocked and asserted unused.
vi.mock('../src/ui/ai', () => ({
  generateProse: vi.fn(async () => { throw new Error('updateFromSource must not call the AI'); }),
}));

import { generateProse } from '../src/ui/ai';
import {
  createState,
  updateFromSource,
  type BuildPresenter,
  type DocSource,
} from '../src/ui/actions';

function fakePresenter(): BuildPresenter & { errors: string[]; progress: string[][] } {
  const errors: string[] = [];
  const progress: string[][] = [];
  return {
    errors,
    progress,
    clear: vi.fn(),
    error: (message: string) => { errors.push(message); },
    info: vi.fn(),
    setBusy: vi.fn(),
    startProgress: (messages: string[]) => { progress.push(messages); },
    stopProgress: vi.fn(),
  };
}

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

const prose: ProseDrafts = {
  definition: 'Edited by hand on the canvas.',
  accessibility: 'Focusable.',
  dos: ['Do this'],
  donts: [],
};

const badSource: DocSource = {
  docId: 'd1',
  // `null` makes `extract()` genuinely throw (matches the broken fixture in
  // copyBrief.test.ts), rather than relying on `parent` being unstubbed to
  // fail the message send.
  node: null as unknown as SerializedNode,
  fileKey: 'f1',
  config: { sections: [], variantIds: [], aiEnabled: false, anatomyView: 'diagram', measureViews: [] },
  prose: null,
};

const goodSource: DocSource = {
  docId: 'd2',
  node: buttonNode(),
  fileKey: 'f1',
  // aiEnabled is on, and Update still must not call the model.
  config: { sections: ['definition', 'dosDonts', 'tokens'], variantIds: [], aiEnabled: true, anatomyView: 'diagram', measureViews: [] },
  prose,
};

let sent: unknown[];

beforeEach(() => {
  sent = [];
  vi.clearAllMocks();
  vi.stubGlobal('parent', {
    postMessage: (m: { pluginMessage: unknown }) => { sent.push(m.pluginMessage); },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('updateFromSource', () => {
  it('narrates before it starts working', async () => {
    const ui = fakePresenter();
    await updateFromSource(createState(), badSource, ui);
    expect(ui.progress[0]).toEqual([
      'Reading the component',
      'Composing sections',
      'Placing the frame on the canvas',
    ]);
  });

  it('reports failure through the presenter rather than throwing', async () => {
    const ui = fakePresenter();
    await expect(updateFromSource(createState(), badSource, ui)).resolves.toBe(false);
    expect(ui.errors.length).toBeGreaterThan(0);
  });

  it('builds from the prose it was given and never calls the AI', async () => {
    const ui = fakePresenter();
    const state = createState();
    state.licenseKey = 'k';
    await expect(updateFromSource(state, goodSource, ui)).resolves.toBe(true);
    expect(generateProse).not.toHaveBeenCalled();

    const msg = sent.find((m) => (m as { type: string }).type === 'renderDocFrame') as {
      prose?: ProseDrafts; model: { sections: { id: string; kind: string; text?: string }[] };
    };
    expect(msg).toBeDefined();
    expect(msg.prose).toEqual(prose);
    const definition = msg.model.sections.find((s) => s.id === 'definition');
    expect(definition?.kind === 'prose' && definition.text).toBe('Edited by hand on the canvas.');
  });

  it('omits prose from the render request when the doc has none', async () => {
    const ui = fakePresenter();
    await updateFromSource(createState(), { ...goodSource, prose: null }, ui);
    const msg = sent.find((m) => (m as { type: string }).type === 'renderDocFrame') as { prose?: unknown };
    expect('prose' in msg).toBe(false);
  });
});
