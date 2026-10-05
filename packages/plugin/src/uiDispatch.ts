/**
 * The safety net around every message the UI sends the main thread.
 *
 * Handlers catch the failures they expect and reply with a typed error. This
 * catches the rest, so an unexpected throw is logged and shown as a native
 * toast instead of becoming an unhandled rejection the UI never hears about.
 *
 * It also closes an undo step after every message that changes the canvas.
 * Figma does not commit plugin edits to undo history on its own, so without
 * this one Undo after a second build reverted the first build too.
 */

/** Messages whose handlers create, replace, or delete canvas nodes, or change
 *  file data a later canvas edit's Undo would otherwise revert with it. */
export const CANVAS_EDITS: ReadonlySet<string> = new Set([
  'renderDocFrame', 'renderFoundation', 'updateFoundationDoc', 'detachDoc', 'removeDoc', 'applySync',
  'setSyncFileUrl',
]);

export interface DispatchDeps {
  commitUndo(): void;
  notifyError(message: string): void;
  log(message: string, err: unknown): void;
}

/** Shown for a failure no handler anticipated. Plain, second person, no em dashes. */
export const UNEXPECTED_ERROR = 'Something went wrong in Spec Layer. Try again, and if it keeps happening, reopen the plugin.';

export async function dispatchUiMessage(
  raw: unknown, handle: (raw: unknown) => Promise<void>, deps: DispatchDeps,
): Promise<void> {
  const type = typeof (raw as { type?: unknown } | null)?.type === 'string' ? (raw as { type: string }).type : 'unknown';
  try {
    await handle(raw);
  } catch (err) {
    deps.log(`[Spec Layer] ${type} failed`, err);
    deps.notifyError(UNEXPECTED_ERROR);
  } finally {
    // After a failure too: whatever the handler changed before it threw is
    // one step, not merged into the next action's.
    if (CANVAS_EDITS.has(type)) deps.commitUndo();
  }
}
