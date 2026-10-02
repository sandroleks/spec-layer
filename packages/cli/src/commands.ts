import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { canonicalJson, type DtcgOptions } from '@spec-layer/extractor';
import { parseBundle, type BundleV1 } from './bundle';
import {
  readConfig, resolveOptions, resolveOutDir, legacyOutDir, writeConfig, DEFAULT_COMPONENT_SPECS_DIR, DEFAULT_COMPONENT_FORMAT,
  COMPONENT_FORMATS, isComponentFormat, isLibraryId, type CliConfig, type ComponentFormat, type ResolvedOptions,
} from './config';
import { fetchBundleWithRetry, retriesFromEnv } from './api';
import { componentMarkdownPage, readLocalBundle, readManifest, slugify, writeBundleFiles, type Manifest } from './files';
import {
  DEFAULT_SELECTION, matchesName, resolveSelection, selectComponents, selectionFromFlags, type Selection,
} from './selection';
import { CREDENTIALS_NAME, writeCredentials } from './credentials';
import { ensureIgnored } from './gitignore';
import {
  detectRepo, isAgentHost, isPlatform, missingFontSourcesInRepo, AGENT_HOSTS, PLATFORMS, type AgentHost, type Platform,
} from './detect';
import { buildSkillGuide, installSkill, installTarget, summarizePull, type SkillInput } from './skill';
import {
  FORMATS, defaultOutputs, outputId, readIndexImports, withDefaults, type OutputConfig,
} from './outputs';
import { toolsJson, toolsText } from './tools';
import { cliVersion } from './version';

export type Flags = {
  id?: string; out?: string; key?: string; api?: string;
  only?: string; component?: string[]; canonical?: boolean;
  json?: boolean; install?: boolean; agent?: string[]; platform?: string[];
  /** setup, init, pull, show: how component-specs/ is written or printed. */
  'component-format'?: string;
  /** pull only: exit 1 when an output report holds an error-severity entry. */
  strict?: boolean;
};
/** out/err add a newline per line; write emits exactly the given text, for piped output. */
export type Io = { out(line: string): void; err(line: string): void; write(text: string): void };

const NO_LOCAL_PULL = 'No local pull found. Run spec-layer pull.';

/** What a command adds to its --json object beyond the exit code and lines. */
type JsonReport = Record<string, unknown>;

/**
 * Runs a command; with --json, stdout carries exactly one JSON object:
 * `{ command, exitCode, ...report, stdout, stderr }`. The human lines the
 * command would have printed to stdout go into `stdout` instead; stderr lines
 * (errors, warnings, notes) still reach stderr and are copied into `stderr`.
 * Exit codes do not change.
 */
function jsonCapture(io: Io): { captured: Io; finish(command: string, exitCode: number, report: JsonReport): number } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    captured: {
      out: (line) => stdout.push(line),
      err: (line) => { stderr.push(line); io.err(line); },
      write: (text) => stdout.push(text),
    },
    finish(command, exitCode, report) {
      io.write(`${JSON.stringify({ command, exitCode, ...report, stdout, stderr }, null, 2)}\n`);
      return exitCode;
    },
  };
}

async function withJson(
  command: string, flags: Flags, io: Io, run: (io: Io, report: JsonReport) => Promise<number>,
): Promise<number> {
  if (!flags.json) return run(io, {});
  const { captured, finish } = jsonCapture(io);
  const report: JsonReport = {};
  return finish(command, await run(captured, report), report);
}

/** withJson for a command that never awaits, so it stays synchronous. */
function withJsonSync(command: string, flags: Flags, io: Io, run: (io: Io, report: JsonReport) => number): number {
  if (!flags.json) return run(io, {});
  const { captured, finish } = jsonCapture(io);
  const report: JsonReport = {};
  return finish(command, run(captured, report), report);
}

/** The plugin never shows `md`; neither does the pull summary. */
const FORMAT_NAME: Record<ComponentFormat, string> = { yaml: 'YAML', md: 'Markdown' };

/** One manifest read per command, shared by the id fallback and the freshness check. */
function manifestReader(): (outDir: string) => Manifest | null {
  const cache = new Map<string, Manifest | null>();
  return (outDir) => {
    if (!cache.has(outDir)) cache.set(outDir, readManifest(outDir));
    return cache.get(outDir) ?? null;
  };
}

/** Two pulls write the same files when they agree on all of these. */
function sameOutput(
  a: { selection: Selection; dtcg?: DtcgOptions; outputs?: OutputConfig[]; componentSpecsDir?: string; componentSpecsFormat?: ComponentFormat },
  b: { selection: Selection; dtcg?: DtcgOptions; outputs?: OutputConfig[]; componentSpecsDir?: string; componentSpecsFormat?: ComponentFormat },
): boolean {
  const selectionKey = (s: Selection) =>
    JSON.stringify([s.foundation, s.components === null ? null : [...new Set(s.components.map(slugify))].sort()]);
  const key = (v: unknown) => canonicalJson(v ?? {});
  return selectionKey(a.selection) === selectionKey(b.selection)
    && key(a.dtcg) === key(b.dtcg) && key(a.outputs ?? []) === key(b.outputs ?? [])
    && (a.componentSpecsDir ?? DEFAULT_COMPONENT_SPECS_DIR) === (b.componentSpecsDir ?? DEFAULT_COMPONENT_SPECS_DIR)
    && (a.componentSpecsFormat ?? DEFAULT_COMPONENT_FORMAT) === (b.componentSpecsFormat ?? DEFAULT_COMPONENT_FORMAT);
}

/** --platform values as platforms, or null after printing the usage error. */
function platformsFromFlags(flags: Flags, io: Io): Platform[] | null | undefined {
  if (flags.platform === undefined || flags.platform.length === 0) return undefined;
  const out: Platform[] = [];
  for (const value of flags.platform) {
    if (!isPlatform(value)) {
      io.err(`--platform takes ${PLATFORMS.join(', ')}, not "${value}".`);
      return null;
    }
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/** --component-format as a format, undefined when absent, or null after printing the usage error. */
function componentFormatFromFlags(flags: Flags, io: Io): ComponentFormat | null | undefined {
  const value = flags['component-format'];
  if (value === undefined) return undefined;
  if (isComponentFormat(value)) return value;
  io.err(`--component-format takes ${COMPONENT_FORMATS.join(' or ')}, not "${value}".`);
  return null;
}

type PlatformSource = 'flag' | 'config' | 'detected' | 'none';

/** Flags, then speclayer.json, then the repository root. */
function resolvePlatforms(
  cwd: string, fromFlags: Platform[] | undefined, config: { platforms?: Platform[] } | null,
): { platforms: Platform[]; source: PlatformSource } {
  if (fromFlags) return { platforms: fromFlags, source: 'flag' };
  if (config?.platforms && config.platforms.length > 0) return { platforms: config.platforms, source: 'config' };
  const detected = detectRepo(cwd).platforms;
  return { platforms: detected, source: detected.length > 0 ? 'detected' : 'none' };
}

/** The outputs one pull writes: the config's list, or defaults for the platforms, plus defaults for platforms named by flag. */
function outputsForRun(
  fromFlags: Platform[] | undefined, config: { outputs?: OutputConfig[] } | null, platforms: Platform[],
): OutputConfig[] {
  if (fromFlags) return withDefaults(config?.outputs ?? [], fromFlags);
  return config?.outputs ?? defaultOutputs(platforms);
}

const NO_PLATFORM_NOTE = `No target platform detected, so no token files were written for your code. Pass --platform ${PLATFORMS.join('|')}, or add outputs to speclayer.json.`;

/** Platforms this run named or configured that have no registered output format (only web/css exists today). */
function platformsMissingFormat(platforms: Platform[]): Platform[] {
  return platforms.filter((p) => !FORMATS.some((f) => f.platform === p));
}

/**
 * A missing format is a capability gap, so it is named. Callers use it only for
 * a platform named by flag or config, never one merely detected.
 */
function missingFormatNote(platforms: Platform[]): string {
  return `No token files exist yet for ${platforms.join(', ')}: no output format is available for that platform. Web has css.`;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Never echoes the value: a swapped --id and --key would put the pull key in scrollback or a CI log. */
const badLibraryId = (id: string): string =>
  '--id must be "lib_" followed by 24 hex characters, as the plugin shows it.'
  + (id.startsWith('sl_') ? ' That looks like the pull key; pass it with --key.' : '');

export function runInit(cwd: string, flags: Flags, io: Io): number {
  if (!flags.id) {
    io.err('spec-layer init needs --id lib_... (shown in the plugin after publishing).');
    return 1;
  }
  if (!isLibraryId(flags.id)) {
    io.err(badLibraryId(flags.id));
    return 1;
  }
  let include: Selection | null;
  try {
    include = selectionFromFlags(flags);
  } catch (err) {
    io.err(errorText(err));
    return 1;
  }
  const fromFlags = platformsFromFlags(flags, io);
  if (fromFlags === null) return 1;
  const format = componentFormatFromFlags(flags, io);
  if (format === null) return 1;
  const { platforms, source } = resolvePlatforms(cwd, fromFlags, null);
  const outputs = defaultOutputs(platforms);
  let outDir: string;
  try {
    outDir = resolveOutDir(cwd, flags.out, undefined);
  } catch (err) {
    io.err(errorText(err));
    return 1;
  }
  writeConfig(cwd, {
    libraryId: flags.id, outDir, componentSpecsDir: DEFAULT_COMPONENT_SPECS_DIR,
    ...(format ? { componentSpecsFormat: format } : {}),
    ...(include ? { include } : {}),
    ...(platforms.length > 0 ? { platforms } : {}), ...(outputs.length > 0 ? { outputs } : {}),
  });
  io.out(`Wrote speclayer.json (library ${flags.id}, output ${outDir}${platforms.length > 0 ? `, platforms ${platforms.join(', ')}` : ''}).`);
  for (const o of outputs) io.out(`Token files for ${o.platform}: ${o.path}/ (${o.format}, ${o.case} names), written by the next pull.`);
  // init passes no config, so only flag and detected platforms occur here.
  if (source === 'flag' || source === 'detected') {
    const missing = platformsMissingFormat(platforms);
    if (missing.length > 0) io.out(missingFormatNote(missing));
  }
  io.out(`The pull key is not stored here. Run spec-layer setup to store it in ${CREDENTIALS_NAME}, or set SPEC_LAYER_KEY.`);
  return 0;
}

/** Shared option gate for pull and status. */
function resolved(
  cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io,
  manifestAt: (outDir: string) => Manifest | null,
): (ResolvedOptions & { libraryId: string; key: string }) | null {
  // Shape-check a flag --id before any message names it or any request carries
  // it, so a pull key pasted as --id is never printed or sent in a URL. An id
  // from speclayer.json is not checked, so a config earlier versions accepted
  // keeps working.
  if (flags.id !== undefined && !isLibraryId(flags.id)) {
    io.err(badLibraryId(flags.id));
    return null;
  }
  let opts: ResolvedOptions;
  try {
    opts = resolveOptions(cwd, flags, env, (outDir) => manifestAt(outDir)?.libraryId ?? null);
  } catch (err) {
    // readConfig throws on corrupt JSON.
    io.err(errorText(err));
    return null;
  }
  if (!opts.libraryId) {
    // A stored key names its library, which is the id the reader needs.
    io.err(opts.storedKeyFor
      ? `No library id. ${CREDENTIALS_NAME} holds a key for library ${opts.storedKeyFor}. `
        + `Pass --id ${opts.storedKeyFor}, or run spec-layer init first.`
      : 'No library id. Pass --id lib_..., or run spec-layer init first.');
    return null;
  }
  if (!opts.key) {
    io.err(opts.storedKeyFor
      ? `The key in ${CREDENTIALS_NAME} was issued for library ${opts.storedKeyFor}, not `
        + `${opts.libraryId}. Run the setup command from the plugin's Publish screen.`
      : 'No pull key. Run the setup command from the plugin\'s Publish screen, '
        + 'or set SPEC_LAYER_KEY.');
    return null;
  }
  return opts as typeof opts & { libraryId: string; key: string };
}

/** Output directory for the local-only commands, which need neither id nor key. */
function resolvedOutDir(cwd: string, flags: Flags, io: Io): string | null {
  try {
    return join(cwd, resolveOutDir(cwd, flags.out, readConfig(cwd)?.outDir));
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
 * First run in a repo: config, gitignore, key, pull. The order is load-bearing:
 * speclayer.json first (no secret, and configured even if a later step refuses),
 * the gitignore entry before the key so the secret is ignored before it exists,
 * the pull last so a network failure leaves a setup `spec-layer pull` retries.
 */
export async function runSetup(
  cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io, fetcher?: typeof fetch,
): Promise<number> {
  if (!flags.id) {
    io.err('spec-layer setup needs --id lib_... (shown in the plugin after publishing).');
    return 1;
  }
  if (!isLibraryId(flags.id)) {
    io.err(badLibraryId(flags.id));
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

  // Unlike `init`, `setup` defaults from the committed config instead of
  // overwriting it: setup is also the rotation path, and the plugin's command
  // carries neither --out nor a selection, so re-pasting it must not reset them.
  // That is why the two blocks are not shared. A corrupt speclayer.json has
  // nothing to preserve, and setup overwriting it is the repair path.
  let existing: CliConfig | null;
  try { existing = readConfig(cwd); } catch { existing = null; }
  const fromFlags = platformsFromFlags(flags, io);
  if (fromFlags === null) return 1;
  const format = componentFormatFromFlags(flags, io);
  if (format === null) return 1;
  // 0.10.0 and earlier joined an absolute --out under the working directory.
  // With no --out, setup records that relative path, where the files already
  // are. This is the only stored value any command rewrites on its own.
  let configOutDir = existing?.outDir;
  let legacyFrom: string | null = null;
  if (flags.out === undefined && configOutDir !== undefined) {
    const legacy = legacyOutDir(cwd, configOutDir);
    if (legacy !== null) {
      legacyFrom = configOutDir;
      configOutDir = legacy;
    }
  }
  let outDir: string;
  try {
    outDir = resolveOutDir(cwd, flags.out, configOutDir);
  } catch (err) {
    io.err(errorText(err));
    return 1;
  }
  const componentSpecsDir = existing?.componentSpecsDir ?? DEFAULT_COMPONENT_SPECS_DIR;
  const keptInclude = include ?? existing?.include ?? null;
  const keptDtcg = existing?.dtcg ?? null;
  const keptFormat = format ?? existing?.componentSpecsFormat ?? null;
  // Platforms: a flag, else the committed config, else detection. Outputs keep
  // every configured entry and gain a default for any platform without one.
  const { platforms } = resolvePlatforms(cwd, fromFlags, existing);
  const outputs = withDefaults(existing?.outputs ?? [], platforms);
  writeConfig(cwd, {
    libraryId: flags.id, outDir, componentSpecsDir,
    ...(keptFormat ? { componentSpecsFormat: keptFormat } : {}),
    ...(keptInclude ? { include: keptInclude } : {}),
    ...(keptDtcg ? { dtcg: keptDtcg } : {}),
    ...(platforms.length > 0 ? { platforms } : {}),
    ...(existing?.outputs !== undefined || outputs.length > 0 ? { outputs } : {}),
  });
  io.out(`Wrote speclayer.json (library ${flags.id}, output ${outDir}${platforms.length > 0 ? `, platforms ${platforms.join(', ')}` : ''}).`);
  if (legacyFrom !== null) {
    io.out(`speclayer.json "outDir" was ${JSON.stringify(legacyFrom)}, which earlier versions wrote to ${outDir} inside this directory. It now reads "${outDir}", so the files stay where they are.`);
  }

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
    case 'still-not-ignored':
      io.err(`${ignored.line} is listed in .gitignore, but git still does not ignore it, so the key was not written.`);
      io.err(ignored.tracked
        ? `git confirms ${ignored.line} is already tracked, which is why the ignore rule has no effect. Run this, then run the command again:\ngit rm --cached ${ignored.line}`
        : `git does not report ${ignored.line} as tracked either. Look for a rule that re-includes it (a line starting with "!") in .gitignore or the global excludes file, remove it, then run the command again.`);
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
      // Exhaustiveness only: returning `exhaustive` would set a non-number exit code.
      const exhaustive: never = ignored;
      void exhaustive;
      return 1;
    }
  }

  const { replaced } = writeCredentials(cwd, { libraryId: flags.id, key });
  io.out(replaced
    ? `Replaced the stored key in ${CREDENTIALS_NAME}.`
    : `Stored the pull key in ${CREDENTIALS_NAME}.`);

  // Pass the key through so the pull cannot disagree with the file.
  const outcome: PullOutcome = { retryable: false };
  const code = await pullWith(cwd, { ...flags, key }, env, io, fetcher, outcome);
  if (code !== 0) {
    // Only when a bare retry can help: after a 401, 404, refused directory, or
    // --strict report, the line above already says what to change.
    if (outcome.retryable) io.err('Setup is stored. Run spec-layer pull to retry.');
    return code;
  }
  // Setup is often a coding agent's first sight of this tool, so point it at the guide.
  const hosts = detectRepo(cwd).agents;
  io.out('');
  io.out('Next step for a coding agent: npx spec-layer skill --install');
  io.out(hosts.length > 0
    ? `That writes a guide to the pulled files, adapted to this codebase, to ${hosts.map((h) => installTarget(h).path).join(', ')}.`
    : `That writes a guide to the pulled files, adapted to this codebase, into ${installTarget('agents-md').path}; --agent ${AGENT_HOSTS.join('|')} chooses where.`);
  io.out('spec-layer skill prints the same guide; spec-layer tools lists every command.');
  return 0;
}

/**
 * Whether every file this output wrote is still on disk. Part files come from
 * index.css's imports, not the map: a map entry names only the file that first
 * declares a token, so a non-default mode file never appears in it. The report
 * is checked because a 304 pass and --strict read it.
 */
function outputFilesOnDisk(cwd: string, outDir: string, o: OutputConfig): boolean {
  const id = outputId(o);
  for (const rel of [`${id}.map.json`, `${id}.report.json`]) {
    if (!existsSync(join(cwd, outDir, 'outputs', rel))) return false;
  }
  const imports = readIndexImports(cwd, o);
  return imports !== null && imports.every((f) => existsSync(resolve(cwd, o.path, f)));
}

/**
 * Whether the Foundation files outside `outputs/` are still on disk: the report
 * and fonts.json that a 304 pass and the skill read, and resolver.json standing
 * in for the token files.
 */
function foundationFilesOnDisk(cwd: string, outDir: string): boolean {
  return ['fonts.json', join('tokens', 'report.json'), join('tokens', 'resolver.json')]
    .every((rel) => existsSync(join(cwd, outDir, rel)));
}

/** A JSON array from disk, or `[]` when missing, unreadable, or not an array. Never throws. */
function readJsonArray(path: string): unknown[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Every entry's severity in a report file; `[]` when missing or unreadable. */
function readReportSeverities(path: string): Array<'error' | 'warning' | 'info'> {
  return readJsonArray(path)
    .map((entry) => (entry as { severity?: unknown }).severity)
    .filter((s): s is 'error' | 'warning' | 'info' => s === 'error' || s === 'warning' || s === 'info');
}

/** Family names from fonts.json; none when it was not written or cannot be read. */
function readFontFamilies(cwd: string, outDir: string): string[] {
  return readJsonArray(join(cwd, outDir, 'fonts.json'))
    .map((entry) => (entry as { family?: unknown }).family)
    .filter((f): f is string => typeof f === 'string');
}

/** "1 error" / "2 errors". */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Prints the severity summary and missing-font notes for what is on disk after
 * a 200 or a 304 (granted only when the reports and fonts.json are present).
 * Reads by the configured outputs and outDir, never writeBundleFiles' result,
 * because a cached pull with an error report is what --strict exists to catch.
 * Reads `tokens/report.json` and each `outputs/<platform>-<format>.report.json`.
 * Returns the error count.
 */
function printReportSummary(cwd: string, outDir: string, outputs: OutputConfig[], io: Io): number {
  const reportPaths: string[] = [];
  let errors = 0;
  let warnings = 0;
  const add = (severities: Array<'error' | 'warning' | 'info'>, path: string) => {
    if (severities.length === 0) return;
    errors += severities.filter((s) => s === 'error').length;
    warnings += severities.filter((s) => s === 'warning').length;
    reportPaths.push(path);
  };
  add(readReportSeverities(join(cwd, outDir, 'tokens', 'report.json')), `${outDir}/tokens/report.json`);
  for (const o of outputs) {
    add(readReportSeverities(join(cwd, outDir, 'outputs', `${outputId(o)}.report.json`)), `${outDir}/outputs/${outputId(o)}.report.json`);
  }
  if (errors > 0 || warnings > 0) {
    io.err(`${plural(errors, 'error')}, ${plural(warnings, 'warning')} in the token output. See ${reportPaths.join(', ')}.`);
  }
  // fonts.json can legitimately be empty; check only the families it names.
  const fontFamilies = readFontFamilies(cwd, outDir);
  if (fontFamilies.length > 0) {
    for (const family of missingFontSourcesInRepo(fontFamilies, cwd)) {
      io.err(`This library needs ${family}, and nothing in this repository loads it. See fonts.json.`);
    }
  }
  return errors;
}

/** "(v1.5.0, published <date>)" when a version is known, else "(published <date>)". */
function publishedPhrase(version: string | null | undefined, publishedAt: string): string {
  return version ? `(v${version}, published ${publishedAt})` : `(published ${publishedAt})`;
}

export async function runPull(
  cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io, fetcher?: typeof fetch,
): Promise<number> {
  return withJson('pull', flags, io, (jsonIo, report) => pullWith(cwd, flags, env, jsonIo, fetcher, { retryable: false, report }));
}

/** What runSetup needs to know about a failed pull beyond its exit code. */
interface PullOutcome {
  /** The failed fetch's `retryable`. */
  retryable: boolean;
  /** Filled for `pull --json`: state is "pulled", "up_to_date", or "failed". */
  report?: JsonReport;
}

async function pullWith(
  cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io, fetcher: typeof fetch | undefined,
  outcome: PullOutcome,
): Promise<number> {
  const report = outcome.report ?? {};
  report.state = 'failed';
  const manifestAt = manifestReader();
  const opts = resolved(cwd, flags, env, io, manifestAt);
  if (!opts) return 1;
  report.libraryId = opts.libraryId;
  report.outDir = opts.outDir;
  let selection: Selection;
  try {
    selection = resolveSelection(flags, opts);
  } catch (err) {
    io.err(errorText(err));
    return 1;
  }
  const fromFlags = platformsFromFlags(flags, io);
  if (fromFlags === null) return 1;
  const flagFormat = componentFormatFromFlags(flags, io);
  if (flagFormat === null) return 1;
  const componentSpecsFormat = flagFormat ?? opts.componentSpecsFormat ?? DEFAULT_COMPONENT_FORMAT;
  const { platforms, source } = resolvePlatforms(cwd, fromFlags, opts);
  const outputs = outputsForRun(fromFlags, opts, platforms);
  // Ask for a 304 only when the last pull wrote the same files with the same CLI
  // and every one is still on disk, since a 304 restores nothing. Deliverables
  // are written only with the Foundation, so a pull without it checks none, or
  // it would never match and would redownload on every run.
  //
  // The cliVersion clause makes an upgrade land: DTCG, reports, fonts.json and
  // CSS are projected here, not in the bundle, so a new CLI changes the output
  // for unchanged bytes. A manifest with no cliVersion fails `!==` too. The
  // publisher's extractorVersion travels in the bundle, so the ETag covers it.
  const manifest = manifestAt(join(cwd, opts.outDir));
  const foundationOnDisk = Boolean(manifest?.artifacts.find((a) => a.kind === 'foundation')?.path);
  const willWriteFoundation = selection.foundation && foundationOnDisk;
  // 0.6.0 manifests carry outDir-relative paths that fail this check, forcing
  // the re-fetch that migrates them.
  const briefsOnDisk = (manifest?.artifacts ?? [])
    .filter((a) => a.kind === 'component' && a.path !== null)
    .every((a) => existsSync(resolve(cwd, a.path as string)));
  const etag = manifest && manifest.cliVersion === cliVersion() && sameOutput(
    {
      selection: manifest.selection ?? DEFAULT_SELECTION, dtcg: manifest.dtcg, outputs: manifest.outputs,
      componentSpecsDir: manifest.componentSpecsDir, componentSpecsFormat: manifest.componentSpecsFormat,
    },
    { selection, dtcg: opts.dtcg, outputs, componentSpecsDir: opts.componentSpecsDir, componentSpecsFormat },
  ) && briefsOnDisk && (!willWriteFoundation || foundationFilesOnDisk(cwd, opts.outDir))
    && (!willWriteFoundation || outputs.every((o) => outputFilesOnDisk(cwd, opts.outDir, o)))
    ? manifest.bundleHash
    : undefined;
  const result = await fetchBundleWithRetry({
    api: opts.api, libraryId: opts.libraryId, key: opts.key, env,
    ...(etag ? { etag } : {}), ...(fetcher ? { fetcher } : {}),
  }, { retries: retriesFromEnv(env), onRetry: io.err });
  if (result.kind === 'error') {
    io.err(result.message);
    outcome.retryable = result.retryable;
    report.retryable = result.retryable;
    return 1;
  }
  if (result.kind === 'not_modified') {
    if (!etag) {
      // A 304 to a request with no If-None-Match answers nothing, so it is not
      // success. Earlier files may still exist, so the message does not deny them.
      io.err(`${opts.api} answered 304 Not Modified to a request that sent no If-None-Match, so it cannot be treated as current. Nothing was written, and files from an earlier pull, if any, are unchanged. Run spec-layer pull again.`);
      return 1;
    }
    io.out(`Already up to date ${publishedPhrase(result.version ?? manifest?.version, manifest?.publishedAt ?? 'unknown')}.`);
    // --strict must see a cached error report too; see printReportSummary.
    const cachedErrors = printReportSummary(cwd, opts.outDir, outputs, io);
    Object.assign(report, {
      state: 'up_to_date', version: result.version ?? manifest?.version ?? null,
      publishedAt: manifest?.publishedAt ?? null, reportErrors: cachedErrors,
    });
    if (flags.strict && cachedErrors > 0) return 1;
    return 0;
  }
  let written: string[];
  let componentSpecs: { path: string; files: string[] };
  let outputResults: Array<{ path: string; files: string[] }>;
  try {
    const bundle = parseBundle(result.raw);
    const selected = selectComponents(bundle, selection);
    const writeResult = writeBundleFiles({
      outDir: join(cwd, opts.outDir), cwd, raw: result.raw, bundle, selection,
      libraryId: opts.libraryId, publishedAt: result.publishedAt, bundleHash: result.bundleHash,
      version: result.version,
      dtcg: opts.dtcg, platforms, outputs, componentSpecsDir: opts.componentSpecsDir, componentSpecsFormat,
    });
    written = writeResult.written;
    componentSpecs = writeResult.componentSpecs;
    outputResults = writeResult.outputs;
    io.out(
      `Pulled ${bundle.fileName ?? opts.libraryId}: ${describePull(bundle, selection, selected)} ` +
      `${publishedPhrase(result.version, result.publishedAt)}.`,
    );
  } catch (err) {
    io.err(errorText(err));
    return 1;
  }
  const count = (n: number) => `${n} file${n === 1 ? '' : 's'}`;
  io.out(`Wrote ${written.length} files under ${opts.outDir}/.`);
  if (componentSpecs.files.length > 0) {
    const n = componentSpecs.files.length;
    io.out(`Wrote ${componentSpecs.path}/ (${n} ${FORMAT_NAME[componentSpecsFormat]} file${n === 1 ? '' : 's'}).`);
  }
  for (const r of outputResults) {
    const o = outputs.find((x) => x.path === r.path);
    if (o) io.out(`Wrote ${r.path}/ (${count(r.files.length)}, ${o.platform}/${o.format}, ${o.case} names).`);
  }
  // A renamed directory leaves marked files at the old path. Name it, never
  // delete it: only the developer knows whether something still reads it.
  const staleDirNote = (previous: string, current: string): void => {
    if (previous !== current && existsSync(resolve(cwd, previous))) {
      io.out(`The previous pull wrote ${previous}/; this one wrote ${current}/. Delete ${previous}/ if nothing else uses it.`);
    }
  };
  if (manifest) staleDirNote(manifest.componentSpecsDir ?? DEFAULT_COMPONENT_SPECS_DIR, opts.componentSpecsDir);
  for (const prev of manifest?.outputs ?? []) {
    const current = outputs.find((o) => outputId(o) === outputId(prev));
    if (current) staleDirNote(prev.path, current.path);
  }
  if (outputResults.length === 0 && selection.foundation && source === 'none' && (opts.outputs === undefined)) io.out(NO_PLATFORM_NOTE);
  if (source === 'flag' || source === 'config') {
    const missing = platformsMissingFormat(platforms);
    if (missing.length > 0) io.out(missingFormatNote(missing));
  }
  // A report entry never fails a default pull (that would break every CI that
  // runs it), so this is where it gets said. See printReportSummary.
  const errors = printReportSummary(cwd, opts.outDir, outputs, io);
  Object.assign(report, {
    state: 'pulled', version: result.version, publishedAt: result.publishedAt,
    files: written, componentSpecs, outputs: outputResults, reportErrors: errors,
  });
  if (flags.strict && errors > 0) return 1;
  return 0;
}

export async function runStatus(
  cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io, fetcher?: typeof fetch,
): Promise<number> {
  return withJson('status', flags, io, (jsonIo, report) => statusWith(cwd, flags, env, jsonIo, fetcher, report));
}

/** `state` is "up_to_date", "behind", "no_local_pull", or "error". */
async function statusWith(
  cwd: string, flags: Flags, env: Record<string, string | undefined>, io: Io, fetcher: typeof fetch | undefined,
  report: JsonReport,
): Promise<number> {
  report.state = 'error';
  const manifestAt = manifestReader();
  const opts = resolved(cwd, flags, env, io, manifestAt);
  if (!opts) return 1;
  report.libraryId = opts.libraryId;
  const manifest = manifestAt(join(cwd, opts.outDir));
  if (!manifest) {
    report.state = 'no_local_pull';
    io.err(NO_LOCAL_PULL);
    return 2;
  }
  report.local = { version: manifest.version ?? null, publishedAt: manifest.publishedAt };
  const result = await fetchBundleWithRetry({
    api: opts.api, libraryId: opts.libraryId, key: opts.key, etag: manifest.bundleHash, env,
    ...(fetcher ? { fetcher } : {}),
  }, { retries: retriesFromEnv(env), onRetry: io.err });
  if (result.kind === 'error') {
    io.err(result.message);
    return 1;
  }
  if (result.kind === 'not_modified') {
    report.state = 'up_to_date';
    io.out(`Up to date ${publishedPhrase(result.version ?? manifest.version, manifest.publishedAt)}.`);
    return 0;
  }
  report.state = 'behind';
  report.remote = { version: result.version, publishedAt: result.publishedAt };
  io.out(result.version
    ? `Behind: remote is v${result.version}, published ${result.publishedAt}. Run spec-layer pull.`
    : `Behind: remote published ${result.publishedAt}. Run spec-layer pull.`);
  return 2;
}

export function runList(cwd: string, flags: Flags, io: Io): number {
  return withJsonSync('list', flags, io, (jsonIo, report) => listWith(cwd, flags, jsonIo, report));
}

function listWith(cwd: string, flags: Flags, io: Io, report: JsonReport): number {
  const outDir = resolvedOutDir(cwd, flags, io);
  if (!outDir) return 1;
  const manifest = readManifest(outDir);
  if (!manifest) {
    io.err(NO_LOCAL_PULL);
    return 1;
  }
  Object.assign(report, {
    libraryId: manifest.libraryId, version: manifest.version ?? null, publishedAt: manifest.publishedAt,
    artifacts: manifest.artifacts.map((a) => ({ kind: a.kind, name: a.name, path: a.path, contentHash: a.contentHash })),
    outputs: (manifest.outputs ?? []).map((o) => ({
      platform: o.platform, format: o.format, path: o.path,
      written: existsSync(join(outDir, 'outputs', `${o.platform}-${o.format}.map.json`)),
    })),
  });
  io.out(manifest.version
    ? `Library ${manifest.libraryId}, v${manifest.version}, published ${manifest.publishedAt}.`
    : `Library ${manifest.libraryId}, published ${manifest.publishedAt}.`);
  const rows = manifest.artifacts.map((a) => [a.kind, a.name, a.path ?? 'not written', a.contentHash]);
  const widths = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i].length)));
  for (const row of rows) {
    io.out(row.map((cell, i) => (i < 3 ? cell.padEnd(widths[i]) : cell)).join('  '));
  }
  for (const o of manifest.outputs ?? []) {
    // manifest.outputs is the configured list; the map file proves it was written.
    const written = existsSync(join(outDir, 'outputs', `${o.platform}-${o.format}.map.json`));
    io.out(['output'.padEnd(widths[0]), `${o.platform}/${o.format}`.padEnd(widths[1]), written ? o.path : 'not written'].join('  '));
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
  const flagFormat = componentFormatFromFlags(flags, io);
  if (flagFormat === null) return 1;
  if (wantsFoundation && flagFormat !== undefined) {
    io.err('--component-format applies to components. The Foundation prints as its DTCG document.');
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
  // Set only for `show component`: the bundle entry, which always carries a name.
  let component: { name: string; artifact: unknown } | null = null;
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
    component = matches[0];
  }
  if (flags.canonical) {
    io.write(`${JSON.stringify(entry.artifact, null, 2)}\n`);
    return 0;
  }
  if (component) {
    // The flag, then the config (what the next pull will write), then the last pull (what is on disk).
    let configFormat: ComponentFormat | undefined;
    try {
      configFormat = readConfig(cwd)?.componentSpecsFormat;
    } catch (err) {
      io.err(errorText(err));
      return 1;
    }
    const format = flagFormat ?? configFormat ?? readManifest(outDir)?.componentSpecsFormat ?? DEFAULT_COMPONENT_FORMAT;
    if (format === 'md') {
      try {
        io.write(componentMarkdownPage(component));
      } catch (err) {
        io.err(errorText(err));
        return 1;
      }
      return 0;
    }
  }
  io.write(entry.ai);
  return 0;
}

export function runTools(flags: Flags, io: Io): number {
  if (flags.json) io.write(toolsJson(cliVersion()));
  else io.out(toolsText());
  return 0;
}

/** Everything `skill` says, gathered once so --json, printing, and --install agree. */
function collectSkillInput(cwd: string, flags: Flags, io: Io): SkillInput | null {
  let config: CliConfig | null;
  let outDir: string;
  try {
    config = readConfig(cwd);
    outDir = resolveOutDir(cwd, flags.out, config?.outDir);
  } catch (err) { io.err(errorText(err)); return null; }
  const profile = detectRepo(cwd);
  const fromFlags = platformsFromFlags(flags, io);
  if (fromFlags === null) return null;
  const { platforms, source: platformSource } = resolvePlatforms(cwd, fromFlags, config);
  const pull = summarizePull(cwd, outDir, readManifest(join(cwd, outDir)));
  return { profile, platforms, platformSource, outDir, config, pull, version: cliVersion() };
}

/** Hosts named with --agent, else the ones detected, else AGENTS.md. */
function skillHosts(flags: Flags, input: SkillInput, io: Io): AgentHost[] | null {
  const named = flags.agent ?? [];
  if (named.length > 0) {
    const hosts: AgentHost[] = [];
    for (const value of named) {
      if (!isAgentHost(value)) {
        io.err(`--agent takes ${AGENT_HOSTS.join(', ')}, not "${value}".`);
        return null;
      }
      if (!hosts.includes(value)) hosts.push(value);
    }
    return hosts;
  }
  return input.profile.agents.length > 0 ? input.profile.agents : ['agents-md'];
}

export function runSkill(cwd: string, flags: Flags, io: Io): number {
  const input = collectSkillInput(cwd, flags, io);
  if (!input) return 1;
  const hosts = skillHosts(flags, input, io);
  if (!hosts) return 1;
  if (flags.json) {
    io.write(`${JSON.stringify({
      cli_version: input.version,
      detected: input.profile,
      platforms: input.platforms,
      platform_source: input.platformSource,
      pull: input.pull,
      install_targets: hosts.map((h) => installTarget(h)),
    }, null, 2)}\n`);
    return 0;
  }
  const guide = buildSkillGuide(input);
  if (!flags.install) {
    io.write(guide);
    return 0;
  }
  const chosen = flags.agent && flags.agent.length > 0 ? 'named with --agent'
    : input.profile.agents.length > 0 ? 'detected in this repository' : 'the default when no agent is detected';
  for (const host of hosts) {
    let outcome: ReturnType<typeof installSkill>;
    try {
      outcome = installSkill(cwd, host, guide);
    } catch (err) {
      io.err(`Could not write ${installTarget(host).path}: ${errorText(err)}`);
      return 1;
    }
    const verb = outcome.result === 'created' ? 'Wrote' : outcome.result === 'updated' ? 'Updated' : 'Unchanged:';
    io.out(`${verb} ${outcome.path} (${host}, ${chosen}).`);
    const stale = outcome.staleSnapshot;
    if (stale.length > 0) {
      // Folders and `fonts.json` alike, so the sentence names neither kind.
      const list = stale.length <= 2
        ? stale.join(' and ')
        : `${stale.slice(0, -1).join(', ')}, and ${stale[stale.length - 1]}`;
      io.out(
        `A downloaded snapshot is still at ${list}. `
        + `The guide above supersedes it, and ${stale.length === 1 ? 'that path' : 'those paths'} can be deleted.`,
      );
    }
  }
  if (!input.pull) io.out(`No local pull yet, so the guide lists no components. Run spec-layer pull, then spec-layer skill --install again.`);
  if (input.platformSource === 'none') io.out(`No target platform detected. Pass --platform ${PLATFORMS.join('|')} to write platform-specific token advice.`);
  return 0;
}
