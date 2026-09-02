import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureIgnored } from '../src/gitignore';

const NAME = 'speclayer.local.json';

function gitInit(cwd: string): void {
  const res = spawnSync('git', ['init', '-q'], { cwd });
  if (res.status !== 0) throw new Error('git init failed; git must be on PATH for these tests');
}

describe('ensureIgnored', () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'sl-ignore-')); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it('reports not-a-repo outside a git working tree', () => {
    expect(ensureIgnored(cwd, NAME)).toEqual({ kind: 'not-a-repo' });
    expect(existsSync(join(cwd, '.gitignore'))).toBe(false);
  });

  it('creates .gitignore with the entry when there is none', () => {
    gitInit(cwd);
    expect(ensureIgnored(cwd, NAME)).toEqual({ kind: 'created' });
    expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).toContain(NAME);
  });

  it('appends to an existing .gitignore', () => {
    gitInit(cwd);
    writeFileSync(join(cwd, '.gitignore'), 'node_modules\n');
    expect(ensureIgnored(cwd, NAME)).toEqual({ kind: 'added' });
    const body = readFileSync(join(cwd, '.gitignore'), 'utf8');
    expect(body).toContain('node_modules');
    expect(body).toContain(NAME);
  });

  it('appends cleanly when the file has no trailing newline', () => {
    gitInit(cwd);
    writeFileSync(join(cwd, '.gitignore'), 'node_modules');
    ensureIgnored(cwd, NAME);
    const lines = readFileSync(join(cwd, '.gitignore'), 'utf8').split('\n');
    expect(lines).toContain('node_modules');
    expect(lines).toContain(NAME);
  });

  it('is idempotent: a second call adds nothing', () => {
    gitInit(cwd);
    ensureIgnored(cwd, NAME);
    const first = readFileSync(join(cwd, '.gitignore'), 'utf8');
    expect(ensureIgnored(cwd, NAME)).toEqual({ kind: 'already' });
    expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).toBe(first);
  });

  // A broad pattern already covers the file, so appending the name would be
  // noise. git decides, so this passes without any pattern parsing.
  it('reports already when a wildcard pattern covers the file', () => {
    gitInit(cwd);
    writeFileSync(join(cwd, '.gitignore'), '*.local.json\n');
    expect(ensureIgnored(cwd, NAME)).toEqual({ kind: 'already' });
  });

  it('refuses when .gitignore cannot be written', () => {
    if (process.getuid?.() === 0) return; // root ignores the mode bits
    gitInit(cwd);
    const path = join(cwd, '.gitignore');
    writeFileSync(path, 'node_modules\n');
    chmodSync(path, 0o444);
    const result = ensureIgnored(cwd, NAME);
    expect(result.kind).toBe('refused');
    expect((result as { kind: 'refused'; line: string }).line).toBe(NAME);
    chmodSync(path, 0o644);
  });
});
