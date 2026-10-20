import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '../src/messages';
import type { LibraryDriftState } from '../src/ui/viewModel/library';
import type { WritingGap } from '../src/writingGaps';
import { writeKey } from '../src/descriptionWriter';
import { writingCount } from '../src/ui/writingCopy';
import {
  buildWritingModel, closedTasks, docTaskKey, openTasks, type TaskRef, taskTitle, taskCaption, writingTaskKey,
  writingTaskKnown,
} from '../src/ui/viewModel/writing';

const NOW = Date.UTC(2026, 9, 20, 12);
/** An override may set a field to undefined to leave it out, as an older link does. */
type EntryOver = { [K in keyof LibraryEntry]?: LibraryEntry[K] | undefined };
function entry(over: EntryOver = {}): LibraryEntry {
  const out: Record<string, unknown> = {
    docId: 'doc-1', kind: 'component', label: 'Button', componentName: 'Button', pageName: 'Components',
    sourceLabel: 'Components', generatedAt: NOW, sourceNodeId: '10:20', sourceExists: true, selfEdited: false,
    storedContentHash: 'h', unwrittenSections: [], sections: ['definition', 'whenToUse'], ...over,
  };
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  return out as unknown as LibraryEntry;
}
const gap = (over: Partial<WritingGap>): WritingGap => ({ kind: 'component', id: '10:20', name: 'Button', ...over });

describe('taskTitle and taskCaption', () => {
  it('name the task, never the mechanism', () => {
    expect(taskTitle(gap({}))).toBe('Description');
    expect(taskTitle(gap({ kind: 'slot', propertyName: 'Content#1:2', name: 'Button / Content' }))).toBe('Slot: Content');
    expect(taskTitle(gap({ kind: 'section', id: 'doc-1', sectionId: 'whenToUse', name: 'When to use' }))).toBe('When to use');
    expect(taskTitle(gap({ kind: 'variable', id: 'V1', name: 'color/surface', facts: ['Light = #FFF'] }))).toBe('color/surface');
    expect(taskCaption(gap({ kind: 'variable', id: 'V1', name: 'color/surface', facts: ['Light = #FFF', 'Dark = #111'] }))).toBe('Light = #FFF · Dark = #111');
    expect(taskCaption(gap({ kind: 'style', id: 'S1', name: 'Body', facts: ['typography'] }))).toBe('Typography');
    expect(taskCaption(gap({}))).toBeNull();
  });
});

describe('writingTaskKey and writingCount', () => {
  it('files a section under its doc and everything else under the write key', () => {
    const section = gap({ kind: 'section', id: 'doc-1', sectionId: 'whenToUse', name: 'When to use' });
    expect(writingTaskKey(section)).toBe('section:doc-1:whenToUse');
    const slot = gap({ kind: 'slot', propertyName: 'Content#1:2', name: 'Button / Content' });
    expect(writingTaskKey(slot)).toBe(writeKey({ kind: 'slot', id: '10:20', propertyName: 'Content#1:2' }));
    expect(writingTaskKey(gap({}))).toBe(writeKey({ kind: 'component', id: '10:20' }));
  });
  it('counts done of total', () => {
    expect(writingCount(1, 3)).toBe('1 of 3 done');
  });
});

describe('buildWritingModel', () => {
  it('groups open tasks per doc with a count, open first then done', () => {
    const e = entry({ unwrittenSections: ['whenToUse'] });
    const done = new Map<string, TaskRef>([[docTaskKey('doc-1', 'component:10:20'), { gap: gap({}), docId: 'doc-1' }]]);
    const model = buildWritingModel([e], {
      drift: new Map([['doc-1', 'inSync']]),
      componentGaps: new Map([['doc-1', [gap({ kind: 'slot', propertyName: 'Content#1:2', name: 'Button / Content' })]]]),
      done,
    });
    expect(model.groups).toHaveLength(1);
    const g = model.groups[0];
    expect(g.label).toBe('Button');
    expect(g.tasks.map((t) => [t.title, t.done])).toEqual([['Slot: Content', false], ['When to use', false], ['Description', true]]);
    expect(g.countLabel).toBe('1 of 3 done');
    expect(g.canDraft).toBe(true);
  });

  it('lists no group for a doc with nothing open and nothing done', () => {
    const model = buildWritingModel([entry()], { drift: new Map([['doc-1', 'inSync']]), componentGaps: new Map([['doc-1', []]]) });
    expect(model.groups).toEqual([]);
    expect(model.known).toBe(true);
  });

  it('is unknown while a check runs, for an older link, and for an unread doc', () => {
    const running = buildWritingModel([entry()], { drift: new Map([['doc-1', 'pending']]) });
    expect(running.known).toBe(false);
    expect(running.unknownReasons).toEqual(['Checks are still running.']);
    const older = buildWritingModel([entry({ unwrittenSections: undefined })], { drift: new Map([['doc-1', 'inSync']]), componentGaps: new Map([['doc-1', []]]) });
    expect(older.unknownReasons).toEqual(['Docs built before this version list their sections after an Update.']);
  });

  it('expands one task by key and attaches its draft', () => {
    const model = buildWritingModel([entry()], {
      drift: new Map([['doc-1', 'inSync']]),
      componentGaps: new Map([['doc-1', [gap({})]]]),
      drafts: new Map([['component:10:20', { text: 'Starts an action.', origin: 'ai' as const }]]),
      expandedKey: docTaskKey('doc-1', 'component:10:20'),
    });
    const task = model.groups[0].tasks[0];
    expect(task.expanded).toBe(true);
    expect(task.draft).toEqual({ text: 'Starts an action.', origin: 'ai' });
  });

  it('lists Foundation tasks within the row scope', () => {
    const e = entry({ docId: 'f', kind: 'foundation', label: 'Semantic', sourceNodeId: '', foundationScope: { target: 'textStyles' }, currentContentHash: 'h' });
    const spec = { fileKey: 'f', collections: [], textStyles: [{ id: 'S1', name: 'Body', group: 'Body', description: '' }], effectStyles: [], extractedAt: '' } as never;
    const model = buildWritingModel([e], { foundation: spec });
    expect(model.groups[0].tasks[0].title).toBe('Body');
  });
});

describe('done tasks', () => {
  const foundation = (docId: string, target: string, group?: string): LibraryEntry => entry({
    docId, kind: 'foundation', label: docId, sourceNodeId: '', currentContentHash: 'h',
    foundationScope: { target, ...(group ? { group } : {}) } as never,
  });
  const spec = { fileKey: 'f', collections: [], textStyles: [], effectStyles: [], extractedAt: '' } as never;

  it('lists a done variable under its own doc only, not under another Foundation doc', () => {
    const done = new Map<string, TaskRef>([[docTaskKey('a', 'variable:V1'), { gap: gap({ kind: 'variable', id: 'V1', name: 'color/surface' }), docId: 'a' }]]);
    const model = buildWritingModel([foundation('a', 'textStyles'), foundation('b', 'effectStyles')], { foundation: spec, done });
    expect(model.groups.map((g) => g.docId)).toEqual(['a']);
    expect(model.groups[0].countLabel).toBe('1 of 1 done');
  });

  it('carries no draft and never expands', () => {
    const g = gap({});
    const model = buildWritingModel([entry()], {
      drift: new Map([['doc-1', 'inSync']]), componentGaps: new Map([['doc-1', []]]),
      done: new Map([[docTaskKey('doc-1', 'component:10:20'), { gap: g, docId: 'doc-1' }]]),
      drafts: new Map([['component:10:20', { text: 'x', origin: 'person' as const }]]),
      expandedKey: docTaskKey('doc-1', 'component:10:20'),
    });
    const t = model.groups[0].tasks[0];
    expect(t.done).toBe(true);
    expect(t.draft).toBeNull();
    expect(t.expanded).toBe(false);
  });
});

describe('closedTasks and openTasks', () => {
  const ref = (id: string, docId: string): TaskRef => ({ gap: gap({ id }), docId });
  const docs = (...ids: string[]) => (r: TaskRef): boolean => ids.includes(r.docId);
  it('reports keys that were open and are gone while their state is known', () => {
    const before = new Map([['a', ref('a', 'doc-1')], ['b', ref('b', 'doc-1')]]);
    const after = new Map([['b', ref('b', 'doc-1')]]);
    expect([...closedTasks(before, after, docs('doc-1')).keys()]).toEqual(['a']);
  });
  it('ignores a key whose state is not known now', () => {
    const before = new Map([['a', ref('a', 'doc-1')], ['s', ref('s', 'doc-2')]]);
    expect(closedTasks(before, new Map(), docs()).size).toBe(0);
    expect([...closedTasks(before, new Map(), docs('doc-2')).keys()]).toEqual(['s']);
  });
  it('does not report a section key whose doc was removed', () => {
    const before = new Map([['section:gone:definition', ref('gone', 'gone')]]);
    expect(closedTasks(before, new Map(), writingTaskKnown([entry()], {})).size).toBe(0);
  });
  it('openTasks keys every open task by doc and key', () => {
    const model = buildWritingModel([entry()], { drift: new Map([['doc-1', 'inSync']]), componentGaps: new Map([['doc-1', [gap({})]]]) });
    const open = openTasks(model);
    expect([...open.keys()]).toEqual([docTaskKey('doc-1', 'component:10:20')]);
    expect(open.get(docTaskKey('doc-1', 'component:10:20'))?.docId).toBe('doc-1');
  });
  it('never builds a key with a NUL', () => {
    expect(docTaskKey('doc-1', 'component:10:20')).not.toContain('\u0000');
  });
});

describe('two docs listing one gap', () => {
  // A text styles doc and a group doc over the same styles list the same style.
  const spec = {
    fileKey: 'f', extractedAt: '', collections: [], effectStyles: [],
    textStyles: [{ id: 'S1', name: 'Body/Medium', group: 'Body', description: '' }],
  } as never;
  const doc = (docId: string, group?: string): LibraryEntry => entry({
    docId, kind: 'foundation', label: docId, sourceNodeId: '', currentContentHash: 'h',
    foundationScope: { target: 'textStyles', ...(group ? { group } : {}) } as never,
  });
  const entries = [doc('whole'), doc('body', 'Body')];
  const key = 'style:S1';

  it('lists it under both docs', () => {
    const model = buildWritingModel(entries, { foundation: spec });
    expect(model.groups.map((g) => [g.docId, g.tasks.map((t) => t.key)])).toEqual([['whole', [key]], ['body', [key]]]);
    expect([...openTasks(model).keys()]).toEqual([docTaskKey('whole', key), docTaskKey('body', key)]);
  });

  it('closing it under one doc leaves it open under the other', () => {
    // Two component docs for one component: one re-checked and no longer lists
    // the description, the other's check is still out.
    const twin = (docId: string) => entry({ docId, label: docId });
    const shared = gap({});
    const sharedKey = writingTaskKey(shared);
    const twins = [twin('one'), twin('two')];
    const before = openTasks(buildWritingModel(twins, {
      drift: new Map([['one', 'inSync'], ['two', 'inSync']]),
      componentGaps: new Map([['one', [shared]], ['two', [shared]]]),
    }));
    const options = {
      drift: new Map<string, LibraryDriftState>([['one', 'inSync'], ['two', 'pending']]),
      componentGaps: new Map([['one', []]]),
    };
    const closed = closedTasks(before, openTasks(buildWritingModel(twins, options)), writingTaskKnown(twins, options));
    expect([...closed.keys()]).toEqual([docTaskKey('one', sharedKey)]);
    // The second doc's check lands and still lists it: done under one, open under the other.
    const settled = buildWritingModel(twins, {
      drift: new Map([['one', 'inSync'], ['two', 'inSync']]),
      componentGaps: new Map([['one', []], ['two', [shared]]]),
      done: closed,
    });
    expect(settled.groups.map((g) => [g.docId, g.tasks.map((t) => t.done), g.countLabel])).toEqual([
      ['one', [true], '1 of 1 done'],
      ['two', [false], '0 of 1 done'],
    ]);
  });

  it('expands it under one doc only', () => {
    const model = buildWritingModel(entries, { foundation: spec, expandedKey: docTaskKey('body', key) });
    expect(model.groups.map((g) => [g.docId, g.tasks[0]?.expanded])).toEqual([['whole', false], ['body', true]]);
  });
});

describe('writingTaskKnown', () => {
  const spec = { fileKey: 'f', collections: [], textStyles: [], effectStyles: [], extractedAt: '' } as never;
  const ok = { drift: new Map<string, LibraryDriftState>([['a', 'inSync']]), componentGaps: new Map([['a', []]]) };
  const a = (over: EntryOver = {}) => entry({ docId: 'a', ...over });
  const field: TaskRef = { gap: gap({}), docId: 'a' };
  const section: TaskRef = { gap: gap({ kind: 'section', id: 'a', sectionId: 'whenToUse', name: 'When to use' }), docId: 'a' };
  it('knows a settled component doc with its gaps reply and section list', () => {
    expect(writingTaskKnown([a()], ok)(field)).toBe(true);
    expect(writingTaskKnown([a()], ok)(section)).toBe(true);
    expect(writingTaskKnown([a()], { ...ok, drift: new Map([['a', 'drifted']]) })(field)).toBe(true);
  });
  it('does not know a field under a pending, unavailable or rebuild-needed check', () => {
    for (const state of ['pending', 'unavailable', 'staleVersion'] as const) {
      expect(writingTaskKnown([a()], { ...ok, drift: new Map([['a', state]]) })(field)).toBe(false);
    }
  });
  it('does not know a field with no gaps entry or no source', () => {
    expect(writingTaskKnown([a()], { drift: ok.drift })(field)).toBe(false);
    expect(writingTaskKnown([a({ sourceExists: false })], ok)(field)).toBe(false);
  });
  it('knows a field of a doc built before the section list, but not its sections', () => {
    const older = writingTaskKnown([a({ unwrittenSections: undefined })], ok);
    expect(older(field)).toBe(true);
    expect(older(section)).toBe(false);
  });
  it('knows sections from the link alone, while the field check runs', () => {
    const running = writingTaskKnown([a()], { drift: new Map([['a', 'pending']]) });
    expect(running(section)).toBe(true);
    expect(running(field)).toBe(false);
  });
  it('knows a Foundation task only once the spec is set', () => {
    const f = entry({ docId: 'f', kind: 'foundation', sourceNodeId: '', foundationScope: { target: 'textStyles' } });
    const style: TaskRef = { gap: gap({ kind: 'style', id: 'S1', name: 'Body' }), docId: 'f' };
    expect(writingTaskKnown([f], {})(style)).toBe(false);
    expect(writingTaskKnown([f], { foundationLoading: true })(style)).toBe(false);
    expect(writingTaskKnown([f], { foundation: spec })(style)).toBe(true);
  });
  it('knows nothing of a doc that is gone', () => {
    expect(writingTaskKnown([], ok)(field)).toBe(false);
  });
  it('closes a saved description of an older doc once its re-check no longer lists it', () => {
    const older = a({ unwrittenSections: undefined });
    const before = openTasks(buildWritingModel([older], { ...ok, componentGaps: new Map([['a', [gap({})]]]) }));
    const after = buildWritingModel([older], ok);
    const closed = closedTasks(before, openTasks(after), writingTaskKnown([older], ok));
    expect([...closed.keys()]).toEqual([docTaskKey('a', 'component:10:20')]);
  });
});

describe('writing known state', () => {
  const settled = (docId: string) => entry({ docId, unwrittenSections: [] });
  const spec = { fileKey: 'f', collections: [], textStyles: [], effectStyles: [], extractedAt: '' } as never;
  const known = (entries: LibraryEntry[], options: Parameters<typeof buildWritingModel>[1]) => {
    const model = buildWritingModel(entries, options);
    return { known: model.known, reasons: model.unknownReasons };
  };
  const foundationRow = () => entry({ docId: 'f', kind: 'foundation', sourceNodeId: '', foundationScope: { target: 'textStyles' } });

  it('is known when every component row settled with its gaps and the Foundation spec is loaded', () => {
    expect(known([settled('a'), foundationRow()], {
      drift: new Map([['a', 'inSync']]), componentGaps: new Map([['a', []]]), foundation: spec,
    })).toEqual({ known: true, reasons: [] });
  });

  it('says checks are running while a row is pending or the Foundation dump is on its way', () => {
    expect(known([settled('a')], { drift: new Map([['a', 'pending']]) }))
      .toEqual({ known: false, reasons: ['Checks are still running.'] });
    expect(known([foundationRow()], { foundationLoading: true }))
      .toEqual({ known: false, reasons: ['Checks are still running.'] });
  });

  it('names a link that predates the section list', () => {
    expect(known([entry({ docId: 'a', unwrittenSections: undefined })], { drift: new Map([['a', 'inSync']]), componentGaps: new Map([['a', []]]) }))
      .toEqual({ known: false, reasons: ['Docs built before this version list their sections after an Update.'] });
  });

  it('names a failed check, a rebuild, a missing gaps reply and an unloaded Foundation as not read', () => {
    const unread = { known: false, reasons: ['Some docs could not be read.'] };
    expect(known([settled('a')], { drift: new Map([['a', 'unavailable']]) })).toEqual(unread);
    expect(known([settled('a')], { drift: new Map([['a', 'staleVersion']]) })).toEqual(unread);
    expect(known([settled('a')], { drift: new Map([['a', 'drifted']]) })).toEqual(unread);
    expect(known([foundationRow()], {})).toEqual(unread);
  });

  it('lists every reason once, in order', () => {
    const entries = [entry({ docId: 'a', unwrittenSections: undefined }), settled('b'), settled('c')];
    expect(known(entries, {
      drift: new Map<string, LibraryDriftState>([['a', 'inSync'], ['b', 'pending'], ['c', 'unavailable']]),
      componentGaps: new Map([['a', []]]),
    }).reasons).toEqual([
      'Checks are still running.',
      'Docs built before this version list their sections after an Update.',
      'Some docs could not be read.',
    ]);
  });

  it('reads only the link of a row whose source is gone', () => {
    expect(known([entry({ docId: 'a', sourceExists: false, unwrittenSections: [] })], {})).toEqual({ known: true, reasons: [] });
  });
});
