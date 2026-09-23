#!/usr/bin/env node
/**
 * install-hooks.mjs — point git at the repository's hooks.
 *
 * `.githooks/pre-commit` rejects known secret shapes, but git only runs it
 * when `core.hooksPath` says so, and that setting lives in the clone's own
 * config, which a fresh clone does not carry. Until 2026-09-23 it was set by
 * hand on one machine, so every other clone committed without the hook. npm
 * runs this as the `prepare` script on `npm ci` and `npm install`.
 *
 * A quiet no-op outside a git checkout (an exported tarball, an image that
 * strips .git) or when git is not on PATH: the hook is a courtesy for
 * contributors, never a gate the build depends on. The relative value works
 * in a linked worktree too: git resolves it against the worktree root.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// A linked worktree has a `.git` file rather than a directory; both count.
if (!existsSync(resolve(repoRoot, '.git'))) process.exit(0);

const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repoRoot, stdio: 'ignore' });
if (result.error || result.status !== 0) process.exit(0);
console.log('git hooks: core.hooksPath set to .githooks');
