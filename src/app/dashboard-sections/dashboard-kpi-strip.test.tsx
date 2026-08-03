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
        trends={trends}
        onNavigate={vi.fn()}
        dc={densityClasses("comfortable")}
      />,
    );
    expect(screen.getByText(t("en-US", "dashboardNoActiveScope"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "dashboardAllCancelled", "2"))).toBeInTheDocument();
    expect(screen.queryByText("0%")).toBeNull();
    // KpiGradientBar is the completion tile's sole role="img" element.
    expect(screen.queryByRole("img")).toBeNull();
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
        trends={trends}
        onNavigate={vi.fn()}
        dc={densityClasses("comfortable")}
      />,
    );
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "dashboardNoActiveScope"))).toBeNull();
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
