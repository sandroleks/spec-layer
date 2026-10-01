/**
 * For a `DRIFT_TIMING=1` build only (build.mjs): callers construct this behind
 * `__DRIFT_TIMING__`, so a normal build drops it; it never reads the flag, so
 * it runs under test.
 *
 * A busy thread cannot run a timer, so a repeating timer's lateness is how
 * long the thread was held, which elapsed time around an await cannot tell
 * from waiting on Figma. The late tick fires after the block, so a report
 * names everything since the previous tick.
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
