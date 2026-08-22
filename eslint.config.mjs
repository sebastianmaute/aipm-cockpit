import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated coverage report + ephemeral agent git worktrees (both
    // git-ignored). Linting them surfaces stale/generated code that isn't ours.
    "coverage/**",
    ".claude/**",
  ]),
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@heroicons/react",
              message:
                "Icons come from src/app/icons.ts. @heroicons/react was removed app-wide (tech-debt TD-8).",
            },
          ],
          patterns: [
            {
              group: ["@heroicons/react/*"],
              message:
                "Icons come from src/app/icons.ts. @heroicons/react was removed app-wide (tech-debt TD-8).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
