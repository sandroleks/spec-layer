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

/** `env` is still needed for UI_HARNESS, the one remaining build flag. */
function build(env: NodeJS.ProcessEnv = {}): void {
  execFileSync('node', ['build.mjs'], {
    cwd: pluginDir, stdio: 'pipe', env: { ...process.env, ...env },
  });
}

/**
 * These specs overwrite the developer's dist/. Put it back the way a plain
 * build leaves it, so running the tests never leaves someone holding a
 * different artefact than they think they have.
 */
afterAll(() => {
  build();
  rmSync(harness, { force: true });
});

describe('dist/ui.html', () => {
  let vnext = '';

  beforeAll(() => {
    build();
    vnext = readFileSync(uiHtml, 'utf-8');
  });

  it('does not ship Anatomy display-mode controls', () => {
    expect(vnext).not.toContain('id="anatomy-view"');
    expect(vnext).not.toContain('name="anatomy-view"');
    expect(vnext).not.toContain('data-anatomy=');
  });

  it('embeds the layers in cascade order by default: tokens, components, patterns', () => {
    const tokens = vnext.indexOf('--sl-plugin-width');
    const components = vnext.indexOf('.sl-button');
    const patterns = vnext.indexOf('.sl-plugin-shell');
    expect(tokens).toBeGreaterThan(-1);
    expect(components).toBeGreaterThan(tokens);
    expect(patterns).toBeGreaterThan(components);
    expect(vnext).toContain('--sl-color-canvas');
  });

  it('embeds the vNext UI bundle by default', () => {
    expect(vnext).toContain('<script>');
    expect(vnext).toContain('sl-plugin-shell');
  });

  /**
   * The deleted UI's markup must not reappear through a shared module. There is
   * only one entry point now, so this can no longer fail by building the wrong
   * file; it can still fail if legacy markup gets reintroduced somewhere the
   * vNext graph reaches.
   */
  it('does not ship the deleted legacy UI markup', () => {
    expect(vnext).not.toContain('tab-panel-selected');
  });

  it('ships working external utility destinations in the vNext build', () => {
    expect(vnext).toContain('https://spec-layer.com/');
    expect(vnext).toContain('https://www.linkedin.com/in/alexkurchev/');
    expect(vnext).not.toContain('id=\\"rail-site\\" href=\\"#\\"');
  });

  it('lets vNext AI writing fall back immediately when image export fails', () => {
    expect(vnext).toContain('componentImageError');
    // The bundle is minified, so the local name resolveComponentImage no
    // longer appears literally. Check the call structure by backreference
    // instead: whatever the minifier renamed it to, the same identifier
    // resolves the image on success and resolves null immediately on
    // failure, right after the matching case labels (string literals, so
    // unaffected by minification). esbuild's minifier reaches into `$`- and
    // `_`-prefixed names once the plain alphabet is exhausted, so the class
    // must include them alongside \w.
    expect(vnext).toMatch(
      /case"componentImage":([\w$]+)\(\{base64:[^}]*\}\);return;case"componentImageError":\1\(null\);return;/,
    );
  });

  it('anchors hidden choice inputs to their visible controls to prevent focus scroll jumps', () => {
    expect(vnext).toMatch(
      /\.sl-choice\s*\{[^}]*position:\s*relative;[^}]*\}/,
    );
    expect(vnext).toMatch(
      /\.sl-choice-input,\s*\.sl-switch-input\s*\{[^}]*top:\s*50%;[^}]*\}/,
    );
  });

  it('visually expands the wrapped variant disclosure panel', () => {
    expect(vnext).toContain(
      '.sl-variant-picker .sl-disclosure-panel:not([hidden])',
    );
  });

  it('keeps selected and focused rows neutral instead of filling them blue', () => {
    expect(vnext).not.toContain('.sl-section-row.is-selected');
    expect(vnext).not.toContain('.sl-section-row:focus-within');
  });

  // The indent is what this guards: child rows align to the control column, and
  // details align a step further in. Those two left values are computed
  // alignment, not rhythm, so they stay literal px while the block's other
  // sides come from the spacing scale. Asserting the left value only keeps the
  // test on the invariant that matters instead of the whole shorthand.
  it('indents child sections beneath their category title', () => {
    // Minified CSS drops the trailing semicolon on a rule's last
    // declaration, so accept either a semicolon or the closing brace.
    expect(vnext).toMatch(
      /\.sl-section-row \.sl-choice\s*\{[^}]*padding:[^;]*\s40px[;}]/,
    );
    expect(vnext).toMatch(/\.sl-section-details\s*\{[^}]*padding:[^;]*\s63px[;}]/);
  });

  it('drives light-theme surfaces and component states through semantic roles', () => {
    // Minified CSS drops the quotes around an attribute value that is a
    // plain identifier (e.g. data-theme=light instead of data-theme="light"),
    // so the attribute selectors below accept either form.
    expect(vnext).toMatch(
      /body\[data-theme="?light"?\]\s*\{[^}]*--brand-canvas:\s*#FFFFFF;[^}]*--brand-chrome:\s*#FFFFFF;[^}]*--brand-surface:\s*#FFFFFF;/,
    );
    expect(vnext).toContain('--sl-color-accent-border');
    expect(vnext).toContain('--sl-color-control-thumb');
    expect(vnext).toMatch(/--sl-color-section-header:\s*var\(--brand-surface\)/);
    expect(vnext).toMatch(/--sl-color-ai-badge-text:\s*var\(--brand-muted\)/);
    expect(vnext).not.toMatch(/body\[data-theme="?light"?\]\s+\.sl-/);
    expect(vnext).toMatch(
      /\.sl-component-screen \.sl-section-row \.sl-badge\[data-tone="?accent"?\]\s*\{[^}]*color:\s*var\(--sl-color-ai-badge-text\);[^}]*background:\s*var\(--sl-color-ai-badge-bg\);[^}]*border:\s*1px solid var\(--sl-color-ai-badge-border\);/,
    );
    expect(vnext).toMatch(
      /\.sl-switch-thumb\s*\{[^}]*background:\s*var\(--sl-color-control-thumb\);[^}]*box-shadow:\s*var\(--sl-shadow-control-thumb\);/,
    );
  });

  it('ships both shared action pairings and resolves all stylesheet imports', () => {
    const css = vnext.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(css).not.toContain('@import');
    expect(css).toMatch(/--brand-action:\s*#B3A0FF/);
    expect(css).toMatch(/--brand-on-action:\s*#17112E/);
    expect(css).toMatch(/--brand-action:\s*#6845C7/);
    // Rebinding aliases on body is necessary for an actual theme switch;
    // inheriting an alias resolved on the dark root would freeze that color.
    expect(css).toMatch(/body\[data-theme\]\s*\{[^}]*--sl-color-accent:\s*var\(--brand-action\)/);
    expect(css).toMatch(/--sl-color-text-on-danger:\s*var\(--brand-on-danger\)/);
    expect(css).toMatch(/\.sl-library-change-scope\s*\{[^}]*font-size:\s*var\(--sl-font-size-body\)/);
  });

  it('centers the indeterminate mark in the checkbox grid', () => {
    // Minified CSS drops a rule's trailing semicolon when the matched
    // property is its only or last declaration, downgrades ::after to the
    // equivalent legacy :after, and drops quotes around a plain-identifier
    // attribute value; accept both forms for each.
    expect(vnext).toMatch(
      /\.sl-checkbox-box\s*>\s*svg\s*\{[^}]*grid-area:\s*1\s*\/\s*1[;}]/,
    );
    expect(vnext).toMatch(
      /\.sl-choice-input\[data-mixed="?true"?\]\s*\+\s*\.sl-checkbox-box:{1,2}after\s*\{[^}]*grid-area:\s*1\s*\/\s*1;/,
    );
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
