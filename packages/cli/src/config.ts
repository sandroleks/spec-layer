import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Selection } from './selection';

export const DEFAULT_API = 'https://api.spec-layer.com';
export const DEFAULT_OUT_DIR = '.speclayer';
const CONFIG_NAME = 'speclayer.json';

export interface CliConfig { libraryId?: string; outDir?: string; include?: Selection }

const invalidConfig = () => new Error(`${CONFIG_NAME} is not valid JSON. Fix or delete it, then retry.`);

/** `include` narrows what pull writes. Missing fields take the default (everything). */
function parseInclude(value: unknown): Selection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalidConfig();
  const record = value as Record<string, unknown>;
  if (record.foundation !== undefined && typeof record.foundation !== 'boolean') throw invalidConfig();
  if (record.components !== undefined
    && !(Array.isArray(record.components) && record.components.every((c) => typeof c === 'string'))) {
    throw invalidConfig();
  }
  return {
    foundation: record.foundation === undefined ? true : record.foundation,
    components: record.components === undefined ? null : record.components as string[],
  };
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
    ...(record.include !== undefined ? { include: parseInclude(record.include) } : {}),
  };
}

export function writeConfig(
  cwd: string, config: { libraryId: string; outDir: string; include?: Selection },
): void {
  const body = {
    libraryId: config.libraryId,
    outDir: config.outDir,
    ...(config.include ? { include: config.include } : {}),
  };
  writeFileSync(join(cwd, CONFIG_NAME), `${JSON.stringify(body, null, 2)}\n`);
}

export interface ResolvedOptions {
  libraryId: string | null; outDir: string; api: string; key: string | null;
  /** The config's include block, when it has one, for pull to fall back on. */
  include?: Selection;
}

export function resolveOptions(
  cwd: string,
  flags: { id?: string; out?: string; key?: string; api?: string },
  env: Record<string, string | undefined>,
  manifestLibraryId: (outDir: string) => string | null,
): ResolvedOptions {
  const config = readConfig(cwd);
  const outDir = flags.out ?? config?.outDir ?? DEFAULT_OUT_DIR;
  const libraryId = flags.id ?? config?.libraryId ?? manifestLibraryId(join(cwd, outDir));
  return {
    libraryId,
    outDir,
    // A trailing slash would build "//v1/..." paths the proxy router 404s on.
    api: (flags.api ?? env.SPEC_LAYER_API ?? DEFAULT_API).replace(/\/+$/, ''),
    key: flags.key ?? env.SPEC_LAYER_KEY ?? null,
    ...(config?.include ? { include: config.include } : {}),
  };
}
