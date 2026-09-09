import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOOLS, toolsJson, toolsText } from '../src/tools';

const CLI_SOURCE = readFileSync(fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'utf8');

describe('the tool catalogue', () => {
  it('names every command cli.ts dispatches, and nothing else', () => {
    const dispatched = [...CLI_SOURCE.matchAll(/command === '([a-z]+)'/g)].map((m) => m[1]).sort();
    expect(TOOLS.map((t) => t.name).sort()).toEqual(dispatched);
  });

  it('lists every command in the usage banner', () => {
    for (const tool of TOOLS) {
      expect(CLI_SOURCE, `${tool.name} is missing from USAGE`).toMatch(new RegExp(`^  ${tool.name}\\s`, 'm'));
    }
  });

  it('states network, key, writes, and exits for every tool', () => {
    for (const tool of TOOLS) {
      expect(typeof tool.network).toBe('boolean');
      expect(typeof tool.needsKey).toBe('boolean');
      expect(Array.isArray(tool.writes)).toBe(true);
      expect(Object.keys(tool.exits)).toContain('0');
      // A command that needs the key must reach the network; the reverse need not hold.
      if (tool.needsKey) expect(tool.network).toBe(true);
    }
  });

  it('marks the local-only commands as needing no key', () => {
    const local = TOOLS.filter((t) => ['list', 'show', 'tools', 'skill', 'init'].includes(t.name));
    expect(local).toHaveLength(5);
    for (const t of local) expect(t.network).toBe(false);
  });

  it('prints text with one block per tool and the key resolution order', () => {
    const text = toolsText();
    for (const tool of TOOLS) expect(text).toContain(tool.usage);
    expect(text).toContain('--key, then SPEC_LAYER_KEY, then speclayer.local.json');
    expect(text).not.toContain('—');
  });

  it('names the platform flag and the output paths for setup, init, and pull', () => {
    const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
    for (const name of ['setup', 'init', 'pull']) expect(byName[name].usage).toContain('[--platform web|ios|android|flutter]...');
    expect(byName.setup.writes).toContain('outputs[].path from speclayer.json (default spec-layer/tokens.css for web), written in place');
    expect(byName.pull.writes).toContain('outputs[].path from speclayer.json (default spec-layer/tokens.css for web), written in place');
    expect(byName.init.writes).toEqual(['speclayer.json']);
  });

  it('prints stable JSON carrying the version', () => {
    const parsed = JSON.parse(toolsJson('9.9.9')) as { cli: string; version: string; tools: Array<{ name: string }> };
    expect(parsed.cli).toBe('spec-layer');
    expect(parsed.version).toBe('9.9.9');
    expect(parsed.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
  });
});
