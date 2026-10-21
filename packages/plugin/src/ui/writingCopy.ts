/**
 * The words the To do screen shows. Pure, so every sentence is tested.
 * Sentence case, second person, curly apostrophes, no em or en dashes.
 */

export const WRITING_HEADING = 'To do';
export const WRITING_RAIL_LABEL = 'To do';
export const WRITING_REFRESH = 'Refresh';
export const WRITING_FIELD_HINTS = {
  variable: 'What this token is for',
  style: 'What this style is for',
  component: 'What it is and when to use it',
  slot: 'What goes in this slot',
} as const;
/** Said by the row's AI mark, which shows no text of its own. */
export const WRITING_AI_TAG = 'AI draft';
export const WRITING_SAVING = 'Saving…';
/** Main wrote it; the source check that closes the task has not landed. */
export const WRITING_CHECKING = 'Saved, checking…';
export const WRITING_DISCARD = 'Discard draft';
export const WRITING_CANVAS_HEADING = 'On the canvas';
export const WRITING_OPEN = 'Open in doc';
export const WRITING_STALE = 'This doc was edited on the canvas, so some of these may already be written. Update it to check.';
export const WRITING_DISCARD_ALL = 'Discard all';
export const WRITING_CONFIRM_YES = 'Yes';
export const WRITING_CONFIRM_CANCEL = 'Cancel';
export const WRITING_EMPTY_HEADING = 'Nothing left to do';
export const WRITING_EMPTY = 'Every description and section in your docs is filled.';
/** A file with no docs: nothing is filled because nothing is there yet. */
export const WRITING_NO_DOCS_HEADING = 'No docs yet';
export const WRITING_NO_DOCS = 'Create a component or Foundation doc, and anything left to write shows up here.';
/** An empty list that is not a fact. */
export const WRITING_UNKNOWN_HEADING = 'Not everything is checked yet';
/** Under WRITING_UNKNOWN_HEADING, one line per thing not yet known. */
export const WRITING_UNKNOWN_RUNNING = 'Checks are still running.';
export const WRITING_UNKNOWN_OLDER = 'Docs built before this version list their sections after an Update.';
export const WRITING_UNKNOWN_UNREAD = 'Some docs could not be read.';

export const WRITING_TASK_DESCRIPTION = 'Description';
export const WRITING_TASK_SLOT = (property: string): string => `Slot: ${property}`;
export const WRITING_CAPTION_TYPOGRAPHY = 'Typography';
export const WRITING_CAPTION_EFFECT = 'Effect';
export const WRITING_NOT_RESOLVED = 'Not resolved';
export const WRITING_NOT_SET = 'Not set';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "79 descriptions and 3 sections left in 2 docs"; a zero part is dropped, both zero is ''. */
export function writingSummary(descriptions: number, sections: number, docs: number): string {
  const parts = [
    ...(descriptions > 0 ? [plural(descriptions, 'description', 'descriptions')] : []),
    ...(sections > 0 ? [plural(sections, 'section', 'sections')] : []),
  ];
  if (parts.length === 0) return '';
  return `${parts.join(' and ')} left in ${plural(docs, 'doc', 'docs')}`;
}

export function writingCheckingLabel(done: number, total: number): string {
  return `Checking ${done} of ${total} docs…`;
}

export function writtenCount(done: number, total: number): string {
  return `${done} of ${total} written`;
}

export const WRITING_DRAFT_ALL = 'Draft with AI';
export const WRITING_DRAFTING = 'Drafting…';
export const WRITING_SAVE_ALL = 'Save all';

/**
 * The Draft button's tooltip: how many fields, and what it costs, worded as
 * the component screen words a use. One generation per DESCRIPTION_CHUNK fields.
 */
export function draftCostLabel(fields: number, generations: number, free: boolean): string {
  const uses = `${generations} ${free ? 'free ' : ''}AI writing use${generations === 1 ? '' : 's'}`;
  return `Drafts ${plural(fields, 'empty field', 'empty fields')}. Takes ${uses}.`;
}

export const unsavedLabel = (n: number): string => `${n} unsaved`;
export const discardConfirmLabel = (n: number): string => `Discard ${n}?`;
export const doneHeading = (n: number): string => `Written this session (${n})`;

/** The toast after one doc's save: what landed, then each refusal in Figma's words. */
export function writtenToast(written: number, failed: readonly { message: string }[], docLabel: string): string {
  const reasons = failed.map((f) => f.message).join(' ');
  if (written === 0) return failed.length ? `Nothing was saved. ${reasons}` : 'Nothing was saved.';
  if (failed.length === 0) {
    return `${plural(written, 'description', 'descriptions')} saved to Figma. ${docLabel} now shows Update available.`;
  }
  return `${written} saved to Figma. ${failed.length} ${failed.length === 1 ? 'was' : 'were'} not: ${reasons}`;
}

export function draftedToast(n: number): string {
  return `${plural(n, 'draft', 'drafts')} ready to review. ${n === 1 ? 'It’s' : 'They’re'} kept until you close the plugin.`;
}

/** When a draft request returns nothing usable for some fields. */
export function draftFailedNote(items: number): string {
  return `No draft came back for ${plural(items, 'field', 'fields')}. ${items === 1 ? 'It’s' : 'They’re'} still yours to fill.`;
}
