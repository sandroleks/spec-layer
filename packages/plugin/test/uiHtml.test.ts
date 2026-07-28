import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The design system reaches the plugin through build.mjs, not through the
 * TypeScript import graph, so the only honest place to assert it is the
 * built artefact.
 */
const pluginDir = fileURLToPath(new URL('..', import.meta.url));
const uiHtml = fileURLToPath(new URL('../dist/ui.html', import.meta.url));
const harness = fileURLToPath(new URL('../dist/ui-harness.html', import.meta.url));

function build(env: NodeJS.ProcessEnv = {}): void {
  execFileSync('node', ['build.mjs'], {
    cwd: pluginDir, stdio: 'pipe', env: { ...process.env, ...env },
  });
}

/**
 * These specs overwrite the developer's dist/. Put it back the way a plain
 * build leaves it, so someone who built with the flag and then ran the tests
 * is not silently left holding a different artefact than they think they have.
 */
afterAll(() => {
  build();
  rmSync(harness, { force: true });
});

describe('dist/ui.html', () => {
  let legacy = '';
  let vnext = '';

  beforeAll(() => {
    build();
    legacy = readFileSync(uiHtml, 'utf-8');
    build({ UI_VNEXT: '1' });
    vnext = readFileSync(uiHtml, 'utf-8');
  });

  /**
   * The design-system layers open with a global reset and set :root/body theme
   * rules the legacy UI also sets, so shipping them in a default build
   * restyles the UI users actually run. The flag is off by default and the CSS
   * has to be off with it.
   */
  it('keeps the design system out of a default build', () => {
    expect(legacy).not.toContain('--sl-color-canvas');
    expect(legacy).not.toContain('.sl-plugin-shell');
  });

  it('still builds the legacy UI by default', () => {
    expect(legacy).toContain('tab-panel-selected');
  });

  it('embeds the layers in cascade order under the flag: tokens, components, patterns', () => {
    const tokens = vnext.indexOf('--sl-plugin-width');
    const components = vnext.indexOf('.sl-button');
    const patterns = vnext.indexOf('.sl-plugin-shell');
    expect(tokens).toBeGreaterThan(-1);
    expect(components).toBeGreaterThan(tokens);
    expect(patterns).toBeGreaterThan(components);
    expect(vnext).toContain('--sl-color-canvas');
  });

  it('still embeds the UI bundle under the flag', () => {
    expect(vnext).toContain('<script>');
    expect(vnext).toContain('sl-plugin-shell');
  });

  /** Two entry points, two bundles: neither build can carry the other's UI. */
  it('does not ship the legacy UI inside the flagged build', () => {
    expect(vnext).not.toContain('tab-panel-selected');
  });
});

describe('dist/ui-harness.html', () => {
  it('is not emitted by a normal build, so it can never ship as the plugin UI', () => {
    rmSync(harness, { force: true });
    build();
    expect(existsSync(harness)).toBe(false);
  });

  it('is emitted when explicitly asked for', () => {
    build({ UI_HARNESS: '1' });
    expect(existsSync(harness)).toBe(true);
  });

  it('is never referenced by the manifest', () => {
    const manifest = readFileSync(
      fileURLToPath(new URL('../manifest.json', import.meta.url)), 'utf-8');
    expect(manifest).not.toContain('ui-harness');
  });
});
