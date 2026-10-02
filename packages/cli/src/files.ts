import { lstatSync, mkdirSync, mkdtempSync, chmodSync, writeFileSync, readFileSync, readdirSync, rmSync, renameSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import {
  CSS_HEADER_PREFIX, CSS_INDEX_FILE, COMPONENT_MARKDOWN_MARKER, COMPONENT_YAML_MARKER, componentMarkdown, componentSlugs,
  dtcgExportFiles, fontRequirements, foundationDtcg, slugify, usageUnits, validateLevel1,
  type ComponentArtifactV5, type DtcgOptions, type FoundationArtifactV5,
} from '@spec-layer/extractor';
import type { Platform } from './detect';
import { outputId, outputPathProblem, renderOutput, type OutputConfig } from './outputs';
import { pathInside, visibleDirProblem, writeVisibleDir } from './visibleDir';
import { DEFAULT_COMPONENT_FORMAT, DEFAULT_COMPONENT_SPECS_DIR, OUT_DIR_RULE, isComponentFormat, type ComponentFormat } from './config';
import { parseBundle, type BundleV1 } from './bundle';
import { DEFAULT_SELECTION, selectComponents, type Selection } from './selection';
import { cliVersion } from './version';

// Re-exported for existing callers; the rule lives in the extractor so the plugin shares it.
export { slugify };

/** The first two lines of every brief. Nothing is prepended, so the file stays byte-identical to Copy for AI. */
const COMPONENT_SPEC_MARKER = COMPONENT_YAML_MARKER;

/**
 * component-specs/ is owned by either format's opening bytes: a file that begins
 * with one is ours to replace or remove, anything else stops the pull. Owning
 * both lets a format switch remove the other format's files.
 */
export const COMPONENT_SPEC_MARKERS: readonly string[] = [COMPONENT_YAML_MARKER, COMPONENT_MARKDOWN_MARKER];

/**
 * One component's Markdown page. The envelope check never looked inside the
 * artifact, so a malformed one fails here in one plain sentence.
 */
export function componentMarkdownPage(component: { name: string; artifact: unknown }): string {
  const failed = () => new Error(
    `The published component context for ${component.name} could not be rendered as Markdown. Republish from the plugin, then pull again.`,
  );
  let page: string;
  try {
    page = componentMarkdown(component.artifact as ComponentArtifactV5);
  } catch {
    throw failed();
  }
  if (!page.startsWith(COMPONENT_MARKDOWN_MARKER)) throw failed();
  return page;
}

/**
 * `path` is relative to the working directory (`component-specs/<slug>.yaml`),
 * or null when the selection left it unwritten. CLI 0.6.0 and earlier wrote
 * paths relative to outDir; the next pull rewrites them.
 */
export interface ManifestArtifact {
  kind: 'foundation' | 'component'; name: string; contentHash: string; path: string | null;
}
export interface Manifest {
  libraryId: string;
  publishedAt: string;
  bundleHash: string;
  /** From `X-Library-Version`; absent when the proxy sent none. Never invented. */
  version?: string;
  pluginVersion: string | null;
  extractorVersion: string;
  /**
   * The CLI that projected this pull; absent before 0.9.0. Part of the
   * freshness check because the projection lives in the CLI, not the bundle.
   * `extractorVersion` needs none: it travels in the bundle, so the ETag covers it.
   */
  cliVersion?: string;
  /** Absent in manifests written by CLI 0.1.0, which always wrote everything. */
  selection?: Selection;
  /** The dtcg options tokens/ was projected with; absent for defaults. Part of the freshness check. */
  dtcg?: DtcgOptions;
  platforms?: Platform[];
  /** Written or configured outputs; part of the freshness check. */
  outputs?: OutputConfig[];
  /** Absent before 0.7.0. Part of the freshness check. */
  componentSpecsDir?: string;
  /** Absent before 0.10.0, which always wrote yaml. Part of the freshness check. */
  componentSpecsFormat?: ComponentFormat;
  artifacts: ManifestArtifact[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

type StoredArtifact = ManifestArtifact & { aiPath?: string | null };

const isString = (v: unknown): v is string => typeof v === 'string';
const optional = (v: unknown, check: (x: unknown) => boolean): boolean => v === undefined || check(v);

/** `{ foundation, components }` as every CLI since 0.2.0 wrote it; `components` is null for every component. */
const isStoredSelection = (v: unknown): boolean => isRecord(v)
  && typeof v.foundation === 'boolean'
  && (v.components === null || (Array.isArray(v.components) && v.components.every(isString)));

/** One outputs[] entry as parseOutput produced it, since 0.6.0: the four named strings, plus the optional overrides. */
const isStoredOutput = (v: unknown): boolean => isRecord(v)
  && isString(v.platform) && isString(v.format) && isString(v.path) && isString(v.case)
  && optional(v.root, isString) && optional(v.modeSelector, isString)
  && optional(v.modes, (m) => isRecord(m) && Object.values(m).every(isString));

/**
 * The fields every CLI since 0.1.0 wrote, plus a type check on each optional
 * field present, so a hand edit reads as no pull instead of a crash. `path` may
 * be absent (0.5.0 wrote `aiPath`), null (not written), or a string.
 */
function isManifestShape(v: unknown): v is Manifest & { artifacts: StoredArtifact[] } {
  if (!isRecord(v)) return false;
  if (typeof v.libraryId !== 'string' || typeof v.publishedAt !== 'string'
    || typeof v.bundleHash !== 'string' || typeof v.extractorVersion !== 'string') return false;
  if (v.pluginVersion !== undefined && v.pluginVersion !== null && typeof v.pluginVersion !== 'string') return false;
  if (!optional(v.version, isString) || !optional(v.cliVersion, isString)
    || !optional(v.selection, isStoredSelection) || !optional(v.dtcg, isRecord)
    || !optional(v.platforms, (p) => Array.isArray(p) && p.every(isString))
    || !optional(v.outputs, (o) => Array.isArray(o) && o.every(isStoredOutput))
    || !optional(v.componentSpecsDir, isString) || !optional(v.componentSpecsFormat, isComponentFormat)) return false;
  if (!Array.isArray(v.artifacts)) return false;
  const pathLike = (p: unknown): boolean => p === undefined || p === null || typeof p === 'string';
  return v.artifacts.every((a) => isRecord(a)
    && (a.kind === 'foundation' || a.kind === 'component')
    && typeof a.name === 'string' && typeof a.contentHash === 'string'
    && pathLike(a.path) && pathLike(a.aiPath));
}

export function readManifest(outDir: string): Manifest | null {
  const path = join(outDir, 'manifest.json');
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  // Not the shape this CLI writes: treat it as no pull, which the next pull rewrites.
  if (!isManifestShape(parsed)) return null;
  // CLI 0.5.0 and earlier wrote aiPath; read it as path until the next pull.
  const artifacts: ManifestArtifact[] = (parsed.artifacts as StoredArtifact[])
    .map(({ aiPath, ...rest }) => ({ ...rest, path: rest.path ?? aiPath ?? null }));
  return { ...parsed, artifacts };
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
 * The swap deletes outDir wholesale, so refuse anything not our own: the
 * working directory or a parent, a file, or a non-empty directory with no
 * manifest. resolveOutDir already refuses the first; this is the last defence.
 */
function assertReplaceable(outDir: string, cwd: string): void {
  const root = resolve(cwd);
  const abs = resolve(outDir);
  if (abs === root || !pathInside(root, abs)) throw new Error(OUT_DIR_RULE);
  // lstat, not existsSync: a link, dangling or not, is the link itself here.
  const stat = lstatSync(abs, { throwIfNoEntry: false });
  if (!stat) return;
  // The swap's rename would replace a link rather than write through it.
  if (stat.isSymbolicLink()) {
    throw new Error(
      `${outDir} is a symbolic link, and spec-layer pull replaces its output directory rather than writing through a link. `
      + 'Point --out or "outDir" in speclayer.json at a real directory, or replace the link with the directory it points to.',
    );
  }
  // readdirSync on a file throws a raw ENOTDIR; say what is there instead.
  if (!stat.isDirectory()) {
    throw new Error(`${outDir} exists and is not a directory. Choose another path or remove the file.`);
  }
  if (!existsSync(join(abs, 'manifest.json')) && readdirSync(abs).length > 0) {
    throw new Error(`${outDir} exists and was not written by spec-layer pull. Choose an empty or new directory.`);
  }
}

/** The filesystem calls a swap makes, so a test can fail one of them. */
export interface SwapFs {
  renameSync: (from: string, to: string) => void;
  rmSync: (path: string, opts: { recursive: true; force: true }) => void;
  existsSync: (path: string) => boolean;
}

const REAL_SWAP_FS: SwapFs = { renameSync, rmSync, existsSync };

/**
 * Puts `staging` at `target` so that at every moment one complete copy is on
 * disk: the previous directory moves aside first, the new one moves in, and
 * only then is the previous one deleted. If the second rename fails (on
 * Windows, a virus scanner or indexer holding a file open answers EPERM), the
 * previous directory moves back, so a failed pull leaves the last good one.
 * Deleting it before the rename, as this once did, left no output directory
 * at all when that rename failed.
 */
export function swapInto(staging: string, target: string, fs: SwapFs = REAL_SWAP_FS): void {
  if (!fs.existsSync(target)) {
    try {
      fs.renameSync(staging, target);
    } catch (err) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw err;
    }
    return;
  }
  const previous = `${staging}.previous`;
  try {
    fs.renameSync(target, previous);
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  try {
    fs.renameSync(staging, target);
  } catch (err) {
    try {
      fs.renameSync(previous, target);
    } catch {
      // Both renames failed: the last good copy is still whole at `previous`.
      throw new Error(`${target} could not be replaced, and the previous copy could not be moved back. It is intact at ${previous}; rename it to ${target}.`);
    }
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  // The new copy is in place. A previous copy that will not delete is clutter, not a failed pull.
  try {
    fs.rmSync(previous, { recursive: true, force: true });
  } catch {
    // Left for the developer; its name says what it is.
  }
}

/** Stage the record into a fresh <outDir>.partial-XXXXXX, swap, then write the visible directories. A failed pull never half-writes. */
export function writeBundleFiles(opts: {
  outDir: string; cwd: string; raw: string; bundle: BundleV1; libraryId: string; publishedAt: string; bundleHash: string;
  version?: string | null;
  selection?: Selection; dtcg?: DtcgOptions; platforms?: Platform[]; outputs?: OutputConfig[]; componentSpecsDir?: string;
  componentSpecsFormat?: ComponentFormat;
}): { written: string[]; componentSpecs: { path: string; files: string[] }; outputs: Array<{ path: string; files: string[] }> } {
  assertReplaceable(opts.outDir, opts.cwd);
  const selection = opts.selection ?? DEFAULT_SELECTION;
  const selected = selectComponents(opts.bundle, selection);
  const slugs = componentSlugs(opts.bundle.components.map((c) => c.name));
  const outputs = opts.outputs ?? [];
  const componentSpecsDir = opts.componentSpecsDir ?? DEFAULT_COMPONENT_SPECS_DIR;
  const componentSpecsFormat = opts.componentSpecsFormat ?? DEFAULT_COMPONENT_FORMAT;
  // Manifest paths are relative to the working directory and always use `/`.
  const outDirRel = relative(resolve(opts.cwd), resolve(opts.outDir)).split(sep).join('/');

  // Check every visible directory and brief before staging, so a refusal changes nothing.
  const outputPaths = outputs.map((o) => o.path);
  const specsProblem = visibleDirProblem(opts.cwd, outDirRel, componentSpecsDir, COMPONENT_SPEC_MARKERS, outputPaths, 'componentSpecsDir');
  if (specsProblem) throw new Error(specsProblem);
  for (const o of outputs) {
    const problem = outputPathProblem(opts.cwd, outDirRel, o, [componentSpecsDir, ...outputPaths.filter((p) => p !== o.path)]);
    if (problem) throw new Error(problem);
  }
  const briefs: Record<string, string> = {};
  opts.bundle.components.forEach((component, i) => {
    if (!selected[i]) return;
    if (componentSpecsFormat === 'md') {
      briefs[`${slugs[i]}.md`] = componentMarkdownPage(component);
      return;
    }
    if (!component.ai.startsWith(COMPONENT_SPEC_MARKER)) {
      throw new Error(`The published brief for ${component.name} does not begin with the Spec Layer marker. Republish from the plugin, then pull again.`);
    }
    briefs[`${slugs[i]}.yaml`] = component.ai;
  });

  // A directory this call creates, so cleanup removes only what it made. The
  // parent must exist first: `--out build/spec` on a fresh checkout has no `build/`.
  mkdirSync(dirname(resolve(opts.outDir)), { recursive: true });
  const staging = mkdtempSync(`${resolve(opts.outDir)}.partial-`);
  // mkdtempSync creates at 0700 regardless of umask, but this directory becomes
  // outDir, so give it mkdirSync's default mode.
  chmodSync(staging, 0o777 & ~process.umask());
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
        // A shape check only, so a malformed artifact fails in one sentence.
        const artifact: unknown = opts.bundle.foundation.artifact;
        if (validateLevel1(artifact).some((d) => d.severity === 'error')) {
          throw new Error('The published Foundation context did not pass schema validation. Republish from the plugin, then pull again.');
        }
        // The families and weights typography styles reference, so a repo loads exactly those.
        put('fonts.json', json(fontRequirements(artifact as FoundationArtifactV5)));
        // Unit evidence is split: scopes in the Foundation, bindings in the
        // components. The pull holds both, so the pass runs here; every unit it
        // derives goes to the projection's report.
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
        path: selected[i] ? `${componentSpecsDir}/${slugs[i]}.${componentSpecsFormat}` : null,
      });
    });
    const manifest: Manifest = {
      libraryId: opts.libraryId, publishedAt: opts.publishedAt, bundleHash: opts.bundleHash,
      pluginVersion: opts.bundle.pluginVersion, extractorVersion: opts.bundle.extractorVersion,
      cliVersion: cliVersion(),
      selection, componentSpecsDir, componentSpecsFormat, artifacts,
      ...(opts.version ? { version: opts.version } : {}),
      ...(opts.dtcg && Object.keys(opts.dtcg).length > 0 ? { dtcg: opts.dtcg } : {}),
      ...(opts.platforms && opts.platforms.length > 0 ? { platforms: opts.platforms } : {}),
      ...(opts.outputs ? { outputs: opts.outputs } : {}),
    };
    put('manifest.json', json(manifest));
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  swapInto(staging, resolve(opts.outDir));
  // Visible directories go last, after the record is complete. Briefs are
  // rewritten on every pull; tokens/ only when the Foundation was written.
  const componentSpecs = { path: componentSpecsDir, files: writeVisibleDir(opts.cwd, componentSpecsDir, COMPONENT_SPEC_MARKERS, briefs) };
  const outputResults: Array<{ path: string; files: string[] }> = [];
  for (const d of deliverables) {
    outputResults.push({ path: d.output.path, files: writeVisibleDir(opts.cwd, d.output.path, CSS_HEADER_PREFIX, d.files, CSS_INDEX_FILE) });
  }
  return { written, componentSpecs, outputs: outputResults };
}
