import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/**
 * A visible directory is one the team sees and commits (tokens/,
 * component-specs/), as opposed to the swapped record under outDir. The CLI
 * owns exactly the files in it that begin with the directory's marker: it
 * replaces or removes those and never touches anything else. Spec:
 * docs/superpowers/specs/2026-09-09-css-token-directory-design.md, section 5.
 */

const inside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const isDotfile = (name: string): boolean => name.startsWith('.');

/**
 * Whether the file at `abs` begins with `marker`. Reads only enough bytes for
 * `marker` itself, plus one byte per `\n` it contains, so a CRLF checkout of
 * a marker that spans lines (a Git for Windows repository with
 * core.autocrlf=true) still reads the whole prefix. `\r\n` is then folded
 * back to `\n` before the comparison, so the check does not care which line
 * ending the file on disk uses.
 */
export function carriesMarker(abs: string, marker: string): boolean {
  const newlines = (marker.match(/\n/g) ?? []).length;
  const wantBytes = Buffer.byteLength(marker, 'utf8') + newlines;
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(wantBytes);
    const read = readSync(fd, buf, 0, wantBytes, 0);
    const text = buf.subarray(0, read).toString('utf8').replace(/\r\n/g, '\n');
    return text.startsWith(marker);
  } finally {
    closeSync(fd);
  }
}

/**
 * Why `dir` cannot be written as a visible directory, or null when it can.
 * `others` are the other visible directories of this pull. `configKey` names
 * the speclayer.json field that controls this path, so the refusal tells the
 * reader exactly what to edit.
 */
export function visibleDirProblem(
  cwd: string, outDir: string, dir: string, marker: string, others: string[], configKey: string,
): string | null {
  const root = resolve(cwd);
  const abs = resolve(cwd, dir);
  if (!inside(root, abs) || abs === root) return `${dir} is outside this directory. Choose a path inside the repository.`;
  if (inside(resolve(cwd, outDir), abs)) return `${dir} is inside ${outDir}, which pull replaces wholesale. Choose a path outside it.`;
  for (const other of others) {
    const otherAbs = resolve(cwd, other);
    if (inside(abs, otherAbs) || inside(otherAbs, abs)) return `${dir} and ${other} overlap. Give each output its own directory.`;
  }
  if (!existsSync(abs)) return null;
  if (!lstatSync(abs).isDirectory()) return `${dir} exists and is not a directory. Choose another path or remove the file.`;
  const foreign = `${dir} holds files spec-layer did not write. Set ${configKey} in speclayer.json to another path, or move them.`;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (isDotfile(entry.name)) continue;
    if (!entry.isFile()) return foreign;
    try {
      if (!carriesMarker(join(abs, entry.name), marker)) return foreign;
    } catch {
      return `${dir}/${entry.name} could not be read.`;
    }
  }
  return null;
}

/** Writes to <path>.partial, then renames over the target, so a reader never sees a half file. */
function writeAtomically(abs: string, text: string): void {
  const partial = `${abs}.partial`;
  writeFileSync(partial, text);
  try {
    renameSync(partial, abs);
  } catch (err) {
    rmSync(partial, { force: true });
    throw err;
  }
}

/**
 * Writes `files` into `dir`, `last` after the others (index.css, so an import
 * never names a missing file), then removes every marked non-dot file this
 * write did not produce. Returns the names written, in write order. Assumes
 * visibleDirProblem returned null for this directory.
 */
export function writeVisibleDir(cwd: string, dir: string, marker: string, files: Record<string, string>, last?: string): string[] {
  const abs = resolve(cwd, dir);
  const names = Object.keys(files).filter((n) => n !== last);
  if (last !== undefined && last in files) names.push(last);
  if (names.length === 0 && !existsSync(abs)) return [];
  mkdirSync(abs, { recursive: true });
  for (const name of names) writeAtomically(join(abs, name), files[name]);
  const keep = new Set(names);
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (isDotfile(entry.name) || keep.has(entry.name) || !entry.isFile()) continue;
    const path = join(abs, entry.name);
    if (carriesMarker(path, marker)) rmSync(path);
  }
  return names;
}
