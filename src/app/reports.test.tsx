import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportsPanel } from "./reports";
import type { BudgetBucket, ResourcePlan, Role, Task } from "./types";
import type { AddableReportId } from "./addable-reports";
import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";

const TODAY = "2026-05-28";

function makeTask(p: Partial<Task> & { id: number; assignee: string }): Task {
  return {
    id: p.id,
    taskName: p.taskName ?? `Task ${p.id}`,
    assignee: p.assignee,
    assigneeEmail: p.assigneeEmail ?? "",
    priority: p.priority ?? "Medium",
    startDate: p.startDate ?? TODAY,
    dueDate: p.dueDate ?? TODAY,
    completedDate: p.completedDate,
    lastUpdateDate: p.lastUpdateDate ?? TODAY,
    blockers: p.blockers ?? "",
    description: p.description ?? "",
    inquiriesSent: p.inquiriesSent ?? 0,
    group: p.group ?? "",
    labels: p.labels ?? [],
    dependencies: p.dependencies ?? [],
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
