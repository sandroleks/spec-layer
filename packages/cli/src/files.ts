import { mkdirSync, writeFileSync, readFileSync, rmSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { BundleV1 } from './bundle';

export function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'component';
}

export interface ManifestArtifact { kind: 'foundation' | 'component'; name: string; contentHash: string; aiPath: string }
export interface Manifest {
  libraryId: string;
  publishedAt: string;
  bundleHash: string;
  pluginVersion: string | null;
  extractorVersion: string;
  artifacts: ManifestArtifact[];
}

export function readManifest(outDir: string): Manifest | null {
  const path = join(outDir, 'manifest.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as Manifest; } catch { return null; }
}

/** Stage into <outDir>.partial, then swap. A failed pull never half-writes. */
export function writeBundleFiles(opts: {
  outDir: string; raw: string; bundle: BundleV1; libraryId: string; publishedAt: string; bundleHash: string;
}): string[] {
  const staging = `${opts.outDir}.partial`;
  rmSync(staging, { recursive: true, force: true });
  const written: string[] = [];
  const put = (rel: string, content: string) => {
    const path = join(staging, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    written.push(rel);
  };
  try {
    put('bundle.json', opts.raw);
    const artifacts: ManifestArtifact[] = [];
    if (opts.bundle.foundation) {
      put('ai/foundation.yaml', opts.bundle.foundation.ai);
      artifacts.push({
        kind: 'foundation', name: 'foundation',
        contentHash: opts.bundle.foundation.artifact.spec_layer.export.content_hash,
        aiPath: 'ai/foundation.yaml',
      });
    }
    const used = new Map<string, number>();
    for (const component of opts.bundle.components) {
      const base = slugify(component.name);
      const count = (used.get(base) ?? 0) + 1;
      used.set(base, count);
      const aiPath = `ai/components/${count === 1 ? base : `${base}-${count}`}.yaml`;
      put(aiPath, component.ai);
      artifacts.push({
        kind: 'component', name: component.name,
        contentHash: component.artifact.spec_layer.export.content_hash, aiPath,
      });
    }
    const manifest: Manifest = {
      libraryId: opts.libraryId, publishedAt: opts.publishedAt, bundleHash: opts.bundleHash,
      pluginVersion: opts.bundle.pluginVersion, extractorVersion: opts.bundle.extractorVersion, artifacts,
    };
    put('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  rmSync(opts.outDir, { recursive: true, force: true });
  renameSync(staging, opts.outDir);
  return written;
}
