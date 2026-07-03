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
        // Render-scope hook factories extracted from the (excluded) task-manager.tsx
        // orchestrator in the Phase 3 decomposition. They take a live render-scope
        // `deps` object and return UI event handlers — the SAME UI/render glue the
        // .tsx exclusion above covers (they are .ts only because a .ts hook may
        // receive refs, per the react-hooks purity rule). Their handlers run on user
        // interaction and are exercised by the task-manager characterization suites +
        // E2E, not unit-testable in isolation; the pure engines they call (next-actions,
        // calendar-reconcile, etc.) live in separate .ts files that REMAIN gated.
        // Excluding here keeps the gate on the pure logic/data layer, matching how this
        // code was treated (unmeasured, inside task-manager.tsx) before extraction.
        "src/app/use-calendar-integrations.ts",
        "src/app/use-action-center-handlers.ts",
        "src/app/use-ai-orchestration.ts",
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
      // Phase 2 ratchet (2026-07-02): raised to ~measured-minus-1 to lock in the
      // current floor. Measured this date: lines 92.67 / funcs 91.44 /
      // branches 80.89 / stmts 89.46 (the scoped .ts logic layer; the new
      // characterization suites exercise task-manager/workspace-section .tsx,
      // which are excluded from the % gate — line 48 — so they raise the floor
      // only transitively).
      thresholds: {
        // Global floor for the gated .ts logic/data layer — ratcheted to
        // measured-minus-headroom (measured 2026-07-03: lines 92.97 / funcs
        // 91.56 / branches 81.6 / stmts 89.86). Raise as coverage climbs; never
        // lower to make a PR pass.
        lines: 92,
        functions: 91,
        branches: 80,
        statements: 89,
        // Pure-engine per-directory floors (roadmap: pure engines should sit
        // >= 90). A glob key overrides the global floor for its matched files.
        // Measured 2026-07-03 in the trailing comment.
        "src/app/next-actions/**": { lines: 97, branches: 90 }, // 100 / 95.81
        "src/app/csv-codecs*.ts": { lines: 95, branches: 84 }, // 97.91 / 86.77
        "src/app/markdown-codecs*.ts": { lines: 96, branches: 90 }, // 98.98 / 93.66
        // sanitize branch coverage (84.82) is BELOW the >=90 engine target; the
        // floor is set at the honest measured level and tracked in the debt
        // register (TD: add validator branch tests to reach 90). Not faked.
        "src/app/sanitize*.ts": { lines: 93, branches: 82 }, // 95.46 / 84.82
      },
    },
  },
});
