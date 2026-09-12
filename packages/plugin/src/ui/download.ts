/**
 * download.ts — turning a set of files into bytes the browser saves.
 *
 * The only DOM contact in the snapshot feature, and the reason the rest of it
 * is a set of pure functions. Never import this from `main.ts`: the Figma
 * plugin sandbox has no `document`, `Blob`, or `URL`, and `npm run
 * check:sandbox` scans `dist/main.js` for exactly that mistake.
 */
import { zipSync, strToU8 } from 'fflate';

/**
 * A zip of `path -> text`. `mtime` is pinned so the same library always
 * produces the same bytes: a zip carries per-entry timestamps, and without
 * this two downloads a second apart would differ for no reason a reader could
 * see, and no test could assert determinism.
 *
 * fflate encodes `mtime` as an MS-DOS date, which only represents years
 * 1980-2099; the epoch (`new Date(0)`, or the numeric `mtime: 0` the type
 * also accepts) falls outside that range and throws at runtime. `1980-01-01`
 * is the earliest timestamp the format can hold, so it is the fixed value
 * used here.
 */
export function zipFiles(files: Record<string, string>): Uint8Array {
  const input: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(files)) input[path] = strToU8(text);
  return zipSync(input, { level: 6, mtime: new Date(1980, 0, 1) });
}

/**
 * Hand the bytes to the browser as a download. Recovered from the Markdown
 * export this plugin shipped until commit 77f1412. There is no completion
 * signal available to script, so callers return to idle themselves rather
 * than waiting for one.
 */
export function downloadBytes(bytes: Uint8Array, filename: string, type: string): void {
  // Copy into a plain ArrayBuffer to satisfy Blob constructor typings for byte
  // sources whose buffer may be an ArrayBufferLike (e.g. SharedArrayBuffer).
  const buffer: ArrayBuffer = bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    : new Uint8Array(bytes).buffer as ArrayBuffer;
  const blob = new Blob([buffer], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
