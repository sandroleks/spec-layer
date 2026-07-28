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
    // A verbatim archive of the prototype the plugin UI redesign was approved
    // from. It is a visual reference, not source: nothing here ships, and it
    // is deliberately preserved as it was written rather than corrected.
    "docs/plugin-ui-vnext/prototype/**",
  ]),
]);
