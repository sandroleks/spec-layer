import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { slugify, readManifest, writeBundleFiles, type Manifest } from '../src/files';
import type { BundleV1 } from '../src/bundle';

function makeBundle(overrides: Partial<BundleV1> = {}): BundleV1 {
  return {
    schema: 'spec-layer-library-bundle',
    version: '1.0.0',
    fileName: 'DS',
    pluginVersion: '5.0.0',
    extractorVersion: '2',
    foundation: {
      ai: 'foundation: yes\n',
      artifact: { spec_layer: { export: { content_hash: 'f'.repeat(64) } } },
    },
    components: [
      { name: 'Button', ai: 'button: yes\n', artifact: { spec_layer: { export: { content_hash: 'c'.repeat(64) } } } },
    ],
    ...overrides,
  };
}

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Icon Button / Large')).toBe('icon-button-large');
  });

  it('falls back for a name with no usable characters', () => {
    expect(slugify('***')).toBe('component');
  });
});

describe('writeBundleFiles', () => {
  let tmpDir: string;
  let outDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sl-files-'));
    outDir = join(tmpDir, '.speclayer');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes bundle.json byte-for-byte, ai yaml per artifact, and a manifest', () => {
    const bundle = makeBundle();
    const raw = JSON.stringify(bundle);
    writeBundleFiles({
      outDir, raw, bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });

    expect(readFileSync(join(outDir, 'bundle.json'), 'utf8')).toBe(raw);
    expect(readFileSync(join(outDir, 'ai/foundation.yaml'), 'utf8')).toBe(bundle.foundation!.ai);
    expect(readFileSync(join(outDir, 'ai/components/button.yaml'), 'utf8')).toBe(bundle.components[0].ai);

    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.libraryId).toBe('lib-1');
    expect(manifest.publishedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(manifest.bundleHash).toBe('h'.repeat(64));
    expect(manifest.pluginVersion).toBe('5.0.0');
    expect(manifest.extractorVersion).toBe('2');
    expect(manifest.artifacts).toEqual([
      { kind: 'foundation', name: 'foundation', contentHash: 'f'.repeat(64), aiPath: 'ai/foundation.yaml' },
      { kind: 'component', name: 'Button', contentHash: 'c'.repeat(64), aiPath: 'ai/components/button.yaml' },
    ]);
  });

  it('dedupes colliding slugs in bundle order', () => {
    const bundle = makeBundle({
      components: [
        { name: 'Button', ai: 'first\n', artifact: { spec_layer: { export: { content_hash: 'a'.repeat(64) } } } },
        { name: 'button', ai: 'second\n', artifact: { spec_layer: { export: { content_hash: 'b'.repeat(64) } } } },
      ],
    });
    const raw = JSON.stringify(bundle);
    const written = writeBundleFiles({
      outDir, raw, bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });

    expect(written).toContain('ai/components/button.yaml');
    expect(written).toContain('ai/components/button-2.yaml');
    expect(readFileSync(join(outDir, 'ai/components/button.yaml'), 'utf8')).toBe('first\n');
    expect(readFileSync(join(outDir, 'ai/components/button-2.yaml'), 'utf8')).toBe('second\n');

    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.artifacts.map((a) => a.aiPath)).toEqual([
      'ai/foundation.yaml',
      'ai/components/button.yaml',
      'ai/components/button-2.yaml',
    ]);
  });

  it('is atomic: a second write replaces the directory, and no staging dir remains after success', () => {
    const bundle1 = makeBundle();
    writeBundleFiles({
      outDir, raw: JSON.stringify(bundle1), bundle: bundle1,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });
    expect(existsSync(join(outDir, 'ai/components/button.yaml'))).toBe(true);
    expect(existsSync(`${outDir}.partial`)).toBe(false);

    const bundle2 = makeBundle({
      foundation: null,
      components: [
        { name: 'Card', ai: 'card: yes\n', artifact: { spec_layer: { export: { content_hash: 'd'.repeat(64) } } } },
      ],
    });
    writeBundleFiles({
      outDir, raw: JSON.stringify(bundle2), bundle: bundle2,
      libraryId: 'lib-1', publishedAt: '2026-09-01T01:00:00.000Z', bundleHash: 'i'.repeat(64),
    });

    // Old files are gone.
    expect(existsSync(join(outDir, 'ai/components/button.yaml'))).toBe(false);
    expect(existsSync(join(outDir, 'ai/foundation.yaml'))).toBe(false);
    // New files are present.
    expect(existsSync(join(outDir, 'ai/components/card.yaml'))).toBe(true);
    // No staging dir left behind.
    expect(existsSync(`${outDir}.partial`)).toBe(false);
  });

  it('skips the foundation file when foundation is null', () => {
    const bundle = makeBundle({ foundation: null });
    const written = writeBundleFiles({
      outDir, raw: JSON.stringify(bundle), bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });

    expect(written).not.toContain('ai/foundation.yaml');
    expect(existsSync(join(outDir, 'ai/foundation.yaml'))).toBe(false);

    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.artifacts.every((a) => a.kind !== 'foundation')).toBe(true);
  });

  it('readManifest returns null when absent and the manifest after a write', () => {
    expect(readManifest(outDir)).toBeNull();

    const bundle = makeBundle();
    writeBundleFiles({
      outDir, raw: JSON.stringify(bundle), bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });

    const manifest = readManifest(outDir);
    expect(manifest).not.toBeNull();
    expect(manifest!.libraryId).toBe('lib-1');
    expect(manifest!.artifacts.length).toBe(2);
  });
});
