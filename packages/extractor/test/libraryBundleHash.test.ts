import { describe, it, expect } from 'vitest';
import { libraryBundleContentHash } from '../src/libraryBundleHash';

/** An artifact with a full export envelope, so the volatile fields are real. */
const artifact = (hash: string, generatedAt: string) => ({
  spec_layer: {
    kind: 'component',
    export: {
      id: `component:1:100:${generatedAt}`,
      generated_at: generatedAt,
      deterministic: true,
      content_hash: `sha256:${hash.repeat(64).slice(0, 64)}`,
    },
  },
});

function bundle(generatedAt: string, overrides: Record<string, unknown> = {}) {
  return {
    schema: 'spec-layer-library-bundle', version: '1.0.0', fileName: 'DS',
    pluginVersion: '5.0.0', extractorVersion: '2',
    foundation: { ai: 'tokens: {}\n', artifact: artifact('f', generatedAt) },
    components: [{ name: 'Button', ai: 'component: Button\n', artifact: artifact('c', generatedAt) }],
    ...overrides,
  };
}

describe('libraryBundleContentHash', () => {
  it('ignores the per-export envelope, so two build times hash the same', () => {
    const early = bundle('2026-09-08T10:00:00.000Z');
    const late = bundle('2026-09-08T10:00:05.000Z');
    expect(JSON.stringify(early)).not.toBe(JSON.stringify(late));
    expect(libraryBundleContentHash(early)).toBe(libraryBundleContentHash(late));
  });

  it('never mutates the bundle it is given', () => {
    const b = bundle('2026-09-08T10:00:00.000Z');
    const before = JSON.stringify(b);
    libraryBundleContentHash(b);
    expect(JSON.stringify(b)).toBe(before);
  });

  it("changes when a component's content hash changes", () => {
    const base = bundle('2026-09-08T10:00:00.000Z');
    const changed = bundle('2026-09-08T10:00:00.000Z');
    changed.components[0].artifact.spec_layer.export.content_hash = `sha256:${'d'.repeat(64)}`;
    expect(libraryBundleContentHash(changed)).not.toBe(libraryBundleContentHash(base));
  });

  it('changes for the foundation, fileName, extractorVersion, and pluginVersion', () => {
    const at = '2026-09-08T10:00:00.000Z';
    const base = libraryBundleContentHash(bundle(at));
    const withoutFoundation = bundle(at, { foundation: null });
    const renamed = bundle(at, { fileName: 'Other file' });
    const rebuilt = bundle(at, { extractorVersion: '3' });
    const republished = bundle(at, { pluginVersion: '5.1.0' });
    for (const other of [withoutFoundation, renamed, rebuilt, republished]) {
      expect(libraryBundleContentHash(other)).not.toBe(base);
    }
  });

  it("changes when a component's ai projection changes but its artifact does not", () => {
    const at = '2026-09-08T10:00:00.000Z';
    const changed = bundle(at);
    changed.components[0].ai = 'component: Button\nnotes: new\n';
    expect(libraryBundleContentHash(changed)).not.toBe(libraryBundleContentHash(bundle(at)));
  });

  it('does not depend on key order', () => {
    const at = '2026-09-08T10:00:00.000Z';
    const reordered = {
      components: bundle(at).components,
      foundation: bundle(at).foundation,
      extractorVersion: '2', pluginVersion: '5.0.0', fileName: 'DS',
      version: '1.0.0', schema: 'spec-layer-library-bundle',
    };
    expect(libraryBundleContentHash(reordered)).toBe(libraryBundleContentHash(bundle(at)));
  });

  it('is a plain sha256 digest', () => {
    expect(libraryBundleContentHash(bundle('2026-09-08T10:00:00.000Z'))).toMatch(/^[0-9a-f]{64}$/);
  });
});
