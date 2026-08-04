import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([
    "**/.next/**",
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
