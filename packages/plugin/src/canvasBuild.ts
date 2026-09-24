/**
 * One canvas build at a time, whichever frame family it draws.
 *
 * buildDocFrames and buildFoundationFrame both write frameKit's module state
 * (palette, fonts, corner scale, per-build caches), so a component build and
 * a foundation build interleaving would paint one document in the other's
 * theme. main.ts used to keep one flag per family, which stopped two component
 * builds or two foundation builds from overlapping but not one of each. This
 * is the single flag.
 *
 * It also answers the selection listener. A build switches pages to place a
 * doc beside its predecessor and switches back, and each switch fires
 * `selectionchange` with that page's selection, which is nobody's choice;
 * posting it would empty the component pane the moment "Updated" shows. But a
 * *real* selection the user makes while the gate is held is not nobody's
 * choice, and must not be dropped for good just because it arrived at a bad
 * time: the listener calls `noteSkipped()` instead of posting, and the
 * build's own `finally` block replays the selection once, after `end()`,
 * through `selectionToReplay` below.
 */
export class CanvasBuildGate {
  private building = false;
  private skipped = false;

  /** True while a build holds the gate. */
  get busy(): boolean {
    return this.building;
  }

  /**
   * True when a `selectionchange` fired while the gate was held and was
   * swallowed rather than posted. Reset by `begin()`. Stays readable after
   * `end()`, so a build's `finally` block can ask "did I owe anyone a
   * replay" once the gate no longer says `busy`.
   */
  get skippedSelection(): boolean {
    return this.skipped;
  }

  /** Take the gate. False when a build already holds it: reply, do not build. */
  begin(): boolean {
    if (this.building) return false;
    this.building = true;
    this.skipped = false;
    return true;
  }

  /**
   * Record that a `selectionchange` event was swallowed while the gate was
   * held. `busy` alone cannot answer this after the fact: it is already
   * `false` by the time a `finally` block gets to ask.
   */
  noteSkipped(): void {
    this.skipped = true;
  }

  end(): void {
    this.building = false;
  }
}

/**
 * Whether a build's `finally` block should replay the current selection to
 * the UI once the gate has released it.
 *
 * Only a genuine, still-current user choice replays:
 * - nothing replays when no event was skipped (there is nothing to replay);
 * - nothing replays when the current selection is exactly what it was when
 *   the build began (nothing actually changed, even though an event fired,
 *   e.g. the user reselected the same node);
 * - nothing replays when the current selection is exactly the build's own
 *   programmatic selection (renderDocFrame's generated Section on success).
 *   Posting that would resolve to `node: null` and empty the pane, the
 *   original bug this whole gate exists to fix.
 *
 * `programmatic` is `null`, not `[]`, for a build that never selects
 * anything of its own (both Foundation paths): an empty array would mean
 * "this build's own selection was empty", which is a claim those two paths
 * have no basis to make, and would wrongly swallow a genuine mid-build
 * deselect (the user clearing their selection, so `current` is also `[]`).
 * `null` says there is no programmatic selection to compare against at all,
 * so that case falls through to the atBegin comparison alone.
 *
 * Only a selection that differs from both atBegin and (when there is one)
 * programmatic counts as something to tell the UI about.
 */
export function selectionToReplay(input: {
  skipped: boolean;
  current: readonly string[];
  atBegin: readonly string[];
  programmatic: readonly string[] | null;
}): boolean {
  if (!input.skipped) return false;
  if (sameSelection(input.current, input.atBegin)) return false;
  if (input.programmatic !== null && sameSelection(input.current, input.programmatic)) return false;
  return true;
}

/** Order-independent id-set equality: selection order is not a user choice. */
function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const bIds = new Set(b);
  return a.every((id) => bIds.has(id));
}
