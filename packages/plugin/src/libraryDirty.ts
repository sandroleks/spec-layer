/**
 * "Has the document changed since the Library last scanned it?" One coarse
 * boolean, set by any current-page `nodechange` or any `stylechange` (the
 * plugin's own writes included) and cleared when a scan starts.
 *
 * `nodechange`, not `documentchange`: under dynamic-page access the latter
 * needs every page loaded, so edits on other pages are not seen.
 * `stylechange` is document-wide. Variables have no event: the foundation
 * fingerprint covers renames and FLOAT edits, and a colour, string or boolean
 * value edit waits for Refresh library.
 *
 * Starts dirty. `attach` throws if it cannot subscribe; main.ts then
 * re-checks on every visit.
 */
export interface DirtyPageLike {
  on(event: 'nodechange', cb: () => void): void;
  off(event: 'nodechange', cb: () => void): void;
}

export interface DirtyFlagHost {
  currentPage(): DirtyPageLike;
  onPageChange(cb: () => void): void;
  onStyleChange(cb: () => void): void;
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
    host.onStyleChange(this.mark);
  }

  private listenTo(page: DirtyPageLike): void {
    if (this.page === page) return;
    this.page?.off('nodechange', this.mark);
    page.on('nodechange', this.mark);
    this.page = page;
  }
}
