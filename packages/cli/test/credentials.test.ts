import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readCredentials, writeCredentials, CREDENTIALS_NAME } from '../src/credentials';

const LIB = 'lib_aaaaaaaaaaaaaaaaaaaaaaaa';
const KEY = `sl_${'a'.repeat(48)}`;

describe('credentials', () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'sl-cred-')); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it('is named speclayer.local.json', () => {
    expect(CREDENTIALS_NAME).toBe('speclayer.local.json');
  });

  it('reads null when there is no file', () => {
    expect(readCredentials(cwd)).toBeNull();
  });

  it('round-trips the library id and key', () => {
    const result = writeCredentials(cwd, { libraryId: LIB, key: KEY });
    expect(result.replaced).toBe(false);
    expect(readCredentials(cwd)).toEqual({ libraryId: LIB, key: KEY });
  });

  it('writes mode 0600 on create', () => {
    writeCredentials(cwd, { libraryId: LIB, key: KEY });
    const mode = statSync(join(cwd, CREDENTIALS_NAME)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  // writeFileSync's `mode` option applies only when the file is created, so an
  // overwrite of a loose-permission file needs an explicit chmod.
  it('forces mode 0600 on overwrite of a loose file', () => {
    const path = join(cwd, CREDENTIALS_NAME);
    writeFileSync(path, '{}\n');
    chmodSync(path, 0o644);
    const result = writeCredentials(cwd, { libraryId: LIB, key: KEY });
    expect(result.replaced).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('throws a message naming the setup command on malformed JSON', () => {
    writeFileSync(join(cwd, CREDENTIALS_NAME), '{ not json');
    expect(() => readCredentials(cwd)).toThrow(/speclayer\.local\.json/);
    expect(() => readCredentials(cwd)).toThrow(/setup command/);
  });

  it('throws when the fields are the wrong shape', () => {
    writeFileSync(join(cwd, CREDENTIALS_NAME), JSON.stringify({ libraryId: LIB }));
    expect(() => readCredentials(cwd)).toThrow(/setup command/);
    writeFileSync(join(cwd, CREDENTIALS_NAME), JSON.stringify({ libraryId: 7, key: KEY }));
    expect(() => readCredentials(cwd)).toThrow(/setup command/);
  });

  it('never puts anything but the two fields on disk', () => {
    writeCredentials(cwd, { libraryId: LIB, key: KEY });
    const parsed = JSON.parse(readFileSync(join(cwd, CREDENTIALS_NAME), 'utf8'));
    expect(Object.keys(parsed).sort()).toEqual(['key', 'libraryId']);
  });
});
