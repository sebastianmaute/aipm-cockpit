import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { computeDashboard, buildDashboardInput } from "../dashboard";
import { densityClasses } from "../dashboard-density";
import { computeMetricTrends } from "../dashboard-trends";
import { DashboardKpiStrip } from "./dashboard-kpi-strip";
import { t } from "../i18n";

const plan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "EUR" };

function modelFor(tasks: unknown) {
  return computeDashboard(
    buildDashboardInput(
      { tasks: tasks as never, raid: [], budgets: [], plan, roles: [], resources: [], absences: [], milestones: [], changes: [] },
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
      screen.getByRole("button", { name: t("en-US", "dashboardKpiCompleteHint") }),
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
