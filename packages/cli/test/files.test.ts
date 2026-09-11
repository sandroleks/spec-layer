import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

/** A component brief as the plugin publishes it: the marker lines first, then whatever body. */
const brief = (body: string): string => `spec_layer:\n  kind: component\n${body}`;

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
      { name: 'Button', ai: brief('button: yes\n'), artifact: { spec_layer: { export: { content_hash: 'c'.repeat(64) } } } },
    ],
    ...overrides,
  };
}

// twoComponents() carries the stub foundation from makeBundle(), which fails
// validateLevel1 (it is only a content-hash stub, not a real v5 artifact), so
// every writeBundleFiles call using it must deselect the foundation.
const twoComponents = () => makeBundle({
  components: [
    { name: 'Button', ai: brief('button\n'), artifact: { spec_layer: { export: { content_hash: 'a'.repeat(64) } } } },
    { name: 'Card', ai: brief('card\n'), artifact: { spec_layer: { export: { content_hash: 'b'.repeat(64) } } } },
  ],
});

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

  it('reads a manifest written by an earlier CLI that used path', () => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({
      libraryId: 'lib_old', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h', pluginVersion: null, extractorVersion: '2',
      artifacts: [
        { kind: 'foundation', name: 'foundation', contentHash: 'f', path: 'tokens/resolver.json' },
        { kind: 'component', name: 'Button', contentHash: 'c', path: null },
      ],
    }));
    const manifest = readManifest(outDir);
    expect(manifest?.artifacts.map((a) => a.path)).toEqual(['tokens/resolver.json', null]);
    expect(manifest?.artifacts.some((a) => 'path' in a)).toBe(true);
  });

  it('reads a manifest written by an earlier CLI that used aiPath', () => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({
      libraryId: 'lib_old', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h', pluginVersion: null, extractorVersion: '2',
      artifacts: [
        { kind: 'foundation', name: 'foundation', contentHash: 'f', aiPath: 'tokens/resolver.json' },
        { kind: 'component', name: 'Button', contentHash: 'c', aiPath: null },
      ],
    }));
    const manifest = readManifest(outDir);
    expect(manifest?.artifacts.map((a) => a.path)).toEqual(['tokens/resolver.json', null]);
    expect(manifest?.artifacts.some((a) => 'aiPath' in a)).toBe(false);
  });

  it('replaces a CRLF-checked-out brief already on disk in component-specs/', () => {
    // A Git for Windows checkout with core.autocrlf=true turns the CLI's own
    // committed briefs into `spec_layer:\r\n  kind: component`; the marker
    // check must still recognise them as ours, or a Windows pull refuses its
    // own files.
    const bundle = makeBundle();
    mkdirSync(join(tmpDir, 'component-specs'), { recursive: true });
    writeFileSync(join(tmpDir, 'component-specs/button.yaml'), 'spec_layer:\r\n  kind: component\r\nname: old\r\n');
    const { componentSpecs } = writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle,
      libraryId: 'lib-1', publishedAt: 'p', bundleHash: 'h',
      selection: { foundation: false, components: null },
    });
    expect(componentSpecs.files).toEqual(['button.yaml']);
    expect(readFileSync(join(tmpDir, 'component-specs/button.yaml'), 'utf8')).toBe(bundle.components[0].ai);
  });

  it('writes bundle.json byte-for-byte, ai yaml per artifact, and a manifest', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    const raw = JSON.stringify(bundle);
    const { written } = writeBundleFiles({
      outDir, cwd: tmpDir, raw, bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });

    expect(readFileSync(join(outDir, 'bundle.json'), 'utf8')).toBe(raw);
    expect(written).toContain('tokens/resolver.json');
    expect(written).toContain('tokens/spec-layer.meta.json');
    expect(written).toContain('tokens/report.json');
    expect(written).toContain('fonts.json');
    expect(readFileSync(join(tmpDir, 'component-specs/button.yaml'), 'utf8')).toBe(bundle.components[0].ai);

    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.libraryId).toBe('lib-1');
    expect(manifest.publishedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(manifest.bundleHash).toBe('h'.repeat(64));
    expect(manifest.pluginVersion).toBe('5.0.0');
    expect(manifest.extractorVersion).toBe('2');
    expect(manifest.componentSpecsDir).toBe('component-specs');
    expect(manifest.artifacts).toEqual([
      {
        kind: 'foundation', name: 'foundation',
        contentHash: bundle.foundation!.artifact.spec_layer.export.content_hash,
        path: '.speclayer/tokens/resolver.json',
      },
      { kind: 'component', name: 'Button', contentHash: 'c'.repeat(64), path: 'component-specs/button.yaml' },
    ]);
  });

  it('writes fonts.json at the top of outDir, naming the families and weights the styles need', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    const raw = JSON.stringify(bundle);
    writeBundleFiles({
      outDir, cwd: tmpDir, raw, bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });

    const fonts = JSON.parse(readFileSync(join(outDir, 'fonts.json'), 'utf8'));
    // The synthetic fixture's one typography style is Body/Regular in Inter at
    // weight 400 (bound via alias, resolved the same way a literal would be).
    expect(fonts).toEqual([{
      family: 'Inter',
      weights: [400],
      used_by: ['Body/Regular'],
    }]);
  });

  it('does not write fonts.json when the foundation is deselected', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    const raw = JSON.stringify(bundle);
    const { written } = writeBundleFiles({
      outDir, cwd: tmpDir, raw, bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
      selection: { foundation: false, components: null },
    });

    expect(written).not.toContain('fonts.json');
    expect(existsSync(join(outDir, 'fonts.json'))).toBe(false);
  });

  it('dedupes colliding slugs in bundle order', () => {
    const bundle = makeBundle({
      foundation: null,
      components: [
        { name: 'Button', ai: brief('first\n'), artifact: { spec_layer: { export: { content_hash: 'a'.repeat(64) } } } },
        { name: 'button', ai: brief('second\n'), artifact: { spec_layer: { export: { content_hash: 'b'.repeat(64) } } } },
      ],
    });
    const raw = JSON.stringify(bundle);
    const { componentSpecs } = writeBundleFiles({
      outDir, cwd: tmpDir, raw, bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });

    expect(componentSpecs.files).toContain('button.yaml');
    expect(componentSpecs.files).toContain('button-2.yaml');
    expect(readFileSync(join(tmpDir, 'component-specs/button.yaml'), 'utf8')).toBe(brief('first\n'));
    expect(readFileSync(join(tmpDir, 'component-specs/button-2.yaml'), 'utf8')).toBe(brief('second\n'));

    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.artifacts.map((a) => a.path)).toEqual([
      'component-specs/button.yaml',
      'component-specs/button-2.yaml',
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
        { name: 'Button', ai: brief('first\n'), artifact: { spec_layer: { export: { content_hash: 'a'.repeat(64) } } } },
        { name: 'Button 2', ai: brief('second\n'), artifact: { spec_layer: { export: { content_hash: 'b'.repeat(64) } } } },
        { name: 'button', ai: brief('third\n'), artifact: { spec_layer: { export: { content_hash: 'c'.repeat(64) } } } },
      ],
    });
    const raw = JSON.stringify(bundle);
    const { componentSpecs } = writeBundleFiles({
      outDir, cwd: tmpDir, raw, bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });

    expect(new Set(componentSpecs.files).size).toBe(3);
    expect(componentSpecs.files).toEqual([
      'button.yaml',
      'button-2.yaml',
      'button-3.yaml',
    ]);

    expect(readFileSync(join(tmpDir, 'component-specs/button.yaml'), 'utf8')).toBe(brief('first\n'));
    expect(readFileSync(join(tmpDir, 'component-specs/button-2.yaml'), 'utf8')).toBe(brief('second\n'));
    expect(readFileSync(join(tmpDir, 'component-specs/button-3.yaml'), 'utf8')).toBe(brief('third\n'));

    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as Manifest;
    const componentAiPaths = manifest.artifacts.filter((a) => a.kind === 'component').map((a) => a.path);
    expect(new Set(componentAiPaths).size).toBe(3);
    expect(componentAiPaths).toEqual([
      'component-specs/button.yaml',
      'component-specs/button-2.yaml',
      'component-specs/button-3.yaml',
    ]);
  });

  it('is atomic: a second write replaces the directory, and no staging dir remains after success', () => {
    const bundle1 = makeBundle({ foundation: null });
    writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle1), bundle: bundle1,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });
    expect(existsSync(join(tmpDir, 'component-specs/button.yaml'))).toBe(true);
    expect(existsSync(`${outDir}.partial`)).toBe(false);

    const bundle2 = makeBundle({
      foundation: null,
      components: [
        { name: 'Card', ai: brief('card: yes\n'), artifact: { spec_layer: { export: { content_hash: 'd'.repeat(64) } } } },
      ],
    });
    writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle2), bundle: bundle2,
      libraryId: 'lib-1', publishedAt: '2026-09-01T01:00:00.000Z', bundleHash: 'i'.repeat(64),
    });

    // Old files are gone.
    expect(existsSync(join(tmpDir, 'component-specs/button.yaml'))).toBe(false);
    expect(existsSync(join(outDir, 'ai/foundation.yaml'))).toBe(false);
    // New files are present.
    expect(existsSync(join(tmpDir, 'component-specs/card.yaml'))).toBe(true);
    // No staging dir left behind.
    expect(existsSync(`${outDir}.partial`)).toBe(false);
  });

  it('skips the foundation file when foundation is null', () => {
    const bundle = makeBundle({ foundation: null });
    const { written } = writeBundleFiles({
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
    const originalButtonContent = readFileSync(join(tmpDir, 'component-specs/button.yaml'), 'utf8');
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
        { name: 'Card', ai: brief('card: yes\n'), artifact: { spec_layer: { export: { content_hash: 'd'.repeat(64) } } } },
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
    // The visible component-specs/ directory was never touched either, because the
    // failure happens while staging the swapped record, before the visible
    // directories are written.
    expect(existsSync(join(tmpDir, 'component-specs/button.yaml'))).toBe(true);
    expect(readFileSync(join(tmpDir, 'component-specs/button.yaml'), 'utf8')).toBe(originalButtonContent);
    expect(existsSync(join(outDir, 'tokens/resolver.json'))).toBe(true);
    expect(readFileSync(join(outDir, 'tokens/resolver.json'), 'utf8')).toBe(originalResolverContent);
    expect(existsSync(join(tmpDir, 'component-specs/card.yaml'))).toBe(false);
  });

  it('writes the foundation as a tokens/ directory projected from the canonical artifact', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    const { written } = writeBundleFiles({
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
    expect(manifest.artifacts.find((a) => a.kind === 'foundation')?.path).toBe('.speclayer/tokens/resolver.json');
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

  it('records the dtcg options in the manifest, and omits the field for defaults', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_1',
      publishedAt: '2026-09-03T00:00:00.000Z', bundleHash: 'h'.repeat(64),
      dtcg: { values: 'legacy', units: { 'Primitives/number/*': 'px' } },
    });
    expect(readManifest(outDir)!.dtcg).toEqual({ values: 'legacy', units: { 'Primitives/number/*': 'px' } });
    writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_1',
      publishedAt: '2026-09-03T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    });
    expect(readManifest(outDir)!).not.toHaveProperty('dtcg');
  });

  it('writes no tokens/ when the selection excludes the foundation', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    const { written } = writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_1',
      publishedAt: '2026-09-03T00:00:00.000Z', bundleHash: 'h'.repeat(64),
      selection: { foundation: false, components: null },
    });
    expect(written.some((f) => f.startsWith('tokens/'))).toBe(false);
    expect(readManifest(outDir)!.artifacts.find((a) => a.kind === 'foundation')?.path).toBeNull();
  });

  it('fails with a plain sentence when the foundation artifact is not a valid v5 artifact', () => {
    const bundle = makeBundle(); // the stub artifact carries only a content hash
    expect(() => writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_1',
      publishedAt: '2026-09-03T00:00:00.000Z', bundleHash: 'h'.repeat(64),
    })).toThrow('The published Foundation context did not pass schema validation. Republish from the plugin, then pull again.');
    expect(existsSync(outDir)).toBe(false);
  });

  const WEB = { platform: 'web' as const, format: 'css' as const, path: 'tokens', case: 'kebab' as const };

  it('writes the output record into outDir and a tokens/ directory in place, and returns both', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    const result = writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_x',
      publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h', platforms: ['web'], outputs: [WEB],
    });
    expect(result.written).toContain('outputs/web-css.map.json');
    expect(result.written).toContain('outputs/web-css.report.json');
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0].path).toBe('tokens');
    expect(result.outputs[0].files.at(-1)).toBe('index.css');
    expect(readdirSync(join(tmpDir, 'tokens')).sort()).toEqual([...result.outputs[0].files].sort());
    const index = readFileSync(join(tmpDir, 'tokens/index.css'), 'utf8');
    expect(index.startsWith('/* Generated by spec-layer from library lib_x, foundation sha256:')).toBe(true);
    for (const name of result.outputs[0].files) {
      if (name !== 'index.css') expect(index).toContain(`@import "./${name}";`);
    }
    const all = result.outputs[0].files.map((f) => readFileSync(join(tmpDir, 'tokens', f), 'utf8')).join('\n');
    expect(all).toContain('--color-exact-red: #ff0000;');
    const manifest = readManifest(outDir) as Manifest;
    expect(manifest.platforms).toEqual(['web']);
    expect(manifest.outputs).toEqual([WEB]);
    expect(manifest.componentSpecsDir).toBe('component-specs');
    const map = JSON.parse(readFileSync(join(outDir, 'outputs/web-css.map.json'), 'utf8'));
    expect(map['Primitives.color.exact.red']).toMatchObject({ name: '--color-exact-red', source: 'code_syntax' });
    expect(result.outputs[0].files).toContain(map['Primitives.color.exact.red'].file);
  });

  it('writes a real length for a token a component binds to a length property', () => {
    // Primitives.number.unknown-scope carries no unit-pinning scope, so on its
    // own it lands in the CSS as the bare `1.5` a browser drops. The bundle
    // states what it is used for; the pull is where both halves are in hand.
    const bound = {
      name: 'Button',
      ai: brief('button: yes\n'),
      artifact: {
        spec_layer: { export: { content_hash: 'c'.repeat(64) } },
        references: {
          used: [],
          bindings: [{
            path: 'Container', property: 'height',
            source_id: 'VariableID:unknown-number', kind: 'variable',
          }],
        },
      },
    } as unknown as BundleV1['components'][number];
    const bundle = makeBundle({ foundation: realFoundation(), components: [bound] });
    const result = writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_x',
      publishedAt: 'p', bundleHash: 'h', outputs: [WEB],
    });

    const all = result.outputs[0].files
      .map((f) => readFileSync(join(tmpDir, 'tokens', f), 'utf8')).join('\n');
    expect(all).toContain('--primitives-number-unknown-scope: 1.5px;');
    expect(all).not.toContain('--primitives-number-unknown-scope: 1.5;');

    // The file says so itself, rather than only the report: it was the only
    // unitless property in these files, so that note is gone and the derived
    // note stands in its place.
    expect(all).toContain(
      '   1 property in this file has a unit its own Figma variable does not state, taken from how the library uses the token.',
    );
    expect(all).toContain("   See tokens/report.json under your pull's output directory for what pinned it.");
    expect(all).not.toContain('has no unit');

    // Guardrail: every derived unit is auditable. The projection's own report
    // names the component and the property that pinned it.
    const report = JSON.parse(readFileSync(join(outDir, 'tokens/report.json'), 'utf8')) as Array<{
      code: string; severity: string; path: string; details: Record<string, string>;
    }>;
    const derived = report.filter((r) => r.code === 'unit_derived_from_usage');
    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({
      severity: 'info',
      path: 'Primitives.number.unknown-scope',
      details: { via: 'binding', source: 'Button', reason: 'height' },
    });

    // And the CSS output no longer counts it among the unusable ones.
    const cssReport = JSON.parse(readFileSync(join(outDir, 'outputs/web-css.report.json'), 'utf8')) as Array<{ code: string; path: string }>;
    expect(cssReport.some((r) => r.code === 'unitless_number' && r.path === 'Primitives.number.unknown-scope')).toBe(false);
  });

  it('refuses a foreign file in the tokens directory before writing anything', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    mkdirSync(join(tmpDir, 'tokens'), { recursive: true });
    writeFileSync(join(tmpDir, 'tokens/mine.css'), ':root { --mine: 1; }\n');
    expect(() => writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_x',
      publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h', outputs: [WEB],
    })).toThrow('tokens holds files spec-layer did not write. Set outputs[].path in speclayer.json to another path, or move them.');
    expect(existsSync(outDir)).toBe(false);
    expect(existsSync(join(tmpDir, 'component-specs'))).toBe(false);
    expect(readFileSync(join(tmpDir, 'tokens/mine.css'), 'utf8')).toBe(':root { --mine: 1; }\n');
  });

  it('refuses a foreign file in the component specs directory before writing anything', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    mkdirSync(join(tmpDir, 'component-specs'));
    writeFileSync(join(tmpDir, 'component-specs/mine.yaml'), 'name: mine\n');
    expect(() => writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_x', publishedAt: 'p', bundleHash: 'h',
    })).toThrow('component-specs holds files spec-layer did not write. Set componentSpecsDir in speclayer.json to another path, or move them.');
    expect(existsSync(outDir)).toBe(false);
  });

  it('refuses the 0.6.0 file path and overlapping directories', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    const base = { outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_x', publishedAt: 'p', bundleHash: 'h' };
    expect(() => writeBundleFiles({ ...base, outputs: [{ ...WEB, path: 'spec-layer/tokens.css' }] })).toThrow('names a file; spec-layer 0.7.0 writes a directory.');
    expect(() => writeBundleFiles({ ...base, outputs: [WEB], componentSpecsDir: 'tokens' })).toThrow('overlap');
    expect(() => writeBundleFiles({ ...base, outputs: [WEB], componentSpecsDir: 'tokens/specs' })).toThrow('overlap');
  });

  it('refuses a brief that does not begin with the marker, before writing anything', () => {
    const bundle = makeBundle({ foundation: null, components: [{ name: 'Odd', ai: 'name: Odd\n', artifact: { spec_layer: { export: { content_hash: 'd'.repeat(64) } } } }] });
    expect(() => writeBundleFiles({ outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_x', publishedAt: 'p', bundleHash: 'h' }))
      .toThrow('The published brief for Odd does not begin with the Spec Layer marker. Republish from the plugin, then pull again.');
    expect(existsSync(outDir)).toBe(false);
  });

  it('replaces its own earlier files in place and leaves tokens/ alone when the foundation is not selected', () => {
    const bundle = makeBundle({ foundation: realFoundation() });
    const base = { outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_x', publishedAt: 'p', bundleHash: 'h', outputs: [WEB] };
    writeBundleFiles(base);
    const first = readFileSync(join(tmpDir, 'tokens/index.css'), 'utf8');
    writeBundleFiles(base);
    expect(readFileSync(join(tmpDir, 'tokens/index.css'), 'utf8')).toBe(first);
    const noFoundation = writeBundleFiles({ ...base, selection: { foundation: false, components: null } });
    expect(noFoundation.outputs).toEqual([]);
    expect(readFileSync(join(tmpDir, 'tokens/index.css'), 'utf8')).toBe(first);
  });

  it('removes a stale marked brief when the selection narrows, and a stale marked css file when a mode disappears', () => {
    // twoComponents() carries the stub foundation, which fails validateLevel1, so every call here deselects it.
    const bundle = twoComponents();
    const base = { outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib-1', publishedAt: 'p', bundleHash: 'h', selection: { foundation: false, components: null } };
    writeBundleFiles(base);
    expect(readdirSync(join(tmpDir, 'component-specs')).sort()).toEqual(['button.yaml', 'card.yaml']);
    writeFileSync(join(tmpDir, 'component-specs/.gitkeep'), '');
    writeBundleFiles({ ...base, selection: { foundation: false, components: ['card'] } });
    expect(readdirSync(join(tmpDir, 'component-specs')).sort()).toEqual(['.gitkeep', 'card.yaml']);
    writeBundleFiles({ ...base, selection: { foundation: false, components: [] } });
    expect(readdirSync(join(tmpDir, 'component-specs'))).toEqual(['.gitkeep']);

    const withFoundation = makeBundle({ foundation: realFoundation() });
    const fb = { outDir, cwd: tmpDir, raw: JSON.stringify(withFoundation), bundle: withFoundation, libraryId: 'lib_x', publishedAt: 'p', bundleHash: 'h', outputs: [WEB] };
    writeBundleFiles(fb);
    writeFileSync(join(tmpDir, 'tokens/theme.gone.css'), '/* Generated by spec-layer stale */\n');
    writeBundleFiles(fb);
    expect(existsSync(join(tmpDir, 'tokens/theme.gone.css'))).toBe(false);
  });

  it('honours componentSpecsDir and records it in the manifest', () => {
    const bundle = makeBundle({ foundation: null });
    writeBundleFiles({ outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle, libraryId: 'lib_x', publishedAt: 'p', bundleHash: 'h', componentSpecsDir: 'design/specs' });
    expect(readFileSync(join(tmpDir, 'design/specs/button.yaml'), 'utf8')).toBe(bundle.components[0].ai);
    const manifest = readManifest(outDir) as Manifest;
    expect(manifest.componentSpecsDir).toBe('design/specs');
    // foundation: null means no foundation entry is pushed (see "skips the
    // foundation file when foundation is null" above), so the lone component
    // sits at index 0.
    expect(manifest.artifacts[0].path).toBe('design/specs/button.yaml');
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

  it('writes only the selected component files and skips the foundation when deselected', () => {
    const bundle = twoComponents();
    const { written } = writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
      selection: { foundation: false, components: ['card'] },
    });

    expect(written).toEqual(['bundle.json', 'manifest.json']);
    expect(readdirSync(join(tmpDir, 'component-specs'))).toEqual(['card.yaml']);
    expect(existsSync(join(outDir, 'ai/foundation.yaml'))).toBe(false);
    expect(existsSync(join(tmpDir, 'component-specs/button.yaml'))).toBe(false);
    expect(readFileSync(join(tmpDir, 'component-specs/card.yaml'), 'utf8')).toBe(brief('card\n'));
  });

  it('lists every artifact in the manifest, with a null path for the ones not written, and records the selection', () => {
    const bundle = twoComponents();
    writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
      selection: { foundation: false, components: ['card'] },
    });

    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.selection).toEqual({ foundation: false, components: ['card'] });
    expect(manifest.artifacts).toEqual([
      { kind: 'foundation', name: 'foundation', contentHash: 'f'.repeat(64), path: null },
      { kind: 'component', name: 'Button', contentHash: 'a'.repeat(64), path: null },
      { kind: 'component', name: 'Card', contentHash: 'b'.repeat(64), path: 'component-specs/card.yaml' },
    ]);
  });

  it('keeps slugs stable for a selected component regardless of which siblings are deselected', () => {
    const bundle = makeBundle({
      foundation: null,
      components: [
        { name: 'Button', ai: brief('first\n'), artifact: { spec_layer: { export: { content_hash: 'a'.repeat(64) } } } },
        { name: 'button', ai: brief('second\n'), artifact: { spec_layer: { export: { content_hash: 'b'.repeat(64) } } } },
      ],
    });
    const { componentSpecs } = writeBundleFiles({
      outDir, cwd: tmpDir, raw: JSON.stringify(bundle), bundle,
      libraryId: 'lib-1', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
      selection: { foundation: true, components: ['button'] },
    });

    // Both share the name, so both are selected and both keep the slugs an unfiltered pull gives them.
    expect(componentSpecs.files).toContain('button.yaml');
    expect(componentSpecs.files).toContain('button-2.yaml');
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
