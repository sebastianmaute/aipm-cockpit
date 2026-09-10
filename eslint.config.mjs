import { createRequire } from "node:module";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const reactVersion = createRequire(import.meta.url)("react/package.json").version;

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next sets settings.react.version = "detect" and nothing else under
  // settings.react. Under ESLint 10 that detect path is the only route THIS config reaches
  // into eslint-plugin-react 7.37.5's removed context.getFilename(), which aborts rule
  // loading outright — exit 2, with no report file written at all.
  //
  // ★★ TWO CALLERS, TWO DIFFERENT GATES — do not restate this as one. resolveBasedir is
  // also reached from detectFlowVersion, gated on settings.react.flowVersion, a SEPARATE
  // key this pin does not set. That route is unreachable only because no enabled rule
  // reaches testFlowVersion (measured: injecting flowVersion: "detect" alongside this pin
  // lints clean), so adding flowVersion: "detect" would reopen it.
  //
  // Derived, not restated — and the reason is the absence of a gate, not the presence of
  // one: version-sync-check reads APP_VERSION and the codename only, so NOTHING in this
  // repo would catch a stale hardcoded React version. That is what makes deriving
  // load-bearing rather than tidy.
  //
  // Keep the pin even after upstream ships v10 support: it is deterministic. It does NOT
  // save "a probe per rule load" — detectReactVersion memoises into
  // cachedDetectedReactVersion, so what it avoids is one filesystem probe per process.
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
