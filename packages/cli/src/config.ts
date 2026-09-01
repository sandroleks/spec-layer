import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_API = 'https://api.spec-layer.com';
export const DEFAULT_OUT_DIR = '.speclayer';
const CONFIG_NAME = 'speclayer.json';

export interface CliConfig { libraryId?: string; outDir?: string }

export function readConfig(cwd: string): CliConfig | null {
  const path = join(cwd, CONFIG_NAME);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch {
    throw new Error(`${CONFIG_NAME} is not valid JSON. Fix or delete it, then retry.`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${CONFIG_NAME} is not valid JSON. Fix or delete it, then retry.`);
  }
  const record = parsed as Record<string, unknown>;
  return {
    ...(typeof record.libraryId === 'string' ? { libraryId: record.libraryId } : {}),
    ...(typeof record.outDir === 'string' ? { outDir: record.outDir } : {}),
  };
}

export function writeConfig(cwd: string, config: { libraryId: string; outDir: string }): void {
  writeFileSync(join(cwd, CONFIG_NAME), `${JSON.stringify(config, null, 2)}\n`);
}

export interface ResolvedOptions { libraryId: string | null; outDir: string; api: string; key: string | null }

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
    api: flags.api ?? env.SPEC_LAYER_API ?? DEFAULT_API,
    key: flags.key ?? env.SPEC_LAYER_KEY ?? null,
  };
}
