/**
 * The Writing screen: one task group per doc, what is left to write and what
 * was written this session. Presentation only; the host owns refreshes,
 * checks, saves and drafts. Task 3 fills this file; Task 1 draws the loading
 * state so the rail destination exists.
 */
import type { ShellRefs } from '../shell/shell';
import { loadingRowsMarkup } from './progress';
import { WRITING_HEADING } from '../writingCopy';

export interface WritingScreenPresentation {
  loading?: boolean;
}

export function writingHeaderMarkup(): string {
  return `<div class="sl-page-header-copy"><h1>${WRITING_HEADING}</h1></div>`;
}

export function writingScrollMarkup(model: WritingScreenPresentation): string {
  return `<div class="sl-writing-list">${model.loading ? loadingRowsMarkup(4) : ''}</div>`;
}

export function renderWritingScreen(refs: ShellRefs, model: WritingScreenPresentation): void {
  refs.screen.className = 'sl-screen sl-writing-screen';
  refs.pageHeader.innerHTML = writingHeaderMarkup();
  refs.pageHeader.hidden = false;
  refs.scroll.innerHTML = writingScrollMarkup(model);
  refs.scroll.scrollTop = 0;
  refs.footer.innerHTML = '';
  refs.footer.hidden = true;
}
