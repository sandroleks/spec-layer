import { describe, expect, it } from 'vitest';
import {
  writingFooterMarkup, writingHeaderMarkup, writingScrollMarkup, writingSublineText, type WritingScreenPresentation,
} from '../src/ui/screens/writing';
import {
  WRITING_AI_TAG, WRITING_CANVAS_HEADING, WRITING_CHECKING, WRITING_EMPTY, WRITING_EMPTY_HEADING, WRITING_FIELD_HINTS,
  WRITING_NO_DOCS_HEADING, WRITING_SAVING, WRITING_STALE, WRITING_UNKNOWN_HEADING, WRITING_UNKNOWN_RUNNING,
} from '../src/ui/writingCopy';
import type { WritingGroup, WritingTask } from '../src/ui/viewModel/writing';

const task = (over: Partial<WritingTask>): WritingTask => ({
  key: 'component:10:20', gap: { kind: 'component', id: '10:20', name: 'Button' }, title: 'Description', caption: null,
  tooltip: 'Button', swatches: [], draft: null, done: false, saving: null, error: null, ...over,
});
const variable = (over: Partial<WritingTask> = {}): WritingTask => task({
  key: 'variable:V1', gap: { kind: 'variable', id: 'V1', name: 'color/surface/light' }, title: 'light',
  caption: 'Light colors/blue/25 · Dark colors/blue/900', tooltip: 'color/surface/light\nLight = #F2F9FF (colors/blue/25)',
  swatches: [{ hex: '#F2F9FF', alpha: 1 }, { hex: '#002A4D', alpha: 0.5 }], ...over,
});
const section = task({
  key: 'section:doc-1:whenToUse', gap: { kind: 'section', id: 'doc-1', sectionId: 'whenToUse', name: 'When to use' }, title: 'When to use',
});
const group = (over: Partial<WritingGroup> = {}): WritingGroup => {
  const fields = over.fields ?? [{ heading: 'Button', tasks: [task({})] }];
  const sections = over.sections ?? [];
  const done = over.done ?? [];
  return {
    docId: 'doc-1', label: 'Button', countLabel: '0 of 1 written', drafting: false, stale: false,
    draftable: 1, unsaved: 0, doneOpen: false,
    tasks: [...fields.flatMap((run) => run.tasks), ...sections, ...done], fields, sections, done, ...over,
  };
};
const model = (over: Partial<WritingScreenPresentation> = {}): WritingScreenPresentation => ({
  groups: [group()], known: true, unknownReasons: [], noDocs: false,
  openFields: 1, openSections: 0, docsWithOpen: 1, unsaved: 0, ...over,
});

describe('to do header', () => {
  it('sums up what is left and when it was checked, with Refresh beside it', () => {
    const html = writingHeaderMarkup(model({ openFields: 79, openSections: 3, docsWithOpen: 2, checkedLabel: 'Checked just now' }));
    expect(html).toContain('<h1>To do</h1>');
    expect(html).toContain('79 descriptions and 3 sections left in 2 docs · Checked just now');
    expect(html).not.toContain('sl-writing-intro');
    expect(html).toMatch(/data-library-refresh[^>]*aria-label="Refresh"/);
    expect(writingHeaderMarkup(model({ busy: true }))).toMatch(/data-library-refresh[^>]*disabled/);
  });

  it('shows a running check by doc count', () => {
    expect(writingSublineText(model({ refreshing: true, checkProgress: { label: 'x', current: 2, total: 5 } })))
      .toBe('1 description left in 1 doc · Checking 2 of 5 docs…');
    expect(writingSublineText(model({ loading: true, groups: [] }))).toBe('');
  });
});

describe('to do explainer', () => {
  it('shows the card above the docs while open, with its info button expanded', () => {
    const html = writingScrollMarkup(model({ why: true }));
    expect(html).toContain('id="sl-writing-why"');
    expect(html).toContain('Why fill these in here?');
    expect(html).toContain('data-writing-why-dismiss');
    expect(html.indexOf('sl-writing-why"')).toBeLessThan(html.indexOf('data-writing-group'));
    expect(writingHeaderMarkup(model({ why: true }))).toMatch(/data-writing-why aria-label="Why fill these in here\?"[^>]*aria-controls="sl-writing-why" aria-expanded="true"/);
  });

  it('keeps only the info button once closed', () => {
    expect(writingScrollMarkup(model())).not.toContain('sl-writing-why"');
    expect(writingHeaderMarkup(model())).toContain('aria-expanded="false"');
  });
});

describe('to do rows', () => {
  it('draws every field open, under its path, with swatches and mode values', () => {
    const html = writingScrollMarkup(model({ groups: [group({ fields: [{ heading: 'color/surface', tasks: [variable()] }] })] }));
    expect(html).toContain('<h3 class="sl-writing-subhead" title="color/surface">color/surface</h3>');
    expect(html).toContain('<span class="sl-writing-title">light</span>');
    expect(html).toContain('Light colors/blue/25 · Dark colors/blue/900');
    expect(html).toContain('background-color: #F2F9FF"');
    expect(html).toContain('background-color: #002A4D80"');
    expect(html).toContain('title="color/surface/light\nLight = #F2F9FF (colors/blue/25)"');
    expect(html).toContain(`placeholder="${WRITING_FIELD_HINTS.variable}"`);
    expect(html).toContain('aria-label="color/surface/light"');
    expect(html).not.toContain('data-writing-toggle');
  });

  it('draws no swatch for anything but a plain hex', () => {
    const html = writingScrollMarkup(model({ groups: [group({ fields: [{ heading: null, tasks: [variable({ swatches: [{ hex: 'red;x:1', alpha: 1 }] })] }] })] }));
    expect(html).not.toContain('background-color');
  });

  it('names a component field by component and task, with its own hint', () => {
    const html = writingScrollMarkup(model());
    expect(html).toContain('aria-label="Button, Description"');
    expect(html).toContain(`placeholder="${WRITING_FIELD_HINTS.component}"`);
  });

  it('marks an AI draft without a text tag, and offers Discard only with a draft', () => {
    const empty = writingScrollMarkup(model());
    expect(empty).not.toContain('data-writing-clear=');
    const ai = writingScrollMarkup(model({ groups: [group({ fields: [{ heading: 'Button', tasks: [task({ draft: { text: 'Starts an action.', origin: 'ai' } })] }] })] }));
    expect(ai).toMatch(new RegExp(`sl-writing-ai-mark" title="${WRITING_AI_TAG}"><svg[\\s\\S]*<span class="sl-sr-only">${WRITING_AI_TAG}</span>`));
    expect(ai).toContain('data-origin="ai"');
    expect(ai).toContain('>Starts an action.</textarea>');
    // No per-row Save: Enter saves a row, the footer saves all.
    expect(ai).not.toContain('data-writing-save');
    expect(ai).toMatch(/data-writing-clear="component:10:20"[^>]*aria-label="Discard draft"/);
    const mine = writingScrollMarkup(model({ groups: [group({ fields: [{ heading: 'Button', tasks: [task({ draft: { text: 'Mine.', origin: 'person' } })] }] })] }));
    expect(mine).not.toContain('sl-writing-ai-mark');
    expect(mine).toContain('data-origin="person"');
  });

  it('holds a field read only while its save is out or checking, showing what was sent', () => {
    const saving = writingScrollMarkup(model({ groups: [group({ fields: [{ heading: 'Button', tasks: [task({ saving: { state: 'saving', text: 'Sent.', origin: 'ai' } })] }] })] }));
    expect(saving).toMatch(/<textarea[^>]*readonly>Sent\.<\/textarea>/);
    expect(saving).toContain(`<span class="sl-writing-state" role="status">${WRITING_SAVING}</span>`);
    expect(saving).not.toContain('sl-writing-ai-mark');
    expect(saving).not.toContain('data-writing-clear=');
    const checking = writingScrollMarkup(model({ groups: [group({ fields: [{ heading: 'Button', tasks: [task({ saving: { state: 'checking', text: 'Sent.', origin: 'person' } })] }] })] }));
    expect(checking).toContain(WRITING_CHECKING);
    expect(checking).toContain('data-state="checking"');
  });

  it('says why Figma refused a save, in its words', () => {
    const html = writingScrollMarkup(model({ groups: [group({ fields: [{ heading: 'Button', tasks: [task({ error: 'That component is no longer in this file.' })] }] })] }));
    expect(html).toContain('<p class="sl-writing-error" role="alert">That component is no longer in this file.</p>');
  });
});

describe('to do doc blocks', () => {
  it('heads a doc with its count and Draft, its cost in the tooltip, and no progress bar', () => {
    const html = writingScrollMarkup(model({ freeTier: true, groups: [group({ draftable: 61, countLabel: '12 of 79 written' })] }));
    expect(html).toContain('12 of 79 written');
    expect(html).not.toContain('sl-writing-progress');
    expect(html).toContain('<h2 title="Button">Button</h2>');
    expect(html).toMatch(/data-writing-draft-all[^>]*title="Drafts 61 empty fields\. Takes 2 free AI writing uses\."[^>]*>[\s\S]*Draft with AI/);
    expect(writingScrollMarkup(model({ groups: [group({ draftable: 3 })] }))).toContain('Takes 1 AI writing use.');
    expect(writingScrollMarkup(model({ groups: [group({ draftable: 0 })] }))).not.toContain('data-writing-draft-all');
    expect(writingScrollMarkup(model({ groups: [group({ drafting: true })] }))).toMatch(/data-writing-draft-all[^>]*disabled[^>]*>[\s\S]*Drafting…/);
  });

  it('lists sections apart, with the edited doc note there', () => {
    const html = writingScrollMarkup(model({ groups: [group({ sections: [section], stale: true })] }));
    expect(html).toContain(WRITING_CANVAS_HEADING);
    expect(html).toContain('data-writing-open="whenToUse"');
    expect(html.indexOf(WRITING_CANVAS_HEADING)).toBeLessThan(html.indexOf(WRITING_STALE));
  });

  it('folds the done list until it is opened', () => {
    const done = [task({ key: 'slot:10:20:Content#1:2', gap: { kind: 'slot', id: '10:20', propertyName: 'Content#1:2', name: 'Button / Content' }, title: 'Slot: Content', done: true })];
    const closed = writingScrollMarkup(model({ groups: [group({ done })] }));
    expect(closed).toMatch(/data-writing-done-toggle="doc-1" aria-expanded="false"[\s\S]*Written this session \(1\)/);
    expect(closed).toMatch(/<ul class="sl-writing-tasks" hidden><li class="sl-writing-task is-done"/);
    const open = writingScrollMarkup(model({ groups: [group({ done, doneOpen: true })] }));
    expect(open).toContain('aria-expanded="true"');
    expect(open).not.toContain(' hidden>');
    expect(open).toMatch(/is-done[\s\S]*Button, Slot: Content/);
  });
});

describe('to do states', () => {
  it('claims nothing to do only when known', () => {
    const empty = writingScrollMarkup(model({ groups: [] }));
    expect(empty).toContain(WRITING_EMPTY_HEADING);
    expect(empty).toContain(WRITING_EMPTY);
    const unknown = writingScrollMarkup(model({ groups: [], known: false, unknownReasons: [WRITING_UNKNOWN_RUNNING] }));
    expect(unknown).toContain(WRITING_UNKNOWN_HEADING);
    expect(unknown).toContain(WRITING_UNKNOWN_RUNNING);
    expect(unknown).not.toContain(WRITING_EMPTY_HEADING);
  });

  it('says a file with no docs has none, with the two starts the Library offers', () => {
    const html = writingScrollMarkup(model({ groups: [], noDocs: true }));
    expect(html).toContain(WRITING_NO_DOCS_HEADING);
    expect(html).toContain('data-empty-nav="component"');
    expect(html).toContain('data-empty-nav="foundations"');
    const unknown = writingScrollMarkup(model({ groups: [], noDocs: true, known: false, unknownReasons: [WRITING_UNKNOWN_RUNNING] }));
    expect(unknown).toContain(WRITING_UNKNOWN_HEADING);
    expect(unknown).not.toContain(WRITING_NO_DOCS_HEADING);
  });

  it('shows loading rows before the first scan', () => {
    expect(writingScrollMarkup(model({ groups: [], loading: true }))).toContain('sl-loading-rows');
  });

  it('disables every write and draft while a run holds the lock, and leaves the field typeable', () => {
    const drafted = task({ draft: { text: 'Starts an action.', origin: 'person' } });
    const groups = [group({ fields: [{ heading: 'Button', tasks: [drafted] }], sections: [section], unsaved: 1 })];
    const locked = writingScrollMarkup(model({ locked: true, groups }));
    expect(locked).toMatch(/data-writing-clear="component:10:20"[^>]*disabled/);
    expect(locked).toMatch(/data-writing-draft-all[^>]*disabled/);
    expect(locked).toMatch(/data-writing-open="whenToUse"[^>]*disabled/);
    expect(locked).not.toMatch(/<textarea[^>]*(disabled|readonly)/);
    expect(locked).toContain('data-locked="true"');
    const footer = writingFooterMarkup(model({ locked: true, unsaved: 1 }));
    expect(footer).toMatch(/data-writing-save-all[^>]*disabled/);
    expect(footer).toMatch(/data-writing-discard-all[^>]*disabled/);
    expect(writingScrollMarkup(model({ groups }))).not.toMatch(/disabled/);
  });
});

describe('to do footer', () => {
  it('says nothing with nothing unsaved', () => {
    expect(writingFooterMarkup(model())).toBe('');
  });

  it('offers Save all and Discard all for every unsaved field', () => {
    const html = writingFooterMarkup(model({ unsaved: 67 }));
    expect(html).toContain('67 unsaved');
    expect(html).toMatch(/data-writing-save-all[^>]*>Save all</);
    expect(html).toMatch(/data-writing-discard-all[^>]*>Discard all</);
  });

  it('asks before discarding', () => {
    const html = writingFooterMarkup(model({ unsaved: 67, confirmDiscard: true }));
    expect(html).toContain('Discard 67?');
    expect(html).toMatch(/data-tone="danger"[^>]*data-writing-discard-yes[^>]*>Yes</);
    expect(html).toMatch(/data-writing-discard-cancel[^>]*>Cancel</);
    expect(html).not.toContain('data-writing-save-all');
  });
});
