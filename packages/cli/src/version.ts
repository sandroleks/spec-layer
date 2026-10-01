import { readFileSync } from 'node:fs';

/**
 * The published version from package.json one directory up (true for dist/ and
 * src/), or 'unknown' rather than a guess.
 */
export function cliVersion(): string {
  try {
    const parsed = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}
