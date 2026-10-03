import { describe, it, expect } from 'vitest';
import {
  planSync, nextAnnotations, annotationFor, annotationOf, countPlan,
  type SyncFacts, type SyncOptions,
} from '../src/syncPlan';
import { annotationHash, bodyHash, descriptionHash, type SyncRecord, type AnnotationLike } from '../src/syncRecord';
import type { DescriptionText } from '../src/syncText';

const TEXT: DescriptionText = { body: 'Body', markdown: 'Body\n\nWritten in Spec Layer · d', origin: 'authored' };
const MANUAL: SyncOptions = { replaceEdited: false, auto: false };
const REPLACE: SyncOptions = { replaceEdited: true, auto: false };
const AUTO: SyncOptions = { replaceEdited: false, auto: true };
const LINK = 'https://www.figma.com/design/K/?node-id=9-9';
const SPEC = { label: '1 Icon', properties: ['cornerRadius'] };

function facts(over: Partial<SyncFacts> = {}): SyncFacts {
  return {
    docId: '9:9', nodeId: '1:1', name: 'Button', liveDescription: '', liveLinks: [], record: null,
    description: TEXT, link: LINK, layers: [{ nodeId: '1:2', live: [], proposed: SPEC }], ...over,
  };
}
function record(over: Partial<SyncRecord> = {}): SyncRecord {
  return {
    v: 1, syncedAt: 1, pluginVersion: 'x',
    description: { hash: descriptionHash('Old ours'), bodyHash: bodyHash('Old'), origin: 'authored' },
    annotations: [], ...over,
  };
}

describe('description', () => {
  it('writes into an empty description on the first sync', () => {
    expect(planSync(facts(), MANUAL).description).toEqual({ action: 'write', origin: 'authored' });
  });
  it('keeps a description a person wrote before any sync', () => {
    expect(planSync(facts({ liveDescription: 'Mine' }), MANUAL).description)
      .toMatchObject({ action: 'keep', reason: 'writtenBeforeSync' });
  });
  it('replaces its own description when the doc text changed', () => {
    expect(planSync(facts({ liveDescription: 'Old ours', record: record() }), MANUAL).description.action).toBe('write');
  });
  it('writes nothing when its own description already carries this text', () => {
    const r = record({ description: { hash: descriptionHash('Old ours'), bodyHash: bodyHash('Body'), origin: 'authored' } });
    expect(planSync(facts({ liveDescription: 'Old ours', record: r }), MANUAL).description.action).toBe('same');
  });
  it('keeps a description edited after the last sync, including a cleared one', () => {
    for (const live of ['Edited', '']) {
      expect(planSync(facts({ liveDescription: live, record: record() }), MANUAL).description)
        .toMatchObject({ action: 'keep', reason: 'editedInFigma' });
    }
  });
  it('replaces edits only in the confirmed replace run', () => {
    expect(planSync(facts({ liveDescription: 'Edited', record: record() }), REPLACE).description.action).toBe('write');
  });
  it('skips when the doc has no Usage text', () => {
    expect(planSync(facts({ description: null }), MANUAL).description).toEqual({ action: 'skip', reason: 'nothingToWrite' });
  });
});

describe('automatic runs', () => {
  it('only refresh components a manual sync already owns', () => {
    expect(planSync(facts(), AUTO).description).toMatchObject({ action: 'skip', reason: 'notSyncedYet' });
    expect(planSync(facts(), AUTO).link).toMatchObject({ action: 'skip', reason: 'notSyncedYet' });
    expect(planSync(facts(), AUTO).layers[0]).toMatchObject({ action: 'skip', reason: 'notSyncedYet' });
  });
  it('never write AI text nobody has reviewed', () => {
    const f = facts({ liveDescription: 'Old ours', record: record(), description: { ...TEXT, origin: 'ai' } });
    expect(planSync(f, AUTO).description).toMatchObject({ action: 'skip', reason: 'aiNotReviewed' });
  });
  it('write authored text over their own description', () => {
    expect(planSync(facts({ liveDescription: 'Old ours', record: record() }), AUTO).description.action).toBe('write');
  });
  it('never replace an edit, even when asked to', () => {
    expect(planSync(facts({ liveDescription: 'Edited', record: record() }), { auto: true, replaceEdited: true }).description.action).toBe('skip');
  });
});

describe('documentation link', () => {
  it('skips without a file link', () => {
    expect(planSync(facts({ link: null }), MANUAL).link).toEqual({ action: 'skip', reason: 'noFileLink' });
  });
  it('writes into an empty field or over its own older link', () => {
    expect(planSync(facts(), MANUAL).link.action).toBe('write');
    const r = record({ link: { uri: 'https://old' } });
    expect(planSync(facts({ liveLinks: ['https://old'], record: r }), MANUAL).link.action).toBe('write');
  });
  it('keeps a link someone else set, and is same when it already matches', () => {
    expect(planSync(facts({ liveLinks: ['https://zeroheight'] }), MANUAL).link).toMatchObject({ action: 'keep' });
    expect(planSync(facts({ liveLinks: [LINK] }), MANUAL).link.action).toBe('same');
  });
});

describe('annotations', () => {
  const ours = { ...annotationOf({ label: '1 Old', properties: [] }) };
  const theirs: AnnotationLike = { label: 'Designer note' };
  it('appends next to a designer annotation', () => {
    const p = planSync(facts({ layers: [{ nodeId: '1:2', live: [theirs], proposed: SPEC }] }), MANUAL).layers[0];
    expect(p).toMatchObject({ action: 'write', ownIndex: -1 });
    expect(nextAnnotations([theirs], p, annotationOf)).toEqual([theirs, annotationOf(SPEC)]);
  });
  it('replaces its own annotation in place, keeping the others', () => {
    const r = record({ annotations: [{ nodeId: '1:2', hash: annotationHash(ours) }] });
    const p = planSync(facts({ record: r, layers: [{ nodeId: '1:2', live: [theirs, ours], proposed: SPEC }] }), MANUAL).layers[0];
    expect(p).toMatchObject({ action: 'write', ownIndex: 1 });
    expect(nextAnnotations([theirs, ours], p, annotationOf)).toEqual([theirs, annotationOf(SPEC)]);
  });
  it('adopts an identical annotation instead of adding a copy', () => {
    const p = planSync(facts({ layers: [{ nodeId: '1:2', live: [annotationOf(SPEC)], proposed: SPEC }] }), MANUAL).layers[0];
    expect(p).toMatchObject({ action: 'same', ownIndex: 0 });
  });
  it('does not recreate an annotation a designer removed, unless replacing', () => {
    const r = record({ annotations: [{ nodeId: '1:2', hash: annotationHash(ours) }] });
    const f = facts({ record: r, layers: [{ nodeId: '1:2', live: [theirs], proposed: SPEC }] });
    expect(planSync(f, MANUAL).layers[0]).toMatchObject({ action: 'keep', reason: 'removedInFigma' });
    expect(planSync(f, REPLACE).layers[0].action).toBe('write');
  });
});

describe('annotationFor', () => {
  it('pins only properties the layer has, and types no number', () => {
    expect(annotationFor({ label: '1', name: 'Label', type: 'TEXT', autoLayout: false, hasRadius: false }))
      .toEqual({ label: '1 Label', properties: ['fontSize', 'lineHeight'] });
    expect(annotationFor({ type: 'COMPONENT', autoLayout: true, hasRadius: true }))
      .toEqual({ label: '', properties: ['padding', 'itemSpacing', 'cornerRadius'] });
    expect(annotationFor({ label: '2', name: 'Icon', shownBy: 'Has icon', type: 'INSTANCE', autoLayout: false, hasRadius: false }))
      .toEqual({ label: '2 Icon · shown by Has icon', properties: ['mainComponent'] });
  });
  it('is null for a root with nothing to pin', () => {
    expect(annotationFor({ type: 'COMPONENT', autoLayout: false, hasRadius: false })).toBeNull();
  });
  it('sends no label key for a properties-only annotation', () => {
    expect(annotationOf({ label: '', properties: ['padding'] })).toEqual({ properties: [{ type: 'padding' }] });
  });
});

describe('countPlan', () => {
  it('counts writes, AI text and kept edits per component', () => {
    const a = planSync(facts({ description: { ...TEXT, origin: 'mixed' } }), MANUAL);
    const b = planSync(facts({ name: 'Input', liveDescription: 'Mine', link: null, layers: [] }), MANUAL);
    expect(countPlan([a, b])).toEqual({
      components: 2, descriptions: 1, links: 1, annotations: 1,
      edited: ['Input'], aiWritten: ['Button'], noWrites: 1,
    });
  });
});
