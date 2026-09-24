import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  proseNeedsRegen,
  aiFailureNote,
  canGenerate,
  createDocFrame,
  createState,
  foundationAiRequested,
  generatingMessages,
  nextPhaseIndex,
  omissionsMessage,
  resultOutcome,
  setComponentFormat,
  setLicenseKey,
  licenseFailureNote,
  type BuildPresenter,
  type UiState,
} from '../src/ui/actions';
import type { DocFrameModel } from '../src/ui/docModel';
import { ProseProxyError, type ProseV2Key, type SerializedNode } from '@spec-layer/extractor';

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

describe('foundationAiRequested', () => {
  const briefs = { collections: [{}] } as unknown as import('@spec-layer/extractor').GroupDraftInput;

  it('is false with AI writing off, even with an identity and something to describe', () => {
    const s = createState();
    s.aiEnabled = false; s.figmaUserId = 'u1';
    expect(foundationAiRequested(s, briefs)).toBe(false);
  });

  it('is false with nothing to describe', () => {
    const s = createState();
    s.aiEnabled = true; s.figmaUserId = 'u1';
    expect(foundationAiRequested(s, null)).toBe(false);
    expect(foundationAiRequested(s, { collections: [] })).toBe(false);
  });

  it('is true with the switch on, an identity, and at least one collection brief', () => {
    const s = createState();
    s.aiEnabled = true; s.figmaUserId = 'u1';
    expect(foundationAiRequested(s, briefs)).toBe(true);
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
    expect(out.note).toBe(
      'Spec Layer couldn’t check your license key, so the AI sections were left out. '
      + 'Your key is still saved. Try again in a minute.',
    );
  });
  it('a definite lapse drops to the free plan and says where to renew', () => {
    expect(licenseFailureNote('expired').markInactive).toBe(true);
    expect(licenseFailureNote(undefined).markInactive).toBe(true);
    expect(licenseFailureNote('expired').note).toBe(
      'Your Pro subscription isn’t active, so the AI sections were left out. '
      + 'You’re on the free plan now. Renew Pro on the License screen.',
    );
  });
  it('words a foundation build for descriptions', () => {
    expect(licenseFailureNote('inactive', 'foundation').note).toBe(
      'Your Pro subscription isn’t active, so the AI descriptions were left out. '
      + 'You’re on the free plan now. Renew Pro on the License screen.',
    );
  });
  it('never tells a rebuild to try again', () => {
    // A rebuilt doc is no longer stale, so updating it again never asks AI.
    expect(licenseFailureNote('unreachable', 'rebuild').note).toBe(
      'Spec Layer couldn’t check your license key, so sections that needed AI were left empty. '
      + 'Your key is still saved.',
    );
  });
});

describe('aiFailureNote', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the raw error out of the note and logs it instead', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const note = aiFailureNote(createState(), new SyntaxError('Unexpected token < in JSON'), 'component');
    expect(note).toBe('AI writing failed, so the AI sections were left out. Try again.');
    expect(note).not.toContain('Unexpected token');
    expect(warn).toHaveBeenCalled();
  });

  it('names Spec Layer as unreachable only for a fetch that never arrived', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(aiFailureNote(createState(), new TypeError('Failed to fetch'), 'component')).toBe(
      'Couldn’t reach Spec Layer, so the AI sections were left out. Check your connection and try again.',
    );
    // A TypeError from a bug is not a connection problem.
    expect(aiFailureNote(createState(), new TypeError('Cannot read properties of undefined'), 'component'))
      .toBe('AI writing failed, so the AI sections were left out. Try again.');
  });

  it('words each typed failure for the build it interrupted', () => {
    const rate = new ProseProxyError('rate_limited');
    expect(aiFailureNote(createState(), rate, 'component')).toBe(
      'Too many AI writing requests in the last minute, so the AI sections were left out. Try again in a minute.',
    );
    expect(aiFailureNote(createState(), rate, 'foundation')).toBe(
      'Too many AI writing requests in the last minute, so the AI descriptions were left out. Try again in a minute.',
    );
    expect(aiFailureNote(createState(), new ProseProxyError('generation_pending'), 'foundation')).toBe(
      'AI writing is still busy with an earlier request, so the AI descriptions were left out. Try again in a minute or two.',
    );
    expect(aiFailureNote(createState(), new ProseProxyError('upstream'), 'foundation')).toBe(
      'AI writing failed, so the AI descriptions were left out. Try again.',
    );
  });

  it('never says a rebuild left the AI sections out, or to try again', () => {
    for (const code of ['rate_limited', 'generation_pending', 'upstream'] as const) {
      const note = aiFailureNote(createState(), new ProseProxyError(code), 'rebuild');
      expect(note).toContain('sections that needed AI were left empty.');
      expect(note).not.toContain('left out');
      expect(note).not.toMatch(/try again/i);
    }
  });

  it('drops a foundation build to the free plan on a lapsed license', () => {
    const state = createState();
    const note = aiFailureNote(state, new ProseProxyError('license_not_active', undefined, 'expired'), 'foundation');
    expect(state.licenseActive).toBe(false);
    expect(note).toContain('the AI descriptions were left out');
  });

  it('keeps the key on an unreachable license check', () => {
    const state = createState();
    aiFailureNote(state, new ProseProxyError('license_not_active', undefined, 'unreachable'), 'foundation');
    expect(state.licenseActive).toBeNull();
  });

  it('marks the quota exhausted for any build', () => {
    const state = createState();
    expect(aiFailureNote(state, new ProseProxyError('quota_exhausted'), 'foundation'))
      .toBe('You’ve used all your free AI writing uses this month, so the AI descriptions were left out.');
    expect(state.quotaExhausted).toBe(true);
  });
});

describe('omissionsMessage', () => {
  it('states the outcome alone when nothing was left out', () => {
    expect(omissionsMessage('Docs created.', [])).toBe('Docs created.');
  });
  it('names every omitted section with its reason, in order', () => {
    expect(omissionsMessage('Docs created.', [
      { id: 'keyboard', label: 'Keyboard', reason: 'nothingToShow' },
      { id: 'whenToUse', label: 'When to use', reason: 'aiOff' },
    ])).toBe('Docs created. Left out Keyboard: nothing to show. Left out When to use: AI writing is off.');
  });
});

describe('resultOutcome', () => {
  it('names the outcome in docs, with no frame count', () => {
    expect(resultOutcome(false)).toBe('Docs created.');
    expect(resultOutcome(true)).toBe('Docs updated.');
  });

  it('is what follows a build the main thread was sent', async () => {
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
      expect(msg.model.componentName).toBe('Button');
      expect(presenter.error).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('loader phases', () => {
  it('end on the same docs line whether AI writes or not', () => {
    for (const withAi of [true, false]) {
      const lines = generatingMessages(withAi);
      expect(lines[lines.length - 1]).toBe('Placing docs on the canvas');
    }
  });

  it('hold on the last line instead of wrapping to the first', () => {
    expect(nextPhaseIndex(0, 3)).toBe(1);
    expect(nextPhaseIndex(1, 3)).toBe(2);
    expect(nextPhaseIndex(2, 3)).toBeNull();
    expect(nextPhaseIndex(0, 1)).toBeNull();
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
