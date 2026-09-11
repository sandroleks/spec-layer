import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BLOCK_BEGIN, BLOCK_END, buildSkillGuide, installSkill, installTarget, renderForHost, summarizePull, upsertBlock,
  type SkillInput,
} from '../src/skill';
import type { RepoProfile } from '../src/detect';
import { AGENT_HOSTS } from '../src/detect';
import type { Manifest } from '../src/files';

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
  componentSpecsDir: 'component-specs',
  components: [
    { name: 'Button', path: 'component-specs/button.yaml' },
    { name: 'Text field', path: null },
  ],
  foundation: {
    written: true,
    sets: ['Primitives'],
    modifiers: [{ name: 'Theme', contexts: ['Light', 'Dark'], default: 'Light' }],
    tokenFiles: ['primitives.default.json', 'theme.dark.json', 'theme.light.json'],
    unitlessNumbers: 3,
    reportCounts: { unit_not_expressible: 2 },
    fontsStatus: 'ok',
    fonts: [],
    missingFontFamilies: [],
  },
  outputs: [],
};

const PULL_WITH_CSS: NonNullable<SkillInput['pull']> = {
  ...PULL,
  outputs: [{
    platform: 'web', format: 'css', path: 'tokens', case: 'kebab',
    modeSelector: '[data-theme="{mode}"]', modes: {}, written: true, indexMissing: false,
    files: ['primitives.css', 'theme.light.css', 'theme.dark.css', 'index.css'],
  }],
};

// The Foundation's typography styles name a font family, and something in the
// repository loads it.
const PULL_WITH_FONTS: NonNullable<SkillInput['pull']> = {
  ...PULL_WITH_CSS,
  foundation: {
    ...PULL.foundation!,
    fonts: [{ family: 'Open Sans', weights: [400, 500, 600], used_by: ['Body', 'Label'] }],
    missingFontFamilies: [],
  },
};

// Same font requirement, but nothing in the repository loads it.
const PULL_WITH_MISSING_FONT: NonNullable<SkillInput['pull']> = {
  ...PULL_WITH_CSS,
  foundation: {
    ...PULL.foundation!,
    fonts: [{ family: 'Open Sans', weights: [400], used_by: ['Body'] }],
    missingFontFamilies: ['Open Sans'],
  },
};

// A pulled Foundation whose typography styles name no font family at all:
// fonts.json is a legitimate empty array, not a missing or broken file.
const PULL_WITH_NO_FONTS: NonNullable<SkillInput['pull']> = {
  ...PULL_WITH_CSS,
  foundation: { ...PULL.foundation!, fontsStatus: 'ok', fonts: [], missingFontFamilies: [] },
};

// fonts.json does not exist at all: a pull taken before this file existed,
// or one where it failed to write for some other reason. Distinct from the
// genuine empty array above -- an unknown font requirement, not a proven
// absence of one.
const PULL_FONTS_MISSING: NonNullable<SkillInput['pull']> = {
  ...PULL_WITH_CSS,
  foundation: { ...PULL.foundation!, fontsStatus: 'missing', fonts: [], missingFontFamilies: [] },
};

// fonts.json exists but is not a JSON array (corrupted, truncated, or holds
// some other shape entirely).
const PULL_FONTS_UNREADABLE: NonNullable<SkillInput['pull']> = {
  ...PULL_WITH_CSS,
  foundation: { ...PULL.foundation!, fontsStatus: 'unreadable', fonts: [], missingFontFamilies: [] },
};

// The map file never existed: the Foundation was excluded from the pull.
const PULL_CSS_NOT_WRITTEN: NonNullable<SkillInput['pull']> = {
  ...PULL,
  outputs: [{
    platform: 'web', format: 'css', path: 'tokens', case: 'kebab',
    modeSelector: '[data-theme="{mode}"]', modes: {}, written: false, indexMissing: false,
    files: [],
  }],
};

// The map file is still on disk, but index.css was deleted (or is unreadable),
// so the file list cannot be trusted: a different cause than the Foundation
// having been excluded, and the guide must say so distinctly.
const PULL_CSS_INDEX_MISSING: NonNullable<SkillInput['pull']> = {
  ...PULL,
  outputs: [{
    platform: 'web', format: 'css', path: 'tokens', case: 'kebab',
    modeSelector: '[data-theme="{mode}"]', modes: {}, written: false, indexMissing: true,
    files: [],
  }],
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
    expect(guide).toContain('- Button: `component-specs/button.yaml`');
    expect(guide).toContain('- Text field: not written (excluded by the selection). `spec-layer show component "Text field"` prints it.');
    expect(guide).toContain('- `Primitives`: one mode, always applied.');
    expect(guide).toContain('- `Theme`: modes `Light`, `Dark`, default `Light`.');
    expect(guide).toContain('  - `theme.dark.json`');
    expect(guide).toContain('`report.json` lists 2 `unit_not_expressible`');
    expect(guide).toContain('Library `lib_x`, published 2026-09-01T00:00:00.000Z by plugin 5.0.0');
  });

  it('warns that unitless tokens are not usable as lengths, and does not blanket-prescribe a unit override', () => {
    const guide = buildSkillGuide(input({ pull: PULL }));
    expect(guide).toContain('3 tokens have no unit');
    expect(guide).toContain('not usable as a CSS length');
    expect(guide).toContain('height: 36');
    // The remedy is conditioned on the token being a length: a bare
    // "declare a unit" instruction would be wrong for a genuinely unitless
    // opacity or font weight, so the guide must say so rather than telling
    // every reader of every count to add a dtcg.units override.
    expect(guide).toContain('opacity or a font weight');
    expect(guide).toContain('turn a genuine opacity or font weight into a fake length');
    expect(guide).toContain('Nothing is inferred from a name');
  });

  it('names spec-layer.meta.json for per-token scopes, and does not claim tokens/report.json enumerates them', () => {
    // PULL carries no written web/css output, so there is no per-output
    // report to point at either -- the sentence must not invent one.
    const guide = buildSkillGuide(input({ pull: PULL }));
    expect(guide).toContain('`.speclayer/tokens/spec-layer.meta.json` names each token\'s own Figma scopes');
    expect(guide).not.toContain('unitless_number');
    // The old, wrong phrasing pointed at a bare `report.json` for "what each
    // one actually is" -- a file tokens/report.json cannot answer, since none
    // of its codes name a token left with no unit at all.
    expect(guide).not.toContain('see `report.json` for what each one actually is');
  });

  it('names the actual web/css report file that lists unitless_number, when one was written', () => {
    const guide = buildSkillGuide(input({ pull: PULL_WITH_CSS }));
    expect(guide).toContain('`.speclayer/tokens/spec-layer.meta.json` names each token\'s own Figma scopes, and '
      + '`.speclayer/outputs/web-css.report.json` lists every one under `unitless_number`.');
  });

  it('states the unit caveat once for a single unitless token, in singular English', () => {
    const pull = { ...PULL, foundation: { ...PULL.foundation!, unitlessNumbers: 1 } };
    const guide = buildSkillGuide(input({ pull }));
    expect(guide).toContain('1 token has no unit');
    expect(guide).not.toContain('1 tokens');
  });

  it('says nothing about units when the pull has none', () => {
    const pull = { ...PULL, foundation: { ...PULL.foundation!, unitlessNumbers: 0 } };
    const guide = buildSkillGuide(input({ pull }));
    expect(guide).not.toContain('token has no unit');
    expect(guide).not.toContain('tokens have no unit');
  });

  it('puts the unit caveat ahead of every per-platform section, not after them', () => {
    const guide = buildSkillGuide(input({ pull: PULL, platforms: ['web', 'ios'], platformSource: 'detected' }));
    const unitIndex = guide.indexOf('3 tokens have no unit');
    const webIndex = guide.indexOf('### Web');
    const iosIndex = guide.indexOf('### iOS');
    // indexOf returns -1 for a missing substring, which is "less than" any
    // real index; asserting each index is actually found keeps this test
    // from passing vacuously if the sentence's wording ever drifts.
    expect(unitIndex).toBeGreaterThanOrEqual(0);
    expect(webIndex).toBeGreaterThan(0);
    expect(iosIndex).toBeGreaterThan(0);
    expect(unitIndex).toBeLessThan(webIndex);
    expect(unitIndex).toBeLessThan(iosIndex);
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
      ...PULL, outDir: 'design/context', componentSpecsDir: 'design/specs',
      components: PULL.components.map((c) => ({ ...c, path: c.path?.replace('component-specs', 'design/specs') ?? null })),
    };
    const guide = buildSkillGuide(input({ outDir: 'design/context', pull }));
    expect(guide).toContain('`design/context/tokens/resolver.json`');
    expect(guide).toContain('Never edit files under `design/context/`');
    expect(guide).toContain('- `design/specs/`: one YAML per component.');
    // The flag reference still states the default; no path may use it.
    expect(guide).not.toMatch(/`\.speclayer\//);
  });
});

describe('buildSkillGuide outputs', () => {
  const web: RepoProfile = { ...EMPTY_PROFILE, platforms: ['web'] };

  it('tells the agent to import the css file, switch modes with data-theme, and read names from the map', () => {
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull: PULL_WITH_CSS }));
    expect(guide).toContain(
      '- `tokens/`: web/css token files, kebab names: primitives.css, theme.light.css, theme.dark.css, index.css. '
      + 'Non-default modes are under `[data-theme="{mode}"]`, each in its own file.',
    );
    expect(guide).toContain(
      'Import `tokens/index.css` from the root stylesheet. It imports one file per collection and mode: '
      + 'primitives.css, theme.light.css, theme.dark.css. ',
    );
    expect(guide).toContain('Each entry names the file that declares the property.');
    expect(guide).toContain('set `data-theme` on `<html>`');
    expect(guide).toContain(
      'To let the OS choose, set that collection\'s selector to `:root` under `outputs[].modes` and import the mode\'s '
      + 'file yourself under `@media (prefers-color-scheme: dark)`; the CLI never assumes that.',
    );
    expect(guide).toContain('`.speclayer/outputs/web-css.map.json`');
    expect(guide).toContain('source "code_syntax" when the designer declared it in Figma, "derived" when the CLI built it from the DTCG path');
    expect(guide).not.toContain('derive nothing');
  });

  it('says the css is a projection of tokens/ when a pipeline is present', () => {
    const sd: RepoProfile = { ...web, tokenTools: ['style-dictionary'], styleDictionaryMajor: 5 };
    const guide = buildSkillGuide(input({ profile: sd, platforms: ['web'], platformSource: 'detected', pull: PULL_WITH_CSS }));
    expect(guide).toContain('`tokens/` is a projection of the same `.speclayer/tokens/` files, not a second source. Import one or the other.');
  });

  it('names the flag when web is targeted but no output was written', () => {
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull: PULL }));
    expect(guide).toContain('No token file was written for web.');
    expect(guide).toContain('`"outputs"` in `speclayer.json`');
    expect(guide).toContain('the default lands at `tokens/`');
    expect(guide).not.toContain('web-css.map.json');
  });

  it('says a configured web output was not written, not that it exists, when the foundation was excluded', () => {
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull: PULL_CSS_NOT_WRITTEN }));
    expect(guide).toContain('A web/css output is configured at `tokens/` but was not written, because the last pull did not write the Foundation. '
      + 'Pull with the Foundation selected to write it.');
    expect(guide).not.toContain('its `index.css` is missing');
    expect(guide).not.toContain('Import `tokens/index.css` from the root stylesheet');
    expect(guide).not.toContain('web-css.map.json');
    expect(guide).not.toContain('No token file was written for web.');
  });

  it('says index.css is missing, not that the Foundation was excluded, when the map is still on disk', () => {
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull: PULL_CSS_INDEX_MISSING }));
    expect(guide).toContain(
      'A web/css output is configured at `tokens/` but its `index.css` is missing, so the file list is unknown. '
      + 'Run `npx spec-layer pull` to write it again.',
    );
    expect(guide).not.toContain('because the last pull did not write the Foundation');
    expect(guide).not.toContain('Import `tokens/index.css` from the root stylesheet');
    expect(guide).not.toContain('web-css.map.json');
    expect(guide).not.toContain('No token file was written for web.');
  });

  it('falls back to spec-layer.meta.json for web when there is no pull at all', () => {
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull: null }));
    expect(guide).toContain("Token identifiers for code live in `.speclayer/tokens/spec-layer.meta.json` under each token's `code_syntax.WEB`");
    expect(guide).not.toContain('web-css.map.json');
  });

  it('states the fonts the library needs, before the token import instructions', () => {
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull: PULL_WITH_FONTS }));
    expect(guide).toContain('Open Sans at 400, 500, 600');
    expect(guide).toContain('a missing weight renders as a synthesised bold that matches nothing in the design');
    const fontIndex = guide.indexOf('Open Sans at 400');
    const importIndex = guide.indexOf('Import `tokens/index.css`');
    // Both indexes must actually be found (indexOf's -1 would otherwise make
    // this assertion pass vacuously), and the font line must come first.
    expect(fontIndex).toBeGreaterThanOrEqual(0);
    expect(importIndex).toBeGreaterThan(0);
    expect(fontIndex).toBeLessThan(importIndex);
    expect(guide).toContain('Never write `font-family` from a token without appending a generic fallback');
  });

  it('says when nothing in the repository loads the family', () => {
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull: PULL_WITH_MISSING_FONT }));
    expect(guide).toContain('Open Sans: nothing in this repository loads it');
    expect(guide).toContain('Add a font source before building UI');
  });

  it('does not claim the fallback stack is missing from the DTCG token directory: it names the generated CSS', () => {
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull: PULL_WITH_FONTS }));
    expect(guide).toContain('never keep that fallback inside `tokens/`: the next pull replaces it.');
    // tokens/ here is cssOut.path (the generated CSS an agent would actually
    // edit), not `.speclayer/tokens/` (the DTCG JSON source) -- both fixtures
    // happen to use the literal name "tokens" so this also checks the actual
    // computed value, not just a shared substring, via the full sentence above.
    expect(guide).not.toContain('never keep that fallback inside `.speclayer/tokens/`');
  });

  it('names the whole pull directory as the fallback warning when no CSS output was written', () => {
    const pull = { ...PULL, foundation: { ...PULL.foundation!, fontsStatus: 'ok' as const, fonts: [{ family: 'Inter', weights: [400], used_by: ['Body'] }] } };
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull }));
    expect(guide).toContain('never keep that fallback inside `.speclayer/`: the next pull replaces it.');
  });

  it('reads sensibly when fonts.json is a genuine empty array, without claiming the library has no typography', () => {
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull: PULL_WITH_NO_FONTS }));
    expect(guide).toContain('`fonts.json` names no font family.');
    // Must not overclaim: fontRequirements silently skips a style whose font
    // family never resolved, so an empty array does not prove there is no
    // typography, only that fonts.json names nothing.
    expect(guide).not.toContain('this library has no typography');
    expect(guide).not.toContain('**Fonts.**');
    expect(guide).not.toContain('nothing in this repository loads it');
  });

  it('says the font requirement is unknown, not that there is none, when fonts.json is missing', () => {
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull: PULL_FONTS_MISSING }));
    expect(guide).toContain('`fonts.json` is missing, so the font requirement for this library is unknown here.');
    expect(guide).not.toContain('**Fonts.**');
    expect(guide).not.toContain('names no font family');
  });

  it('says the font requirement is unknown, not that there is none, when fonts.json is not valid JSON', () => {
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull: PULL_FONTS_UNREADABLE }));
    expect(guide).toContain('`fonts.json` is not valid JSON, so the font requirement for this library is unknown here.');
    expect(guide).not.toContain('**Fonts.**');
    expect(guide).not.toContain('names no font family');
  });

  it('says nothing about fonts when the Foundation was not written', () => {
    const pull = { ...PULL, foundation: { ...PULL.foundation!, written: false } };
    const guide = buildSkillGuide(input({ profile: web, platforms: ['web'], platformSource: 'detected', pull }));
    expect(guide).not.toContain('**Fonts.**');
    expect(guide).not.toContain('names no font family');
    expect(guide).not.toContain('font requirement for this library is unknown');
  });

  it('labels a platform that came from the config', () => {
    const guide = buildSkillGuide(input({ platforms: ['web'], platformSource: 'config', pull: PULL_WITH_CSS }));
    expect(guide).toContain('Target platform (set in speclayer.json): web.');
  });

  it('warns never to edit the output path in step 6', () => {
    const guide = buildSkillGuide(input({ pull: PULL_WITH_CSS }));
    expect(guide).toContain('Never edit `tokens/` either: pull replaces or removes files there.');
    expect(guide).toContain('2. Building or changing a component: read its YAML under `component-specs/`');
    expect(guide).toContain('6. Never edit files under `.speclayer/` or `component-specs/`: the next pull replaces or removes them.');
    expect(guide).toContain('after a pull that adds components, after changing `outputs` or `componentSpecsDir`, or when the codebase changes stack');
  });

  it('names the Foundation exclusion in the disk section when the map never existed', () => {
    const guide = buildSkillGuide(input({ pull: PULL_CSS_NOT_WRITTEN }));
    expect(guide).toContain(
      '- `tokens/`: web/css token files, configured but not written by the last pull (the Foundation was not written). '
      + 'Nothing is on disk at that path from Spec Layer.',
    );
  });

  it('names the missing index.css in the disk section, not the Foundation exclusion, when the map is on disk', () => {
    const guide = buildSkillGuide(input({ pull: PULL_CSS_INDEX_MISSING }));
    expect(guide).toContain(
      '- `tokens/`: web/css token files, but `index.css` is missing; run `npx spec-layer pull` to restore the directory.',
    );
    expect(guide).not.toContain('configured but not written by the last pull (the Foundation was not written)');
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

// ---------------------------------------------------------------------------
// summarizePull, driven from a real directory on disk (not injected into a
// fixture): every buildSkillGuide test above assumes `PullSummary.foundation`
// already carries the right fonts/fontsStatus/unitlessNumbers, so none of
// them can catch a bug in how summarizePull actually reads the pull -- the
// wrong file, a validator that rejects a good entry, or the wrong cwd handed
// to the repository scan. Each of those would silently yield an empty or
// zero value that renders as a confident, false statement rather than a
// visible error, so they are worth a real filesystem round trip.
// ---------------------------------------------------------------------------

describe('summarizePull', () => {
  let cwd: string;
  let outDir: string;
  let tokensDir: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'sl-summarize-'));
    outDir = '.speclayer';
    tokensDir = join(cwd, outDir, 'tokens');
    mkdirSync(tokensDir, { recursive: true });
    writeFileSync(join(tokensDir, 'resolver.json'), JSON.stringify({ sets: {}, modifiers: {} }));
  });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  function manifest(overrides: Partial<Manifest> = {}): Manifest {
    return {
      libraryId: 'lib_x', publishedAt: '2026-09-01T00:00:00.000Z', bundleHash: 'h'.repeat(64),
      pluginVersion: '5.0.0', extractorVersion: '2',
      artifacts: [{
        kind: 'foundation', name: 'Foundation', contentHash: 'c'.repeat(64),
        path: `${outDir}/tokens/resolver.json`,
      }],
      ...overrides,
    };
  }

  it('reads fonts.json from the pull root, not from tokens/', () => {
    // A decoy at the wrong path: if summarizePull ever read tokens/fonts.json
    // instead of the real one, this is the value it would wrongly return.
    writeFileSync(join(tokensDir, 'fonts.json'), JSON.stringify([{ family: 'Wrong Place', weights: [400], used_by: ['X'] }]));
    writeFileSync(join(cwd, outDir, 'fonts.json'), JSON.stringify([{ family: 'Open Sans', weights: [400, 600], used_by: ['Body'] }]));
    const summary = summarizePull(cwd, outDir, manifest());
    expect(summary?.foundation?.fontsStatus).toBe('ok');
    expect(summary?.foundation?.fonts).toEqual([{ family: 'Open Sans', weights: [400, 600], used_by: ['Body'] }]);
  });

  it('does not reject a well-formed fonts.json entry', () => {
    const entry = { family: 'Inter', weights: [400, 700], used_by: ['Body/Regular', 'Heading/Bold'] };
    writeFileSync(join(cwd, outDir, 'fonts.json'), JSON.stringify([entry]));
    const summary = summarizePull(cwd, outDir, manifest());
    expect(summary?.foundation?.fonts).toEqual([entry]);
  });

  it('reports fontsStatus "missing" when fonts.json does not exist', () => {
    const summary = summarizePull(cwd, outDir, manifest());
    expect(summary?.foundation?.fontsStatus).toBe('missing');
    expect(summary?.foundation?.fonts).toEqual([]);
  });

  it('reports fontsStatus "unreadable" when fonts.json is not a JSON array', () => {
    writeFileSync(join(cwd, outDir, 'fonts.json'), JSON.stringify({ not: 'an array' }));
    const summary = summarizePull(cwd, outDir, manifest());
    expect(summary?.foundation?.fontsStatus).toBe('unreadable');
    expect(summary?.foundation?.fonts).toEqual([]);
  });

  it('reports fontsStatus "unreadable" when fonts.json is not valid JSON at all', () => {
    writeFileSync(join(cwd, outDir, 'fonts.json'), '{not json');
    const summary = summarizePull(cwd, outDir, manifest());
    expect(summary?.foundation?.fontsStatus).toBe('unreadable');
  });

  it('reports fontsStatus "ok" with an empty array for a genuine empty fonts.json', () => {
    writeFileSync(join(cwd, outDir, 'fonts.json'), '[]');
    const summary = summarizePull(cwd, outDir, manifest());
    expect(summary?.foundation?.fontsStatus).toBe('ok');
    expect(summary?.foundation?.fonts).toEqual([]);
  });

  it('checks missingFontSourcesInRepo against the real repository root, not outDir', () => {
    writeFileSync(join(cwd, outDir, 'fonts.json'), JSON.stringify([{ family: 'Open Sans', weights: [400], used_by: ['Body'] }]));
    // No package.json/CSS/HTML anywhere yet: the family is missing.
    let summary = summarizePull(cwd, outDir, manifest());
    expect(summary?.foundation?.missingFontFamilies).toEqual(['Open Sans']);
    // A package.json at the repository ROOT (cwd), not under outDir, should
    // satisfy the check. If missingFontSourcesInRepo were ever called with
    // outDir (or any other wrong path) instead of cwd, this would still
    // wrongly report the family missing.
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies: { '@fontsource/open-sans': '^5.0.0' } }));
    summary = summarizePull(cwd, outDir, manifest());
    expect(summary?.foundation?.missingFontFamilies).toEqual([]);
  });

  it('excludes an OPACITY-scoped number from unitlessNumbers, but still counts an unscoped one', () => {
    writeFileSync(join(tokensDir, 'primitives.json'), JSON.stringify({
      Primitives: {
        opacity: { muted: { $type: 'number', $value: 0.5 } },
        number: { unknown: { $type: 'number', $value: 2 } },
      },
    }));
    writeFileSync(join(tokensDir, 'spec-layer.meta.json'), JSON.stringify({
      'Primitives.opacity.muted': { id: 'v1', collection_id: 'c1', type: 'number', scopes: ['OPACITY'] },
      'Primitives.number.unknown': { id: 'v2', collection_id: 'c1', type: 'number', scopes: ['ALL_SCOPES'] },
    }));
    const summary = summarizePull(cwd, outDir, manifest());
    // Only Primitives.number.unknown counts: its scopes state nothing at all.
    // Primitives.opacity.muted is a `$type: "number"` leaf too, but its
    // OPACITY scope already states it is a unitless number, so it must not
    // be told its variable "states none".
    expect(summary?.foundation?.unitlessNumbers).toBe(1);
  });

  it('excludes a FONT_WEIGHT-scoped number the same way, even though it is never $type "number" in the file', () => {
    writeFileSync(join(tokensDir, 'primitives.json'), JSON.stringify({
      Primitives: {
        weight: { strong: { $type: 'fontWeight', $value: 700 } },
        number: { unknown: { $type: 'number', $value: 2 } },
      },
    }));
    writeFileSync(join(tokensDir, 'spec-layer.meta.json'), JSON.stringify({
      'Primitives.weight.strong': { id: 'v1', collection_id: 'c1', type: 'number', scopes: ['FONT_WEIGHT'] },
      'Primitives.number.unknown': { id: 'v2', collection_id: 'c1', type: 'number', scopes: ['ALL_SCOPES'] },
    }));
    const summary = summarizePull(cwd, outDir, manifest());
    expect(summary?.foundation?.unitlessNumbers).toBe(1);
  });
});
