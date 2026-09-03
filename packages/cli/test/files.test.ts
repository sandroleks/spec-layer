import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  buildFoundation, buildFoundationArtifactV5, type SerializedFoundation,
} from '@spec-layer/extractor';
import { slugify, readManifest, readLocalBundle, writeBundleFiles, type Manifest } from '../src/files';
import type { BundleV1 } from '../src/bundle';

const SERIALIZED = fileURLToPath(new URL(
  '../../extractor/test/fixtures/v5/synthetic-foundation-serialized.json', import.meta.url,
));
function realFoundation() {
  const serialized = JSON.parse(readFileSync(SERIALIZED, 'utf8')) as SerializedFoundation;
  const { artifact } = buildFoundationArtifactV5(buildFoundation(serialized), {
    exportId: 'cli-test', generatedAt: '2026-09-03T00:00:00.000Z', build: null,
  });
  return { ai: '{"version":"2025.10"}\n', artifact };
}

// Controls a single injected failure for the atomicity test below. Node's `node:fs`
// module namespace is not configurable under ESM, so `vi.spyOn(fs, 'writeFileSync')`
// throws "Cannot redefine property: writeFileSync / Module namespace is not
// configurable in ESM" (verified). vi.mock intercepts at module resolution instead of
// mutating the namespace object, so it is the only working way to fail exactly one
// write. Vitest hoists this call above the imports above automatically.
const fsFailure = vi.hoisted(() => ({ failPathSuffix: null as string | null }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: (path: unknown, ...rest: unknown[]) => {
      if (fsFailure.failPathSuffix && String(path).endsWith(fsFailure.failPathSuffix)) {
        throw new Error('simulated disk failure');
      }
      return (actual.writeFileSync as (...args: unknown[]) => unknown)(path, ...rest);
    },
  };
});

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
    const bundle = makeBundle({ foundation: realFoundation() });
    const raw = JSON.stringify(bundle);
    const written = writeBundleFiles({
      outDir, cwd: tmpDir, raw, bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });

    expect(readFileSync(join(outDir, 'bundle.json'), 'utf8')).toBe(raw);
    expect(written).toContain('tokens/resolver.json');
    expect(written).toContain('tokens/spec-layer.meta.json');
    expect(written).toContain('tokens/report.json');
    expect(readFileSync(join(outDir, 'ai/components/button.yaml'), 'utf8')).toBe(bundle.components[0].ai);

    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.libraryId).toBe('lib-1');
    expect(manifest.publishedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(manifest.bundleHash).toBe('h'.repeat(64));
    expect(manifest.pluginVersion).toBe('5.0.0');
    expect(manifest.extractorVersion).toBe('2');
    expect(manifest.artifacts).toEqual([
      {
        kind: 'foundation', name: 'foundation',
        contentHash: bundle.foundation!.artifact.spec_layer.export.content_hash,
        aiPath: 'tokens/resolver.json',
      },
      { kind: 'component', name: 'Button', contentHash: 'c'.repeat(64), aiPath: 'ai/components/button.yaml' },
    ]);
  });

  it('dedupes colliding slugs in bundle order', () => {
    const bundle = makeBundle({
      foundation: null,
      components: [
        { name: 'Button', ai: 'first\n', artifact: { spec_layer: { export: { content_hash: 'a'.repeat(64) } } } },
        { name: 'button', ai: 'second\n', artifact: { spec_layer: { export: { content_hash: 'b'.repeat(64) } } } },
      ],
    });
    const raw = JSON.stringify(bundle);
    const written = writeBundleFiles({
      outDir, cwd: tmpDir, raw, bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });

    expect(written).toContain('ai/components/button.yaml');
    expect(written).toContain('ai/components/button-2.yaml');
    expect(readFileSync(join(outDir, 'ai/components/button.yaml'), 'utf8')).toBe('first\n');
    expect(readFileSync(join(outDir, 'ai/components/button-2.yaml'), 'utf8')).toBe('second\n');

    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.artifacts.map((a) => a.aiPath)).toEqual([
      'ai/components/button.yaml',
      'ai/components/button-2.yaml',
    ]);
  });

  it('never collides a generated suffix with an already-claimed literal slug', () => {
    // Bundle order: 'button' -> base 'button'; 'Button 2' -> base 'button-2' (a literal
    // collision target); a second 'button' -> base 'button' again. The naive "count per
    // base" dedupe would give the third component 'button-2' too (count=2), silently
    // overwriting the second component's file. The fix must skip already-used slugs.
    const bundle = makeBundle({
      foundation: null,
      components: [
        { name: 'Button', ai: 'first\n', artifact: { spec_layer: { export: { content_hash: 'a'.repeat(64) } } } },
        { name: 'Button 2', ai: 'second\n', artifact: { spec_layer: { export: { content_hash: 'b'.repeat(64) } } } },
        { name: 'button', ai: 'third\n', artifact: { spec_layer: { export: { content_hash: 'c'.repeat(64) } } } },
      ],
    });
    const raw = JSON.stringify(bundle);
    const written = writeBundleFiles({
      outDir, cwd: tmpDir, raw, bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });

    const componentPaths = written.filter((p) => p.startsWith('ai/components/'));
    expect(new Set(componentPaths).size).toBe(3);
    expect(componentPaths).toEqual([
      'ai/components/button.yaml',
      'ai/components/button-2.yaml',
      'ai/components/button-3.yaml',
    ]);

    expect(readFileSync(join(outDir, 'ai/components/button.yaml'), 'utf8')).toBe('first\n');
    expect(readFileSync(join(outDir, 'ai/components/button-2.yaml'), 'utf8')).toBe('second\n');
    expect(readFileSync(join(outDir, 'ai/components/button-3.yaml'), 'utf8')).toBe('third\n');

    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as Manifest;
    const componentAiPaths = manifest.artifacts.filter((a) => a.kind === 'component').map((a) => a.aiPath);
    expect(new Set(componentAiPaths).size).toBe(3);
    expect(componentAiPaths).toEqual([
      'ai/components/button.yaml',
      'ai/components/button-2.yaml',
      'ai/components/button-3.yaml',
    ]);
  });

  it('is atomic: a second write replaces the directory, and no staging dir remains after success', () => {
    const bundle1 = makeBundle({ foundation: null });
    writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle1), bundle: bundle1,
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
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle2), bundle: bundle2,
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
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });

    expect(written).not.toContain('ai/foundation.yaml');
    expect(existsSync(join(outDir, 'ai/foundation.yaml'))).toBe(false);

    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.artifacts.every((a) => a.kind !== 'foundation')).toBe(true);
  });

  it('readManifest returns null when absent and the manifest after a write', () => {
    expect(readManifest(outDir)).toBeNull();

    const bundle = makeBundle({ foundation: realFoundation() });
    writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });

    const manifest = readManifest(outDir);
    expect(manifest).not.toBeNull();
    expect(manifest!.libraryId).toBe('lib-1');
    expect(manifest!.artifacts.length).toBe(2);
  });

  it('cleans up staging and leaves the prior outDir untouched when a write fails partway', () => {
    // Establish a baseline outDir with a successful write first.
    const bundle1 = makeBundle({ foundation: realFoundation() });
    writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle1), bundle: bundle1,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });
    const originalButtonContent = readFileSync(join(outDir, 'ai/components/button.yaml'), 'utf8');
    const originalResolverContent = readFileSync(join(outDir, 'tokens/resolver.json'), 'utf8');

    // Force the mid-staging write of tokens/resolver.json to fail, simulating a disk
    // error partway through. Directory pre-seeding cannot inject this: writeBundleFiles
    // unconditionally rmSync's the .partial staging dir as its very first step, so any
    // conflict planted there ahead of time is wiped out before it can matter (verified:
    // pre-creating <outDir>.partial/tokens/resolver.json as a directory does not trigger
    // the catch branch, because it never survives that leading rmSync). Failing exactly
    // one write instead requires intercepting the fs call itself, via the vi.mock above.
    const bundle2 = makeBundle({
      foundation: realFoundation(),
      components: [
        { name: 'Card', ai: 'card: yes\n', artifact: { spec_layer: { export: { content_hash: 'd'.repeat(64) } } } },
      ],
    });

    fsFailure.failPathSuffix = join('tokens', 'resolver.json');
    try {
      expect(() => writeBundleFiles({
        outDir, cwd: tmpDir, raw: JSON.stringify(bundle2), bundle: bundle2,
        libraryId: 'lib-1', publishedAt: '2026-09-01T02:00:00.000Z', bundleHash: 'j'.repeat(64),
      })).toThrow(/simulated disk failure/);
    } finally {
      fsFailure.failPathSuffix = null;
    }

    // Staging directory was cleaned up by the catch branch.
    expect(existsSync(`${outDir}.partial`)).toBe(false);
    // The prior successful outDir is untouched: neither deleted nor half-overwritten.
    expect(existsSync(join(outDir, 'ai/components/button.yaml'))).toBe(true);
    expect(readFileSync(join(outDir, 'ai/components/button.yaml'), 'utf8')).toBe(originalButtonContent);
    expect(existsSync(join(outDir, 'tokens/resolver.json'))).toBe(true);
    expect(readFileSync(join(outDir, 'tokens/resolver.json'), 'utf8')).toBe(originalResolverContent);
    expect(existsSync(join(outDir, 'ai/components/card.yaml'))).toBe(false);
  });

  it('writes the foundation as a tokens/ directory projected from the canonical artifact', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    const written = writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_1',
      publishedAt: '2026-09-03T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });
    expect(written).toContain('tokens/resolver.json');
    expect(written).toContain('tokens/primitives.light.json');
    expect(written).toContain('tokens/spec-layer.meta.json');
    expect(written).toContain('tokens/report.json');
    expect(written).not.toContain('ai/foundation.yaml');
    const resolver = JSON.parse(readFileSync(join(outDir, 'tokens/resolver.json'), 'utf8'));
    expect(resolver.version).toBe('2025.10');
    const manifest = readManifest(outDir)!;
    expect(manifest.artifacts.find((a) => a.kind === 'foundation')?.aiPath).toBe('tokens/resolver.json');
  });

  it('honours dtcg options from config', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_1',
      publishedAt: '2026-09-03T00:00:00.000Z', bundleHash: 'h'.repeat(64),
      dtcg: { values: 'legacy' },
    });
    const light = JSON.parse(readFileSync(join(outDir, 'tokens/primitives.light.json'), 'utf8'));
    expect(light.Primitives.color.exact.red.$value).toBe('#ff0000');
  });

  it('writes no tokens/ when the selection excludes the foundation', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    const written = writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_1',
      publishedAt: '2026-09-03T00:00:00.000Z', bundleHash: 'h'.repeat(64),
      selection: { foundation: false, components: null },
    });
    expect(written.some((f) => f.startsWith('tokens/'))).toBe(false);
    expect(readManifest(outDir)!.artifacts.find((a) => a.kind === 'foundation')?.aiPath).toBeNull();
  });

  it('fails with a plain sentence when the foundation artifact is not a valid v5 artifact', () => {
    const bundle = makeBundle(); // the stub artifact carries only a content hash
    expect(() => writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_1',
      publishedAt: '2026-09-03T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    })).toThrow('The published Foundation context did not pass schema validation. Republish from the plugin, then pull again.');
    expect(existsSync(outDir)).toBe(false);
  });
});

describe('writeBundleFiles with a selection', () => {
  let tmpDir: string;
  let outDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sl-files-sel-'));
    outDir = join(tmpDir, '.speclayer');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const twoComponents = () => makeBundle({
    components: [
      { name: 'Button', ai: 'button\n', artifact: { spec_layer: { export: { content_hash: 'a'.repeat(64) } } } },
      { name: 'Card', ai: 'card\n', artifact: { spec_layer: { export: { content_hash: 'b'.repeat(64) } } } },
    ],
  });

  it('writes only the selected component files and skips the foundation when deselected', () => {
    const bundle = twoComponents();
    const written = writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
      selection: { foundation: false, components: ['card'] },
    });

    expect(written).toEqual(['bundle.json', 'ai/components/card.yaml', 'manifest.json']);
    expect(existsSync(join(outDir, 'ai/foundation.yaml'))).toBe(false);
    expect(existsSync(join(outDir, 'ai/components/button.yaml'))).toBe(false);
    expect(readFileSync(join(outDir, 'ai/components/card.yaml'), 'utf8')).toBe('card\n');
  });

  it('lists every artifact in the manifest, with a null aiPath for the ones not written, and records the selection', () => {
    const bundle = twoComponents();
    writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
      selection: { foundation: false, components: ['card'] },
    });

    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.selection).toEqual({ foundation: false, components: ['card'] });
    expect(manifest.artifacts).toEqual([
      { kind: 'foundation', name: 'foundation', contentHash: 'f'.repeat(64), aiPath: null },
      { kind: 'component', name: 'Button', contentHash: 'a'.repeat(64), aiPath: null },
      { kind: 'component', name: 'Card', contentHash: 'b'.repeat(64), aiPath: 'ai/components/card.yaml' },
    ]);
  });

  it('keeps slugs stable for a selected component regardless of which siblings are deselected', () => {
    const bundle = makeBundle({
      foundation: null,
      components: [
        { name: 'Button', ai: 'first\n', artifact: { spec_layer: { export: { content_hash: 'a'.repeat(64) } } } },
        { name: 'button', ai: 'second\n', artifact: { spec_layer: { export: { content_hash: 'b'.repeat(64) } } } },
      ],
    });
    const written = writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
      selection: { foundation: true, components: ['button'] },
    });

    // Both share the name, so both are selected and both keep the slugs an unfiltered pull gives them.
    expect(written).toContain('ai/components/button.yaml');
    expect(written).toContain('ai/components/button-2.yaml');
  });

  it('records the default selection when none is given', () => {
    const bundle = makeBundle({ foundation: null, components: twoComponents().components });
    writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });
    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.selection).toEqual({ foundation: true, components: null });
  });
});

describe('readLocalBundle', () => {
  let tmpDir: string;
  let outDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sl-files-local-'));
    outDir = join(tmpDir, '.speclayer');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when nothing was pulled', () => {
    expect(readLocalBundle(outDir)).toBeNull();
  });

  it('returns the parsed bundle after a write', () => {
    const bundle = makeBundle({ foundation: null });
    writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });
    expect(readLocalBundle(outDir)?.components.map((c) => c.name)).toEqual(['Button']);
  });

  it('throws a readable error when bundle.json is corrupt', () => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'bundle.json'), '{ not json');
    expect(() => readLocalBundle(outDir)).toThrow(/bundle\.json.*pull/i);
  });
});
