import { describe, it, expect } from 'vitest';
import {
  serializeDocLink, parseDocLink, serializeRegistry, parseRegistry,
  addDoc, removeDoc, pruneRegistry, textContentHash, resolveStatus,
  type DocLinkData,
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
  it('parseDocLink returns null on garbage / wrong shape / empty', () => {
    expect(parseDocLink('')).toBeNull();
    expect(parseDocLink('not json')).toBeNull();
    expect(parseDocLink(JSON.stringify({ v: 2 }))).toBeNull();
    expect(parseDocLink(JSON.stringify({ v: 1, sourceNodeId: 5 }))).toBeNull();
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
