import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extract, specHashProjection, specContentHash, contentHash, ProseProxyError,
} from '@spec-layer/extractor';
import type { ProseV2, SerializedNode } from '@spec-layer/extractor';
import chipHidden from '../../extractor/test/fixtures/chip-hidden.json';

// Prove Update never reaches the AI: the module is mocked and asserted unused.
// Individual describe blocks below (missingProseKeys, mergeTopUp are pure and
// need no mock; topUpProseForRebuild sets the resolved value per case) rely on
// the default throwing so a path that must not call the AI is caught outright.
vi.mock('../src/ui/ai', () => ({ generateProse: vi.fn(async () => { throw new Error('the AI must not run here'); }) }));

import { generateProse } from '../src/ui/ai';
import {
  canGenerate,
  createDocFrame,
  createState,
  updateFromSource,
  missingProseKeys,
  mergeTopUp,
  topUpProseForRebuild,
  takeTopUpNote,
  quotaExhaustedNote,
  withoutAiOmissions,
  noteGenerationError,
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

const prose: ProseV2 = {
  v: 2,
  overview: { lede: 'Edited by hand on the canvas.', body: [] },
  whenToUse: ['Edited on the canvas: use it for the primary action.'],
  whenNotToUse: ['Edited on the canvas: not for navigation.'],
  semantics: ['Focusable.'],
  guidelines: [{ do: { rule: 'Do this', reason: '' }, dont: null }],
};

const badSource: DocSource = {
  docId: 'd1',
  // `null` makes `extract()` genuinely throw (matches the broken fixture in
  // copyBrief.test.ts), rather than relying on `parent` being unstubbed to
  // fail the message send.
  node: null as unknown as SerializedNode,
  fileKey: 'f1',
  config: { sections: [], variantIds: [], aiEnabled: false, anatomyView: 'diagram', measureViews: [], includeHidden: false },
  prose: null,
};

const goodSource: DocSource = {
  docId: 'd2',
  node: buttonNode(),
  fileKey: 'f1',
  // aiEnabled is on, and Update still must not call the model.
  config: { sections: ['definition', 'whenToUse', 'dosDonts', 'tokens'], variantIds: [], aiEnabled: true, anatomyView: 'diagram', measureViews: [], includeHidden: false },
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
  it('starts the presenter before it works, with no lines of its own', async () => {
    // The Library shows its own "Updating" label; its presenter only repaints.
    const ui = fakePresenter();
    await updateFromSource(createState(), badSource, ui);
    expect(ui.progress[0]).toEqual([]);
  });

  it('says it could not update the doc, with the cause last', async () => {
    const ui = fakePresenter();
    await updateFromSource(createState(), badSource, ui);
    expect(ui.errors[0]).toMatch(/^Couldn’t update this doc\. \(.+\)$/);
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
      prose?: ProseV2;
      model: { sections: { id: string; kind: string; text?: string; subtitle?: { text: string } | null }[] };
    };
    expect(msg).toBeDefined();
    expect(msg.prose).toEqual(prose);
    // The component has no Figma description, so the hand-edited lead sentence
    // is what the model lifts into the Usage header subtitle.
    const definition = msg.model.sections.find((s) => s.id === 'definition');
    expect(definition?.kind === 'prose' && definition.subtitle?.text).toBe('Edited by hand on the canvas.');
  });

  it('keeps a canvas edit to When to use and When not to use', async () => {
    // Both columns are read off the canvas by the main thread and ride the
    // docSource message. An adapter that flattened the doc's prose to the v1
    // shape on the way in dropped them, because v1 has no field for either:
    // the edit reached the UI and then vanished from the rebuilt frame.
    const ui = fakePresenter();
    await expect(updateFromSource(createState(), goodSource, ui)).resolves.toBe(true);
    const msg = sent.find((m) => (m as { type: string }).type === 'renderDocFrame') as {
      prose?: ProseV2;
      model: { sections: { id: string; kind: string; left?: { items: unknown[] }; right?: { items: unknown[] } }[] };
    };
    expect(msg.prose?.whenToUse).toEqual(['Edited on the canvas: use it for the primary action.']);
    expect(msg.prose?.whenNotToUse).toEqual(['Edited on the canvas: not for navigation.']);
    const whenToUse = msg.model.sections.find((s) => s.id === 'whenToUse');
    expect(whenToUse?.kind).toBe('twoColumns');
    expect(whenToUse?.left?.items).toHaveLength(1);
    expect(whenToUse?.right?.items).toHaveLength(1);
  });

  it('omits prose from the render request when the doc has none', async () => {
    const ui = fakePresenter();
    await updateFromSource(createState(), { ...goodSource, prose: null }, ui);
    const msg = sent.find((m) => (m as { type: string }).type === 'renderDocFrame') as { prose?: unknown };
    expect('prose' in msg).toBe(false);
  });

  it('records what it left out, so the Library can report it the way Create does', async () => {
    const ui = fakePresenter();
    const state = createState();
    // AI is off for this doc, so its AI-only sections are left out with that
    // reason rather than silently missing.
    const source: DocSource = {
      ...goodSource,
      config: { ...goodSource.config, sections: ['definition', 'whenToUse', 'dosDonts'], aiEnabled: false },
      prose: null,
    };
    await expect(updateFromSource(state, source, ui)).resolves.toBe(true);
    expect(state.lastOmitted.map((o) => [o.id, o.reason])).toEqual([
      ['definition', 'nothingToShow'],
      ['whenToUse', 'aiOff'],
      ['dosDonts', 'aiOff'],
    ]);
  });

  it('clears the record when a rebuild leaves nothing out', async () => {
    const ui = fakePresenter();
    const state = createState();
    state.lastOmitted = [{ id: 'keyboard', label: 'Keyboard', reason: 'nothingToShow' }];
    await expect(updateFromSource(state, goodSource, ui)).resolves.toBe(true);
    expect(state.lastOmitted).toEqual([]);
  });

  it('sends the hash projection as the baseline, and its hash is the message contentHash', async () => {
    const ui = fakePresenter();
    await updateFromSource(createState(), goodSource, ui);
    const msg = sent.find((m) => (m as { type: string }).type === 'renderDocFrame') as {
      contentHash: string; baseline: unknown;
    };
    const expected = specHashProjection(extract(goodSource.node, { figmaFile: goodSource.fileKey }));
    expect(msg.baseline).toEqual(expected);
    expect(contentHash(msg.baseline)).toBe(msg.contentHash);
  });

  it('passes the stored includeHidden through the model, the config, and the hash', async () => {
    const source: DocSource = {
      ...goodSource,
      node: chipHidden as unknown as SerializedNode,
      config: { ...goodSource.config, includeHidden: true },
    };
    const ui = fakePresenter();
    await updateFromSource(createState(), source, ui);
    const msg = sent.find((m) => (m as { type: string }).type === 'renderDocFrame') as {
      model: { includeHidden?: true }; config: { includeHidden: boolean }; contentHash: string;
    };
    expect(msg.model.includeHidden).toBe(true);
    expect(msg.config.includeHidden).toBe(true);
    const spec = extract(source.node, { figmaFile: source.fileKey });
    expect(msg.contentHash).toBe(specContentHash(spec, { includeHidden: true }));
    expect(msg.contentHash).not.toBe(specContentHash(spec));
  });
});

describe('missingProseKeys', () => {
  const stored: ProseV2 = { v: 2, overview: { lede: 'L.', body: [] }, semantics: ['S.'], keyboard: [{ keys: ['Tab'], action: 'Moves focus.' }] };
  it('asks only for the requested keys with no content, and always for keyboard', () => {
    const missing = missingProseKeys(stored, new Set(['overview', 'semantics', 'whenToUse', 'guidelines', 'keyboard']));
    expect([...missing].sort()).toEqual(['guidelines', 'keyboard', 'whenToUse']);
  });
  it('treats a blank lede with no body, and an empty list, as missing', () => {
    const blank: ProseV2 = { v: 2, overview: { lede: '  ', body: [] }, pointer: [] };
    expect([...missingProseKeys(blank, new Set(['overview', 'pointer']))].sort()).toEqual(['overview', 'pointer']);
  });
  it('asks for everything requested when there is no stored prose', () => {
    expect([...missingProseKeys(null, new Set(['overview', 'content']))].sort()).toEqual(['content', 'overview']);
  });
});

describe('mergeTopUp', () => {
  const stored: ProseV2 = { v: 2, overview: { lede: 'Kept.', body: [] }, keyboard: [{ keys: ['Tab'], action: 'Old.' }] };
  it('keeps every stored key, fills the empty ones, and lets the fresh keyboard win', () => {
    const fresh: ProseV2 = { v: 2, overview: { lede: 'New.', body: ['N.'] }, whenToUse: ['W.'], keyboard: [{ keys: ['Enter'], action: 'New.' }] };
    expect(mergeTopUp(stored, fresh)).toEqual({
      v: 2, overview: { lede: 'Kept.', body: [] }, whenToUse: ['W.'], keyboard: [{ keys: ['Enter'], action: 'New.' }],
    });
  });
  it('returns the stored prose when nothing was generated, and null when both are empty', () => {
    expect(mergeTopUp(stored, null)).toEqual(stored);
    expect(mergeTopUp(null, { v: 2 })).toBeNull();
  });
});

describe('topUpProseForRebuild', () => {
  const src: DocSource = {
    docId: 'd1', node: buttonNode(), fileKey: 'F',
    config: { sections: ['definition', 'whenToUse', 'keyboard'], variantIds: [], measureViews: [], includeHidden: false, aiEnabled: true, anatomyView: 'diagram' },
    prose: { v: 2, overview: { lede: 'Kept.', body: [] } },
  };
  const aiState = () => Object.assign(createState(), { aiEnabled: true, figmaUserId: 'u1' });

  beforeEach(() => { vi.mocked(generateProse).mockReset(); });

  it('asks the model only for the missing keys and keyboard, and merges the answer', async () => {
    vi.mocked(generateProse).mockResolvedValueOnce({
      prose: { v: 2, overview: { lede: 'Ignored.', body: [] }, whenToUse: ['W.'], keyboard: [{ keys: ['Space'], action: 'Activates.' }] },
      dropped: {},
    });
    const out = await topUpProseForRebuild(aiState(), src);
    const requested = vi.mocked(generateProse).mock.calls[0][3] as Set<string>;
    expect([...requested].sort()).toEqual(['keyboard', 'whenNotToUse', 'whenToUse']);
    expect(out).toEqual({ v: 2, overview: { lede: 'Kept.', body: [] }, whenToUse: ['W.'], keyboard: [{ keys: ['Space'], action: 'Activates.' }] });
  });

  it('does not call the model when AI writing is off or nothing is missing', async () => {
    const off = Object.assign(createState(), { aiEnabled: false, figmaUserId: 'u1' });
    expect(await topUpProseForRebuild(off, src)).toEqual(src.prose);
    const full: DocSource = { ...src, config: { ...src.config, sections: ['definition'] } };
    expect(await topUpProseForRebuild(aiState(), full)).toEqual(src.prose);
    expect(generateProse).not.toHaveBeenCalled();
  });

  it('keeps the stored prose and records the note when the model fails', async () => {
    vi.mocked(generateProse).mockRejectedValueOnce(new ProseProxyError('rate_limited'));
    const state = aiState();
    expect(await topUpProseForRebuild(state, src)).toEqual(src.prose);
    // Worded for a rebuild: the stored prose stays, and there is no "try
    // again", because the rebuilt doc is no longer stale and an Update never
    // asks AI.
    expect(state.pendingAiNote).toBe(
      'Too many AI writing requests in the last minute, so sections that needed AI were left empty.',
    );
  });

  it('logs a thrown error instead of putting it in the note', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(generateProse).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const state = aiState();
    expect(await topUpProseForRebuild(state, src)).toEqual(src.prose);
    expect(state.pendingAiNote).toBe('Couldn’t reach Spec Layer, so sections that needed AI were left empty.');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('says so when the AI allowance runs out, worded for a rebuild', async () => {
    // Silence here would attribute the empty sections to "nothing to show".
    vi.mocked(generateProse).mockRejectedValueOnce(new ProseProxyError('quota_exhausted'));
    const state = aiState();
    state.quota = { tier: 'free', used: 10, limit: 10, remaining: 0, resetsAt: '2026-10-01T00:00:00.000Z' };
    expect(await topUpProseForRebuild(state, src)).toEqual(src.prose);
    expect(state.quotaExhausted).toBe(true);
    expect(state.pendingAiNote).toBe(
      'You’ve used all 10 free AI writing uses this month, so sections that needed AI were left empty. Your uses reset on Oct 1.',
    );
    expect(state.pendingAiNote).not.toContain('\u2014');
  });

  it('does not top up a document that was built with AI writing off', async () => {
    // The panel toggle is on; the document's own config is not. Topping it up
    // would write AI text into a doc whose stored config still reads
    // aiEnabled: false, and a later empty AI section on it would be reported
    // as "AI writing is off" although AI had just written into it.
    const builtWithoutAi: DocSource = { ...src, config: { ...src.config, aiEnabled: false } };
    expect(await topUpProseForRebuild(aiState(), builtWithoutAi)).toEqual(src.prose);
    expect(generateProse).not.toHaveBeenCalled();
  });
});

describe('takeTopUpNote', () => {
  it('returns the note and clears the slot', () => {
    const state = createState();
    const note = 'Too many AI writing requests in the last minute, so sections that needed AI were left empty.';
    state.pendingAiNote = note;
    expect(takeTopUpNote(state)).toBe(note);
    expect(state.pendingAiNote).toBe('');
  });

  it('returns null when there is nothing to report', () => {
    expect(takeTopUpNote(createState())).toBeNull();
  });

  it('pins the fix: draining the note for one failed rebuild leaves nothing for a later, unrelated document to inherit', async () => {
    // A stale-version doc whose top-up fails leaves a note on the shared slot.
    const failing: DocSource = {
      docId: 'a', node: buttonNode(), fileKey: 'F',
      config: { sections: ['whenToUse', 'keyboard'], variantIds: [], measureViews: [], includeHidden: false, aiEnabled: true, anatomyView: 'diagram' },
      prose: null,
    };
    const state = Object.assign(createState(), { aiEnabled: true, figmaUserId: 'u1' });
    vi.mocked(generateProse).mockReset();
    vi.mocked(generateProse).mockRejectedValueOnce(new ProseProxyError('rate_limited'));
    await topUpProseForRebuild(state, failing);
    expect(state.pendingAiNote).not.toBe('');

    // The UI drains the note the instant this document's own top-up finishes
    // (this is the fix: ui-vnext.ts no longer waits for a later, unrelated
    // completion to read the shared slot).
    expect(takeTopUpNote(state)).toBe(
      'Too many AI writing requests in the last minute, so sections that needed AI were left empty.',
    );
    expect(state.pendingAiNote).toBe('');
    vi.mocked(generateProse).mockClear();

    // A later document whose stored prose already covers everything its
    // config requests never calls the model at all, and must not inherit the
    // earlier document's failure note.
    const complete: DocSource = {
      docId: 'c', node: buttonNode(), fileKey: 'F',
      config: { sections: ['accessibility'], variantIds: [], measureViews: [], includeHidden: false, aiEnabled: true, anatomyView: 'diagram' },
      prose: { v: 2, semantics: ['Focusable.'] },
    };
    expect(await topUpProseForRebuild(state, complete)).toEqual(complete.prose);
    expect(generateProse).not.toHaveBeenCalled();
    expect(state.pendingAiNote).toBe('');
  });
});

/**
 * The create path writes the same baseline the Update path does. Pinned here
 * as well because the two build the message independently: a baseline whose
 * hash is not the message's contentHash would make every later diff read
 * against the wrong object.
 */
describe('createDocFrame', () => {
  it('sends a baseline whose hash is the message contentHash', async () => {
    const ui = fakePresenter();
    const state = createState();
    state.currentNode = buttonNode();
    state.currentFileKey = 'f1';
    await createDocFrame(state, {
      sections: new Set(['definition', 'tokens']),
      variantIds: new Set(),
    }, ui);
    expect(ui.errors).toEqual([]);
    expect(generateProse).not.toHaveBeenCalled();

    const msg = sent.find((m) => (m as { type: string }).type === 'renderDocFrame') as {
      contentHash: string; baseline: unknown;
    };
    expect(msg).toBeDefined();
    expect(contentHash(msg.baseline)).toBe(msg.contentHash);
  });

  it('records what the build left out, and blames AI only when AI was off', async () => {
    // The reason is what the result message prints, so it has to come from the
    // build that actually ran: a section AI writing would have filled reads
    // 'aiOff' only while AI is off, and a deterministic section with nothing
    // in the spec always reads 'nothingToShow'.
    const state = createState();
    state.currentNode = buttonNode();
    state.currentFileKey = 'f1';
    expect(state.lastOmitted).toEqual([]);

    await createDocFrame(state, {
      sections: new Set(['keyboard', 'related']),
      variantIds: new Set(),
    }, fakePresenter());
    expect(state.lastOmitted).toEqual([
      { id: 'related', label: 'Related components', reason: 'nothingToShow' },
      { id: 'keyboard', label: 'Keyboard', reason: 'aiOff' },
    ]);
  });

  it('persists the flag the model was built with, so Update classifies omissions the same way', async () => {
    // The checkbox is on but there is no licence and no Figma identity, so
    // canGenerate is false and the build ran without AI. Update reads this
    // stored flag back; persisting the raw checkbox instead made the same doc
    // read 'nothing to show' on Create and 'AI writing is off' on Update.
    const state = createState();
    state.currentNode = buttonNode();
    state.currentFileKey = 'f1';
    state.aiEnabled = true;
    state.licenseKey = null;
    state.figmaUserId = null;
    expect(canGenerate(state)).toBe(false);

    await createDocFrame(state, { sections: new Set(['definition']), variantIds: new Set() }, fakePresenter());
    const msg = sent.find((m) => (m as { type: string }).type === 'renderDocFrame') as {
      config: { aiEnabled: boolean };
    };
    expect(msg.config.aiEnabled).toBe(canGenerate(state));
    expect(msg.config.aiEnabled).toBe(false);
  });

  it('persists a true flag when the build really could generate', async () => {
    const state = createState();
    state.currentNode = buttonNode();
    state.currentFileKey = 'f1';
    state.aiEnabled = true;
    state.figmaUserId = 'u1';
    expect(canGenerate(state)).toBe(true);

    await createDocFrame(state, { sections: new Set(['definition']), variantIds: new Set() }, fakePresenter());
    const msg = sent.find((m) => (m as { type: string }).type === 'renderDocFrame') as {
      config: { aiEnabled: boolean };
    };
    expect(msg.config.aiEnabled).toBe(true);
  });
});

describe('quota exhausted note', () => {
  it('names the limit and the reset date the proxy reported', () => {
    expect(quotaExhaustedNote({ tier: 'free', used: 10, limit: 10, remaining: 0, resetsAt: '2026-10-01T00:00:00.000Z' }))
      .toBe('You’ve used all 10 free AI writing uses this month, so the AI sections were left out. Your uses reset on Oct 1.');
  });

  it('invents neither a limit nor a date the snapshot lacks', () => {
    expect(quotaExhaustedNote(null))
      .toBe('You’ve used all your free AI writing uses this month, so the AI sections were left out.');
  });

  it('words a foundation build for descriptions, not sections', () => {
    expect(quotaExhaustedNote({ tier: 'free', used: 10, limit: 10, remaining: 0, resetsAt: '2026-10-01T00:00:00.000Z' }, 'foundation'))
      .toBe('You’ve used all 10 free AI writing uses this month, so the AI descriptions were left out. Your uses reset on Oct 1.');
  });

  it('does not call a Pro allowance free', () => {
    expect(quotaExhaustedNote({ tier: 'pro', used: 500, limit: 500, remaining: 0, resetsAt: '2026-10-01T00:00:00.000Z' }))
      .not.toContain('free');
  });

  it('is what Create records, not an empty note', () => {
    const state = createState();
    noteGenerationError(state, new ProseProxyError('quota_exhausted'));
    expect(state.quotaExhausted).toBe(true);
    expect(state.pendingAiNote).toContain('You’ve used all');
  });

  it('drops only the AI sections left empty, not deterministic or AI-off omissions', () => {
    const kept = withoutAiOmissions([
      { id: 'definition', label: 'Overview', reason: 'nothingToShow' },
      { id: 'keyboard', label: 'Keyboard', reason: 'nothingToShow' },
      { id: 'related', label: 'Related components', reason: 'nothingToShow' },
      { id: 'whenToUse', label: 'When to use', reason: 'aiOff' },
    ]);
    expect(kept.map((o) => o.id)).toEqual(['related', 'whenToUse']);
  });
});
