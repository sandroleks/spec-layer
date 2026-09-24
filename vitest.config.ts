import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['packages/*/src/**/*.ts', 'packages/brand/src/**/*.mjs', 'scripts/**/*.mjs'],
      exclude: [
        '**/*.test.ts',
        '**/types.ts',
        // Entry points. These are wiring, not logic: they read as a long
        // sequence of API registrations and listener hookups, so a unit test
        // can only restate them. The plugin files below are the literal esbuild
        // entry points (dist/main.js comes from main.ts, dist/ui.html from
        // src/ui/ui-vnext.ts), same category as the index.ts rule above.
        'packages/*/src/index.ts',
        'packages/plugin/src/main.ts',
        'packages/plugin/src/ui/ui-vnext.ts',
        'packages/plugin/src/ui/harness.ts',
        // The gate runners in scripts/ are the same category: they spawn a
        // process or fetch a URL and exit. Their decisions live in modules
        // that are measured (site/live.mjs, check-nul-bytes.mjs,
        // check-main-sandbox.mjs).
        'scripts/check-cli-bundle.mjs',
        'scripts/check-site-live.mjs',
        'scripts/install-hooks.mjs',
      ],
      // A ratchet, not an aspiration: this floor only moves up. Raise it as
      // coverage improves so regressions fail CI, but never lower it.
      //
      // Jumped from 45/40/50/45 when the legacy UI and apps/web left the
      // measured set, and again from 72/77/88/71 on 2026-09-23, when actual
      // coverage had been 10 to 23 points above the floor for months and the
      // ratchet could not fire. Set two to three points under the measured
      // 92.82 / 87.18 / 96.72 / 94.28 with the .mjs files included.
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 94,
        lines: 92,
      },
    },
  },
});
