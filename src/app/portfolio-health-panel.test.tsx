import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { PortfolioRow } from "./portfolio-rollup";

// Mock the data hook so the panel test stays a pure presentational check.
const mockHook = vi.fn();
vi.mock("./use-portfolio-health", () => ({
  usePortfolioHealth: (...args: unknown[]) => mockHook(...args),
  PORTFOLIO_LOAD_FAILED: "portfolio-load-failed",
}));

// Control the Turso-config gate directly (real getTursoConfig validates URLs).
const mockTursoConfig = vi.fn();
vi.mock("./turso-config", () => ({
  getTursoConfig: (...args: unknown[]) => mockTursoConfig(...args),
}));

import { PortfolioHealthPanel } from "./portfolio-health-panel";
import { defaultSettings } from "./settings-types";

const baseProps = {
  lang: "en-US" as const,
  projects: [{ id: "p1", name: "Alpha" }] as never,
  today: "2026-06-26",
  holidaySet: new Set<string>(),
  workdayHours: 8,
};

// Settings WITH a Turso config so getTursoConfig returns non-null.
const tursoSettings = {
  ...defaultSettings,
  integrations: {
    ...defaultSettings.integrations,
    turso: { enabled: true, databaseUrl: "libsql://demo.turso.io", authToken: "tok" },
  },
};

describe("PortfolioHealthPanel", () => {
  it("shows a needs-Turso empty state when no Turso config", () => {
    mockTursoConfig.mockReturnValue(null);
    mockHook.mockReturnValue({ rows: [], aggregate: { projectCount: 0, overallR: 0, overallA: 0, overallG: 0, totalOpenRaid: 0, avgCompletionPercent: 0 }, loading: false, error: null });
    render(<PortfolioHealthPanel {...baseProps} settings={defaultSettings} />);
    expect(screen.getByText("Portfolio health needs Turso")).toBeInTheDocument();
  });

  it("renders a per-project row with RAG + completion when the hook returns rows", () => {
    const rows: PortfolioRow[] = [
      { id: "p1", name: "Alpha", overall: "G", schedule: "A", budget: "R", completionPercent: 42, openRaidCount: 3, milestoneHealth: "on_track" },
    ];
    mockTursoConfig.mockReturnValue({ httpUrl: "https://demo.turso.io", authToken: "tok" });
    mockHook.mockReturnValue({ rows, aggregate: { projectCount: 1, overallR: 0, overallA: 0, overallG: 1, totalOpenRaid: 3, avgCompletionPercent: 42 }, loading: false, error: null });
    render(<PortfolioHealthPanel {...baseProps} settings={tursoSettings} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    // 42% appears in both the aggregate KPI tile and the row's completion cell.
    expect(screen.getAllByText("42%").length).toBeGreaterThan(0);
  });

  // open-followups §64: an all-cancelled project reported "0%" in the table a
  // portfolio owner scans across projects — the same misreading the dashboard
  // stopped showing, on the surface where cross-project comparison happens.
  it("renders no-active-scope instead of 0% when a project has no scope left", () => {
    const rows: PortfolioRow[] = [
      { id: "p1", name: "Alpha", overall: "G", schedule: "G", budget: null, completionPercent: null, openRaidCount: 0, milestoneHealth: "on_track" },
    ];
    mockTursoConfig.mockReturnValue({ httpUrl: "https://demo.turso.io", authToken: "tok" });
    // ★ `avgCompletionPercent: 0` is a DELIBERATELY unreachable stub — production
    //   returns null for a portfolio of one no-scope project. It is kept so this
    //   test isolates the ROW cell; the tile is covered by the test below.
    //   Stubbing null here would make "No active scope" match twice and throw.
    //   It is type-valid either way, so tsc says nothing.
    mockHook.mockReturnValue({ rows, aggregate: { projectCount: 1, overallR: 0, overallA: 0, overallG: 1, totalOpenRaid: 0, avgCompletionPercent: 0 }, loading: false, error: null });
    render(<PortfolioHealthPanel {...baseProps} settings={tursoSettings} />);
    // Anchor on the sr-only text, NOT on the em dash: a null budget renders its
    // own "—" through RagCell, so getByText("—") throws on the second match.
    // The em dash is aria-hidden anyway, which makes this the accessible value.
    const cell = screen.getByText("No active scope").closest("td");
    expect(cell).not.toBeNull();
    expect(within(cell as HTMLElement).getByText("—")).toBeInTheDocument();
    // The row's cell must not read 0%. This stub still shows 0% on the tile, so
    // scope the absence to the cell — a bare queryByText("0%") would fail on the
    // tile and prove nothing about the row.
    expect(cell?.textContent).not.toContain("0%");
  });

  // ★★ The AGGREGATE tile, which had no test at all: `.tsx` is coverage-excluded
  //    and the Portfolio view is Turso-gated so it is not in A11Y_VIEWS either —
  //    nothing else looks at this surface. A "0%" tile above a table whose every
  //    row reads "—" is §64's misreading one level up from where it was closed.
  it("shows no average when no project contributed a completion figure", () => {
    const rows: PortfolioRow[] = [
      { id: "p1", name: "Alpha", overall: "G", schedule: "G", budget: "G", completionPercent: null, openRaidCount: 0, milestoneHealth: "on_track" },
    ];
    mockTursoConfig.mockReturnValue({ httpUrl: "https://demo.turso.io", authToken: "tok" });
    mockHook.mockReturnValue({ rows, aggregate: { projectCount: 1, overallR: 0, overallA: 0, overallG: 1, totalOpenRaid: 0, avgCompletionPercent: null }, loading: false, error: null });
    const { container } = render(<PortfolioHealthPanel {...baseProps} settings={tursoSettings} />);
    // TWO — the tile AND the row cell. `getByText` would throw on the second
    // match, and asserting only that "some" element says it would pass with the
    // tile left rendering "0%", which is the whole point of this test.
    expect(screen.getAllByText("No active scope")).toHaveLength(2);
    expect(container.textContent).not.toContain("0%");
    // The gradient bar must be gone too: at 0 it draws an empty progress track,
    // which reads as "nothing done yet" — the same misreading in pictorial form.
    // ★ Queried by its accessible name (`KpiGradientBar` renders role="img" with
    //   `${label}: ${pct}%`). A first draft used a `[data-kpi-bar]` selector that
    //   does not exist on that component, so it was null either way — vacuous.
    expect(screen.queryByRole("img", { name: /Avg\. complete/ })).toBeNull();
  });

  it("shows a loading skeleton while loading", () => {
    mockTursoConfig.mockReturnValue({ httpUrl: "https://demo.turso.io", authToken: "tok" });
    mockHook.mockReturnValue({ rows: [], aggregate: { projectCount: 0, overallR: 0, overallA: 0, overallG: 0, totalOpenRaid: 0, avgCompletionPercent: 0 }, loading: true, error: null });
    const { container } = render(<PortfolioHealthPanel {...baseProps} settings={tursoSettings} />);
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });
});
