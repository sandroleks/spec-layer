/**
 * Remembers which foundation dump object the UI already holds, so a
 * 'selection' message skips a large structured clone and a UI rebuild.
 * Identity, not equality: an equal dump from a refresh is still a new read to
 * adopt. Both realms restart together, so the gate never misjudges the UI.
 */
export class FoundationPostGate {
  private posted: object | null = null;

  /** The dump if the UI has not seen this exact object; undefined otherwise. */
  fresh<T extends object>(dump: T): T | undefined {
    if (this.posted === dump) return undefined;
    this.posted = dump;
    return dump;
  }
}
