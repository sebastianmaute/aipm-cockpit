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

/** Mutable so a test can put a project into the no-active-scope state.
 *
 *  ★★ `seq` exists because the average is the thing worth pinning and a UNIFORM
 *  fixture cannot pin it: with every project null the correct divisor
 *  (`completionCount`) and the wrong one (`rows.length`) both yield 0, and with
 *  every project scoped they both yield the same mean. Only a MIXED portfolio
 *  separates them. `computeDashboard` is called once per project in registry
 *  order, so `seq` is consumed positionally; it falls back to `progress` once
 *  exhausted. */
const stub = vi.hoisted(() => ({
  progress: { percent: 50, total: 4, inScope: 4 } as Record<string, number>,
  seq: [] as Record<string, number>[],
  calls: 0,
}));

// ★★ importOriginal, NOT a bare factory. This module also exports
// `hasNoActiveScope`, which the hook calls to decide whether a project has a
// completion figure at all; a bare factory listing only the two heavy functions
// leaves it undefined, and the two tests that build rows from a successful load
// die with "not a function" (the other two never reach it). Keep the REAL
// predicate — a hand-written stub of it is a second copy of the very expression
// `task-closed.ts` exists to stop people copying.
vi.mock("./dashboard", async (orig) => ({
  ...(await orig<typeof import("./dashboard")>()),
  buildDashboardInput: (e: unknown) => e,
  computeDashboard: () => ({
    overall: { effective: "G" },
    schedule: { effective: "G" },
    budget: { effective: null },
    progress: stub.seq[stub.calls++] ?? stub.progress,
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
  stub.seq = [];
  stub.calls = 0;
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
    // ★ The aggregate is null too, for the same reason the rows are: nothing
    //   contributed a figure, so there is nothing to average. A 0 here would put
    //   "0%" above a table whose every row reads "—".
    //   ★★ This does NOT pin the divisor — the mixed test below does. With every
    //   project null, the wrong divisor (`rows.length`) never runs either, since
    //   `completionCount === 0` short-circuits first.
    expect(result.current.aggregate.avgCompletionPercent).toBeNull();
    expect(result.current.aggregate.projectCount).toBe(2);
  });

  // ★★ The MIXED portfolio — the only shape that pins the divisor. 80 under the
  //    fix (one contributing project), 40 if the divisor goes back to
  //    `rows.length`. An earlier version of this test set no `seq` at all, so
  //    both projects were scoped and it asserted the same thing as the control
  //    above under a title describing a branch it never reached.
  it("keeps a no-scope project out of the average without zeroing it", async () => {
    stub.seq = [
      { percent: 80, total: 5, inScope: 5 },
      { percent: 0, total: 3, inScope: 0 },
    ];
    loadBehaviour.set("p1", "ok");
    loadBehaviour.set("p2", "ok");
    const { result } = renderHook(() =>
      usePortfolioHealth(CFG, projects, "2026-06-26", new Set(), 8),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows.map((r) => r.completionPercent)).toEqual([80, null]);
    expect(result.current.aggregate.avgCompletionPercent).toBe(80);
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
