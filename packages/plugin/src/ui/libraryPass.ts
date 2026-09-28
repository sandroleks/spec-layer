/**
 * The Library's drift pass as a queue: which docs still need a source check,
 * which one is in flight, and the pass id the main thread keys its resolver
 * memo by.
 *
 * One in flight at a time. The pass before this sent every requestDrift at
 * once, and the main thread serialized them all concurrently with no gap for
 * Figma to repaint. Leaving the Library stops the host from calling next(),
 * which is the whole pause mechanism; the pending ids survive, and resume()
 * gives them a new pass id so the main thread starts a fresh memo rather
 * than serving lookups from before the pause.
 *
 * The check in flight remembers the pass id it went out under, and a reply
 * echoes it, so settle() accepts only the reply to that request. A reply
 * from a pass that start() or clear() replaced is rejected even when it
 * names the doc now in flight: it was read before the scan that replaced
 * it, so it must not settle the new request or set a row. resume() does not
 * replace the pass, so the check in flight across it still settles.
 */
export interface DriftCheck {
  docId: string;
  passId: string;
}

export class DriftQueue {
  private passId: string | null = null;
  private queue: string[] = [];
  private current: DriftCheck | null = null;

  start(passId: string, docIds: readonly string[]): void {
    this.passId = passId;
    this.queue = [...docIds];
    this.current = null;
  }

  resume(passId: string): void {
    this.passId = passId;
  }

  clear(): void {
    this.passId = null;
    this.queue = [];
    this.current = null;
  }

  id(): string | null {
    return this.passId;
  }

  /** The next check to send, or null while one is in flight or none is left. */
  next(): DriftCheck | null {
    if (this.current !== null || this.queue.length === 0 || this.passId === null) return null;
    this.current = { docId: this.queue.shift() as string, passId: this.passId };
    return this.current;
  }

  /** True when this reply answers the check in flight, which it then clears. */
  settle(docId: string, passId: string): boolean {
    if (this.current === null || this.current.docId !== docId || this.current.passId !== passId) return false;
    this.current = null;
    return true;
  }

  inFlight(): string | null {
    return this.current === null ? null : this.current.docId;
  }

  pending(): readonly string[] {
    return this.queue;
  }

  done(): boolean {
    return this.current === null && this.queue.length === 0;
  }
}
