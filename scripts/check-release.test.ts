import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTES_LIMIT, PROXY_ORIGIN, pluginChecklist, changelogSection, releaseNotes, releaseProblems, versionFromTag } from './check-release.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** A synthetic checkout where every rule holds for plugin 6.1.0 and CLI 0.12.0. */
function files(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\n## [6.1.0] - 2026-10-01\n\nThe CLI ships as 0.12.0.\n\n## [6.0.0] - 2026-09-24\n\nOld.\n',
    'package.json': JSON.stringify({ version: '6.1.0' }),
    'packages/plugin/package.json': JSON.stringify({ version: '6.1.0' }),
    'packages/cli/package.json': JSON.stringify({ version: '0.12.0' }),
    'packages/plugin/manifest.json': JSON.stringify({ networkAccess: { allowedDomains: [PROXY_ORIGIN] } }),
    'packages/plugin/src/ui/proxy.ts': `export const PROXY_URL = '${PROXY_ORIGIN}';\n`,
    ...overrides,
  };
}

describe('versionFromTag', () => {
  it.each([
    ['cli', 'cli-v0.12.0', '0.12.0'],
    ['plugin', 'v6.1.0', '6.1.0'],
    ['plugin', 'cli-v0.12.0', null],
    ['cli', 'v6.1.0', null],
    ['plugin', 'v6.1', null],
    ['plugin', 'v6.1.0-rc.1', null],
  ])('%s %s → %s', (surface, tag, expected) => {
    expect(versionFromTag(surface, tag)).toBe(expected);
  });
});

describe('changelogSection', () => {
  it('returns the dated section up to the next heading', () => {
    expect(changelogSection(files()['CHANGELOG.md'], '6.1.0')).toBe('The CLI ships as 0.12.0.');
  });

  it('is null for an undated or missing section', () => {
    expect(changelogSection('## [6.1.0]\n\nx\n', '6.1.0')).toBeNull();
    expect(changelogSection(files()['CHANGELOG.md'], '6.2.0')).toBeNull();
  });
});

describe('releaseProblems', () => {
  it('passes a consistent plugin and CLI release', () => {
    expect(releaseProblems('plugin', 'v6.1.0', files())).toEqual([]);
    expect(releaseProblems('cli', 'cli-v0.12.0', files())).toEqual([]);
  });

  it('passes the releases already cut from this checkout', () => {
    const real = Object.fromEntries(Object.keys(files()).map((p) => [p, read(p)]));
    const cli = JSON.parse(real['packages/cli/package.json']).version;
    expect(releaseProblems('cli', `cli-v${cli}`, real)).toEqual([]);
    expect(releaseProblems('plugin', 'v6.0.0', real)).toEqual([]);
  });

  it('refuses a tag the package versions do not carry', () => {
    expect(releaseProblems('plugin', 'v6.2.0', files())).toHaveLength(3);
    expect(releaseProblems('cli', 'cli-v0.13.0', files()).join(' ')).toMatch(/0\.12\.0, but the tag names 0\.13\.0/);
  });

  it('refuses a CLI version the changelog never mentions, without matching a longer version', () => {
    const changelog = '## [6.1.0] - 2026-10-01\n\nThe CLI ships as 10.12.0 and 0.12.01.\n';
    expect(releaseProblems('cli', 'cli-v0.12.0', files({ 'CHANGELOG.md': changelog }))).toEqual(['CHANGELOG.md never mentions CLI 0.12.0.']);
  });

  it('refuses a plugin build pointed at another proxy', () => {
    const problems = releaseProblems('plugin', 'v6.1.0', files({
      'packages/plugin/manifest.json': JSON.stringify({ networkAccess: { allowedDomains: ['http://localhost:8787'] } }),
      'packages/plugin/src/ui/proxy.ts': "export const PROXY_URL = 'http://localhost:8787';\n",
    }));
    expect(problems).toHaveLength(2);
  });

  it('refuses allowedDomains that only contain the origin as a substring, or are not a list', () => {
    for (const allowedDomains of [
      `${PROXY_ORIGIN}.evil.example`,
      [`${PROXY_ORIGIN}.evil.example`],
      [`https://evil.example/?${PROXY_ORIGIN}`],
    ]) {
      const problems = releaseProblems('plugin', 'v6.1.0', files({
        'packages/plugin/manifest.json': JSON.stringify({ networkAccess: { allowedDomains } }),
      }));
      expect(problems, JSON.stringify(allowedDomains)).toEqual([`manifest.json networkAccess.allowedDomains does not include ${PROXY_ORIGIN}.`]);
    }
  });

  it('refuses a tag for the wrong surface', () => {
    expect(releaseProblems('plugin', 'cli-v0.12.0', files())[0]).toMatch(/not a plugin release tag/);
  });
});

describe('releaseNotes', () => {
  it('keeps a section that fits whole', () => {
    expect(releaseNotes('Short.', '6.1.0')).toBe('Short.\n');
  });

  it('cuts a long section at a paragraph break and points at the changelog', () => {
    const paragraph = `${'word '.repeat(200).trim()}\n\n`;
    const notes = releaseNotes(paragraph.repeat(200), '6.1.0');
    expect(notes.length).toBeLessThanOrEqual(NOTES_LIMIT);
    expect(notes).toMatch(/word\n\n…\n\nSee CHANGELOG\.md for the full 6\.1\.0 entry\.\n$/);
  });

  it('keeps the footer whole when the section is cut', () => {
    const footer = pluginChecklist('6.1.0');
    const notes = releaseNotes(`${'word '.repeat(200).trim()}\n\n`.repeat(200), '6.1.0', footer);
    expect(notes.length).toBeLessThanOrEqual(NOTES_LIMIT);
    expect(notes.endsWith(`${footer}\n`)).toBe(true);
    expect(notes).toContain('See CHANGELOG.md for the full 6.1.0 entry.');
  });

  it('fits the real 6.0.0 entry with its checklist', () => {
    const section = changelogSection(read('CHANGELOG.md'), '6.0.0');
    expect(section).not.toBeNull();
    const notes = releaseNotes(section as string, '6.0.0', pluginChecklist('6.0.0'));
    expect(notes.length).toBeLessThanOrEqual(NOTES_LIMIT);
    expect(notes).toContain('## Before publishing');
  });
});
