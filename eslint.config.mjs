import { createRequire } from "node:module";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const reactVersion = createRequire(import.meta.url)("react/package.json").version;

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next sets settings.react.version = "detect"; that detect path is the
  // ONLY route into eslint-plugin-react 7.37.5's removed context.getFilename() call, which
  // aborts rule loading under ESLint 10. Pinning the version skips it. Derived, not
  // restated, so it cannot drift from the react dependency. Keep this pin even after
  // upstream ships v10 support: an explicit version also avoids a filesystem probe per
  // rule load, and is deterministic.
  { settings: { react: { version: reactVersion } } },
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
