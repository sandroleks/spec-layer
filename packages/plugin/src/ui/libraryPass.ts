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
 */
export class DriftQueue {
  private passId: string | null = null;
  private queue: string[] = [];
  private current: string | null = null;

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

  next(): string | null {
    if (this.current !== null || this.queue.length === 0) return null;
    this.current = this.queue.shift() as string;
    return this.current;
  }

  settle(docId: string): boolean {
    if (this.current !== docId) return false;
    this.current = null;
    return true;
  }

  inFlight(): string | null {
    return this.current;
  }

  pending(): readonly string[] {
    return this.queue;
  }

  done(): boolean {
    return this.current === null && this.queue.length === 0;
  }
}
