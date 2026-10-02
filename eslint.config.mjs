import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// The plugin is the only product, so this gate lints TypeScript and plain JS
// and nothing else. It used to extend eslint-config-next, which pulled Next,
// React and react-dom in as devDependencies for the sake of the deleted
// apps/web — three heavy trees whose rules had no React left to fire on.
export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Source runs in the Figma plugin sandbox (main thread) or its UI iframe;
    // the build and check scripts run in Node.
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The extractor and the plugin compile against ES2020 (tsconfig.base.json),
    // because both run in Figma's plugin sandbox, and Error's `cause` option is
    // ES2022. The CLI and the proxy target ES2022 and keep the rule.
    files: ["packages/extractor/**", "packages/plugin/**"],
    rules: { "preserve-caught-error": "off" },
  },
  {
    // The YAML writer's whole job is deciding which characters must be quoted
    // or escaped, so matching C0 controls literally is the point rather than a
    // slip. See the NUL-byte handling in `needsQuote`/`quoteDouble`.
    files: ["packages/extractor/src/yaml.ts"],
    rules: { "no-control-regex": "off" },
  },
  // `docs/` is a local scratch tree that .gitignore excludes, so nothing in it
  // reaches CI. Linting it anyway only ever breaks the local gate over a file
  // the repository does not carry.
  globalIgnores([
    "docs/**",
    "**/coverage/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/*.tsbuildinfo",
    ".worktrees/**",
    ".claude/worktrees/**",
  ]),
]);
