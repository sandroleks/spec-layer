import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInit, runPull, runStatus, type Io } from '../src/commands';
import { readConfig } from '../src/config';

function makeIo(): Io & { outLines: string[]; errLines: string[] } {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    outLines,
    errLines,
    out: (l: string) => outLines.push(l),
    err: (l: string) => errLines.push(l),
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
    expect(io.outLines.join('\n')).toMatch(/SPEC_LAYER_KEY/);
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
    expect(io.errLines.join('\n')).toBe('No pull key. Set SPEC_LAYER_KEY or pass --key.');
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
