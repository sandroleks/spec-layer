import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readConfig, writeConfig, resolveOptions, DEFAULT_API, DEFAULT_OUT_DIR } from '../src/config';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('resolveOptions precedence', () => {
  it('flag beats config beats manifest for libraryId', () => {
    const manifestLibraryId = (_outDir: string) => 'from-manifest';
    const result = resolveOptions(
      '/some/cwd',
      { id: 'from-flag' },
      {},
      manifestLibraryId,
    );
    expect(result.libraryId).toBe('from-flag');

    const result2 = resolveOptions(
      '/some/cwd',
      { id: 'from-flag' },
      {},
      () => 'from-manifest',
    );
    expect(result2.libraryId).toBe('from-flag');

    // Flag beats config: flag takes precedence
    const result3 = resolveOptions(
      '/some/cwd',
      { id: 'from-flag' },
      {},
      (_outDir: string) => 'from-manifest',
    );
    expect(result3.libraryId).toBe('from-flag');
  });

  it('falls back to the manifest loader when no flag or config', () => {
    const manifestLibraryId = (_outDir: string) => 'from-manifest';
    const result = resolveOptions(
      '/some/cwd',
      {},
      {},
      manifestLibraryId,
    );
    expect(result.libraryId).toBe('from-manifest');
  });

  it('returns null libraryId when nothing supplies one', () => {
    const manifestLibraryId = (_outDir: string) => null;
    const result = resolveOptions(
      '/some/cwd',
      {},
      {},
      manifestLibraryId,
    );
    expect(result.libraryId).toBeNull();
  });

  it('key comes from --key, then SPEC_LAYER_KEY, else null', () => {
    const stub = (_outDir: string) => null;

    const resultFromFlag = resolveOptions('/some/cwd', { key: 'from-flag' }, {}, stub);
    expect(resultFromFlag.key).toBe('from-flag');

    const resultFromEnv = resolveOptions('/some/cwd', {}, { SPEC_LAYER_KEY: 'from-env' }, stub);
    expect(resultFromEnv.key).toBe('from-env');

    const resultNull = resolveOptions('/some/cwd', {}, {}, stub);
    expect(resultNull.key).toBeNull();

    // Flag beats env
    const resultFlagBeatsEnv = resolveOptions(
      '/some/cwd',
      { key: 'from-flag' },
      { SPEC_LAYER_KEY: 'from-env' },
      stub,
    );
    expect(resultFlagBeatsEnv.key).toBe('from-flag');
  });

  it('api comes from --api, then SPEC_LAYER_API, else DEFAULT_API', () => {
    const stub = (_outDir: string) => null;

    const resultFromFlag = resolveOptions('/some/cwd', { api: 'from-flag' }, {}, stub);
    expect(resultFromFlag.api).toBe('from-flag');

    const resultFromEnv = resolveOptions('/some/cwd', {}, { SPEC_LAYER_API: 'from-env' }, stub);
    expect(resultFromEnv.api).toBe('from-env');

    const resultDefault = resolveOptions('/some/cwd', {}, {}, stub);
    expect(resultDefault.api).toBe(DEFAULT_API);

    // Flag beats env
    const resultFlagBeatsEnv = resolveOptions(
      '/some/cwd',
      { api: 'from-flag' },
      { SPEC_LAYER_API: 'from-env' },
      stub,
    );
    expect(resultFlagBeatsEnv.api).toBe('from-flag');
  });

  it('outDir comes from --out, then config, else .speclayer', () => {
    const stub = (_outDir: string) => null;

    const resultFromFlag = resolveOptions('/some/cwd', { out: '/custom' }, {}, stub);
    expect(resultFromFlag.outDir).toBe('/custom');

    const resultDefault = resolveOptions('/some/cwd', {}, {}, stub);
    expect(resultDefault.outDir).toBe(DEFAULT_OUT_DIR);
  });

  it('config.libraryId beats manifest when no --id flag', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sl-'));
    try {
      writeConfig(tmpDir, { libraryId: 'from-config', outDir: '.speclayer' });
      const manifestLibraryId = (_outDir: string) => 'from-manifest';
      const result = resolveOptions(tmpDir, {}, {}, manifestLibraryId);
      expect(result.libraryId).toBe('from-config');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('--id flag still beats config', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sl-'));
    try {
      writeConfig(tmpDir, { libraryId: 'from-config', outDir: '.speclayer' });
      const manifestLibraryId = (_outDir: string) => 'from-manifest';
      const result = resolveOptions(tmpDir, { id: 'from-flag' }, {}, manifestLibraryId);
      expect(result.libraryId).toBe('from-flag');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('config.outDir is passed to manifestLibraryId and resolved correctly', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sl-'));
    try {
      // Only set outDir in config, not libraryId, so manifestLibraryId gets called
      writeConfig(tmpDir, { outDir: '.custom-output' });
      let loaderCalledWith: string | null = null;
      const manifestLibraryId = (outDir: string) => {
        loaderCalledWith = outDir;
        return 'from-manifest';
      };
      const result = resolveOptions(tmpDir, {}, {}, manifestLibraryId);
      expect(result.outDir).toBe('.custom-output');
      expect(result.libraryId).toBe('from-manifest');
      expect(loaderCalledWith).toBe(join(tmpDir, '.custom-output'));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('config file round trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sl-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writeConfig then readConfig round-trips', () => {
    const config = { libraryId: 'test-lib-id', outDir: '.test-output' };
    writeConfig(tmpDir, config);
    const read = readConfig(tmpDir);
    expect(read).toEqual(config);
  });

  it('readConfig returns null when the file is absent', () => {
    const result = readConfig(tmpDir);
    expect(result).toBeNull();
  });

  it('readConfig throws a readable error on invalid json', () => {
    // Create a speclayer.json with invalid JSON
    writeFileSync(join(tmpDir, 'speclayer.json'), '{invalid json}');

    expect(() => readConfig(tmpDir)).toThrow(/speclayer.json is not valid JSON/);
  });

  it('readConfig throws a readable error when config is not an object', () => {
    // Create a speclayer.json with valid JSON that is not an object (array)
    writeFileSync(join(tmpDir, 'speclayer.json'), '[]');

    expect(() => readConfig(tmpDir)).toThrow(/speclayer.json is not valid JSON/);
  });
});
