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

vi.mock("./dashboard", () => ({
  computeDashboard: () => ({
    overall: { effective: "G" },
    schedule: { effective: "G" },
    budget: { effective: null },
    progress: { percent: 50 },
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
