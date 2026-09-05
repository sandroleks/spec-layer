/**
 * Remembers which foundation dump object the UI already holds.
 *
 * The main thread caches one SerializedFoundation per session and used to
 * attach it to every 'selection' message: 114 KB of structured clone per
 * click at 360 variables, 340 KB at 1080, and a buildFoundation() re-run in
 * the UI each time. The UI keeps the parsed spec at module scope, so it only
 * needs the dump when the object changes. Identity, not equality: a refresh
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
