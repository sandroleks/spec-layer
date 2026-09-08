import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BLOCK_BEGIN, BLOCK_END, buildSkillGuide, installSkill, installTarget, renderForHost, upsertBlock,
  type SkillInput,
} from '../src/skill';
import type { RepoProfile } from '../src/detect';
import { AGENT_HOSTS } from '../src/detect';

const EMPTY_PROFILE: RepoProfile = {
  platforms: [], languages: [], frameworks: [], tokenTools: [], agents: [], styleDictionaryMajor: null, evidence: [],
};

function input(overrides: Partial<SkillInput> = {}): SkillInput {
  return {
    profile: EMPTY_PROFILE, platforms: [], platformSource: 'none', outDir: '.speclayer',
    config: null, pull: null, version: '0.5.0', ...overrides,
  };
}

const PULL: NonNullable<SkillInput['pull']> = {
  outDir: '.speclayer', libraryId: 'lib_x', publishedAt: '2026-09-01T00:00:00.000Z', pluginVersion: '5.0.0',
  components: [
    { name: 'Button', path: '.speclayer/components/button.yaml' },
    { name: 'Text field', path: null },
  ],
  foundation: {
    written: true,
    sets: ['Primitives'],
    modifiers: [{ name: 'Theme', contexts: ['Light', 'Dark'], default: 'Light' }],
    tokenFiles: ['primitives.default.json', 'theme.dark.json', 'theme.light.json'],
    unitlessNumbers: 3,
    reportCounts: { unit_not_expressible: 2 },
  },
  outputs: [],
};

const PULL_WITH_CSS: NonNullable<SkillInput['pull']> = {
  ...PULL,
  outputs: [{ platform: 'web', format: 'css', path: 'spec-layer/tokens.css', case: 'kebab', modeSelector: '[data-theme="{mode}"]', modes: {} }],
};

describe('buildSkillGuide', () => {
  it('says there is no pull and names nothing when nothing was pulled', () => {
    const guide = buildSkillGuide(input());
    expect(guide).toContain('No pull has been made in this directory yet');
    expect(guide).not.toContain('### Components');
    expect(guide).not.toContain('### Token collections');
  });

  it('lists the components, collections, modes, and token files from the pull', () => {
    const guide = buildSkillGuide(input({ pull: PULL }));
    expect(guide).toContain('- Button: `.speclayer/components/button.yaml`');
    expect(guide).toContain('- Text field: not written (excluded by the selection). `spec-layer show component "Text field"` prints it.');
    expect(guide).toContain('- `Primitives`: one mode, always applied.');
    expect(guide).toContain('- `Theme`: modes `Light`, `Dark`, default `Light`.');
    expect(guide).toContain('  - `theme.dark.json`');
    expect(guide).toContain('`report.json` lists 2 `unit_not_expressible`');
    expect(guide).toContain('Library `lib_x`, published 2026-09-01T00:00:00.000Z by plugin 5.0.0');
  });

  it('explains unitless numbers and points at the dtcg units block, without naming a unit as fact', () => {
    const guide = buildSkillGuide(input({ pull: PULL }));
    expect(guide).toContain('3 tokens are exported as `$type: "number"` because the Figma scopes state no unit.');
    expect(guide).toContain('Nothing is inferred from a name');
  });

  it('writes the generic paragraph and the --platform flag when nothing was detected', () => {
    const guide = buildSkillGuide(input());
    expect(guide).toContain('Nothing at the root of this directory identified a language, framework, or platform.');
    expect(guide).toContain('No target platform was detected');
    expect(guide).toContain('--platform web|ios|android|flutter');
    expect(guide).not.toContain('### Web');
  });

  it('writes platform sections for each target and names the code_syntax key', () => {
    const guide = buildSkillGuide(input({ platforms: ['ios', 'android', 'flutter'], platformSource: 'flag' }));
    expect(guide).toContain('Target platforms (chosen with --platform): ios, android, flutter.');
    expect(guide).toContain('`code_syntax.iOS`');
    expect(guide).toContain('`code_syntax.ANDROID`');
    expect(guide).toContain('Figma declares no code syntax for Flutter');
  });

  it('adapts the web section to Tailwind and to an old Style Dictionary', () => {
    const profile: RepoProfile = {
      ...EMPTY_PROFILE, platforms: ['web'], tokenTools: ['style-dictionary', 'tailwind'], styleDictionaryMajor: 4,
      evidence: [{ signal: 'tailwindcss dependency', file: 'package.json' }],
    };
    const guide = buildSkillGuide(input({ profile, platforms: ['web'], platformSource: 'detected' }));
    expect(guide).toContain('- tailwindcss dependency (`package.json`)');
    expect(guide).toContain('Tailwind is present');
    expect(guide).toContain('Style Dictionary 4 reads the string value forms');
    expect(guide).toContain('"dtcg": { "values": "legacy" }');
  });

  it('does not suggest legacy values for Style Dictionary 5', () => {
    const profile: RepoProfile = { ...EMPTY_PROFILE, platforms: ['web'], tokenTools: ['style-dictionary'], styleDictionaryMajor: 5 };
    const guide = buildSkillGuide(input({ profile, platforms: ['web'], platformSource: 'detected' }));
    expect(guide).toContain('Style Dictionary is present (major version 5 in package.json)');
    expect(guide).not.toContain('legacy');
  });

  it('carries the command table with every pipe escaped, and no em dash', () => {
    const guide = buildSkillGuide(input({ pull: PULL, platforms: ['web'], platformSource: 'detected' }));
    expect(guide).toContain('| `spec-layer show foundation \\| component NAME [--canonical] [--out DIR]` |');
    expect(guide).toContain('--only foundation\\|components');
    expect(guide).not.toContain('—');
    expect(guide).toContain('npx --yes spec-layer <command>');
  });

  it('uses the configured output directory in every path', () => {
    const pull = {
      ...PULL, outDir: 'design/context',
      components: PULL.components.map((c) => ({ ...c, path: c.path?.replace('.speclayer', 'design/context') ?? null })),
    };
    const guide = buildSkillGuide(input({ outDir: 'design/context', pull }));
    expect(guide).toContain('`design/context/tokens/resolver.json`');
    expect(guide).toContain('Never edit files under `design/context/`');
    // The flag reference still states the default; no path may use it.
    expect(guide).not.toMatch(/`\.speclayer\//);
  });
});

describe('buildSkillGuide outputs', () => {
  const web: RepoProfile = { ...EMPTY_PROFILE, platforms: ['web'] };

  it('tells the agent to import the css file, switch modes with data-theme, and read names from the map', () => {
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull: PULL_WITH_CSS }));
    expect(guide).toContain('- `spec-layer/tokens.css`: web/css token file, kebab names, modes under `[data-theme="{mode}"]`.');
    expect(guide).toContain('Import `spec-layer/tokens.css` from the root stylesheet');
    expect(guide).toContain('set `data-theme` on `<html>`');
    expect(guide).toContain('`.speclayer/outputs/web-css.map.json`');
    expect(guide).toContain('source "code_syntax" when the designer declared it in Figma, "derived" when the CLI built it from the DTCG path');
    expect(guide).not.toContain('derive nothing');
  });

  it('says the css is a projection of tokens/ when a pipeline is present', () => {
    const sd: RepoProfile = { ...web, tokenTools: ['style-dictionary'], styleDictionaryMajor: 5 };
    const guide = buildSkillGuide(input({ profile: sd, platforms: ['web'], platformSource: 'detected', pull: PULL_WITH_CSS }));
    expect(guide).toContain('`spec-layer/tokens.css` is a projection of the same `tokens/` files, not a second source. Import one or the other.');
  });

  it('names the flag when web is targeted but no output was written', () => {
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull: PULL }));
    expect(guide).toContain('No token file was written for web.');
    expect(guide).toContain('`"outputs"` in `speclayer.json`');
  });

  it('labels a platform that came from the config', () => {
    const guide = buildSkillGuide(input({ platforms: ['web'], platformSource: 'config', pull: PULL_WITH_CSS }));
    expect(guide).toContain('Target platform (set in speclayer.json): web.');
  });

  it('warns never to edit the output path in step 6', () => {
    const guide = buildSkillGuide(input({ pull: PULL_WITH_CSS }));
    expect(guide).toContain('Never edit `spec-layer/tokens.css` either: pull replaces it in place.');
  });
});

describe('renderForHost', () => {
  it('wraps the guide in the frontmatter each host expects', () => {
    const guide = '# G\n';
    expect(renderForHost('claude', guide)).toMatch(/^---\nname: spec-layer\ndescription: ".+"\n---\n\n# G\n$/);
    expect(renderForHost('cursor', guide)).toMatch(/^---\ndescription: ".+"\nalwaysApply: false\n---\n\n# G\n$/);
    expect(renderForHost('copilot', guide)).toMatch(/^---\napplyTo: "\*\*"\n---\n\n# G\n$/);
    expect(renderForHost('windsurf', guide)).toMatch(/^---\ntrigger: model_decision\ndescription: ".+"\n---\n\n# G\n$/);
    expect(renderForHost('agents-md', guide)).toBe(guide);
    expect(renderForHost('gemini', guide)).toBe(guide);
  });

  it('has a target for every host', () => {
    for (const host of AGENT_HOSTS) expect(installTarget(host).path.length).toBeGreaterThan(0);
    expect(installTarget('claude')).toEqual({ host: 'claude', path: '.claude/skills/spec-layer/SKILL.md', mode: 'file' });
    expect(installTarget('agents-md').mode).toBe('block');
  });
});

describe('upsertBlock', () => {
  it('creates a lone block for a missing file', () => {
    expect(upsertBlock(null, 'body\n')).toBe(`${BLOCK_BEGIN}\nbody\n${BLOCK_END}\n`);
  });

  it('appends after existing content with one blank line', () => {
    expect(upsertBlock('# Repo\n\nrules\n', 'body\n')).toBe(`# Repo\n\nrules\n\n${BLOCK_BEGIN}\nbody\n${BLOCK_END}\n`);
    expect(upsertBlock('no newline', 'body\n')).toBe(`no newline\n\n${BLOCK_BEGIN}\nbody\n${BLOCK_END}\n`);
  });

  it('replaces only the marked region and keeps what surrounds it', () => {
    const existing = `# Repo\n\n${BLOCK_BEGIN}\nold\n${BLOCK_END}\n\n## After\n`;
    expect(upsertBlock(existing, 'new\n')).toBe(`# Repo\n\n${BLOCK_BEGIN}\nnew\n${BLOCK_END}\n\n## After\n`);
  });

  it('is idempotent', () => {
    const once = upsertBlock('# Repo\n', 'body\n');
    expect(upsertBlock(once, 'body\n')).toBe(once);
  });
});

describe('installSkill', () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'sl-skill-')); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it('creates, then reports unchanged, then updates', () => {
    expect(installSkill(cwd, 'claude', 'a\n')).toEqual({ path: '.claude/skills/spec-layer/SKILL.md', result: 'created' });
    expect(existsSync(join(cwd, '.claude/skills/spec-layer/SKILL.md'))).toBe(true);
    expect(installSkill(cwd, 'claude', 'a\n').result).toBe('unchanged');
    expect(installSkill(cwd, 'claude', 'b\n').result).toBe('updated');
    expect(readFileSync(join(cwd, '.claude/skills/spec-layer/SKILL.md'), 'utf8')).toContain('\n\nb\n');
  });

  it('leaves the rest of AGENTS.md alone', () => {
    writeFileSync(join(cwd, 'AGENTS.md'), '# Ours\n\nKeep this.\n');
    installSkill(cwd, 'agents-md', 'guide\n');
    installSkill(cwd, 'agents-md', 'guide 2\n');
    const text = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
    expect(text.startsWith('# Ours\n\nKeep this.\n\n')).toBe(true);
    expect(text).toContain('guide 2');
    expect(text).not.toContain('guide\n');
    expect(text.split(BLOCK_BEGIN)).toHaveLength(2);
  });
});
