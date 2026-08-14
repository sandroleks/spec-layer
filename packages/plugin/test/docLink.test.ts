import { describe, it, expect } from 'vitest';
import { EXTRACTOR_VERSION } from '@spec-layer/extractor';
import {
  serializeDocLink, parseDocLink, serializeRegistry, parseRegistry,
  addDoc, removeDoc, pruneRegistry, textContentHash, resolveStatus,
  isFoundationLink, foundationScopeKey, retargetScope,
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
