import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectRepo, majorOf, CODE_SYNTAX_KEY, isAgentHost, isPlatform, missingFontSources,
  missingFontSourcesInRepo, readFontRepoSignals, type RepoSignals,
} from '../src/detect';

describe('detectRepo', () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'sl-detect-')); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  const pkg = (deps: Record<string, string>, dev: Record<string, string> = {}) =>
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies: deps, devDependencies: dev }));

  it('reports nothing for an empty directory, with no evidence', () => {
    expect(detectRepo(cwd)).toEqual({
      platforms: [], languages: [], frameworks: [], tokenTools: [], agents: [],
      styleDictionaryMajor: null, evidence: [],
    });
  });

  it('reads a web stack from package.json and names the file behind each signal', () => {
    pkg({ react: '^18', tailwindcss: '^3' }, { 'style-dictionary': '^4.3.0', typescript: '^5' });
    writeFileSync(join(cwd, 'tsconfig.json'), '{}');
    const profile = detectRepo(cwd);
    expect(profile.platforms).toEqual(['web']);
    expect(profile.frameworks).toEqual(['react']);
    expect(profile.tokenTools).toEqual(['style-dictionary', 'tailwind']);
    expect(profile.languages).toEqual(['javascript', 'typescript']);
    expect(profile.styleDictionaryMajor).toBe(4);
    for (const e of profile.evidence) expect(['package.json', 'tsconfig.json']).toContain(e.file);
    expect(profile.evidence).toContainEqual({ signal: 'react dependency', file: 'package.json' });
  });

  it('reads iOS and Android from build files, in a fixed order', () => {
    writeFileSync(join(cwd, 'build.gradle.kts'), '');
    writeFileSync(join(cwd, 'Package.swift'), '');
    const profile = detectRepo(cwd);
    expect(profile.platforms).toEqual(['ios', 'android']);
    expect(profile.languages).toEqual(['kotlin', 'swift']);
  });

  it('treats React Native as both stores and pubspec as Flutter', () => {
    pkg({ 'react-native': '0.75.0' });
    writeFileSync(join(cwd, 'pubspec.yaml'), '');
    expect(detectRepo(cwd).platforms).toEqual(['ios', 'android', 'flutter']);
  });

  it('finds every agent host it knows, in a fixed order', () => {
    mkdirSync(join(cwd, '.claude'));
    mkdirSync(join(cwd, '.cursor'));
    mkdirSync(join(cwd, '.github', 'instructions'), { recursive: true });
    writeFileSync(join(cwd, 'AGENTS.md'), '');
    writeFileSync(join(cwd, 'GEMINI.md'), '');
    writeFileSync(join(cwd, '.windsurfrules'), '');
    expect(detectRepo(cwd).agents).toEqual(['claude', 'cursor', 'copilot', 'windsurf', 'gemini', 'agents-md']);
  });

  it('ignores an unreadable package.json rather than throwing', () => {
    writeFileSync(join(cwd, 'package.json'), '{not json');
    const profile = detectRepo(cwd);
    expect(profile.frameworks).toEqual([]);
    // The file itself is still evidence of an npm package.
    expect(profile.evidence).toContainEqual({ signal: 'npm package', file: 'package.json' });
  });

  it('never looks below the root', () => {
    mkdirSync(join(cwd, 'ios'));
    writeFileSync(join(cwd, 'ios', 'Podfile'), '');
    expect(detectRepo(cwd).platforms).toEqual([]);
  });
});

describe('helpers', () => {
  it('majorOf reads the leading major of common range forms', () => {
    expect(majorOf('^4.3.0')).toBe(4);
    expect(majorOf('~5.1')).toBe(5);
    expect(majorOf('5')).toBe(5);
    expect(majorOf('>=4 <6')).toBe(4);
    expect(majorOf('workspace:*')).toBeNull();
    expect(majorOf('latest')).toBeNull();
  });

  it('maps platforms to the Figma code_syntax key, and Flutter to none', () => {
    expect(CODE_SYNTAX_KEY).toEqual({ web: 'WEB', ios: 'iOS', android: 'ANDROID', flutter: null });
  });

  it('guards flag values', () => {
    expect(isPlatform('web')).toBe(true);
    expect(isPlatform('Web')).toBe(false);
    expect(isAgentHost('agents-md')).toBe(true);
    expect(isAgentHost('codex')).toBe(false);
  });
});

describe('missingFontSources', () => {
  const empty: RepoSignals = { packageJson: {}, cssText: '', htmlText: '' };

  it('reports a family nothing in the repository loads', () => {
    expect(missingFontSources(['Open Sans'], empty)).toEqual(['Open Sans']);
  });

  it('accepts a @fontsource package', () => {
    expect(missingFontSources(['Open Sans'], {
      ...empty, packageJson: { dependencies: { '@fontsource/open-sans': '^5.0.0' } },
    })).toEqual([]);
  });

  it('accepts a font package in devDependencies too', () => {
    expect(missingFontSources(['Open Sans'], {
      ...empty, packageJson: { devDependencies: { '@fontsource/open-sans': '^5.0.0' } },
    })).toEqual([]);
  });

  it('accepts a bare, unscoped package named exactly the family slug', () => {
    expect(missingFontSources(['Open Sans'], {
      ...empty, packageJson: { dependencies: { 'open-sans': '^1.0.0' } },
    })).toEqual([]);
  });

  it('accepts an @font-face rule naming the family', () => {
    expect(missingFontSources(['Open Sans'], {
      ...empty, cssText: '@font-face { font-family: "Open Sans"; src: url(a.woff2); }',
    })).toEqual([]);
  });

  it('accepts a Google Fonts link', () => {
    expect(missingFontSources(['Open Sans'], {
      ...empty, htmlText: '<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600">',
    })).toEqual([]);
  });

  it('checks every family independently, in one pass', () => {
    expect(missingFontSources(['Open Sans', 'Inter'], {
      ...empty, packageJson: { dependencies: { '@fontsource/open-sans': '^5.0.0' } },
    })).toEqual(['Inter']);
  });

  // A font package for a longer, different family name must not cover a
  // shorter one that happens to be its prefix -- Fontsource really does
  // publish "Open Sans Condensed" as a separate package from "Open Sans".
  it('does not let a package for a longer family name cover a shorter one', () => {
    expect(missingFontSources(['Open Sans'], {
      ...empty, packageJson: { dependencies: { '@fontsource/open-sans-condensed': '^5.0.0' } },
    })).toEqual(['Open Sans']);
  });

  // Same risk in CSS: an @font-face rule for "Inter Tight" must not be read
  // as covering the family "Inter".
  it('does not let an @font-face rule for a longer family name cover a shorter one', () => {
    expect(missingFontSources(['Inter'], {
      ...empty, cssText: '@font-face { font-family: "Inter Tight"; src: url(a.woff2); }',
    })).toEqual(['Inter']);
  });

  // Same risk in a Google Fonts link: "Open+Sans+Condensed" must not be read
  // as covering "Open Sans".
  it('does not let a Google Fonts link for a longer family name cover a shorter one', () => {
    expect(missingFontSources(['Open Sans'], {
      ...empty, htmlText: '<link href="https://fonts.googleapis.com/css2?family=Open+Sans+Condensed:wght@400">',
    })).toEqual(['Open Sans']);
  });

  // CodeQL js/incomplete-url-substring-sanitization, high, on PR #61. The
  // host was searched for as a substring, so any other host carrying
  // "fonts.googleapis.com" in its own path or query read as a match. A false
  // "present" is the costly direction: it tells a developer a font is loaded
  // when nothing loads it.
  it('does not accept another host that merely mentions the Google Fonts host', () => {
    expect(missingFontSources(['Open Sans'], {
      ...empty,
      htmlText: '<link href="https://cdn.example.com/fonts.googleapis.com/css2?family=Open+Sans">',
    })).toEqual(['Open Sans']);
  });

  it('does not accept the Google Fonts host in a query parameter of another host', () => {
    expect(missingFontSources(['Open Sans'], {
      ...empty,
      htmlText: '<a href="https://evil.example/?next=fonts.googleapis.com/css2?family=Open+Sans">x</a>',
    })).toEqual(['Open Sans']);
  });

  it('accepts a protocol-relative Google Fonts link', () => {
    expect(missingFontSources(['Open Sans'], {
      ...empty, htmlText: '<link href="//fonts.googleapis.com/css2?family=Open+Sans:wght@400">',
    })).toEqual([]);
  });

  it('accepts a family that is the second one in a Google Fonts link', () => {
    expect(missingFontSources(['Open Sans'], {
      ...empty,
      htmlText: '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400&family=Open+Sans:wght@600">',
    })).toEqual([]);
  });

  it('matches a package dependency name regardless of case', () => {
    expect(missingFontSources(['Open Sans'], {
      ...empty, packageJson: { dependencies: { '@FontSource/Open-Sans': '^5.0.0' } },
    })).toEqual([]);
  });

  // Deliberate design choice, not a bug: the CSS and Google Fonts routes do
  // not fold case, so a differently-cased family in the repository is left
  // unproven. That only ever costs the safe direction -- one more "missing"
  // a developer can dismiss at a glance -- never a false "present".
  it('does not fold case for an @font-face rule', () => {
    expect(missingFontSources(['Open Sans'], {
      ...empty, cssText: '@font-face { font-family: "OPEN SANS"; src: url(a.woff2); }',
    })).toEqual(['Open Sans']);
  });

  it('does not fold case for a Google Fonts link', () => {
    expect(missingFontSources(['Open Sans'], {
      ...empty, htmlText: '<link href="https://fonts.googleapis.com/css2?family=open+sans:wght@400">',
    })).toEqual(['Open Sans']);
  });
});

describe('readFontRepoSignals / missingFontSourcesInRepo (real repository root)', () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'sl-fontrepo-')); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  // The two directions that matter: found via a real root CSS file, and
  // reported missing when nothing in the repository loads it at all.
  it('finds a family from a @font-face rule in a root CSS file', () => {
    writeFileSync(join(cwd, 'styles.css'), '@font-face { font-family: "Open Sans"; src: url(a.woff2); }');
    expect(missingFontSourcesInRepo(['Open Sans'], cwd)).toEqual([]);
  });

  it('reports a family missing from a real, empty repository', () => {
    expect(missingFontSourcesInRepo(['Open Sans'], cwd)).toEqual(['Open Sans']);
  });

  it('finds a family from a package.json dependency in a real repository', () => {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({
      dependencies: { '@fontsource/open-sans': '^5.0.0' },
    }));
    expect(missingFontSourcesInRepo(['Open Sans'], cwd)).toEqual([]);
  });

  it('finds a family from index.html at the repository root (Vite convention)', () => {
    writeFileSync(join(cwd, 'index.html'),
      '<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600">');
    expect(missingFontSourcesInRepo(['Open Sans'], cwd)).toEqual([]);
  });

  it('finds a family from public/index.html (create-react-app convention)', () => {
    mkdirSync(join(cwd, 'public'));
    writeFileSync(join(cwd, 'public', 'index.html'),
      '<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600">');
    expect(missingFontSourcesInRepo(['Open Sans'], cwd)).toEqual([]);
  });

  it('concatenates every root-level CSS file, not just the first', () => {
    writeFileSync(join(cwd, 'a.css'), 'body { color: red; }');
    writeFileSync(join(cwd, 'b.css'), '@font-face { font-family: "Open Sans"; src: url(a.woff2); }');
    expect(missingFontSourcesInRepo(['Open Sans'], cwd)).toEqual([]);
  });

  it('does not look below the root for CSS or HTML', () => {
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'index.css'), '@font-face { font-family: "Open Sans"; src: url(a.woff2); }');
    expect(missingFontSourcesInRepo(['Open Sans'], cwd)).toEqual(['Open Sans']);
  });

  it('never throws on an unreadable or absent package.json', () => {
    writeFileSync(join(cwd, 'package.json'), '{not json');
    expect(() => readFontRepoSignals(cwd)).not.toThrow();
    expect(missingFontSourcesInRepo(['Open Sans'], cwd)).toEqual(['Open Sans']);
  });

  it('reads dependencies and devDependencies apart, not merged into detect.ts\'s own shape', () => {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0' },
      devDependencies: { '@fontsource/open-sans': '^5.0.0' },
    }));
    const signals = readFontRepoSignals(cwd);
    expect(signals.packageJson.dependencies).toEqual({ react: '^18.0.0' });
    expect(signals.packageJson.devDependencies).toEqual({ '@fontsource/open-sans': '^5.0.0' });
  });
});
