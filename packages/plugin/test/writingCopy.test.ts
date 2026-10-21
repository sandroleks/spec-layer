import { describe, expect, it } from 'vitest';
import * as copy from '../src/ui/writingCopy';

/** Every string the module can produce, fixed or built. */
function everySentence(): string[] {
  const fixed = Object.values(copy).flatMap((value) =>
    typeof value === 'string' ? [value] : typeof value === 'object' ? Object.values(value) : []);
  return [
    ...fixed,
    copy.writingSummary(79, 3, 2), copy.writingSummary(1, 1, 1), copy.writingCheckingLabel(2, 5),
    copy.writtenCount(12, 79), copy.draftCostLabel(61, 2, true), copy.draftCostLabel(1, 1, false),
    copy.unsavedLabel(3), copy.discardConfirmLabel(3), copy.doneHeading(12),
    copy.writtenToast(2, [], 'Button'), copy.writtenToast(2, [{ message: 'a' }], 'Button'),
    copy.writtenToast(0, [{ message: 'a' }], 'Button'), copy.draftedToast(1), copy.draftedToast(5),
    copy.draftFailedNote(1), copy.draftFailedNote(4), copy.WRITING_TASK_SLOT('Content'),
  ];
}

describe('to do copy', () => {
  it('has no em or en dashes and no straight apostrophes', () => {
    for (const sentence of everySentence()) {
      expect(sentence).not.toMatch(/[—–]/);
      expect(sentence).not.toMatch(/'/);
    }
  });

  it('names the screen and says what it is for', () => {
    expect(copy.WRITING_RAIL_LABEL).toBe('To do');
    expect(copy.WRITING_HEADING).toBe('To do');
    expect(copy.WRITING_REFRESH).toBe('Refresh');
  });

  it('says why a description is written here and not in a doc, claiming only what the plugin does', () => {
    expect(copy.WRITING_WHY_HEADING).toBe('Why fill these in here?');
    expect(copy.WRITING_WHY).toEqual([
      'These are the description fields on your variables, styles and components. They aren’t part of a doc.',
      'Copy for AI uses them right away. Your docs and published library get them the next time you update or publish.',
      'Sections under On the canvas are part of a doc, so you write them there.',
    ]);
    expect(copy.WRITING_WHY_DISMISS).toBe('Got it');
    expect(copy.WRITING_WHY.join(' ')).not.toMatch(/Dev Mode|agent/);
  });

  it('sums up what is left, dropping a zero part', () => {
    expect(copy.writingSummary(79, 3, 2)).toBe('79 descriptions and 3 sections left in 2 docs');
    expect(copy.writingSummary(79, 0, 1)).toBe('79 descriptions left in 1 doc');
    expect(copy.writingSummary(0, 1, 1)).toBe('1 section left in 1 doc');
    expect(copy.writingSummary(1, 2, 3)).toBe('1 description and 2 sections left in 3 docs');
    expect(copy.writingSummary(0, 0, 0)).toBe('');
    expect(copy.writingCheckingLabel(2, 5)).toBe('Checking 2 of 5 docs…');
  });

  it('words a doc head and its draft button', () => {
    expect(copy.writtenCount(12, 79)).toBe('12 of 79 written');
    expect(copy.WRITING_DRAFT_ALL).toBe('Draft with AI');
    expect(copy.WRITING_DRAFTING).toBe('Drafting…');
    expect(copy.draftCostLabel(1, 1, true)).toBe('Drafts 1 empty field. Takes 1 free AI writing use.');
    expect(copy.draftCostLabel(61, 2, true)).toBe('Drafts 61 empty fields. Takes 2 free AI writing uses.');
    expect(copy.draftCostLabel(61, 2, false)).toBe('Drafts 61 empty fields. Takes 2 AI writing uses.');
  });

  it('words each row', () => {
    expect(copy.WRITING_FIELD_HINTS).toEqual({
      variable: 'What this token is for',
      style: 'What this style is for',
      component: 'What it is and when to use it',
      slot: 'What goes in this slot',
    });
    expect(copy.WRITING_AI_TAG).toBe('AI draft');
    expect(copy.WRITING_SAVING).toBe('Saving…');
    expect(copy.WRITING_CHECKING).toBe('Saved, checking…');
    expect(copy.WRITING_DISCARD).toBe('Discard draft');
    expect(copy.WRITING_TASK_DESCRIPTION).toBe('Description');
    expect(copy.WRITING_TASK_SLOT('Content')).toBe('Slot: Content');
    expect(copy.WRITING_CAPTION_TYPOGRAPHY).toBe('Typography');
    expect(copy.WRITING_CAPTION_EFFECT).toBe('Effect');
    expect(copy.WRITING_NOT_RESOLVED).toBe('Not resolved');
    expect(copy.WRITING_NOT_SET).toBe('Not set');
  });

  it('words the canvas list, the done list and the footer', () => {
    expect(copy.WRITING_CANVAS_HEADING).toBe('On the canvas');
    expect(copy.WRITING_OPEN).toBe('Open in doc');
    expect(copy.WRITING_STALE).toBe('This doc was edited on the canvas, so some of these may already be written. Update it to check.');
    expect(copy.doneHeading(12)).toBe('Written this session (12)');
    expect(copy.unsavedLabel(67)).toBe('67 unsaved');
    expect(copy.WRITING_DISCARD_ALL).toBe('Discard all');
    expect(copy.WRITING_SAVE_ALL).toBe('Save all');
    expect(copy.discardConfirmLabel(67)).toBe('Discard 67?');
    expect(copy.WRITING_CONFIRM_YES).toBe('Yes');
    expect(copy.WRITING_CONFIRM_CANCEL).toBe('Cancel');
  });

  it('reports one doc’s save and names what was not saved', () => {
    expect(copy.writtenToast(1, [], 'Button')).toBe('1 description saved to Figma. Button now shows Update available.');
    expect(copy.writtenToast(67, [], 'Semantic Colors')).toBe('67 descriptions saved to Figma. Semantic Colors now shows Update available.');
    expect(copy.writtenToast(2, [{ message: 'That variable is no longer in this file.' }], 'Button'))
      .toBe('2 saved to Figma. 1 was not: That variable is no longer in this file.');
    expect(copy.writtenToast(1, [{ message: 'a' }, { message: 'b' }], 'Button')).toBe('1 saved to Figma. 2 were not: a b');
    expect(copy.writtenToast(0, [{ message: 'Nothing to write.' }], 'Button')).toBe('Nothing was saved. Nothing to write.');
    expect(copy.writtenToast(0, [], 'Button')).toBe('Nothing was saved.');
  });

  it('reports drafts that landed and drafts that did not', () => {
    expect(copy.draftedToast(67)).toBe('67 drafts ready to review. They’re kept until you close the plugin.');
    expect(copy.draftedToast(1)).toBe('1 draft ready to review. It’s kept until you close the plugin.');
    expect(copy.draftFailedNote(4)).toBe('No draft came back for 4 fields. They’re still yours to fill.');
    expect(copy.draftFailedNote(1)).toBe('No draft came back for 1 field. It’s still yours to fill.');
  });

  it('tells an empty list, an empty file and an unknown list apart', () => {
    expect(copy.WRITING_EMPTY_HEADING).toBe('Nothing left to do');
    expect(copy.WRITING_EMPTY).toBe('Every description and section in your docs is filled.');
    expect(copy.WRITING_NO_DOCS_HEADING).toBe('No docs yet');
    expect(copy.WRITING_NO_DOCS).toBe('Create a component or Foundation doc, and anything left to write shows up here.');
    expect(copy.WRITING_UNKNOWN_HEADING).toBe('Not everything is checked yet');
    expect(copy.WRITING_UNKNOWN_RUNNING).toBe('Checks are still running.');
    expect(copy.WRITING_UNKNOWN_OLDER).toBe('Docs built before this version list their sections after an Update.');
    expect(copy.WRITING_UNKNOWN_UNREAD).toBe('Some docs could not be read.');
  });
});
