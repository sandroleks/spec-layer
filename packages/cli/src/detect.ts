import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the repository the CLI runs in looks like, read from the top level of
 * the working directory only. Nothing here walks the tree, follows imports, or
 * guesses from file contents beyond package.json's dependency names, so the
 * result is the same on every machine and every run, and every conclusion
 * names the file that supports it. A codebase this cannot read reports
 * nothing rather than a plausible default; `spec-layer skill --platform`
 * overrides the target when the repo gives no signal.
 */

export type Platform = 'web' | 'ios' | 'android' | 'flutter';
export type AgentHost = 'claude' | 'cursor' | 'copilot' | 'windsurf' | 'gemini' | 'agents-md';

export interface Evidence {
  /** What the file proves, in a short phrase, e.g. "react dependency". */
  signal: string;
  /** The file at the repository root that carries the signal. */
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

function readPackageJson(cwd: string): { deps: Record<string, string> } | null {
  const path = join(cwd, 'package.json');
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
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
 * Whether the repository around a pull actually loads a font family the
 * tokens name -- and, unlike everything above, this does read file contents,
 * not just names and dependency ranges. A family with nothing loading it
 * renders as the browser default: on a real pull, every button rendered in
 * Times, `--typography-font-family-primary: "Open Sans"` measured
 * byte-identical in the browser to a bogus family name and to `serif`, and
 * four rounds of human visual review signed it off because color and size
 * were both fine. `missingFontSources` is the check that would have caught
 * it; gathering `RepoSignals` from an actual repository root (which files to
 * read the CSS and HTML from) is left to its caller, deliberately -- see the
 * task-7 report for why.
 *
 * The asymmetry that governs every match below: a false "missing" costs a
 * developer one glance at a report; a false "present" ships the Times-button
 * failure again. So each check is deliberately narrower than a bare
 * substring search -- a family that is itself a substring of a different,
 * real family (`"Sans"` inside `"Open Sans"`, `"Inter"` inside `"Inter
 * Tight"`, `"Open Sans"` inside `"Open Sans Condensed"`) must not read as
 * found. Case is intentionally NOT folded for the CSS and Google Fonts
 * routes: a differently-cased family in the repository is left unproven
 * rather than guessed at, which only ever costs the safe direction (one more
 * "missing" a developer can dismiss at a glance).
 */
export interface RepoSignals {
  /** package.json's own dependency maps, read raw -- not detect.ts's merged
   *  `deps` above, so a caller can keep dependencies and devDependencies
   *  apart if it ever needs to. */
  packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  /** Concatenated text of whatever CSS the caller decided to read. */
  cssText: string;
  /** Concatenated text of whatever HTML the caller decided to read. */
  htmlText: string;
}

/** No regex: a fixed, cheap string transform over a short, known family
 *  name, not a scan over arbitrary repository content. */
function fontPackageSlug(family: string): string {
  return family.toLowerCase().split(' ').join('-');
}

/** A fontsource-style package naming exactly this family:
 *  `@fontsource/<slug>`, `@fontsource-variable/<slug>`, or a bare `<slug>`.
 *  Deliberately not a plain `.includes(slug)`: that would also match
 *  `@fontsource/open-sans-condensed` for the family "Open Sans" -- a real,
 *  differently-named font on the same registry. */
function dependencyNamesFamily(dependencyName: string, slug: string): boolean {
  const lower = dependencyName.toLowerCase();
  return lower === slug || lower.endsWith(`/${slug}`);
}

/** An `@font-face` rule naming this exact family. CSS requires quotes around
 *  a multi-word `font-family` value, so requiring the quoted form is what
 *  keeps "Inter" from matching inside a rule that only names "Inter
 *  Tight". */
function cssNamesFamily(cssText: string, family: string): boolean {
  if (!cssText.includes('@font-face')) return false;
  return cssText.includes(`"${family}"`) || cssText.includes(`'${family}'`);
}

/** A Google Fonts `css2?family=` parameter naming this exact family.
 *  Bounding the match at the next `:` (a weight axis), `&` (the next
 *  family), a closing quote, or the end of the string is what keeps
 *  "Open+Sans" from matching inside a link that only loads
 *  "Open+Sans+Condensed". */
function googleFontsLinkNamesFamily(htmlText: string, family: string): boolean {
  if (!htmlText.includes('fonts.googleapis.com')) return false;
  const needle = `family=${family.split(' ').join('+')}`;
  if (htmlText.endsWith(needle)) return true;
  return ['"', "'", ':', '&'].some((terminator) => htmlText.includes(needle + terminator));
}

/**
 * The families with no loader found in `repo`. Three routes, checked in
 * order, no fourth: a font package in package.json, an `@font-face` rule, or
 * a Google Fonts link. When a family matches none of the three, it is
 * reported missing -- never assumed present.
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
