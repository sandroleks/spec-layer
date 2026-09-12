import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  CSS_INDEX_FILE, scopesStateNumber, type DtcgReportEntry, type DtcgResolverDocument, type FontRequirement,
} from '@spec-layer/extractor';
import type { CliConfig } from './config';
import { DEFAULT_COMPONENT_SPECS_DIR } from './config';
import { CREDENTIALS_NAME } from './credentials';
import {
  CODE_SYNTAX_KEY, missingFontSourcesInRepo, type AgentHost, type Platform, type RepoProfile,
} from './detect';
import type { Manifest } from './files';
import { readIndexImports } from './outputs';
import { GLOBAL_FLAGS, KEY_RESOLUTION, TOOLS } from './tools';

/**
 * The guide a coding agent reads before it touches the pulled files. It is
 * built from three things the CLI can see, and nothing else: the tool
 * catalogue, what the repository root says about the codebase, and what the
 * last pull wrote. Every component name, collection, mode, and file path in
 * it comes from manifest.json and tokens/resolver.json; when there is no pull
 * yet the guide says so and stops short of naming anything. The stack advice
 * is keyed to detected signals and names the file each one came from, and a
 * codebase with no signal gets the generic paragraph plus the flag that
 * overrides it, never a guessed platform.
 */

export interface PullSummary {
  outDir: string;
  libraryId: string;
  publishedAt: string;
  pluginVersion: string | null;
  /** Where the last pull wrote the briefs; DEFAULT_COMPONENT_SPECS_DIR when the manifest predates the field. */
  componentSpecsDir: string;
  components: Array<{ name: string; path: string | null }>;
  foundation: {
    written: boolean;
    sets: string[];
    modifiers: Array<{ name: string; contexts: string[]; default: string | null }>;
    tokenFiles: string[];
    /** Distinct tokens exported as `$type: "number"` whose Figma scopes state nothing at all -- not a length, and not `OPACITY`/`FONT_WEIGHT` either (those already state a unit, namely "none", and are excluded). Deduplicated by DTCG path across every mode file, so a token in a two-mode collection counts once, which is what "N tokens" has to mean to a reader about to go narrow N variables in Figma. */
    unitlessNumbers: number;
    reportCounts: Record<string, number>;
    /** Whether `<outDir>/fonts.json` could be read: 'ok' (parsed as an array, possibly empty), 'missing' (no such file -- expected when the Foundation was excluded from this pull, or a real gap when it predates this file), or 'unreadable' (present but not a JSON array). */
    fontsStatus: 'ok' | 'missing' | 'unreadable';
    /** The families and weights this library's typography styles need, from `fonts.json`. Only meaningful when `fontsStatus` is 'ok'; `[]` otherwise. An 'ok' empty array does not prove the library names no font either: `fontRequirements` silently skips a style whose font family never resolved. */
    fonts: FontRequirement[];
    /** The families in `fonts` that nothing in this repository loads, per `missingFontSourcesInRepo`. Computed only when `fontsStatus` is 'ok' and `fonts` is non-empty. */
    missingFontFamilies: string[];
  } | null;
  outputs: Array<{
    platform: string; format: string; path: string; case: string; modeSelector: string; modes: Record<string, string>;
    /** Whether `<outDir>/outputs/<platform>-<format>.map.json` exists: the on-disk proof the file was rendered. */
    written: boolean;
    /** True when the map exists but index.css is missing or unreadable, so the file list in `files` cannot be trusted; false whenever `written` is true, and false when the map itself is missing (the Foundation was never written). */
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
 * `path` accumulates the DTCG path segments seen so far (the projected token
 * file's own nesting mirrors it exactly: `{"Primitives": {"number": {"unknown-scope":
 * {"$type": "number", ...}}}}` reaches this leaf with `path` equal to
 * `['Primitives', 'number', 'unknown-scope']`, the same string
 * `spec-layer.meta.json` keys itself with). `legitimatelyUnitless` names every
 * path whose own Figma scopes already state it is a unitless number
 * (`OPACITY`, `FONT_WEIGHT`): those are excluded here, because a `$type:
 * "number"` leaf alone cannot tell "nobody scoped this" from "Figma states
 * this has no unit", and only the first is what this count is for.
 *
 * Paths, not a count, because the caller walks one file per (collection,
 * mode) and every mode file of a collection carries every token of that
 * collection: a summed count reports a token in a two-mode collection twice,
 * and the sentence it feeds says "tokens" and tells the reader to go narrow
 * that many variables in Figma. A DTCG path is the same string in every mode
 * file of its collection, and is what `spec-layer.meta.json` keys a variable
 * by, so collecting into one set across files counts each variable once.
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
 * The DTCG paths `spec-layer.meta.json` (the only pulled file carrying a
 * token's own Figma scopes) says are a unitless number by scope, not by
 * silence: `OPACITY` and `FONT_WEIGHT` state "no unit" exactly as
 * `CORNER_RADIUS` states "px" (`scopesStateNumber`, `@spec-layer/extractor`).
 * `[]` when the file is missing or unreadable -- the caller then simply
 * excludes nothing, which is the safe direction (a token that is actually
 * scoped unitless still gets counted rather than one that is not getting
 * wrongly excluded).
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

/** A minimal shape check on one `fonts.json` entry: untrusted disk content,
 *  not the extractor's own output, so a malformed entry is dropped rather
 *  than crashing the guide. */
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
    // fonts.json sits at the pull root next to bundle.json, not under tokens/,
    // and is written whenever the Foundation is selected. Its three readable
    // states are kept apart rather than collapsed to "empty": a genuine empty
    // array (a library with no typography styles, or none whose font family
    // resolved) is not an error, but a MISSING file is -- every pull taken
    // before this file existed would otherwise render a confident "this
    // library needs no font" that is not backed by anything.
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
    components, foundation,
    outputs: (manifest.outputs ?? []).map((o) => {
      // manifest.outputs records the configured list regardless of whether the
      // Foundation was written; the map file exists only when it was actually
      // rendered, so it is the on-disk proof a sentence can point to. The file
      // list itself comes from index.css's own imports, not the map: a map
      // entry names only the file that first declares a token, so a
      // non-default mode file never appears there.
      const mapPath = join(absOut, 'outputs', `${o.platform}-${o.format}.map.json`);
      const map = readJson(mapPath) as Record<string, { file?: string }> | null;
      const imports = map ? readIndexImports(cwd, o) : null;
      const files = imports !== null ? [...imports, CSS_INDEX_FILE] : [];
      return {
        platform: o.platform, format: o.format, path: o.path, case: o.case,
        modeSelector: o.modeSelector ?? '[data-theme="{mode}"]', modes: o.modes ?? {},
        // index.css must be readable, not just the map, or a deleted index.css
        // (with the map still on disk from an interrupted pull) would report
        // written with an empty file list, a sentence that claims files exist.
        written: map !== null && imports !== null,
        // Distinguishes "the map is on disk but index.css is gone" from "the
        // map itself never existed" (the Foundation was excluded), so the
        // guide can name the actual cause instead of always blaming the
        // Foundation.
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

  // Ahead of every platform section, not after them: a token with no unit
  // breaks every platform's build the same way, and burying this after a long
  // per-platform walkthrough is exactly how it went unread on a real pull --
  // an agent built a component whose height, padding, gap, and border-radius
  // were all invalid CSS and silently dropped, and four rounds of visual
  // review signed it off.
  const tokensDir = `${input.outDir}/tokens/`;
  if (pull?.foundation && pull.foundation.unitlessNumbers > 0) {
    const n = pull.foundation.unitlessNumbers;
    // The only report file that actually enumerates these is the per-output
    // one (`unitless_number`, css.ts) -- `tokens/report.json`'s own codes
    // (`unit_derived_from_usage`, `unit_override_conflicts_with_scope`,
    // `unit_not_expressible`) name a different condition each, none of them
    // "this token was left with no unit at all". Only web/css is a real
    // output format today, so this is the only one that can exist.
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
      // cssOut only ever names a file the on-disk map proves was rendered;
      // manifest.outputs (and so pull.outputs) can carry a configured entry
      // that the last pull never wrote, and the guide must not imply that one exists.
      // Computed before the font block below so that block can name the
      // actual generated CSS an agent would edit, not the DTCG JSON directory.
      const cssOut = pull?.outputs.find((o) => o.platform === 'web' && o.format === 'css' && o.written) ?? null;
      // Before anything about importing token files: a missing or
      // under-loaded font fails silently and every label renders in the
      // browser default, which is the other half of the same real incident
      // the unit caveat above is named for.
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
          // cssOut.path is the generated CSS an agent would actually open and
          // edit (it holds the literal `font-family: "..."` declaration);
          // tokensDir is the DTCG JSON source, which is not CSS and is not
          // where anyone would add a fallback. When no CSS was written, the
          // warning falls back to the whole pull directory, which is still
          // true and still replaced wholesale by the next pull.
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
          // What to do here has to be an instruction that can actually
          // succeed. `pull` re-projects rather than reporting no change when
          // the CLI has moved since the last pull, or when a file it writes
          // alongside the Foundation is gone -- fonts.json is one of those --
          // so telling a reader with no fonts.json to pull again is sound. A
          // file that is present but unparseable is not the missing case and
          // does not trip that check, so that branch says to remove it first.
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
  lines.push(`- ${code(`${pull.componentSpecsDir}/`)}: one YAML per component.`);
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
  lines.push('# Spec Layer: design-system context for this repository', '');
  lines.push(
    'The Spec Layer Figma plugin publishes a design system\'s components, variables, and styles as data. The '
    + `${code('spec-layer')} CLI (version ${input.version}) pulls that data into this repository under ${code(outDir + '/')}. `
    + 'Everything in those files is extracted deterministically from Figma and validated against a published schema, '
    + `with two exceptions that can carry model-written prose: a component's or the foundation's ${code('guidelines')} `
    + `block, marked ${code('origin: generated')}, and a token group's ${code('$description')}, which carries no marker `
    + 'and can be model-written even though it looks like an ordinary field. Treat the rest as the source of truth '
    + 'for what the design system contains, and treat anything it does not state as unknown rather than as something '
    + 'to infer.',
    '',
  );
  const componentSpecsDir = input.pull?.componentSpecsDir ?? input.config?.componentSpecsDir ?? DEFAULT_COMPONENT_SPECS_DIR;
  lines.push('## How to use it', '');
  lines.push(`1. Run ${code('npx spec-layer status')}. Exit 0 means the local copy is current; exit 2 means run ${code('npx spec-layer pull')} first.`);
  lines.push(`2. Building or changing a component: read its YAML under ${code(`${componentSpecsDir}/`)}, or ${code('npx spec-layer show component NAME')}. ${code('api')} gives variants, states, booleans, and slots; ${code('anatomy')} names the parts; ${code('references.bindings')} says which token each part's property uses and under which ${code('when')} conditions; ${code('unbound')} lists values that are hardcoded in Figma.`);
  lines.push(`3. Working with colors, spacing, type, or effects: start at ${code(`${outDir}/tokens/resolver.json`)}, load the set and mode files it names, and look up ${code('code_syntax')} in ${code('spec-layer.meta.json')} for the name the designer declared for your platform.`);
  lines.push(`4. Reference tokens by name in code; never paste a resolved value where a token exists. A value the design system does not define is not a token: say so in your change rather than adding one.`);
  lines.push(`5. An ${code('unbound')} entry is design debt reported from Figma. Do not silently promote it to a token; keep the literal and note that Figma has no binding for it.`);
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
 * so the guide lives between two markers and only that region is ever
 * replaced. A file without the markers gets the block appended; a missing
 * file is created holding just the block.
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
  const sep = existing.length === 0 ? '' : existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  return `${existing}${sep}${block}`;
}

export type InstallOutcome = {
  path: string;
  result: 'created' | 'updated' | 'unchanged';
  /** Directories from a downloaded snapshot left beside the file this install
   *  replaced. The plugin's download and this command both write
   *  `.claude/skills/spec-layer/`, so a guide that points at the pulled files
   *  can end up sitting next to a snapshot's data folders that it never
   *  mentions. Reported so the command can say so; never deleted here, since
   *  the CLI does not own files it did not write. */
  staleSnapshot: string[];
};

/** The folders a downloaded snapshot writes beside its SKILL.md. */
const SNAPSHOT_DIRS = ['components', 'tokens'];

function staleSnapshotDirs(cwd: string, target: InstallTarget): string[] {
  if (target.host !== 'claude') return [];
  const dir = dirname(target.path);
  return SNAPSHOT_DIRS
    .map((name) => `${dir}/${name}`)
    .filter((rel) => existsSync(join(cwd, rel)));
}

export function installSkill(cwd: string, host: AgentHost, guide: string): InstallOutcome {
  const target = installTarget(host);
  const abs = join(cwd, target.path);
  const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  const staleSnapshot = staleSnapshotDirs(cwd, target);
  const next = target.mode === 'file' ? renderForHost(host, guide) : upsertBlock(existing, renderForHost(host, guide));
  if (existing === next) return { path: target.path, result: 'unchanged', staleSnapshot };
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, next);
  return { path: target.path, result: existing === null ? 'created' : 'updated', staleSnapshot };
}
