import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// Per-project load behaviour, keyed by project id.
const loadBehaviour = new Map<string, "ok" | "fail">();

vi.mock("./turso-backend", () => ({
  TursoBackend: class {
    constructor(private cfg: unknown, private projectId?: string) {}
    load() {
      if (loadBehaviour.get(this.projectId ?? "") === "fail") {
        return Promise.reject(new Error("boom"));
      }
      // Minimal workspace; computeDashboard is mocked so shape barely matters.
      return Promise.resolve({
        tasks: [], raid: [], budgets: [], roles: [], resources: [], absences: [],
        milestones: [], changes: [], plan: undefined, status: {},
      });
    }
  },
}));

// Mutable so a test can put the project into the no-active-scope state.
const stub = vi.hoisted(() => ({
  progress: { percent: 50, total: 4, inScope: 4 } as Record<string, number>,
}));

// ★★ importOriginal, NOT a bare factory. This module also exports
// `hasNoActiveScope`, which the hook calls to decide whether a project has a
// completion figure at all; a factory listing only the two heavy functions
// leaves it undefined and every test here dies with "not a function". Keep the
// REAL predicate — a hand-written stub of it is a second copy of the very
// expression `task-closed.ts` exists to stop people copying.
vi.mock("./dashboard", async (orig) => ({
  ...(await orig<typeof import("./dashboard")>()),
  buildDashboardInput: (e: unknown) => e,
  computeDashboard: () => ({
    overall: { effective: "G" },
    schedule: { effective: "G" },
    budget: { effective: null },
    progress: stub.progress,
    openRaidCount: 0,
    overdueMilestones: [],
    atRiskMilestones: [],
    dueSoonMilestones: [],
  }),
}));

import { usePortfolioHealth, PORTFOLIO_LOAD_FAILED } from "./use-portfolio-health";
import type { TursoConfig } from "./turso-config";

const CFG: TursoConfig = { httpUrl: "https://demo.turso.io", authToken: "tok" };
const projects = [
  { id: "p1", name: "Alpha" },
  { id: "p2", name: "Beta" },
] as never;

beforeEach(() => {
  loadBehaviour.clear();
  stub.progress = { percent: 50, total: 4, inScope: 4 };
});

describe("usePortfolioHealth", () => {
  it("returns a row per project on success", async () => {
    loadBehaviour.set("p1", "ok");
    loadBehaviour.set("p2", "ok");
    const { result } = renderHook(() =>
      usePortfolioHealth(CFG, projects, "2026-06-26", new Set(), 8),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows.map((r) => r.id)).toEqual(["p1", "p2"]);
    expect(result.current.error).toBeNull();
    expect(result.current.aggregate.projectCount).toBe(2);
    // A project WITH scope carries a real figure — the control for the test below.
    expect(result.current.rows.map((r) => r.completionPercent)).toEqual([50, 50]);
  });

  // open-followups §64: an all-cancelled project reported "0%" in the table a
  // portfolio owner scans across projects. The hook is where that is decided.
  it("reports null completion for a project with no active scope", async () => {
    stub.progress = { percent: 0, total: 3, inScope: 0 };
    loadBehaviour.set("p1", "ok");
    loadBehaviour.set("p2", "ok");
    const { result } = renderHook(() =>
      usePortfolioHealth(CFG, projects, "2026-06-26", new Set(), 8),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows.map((r) => r.completionPercent)).toEqual([null, null]);
    // Excluded from the average rather than dragging it to 0 — with every
    // project null there is nothing to average, so it falls back to 0.
    expect(result.current.aggregate.avgCompletionPercent).toBe(0);
    expect(result.current.aggregate.projectCount).toBe(2);
  });

  it("keeps a no-scope project out of the average without zeroing it", async () => {
    loadBehaviour.set("p1", "ok");
    loadBehaviour.set("p2", "ok");
    const { result } = renderHook(() =>
      usePortfolioHealth(CFG, projects, "2026-06-26", new Set(), 8),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Both scoped at 50 → 50, not something dragged down. The mixed case is
    // pinned in portfolio-rollup.test.ts, where the two sides can differ.
    expect(result.current.aggregate.avgCompletionPercent).toBe(50);
  });

  it("tolerates a PARTIAL failure (keeps the projects that loaded, no error)", async () => {
    loadBehaviour.set("p1", "ok");
    loadBehaviour.set("p2", "fail");
    const { result } = renderHook(() =>
      usePortfolioHealth(CFG, projects, "2026-06-26", new Set(), 8),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows.map((r) => r.id)).toEqual(["p1"]);
    expect(result.current.error).toBeNull();
  });

  it("surfaces an error (not empty) when EVERY project fails", async () => {
    loadBehaviour.set("p1", "fail");
    loadBehaviour.set("p2", "fail");
    const { result } = renderHook(() =>
      usePortfolioHealth(CFG, projects, "2026-06-26", new Set(), 8),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([]);
    expect(result.current.error).toBe(PORTFOLIO_LOAD_FAILED);
  });

  it("does nothing (no error) with no Turso config", async () => {
    const { result } = renderHook(() =>
      usePortfolioHealth(null, projects, "2026-06-26", new Set(), 8),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
