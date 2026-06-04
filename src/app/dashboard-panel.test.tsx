import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { DashboardPanel } from "./dashboard-panel";
import { RegistersBand } from "./dashboard-sections/registers-band";
import { healthText } from "./health";
import type { RaidItem, Milestone, ChangeItem } from "./types";

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

const minimalBudget = [
  {
    id: 1, name: "Test PO", type: "tm" as const, currency: "EUR" as const,
    startDate: "2026-01-01", endDate: "2026-12-31", status: "open" as const,
    allocations: [],
  },
];

describe("DashboardPanel captions and thresholds", () => {
  function renderDashboard() {
    render(
      <DashboardPanel
        lang="en-US"
        tasks={[
          { id: 1, title: "Done task", status: "Done", health: "G", linkedRaidIds: [], subtaskIds: [], parentId: null, assigneeIds: [] } as never,
        ]}
        raid={[]}
        budgets={minimalBudget as never}
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

  it("renders the RAG thresholds legend in the Overall band", () => {
    renderDashboard();
    expect(screen.getByText(/Amber ≥ 90%/)).toBeInTheDocument();
  });

  it("renders the progress and burn captions", () => {
    renderDashboard();
    expect(screen.getByText(/Tasks completed vs total/)).toBeInTheDocument();
    expect(screen.getByText(/burn-down shows remaining budget/)).toBeInTheDocument();
  });

  it("applies the AIPM colour class to the overall status word", () => {
    renderDashboard();
    const overallSpans = screen.getAllByText(/^(Green|Amber|Red)$/).filter((el) =>
      /text-AIPM-(green|purple|pink)/.test(el.className),
    );
    expect(overallSpans.length).toBeGreaterThan(0);
    expect(overallSpans[0].className).toMatch(/text-AIPM-green/);
  });
});

describe("DashboardPanel Changes subsection", () => {
  it("renders a Changes subsection with the pending count", () => {
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
        changes={[
          {
            id: 1, title: "Add module", description: "", type: "Scope", status: "Proposed",
            impact: "High", raisedDate: "2026-05-01", linkedTaskIds: [], linkedRaidIds: [],
          },
        ]}
      />,
      { wrapper },
    );
    expect(screen.getByText(/changes/i)).toBeTruthy();
    expect(screen.getByText(/1 pending/i)).toBeTruthy();
  });
});

describe("DashboardPanel RAG polish (Task 3)", () => {
  it("colorizes the R / A / G counts with the AIPM health text classes", () => {
    render(
      <DashboardPanel
        lang="en-US"
        tasks={[
          // Overdue → Red open task so the R count is at least 1.
          { id: 1, title: "Overdue", status: "Open", dueDate: "2026-01-01", linkedRaidIds: [], subtaskIds: [], parentId: null, assigneeIds: [] } as never,
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
    const redCount = screen.getByText("1", { selector: `span.${healthText.R.replace(/\s+/g, ".")}` });
    expect(redCount).toBeInTheDocument();
    expect(redCount.className).toContain("text-AIPM-pink");
  });

  it("wraps the Progress section in a boxed rounded-lg card", () => {
    render(
      <DashboardPanel
        lang="en-US"
        tasks={[
          { id: 1, title: "Done task", status: "Done", health: "G", linkedRaidIds: [], subtaskIds: [], parentId: null, assigneeIds: [] } as never,
        ]}
        raid={[]}
        budgets={minimalBudget as never}
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
    const heading = screen.getByText("Progress");
    expect(heading.closest("div.rounded-lg")).not.toBeNull();
  });

  it("commits the narrative via the Save button and shows the updated label", async () => {
    const user = userEvent.setup();
    render(
      <DashboardPanel
        lang="en-US"
        tasks={[]}
        raid={[]}
        budgets={minimalBudget as never}
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
    const textarea = screen.getByPlaceholderText(/Summarize the current status/i);
    await user.type(textarea, "All good this week");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });
});

describe("DashboardPanel status narrative Clear button", () => {
  it("Clear empties and persists the status narrative", async () => {
    const user = userEvent.setup();
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
    // Seed a non-empty narrative via the textarea + Save
    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "Some narrative text");
    await user.click(screen.getByRole("button", { name: /save/i }));
    // Now the Clear button should be enabled (narrative is non-empty)
    const clearBtn = screen.getByRole("button", { name: /clear/i });
    expect(clearBtn).not.toBeDisabled();
    await user.click(clearBtn);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("Clear is disabled when the narrative is already empty", () => {
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
    const clearBtn = screen.getByRole("button", { name: /clear/i });
    expect(clearBtn).toBeDisabled();
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

// ─── Task 8: showBudget / showMilestones / showRaid / showChanges gates ───────

const fullProps = {
  lang: "en-US" as const,
  tasks: [],
  raid: [
    { id: 1, category: "R", title: "A risk", status: "Open", linkedTaskIds: [], raisedDate: "2026-01-01", causedByRaidIds: [] },
  ] as RaidItem[],
  budgets: minimalBudget as never[],
  plan,
  roles: [],
  resources: [],
  absences: [],
  holidaySet: new Set<string>(),
  workdayHours: 8,
  today: "2026-06-02",
  milestones: [
    { id: 1, name: "Go-Live", date: "2026-06-01", linkedTaskIds: [] },
  ] as Milestone[],
  changes: [
    {
      id: 1, title: "Scope change", description: "", type: "Scope", status: "Proposed",
      impact: "High", raisedDate: "2026-05-01", linkedTaskIds: [], linkedRaidIds: [],
    },
  ] as ChangeItem[],
};

describe("DashboardPanel module visibility gates (Task 8)", () => {
  it("shows Budget burn section and RAID section when all flags are true (baseline)", () => {
    render(<DashboardPanel {...fullProps} />, { wrapper });
    expect(screen.getByText("Budget burn")).toBeInTheDocument();
    expect(screen.getByText("Top open RAID")).toBeInTheDocument();
    expect(screen.getByText("Milestones")).toBeInTheDocument();
    expect(screen.getByText("Changes")).toBeInTheDocument();
  });

  it("hides Budget burn section and EVM when showBudget is false", () => {
    render(<DashboardPanel {...fullProps} showBudget={false} />, { wrapper });
    expect(screen.queryByText("Budget burn")).toBeNull();
    expect(screen.queryByText("SPI")).toBeNull();
    expect(screen.queryByText("CPI")).toBeNull();
  });

  it("hides RAID section when showRaid is false", () => {
    render(<DashboardPanel {...fullProps} showRaid={false} />, { wrapper });
    expect(screen.queryByText("Top open RAID")).toBeNull();
    expect(screen.queryByText("A risk")).toBeNull();
  });

  it("hides Milestones section when showMilestones is false", () => {
    render(<DashboardPanel {...fullProps} showMilestones={false} />, { wrapper });
    expect(screen.queryByText("Milestones")).toBeNull();
  });

  it("hides Changes section when showChanges is false", () => {
    render(<DashboardPanel {...fullProps} showChanges={false} />, { wrapper });
    expect(screen.queryByText("Changes")).toBeNull();
  });

  it("still renders overall RAG and progress when all module flags are false", () => {
    render(
      <DashboardPanel {...fullProps} showBudget={false} showRaid={false} showMilestones={false} showChanges={false} />,
      { wrapper },
    );
    // Always-on sections must still render
    expect(screen.getByText("Overall")).toBeInTheDocument();
    expect(screen.getByText("Progress")).toBeInTheDocument();
  });
});

// ─── Top-band Budget/Scope pill gating (review fix) ──────────────────────────

// Tasks with originalEstimate ensure the budget model would compute a
// non-null budget health if not gated — making the gate the only reason
// the pill is absent.
const tasksWithEstimates = [
  {
    id: 1, title: "Task A", status: "Open", health: "G",
    originalEstimate: 40, remainingEstimate: 20,
    linkedRaidIds: [], subtaskIds: [], parentId: null, assigneeIds: [],
  },
] as never[];

const propsWithEstimates = {
  ...fullProps,
  tasks: tasksWithEstimates,
};

describe("DashboardPanel top-band Budget/Scope pill gating", () => {
  it("shows both Budget and Scope pills in the top band when all flags are true (baseline)", () => {
    render(<DashboardPanel {...propsWithEstimates} />, { wrapper });
    // Both pill labels must appear (at least one instance each)
    expect(screen.queryAllByText("Budget").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Scope").length).toBeGreaterThan(0);
  });

  it("hides the Budget top-band pill when showBudget is false", () => {
    render(<DashboardPanel {...propsWithEstimates} showBudget={false} />, { wrapper });
    // The entire showBudget-gated subtree (pill + burn section) is gone,
    // so "Budget" must not appear anywhere in the document.
    expect(screen.queryAllByText("Budget").length).toBe(0);
  });

  it("hides the Scope top-band pill when showChanges is false", () => {
    render(<DashboardPanel {...propsWithEstimates} showChanges={false} />, { wrapper });
    expect(screen.queryAllByText("Scope").length).toBe(0);
  });
});
