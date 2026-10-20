import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '../src/messages';
import type { LibraryDriftState } from '../src/ui/viewModel/library';
import type { WritingGap } from '../src/writingGaps';
import { writeKey } from '../src/descriptionWriter';
import { writingCount } from '../src/ui/writingCopy';
import {
  buildWritingModel, closedTasks, knownDocIds, openTasks, type TaskRef, taskTitle, taskCaption, writingTaskKey,
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
    const done = new Map<string, TaskRef>([['component:10:20', { gap: gap({}), docId: 'doc-1' }]]);
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
    expect(model.openCount).toBe(2);
    expect(model.doneCount).toBe(1);
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
      expandedKey: 'component:10:20',
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
    const done = new Map<string, TaskRef>([['variable:V1', { gap: gap({ kind: 'variable', id: 'V1', name: 'color/surface' }), docId: 'a' }]]);
    const model = buildWritingModel([foundation('a', 'textStyles'), foundation('b', 'effectStyles')], { foundation: spec, done });
    expect(model.groups.map((g) => g.docId)).toEqual(['a']);
    expect(model.groups[0].countLabel).toBe('1 of 1 done');
    expect(model.doneCount).toBe(1);
  });

  it('carries no draft and never expands', () => {
    const g = gap({});
    const model = buildWritingModel([entry()], {
      drift: new Map([['doc-1', 'inSync']]), componentGaps: new Map([['doc-1', []]]),
      done: new Map([['component:10:20', { gap: g, docId: 'doc-1' }]]),
      drafts: new Map([['component:10:20', { text: 'x', origin: 'person' as const }]]),
      expandedKey: 'component:10:20',
    });
    const t = model.groups[0].tasks[0];
    expect(t.done).toBe(true);
    expect(t.draft).toBeNull();
    expect(t.expanded).toBe(false);
  });
});

describe('closedTasks and openTasks', () => {
  const ref = (id: string, docId: string): TaskRef => ({ gap: gap({ id }), docId });
  it('reports keys that were open and are gone while their doc is known', () => {
    const before = new Map([['a', ref('a', 'doc-1')], ['b', ref('b', 'doc-1')]]);
    const after = new Map([['b', ref('b', 'doc-1')]]);
    expect([...closedTasks(before, after, new Set(['doc-1'])).keys()]).toEqual(['a']);
  });
  it('ignores a key whose doc is not known now', () => {
    const before = new Map([['a', ref('a', 'doc-1')], ['s', ref('s', 'doc-2')]]);
    expect(closedTasks(before, new Map(), new Set()).size).toBe(0);
    expect([...closedTasks(before, new Map(), new Set(['doc-2'])).keys()]).toEqual(['s']);
  });
  it('does not report a section key whose doc was removed', () => {
    const before = new Map([['section:gone:definition', ref('gone', 'gone')]]);
    expect(closedTasks(before, new Map(), new Set(['doc-1'])).size).toBe(0);
  });
  it('openTasks keys every open task with its doc', () => {
    const model = buildWritingModel([entry()], { drift: new Map([['doc-1', 'inSync']]), componentGaps: new Map([['doc-1', [gap({})]]]) });
    const open = openTasks(model);
    expect([...open.keys()]).toEqual(['component:10:20']);
    expect(open.get('component:10:20')?.docId).toBe('doc-1');
  });
});

describe('knownDocIds', () => {
  const spec = { fileKey: 'f', collections: [], textStyles: [], effectStyles: [], extractedAt: '' } as never;
  const ok = { drift: new Map<string, LibraryDriftState>([['a', 'inSync']]), componentGaps: new Map([['a', []]]) };
  const a = (over: EntryOver = {}) => entry({ docId: 'a', ...over });
  it('counts a settled component doc with its gaps reply and section list', () => {
    expect([...knownDocIds([a()], ok)]).toEqual(['a']);
    expect(knownDocIds([a()], { ...ok, drift: new Map([['a', 'drifted']]) }).has('a')).toBe(true);
  });
  it('leaves out a pending, unavailable or rebuild-needed check', () => {
    for (const state of ['pending', 'unavailable', 'staleVersion'] as const) {
      expect(knownDocIds([a()], { ...ok, drift: new Map([['a', state]]) }).size).toBe(0);
    }
  });
  it('leaves out a doc with no gaps entry, no section list, or no source', () => {
    expect(knownDocIds([a()], { drift: ok.drift }).size).toBe(0);
    expect(knownDocIds([a({ unwrittenSections: undefined })], ok).size).toBe(0);
    expect(knownDocIds([a({ sourceExists: false })], ok).size).toBe(0);
  });
  it('counts a Foundation doc only once the spec is set', () => {
    const f = entry({ docId: 'f', kind: 'foundation', sourceNodeId: '', foundationScope: { target: 'textStyles' } });
    expect(knownDocIds([f], {}).size).toBe(0);
    expect(knownDocIds([f], { foundationLoading: true }).size).toBe(0);
    expect(knownDocIds([f], { foundation: spec }).has('f')).toBe(true);
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
