import { describe, it, expect, vi } from 'vitest';
import { EXTRACTOR_VERSION, type ProseDrafts } from '@spec-layer/extractor';
import {
  serializeDocLink, parseDocLink, serializeRegistry, parseRegistry,
  addDoc, removeDoc, pruneRegistry, textContentHash, resolveStatus,
  isFoundationLink, foundationScopeKey, retargetScope,
  DOC_PROSE_KEY, serializeProse, parseProse, PROSE_BUDGET_BYTES,
  type DocLinkData, type FoundationDocLink, type ComponentDocLink,
} from '../src/docLink';

const DATA: DocLinkData = {
  v: 1, sourceNodeId: '10:2', contentHash: 'abc', selfHash: 'def',
  config: { sections: ['definition', 'anatomy'], variantIds: ['1:1'], aiEnabled: true, anatomyView: 'diagram', measureViews: ['size', 'padding', 'spacing'] },
  generatedAt: 1720000000000, pluginVersion: '3.0.0',
};

describe('docLink data', () => {
  it('round-trips DocLinkData', () => {
    expect(parseDocLink(serializeDocLink(DATA))).toEqual(DATA);
  });
  it('round-trips extractorVersion, so a freshly generated doc reads its own EXTRACTOR_VERSION back', () => {
    // Regression guard: the main thread must stamp specVersion onto every
    // ComponentDocLink it persists (main.ts's renderDocFrame handler), or a
    // doc generated today reads back with no specVersion at all and shows
    // "Rebuild needed" forever, exactly like a genuinely stale pre-0.2 doc
    // (see the specVersion doc comment on ComponentDocLink above). This
    // exercises the same serialize -> pluginData string -> parse round trip
    // the plugin actually performs, not just the type-level field.
    const fresh: DocLinkData = { ...DATA, extractorVersion: EXTRACTOR_VERSION };
    const parsed = parseDocLink(serializeDocLink(fresh)) as ComponentDocLink;
    expect(parsed.extractorVersion).toBe(EXTRACTOR_VERSION);
  });
  it('parseDocLink returns null on garbage / wrong shape / empty', () => {
    expect(parseDocLink('')).toBeNull();
    expect(parseDocLink('not json')).toBeNull();
    expect(parseDocLink(JSON.stringify({ v: 2 }))).toBeNull();
    expect(parseDocLink(JSON.stringify({ v: 1, sourceNodeId: 5 }))).toBeNull();
  });
  it('normalizes missing/invalid config sub-fields to safe defaults', () => {
    const raw = JSON.stringify({
      ...DATA,
      config: { sections: ['definition', 42, 'anatomy'], anatomyView: 'bogus' },
    });
    const parsed = parseDocLink(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.config).toEqual({
      sections: ['definition', 'anatomy'], // non-string dropped
      variantIds: [],                       // missing → default
      aiEnabled: false,                     // missing → default
      anatomyView: 'diagram',               // all links normalize to diagram
      measureViews: [],                     // missing → default
    });
  });
  it('normalizes legacy anatomy table/both links to diagram', () => {
    const raw = JSON.stringify({
      ...DATA,
      config: { ...DATA.config, anatomyView: 'both' },
    });
    expect((parseDocLink(raw) as ComponentDocLink).config.anatomyView).toBe('diagram');
  });
  it('drops invalid measureViews entries but keeps valid ones', () => {
    const raw = JSON.stringify({
      ...DATA,
      config: { ...DATA.config, measureViews: ['size', 'nope', 'spacing'] },
    });
    expect((parseDocLink(raw) as ComponentDocLink).config.measureViews).toEqual(['size', 'spacing']);
  });
});

describe('registry', () => {
  it('parses empty/garbage to an empty registry', () => {
    expect(parseRegistry('')).toEqual({ v: 1, docIds: [] });
    expect(parseRegistry('{oops')).toEqual({ v: 1, docIds: [] });
  });
  it('round-trips and add is idempotent', () => {
    let r = parseRegistry(serializeRegistry({ v: 1, docIds: ['a'] }));
    r = addDoc(r, 'b');
    r = addDoc(r, 'b'); // no dup
    expect(r.docIds).toEqual(['a', 'b']);
  });
  it('removeDoc drops the id', () => {
    expect(removeDoc({ v: 1, docIds: ['a', 'b'] }, 'a').docIds).toEqual(['b']);
  });
  it('pruneRegistry keeps only surviving ids (self-heal)', () => {
    expect(pruneRegistry({ v: 1, docIds: ['a', 'b', 'c'] }, new Set(['b'])).docIds).toEqual(['b']);
  });
});

describe('textContentHash', () => {
  it('is order-sensitive and stable', () => {
    const h = textContentHash(['One', 'Two']);
    expect(h).toBe(textContentHash(['One', 'Two']));
    expect(h).not.toBe(textContentHash(['Two', 'One']));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('resolveStatus (priority: orphaned > updateAvailable > edited > inSync)', () => {
  const f = (o: Partial<{ e: boolean; d: boolean; s: boolean }>) => ({
    sourceExists: o.e ?? true, sourceDrifted: o.d ?? false, selfEdited: o.s ?? false,
  });
  it('orphaned when source gone (even if drifted+edited)', () => {
    expect(resolveStatus(f({ e: false, d: true, s: true }))).toBe('orphaned');
  });
  it('updateAvailable outranks edited', () => {
    expect(resolveStatus(f({ d: true, s: true }))).toBe('updateAvailable');
  });
  it('edited when only edited', () => {
    expect(resolveStatus(f({ s: true }))).toBe('edited');
  });
  it('inSync when all clear', () => {
    expect(resolveStatus(f({}))).toBe('inSync');
  });
});

const FOUNDATION: FoundationDocLink = {
  v: 1, kind: 'foundation',
  scope: {
    target: 'collection', collectionId: 'c1', collectionName: 'Semantic',
    modeIds: ['s1', 's2'],
  },
  contentHash: 'fhash', selfHash: 'fself',
  config: { includeDescriptions: true, aiNotes: false },
  generatedAt: 1720000000000, pluginVersion: '3.0.0',
};

describe('docLink foundation variant', () => {
  it('round-trips a foundation link', () => {
    expect(parseDocLink(serializeDocLink(FOUNDATION))).toEqual(FOUNDATION);
  });

  it('round-trips a text-styles scope', () => {
    const d: FoundationDocLink = { ...FOUNDATION, scope: { target: 'textStyles', group: 'Heading' } };
    expect(parseDocLink(serializeDocLink(d))).toEqual(d);
  });

  it('parses a legacy blob with no kind exactly as a component link', () => {
    const legacy = parseDocLink(serializeDocLink(DATA));
    expect(legacy).toEqual(DATA);
    expect(isFoundationLink(legacy!)).toBe(false);
    expect(legacy && 'kind' in legacy && legacy.kind).toBeFalsy();
  });

  it('narrows with isFoundationLink', () => {
    expect(isFoundationLink(FOUNDATION)).toBe(true);
    expect(isFoundationLink(DATA)).toBe(false);
  });

  it('rejects a foundation blob with an unknown scope target', () => {
    const raw = JSON.stringify({ ...FOUNDATION, scope: { target: 'bogus' } });
    expect(parseDocLink(raw)).toBeNull();
  });

  it('rejects a foundation blob with a missing scope', () => {
    const noScope = { ...FOUNDATION } as Record<string, unknown>;
    delete noScope.scope;
    expect(parseDocLink(JSON.stringify(noScope))).toBeNull();
  });

  it('rejects a collection scope with a non-string collectionId', () => {
    const raw = JSON.stringify({
      ...FOUNDATION,
      scope: { target: 'collection', collectionId: 7, collectionName: 'X', modeIds: [] },
    });
    expect(parseDocLink(raw)).toBeNull();
  });

  it('filters non-string modeIds instead of rejecting the blob', () => {
    const raw = JSON.stringify({
      ...FOUNDATION,
      scope: { ...FOUNDATION.scope, modeIds: ['s1', 42, 's2'] },
    });
    const parsed = parseDocLink(raw);
    expect(parsed).not.toBeNull();
    expect(isFoundationLink(parsed!) && parsed.scope.target === 'collection'
      && parsed.scope.modeIds).toEqual(['s1', 's2']);
  });

  it('normalizes missing foundation config fields to safe defaults', () => {
    const raw = JSON.stringify({ ...FOUNDATION, config: {} });
    const parsed = parseDocLink(raw);
    expect(isFoundationLink(parsed!) && parsed.config)
      .toEqual({ includeDescriptions: true, aiNotes: false });
  });

  it('does not require sourceNodeId on a foundation blob', () => {
    const raw = JSON.stringify(FOUNDATION);
    expect(raw).not.toContain('sourceNodeId');
    expect(parseDocLink(raw)).not.toBeNull();
  });
});

describe('foundationScopeKey', () => {
  it('keys a collection scope by collection id and group', () => {
    expect(foundationScopeKey({ target: 'collection', collectionId: 'c1', collectionName: 'Semantic', modeIds: [] }))
      .toBe('coll:c1:');
    expect(foundationScopeKey({ target: 'collection', collectionId: 'c1', collectionName: 'Semantic', group: 'color', modeIds: [] }))
      .toBe('coll:c1:color');
  });

  it('keys a text-styles scope by group alone, distinct from any collection key', () => {
    expect(foundationScopeKey({ target: 'textStyles' })).toBe('text:');
    expect(foundationScopeKey({ target: 'textStyles', group: 'Heading' })).toBe('text:Heading');
  });

  it('treats two collection scopes with the same id but different groups as distinct', () => {
    const a = foundationScopeKey({ target: 'collection', collectionId: 'c1', collectionName: 'X', group: 'color', modeIds: [] });
    const b = foundationScopeKey({ target: 'collection', collectionId: 'c1', collectionName: 'X', group: 'spacing', modeIds: [] });
    expect(a).not.toBe(b);
  });

  it('is stable regardless of collectionName or modeIds, which are not part of identity', () => {
    const a = foundationScopeKey({ target: 'collection', collectionId: 'c1', collectionName: 'Old name', modeIds: ['m1'] });
    const b = foundationScopeKey({ target: 'collection', collectionId: 'c1', collectionName: 'New name', modeIds: ['m1', 'm2'] });
    expect(a).toBe(b);
  });
});

describe('retargetScope', () => {
  const scope = {
    target: 'collection' as const,
    collectionId: 'dead', collectionName: 'Semantic', modeIds: ['m1'],
  };

  it('leaves a scope alone when its collection id still resolves', () => {
    const live = [{ id: 'dead', name: 'Renamed since' }, { id: 'other', name: 'Semantic' }];
    expect(retargetScope(scope, live)).toBe(scope);
  });

  it('retargets to the one live collection sharing the stored name', () => {
    const live = [{ id: 'fresh', name: 'Semantic' }, { id: 'other', name: 'Primitives' }];
    expect(retargetScope(scope, live)).toEqual({ ...scope, collectionId: 'fresh' });
  });

  it('refuses to guess when two live collections share the stored name', () => {
    // Figma allows duplicate collection names. The documented collection may
    // simply be gone, so binding to one of these at random would rebuild the
    // doc from unrelated variables and stamp the wrong id in.
    const live = [{ id: 'a', name: 'Semantic' }, { id: 'b', name: 'Semantic' }];
    expect(retargetScope(scope, live)).toBe(scope);
  });

  it('leaves the scope unresolved when no live collection matches the name', () => {
    expect(retargetScope(scope, [{ id: 'a', name: 'Primitives' }])).toBe(scope);
    expect(retargetScope(scope, [])).toBe(scope);
  });

  it('never touches a text-styles scope', () => {
    const text = { target: 'textStyles' as const, group: 'Heading' };
    expect(retargetScope(text, [{ id: 'a', name: 'Heading' }])).toBe(text);
  });
});

const PROSE: ProseDrafts = {
  definition: 'A button triggers an action.',
  accessibility: 'Always give it an accessible name.',
  dos: ['Use sentence case.'],
  donts: ['Do not nest buttons.'],
  interactions: 'Hover raises the surface.',
};

describe('prose storage', () => {
  it('uses a key distinct from the doc link, so the library scan never reads it', () => {
    expect(DOC_PROSE_KEY).not.toBe('specLayerDoc');
  });

  it('round-trips every populated field', () => {
    expect(parseProse(serializeProse(PROSE))).toEqual(PROSE);
  });

  it('returns null for absent or unparseable data rather than throwing', () => {
    expect(parseProse('')).toBeNull();
    expect(parseProse('not json')).toBeNull();
    expect(parseProse('[]')).toBeNull();
  });

  it('drops a payload over budget rather than writing a truncated document', () => {
    const huge: ProseDrafts = { ...PROSE, definition: 'x'.repeat(PROSE_BUDGET_BYTES + 1) };
    expect(serializeProse(huge)).toBe('');
  });

  it('logs the drop instead of dropping silently, naming the size and the budget', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const huge: ProseDrafts = { ...PROSE, definition: 'x'.repeat(PROSE_BUDGET_BYTES + 1) };
      serializeProse(huge);
      expect(warn).toHaveBeenCalledTimes(1);
      const [message] = warn.mock.calls[0];
      expect(message).toContain(String(PROSE_BUDGET_BYTES));
      expect(message).toMatch(/\d+ bytes/);
    } finally {
      warn.mockRestore();
    }
  });

  it('works in a realm with no TextEncoder, which is the Figma main thread', () => {
    // serializeProse is called ONLY from main.ts, which runs in Figma's plugin
    // sandbox: a bare JS realm with the figma API and no browser globals. Node
    // provides TextEncoder, so every other test in this file exercises the
    // function in a realm it never actually ships to. Deleting the global is
    // the only way a Node test can reproduce the sandbox.
    const g = globalThis as Record<string, unknown>;
    const saved = g.TextEncoder;
    delete g.TextEncoder;
    try {
      expect(() => serializeProse(PROSE)).not.toThrow();
      expect(parseProse(serializeProse(PROSE))).toEqual(PROSE);
    } finally {
      g.TextEncoder = saved;
    }
  });

  it('counts UTF-8 bytes, not UTF-16 units, for multi-byte and astral text', () => {
    // The budget is a BYTE budget because Figma stores pluginData as UTF-8.
    // Measuring string length instead would let a payload of emoji or CJK sail
    // past a limit it actually exceeds by up to 4x.
    const g = globalThis as Record<string, unknown>;
    const saved = g.TextEncoder;
    delete g.TextEncoder;
    try {
      // Each rocket is 4 UTF-8 bytes but only 2 UTF-16 units, so a string of
      // them sized to just clear the budget in bytes must be dropped.
      const rockets = '\u{1F680}'.repeat(Math.ceil(PROSE_BUDGET_BYTES / 4) + 10);
      expect(serializeProse({ ...PROSE, definition: rockets })).toBe('');
      // A 3-byte-per-char CJK string just under budget must survive.
      const cjk = '\u4e2d'.repeat(Math.floor(PROSE_BUDGET_BYTES / 3) - 200);
      expect(serializeProse({ ...PROSE, definition: cjk })).not.toBe('');
    } finally {
      g.TextEncoder = saved;
    }
  });

  it('does not log anything for a payload within budget', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      serializeProse(PROSE);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('omits absent optional keys instead of writing empty strings', () => {
    const minimal: ProseDrafts = { definition: 'D', accessibility: 'A', dos: [], donts: [] };
    const parsed = parseProse(serializeProse(minimal));
    expect(parsed).toEqual(minimal);
    expect(parsed && 'interactions' in parsed).toBe(false);
  });
});
