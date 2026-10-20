import { describe, expect, it } from 'vitest';
import * as copy from '../src/ui/writingCopy';

describe('writing copy', () => {
  it('has no em or en dashes anywhere', () => {
    for (const [name, value] of Object.entries(copy)) {
      if (typeof value === 'string') expect(value, name).not.toMatch(/[—–]/);
    }
    expect(copy.writtenToast(2, [{ message: 'That variable is no longer in this file.' }])).not.toMatch(/[—–]/);
  });

  it('reports what was written and names what was not', () => {
    expect(copy.writtenToast(1, [])).toBe('1 description written into Figma.');
    expect(copy.writtenToast(3, [])).toBe('3 descriptions written into Figma.');
    expect(copy.writtenToast(0, [{ message: 'Nothing to write.' }])).toBe('Nothing was written. Nothing to write.');
    expect(copy.writtenToast(2, [{ message: 'That variable is no longer in this file.' }])).toBe('2 descriptions written into Figma. 1 was not: That variable is no longer in this file.');
    expect(copy.writtenToast(1, [{ message: 'a' }, { message: 'b' }])).toBe('1 description written into Figma. 2 were not: a b');
  });

  it('says what a draft failure cost and what to do', () => {
    expect(copy.draftFailedNote(4)).toBe('No draft came back for 4 fields. The fields are still yours to fill.');
    expect(copy.draftFailedNote(1)).toBe('No draft came back for 1 field. The field is still yours to fill.');
  });

  it('names an unwritten section plainly', () => {
    expect(copy.sectionGapLine('When to use')).toBe('When to use, not written');
  });

  it('keeps the fixed strings as the spec states them', () => {
    expect(copy.WRITING_FILTER_LABEL).toBe('Needs writing');
    expect(copy.WRITING_RAIL_LABEL).toBe('Writing');
    expect(copy.WRITING_FIELD_HINT).toBe('What it is and when to use it');
    expect(copy.WRITING_DRAFT_ALL).toBe('Draft all with AI');
    expect(copy.WRITING_FOOT).toBe('Saving writes into Figma. The doc then shows Update available. You can undo this right after.');
    expect(copy.WRITING_STALE).toBe('Sections as of the last update. Check again after Update.');
    expect(copy.WRITING_DRAFTS_NOTE).toBe('Drafts are kept until you close the plugin.');
    expect(copy.WRITING_EMPTY).toBe('Nothing to write. Every description and section is filled.');
  });

  it('names what an incomplete Needs writing list does not know yet', () => {
    expect(copy.WRITING_FILTER_EMPTY).toBe('Nothing to write in any doc.');
    expect(copy.WRITING_UNKNOWN_RUNNING).toBe('Checks are still running.');
    expect(copy.WRITING_UNKNOWN_OLDER).toBe('Docs built before this version list their sections after an Update.');
    expect(copy.WRITING_UNKNOWN_UNREAD).toBe('Some docs could not be read.');
  });
});
