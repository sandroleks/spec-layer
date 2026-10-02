import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { main, USAGE } from '../src/main';
import { cliVersion } from '../src/version';

function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const cwd = mkdtempSync(join(tmpdir(), 'sl-main-'));
  const done = main(argv, {
    cwd, env: {}, stdin: Readable.from([]),
    io: { out: (l) => out.push(l), err: (l) => err.push(l), write: (t) => out.push(t) },
  }).finally(() => rmSync(cwd, { recursive: true, force: true }));
  return done.then((code) => ({ code, out, err }));
}

describe('main', () => {
  it.each([['--help'], ['-h'], ['help'], ['pull', '--help']])('%s prints the usage to stdout and exits 0', async (...argv) => {
    const { code, out, err } = await run(argv);
    expect(code).toBe(0);
    expect(out).toEqual([USAGE]);
    expect(err).toEqual([]);
  });

  it.each([['--version'], ['-v']])('%s prints only the version and exits 0', async (flag) => {
    const { code, out } = await run([flag]);
    expect(code).toBe(0);
    expect(out).toEqual([cliVersion()]);
    expect(cliVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('prints the usage to stderr and exits 1 with no command', async () => {
    const { code, out, err } = await run([]);
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual([USAGE]);
  });

  it('prints the usage to stderr and exits 1 for an unknown command or flag', async () => {
    for (const argv of [['frobnicate'], ['pull', '--no-such-flag']]) {
      const { code, err } = await run(argv);
      expect(code, argv.join(' ')).toBe(1);
      expect(err, argv.join(' ')).toEqual([USAGE]);
    }
  });

  it('dispatches a local command with its flags', async () => {
    const { code, out } = await run(['tools', '--json']);
    expect(code).toBe(0);
    expect(JSON.parse(out.join(''))).toMatchObject({ cli: 'spec-layer', version: cliVersion() });
  });

  it('mentions --help, --version and SPEC_LAYER_RETRIES in the usage', () => {
    expect(USAGE).toMatch(/--help/);
    expect(USAGE).toMatch(/--version/);
    expect(USAGE).toMatch(/SPEC_LAYER_RETRIES/);
  });
});
