import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DtcgReportEntry, DtcgResolverDocument } from '@spec-layer/extractor';
import type { CliConfig } from './config';
import { CREDENTIALS_NAME } from './credentials';
import {
  CODE_SYNTAX_KEY, type AgentHost, type Platform, type RepoProfile,
} from './detect';
import type { Manifest } from './files';
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
  components: Array<{ name: string; path: string | null }>;
  foundation: {
    written: boolean;
    sets: string[];
    modifiers: Array<{ name: string; contexts: string[]; default: string | null }>;
    tokenFiles: string[];
    /** Tokens exported as plain numbers because their Figma scopes state no unit. */
    unitlessNumbers: number;
    reportCounts: Record<string, number>;
  } | null;
  outputs: Array<{
    platform: string; format: string; path: string; case: string; modeSelector: string; modes: Record<string, string>;
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

function countNumberTokens(tree: unknown): number {
  if (typeof tree !== 'object' || tree === null || Array.isArray(tree)) return 0;
  const record = tree as Record<string, unknown>;
  if (record.$type === 'number' && '$value' in record) return 1;
  let n = 0;
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('$')) continue;
    n += countNumberTokens(value);
  }
  return n;
}

function readJson(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/** What the last pull left under outDir, or null when there is none. Never throws. */
export function summarizePull(cwd: string, outDir: string, manifest: Manifest | null): PullSummary | null {
  if (!manifest) return null;
  const absOut = join(cwd, outDir);
  const components = manifest.artifacts
    .filter((a) => a.kind === 'component')
    .map((a) => ({ name: a.name, path: a.path ? `${outDir}/${a.path}` : null }));
  const foundationEntry = manifest.artifacts.find((a) => a.kind === 'foundation') ?? null;
  let foundation: PullSummary['foundation'] = null;
  if (foundationEntry) {
    const tokensDir = join(absOut, 'tokens');
    const resolver = readJson(join(tokensDir, 'resolver.json')) as DtcgResolverDocument | null;
    const report = readJson(join(tokensDir, 'report.json'));
    let tokenFiles: string[] = [];
    try { tokenFiles = readdirSync(tokensDir).filter((f) => f.endsWith('.json') && !RESERVED.has(f)).sort(); } catch { tokenFiles = []; }
    let unitlessNumbers = 0;
    for (const file of tokenFiles) {
      if (file.startsWith('styles.')) continue;
      unitlessNumbers += countNumberTokens(readJson(join(tokensDir, file)));
    }
    const reportCounts: Record<string, number> = {};
    if (Array.isArray(report)) {
      for (const entry of report as DtcgReportEntry[]) {
        if (typeof entry?.code === 'string') reportCounts[entry.code] = (reportCounts[entry.code] ?? 0) + 1;
      }
    }
    foundation = {
      written: foundationEntry.path !== null && resolver !== null,
      sets: resolver ? Object.keys(resolver.sets ?? {}) : [],
      modifiers: resolver
        ? Object.entries(resolver.modifiers ?? {}).map(([name, m]) => ({
          name, contexts: Object.keys(m.contexts ?? {}), default: m.default ?? null,
        }))
        : [],
      tokenFiles, unitlessNumbers, reportCounts,
    };
  }
  return {
    outDir, libraryId: manifest.libraryId, publishedAt: manifest.publishedAt,
    pluginVersion: manifest.pluginVersion, components, foundation,
    outputs: (manifest.outputs ?? []).map((o) => ({
      platform: o.platform, format: o.format, path: o.path, case: o.case,
      modeSelector: o.modeSelector ?? '[data-theme="{mode}"]', modes: o.modes ?? {},
    })),
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

  for (const platform of platforms) {
    const key = CODE_SYNTAX_KEY[platform];
    const tokensDir = `${input.outDir}/tokens/`;
    if (platform === 'web') {
      lines.push('### Web', '');
      const cssOut = pull?.outputs.find((o) => o.platform === 'web' && o.format === 'css') ?? null;
      const mapPath = `${input.outDir}/outputs/web-css.map.json`;
      lines.push(
        `The CSS custom property for every token is in ${code(mapPath)}: `
        + 'source "code_syntax" when the designer declared it in Figma, "derived" when the CLI built it from the DTCG path '
        + `by the stated rule (${cssOut ? cssOut.case : 'kebab'} case, collection root included). Use those names; never invent a third. `
        + `${code(`${tokensDir}spec-layer.meta.json`)} still holds the raw ${code('code_syntax.WEB')} the designer declared.`,
        '',
      );
      if (cssOut) {
        lines.push(
          `Import ${code(cssOut.path)} from the root stylesheet. It holds every set and every default mode at ${code(':root')}; `
          + `every other mode is a block under ${code(cssOut.modeSelector)}. To switch, set ${code('data-theme')} on ${code('<html>')} `
          + '(or whatever the selector names). Wire it to prefers-color-scheme yourself if the OS should choose; the file never assumes that.',
          '',
        );
        if (profile.tokenTools.includes('style-dictionary') || profile.tokenTools.includes('tokens-studio')) {
          lines.push(
            `${code(cssOut.path)} is a projection of the same ${code('tokens/')} files, not a second source. Import one or the other.`,
            '',
          );
        }
      } else if (pull?.foundation?.written) {
        lines.push(
          'No token file was written for web. Add `"outputs"` in `speclayer.json` (or run `spec-layer pull --platform web` once) '
          + `and pull again; the default lands at ${code('spec-layer/tokens.css')}.`,
          '',
        );
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

  if (pull?.foundation && pull.foundation.unitlessNumbers > 0) {
    const n = pull.foundation.unitlessNumbers;
    lines.push(
      `${n} token${n === 1 ? ' is' : 's are'} exported as ${code('$type: "number"')} because the Figma scopes state no unit. `
      + `If your code needs them as px or rem, declare it in ${code('speclayer.json')}: `
      + `${code('"dtcg": { "units": { "<Collection>/<name glob>": "px" } }')}, then run ${code('spec-layer pull')}. `
      + `Nothing is inferred from a name; an override that contradicts a stated scope is ignored and listed in ${code('report.json')}.`,
      '',
    );
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
  lines.push(`- ${code(`${outDir}/components/`)}: one YAML per component.`);
  for (const o of pull.outputs) {
    lines.push(`- ${code(o.path)}: ${o.platform}/${o.format} token file, ${o.case} names, modes under ${code(o.modeSelector)}.`
      + ` Names and provenance: ${code(`${outDir}/outputs/${o.platform}-${o.format}.map.json`)}; what it could not express: ${code(`${outDir}/outputs/${o.platform}-${o.format}.report.json`)}.`);
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
    + 'Everything in those files is extracted deterministically from Figma and validated against a published schema; '
    + 'no model wrote any of it. Treat it as the source of truth for what the design system contains, and treat anything it '
    + 'does not state as unknown rather than as something to infer.',
    '',
  );
  lines.push('## How to use it', '');
  lines.push(`1. Run ${code('npx spec-layer status')}. Exit 0 means the local copy is current; exit 2 means run ${code('npx spec-layer pull')} first.`);
  lines.push(`2. Building or changing a component: read its YAML under ${code(`${outDir}/components/`)}, or ${code('npx spec-layer show component NAME')}. ${code('api')} gives variants, states, booleans, and slots; ${code('anatomy')} names the parts; ${code('references.bindings')} says which token each part's property uses and under which ${code('when')} conditions; ${code('unbound')} lists values that are hardcoded in Figma.`);
  lines.push(`3. Working with colors, spacing, type, or effects: start at ${code(`${outDir}/tokens/resolver.json`)}, load the set and mode files it names, and look up ${code('code_syntax')} in ${code('spec-layer.meta.json')} for the name the designer declared for your platform.`);
  lines.push(`4. Reference tokens by name in code; never paste a resolved value where a token exists. A value the design system does not define is not a token: say so in your change rather than adding one.`);
  lines.push(`5. An ${code('unbound')} entry is design debt reported from Figma. Do not silently promote it to a token; keep the literal and note that Figma has no binding for it.`);
  const outputNote = input.pull?.outputs.length
    ? ` Never edit ${input.pull.outputs.map((o) => code(o.path)).join(', ')} either: pull replaces ${input.pull.outputs.length === 1 ? 'it' : 'them'} in place.`
    : '';
  lines.push(`6. Never edit files under ${code(outDir + '/')}: the next pull replaces the whole directory.${outputNote} Configuration lives in ${code('speclayer.json')}. Never commit ${code(CREDENTIALS_NAME)}, and never print or copy the pull key.`);
  lines.push('');
  lines.push(...pullSection(input));
  lines.push(...stackSection(input));
  lines.push(...commandsSection());
  lines.push(`Generated by ${code('spec-layer skill')}. Re-run ${code('npx spec-layer skill --install')} after a pull that adds components or when the codebase changes stack; the file is replaced, not appended.`);
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

export type InstallOutcome = { path: string; result: 'created' | 'updated' | 'unchanged' };

export function installSkill(cwd: string, host: AgentHost, guide: string): InstallOutcome {
  const target = installTarget(host);
  const abs = join(cwd, target.path);
  const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  const next = target.mode === 'file' ? renderForHost(host, guide) : upsertBlock(existing, renderForHost(host, guide));
  if (existing === next) return { path: target.path, result: 'unchanged' };
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, next);
  return { path: target.path, result: existing === null ? 'created' : 'updated' };
}
