import { readFileSync } from 'node:fs';

/**
 * The published version, read from package.json one directory up. That holds
 * for the built bundle in dist/ and for the TypeScript sources under src/
 * during tests. A CLI that cannot find its own package.json says so rather
 * than guessing.
 */
export function cliVersion(): string {
  try {
    const parsed = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}
