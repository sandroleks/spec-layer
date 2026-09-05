import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, renameSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, isAbsolute } from 'node:path';
import {
  dtcgExportFiles, foundationDtcg, validateLevel1,
  type DtcgOptions, type FoundationArtifactV5,
} from '@spec-layer/extractor';
import { parseBundle, type BundleV1 } from './bundle';
import { DEFAULT_SELECTION, selectComponents, type Selection } from './selection';

export function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'component';
}

/**
 * Every artifact in the bundle; aiPath is null when the selection left it
 * unwritten. For the foundation this is the DTCG resolver path
 * (`tokens/resolver.json`); for a component it is its AI YAML path.
 */
export interface ManifestArtifact {
  kind: 'foundation' | 'component'; name: string; contentHash: string; aiPath: string | null;
}
export interface Manifest {
  libraryId: string;
  publishedAt: string;
  bundleHash: string;
  pluginVersion: string | null;
  extractorVersion: string;
  /** Absent in manifests written by CLI 0.1.0, which always wrote everything. */
  selection?: Selection;
  /**
   * The dtcg options the tokens/ directory was projected with; absent for
   * defaults. Part of the freshness comparison, since a config change must
   * re-project even when the bundle did not move.
   */
  dtcg?: DtcgOptions;
  artifacts: ManifestArtifact[];
}

export function readManifest(outDir: string): Manifest | null {
  const path = join(outDir, 'manifest.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as Manifest; } catch { return null; }
}

/** The whole bundle as last pulled, or null when nothing was pulled. */
export function readLocalBundle(outDir: string): BundleV1 | null {
  const path = join(outDir, 'bundle.json');
  if (!existsSync(path)) return null;
  try {
    return parseBundle(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${path} could not be read as a library bundle. Run spec-layer pull again.`);
  }
}

/**
 * Slugs for every component in bundle order, deduped the same way regardless of
 * which components a selection writes, so a filtered pull names a file exactly
 * as an unfiltered one would.
 */
function componentSlugs(bundle: BundleV1): string[] {
  const usedSlugs = new Set<string>();
  const nextSuffix = new Map<string, number>();
  return bundle.components.map((component) => {
    const base = slugify(component.name);
    let slug = base;
    if (usedSlugs.has(slug)) {
      let n = (nextSuffix.get(base) ?? 1) + 1;
      slug = `${base}-${n}`;
      while (usedSlugs.has(slug)) {
        n += 1;
        slug = `${base}-${n}`;
      }
      nextSuffix.set(base, n);
    } else {
      nextSuffix.set(base, 1);
    }
    usedSlugs.add(slug);
    return slug;
  });
}

/**
 * The swap below deletes outDir wholesale, so refuse anything that is not a
 * directory of our own: the working directory or one of its parents, or an
 * existing non-empty directory that holds no manifest from a previous pull.
 */
function assertReplaceable(outDir: string, cwd: string): void {
  const rel = relative(resolve(cwd), resolve(outDir));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('The output directory must sit inside the current directory, not be "." or a parent of it.');
  }
  if (existsSync(outDir) && !existsSync(join(outDir, 'manifest.json')) && readdirSync(outDir).length > 0) {
    throw new Error(`${outDir} exists and was not written by spec-layer pull. Choose an empty or new directory.`);
  }
}

/** Stage into <outDir>.partial, then swap. A failed pull never half-writes. */
export function writeBundleFiles(opts: {
  outDir: string; cwd: string; raw: string; bundle: BundleV1; libraryId: string; publishedAt: string; bundleHash: string;
  selection?: Selection; dtcg?: DtcgOptions;
}): string[] {
  assertReplaceable(opts.outDir, opts.cwd);
  const selection = opts.selection ?? DEFAULT_SELECTION;
  const selected = selectComponents(opts.bundle, selection);
  const slugs = componentSlugs(opts.bundle);
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
      let aiPath: string | null = null;
      if (selection.foundation) {
        // A shape check on the wire, so a malformed artifact fails in one
        // sentence rather than deep inside the projection. This does not
        // re-derive v5 output; the projection reads the artifact as published.
        const artifact: unknown = opts.bundle.foundation.artifact;
        if (validateLevel1(artifact).some((d) => d.severity === 'error')) {
          throw new Error('The published Foundation context did not pass schema validation. Republish from the plugin, then pull again.');
        }
        const files = dtcgExportFiles(foundationDtcg(artifact as FoundationArtifactV5, opts.dtcg ?? {}));
        for (const [name, text] of Object.entries(files)) put(`tokens/${name}`, text);
        aiPath = 'tokens/resolver.json';
      }
      artifacts.push({
        kind: 'foundation', name: 'foundation',
        contentHash: opts.bundle.foundation.artifact.spec_layer.export.content_hash,
        aiPath,
      });
    }
    opts.bundle.components.forEach((component, i) => {
      const aiPath = selected[i] ? `ai/components/${slugs[i]}.yaml` : null;
      if (aiPath) put(aiPath, component.ai);
      artifacts.push({
        kind: 'component', name: component.name,
        contentHash: component.artifact.spec_layer.export.content_hash, aiPath,
      });
    });
    const manifest: Manifest = {
      libraryId: opts.libraryId, publishedAt: opts.publishedAt, bundleHash: opts.bundleHash,
      pluginVersion: opts.bundle.pluginVersion, extractorVersion: opts.bundle.extractorVersion,
      selection, artifacts,
      ...(opts.dtcg && Object.keys(opts.dtcg).length > 0 ? { dtcg: opts.dtcg } : {}),
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
