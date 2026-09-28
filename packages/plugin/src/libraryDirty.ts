/**
 * "Has the document changed since the Library last scanned it?"
 *
 * One boolean, set by any `nodechange` on the current page and cleared when
 * a scan starts. Deliberately coarse: it only ever errs toward re-checking
 * after the user edited something, which is when a check matters. The
 * plugin's own canvas writes set it too; that costs one re-check after a
 * build, which is correct.
 *
 * Why `nodechange` and not `documentchange`: under dynamic-page access
 * `figma.on('documentchange')` needs every page loaded, and it fires for
 * every edit anywhere. `PageNode.on('nodechange')` needs no page loading and
 * is scoped to the page the user can edit. The listener is on the current
 * page only, so edits by others on any other page are not seen, whether or
 * not you visited it this session. Variable and style edits are not node
 * changes either: the Library probe's foundation fingerprint catches
 * renames, additions and deletions, and number (FLOAT) value edits, since a
 * component's layout summary carries the resolved padding, gap and radius.
 * A color, string or boolean value edit is not seen, and no component row
 * carries those values; the Foundation row that shows them keeps its last
 * result until the next change or Refresh library. The last-checked caption
 * and Refresh library are the recovery.
 *
 * Starts dirty so the first scan of a session always runs.
 */
export interface DirtyPageLike {
  on(event: 'nodechange', cb: () => void): void;
  off(event: 'nodechange', cb: () => void): void;
}

export interface DirtyFlagHost {
  currentPage(): DirtyPageLike;
  onPageChange(cb: () => void): void;
}

export class DocumentDirtyFlag {
  private dirty = true;
  private page: DirtyPageLike | null = null;
  private readonly mark = (): void => { this.dirty = true; };

  get isDirty(): boolean { return this.dirty; }

  /** Read and clear in one step; the caller is starting a scan. */
  consume(): boolean {
    const was = this.dirty;
    this.dirty = false;
    return was;
  }

  attach(host: DirtyFlagHost): void {
    this.listenTo(host.currentPage());
    host.onPageChange(() => this.listenTo(host.currentPage()));
  }

  private listenTo(page: DirtyPageLike): void {
    if (this.page === page) return;
    this.page?.off('nodechange', this.mark);
    page.on('nodechange', this.mark);
    this.page = page;
  }
}
