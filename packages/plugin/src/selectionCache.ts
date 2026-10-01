/**
 * selectionCache.ts: whether a selection change needs a fresh serialization.
 *
 * findComponent resolves a selection to its component set, so clicking from
 * one layer to the next inside one set resolves to the same component every
 * time, and serializing a large set holds the main thread for seconds. A
 * selection that resolves to the component the panel already shows, or to one
 * already being read, sends nothing while nothing has changed: no layer edit
 * on the current page, no style edit, and the same variable fingerprint
 * (variables fire no event, and a rename moves the names a serialization
 * carries). Layer edits on other pages are not seen, the same limit the
 * Library's re-check has.
 */

/** The dirty flag this reads, and the only reader of it. DocumentDirtyFlag satisfies it. */
export interface SelectionDirtyFlag {
  consume(): boolean;
}

interface Read { edits: number; fingerprint: Promise<string | null> }

export class SelectionCache {
  /** Edits seen so far. Each read remembers the count it started at. */
  private edits = 0;
  private shown: (Read & { componentId: string }) | null = null;
  private readonly reading = new Map<string, Read>();

  /** `watched` is false when the edit watch failed to attach: then nothing is skipped. */
  constructor(private readonly dirty: SelectionDirtyFlag, private readonly watched: boolean) {}

  /** Folds the flag into the count, so an edit made during any read is never lost. */
  private sync(): number {
    if (this.dirty.consume()) this.edits++;
    return this.edits;
  }

  /** A serialization of `componentId` is starting. */
  begin(componentId: string, fingerprint: Promise<string | null>): void {
    this.reading.set(componentId, { edits: this.sync(), fingerprint });
  }

  /** The serialization ended; `shown` when its result reached the panel. */
  end(componentId: string, shown: boolean): void {
    const read = this.reading.get(componentId);
    this.reading.delete(componentId);
    if (shown && read) this.shown = { componentId, ...read };
  }

  /** The panel now shows something else: no component, or a failed read. */
  clear(): void {
    this.shown = null;
  }

  /** True when posting `componentId` again would tell the panel nothing new. */
  async unchanged(componentId: string, fingerprint: () => Promise<string | null>): Promise<boolean> {
    if (!this.watched) return false;
    const edits = this.sync();
    const running = this.reading.get(componentId);
    if (running) return running.edits === edits;
    const shown = this.shown;
    if (!shown || shown.componentId !== componentId || shown.edits !== edits) return false;
    const [before, now] = await Promise.all([shown.fingerprint, fingerprint().catch(() => null)]);
    return before !== null && before === now && this.sync() === edits;
  }
}
