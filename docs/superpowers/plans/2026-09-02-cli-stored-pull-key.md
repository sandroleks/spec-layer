# Stored pull key for the spec-layer CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A developer pastes one command from the Figma plugin, and every later `spec-layer` command in that repo works with no key in the environment.

**Architecture:** The pull key is stored in a repo-local `speclayer.local.json` beside the committable `speclayer.json`, at mode `0600`, ignored by git before it is ever written. Key resolution gains the file as a third source below `--key` and `SPEC_LAYER_KEY`. A new `setup` command owns the whole first run: config, gitignore, key, pull.

**Tech Stack:** TypeScript, Node >= 22 builtins only (`node:fs`, `node:path`, `node:child_process`), Vitest, esbuild. No new dependencies.

Design: `docs/superpowers/specs/2026-09-02-cli-stored-pull-key-design.md`

## Global Constraints

- **The CLI has zero runtime dependencies.** Node builtins only. `node:child_process` is a builtin and is allowed.
- **Node >= 22.** `packages/cli/package.json` sets this floor; do not lower it.
- **The key never reaches committable output.** Not `speclayer.json`, not `bundle.json`, not `manifest.json`, nothing under the output directory.
- **No command prints the key.** Not on stdout, not on stderr, not in an error path. Report the fact of writing, never the value.
- **No em dashes in plugin UI copy.** Ever. Sentence case, second person, no hype words, honest about limits. See `docs/plugin-voice-and-copy.md`.
- **The extractor stays Figma-free and `EXTRACTOR_VERSION` is untouched.** This work does not change extraction output.
- **Single-line conventional commits, lowercase, scoped.** `feat(cli): ...`, `fix(plugin): ...`, `docs: ...`.
- **`npm run check` must pass before the final commit.** It runs lint, typecheck, the NUL scan, tests, both builds, `check:cli-bundle`, the sandbox scan, and the proxy dry run. Read its exit status directly; never pipe it through anything that swallows the code.
- **Gate order matters:** the gitignore entry is ensured *before* the credential file is written, in every code path.

---

### Task 1: The credential file

**Files:**
- Create: `packages/cli/src/credentials.ts`
- Test: `packages/cli/test/credentials.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `CREDENTIALS_NAME: string` (the literal `'speclayer.local.json'`)
  - `interface StoredKey { libraryId: string; key: string }`
  - `readCredentials(cwd: string): StoredKey | null` — null when absent, throws `Error` when present and unusable
  - `writeCredentials(cwd: string, stored: StoredKey): { replaced: boolean }`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/credentials.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/test/credentials.test.ts`
Expected: FAIL, cannot resolve `../src/credentials`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/cli/src/credentials.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/test/credentials.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/credentials.ts packages/cli/test/credentials.test.ts
git commit -m "feat(cli): store the pull key in speclayer.local.json at mode 0600"
```

---

### Task 2: Gitignore enforcement

**Files:**
- Create: `packages/cli/src/gitignore.ts`
- Test: `packages/cli/test/gitignore.test.ts`

**Interfaces:**
- Consumes: `CREDENTIALS_NAME` from Task 1 (tests only; the module takes any file name).
- Produces:
  - `type IgnoreResult = { kind: 'already' } | { kind: 'added' } | { kind: 'created' } | { kind: 'not-a-repo' } | { kind: 'refused'; line: string }`
  - `ensureIgnored(cwd: string, fileName: string): IgnoreResult`

Whether a file is ignored is decided by `git check-ignore`, not by string matching, so a global ignore file or a broad pattern such as `*.local.json` counts and a second run appends nothing.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/gitignore.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/test/gitignore.test.ts`
Expected: FAIL, cannot resolve `../src/gitignore`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/cli/src/gitignore.ts`:

```ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export type IgnoreResult =
  | { kind: 'already' }
  | { kind: 'added' }
  | { kind: 'created' }
  | { kind: 'not-a-repo' }
  | { kind: 'refused'; line: string };

const COMMENT = '# Spec Layer pull key, not for committing';

/** Quiet, never-throwing git call. `null` means git could not run at all. */
function git(cwd: string, args: string[]): number | null {
  const res = spawnSync('git', args, { cwd, stdio: 'ignore' });
  if (res.error || res.status === null) return null;
  return res.status;
}

/**
 * Make sure git ignores `fileName` in `cwd` before a secret is written there.
 *
 * Whether it is already ignored is git's answer, not a string match, so a
 * global ignore file, a broader pattern such as `*.local.json`, or a line
 * already present all count and a repeat run appends nothing.
 *
 * `.gitignore` in `cwd` rather than at `git rev-parse --show-toplevel`: git
 * honours a nested ignore file for its own directory, and that avoids guessing
 * wrong in a monorepo.
 */
export function ensureIgnored(cwd: string, fileName: string): IgnoreResult {
  if (git(cwd, ['rev-parse', '--is-inside-work-tree']) !== 0) return { kind: 'not-a-repo' };
  if (git(cwd, ['check-ignore', '-q', fileName]) === 0) return { kind: 'already' };

  const path = join(cwd, '.gitignore');
  const existed = existsSync(path);
  try {
    if (!existed) {
      writeFileSync(path, `${COMMENT}\n${fileName}\n`);
      return { kind: 'created' };
    }
    const body = readFileSync(path, 'utf8');
    const lead = body.length === 0 || body.endsWith('\n') ? '' : '\n';
    writeFileSync(path, `${body}${lead}${COMMENT}\n${fileName}\n`);
    return { kind: 'added' };
  } catch {
    return { kind: 'refused', line: fileName };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/test/gitignore.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/gitignore.ts packages/cli/test/gitignore.test.ts
git commit -m "feat(cli): ensure git ignores the key file before writing it"
```

---

### Task 3: Key resolution order

**Files:**
- Modify: `packages/cli/src/config.ts` (the `ResolvedOptions` interface and `resolveOptions`)
- Test: `packages/cli/test/config.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `readCredentials`, `CREDENTIALS_NAME` from Task 1.
- Produces: `ResolvedOptions` gains one optional field:
  - `storedKeyFor?: string` — set when a credential file exists but names a different library than the one resolved. Task 4 turns this into the mismatch message.

Resolution becomes `--key`, then `SPEC_LAYER_KEY`, then the file. Environment above file so CI overrides without editing the working tree.

The file is read **only** when neither the flag nor the environment supplies a key. A corrupt credential file must not break an explicit `--key`.

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/test/config.test.ts`:

```ts
describe('resolveOptions key sources', () => {
  let cwd: string;
  const stub = (_outDir: string) => null;
  const LIB = 'lib_aaaaaaaaaaaaaaaaaaaaaaaa';
  const STORED = `sl_${'s'.repeat(48)}`;

  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'sl-cfg-')); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  const writeStored = (libraryId: string, key: string) => {
    writeFileSync(join(cwd, 'speclayer.local.json'), JSON.stringify({ libraryId, key }));
  };

  it('uses the stored key when neither flag nor env has one', () => {
    writeStored(LIB, STORED);
    const result = resolveOptions(cwd, { id: LIB }, {}, stub);
    expect(result.key).toBe(STORED);
    expect(result.storedKeyFor).toBeUndefined();
  });

  it('lets --key and SPEC_LAYER_KEY beat the stored key', () => {
    writeStored(LIB, STORED);
    expect(resolveOptions(cwd, { id: LIB, key: 'from-flag' }, {}, stub).key).toBe('from-flag');
    expect(resolveOptions(cwd, { id: LIB }, { SPEC_LAYER_KEY: 'from-env' }, stub).key).toBe('from-env');
  });

  it('ignores a stored key issued for another library and reports which', () => {
    writeStored('lib_ffffffffffffffffffffffff', STORED);
    const result = resolveOptions(cwd, { id: LIB }, {}, stub);
    expect(result.key).toBeNull();
    expect(result.storedKeyFor).toBe('lib_ffffffffffffffffffffffff');
  });

  // A corrupt credential file must not break a run that never needed it.
  it('does not read the credential file when a key is already supplied', () => {
    writeFileSync(join(cwd, 'speclayer.local.json'), '{ not json');
    expect(resolveOptions(cwd, { id: LIB, key: 'from-flag' }, {}, stub).key).toBe('from-flag');
    expect(() => resolveOptions(cwd, { id: LIB }, {}, stub)).toThrow(/setup command/);
  });

  it('returns a null key with no file at all', () => {
    expect(resolveOptions(cwd, { id: LIB }, {}, stub).key).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/test/config.test.ts`
Expected: FAIL. The stored-key tests get `null`, and `storedKeyFor` does not exist.

- [ ] **Step 3: Write minimal implementation**

In `packages/cli/src/config.ts`, add the import:

```ts
import { readCredentials } from './credentials';
```

Add the field to `ResolvedOptions`:

```ts
export interface ResolvedOptions {
  libraryId: string | null; outDir: string; api: string; key: string | null;
  /** The config's include block, when it has one, for pull to fall back on. */
  include?: Selection;
  /**
   * Set when a credential file exists but was issued for another library, so
   * the caller can say that instead of reporting a plain missing key.
   */
  storedKeyFor?: string;
}
```

Replace the body of `resolveOptions` after `libraryId` is computed:

```ts
export function resolveOptions(
  cwd: string,
  flags: { id?: string; out?: string; key?: string; api?: string },
  env: Record<string, string | undefined>,
  manifestLibraryId: (outDir: string) => string | null,
): ResolvedOptions {
  const config = readConfig(cwd);
  const outDir = flags.out ?? config?.outDir ?? DEFAULT_OUT_DIR;
  const libraryId = flags.id ?? config?.libraryId ?? manifestLibraryId(join(cwd, outDir));

  // Read the credential file only when nothing else supplies a key, so a
  // corrupt file cannot break a run that passed --key or set SPEC_LAYER_KEY.
  const supplied = flags.key ?? env.SPEC_LAYER_KEY ?? null;
  let storedKey: string | null = null;
  let storedKeyFor: string | undefined;
  if (!supplied) {
    const stored = readCredentials(cwd);
    if (stored) {
      if (libraryId && stored.libraryId === libraryId) storedKey = stored.key;
      else storedKeyFor = stored.libraryId;
    }
  }

  return {
    libraryId,
    outDir,
    // A trailing slash would build "//v1/..." paths the proxy router 404s on.
    api: (flags.api ?? env.SPEC_LAYER_API ?? DEFAULT_API).replace(/\/+$/, ''),
    key: supplied ?? storedKey,
    ...(config?.include ? { include: config.include } : {}),
    ...(storedKeyFor ? { storedKeyFor } : {}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/test/config.test.ts`
Expected: PASS, including the pre-existing precedence tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/config.ts packages/cli/test/config.test.ts
git commit -m "feat(cli): read the stored key below --key and SPEC_LAYER_KEY"
```

---

### Task 4: The `setup` command

**Files:**
- Modify: `packages/cli/src/commands.ts` (add `runSetup`, change the missing-key message in `resolved`, change the trailing line of `runInit`)
- Modify: `packages/cli/src/cli.ts` (`USAGE` and the command dispatch)
- Modify: `packages/cli/src/api.ts:25` (point the rotated-key error at the recovery path)
- Test: `packages/cli/test/commands.test.ts` (append a describe block, update one existing assertion)

**Interfaces:**
- Consumes: `CREDENTIALS_NAME`, `writeCredentials` (Task 1); `ensureIgnored` (Task 2); `storedKeyFor` on `ResolvedOptions` (Task 3).
- Produces: `runSetup(cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io, fetcher?: typeof fetch): Promise<number>`

Order inside `runSetup` is load-bearing: config, then gitignore, then key, then pull. Config first because `speclayer.json` holds no secret and leaves the repo configured even if a later step refuses. Gitignore before the key so the secret is ignored before it exists. Pull last so a network failure leaves a usable setup behind that a bare `spec-layer pull` retries.

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/test/commands.test.ts`. It reuses `makeIo`, `GOOD_BUNDLE`, `stub200` and `stub401` already defined at the top of that file:

```ts
describe('runSetup', () => {
  let cwd: string;
  const LIB = 'lib_aaaaaaaaaaaaaaaaaaaaaaaa';
  const KEY = `sl_${'a'.repeat(48)}`;

  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'sl-setup-')); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  const gitInit = () => {
    const res = spawnSync('git', ['init', '-q'], { cwd });
    if (res.status !== 0) throw new Error('git init failed; git must be on PATH');
  };
  const stored = () => JSON.parse(readFileSync(join(cwd, 'speclayer.local.json'), 'utf8'));

  it('writes the config, ignores the key file, stores the key, then pulls', async () => {
    gitInit();
    const io = makeIo();
    const code = await runSetup(cwd, { id: LIB, key: KEY }, {}, io, stub200());

    expect(code).toBe(0);
    expect(readConfig(cwd)).toMatchObject({ libraryId: LIB, outDir: '.speclayer' });
    expect(readFileSync(join(cwd, '.gitignore'), 'utf8')).toContain('speclayer.local.json');
    expect(stored()).toEqual({ libraryId: LIB, key: KEY });
    expect(existsSync(join(cwd, '.speclayer', 'manifest.json'))).toBe(true);
    expect(io.outLines.join('\n')).toMatch(/Pulled/);
  });

  it('takes the key from SPEC_LAYER_KEY when --key is absent', async () => {
    gitInit();
    const io = makeIo();
    const code = await runSetup(cwd, { id: LIB }, { SPEC_LAYER_KEY: KEY }, io, stub200());
    expect(code).toBe(0);
    expect(stored().key).toBe(KEY);
  });

  it('errors without an id, before writing anything', async () => {
    const io = makeIo();
    expect(await runSetup(cwd, { key: KEY }, {}, io, stub200())).toBe(1);
    expect(io.errLines.join('\n')).toMatch(/--id/);
    expect(existsSync(join(cwd, 'speclayer.json'))).toBe(false);
    expect(existsSync(join(cwd, 'speclayer.local.json'))).toBe(false);
  });

  it('errors without a key, before writing anything', async () => {
    const io = makeIo();
    expect(await runSetup(cwd, { id: LIB }, {}, io, stub200())).toBe(1);
    expect(io.errLines.join('\n')).toMatch(/--key/);
    expect(io.errLines.join('\n')).toMatch(/SPEC_LAYER_KEY/);
    expect(existsSync(join(cwd, 'speclayer.json'))).toBe(false);
  });

  it('stores the key outside a git repo and says it skipped .gitignore', async () => {
    const io = makeIo();
    expect(await runSetup(cwd, { id: LIB, key: KEY }, {}, io, stub200())).toBe(0);
    expect(stored().key).toBe(KEY);
    expect(io.outLines.join('\n')).toMatch(/[Nn]ot a git repository/);
    expect(existsSync(join(cwd, '.gitignore'))).toBe(false);
  });

  // The awkward case, chosen deliberately: an un-ignored secret in a git
  // working tree is worse than a failed setup.
  it('writes no key when .gitignore cannot be updated', async () => {
    if (process.getuid?.() === 0) return;
    gitInit();
    const path = join(cwd, '.gitignore');
    writeFileSync(path, 'node_modules\n');
    chmodSync(path, 0o444);
    const io = makeIo();
    const code = await runSetup(cwd, { id: LIB, key: KEY }, {}, io, stub200());
    chmodSync(path, 0o644);

    expect(code).toBe(1);
    expect(existsSync(join(cwd, 'speclayer.local.json'))).toBe(false);
    expect(io.errLines.join('\n')).toContain('speclayer.local.json');
  });

  it('reports a replacement rather than a fresh write on a second run', async () => {
    gitInit();
    await runSetup(cwd, { id: LIB, key: KEY }, {}, makeIo(), stub200());
    const io = makeIo();
    const next = `sl_${'b'.repeat(48)}`;
    expect(await runSetup(cwd, { id: LIB, key: next }, {}, io, stub200())).toBe(0);
    expect(stored().key).toBe(next);
    expect(io.outLines.join('\n')).toMatch(/[Rr]eplaced/);
  });

  it('exits with the pull code and still leaves a usable setup', async () => {
    gitInit();
    const io = makeIo();
    expect(await runSetup(cwd, { id: LIB, key: KEY }, {}, io, stub401())).toBe(1);
    expect(stored().key).toBe(KEY);
    expect(readConfig(cwd)).toMatchObject({ libraryId: LIB });
  });

  it('honours --out and the selection flags like init does', async () => {
    gitInit();
    const io = makeIo();
    const code = await runSetup(
      cwd, { id: LIB, key: KEY, out: 'design-context', only: 'foundation' }, {}, io, stub200(),
    );
    expect(code).toBe(0);
    expect(readConfig(cwd)).toMatchObject({
      outDir: 'design-context', include: { foundation: true, components: [] },
    });
    expect(existsSync(join(cwd, 'design-context', 'manifest.json'))).toBe(true);
  });

  it('never prints the key', async () => {
    gitInit();
    const io = makeIo();
    await runSetup(cwd, { id: LIB, key: KEY }, {}, io, stub200());
    const everything = [...io.outLines, ...io.errLines, ...io.writes].join('\n');
    expect(everything).not.toContain(KEY);
  });
});

describe('stored key errors', () => {
  let cwd: string;
  const LIB = 'lib_aaaaaaaaaaaaaaaaaaaaaaaa';

  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'sl-stored-')); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it('names the setup command when no source has a key', async () => {
    const io = makeIo();
    expect(await runPull(cwd, { id: LIB }, {}, io, stub200())).toBe(1);
    expect(io.errLines.join('\n')).toMatch(/setup command/);
    expect(io.errLines.join('\n')).toMatch(/SPEC_LAYER_KEY/);
  });

  it('says which library a mismatched stored key belongs to', async () => {
    writeFileSync(
      join(cwd, 'speclayer.local.json'),
      JSON.stringify({ libraryId: 'lib_ffffffffffffffffffffffff', key: `sl_${'a'.repeat(48)}` }),
    );
    const io = makeIo();
    expect(await runPull(cwd, { id: LIB }, {}, io, stub200())).toBe(1);
    expect(io.errLines.join('\n')).toContain('lib_ffffffffffffffffffffffff');
    expect(io.errLines.join('\n')).toMatch(/setup command/);
  });

  it('reports an unreadable credential file and exits 1', async () => {
    writeFileSync(join(cwd, 'speclayer.local.json'), '{ not json');
    const io = makeIo();
    expect(await runPull(cwd, { id: LIB }, {}, io, stub200())).toBe(1);
    expect(io.errLines.join('\n')).toContain('speclayer.local.json');
    expect(io.errLines.join('\n')).toMatch(/setup command/);
  });

  /**
   * An invariant from the design: list and show need no key, so they must not
   * touch the credential file at all. A malformed one would throw if they did.
   */
  it('list and show ignore the credential file entirely', async () => {
    await runSetup(cwd, { id: LIB, key: `sl_${'a'.repeat(48)}` }, {}, makeIo(), stub200());
    writeFileSync(join(cwd, 'speclayer.local.json'), '{ not json');

    const listIo = makeIo();
    expect(runList(cwd, {}, listIo)).toBe(0);
    const showIo = makeIo();
    expect(runShow(cwd, {}, ['foundation'], showIo)).toBe(0);

    const everything = [
      ...listIo.outLines, ...listIo.errLines, ...showIo.outLines, ...showIo.errLines,
    ].join('\n');
    expect(everything).not.toContain('speclayer.local.json');
  });
});
```

Extend the imports at the top of `packages/cli/test/commands.test.ts`:

```ts
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runInit, runSetup, runPull, runStatus, runList, runShow, type Io } from '../src/commands';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/test/commands.test.ts`
Expected: FAIL, `runSetup` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `packages/cli/src/commands.ts`, extend the imports:

```ts
import { CREDENTIALS_NAME, writeCredentials } from './credentials';
import { ensureIgnored } from './gitignore';
```

Replace the missing-key branch in `resolved`:

```ts
  if (!opts.key) {
    io.err(opts.storedKeyFor
      ? `The key in ${CREDENTIALS_NAME} was issued for library ${opts.storedKeyFor}, not `
        + `${opts.libraryId}. Run the setup command from the plugin's Library screen.`
      : 'No pull key. Run the setup command from the plugin\'s Library screen, '
        + 'or set SPEC_LAYER_KEY.');
    return null;
  }
```

Replace the trailing line of `runInit`:

```ts
  io.out(`The pull key is not stored here. Run spec-layer setup to store it in ${CREDENTIALS_NAME}, or set SPEC_LAYER_KEY.`);
```

Add `runSetup`, directly above `runPull`:

```ts
/**
 * First run in a repo: config, gitignore, key, pull.
 *
 * The order is load-bearing. speclayer.json first because it holds no secret
 * and leaves the repo configured even when a later step refuses. The gitignore
 * entry before the key, so the secret is ignored before it exists. The pull
 * last, so a network failure still leaves a usable setup that a bare
 * `spec-layer pull` retries.
 */
export async function runSetup(
  cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io, fetcher?: typeof fetch,
): Promise<number> {
  if (!flags.id) {
    io.err('spec-layer setup needs --id lib_... (shown in the plugin after publishing).');
    return 1;
  }
  const key = flags.key ?? env.SPEC_LAYER_KEY;
  if (!key) {
    io.err('spec-layer setup needs --key sl_..., or SPEC_LAYER_KEY in the environment.');
    return 1;
  }
  let include: Selection | null;
  try {
    include = selectionFromFlags(flags);
  } catch (err) {
    io.err(errorText(err));
    return 1;
  }

  const outDir = flags.out ?? DEFAULT_OUT_DIR;
  writeConfig(cwd, { libraryId: flags.id, outDir, ...(include ? { include } : {}) });
  io.out(`Wrote speclayer.json (library ${flags.id}, output ${outDir}).`);

  const ignored = ensureIgnored(cwd, CREDENTIALS_NAME);
  if (ignored.kind === 'refused') {
    io.err(`Could not add ${CREDENTIALS_NAME} to .gitignore, so the key was not written.`);
    io.err(`Add this line to .gitignore, then run the command again:\n${ignored.line}`);
    return 1;
  }
  if (ignored.kind === 'created') io.out(`Created .gitignore with ${CREDENTIALS_NAME}.`);
  if (ignored.kind === 'added') io.out(`Added ${CREDENTIALS_NAME} to .gitignore.`);
  if (ignored.kind === 'already') io.out(`${CREDENTIALS_NAME} is already ignored by git.`);
  if (ignored.kind === 'not-a-repo') io.out('Not a git repository, so .gitignore was left alone.');

  const { replaced } = writeCredentials(cwd, { libraryId: flags.id, key });
  io.out(replaced
    ? `Replaced the stored key in ${CREDENTIALS_NAME}.`
    : `Stored the pull key in ${CREDENTIALS_NAME}.`);

  // Pass the key through rather than relying on a re-read of what was just
  // written, so the pull cannot disagree with the file.
  return runPull(cwd, { ...flags, key }, env, io, fetcher);
}
```

In `packages/cli/src/cli.ts`, add to `USAGE` under `Commands:`, directly above the `init` line:

```text
  setup   --id lib_... --key sl_... [--out DIR] [selection]
                                                 store the key, then pull
```

and change the final line of `USAGE` to:

```text
The pull key comes from --key, SPEC_LAYER_KEY, or speclayer.local.json written by setup.
```

Add the import and the dispatch branch:

```ts
import { runInit, runSetup, runPull, runStatus, runList, runShow, type Flags, type Io } from './commands';
```

```ts
    if (command === 'setup') return await runSetup(cwd, values, process.env, io);
```

placed directly above the `init` branch.

In `packages/cli/src/api.ts:25`, change the message:

```ts
    return {
      kind: 'error',
      message: 'Key was rotated or revoked. Run the setup command from the plugin\'s '
        + 'Library screen to store the current key.',
    };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/cli`
Expected: PASS. One pre-existing `runInit` assertion checks the old "never stored here" line; update its expectation to match the new sentence, keeping it asserting that the output names where the key comes from. The `api.test.ts` and `commands.test.ts` assertions that match `/rotated or revoked/` still hold.

- [ ] **Step 5: Verify the built binary still loads**

```bash
npm run build:cli && npm run check:cli-bundle
```

Expected: both exit 0. `setup` reaches the bundle through `commands.ts`, and `node:child_process` must not break the ESM bundle.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands.ts packages/cli/src/cli.ts packages/cli/src/api.ts packages/cli/test/commands.test.ts
git commit -m "feat(cli): add setup to store the pull key and pull in one command"
```

---

### Task 5: Plugin setup command and copy

**Files:**
- Modify: `packages/plugin/src/ui/publish.ts:150-152` (`setupCommand`)
- Modify: `packages/plugin/src/ui/screens/publish.ts:39-41` (`DEVELOPER_SETUP`)
- Test: `packages/plugin/test/publish.test.ts:357-361`

**Interfaces:**
- Consumes: the `setup` command surface from Task 4. `npx spec-layer setup` only resolves once a CLI version containing it is on npm, so this task ships after that publish, not before.
- Produces: no new exports. `setupCommand(libraryId, pullKey)` keeps its signature and changes its output.

- [ ] **Step 1: Write the failing test**

Replace the `setupCommand` describe block in `packages/plugin/test/publish.test.ts`:

```ts
describe('setupCommand', () => {
  it('produces the exact one-liner', () => {
    expect(setupCommand('lib_aaaaaaaaaaaaaaaaaaaaaaaa', 'sl_' + 'b'.repeat(48)))
      .toBe('npx spec-layer setup --id lib_aaaaaaaaaaaaaaaaaaaaaaaa --key sl_' + 'b'.repeat(48));
  });

  // The voice rules forbid em dashes anywhere in plugin UI copy, and this
  // string is rendered into the publish screen.
  it('carries no em dash', () => {
    expect(setupCommand('lib_aaaaaaaaaaaaaaaaaaaaaaaa', 'sl_' + 'b'.repeat(48))).not.toContain('—');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/plugin/test/publish.test.ts -t setupCommand`
Expected: FAIL, the received string is the old `SPEC_LAYER_KEY=... npx spec-layer pull --id ...`.

- [ ] **Step 3: Write minimal implementation**

`packages/plugin/src/ui/publish.ts`:

```ts
export function setupCommand(libraryId: string, pullKey: string): string {
  return `npx spec-layer setup --id ${libraryId} --key ${pullKey}`;
}
```

`packages/plugin/src/ui/screens/publish.ts`, replacing `DEVELOPER_SETUP`:

```ts
const DEVELOPER_SETUP =
  'Developers run this in their repo. It stores the pull key so later pulls '
  + 'need no key, adds that file to .gitignore, and pulls the library. Anyone '
  + 'with the key can pull it.';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/plugin`
Expected: PASS. `publishScreen.test.ts` asserts the command contains `--id`, which still holds, and asserts ligatures are off because of that flag.

- [ ] **Step 5: Verify the plugin bundle and the sandbox scan**

```bash
npm run build:plugin && npm run check:sandbox
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/ui/publish.ts packages/plugin/src/ui/screens/publish.ts packages/plugin/test/publish.test.ts
git commit -m "feat(plugin): copy a setup command that stores the pull key"
```

---

### Task 6: Documentation and the manual row

**Files:**
- Modify: `packages/cli/README.md` (the "The pull key" section, and the quickstart block near line 17)
- Modify: `README.md:107` (the quickstart command)
- Modify: `CHANGELOG.md` (an entry under `## [Unreleased]` / `### Added`, and the reversal noted there)
- Modify: `docs/superpowers/specs/2026-09-01-library-publish-cli-design.md:104` (mark the decision superseded)
- Modify: `packages/plugin/TESTING.md` (one new row beside the existing "Publish and pull" rows)

**Interfaces:**
- Consumes: the behaviour from Tasks 1 to 5. Nothing consumes this task.
- Produces: no code.

- [ ] **Step 1: Rewrite the CLI README's pull key section**

Replace the section currently reading "Every command that talks to the server reads the pull key from `SPEC_LAYER_KEY` or `--key`. It is never written to disk..." with:

```markdown
## The pull key

`spec-layer setup` stores the key in `speclayer.local.json` next to
`speclayer.json`, at mode `0600`, and makes sure git ignores it before writing
it. Every later command in that directory needs no key.

Commands that talk to the server resolve the key in this order:

1. `--key sl_...`
2. `SPEC_LAYER_KEY` in the environment
3. `speclayer.local.json`, when it was issued for the same library

Environment sits above the file so CI can supply a key without touching the
working tree. A stored key issued for a different library is ignored, and the
CLI says which library it belongs to rather than letting the server answer 401.

Treat the key as a secret: it grants read access to the published bundle.
`speclayer.local.json` is gitignored, never printed by any command, and never
copied into `speclayer.json`, `bundle.json`, `manifest.json`, or anything under
the output directory. If it leaks, rotate it from the plugin's Library screen,
then run the new setup command. The old key stops working once the change
propagates, which can take up to about a minute.

Outside a git working tree the key is still stored and the CLI says it left
`.gitignore` alone. Inside one, if `.gitignore` cannot be updated, `setup`
refuses to write the key and prints the line to add.
```

- [ ] **Step 2: Update both quickstart blocks**

In `packages/cli/README.md`, the "Quick start" section currently reads:

```markdown
After publishing a library from the plugin's Library screen, it shows a setup
command. Run it in your repository:

```bash
SPEC_LAYER_KEY=sl_... npx spec-layer pull --id lib_...
```

That writes `.speclayer/` and is enough on its own. To avoid repeating the
library id, record it once:

```bash
npx spec-layer init --id lib_...
```
```

Replace it with:

```markdown
After publishing a library from the plugin's Library screen, it shows a setup
command. Run it once in your repository:

```bash
npx spec-layer setup --id lib_... --key sl_...
```

That records the library id, stores the key in a gitignored
`speclayer.local.json`, and writes `.speclayer/`. Every later command needs no
flags at all:

```bash
npx spec-layer pull
```

`init` still writes the config without a key or a network call, for a repo
that supplies the key from the environment instead.
```

In `README.md`, the "### The CLI" section currently reads:

```markdown
Publishing a library from the plugin's **Library** screen shows a setup command
to run in your repository:

```bash
SPEC_LAYER_KEY=sl_... npx spec-layer pull --id lib_...
```

`npx` needs no install step of its own, though a repo that pulls on a schedule
should pin the CLI as a dev dependency. That writes `.speclayer/`. The CLI is
delivery only: it never talks to Figma, re-derives nothing, and has no runtime
dependencies. `init` records the library id, `status` checks freshness without
writing, and `list` and `show` read the last pull. See the
[CLI README](packages/cli/README.md) for every command, partial pulls, and what
`pull` writes.
```

Replace it with:

```markdown
Publishing a library from the plugin's **Library** screen shows a setup command
to run once in your repository:

```bash
npx spec-layer setup --id lib_... --key sl_...
```

That records the library id, stores the key in a gitignored
`speclayer.local.json`, and writes `.speclayer/`, so a later `npx spec-layer
pull` needs no flags. `npx` needs no install step of its own, though a repo
that pulls on a schedule should pin the CLI as a dev dependency. The CLI is
delivery only: it never talks to Figma, re-derives nothing, and has no runtime
dependencies. `init` records the library id without a key, `status` checks
freshness without writing, and `list` and `show` read the last pull. See the
[CLI README](packages/cli/README.md) for every command, partial pulls, and what
`pull` writes.
```

- [ ] **Step 3: Add the CHANGELOG entry**

Under `## [Unreleased]`, in `### Added`:

```markdown
- `spec-layer setup`, one command for a developer's first run in a repo. It
  writes `speclayer.json`, makes sure git ignores `speclayer.local.json`,
  stores the pull key there at mode `0600`, and pulls. Every later `pull` and
  `status` in that directory needs no key, so the plugin's copied setup
  command is now something a developer runs once rather than a line they keep
  pasting. Keys resolve `--key`, then `SPEC_LAYER_KEY`, then the stored file,
  so CI overrides the working tree without editing it. A stored key issued for
  another library is ignored and named, instead of reaching the server and
  coming back as a rotated-key error.

  This reverses a stated property: the key used to be documented as never
  written to disk. That claim did not remove the secret, it relocated it into
  shell history and hand-edited shell profiles, which are worse homes than a
  mode `0600` file the tool ignores in git and can point at in an error
  message. Outside a git working tree the key is still stored, and the CLI
  says it left `.gitignore` alone. Inside one, if `.gitignore` cannot be
  written, setup refuses to store the key rather than leaving an un-ignored
  secret in a working tree.
```

- [ ] **Step 4: Mark the old decision superseded**

At `docs/superpowers/specs/2026-09-01-library-publish-cli-design.md:104`, leave the original text and add a note beside it rather than editing the decision away:

```markdown
> Superseded by `2026-09-02-cli-stored-pull-key-design.md`. The key is now
> stored in `speclayer.local.json`, gitignored, at mode 0600.
```

- [ ] **Step 5: Add the manual test rows**

`packages/plugin/TESTING.md` has a `## Publish and pull` section at line 212 whose rows are checkboxes with six-space continuation indents. Add these two after the existing "Pull:" row (line 229):

```markdown
- [ ] Stored key: run the copied setup command in an empty directory inside a
      git repository. The output names speclayer.json, the .gitignore entry and
      the stored key, and never prints the key itself. `git status` shows no
      untracked speclayer.local.json. `spec-layer pull` and `spec-layer status`
      then both work with nothing in the environment.
- [ ] Stored key, no git: run the same command in a directory that is not a git
      working tree. It stores the key, says it left .gitignore alone, and pulls.
- [ ] Stored key after a rotation: rotate in the plugin, then run
      `spec-layer pull` in the directory holding the old stored key. It fails
      with the message pointing back at the setup command. Re-pasting the new
      setup command reports that it replaced the stored key, and the next pull
      succeeds.
```

The existing "Pull:" row says "run the copied setup command in an empty directory", which is still accurate but now exercises more; leave its wording alone. The existing "Rotate key" row at line 234 says the old command fails with the rotated-key message. That message changed in Task 4, so check the row still describes what a tester will see and adjust the quoted wording if it names the old text.

- [ ] **Step 6: Scan the docs for NUL bytes**

```bash
node -e "for (const f of ['CHANGELOG.md','README.md','packages/cli/README.md','packages/plugin/TESTING.md','docs/superpowers/specs/2026-09-01-library-publish-cli-design.md']) { const d = require('node:fs').readFileSync(f); if (d.includes(0)) { console.error('NUL in ' + f); process.exit(1); } } console.log('clean')"
```

Expected: `clean`. `npm run check:nul` guards `packages/` but not `docs/`, and this repo has been bitten three times by separator idioms that emit raw `0x00` while lint, tests and `git diff` all hide it.

- [ ] **Step 7: Run the full gate**

```bash
npm run check
```

Expected: exit 0. Read the status directly; do not pipe it through anything that swallows the exit code.

- [ ] **Step 8: Commit**

```bash
git add CHANGELOG.md README.md packages/cli/README.md packages/plugin/TESTING.md docs/superpowers/specs/2026-09-01-library-publish-cli-design.md
git commit -m "docs: document the stored pull key and the setup command"
```

---

## Release notes for whoever ships this

- `packages/cli/package.json` needs a minor bump (`0.3.0`) alongside this work, since `setup` is a new command.
- Task 5 cannot ship to the Community listing before the CLI version containing `setup` is on npm, or the plugin will hand developers a command that does not resolve. Publish the CLI first, verify from the registry, then release the plugin.
- The manual row from Task 6 Step 5 is part of the standing release gate in `packages/plugin/TESTING.md` and has to be run against a development build in Figma. Unit tests cannot reach it.
