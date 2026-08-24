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
    // The YAML writer's whole job is deciding which characters must be quoted
    // or escaped, so matching C0 controls literally is the point rather than a
    // slip. See the NUL-byte handling in `needsQuote`/`quoteDouble`.
    files: ["packages/extractor/src/yaml.ts"],
    rules: { "no-control-regex": "off" },
  },
  globalIgnores([
    "**/coverage/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/*.tsbuildinfo",
    ".worktrees/**",
    ".claude/worktrees/**",
    // Vendored, minified browser libraries. Their upstream source is linted
    // by its own project; treating minified expressions as repository warnings
    // made our lint gate noisy without finding issues in code we maintain.
    "apps/landing/lenis.min.js",
    "apps/landing/motion.js",
    // A verbatim archive of the prototype the plugin UI redesign was approved
    // from. It is a visual reference, not source: nothing here ships, and it
    // is deliberately preserved as it was written rather than corrected.
    "docs/plugin-ui-vnext/prototype/**",
  ]),
]);
