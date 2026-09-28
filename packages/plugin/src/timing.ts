/**
 * Measurement for a `DRIFT_TIMING=1` build only (see build.mjs). main.ts and
 * ui-vnext.ts construct this behind `__DRIFT_TIMING__`, so a normal build
 * drops the module with the branch. Nothing here reads that flag, which is
 * what lets it run under test.
 *
 * A thread that is busy cannot run a timer, so a repeating timer that fires
 * late measures how long the thread was held: on the main thread, the time
 * Figma could not repaint or take input; in the UI iframe, the time the
 * plugin could not. Elapsed time around an async handler cannot tell the
 * difference between waiting on Figma and holding the thread; this can.
 *
 * The late tick runs after the block has ended, when the activity then is
 * often idle again, so a report names everything that ran since the
 * previous tick.
 */
export class BlockWatch {
  private last: number;
  private current: string | null = null;
  private seen: string[] = [];

  constructor(
    private readonly now: () => number,
    private readonly thresholdMs: number,
    private readonly report: (blockedMs: number, during: string[]) => void,
  ) {
    this.last = now();
  }

  /** Name what runs now; a block reported before the next tick blames it. */
  doing(activity: string): void {
    this.current = activity;
    if (!this.seen.includes(activity)) this.seen.push(activity);
  }

  done(): void {
    this.current = null;
  }

  /** Call from a timer set to repeat every `intervalMs`. */
  tick(intervalMs: number): void {
    const t = this.now();
    const late = t - this.last - intervalMs;
    if (late >= this.thresholdMs) this.report(late, this.seen.length > 0 ? this.seen : ['idle']);
    this.last = t;
    this.seen = this.current === null ? [] : [this.current];
  }
}
