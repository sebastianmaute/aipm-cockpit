import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportsPanel } from "./reports";
import type { BudgetBucket, ResourcePlan, Role, Task } from "./types";
import type { AddableReportId } from "./addable-reports";
import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";
import { t } from "./i18n";

const TODAY = "2026-05-28";

// Defaults first, overrides SPREAD last. The earlier shape wired each field by
// hand (`status: p.status`), so any field it forgot — healthOverride, jiraKey,
// resourceId — was silently dropped and a test overriding one would pass
// against broken code. The `as unknown as Task` cast hides that from tsc, so
// the spread is the only thing keeping overrides honest.
function makeTask(p: Partial<Task> & { id: number; assignee: string }): Task {
  return {
    taskName: `Task ${p.id}`,
    assigneeEmail: "",
    priority: "Medium",
    startDate: TODAY,
    dueDate: TODAY,
    lastUpdateDate: TODAY,
    blockers: "",
    description: "",
    inquiriesSent: 0,
    group: "",
    labels: [],
    dependencies: [],
    ...p,
  } as unknown as Task;
}

function renderReports(tasks: Task[]) {
  return render(
    <ReportsPanel
      tasks={tasks}
      lang="en-US"
      today={TODAY}
      holidaySet={new Set()}
    />,
  );
}

function sectionByTitle(re: RegExp): HTMLElement {
  const heading = screen.getByText(re);
  return heading.closest("div") as HTMLElement;
}

function rowNamesIn(section: HTMLElement): string[] {
  const tbody = section.querySelector("tbody");
  if (!tbody) return [];
  return Array.from(tbody.querySelectorAll("tr")).map(
    (tr) => (tr.querySelector("td") as HTMLElement | null)?.textContent?.trim() ?? "",
  );
}

describe("ReportsPanel — sort + filter", () => {
  const tasks: Task[] = [
    makeTask({ id: 1, assignee: "Alex", group: "Backend", labels: ["urgent"] }),
    makeTask({ id: 2, assignee: "Alex", group: "Backend", labels: ["urgent"] }),
    makeTask({ id: 3, assignee: "Bea", group: "Frontend", labels: ["ui"] }),
    makeTask({ id: 4, assignee: "Carl", group: "Backend", labels: ["urgent"] }),
  ];

  it("marks the report root as a print-root for scoped printing", () => {
    const { container } = renderReports(tasks);
    expect((container.firstElementChild as HTMLElement).className).toContain("print-root");
  });

  it("By Assignee renders rows with default total-desc sort", () => {
    renderReports(tasks);
    const section = sectionByTitle(/By Assignee/i);
    // Default sort: total desc — Alex (2) first; then Bea (1), Carl (1).
    // The sort is: stable asc by name+total, then reversed → Carl precedes Bea after reverse.
    expect(rowNamesIn(section)).toEqual(["Alex", "Carl", "Bea"]);
  });

  it("clicking By Assignee header cycles asc → desc → off", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const section = sectionByTitle(/By Assignee/i);
    const header = within(section).getByRole("button", { name: /assignee/i });

    await user.click(header); // asc by name
    expect(rowNamesIn(section)).toEqual(["Alex", "Bea", "Carl"]);

    await user.click(header); // desc
    expect(rowNamesIn(section)).toEqual(["Carl", "Bea", "Alex"]);

    await user.click(header); // off → default (total desc) restored
    expect(rowNamesIn(section)[0]).toBe("Alex");
  });

  it("By Assignee filter narrows rows (case-insensitive)", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const section = sectionByTitle(/By Assignee/i);
    const input = within(section).getByPlaceholderText(/filter assignees/i);
    await user.type(input, "alex");
    expect(rowNamesIn(section)).toEqual(["Alex"]);
  });

  it("By Assignee clear button restores all rows", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const section = sectionByTitle(/By Assignee/i);
    const input = within(section).getByPlaceholderText(/filter assignees/i);
    await user.type(input, "alex");
    const clearBtn = within(section).getByRole("button", { name: /clear/i });
    await user.click(clearBtn);
    expect(rowNamesIn(section).length).toBeGreaterThanOrEqual(3);
  });

  it("By Assignee shows 'No matches' when filter matches nothing", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const section = sectionByTitle(/By Assignee/i);
    const input = within(section).getByPlaceholderText(/filter assignees/i);
    await user.type(input, "zzz");
    expect(within(section).getByText(/no matches/i)).toBeInTheDocument();
  });

  it("By Group + By Label have independent sort state", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const groupSection = sectionByTitle(/By Group/i);
    const labelSection = sectionByTitle(/By Label/i);

    const groupNameHeader = within(groupSection).getByRole("button", { name: /^Group/i });
    await user.click(groupNameHeader);
    expect(rowNamesIn(groupSection)[0]).toBe("Backend"); // alphabetical asc

    // Label default sort is total desc; "urgent" (3) > "ui" (1) → urgent first.
    expect(rowNamesIn(labelSection)[0]).toBe("urgent");
  });

  it("By Assignee filter does not affect By Group rows", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const assigneeSection = sectionByTitle(/By Assignee/i);
    const groupSection = sectionByTitle(/By Group/i);

    const assigneeFilter = within(assigneeSection).getByPlaceholderText(/filter assignees/i);
    await user.type(assigneeFilter, "alex");

    const groupNames = rowNamesIn(groupSection);
    expect(groupNames).toContain("Backend");
    expect(groupNames).toContain("Frontend");
  });

  it("renders a Print button in the header", () => {
    renderReports(tasks);
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
  });
});

const brPlan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-01-31", granularity: "month", currency: "EUR" };
const brRoles: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
const brBuckets: BudgetBucket[] = [
  { id: 1, name: "Alpha", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 40 } }] },
];

function renderComposed(
  extraReports: AddableReportId[],
  onChange = vi.fn(),
  features?: FeatureModuleId[],
) {
  render(
    <ReportsPanel
      tasks={[makeTask({ id: 1, assignee: "A" })]}
      today={TODAY}
      holidaySet={new Set()}
      lang="en-US"
      buckets={brBuckets}
      plan={brPlan}
      roles={brRoles}
      disciplines={[{ id: 1, name: "Consulting" }]}
      grades={[{ id: 1, name: "Junior" }]}
      resources={[]}
      absences={[]}
      workdayHours={8}
      fxRates={null}
      raid={[]}
      extraReports={extraReports}
      onChangeExtraReports={onChange}
      features={features}
    />,
  );
  return onChange;
}

describe("ReportsPanel — composed reports", () => {
  it("renders RAID and Budget reports when both are in extraReports", () => {
    renderComposed(["raid-report", "budget-report"]);
    expect(screen.getByRole("heading", { name: /raid report/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /budget report/i })).toBeInTheDocument();
  });

  it("renders an appended report's content when in extraReports", () => {
    renderComposed(["budget-report"]);
    expect(screen.getByText(/project total/i)).toBeInTheDocument(); // Budget report body
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
  it("the add-report select appends a chosen report", () => {
    const onChange = renderComposed([]);
    fireEvent.change(screen.getByLabelText(/add report/i), { target: { value: "budget-report" } });
    expect(onChange).toHaveBeenCalledWith(["budget-report"]);
  });
  it("a report's remove button removes it", () => {
    const onChange = renderComposed(["budget-report"]);
    fireEvent.click(screen.getByRole("button", { name: /remove report/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
  it("the remove-report select removes a chosen report", async () => {
    const user = userEvent.setup();
    const onChange = renderComposed(["raid-report", "budget-report"]);
    await user.selectOptions(screen.getByLabelText("Remove report"), "raid-report");
    expect(onChange).toHaveBeenCalledWith(["budget-report"]);
  });
  it("the remove-report select is absent when there are no added reports", () => {
    renderComposed([]);
    expect(screen.queryByLabelText("Remove report")).toBeNull();
  });
  it("renders the Stakeholder report when added", () => {
    renderComposed(["stakeholder-report"]);
    expect(screen.getByRole("heading", { name: /stakeholder report/i })).toBeInTheDocument();
  });
});

describe("ReportsPanel — module gating", () => {
  it("omits a stored extra report whose module is disabled", () => {
    const featuresWithout = ALL_MODULE_IDS.filter((m) => m !== "stakeholders");
    render(
      <ReportsPanel
        tasks={[makeTask({ id: 1, assignee: "A" })]}
        today={TODAY}
        holidaySet={new Set()}
        lang="en-US"
        raid={[]}
        stakeholders={[]}
        milestones={[]}
        extraReports={["stakeholder-report"]}
        features={featuresWithout}
      />,
    );
    expect(screen.queryByRole("heading", { name: /stakeholder report/i })).toBeNull();
  });

  it("shows a stored extra report when its module is enabled", () => {
    render(
      <ReportsPanel
        tasks={[makeTask({ id: 1, assignee: "A" })]}
        today={TODAY}
        holidaySet={new Set()}
        lang="en-US"
        raid={[]}
        stakeholders={[]}
        milestones={[]}
        extraReports={["stakeholder-report"]}
        features={[...ALL_MODULE_IDS]}
      />,
    );
    expect(screen.getByRole("heading", { name: /stakeholder report/i })).toBeInTheDocument();
  });

  it("add-report picker does NOT offer a disabled-module report as an option", () => {
    const featuresWithout = ALL_MODULE_IDS.filter((m) => m !== "stakeholders");
    renderComposed([], vi.fn(), featuresWithout);
    const picker = screen.getByRole("combobox", { name: /add report/i });
    expect(within(picker).queryByRole("option", { name: /stakeholder report/i })).toBeNull();
  });

  it("add-report picker DOES offer the report when its module is enabled", () => {
    renderComposed([], vi.fn(), [...ALL_MODULE_IDS]);
    const picker = screen.getByRole("combobox", { name: /add report/i });
    expect(within(picker).getByRole("option", { name: /stakeholder report/i })).toBeInTheDocument();
  });
});

describe("ReportsPanel — drag-reorder extra reports", () => {
  it("calls onChangeExtraReports with reordered array when 2nd card dragged onto 1st", () => {
    const onChange = vi.fn();
    render(
      <ReportsPanel
        tasks={[makeTask({ id: 1, assignee: "A" })]}
        today={TODAY}
        holidaySet={new Set()}
        lang="en-US"
        raid={[]}
        stakeholders={[]}
        milestones={[]}
        extraReports={["raid-report", "budget-report"]}
        onChangeExtraReports={onChange}
        features={[...ALL_MODULE_IDS]}
        buckets={brBuckets}
        plan={brPlan}
        roles={brRoles}
        disciplines={[{ id: 1, name: "Consulting" }]}
        grades={[{ id: 1, name: "Junior" }]}
        resources={[]}
        absences={[]}
        workdayHours={8}
        fxRates={null}
      />,
    );

    // Locate the two drag handles (one per extra report card, in DOM order)
    const handles = screen.getAllByRole("button", { name: /drag or use arrow keys to reorder/i });
    expect(handles).toHaveLength(2);

    // Drag the 2nd handle (budget-report) onto the 1st card (raid-report)
    fireEvent.dragStart(handles[1]);
    const cards = screen.getAllByTestId("extra-report-card");
    fireEvent.dragOver(cards[0]);
    fireEvent.drop(cards[0]);

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(["budget-report", "raid-report"]);
  });
});

describe("ReportsPanel — Total tile names the cancelled count", () => {
  it("names the cancelled count under Total when there is any", () => {
    const { container } = renderReports([
      makeTask({ id: 1, assignee: "Alex", status: "To Do" }),
      makeTask({ id: 2, assignee: "Bea", status: "Cancelled" }),
    ]);
    expect(screen.getByText(t("en-US", "reportsCancelledCount", "1"))).toBeInTheDocument();
    // WHICH tile carries the qualifier is the decision, not merely that some
    // tile does: `Total` is the number that stopped reconciling with Open +
    // Completed, so the sub must sit in ITS tile. A bare getByText passes with
    // the line moved onto Open or Completed.
    const subs = container.querySelectorAll("[data-tile-sub]");
    // Exactly one, so this cannot silently start testing some other section's
    // sub line if one is ever added earlier in the panel.
    expect(subs).toHaveLength(1);
    expect(subs[0].parentElement?.textContent).toContain(t("en-US", "reportsTotal"));
  });

  it("shows no cancelled line when nothing is cancelled", () => {
    const { container } = renderReports([makeTask({ id: 1, assignee: "Alex", status: "To Do" })]);
    expect(container.querySelector("[data-tile-sub]")).toBeNull();
  });
});

// ★★ The §66 change altered this sort SILENTLY: the within-colour tiebreak sums
//    `counts`, which now excludes out-of-scope work, so the rank is IN-SCOPE
//    size rather than group size. Deliberate (cancelled work does not "move the
//    needle"), but it shipped with no test until a mutation pass flagged it.
describe("ReportsPanel — group cards rank by in-scope size, not raw size", () => {
  it("puts a smaller active group above a larger mostly-cancelled one", () => {
    renderReports([
      makeTask({ id: 1, assignee: "A", group: "Mostly cancelled", status: "To Do" }),
      makeTask({ id: 2, assignee: "B", group: "Mostly cancelled", status: "Cancelled" }),
      makeTask({ id: 3, assignee: "C", group: "Mostly cancelled", status: "Cancelled" }),
      makeTask({ id: 4, assignee: "D", group: "Active", status: "To Do" }),
      makeTask({ id: 5, assignee: "E", group: "Active", status: "To Do" }),
    ]);
    const names = screen.getAllByTitle(/^(Active|Mostly cancelled)$/).map((el) => el.textContent);
    // By raw size "Mostly cancelled" (3) would lead; by in-scope size "Active"
    // (2 vs 1) does. Both groups share a colour bucket, so the tiebreak decides.
    expect(names).toEqual(["Active", "Mostly cancelled"]);
  });
});

describe("ReportsPanel — a group card does not count cancelled work Green", () => {
  it("names the cancelled count and leaves Green at zero (open-followups §66)", () => {
    renderReports([
      makeTask({ id: 1, assignee: "Alex", group: "Alpha", status: "To Do" }),
      makeTask({ id: 2, assignee: "Bea", group: "Alpha", status: "Cancelled" }),
    ]);
    // TWO, and the count is the point: the Total tile's sub line already said
    // "1 cancelled" before this change, so a bare getByText finds that one and
    // passes with the group card left unfixed. (It does not merely pass — it
    // THROWS on the second match, which is how this was caught.)
    expect(screen.getAllByText(/1 cancelled/)).toHaveLength(2);
    // The point of §66: before this, the cancelled row was tallied Green, so
    // the same fixture read "… · 1 green". Asserting the absence is what fails
    // on the unfixed code — the presence assertion above would pass either way
    // once the clause exists.
    expect(screen.queryByText(/1 green/)).toBeNull();
  });
});
