export type FileKeySource = 'figma' | 'override' | 'missing';

export interface ResolvedFileKey {
  fileKey: string;
  source: FileKeySource;
}

/** Resolve both the effective key and the UX state that produced it. */
export function resolveFileKey(
  figmaFileKey: string | null | undefined,
  override: string | null,
): ResolvedFileKey {
  if (figmaFileKey) return { fileKey: figmaFileKey, source: 'figma' };
  if (override) return { fileKey: override, source: 'override' };
  return { fileKey: 'unknown', source: 'missing' };
}
