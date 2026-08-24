import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['packages/*/src/**/*.ts'],
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
      ],
      // A ratchet, not an aspiration: this floor only moves up. Raise it as
      // coverage improves so regressions fail CI, but never lower it.
      //
      // Jumped from 45/40/50/45 when the legacy UI and apps/web left the
      // measured set: the old floor was mostly slack, and slack in a ratchet
      // is just a regression nobody notices.
      thresholds: {
        statements: 70,
        branches: 75,
        functions: 85,
        lines: 69,
      },
    },
  },
});
