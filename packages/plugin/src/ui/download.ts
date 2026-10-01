/**
 * The snapshot feature's only DOM contact. Never import this from `main.ts`:
 * the sandbox has no `document`, `Blob`, or `URL`, and `npm run check:sandbox`
 * scans `dist/main.js` for that.
 */
import { zipSync, strToU8 } from 'fflate';

/**
 * A zip of `path -> text`, with `mtime` pinned so the same library always
 * gives the same bytes. fflate writes an MS-DOS date (1980-2099), so the epoch
 * throws; 1980-01-01 is the earliest it holds.
 */
export function zipFiles(files: Record<string, string>): Uint8Array {
  const input: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(files)) input[path] = strToU8(text);
  return zipSync(input, { level: 6, mtime: new Date(1980, 0, 1) });
}

/** Revoking a `blob:` URL in the click's tick can cancel the save in WebKit
 *  hosts; a minute is far past that. */
export const REVOKE_DELAY_MS = 60_000;

/** There is no completion signal, so callers return to idle themselves and
 *  claim only that the download started. */
export function downloadBytes(bytes: Uint8Array, filename: string, type: string): void {
  // A plain ArrayBuffer for Blob's typings; the source may be SharedArrayBuffer.
  const buffer: ArrayBuffer = bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    : new Uint8Array(bytes).buffer as ArrayBuffer;
  const blob = new Blob([buffer], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
