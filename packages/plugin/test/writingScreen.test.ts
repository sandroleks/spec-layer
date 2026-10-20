import { describe, expect, it } from 'vitest';
import { writingScrollMarkup, writingFooterMarkup, type WritingScreenPresentation } from '../src/ui/screens/writing';
import { WRITING_EMPTY, WRITING_UNKNOWN_RUNNING, WRITING_FIELD_HINT, WRITING_FOOT } from '../src/ui/writingCopy';
import type { WritingGroup, WritingTask } from '../src/ui/viewModel/writing';

const task = (over: Partial<WritingTask>): WritingTask => ({
  key: 'component:10:20', gap: { kind: 'component', id: '10:20', name: 'Button' }, title: 'Description', caption: null,
  draft: null, done: false, expanded: false, ...over,
});
const group = (over: Partial<WritingGroup> = {}): WritingGroup => ({
  docId: 'doc-1', label: 'Button', kind: 'component', status: 'inSync', tasks: [task({})],
  openCount: 1, doneCount: 0, totalCount: 1, countLabel: '0 of 1 done', drafting: false, stale: false, canDraft: true, ...over,
});
const model = (over: Partial<WritingScreenPresentation> = {}): WritingScreenPresentation => ({
  groups: [group()], known: true, unknownReasons: [], openCount: 1, doneCount: 0, ...over,
});

describe('writing screen', () => {
  it('draws a group with its count and collapsed task rows', () => {
    const html = writingScrollMarkup(model());
    expect(html).toContain('data-writing-group="doc-1"');
    expect(html).toContain('0 of 1 done');
    expect(html).toContain('data-writing-toggle="component:10:20"');
    expect(html).not.toContain('sl-writing-field');
  });

  it('expands a description task into its field and a section task into Open in doc', () => {
    const open = task({ expanded: true, draft: { text: 'Starts an action.', origin: 'ai' } });
    const section = task({ key: 'section:doc-1:whenToUse', gap: { kind: 'section', id: 'doc-1', sectionId: 'whenToUse', name: 'When to use' }, title: 'When to use', expanded: true });
    const html = writingScrollMarkup(model({ groups: [group({ tasks: [open, section] })] }));
    expect(html).toContain(`placeholder="${WRITING_FIELD_HINT}"`);
    expect(html).toContain('value="Starts an action."');
    expect(html).toContain('sl-writing-ai-tag');
    expect(html).toContain('data-writing-clear="component:10:20"');
    expect(html).toContain('data-writing-open="whenToUse"');
    expect(html).toContain(WRITING_FOOT);
  });

  it('marks a done task and keeps it after the open ones', () => {
    const html = writingScrollMarkup(model({ groups: [group({ tasks: [task({}), task({ key: 'slot:10:20:Content#1:2', title: 'Slot: Content', done: true })] })] }));
    expect(html.indexOf('data-writing-toggle="component:10:20"')).toBeLessThan(html.indexOf('is-done'));
    expect(html).toMatch(/is-done[^>]*>[\s\S]*Slot: Content/);
  });

  it('claims nothing to write only when known', () => {
    expect(writingScrollMarkup(model({ groups: [] }))).toContain(WRITING_EMPTY);
    const unknown = writingScrollMarkup(model({ groups: [], known: false, unknownReasons: [WRITING_UNKNOWN_RUNNING] }));
    expect(unknown).toContain('None found in what could be read');
    expect(unknown).toContain(WRITING_UNKNOWN_RUNNING);
    expect(unknown).not.toContain(WRITING_EMPTY);
  });

  it('shows loading rows before the first scan', () => {
    expect(writingScrollMarkup(model({ groups: [], loading: true }))).toContain('sl-loading-rows');
  });

  it('disables Draft all while drafting and the footer Refresh while busy', () => {
    expect(writingScrollMarkup(model({ groups: [group({ drafting: true })] }))).toMatch(/data-writing-draft-all[^>]*disabled/);
    expect(writingFooterMarkup(model({ busy: true }))).toMatch(/data-library-refresh[^>]*disabled/);
  });
});
