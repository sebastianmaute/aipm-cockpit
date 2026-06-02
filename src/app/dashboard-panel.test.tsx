import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { DashboardPanel } from "./dashboard-panel";

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
});
