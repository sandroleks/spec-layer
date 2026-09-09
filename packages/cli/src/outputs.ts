import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CSS_HEADER_PREFIX, CSS_INDEX_FILE, NAME_CASES, cssOutput, type CssOutput, type DtcgExport, type NameCase,
} from '@spec-layer/extractor';
import type { Platform } from './detect';
import { visibleDirProblem } from './visibleDir';

/**
 * Platform outputs: the directories the team's build compiles, written in place at a
 * declared path outside the swapped output directory. Spec:
 * 2026-09-09-css-token-directory-design.md.
 * One format exists today; the registry is where the next one is added.
 */

export type OutputFormat = 'css';

export interface OutputConfig {
  platform: Platform;
  format: OutputFormat;
  /** Relative to the working directory. */
  path: string;
  case: NameCase;
  root?: string;
  modeSelector?: string;
  modes?: Record<string, string>;
}

interface FormatSpec {
  platform: Platform; format: OutputFormat;
  /** Where the directory lands when the config names none; null means a path is required. */
  defaultPath: string | null;
  defaultCase: NameCase;
  /** The first bytes of a file this format writes; anything else at the path is not ours. */
  headerPrefix: string;
}

export const FORMATS: readonly FormatSpec[] = [
  { platform: 'web', format: 'css', defaultPath: 'tokens', defaultCase: 'kebab', headerPrefix: CSS_HEADER_PREFIX },
];

export const knownFormats = (): string => FORMATS.map((f) => `${f.platform}/${f.format}`).join(', ');

const specOf = (platform: string, format: string): FormatSpec | null =>
  FORMATS.find((f) => f.platform === platform && f.format === format) ?? null;

/** One default output per platform that has one; ios, android, and flutter have none yet. */
export function defaultOutputs(platforms: Platform[]): OutputConfig[] {
  return FORMATS
    .filter((f) => f.defaultPath !== null && platforms.includes(f.platform))
    .map((f) => ({ platform: f.platform, format: f.format, path: f.defaultPath as string, case: f.defaultCase }));
}

/** The existing entries plus a default for every named platform that has none. */
export function withDefaults(existing: OutputConfig[], platforms: Platform[]): OutputConfig[] {
  const covered = new Set(existing.map((o) => o.platform));
  return [...existing, ...defaultOutputs(platforms.filter((p) => !covered.has(p)))];
}

/** The record file stem under <outDir>/outputs/. */
export const outputId = (o: OutputConfig): string => `${o.platform}-${o.format}`;

/** One outputs[] entry from speclayer.json. Throws a plain error naming the entry. */
export function parseOutput(value: unknown, index: number): OutputConfig {
  const at = `speclayer.json outputs[${index}]`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${at} must be an object.`);
  const r = value as Record<string, unknown>;
  if (typeof r.platform !== 'string' || typeof r.format !== 'string') {
    throw new Error(`${at} needs "platform" and "format". Known: ${knownFormats()}.`);
  }
  const spec = specOf(r.platform, r.format);
  if (!spec) throw new Error(`${at}: unknown platform/format "${r.platform}/${r.format}". Known: ${knownFormats()}.`);
  const str = (key: string): string | undefined => {
    if (r[key] !== undefined && typeof r[key] !== 'string') throw new Error(`${at} "${key}" must be a string.`);
    return r[key] as string | undefined;
  };
  const path = str('path') ?? spec.defaultPath;
  if (path === null) throw new Error(`${at} needs "path": ${spec.platform} has no default location.`);
  const nameCase = str('case');
  if (nameCase !== undefined && !(NAME_CASES as readonly string[]).includes(nameCase)) {
    throw new Error(`${at} "case" takes ${NAME_CASES.join(', ')}.`);
  }
  const root = str('root');
  const modeSelector = str('modeSelector');
  let modes: Record<string, string> | undefined;
  if (r.modes !== undefined) {
    const m = r.modes;
    if (typeof m !== 'object' || m === null || Array.isArray(m) || !Object.values(m).every((v) => typeof v === 'string')) {
      throw new Error(`${at} "modes" must map collection names to selector strings.`);
    }
    modes = m as Record<string, string>;
  }
  return {
    platform: spec.platform, format: spec.format, path, case: (nameCase as NameCase | undefined) ?? spec.defaultCase,
    ...(root !== undefined ? { root } : {}),
    ...(modeSelector !== undefined ? { modeSelector } : {}),
    ...(modes ? { modes } : {}),
  };
}

export function renderOutput(
  exp: DtcgExport, o: OutputConfig, header: { libraryId: string; contentHash: string },
): CssOutput {
  switch (o.format) {
    case 'css':
      return cssOutput(exp, { ...header, platform: o.platform, format: o.format }, {
        case: o.case,
        ...(o.root !== undefined ? { root: o.root } : {}),
        ...(o.modeSelector !== undefined ? { modeSelector: o.modeSelector } : {}),
        ...(o.modes ? { modes: o.modes } : {}),
      });
    default: {
      const exhaustive: never = o.format;
      return exhaustive;
    }
  }
}

/**
 * The part files an output's index.css imports, in order, or null when
 * index.css is missing or unreadable. index.css is the authoritative list of
 * what the last pull wrote: the record map names only the file that first
 * declares each token, which for a two-mode collection is always the default
 * mode's file, so a non-default mode file never appears in the map.
 */
export function readIndexImports(cwd: string, o: OutputConfig): string[] | null {
  const path = resolve(cwd, o.path, CSS_INDEX_FILE);
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { return null; }
  return [...text.matchAll(/^@import "\.\/([^"\n]+)";$/gm)].map((m) => m[1]);
}

export const LEGACY_CSS_PATH_NOTE = (path: string): string =>
  `${path} names a file; spec-layer 0.7.0 writes a directory. `
  + 'Set outputs[].path to a directory, for example "tokens", delete the old file, and pull again.';

/** Why a deliverable directory cannot be written at its path, or null when it can. `others` are this pull's other visible directories. */
export function outputPathProblem(cwd: string, outDir: string, o: OutputConfig, others: string[] = []): string | null {
  if (/\.css$/i.test(o.path)) return LEGACY_CSS_PATH_NOTE(o.path);
  const marker = specOf(o.platform, o.format)?.headerPrefix ?? CSS_HEADER_PREFIX;
  return visibleDirProblem(cwd, outDir, o.path, marker, others);
}
