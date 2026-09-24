import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { DtcgOptions } from '@spec-layer/extractor';
import type { Selection } from './selection';
import { readCredentials } from './credentials';
import { isPlatform, PLATFORMS, type Platform } from './detect';
import { parseOutput, type OutputConfig } from './outputs';
import { pathInside } from './visibleDir';

export const DEFAULT_API = 'https://api.spec-layer.com';
export const DEFAULT_OUT_DIR = '.speclayer';
export const DEFAULT_COMPONENT_SPECS_DIR = 'component-specs';
const CONFIG_NAME = 'speclayer.json';

/**
 * The swap in files.ts deletes outDir wholesale, so outDir is only ever a
 * relative path under the working directory. `join(cwd, '/abs')` used to
 * nest an absolute --out under cwd silently while every message named the
 * absolute path; refusing here means init and setup never record such a
 * value either. The same sentence is thrown by assertReplaceable in files.ts.
 */
export const OUT_DIR_RULE = 'The output directory must be a relative path inside the current directory: not ".", not a parent of it, and not an absolute path.';

/** The output directory for a run, as typed: the flag, then the config, then the default. Throws OUT_DIR_RULE. */
export function resolveOutDir(cwd: string, out: string | undefined, configOutDir: string | undefined): string {
  const outDir = out ?? configOutDir ?? DEFAULT_OUT_DIR;
  const root = resolve(cwd);
  const abs = resolve(cwd, outDir);
  if (isAbsolute(outDir) || abs === root || !pathInside(root, abs)) throw new Error(OUT_DIR_RULE);
  return outDir;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The API origin, checked before any request carries the key. The key
 * travels in the Authorization header of every request, so plain http is
 * refused except to this machine, where a local proxy build is the only
 * thing listening. A trailing slash is dropped: it would build "//v1/..."
 * paths the proxy router 404s on.
 */
export function apiOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`--api must be an origin such as ${DEFAULT_API}, not "${value}".`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error(`--api must use https, since the pull key travels with every request. Plain http is allowed only for localhost. Got "${value}".`);
  }
  return value.replace(/\/+$/, '');
}

/** How component-specs/ is written: the published AI YAML, or a Markdown page projected from the artifact. */
export const COMPONENT_FORMATS = ['yaml', 'md'] as const;
export type ComponentFormat = typeof COMPONENT_FORMATS[number];
export const DEFAULT_COMPONENT_FORMAT: ComponentFormat = 'yaml';

export function isComponentFormat(value: unknown): value is ComponentFormat {
  return typeof value === 'string' && (COMPONENT_FORMATS as readonly string[]).includes(value);
}

export interface CliConfig {
  libraryId?: string; outDir?: string; componentSpecsDir?: string; componentSpecsFormat?: ComponentFormat; include?: Selection; dtcg?: DtcgOptions;
  platforms?: Platform[]; outputs?: OutputConfig[];
}

const invalidConfig = () => new Error(`${CONFIG_NAME} is not valid JSON. Fix or delete it, then retry.`);

/** `include` narrows what pull writes. Missing fields take the default (everything). */
function parseInclude(value: unknown): Selection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalidConfig();
  const record = value as Record<string, unknown>;
  if (record.foundation !== undefined && typeof record.foundation !== 'boolean') throw invalidConfig();
  if (record.components !== undefined && record.components !== null
    && !(Array.isArray(record.components) && record.components.every((c) => typeof c === 'string'))) {
    throw invalidConfig();
  }
  return {
    foundation: record.foundation === undefined ? true : record.foundation,
    components: (record.components ?? null) as string[] | null,
  };
}

/** `dtcg` chooses the value flavour and declares unit overrides for the tokens/ output. */
function parseDtcg(value: unknown): DtcgOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalidConfig();
  const record = value as Record<string, unknown>;
  const out: DtcgOptions = {};
  if (record.values !== undefined) {
    if (record.values !== 'standard' && record.values !== 'legacy') throw invalidConfig();
    out.values = record.values;
  }
  if (record.units !== undefined) {
    if (typeof record.units !== 'object' || record.units === null || Array.isArray(record.units)) throw invalidConfig();
    for (const unit of Object.values(record.units as Record<string, unknown>)) {
      if (unit !== 'px' && unit !== 'rem') throw invalidConfig();
    }
    out.units = record.units as Record<string, 'px' | 'rem'>;
  }
  return out;
}

/**
 * `componentSpecsDir` is the visible directory the component briefs are
 * written to, relative to the working directory. Normalized so a value typed
 * or committed on Windows (backslashes, a leading `./`) means the same thing
 * as it does on every other platform, and so a trailing slash does not make
 * two settings compare as different when they name the same directory.
 */
function parseComponentSpecsDir(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('speclayer.json "componentSpecsDir" must be a non-empty string.');
  let dir = value.replace(/\\/g, '/');
  if (dir.startsWith('./')) dir = dir.slice(2);
  dir = dir.replace(/\/+$/, '');
  if (dir.length === 0) throw new Error('speclayer.json "componentSpecsDir" must be a non-empty string.');
  return dir;
}

/** `componentSpecsFormat` chooses how component-specs/ is written. Absent means yaml. */
function parseComponentSpecsFormat(value: unknown): ComponentFormat {
  if (!isComponentFormat(value)) throw new Error('speclayer.json "componentSpecsFormat" must be "yaml" or "md".');
  return value;
}

/** `platforms` names the targets this repository builds for; pull and skill read it before detecting. */
function parsePlatforms(value: unknown): Platform[] {
  if (!Array.isArray(value) || !value.every((p) => typeof p === 'string' && isPlatform(p))) {
    throw new Error(`speclayer.json "platforms" must be an array of ${PLATFORMS.join(', ')}.`);
  }
  return [...new Set(value as Platform[])];
}

/** `outputs` lists the files the team's build compiles; each entry is validated by the format registry. */
function parseOutputs(value: unknown): OutputConfig[] {
  if (!Array.isArray(value)) throw new Error('speclayer.json "outputs" must be an array.');
  const outputs = value.map((v, i) => parseOutput(v, i));

  // Check for duplicate platform/format pairs
  const seen = new Set<string>();
  for (const output of outputs) {
    const key = `${output.platform}/${output.format}`;
    if (seen.has(key)) {
      throw new Error(`speclayer.json "outputs" lists ${output.platform}/${output.format} more than once. Keep one entry per platform and format.`);
    }
    seen.add(key);
  }

  return outputs;
}

export function readConfig(cwd: string): CliConfig | null {
  const path = join(cwd, CONFIG_NAME);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { throw invalidConfig(); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalidConfig();
  const record = parsed as Record<string, unknown>;
  return {
    ...(typeof record.libraryId === 'string' ? { libraryId: record.libraryId } : {}),
    ...(typeof record.outDir === 'string' ? { outDir: record.outDir } : {}),
    ...(record.componentSpecsDir !== undefined ? { componentSpecsDir: parseComponentSpecsDir(record.componentSpecsDir) } : {}),
    ...(record.componentSpecsFormat !== undefined ? { componentSpecsFormat: parseComponentSpecsFormat(record.componentSpecsFormat) } : {}),
    ...(record.include !== undefined ? { include: parseInclude(record.include) } : {}),
    ...(record.dtcg !== undefined ? { dtcg: parseDtcg(record.dtcg) } : {}),
    ...(record.platforms !== undefined ? { platforms: parsePlatforms(record.platforms) } : {}),
    ...(record.outputs !== undefined ? { outputs: parseOutputs(record.outputs) } : {}),
  };
}

export function writeConfig(
  cwd: string,
  config: {
    libraryId: string; outDir: string; componentSpecsDir?: string; componentSpecsFormat?: ComponentFormat; include?: Selection; dtcg?: DtcgOptions;
    platforms?: Platform[]; outputs?: OutputConfig[];
  },
): void {
  const body = {
    libraryId: config.libraryId,
    outDir: config.outDir,
    ...(config.componentSpecsDir ? { componentSpecsDir: config.componentSpecsDir } : {}),
    ...(config.componentSpecsFormat ? { componentSpecsFormat: config.componentSpecsFormat } : {}),
    ...(config.include ? { include: config.include } : {}),
    ...(config.dtcg ? { dtcg: config.dtcg } : {}),
    ...(config.platforms && config.platforms.length > 0 ? { platforms: config.platforms } : {}),
    ...(config.outputs ? { outputs: config.outputs } : {}),
  };
  writeFileSync(join(cwd, CONFIG_NAME), `${JSON.stringify(body, null, 2)}\n`);
}

export interface ResolvedOptions {
  libraryId: string | null; outDir: string; api: string; key: string | null;
  /** Where component briefs are written; the config's value or the default. */
  componentSpecsDir: string;
  /** The config's componentSpecsFormat, when it has one; pull applies the flag first and the default last. */
  componentSpecsFormat?: ComponentFormat;
  /** The config's include block, when it has one, for pull to fall back on. */
  include?: Selection;
  /** The config's dtcg block, when it has one, for pull to pass through to writeBundleFiles. */
  dtcg?: DtcgOptions;
  /** The config's platforms block, when it has one, for pull and skill to read before detecting. */
  platforms?: Platform[];
  /** The config's outputs block, when it has one, for pull to write deliverables from. */
  outputs?: OutputConfig[];
  /**
   * Set when a credential file exists but was issued for another library, so
   * the caller can say that instead of reporting a plain missing key.
   */
  storedKeyFor?: string;
}

export function resolveOptions(
  cwd: string,
  flags: { id?: string; out?: string; key?: string; api?: string },
  env: Record<string, string | undefined>,
  manifestLibraryId: (outDir: string) => string | null,
): ResolvedOptions {
  const config = readConfig(cwd);
  const outDir = resolveOutDir(cwd, flags.out, config?.outDir);
  const libraryId = flags.id ?? config?.libraryId ?? manifestLibraryId(join(cwd, outDir));

  // Read the credential file only when nothing else supplies a key, so a
  // corrupt file cannot break a run that passed --key or set SPEC_LAYER_KEY.
  //
  // `||` rather than `??`: an exported but empty SPEC_LAYER_KEY (a CI secret
  // that resolved to nothing, a stale shell profile line) is no key at all. A
  // `??` here would disagree with the falsy check below, read a perfectly good
  // stored key off disk, and then discard it for the empty string.
  const supplied = flags.key || env.SPEC_LAYER_KEY || null;
  let storedKey: string | null = null;
  let storedKeyFor: string | undefined;
  if (!supplied) {
    const stored = readCredentials(cwd);
    if (stored) {
      // An empty stored key is normalised the same way, so `key` is null when
      // there is no usable key rather than an empty string that reads as one.
      if (libraryId && stored.libraryId === libraryId) storedKey = stored.key || null;
      else storedKeyFor = stored.libraryId;
    }
  }

  return {
    libraryId,
    outDir,
    componentSpecsDir: config?.componentSpecsDir ?? DEFAULT_COMPONENT_SPECS_DIR,
    api: apiOrigin(flags.api ?? env.SPEC_LAYER_API ?? DEFAULT_API),
    key: supplied ?? storedKey,
    ...(config?.componentSpecsFormat ? { componentSpecsFormat: config.componentSpecsFormat } : {}),
    ...(config?.include ? { include: config.include } : {}),
    ...(config?.dtcg ? { dtcg: config.dtcg } : {}),
    ...(config?.platforms ? { platforms: config.platforms } : {}),
    ...(config?.outputs ? { outputs: config.outputs } : {}),
    ...(storedKeyFor ? { storedKeyFor } : {}),
  };
}
