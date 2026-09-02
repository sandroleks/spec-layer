import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The pull key lives beside speclayer.json, not inside the output directory:
 * `.speclayer/` is disposable pull output and `rm -rf .speclayer` must not
 * destroy the credential.
 */
export const CREDENTIALS_NAME = 'speclayer.local.json';

export interface StoredKey { libraryId: string; key: string }

const unreadable = () => new Error(
  `${CREDENTIALS_NAME} cannot be read. Delete it, then run the setup command `
  + `from the plugin's Library screen.`,
);

/**
 * The stored key, or null when there is no file. Throws when a file exists but
 * cannot be used: silently ignoring it would send no key and report a missing
 * one, hiding a corrupt file behind a confusing error.
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
  // `mode` above applies only on create, so an existing loose file keeps its
  // permissions without this.
  chmodSync(path, 0o600);
  return { replaced };
}
