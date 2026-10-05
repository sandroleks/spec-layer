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
    description: TEXT, link: LINK, layers: [{ nodeId: '1:2', live: [], proposed: SPEC }],
    orphans: [], categoryId: 'cat', legendCurrent: true, ...over,
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
  it('clears its own description once the doc has no Usage text, never a person’s', () => {
    expect(planSync(facts({ description: null, liveDescription: 'Old ours', record: record() }), MANUAL).description)
      .toEqual({ action: 'clear' });
    expect(planSync(facts({ description: null, liveDescription: 'Old ours', record: record() }), AUTO).description)
      .toEqual({ action: 'clear' });
    expect(planSync(facts({ description: null, liveDescription: 'Mine', record: record() }), MANUAL).description)
      .toEqual({ action: 'skip', reason: 'nothingToWrite' });
  });
  it('rewrites the same words when the provenance they need changed', () => {
    const r = record({ description: { hash: descriptionHash('Old ours'), bodyHash: bodyHash('Body'), origin: 'ai' } });
    expect(planSync(facts({ liveDescription: 'Old ours', record: r }), MANUAL).description)
      .toEqual({ action: 'write', origin: 'authored' });
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
  it('never add a link a manual run did not write', () => {
    expect(planSync(facts({ record: record() }), AUTO).link).toEqual({ action: 'skip', reason: 'notSyncedYet' });
    expect(planSync(facts({ record: record(), liveLinks: ['https://storybook'] }), AUTO).link)
      .toEqual({ action: 'skip', reason: 'notSyncedYet' });
  });
  it('refresh their own link', () => {
    const r = record({ link: { uri: 'https://old' } });
    expect(planSync(facts({ record: r, liveLinks: ['https://old'] }), AUTO).link).toEqual({ action: 'write' });
  });
});

describe('held values', () => {
  const edited = record({ annotations: [{ nodeId: '1:2', hash: annotationHash({ label: '1 Gone' }) }] });
  const heldFacts = facts({ liveDescription: 'Edited', record: edited });

  it('name the same held state with the same key in manual and automatic runs', () => {
    const manual = planSync(heldFacts, MANUAL);
    const auto = planSync(heldFacts, AUTO);
    expect(manual.heldKey).toBeDefined();
    expect(auto.heldKey).toBe(manual.heldKey);
  });
  it('change key when a person edits again', () => {
    expect(planSync(facts({ liveDescription: 'Edited twice', record: edited }), AUTO).heldKey)
      .not.toBe(planSync(heldFacts, AUTO).heldKey);
  });
  it('leave text written before any sync out, since automatic runs never hold it', () => {
    expect(planSync(facts({ liveDescription: 'Mine' }), MANUAL).heldKey).toBeUndefined();
    expect(planSync(facts(), MANUAL).heldKey).toBeUndefined();
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
    expect(planSync(facts({ liveLinks: ['https://zeroheight'] }), MANUAL).link)
      .toEqual({ action: 'keep', reason: 'writtenBeforeSync' });
    expect(planSync(facts({ liveLinks: [LINK] }), MANUAL).link.action).toBe('same');
  });
  it('keeps a link someone removed after the sync wrote it, unless replacing', () => {
    const r = record({ link: { uri: 'https://old' } });
    expect(planSync(facts({ record: r }), MANUAL).link).toEqual({ action: 'keep', reason: 'removedInFigma' });
    expect(planSync(facts({ record: r }), AUTO).link).toEqual({ action: 'skip', reason: 'removedInFigma' });
    expect(planSync(facts({ record: r }), REPLACE).link).toEqual({ action: 'write' });
  });
  it('keeps a link someone changed after the sync wrote it', () => {
    const r = record({ link: { uri: 'https://old' } });
    expect(planSync(facts({ record: r, liveLinks: ['https://zeroheight'] }), MANUAL).link)
      .toEqual({ action: 'keep', reason: 'editedInFigma' });
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
  it('adopts an identical annotation in its own category instead of adding a copy', () => {
    const twin = { ...annotationOf(SPEC), categoryId: 'cat' };
    const p = planSync(facts({ layers: [{ nodeId: '1:2', live: [twin], proposed: SPEC }] }), MANUAL).layers[0];
    expect(p).toMatchObject({ action: 'same', ownIndex: 0 });
  });
  it('leaves a person’s identical annotation as theirs: no copy, and no claim on it', () => {
    const p = planSync(facts({ layers: [{ nodeId: '1:2', live: [annotationOf(SPEC)], proposed: SPEC }] }), MANUAL).layers[0];
    expect(p).toMatchObject({ action: 'same', ownIndex: -1 });
  });
  it('does not recreate an annotation a designer removed, unless replacing', () => {
    const r = record({ annotations: [{ nodeId: '1:2', hash: annotationHash(ours) }] });
    const f = facts({ record: r, layers: [{ nodeId: '1:2', live: [theirs], proposed: SPEC }] });
    expect(planSync(f, MANUAL).layers[0]).toMatchObject({ action: 'keep', reason: 'removedInFigma' });
    expect(planSync(f, REPLACE).layers[0].action).toBe('write');
  });
  it('treats its own annotation edited in Figma as edited, and replaces it in place', () => {
    const r = record({ annotations: [{ nodeId: '1:2', hash: annotationHash(ours) }] });
    const editedOurs = { label: '1 Old, edited', categoryId: 'cat' };
    const f = facts({ record: r, layers: [{ nodeId: '1:2', live: [theirs, editedOurs], proposed: SPEC }] });
    expect(planSync(f, MANUAL).layers[0]).toMatchObject({ action: 'keep', reason: 'editedInFigma', ownIndex: 1 });
    const replace = planSync(f, REPLACE).layers[0];
    expect(replace).toMatchObject({ action: 'write', ownIndex: 1 });
    expect(nextAnnotations([theirs, editedOurs], replace, annotationOf)).toEqual([theirs, annotationOf(SPEC)]);
  });
  it('compares the proposal with the last proposal, so a normalized read-back is still same', () => {
    const readBack: AnnotationLike = { labelMarkdown: '1 Icon\\_left', properties: [{ type: 'cornerRadius' }] };
    const spec = { label: '1 Icon_left', properties: ['cornerRadius'] };
    const r = record({ annotations: [{ nodeId: '1:2', hash: annotationHash(readBack), proposed: annotationHash(annotationOf(spec)) }] });
    const p = planSync(facts({ record: r, layers: [{ nodeId: '1:2', live: [readBack], proposed: spec }] }), MANUAL).layers[0];
    expect(p).toMatchObject({ action: 'same', ownIndex: 0 });
  });
});

describe('annotations that left the legend', () => {
  const ours: AnnotationLike = { label: '2 Icon', properties: [{ type: 'mainComponent' }] };
  const r = record({ annotations: [{ nodeId: '1:3', hash: annotationHash(ours) }] });
  it('removes its own annotation from a layer the doc no longer numbers', () => {
    const p = planSync(facts({ record: r, orphans: [{ nodeId: '1:3', live: [{ label: 'Note' }, ours] }] }), AUTO);
    expect(p.orphans).toEqual([{ nodeId: '1:3', action: 'remove', ownIndex: 1 }]);
  });
  it('neither places nor removes an annotation while the doc’s legend is out of date', () => {
    const p = planSync(facts({
      record: r, liveDescription: 'Old ours', legendCurrent: false, orphans: [{ nodeId: '1:3', live: [ours] }],
    }), MANUAL);
    expect(p).toMatchObject({ updateFirst: true, layers: [], orphans: [] });
    expect(p.description.action).toBe('write');
    expect(countPlan([p])).toMatchObject({ annotations: 0, removed: 0, updateFirst: ['Button'] });
  });
  it('forgets an annotation a person edited or a layer that is gone, writing nothing', () => {
    expect(planSync(facts({ record: r, orphans: [{ nodeId: '1:3', live: [{ label: '2 Icon, edited' }] }] }), MANUAL).orphans)
      .toEqual([{ nodeId: '1:3', action: 'drop', ownIndex: -1 }]);
    expect(planSync(facts({ record: r, orphans: [{ nodeId: '1:3', live: null }] }), MANUAL).orphans)
      .toEqual([{ nodeId: '1:3', action: 'drop', ownIndex: -1 }]);
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
  it('pins a grid’s gaps, not item spacing', () => {
    expect(annotationFor({ type: 'FRAME', autoLayout: true, grid: true, hasRadius: false }))
      .toEqual({ label: '', properties: ['padding', 'gridRowGap', 'gridColumnGap'] });
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
      components: 2, descriptions: 1, cleared: 0, links: 1, annotations: 1, removed: 0,
      edited: ['Input'], aiWritten: ['Button'], keptAi: [], updateFirst: [],
    });
  });
  it('names AI text that a replace would write over a kept description', () => {
    const kept = planSync(facts({ liveDescription: 'Mine', description: { ...TEXT, origin: 'ai' }, link: null, layers: [] }), MANUAL);
    expect(countPlan([kept])).toMatchObject({ edited: ['Button'], keptAi: ['Button'], aiWritten: [] });
  });
  it('counts cleared descriptions and removed annotations', () => {
    const ours: AnnotationLike = { label: '2 Icon' };
    const r = record({ annotations: [{ nodeId: '1:3', hash: annotationHash(ours) }] });
    const p = planSync(facts({
      description: null, liveDescription: 'Old ours', record: r, link: null, layers: [],
      orphans: [{ nodeId: '1:3', live: [ours] }],
    }), MANUAL);
    expect(countPlan([p])).toMatchObject({ descriptions: 0, cleared: 1, annotations: 0, removed: 1 });
  });
});
