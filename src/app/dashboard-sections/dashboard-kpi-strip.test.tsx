import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { computeDashboard, buildDashboardInput } from "../dashboard";
import { densityClasses } from "../dashboard-density";
import { computeMetricTrends } from "../dashboard-trends";
import { DashboardKpiStrip, KPI_STRIP_COLS } from "./dashboard-kpi-strip";
import { t } from "../i18n";

const plan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "EUR" as const };

function modelFor(tasks: unknown) {
  return computeDashboard(
    buildDashboardInput(
      { tasks: tasks as never, raid: [], budgets: [], plan, roles: [], resources: [], absences: [], fxRates: null, milestones: [], changes: [] },
      { workdayHours: 8, holidaySet: new Set<string>(), status: {}, activity: [], today: "2026-06-02" },
    ),
  );
}

function model() {
  return modelFor([]);
}

function taskFixture(id: number, status: string, completedDate?: string) {
  return {
    id, taskName: `Task ${id}`, assignee: "A", assigneeEmail: "a@x.io",
    dueDate: "2026-05-01", lastUpdateDate: "2026-05-01", status,
    priority: "Medium", blockers: "", description: "",
    ...(completedDate ? { completedDate } : {}),
  };
}

const trends = computeMetricTrends(undefined, { complete: 0, overdue: 0, openRaid: 0 });

// ★★ `trends` above has NO prior (first visit), so every MetricTrend carries
// `delta: null` and TrendArrow returns null in EVERY branch. A test using it
// cannot tell a SUPPRESSED arrow from an arrow that was never going to render:
// deleting the `noActiveScope ? undefined :` guard from the `trend` prop passes
// the whole suite (verified by mutation). This fixture has a prior, so the arrow
// really renders — and the two tests below assert it PRESENT in the control case
// and ABSENT in the no-active-scope one, which is what makes the pair
// self-validating: a degenerate fixture fails the presence half.
const trendsWithPrior = computeMetricTrends(
  { complete: 40, overdue: 0, openRaid: 0 },
  { complete: 0, overdue: 0, openRaid: 0 },
);

/** The completion arrow's accessible name — the wrapper's aria-label carries the
 *  meaning; the glyph and number are aria-hidden. */
const COMPLETE_TREND_LABEL = t(
  "en-US",
  "dashboardTrendDown",
  t("en-US", "dashboardKpiComplete"),
  "40%",
);

describe("DashboardKpiStrip", () => {
  it("renders the three KPI tile labels and the completion tile activateLabel", () => {
    render(
      <DashboardKpiStrip
        lang="en-US"
        model={model()}
        trends={trends}
        onNavigate={vi.fn()}
        dc={densityClasses("comfortable")}
      />,
    );
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("Open RAID")).toBeInTheDocument();
    // Completion tile activateLabel resolves as an accessible button name.
    expect(screen.getByRole("button", { name: /Complete – Open the tasks list/ })).toBeInTheDocument();
  });

  it("renders Open RAID tile button with accessible name when onNavigate is provided", () => {
    render(
      <DashboardKpiStrip
        lang="en-US"
        model={model()}
        trends={trends}
        onNavigate={vi.fn()}
        dc={densityClasses("comfortable")}
      />,
    );
    expect(screen.getByRole("button", { name: /Open RAID –/ })).toBeInTheDocument();
  });

  it("renders an explanatory InfoTooltip trigger on each KPI tile", () => {
    render(
      <DashboardKpiStrip
        lang="en-US"
        model={model()}
        trends={trends}
        onNavigate={vi.fn()}
        dc={densityClasses("comfortable")}
      />,
    );
    // InfoTooltip renders a span[role=button] whose accessible name defaults to the hint text.
    expect(
      screen.getByRole("button", { name: t("en-US", "dashboardCompleteHint") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("en-US", "dashboardKpiOverdueHint") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("en-US", "dashboardKpiOpenRaidHint") }),
    ).toBeInTheDocument();
  });
});

describe("DashboardKpiStrip completion tile no-active-scope state", () => {
  it("reads as no-active-scope (no '0%', no gradient bar) when every task is cancelled", () => {
    const allCancelled = modelFor([taskFixture(1, "Cancelled"), taskFixture(2, "Cancelled")]);
    render(
      <DashboardKpiStrip
        lang="en-US"
        model={allCancelled}
        trends={trendsWithPrior}
        onNavigate={vi.fn()}
        dc={densityClasses("comfortable")}
      />,
    );
    expect(screen.getByText(t("en-US", "dashboardNoActiveScope"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "dashboardAllCancelled", "2"))).toBeInTheDocument();
    expect(screen.queryByText("0%")).toBeNull();
    // KpiGradientBar is the completion tile's sole role="img" element.
    expect(screen.queryByRole("img")).toBeNull();
    // And the trend arrow: it would announce a delta against a percentage the
    // tile no longer shows. The control test below proves this fixture DOES
    // render an arrow, so this absence is a suppression, not a no-op.
    expect(screen.queryByLabelText(COMPLETE_TREND_LABEL)).toBeNull();
    // Same reason as the bar and the arrow: the hint explains how a percentage
    // is derived, and this tile shows none. InfoTooltip's accessible name IS
    // the hint text (`info-tooltip.tsx:47`, `aria-label={label ?? text}`), and
    // the control test proves it renders for a normal project.
    expect(screen.queryByLabelText(t("en-US", "dashboardCompleteHint"))).toBeNull();
  });

  it("still renders the percent + gradient bar for a normal (non-cancelled) project", () => {
    const normal = modelFor([
      ...Array.from({ length: 4 }, (_, i) => taskFixture(i + 1, "Done", "2026-05-01")),
      ...Array.from({ length: 6 }, (_, i) => taskFixture(i + 5, "In Progress")),
    ]);
    render(
      <DashboardKpiStrip
        lang="en-US"
        model={normal}
        trends={trendsWithPrior}
        onNavigate={vi.fn()}
        dc={densityClasses("comfortable")}
      />,
    );
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "dashboardNoActiveScope"))).toBeNull();
    // The half that makes the suppression above meaningful: with the same
    // fixture, an arrow really does render here.
    expect(screen.getByLabelText(COMPLETE_TREND_LABEL)).toBeInTheDocument();
    expect(screen.getByLabelText(t("en-US", "dashboardCompleteHint"))).toBeInTheDocument();
  });

  it("leaves an empty project on 0% complete (not no-active-scope)", () => {
    const empty = modelFor([]);
    render(
      <DashboardKpiStrip
        lang="en-US"
        model={empty}
        trends={trends}
        onNavigate={vi.fn()}
        dc={densityClasses("comfortable")}
      />,
    );
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "dashboardNoActiveScope"))).toBeNull();
  });
});

// ── The retired Progress tile's content, merged into At a glance ────────────
describe("DashboardKpiStrip — merged Progress cells", () => {
  // 2 delivered, 2 open (both overdue against today 2026-06-02), 1 cancelled:
  // 2 of 4 in scope complete → 50%, and one task out of scope.
  const MIXED = [
    taskFixture(1, "Done", "2026-05-01"), taskFixture(2, "Done", "2026-05-01"),
    taskFixture(3, "In Progress"), taskFixture(4, "To Do"),
    taskFixture(5, "Cancelled"),
  ];
  const openTasks = t("en-US", "dashboardOpenTasksView");
  const ragCell = () => screen.getByRole("button", { name: `R / A / G – ${openTasks}` });

  it("the Complete cell carries its percentage, bar, trend arrow AND the count", () => {
    render(<DashboardKpiStrip lang="en-US" model={modelFor(MIXED)} trends={trendsWithPrior} onNavigate={vi.fn()} dc={densityClasses("comfortable")} />);
    const cell = screen.getByRole("button", { name: `${t("en-US", "dashboardKpiComplete")} – ${openTasks}` });
    expect(within(cell).getByText("50%")).toBeInTheDocument();
    expect(within(cell).getByRole("img")).toBeInTheDocument();
    expect(within(cell).getByLabelText(COMPLETE_TREND_LABEL)).toBeInTheDocument();
    expect(within(cell).getByText(t("en-US", "dashboardCompletedOf", "2", "4"))).toBeInTheDocument();
  });

  it("names the Complete tooltip with dashboardCompleteHint", () => {
    render(<DashboardKpiStrip lang="en-US" model={modelFor(MIXED)} trends={trends} onNavigate={vi.fn()} dc={densityClasses("comfortable")} />);
    expect(screen.getByRole("button", { name: t("en-US", "dashboardCompleteHint") })).toBeInTheDocument();
  });

  it("drops the Complete tooltip and the count in the no-active-scope state", () => {
    render(<DashboardKpiStrip lang="en-US" model={modelFor([taskFixture(1, "Cancelled")])} trends={trends} onNavigate={vi.fn()} dc={densityClasses("comfortable")} />);
    expect(screen.getByText(t("en-US", "dashboardNoActiveScope"))).toBeInTheDocument();   // positive control
    expect(screen.queryByRole("button", { name: t("en-US", "dashboardCompleteHint") })).toBeNull();
    expect(screen.queryByText(t("en-US", "dashboardCompletedOf", "0", "0"))).toBeNull();
  });

  it("renders an R / A / G cell with its tooltip and the ✕ marker when work is out of scope", () => {
    const m = modelFor(MIXED);
    expect(m.progress.outOfScope).toBe(1);   // the fixture really has out-of-scope work
    render(<DashboardKpiStrip lang="en-US" model={m} trends={trends} onNavigate={vi.fn()} dc={densityClasses("comfortable")} />);
    const cell = ragCell();
    const { R, A, G } = m.progress.counts;
    expect(cell.textContent).toContain(`${R}${A}${G}`);
    expect(within(cell).getByText("✕")).toHaveAttribute("aria-hidden", "true");
    expect(within(cell).getByText(t("en-US", "dashboardOutOfScopeCount"))).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: t("en-US", "dashboardRagSplitHint") })).toBeInTheDocument();
  });

  it("omits the ✕ marker when nothing is out of scope", () => {
    const m = modelFor(MIXED.slice(0, 4));
    expect(m.progress.outOfScope).toBe(0);
    render(<DashboardKpiStrip lang="en-US" model={m} trends={trends} onNavigate={vi.fn()} dc={densityClasses("comfortable")} />);
    expect(ragCell()).toBeInTheDocument();                                   // positive control
    expect(within(ragCell()).queryByText("✕")).toBeNull();
    expect(within(ragCell()).queryByText(t("en-US", "dashboardOutOfScopeCount"))).toBeNull();
  });

  it("orders the cells Complete · R/A/G · Overdue · Open RAID, then SPI · CPI when present", () => {
    const labels = (grid: Element) => Array.from(grid.children, (c) => c.querySelector("p")!.textContent);
    const base = [t("en-US", "dashboardKpiComplete"), "R / A / G", t("en-US", "dashboardKpiOverdue"), t("en-US", "dashboardKpiOpenRaid")];
    const cases: Array<[unknown[], string[]]> = [
      [[], base],
      [[{ ...taskFixture(1, "In Progress", "2026-06-01"), dueDate: "2026-06-01", originalEstimateMinutes: 4800, timeSpentMinutes: 0 }], [...base, t("en-US", "evmSpi")]],
      [[
        { ...taskFixture(1, "Done", "2026-06-02"), dueDate: "2026-06-02", originalEstimateMinutes: 4800, timeSpentMinutes: 6000 },
        { ...taskFixture(2, "To Do"), dueDate: "2026-06-02", originalEstimateMinutes: 2400 },
      ], [...base, t("en-US", "evmSpi"), t("en-US", "evmCpi")]],
    ];
    for (const [tasks, expected] of cases) {
      const { container, unmount } = render(<DashboardKpiStrip lang="en-US" model={modelFor(tasks)} trends={trends} onNavigate={vi.fn()} dc={densityClasses("comfortable")} />);
      expect(labels(container.firstElementChild!.firstElementChild!)).toEqual(expected);
      unmount();
    }
  });
});

// ── Spec C decision 8: Effort SPI / Effort CPI live in the KPI tile ─────────
describe("DashboardKpiStrip — Effort SPI and CPI (spec C)", () => {
  // 80 h earned of 120 h planned → SPI 0.67; 100 h booked → CPI 0.80.
  const EVM_TASKS = [
    { ...taskFixture(1, "Done", "2026-06-02"), dueDate: "2026-06-02", originalEstimateMinutes: 4800, timeSpentMinutes: 6000 },
    { ...taskFixture(2, "To Do"), dueDate: "2026-06-02", originalEstimateMinutes: 2400 },
  ];

  // pv = 80h (due by today, so it counts), ev = 80h (completed by today), ac = 0
  // (`timeSpentMinutes` 0) → spi = 1.00, cpi = null (`evm.ts`: cpi is null when
  // ac === 0). The common early case: an estimate exists and its due date has
  // passed, but no hours have been booked against it yet.
  const SPI_ONLY_TASKS = [
    { ...taskFixture(1, "In Progress", "2026-06-01"), dueDate: "2026-06-01", originalEstimateMinutes: 4800, timeSpentMinutes: 0 },
  ];

  // pv = 0 (due date is AFTER today, so it never counts toward pv) → spi = null.
  // ac = 100h (`timeSpentMinutes` booked) → cpi = 0/100 = 0.00. The mirror case:
  // hours are booked against a task before its due date arrives.
  const CPI_ONLY_TASKS = [
    { ...taskFixture(1, "In Progress"), dueDate: "2026-07-01", originalEstimateMinutes: 4800, timeSpentMinutes: 6000 },
  ];

  // Each index's own `<Tile>` — a `<button>` here since every render in this
  // describe block passes `onNavigate`. Scoping a value to its own tile (not
  // just to the strip as a whole) is what catches a mutant that swapped the
  // SPI and CPI values under their labels.
  function tileFor(label: string): HTMLElement {
    return screen.getByText(label).closest("button") as HTMLElement;
  }

  it("adds both index tiles with their labels, values and hints when estimates exist", () => {
    render(<DashboardKpiStrip lang="en-US" model={modelFor(EVM_TASKS)} trends={trends} onNavigate={vi.fn()} dc={densityClasses("comfortable")} />);
    expect(within(tileFor(t("en-US", "evmSpi"))).getByText("0.67")).toBeInTheDocument();
    expect(within(tileFor(t("en-US", "evmCpi"))).getByText("0.80")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "evmSpiHint") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "evmCpiHint") })).toBeInTheDocument();
  });

  it("opens the Budget view from either index tile, named after its own label", () => {
    const onNavigate = vi.fn();
    render(<DashboardKpiStrip lang="en-US" model={modelFor(EVM_TASKS)} trends={trends} onNavigate={onNavigate} dc={densityClasses("comfortable")} />);
    const open = t("en-US", "dashboardOpenBudgetView");
    screen.getByRole("button", { name: `${t("en-US", "evmSpi")} – ${open}` }).click();
    screen.getByRole("button", { name: `${t("en-US", "evmCpi")} – ${open}` }).click();
    expect(onNavigate).toHaveBeenNthCalledWith(1, "budget");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "budget");
  });

  // ★ Neither tile takes a Budget-module signal at all — `modelFor` above
  // always passes `budgets: []` (see its definition earlier in this file), so
  // this run doubles as proof that both render with the Budget module
  // effectively off, exactly as the migrated `dashboard-panel.test.tsx`
  // integration test pins.
  it("omits both when no task carries an estimate", () => {
    render(<DashboardKpiStrip lang="en-US" model={model()} trends={trends} onNavigate={vi.fn()} dc={densityClasses("comfortable")} />);
    expect(screen.getByText("Complete")).toBeInTheDocument();          // positive control
    expect(screen.queryByText(t("en-US", "evmSpi"))).toBeNull();
    expect(screen.queryByText(t("en-US", "evmCpi"))).toBeNull();
  });

  // The engine makes the two indices INDEPENDENT (`evm.ts`: spi is null when
  // pv === 0, cpi is null when ac === 0 — two different sums), so a tile gated
  // on the WRONG field is a real, reachable bug, not just a theoretical one.
  it("shows only Effort SPI when an estimate is due but no hours are booked yet", () => {
    render(<DashboardKpiStrip lang="en-US" model={modelFor(SPI_ONLY_TASKS)} trends={trends} onNavigate={vi.fn()} dc={densityClasses("comfortable")} />);
    expect(screen.getByText(t("en-US", "evmSpi"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "evmCpi"))).toBeNull();
  });

  // §581: the column classes follow the VISIBLE cell count, so no count leaves
  // an empty cell (the old `showSpi || showCpi` OR gave four cells a
  // five-column row). jsdom has no layout and no container queries — this pins
  // the class plumbing; the breakpoints themselves were measured in Chromium
  // (see `KPI_STRIP_COLS`).
  describe("columns follow the visible cell count (§581)", () => {
    function stripGrid(container: HTMLElement): { wrapper: HTMLElement; grid: HTMLElement } {
      const wrapper = container.firstElementChild as HTMLElement;
      return { wrapper, grid: wrapper.firstElementChild as HTMLElement };
    }
    const classesOf = (el: HTMLElement) => el.className.split(/\s+/);

    it("is a container, so the columns size to the tile rather than the viewport", () => {
      const { container } = render(<DashboardKpiStrip lang="en-US" model={model()} trends={trends} dc={densityClasses("comfortable")} />);
      expect(classesOf(stripGrid(container).wrapper)).toContain("@container");
    });

    it("pads with the density's kpiPad, not cardPad (§585)", () => {
      const { container } = render(<DashboardKpiStrip lang="en-US" model={model()} trends={trends} dc={densityClasses("compact")} />);
      const wrapper = classesOf(stripGrid(container).wrapper);
      expect(wrapper).toEqual(expect.arrayContaining(["px-2", "py-0"]));
      expect(wrapper).not.toContain("p-2");
    });

    it("4 cells (no index): two by two, then one row of four — never five columns", () => {
      const { container } = render(<DashboardKpiStrip lang="en-US" model={model()} trends={trends} dc={densityClasses("comfortable")} />);
      const { grid } = stripGrid(container);
      expect(grid.children).toHaveLength(4);
      expect(classesOf(grid)).toEqual(expect.arrayContaining(KPI_STRIP_COLS[4].split(" ")));
      expect(KPI_STRIP_COLS[4]).toBe("@2xs:grid-cols-2 @[34rem]:grid-cols-4");
      expect(grid.className).not.toMatch(/grid-cols-[35]\b/);
    });

    it("5 cells (one index): 3 + 2 on six tracks (a full second row), then one row of five", () => {
      const { container } = render(<DashboardKpiStrip lang="en-US" model={modelFor(SPI_ONLY_TASKS)} trends={trends} dc={densityClasses("comfortable")} />);
      const { grid } = stripGrid(container);
      expect(grid.children).toHaveLength(5);
      expect(classesOf(grid)).toEqual(expect.arrayContaining(KPI_STRIP_COLS[5].split(" ")));
      expect(KPI_STRIP_COLS[5].split(" ")).toEqual([
        "@[25rem]:grid-cols-6", "@[25rem]:*:col-span-2", "@[25rem]:*:nth-last-[-n+2]:col-span-3",
        "@2xl:grid-cols-5", "@2xl:*:col-span-1", "@2xl:*:nth-last-[-n+2]:col-span-1",
      ]);
    });

    it("6 cells (both indices): two, then three, then one row of six", () => {
      const { container } = render(<DashboardKpiStrip lang="en-US" model={modelFor(EVM_TASKS)} trends={trends} dc={densityClasses("comfortable")} />);
      const { grid } = stripGrid(container);
      expect(grid.children).toHaveLength(6);
      expect(classesOf(grid)).toEqual(expect.arrayContaining(KPI_STRIP_COLS[6].split(" ")));
      expect(KPI_STRIP_COLS[6]).toBe("@2xs:grid-cols-2 @[25rem]:grid-cols-3 @4xl:grid-cols-6");
    });

    it("gives each count its own classes", () => {
      expect(new Set([KPI_STRIP_COLS[4], KPI_STRIP_COLS[5], KPI_STRIP_COLS[6]]).size).toBe(3);
    });
  });

  it("shows only Effort CPI when hours are booked on a task that is not yet due", () => {
    render(<DashboardKpiStrip lang="en-US" model={modelFor(CPI_ONLY_TASKS)} trends={trends} onNavigate={vi.fn()} dc={densityClasses("comfortable")} />);
    expect(screen.getByText(t("en-US", "evmCpi"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "evmSpi"))).toBeNull();
  });
});
