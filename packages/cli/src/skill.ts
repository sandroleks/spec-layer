import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  CSS_INDEX_FILE, scopesStateNumber, type DtcgReportEntry, type DtcgResolverDocument, type FontRequirement,
} from '@spec-layer/extractor';
import type { CliConfig } from './config';
import { DEFAULT_COMPONENT_FORMAT, DEFAULT_COMPONENT_SPECS_DIR, type ComponentFormat } from './config';
import { CREDENTIALS_NAME } from './credentials';
import {
  CODE_SYNTAX_KEY, missingFontSourcesInRepo, type AgentHost, type Platform, type RepoProfile,
} from './detect';
import type { Manifest } from './files';
import { readIndexImports } from './outputs';
import { GLOBAL_FLAGS, KEY_RESOLUTION, TOOLS } from './tools';

/**
 * The guide a coding agent reads before touching the pulled files, built only
 * from the tool catalogue, the repository root, and the last pull. Every name
 * and path comes from manifest.json and tokens/resolver.json; with no pull the
 * guide names nothing, and with no stack signal it gives generic advice plus
 * the overriding flag, never a guessed platform.
 */

export interface PullSummary {
  outDir: string;
  libraryId: string;
  publishedAt: string;
  pluginVersion: string | null;
  /** DEFAULT_COMPONENT_SPECS_DIR when the manifest predates the field. */
  componentSpecsDir: string;
  /** 'yaml' when the manifest predates the field. */
  componentSpecsFormat: ComponentFormat;
  components: Array<{ name: string; path: string | null }>;
  foundation: {
    written: boolean;
    sets: string[];
    modifiers: Array<{ name: string; contexts: string[]; default: string | null }>;
    tokenFiles: string[];
    /**
     * Distinct `$type: "number"` tokens whose Figma scopes state nothing
     * (`OPACITY`/`FONT_WEIGHT` state "none" and are excluded). Deduplicated by
     * DTCG path across mode files, so a two-mode token counts once.
     */
    unitlessNumbers: number;
    reportCounts: Record<string, number>;
    /** 'ok' (an array, possibly empty), 'missing' (no file), or 'unreadable' (not a JSON array). */
    fontsStatus: 'ok' | 'missing' | 'unreadable';
    /**
     * From `fonts.json`; `[]` unless 'ok'. An empty 'ok' array does not prove the
     * library names no font: `fontRequirements` skips a style whose family never resolved.
     */
    fonts: FontRequirement[];
    /** Families in `fonts` nothing in this repository loads; computed only when 'ok' and non-empty. */
    missingFontFamilies: string[];
  } | null;
  outputs: Array<{
    platform: string; format: string; path: string; case: string; modeSelector: string; modes: Record<string, string>;
    /** Whether the map file exists: the on-disk proof the output was rendered. */
    written: boolean;
    /** The map exists but index.css does not, so `files` cannot be trusted. False when `written` or when the map is missing. */
    indexMissing: boolean;
    /** The part files index.css imports, in import order, then index.css; empty when not written. */
    files: string[];
  }>;
}

export interface SkillInput {
  profile: RepoProfile;
  /** Platforms the guide is written for, after any --platform override. */
  platforms: Platform[];
  platformSource: 'flag' | 'config' | 'detected' | 'none';
  outDir: string;
  config: CliConfig | null;
  pull: PullSummary | null;
  version: string;
}

// ---------------------------------------------------------------------------
// Reading the last pull
// ---------------------------------------------------------------------------

const RESERVED = new Set(['resolver.json', 'spec-layer.meta.json', 'report.json']);

/**
 * Collects the dotted DTCG path (the key `spec-layer.meta.json` uses) of every
 * `$type: "number"` leaf not in `legitimatelyUnitless`, the paths whose Figma
 * scopes state no unit. Paths, not a count: every mode file of a collection
 * carries every token, so one set across files counts each variable once.
 */
function collectNumberTokenPaths(
  tree: unknown, path: string[], legitimatelyUnitless: Set<string>, out: Set<string>,
): void {
  if (typeof tree !== 'object' || tree === null || Array.isArray(tree)) return;
  const record = tree as Record<string, unknown>;
  if (record.$type === 'number' && '$value' in record) {
    const dotted = path.join('.');
    if (!legitimatelyUnitless.has(dotted)) out.add(dotted);
    return;
  }
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('$')) continue;
    collectNumberTokenPaths(value, [...path, key], legitimatelyUnitless, out);
  }
}

function readJson(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/**
 * The DTCG paths `spec-layer.meta.json` says are unitless by scope, not by
 * silence (`scopesStateNumber`). Empty when the file is missing or unreadable,
 * which excludes nothing: the safe direction.
 */
function unitlessScopedPaths(tokensDir: string): Set<string> {
  const meta = readJson(join(tokensDir, 'spec-layer.meta.json'));
  const out = new Set<string>();
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return out;
  for (const [path, entry] of Object.entries(meta as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { type, scopes } = entry as { type?: unknown; scopes?: unknown };
    if (type === 'number' && Array.isArray(scopes) && scopesStateNumber(scopes as string[])) out.add(path);
  }
  return out;
}

/** A minimal shape check: `fonts.json` is untrusted disk content, so a malformed entry is dropped. */
function isFontRequirement(v: unknown): v is FontRequirement {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.family === 'string'
    && Array.isArray(r.weights) && r.weights.every((w) => typeof w === 'number')
    && Array.isArray(r.used_by) && r.used_by.every((u) => typeof u === 'string');
}

/** What the last pull left under outDir, or null when there is none. Never throws. */
export function summarizePull(cwd: string, outDir: string, manifest: Manifest | null): PullSummary | null {
  if (!manifest) return null;
  const absOut = join(cwd, outDir);
  const components = manifest.artifacts
    .filter((a) => a.kind === 'component')
    .map((a) => ({ name: a.name, path: a.path }));
  const foundationEntry = manifest.artifacts.find((a) => a.kind === 'foundation') ?? null;
  let foundation: PullSummary['foundation'] = null;
  if (foundationEntry) {
    const tokensDir = join(absOut, 'tokens');
    const resolver = readJson(join(tokensDir, 'resolver.json')) as DtcgResolverDocument | null;
    const report = readJson(join(tokensDir, 'report.json'));
    let tokenFiles: string[] = [];
    try { tokenFiles = readdirSync(tokensDir).filter((f) => f.endsWith('.json') && !RESERVED.has(f)).sort(); } catch { tokenFiles = []; }
    const legitimatelyUnitless = unitlessScopedPaths(tokensDir);
    const unitlessPaths = new Set<string>();
    for (const file of tokenFiles) {
      if (file.startsWith('styles.')) continue;
      collectNumberTokenPaths(readJson(join(tokensDir, file)), [], legitimatelyUnitless, unitlessPaths);
    }
    const unitlessNumbers = unitlessPaths.size;
    const reportCounts: Record<string, number> = {};
    if (Array.isArray(report)) {
      for (const entry of report as DtcgReportEntry[]) {
        if (typeof entry?.code === 'string') reportCounts[entry.code] = (reportCounts[entry.code] ?? 0) + 1;
      }
    }
    // fonts.json sits at the pull root, not under tokens/. Its three states stay
    // apart: an empty array is not an error, but a missing file must never read
    // as "this library needs no font".
    const fontsPath = join(absOut, 'fonts.json');
    let fontsStatus: 'ok' | 'missing' | 'unreadable' = 'missing';
    let fonts: FontRequirement[] = [];
    if (existsSync(fontsPath)) {
      let parsed: unknown;
      try { parsed = JSON.parse(readFileSync(fontsPath, 'utf8')); } catch { parsed = undefined; }
      if (Array.isArray(parsed)) { fontsStatus = 'ok'; fonts = parsed.filter(isFontRequirement); } else { fontsStatus = 'unreadable'; }
    }
    const missingFontFamilies = fontsStatus === 'ok' && fonts.length > 0
      ? missingFontSourcesInRepo(fonts.map((f) => f.family), cwd)
      : [];
    foundation = {
      written: foundationEntry.path !== null && resolver !== null,
      sets: resolver ? Object.keys(resolver.sets ?? {}) : [],
      modifiers: resolver
        ? Object.entries(resolver.modifiers ?? {}).map(([name, m]) => ({
          name, contexts: Object.keys(m.contexts ?? {}), default: m.default ?? null,
        }))
        : [],
      tokenFiles, unitlessNumbers, reportCounts, fontsStatus, fonts, missingFontFamilies,
    };
  }
  return {
    outDir, libraryId: manifest.libraryId, publishedAt: manifest.publishedAt,
    pluginVersion: manifest.pluginVersion,
    componentSpecsDir: manifest.componentSpecsDir ?? DEFAULT_COMPONENT_SPECS_DIR,
    componentSpecsFormat: manifest.componentSpecsFormat ?? DEFAULT_COMPONENT_FORMAT,
    components, foundation,
    outputs: (manifest.outputs ?? []).map((o) => {
      // manifest.outputs is the configured list; the map file proves rendering.
      // The file list comes from index.css, not the map; see readIndexImports.
      const mapPath = join(absOut, 'outputs', `${o.platform}-${o.format}.map.json`);
      const map = readJson(mapPath) as Record<string, { file?: string }> | null;
      const imports = map ? readIndexImports(cwd, o) : null;
      const files = imports !== null ? [...imports, CSS_INDEX_FILE] : [];
      return {
        platform: o.platform, format: o.format, path: o.path, case: o.case,
        modeSelector: o.modeSelector ?? '[data-theme="{mode}"]', modes: o.modes ?? {},
        // index.css must be readable too, or a stale map would claim files that are gone.
        written: map !== null && imports !== null,
        // "index.css gone" versus "map never written", so the guide names the real cause.
        indexMissing: map !== null && imports === null,
        files,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// The guide
// ---------------------------------------------------------------------------

const code = (s: string) => `\`${s}\``;

function stackSection(input: SkillInput): string[] {
  const { profile, platforms, platformSource, pull } = input;
  const lines: string[] = ['## This codebase', ''];

  if (profile.evidence.length === 0) {
    lines.push(
      'Nothing at the root of this directory identified a language, framework, or platform. ',
    );
  } else {
    lines.push('Detected from the repository root (the file that carries each signal is named, and nothing deeper was read):', '');
    for (const e of profile.evidence) lines.push(`- ${e.signal} (${code(e.file)})`);
    lines.push('');
    const facts: string[] = [];
    if (profile.languages.length) facts.push(`Languages: ${profile.languages.join(', ')}.`);
    if (profile.frameworks.length) facts.push(`Frameworks: ${profile.frameworks.join(', ')}.`);
    if (profile.tokenTools.length) facts.push(`Token tooling: ${profile.tokenTools.join(', ')}.`);
    if (facts.length) lines.push(facts.join(' '), '');
  }

  if (platformSource === 'none') {
    lines.push(
      'No target platform was detected, so the token advice below is generic. '
      + `Re-run ${code('spec-layer skill --platform web|ios|android|flutter')} to write it for a platform, or pass `
      + code('--install') + ' with the same flag to update the installed copy.',
      '',
    );
  } else {
    const label = platformSource === 'flag' ? 'chosen with --platform' : platformSource === 'config' ? 'set in speclayer.json' : 'detected';
    lines.push(`Target platform${platforms.length > 1 ? 's' : ''} (${label}): ${platforms.join(', ')}.`, '');
  }

  // Ahead of every platform section: a token with no unit breaks every
  // platform's build alike, and buried after the walkthroughs it goes unread.
  const tokensDir = `${input.outDir}/tokens/`;
  if (pull?.foundation && pull.foundation.unitlessNumbers > 0) {
    const n = pull.foundation.unitlessNumbers;
    // Only the per-output report enumerates these (`unitless_number`, css.ts);
    // tokens/report.json's unit codes name other conditions. Only web/css exists.
    const cssReport = pull.outputs.find((o) => o.platform === 'web' && o.format === 'css' && o.written) ?? null;
    lines.push(
      `**${n} token${n === 1 ? ' has' : 's have'} no unit.** `
      + `${n === 1 ? 'Its own Figma variable states' : 'Their own Figma variables state'} none at all, not even that `
      + `${n === 1 ? 'it is' : 'they are'} a unitless number the way an opacity or a font weight would. `
      + `Those are already excluded from this count, because Figma states that for them. So ${n === 1 ? 'it is' : 'they are'} written as `
      + `${code('$type: "number"')}: a bare number, not usable as a CSS length. ${code('height: 36')} is invalid CSS and the `
      + `browser drops the declaration. ${n === 1 ? 'Narrow the variable\'s' : 'Narrow each variable\'s'} scope in Figma to a length `
      + `(${code('CORNER_RADIUS')}, ${code('GAP')}, ${code('WIDTH_HEIGHT')}, ${code('FONT_SIZE')}, or ${code('STROKE_FLOAT')}), `
      + `or to ${code('OPACITY')}/${code('FONT_WEIGHT')} if it genuinely carries none, and pull again. `
      + `Only add ${code('"dtcg": { "units": { "<Collection>/<name glob>": "px" } }')} in ${code('speclayer.json')} once you already `
      + 'know the token is a length: the override applies to anything the glob matches that Figma has not already scoped as unitless, '
      + 'so a glob that is too broad can turn a genuine opacity or font weight into a fake length. '
      + `Nothing is inferred from a name; ${code(`${tokensDir}spec-layer.meta.json`)} names each token's own Figma scopes`
      + (cssReport
        ? `, and ${code(`${input.outDir}/outputs/${cssReport.platform}-${cssReport.format}.report.json`)} names every one under `
          + `${code('unitless_number')}. Do not read that file's entry count as this number: it carries one entry per mode a `
          + 'token appears in, and it also names the tokens Figma does scope as a unitless number, which this count leaves out.'
        : '.'),
      '',
    );
  }

  for (const platform of platforms) {
    const key = CODE_SYNTAX_KEY[platform];
    if (platform === 'web') {
      lines.push('### Web', '');
      // cssOut names only a file the on-disk map proves was rendered, since
      // pull.outputs can carry a configured entry the last pull never wrote.
      const cssOut = pull?.outputs.find((o) => o.platform === 'web' && o.format === 'css' && o.written) ?? null;
      // Fonts before imports: a missing font fails silently into the browser default.
      if (pull?.foundation?.written) {
        const { fontsStatus, fonts, missingFontFamilies } = pull.foundation;
        if (fontsStatus === 'ok' && fonts.length > 0) {
          const fontList = fonts.map((f) => `${f.family} at ${f.weights.join(', ')}`).join('; ');
          lines.push(
            `**Fonts.** This library's type is ${fontList}. Load every weight listed; a missing weight renders as a `
            + 'synthesised bold that matches nothing in the design.',
          );
          for (const family of missingFontFamilies) {
            lines.push(
              `${family}: nothing in this repository loads it. Add a font source before building UI, `
              + 'or every component that uses it renders in the browser default.',
            );
          }
          // Name the generated CSS an agent would edit, not the DTCG source; with
          // no CSS, the pull directory, which the next pull also replaces.
          const fallbackTarget = cssOut ? `${cssOut.path}/` : `${input.outDir}/`;
          lines.push(
            `The token holds a family name and no fallback stack. Never write ${code('font-family')} from a token without `
            + `appending a generic fallback, and never keep that fallback inside ${code(fallbackTarget)}: the next pull replaces it.`,
            '',
          );
        } else if (fontsStatus === 'ok') {
          lines.push(
            `${code('fonts.json')} names no font family. Either this library's typography styles reference none, or a `
            + `reference failed to resolve one; ${code('npx spec-layer show foundation')} prints the styles themselves.`,
            '',
          );
        } else {
          // The instruction must be able to succeed: pull re-projects when
          // fonts.json is gone, but an unparseable file does not trip that check,
          // so that branch says to delete it first.
          lines.push(
            fontsStatus === 'missing'
              ? `${code('fonts.json')} is missing, so the font requirement for this library is unknown here. `
                + `Run ${code('npx spec-layer pull')} again: every pull that includes the Foundation writes this file, `
                + 'and a pull that finds it gone re-projects instead of reporting no change.'
              : `${code('fonts.json')} is not valid JSON, so the font requirement for this library is unknown here. `
                + `Delete ${code(`${input.outDir}/fonts.json`)} and run ${code('npx spec-layer pull')} again, which rewrites it.`,
            '',
          );
        }
      }
      if (cssOut) {
        const mapPath = `${input.outDir}/outputs/web-css.map.json`;
        lines.push(
          `The CSS custom property for every token is in ${code(mapPath)}: `
          + 'source "code_syntax" when the designer declared it in Figma, "derived" when the CLI built it from the DTCG path '
          + `by the stated rule (${cssOut.case} case, collection root included). Each entry names the file that declares the property. Use those names; never invent a third. `
          + `${code(`${tokensDir}spec-layer.meta.json`)} still holds the raw ${code('code_syntax.WEB')} the designer declared.`,
          '',
        );
        const partFiles = cssOut.files.filter((f) => f !== CSS_INDEX_FILE);
        lines.push(
          `Import ${code(`${cssOut.path}/index.css`)} from the root stylesheet. It imports one file per collection and mode: ${partFiles.join(', ')}. `
          + `Sets and default modes are at ${code(':root')}; every other mode is a block under ${code(cssOut.modeSelector)} in its own file, so a mode can also be imported alone. `
          + `To switch, set ${code('data-theme')} on ${code('<html>')} (or whatever the selector names). `
          + `To let the OS choose, set that collection's selector to ${code(':root')} under ${code('outputs[].modes')} and import the mode's file yourself under ${code('@media (prefers-color-scheme: dark)')}; the CLI never assumes that.`,
          '',
        );
        if (profile.tokenTools.includes('style-dictionary') || profile.tokenTools.includes('tokens-studio')) {
          lines.push(
            `${code(`${cssOut.path}/`)} is a projection of the same ${code(tokensDir)} files, not a second source. Import one or the other.`,
            '',
          );
        }
      } else {
        lines.push(
          `Token identifiers for code live in ${code(`${tokensDir}spec-layer.meta.json`)} under each token's `
          + `${code(`code_syntax.${key}`)}, when the designer declared one in Figma. When a token has no WEB entry, use the DTCG path `
          + 'as it appears in the token file and say in your change that the code name is not declared in Figma.',
          '',
        );
        const configuredNotWritten = pull?.outputs.find((o) => o.platform === 'web' && !o.written) ?? null;
        if (configuredNotWritten?.indexMissing) {
          lines.push(
            `A web/css output is configured at ${code(`${configuredNotWritten.path}/`)} but its ${code('index.css')} is missing, so the file list is unknown. `
            + `Run ${code('npx spec-layer pull')} to write it again.`,
            '',
          );
        } else if (configuredNotWritten) {
          lines.push(
            `A web/css output is configured at ${code(`${configuredNotWritten.path}/`)} but was not written, because the last pull did not write the Foundation. `
            + 'Pull with the Foundation selected to write it.',
            '',
          );
        } else if (pull?.foundation?.written) {
          lines.push(
            'No token file was written for web. Add `"outputs"` in `speclayer.json` (or run `spec-layer pull --platform web` once) '
            + `and pull again; the default lands at ${code('tokens/')}.`,
            '',
          );
        }
      }
      if (profile.tokenTools.includes('tailwind')) {
        lines.push(
          `Tailwind is present (${code('tailwindcss')}). Map DTCG ${code('color')} tokens to the theme's color scale and `
          + `${code('dimension')} tokens to spacing, radius, or font size by the collection and group they sit in. `
          + 'Keep the mapping in one place and reference token paths, not copied values, so a republish moves the code with it.',
          '',
        );
      }
      if (profile.tokenTools.includes('style-dictionary')) {
        const major = profile.styleDictionaryMajor;
        lines.push(
          `Style Dictionary is present${major !== null ? ` (major version ${major} in package.json)` : ''}. `
          + `Point it at ${code(tokensDir)} and load the files ${code('resolver.json')} names for the mode you build. `
          + `Exclude ${code('spec-layer.meta.json')} and ${code('report.json')} from token globs; they are not token files.`,
        );
        if (major !== null && major < 5) {
          lines.push(
            '',
            `Style Dictionary ${major} reads the string value forms, not the 2025.10 object forms. Set `
            + `${code('"dtcg": { "values": "legacy" }')} in ${code('speclayer.json')} and run ${code('spec-layer pull')}; `
            + 'the change re-projects tokens/ without a republish.',
          );
        }
        lines.push('');
      }
    } else if (platform === 'ios') {
      lines.push('### iOS', '');
      lines.push(
        `Token identifiers for code live in ${code(`${tokensDir}spec-layer.meta.json`)} under each token's `
        + `${code(`code_syntax.${key}`)}, when the designer declared one in Figma. Use that as the Swift symbol. `
        + 'Colors arrive as hex strings or DTCG color objects with RGBA components; dimensions carry an explicit px or rem unit. '
        + 'A modifier with more than one context (for example a light and a dark mode) maps to a color-scheme-dependent value; '
        + 'a set without modes is a constant. Do not invent a dark variant for a collection that has one mode.',
        '',
      );
    } else if (platform === 'android') {
      lines.push('### Android', '');
      lines.push(
        `Token identifiers for code live in ${code(`${tokensDir}spec-layer.meta.json`)} under each token's `
        + `${code(`code_syntax.${key}`)}, when the designer declared one in Figma. Use that as the Kotlin or resource name. `
        + 'Dimensions carry an explicit px or rem unit and no density assumption; a value is only dp when your own convention says so, '
        + 'and that convention belongs in your code, not in the token file. Modes map to resource qualifiers or a Compose theme switch.',
        '',
      );
    } else {
      lines.push('### Flutter', '');
      lines.push(
        'Figma declares no code syntax for Flutter, so no identifier is provided for Dart. Name symbols after the DTCG path '
        + `(for example ${code('Collection.group.name')} becomes a nested class or a camelCase constant) and keep the path in a `
        + 'comment so the source token stays traceable. Modes map to theme variants.',
        '',
      );
    }
  }
  return lines;
}

function pullSection(input: SkillInput): string[] {
  const { pull, outDir } = input;
  const lines: string[] = ['## What is on disk', ''];
  if (!pull) {
    lines.push(
      `No pull has been made in this directory yet, so nothing under ${code(outDir + '/')} can be described. `
      + `Run ${code('npx spec-layer pull')} (or the setup command from the plugin if there is no ${code('speclayer.json')}), `
      + `then ${code('npx spec-layer skill --install')} again to list the components and token collections here.`,
      '',
    );
    return lines;
  }
  lines.push(
    `Library ${code(pull.libraryId)}, published ${pull.publishedAt}`
    + `${pull.pluginVersion ? ` by plugin ${pull.pluginVersion}` : ''}. Run ${code('npx spec-layer status')} first; exit code 2 means a newer publish exists and ${code('npx spec-layer pull')} fetches it.`,
    '',
  );
  lines.push(`- ${code(`${outDir}/manifest.json`)}: every artifact with its content hash and file path.`);
  lines.push(`- ${code(`${outDir}/bundle.json`)}: the whole published library, including the canonical v5 JSON of every artifact.`);
  if (pull.foundation) {
    if (pull.foundation.written) {
      lines.push(`- ${code(`${outDir}/tokens/`)}: the Foundation as Design Tokens Format Module 2025.10 files.`);
      lines.push(`  - ${code('resolver.json')}: sets, modifiers, and resolution order. Start here.`);
      lines.push(`  - ${code('spec-layer.meta.json')}: Figma ids, scopes, publication, and ${code('code_syntax')} per DTCG path.`);
      lines.push(`  - ${code('report.json')}: what the format could not express, with reasons. Never fill these gaps with a guess.`);
      for (const f of pull.foundation.tokenFiles) lines.push(`  - ${code(f)}`);
    } else {
      lines.push(`- Foundation: present in the library but not written, because the selection excludes it. ${code('spec-layer show foundation')} still prints it.`);
    }
  } else {
    lines.push('- This library has no Foundation, so there is no tokens/ directory.');
  }
  lines.push(`- ${code(`${pull.componentSpecsDir}/`)}: one ${pull.componentSpecsFormat === 'md' ? 'Markdown page' : 'YAML'} per component.`);
  for (const o of pull.outputs) {
    lines.push(o.written
      ? `- ${code(`${o.path}/`)}: ${o.platform}/${o.format} token files, ${o.case} names: ${o.files.join(', ')}. Non-default modes are under ${code(o.modeSelector)}, each in its own file.`
        + ` Names and provenance: ${code(`${outDir}/outputs/${o.platform}-${o.format}.map.json`)}; what it could not express: ${code(`${outDir}/outputs/${o.platform}-${o.format}.report.json`)}.`
      : o.indexMissing
        ? `- ${code(`${o.path}/`)}: ${o.platform}/${o.format} token files, but ${code('index.css')} is missing; run ${code('npx spec-layer pull')} to restore the directory.`
        : `- ${code(`${o.path}/`)}: ${o.platform}/${o.format} token files, configured but not written by the last pull (the Foundation was not written). Nothing is on disk at that path from Spec Layer.`);
  }
  lines.push('');

  if (pull.foundation && (pull.foundation.sets.length || pull.foundation.modifiers.length)) {
    lines.push('### Token collections', '');
    for (const set of pull.foundation.sets) lines.push(`- ${code(set)}: one mode, always applied.`);
    for (const m of pull.foundation.modifiers) {
      lines.push(`- ${code(m.name)}: modes ${m.contexts.map(code).join(', ')}${m.default ? `, default ${code(m.default)}` : ''}.`);
    }
    lines.push('');
    const counts = Object.entries(pull.foundation.reportCounts);
    if (counts.length) {
      lines.push(
        `${code('report.json')} lists ${counts.map(([c, n]) => `${n} ${code(c)}`).join(', ')}. Read it before assuming a token is missing.`,
        '',
      );
    }
  }

  lines.push('### Components', '');
  if (pull.components.length === 0) {
    lines.push('The library documents no components.', '');
  } else {
    for (const c of pull.components) {
      lines.push(c.path
        ? `- ${c.name}: ${code(c.path)}`
        : `- ${c.name}: not written (excluded by the selection). ${code(`spec-layer show component "${c.name}"`)} prints it.`);
    }
    lines.push('');
  }
  return lines;
}

function commandsSection(): string[] {
  const lines: string[] = ['## Commands', ''];
  // A pipe inside a table cell ends the cell, backticks or not, so every
  // usage string's `a|b` alternatives are escaped for the table.
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  lines.push('| Command | What it does | When | Network | Key | Writes |', '|---|---|---|---|---|---|');
  for (const t of TOOLS) {
    lines.push(`| ${code(cell(t.usage))} | ${cell(t.summary)} | ${cell(t.when)} | ${t.network ? 'yes' : 'no'} | ${t.needsKey ? 'required' : 'no'} | ${t.writes.length ? t.writes.map((w) => code(cell(w))).join(', ') : 'nothing'} |`);
  }
  lines.push('');
  lines.push('Exit codes:', '');
  for (const t of TOOLS) {
    lines.push(`- ${code(t.name)}: ${Object.entries(t.exits).map(([c, m]) => `${c} = ${m}`).join('; ')}.`);
  }
  lines.push('');
  for (const f of GLOBAL_FLAGS) lines.push(`- ${code(f.flag)}: ${f.summary}`);
  lines.push('', KEY_RESOLUTION, '');
  lines.push(`Run ${code('npx --yes spec-layer <command>')} in an unattended session so npx does not stop to ask before downloading the package. ${code('spec-layer tools --json')} prints this table for machines.`, '');
  return lines;
}

/** The guide body, Markdown without any host frontmatter. */
export function buildSkillGuide(input: SkillInput): string {
  const { outDir } = input;
  const lines: string[] = [];
  // What is on disk first (the last pull), then what the next pull will write.
  const markdown = (input.pull?.componentSpecsFormat ?? input.config?.componentSpecsFormat ?? DEFAULT_COMPONENT_FORMAT) === 'md';
  lines.push('# Spec Layer: design-system context for this repository', '');
  lines.push(
    'The Spec Layer Figma plugin publishes a design system\'s components, variables, and styles as data. The '
    + `${code('spec-layer')} CLI (version ${input.version}) pulls that data into this repository under ${code(outDir + '/')}. `
    + 'Everything in those files is extracted deterministically from Figma and validated against a published schema, '
    + (markdown
      ? 'with two exceptions that can carry model-written prose: a section of a component page that says it was written by AI, '
        + `or a component's or the foundation's ${code('guidelines')} block, marked ${code('origin: generated')} `
        + `(${code('origin: authored')} when a person wrote all of it on the Figma canvas, and ${code('authored')} lists `
        + 'the fields a person wrote when they wrote only some); and a token group\'s '
        + `${code('$extensions["com.spec-layer"].generated_description')}, whose key names its origin `
      : `with two exceptions that can carry model-written prose: a component's or the foundation's ${code('guidelines')} `
        + `block, marked ${code('origin: generated')} (${code('origin: authored')} when a person wrote all of it on the `
        + `Figma canvas, and ${code('authored')} lists the fields a person wrote when they wrote only some), and a token `
        + `group's ${code('$extensions["com.spec-layer"].generated_description')}, whose key names its origin `)
    + 'and which is model-written wherever it appears; no token group carries a plain `$description`. Treat the rest as the source of truth '
    + 'for what the design system contains, and treat anything it does not state as unknown rather than as something '
    + 'to infer.',
    '',
  );
  const componentSpecsDir = input.pull?.componentSpecsDir ?? input.config?.componentSpecsDir ?? DEFAULT_COMPONENT_SPECS_DIR;
  lines.push('## How to use it', '');
  lines.push(`1. Run ${code('npx spec-layer status')}. Exit 0 means the local copy is current; exit 2 means run ${code('npx spec-layer pull')} first.`);
  lines.push(markdown
    ? `2. Building or changing a component: read its page under ${code(`${componentSpecsDir}/`)}, or ${code('npx spec-layer show component NAME')}. **Properties** gives variants, states, booleans, and slots; **Anatomy** names the parts; **Token bindings** says which token each part's property uses and under which **When** conditions; **Unbound values** lists values that are hardcoded in Figma.`
    : `2. Building or changing a component: read its YAML under ${code(`${componentSpecsDir}/`)}, or ${code('npx spec-layer show component NAME')}. ${code('api')} gives variants, states, booleans, and slots; ${code('anatomy')} names the parts; ${code('references.bindings')} says which token each part's property uses and under which ${code('when')} conditions; ${code('unbound')} lists values that are hardcoded in Figma.`);
  lines.push(`3. Working with colors, spacing, type, or effects: start at ${code(`${outDir}/tokens/resolver.json`)}, load the set and mode files it names, and look up ${code('code_syntax')} in ${code('spec-layer.meta.json')} for the name the designer declared for your platform.`);
  lines.push(`4. Reference tokens by name in code; never paste a resolved value where a token exists. A value the design system does not define is not a token: say so in your change rather than adding one.`);
  lines.push(markdown
    ? '5. A row under **Unbound values** is a value hardcoded in Figma with no token bound to it, which is design debt. Keep the literal value, do not replace it with a token, and note in your change that Figma has no binding for it.'
    : `5. An ${code('unbound')} entry is a value hardcoded in Figma with no token bound to it, which is design debt. Keep the literal value, do not replace it with a token, and note in your change that Figma has no binding for it.`);
  const writtenOutputs = input.pull?.outputs.filter((o) => o.written) ?? [];
  const outputNote = writtenOutputs.length
    ? ` Never edit ${writtenOutputs.map((o) => code(`${o.path}/`)).join(', ')} either: pull replaces or removes files there.`
    : '';
  lines.push(`6. Never edit files under ${code(outDir + '/')} or ${code(componentSpecsDir + '/')}: the next pull replaces or removes them.${outputNote} Configuration lives in ${code('speclayer.json')}. Never commit ${code(CREDENTIALS_NAME)}, and never print or copy the pull key.`);
  lines.push('');
  lines.push(...pullSection(input));
  lines.push(...stackSection(input));
  lines.push(...commandsSection());
  lines.push(`Generated by ${code('spec-layer skill')}. Re-run ${code('npx spec-layer skill --install')} after a pull that adds components, after changing ${code('outputs')} or ${code('componentSpecsDir')}, or when the codebase changes stack; the file is replaced, not appended.`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Installing
// ---------------------------------------------------------------------------

export const SKILL_DESCRIPTION =
  'Use the design-system context the Spec Layer Figma plugin published into this repository: component variants, states, anatomy, token bindings, and design tokens. Read this before building or changing UI, using tokens, or running the spec-layer CLI.';

export interface InstallTarget { host: AgentHost; path: string; mode: 'file' | 'block' }

/** Where each agent reads instructions, relative to the working directory. */
export function installTarget(host: AgentHost): InstallTarget {
  switch (host) {
    case 'claude': return { host, path: '.claude/skills/spec-layer/SKILL.md', mode: 'file' };
    case 'cursor': return { host, path: '.cursor/rules/spec-layer.mdc', mode: 'file' };
    case 'copilot': return { host, path: '.github/instructions/spec-layer.instructions.md', mode: 'file' };
    case 'windsurf': return { host, path: '.windsurf/rules/spec-layer.md', mode: 'file' };
    case 'gemini': return { host, path: 'GEMINI.md', mode: 'block' };
    case 'agents-md': return { host, path: 'AGENTS.md', mode: 'block' };
  }
}

/** The guide wrapped the way one host expects it. */
export function renderForHost(host: AgentHost, guide: string): string {
  const yamlString = (s: string) => JSON.stringify(s);
  switch (host) {
    case 'claude':
      return `---\nname: spec-layer\ndescription: ${yamlString(SKILL_DESCRIPTION)}\n---\n\n${guide}`;
    case 'cursor':
      return `---\ndescription: ${yamlString(SKILL_DESCRIPTION)}\nalwaysApply: false\n---\n\n${guide}`;
    case 'copilot':
      return `---\napplyTo: "**"\n---\n\n${guide}`;
    case 'windsurf':
      return `---\ntrigger: model_decision\ndescription: ${yamlString(SKILL_DESCRIPTION)}\n---\n\n${guide}`;
    case 'gemini':
    case 'agents-md':
      return guide;
  }
}

export const BLOCK_BEGIN = '<!-- spec-layer:begin -->';
export const BLOCK_END = '<!-- spec-layer:end -->';

/**
 * A shared instruction file (AGENTS.md, GEMINI.md) belongs to the repository,
 * so only the region between the markers is replaced; without markers the
 * block is appended. One marker alone, or end before begin, is refused: the
 * next run would replace the reader's own text between them.
 */
export function upsertBlock(existing: string | null, guide: string): string {
  const block = `${BLOCK_BEGIN}\n${guide.trimEnd()}\n${BLOCK_END}\n`;
  if (existing === null) return block;
  const begin = existing.indexOf(BLOCK_BEGIN);
  const end = existing.indexOf(BLOCK_END);
  if (begin !== -1 && end !== -1 && end > begin) {
    const after = existing.slice(end + BLOCK_END.length).replace(/^\n/, '');
    return `${existing.slice(0, begin)}${block}${after}`;
  }
  if (begin !== -1 || end !== -1) {
    throw new Error(
      `${BLOCK_BEGIN} and ${BLOCK_END} must both be present, in that order, or both absent. Fix the markers in the file, then run again.`,
    );
  }
  const sep = existing.length === 0 ? '' : existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  return `${existing}${sep}${block}`;
}

export type InstallOutcome = {
  path: string;
  result: 'created' | 'updated' | 'unchanged';
  /**
   * Snapshot entries beside the replaced file, since the plugin's download also
   * writes `.claude/skills/spec-layer/`. Reported, never deleted: the CLI does
   * not own files it did not write.
   */
  staleSnapshot: string[];
};

/** What a downloaded snapshot writes beside its SKILL.md, the list its own SKILL.md says to delete. */
const SNAPSHOT_ENTRIES = ['components', 'tokens', 'fonts.json'];

function staleSnapshotEntries(cwd: string, target: InstallTarget): string[] {
  if (target.host !== 'claude') return [];
  const dir = dirname(target.path);
  return SNAPSHOT_ENTRIES
    .map((name) => `${dir}/${name}`)
    .filter((rel) => existsSync(join(cwd, rel)));
}

export function installSkill(cwd: string, host: AgentHost, guide: string): InstallOutcome {
  const target = installTarget(host);
  const abs = join(cwd, target.path);
  const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  const staleSnapshot = staleSnapshotEntries(cwd, target);
  const next = target.mode === 'file' ? renderForHost(host, guide) : upsertBlock(existing, renderForHost(host, guide));
  if (existing === next) return { path: target.path, result: 'unchanged', staleSnapshot };
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, next);
  return { path: target.path, result: existing === null ? 'created' : 'updated', staleSnapshot };
}
