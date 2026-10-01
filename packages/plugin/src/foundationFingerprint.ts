/**
 * Identity of the file's local variables as one string, so the Library probe
 * can tell a rename, addition or removal from no change without the full
 * foundation read. Variables have no change event; styles have `stylechange`,
 * so they stay out. Every name counts, since a component's drift hash carries
 * bound token names; FLOAT values count because the hash's `layout` carries
 * resolved padding, gap and radius. No other value types: no component hash
 * carries them.
 *
 * Equality only, never a hash. Sorted in code-unit order so two reads agree;
 * JSON per entry so a name containing the separator cannot collide.
 */
export interface FingerprintVariable {
  id: string;
  name: string;
  collectionId: string;
  /** The variable's `valuesByMode`; passed only for FLOAT variables. */
  values?: Readonly<Record<string, unknown>>;
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function variableEntry({ id, name, collectionId, values }: FingerprintVariable): string {
  if (values === undefined) return JSON.stringify([id, name, collectionId]);
  const pairs = Object.keys(values).sort(byCodeUnit).map((mode) => [mode, values[mode]]);
  return JSON.stringify([id, name, collectionId, pairs]);
}

export function foundationFingerprint(variables: readonly FingerprintVariable[]): string {
  return [...variables].sort(byId).map(variableEntry).join('\u001f');
}

/** The fingerprint the last Library scan took. Held as the read itself, set
 *  as the scan starts, so a probe mid-scan waits for that scan's value. A
 *  missing or failed read never matches, so both fall toward scanning. */
export class FingerprintBaseline {
  private held: Promise<string | null> = Promise.resolve(null);

  set(read: Promise<string | null>): void {
    this.held = read.catch(() => null);
  }

  async matches(fresh: string | null): Promise<boolean> {
    if (fresh === null) return false;
    return fresh === await this.held;
  }
}
