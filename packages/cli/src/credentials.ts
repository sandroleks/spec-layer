import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

/** Beside speclayer.json, not in `.speclayer/`: deleting pull output must not destroy the key. */
export const CREDENTIALS_NAME = 'speclayer.local.json';

export interface StoredKey { libraryId: string; key: string }

const unreadable = () => new Error(
  `${CREDENTIALS_NAME} cannot be read. Delete it, then run the setup command `
  + `from the plugin's Publish screen.`,
);

/**
 * The stored key, or null when there is no file. Throws on an unusable file,
 * which ignoring would hide behind a "missing key" error.
 */
export function readCredentials(cwd: string): StoredKey | null {
  const path = join(cwd, CREDENTIALS_NAME);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { throw unreadable(); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw unreadable();
  const record = parsed as Record<string, unknown>;
  if (typeof record.libraryId !== 'string' || typeof record.key !== 'string') throw unreadable();
  return { libraryId: record.libraryId, key: record.key };
}

/** Writes the key at mode 0600. `replaced` is true when a file was already there. */
export function writeCredentials(cwd: string, stored: StoredKey): { replaced: boolean } {
  const path = join(cwd, CREDENTIALS_NAME);
  const replaced = existsSync(path);
  const body = { libraryId: stored.libraryId, key: stored.key };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  // `mode` applies only on create; this tightens an existing loose file.
  chmodSync(path, 0o600);
  return { replaced };
}
