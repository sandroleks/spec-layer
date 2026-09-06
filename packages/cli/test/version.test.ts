import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cliVersion } from '../src/version';

describe('cliVersion', () => {
  it('reads the version the package publishes', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string };
    expect(cliVersion()).toBe(pkg.version);
    expect(cliVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
