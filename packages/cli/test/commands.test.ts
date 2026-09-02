import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInit, runSetup, runPull, runStatus, runList, runShow, type Io } from '../src/commands';
import { readConfig } from '../src/config';

function makeIo(): Io & { outLines: string[]; errLines: string[]; writes: string[] } {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const writes: string[] = [];
  return {
    outLines,
    errLines,
    writes,
    out: (l: string) => outLines.push(l),
    err: (l: string) => errLines.push(l),
    write: (t: string) => writes.push(t),
  };
}

const GOOD_BUNDLE = {
  schema: 'spec-layer-library-bundle', version: '1.0.0', fileName: 'DS',
  pluginVersion: '5.0.0', extractorVersion: '2',
  foundation: { ai: 'foundation: yes\n', artifact: { spec_layer: { export: { content_hash: 'f'.repeat(64) } } } },
  components: [
    { name: 'Button', ai: 'button: yes\n', artifact: { spec_layer: { export: { content_hash: 'c'.repeat(64) } } } },
  ],
};

function stub200(body = JSON.stringify(GOOD_BUNDLE), publishedAt = '2026-09-01T00:00:00.000Z') {
  return vi.fn(async () => new Response(body, {
    status: 200,
    headers: { 'X-Published-At': publishedAt },
  })) as unknown as typeof fetch;
}

function stub304() {
  return vi.fn(async () => new Response(null, { status: 304 })) as unknown as typeof fetch;
}

function stub401() {
  return vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch;
}

describe('runInit', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'sl-cli-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('writes speclayer.json from --id and prints where the key comes from', () => {
    const io = makeIo();

    const code = runInit(cwd, { id: 'lib_abc' }, io);

    expect(code).toBe(0);
    expect(readConfig(cwd)).toEqual({ libraryId: 'lib_abc', outDir: '.speclayer' });
    expect(io.outLines.join('\n')).toMatch(/spec-layer setup/);
  });

  it('fails without --id', () => {
    const io = makeIo();

    const code = runInit(cwd, {}, io);

    expect(code).toBe(1);
    expect(io.errLines.join('\n')).toMatch(/--id/);
    expect(existsSync(join(cwd, 'speclayer.json'))).toBe(false);
  });
});

describe('runPull', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'sl-cli-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('pulls and writes files with config present', async () => {
    runInit(cwd, { id: 'lib_abc' }, makeIo());
    const io = makeIo();

    const code = await runPull(cwd, {}, { SPEC_LAYER_KEY: 'sl_secret' }, io, stub200());

    expect(code).toBe(0);
    expect(existsSync(join(cwd, '.speclayer/bundle.json'))).toBe(true);
    expect(existsSync(join(cwd, '.speclayer/ai/foundation.yaml'))).toBe(true);
    expect(existsSync(join(cwd, '.speclayer/ai/components/button.yaml'))).toBe(true);
    expect(existsSync(join(cwd, '.speclayer/manifest.json'))).toBe(true);
    const output = io.outLines.join('\n');
    expect(output).toMatch(/1 component/);
    expect(output).toMatch(/2026-09-01T00:00:00\.000Z/);
  });

  it('works bare with --id and --key (no config), then status resolves id from the manifest', async () => {
    const pullIo = makeIo();

    const pullCode = await runPull(cwd, { id: 'lib_abc', key: 'sl_secret' }, {}, pullIo, stub200());

    expect(pullCode).toBe(0);
    expect(existsSync(join(cwd, 'speclayer.json'))).toBe(false);
    expect(existsSync(join(cwd, '.speclayer/manifest.json'))).toBe(true);

    const statusIo = makeIo();
    const fetcher = stub304();

    const statusCode = await runStatus(cwd, { key: 'sl_secret' }, {}, statusIo, fetcher);

    expect(statusCode).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://api.spec-layer.com/v1/libraries/lib_abc');
  });

  it('errors without a key', async () => {
    runInit(cwd, { id: 'lib_abc' }, makeIo());
    const io = makeIo();

    const code = await runPull(cwd, {}, {}, io);

    expect(code).toBe(1);
    expect(io.errLines.join('\n')).toBe(
      'No pull key. Run the setup command from the plugin\'s Library screen, or set SPEC_LAYER_KEY.',
    );
  });

  it('errors without a library id', async () => {
    const io = makeIo();

    const code = await runPull(cwd, {}, { SPEC_LAYER_KEY: 'sl_secret' }, io);

    expect(code).toBe(1);
    const err = io.errLines.join('\n');
    expect(err).toMatch(/--id/);
    expect(err).toMatch(/spec-layer init/);
  });

  it('errors with a plain message, not a thrown stack trace, on a corrupt speclayer.json', async () => {
    writeFileSync(join(cwd, 'speclayer.json'), '{ not json');
    const io = makeIo();

    const code = await runPull(cwd, {}, { SPEC_LAYER_KEY: 'sl_secret' }, io);

    expect(code).toBe(1);
    expect(io.errLines).toEqual(['speclayer.json is not valid JSON. Fix or delete it, then retry.']);
  });

  it('propagates api errors with exit 1 and no partial directory', async () => {
    runInit(cwd, { id: 'lib_abc' }, makeIo());
    const io = makeIo();

    const code = await runPull(cwd, {}, { SPEC_LAYER_KEY: 'sl_secret' }, io, stub401());

    expect(code).toBe(1);
    expect(io.errLines.join('\n')).toMatch(/rotated or revoked/);
    expect(existsSync(join(cwd, '.speclayer'))).toBe(false);
    expect(existsSync(join(cwd, '.speclayer.partial'))).toBe(false);
  });

  it('re-pull with unchanged content leaves identical bytes', async () => {
    runInit(cwd, { id: 'lib_abc' }, makeIo());

    await runPull(cwd, {}, { SPEC_LAYER_KEY: 'sl_secret' }, makeIo(), stub200());
    const beforeBundle = readFileSync(join(cwd, '.speclayer/bundle.json'), 'utf8');
    const beforeButton = readFileSync(join(cwd, '.speclayer/ai/components/button.yaml'), 'utf8');
    const beforeManifest = readFileSync(join(cwd, '.speclayer/manifest.json'), 'utf8');

    await runPull(cwd, {}, { SPEC_LAYER_KEY: 'sl_secret' }, makeIo(), stub200());
    const afterBundle = readFileSync(join(cwd, '.speclayer/bundle.json'), 'utf8');
    const afterButton = readFileSync(join(cwd, '.speclayer/ai/components/button.yaml'), 'utf8');
    const afterManifest = readFileSync(join(cwd, '.speclayer/manifest.json'), 'utf8');

    expect(afterBundle).toBe(beforeBundle);
    expect(afterButton).toBe(beforeButton);
    expect(afterManifest).toBe(beforeManifest);
  });
});

describe('runStatus', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'sl-cli-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('reports up to date on 304 with exit 0', async () => {
    runInit(cwd, { id: 'lib_abc' }, makeIo());
    await runPull(cwd, {}, { SPEC_LAYER_KEY: 'sl_secret' }, makeIo(), stub200());
    const io = makeIo();

    const code = await runStatus(cwd, {}, { SPEC_LAYER_KEY: 'sl_secret' }, io, stub304());

    expect(code).toBe(0);
    expect(io.outLines.join('\n')).toMatch(/up to date/i);
  });

  it('reports behind on 200 with exit 2 and names the remote publishedAt', async () => {
    runInit(cwd, { id: 'lib_abc' }, makeIo());
    await runPull(cwd, {}, { SPEC_LAYER_KEY: 'sl_secret' }, makeIo(), stub200(JSON.stringify(GOOD_BUNDLE), '2026-09-01T00:00:00.000Z'));
    const io = makeIo();

    const code = await runStatus(
      cwd, {}, { SPEC_LAYER_KEY: 'sl_secret' }, io,
      stub200(JSON.stringify(GOOD_BUNDLE), '2026-09-02T00:00:00.000Z'),
    );

    expect(code).toBe(2);
    expect(io.outLines.join('\n')).toMatch(/2026-09-02T00:00:00\.000Z/);
  });

  it('reports no local pull with exit 2 when manifest is missing', async () => {
    runInit(cwd, { id: 'lib_abc' }, makeIo());
    const io = makeIo();

    const code = await runStatus(cwd, {}, { SPEC_LAYER_KEY: 'sl_secret' }, io);

    expect(code).toBe(2);
    expect(io.errLines.join('\n')).toMatch(/No local pull/);
  });

  it('errors with a plain message, not a thrown stack trace, on a corrupt speclayer.json', async () => {
    writeFileSync(join(cwd, 'speclayer.json'), '{ not json');
    const io = makeIo();

    const code = await runStatus(cwd, {}, { SPEC_LAYER_KEY: 'sl_secret' }, io);

    expect(code).toBe(1);
    expect(io.errLines).toEqual(['speclayer.json is not valid JSON. Fix or delete it, then retry.']);
  });
});

const THREE_BUNDLE = {
  ...GOOD_BUNDLE,
  components: [
    { name: 'Button', ai: 'button: yes\n', artifact: { spec_layer: { export: { content_hash: 'a'.repeat(64) } } } },
    { name: 'Card', ai: 'card: yes\n', artifact: { spec_layer: { export: { content_hash: 'b'.repeat(64) } } } },
    { name: 'Icon Button', ai: 'icon: yes\n', artifact: { spec_layer: { export: { content_hash: 'c'.repeat(64) } } } },
  ],
};
const stubThree = () => stub200(JSON.stringify(THREE_BUNDLE));
const ENV = { SPEC_LAYER_KEY: 'sl_secret' };

describe('runPull with a selection', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'sl-cli-sel-'));
    runInit(cwd, { id: 'lib_abc' }, makeIo());
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('--only foundation writes the foundation and no component files, and says so', async () => {
    const io = makeIo();

    const code = await runPull(cwd, { only: 'foundation' }, ENV, io, stubThree());

    expect(code).toBe(0);
    expect(existsSync(join(cwd, '.speclayer/ai/foundation.yaml'))).toBe(true);
    expect(existsSync(join(cwd, '.speclayer/ai/components'))).toBe(false);
    expect(existsSync(join(cwd, '.speclayer/bundle.json'))).toBe(true);
    expect(io.outLines.join('\n')).toMatch(/foundation \+ 0 of 3 components/);
  });

  it('--component writes just those components and reports the count', async () => {
    const io = makeIo();

    const code = await runPull(cwd, { component: ['card', 'icon-button'] }, ENV, io, stubThree());

    expect(code).toBe(0);
    expect(existsSync(join(cwd, '.speclayer/ai/components/card.yaml'))).toBe(true);
    expect(existsSync(join(cwd, '.speclayer/ai/components/icon-button.yaml'))).toBe(true);
    expect(existsSync(join(cwd, '.speclayer/ai/components/button.yaml'))).toBe(false);
    expect(io.outLines.join('\n')).toMatch(/foundation \+ 2 of 3 components/);
  });

  it('--only components skips the foundation and says so', async () => {
    const io = makeIo();

    const code = await runPull(cwd, { only: 'components' }, ENV, io, stubThree());

    expect(code).toBe(0);
    expect(existsSync(join(cwd, '.speclayer/ai/foundation.yaml'))).toBe(false);
    expect(io.outLines.join('\n')).toMatch(/3 components, no foundation/);
  });

  it('uses the include block from speclayer.json when no flag is given, and a flag replaces it', async () => {
    runInit(cwd, { id: 'lib_abc', component: ['Card'] }, makeIo());

    await runPull(cwd, {}, ENV, makeIo(), stubThree());
    expect(existsSync(join(cwd, '.speclayer/ai/components/card.yaml'))).toBe(true);
    expect(existsSync(join(cwd, '.speclayer/ai/components/button.yaml'))).toBe(false);

    await runPull(cwd, { component: ['Button'] }, ENV, makeIo(), stubThree());
    expect(existsSync(join(cwd, '.speclayer/ai/components/button.yaml'))).toBe(true);
    expect(existsSync(join(cwd, '.speclayer/ai/components/card.yaml'))).toBe(false);
  });

  it('fails on an unknown component name, lists the available ones, and writes nothing', async () => {
    const io = makeIo();

    const code = await runPull(cwd, { component: ['Toast'] }, ENV, io, stubThree());

    expect(code).toBe(1);
    const err = io.errLines.join('\n');
    expect(err).toMatch(/"Toast"/);
    expect(err).toMatch(/Button, Card, Icon Button/);
    expect(existsSync(join(cwd, '.speclayer'))).toBe(false);
    expect(existsSync(join(cwd, '.speclayer.partial'))).toBe(false);
  });

  it('rejects an unknown --only value before touching the network', async () => {
    const io = makeIo();
    const fetcher = stubThree();

    const code = await runPull(cwd, { only: 'tokens' }, ENV, io, fetcher);

    expect(code).toBe(1);
    expect(io.errLines.join('\n')).toMatch(/--only takes "foundation" or "components"/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('runInit with a selection', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'sl-cli-init-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('persists --only and --component as the include block', () => {
    const code = runInit(cwd, { id: 'lib_abc', only: 'components', component: ['Button'] }, makeIo());

    expect(code).toBe(0);
    expect(readConfig(cwd)?.include).toEqual({ foundation: false, components: ['Button'] });
  });

  it('writes no include block when no selection flag is given', () => {
    runInit(cwd, { id: 'lib_abc' }, makeIo());
    expect(readConfig(cwd)?.include).toBeUndefined();
  });

  it('rejects contradictory selection flags without writing config', () => {
    const io = makeIo();

    const code = runInit(cwd, { id: 'lib_abc', only: 'foundation', component: ['Button'] }, io);

    expect(code).toBe(1);
    expect(io.errLines.join('\n')).toMatch(/--only foundation/);
    expect(existsSync(join(cwd, 'speclayer.json'))).toBe(false);
  });
});

describe('runList', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'sl-cli-list-'));
    runInit(cwd, { id: 'lib_abc' }, makeIo());
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('fails when nothing was pulled', () => {
    const io = makeIo();

    const code = runList(cwd, {}, io);

    expect(code).toBe(1);
    expect(io.errLines.join('\n')).toBe('No local pull found. Run spec-layer pull.');
  });

  it('lists every artifact with its ai path or "not written" after a filtered pull', async () => {
    await runPull(cwd, { component: ['Card'] }, ENV, makeIo(), stubThree());
    const io = makeIo();

    const code = runList(cwd, {}, io);

    expect(code).toBe(0);
    const out = io.outLines.join('\n');
    expect(out).toMatch(/lib_abc/);
    expect(out).toMatch(/2026-09-01T00:00:00\.000Z/);
    expect(out).toMatch(/foundation\s+foundation\s+ai\/foundation\.yaml\s+f{64}/);
    expect(out).toMatch(/component\s+Button\s+not written\s+a{64}/);
    expect(out).toMatch(/component\s+Card\s+ai\/components\/card\.yaml\s+b{64}/);
  });
});

describe('runShow', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'sl-cli-show-'));
    runInit(cwd, { id: 'lib_abc' }, makeIo());
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('fails when nothing was pulled', () => {
    const io = makeIo();

    const code = runShow(cwd, {}, ['foundation'], io);

    expect(code).toBe(1);
    expect(io.errLines.join('\n')).toBe('No local pull found. Run spec-layer pull.');
  });

  it('writes the foundation ai yaml verbatim to stdout', async () => {
    await runPull(cwd, { only: 'components' }, ENV, makeIo(), stubThree());
    const io = makeIo();

    const code = runShow(cwd, {}, ['foundation'], io);

    expect(code).toBe(0);
    expect(io.writes).toEqual(['foundation: yes\n']);
    expect(io.outLines).toEqual([]);
  });

  it('finds a component by slug even when its file was not written', async () => {
    await runPull(cwd, { only: 'foundation' }, ENV, makeIo(), stubThree());
    const io = makeIo();

    const code = runShow(cwd, {}, ['component', 'icon-button'], io);

    expect(code).toBe(0);
    expect(io.writes).toEqual(['icon: yes\n']);
  });

  it('--canonical prints the canonical artifact as two-space json', async () => {
    await runPull(cwd, {}, ENV, makeIo(), stubThree());
    const io = makeIo();

    const code = runShow(cwd, { canonical: true }, ['component', 'Card'], io);

    expect(code).toBe(0);
    expect(io.writes).toEqual([`${JSON.stringify(THREE_BUNDLE.components[1].artifact, null, 2)}\n`]);
  });

  it('fails for an unknown component and lists the available names', async () => {
    await runPull(cwd, {}, ENV, makeIo(), stubThree());
    const io = makeIo();

    const code = runShow(cwd, {}, ['component', 'Toast'], io);

    expect(code).toBe(1);
    expect(io.errLines.join('\n')).toMatch(/Button, Card, Icon Button/);
    expect(io.writes).toEqual([]);
  });

  it('refuses to pick one of several components sharing a name', async () => {
    const dupes = { ...GOOD_BUNDLE, components: [
      { name: 'Button', ai: 'a\n', artifact: { spec_layer: { export: { content_hash: 'a'.repeat(64) } } } },
      { name: 'button', ai: 'b\n', artifact: { spec_layer: { export: { content_hash: 'b'.repeat(64) } } } },
    ] };
    await runPull(cwd, {}, ENV, makeIo(), stub200(JSON.stringify(dupes)));
    const io = makeIo();

    const code = runShow(cwd, {}, ['component', 'button'], io);

    expect(code).toBe(1);
    expect(io.errLines.join('\n')).toMatch(/2 components.*spec-layer list/s);
    expect(io.writes).toEqual([]);
  });

  it('fails when the library has no foundation', async () => {
    await runPull(cwd, {}, ENV, makeIo(), stub200(JSON.stringify({ ...GOOD_BUNDLE, foundation: null })));
    const io = makeIo();

    const code = runShow(cwd, {}, ['foundation'], io);

    expect(code).toBe(1);
    expect(io.errLines.join('\n')).toMatch(/no Foundation/i);
  });

  it('fails with usage on a missing or unknown target', async () => {
    await runPull(cwd, {}, ENV, makeIo(), stubThree());

    expect(runShow(cwd, {}, [], makeIo())).toBe(1);
    expect(runShow(cwd, {}, ['component'], makeIo())).toBe(1);
    expect(runShow(cwd, {}, ['tokens'], makeIo())).toBe(1);
  });
});

describe('runPull safety and freshness', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'sl-cli-safe-'));
    runInit(cwd, { id: 'lib_abc' }, makeIo());
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  const headerOf = (fetcher: typeof fetch, name: string): string | undefined => {
    const [, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    return (init.headers as Record<string, string>)[name];
  };

  it('sends the last pull hash and reports up to date on 304 when the selection is unchanged', async () => {
    await runPull(cwd, {}, ENV, makeIo(), stubThree());
    const io = makeIo();
    const fetcher = stub304();

    const code = await runPull(cwd, {}, ENV, io, fetcher);

    expect(code).toBe(0);
    expect(headerOf(fetcher, 'If-None-Match')).toBe(`"${JSON.parse(readFileSync(join(cwd, '.speclayer/manifest.json'), 'utf8')).bundleHash}"`);
    expect(io.outLines.join('\n')).toMatch(/Already up to date/);
    expect(existsSync(join(cwd, '.speclayer/ai/components/card.yaml'))).toBe(true);
  });

  it('does not send a hash when the selection differs from the last pull, so the files are re-projected', async () => {
    await runPull(cwd, {}, ENV, makeIo(), stubThree());
    const fetcher = stubThree();

    const code = await runPull(cwd, { component: ['Card'] }, ENV, makeIo(), fetcher);

    expect(code).toBe(0);
    expect(headerOf(fetcher, 'If-None-Match')).toBeUndefined();
    expect(existsSync(join(cwd, '.speclayer/ai/components/button.yaml'))).toBe(false);
    expect(existsSync(join(cwd, '.speclayer/ai/components/card.yaml'))).toBe(true);
  });

  it('refuses to use the working directory itself as the output directory', async () => {
    writeFileSync(join(cwd, 'keep.txt'), 'mine');
    const io = makeIo();

    const code = await runPull(cwd, { out: '.' }, ENV, io, stubThree());

    expect(code).toBe(1);
    expect(io.errLines.join('\n')).toMatch(/output directory/i);
    expect(readFileSync(join(cwd, 'keep.txt'), 'utf8')).toBe('mine');
  });

  it('refuses to replace an existing directory that spec-layer did not write', async () => {
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src/index.ts'), 'export {};');
    const io = makeIo();

    const code = await runPull(cwd, { out: 'src' }, ENV, io, stubThree());

    expect(code).toBe(1);
    expect(io.errLines.join('\n')).toMatch(/src.*not written by spec-layer/s);
    expect(readFileSync(join(cwd, 'src/index.ts'), 'utf8')).toBe('export {};');
    expect(existsSync(join(cwd, 'src.partial'))).toBe(false);
  });
});

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
