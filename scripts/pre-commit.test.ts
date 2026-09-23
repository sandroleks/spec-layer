import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const hook = resolve(fileURLToPath(new URL('.', import.meta.url)), '../.githooks/pre-commit');

/** Stages `content` as `name` in a throwaway repository and runs the hook there. */
function runHook(name: string, content: string): { status: number | null; output: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'sl-hook-'));
  try {
    expect(spawnSync('git', ['init', '-q'], { cwd }).status).toBe(0);
    writeFileSync(join(cwd, name), content);
    expect(spawnSync('git', ['add', name], { cwd }).status).toBe(0);
    const run = spawnSync('bash', [hook], { cwd, encoding: 'utf8' });
    return { status: run.status, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// Each case spawns three processes (git init, git add, the bash hook), so a
// loaded runner can push a case past vitest's default 5000 ms timeout with
// no change in the hook's own behaviour. A longer timeout absorbs that load
// sensitivity; it never hides a real regression the way a retry would.
describe('.githooks/pre-commit', { timeout: 20000 }, () => {
  // Fake values are assembled at runtime from repeated characters, so this
  // file never holds a string the hook itself would reject.
  it.each([
    ['a Spec Layer pull key', `key: sl_${'0123456789abcdef'.repeat(3)}\n`, 'sl_[0-9a-f]{48}'],
    ['an npm access token', `//registry.npmjs.org/:_authToken=npm_${'A1b2C3d4E5f6'.repeat(3)}\n`, 'npm_[A-Za-z0-9]{36}'],
    ['a Cloudflare API token assignment', `CLOUDFLARE_API_TOKEN=${'x'.repeat(40)}\n`, 'CLOUDFLARE_API_TOKEN='],
  ])('blocks a staged file holding %s', (_label, content, pattern) => {
    const { status, output } = runHook('notes.txt', content);
    expect(status).toBe(1);
    expect(output).toContain('Possible secret detected');
    expect(output).toContain(pattern);
  });

  it('lets a file that only builds such a value at runtime through', () => {
    expect(runHook('fixture.ts', 'const KEY = `sl_${"a".repeat(48)}`;\n').status).toBe(0);
  });
});
