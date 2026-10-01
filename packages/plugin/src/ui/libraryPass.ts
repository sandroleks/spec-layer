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
import type { SpecHashProjection } from '@spec-layer/extractor';
import type { LibraryDriftState } from './viewModel/library';

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

/** A component row's settled check, kept across the rescan a Library run ends with. */
export interface CarriedCheck {
  status: 'inSync' | 'drifted';
  /** The live projection that check hashed; a drifted row's change list diffs it. */
  projection?: SpecHashProjection;
}

export interface LibraryCarry {
  checks: Map<string, CarriedCheck>;
  /** When the carried checks from earlier passes ran, or null when none were kept. */
  checkedAt: number | null;
}

/**
 * What the rescan an Update or Copy ends with keeps instead of checking again.
 *
 * An Update writes doc frames, never a source, so every other row's settled
 * result still holds; the docs it rebuilt are in sync by construction, since
 * each new baseline was hashed from the source read the rebuild drew. Pending,
 * unavailable and stale rows are checked again. Earlier results are kept only
 * after a completed check, and keep that check's time, so the caption never
 * claims a fresher check than happened. Refresh library still checks every row.
 */
export function libraryCarry(input: {
  drift: ReadonlyMap<string, LibraryDriftState>;
  projections: ReadonlyMap<string, SpecHashProjection>;
  checkedAt: number | null;
  rebuilt: readonly string[];
}): LibraryCarry {
  const checks = new Map<string, CarriedCheck>();
  if (input.checkedAt !== null) {
    for (const [docId, status] of input.drift) {
      if (status !== 'inSync' && status !== 'drifted') continue;
      const projection = input.projections.get(docId);
      checks.set(docId, projection ? { status, projection } : { status });
    }
  }
  const kept = checks.size;
  for (const docId of input.rebuilt) checks.set(docId, { status: 'inSync' });
  return { checks, checkedAt: kept > 0 ? input.checkedAt : null };
}
