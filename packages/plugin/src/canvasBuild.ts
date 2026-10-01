/**
 * One canvas build at a time, whichever frame family it draws: buildDocFrames
 * and buildFoundationFrame share frameKit's module state (palette, fonts,
 * corner scale, per-build caches), so interleaving would paint one document in
 * the other's theme.
 *
 * It also answers the selection listener. A build's page switches fire
 * `selectionchange` with a selection nobody chose, and posting it would empty
 * the component pane, so the listener calls `noteSkipped()` instead. A real
 * selection made meanwhile is not lost: the build's `finally` replays it once,
 * after `end()`, via `selectionToReplay`.
 */
export class CanvasBuildGate {
  private building = false;
  private skipped = false;

  /** True while a build holds the gate. */
  get busy(): boolean {
    return this.building;
  }

  /**
   * A `selectionchange` was swallowed while the gate was held. Reset by
   * `begin()`; still readable after `end()`, when `busy` is already false.
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

  /** Record a `selectionchange` swallowed while the gate was held. */
  noteSkipped(): void {
    this.skipped = true;
  }

  end(): void {
    this.building = false;
  }
}

/**
 * Whether a build's `finally` should replay the current selection once the gate
 * is released: only when an event was skipped and the selection differs from
 * both the build's start and its own programmatic selection (renderDocFrame's
 * Section), which would post `node: null` and empty the pane.
 *
 * `programmatic` is `null`, not `[]`, for a build that selects nothing itself
 * (both Foundation paths): `[]` would claim an empty own selection and swallow
 * a genuine mid-build deselect.
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

/**
 * The tail of a build that may have left the invoking page: return to it,
 * reply, release the gate, replay the selection, in that order.
 *
 * The reply must follow every yield: the UI may send the next request at once
 * (Update all chains rows on replies), and the handler is re-entrant, so an
 * await after the reply would meet a held gate and abort the batch. The page
 * return is the only await, and best effort, so it never skips the reply or
 * holds the gate. Returning first also keeps its `selectionchange` inside the
 * gate and makes `replay` read the invoking page's selection.
 */
export async function settleBuild(steps: {
  restorePage: () => Promise<void>;
  reply: () => void;
  release: () => void;
  replay: () => void;
}): Promise<void> {
  try {
    await steps.restorePage();
  } catch {
    // Best effort only: the reply below still has to go out.
  }
  steps.reply();
  steps.release();
  steps.replay();
}

/** Order-independent id-set equality: selection order is not a user choice. */
function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const bIds = new Set(b);
  return a.every((id) => bIds.has(id));
}
