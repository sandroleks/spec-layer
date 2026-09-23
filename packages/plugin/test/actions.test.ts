import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  proseNeedsRegen,
  canGenerate,
  createDocFrame,
  createState,
  omissionsMessage,
  resultOutcome,
  setComponentFormat,
  setLicenseKey,
  licenseFailureNote,
  type BuildPresenter,
  type UiState,
} from '../src/ui/actions';
import { frameCountFor, type DocFrameModel } from '../src/ui/docModel';
import type { ProseV2Key, SerializedNode } from '@spec-layer/extractor';

/** A minimal component set: one variant, one bound fill, one text child. Same
 *  shape as the fixture in actionsRun.test.ts/fromSource.test.ts; duplicated
 *  here rather than shared because this file stays free of the module mocks
 *  and stubbed document/URL those files need. */
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

describe('proseNeedsRegen', () => {
  const withDraft = (keys: ProseV2Key[]): UiState => ({
    generatedProse: { v: 2, overview: { lede: 'd', body: [] } },
    generatedProseKeys: new Set(keys),
  } as unknown as UiState);

  it('regenerates when the cached draft misses a requested key', () => {
    expect(proseNeedsRegen(withDraft(['overview']), new Set(['overview', 'keyboard']))).toBe(true);
  });
  it('reuses when the cached draft covers the request', () => {
    expect(proseNeedsRegen(withDraft(['overview', 'keyboard']), new Set(['keyboard']))).toBe(false);
  });
  it('regenerates when there is no draft yet', () => {
    expect(proseNeedsRegen({ generatedProse: null, generatedProseKeys: null } as unknown as UiState, new Set(['overview']))).toBe(true);
  });
});

describe('canGenerate', () => {
  it('false when AI is off', () => {
    const s = createState();
    s.aiEnabled = false; s.figmaUserId = 'u1';
    expect(canGenerate(s)).toBe(false);
  });
  it('true for a free user with only a figma id (no key of any kind)', () => {
    const s = createState();
    s.aiEnabled = true; s.figmaUserId = 'u1'; s.licenseKey = null;
    expect(canGenerate(s)).toBe(true);
  });
  it('true with a license key and no figma id', () => {
    const s = createState();
    s.aiEnabled = true; s.licenseKey = 'LK'; s.figmaUserId = null;
    expect(canGenerate(s)).toBe(true);
  });
  it('false with AI on but no identity at all', () => {
    const s = createState();
    s.aiEnabled = true; s.licenseKey = null; s.figmaUserId = null;
    expect(canGenerate(s)).toBe(false);
  });
});

describe('setLicenseKey normalization', () => {
  // send() posts to `parent` (the Figma iframe host), which doesn't exist in
  // this node test environment; stub it so we can assert on state alone.
  beforeEach(() => {
    vi.stubGlobal('parent', { postMessage: vi.fn() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores null for an empty value and drops the instance id with it', () => {
    const state = createState();
    setLicenseKey(state, '   ', 'inst-1');
    expect(state.licenseKey).toBeNull();
    expect(state.licenseInstanceId).toBeNull();
  });
  it('trims the stored key', () => {
    const state = createState();
    setLicenseKey(state, '  LK-1  ', 'inst-1');
    expect(state.licenseKey).toBe('LK-1');
    expect(state.licenseInstanceId).toBe('inst-1');
  });
});

describe('licenseFailureNote', () => {
  it('an unreachable license server never flips the key to inactive', () => {
    const out = licenseFailureNote('unreachable');
    expect(out.markInactive).toBe(false);
    expect(out.note).toContain('still saved');
  });
  it('a definite lapse drops to the free tier', () => {
    expect(licenseFailureNote('expired').markInactive).toBe(true);
    expect(licenseFailureNote(undefined).markInactive).toBe(true);
  });
});

describe('omissionsMessage', () => {
  it('states the outcome alone when nothing was left out', () => {
    expect(omissionsMessage('Created 3 frames.', [])).toBe('Created 3 frames.');
  });
  it('names every omitted section with its reason, in order', () => {
    expect(omissionsMessage('Created 3 frames.', [
      { id: 'keyboard', label: 'Keyboard', reason: 'nothingToShow' },
      { id: 'whenToUse', label: 'When to use', reason: 'aiOff' },
    ])).toBe('Created 3 frames. Left out Keyboard: nothing to show. Left out When to use: AI writing is off.');
  });
});

describe('resultOutcome', () => {
  it('counts frames in sentence case with the right plural', () => {
    expect(resultOutcome(false, 3)).toBe('Created 3 frames.');
    expect(resultOutcome(false, 1)).toBe('Created 1 frame.');
    expect(resultOutcome(true, 2)).toBe('Replaced 2 frames.');
  });

  it('reads the frame count off the assembled model', async () => {
    // createDocFrame with AI off (the default createState()) never calls the
    // AI module, so this needs no mock of it, only the parent postMessage
    // seam every build path sends through.
    const sent: unknown[] = [];
    vi.stubGlobal('parent', {
      postMessage: (m: { pluginMessage: unknown }) => { sent.push(m.pluginMessage); },
    });
    try {
      const state = createState();
      state.currentNode = buttonNode();
      state.currentFileKey = 'FILE1';
      const presenter: BuildPresenter = {
        clear: vi.fn(), error: vi.fn(), info: vi.fn(),
        setBusy: vi.fn(), startProgress: vi.fn(), stopProgress: vi.fn(),
      };
      await createDocFrame(state, { sections: new Set(['properties']), variantIds: new Set() }, presenter);
      const msg = sent.find((m) => (m as { type: string }).type === 'renderDocFrame') as { model: DocFrameModel };
      expect(msg).toBeDefined();
      expect(state.lastFrameCount).toBe(frameCountFor(msg.model));
      expect(state.lastFrameCount).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('setComponentFormat', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts on YAML', () => {
    expect(createState().componentFormat).toBe('yaml');
  });

  it('holds the choice and asks the main thread to store it', () => {
    const sent: unknown[] = [];
    vi.stubGlobal('parent', {
      postMessage: (m: { pluginMessage: unknown }) => { sent.push(m.pluginMessage); },
    });
    const s = createState();
    setComponentFormat(s, 'md');
    expect(s.componentFormat).toBe('md');
    expect(sent).toEqual([{ type: 'setComponentFormat', value: 'md' }]);
  });
});
