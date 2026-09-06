import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectRepo, majorOf, CODE_SYNTAX_KEY, isAgentHost, isPlatform } from '../src/detect';

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
