import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The design system reaches the plugin through build.mjs, not through the
 * TypeScript import graph, so the only honest place to assert it is the
 * built artefact.
 */
const pluginDir = fileURLToPath(new URL('..', import.meta.url));

describe('dist/ui.html', () => {
  let html = '';

  beforeAll(() => {
    execFileSync('node', ['build.mjs'], { cwd: pluginDir, stdio: 'pipe' });
    html = readFileSync(fileURLToPath(new URL('../dist/ui.html', import.meta.url)), 'utf-8');
  });

  it('embeds the design-system tokens', () => {
    expect(html).toContain('--sl-color-canvas');
    expect(html).toContain('--sl-plugin-width');
  });

  it('embeds the layers in cascade order: tokens, components, patterns', () => {
    const tokens = html.indexOf('--sl-plugin-width');
    const components = html.indexOf('.sl-button');
    const patterns = html.indexOf('.sl-plugin-shell');
    expect(tokens).toBeGreaterThan(-1);
    expect(components).toBeGreaterThan(tokens);
    expect(patterns).toBeGreaterThan(components);
  });

  it('still embeds the UI bundle', () => {
    expect(html).toContain('<script>');
  });
});

import { existsSync, rmSync } from 'node:fs';

describe('dist/ui-harness.html', () => {
  const harness = fileURLToPath(new URL('../dist/ui-harness.html', import.meta.url));

  it('is not emitted by a normal build, so it can never ship as the plugin UI', () => {
    rmSync(harness, { force: true });
    execFileSync('node', ['build.mjs'], { cwd: pluginDir, stdio: 'pipe' });
    expect(existsSync(harness)).toBe(false);
  });

  it('is emitted when explicitly asked for', () => {
    execFileSync('node', ['build.mjs'], {
      cwd: pluginDir, stdio: 'pipe', env: { ...process.env, UI_HARNESS: '1' },
    });
    expect(existsSync(harness)).toBe(true);
  });

  it('is never referenced by the manifest', () => {
    const manifest = readFileSync(
      fileURLToPath(new URL('../manifest.json', import.meta.url)), 'utf-8');
    expect(manifest).not.toContain('ui-harness');
  });
});
