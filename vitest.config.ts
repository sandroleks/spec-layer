import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
    },
  },
  test: {
    include: [
      'packages/**/test/**/*.test.ts',
      'apps/**/src/**/*.test.{ts,tsx}',
    ],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: [
        'packages/*/src/**/*.ts',
        'apps/web/src/**/*.{ts,tsx}',
      ],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/types.ts',
        // Entry points. These are wiring, not logic: they read as a long
        // sequence of API registrations and listener hookups, so a unit test
        // can only restate them. The two plugin files below are the literal
        // esbuild entry points (dist/main.js comes from main.ts, dist/ui.html
        // from src/ui/ui.ts), same category as the index.ts rule above.
        'packages/*/src/index.ts',
        'packages/plugin/src/main.ts',
        'packages/plugin/src/ui/ui.ts',
        'packages/plugin/src/ui/harness.ts',
      ],
      // A ratchet, not an aspiration: this floor only moves up. Raise it as
      // coverage improves so regressions fail CI, but never lower it.
      thresholds: {
        statements: 45,
        branches: 40,
        functions: 50,
        lines: 45,
      },
    },
  },
});
