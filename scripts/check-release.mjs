#!/usr/bin/env node
/**
 * check-release.mjs — refuse a release whose tag, versions, changelog or
 * proxy origin disagree, before anything is published.
 *
 *   node scripts/check-release.mjs cli cli-v0.12.0
 *   node scripts/check-release.mjs plugin v6.1.0 [--notes out.md]
 *
 * The release workflows run this first. It replaces the lines of the release
 * template that asked a person to compare these by eye: a tag that names a
 * version the package does not carry, a plugin release with no dated
 * changelog section, or a build that would talk to a proxy other than
 * api.spec-layer.com. With --notes, the plugin's changelog section is written
 * out for the draft GitHub Release.
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PROXY_ORIGIN = 'https://api.spec-layer.com';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The version a tag names for a surface, or null when the tag is not that surface's. */
export function versionFromTag(surface, tag) {
  const prefix = surface === 'cli' ? 'cli-v' : 'v';
  if (!tag.startsWith(prefix)) return null;
  const version = tag.slice(prefix.length);
  return SEMVER.test(version) ? version : null;
}

/** The body of `## [version] - YYYY-MM-DD`, or null when there is no dated section. */
export function changelogSection(changelog, version) {
  const heading = new RegExp(`^## \\[${escapeRe(version)}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm');
  const match = heading.exec(changelog);
  if (!match) return null;
  const rest = changelog.slice(match.index + match[0].length);
  const next = /^## \[/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

/**
 * Problems with a release, as sentences; empty when it may proceed. `files`
 * maps repository paths to their text, so the rules are testable without a
 * checkout.
 */
export function releaseProblems(surface, tag, files) {
  const version = versionFromTag(surface, tag);
  if (version === null) {
    return [`${tag} is not a ${surface} release tag (expected ${surface === 'cli' ? 'cli-vX.Y.Z' : 'vX.Y.Z'}).`];
  }
  const problems = [];
  const changelog = files['CHANGELOG.md'];
  if (surface === 'cli') {
    const pkg = JSON.parse(files['packages/cli/package.json']).version;
    if (pkg !== version) problems.push(`packages/cli/package.json is ${pkg}, but the tag names ${version}.`);
    // CLI releases are described inside the plugin's sections, by version.
    if (!new RegExp(`(^|[^0-9.])${escapeRe(version)}([^0-9]|$)`).test(changelog)) {
      problems.push(`CHANGELOG.md never mentions CLI ${version}.`);
    }
    return problems;
  }
  for (const path of ['package.json', 'packages/plugin/package.json']) {
    const pkg = JSON.parse(files[path]).version;
    if (pkg !== version) problems.push(`${path} is ${pkg}, but the tag names ${version}.`);
  }
  if (changelogSection(changelog, version) === null) {
    problems.push(`CHANGELOG.md has no dated "## [${version}] - YYYY-MM-DD" section.`);
  }
  const manifest = JSON.parse(files['packages/plugin/manifest.json']);
  const allowed = manifest.networkAccess?.allowedDomains ?? [];
  if (!allowed.includes(PROXY_ORIGIN)) {
    problems.push(`manifest.json networkAccess.allowedDomains does not include ${PROXY_ORIGIN}.`);
  }
  const proxyUrl = /export const PROXY_URL = '([^']*)'/.exec(files['packages/plugin/src/ui/proxy.ts'])?.[1];
  if (proxyUrl !== PROXY_ORIGIN) {
    problems.push(`packages/plugin/src/ui/proxy.ts PROXY_URL is ${proxyUrl ?? 'missing'}, expected ${PROXY_ORIGIN}.`);
  }
  return problems;
}

/** GitHub refuses a release body over 125,000 characters; stay well under it. */
export const NOTES_LIMIT = 100_000;

/**
 * What a person still has to do before a draft plugin release is published.
 * CI cannot reach Figma, and the order of the three deliveries is the
 * release's own rule (proxy, then CLI, then the listing).
 */
export function pluginChecklist(version) {
  return [
    '## Before publishing',
    '',
    `- [ ] The manual Figma pass in \`packages/plugin/TESTING.md\` ran on this build (the zip attached here) and is recorded below.`,
    '- [ ] `npm run check:site-live` passed against https://spec-layer.com (the scheduled Site live run counts).',
    '- [ ] The proxy this build needs is deployed to production.',
    '- [ ] Any CLI version this build needs is `latest` on npm.',
    `- [ ] The Figma Community listing is updated to ${version} last, after all of the above.`,
    '',
    'Install from the [Figma Community listing](https://www.figma.com/community/plugin/1652104411578396548), or import `manifest.json` from the attached zip under **Plugins → Development → Import plugin from manifest**. `gh attestation verify <zip> --repo sandroleks/spec-layer` checks the zip was built by this repository\'s release workflow.',
  ].join('\n');
}

/**
 * The release body: the changelog section whole when it fits, otherwise cut
 * at the last paragraph break under the limit with a pointer to the full
 * entry, then the footer. A release never fails over the length of its notes.
 */
export function releaseNotes(section, version, footer = '') {
  const tail = footer ? `\n\n${footer}\n` : '\n';
  if (section.length + tail.length <= NOTES_LIMIT) return `${section}${tail}`;
  const pointer = `See CHANGELOG.md for the full ${version} entry.`;
  const room = NOTES_LIMIT - tail.length - pointer.length - 16;
  const cut = section.lastIndexOf('\n\n', room);
  return `${section.slice(0, cut > 0 ? cut : room).trimEnd()}\n\n…\n\n${pointer}${tail}`;
}

const FILES = [
  'CHANGELOG.md', 'package.json', 'packages/cli/package.json', 'packages/plugin/package.json',
  'packages/plugin/manifest.json', 'packages/plugin/src/ui/proxy.ts',
];

function main() {
  const [surface, tag, flag, notesPath] = process.argv.slice(2);
  if ((surface !== 'cli' && surface !== 'plugin') || !tag || (flag !== undefined && (flag !== '--notes' || !notesPath))) {
    console.error('Usage: check-release.mjs cli <cli-vX.Y.Z> | plugin <vX.Y.Z> [--notes <file>]');
    process.exit(2);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const files = Object.fromEntries(FILES.map((p) => [p, readFileSync(resolve(root, p), 'utf8')]));
  const problems = releaseProblems(surface, tag, files);
  if (problems.length > 0) {
    console.error(`Release ${tag} refused:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  if (notesPath) {
    const version = versionFromTag(surface, tag);
    const section = surface === 'plugin' ? changelogSection(files['CHANGELOG.md'], version) : null;
    writeFileSync(notesPath, surface === 'plugin' ? releaseNotes(section ?? '', version, pluginChecklist(version)) : releaseNotes('', version));
  }
  console.log(`Release ${tag}: tag, versions, changelog${surface === 'plugin' ? ' and proxy origin' : ''} agree.`);
}

function invokedRealPath() {
  if (!process.argv[1]) return null;
  try {
    return realpathSync(process.argv[1]);
  } catch {
    return null;
  }
}

const invoked = invokedRealPath();
if (invoked && pathToFileURL(invoked).href === import.meta.url) {
  main();
}
