import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scanSandboxBundle } from './check-main-sandbox.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const script = join(here, 'check-main-sandbox.mjs');
const names = (src: string) => scanSandboxBundle(src).map((o) => o.name);

describe('scanSandboxBundle', () => {
  it('reports minified zero-argument constructor calls without parentheses', () => {
    const minified = '(()=>{function r(){let e=new TextEncoder,o=new Blob;return e}})();';
    expect(names(minified)).toEqual(expect.arrayContaining(['TextEncoder', 'Blob']));
  });

  it('does not match a constructor name that is only a prefix of a longer identifier', () => {
    expect(scanSandboxBundle('const e = new TextEncoderPolyfill();')).toEqual([]);
  });

  // Every shape here passed the scan before 2026-09-23 and would throw in the
  // Figma sandbox, which has none of these globals.
  it.each([
    ['globalThis.fetch(u)', 'fetch'],
    ['const d = globalThis . document;', 'document'],
    ['window.atob(s)', 'atob'],
    ['self.fetch(u)', 'self'],
    ['const f = fetch; f(u);', 'fetch'],
    ['const decoded = parts.map(atob);', 'atob'],
    ['function g(){return fetch}', 'fetch'],
    ['const u = new URL(href);', 'URL'],
    ['const q = new URLSearchParams(s);', 'URLSearchParams'],
    ['const id = crypto.randomUUID();', 'crypto'],
    ['const t = performance.now();', 'performance'],
    ['const c = new AbortController;', 'AbortController'],
    ['const h = new Headers();', 'Headers'],
    ['const q = new Request(u);', 'Request'],
    ['return new Response(body);', 'Response'],
    ['setImmediate(() => run());', 'setImmediate'],
    ['queueMicrotask(flush);', 'queueMicrotask'],
  ])('catches %s', (src, expected) => {
    expect(names(src)).toContain(expected);
  });

  it('leaves property access, object keys, typeof guards and longer identifiers alone', () => {
    const src = 'obj.fetch(u); const o = { fetch: 1 }; if (typeof fetch === "function") {} fetchAll(); const self_ = 1; myWindow.x;';
    expect(scanSandboxBundle(src)).toEqual([]);
  });

  // globalThis is ES2020 and exists in the Figma sandbox; the plugin's own
  // tests install `figma` on it. Only a forbidden name reached through it is
  // a defect.
  it.each([
    'globalThis.figma.notify(1);',
    'const s = globalThis.Symbol;',
    'var g = typeof globalThis<"u"?globalThis:x;',
    'const f = globalThis.fetchAll;',
  ])('leaves %s alone', (src) => {
    expect(scanSandboxBundle(src)).toEqual([]);
  });
});

describe('the script entry point', () => {
  // The entry guard once compared import.meta.url to `file://` + argv[1],
  // which fails on a path with a space (the URL form is percent-encoded), and
  // then to pathToFileURL(resolve(argv[1])), which fails when the script is
  // reached through a symlink (Node sets import.meta.url to the real path).
  // Either way the gate exited 0 without scanning. The script is copied into
  // a directory whose name has a space and also reached through an explicit
  // symlink, so a regression fails on Linux CI as well as on macOS, where
  // tmpdir() itself sits behind a symlink. It imports only node: modules, so
  // the copy runs on its own.
  let dir: string;
  let copy: string;
  let link: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sl sandbox '));
    mkdirSync(join(dir, 'real dir'));
    copy = join(dir, 'real dir', 'check-main-sandbox.mjs');
    copyFileSync(script, copy);
    link = join(dir, 'linked check.mjs');
    symlinkSync(copy, link);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['a copy in a path with a space', () => copy],
    ['a symlink to that copy', () => link],
  ])('exits non-zero on a missing bundle when run as %s', (_label, entry) => {
    const run = spawnSync(process.execPath, [entry(), '/nonexistent/main.js'], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('/nonexistent/main.js not found');
  });

  it('prints one success line for a clean bundle, so a skipped scan cannot look clean', () => {
    const bundle = join(dir, 'clean main.js');
    writeFileSync(bundle, 'console.log(1);\n');
    const run = spawnSync(process.execPath, [link, bundle], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(`Sandbox scan: ${bundle} clean (16 bytes).\n`);
    expect(run.stderr).toBe('');
  });
});

describe('the shipping main-thread bundle', () => {
  it('passes the widened scan', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'sl-sandbox-'));
    try {
      const pluginDir = resolve(here, '../packages/plugin');
      execFileSync('node', ['build.mjs'], {
        cwd: pluginDir, stdio: 'pipe', env: { ...process.env, PLUGIN_OUT_DIR: outDir },
      });
      expect(scanSandboxBundle(readFileSync(join(outDir, 'main.js'), 'utf8'))).toEqual([]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
