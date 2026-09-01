import { join } from 'node:path';
import { parseBundle } from './bundle';
import { resolveOptions, writeConfig, DEFAULT_OUT_DIR, type ResolvedOptions } from './config';
import { fetchBundle } from './api';
import { readManifest, writeBundleFiles } from './files';

export type Flags = { id?: string; out?: string; key?: string; api?: string };
export type Io = { out(line: string): void; err(line: string): void };

const manifestLibraryId = (outDir: string): string | null => readManifest(outDir)?.libraryId ?? null;

export function runInit(cwd: string, flags: Flags, io: Io): number {
  if (!flags.id) {
    io.err('spec-layer init needs --id lib_... (shown in the plugin after publishing).');
    return 1;
  }
  const outDir = flags.out ?? DEFAULT_OUT_DIR;
  writeConfig(cwd, { libraryId: flags.id, outDir });
  io.out(`Wrote speclayer.json (library ${flags.id}, output ${outDir}).`);
  io.out('The pull key is never stored here. Set SPEC_LAYER_KEY in your environment or pass --key.');
  return 0;
}

/** Shared option gate for pull and status. */
function resolved(
  cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io,
): (ResolvedOptions & { libraryId: string; key: string }) | null {
  const opts = resolveOptions(cwd, flags, env, manifestLibraryId);
  if (!opts.libraryId) {
    io.err('No library id. Pass --id lib_..., or run spec-layer init first.');
    return null;
  }
  if (!opts.key) {
    io.err('No pull key. Set SPEC_LAYER_KEY or pass --key.');
    return null;
  }
  return opts as typeof opts & { libraryId: string; key: string };
}

export async function runPull(
  cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io, fetcher?: typeof fetch,
): Promise<number> {
  const opts = resolved(cwd, flags, env, io);
  if (!opts) return 1;
  const result = await fetchBundle({
    api: opts.api, libraryId: opts.libraryId, key: opts.key, ...(fetcher ? { fetcher } : {}),
  });
  if (result.kind === 'error') {
    io.err(result.message);
    return 1;
  }
  if (result.kind === 'not_modified') {
    // Unreachable in practice: a bare pull never sends an etag. Kept honest rather
    // than assuming fetchBundle can't return this shape here.
    io.out('Already up to date.');
    return 0;
  }
  let written: string[];
  try {
    const bundle = parseBundle(result.raw);
    written = writeBundleFiles({
      outDir: join(cwd, opts.outDir), raw: result.raw, bundle,
      libraryId: opts.libraryId, publishedAt: result.publishedAt, bundleHash: result.bundleHash,
    });
    const components = bundle.components.length;
    io.out(
      `Pulled ${bundle.fileName ?? opts.libraryId}: ${bundle.foundation ? 'foundation + ' : ''}` +
      `${components} component${components === 1 ? '' : 's'} (published ${result.publishedAt}).`,
    );
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 1;
  }
  io.out(`Wrote ${written.length} files under ${opts.outDir}/.`);
  return 0;
}

export async function runStatus(
  cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io, fetcher?: typeof fetch,
): Promise<number> {
  const opts = resolved(cwd, flags, env, io);
  if (!opts) return 1;
  const manifest = readManifest(join(cwd, opts.outDir));
  if (!manifest) {
    io.err('No local pull found. Run spec-layer pull.');
    return 2;
  }
  const result = await fetchBundle({
    api: opts.api, libraryId: opts.libraryId, key: opts.key, etag: manifest.bundleHash,
    ...(fetcher ? { fetcher } : {}),
  });
  if (result.kind === 'error') {
    io.err(result.message);
    return 1;
  }
  if (result.kind === 'not_modified') {
    io.out(`Up to date (published ${manifest.publishedAt}).`);
    return 0;
  }
  io.out(`Behind: remote published ${result.publishedAt}. Run spec-layer pull.`);
  return 2;
}
