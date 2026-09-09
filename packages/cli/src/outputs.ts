import {
  existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  CSS_HEADER_PREFIX, NAME_CASES, cssOutput, type CssOutput, type DtcgExport, type NameCase,
} from '@spec-layer/extractor';
import type { Platform } from './detect';

/**
 * Platform outputs: the files the team's build compiles, written in place at a
 * declared path outside the swapped output directory. Spec:
 * docs/superpowers/specs/2026-09-08-repository-delivery-design.md, section 4.
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
  /** Where the file lands when the config names none; null means a path is required. */
  defaultPath: string | null;
  defaultCase: NameCase;
  /** The first bytes of a file this format writes; anything else at the path is not ours. */
  headerPrefix: string;
}

export const FORMATS: readonly FormatSpec[] = [
  { platform: 'web', format: 'css', defaultPath: 'spec-layer/tokens.css', defaultCase: 'kebab', headerPrefix: CSS_HEADER_PREFIX },
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

const inside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** Why a deliverable cannot be written at its path, or null when it can. */
export function outputPathProblem(cwd: string, outDir: string, o: OutputConfig): string | null {
  const root = resolve(cwd);
  const abs = resolve(cwd, o.path);
  if (!inside(root, abs) || abs === root) return `${o.path} is outside this directory. Choose a path inside the repository.`;
  if (inside(resolve(cwd, outDir), abs)) {
    return `${o.path} is inside ${outDir}, which pull replaces wholesale. Choose a path outside it.`;
  }
  if (existsSync(abs)) {
    const prefix = specOf(o.platform, o.format)?.headerPrefix ?? CSS_HEADER_PREFIX;
    let head: string;
    try { head = readFileSync(abs, 'utf8').slice(0, prefix.length); } catch { return `${o.path} exists and could not be read.`; }
    if (head !== prefix) return `${o.path} exists and was not written by spec-layer. Choose another path or remove the file.`;
  }
  return null;
}

/** Writes to <path>.partial, then renames over the target, so a reader never sees a half file. */
export function writeOutputFile(cwd: string, o: OutputConfig, text: string): void {
  const abs = resolve(cwd, o.path);
  mkdirSync(dirname(abs), { recursive: true });
  const partial = `${abs}.partial`;
  writeFileSync(partial, text);
  try {
    renameSync(partial, abs);
  } catch (err) {
    // A failed rename must not leave the .partial file behind for the next
    // write to trip over, or for a reader to mistake for a real deliverable.
    rmSync(partial, { force: true });
    throw err;
  }
}
