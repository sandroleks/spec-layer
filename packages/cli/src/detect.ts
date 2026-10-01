import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the repository looks like, from the top level of the working directory
 * only: no tree walk, no imports, no file contents beyond package.json's
 * dependency names. Deterministic, and every conclusion names its file. An
 * unreadable codebase reports nothing rather than a plausible default.
 */

export type Platform = 'web' | 'ios' | 'android' | 'flutter';
export type AgentHost = 'claude' | 'cursor' | 'copilot' | 'windsurf' | 'gemini' | 'agents-md';

export interface Evidence {
  /** What the file proves, in a short phrase, e.g. "react dependency". */
  signal: string;
  file: string;
}

export interface RepoProfile {
  /** Deterministic order: web, ios, android, flutter. */
  platforms: Platform[];
  languages: string[];
  frameworks: string[];
  /** Token pipelines already present: style-dictionary, tokens-studio, tailwind. */
  tokenTools: string[];
  /** Coding agents this repository is already configured for. */
  agents: AgentHost[];
  /** Style Dictionary major version from package.json, when declared and readable. */
  styleDictionaryMajor: number | null;
  evidence: Evidence[];
}

/** The Figma `code_syntax` key each platform reads. Flutter has none in Figma. */
export const CODE_SYNTAX_KEY: Record<Platform, string | null> = {
  web: 'WEB', ios: 'iOS', android: 'ANDROID', flutter: null,
};

export const PLATFORMS: readonly Platform[] = ['web', 'ios', 'android', 'flutter'];
export const AGENT_HOSTS: readonly AgentHost[] = ['claude', 'cursor', 'copilot', 'windsurf', 'gemini', 'agents-md'];

const uniq = <T,>(xs: T[]): T[] => [...new Set(xs)];

/** A JSON file's top-level object, or null when missing, invalid, or not an object. */
function readJsonObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  return parsed as Record<string, unknown>;
}

function readPackageJson(cwd: string): { deps: Record<string, string> } | null {
  const record = readJsonObject(join(cwd, 'package.json'));
  if (!record) return null;
  const deps: Record<string, string> = {};
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const block = record[field];
    if (typeof block !== 'object' || block === null) continue;
    for (const [name, range] of Object.entries(block as Record<string, unknown>)) {
      if (typeof range === 'string') deps[name] = range;
    }
  }
  return { deps };
}

/** "^4.3.0", "~5.1", "5", ">=4" all read as their leading major; anything else is null. */
export function majorOf(range: string): number | null {
  const m = /^[\^~>=<\s]*v?(\d+)/.exec(range.trim());
  return m ? Number(m[1]) : null;
}

/** package.json dependency name -> what it says about the repo. */
const DEP_SIGNALS: Array<{
  dep: string; platform?: Platform; framework?: string; tokenTool?: string; language?: string;
}> = [
  { dep: 'react', platform: 'web', framework: 'react' },
  { dep: 'next', platform: 'web', framework: 'next' },
  { dep: 'vue', platform: 'web', framework: 'vue' },
  { dep: 'nuxt', platform: 'web', framework: 'nuxt' },
  { dep: 'svelte', platform: 'web', framework: 'svelte' },
  { dep: '@sveltejs/kit', platform: 'web', framework: 'sveltekit' },
  { dep: '@angular/core', platform: 'web', framework: 'angular' },
  { dep: 'solid-js', platform: 'web', framework: 'solid' },
  { dep: 'lit', platform: 'web', framework: 'lit' },
  { dep: 'astro', platform: 'web', framework: 'astro' },
  { dep: 'react-native', platform: 'ios', framework: 'react-native' },
  { dep: 'expo', platform: 'ios', framework: 'expo' },
  { dep: 'tailwindcss', platform: 'web', tokenTool: 'tailwind' },
  { dep: 'styled-components', platform: 'web', framework: 'styled-components' },
  { dep: '@emotion/react', platform: 'web', framework: 'emotion' },
  { dep: 'sass', platform: 'web', framework: 'sass' },
  { dep: '@vanilla-extract/css', platform: 'web', framework: 'vanilla-extract' },
  { dep: '@stitches/react', platform: 'web', framework: 'stitches' },
  { dep: '@pandacss/dev', platform: 'web', framework: 'panda' },
  { dep: 'style-dictionary', tokenTool: 'style-dictionary' },
  { dep: '@tokens-studio/sd-transforms', tokenTool: 'tokens-studio' },
  { dep: 'typescript', language: 'typescript' },
];

/** Root file or directory name -> what it says about the repo. */
const FILE_SIGNALS: Array<{
  test: (name: string) => boolean; signal: string;
  platform?: Platform; language?: string; framework?: string; tokenTool?: string; agent?: AgentHost;
}> = [
  { test: (n) => n === 'Package.swift', signal: 'Swift package', platform: 'ios', language: 'swift' },
  { test: (n) => n.endsWith('.xcodeproj') || n.endsWith('.xcworkspace'), signal: 'Xcode project', platform: 'ios', language: 'swift' },
  { test: (n) => n === 'Podfile', signal: 'CocoaPods', platform: 'ios' },
  { test: (n) => /^build\.gradle(\.kts)?$/.test(n) || /^settings\.gradle(\.kts)?$/.test(n), signal: 'Gradle build', platform: 'android', language: 'kotlin' },
  { test: (n) => n === 'AndroidManifest.xml', signal: 'Android manifest', platform: 'android' },
  { test: (n) => n === 'pubspec.yaml', signal: 'Flutter or Dart package', platform: 'flutter', language: 'dart' },
  { test: (n) => n === 'tsconfig.json', signal: 'TypeScript config', language: 'typescript' },
  { test: (n) => n === 'package.json', signal: 'npm package', language: 'javascript' },
  { test: (n) => n === 'deno.json' || n === 'deno.jsonc', signal: 'Deno config', language: 'typescript' },
  { test: (n) => n === 'Cargo.toml', signal: 'Cargo manifest', language: 'rust' },
  { test: (n) => n === 'go.mod', signal: 'Go module', language: 'go' },
  { test: (n) => n === 'pyproject.toml' || n === 'requirements.txt', signal: 'Python project', language: 'python' },
  { test: (n) => n === 'Gemfile', signal: 'Ruby bundle', language: 'ruby' },
  { test: (n) => n === 'composer.json', signal: 'Composer package', language: 'php' },
  { test: (n) => n.endsWith('.csproj') || n.endsWith('.sln'), signal: '.NET project', language: 'csharp' },
  { test: (n) => n === 'pom.xml', signal: 'Maven build', language: 'java' },
  { test: (n) => /^tailwind\.config\.(js|cjs|mjs|ts)$/.test(n), signal: 'Tailwind config', platform: 'web', tokenTool: 'tailwind' },
  { test: (n) => /^(style-dictionary\.config|sd\.config)\.(js|cjs|mjs|ts|json)$/.test(n), signal: 'Style Dictionary config', tokenTool: 'style-dictionary' },
  { test: (n) => n === 'index.html' || n === 'vite.config.ts' || n === 'vite.config.js', signal: 'web entry', platform: 'web' },
  { test: (n) => n === 'CLAUDE.md' || n === '.claude', signal: 'Claude Code', agent: 'claude' },
  { test: (n) => n === '.cursor' || n === '.cursorrules', signal: 'Cursor', agent: 'cursor' },
  { test: (n) => n === '.windsurf' || n === '.windsurfrules', signal: 'Windsurf', agent: 'windsurf' },
  { test: (n) => n === 'GEMINI.md', signal: 'Gemini CLI', agent: 'gemini' },
  { test: (n) => n === 'AGENTS.md', signal: 'AGENTS.md', agent: 'agents-md' },
];

export function detectRepo(cwd: string): RepoProfile {
  const platforms: Platform[] = [];
  const languages: string[] = [];
  const frameworks: string[] = [];
  const tokenTools: string[] = [];
  const agents: AgentHost[] = [];
  const evidence: Evidence[] = [];
  let styleDictionaryMajor: number | null = null;

  let names: string[] = [];
  try { names = readdirSync(cwd).sort(); } catch { names = []; }

  for (const name of names) {
    for (const rule of FILE_SIGNALS) {
      if (!rule.test(name)) continue;
      evidence.push({ signal: rule.signal, file: name });
      if (rule.platform) platforms.push(rule.platform);
      if (rule.language) languages.push(rule.language);
      if (rule.framework) frameworks.push(rule.framework);
      if (rule.tokenTool) tokenTools.push(rule.tokenTool);
      if (rule.agent) agents.push(rule.agent);
    }
  }
  if (existsSync(join(cwd, '.github', 'copilot-instructions.md')) || existsSync(join(cwd, '.github', 'instructions'))) {
    evidence.push({ signal: 'GitHub Copilot', file: '.github/copilot-instructions.md' });
    agents.push('copilot');
  }

  const pkg = readPackageJson(cwd);
  if (pkg) {
    for (const rule of DEP_SIGNALS) {
      const range = pkg.deps[rule.dep];
      if (range === undefined) continue;
      evidence.push({ signal: `${rule.dep} dependency`, file: 'package.json' });
      if (rule.platform) platforms.push(rule.platform);
      if (rule.framework) frameworks.push(rule.framework);
      if (rule.tokenTool) tokenTools.push(rule.tokenTool);
      if (rule.language) languages.push(rule.language);
      if (rule.dep === 'style-dictionary') styleDictionaryMajor = majorOf(range);
    }
    // React Native and Expo ship to both stores; the file signals above only
    // say iOS, so add Android when either is present.
    if (pkg.deps['react-native'] !== undefined || pkg.deps.expo !== undefined) platforms.push('android');
  }

  const order = (p: Platform) => PLATFORMS.indexOf(p);
  const hostOrder = (a: AgentHost) => AGENT_HOSTS.indexOf(a);
  return {
    platforms: uniq(platforms).sort((a, b) => order(a) - order(b)),
    languages: uniq(languages).sort(),
    frameworks: uniq(frameworks).sort(),
    tokenTools: uniq(tokenTools).sort(),
    agents: uniq(agents).sort((a, b) => hostOrder(a) - hostOrder(b)),
    styleDictionaryMajor,
    evidence,
  };
}

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

export function isAgentHost(value: string): value is AgentHost {
  return (AGENT_HOSTS as readonly string[]).includes(value);
}

/**
 * Whether the repository loads a font family the tokens name; unlike the rest
 * of this file, this reads file contents. An unloaded family silently renders
 * as the browser default, which visual review misses.
 *
 * A false "missing" costs one glance; a false "present" ships the wrong font.
 * So every match is narrower than a substring search (`"Inter"` must not match
 * `"Inter Tight"`), and case is not folded for the CSS and Google Fonts routes.
 */
export interface RepoSignals {
  /** package.json's raw dependency maps, not the merged `deps` above. */
  packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  /** Concatenated CSS text; `readFontRepoSignals` fills it from the root. */
  cssText: string;
  /** Concatenated HTML text. */
  htmlText: string;
}

function fontPackageSlug(family: string): string {
  return family.toLowerCase().split(' ').join('-');
}

/**
 * `@fontsource/<slug>`, `@fontsource-variable/<slug>`, or a bare `<slug>`. Not
 * `.includes(slug)`, which matches `open-sans-condensed` for "Open Sans".
 */
function dependencyNamesFamily(dependencyName: string, slug: string): boolean {
  const lower = dependencyName.toLowerCase();
  return lower === slug || lower.endsWith(`/${slug}`);
}

/** An `@font-face` naming this exact family, quoted, so "Inter" never matches "Inter Tight". */
function cssNamesFamily(cssText: string, family: string): boolean {
  if (!cssText.includes('@font-face')) return false;
  return cssText.includes(`"${family}"`) || cssText.includes(`'${family}'`);
}

/**
 * A Google Fonts `family=` parameter naming this exact family. The host is
 * compared after parsing, since another host can carry `fonts.googleapis.com`
 * in its path. `searchParams` ends a value at `&` and decodes `+`, so
 * "Open+Sans" never matches "Open+Sans+Condensed". Splitting on quotes yields
 * each attribute URL; no regex, since this runs over arbitrary repository HTML.
 */
function googleFontsLinkNamesFamily(htmlText: string, family: string): boolean {
  for (const quoted of htmlText.split('"')) {
    for (const fragment of quoted.split("'")) {
      const trimmed = fragment.trim();
      const candidate = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
      if (!candidate.startsWith('http')) continue;
      let url: URL;
      try {
        url = new URL(candidate);
      } catch {
        continue;
      }
      if (url.hostname !== 'fonts.googleapis.com') continue;
      for (const value of url.searchParams.getAll('family')) {
        if (value === family || value.startsWith(`${family}:`)) return true;
      }
    }
  }
  return false;
}

/**
 * The families with no loader in `repo`: no font package, no `@font-face`, no
 * Google Fonts link. Unmatched means missing, never assumed present.
 */
export function missingFontSources(families: string[], repo: RepoSignals): string[] {
  const dependencyNames = Object.keys({ ...repo.packageJson.dependencies, ...repo.packageJson.devDependencies });
  return families.filter((family) => {
    const slug = fontPackageSlug(family);
    if (dependencyNames.some((name) => dependencyNamesFamily(name, slug))) return false;
    if (cssNamesFamily(repo.cssText, family)) return false;
    if (googleFontsLinkNamesFamily(repo.htmlText, family)) return false;
    return true;
  });
}

/** One package.json dependency field, or `{}` when absent or malformed. Never throws. */
function dependencyField(record: Record<string, unknown> | null, field: string): Record<string, string> {
  const block = record?.[field];
  if (typeof block !== 'object' || block === null) return {};
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(block as Record<string, unknown>)) {
    if (typeof range === 'string') out[name] = range;
  }
  return out;
}

/** Root-level `*.css` files, concatenated. CSS under `src/` reads as none, the safe direction. */
function readRootCssText(cwd: string): string {
  let names: string[] = [];
  try { names = readdirSync(cwd); } catch { names = []; }
  const chunks: string[] = [];
  for (const name of names) {
    if (!name.endsWith('.css')) continue;
    try { chunks.push(readFileSync(join(cwd, name), 'utf8')); } catch { /* an unreadable file loads nothing */ }
  }
  return chunks.join('\n');
}

/** `index.html` (Vite) and `public/index.html` (create-react-app); elsewhere reads as none. */
function readEntryHtmlText(cwd: string): string {
  const chunks: string[] = [];
  for (const path of [join(cwd, 'index.html'), join(cwd, 'public', 'index.html')]) {
    try { if (existsSync(path)) chunks.push(readFileSync(path, 'utf8')); } catch { /* an unreadable file loads nothing */ }
  }
  return chunks.join('\n');
}

/**
 * `RepoSignals` from a repository root. A missing or unreadable file adds an
 * empty string, never an error: a pull must not fail for lack of `index.html`.
 */
export function readFontRepoSignals(cwd: string): RepoSignals {
  const record = readJsonObject(join(cwd, 'package.json'));
  return {
    packageJson: {
      dependencies: dependencyField(record, 'dependencies'),
      devDependencies: dependencyField(record, 'devDependencies'),
    },
    cssText: readRootCssText(cwd),
    htmlText: readEntryHtmlText(cwd),
  };
}

/** The families from `fonts.json` that nothing at `cwd` loads. */
export function missingFontSourcesInRepo(families: string[], cwd: string): string[] {
  return missingFontSources(families, readFontRepoSignals(cwd));
}
