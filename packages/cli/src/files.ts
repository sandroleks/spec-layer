import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, renameSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, isAbsolute, sep } from 'node:path';
import {
  CSS_HEADER_PREFIX, CSS_INDEX_FILE, dtcgExportFiles, fontRequirements, foundationDtcg, usageUnits,
  validateLevel1,
  type DtcgOptions, type FoundationArtifactV5,
} from '@spec-layer/extractor';
import type { Platform } from './detect';
import { outputId, outputPathProblem, renderOutput, type OutputConfig } from './outputs';
import { visibleDirProblem, writeVisibleDir } from './visibleDir';
import { DEFAULT_COMPONENT_SPECS_DIR } from './config';
import { parseBundle, type BundleV1 } from './bundle';
import { DEFAULT_SELECTION, selectComponents, type Selection } from './selection';

export function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'component';
}

/**
 * The first two lines of every component brief the extractor emits. The
 * visible component-specs/ directory is owned by this marker: files that
 * begin with it are ours to replace or remove, anything else stops the pull.
 * Nothing is prepended to a brief; the marker is what the plugin already
 * writes, so the file stays byte-identical to Copy for AI.
 */
export const COMPONENT_SPEC_MARKER = 'spec_layer:\n  kind: component';

/**
 * Every artifact in the bundle; path is null when the selection left it
 * unwritten, relative to the working directory: `.speclayer/tokens/resolver.json`
 * for the foundation, `component-specs/<slug>.yaml` for a component. A
 * manifest written by CLI 0.6.0 or earlier carries paths relative to outDir;
 * the next pull rewrites them.
 */
export interface ManifestArtifact {
  kind: 'foundation' | 'component'; name: string; contentHash: string; path: string | null;
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
  /** The targets this pull was made for, when known. */
  platforms?: Platform[];
  /** The outputs this pull wrote or was told to write; part of the freshness comparison. */
  outputs?: OutputConfig[];
  /** Where the briefs were written; absent in manifests before 0.7.0. Part of the freshness comparison. */
  componentSpecsDir?: string;
  artifacts: ManifestArtifact[];
}

export function readManifest(outDir: string): Manifest | null {
  const path = join(outDir, 'manifest.json');
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Manifest & {
      artifacts: Array<ManifestArtifact & { aiPath?: string | null }>;
    };
    // CLI 0.5.0 and earlier wrote the field as aiPath. Read it as path so
    // list, skill, and status keep working until the next pull rewrites it.
    parsed.artifacts = parsed.artifacts.map((artifact) => {
      const { aiPath, ...rest } = artifact as ManifestArtifact & { aiPath?: string | null };
      return {
        ...rest, path: rest.path ?? aiPath ?? null,
      } as ManifestArtifact;
    });
    return parsed;
  } catch { return null; }
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

/** Stage the record into <outDir>.partial, swap, then write the visible directories. A failed pull never half-writes. */
export function writeBundleFiles(opts: {
  outDir: string; cwd: string; raw: string; bundle: BundleV1; libraryId: string; publishedAt: string; bundleHash: string;
  selection?: Selection; dtcg?: DtcgOptions; platforms?: Platform[]; outputs?: OutputConfig[]; componentSpecsDir?: string;
}): { written: string[]; componentSpecs: { path: string; files: string[] }; outputs: Array<{ path: string; files: string[] }> } {
  assertReplaceable(opts.outDir, opts.cwd);
  const selection = opts.selection ?? DEFAULT_SELECTION;
  const selected = selectComponents(opts.bundle, selection);
  const slugs = componentSlugs(opts.bundle);
  const outputs = opts.outputs ?? [];
  const componentSpecsDir = opts.componentSpecsDir ?? DEFAULT_COMPONENT_SPECS_DIR;
  // Manifest paths are relative to the working directory and always use `/`.
  const outDirRel = relative(resolve(opts.cwd), resolve(opts.outDir)).split(sep).join('/');

  // Every visible directory and every brief is checked before anything is
  // staged, so a refusal leaves the record and the team's tree exactly as
  // they were.
  const outputPaths = outputs.map((o) => o.path);
  const specsProblem = visibleDirProblem(opts.cwd, outDirRel, componentSpecsDir, COMPONENT_SPEC_MARKER, outputPaths, 'componentSpecsDir');
  if (specsProblem) throw new Error(specsProblem);
  for (const o of outputs) {
    const problem = outputPathProblem(opts.cwd, outDirRel, o, [componentSpecsDir, ...outputPaths.filter((p) => p !== o.path)]);
    if (problem) throw new Error(problem);
  }
  const briefs: Record<string, string> = {};
  opts.bundle.components.forEach((component, i) => {
    if (!selected[i]) return;
    if (!component.ai.startsWith(COMPONENT_SPEC_MARKER)) {
      throw new Error(`The published brief for ${component.name} does not begin with the Spec Layer marker. Republish from the plugin, then pull again.`);
    }
    briefs[`${slugs[i]}.yaml`] = component.ai;
  });

  const staging = `${opts.outDir}.partial`;
  rmSync(staging, { recursive: true, force: true });
  const written: string[] = [];
  const deliverables: Array<{ output: OutputConfig; files: Record<string, string> }> = [];
  const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
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
      let path: string | null = null;
      if (selection.foundation) {
        // A shape check on the wire, so a malformed artifact fails in one
        // sentence rather than deep inside the projection. This does not
        // re-derive v5 output; the projection reads the artifact as published.
        const artifact: unknown = opts.bundle.foundation.artifact;
        if (validateLevel1(artifact).some((d) => d.severity === 'error')) {
          throw new Error('The published Foundation context did not pass schema validation. Republish from the plugin, then pull again.');
        }
        // The families and weights the library's typography styles actually
        // reference, so a repository can load exactly those instead of a bare
        // family name that leaves every weight to synthesise.
        put('fonts.json', json(fontRequirements(artifact as FoundationArtifactV5)));
        // The evidence for a unit no scope states is split across the bundle:
        // the scopes live in the Foundation and the bindings in the component
        // artifacts, and the projection sees only the first. The pull is the
        // first place both are in hand, so it is where the pass runs. Every
        // unit it derives is written to the projection's own report.
        const exp = foundationDtcg(
          artifact as FoundationArtifactV5, opts.dtcg ?? {}, usageUnits(opts.bundle),
        );
        for (const [name, text] of Object.entries(dtcgExportFiles(exp))) put(`tokens/${name}`, text);
        path = `${outDirRel}/tokens/resolver.json`;
        const header = { libraryId: opts.libraryId, contentHash: opts.bundle.foundation.artifact.spec_layer.export.content_hash };
        for (const output of outputs) {
          const rendered = renderOutput(exp, output, header);
          put(`outputs/${outputId(output)}.map.json`, json(rendered.map));
          put(`outputs/${outputId(output)}.report.json`, json(rendered.report));
          deliverables.push({ output, files: rendered.files });
        }
      }
      artifacts.push({
        kind: 'foundation', name: 'foundation',
        contentHash: opts.bundle.foundation.artifact.spec_layer.export.content_hash,
        path,
      });
    }
    opts.bundle.components.forEach((component, i) => {
      artifacts.push({
        kind: 'component', name: component.name,
        contentHash: component.artifact.spec_layer.export.content_hash,
        path: selected[i] ? `${componentSpecsDir}/${slugs[i]}.yaml` : null,
      });
    });
    const manifest: Manifest = {
      libraryId: opts.libraryId, publishedAt: opts.publishedAt, bundleHash: opts.bundleHash,
      pluginVersion: opts.bundle.pluginVersion, extractorVersion: opts.bundle.extractorVersion,
      selection, componentSpecsDir, artifacts,
      ...(opts.dtcg && Object.keys(opts.dtcg).length > 0 ? { dtcg: opts.dtcg } : {}),
      ...(opts.platforms && opts.platforms.length > 0 ? { platforms: opts.platforms } : {}),
      ...(opts.outputs ? { outputs: opts.outputs } : {}),
    };
    put('manifest.json', json(manifest));
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  rmSync(opts.outDir, { recursive: true, force: true });
  renameSync(staging, opts.outDir);
  // Visible directories go last and in place: the record is complete before
  // the team's tree changes. Briefs are written (and stale ones removed)
  // whenever a pull runs; tokens/ is touched only when the Foundation was
  // written, so a components-only pull leaves it exactly as it was.
  const componentSpecs = { path: componentSpecsDir, files: writeVisibleDir(opts.cwd, componentSpecsDir, COMPONENT_SPEC_MARKER, briefs) };
  const outputResults: Array<{ path: string; files: string[] }> = [];
  for (const d of deliverables) {
    outputResults.push({ path: d.output.path, files: writeVisibleDir(opts.cwd, d.output.path, CSS_HEADER_PREFIX, d.files, CSS_INDEX_FILE) });
  }
  return { written, componentSpecs, outputs: outputResults };
}
