import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    css: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Headroom above the 5s default: the CPU-heavy property suites (fast-check,
    // 100 runs each) plus fake-indexeddb setup occasionally exceed 5s when a
    // worker is starved under full-suite parallel load on slower machines —
    // a rare, non-deterministic timeout that never reproduces in isolation or
    // in CI. Raising the ceiling absorbs the scheduling spike without changing
    // any test logic; a genuinely hung test still fails, just later.
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      // The 70% threshold guards the business-logic / data layer. The
      // categories below are validated by component/E2E tests or are not
      // meaningfully unit-testable, so they are excluded from the % gate.
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/**/*.d.ts",
        // Test-only utilities (msw server, fixtures):
        "src/test/**",
        // Next.js framework boundaries + route glue (E2E/manually verified):
        "src/proxy.ts",
        "src/app/layout.tsx",
        "src/app/page.tsx",
        "src/app/error.tsx",
        "src/app/global-error.tsx",
        "src/app/**/route.ts",
        // Pure translation dictionary (data, no logic):
        "src/app/i18n.de.ts",
        // React UI components — validated via component/E2E tests, not this gate:
        "src/app/**/*.tsx",
        // External-format serializers, binary packing, speech & network clients
        // (integration/E2E-tested, not unit-coverage-gated):
        "src/app/export-ooxml.ts",
        "src/app/export.ts",
        "src/app/zip.ts",
        "src/app/voice.ts",
        "src/app/jira-api.ts",
      ],
      // Ratcheted floor for the scoped logic/data layer (see `exclude` above).
      // Set just below the measured coverage (lines 92.5 / stmts 89.7 / funcs
      // 91.9 / branch 81.3 as of 2026-06-12) to lock in the gains and catch
      // regressions, with a few points of headroom for normal churn. Raise
      // these as coverage climbs; never lower them just to make a PR pass.
      // Phase 2 ratchet (2026-07-02): raised to ~measured-minus-1 after the
      // characterization suites added task-manager/workspace-section coverage.
      // Measured this date: lines 92.67 / funcs 91.44 / branches 80.89 / stmts 89.46.
      thresholds: {
        lines: 91,
        functions: 90,
        branches: 79,
        statements: 88,
      },
    },
  },
});
