import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { computeDashboard, buildDashboardInput } from "../dashboard";
import { densityClasses } from "../dashboard-density";
import { computeMetricTrends } from "../dashboard-trends";
import { DashboardKpiStrip } from "./dashboard-kpi-strip";
import { t } from "../i18n";

const plan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "EUR" };

function model() {
  return computeDashboard(
    buildDashboardInput(
      { tasks: [], raid: [], budgets: [], plan, roles: [], resources: [], absences: [], milestones: [], changes: [] },
      { workdayHours: 8, holidaySet: new Set<string>(), status: {}, activity: [], today: "2026-06-02" },
    ),
  );
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
