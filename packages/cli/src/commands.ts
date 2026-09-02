import { join } from 'node:path';
import { parseBundle, type BundleV1 } from './bundle';
import { readConfig, resolveOptions, writeConfig, DEFAULT_OUT_DIR, type ResolvedOptions } from './config';
import { fetchBundle } from './api';
import { readLocalBundle, readManifest, slugify, writeBundleFiles, type Manifest } from './files';
import {
  DEFAULT_SELECTION, matchesName, resolveSelection, selectComponents, selectionFromFlags, type Selection,
} from './selection';
import { CREDENTIALS_NAME, writeCredentials } from './credentials';
import { ensureIgnored } from './gitignore';

export type Flags = {
  id?: string; out?: string; key?: string; api?: string;
  only?: string; component?: string[]; canonical?: boolean;
};
/** out/err add a newline per line; write emits exactly the given text, for piped output. */
export type Io = { out(line: string): void; err(line: string): void; write(text: string): void };

const NO_LOCAL_PULL = 'No local pull found. Run spec-layer pull.';

/** One manifest read per command, shared by the id fallback and the freshness check. */
function manifestReader(): (outDir: string) => Manifest | null {
  const cache = new Map<string, Manifest | null>();
  return (outDir) => {
    if (!cache.has(outDir)) cache.set(outDir, readManifest(outDir));
    return cache.get(outDir) ?? null;
  };
}

/** Two selections name the same files when they agree on the foundation and the component slugs. */
function sameSelection(a: Selection, b: Selection): boolean {
  const key = (s: Selection) => JSON.stringify([s.foundation, s.components === null ? null : [...new Set(s.components.map(slugify))].sort()]);
  return key(a) === key(b);
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function runInit(cwd: string, flags: Flags, io: Io): number {
  if (!flags.id) {
    io.err('spec-layer init needs --id lib_... (shown in the plugin after publishing).');
    return 1;
  }
  let include: Selection | null;
  try {
    include = selectionFromFlags(flags);
  } catch (err) {
    io.err(errorText(err));
    return 1;
  }
  const outDir = flags.out ?? DEFAULT_OUT_DIR;
  writeConfig(cwd, { libraryId: flags.id, outDir, ...(include ? { include } : {}) });
  io.out(`Wrote speclayer.json (library ${flags.id}, output ${outDir}).`);
  io.out(`The pull key is not stored here. Run spec-layer setup to store it in ${CREDENTIALS_NAME}, or set SPEC_LAYER_KEY.`);
  return 0;
}

/** Shared option gate for pull and status. */
function resolved(
  cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io,
  manifestAt: (outDir: string) => Manifest | null,
): (ResolvedOptions & { libraryId: string; key: string }) | null {
  let opts: ResolvedOptions;
  try {
    opts = resolveOptions(cwd, flags, env, (outDir) => manifestAt(outDir)?.libraryId ?? null);
  } catch (err) {
    // resolveOptions reads speclayer.json via readConfig, which throws on
    // corrupt JSON. Surface the message as plain text rather than letting it
    // escape uncaught up through cli.ts.
    io.err(errorText(err));
    return null;
  }
  if (!opts.libraryId) {
    io.err('No library id. Pass --id lib_..., or run spec-layer init first.');
    return null;
  }
  if (!opts.key) {
    io.err(opts.storedKeyFor
      ? `The key in ${CREDENTIALS_NAME} was issued for library ${opts.storedKeyFor}, not `
        + `${opts.libraryId}. Run the setup command from the plugin's Library screen.`
      : 'No pull key. Run the setup command from the plugin\'s Library screen, '
        + 'or set SPEC_LAYER_KEY.');
    return null;
  }
  return opts as typeof opts & { libraryId: string; key: string };
}

/** Output directory for the local-only commands, which need neither id nor key. */
function resolvedOutDir(cwd: string, flags: Flags, io: Io): string | null {
  try {
    return join(cwd, flags.out ?? readConfig(cwd)?.outDir ?? DEFAULT_OUT_DIR);
  } catch (err) {
    io.err(errorText(err));
    return null;
  }
}

/** "foundation + 2 of 14 components", "14 components, no foundation", and so on. */
function describePull(bundle: BundleV1, selection: Selection, selected: boolean[]): string {
  const total = bundle.components.length;
  const count = selected.filter(Boolean).length;
  const components = count === total
    ? `${total} component${total === 1 ? '' : 's'}`
    : `${count} of ${total} components`;
  if (!bundle.foundation) return components;
  return selection.foundation ? `foundation + ${components}` : `${components}, no foundation`;
}

/**
 * First run in a repo: config, gitignore, key, pull.
 *
 * The order is load-bearing. speclayer.json first because it holds no secret
 * and leaves the repo configured even when a later step refuses. The gitignore
 * entry before the key, so the secret is ignored before it exists. The pull
 * last, so a network failure still leaves a usable setup that a bare
 * `spec-layer pull` retries.
 */
export async function runSetup(
  cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io, fetcher?: typeof fetch,
): Promise<number> {
  if (!flags.id) {
    io.err('spec-layer setup needs --id lib_... (shown in the plugin after publishing).');
    return 1;
  }
  const key = flags.key ?? env.SPEC_LAYER_KEY;
  if (!key) {
    io.err('spec-layer setup needs --key sl_..., or SPEC_LAYER_KEY in the environment.');
    return 1;
  }
  let include: Selection | null;
  try {
    include = selectionFromFlags(flags);
  } catch (err) {
    io.err(errorText(err));
    return 1;
  }

  const outDir = flags.out ?? DEFAULT_OUT_DIR;
  writeConfig(cwd, { libraryId: flags.id, outDir, ...(include ? { include } : {}) });
  io.out(`Wrote speclayer.json (library ${flags.id}, output ${outDir}).`);

  const ignored = ensureIgnored(cwd, CREDENTIALS_NAME);
  switch (ignored.kind) {
    case 'refused':
      io.err(`Could not add ${CREDENTIALS_NAME} to .gitignore, so the key was not written.`);
      io.err(`Add this line to .gitignore, then run the command again:\n${ignored.line}`);
      return 1;
    case 'no-git':
      io.err(`Could not run git, so it could not confirm ${CREDENTIALS_NAME} would be ignored. The key was not written.`);
      io.err(`Add this line to .gitignore, then run the command again:\n${ignored.line}`);
      return 1;
    case 'created':
      io.out(`Created .gitignore with ${CREDENTIALS_NAME}.`);
      break;
    case 'added':
      io.out(`Added ${CREDENTIALS_NAME} to .gitignore.`);
      break;
    case 'already':
      io.out(`${CREDENTIALS_NAME} is already ignored by git.`);
      break;
    case 'not-a-repo':
      io.out('Not a git repository, so .gitignore was left alone.');
      break;
    default: {
      const exhaustive: never = ignored;
      return exhaustive;
    }
  }

  const { replaced } = writeCredentials(cwd, { libraryId: flags.id, key });
  io.out(replaced
    ? `Replaced the stored key in ${CREDENTIALS_NAME}.`
    : `Stored the pull key in ${CREDENTIALS_NAME}.`);

  // Pass the key through rather than relying on a re-read of what was just
  // written, so the pull cannot disagree with the file.
  return runPull(cwd, { ...flags, key }, env, io, fetcher);
}

export async function runPull(
  cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io, fetcher?: typeof fetch,
): Promise<number> {
  const manifestAt = manifestReader();
  const opts = resolved(cwd, flags, env, io, manifestAt);
  if (!opts) return 1;
  let selection: Selection;
  try {
    selection = resolveSelection(flags, opts);
  } catch (err) {
    io.err(errorText(err));
    return 1;
  }
  // Ask for a 304 only when the last pull wrote the same files this one would;
  // a changed selection needs the bundle again to re-project the ai/ directory.
  const manifest = manifestAt(join(cwd, opts.outDir));
  const etag = manifest && sameSelection(manifest.selection ?? DEFAULT_SELECTION, selection)
    ? manifest.bundleHash
    : undefined;
  const result = await fetchBundle({
    api: opts.api, libraryId: opts.libraryId, key: opts.key,
    ...(etag ? { etag } : {}), ...(fetcher ? { fetcher } : {}),
  });
  if (result.kind === 'error') {
    io.err(result.message);
    return 1;
  }
  if (result.kind === 'not_modified') {
    io.out(`Already up to date (published ${manifest?.publishedAt ?? 'unknown'}).`);
    return 0;
  }
  let written: string[];
  try {
    const bundle = parseBundle(result.raw);
    const selected = selectComponents(bundle, selection);
    written = writeBundleFiles({
      outDir: join(cwd, opts.outDir), cwd, raw: result.raw, bundle, selection,
      libraryId: opts.libraryId, publishedAt: result.publishedAt, bundleHash: result.bundleHash,
    });
    io.out(
      `Pulled ${bundle.fileName ?? opts.libraryId}: ${describePull(bundle, selection, selected)} ` +
      `(published ${result.publishedAt}).`,
    );
  } catch (err) {
    io.err(errorText(err));
    return 1;
  }
  io.out(`Wrote ${written.length} files under ${opts.outDir}/.`);
  return 0;
}

export async function runStatus(
  cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io, fetcher?: typeof fetch,
): Promise<number> {
  const manifestAt = manifestReader();
  const opts = resolved(cwd, flags, env, io, manifestAt);
  if (!opts) return 1;
  const manifest = manifestAt(join(cwd, opts.outDir));
  if (!manifest) {
    io.err(NO_LOCAL_PULL);
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

export function runList(cwd: string, flags: Flags, io: Io): number {
  const outDir = resolvedOutDir(cwd, flags, io);
  if (!outDir) return 1;
  const manifest = readManifest(outDir);
  if (!manifest) {
    io.err(NO_LOCAL_PULL);
    return 1;
  }
  io.out(`Library ${manifest.libraryId}, published ${manifest.publishedAt}.`);
  const rows = manifest.artifacts.map((a) => [a.kind, a.name, a.aiPath ?? 'not written', a.contentHash]);
  const widths = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i].length)));
  for (const row of rows) {
    io.out(row.map((cell, i) => (i < 3 ? cell.padEnd(widths[i]) : cell)).join('  '));
  }
  return 0;
}

const SHOW_USAGE = 'spec-layer show takes "foundation" or "component NAME".';

export function runShow(cwd: string, flags: Flags, args: string[], io: Io): number {
  const [target, name] = args;
  const wantsFoundation = target === 'foundation' && name === undefined;
  const wantsComponent = target === 'component' && typeof name === 'string';
  if (!wantsFoundation && !wantsComponent) {
    io.err(SHOW_USAGE);
    return 1;
  }
  const outDir = resolvedOutDir(cwd, flags, io);
  if (!outDir) return 1;
  let bundle: BundleV1 | null;
  try {
    bundle = readLocalBundle(outDir);
  } catch (err) {
    io.err(errorText(err));
    return 1;
  }
  if (!bundle) {
    io.err(NO_LOCAL_PULL);
    return 1;
  }
  let entry: { ai: string; artifact: unknown };
  if (wantsFoundation) {
    if (!bundle.foundation) {
      io.err('This library has no Foundation. Run spec-layer list to see what it holds.');
      return 1;
    }
    entry = bundle.foundation;
  } else {
    const matches = bundle.components.filter((c) => matchesName(name, c.name));
    if (matches.length === 0) {
      const available = bundle.components.map((c) => c.name).join(', ');
      io.err(`No component named "${name}" in this library.\nAvailable: ${available || 'none'}.`);
      return 1;
    }
    if (matches.length > 1) {
      io.err(`"${name}" matches ${matches.length} components. Run spec-layer list to see them, then rename one in Figma to tell them apart.`);
      return 1;
    }
    entry = matches[0];
  }
  io.write(flags.canonical ? `${JSON.stringify(entry.artifact, null, 2)}\n` : entry.ai);
  return 0;
}
