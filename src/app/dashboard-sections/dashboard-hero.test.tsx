import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ProjectStatus } from "../types";
import { computeDashboard, buildDashboardInput } from "../dashboard";
import { densityClasses } from "../dashboard-density";
import { computeMetricTrends } from "../dashboard-trends";
import { DashboardHero } from "./dashboard-hero";

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

function Host() {
  const [status, setStatus] = useState<ProjectStatus>({});
  return (
    <DashboardHero
      lang="en-US"
      today="2026-06-02"
      model={model()}
      trends={trends}
      status={status}
      setStatus={setStatus}
      onNavigate={vi.fn()}
      showBudget
      showChanges
      dc={densityClasses("comfortable")}
    />
  );
}

describe("DashboardHero", () => {
  it("renders the Overall band and the Adjust-health disclosure", () => {
    render(<Host />);
    expect(screen.getByText("Overall")).toBeInTheDocument();
    expect(screen.getByText("Adjust health ratings").closest("details")).not.toBeNull();
  });

  it("writes an override via the Overall select", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByText("Adjust health ratings"));
    // The Overall override select is the first combobox in the disclosure.
    const select = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    await user.selectOptions(select, "R");
    // setStatus drove status.ragOverride; OverrideSelect reads value from props.status,
    // so the controlled select now reflects "R" (proves the write path is wired).
    expect(select.value).toBe("R");
  });
});
