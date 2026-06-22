import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { DashboardPanel } from "./dashboard-panel";
import { RegistersBand } from "./dashboard-sections/registers-band";
import { healthText } from "./health";
import { t } from "./i18n";
import { loadActivityLog, type ActivityEntry } from "./activity-log";
import type { RaidItem, Milestone, ChangeItem } from "./types";

vi.mock("./activity-log", async (orig) => ({
  ...(await orig<typeof import("./activity-log")>()),
  loadActivityLog: vi.fn(() => []),
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
            impact: "High", raisedDate: "2026-05-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
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

describe("DashboardPanel top-actions card (Task 7)", () => {
  const baseProps = {
    lang: "en-US" as const,
    tasks: [],
    raid: [],
    budgets: [],
    plan,
    roles: [],
    resources: [],
    absences: [],
    holidaySet: new Set<string>(),
    workdayHours: 8,
    today: "2026-06-02",
  };

  const action1 = {
    id: "raid:1:severity",
    source: "raid" as const,
    moduleId: "raid" as const,
    title: { key: "actionRaidTitle" as const, params: [1, "X"] as (string | number)[] },
    why: { key: "actionRaidWhySeverity" as const, params: ["High"] as (string | number)[] },
    score: 60,
    tier: "now" as const,
    cta: { kind: "open" as const, view: "raid" as const, id: 1 },
  };

  const action2 = {
    id: "task-due:2:overdue",
    source: "task-due" as const,
    title: { key: "actionTaskTitle" as const, params: [2, "Y"] as (string | number)[] },
    why: { key: "actionTaskWhyOverdue" as const, params: [3] as (string | number)[] },
    score: 80,
    tier: "now" as const,
    cta: { kind: "open" as const, view: "open-points" as const, id: 2 },
  };

  it("renders the Top actions heading and rows when topActions has items", () => {
    const onOpenAction = vi.fn();
    render(
      <DashboardPanel
        {...baseProps}
        topActions={[action1, action2]}
        onOpenAction={onOpenAction}
      />,
      { wrapper },
    );
    expect(screen.getByText("Top actions")).toBeInTheDocument();
    // Two action rows rendered — each has an "Open" CTA button
    expect(screen.getAllByRole("button", { name: "Open" }).length).toBeGreaterThanOrEqual(2);
  });

  it("fires onOpenAction with the action when a row is clicked", async () => {
    const user = userEvent.setup();
    const onOpenAction = vi.fn();
    render(
      <DashboardPanel
        {...baseProps}
        topActions={[action1]}
        onOpenAction={onOpenAction}
      />,
      { wrapper },
    );
    // Click the "Open" button inside the ActionRow (exact text, not the print button)
    const rowButton = screen.getByRole("button", { name: "Open" });
    await user.click(rowButton);
    expect(onOpenAction).toHaveBeenCalledWith(action1);
  });

  it("does NOT render the Top actions heading when topActions is undefined", () => {
    render(<DashboardPanel {...baseProps} />, { wrapper });
    expect(screen.queryByText("Top actions")).toBeNull();
  });

  it("does NOT render the Top actions heading when topActions is empty", () => {
    render(<DashboardPanel {...baseProps} topActions={[]} />, { wrapper });
    expect(screen.queryByText("Top actions")).toBeNull();
  });
});

describe("DashboardPanel status narrative layout (Task 2)", () => {
  function renderNarrative() {
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

  it("places Save and Clear in a justify-end row BELOW the textarea", () => {
    renderNarrative();
    const textarea = screen.getByRole("textbox");
    const save = screen.getByRole("button", { name: /save/i });
    const clear = screen.getByRole("button", { name: /clear/i });

    // Save and Clear share one button row.
    const row = save.parentElement!;
    expect(row).toBe(clear.parentElement);
    expect(row.className).toContain("justify-end");
    expect(row.className).toContain("print:hidden");

    // The button row is a sibling that follows the textarea in DOM order.
    const container = textarea.parentElement!;
    expect(container).toBe(row.parentElement);
    const kids = Array.from(container.children);
    expect(kids.indexOf(textarea)).toBeLessThan(kids.indexOf(row));
  });

  it("grows the textarea height to scrollHeight on input (autogrow)", async () => {
    const user = userEvent.setup();
    renderNarrative();
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    // jsdom has no layout, so stub scrollHeight to a known value.
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 173 });
    await user.type(textarea, "line one\nline two\nline three");
    expect(textarea.style.height).toBe("173px");
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

  it("Clear resets the textarea back to its default (short) height", async () => {
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
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    // jsdom has no layout, so stub scrollHeight to simulate a grown box.
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 240 });
    await user.type(textarea, "line one\nline two\nline three\nline four");
    // The box grew to the tall scrollHeight on input.
    expect(textarea.style.height).toBe("240px");
    await user.click(screen.getByRole("button", { name: /save/i }));

    // Now simulate the empty/short box: scrollHeight clamps to the min-height.
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 96 });
    await user.click(screen.getByRole("button", { name: /clear/i }));
    // The resize path ran on Clear → inline height is back to the short value,
    // not stuck at the previously-grown 240px.
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).style.height).toBe("96px");
  });

  it("auto-shrinks the textarea height as content is removed", async () => {
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
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    // Grow.
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 200 });
    await user.type(textarea, "line one\nline two\nline three");
    expect(textarea.style.height).toBe("200px");
    // Remove content → scrollHeight shrinks; the onInput resize (height="auto" first)
    // lets the box shrink back down rather than staying tall.
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 96 });
    await user.clear(textarea);
    expect(textarea.style.height).toBe("96px");
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

describe("DashboardPanel budget-burn CPI stat", () => {
  // A task with an estimate + completion + time-spent yields a non-null EVM CPI:
  // EV = 57min, AC = 60min → cpi = 0.95.
  const taskWithCpi = [
    {
      id: 1, title: "Done task", status: "Done", health: "G",
      originalEstimateMinutes: 57, timeSpentMinutes: 60,
      dueDate: "2026-06-01", completedDate: "2026-06-01",
      linkedRaidIds: [], subtaskIds: [], parentId: null, assigneeIds: [],
    },
  ] as never[];

  // CPI is an EVM index → it lives ONLY in the EVM SPI/CPI row (the burn row now
  // holds just Sub-budget + "h"). The EVM row renders only when there's estimate
  // coverage; its CPI tile sits beside the SPI tile.
  function evmCpiTile(): HTMLElement {
    const spiTile = screen.getByText("SPI").closest("div.rounded-lg") as HTMLElement;
    const evmRow = spiTile.parentElement as HTMLElement;
    return within(evmRow).getByText("CPI").closest("div.rounded-lg") as HTMLElement;
  }

  it("shows the CPI value in the EVM row when model.evm.cpi is present", () => {
    render(
      <DashboardPanel
        lang="en-US"
        tasks={taskWithCpi}
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
    expect(within(evmCpiTile()).getByText("0.95")).toBeInTheDocument();
  });

  it("does not duplicate CPI in the budget-burn (Sub-budget + hours) row", () => {
    render(
      <DashboardPanel
        lang="en-US"
        tasks={taskWithCpi}
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
    // The burn row (the flex row containing the "h" tile) must NOT contain a CPI
    // tile — CPI now lives only in the EVM row, so CPI appears exactly once.
    const burnRow = (screen.getByText("h").closest("div.rounded-lg") as HTMLElement).parentElement as HTMLElement;
    expect(within(burnRow).queryByText("CPI")).toBeNull();
    expect(screen.getAllByText("CPI")).toHaveLength(1);
  });
});

describe("DashboardPanel landing cockpit", () => {
  const action1 = {
    id: "raid:1:severity",
    source: "raid" as const,
    moduleId: "raid" as const,
    title: { key: "actionRaidTitle" as const, params: [1, "X"] as (string | number)[] },
    why: { key: "actionRaidWhySeverity" as const, params: ["High"] as (string | number)[] },
    score: 60,
    tier: "now" as const,
    cta: { kind: "open" as const, view: "raid" as const, id: 1 },
  };

  it("renders the delta-strip welcome line on a first visit", () => {
    render(<DashboardPanel {...fullProps} projectId="p-landing-greet" />, { wrapper });
    expect(screen.getByText(/Welcome/i)).toBeInTheDocument();
  });

  it("folds the RAG override selects into an Adjust-health disclosure", () => {
    render(<DashboardPanel {...fullProps} projectId="p-landing-disc" />, { wrapper });
    const summary = screen.getByText("Adjust health ratings");
    expect(summary.closest("details")).not.toBeNull();
  });

  it("renders Top actions above the RAID registers band in DOM order", () => {
    render(
      <DashboardPanel {...fullProps} projectId="p-landing-order" topActions={[action1]} onOpenAction={vi.fn()} />,
      { wrapper },
    );
    const topActions = screen.getByText("Top actions");
    const registers = screen.getByText("Top open RAID");
    // Node.DOCUMENT_POSITION_FOLLOWING (4) ⇒ registers comes AFTER topActions.
    expect(topActions.compareDocumentPosition(registers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("DashboardPanel coaching card", () => {
  it("shows the Get started card on a blank project (no tasks)", () => {
    render(<DashboardPanel {...fullProps} aiConfigured={false} onNavigate={vi.fn()} />, { wrapper });
    expect(screen.getByText("Get started")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add your first task" })).toBeInTheDocument();
  });

  it("hides the coaching card once a task exists", () => {
    render(
      <DashboardPanel
        {...fullProps}
        tasks={[{ id: 1, title: "T", status: "Open", linkedRaidIds: [], subtaskIds: [], parentId: null, assigneeIds: [] } as never]}
        aiConfigured={false}
        onNavigate={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.queryByText("Get started")).toBeNull();
  });

  it("navigates when a coaching CTA is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<DashboardPanel {...fullProps} aiConfigured={false} onNavigate={onNavigate} />, { wrapper });
    await user.click(screen.getByRole("button", { name: "Configure AI assistant" }));
    expect(onNavigate).toHaveBeenCalledWith("settings", "ai");
  });
});

describe("DashboardPanel milestone horizon", () => {
  it("renders a horizon bucket header instead of the flat list", () => {
    render(<DashboardPanel {...fullProps} />, { wrapper });
    // Go-Live dated 2026-06-01 with today 2026-06-02 → Overdue bucket.
    expect(screen.getByText(/Overdue \(1\)/)).toBeInTheDocument();
  });

  it("still hides the whole milestones section when showMilestones is false", () => {
    render(<DashboardPanel {...fullProps} showMilestones={false} />, { wrapper });
    expect(screen.queryByText(/Overdue \(/)).toBeNull();
    expect(screen.queryByText("Milestones")).toBeNull();
  });
});

describe("RegistersBand link styling", () => {
  it("uses the directory hover affordance, not underline", () => {
    render(
      <RegistersBand
        lang="en-US"
        topRaid={[{ id: 1, category: "R", title: "risk", status: "Open", linkedTaskIds: [], raisedDate: "2026-01-01", causedByRaidIds: [] } as never]}
        overdue={[]} dueSoon={[]}
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
    { id: 1, category: "R", title: "A risk", status: "Open", linkedTaskIds: [], raisedDate: "2026-01-01", causedByRaidIds: [], stakeholderIds: [] },
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
      impact: "High", raisedDate: "2026-05-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
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

// ─── Trends widget visibility + toggle ───────────────────────────────────────

describe("DashboardPanel Trends widget (showTrends)", () => {
  const baseProps = {
    lang: "en-US" as const,
    tasks: [],
    raid: [],
    budgets: [],
    plan,
    roles: [],
    resources: [],
    absences: [],
    holidaySet: new Set<string>(),
    workdayHours: 8,
    today: "2026-06-02",
  };

  it("renders the Trends widget by default (showTrends undefined)", () => {
    render(<DashboardPanel {...baseProps} />, { wrapper });
    expect(screen.getByText("Trends")).toBeInTheDocument();
  });

  it("renders the Trends widget when showTrends is true", () => {
    render(<DashboardPanel {...baseProps} showTrends={true} />, { wrapper });
    expect(screen.getByText("Trends")).toBeInTheDocument();
  });

  it("hides the Trends widget when showTrends is false", () => {
    render(<DashboardPanel {...baseProps} showTrends={false} />, { wrapper });
    expect(screen.queryByText("Trends")).toBeNull();
  });

  it("calls onToggleTrends(false) when the remove button is clicked", async () => {
    const user = userEvent.setup();
    const onToggleTrends = vi.fn();
    render(<DashboardPanel {...baseProps} showTrends={true} onToggleTrends={onToggleTrends} />, { wrapper });
    const removeBtn = screen.getByRole("button", { name: /hide trends/i });
    await user.click(removeBtn);
    expect(onToggleTrends).toHaveBeenCalledWith(false);
  });

  it("calls onToggleTrends(true) when the add button is clicked", async () => {
    const user = userEvent.setup();
    const onToggleTrends = vi.fn();
    render(<DashboardPanel {...baseProps} showTrends={false} onToggleTrends={onToggleTrends} />, { wrapper });
    const addBtn = screen.getByRole("button", { name: /show trends/i });
    await user.click(addBtn);
    expect(onToggleTrends).toHaveBeenCalledWith(true);
  });

  it("renders the Trends toggle in the ReportCard header toolbar (beside Print), not in the Overall band or trends widget", async () => {
    const user = userEvent.setup();
    const onToggleTrends = vi.fn();
    render(<DashboardPanel {...baseProps} showTrends={true} onToggleTrends={onToggleTrends} />, { wrapper });

    // Toggle reflects the current (shown) state.
    const toggle = screen.getByRole("button", { name: /hide trends/i });

    // It must NOT live in the Overall band (the rounded-lg div containing the
    // "Overall" status word) — it was relocated to the card header toolbar.
    const overallWord = screen.getByText("Overall");
    const topBand = overallWord.closest("div.rounded-lg");
    expect(topBand).not.toBeNull();
    expect(topBand!.contains(toggle)).toBe(false);

    // It shares the header toolbar with the Print button.
    const printBtn = screen.getByRole("button", { name: t("en-US", "printHint") });
    const toolbar = printBtn.parentElement;
    expect(toolbar).not.toBeNull();
    expect(toolbar!.contains(toggle)).toBe(true);

    // The Trends widget heading must not be an ancestor of the toggle.
    const trendsHeading = screen.getByText("Trends");
    const trendsWidget = trendsHeading.closest("div.rounded-lg");
    expect(trendsWidget!.contains(toggle)).toBe(false);

    // Toggling still calls the handler with the negated state.
    await user.click(toggle);
    expect(onToggleTrends).toHaveBeenCalledWith(false);
  });

  it("renders the density toggle in the ReportCard header toolbar beside Print", () => {
    const onToggleDensity = vi.fn();
    render(<DashboardPanel {...fullProps} density="comfortable" onToggleDensity={onToggleDensity} />, { wrapper });

    const densityToggle = screen.getByRole("button", { name: "Compact view" });
    const printBtn = screen.getByRole("button", { name: t("en-US", "printHint") });
    const toolbar = printBtn.parentElement;
    expect(toolbar).not.toBeNull();
    expect(toolbar!.contains(densityToggle)).toBe(true);

    // And NOT inside the Overall band.
    const topBand = screen.getByText("Overall").closest("div.rounded-lg");
    expect(topBand!.contains(densityToggle)).toBe(false);
  });

  it("places the report-date text on the same row as the Overall label", () => {
    render(<DashboardPanel {...baseProps} today="2026-06-21" />, { wrapper });
    const dateText = screen.getByText(t("en-US", "dashboardReportDate", "2026-06-21"));
    // The report-date span sits in the Overall band (rounded-lg).
    const band = dateText.closest("div.rounded-lg");
    expect(band).not.toBeNull();
    // The element immediately BEFORE the date is the bold "Overall: <color>"
    // div (text-2xl font-bold). The date carries ml-auto so it floats right on
    // the same flex row; the <details> after it is basis-full and wraps below.
    const before = dateText.previousElementSibling;
    expect(before).not.toBeNull();
    expect(before!.className).toContain("font-bold");
    expect(before!.textContent).toContain("Overall");
  });
});

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

describe("DashboardPanel completion-trend card", () => {
  function snapRec(capturedAt: string, pct: number) {
    return {
      id: capturedAt, capturedAt, bucket: capturedAt.slice(0, 10), cadence: "daily" as const,
      trigger: "manual" as const, isBaseline: false, remainingHours: null, remainingCost: null,
      pctComplete: pct, forecastEndDate: "2026-12-31", planEndDate: "2026-12-31",
      spi: null, cpi: null, overallRag: "" as const, scheduleRag: "" as const,
      budgetRag: "" as const, scopeRag: "" as const, currency: "EUR", milestones: [], series: [],
    };
  }

  const baseProps = {
    lang: "en-US" as const,
    tasks: [], raid: [], budgets: [], plan, roles: [], resources: [], absences: [],
    holidaySet: new Set<string>(), workdayHours: 8, today: "2026-06-21",
  };

  it("shows the trend card when snapshots yield >= 2 points", () => {
    const { container } = render(
      <DashboardPanel
        {...baseProps}
        snapshots={[snapRec("2026-06-10T00:00:00.000Z", 20), snapRec("2026-06-14T00:00:00.000Z", 55)]}
      />,
      { wrapper },
    );
    expect(screen.getByText("Completion trend")).toBeInTheDocument();
    expect(container.querySelector("polyline")).not.toBeNull();
    // The graphic carries an announced accessible name (role=img), not a dead
    // aria-label on a bare wrapper div.
    expect(screen.getByRole("img", { name: /Completion trend: \d+% now/ })).toBeInTheDocument();
  });

  it("hides the trend card when there is no series", () => {
    render(<DashboardPanel {...baseProps} snapshots={[]} />, { wrapper });
    expect(screen.queryByText("Completion trend")).toBeNull();
  });
});

describe("DashboardPanel density (slice #8)", () => {
  it("applies the comfortable spacing class by default", () => {
    const { container } = render(<DashboardPanel {...fullProps} />, { wrapper });
    expect(container.querySelector(".space-y-4")).not.toBeNull();
    expect(container.querySelector(".space-y-2")).toBeNull();
  });

  it("applies the compact spacing class when density is compact", () => {
    // The comfortable test confirms `.space-y-2` is the container-only class, so
    // its presence here is decisive proof the container flipped to compact.
    const { container } = render(<DashboardPanel {...fullProps} density="compact" />, { wrapper });
    expect(container.querySelector(".space-y-2")).not.toBeNull();
  });

  it("renders no density toggle when onToggleDensity is omitted", () => {
    render(<DashboardPanel {...fullProps} />, { wrapper });
    expect(screen.queryByRole("button", { name: "Compact view" })).toBeNull();
  });

  it("toggles comfortable -> compact via the on-panel button (aria-pressed reflects compact)", () => {
    const onToggleDensity = vi.fn();
    render(<DashboardPanel {...fullProps} density="comfortable" onToggleDensity={onToggleDensity} />, { wrapper });
    // Stable label names the toggle target; aria-pressed=false ⇒ compact is off.
    const btn = screen.getByRole("button", { name: "Compact view" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(onToggleDensity).toHaveBeenCalledWith("compact");
  });

  it("toggles compact -> comfortable; aria-pressed is true while compact is active", () => {
    const onToggleDensity = vi.fn();
    render(<DashboardPanel {...fullProps} density="compact" onToggleDensity={onToggleDensity} />, { wrapper });
    const btn = screen.getByRole("button", { name: "Compact view" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btn);
    expect(onToggleDensity).toHaveBeenCalledWith("comfortable");
  });
});

describe("DashboardPanel click-through parity (slice #9)", () => {
  afterEach(() => {
    vi.mocked(loadActivityLog).mockReturnValue([]);
    localStorage.clear();
  });

  it("navigates to raid when the Open RAID KPI tile is clicked", () => {
    const onNavigate = vi.fn();
    render(<DashboardPanel {...fullProps} onNavigate={onNavigate} />, { wrapper });
    // Tile names are now metric-qualified for uniqueness: "Open RAID – Open the RAID register".
    fireEvent.click(screen.getByRole("button", { name: /Open RAID –/ }));
    expect(onNavigate).toHaveBeenCalledWith("raid");
  });

  it("navigates to open-points when the Complete KPI tile is clicked", () => {
    const onNavigate = vi.fn();
    render(<DashboardPanel {...fullProps} onNavigate={onNavigate} />, { wrapper });
    // Qualified name is now unique (e.g. "Complete – Open the tasks list") → getByRole works.
    fireEvent.click(screen.getByRole("button", { name: /Complete – Open the tasks list/ }));
    expect(onNavigate).toHaveBeenCalledWith("open-points");
  });

  it("opens a specific change by id when a Top Changes row is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <DashboardPanel
        {...fullProps}
        showChanges
        changes={[
          {
            id: 7, title: "Scope cut", description: "", type: "Scope", status: "Proposed",
            impact: "High", raisedDate: "2026-05-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
          },
        ] as ChangeItem[]}
        onOpenChange={onOpenChange}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Open change Scope cut" }));
    expect(onOpenChange).toHaveBeenCalledWith(7);
  });

  it("navigates by activity kind: a task.created row links to open-points", () => {
    vi.mocked(loadActivityLog).mockReturnValue([
      { id: 1, timestamp: "2026-06-20T10:00:00.000Z", kind: "task.created", args: [] },
    ] as ActivityEntry[]);
    const onNavigate = vi.fn();
    render(<DashboardPanel {...fullProps} onNavigate={onNavigate} />, { wrapper });
    // Accessible name PREFIXES the visible "date · kind" with the open-view
    // hint → "2026-06-20 · task.created – Open Open Points" (unique + informative).
    const row = screen.getByRole("button", { name: /task\.created.*Open Points/ });
    fireEvent.click(row);
    expect(onNavigate).toHaveBeenCalledWith("open-points");
  });

  it("renders a static (non-button) row for a non-deep-linkable activity kind", () => {
    vi.mocked(loadActivityLog).mockReturnValue([
      { id: 2, timestamp: "2026-06-20T11:00:00.000Z", kind: "settings.updated", args: [] },
    ] as ActivityEntry[]);
    const onNavigate = vi.fn();
    render(<DashboardPanel {...fullProps} onNavigate={onNavigate} />, { wrapper });
    // settings.updated has no deep-link destination → its row stays a span.
    expect(screen.getByText(/2026-06-20 · settings\.updated/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /settings\.updated/ })).toBeNull();
  });
});
