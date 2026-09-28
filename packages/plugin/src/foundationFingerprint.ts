/**
 * Identity of the file's local variables and styles, as one string, so the
 * Library probe can tell "a token was renamed, added, or removed" apart from
 * "nothing changed" without the full foundation read.
 *
 * Names only. A component's drift hash (extractor hash.ts, `tokens`) carries
 * the bound token's name and nothing of its value, so a value change cannot
 * move a component row and is not an input here; reading values per mode is
 * the expensive part of the foundation read and is exactly what this avoids.
 * A deleted variable matters because a binding to it resolves to null.
 *
 * Sorted by id in code-unit order so two reads of the same file agree
 * regardless of the order Figma returns them. JSON encodes each entry so a
 * name containing the separator cannot collide with two shorter names.
 */
export interface FingerprintVariable { id: string; name: string; collectionId: string }
export interface FingerprintStyle { id: string; name: string }

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function foundationFingerprint(
  variables: readonly FingerprintVariable[],
  styles: readonly FingerprintStyle[],
): string {
  const v = [...variables].sort(byId)
    .map(({ id, name, collectionId }) => JSON.stringify([id, name, collectionId]));
  const s = [...styles].sort(byId)
    .map(({ id, name }) => JSON.stringify([id, name]));
  return `v:${v.join('\u001f')}|s:${s.join('\u001f')}`;
}
