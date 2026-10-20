/**
 * The words the Writing group shows. Pure, so every sentence is tested.
 * Sentence case, second person, no em or en dashes.
 */

export const WRITING_FILTER_LABEL = 'Needs writing';
export const WRITING_HEADING = 'Writing';
export const WRITING_RAIL_LABEL = 'Writing';
export const WRITING_FIELD_HINT = 'What it is and when to use it';
export const WRITING_DRAFT_ALL = 'Draft all with AI';
export const WRITING_DRAFTING = 'Drafting…';
export const WRITING_SAVE = 'Save';
export const WRITING_CLEAR = 'Clear draft';
export const WRITING_OPEN = 'Open in doc';
export const WRITING_AI_TAG = 'AI';
export const WRITING_FOOT = 'Saving writes into Figma. The doc then shows Update available. You can undo this right after.';
export const WRITING_STALE = 'Sections as of the last update. Check again after Update.';
export const WRITING_DRAFTS_NOTE = 'Drafts are kept until you close the plugin.';
export const WRITING_EMPTY = 'Nothing to write. Every description and section is filled.';
export const WRITING_FILTER_EMPTY = 'Nothing to write in any doc.';
/** Under "None found in what could be read", one line per thing not yet known. */
export const WRITING_UNKNOWN_RUNNING = 'Checks are still running.';
export const WRITING_UNKNOWN_OLDER = 'Docs built before this version list their sections after an Update.';
export const WRITING_UNKNOWN_UNREAD = 'Some docs could not be read.';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The toast after a Save: what landed, then each refusal in Figma's words. */
export function writtenToast(written: number, failed: readonly { message: string }[]): string {
  const head = written > 0 ? `${plural(written, 'description', 'descriptions')} written into Figma.` : 'Nothing was written.';
  if (failed.length === 0) return head;
  const reasons = failed.map((f) => f.message).join(' ');
  if (written === 0) return `${head} ${reasons}`;
  return `${head} ${failed.length} ${failed.length === 1 ? 'was' : 'were'} not: ${reasons}`;
}

/** When a draft request returns nothing usable for some fields. */
export function draftFailedNote(items: number): string {
  return `No draft came back for ${plural(items, 'field', 'fields')}. The ${items === 1 ? 'field is' : 'fields are'} still yours to fill.`;
}

export function sectionGapLine(heading: string): string {
  return `${heading}, not written`;
}

export const WRITING_TASK_DESCRIPTION = 'Description';
export const WRITING_TASK_SLOT = (property: string): string => `Slot: ${property}`;
export const WRITING_CAPTION_TYPOGRAPHY = 'Typography';
export const WRITING_CAPTION_EFFECT = 'Effect';
export const WRITING_REFRESH = 'Refresh';
export const WRITING_REFRESHING = 'Refreshing…';
export function writingCount(done: number, total: number): string {
  return `${done} of ${total} done`;
}
