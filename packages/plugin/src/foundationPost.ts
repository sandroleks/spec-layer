/**
 * Remembers which foundation dump object the UI already holds.
 *
 * The main thread caches one SerializedFoundation per session. Attached to
 * every 'selection' message it costs 114 KB of structured clone per click at
 * 360 variables and a buildFoundation() re-run in the UI, which keeps the
 * parsed spec at module scope and so only needs the dump when it changes. Identity, not equality: a refresh
 * that produced an equal dump is still a new read the UI should adopt, and
 * comparing content would cost what this saves.
 *
 * Both realms restart together when the plugin reopens, so the gate can never
 * believe the UI holds a dump it does not.
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
