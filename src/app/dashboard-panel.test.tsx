import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { DashboardPanel } from "./dashboard-panel";
import { RaidRegisterCard } from "./dashboard-sections/registers-band";
import { t } from "./i18n";
import * as dashboardModule from "./dashboard";
import type { ActivityEntry } from "./activity-log";
import type { SnapshotRecord } from "./snapshot";
import type { BudgetHistoryEntry } from "./budget-history";
import type { BudgetBucket, RaidItem, Milestone, ChangeItem } from "./types";
import { expectButtonOrder } from "../test/toolbar-order";
import { rateMixTileChipText, rateMixWhyName } from "./budget-rate-mix-text";
import { BUNDLE_HOURS_WORSE, HOURS_FORECAST_HOURS_WORSE, MIX_HOURS_WORSE } from "../test/forecast-fixtures";

/**
 * The `scrollRef` every render hands `useListReorderDnd`, captured through a
 * PASS-THROUGH spy so the real hook still runs and every other test in this
 * file is unaffected. There is no other seam: the ref is created and consumed
 * entirely inside `DashboardPanel`, and jsdom has no layout, so nothing can
 * observe the resulting scroll.
 */
const reorderScrollRefs: (React.RefObject<HTMLElement | null> | undefined)[] = [];
vi.mock("./use-list-reorder-dnd", async (orig) => {
  const actual = await orig<typeof import("./use-list-reorder-dnd")>();
  return {
    ...actual,
    useListReorderDnd: (opts: Parameters<typeof actual.useListReorderDnd>[0]) => {
      reorderScrollRefs.push(opts.scrollRef);
      return actual.useListReorderDnd(opts);
    },
  };
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

const plan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "EUR" as const };

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

  it("autoscrolls the CARD's scroller during a drag, with no nested scroller under it", () => {
    // ★★★ THE REF MUST REACH THE ONE ELEMENT THAT CAN ACTUALLY SCROLL.
    // `ReportCard` is `flex h-full min-h-0 flex-col overflow-hidden`, so its
    // `contentRef` child (`min-h-0 flex-1 overflow-y-auto`) has a BOUNDED height
    // and a real `scrollTop`. `DashboardGrid` used to wrap itself in its own
    // `overflow-y-auto` div and hand THAT to the hook — a block-level child of a
    // plain block, which sizes to its content, so `scrollHeight === clientHeight`
    // and `useDragAutoscroll`'s `scrollTop +=` could never move it. Dragging a
    // tile toward the bottom of a long board did nothing.
    //
    // ★★ jsdom HAS NO LAYOUT, so no assertion anywhere can watch the scroll
    // happen. Identity is the whole of what is checkable: the ref the hook
    // autoscrolls is the same node `ReportCard` scrolls. The second half is a
    // separate defect — a re-added wrapper would be a NESTED scroller, which
    // swallows the wheel and takes the drag back to a dead element.
    reorderScrollRefs.length = 0;
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
    // `hideToolbar` is set, so the card's content div is its only child.
    const card = document.querySelector(".print-root")!;
    const content = card.firstElementChild as HTMLElement;
    expect(content.className).toMatch(/overflow-y-auto/);

    const captured = reorderScrollRefs.at(-1);
    expect(captured, "the panel passes no scrollRef at all").toBeDefined();
    expect(captured!.current).toBe(content);

    const grid = screen.getByTestId("dashboard-grid");
    expect(content.contains(grid)).toBe(true);
    for (let el: HTMLElement | null = grid; el && el !== content; el = el.parentElement) {
      expect(String(el.className), `${el.tagName} nests a second scroller`).not.toMatch(/overflow-/);
    }
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
    expect(screen.getAllByRole("button", { name: /^Open – / }).length).toBeGreaterThanOrEqual(2);
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
    const rowButton = screen.getByRole("button", { name: /^Open – / });
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
  // holds just Spent + "h"). The EVM row renders only when there's estimate
  // coverage; its CPI tile sits beside the SPI tile.
  function evmCpiTile(): HTMLElement {
    const spiTile = screen.getByText("Effort SPI").closest("div.rounded-lg") as HTMLElement;
    // Each hinted tile is wrapped in a `div.relative` (tooltip sibling), so the
    // shared EVM row is the wrapper's parent, not the tile's direct parent.
    const evmRow = spiTile.parentElement?.parentElement as HTMLElement;
    return within(evmRow).getByText("Effort CPI").closest("div.rounded-lg") as HTMLElement;
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
    expect(within(burnRow).queryByText("Effort CPI")).toBeNull();
    expect(screen.getAllByText("Effort CPI")).toHaveLength(1);
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

// The EVM tiles only render once there is estimate coverage (`evm.ts`
// `computeEvm`: a task participates iff `originalEstimateMinutes > 0`) — plain
// `fullProps` (tasks: []) never reaches that branch, so it cannot exercise the
// showBudget→EVM gate below. This task gives a non-null coverage without
// otherwise changing what `fullProps`-based baseline assertions see.
const tasksWithEvmEstimate = [
  {
    id: 1, title: "Done task", status: "Done", health: "G",
    originalEstimateMinutes: 57, timeSpentMinutes: 60,
    dueDate: "2026-06-01", completedDate: "2026-06-01",
    linkedRaidIds: [], subtaskIds: [], parentId: null, assigneeIds: [],
  },
] as never[];

describe("DashboardPanel module visibility gates (Task 8)", () => {
  it("shows Budget burn section and RAID section when all flags are true (baseline)", () => {
    render(<DashboardPanel {...fullProps} />, { wrapper });
    expect(screen.getByText("Budget burn")).toBeInTheDocument();
    expect(screen.getByText("Top open RAID")).toBeInTheDocument();
    expect(screen.getByText("Milestones")).toBeInTheDocument();
    expect(screen.getByText("Changes")).toBeInTheDocument();
  });

  it("shows the Effort SPI/CPI tiles when showBudget is true (positive control)", () => {
    // Without this, the negative test below (queryByText → toBeNull) would pass
    // just as happily if the EVM row's text were renamed out from under the
    // query — a bare `queryByText` failing to find a stale string reads
    // identically to the gate actually working.
    render(<DashboardPanel {...fullProps} tasks={tasksWithEvmEstimate} />, { wrapper });
    expect(screen.getByText(t("en-US", "evmSpi"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "evmCpi"))).toBeInTheDocument();
  });

  it("hides Budget burn section and EVM when showBudget is false", () => {
    render(<DashboardPanel {...fullProps} tasks={tasksWithEvmEstimate} showBudget={false} />, { wrapper });
    expect(screen.queryByText("Budget burn")).toBeNull();
    expect(screen.queryByText(t("en-US", "evmSpi"))).toBeNull();
    expect(screen.queryByText(t("en-US", "evmCpi"))).toBeNull();
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
      budgetRag: "" as const, scopeRag: "" as const, milestones: [], series: [], bucketProgress: [],
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

  it("labels the burn tile's spend box \"Spent\", not \"Budget\" (the budget rating now follows the forecast)", () => {
    const onNavigate = vi.fn();
    render(<DashboardPanel {...fullProps} onNavigate={onNavigate} />, { wrapper });
    // The label + activate button both carry the new "Spent" wording, and the
    // accessible name (label-in-name) still contains the visible "Spent" text.
    expect(screen.getByText("Spent")).toBeInTheDocument();
    // The top-band pill (dashboard-hero.tsx, a separate surface) is unaffected
    // and still reads "Budget" — this proves the rename is scoped to the burn
    // tile, not a global string swap.
    expect(screen.getAllByText("Budget").length).toBeGreaterThan(0);
    const activateBtn = screen.getByRole("button", { name: /^Spent – /  });
    fireEvent.click(activateBtn);
    expect(onNavigate).toHaveBeenCalledWith("budget");
  });

});

// ★★ EVERY TEST HERE NEEDS ITS OWN `projectId`. `useDashboardLayout` keys its
// stored arrangement on it, so a shared id would let one test's hide leak into
// the next. ★★★ THIS IS STRICTLY LOAD-BEARING, NOT BELT-AND-BRACES — an earlier
// version of this comment claimed the 400ms debounce meant nothing was ever
// written inside a synchronous test. It is written: `use-dashboard-layout.ts`
// has a flush-on-unmount effect (`useEffect(() => flush, …)`) that exists
// exactly so an unmount inside the debounce window is not discarded, and RTL
// cleanup triggers it. Reusing an id WILL leak.
const EN = "en-US" as const;
// ★★ §425: `reorderHandleDragOnly`, NOT `reorderHandle`. This panel passes
// `keyboard: false` to `useListReorderDnd`, so its grips carry no `onKeyDown`
// and the arrow-key half of `reorderHandle`'s name was a promise nothing kept.
// Every expected grip name is built here, which is why closing §425 was a
// one-line change in this file.
// ★★★ THREE DIFFERENT TALLIES LIVE HERE AND THEY ARE 5, 4 AND 3. §425 predicted
// "five test names": five is the count of `grip()` CALL SITES. They sit in FOUR
// tests. Only THREE of those are mutation-sensitive — flipping
// `keyboardReorder` to `true` in `dashboard-panel.tsx` gives
// `3 failed | 70 passed (73)`.
// ★★ THE FOURTH IS WHY THE SUM CHECK CANNOT CATCH THIS: "renders no grip, menu,
// shelf or reset in a popout (read-only)" asserts `queryByRole(...)` is NULL,
// and `arrangement-tile.tsx` renders the grip behind `{!readOnly && …}` — so in
// a popout there is no grip AT ALL and that assertion passes whether the name is
// right, renamed, or misspelt in this helper. It is name-INSENSITIVE by
// construction, which is correct for what it tests and useless as a name pin.
// ★ A first cut of this comment said "THREE tests", derived from the mutation
// count — the same call-sites-vs-tests conflation it was written to warn about.
// Count the enclosing `it(` blocks, not the failures and not the call sites.
const grip = (title: string) => `${t(EN, "reorderHandleDragOnly")} – ${title}`;
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
    // ★★★ queryByRole, NOT queryByText. This button is icon-only, so it renders
    // no text node and a text query passes whether it is guarded or not — the
    // assertion would read as coverage while pinning nothing. The accessible
    // name is the only observable that survives the icon-only form.
    expect(
      screen.queryByRole("button", { name: t(EN, "arrangementResetLayout") }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: t(EN, "arrangementShelfCount", 0) })).toBeNull();
  });

  it("hides a tile from the ⋮ menu onto the shelf, announces it, and restores it", async () => {
    const user = userEvent.setup();
    render(<DashboardPanel {...fullProps} projectId="p-grid-hide" />, { wrapper });
    await user.click(screen.getByRole("button", { name: kebab("Progress") }));
    // PopoverPanel owns the dismissal protocol and portals the panel to <body>.
    const menu = screen.getByRole("dialog", { name: kebab("Progress") });
    await user.click(within(menu).getByRole("button", { name: t(EN, "arrangementTileHide") }));

    expect(screen.queryByTestId("tile-progress")).toBeNull();
    const announced = screen.getAllByRole("status").map((el) => el.textContent);
    expect(announced).toContain(t(EN, "arrangementTileHidden", "Progress"));

    await user.click(screen.getByRole("button", { name: t(EN, "arrangementShelfCount", 1) }));
    await user.click(screen.getByRole("button", { name: `${t(EN, "arrangementTileRestore")} – Progress` }));
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
    await user.click(within(menu).getByRole("button", { name: t(EN, "arrangementTileHide") }));

    expect(screen.queryByTestId("tile-progress")).toBeNull();      // the trigger really did unmount
    const shelf = screen.getByRole("button", { name: t(EN, "arrangementShelfCount", 1) });
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
    await user.click(within(menu).getByRole("button", { name: t(EN, "arrangementTileHide") }));

    await user.click(screen.getByRole("button", { name: t(EN, "arrangementShelfCount", 1) }));
    await user.click(screen.getByRole("button", { name: `${t(EN, "arrangementTileRestore")} – Progress` }));
    expect(screen.getByTestId("tile-progress")).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: t(EN, "arrangementShelfCount", 0) }),
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
    await user.click(within(menu).getByRole("button", { name: t(EN, "arrangementTileMoveEarlier") }));

    const after = Array.from(document.querySelectorAll('[data-testid^="tile-"]'))
      .map((el) => el.getAttribute("data-testid"));
    expect(after.indexOf(target)).toBe(1);
    expect(after).toHaveLength(before.length);
    const announced = screen.getAllByRole("status").map((el) => el.textContent);
    expect(announced).toContain(t(EN, "arrangementTileMoved", title, "2", String(before.length)));
  });

  it("returns focus to the moved tile's own ⋮ trigger, so the next move needs no re-navigation", async () => {
    // ★★★ THE ⋮ MENU IS THIS SURFACE'S ENTIRE KEYBOARD REORDER PATH (the drag
    // primitive's arrow-key option is deliberately off here), so where focus
    // lands after a move IS the feature. The popover closes on every move
    // command and `PopoverPanel` restores focus to nothing on close, so focus
    // fell to `<body>` and a keyboard user had to navigate back to the tile
    // between every single press.
    const user = userEvent.setup();
    render(<DashboardPanel {...fullProps} projectId="p-grid-move-focus" />, { wrapper });
    const before = Array.from(document.querySelectorAll('[data-testid^="tile-"]'))
      .map((el) => el.getAttribute("data-testid"));
    const target = before[2]!;                       // never index 0 — Move earlier is disabled there
    const title = screen.getByTestId(target).getAttribute("aria-label")!;

    await user.click(screen.getByRole("button", { name: kebab(title) }));
    const menu = screen.getByRole("dialog", { name: kebab(title) });
    await user.click(within(menu).getByRole("button", { name: t(EN, "arrangementTileMoveEarlier") }));

    // The tile survives a move — only the popover goes — so the destination is
    // the trigger the user opened, found by TILE IDENTITY rather than by a node
    // captured before the reorder.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: kebab(title) }));
  });

  it("keeps focus on the size control through a resize, WITHOUT any focus machinery", async () => {
    // ★★ RESIZE IS NOT THE MOVE CASE AND MUST NOT BE "FIXED" LIKE ONE. The size
    // radios do NOT close the popover (`TileAxisGroup`'s onPick calls onResize
    // and nothing else), so the control the user pressed is still mounted and
    // keeps focus by itself — and the popover is portaled, so the tile
    // re-rendering at its new span cannot disturb it. Measured before writing
    // the move fix, precisely so no machinery was added for a defect that is
    // not there. This test is the pin: if a future change makes resize close the
    // menu, it goes red and the decision gets made deliberately.
    const user = userEvent.setup();
    render(<DashboardPanel {...fullProps} projectId="p-grid-resize-focus" />, { wrapper });
    await user.click(screen.getByRole("button", { name: kebab("Progress") }));
    const menu = screen.getByRole("dialog", { name: kebab("Progress") });
    const taller = within(menu).getByRole("radio", { name: /height 3/i });
    await user.click(taller);

    expect(screen.getByRole("dialog", { name: kebab("Progress") })).toBeInTheDocument();  // still open
    expect(document.activeElement).toBe(taller);
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
    fireEvent.drop(screen.getByRole("button", { name: t(EN, "arrangementShelfCount", 0) }));
    expect(screen.queryByTestId("tile-progress")).toBeNull();     // the grip really did unmount

    const shelf = screen.getByRole("button", { name: t(EN, "arrangementShelfCount", 1) });
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
    const shelf = screen.getByRole("button", { name: t(EN, "arrangementShelfCount", 0) });
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
    await user.click(within(menu).getByRole("button", { name: t(EN, "arrangementTileHide") }));
    await user.click(screen.getByRole("button", { name: t(EN, "arrangementShelfCount", 1) }));
    const chip = `${t(EN, "arrangementTileRestore")} – Budget burn`;
    expect(screen.getByRole("button", { name: chip })).toBeInTheDocument();

    rerender(<DashboardPanel {...fullProps} projectId="p-grid-gate" showBudget={false} />);
    expect(screen.queryByRole("button", { name: chip })).toBeNull();
    expect(screen.getByRole("button", { name: t(EN, "arrangementShelfCount", 0) })).toBeInTheDocument();

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

describe("DashboardPanel reset-layout control", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("renders the reset button in the top control stack", () => {
    render(<DashboardPanel {...fullProps} projectId="p-reset-present" />, { wrapper });
    expect(
      screen.getByRole("button", { name: t(EN, "arrangementResetLayout") }),
    ).toBeInTheDocument();
  });

  // ★ AGENTS.md pins the trailing group as Print · reset-columns ·
  // reset-pane-size. Reset layout is the reset-columns ANALOGUE (it restores
  // content arrangement, where reset-size restores the pane box), so it sorts
  // between them.
  it("orders the stack Print, Reset layout, Reset size", () => {
    render(<DashboardPanel {...fullProps} projectId="p-reset-order" />, { wrapper });
    expectButtonOrder(["printHint", "arrangementResetLayout", "tableResetSizeHint"], {
      contiguous: true,
    });
  });

  it("restores a hidden tile when the reset button is clicked", async () => {
    const user = userEvent.setup();
    render(<DashboardPanel {...fullProps} projectId="p-reset-click" />, { wrapper });
    await user.click(screen.getByRole("button", { name: kebab("Progress") }));
    const menu = screen.getByRole("dialog", { name: kebab("Progress") });
    await user.click(within(menu).getByRole("button", { name: t(EN, "arrangementTileHide") }));
    expect(screen.queryByTestId("tile-progress")).toBeNull();

    await user.click(screen.getByRole("button", { name: t(EN, "arrangementResetLayout") }));
    expect(screen.getByTestId("tile-progress")).toBeInTheDocument();
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

describe("DashboardPanel activity log source (activity-log-workspace-data, task 11)", () => {
  afterEach(() => {
    localStorage.clear();
  });

  // Seeds the WORKSPACE's activityLog through the real setter — the only path
  // a live project ever populates it through (use-storage-backend's merge on
  // load, or use-activity-log's append). A localStorage write is the LEGACY
  // path this test proves the panel no longer reads.
  function Seed({ activityLog }: { activityLog: readonly ActivityEntry[] }) {
    const { setActivityLog } = useWorkspace();
    useEffect(() => {
      setActivityLog(activityLog);
    }, [activityLog, setActivityLog]);
    return null;
  }

  it("reads the activity log from the workspace, not localStorage", () => {
    window.localStorage.setItem(
      "aipm-cockpit:activity-log",
      JSON.stringify([
        { id: "legacy-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created", args: ["OLD"] },
      ]),
    );
    const workspaceEntry: ActivityEntry = {
      id: "dev1-s1-1",
      timestamp: "2026-08-02T00:00:00.000Z",
      kind: "task.created",
      args: ["NEW"],
    };
    const buildSpy = vi.spyOn(dashboardModule, "buildDashboardInput");

    render(
      <>
        <Seed activityLog={[workspaceEntry]} />
        <DashboardPanel {...fullProps} />
      </>,
      { wrapper },
    );

    const lastCall = buildSpy.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    const ctxArg = lastCall![1];
    // Positive: the panel's computation ran on the WORKSPACE-seeded entry.
    expect(ctxArg.activity).toEqual([workspaceEntry]);
    // Negative: the legacy localStorage entry never reached it — this is what
    // makes the assertion above non-vacuous (an empty `activity` would also
    // pass a bare "OLD is absent" check).
    expect(ctxArg.activity.some((e) => e.args.includes("OLD"))).toBe(false);
  });
});

// Pins the wiring that feeds `computeForecastBundle`'s `progress`/`budgetHistory`
// (via `buildDashboardInput`'s `snapshots`/`budgetHistory` entities): `snapshots`
// only reaches it while Turso trends are active, `budgetHistory` always does.
describe("DashboardPanel forecast bundle wiring (snapshots / budgetHistory)", () => {
  function SeedBudgetHistory({ budgetHistory }: { budgetHistory: readonly BudgetHistoryEntry[] }) {
    const { setBudgetHistory } = useWorkspace();
    useEffect(() => {
      setBudgetHistory(budgetHistory);
    }, [budgetHistory, setBudgetHistory]);
    return null;
  }

  const snapshot: SnapshotRecord = {
    id: "s1", capturedAt: "2026-01-01T00:00:00.000Z", bucket: "2026-01", cadence: "monthly", trigger: "manual",
    isBaseline: false, remainingHours: null, remainingCost: null, pctComplete: 30,
    forecastEndDate: "2026-12-31", planEndDate: "2026-12-31", spi: null, cpi: null,
    overallRag: "", scheduleRag: "", budgetRag: "", scopeRag: "",
    milestones: [], series: [], bucketProgress: [{ bucketId: 1, pctComplete: 30 }],
  };
  const history: BudgetHistoryEntry[] = [{
    id: "h1", at: "2026-01-01T00:00:00.000Z", date: "2026-01-01", kind: "baseline",
    bucketId: null, bucketName: "", projectBacHours: 100, projectBacValue: 15000, deltaHours: 0, deltaValue: 0,
  }];

  it("carries `snapshots` into buildDashboardInput's entities when Turso trends are active, and carries `budgetHistory`", () => {
    const buildSpy = vi.spyOn(dashboardModule, "buildDashboardInput");
    render(
      <>
        <SeedBudgetHistory budgetHistory={history} />
        <DashboardPanel {...fullProps} tursoActive snapshots={[snapshot]} />
      </>,
      { wrapper },
    );
    const entitiesArg = buildSpy.mock.calls.at(-1)![0];
    expect(entitiesArg.snapshots).toEqual([snapshot]);
    expect(entitiesArg.budgetHistory).toEqual(history);
  });

  it("carries an EMPTY snapshots array when Turso trends are NOT active, even though `snapshots` was supplied", () => {
    const buildSpy = vi.spyOn(dashboardModule, "buildDashboardInput");
    render(<DashboardPanel {...fullProps} tursoActive={false} snapshots={[snapshot]} />, { wrapper });
    const entitiesArg = buildSpy.mock.calls.at(-1)![0];
    expect(entitiesArg.snapshots).toEqual([]);
  });
});

// ★★ The dashboard is the LANDING view, and both of its money surfaces render
// figures that came out of the budget engine and convert NOTHING:
//   · the Budget tile prints `model.burn.consumedValue / budgetValue`, which
//     `dashboard.ts` copies straight off `computeBudgetReport(...).project`;
//   · the burn-down chart prints `model.burndown`, whose values are
//     `budgetHours × role.rates.external`.
// The engine's money unit is EUR (`computeBucketReport` converts a fixed-price
// contract amount to EUR at its one read), so both are EUR whatever
// `plan.currency` says. Narrowing that field to the `BudgetCurrency` union did
// NOT make it safe to label with: the union still admits `USD`/`GBP`, so it
// states the plan's base currency, never the unit of an unconverted engine
// figure. Labelling them `plan.currency` printed EUR money
// under another currency's symbol (docs/open-followups.md §465).
describe("DashboardPanel currency labelling", () => {
  // Rated roles + budgeted AND actual hours are both required: with no rate
  // card every value is 0, the burn-down renders its "no budget" line instead
  // of an axis, and the assertions below would have nothing to read.
  const ratedRoles = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
  const ratedBudget = [
    {
      id: 1, name: "PO", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 40 } }],
    },
  ] as unknown as BudgetBucket[];

  function renderUsdDashboard() {
    render(
      <DashboardPanel
        lang="en-US"
        tasks={[]}
        raid={[]}
        budgets={ratedBudget}
        plan={{ ...plan, currency: "USD" }}
        roles={ratedRoles}
        resources={[]}
        absences={[]}
        holidaySet={new Set<string>()}
        workdayHours={8}
        today="2026-06-02"
      />,
      { wrapper },
    );
  }

  it("labels the Budget tile in EUR even when the plan names another currency", () => {
    renderUsdDashboard();
    // Anchored on the hours tile, which is labelled "h" and is the one handle
    // here already proven unique. TWO hops up, and the shape this walks is NOT
    // a property of `Tile` — it holds only while BOTH of these are true of
    // this fixture, and they pull in opposite directions:
    //   · no `onNavigate` is passed, so `buildTileBodies` leaves `openBudget`
    //     undefined (`dashboard-tile-bodies.tsx`) and the tile's `onActivate`
    //     with it — so `Tile` takes its `Card` branch, a `div.rounded-lg`.
    //     Pass `onNavigate` and the tile becomes a `<button class="…rounded-lg…">`
    //     instead, and `closest("div.rounded-lg")` walks straight PAST both
    //     tiles.
    //   · a `hint` IS passed, and `Tile` returns the bare tile when there is
    //     none (`if (!hint) return tile;`). The hint is what adds the
    //     `relative h-full w-full` wrapper, which is the whole reason this is
    //     two hops rather than one — drop the hint and the second hop
    //     overshoots the flex row.
    // Either way the failure is loud (`getAllByText` throws on zero matches)
    // rather than a silent pass, so the test is not at risk — but do not read
    // the hop count as something `Tile` guarantees.
    const burnRow = (screen.getByText("h").closest("div.rounded-lg") as HTMLElement)
      .parentElement!.parentElement as HTMLElement;

    // ★★★ THE POSITIVE CONTROL. `queryByText(/\$/) === null` passes just as
    // happily when the query is wrong, the scope is empty, or the tile failed
    // to render. `getAllByText` THROWS on zero matches. MEASURED, not reasoned:
    // 1 — the tile prints consumed and budget as ONE string ("€6,000 /
    // €15,000"), so the pair is a single text node, and the neighbouring hours
    // tile carries no currency at all.
    const money = within(burnRow).getAllByText(/[€$]/).map((el) => el.textContent ?? "");
    expect(money).toHaveLength(1);
    expect(money.filter((s) => s.includes("$"))).toEqual([]);
    expect(money.every((s) => s.includes("€"))).toBe(true);
  });

  it("labels the burn-down value axis in EUR even when the plan names another currency", () => {
    renderUsdDashboard();
    // Scoped to the € chart: `BurndownChart` renders `<div>{caption}</div><svg>`,
    // so the caption's parent is that chart alone ("Budget remaining" is the
    // default burn-down × € view).
    const valueChart = screen.getByText(/Budget remaining/i).parentElement!;

    // Y ticks only (`data-axis="y"`): forecast end labels are money too. Ticks
    // are `[yMin if below zero, 0, total/2, total]`; this fixture books 40 h of
    // 100 h, nothing reaches below zero, so yMin is 0 and deduplicates → 3.
    const money = Array.from(valueChart.querySelectorAll("svg text[data-axis='y']")).map((el) => el.textContent ?? "");
    expect(money).toHaveLength(3);
    expect(money.filter((s) => s.includes("$"))).toEqual([]);
    expect(money.every((s) => s.includes("€"))).toBe(true);
  });
});

// §474 (third surface): budget-panel.tsx and budget-report-panel.tsx already
// disclose how many of their EUR-rollup summands were counted at par because
// no FX rate was ever confirmed for them (`BudgetFxRollupNotice`, fx.ts's
// `countUnresolvedBuckets`). The Dashboard budget tile sums the SAME
// `computeBudgetReport(...).project` figures and had the same blind spot —
// this pins the notice reused verbatim on that tile.
describe("DashboardPanel budget tile — unresolved-rate FX rollup notice (§474)", () => {
  const ratedRoles = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];

  function budgetBucket(over: Partial<BudgetBucket> = {}): BudgetBucket {
    return {
      id: 1, name: "PO", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 40 } }],
      ...over,
    } as unknown as BudgetBucket;
  }

  function renderDashboard(budgets: BudgetBucket[]) {
    render(
      <DashboardPanel
        lang="en-US" tasks={[]} raid={[]} budgets={budgets} plan={plan} roles={ratedRoles}
        resources={[]} absences={[]} holidaySet={new Set<string>()} workdayHours={8} today="2026-06-02"
      />,
      { wrapper },
    );
  }

  it("names the unresolved count when a non-EUR bucket has no confirmed rate (fxRates null)", () => {
    // USD with no fxRateOverride and no cached rate (fxRates defaults to null
    // in WorkspaceProvider) -> resolveRateSource is "unresolved" (fx.ts).
    // Fixed-price: only a contract amount is converted, so only it is summed at par.
    renderDashboard([budgetBucket({ currency: "USD", type: "fixed", fixedPriceAmount: 10000 })]);
    const tile = screen.getByTestId("tile-burn");
    expect(within(tile).getByText(t("en-US", "budgetFxRollupUnresolvedOne"))).toBeInTheDocument();
  });

  it("renders no notice when the only rateless non-EUR bucket is T&M", () => {
    // T&M money is hours × EUR role rates, converted nowhere.
    renderDashboard([budgetBucket({ currency: "USD" })]);
    const tile = screen.getByTestId("tile-burn");
    expect(within(tile).queryByText(/without an FX rate/i)).toBeNull();
  });

  it("renders no notice when every bucket resolves (EUR)", () => {
    renderDashboard([budgetBucket()]);
    const tile = screen.getByTestId("tile-burn");
    expect(within(tile).queryByText(/without an FX rate/i)).toBeNull();
  });
});

// S5: the burn tile threads the bundle's `hours` and `mix` into
// `ForecastHeadline`. Replacing either prop with null left every other test
// green, so this pins the wiring with a triggered mix. The model is the real
// one with only the forecast bundle swapped in: building a triggered mix from
// workspace data would need a whole booked-hours scenario for one chip.
describe("DashboardPanel burn tile — rate-mix chip (S5)", () => {
  it("shows the hours-view chip inside the burn tile when the rate mix triggers", () => {
    const realCompute = dashboardModule.computeDashboard;
    const spy = vi.spyOn(dashboardModule, "computeDashboard").mockImplementation(
      (...args: Parameters<typeof realCompute>) => ({
        ...realCompute(...args), forecast: BUNDLE_HOURS_WORSE.eur, forecastBundle: BUNDLE_HOURS_WORSE,
      }),
    );
    try {
      const bucket = {
        id: 1, name: "PO", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
        allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 40 } }],
      } as unknown as BudgetBucket;
      render(
        <DashboardPanel
          lang="en-US" tasks={[]} raid={[]} budgets={[bucket]} plan={plan}
          roles={[{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }]}
          resources={[]} absences={[]} holidaySet={new Set<string>()} workdayHours={8} today="2026-06-02"
        />,
        { wrapper },
      );
      const chipText = rateMixTileChipText("en-US", MIX_HOURS_WORSE, HOURS_FORECAST_HOURS_WORSE);
      const tile = screen.getByTestId("tile-burn");
      expect(within(tile).getByRole("button", { name: rateMixWhyName("en-US", chipText) })).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });
});
