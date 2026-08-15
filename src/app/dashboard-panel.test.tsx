import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { DashboardPanel } from "./dashboard-panel";
import { RaidRegisterCard } from "./dashboard-sections/registers-band";
import { t } from "./i18n";
import { loadActivityLog } from "./activity-log";
import type { BudgetBucket, RaidItem, Milestone, ChangeItem } from "./types";

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

  // Assert the KEY renders, not a hardcoded fragment of its English wording.
  // The old form matched /Tasks completed vs total/ — a sentence that had been
  // FALSE since the completion denominator became `inScope` (the tile beneath
  // it reads "{completed} of {inScope}"), and the test kept passing precisely
  // because it pinned the stale words. A fragment assertion cannot tell a
  // correct caption from an incorrect one; it only makes copy edits fail. It
  // never was, and still is not, coverage for whether the sentence is TRUE —
  // nothing automated is. It just no longer pretends to be.
  it("renders the progress and burn captions", () => {
    renderDashboard();
    expect(screen.getByText(t("en-US", "dashboardProgressCaption"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "dashboardBurnCaption"))).toBeInTheDocument();
  });

  it("applies the RAG role-token colour class to the overall status word", () => {
    renderDashboard();
    const overallSpans = screen.getAllByText(/^(Green|Amber|Red)$/).filter((el) =>
      /text-\[var\(--rag-(green|amber|red)-text\)\]/.test(el.className),
    );
    expect(overallSpans.length).toBeGreaterThan(0);
    expect(overallSpans[0].className).toMatch(/text-\[var\(--rag-green-text\)\]/);
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
    // Scope to the subsection heading: the dashboard tip-of-the-day card can
    // also contain the word "Changes", so a loose getByText(/changes/i) is
    // ambiguous (date-dependent).
    expect(screen.getByRole("heading", { name: "Changes" })).toBeTruthy();
    expect(screen.getByText(/1 pending/i)).toBeTruthy();
  });
});

describe("DashboardPanel RAG polish (Task 3)", () => {
  it("marks the R / A / G counts with RAG dots (colour rides the dot, not small text)", () => {
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
    // Counts now carry a RagDot (colour rides the dot, AA-exempt) instead of
    // small rag-*-text, which fails AA on dark + mockup schemes.
    expect(document.querySelector("span.bg-\\[var\\(--rag-red\\)\\]")).not.toBeNull();
    expect(document.querySelector("span.bg-\\[var\\(--rag-amber\\)\\]")).not.toBeNull();
    expect(document.querySelector("span.bg-\\[var\\(--rag-green\\)\\]")).not.toBeNull();
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
    // The boxed card is now the arrangeable TILE CHROME (a <section>), not a
    // <div> the body drew itself — the body no longer boxes or titles itself at
    // all, or the tile would stack two identical "Progress" headings inside two
    // nested borders.
    const heading = screen.getByText("Progress");
    const tile = heading.closest("section.rounded-lg");
    expect(tile).not.toBeNull();
    expect(tile!.getAttribute("data-testid")).toBe("tile-progress");
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
    // Each hinted tile is wrapped in a `div.relative` (tooltip sibling), so the
    // shared EVM row is the wrapper's parent, not the tile's direct parent.
    const evmRow = spiTile.parentElement?.parentElement as HTMLElement;
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

describe("RaidRegisterCard link styling", () => {
  it("uses the directory hover affordance, not underline", () => {
    render(
      <RaidRegisterCard
        lang="en-US"
        topRaid={[{ id: 1, category: "R", title: "risk", status: "Open", linkedTaskIds: [], raisedDate: "2026-01-01", causedByRaidIds: [] } as never]}
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

describe("DashboardPanel Trends widget (Turso-gated)", () => {
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

  it("hides the Trends widget when Turso is inactive", () => {
    render(<DashboardPanel {...baseProps} />, { wrapper });
    expect(screen.queryByText("Trends")).toBeNull();
  });

  it("renders the Trends widget when tursoActive is true", () => {
    render(<DashboardPanel {...baseProps} tursoActive />, { wrapper });
    expect(screen.getByText("Trends")).toBeInTheDocument();
  });

  it("renders no Trends or density toggle button in the header toolbar", () => {
    render(<DashboardPanel {...baseProps} tursoActive />, { wrapper });
    // Trends is Turso-gated with no on-panel toggle; density is set via Settings.
    expect(screen.queryByRole("button", { name: "Trends" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compact view" })).toBeNull();
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

  // The card renders directly beneath the completion tile, so on an
  // all-cancelled project it would draw a trajectory under a tile reading
  // "No active scope". The fixture is IDENTICAL to the control test above
  // except for the tasks, and the snapshot path does not consult `inScope`
  // (`fromSnapshots` reads each record's stored `pctComplete`) — so the series
  // genuinely still has two points here and the absence is a suppression, not
  // a series that collapsed on its own.
  it("hides the trend card when every task is cancelled, even with a real series", () => {
    const cancelled = [1, 2].map((id) => ({
      id, taskName: `Cancelled ${id}`, assignee: "A", assigneeEmail: "a@x.io",
      dueDate: "2026-05-01", lastUpdateDate: "2026-05-01", status: "Cancelled" as const,
      priority: "Medium" as const, blockers: "", description: "",
    }));
    const snapshots = [snapRec("2026-06-10T00:00:00.000Z", 20), snapRec("2026-06-14T00:00:00.000Z", 55)];
    render(<DashboardPanel {...baseProps} tasks={cancelled} snapshots={snapshots} />, { wrapper });
    // Two, for the same reason as the paired assertion further down this file:
    // the Progress tile and the at-a-glance KPI card both carry the state.
    expect(screen.getAllByText(t("en-US", "dashboardNoActiveScope"))).toHaveLength(2);
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

  it("renders no on-panel density toggle button (density is set via Settings → Appearance)", () => {
    render(<DashboardPanel {...fullProps} density="comfortable" />, { wrapper });
    expect(screen.queryByRole("button", { name: "Compact view" })).toBeNull();
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

});

// ★★ EVERY TEST HERE NEEDS ITS OWN `projectId`. `useDashboardLayout` keys its
// stored arrangement on it, so a shared id would let one test's hide leak into
// the next. (The 400ms debounce means nothing is actually written inside a
// synchronous test — the effect's cleanup clears the timer on unmount — but the
// isolation must not rest on that timing.)
const EN = "en-US" as const;
const grip = (title: string) => `${t(EN, "reorderHandle")} – ${title}`;
const kebab = (title: string) => `${t(EN, "actionMoreActions")} – ${title}`;

describe("DashboardPanel arrangeable tile grid", () => {
  it("renders the cards as tiles inside one dense grid", () => {
    const { container } = render(<DashboardPanel {...fullProps} projectId="p-grid-flow" />, { wrapper });
    const grid = container.querySelector('[data-testid="dashboard-grid"]');
    expect(grid).not.toBeNull();
    // Order is the whole placement model — `grid-auto-flow: row dense` resolves
    // the ordered list into cells, which is why nothing stores coordinates.
    expect(grid!.className).toContain("grid-flow-row-dense");
    expect(grid!.querySelectorAll('[data-testid^="tile-"]').length).toBeGreaterThan(0);
    // Progress, Milestones + Changes all live in the SAME grid.
    expect(grid!.textContent).toContain("Milestones");
    expect(grid!.textContent).toContain("Changes");
  });

  it("gives each tile the span classes its catalogue entry declares", () => {
    render(<DashboardPanel {...fullProps} projectId="p-grid-span" />, { wrapper });
    // `progress` is w:2 h:2 in DASHBOARD_TILES, and the classes must be WHOLE
    // literals — an interpolated `col-span-${w}` emits no CSS at all, and jsdom
    // has no layout to notice.
    const tile = screen.getByTestId("tile-progress");
    expect(tile.className).toContain("lg:col-span-2");
    expect(tile.className).toContain("row-span-2");
  });

  it("qualifies every per-tile control with that tile's title", () => {
    // WCAG 2.4.6, and the axe gate cannot see a duplicate accessible name in any
    // view at any seed size — a multi-tile render is the only possible detector.
    render(<DashboardPanel {...fullProps} projectId="p-grid-names" />, { wrapper });
    expect(screen.getByRole("button", { name: grip("Progress") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: grip("Milestones") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: kebab("Progress") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: kebab("Milestones") })).toBeInTheDocument();
  });

  it("renders no grip, menu, shelf or reset in a popout (read-only)", () => {
    render(<DashboardPanel {...fullProps} projectId="p-grid-popout" isPopout />, { wrapper });
    expect(screen.getByTestId("tile-progress")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: grip("Progress") })).toBeNull();
    expect(screen.queryByRole("button", { name: kebab("Progress") })).toBeNull();
    expect(screen.queryByText(t(EN, "dashboardResetLayout"))).toBeNull();
    expect(screen.queryByRole("button", { name: t(EN, "dashboardShelfCount", 0) })).toBeNull();
  });

  it("hides a tile from the ⋮ menu onto the shelf, announces it, and restores it", async () => {
    const user = userEvent.setup();
    render(<DashboardPanel {...fullProps} projectId="p-grid-hide" />, { wrapper });
    await user.click(screen.getByRole("button", { name: kebab("Progress") }));
    // PopoverPanel owns the dismissal protocol and portals the panel to <body>.
    const menu = screen.getByRole("dialog", { name: kebab("Progress") });
    await user.click(within(menu).getByRole("button", { name: t(EN, "dashboardTileHide") }));

    expect(screen.queryByTestId("tile-progress")).toBeNull();
    const announced = screen.getAllByRole("status").map((el) => el.textContent);
    expect(announced).toContain(t(EN, "dashboardTileHidden", "Progress"));

    await user.click(screen.getByRole("button", { name: t(EN, "dashboardShelfCount", 1) }));
    await user.click(screen.getByRole("button", { name: `${t(EN, "dashboardTileRestore")} – Progress` }));
    expect(screen.getByTestId("tile-progress")).toBeInTheDocument();
  });

  it("lands focus on the shelf disclosure after hiding, instead of dropping it on <body>", async () => {
    // ★★★ HIDING DESTROYS THE CONTROL THAT WAS PRESSED. Hide lives inside the ⋮
    // popover, which is anchored to the tile's own ⋮ trigger — hiding unmounts
    // BOTH, and `PopoverPanel` restores focus to nothing on close (it focuses
    // the first control on OPEN only). Focus therefore fell to `<body>` and a
    // keyboard user who had just navigated the menu was stranded at the top of
    // the document, with no route back to the tile they had put on the shelf.
    const user = userEvent.setup();
    render(<DashboardPanel {...fullProps} projectId="p-grid-hide-focus" />, { wrapper });
    await user.click(screen.getByRole("button", { name: kebab("Progress") }));
    const menu = screen.getByRole("dialog", { name: kebab("Progress") });
    await user.click(within(menu).getByRole("button", { name: t(EN, "dashboardTileHide") }));

    expect(screen.queryByTestId("tile-progress")).toBeNull();      // the trigger really did unmount
    const shelf = screen.getByRole("button", { name: t(EN, "dashboardShelfCount", 1) });
    expect(document.activeElement).toBe(shelf);
  });

  it("lands focus back on the shelf disclosure after restoring a tile", async () => {
    // ★★ THE MIRROR CASE, and the chip is the wrong destination for it: the
    // Restore button the user pressed is removed by that very click, and the
    // remaining chips shift underneath them. The disclosure is the one node in
    // the shelf that survives both directions.
    const user = userEvent.setup();
    render(<DashboardPanel {...fullProps} projectId="p-grid-restore-focus" />, { wrapper });
    await user.click(screen.getByRole("button", { name: kebab("Progress") }));
    const menu = screen.getByRole("dialog", { name: kebab("Progress") });
    await user.click(within(menu).getByRole("button", { name: t(EN, "dashboardTileHide") }));

    await user.click(screen.getByRole("button", { name: t(EN, "dashboardShelfCount", 1) }));
    await user.click(screen.getByRole("button", { name: `${t(EN, "dashboardTileRestore")} – Progress` }));
    expect(screen.getByTestId("tile-progress")).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: t(EN, "dashboardShelfCount", 0) }),
    );
  });

  it("moves a tile earlier from the ⋮ menu and announces its new position", async () => {
    const user = userEvent.setup();
    render(<DashboardPanel {...fullProps} projectId="p-grid-move" />, { wrapper });
    const before = Array.from(document.querySelectorAll('[data-testid^="tile-"]'))
      .map((el) => el.getAttribute("data-testid"));
    const target = before[2]!;                       // never index 0 — Move earlier is disabled there
    const title = screen.getByTestId(target).getAttribute("aria-label")!;

    await user.click(screen.getByRole("button", { name: kebab(title) }));
    const menu = screen.getByRole("dialog", { name: kebab(title) });
    await user.click(within(menu).getByRole("button", { name: t(EN, "dashboardTileMoveEarlier") }));

    const after = Array.from(document.querySelectorAll('[data-testid^="tile-"]'))
      .map((el) => el.getAttribute("data-testid"));
    expect(after.indexOf(target)).toBe(1);
    expect(after).toHaveLength(before.length);
    const announced = screen.getAllByRole("status").map((el) => el.textContent);
    expect(announced).toContain(t(EN, "dashboardTileMoved", title, "2", String(before.length)));
  });

  it("ends the drag when a tile is dropped onto the shelf", () => {
    // ★★★ Hiding UNMOUNTS the tile whose grip owns `onDragEnd`, and a detached
    // node's events never reach React's root container — so nothing would reset
    // the hook's `dragId`. The observable is the shelf's own `isDragging` guard:
    // with the drag stuck true, a stray `dragEnter` pops the tray open, which is
    // exactly what `dashboard-grid.test.tsx`'s "leaves the tray shut when a
    // pointer wanders in with nothing being dragged" test pins at the component.
    render(<DashboardPanel {...fullProps} projectId="p-grid-shelfdrop" />, { wrapper });
    fireEvent.dragStart(screen.getByRole("button", { name: grip("Progress") }));
    fireEvent.drop(screen.getByRole("button", { name: t(EN, "dashboardShelfCount", 0) }));
    expect(screen.queryByTestId("tile-progress")).toBeNull();     // the grip really did unmount

    const shelf = screen.getByRole("button", { name: t(EN, "dashboardShelfCount", 1) });
    expect(shelf).toHaveAttribute("aria-expanded", "false");
    fireEvent.dragEnter(shelf);
    expect(shelf).toHaveAttribute("aria-expanded", "false");
  });

  it("leaves the tray open to a REAL drag, so the test above is not vacuous", () => {
    // ★ The positive observable: the same dragEnter DOES open the tray while a
    // drag is genuinely in flight. Without this, the assertion above would pass
    // against a shelf whose guard was broken shut.
    render(<DashboardPanel {...fullProps} projectId="p-grid-shelfopen" />, { wrapper });
    fireEvent.dragStart(screen.getByRole("button", { name: grip("Progress") }));
    const shelf = screen.getByRole("button", { name: t(EN, "dashboardShelfCount", 0) });
    fireEvent.dragEnter(shelf);
    expect(shelf).toHaveAttribute("aria-expanded", "true");
  });

  it("drops a hidden tile from the shelf once its module gate goes off", async () => {
    // ★★ The shelf offered tiles that could not be restored: it tested only that
    // the id was a known tile, so hiding Budget burn and then switching Budget
    // off left a chip whose Restore made the chip vanish with nothing appearing
    // (the board's own gate filter dropped it again), and the "N hidden" count
    // included it. Storage stays gate-free — the chip must come BACK when the
    // module is switched on again, which the last two assertions pin.
    const user = userEvent.setup();
    const { rerender } = render(
      <DashboardPanel {...fullProps} projectId="p-grid-gate" />, { wrapper });
    await user.click(screen.getByRole("button", { name: kebab("Budget burn") }));
    const menu = screen.getByRole("dialog", { name: kebab("Budget burn") });
    await user.click(within(menu).getByRole("button", { name: t(EN, "dashboardTileHide") }));
    await user.click(screen.getByRole("button", { name: t(EN, "dashboardShelfCount", 1) }));
    const chip = `${t(EN, "dashboardTileRestore")} – Budget burn`;
    expect(screen.getByRole("button", { name: chip })).toBeInTheDocument();

    rerender(<DashboardPanel {...fullProps} projectId="p-grid-gate" showBudget={false} />);
    expect(screen.queryByRole("button", { name: chip })).toBeNull();
    expect(screen.getByRole("button", { name: t(EN, "dashboardShelfCount", 0) })).toBeInTheDocument();

    rerender(<DashboardPanel {...fullProps} projectId="p-grid-gate" />);
    expect(screen.getByRole("button", { name: chip })).toBeInTheDocument();
  });

  it("renders the RAID register (Top open RAID) BEFORE the Progress card in DOM order", () => {
    render(<DashboardPanel {...fullProps} projectId="p-grid-order" />, { wrapper });
    const registers = screen.getByText("Top open RAID");
    const progress = screen.getByText("Progress");
    expect(registers.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("DashboardPanel Tier-3 folds", () => {
  it("renders the narrative editor (Status summary) AFTER the bento Progress card", () => {
    render(<DashboardPanel {...fullProps} />, { wrapper });
    const progress = screen.getByText("Progress");
    const editor = screen.getByText("Status summary");
    expect(progress.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("DashboardPanel burn-down chain warning", () => {
  const chainProps = {
    lang: "en-US" as const,
    tasks: [], raid: [], plan, roles: [], resources: [], absences: [],
    holidaySet: new Set<string>(), workdayHours: 8, today: "2026-06-02",
  };
  const bucketA = {
    id: 1, name: "Phase 1", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: {} }],
  } as unknown as BudgetBucket;
  const bucketB = { ...bucketA, id: 2, name: "Phase 2" };
  const bucketC = { ...bucketA, id: 3, name: "Phase 3" };

  it("stays silent when no bucket was ever chained", () => {
    // Parallel buckets are the normal budget model — warning here fired on every
    // project, including the shipped demo.
    render(<DashboardPanel {...chainProps} budgets={[bucketA, bucketB]} />, { wrapper });
    expect(screen.queryByText(/Burn-down covers the whole plan period/)).toBeNull();
  });

  it("warns when a half-built chain leaves a bucket outside it", () => {
    render(<DashboardPanel {...chainProps} budgets={[{ ...bucketA, successorId: 2 }, bucketB, bucketC]} />, { wrapper });
    expect(screen.getByText(/not linked into one chain/)).toBeInTheDocument();
  });

  it("does not warn when the buckets form one chain", () => {
    render(<DashboardPanel {...chainProps} budgets={[{ ...bucketA, successorId: 2 }, bucketB]} />, { wrapper });
    expect(screen.queryByText(/not linked into one chain/)).toBeNull();
  });
});

describe("DashboardPanel completion tile self-consistency", () => {
  // 5 Done + 5 Cancelled: the percentage divides by the in-scope count (5), so
  // the pair rendered beside it must read "5 of 5", not "5 of 10".
  const mixed = [
    ...[1, 2, 3, 4, 5].map((id) => ({
      id, taskName: `Done ${id}`, assignee: "A", assigneeEmail: "a@x.io",
      dueDate: "2026-05-01", lastUpdateDate: "2026-05-01", status: "Done",
      completedDate: "2026-05-02", priority: "Medium", blockers: "", description: "",
    })),
    ...[6, 7, 8, 9, 10].map((id) => ({
      id, taskName: `Cancelled ${id}`, assignee: "A", assigneeEmail: "a@x.io",
      dueDate: "2026-05-01", lastUpdateDate: "2026-05-01", status: "Cancelled",
      priority: "Medium", blockers: "", description: "",
    })),
  ] as never;

  it("renders '5 of 5 complete' beside '100% complete'", () => {
    render(
      <DashboardPanel
        lang="en-US"
        tasks={mixed}
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
    expect(screen.getByText(t("en-US", "dashboardPercentComplete", "100"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "dashboardCompletedOf", "5", "5"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "dashboardCompletedOf", "5", "10"))).toBeNull();
  });
});

describe("DashboardPanel completion tile", () => {
  // Mirrors renderDashboard() above verbatim, except tasks is a parameter —
  // renderDashboard() itself hardcodes a single task and can't express these fixtures.
  function renderDashboardWithTasks(tasks: unknown) {
    render(
      <DashboardPanel
        lang="en-US"
        tasks={tasks as never}
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

  it("reads as no-active-scope when every task is cancelled", () => {
    renderDashboardWithTasks([
      {
        id: 1, taskName: "Cancelled 1", assignee: "A", assigneeEmail: "a@x.io",
        dueDate: "2026-05-01", lastUpdateDate: "2026-05-01", status: "Cancelled",
        priority: "Medium", blockers: "", description: "",
      },
      {
        id: 2, taskName: "Cancelled 2", assignee: "A", assigneeEmail: "a@x.io",
        dueDate: "2026-05-01", lastUpdateDate: "2026-05-01", status: "Cancelled",
        priority: "Medium", blockers: "", description: "",
      },
    ]);
    // TWO, not one, and the count is the point: the Progress tile and the
    // at-a-glance KPI card both render this state, and a dashboard showing
    // "No active scope" on one card while the other still reads "0% complete"
    // is the defect this pair exists to prevent. `getByText` would throw on
    // the second match, and `getAllByText(...)[0]` would pass with the KPI
    // card left unfixed — so assert the length.
    expect(screen.getAllByText(t("en-US", "dashboardNoActiveScope"))).toHaveLength(2);
    expect(screen.getAllByText(t("en-US", "dashboardAllCancelled", "2"))).toHaveLength(2);
    expect(screen.queryByText(t("en-US", "dashboardPercentComplete", "0"))).toBeNull();
    // The KPI card's own percentage must be gone too — a 0% gradient bar reads
    // as "nothing done yet", which is exactly the misreading being fixed.
    expect(screen.queryByText("0%")).toBeNull();
  });

  // open-followups §66: the R/A/G tile counted a cancelled task GREEN, so this
  // very fixture rendered "All cancelled (2)" beside "R 0 · A 0 · G 2" inside
  // ONE card. Asserting the WHOLE value string pins both halves at once — that
  // G is now 0, and that the cancelled count is disclosed rather than dropped.
  // A `toContain("2")` would pass on the unfixed code, where G was 2.
  it("shows cancelled work as its own count, not as Green", () => {
    renderDashboardWithTasks([
      {
        id: 1, taskName: "Cancelled 1", assignee: "A", assigneeEmail: "a@x.io",
        dueDate: "2026-05-01", lastUpdateDate: "2026-05-01", status: "Cancelled",
        priority: "Medium", blockers: "", description: "",
      },
      {
        id: 2, taskName: "Cancelled 2", assignee: "A", assigneeEmail: "a@x.io",
        dueDate: "2026-05-01", lastUpdateDate: "2026-05-01", status: "Cancelled",
        priority: "Medium", blockers: "", description: "",
      },
    ]);
    const label = t("en-US", "dashboardOutOfScopeCount");
    const marker = screen.getByText(label);
    // sr-only span → its ✕ group → the tile's value span holding all four counts.
    const value = marker.parentElement?.parentElement;
    expect(value?.textContent).toBe(`000✕${label}2`);
  });

  it("renders no cancelled count when there is none", () => {
    renderDashboardWithTasks([
      {
        id: 1, taskName: "Open", assignee: "A", assigneeEmail: "a@x.io",
        dueDate: "2026-12-01", lastUpdateDate: "2026-05-01", status: "In Progress",
        priority: "Medium", blockers: "", description: "",
      },
    ]);
    expect(screen.queryByText(t("en-US", "dashboardOutOfScopeCount"))).toBeNull();
  });

  it("leaves an empty project on 0% complete", () => {
    renderDashboardWithTasks([]);
    expect(screen.getByText(t("en-US", "dashboardPercentComplete", "0"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "dashboardNoActiveScope"))).toBeNull();
  });
});
