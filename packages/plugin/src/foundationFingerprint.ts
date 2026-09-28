/**
 * Identity of the file's local variables and styles, as one string, so the
 * Library probe can tell "a token was renamed, added, or removed" apart from
 * "nothing changed" without the full foundation read.
 *
 * Names for every variable and style. A component's drift hash (extractor
 * hash.ts, `tokens`) carries the bound token's name, so a rename moves it,
 * and a deleted variable matters because a binding to it resolves to null.
 *
 * Values as well for FLOAT variables, because a component's layout summary
 * (extractor layout.ts, carried in the hash's `layout`) renders the resolved
 * padding, gap and radius numbers, so a spacing or radius value edit moves a
 * component row. Other value types stay out: nothing in a component hash
 * carries them, and the Foundation row is where they show. Leaving them out
 * keeps this read cheap: no per-mode resolution, only the raw values of
 * number variables.
 *
 * Compared for equality only; it never feeds a hash. Sorted by id, and mode
 * keys sorted, in code-unit order so two reads of the same file agree
 * regardless of the order Figma returns them. JSON encodes each entry so a
 * name containing the separator cannot collide with two shorter names.
 */
export interface FingerprintVariable {
  id: string;
  name: string;
  collectionId: string;
  /** The variable's `valuesByMode`; passed only for FLOAT variables. */
  values?: Readonly<Record<string, unknown>>;
}
export interface FingerprintStyle { id: string; name: string }

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

export function foundationFingerprint(
  variables: readonly FingerprintVariable[],
  styles: readonly FingerprintStyle[],
): string {
  const v = [...variables].sort(byId).map(variableEntry);
  const s = [...styles].sort(byId)
    .map(({ id, name }) => JSON.stringify([id, name]));
  return `v:${v.join('\u001f')}|s:${s.join('\u001f')}`;
}
