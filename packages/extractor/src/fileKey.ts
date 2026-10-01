/**
 * The file key recorded when Figma exposes none (a Community plugin never sees
 * `figma.fileKey`). It is inside every component doc's drift hash, so it stays
 * a string until an EXTRACTOR_VERSION bump; outputs read it through
 * knownFileKey and never write it as if it were a real key.
 */
export const UNKNOWN_FILE_KEY = 'unknown';

/** A real file key, or null when there is none or it is the placeholder. */
export function knownFileKey(key: string | null | undefined): string | null {
  return key && key !== UNKNOWN_FILE_KEY ? key : null;
}
