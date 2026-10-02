import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// node:fs is not spyable under ESM (see files.test.ts), so the order of calls
// is recorded through vi.mock.
const calls = vi.hoisted(() => ({ log: [] as string[] }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    chmodSync: (path: unknown, mode: unknown) => {
      calls.log.push(`chmod ${String(mode)}`);
      return actual.chmodSync(path as string, mode as number);
    },
    writeFileSync: (path: unknown, ...rest: unknown[]) => {
      if (String(path).endsWith('speclayer.local.json')) calls.log.push('write');
      return (actual.writeFileSync as (...args: unknown[]) => unknown)(path, ...rest);
    },
  };
});

const { CREDENTIALS_NAME, writeCredentials } = await import('../src/credentials');

let cwd: string;
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'sl-cred-order-')); calls.log = []; });
afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

describe('writeCredentials', () => {
  it('tightens an existing file before the new key is written into it', () => {
    writeFileSync(join(cwd, CREDENTIALS_NAME), '{}\n');
    calls.log = [];
    writeCredentials(cwd, { libraryId: `lib_${'a'.repeat(24)}`, key: `sl_${'b'.repeat(48)}` });
    expect(calls.log[0]).toBe(`chmod ${0o600}`);
    expect(calls.log.indexOf('write')).toBeGreaterThan(0);
  });
});
