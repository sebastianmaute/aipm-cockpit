import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { DashboardPanel } from "./dashboard-panel";
import { RegistersBand } from "./dashboard-sections/registers-band";

vi.mock("./activity-log", async (orig) => ({
  ...(await orig<typeof import("./activity-log")>()),
  loadActivityLog: () => [],
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

const plan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "EUR" };

describe("DashboardPanel", () => {
  it("renders an empty workspace without crashing", () => {
    const { container } = render(
      <DashboardPanel
        lang="en-US"
        tasks={[]}
        raid={[]}
        budgets={[]}
        plan={plan}
        roles={[]}
        resources={[]}
        absences={[]}
        holidaySet={new Set<string>()}
        workdayHours={8}
        today="2026-06-02"
      />,
      { wrapper },
    );
    expect(container).toBeTruthy();
  });

  it("renders lettered RAG badges on the status pills", () => {
    render(
      <DashboardPanel
        lang="en-US"
        tasks={[]}
        raid={[]}
        budgets={[]}
        plan={plan}
        roles={[]}
        resources={[]}
        absences={[]}
        holidaySet={new Set<string>()}
        workdayHours={8}
        today="2026-06-02"
      />,
      { wrapper },
    );
    expect(screen.getAllByText(/^[RAG]$/).length).toBeGreaterThan(0);
  });
});

describe("DashboardPanel captions and thresholds", () => {
  function renderDashboard() {
    render(
      <DashboardPanel
        lang="en-US"
        tasks={[
          { id: 1, title: "Done task", status: "Done", health: "G", linkedRaidIds: [], subtaskIds: [], parentId: null, assigneeIds: [] } as never,
        ]}
        raid={[]}
        budgets={[]}
        plan={plan}
        roles={[]}
        resources={[]}
        absences={[]}
        holidaySet={new Set<string>()}
        workdayHours={8}
        today="2026-06-02"
      />,
      { wrapper },
    );
  }

  it("colourises the Overall status text and shows captions + thresholds", () => {
    renderDashboard();
    expect(screen.getByText(/Amber ≥ 90%/)).toBeInTheDocument();
    expect(screen.getByText(/Tasks completed vs total/)).toBeInTheDocument();
    expect(screen.getByText(/burn-down shows remaining budget/)).toBeInTheDocument();
    const overallSpans = screen.getAllByText(/^(Green|Amber|Red)$/).filter(
      (el) => el.className && /text-AIPM-(green|purple|pink)/.test(el.className),
    );
    expect(overallSpans.length).toBeGreaterThan(0);
    expect(overallSpans[0].className).toMatch(/text-AIPM-(green|purple|pink)/);
  });
});

describe("RegistersBand link styling", () => {
  it("uses the directory hover affordance, not underline", () => {
    render(
      <RegistersBand
        lang="en-US"
        topRaid={[{ id: 1, category: "R", title: "risk", status: "Open", linkedTaskIds: [], raisedDate: "2026-01-01", causedByRaidIds: [] } as never]}
        overdue={[]} dueSoon={[]}
        overdueMilestones={[]} atRiskMilestones={[]} dueSoonMilestones={[]}
        onOpenRaid={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: /risk/ });
    expect(btn.className).toContain("hover:bg-surface-muted");
    expect(btn.className).not.toContain("hover:underline");
  });
});
