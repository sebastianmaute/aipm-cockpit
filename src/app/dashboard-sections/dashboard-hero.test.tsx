import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ProjectStatus } from "../types";
import { computeDashboard, buildDashboardInput } from "../dashboard";
import { densityClasses } from "../dashboard-density";
import { computeMetricTrends } from "../dashboard-trends";
import type { SuggestedAction } from "../next-actions/types";
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

const sampleAction: SuggestedAction = {
  id: "raid:1:severity",
  source: "raid",
  moduleId: "raid",
  title: { key: "actionRaidTitle", params: [1, "X"] },
  why: { key: "actionRaidWhySeverity", params: ["High"] },
  score: 60,
  tier: "now",
  cta: { kind: "open", view: "raid", id: 1 },
};

function Host(props: { topActions?: readonly SuggestedAction[] }) {
  const [status, setStatus] = useState<ProjectStatus>({});
  return (
    <DashboardHero
      lang="en-US"
      today="2026-06-02"
      model={model()}
      trends={trends}
      status={status}
      setStatus={setStatus}
      topActions={props.topActions}
      onOpenAction={vi.fn()}
      onNavigate={vi.fn()}
      showBudget
      showChanges
      dc={densityClasses("comfortable")}
    />
  );
}

describe("DashboardHero", () => {
  it("renders the Overall band, the 3 KPI tiles, and the Adjust-health disclosure", () => {
    render(<Host />);
    expect(screen.getByText("Overall")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Complete – Open the tasks list/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open RAID –/ })).toBeInTheDocument();
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

  it("renders the Top actions heading only when topActions has items", () => {
    const { rerender } = render(<Host />);
    expect(screen.queryByText("Top actions")).toBeNull();
    rerender(<Host topActions={[]} />);
    expect(screen.queryByText("Top actions")).toBeNull();
  });

  it("renders the Top actions heading + an ActionRow when a real action is passed", () => {
    render(<Host topActions={[sampleAction]} />);
    expect(screen.getByText("Top actions")).toBeInTheDocument();
    // The ActionRow render path is exercised: the action's title resolves.
    expect(screen.getByText(/X/)).toBeInTheDocument();
  });
});
